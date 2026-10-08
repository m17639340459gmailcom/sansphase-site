import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityListingFixture, owner, reader, listingIds as ids } from './fixtures/community-listing.mjs';

const baseSetup = createCommunityListingFixture(test);
async function setup(t) {
  const fixture = await baseSetup(t);
  return { ...fixture, list: (path = 'topics?sort=curated', identity) => fixture.list(path, identity) };
}

test('curated keeps all featured topics first by last activity, then ranks the rest by existing heat', async t => {
  const f = await setup(t);
  const older = f.topic('更早活动但刚评定的精华', 100);
  const recent = f.topic('近期活动但更早评定的精华', 90);
  f.store.setFeatured(older.id, true, { now: f.ago(0) });
  f.store.setFeatured(recent.id, true, { now: f.ago(60) });
  f.store.addReply({ topicId: older.id, author: reader('author'), body: '精华较早的后续讨论', now: f.ago(10) });
  f.store.addReply({ topicId: recent.id, author: reader('author'), body: '精华较新的后续讨论', now: f.ago(5) });
  const hot = f.topic('互动更多的普通帖子', .1);
  for (let i = 0; i < 5; i++) f.store.addReply({ topicId: hot.id, author: reader('author'), body: `有效的讨论回复 ${i}`, now: f.ago(.05) });
  const fresh = f.topic('发布时间更新但没有互动', 0);
  const pinned = f.topic('旧置顶不应超过精选内容规则', 200, { pin: true });

  const page = await f.list();
  assert.deepEqual(ids(page), [recent.id, older.id, hot.id, fresh.id, pinned.id]);
  assert.deepEqual(page.items.map(item => item.featured), [true, true, false, false, false]);
  assert.equal(page.pageSize, 6);
  assert.equal(page.items[2].replies, 5, 'the compact presentation receives authoritative interaction counts');
  assert.equal(page.items[0].author.name, '测试站长', 'the complete existing topic DTO remains available');
});

test('curated sorts the complete pool before six-item paging, keeps older featured posts and never duplicates pages', async t => {
  const f = await setup(t), featured = [], ordinary = [];
  for (let i = 0; i < 9; i++) {
    const item = f.topic(`旧精华 ${i}`, 100 + i);
    f.store.setFeatured(item.id, true);
    featured.push(item.id);
  }
  for (let i = 0; i < 25; i++) ordinary.push(f.topic(`普通主题 ${i}`, 10 + i).id);
  const expected = [...featured, ...ordinary], accumulated = [];
  for (let page = 1; page <= 6; page++) {
    const listing = await f.list(`topics?sort=curated&page=${page}`);
    assert.equal(listing.page, page);
    assert.equal(listing.pageSize, 6);
    assert.equal(listing.total, expected.length);
    assert.deepEqual(ids(listing), expected.slice((page - 1) * 6, page * 6));
    accumulated.push(...ids(listing));
  }
  assert.deepEqual(accumulated, expected);
  assert.equal(new Set(accumulated).size, expected.length);
  assert.deepEqual((await f.list('topics?sort=curated&page=7')).items, []);
  const latest = await f.list('topics?sort=newest');
  assert.equal(latest.pageSize, 20, 'other existing sort modes keep their pagination contract');
  assert.equal(latest.items.length, 20);
  assert.ok(latest.items.every(item => !item.featured), 'these featured fixtures really lie beyond the newest first page');
  for (const sort of ['active', 'hot', 'featured']) assert.equal((await f.list(`topics?sort=${sort}`)).pageSize, 20, `legacy ${sort} API remains valid`);
});

test('curated excludes private titles and totals before paging and honors membership expiry on the next read', async t => {
  const f = await setup(t), publicIds = [], privateIds = [];
  for (let i = 0; i < 8; i++) publicIds.push(f.topic(`公开主题 ${i}`, 10 + i).id);
  for (let i = 0; i < 7; i++) {
    const item = f.topic(`VIP-PRIVATE-精选-${i}`, 100 + i, { board: 'vip' });
    f.store.setFeatured(item.id, true);
    privateIds.push(item.id);
  }
  const ordinary = await f.list();
  assert.equal(ordinary.total, publicIds.length);
  assert.deepEqual(ids(ordinary), publicIds.slice(0, 6));
  assert.ok(ordinary.items.every(item => item.board !== 'vip'));
  assert.equal(JSON.stringify(ordinary).includes('VIP-PRIVATE'), false);
  assert.equal((await f.get('topics?sort=curated&board=vip')).status, 404);
  const member = await f.list('topics?sort=curated', 'vip');
  assert.equal(member.total, publicIds.length + privateIds.length);
  assert.deepEqual(ids(member), privateIds.slice(0, 6));
  f.accounts.get('vip').vip = false;
  const expired = await f.list('topics?sort=curated', 'vip');
  assert.equal(expired.total, publicIds.length);
  assert.deepEqual(ids(expired), publicIds.slice(0, 6));
  assert.equal(JSON.stringify(expired).includes('VIP-PRIVATE'), false);
});

test('curated rechecks a revoked moderator scope after asynchronous person lookup before publishing a page', async t => {
  const f = await setup(t), publicIds = [];
  f.store.staff.appoint(owner, reader('mod'), { role: 'moderator', boards: ['qa', 'vip'], permissions: ['content.inspect'], delegable: [] });
  for (let i = 0; i < 8; i++) publicIds.push(f.topic(`降权后可见公开主题 ${i}`, 10 + i).id);
  for (let i = 0; i < 7; i++) {
    const item = f.topic(`REVOKED-PRIVATE-${i}`, 100 + i, { board: 'vip' });
    f.store.setFeatured(item.id, true);
  }
  let revoked = false;
  f.onPeople(authors => {
    if (!revoked && authors.some(author => author.kind === 'owner')) {
      revoked = true;
      f.store.staff.revoke(owner, reader('mod'));
    }
  });
  const listing = await f.list('topics?sort=curated', 'mod');
  assert.equal(revoked, true, 'revocation occurs during the real route person projection');
  assert.equal(listing.total, publicIds.length);
  assert.deepEqual(ids(listing), publicIds.slice(0, 6));
  assert.equal(JSON.stringify(listing).includes('REVOKED-PRIVATE'), false);
  assert.equal(f.store.staff.state(reader('mod')), null);
});

test('curated applies board, tag, search and author scopes before ranking and does not borrow unrelated items', async t => {
  const f = await setup(t);
  const tool = f.topic('命中的精选工具', 100, { board: 'tools', tags: ['提示词'] });
  f.store.setFeatured(tool.id, true);
  const question = f.topic('命中的普通问题', 0, { tags: ['提示词'], author: reader('author') });
  const elsewhere = f.topic('无关的另一篇精华', 1, { board: 'tools', tags: ['工作流'] });
  f.store.setFeatured(elsewhere.id, true);
  f.topic('无关的普通主题', 0, { tags: ['本地模型'] });
  const privateTopic = f.topic('命中的VIP-PRIVATE精华', 0, { board: 'vip', tags: ['提示词'] });
  f.store.setFeatured(privateTopic.id, true);
  const filtered = params => f.list(`topics?${new URLSearchParams({ sort: 'curated', ...params })}`);
  assert.deepEqual(ids(await filtered({ board: 'tools' })), [elsewhere.id, tool.id]);
  assert.deepEqual(ids(await filtered({ tag: '提示词' })), [tool.id, question.id]);
  assert.deepEqual(ids(await filtered({ q: '命中' })), [tool.id, question.id]);
  assert.deepEqual(ids(await filtered({ board: 'tools', tag: '提示词', q: '命中' })), [tool.id]);
  assert.deepEqual(ids(await filtered({ author: '10004' })), [question.id]);
  assert.equal((await filtered({ board: 'tools', q: '不存在的关键词' })).total, 0);
  assert.equal((await f.get('topics?sort=curated&board=missing')).status, 404);
  assert.equal((await f.get(`topics?sort=curated&tag=${encodeURIComponent('未知标签')}`)).status, 404);
});

test('curated never promotes pending, hidden or deleted featured posts and preserves a real empty list', async t => {
  const f = await setup(t);
  const pending = f.topic('待审精华不能进入榜单', 0, { pending: '需要审核' });
  const hidden = f.topic('隐藏精华不能进入榜单');
  const deleted = f.topic('删除精华不能进入榜单');
  for (const item of [pending, hidden, deleted]) f.store.setFeatured(item.id, true);
  f.store.hide({ kind: 'topic', id: hidden.id }, '测试隐藏');
  f.store.deleteTopic(deleted.id);
  const empty = await f.list();
  assert.equal(empty.total, 0);
  assert.equal(empty.pageSize, 6);
  assert.deepEqual(empty.items, []);
  const published = f.topic('真实可见的精华');
  f.store.setFeatured(published.id, true);
  assert.deepEqual(ids(await f.list()), [published.id]);
  assert.equal((await f.get('topics?sort=curated', '')).status, 401);
});
