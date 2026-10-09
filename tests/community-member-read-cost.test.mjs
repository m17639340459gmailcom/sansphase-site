import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createCommunityListingFixture, owner, reader } from './fixtures/community-listing.mjs';

const setup = createCommunityListingFixture(test);
const quietTabs = ['badges', 'icons', 'frames'];
const subject = reader('reader');

// Use the unchanged content readers as the compatibility oracle: their limits
// are applied before board visibility, and newest also includes paid/owner pins.
const oldCounts = (store, member, visible, self) => ({
  topics: store.listTopics({ author: member, sort: 'newest', page: 1, pageSize: 100 }).items.filter(item => visible(item.board)).length,
  replies: store.memberReplies(member).filter(item => visible(item.board)).length,
  bookmarks: self ? store.topics(store.bookmarks(member)).filter(item => visible(item.board)).length : 0,
});

function captureSQL(t) {
  let recording = false, queries = [];
  for (const method of ['all', 'get', 'run']) {
    const original = StatementSync.prototype[method];
    t.mock.method(StatementSync.prototype, method, function (...args) {
      const result = Reflect.apply(original, this, args);
      if (recording) queries.push({ method, sql: this.sourceSQL.replace(/\s+/g, ' ').trim(), rows: Array.isArray(result) ? result.length : method === 'get' && result ? 1 : 0 });
      return result;
    });
  }
  return async run => {
    queries = []; recording = true;
    try { return { value: await run(), queries }; }
    finally { recording = false; }
  };
}

async function seed(f, { topics = 200, replies = 250, bookmarks = 120, mixed = false } = {}) {
  const created = [];
  for (let i = 0; i < topics; i++) created.push(f.topic(`个人标签合成主题 ${i}`, i + 1, {
    author: subject, board: mixed && i % 5 === 0 ? 'vip' : 'qa',
  }));
  const repliesCreated = [];
  for (let i = 0; i < replies; i++) repliesCreated.push(f.store.addReply({
    topicId: created[i % created.length].id, author: subject,
    body: `只用于个人标签读取回归的合成回复 ${i}`, now: f.ago(i / 100 + .01),
  }));
  for (const item of created.slice(0, bookmarks)) f.store.bookmark(item.id, subject, true);
  return { created, repliesCreated };
}

test('non-content member tabs retain capped visible counts, pin ordering and full qualification data', async t => {
  const f = await setup(t);
  const { created, repliesCreated } = await seed(f, { topics: 140, replies: 80, bookmarks: 125, mixed: true });
  const oldPublicPin = f.topic('超出最近100条但应计入的置顶', 1000, { author: subject, pin: true });
  const oldPrivatePin = f.topic('占据前100条位置的私有置顶', 1001, { author: subject, board: 'vip', pin: true });
  const paid = f.topic('应计入前100条的旧推荐', 1002, { author: subject, board: 'tools' });
  f.store.ledger.credit(subject, 1000, 'fixture', null, f.ago(0));
  const expiredPaid = f.topic('已过期推荐不能挤入前100条', 1003, { author: subject, board: 'tools' });
  f.store.economy.paidPin(expiredPaid.id, subject, Date.parse(f.ago(10)));
  f.store.economy.paidPin(paid.id, subject);
  const pending = f.topic('待审不计数', .001, { author: subject, pending: 'fixture' });
  f.store.hide({ kind: 'topic', id: created[2].id }, 'fixture');
  f.store.deleteTopic(created[3].id);
  f.store.hide({ kind: 'reply', id: repliesCreated[4].id }, 'fixture');
  f.store.deleteReply(repliesCreated[6].id);
  for (const item of [oldPublicPin, oldPrivatePin, paid, expiredPaid, pending]) f.store.bookmark(item.id, subject, true);
  const limited = f.store.listTopics({ author: subject, sort: 'newest', page: 1, pageSize: 100 }).items;
  assert.ok(limited.some(item => item.id === oldPublicPin.id));
  assert.ok(limited.some(item => item.id === oldPrivatePin.id));
  assert.ok(limited.some(item => item.id === paid.id));
  assert.equal(limited.some(item => item.id === expiredPaid.id), false);

  for (const [identity, self, visible] of [
    ['reader', true, board => board !== 'vip'],
    ['vip', false, () => true],
    ['author', false, board => board !== 'vip'],
  ]) {
    const expected = oldCounts(f.store, subject, visible, self);
    const full = await f.list('members/10001?tab=topics', identity);
    assert.deepEqual(full.counts, expected);
    for (const tab of quietTabs) {
      const page = await f.list(`members/10001?tab=${tab}`, identity);
      assert.deepEqual(page.counts, expected, `${identity}/${tab} keeps the existing limited visible counts`);
      assert.deepEqual([page.stats.topics, page.stats.replies], [expected.topics, expected.replies]);
      assert.deepEqual([page.topics, page.replies, page.bookmarks], [[], [], []]);
      assert.deepEqual(page.person, full.person);
      assert.deepEqual(page.badgeState, full.badgeState, 'skipping payload reads cannot skip earned achievements');
      assert.deepEqual(page.badges, full.badges);
      assert.deepEqual(page.iconState, full.iconState);
    }
  }
});

for (const tab of quietTabs) test(`${tab} reads lightweight counts without loading reply attachments or per-bookmark summaries`, async t => {
  const f = await setup(t);
  await seed(f);
  const expected = oldCounts(f.store, subject, () => true, true);
  const capture = captureSQL(t);
  const { value: page, queries } = await capture(() => f.list(`members/10001?tab=${tab}`));
  const attachments = queries.filter(query => /^SELECT id, width, height FROM community_images WHERE topic_id = \? AND reply_id = \?/i.test(query.sql));
  const bookmarkSummaries = queries.filter(query => query.method === 'get' && query.sql.includes('AS last_kind') && query.sql.includes('t.body FROM community_topics t WHERE t.id = ?'));
  t.diagnostic(JSON.stringify({ tab, sql: queries.length, rows: queries.reduce((sum, query) => sum + query.rows, 0), replyAttachmentReads: attachments.length, bookmarkSummaryReads: bookmarkSummaries.length }));
  assert.deepEqual(page.counts, expected);
  assert.equal(attachments.length, 0, 'non-content tabs must not hydrate unused reply images');
  assert.equal(bookmarkSummaries.length, 0, 'counting bookmarks must not read a full listed topic per bookmark');
  assert.ok(queries.length < 180, `non-content tab SQL must remain bounded for this fixture; got ${queries.length}`);
});

test('content member tabs retain topic, reply image and self-bookmark payloads', async t => {
  const f = await setup(t);
  const item = f.topic('内容标签仍读取完整配图', 1, { author: subject });
  const image = randomUUID();
  f.store.addImage({ id: image, uploader: subject, width: 800, height: 600 });
  const reply = f.store.addReply({ topicId: item.id, author: subject, body: '正文和图片均应保留', images: [image] });
  f.store.bookmark(item.id, subject, true);
  const expected = oldCounts(f.store, subject, () => true, true);
  for (const tab of ['topics', 'replies', 'bookmarks']) {
    const page = await f.list(`members/10001?tab=${tab}`);
    assert.deepEqual(page.counts, expected);
    if (tab === 'topics') assert.deepEqual(page.topics.map(topic => topic.id), [item.id]);
    if (tab === 'replies') {
      assert.deepEqual(page.replies.map(item => item.id), [reply.id]);
      assert.deepEqual(page.replies[0].images, [{ id: image, width: 800, height: 600 }]);
    }
    if (tab === 'bookmarks') assert.deepEqual(page.bookmarks.map(topic => topic.id), [item.id]);
  }
  const other = await f.list('members/10001?tab=bookmarks', 'author');
  assert.equal(other.counts.bookmarks, 0);
  assert.deepEqual(other.bookmarks, []);
});

test('lightweight counts preserve equal-time input order at the 100-topic and 50-reply visibility boundaries', async t => {
  let fixtureDB;
  const originalPrepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (statement, ...options) {
    if (statement.includes('AS last_kind') && statement.includes('FROM community_topics t')) fixtureDB = this;
    return Reflect.apply(originalPrepare, this, [statement, ...options]);
  });
  const f = await setup(t), created = [], at = f.ago(1);
  assert.ok(fixtureDB, 'only the fresh migrated fixture store supplies this handle');
  // A valid alternative index must not change which tied rows fall inside the
  // existing cap. This reproduces planner changes without touching real data.
  fixtureDB.exec('CREATE INDEX fixture_member_author_time ON community_topics(author_kind,author_id,created_at,board)');
  for (let i = 0; i < 130; i++) {
    const item = f.topic(`相同发布时间边界 ${i}`, 1, { author: subject, board: i < 60 ? 'vip' : 'qa', now: at });
    created.push(item);
    // Equal publication times make the original candidate input order matter.
    // Activity order deliberately differs from insertion/author-index order.
    f.store.addReply({ topicId: item.id, author: reader('author'), body: '修改活动时间但不改变发布时间', now: f.ago(i / 100 + .01) });
  }
  f.topic('相同排序下的旧公共置顶', 100, { author: subject, pin: true });
  f.topic('相同排序下的旧私有置顶', 100, { author: subject, board: 'vip', pin: true });
  const paid = f.topic('相同排序下的旧公共推荐', 101, { author: subject, board: 'showcase' });
  f.store.ledger.credit(subject, 1000, 'fixture', null, f.ago(0));
  f.store.economy.paidPin(paid.id, subject);
  for (let i = 0; i < 75; i++) f.store.addReply({
    topicId: created[i * 7 % created.length].id, author: subject, body: `相同时间回复 ${i}`, now: f.ago(.001),
  });
  for (const item of created) f.store.bookmark(item.id, subject, true);
  for (const [identity, visible, self] of [
    ['reader', board => board !== 'vip', true], ['vip', () => true, false],
  ]) {
    const expected = oldCounts(f.store, subject, visible, self);
    assert.equal(expected.replies, f.store.memberReplies(subject).filter(item => visible(item.board)).length);
    for (const tab of quietTabs) assert.deepEqual((await f.list(`members/10001?tab=${tab}`, identity)).counts, expected, `${identity}/${tab}`);
  }
});

test('non-content final profile lookup still removes expired VIP and revoked staff icons while retaining the selection', async t => {
  const f = await setup(t), vip = reader('vip'), mod = reader('mod');
  f.store.members.setIcon(vip, 'vip:1');
  f.onPeople(authors => { if (authors.some(member => member.id === 'vip')) f.accounts.get('vip').vip = false; });
  const expired = await f.list('members/10002?tab=icons', 'vip');
  assert.equal(expired.person.vip, false);
  assert.equal(expired.person.vipGrowth.active, false);
  assert.equal(expired.person.icon, null);
  assert.equal(expired.iconState.selected, 'vip:1');
  assert.equal(expired.iconState.available.some(icon => icon.startsWith('vip:')), false);

  f.store.staff.appoint(owner, mod, { role: 'moderator', boards: ['qa', 'vip'], permissions: ['content.inspect'], delegable: [] });
  f.store.members.setIcon(mod, 'staff:moderator');
  let revoked = false;
  f.onPeople(authors => {
    if (!revoked && authors.some(member => member.id === 'mod')) { revoked = true; f.store.staff.revoke(owner, mod); }
  });
  const retired = await f.list('members/10003?tab=icons', 'mod');
  assert.equal(revoked, true);
  assert.equal(retired.person.staffRole, null);
  assert.equal(retired.person.icon, null);
  assert.equal(retired.iconState.selected, 'staff:moderator');
  assert.equal(retired.iconState.available.includes('staff:moderator'), false);
  f.store.members.setIcon(mod, '');
  f.onPeople(() => {});
  const none = await f.list('members/10003?tab=icons', 'mod');
  assert.equal(none.iconState.selected, '');
  assert.equal(none.person.icon, null, 'explicit non-wear stays explicit');
});
