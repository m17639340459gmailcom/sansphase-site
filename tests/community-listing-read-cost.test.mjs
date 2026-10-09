import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StatementSync } from 'node:sqlite';
import { createCommunityListingFixture, owner, reader, listingIds as ids } from './fixtures/community-listing.mjs';

const setup = createCommunityListingFixture(test);

function captureSQL(t) {
  let recording = false, queries = [];
  for (const method of ['all', 'get', 'run']) {
    const original = StatementSync.prototype[method];
    t.mock.method(StatementSync.prototype, method, function (...args) {
      const value = Reflect.apply(original, this, args);
      if (recording) queries.push({ method, sql: this.sourceSQL.replace(/\s+/g, ' ').trim(), args,
        rows: Array.isArray(value) ? value.length : method === 'get' && value ? 1 : 0,
        fields: Array.isArray(value) && value.length ? Object.keys(value[0]) : [],
        fullBody: Array.isArray(value) ? value.some(row => Object.hasOwn(row, 'body')) : Boolean(value && Object.hasOwn(value, 'body')) });
      return value;
    });
  }
  return async run => {
    queries = []; recording = true;
    try { return { value: await run(), queries }; }
    finally { recording = false; }
  };
}

const summaryReads = queries => queries.filter(query => query.sql.includes('AS last_kind'));
const publicAccessReads = queries => queries.filter(query => /^SELECT t\.id,\s*t\.board FROM json_each\(\?\)/i.test(query.sql));
const boardReads = queries => queries.filter(query => /^SELECT id FROM community_boards WHERE id\s*=\s*\?/i.test(query.sql));

test('public access batch preserves input order and duplicates while reading only live public id and board', async t => {
  const f = await setup(t), first = f.topic('只需读取资格的公开主题', 1), moved = f.topic('移动后读取当前板块', 2);
  const pending = f.topic('待审不进入公开访问核对', 0, { pending: 'fixture' });
  const hidden = f.topic('隐藏不进入公开访问核对', 0), deleted = f.topic('删除不进入公开访问核对', 0);
  f.store.hide({ kind: 'topic', id: hidden.id }, 'fixture');
  f.store.deleteTopic(deleted.id);
  f.store.move(moved.id, 'vip');
  const input = [moved.id, first.id, moved.id, 'missing', pending.id, hidden.id, deleted.id, first.id];
  const oracle = f.store.topics(input).map(({ id, board }) => ({ id, board }));
  const capture = captureSQL(t);
  const { value, queries } = await capture(() => f.store.publicTopicAccesses(input));
  assert.deepEqual(value, oracle);
  assert.deepEqual(value, [{ id: moved.id, board: 'vip' }, { id: first.id, board: 'qa' }, { id: moved.id, board: 'vip' }, { id: first.id, board: 'qa' }]);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].fields, ['id', 'board']);
  assert.equal(publicAccessReads(queries).length, 1);
  assert.equal(summaryReads(queries).length, 0);
  assert.equal(/community_(?:replies|reactions|views|images|votes)/.test(queries[0].sql), false, 'an authorization projection performs no unused summary subqueries');
});

test('public access empty batch reads no SQL and a large ordered batch safely occupies one JSON parameter', async t => {
  const f = await setup(t), first = f.topic('第一份访问投影', 1), second = f.topic('第二份访问投影', 2);
  const capture = captureSQL(t), empty = await capture(() => f.store.publicTopicAccesses([]));
  assert.deepEqual(empty.value, []);
  assert.equal(empty.queries.length, 0);
  const input = Array.from({ length: 2100 }, (_, index) => index % 2 ? second.id : first.id);
  input.splice(17, 0, '', "' OR 1=1 -- 😀", '不存在的中文ID');
  const { value, queries } = await capture(() => f.store.publicTopicAccesses(input));
  assert.deepEqual(value.map(row => row.id), input.filter(id => id === first.id || id === second.id));
  assert.equal(queries.length, 1);
  assert.equal(queries[0].args.length, 1);
  assert.deepEqual(JSON.parse(queries[0].args[0]), input);
  assert.deepEqual(queries[0].fields, ['id', 'board']);
});

test('batch summaries retain input order, duplicate ids, visibility exclusions and every existing listed field', async t => {
  const f = await setup(t), images = Array.from({ length: 5 }, () => randomUUID());
  for (const id of images) f.store.addImage({ id, uploader: owner, width: 800, height: 600 });
  const subject = f.topic('保留所有列表字段的资源主题', 2, {
    board: 'tools', images: [images[4], images[1], images[3], images[0], images[2]], tags: ['提示词'], pin: true,
    body: '批量读取仍只返回摘要。'.repeat(80),
    meta: { tools: '测试工具', model: '测试模型', usage: '仅用于隔离测试', prompt: 'DO-NOT-RETURN-PAID-PROMPT', promptMode: 'paid', price: 8 },
    resource: { url: 'https://example.com/resource', kind: '工具', price: '免费', platform: 'Web' },
  });
  const other = f.topic('另一个公开主题', 3);
  const expired = f.topic('过期推荐仍需一致的摘要', 4, { board: 'tools' });
  const pending = f.topic('待审主题不得返回', 1, { pending: 'fixture' });
  const hidden = f.topic('已隐藏主题不得返回', 1);
  const deleted = f.topic('已删除主题不得返回', 1);
  f.store.hide({ kind: 'topic', id: hidden.id }, 'fixture');
  f.store.deleteTopic(deleted.id);
  f.store.ledger.credit(owner, 1000, 'fixture', null, f.ago(0));
  f.store.economy.paidPin(expired.id, owner, Date.parse(f.ago(10)));
  f.store.economy.paidPin(subject.id, owner);
  f.store.setFeatured(subject.id, true);
  f.store.like({ kind: 'topic', id: subject.id }, reader('reader'), true);
  f.store.view(subject.id, reader('reader'));
  f.store.vote(subject.id, reader('reader'), 'alive');
  f.store.vote(subject.id, reader('vip'), 'dead');
  f.store.addReply({ topicId: subject.id, author: reader('reader'), body: '完整回复不应进入摘要', now: f.ago(1) });
  f.store.addReply({ topicId: subject.id, author: reader('vip'), body: '同时间靠后插入的最后回复', now: f.ago(1) });
  const hiddenReply = f.store.addReply({ topicId: subject.id, author: reader('author'), body: '隐藏回复不应作为最后回复', now: f.ago(.5) });
  f.store.hide({ kind: 'reply', id: hiddenReply.id }, 'fixture');
  const deletedReply = f.store.addReply({ topicId: subject.id, author: reader('author'), body: '删除回复不应作为最后回复', now: f.ago(.2) });
  f.store.deleteReply(deletedReply.id);
  const oracle = new Map(f.store.listTopics({ sort: 'newest', page: 1, pageSize: 100 }).items.map(topic => [topic.id, topic]));
  const input = [other.id, subject.id, other.id, 'missing', pending.id, hidden.id, deleted.id, expired.id, subject.id];
  const capture = captureSQL(t);
  const { value, queries } = await capture(() => f.store.topics(input));
  assert.deepEqual(value, input.flatMap(id => oracle.has(id) ? [oracle.get(id)] : []));
  assert.deepEqual(value[1].thumbs, [images[4], images[1], images[3], images[0]]);
  assert.deepEqual(value[1].lastReply, { author: reader('vip'), at: f.ago(1) });
  assert.equal(value[1].paidPin, true);
  assert.equal(value[3].paidPin, false);
  assert.equal(JSON.stringify(value).includes('DO-NOT-RETURN-PAID-PROMPT'), false);
  assert.equal(value.some(topic => 'body' in topic), false);
  assert.equal(summaryReads(queries).length, 1, 'one bound batch replaces one full-body read per input id');
  assert.equal(summaryReads(queries)[0].fullBody, false, 'SQLite must not materialize unused complete topic bodies');
});

test('an empty batch reads no SQL and a large batch uses one JSON parameter without a variable limit or unsafe interpolation', async t => {
  const f = await setup(t), first = f.topic('第一个安全绑定的主题', 1), second = f.topic('第二个安全绑定的主题', 2);
  const capture = captureSQL(t);
  const empty = await capture(() => f.store.topics([]));
  assert.deepEqual(empty.value, []);
  assert.equal(empty.queries.length, 0);
  const input = Array.from({ length: 2100 }, (_, index) => index % 2 ? second.id : first.id);
  input.splice(17, 0, '', "' OR 1=1 -- 😀", '不存在的中文ID');
  const { value, queries } = await capture(() => f.store.topics(input));
  assert.deepEqual(value.map(topic => topic.id), input.filter(id => id === first.id || id === second.id));
  assert.equal(queries.length, 1, 'large batches do not issue one query per id');
  assert.equal(queries[0].method, 'all');
  assert.equal(queries[0].args.length, 1, 'the whole id list occupies one SQL parameter');
  assert.deepEqual(JSON.parse(queries[0].args[0]), input);
});

for (const sort of ['curated', 'published', 'newest', 'active']) {
  test(`${sort} listing keeps its summary candidates but rechecks only public access in each synchronous stage`, async t => {
    const f = await setup(t), publicIds = [];
    for (let index = 0; index < 100; index++) {
      const board = index % 5 === 0 ? 'vip' : 'qa';
      const topic = f.topic(`查询成本合成主题 ${index}`, index / 100, { board });
      if (board === 'qa') publicIds.push(topic.id);
    }
    const capture = captureSQL(t);
    const { value: listing, queries } = await capture(() => f.list(`topics?sort=${sort}`));
    const summaries = summaryReads(queries), access = publicAccessReads(queries), boards = boardReads(queries);
    t.diagnostic(JSON.stringify({ sort, topics: 100, visible: 80, sql: queries.length,
      summaryQueries: summaries.length, accessQueries: access.length, recheckFields: access[0]?.fields,
      boardQueries: boards.length, rows: queries.reduce((sum, query) => sum + query.rows, 0) }));
    assert.equal(listing.total, 80);
    assert.deepEqual(ids(listing), publicIds.slice(0, sort === 'curated' || sort === 'published' ? 6 : 20));
    assert.equal(summaries.length, 1, 'only the initial candidates need latest reply, reactions, views, thumbs and vote summaries');
    assert.equal(access.length, 1, 'one current public access batch follows the people await');
    assert.equal(access[0].rows, 80);
    assert.deepEqual(access[0].fields, ['id', 'board']);
    assert.equal(/community_(?:replies|reactions|views|images|votes)/.test(access[0].sql), false);
    assert.equal(summaries.every(query => !query.fullBody), true);
    assert.equal(boards.length, 3, 'initial QA/VIP decisions and a fresh final QA decision are independent of candidate count');
    assert.equal(JSON.stringify(listing).includes('"board":"vip"'), false);
  });
}

test('an empty following board page still retains its existing board-wide poster summary', async t => {
  const f = await setup(t);
  f.topic('非关注作者的板块主题一', 1);
  f.topic('非关注作者的板块主题二', 2);
  f.store.members.follow(reader('reader'), reader('author'), true);
  const listing = await f.list('topics?sort=following&board=qa');
  assert.deepEqual(listing.items, []);
  assert.equal(listing.total, 0);
  assert.equal(listing.followingCount, 1);
  assert.deepEqual(listing.posters.map(poster => [poster.author.name, poster.topics]), [['测试站长', 2]]);
});

test('real listing DTOs remain equal to the complete-summary guard across sorting, page boundaries and public fields', async t => {
  const f = await setup(t), image = randomUUID();
  f.store.addImage({ id: image, uploader: owner, width: 800, height: 600 });
  const featured = f.topic('保留全部资源与交互字段的精华', 30, { board: 'tools', images: [image], tags: ['提示词'],
    meta: { tools: '合成工具', model: '合成模型', usage: '仅用于接口对照', prompt: 'PRIVATE-PAID-PROMPT', promptMode: 'paid', price: 8 },
    resource: { url: 'https://example.com/resource', kind: '工具', price: '免费', platform: 'Web' } });
  f.store.setFeatured(featured.id, true);
  f.store.like({ kind: 'topic', id: featured.id }, reader('author'), true);
  f.store.view(featured.id, reader('author'));
  f.store.vote(featured.id, reader('author'), 'alive');
  f.store.addReply({ topicId: featured.id, author: reader('vip'), body: '保留最后回复作者与时间', now: f.ago(1) });
  for (let index = 0; index < 16; index++) f.topic(`分页对照主题 ${index}`, index / 100, { pin: index === 15 });
  f.topic('普通读者不能看到的精华', 0, { board: 'vip' });
  for (const sort of ['curated', 'published', 'newest', 'active', 'hot', 'featured']) for (const page of [1, 2]) {
    const path = `topics?sort=${sort}&page=${page}`;
    const lightweight = await f.list(path);
    const original = f.store.publicTopicAccesses;
    let legacy;
    try {
      f.store.publicTopicAccesses = input => f.store.topics(input);
      legacy = await f.list(path);
    } finally { f.store.publicTopicAccesses = original; }
    assert.deepEqual(lightweight, legacy, `${sort}/${page} keeps all existing response fields, ranking and totals`);
    assert.equal(JSON.stringify(lightweight).includes('PRIVATE-PAID-PROMPT'), false);
    assert.ok(lightweight.items.every(topic => topic.board !== 'vip'));
  }
});

test('a requested private board is denied if its moderator scope is revoked during the people await', async t => {
  const f = await setup(t);
  f.store.staff.appoint(owner, reader('mod'), { role: 'moderator', boards: ['qa', 'vip'], permissions: ['content.inspect'], delegable: [] });
  f.topic('BOARD-SCOPE-PRIVATE-TITLE', 1, { board: 'vip' });
  let revoked = false;
  f.onPeople(authors => {
    if (!revoked && authors.some(author => author.kind === 'owner')) {
      revoked = true;
      f.store.staff.revoke(owner, reader('mod'));
    }
  });
  const capture = captureSQL(t);
  const { value: response, queries } = await capture(() => f.get('topics?sort=published&board=vip', 'mod'));
  assert.equal(revoked, true);
  assert.equal(response.status, 404);
  assert.equal((await response.text()).includes('BOARD-SCOPE-PRIVATE-TITLE'), false);
  assert.equal(summaryReads(queries).length, 1, 'reject the newly inaccessible requested board before performing a summary batch');
});

for (const sort of ['curated', 'published', 'newest', 'active']) {
  test(`${sort} listing rechecks visibility with summaries without loading complete threads or replies`, async t => {
    const f = await setup(t), inserted = [];
    for (let i = 0; i < 15; i++) inserted.push(f.topic(`列表读取主题 ${i}`, i / 100).id);
    for (const id of inserted.slice(-3)) for (let i = 0; i < 12; i++) f.store.addReply({
      topicId: id, author: reader('author'), body: `不应由列表读取的回复正文 ${i}`, now: f.ago(2),
    });
    const expected = f.store.listTopics({ sort, page: 1, pageSize: sort === 'curated' || sort === 'published' ? 6 : 20 }).items.map(topic => topic.id);
    const originalTopic = f.store.topic.bind(f.store);
    let detailReads = 0;
    f.store.topic = id => { detailReads++; return originalTopic(id); };

    const listing = await f.list(`topics?sort=${sort}`);
    assert.equal(detailReads, 0, 'a summary page must not load whole thread bodies and replies for every candidate');
    assert.deepEqual(ids(listing), expected, 'ranking and page boundaries remain unchanged');
    assert.equal(listing.total, inserted.length);
    assert.ok(listing.items.every(item => !('body' in item) && typeof item.replies === 'number'));
    assert.equal(JSON.stringify(listing).includes('不应由列表读取的回复正文'), false);
  });
}

for (const sort of ['curated', 'published']) {
  test(`${sort} summary recheck still removes newly hidden, deleted and moved-to-private candidates after people lookup`, async t => {
    const f = await setup(t), inserted = [];
    for (let i = 0; i < 12; i++) inserted.push(f.topic(`末次复核公开主题 ${i}`, i / 100).id);
    let changed = false;
    f.onPeople(() => {
      if (changed) return;
      changed = true;
      f.store.hide({ kind: 'topic', id: inserted[0] }, '测试隐藏');
      f.store.deleteTopic(inserted[1]);
      f.store.move(inserted[2], 'vip');
    });
    const listing = await f.list(`topics?sort=${sort}`);
    assert.equal(changed, true);
    assert.equal(listing.total, 9);
    assert.deepEqual(ids(listing), inserted.slice(3, 9));
    assert.ok(listing.items.every(item => item.board === 'qa'));
    assert.equal(JSON.stringify(listing).includes('末次复核公开主题 0"'), false);
    assert.equal(JSON.stringify(listing).includes('末次复核公开主题 1"'), false);
    assert.equal(JSON.stringify(listing).includes('末次复核公开主题 2"'), false);
  });
}

test('summary recheck still removes revoked private board access after people lookup', async t => {
  const f = await setup(t), publicIds = [];
  f.store.staff.appoint(owner, reader('mod'), { role: 'moderator', boards: ['qa', 'vip'], permissions: ['content.inspect'], delegable: [] });
  for (let i = 0; i < 8; i++) publicIds.push(f.topic(`只保留公开标题 ${i}`, 10 + i).id);
  for (let i = 0; i < 7; i++) f.topic(`READ-COST-PRIVATE-${i}`, i / 1000, { board: 'vip' });
  let revoked = false;
  f.onPeople(authors => {
    if (revoked || !authors.some(author => author.kind === 'owner')) return;
    revoked = true;
    f.store.staff.revoke(owner, reader('mod'));
  });
  const originalTopic = f.store.topic.bind(f.store);
  let detailReads = 0;
  f.store.topic = id => { detailReads++; return originalTopic(id); };
  const listing = await f.list('topics?sort=published', 'mod');
  assert.equal(detailReads, 0);
  assert.equal(revoked, true);
  assert.equal(listing.total, 8);
  assert.deepEqual(ids(listing), publicIds.slice(0, 6));
  assert.equal(JSON.stringify(listing).includes('READ-COST-PRIVATE'), false);
});

for (const sort of ['curated', 'published']) {
  test(`${sort} fills a concurrently shortened page with the replacement author's real identity`, async t => {
    const f = await setup(t), firstSix = [], requests = [];
    for (let i = 0; i < 6; i++) firstSix.push(f.topic(`初始页面站长主题 ${i}`, i / 100).id);
    const replacement = f.topic('补入另一位真实作者的主题', 1, { author: reader('author') });
    let removed = false;
    f.onPeople(authors => {
      requests.push([...new Set(authors.map(author => `${author.kind}:${author.id}`))]);
      if (removed || !authors.some(author => author.kind === 'owner')) return;
      removed = true;
      f.store.deleteTopic(firstSix[0]);
    });
    const listing = await f.list(`topics?sort=${sort}`);
    assert.equal(listing.total, 6);
    assert.equal(listing.items.length, 6);
    const item = listing.items.find(topic => topic.id === replacement.id);
    assert.ok(item);
    assert.equal(item.author.name, '帖子作者', 'a replacement is not an unqueried account falsely displayed as deleted');
    assert.equal(item.author.uid, '10004');
    assert.deepEqual(requests, [['owner:owner'], ['reader:author']], 'only the missing person is queried, not the full topic pool');
  });
}

for (const change of ['move', 'hide', 'delete']) test(`a replacement affected by ${change} during its identity lookup is removed again before sending`, async t => {
  const f = await setup(t), firstSix = [], requests = [];
  for (let i = 0; i < 6; i++) firstSix.push(f.topic(`待复核公开主题 ${i}`, i / 100).id);
  const replacement = f.topic('REPLACEMENT-MOVED-PRIVATE', 1, { author: reader('author') });
  let removed = false, moved = false;
  f.onPeople(authors => {
    requests.push([...new Set(authors.map(author => `${author.kind}:${author.id}`))]);
    if (!removed && authors.some(author => author.kind === 'owner')) {
      removed = true;
      f.store.deleteTopic(firstSix[0]);
    } else if (removed && !moved && authors.some(author => author.id === 'author')) {
      moved = true;
      if (change === 'move') f.store.move(replacement.id, 'vip');
      else if (change === 'hide') f.store.hide({ kind: 'topic', id: replacement.id }, 'fixture');
      else f.store.deleteTopic(replacement.id);
    }
  });
  const listing = await f.list('topics?sort=published');
  assert.equal(moved, true, 'mutation happens while the replacement identity is being awaited');
  assert.equal(listing.total, 5);
  assert.deepEqual(ids(listing), firstSix.slice(1));
  assert.equal(JSON.stringify(listing).includes('REPLACEMENT-MOVED-PRIVATE'), false);
  assert.deepEqual(requests, [['owner:owner'], ['reader:author']]);
});

test('replacement identity lookup still rechecks freshly revoked moderator visibility', async t => {
  const f = await setup(t), firstSix = [];
  f.store.staff.appoint(owner, reader('mod'), { role: 'moderator', boards: ['qa', 'vip'], permissions: ['content.inspect'], delegable: [] });
  for (let i = 0; i < 6; i++) firstSix.push(f.topic(i === 1 ? 'REPLACEMENT-REVOKED-PRIVATE' : `可见站长主题 ${i}`, i / 100, { board: i === 1 ? 'vip' : 'qa' }).id);
  const replacement = f.topic('实际读者作者的补入主题', 1, { author: reader('author') });
  let removed = false, revoked = false;
  f.onPeople(authors => {
    if (!removed && authors.some(author => author.kind === 'owner')) {
      removed = true;
      f.store.deleteTopic(firstSix[0]);
    } else if (removed && !revoked && authors.some(author => author.id === 'author')) {
      revoked = true;
      f.store.staff.revoke(owner, reader('mod'));
    }
  });
  const listing = await f.list('topics?sort=published', 'mod');
  assert.equal(revoked, true);
  assert.equal(listing.total, 5);
  assert.deepEqual(ids(listing), [...firstSix.slice(2), replacement.id]);
  assert.equal(listing.items.at(-1).author.name, '帖子作者');
  assert.equal(JSON.stringify(listing).includes('REPLACEMENT-REVOKED-PRIVATE'), false);
});

test('a queried replacement whose account really disappeared keeps the deleted-account fallback without repeated lookups', async t => {
  const f = await setup(t), firstSix = [], requests = [];
  for (let i = 0; i < 6; i++) firstSix.push(f.topic(`待填页主题 ${i}`, i / 100).id);
  const replacement = f.topic('真实注销作者的历史主题', 1, { author: reader('gone') });
  let removed = false;
  f.onPeople(authors => {
    requests.push([...new Set(authors.map(author => `${author.kind}:${author.id}`))]);
    if (removed || !authors.some(author => author.kind === 'owner')) return;
    removed = true;
    f.store.deleteTopic(firstSix[0]);
  });
  const listing = await f.list('topics?sort=curated');
  assert.equal(listing.items.find(topic => topic.id === replacement.id).author.name, '已注销用户');
  assert.deepEqual(requests, [['owner:owner'], ['reader:gone']], 'a missing answer from a real lookup does not trigger an endless retry');
});

test('a replacement latest replier is queried independently of its already known topic author', async t => {
  const f = await setup(t), firstSix = [], requests = [];
  for (let i = 0; i < 6; i++) firstSix.push(f.topic(`只认识主题作者 ${i}`, i / 100).id);
  const replacement = f.topic('补入主题的最后回复来自另一位读者', 100);
  f.store.addReply({ topicId: replacement.id, author: reader('vip'), body: '正文不应出现在榜单，最后回复作者需要正确。', now: f.ago(99) });
  let removed = false;
  f.onPeople(authors => {
    requests.push([...new Set(authors.map(author => `${author.kind}:${author.id}`))]);
    if (removed || !authors.some(author => author.kind === 'owner')) return;
    removed = true;
    f.store.deleteTopic(firstSix[0]);
  });
  const listing = await f.list('topics?sort=published');
  const item = listing.items.find(topic => topic.id === replacement.id);
  assert.equal(item.author.name, '测试站长');
  assert.equal(item.lastReply.author.name, '会员读者');
  assert.deepEqual(requests, [['owner:owner'], ['reader:vip']]);
});

test('continuous page replacement stops after two missing-person lookups and returns an explicit retry instead of a false deleted author', async t => {
  const f = await setup(t), firstSix = [], requests = [];
  for (let i = 0; i < 6; i++) firstSix.push(f.topic(`连续变动初始主题 ${i}`, i / 100).id);
  const replacements = [
    f.topic('第一次补入作者主题', 1, { author: reader('author') }).id,
    f.topic('第二次补入作者主题', 2, { author: reader('reader') }).id,
    f.topic('第三次补入作者主题', 3, { author: reader('vip') }).id,
  ];
  const removed = new Set();
  f.onPeople(authors => {
    const keys = [...new Set(authors.map(author => `${author.kind}:${author.id}`))];
    requests.push(keys);
    const id = keys.includes('owner:owner') ? firstSix[0]
      : keys.includes('reader:author') ? replacements[0]
      : keys.includes('reader:reader') ? replacements[1] : null;
    if (id && !removed.has(id)) { removed.add(id); f.store.deleteTopic(id); }
  });
  const response = await f.get('topics?sort=published');
  assert.equal(response.status, 409);
  const value = await response.json();
  assert.match(value.error, /更新|重试|重新/);
  assert.deepEqual(requests, [['owner:owner'], ['reader:author'], ['reader:reader']]);
  assert.equal(JSON.stringify(value).includes('已注销用户'), false);
});
