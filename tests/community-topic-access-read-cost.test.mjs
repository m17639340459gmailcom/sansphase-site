import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StatementSync } from 'node:sqlite';
import { createCommunityListingFixture, owner, reader } from './fixtures/community-listing.mjs';

const setup = createCommunityListingFixture(test);
const accessOf = topic => topic && ({ id: topic.id, board: topic.board, author: topic.author, pending: topic.pending, hidden: topic.hidden });

function captureSQL(t) {
  let recording = false, queries = [];
  for (const method of ['all', 'get', 'run']) {
    const original = StatementSync.prototype[method];
    t.mock.method(StatementSync.prototype, method, function (...args) {
      const value = Reflect.apply(original, this, args);
      if (recording) queries.push({ method, sql: this.sourceSQL.replace(/\s+/g, ' ').trim(),
        rows: Array.isArray(value) ? value.length : method === 'get' && value ? 1 : 0 });
      return value;
    });
  }
  return async run => {
    recording = true; queries = [];
    try { return { value: await run(), queries }; }
    finally { recording = false; }
  };
}

const fullTopicReads = queries => queries.filter(query => query.method === 'get' && query.sql.includes('AS last_kind') && query.sql.includes('t.body FROM community_topics t WHERE t.id = ?'));
const replyReads = queries => queries.filter(query => query.method === 'all' && query.sql.includes('FROM community_replies r WHERE r.topic_id = ? AND r.deleted_at IS NULL ORDER BY r.created_at, r.rowid'));
const attachmentReads = queries => queries.filter(query => query.method === 'all' && query.sql.includes('JOIN community_replies r ON r.id = i.reply_id AND r.topic_id = i.topic_id'));
const diagnose = (t, route, queries) => t.diagnostic(JSON.stringify({ route, sql: queries.length,
  fullTopics: fullTopicReads(queries).length, replyQueries: replyReads(queries).length,
  replyRows: replyReads(queries).reduce((sum, query) => sum + query.rows, 0),
  attachmentQueries: attachmentReads(queries).length }));
const appoint = (f, boards = ['qa']) => f.store.staff.appoint(owner, reader('mod'), {
  role: 'moderator', boards, permissions: ['content.inspect', 'report.review', 'topic.approve', 'topic.delete', 'reply.delete', 'reply.restore'], delegable: [],
});

test('topic access exactly matches existing public, pending, hidden, deleted and moved topic authority fields', async t => {
  const f = await setup(t);
  const publicTopic = f.topic('公开访问投影', 1, { author: reader('author') });
  const pending = f.topic('待审访问投影', 2, { pending: 'fixture' });
  const hidden = f.topic('隐藏访问投影', 3);
  const deleted = f.topic('删除访问投影', 4);
  const moved = f.topic('移动访问投影', 5);
  f.store.hide({ kind: 'topic', id: hidden.id }, 'fixture');
  f.store.deleteTopic(deleted.id);
  f.store.move(moved.id, 'vip');
  assert.equal(typeof f.store.topicAccess, 'function');
  const capture = captureSQL(t);
  for (const id of [publicTopic.id, pending.id, hidden.id, deleted.id, moved.id, 'missing', "' OR 1=1 -- 😀"]) {
    const expected = accessOf(f.store.topic(id));
    const { value, queries } = await capture(() => f.store.topicAccess(id));
    assert.deepEqual(value, expected);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].method, 'get');
    assert.equal(queries[0].sql.includes('body'), false);
    assert.equal(queries[0].sql.includes('SELECT COUNT'), false);
    assert.equal(replyReads(queries).length, 0);
    if (value) assert.deepEqual(Object.keys(value), ['id', 'board', 'author', 'pending', 'hidden']);
  }
});

test('a 250-reply real detail GET reads the complete thread once and retains images, masks, quotes and accepted ordering', async t => {
  const f = await setup(t), topicImage = randomUUID(), replyImage = randomUUID();
  f.store.addImage({ id: topicImage, uploader: owner, width: 800, height: 600 });
  f.store.addImage({ id: replyImage, uploader: reader('author'), width: 600, height: 800 });
  const subject = f.topic('完整详情不应因资格复核再次加载回复', 1, { images: [topicImage], body: '需要保留的完整主题正文' });
  const first = f.store.addReply({ topicId: subject.id, author: reader('author'), body: '带图的原始回答', images: [replyImage], now: f.ago(.9) });
  const quoted = f.store.addReply({ topicId: subject.id, author: reader('vip'), body: '带引用的被采纳回答', quoteId: first.id, now: f.ago(.8) });
  const hidden = f.store.addReply({ topicId: subject.id, author: reader('author'), body: 'HIDDEN-REPLY-BODY', now: f.ago(.7) });
  f.store.hide({ kind: 'reply', id: hidden.id }, 'fixture');
  for (let index = 3; index < 250; index++) f.store.addReply({ topicId: subject.id, author: reader('author'), body: `合成完整回复 ${index}`, now: f.ago(.6 - index / 10000) });
  f.store.accept(quoted.id);
  const expected = f.store.topic(subject.id);
  const capture = captureSQL(t);
  const { value: thread, queries } = await capture(() => f.list(`topics/${subject.id}`));
  diagnose(t, 'detail/250-replies', queries);
  assert.equal(thread.topic.body, expected.body);
  assert.deepEqual(thread.topic.images, expected.images.map(image => ({ ...image })));
  assert.equal(thread.topic.rawTitle, expected.rawTitle);
  assert.equal(thread.topic.replies, expected.replyCount);
  assert.deepEqual(thread.replies.map(reply => reply.id), [quoted.id, ...expected.replies.filter(reply => reply.id !== quoted.id).map(reply => reply.id)]);
  assert.deepEqual(thread.replies.find(reply => reply.id === first.id).images, [{ id: replyImage, width: 600, height: 800 }]);
  assert.deepEqual(thread.replies.find(reply => reply.id === quoted.id).quote, { id: first.id, author: '帖子作者', excerpt: '带图的原始回答' });
  assert.equal(thread.replies[0].accepted, true);
  assert.equal(thread.replies.find(reply => reply.id === hidden.id).body, '');
  assert.deepEqual(thread.replies.find(reply => reply.id === hidden.id).images, []);
  for (const reply of expected.replies.filter(reply => reply.id !== hidden.id)) assert.equal(thread.replies.find(row => row.id === reply.id).body, reply.body);
  assert.equal(fullTopicReads(queries).length, 1);
  assert.equal(replyReads(queries).length, 1, 'the final permission check must not hydrate every reply again');
  assert.equal(replyReads(queries)[0].rows, 250);
  assert.equal(attachmentReads(queries).length, 1);
});

for (const route of ['summary', 'bookmarks', 'members/10001?tab=topics', 'members/10001?tab=bookmarks']) {
  test(`${route} final summary visibility checks never hydrate complete threads`, async t => {
    const f = await setup(t), topicIds = [];
    for (let index = 0; index < 8; index++) {
      const subject = f.topic(`轻量最终可见性主题 ${index}`, index + 1, { author: reader('reader') });
      topicIds.push(subject.id);
      f.store.bookmark(subject.id, reader('reader'), true);
      for (let reply = 0; reply < 15; reply++) f.store.addReply({ topicId: subject.id, author: reader('author'), body: `只供详情读取的合成正文 ${reply}`, now: f.ago(index + .5) });
    }
    const capture = captureSQL(t);
    const { value, queries } = await capture(() => f.list(route));
    diagnose(t, route, queries);
    const items = route === 'summary' ? value.hot : route.endsWith('tab=topics') ? value.topics : route.endsWith('tab=bookmarks') ? value.bookmarks : value.items;
    assert.ok(items.length > 0);
    assert.ok(items.every(topic => topicIds.includes(topic.id) && topic.replies === 15 && !('body' in topic)));
    assert.equal(fullTopicReads(queries).length, 0);
    assert.equal(replyReads(queries).length, 0);
    assert.equal(attachmentReads(queries).length, 0);
  });
}

async function moderationContent(f) {
  appoint(f);
  const publicTopic = f.topic('已分配板块的被举报主题', 2);
  const outsideTopic = f.topic('OUTSIDE-MODERATOR-TITLE', 3, { board: 'tools' });
  const pending = f.topic('已分配板块的待审主题', 1, { pending: 'fixture' });
  f.topic('OUTSIDE-PENDING-TITLE', 1, { board: 'tools', pending: 'fixture' });
  const replies = [], outsideReplies = [];
  for (let index = 0; index < 120; index++) for (const [subject, output] of [[publicTopic, replies], [outsideTopic, outsideReplies]]) {
    const reply = f.store.addReply({ topicId: subject.id, author: reader('author'), body: `管理读取隔离回复 ${index}`, now: f.ago(.5 - index / 10000) });
    output.push(reply);
    if (index < 10) f.store.hide({ kind: 'reply', id: reply.id }, 'fixture');
  }
  const reports = [];
  for (const target of [
    { kind: 'topic', id: publicTopic.id }, { kind: 'reply', id: replies[0].id },
    { kind: 'topic', id: outsideTopic.id }, { kind: 'reply', id: outsideReplies[0].id },
  ]) reports.push(f.store.report({ target, reporter: reader('reader'), reason: '人身攻击', note: `隔离报告-${target.kind}` }));
  return { publicTopic, outsideTopic, pending, replies, outsideReplies, reports };
}

test('me retains exact board-scoped review todo counts without reading reply arrays for parent or report scopes', async t => {
  const f = await setup(t);
  await moderationContent(f);
  const capture = captureSQL(t);
  const { value: me, queries } = await capture(() => f.list('me', 'mod'));
  diagnose(t, 'me/moderator', queries);
  assert.equal(me.manageTodo, 13, 'one pending topic, ten hidden replies and two reports in the assigned board');
  assert.deepEqual(me.moderationBoards, ['qa']);
  assert.equal(me.mod, true);
  assert.equal(fullTopicReads(queries).length, 0);
  assert.equal(replyReads(queries).length, 0);
  assert.equal(attachmentReads(queries).length, 0);
});

test('management preserves queue and report payloads while parent-board and final scope checks avoid full reply arrays', async t => {
  const f = await setup(t), seeded = await moderationContent(f);
  const capture = captureSQL(t);
  const { value: manage, queries } = await capture(() => f.list('manage?tab=reports', 'mod'));
  diagnose(t, 'manage/reports', queries);
  assert.deepEqual(manage.counts, { queue: 11, reports: 2, orders: 0, sanctions: 0 });
  assert.deepEqual(manage.queue.topics.map(topic => topic.id), [seeded.pending.id]);
  assert.deepEqual(manage.queue.replies.map(reply => reply.id), seeded.replies.slice(0, 10).map(reply => reply.id));
  assert.ok(manage.queue.replies.every(reply => reply.board === 'qa' && reply.author.name === '帖子作者'));
  assert.deepEqual(manage.reports.map(report => report.id), seeded.reports.slice(0, 2).map(report => report.id));
  const topicReport = manage.reports.find(report => report.target.kind === 'topic');
  const replyReport = manage.reports.find(report => report.target.kind === 'reply');
  assert.deepEqual([topicReport.target.title, topicReport.target.excerpt, topicReport.target.board], ['已分配板块的被举报主题', '用于真实列表接口回归的完整正文内容。', 'qa']);
  assert.deepEqual([replyReport.target.topicId, replyReport.target.excerpt, replyReport.target.hidden], [seeded.publicTopic.id, '管理读取隔离回复 0', true]);
  assert.equal(JSON.stringify(manage).includes('OUTSIDE-'), false);
  assert.equal(fullTopicReads(queries).length, 4, 'only the original four report payload reads require complete topic fields');
  assert.equal(replyReads(queries).length, 4);
  assert.equal(attachmentReads(queries).length, 4);
});

test('me counts use current parent boards after its profile lookup rather than an earlier queue snapshot', async t => {
  const f = await setup(t), seeded = await moderationContent(f);
  let lookups = 0, changed = false;
  f.onPeople(authors => {
    if (!authors.some(author => author.id === 'mod') || ++lookups !== 2) return;
    changed = true;
    f.store.move(seeded.publicTopic.id, 'tools');
    f.store.deleteTopic(seeded.pending.id);
  });
  const me = await f.list('me', 'mod');
  assert.equal(changed, true);
  assert.equal(me.mod, true);
  assert.deepEqual(me.moderationBoards, ['qa']);
  assert.equal(me.manageTodo, 0, 'moved reply parents, moved report targets and a deleted pending topic no longer count');
});

for (const action of ['hide', 'delete', 'move-private', 'revoke']) {
  test(`detail final authorization still rejects ${action} during asynchronous people lookup`, async t => {
    const f = await setup(t), subject = f.topic(`详情末次检查 ${action}`, 1);
    if (action === 'revoke') appoint(f);
    let changed = false;
    f.onPeople(authors => {
      if (changed || !authors.some(author => author.kind === 'owner')) return;
      changed = true;
      if (action === 'hide') f.store.hide({ kind: 'topic', id: subject.id }, 'fixture');
      else if (action === 'delete') f.store.deleteTopic(subject.id);
      else if (action === 'move-private') f.store.move(subject.id, 'vip');
      else f.store.staff.revoke(owner, reader('mod'));
    });
    const response = await f.get(`topics/${subject.id}`, action === 'revoke' ? 'mod' : 'reader');
    assert.equal(changed, true);
    assert.equal(response.status, action === 'revoke' ? 403 : 404);
    assert.equal((await response.text()).includes('用于真实列表接口回归的完整正文内容。'), false);
  });
}

for (const action of ['hide', 'delete', 'move-private']) {
  test(`bookmarked summaries still remove ${action} during asynchronous people lookup`, async t => {
    const f = await setup(t), subject = f.topic(`收藏末次检查 ${action}`, 1);
    f.store.bookmark(subject.id, reader('reader'), true);
    let changed = false;
    f.onPeople(authors => {
      if (changed || !authors.some(author => author.kind === 'owner')) return;
      changed = true;
      if (action === 'hide') f.store.hide({ kind: 'topic', id: subject.id }, 'fixture');
      else if (action === 'delete') f.store.deleteTopic(subject.id);
      else f.store.move(subject.id, 'vip');
    });
    const value = await f.list('bookmarks');
    assert.equal(changed, true);
    assert.deepEqual(value.items, []);
  });
}

for (const action of ['move', 'delete', 'revoke']) {
  test(`management final scope still rejects ${action} of a queued reply parent during people lookup`, async t => {
    const f = await setup(t);
    appoint(f);
    const subject = f.topic(`管理末次检查 ${action}`, 1);
    const reply = f.store.addReply({ topicId: subject.id, author: reader('author'), body: 'QUEUED-REPLY-PRIVATE-BODY' });
    f.store.hide({ kind: 'reply', id: reply.id }, 'fixture');
    // Ensure the bulk projection includes an owner before changing the parent.
    f.topic('管理等待中的待审主题', 2, { pending: 'fixture' });
    let changed = false;
    f.onPeople(authors => {
      if (changed || !authors.some(author => author.kind === 'owner')) return;
      changed = true;
      if (action === 'move') f.store.move(subject.id, 'tools');
      else if (action === 'delete') f.store.deleteTopic(subject.id);
      else f.store.staff.revoke(owner, reader('mod'));
    });
    const response = await f.get('manage?tab=queue', 'mod');
    assert.equal(changed, true);
    assert.equal(response.status, 403);
    assert.equal((await response.text()).includes('QUEUED-REPLY-PRIVATE-BODY'), false);
  });
}

for (const kind of ['topic', 'reply']) for (const action of ['move', 'delete']) {
  test(`management reports recheck a ${kind} target after ${action} during its people lookup without relying on queued content`, async t => {
    const f = await setup(t);
    appoint(f);
    const subject = f.topic(`REPORT-PRIVATE-${kind}-${action}`, 1);
    const reply = kind === 'reply' ? f.store.addReply({ topicId: subject.id, author: reader('author'), body: 'REPORT-REPLY-PRIVATE-BODY' }) : null;
    f.store.report({ target: { kind, id: reply ? reply.id : subject.id }, reporter: reader('reader'), reason: '人身攻击', note: 'REPORT-PRIVATE-NOTE' });
    let changed = false;
    f.onPeople(authors => {
      if (changed || !authors.some(author => kind === 'reply' ? author.id === 'author' : author.kind === 'owner')) return;
      changed = true;
      if (action === 'move') f.store.move(subject.id, 'tools');
      else f.store.deleteTopic(subject.id);
    });
    const response = await f.get('manage?tab=reports', 'mod');
    assert.equal(changed, true);
    assert.equal(response.status, 403);
    assert.equal((await response.text()).includes('REPORT-PRIVATE'), false);
  });
}
