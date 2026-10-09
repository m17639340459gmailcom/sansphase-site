import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StatementSync } from 'node:sqlite';
import { createCommunityListingFixture, owner, reader } from './fixtures/community-listing.mjs';
import { communityStaffCapabilities } from '../src/community-staff.ts';

const setup = createCommunityListingFixture(test);
const key = member => `${member.kind}:${member.id}`;

function captureSQL(t) {
  let recording = false, queries = [];
  for (const method of ['all', 'get', 'run']) {
    const original = StatementSync.prototype[method];
    t.mock.method(StatementSync.prototype, method, function (...args) {
      const value = Reflect.apply(original, this, args);
      if (recording) queries.push({ method, sql: this.sourceSQL.replace(/\s+/g, ' ').trim(), args,
        rows: Array.isArray(value) ? value.length : method === 'get' && value ? 1 : 0 });
      return value;
    });
  }
  return async run => {
    queries = []; recording = true;
    try { return { value: await run(), queries }; }
    finally { recording = false; }
  };
}

function countCalls(t, object, name) {
  const original = object[name], calls = [];
  t.mock.method(object, name, function (...args) { calls.push(args); return Reflect.apply(original, this, args); });
  return calls;
}

function staffFixture(f) {
  for (const [id, uid] of [['upper', '10101'], ['peer', '10102'], ['lower', '10103']]) {
    f.accounts.set(id, { uid, name: id, vip: false, active: true });
    f.store.members.visit(reader(id));
  }
  const permissions = communityStaffCapabilities.map(cap => cap.id);
  const input = (role, boards) => ({ role, boards, permissions, delegable: permissions });
  f.store.staff.appoint(owner, reader('upper'), input('general', ['qa', 'tools']));
  f.store.staff.appoint(reader('upper'), reader('mod'), input('moderator', ['qa']));
  f.store.staff.appoint(owner, reader('peer'), input('moderator', ['qa']));
  f.store.staff.appoint(reader('mod'), reader('lower'), input('assistant', ['qa']));
}

test('a 250-reply real detail keeps complete replies and only presents each reply/quote author once', async t => {
  const f = await setup(t), image = randomUUID();
  f.store.addImage({ id: image, uploader: reader('author'), width: 640, height: 480 });
  const subject = f.topic('重复回复作者仍保留完整详情', 1, { body: '完整主题正文必须保留' });
  const first = f.store.addReply({ topicId: subject.id, author: reader('author'), body: '有图片的引用原文', images: [image], now: f.ago(.9) });
  const accepted = f.store.addReply({ topicId: subject.id, author: reader('vip'), body: '被采纳的回答', quoteId: first.id, now: f.ago(.8) });
  const hidden = f.store.addReply({ topicId: subject.id, author: reader('author'), body: '不能泄漏的隐藏回答', quoteId: first.id, now: f.ago(.7) });
  f.store.hide({ kind: 'reply', id: hidden.id }, 'fixture');
  for (let index = 3; index < 250; index++) f.store.addReply({ topicId: subject.id, author: reader(index % 2 ? 'author' : 'vip'),
    body: `完整合成回复 ${index}`, quoteId: index % 3 === 0 ? first.id : null, now: f.ago(.6 - index / 10000) });
  f.store.accept(accepted.id);
  const expected = f.store.topic(subject.id);
  const appearances = countCalls(t, f.store.members, 'appearance');
  const capture = captureSQL(t);
  const { value: thread, queries } = await capture(() => f.list(`topics/${subject.id}`));
  const replyAppearances = appearances.slice();
  t.diagnostic(JSON.stringify({ route: 'detail/250-replies', sql: queries.length, rows: queries.reduce((sum, row) => sum + row.rows, 0),
    appearances: appearances.length }));
  assert.equal(thread.topic.body, expected.body);
  assert.equal(thread.topic.replies, 250);
  assert.deepEqual(thread.replies.map(row => row.id), [accepted.id, ...expected.replies.filter(row => row.id !== accepted.id).map(row => row.id)]);
  const people = new Map();
  for (const id of ['author', 'vip']) people.set(id, (await f.list(`members/${f.accounts.get(id).uid}?tab=icons`)).person);
  for (const reply of expected.replies) {
    const actual = thread.replies.find(row => row.id === reply.id);
    assert.deepEqual(actual, {
      id: reply.id, author: people.get(reply.author.id), body: reply.hidden ? '' : reply.body,
      createdAt: reply.createdAt, images: reply.hidden ? [] : JSON.parse(JSON.stringify(reply.images)),
      edited: reply.edited, likes: reply.likes, liked: false, thanked: false, thanks: 0,
      byTopicAuthor: false, accepted: reply.id === accepted.id, mine: false, hidden: reply.hidden,
      quote: reply.quoteId ? { id: first.id, author: '帖子作者', excerpt: '有图片的引用原文' } : null,
      canDelete: false, deleteReasonRequired: false, canEdit: false, canRestore: false,
      canPenalty: false, canMute: false, canAccept: false,
    }, `all public reply fields remain intact for ${reply.id}`);
  }
  for (const id of ['author', 'vip']) assert.equal(replyAppearances.filter(([author]) => key(author) === `reader:${id}`).length,
    1 + Number(expected.lastReply.author.id === id), 'one reply-phase presentation plus the unchanged topic lastReply author');
  assert.ok(queries.length < 1500, `reply SQL should scale with distinct authors, not repeat presentation; got ${queries.length}`);
});

for (const board of ['qa', 'tools']) test(`${board} permissions preserve self/lower/peer/upper rules and memoize false`, async t => {
  const f = await setup(t); staffFixture(f);
  const subject = f.topic(`权限缓存不能扩大 ${board} 权限`, 1, { board });
  const targets = ['mod', 'lower', 'peer', 'upper', 'author', 'owner'];
  const source = [];
  for (let round = 0; round < 4; round++) for (const id of targets) source.push(f.store.addReply({
    topicId: subject.id, author: id === 'owner' ? owner : reader(id), body: `权限回归 ${id} ${round}`, now: f.ago(.5 - source.length / 1000),
  }));
  f.store.hide({ kind: 'reply', id: source[1].id }, 'fixture');
  const expected = f.store.topic(subject.id).replies;
  const can = countCalls(t, f.store.staff, 'can'), protect = countCalls(t, f.store.staff, 'protect');
  const thread = await f.list(`topics/${subject.id}`, 'mod');
  for (const reply of expected) {
    const actual = thread.replies.find(row => row.id === reply.id), mine = reply.author.id === 'mod';
    const lower = ['lower', 'author'].includes(reply.author.id), inside = board === 'qa';
    assert.deepEqual([actual.mine, actual.canDelete, actual.deleteReasonRequired, actual.canPenalty, actual.canMute],
      [mine, mine || inside && lower, inside, inside && lower, lower]);
    assert.equal(actual.canRestore, inside && reply.id === source[1].id);
    assert.equal(actual.body, reply.id === source[1].id && !inside ? '' : reply.body);
  }
  for (const permission of ['reply.delete', 'reply.restore', 'reply.penalty'])
    assert.equal(can.filter(([, cap, scope]) => cap === permission && scope === board).length, 1, `${permission}/${board} is checked once, including false`);
  assert.equal(can.filter(([, cap]) => cap === 'member.mute').length, 1, 'global mute permission is reused for topic and replies');
  for (const id of targets) assert.equal(protect.filter(([, target]) => key(target) === `${id === 'owner' ? 'owner' : 'reader'}:${id}`).length, 1, `${id} protection outcome is cached, including self/peer/superior rejection`);
});

test('ordinary own replies stay deletable without staff protection or new edit windows', async t => {
  const f = await setup(t), subject = f.topic('普通用户自己的回复权限', 1);
  const own = f.store.addReply({ topicId: subject.id, author: reader('reader'), body: '当前自己的回复' });
  const old = f.store.addReply({ topicId: subject.id, author: reader('reader'), body: '超过编辑期限的自己的回复', now: f.ago(40) });
  const other = f.store.addReply({ topicId: subject.id, author: reader('author'), body: '其他用户的回复' });
  const protect = countCalls(t, f.store.staff, 'protect');
  const thread = await f.list(`topics/${subject.id}`);
  assert.deepEqual(thread.replies.filter(row => [own.id, old.id].includes(row.id)).map(row => [row.mine, row.canDelete, row.canEdit]), [[true, true, false], [true, true, true]]);
  assert.equal(thread.replies.find(row => row.id === other.id).canDelete, false);
  assert.equal(protect.length, 0, 'ordinary own withdrawal and false permissions preserve their short circuit');
});

test('the first same-author trust calculation upgrades every reply and sends one level notice', async t => {
  const f = await setup(t), author = reader('author');
  f.store.members.visit(author, Date.parse(f.ago(2)));
  f.store.members.visit(author, Date.parse(f.ago(1)));
  f.topic('满足巡天的作者已发表主题', 3, { author });
  const subject = f.topic('首次读取等级的重复回复', 1);
  for (let index = 0; index < 8; index++) f.store.addReply({ topicId: subject.id, author, body: `首次读取回归 ${index}`, now: f.ago(.5 - index / 1000) });
  f.store.members.setIcon(author, 'trust:1');
  assert.equal(f.store.members.storedLevel(author), 0);
  const before = f.store.members.inbox(author).filter(notice => notice.type === 'level').length;
  const thread = await f.list(`topics/${subject.id}`);
  assert.ok(thread.replies.every(reply => reply.author.level === 1 && reply.author.icon === 'trust:1'));
  assert.equal(f.store.members.storedLevel(author), 1);
  assert.equal(f.store.members.inbox(author).filter(notice => notice.type === 'level').length - before, 1);
});

for (const change of ['revoke', 'deactivate', 'move']) test(`the final awaited people stage still rejects ${change} before reply caches exist`, async t => {
  const f = await setup(t); staffFixture(f);
  const subject = f.topic(`末次等待期间 ${change}`, 1);
  const reply = f.store.addReply({ topicId: subject.id, author: reader('author'), body: 'FINAL-AWAIT-PRIVATE-BODY' });
  f.store.hide({ kind: 'reply', id: reply.id }, 'fixture');
  let changed = false;
  f.onPeople(authors => {
    if (changed || authors.length) return;
    changed = true;
    if (change === 'revoke') f.store.staff.revoke(owner, reader('mod'));
    else if (change === 'deactivate') f.accounts.get('upper').active = false;
    else f.store.move(subject.id, 'tools');
  });
  const response = await f.get(`topics/${subject.id}`, 'mod');
  assert.equal(changed, true, 'the empty mention people batch is the final asynchronous presentation stage');
  assert.equal(response.status, 403);
  assert.equal((await response.text()).includes('FINAL-AWAIT-PRIVATE-BODY'), false);
});

test('reply presentation never crosses the author badge issuance boundary into related topics', async t => {
  const f = await setup(t), author = reader('author');
  // VIP content is not writing evidence; moving it does not eagerly issue
  // honors. The original author sidebar is the first badgeState read.
  const subject = f.topic('成就尚未补发的作者主题', 1, { author, board: 'vip' });
  const related = f.topic('同作者的相关主题要读新成就', 2, { author, board: 'vip' });
  const first = f.store.addReply({ topicId: subject.id, author, body: '与主题作者相同的回复' });
  f.store.addReply({ topicId: subject.id, author, body: '再次引用同作者的回复', quoteId: first.id });
  f.store.addReply({ topicId: related.id, author, body: '相关主题的最后回复也要重新读取' });
  f.store.move(subject.id, 'qa');
  f.store.move(related.id, 'qa');
  f.store.members.setIcon(author, 'badge:writing:gold');
  assert.equal(f.store.members.hasIconHonor(author, 'writing', 'gold'), false);
  const thread = await f.list(`topics/${subject.id}`);
  assert.equal(thread.replies[0].author.icon, null, 'reply map runs before the original author badgeState');
  assert.equal(thread.topic.author.icon, null);
  assert.equal(thread.author.icon, null);
  assert.equal(thread.author.badgeState.families.find(family => family.id === 'writing').tier, 'gold');
  assert.equal(thread.related.find(topic => topic.id === related.id).author.icon, 'badge:writing:gold', 'related must retain its fresh person read after badge issuance');
  assert.equal(thread.related.find(topic => topic.id === related.id).lastReply.author.icon, 'badge:writing:gold');
  assert.ok((await f.list(`topics/${subject.id}`)).replies.every(reply => reply.author.icon === 'badge:writing:gold'));
});

test('a following detail request immediately sees changed icon and revoked qualifications', async t => {
  const f = await setup(t); staffFixture(f);
  const author = reader('lower'), subject = f.topic('跨请求不能复用旧身份', 1);
  for (let index = 0; index < 3; index++) f.store.addReply({ topicId: subject.id, author, body: `身份变更的回复 ${index}` });
  f.store.members.setIcon(author, 'staff:assistant');
  assert.ok((await f.list(`topics/${subject.id}`)).replies.every(reply => reply.author.icon === 'staff:assistant'));
  f.store.members.setIcon(author, '');
  assert.ok((await f.list(`topics/${subject.id}`)).replies.every(reply => reply.author.icon === null));
  f.store.members.setIcon(author, 'staff:assistant');
  f.store.staff.revoke(owner, author);
  const retired = await f.list(`topics/${subject.id}`);
  assert.ok(retired.replies.every(reply => reply.author.icon === null && reply.author.staffRole === null && !reply.author.steward));
});
