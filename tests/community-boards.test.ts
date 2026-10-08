import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { communityBoards, defaultCommunityBoards, installCommunityBoardCatalog, resetCommunityBoardCatalog } from '../src/community.ts';
import { availableCommunityBoardIcons } from '../src/community-board-icons.ts';
import { bodyImageMarker } from '../src/community-body-images.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const owner = { kind: 'owner' as const, id: 'owner' };
const reader = { kind: 'reader' as const, id: 'reader' };
async function fixture(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-board-catalog-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  const store = createCommunityStore(directory);
  acceptCommunityConvention(store, [owner, reader]);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { store, directory };
}
const input = { name: '模型讨论', description: '交流本地模型的使用经验。', icon: 'bot' };
const reversedOrdinaryOrder = (items: readonly { id: string }[]) => items.filter(item => item.id !== 'vip').map(item => item.id).reverse().concat('vip');
test('new boards use an unused spare icon and keep the members board last', async t => {
  const { store } = await fixture(t);
  const created = store.boards.create({ name: 'AI 咨询', description: '交流 AI 产品和使用方面的问题。', icon: 'bot' }, owner);
  assert.equal(created.items.at(-1)?.id, 'vip');
  const board = created.items.find(item => item.zh === 'AI 咨询')!;
  assert.equal(board.icon, 'bot');
  assert.match(board.color, /^#[0-9a-f]{6}$/i);
  assert.match(board.lightColor, /^#[0-9a-f]{6}$/i);
  const next = store.boards.create({ name: 'AI 模型', description: '交流 AI 模型的运行和使用经验。' }, owner);
  const nextBoard = next.items.find(item => item.zh === 'AI 模型')!;
  assert.equal(nextBoard.icon, 'brain', 'an omitted icon picks the first remaining spare');
  assert.equal(next.items.at(-1)?.id, 'vip');
});
test('icon conflicts are rejected atomically across connections and legacy repeats remain readable', async t => {
  const { store, directory } = await fixture(t);
  const before = store.boards.catalog();
  assert.throws(() => store.boards.create({ name: '已有图标', description: '这个板块申请使用已占用的图标。', icon: 'help' }, owner), { status: 409 });
  assert.deepEqual(store.boards.catalog(), before);
  const other = createCommunityStore(directory);
  try {
    const first = other.boards.create({ name: 'AI 咨询', description: '讨论 AI 工具的实际使用。', icon: 'bot' }, owner);
    assert.throws(() => store.boards.create({ name: '另一咨询', description: '另一个窗口选择相同的图标。', icon: 'bot' }, owner), { status: 409 });
    assert.deepEqual(store.boards.catalog(), first);
  } finally { other.close(); }
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    const legacy = { ...defaultCommunityBoards[0], id: 'legacy-repeat', zh: '历史重复图标' };
    db.prepare('UPDATE community_boards SET position=position+100').run();
    db.prepare('INSERT INTO community_boards(id,position,definition,created_at,actor_id) VALUES(?,?,?,?,?)').run(legacy.id, 99, JSON.stringify(legacy), new Date().toISOString(), owner.id);
    assert.equal(store.boards.catalog().items.filter(item => item.icon === 'help').length, 2, 'old catalogs are not rewritten or rejected');
    assert.throws(() => store.boards.create({ name: '又一次重复', description: '已有重复的图标仍然不能新占用。', icon: 'help' }, owner), { status: 409 });
  } finally { db.close(); }
});
test('the members board cannot be reordered and existing non-last positions change only on explicit save', async t => {
  const { store, directory } = await fixture(t);
  const before = store.boards.catalog();
  assert.throws(() => store.boards.reorder(before.items.map(item => item.id).reverse(), owner, before.version), /会员茶室/);
  assert.deepEqual(store.boards.catalog(), before);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    db.prepare('UPDATE community_boards SET position=position+100').run();
    db.prepare('UPDATE community_boards SET position=0 WHERE id=\'vip\'').run();
    assert.equal(store.boards.catalog().items[0]?.id, 'vip', 'reading a legacy order does not write it');
    const ids = before.items.filter(item => item.id !== 'vip').map(item => item.id).reverse().concat('vip');
    assert.deepEqual(store.boards.reorder(ids, owner, before.version).items.map(item => item.id), ids);
  } finally { db.close(); }
});
test('all spare icons can be assigned once and an exhausted catalog cannot silently reuse one', async t => {
  const { store } = await fixture(t);
  const spare = availableCommunityBoardIcons(store.boards.list());
  assert.equal(spare.length, 16);
  spare.forEach((choice, index) => {
    const created = store.boards.create({ name: `备用板块 ${index + 1}`, description: '独立使用备用图标的普通交流板块。', icon: choice.id }, owner);
    assert.equal(created.items.at(-1)?.id, 'vip');
  });
  const full = store.boards.catalog();
  assert.equal(full.items.length, 22);
  assert.equal(new Set(full.items.map(item => item.icon)).size, 22);
  assert.throws(() => store.boards.create({ name: '图标已用尽', description: '不应该隐式复用任何占用的图标。' }, owner), /没有可用/);
  assert.deepEqual(store.boards.catalog(), full);
});
test('migration seeds the six unchanged board definitions once and persists catalog order across stores', async t => {
  const { store, directory } = await fixture(t);
  assert.deepEqual(store.boards.catalog(), { version: 0, items: communityBoards });
  const created = store.boards.create(input, owner);
  assert.equal(created.version, 1);
  assert.equal(created.items.length, 7);
  const next = created.items.find(board => board.zh === input.name)!;
  assert.match(next.id, /^board-[a-z0-9]+$/);
  assert.equal(next.kind, '讨论帖');
  const order = reversedOrdinaryOrder(created.items);
  assert.deepEqual(store.boards.reorder(order, owner, created.version).items.map(board => board.id), order);
  const other = createCommunityStore(directory);
  try { assert.deepEqual(other.boards.catalog(), store.boards.catalog()); } finally { other.close(); }
  assert.deepEqual(await migrateCommunity(directory), { changed: false });
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, 1);
  assert.equal(store.boards.catalog().items.length, 7);
});
test('board writes enforce owner identity, safe labels, unique names and complete versioned ordering', async t => {
  const { store } = await fixture(t);
  assert.throws(() => store.boards.create(input, reader), /作者/);
  for (const fields of [{ name: '学习问答' }, { name: '模\u0000型' }, { name: '<script>test</script>' }, { icon: 'unknown' }, { id: 'home' }, { id: '../evil' }, { description: '' }])
    assert.throws(() => store.boards.create({ ...input, ...fields }, owner));
  const created = store.boards.create(input, owner);
  assert.throws(() => store.boards.create(input, owner), /名称/);
  const ids = created.items.map(board => board.id);
  assert.throws(() => store.boards.reorder(ids, reader, 1), /作者/);
  assert.throws(() => store.boards.reorder(ids.slice(1), owner, 1), /全部/);
  assert.throws(() => store.boards.reorder([...ids.slice(1), ids[1]], owner, 1), /全部/);
  assert.throws(() => store.boards.reorder([...ids.slice(1), 'unknown'], owner, 1), /全部/);
  assert.throws(() => store.boards.reorder([...ids].reverse(), owner, 0), { status: 409 });
  assert.deepEqual(store.boards.catalog(), created, 'every rejected operation is atomic');
  assert.deepEqual(store.boards.reorder(ids, owner, 1), created, 'unchanged order does not bump its version');
});
test('catalogs are isolated per database and author bindings cannot be forged', async t => {
  const first = await fixture(t), second = await fixture(t);
  first.store.staff.bindOwner('fixed-owner');
  assert.throws(() => first.store.boards.create(input, owner), { status: 403 });
  first.store.boards.create(input, { kind: 'owner', id: 'fixed-owner' });
  assert.equal(first.store.boards.list().length, 7);
  assert.equal(second.store.boards.list().length, 6);
  assert.equal(communityBoards.length, 6, 'the shared source seed must never mutate');
});
test('dynamic boards participate in scoped staff, banners, posting, moving, contacts and summary without weakening VIP', async t => {
  const { store, directory } = await fixture(t);
  let peopleReads = 0;
  const service = createCommunityService({ store, directory, siteOrigin: 'http://127.0.0.1', identify: async req => {
    const id = String(req.headers.cookie || 'reader').split(';')[0];
    return { kind: id === 'owner' ? 'owner' : 'reader', id, name: id, vip: id === 'owner' };
  }, ownerReaderIdentity: async () => ({ ...reader, name: 'reader', vip: false }),
  people: async authors => { peopleReads++; return new Map(authors.map(author => [`${author.kind}:${author.id}`, { name: author.id, uid: author.id, avatar: null, vip: false, joinedAt: null, bio: '', active: true }])); } });
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string, id = 'owner') => fetch(`${origin}/api/community/${path}`, { headers: { Cookie: id } });
  const post = (path: string, body: unknown, id = 'owner') => fetch(`${origin}/api/community/${path}`, { method: 'POST', headers: { Cookie: id, Origin: 'http://127.0.0.1', 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await get('manage?tab=boards', 'reader')).status, 403);
  assert.equal((await post('manage/boards', input, 'owner; community_browse=reader')).status, 403);
  const response = await post('manage/boards', input);
  assert.equal(response.status, 201);
  const catalog = await response.json();
  const board = catalog.items.find((item: { zh: string }) => item.zh === input.name).id;
  const conflict = await post('manage/boards', { ...input, name: '另一个模型板块' });
  assert.equal(conflict.status, 409);
  assert.match(await conflict.text(), /图标.*使用/);
  assert.equal((await post('manage/boards/order', { ids: catalog.items.map((item: { id: string }) => item.id).reverse(), version: catalog.version })).status, 400);
  assert.deepEqual((await (await get('summary', 'reader')).json()).boardCatalog, catalog);
  const beforeBoardRead = peopleReads;
  const queue = store.queue;
  store.queue = () => { throw Error('Catalog reads must not touch review queues.'); };
  assert.deepEqual((await (await get('manage?tab=boards')).json()).boardCatalog, catalog);
  assert.ok((await (await get('manage?tab=boards')).json()).allowedTabs.includes('boards'));
  assert.equal(peopleReads, beforeBoardRead, 'catalog management must not wait on account projections');
  store.queue = queue;
  store.staff.appoint(owner, reader, { role: 'moderator', boards: [board], permissions: ['content.inspect', 'banner.manage'], delegable: [] });
  assert.deepEqual(store.members.moderationBoards(reader), [board]);
  assert.equal((await get('manage?tab=boards', 'reader')).status, 403, 'board management remains author only');
  assert.equal((await post('manage/boards/order', { ids: reversedOrdinaryOrder(catalog.items), version: catalog.version })).status, 200);
  assert.equal((await post('manage/boards/order', { ids: catalog.items.map((item: { id: string }) => item.id), version: catalog.version })).status, 409);
  assert.equal((await get(`topics?board=${board}`, 'reader')).status, 200);
  assert.equal((await get('topics?board=vip', 'reader')).status, 404);
  assert.equal((await get(`banners?scope=${board}`, 'reader')).status, 200);
  assert.ok((await (await get('manage?tab=banners')).json()).banners.some((item: { scope: string }) => item.scope === board));
  const topic = store.createTopic({ board, author: owner, title: '新增板块公开帖子', body: '这是新增板块中的普通讨论正文。' });
  assert.equal((await post('manage/banners', { scope: board, version: 0, items: [{ topicId: topic.id, title: '', cover: null }] }, 'reader')).status, 200);
  const image = randomUUID();
  store.addImage({ id: image, uploader: owner, width: 800, height: 600 });
  const created = await post('topics', { board, title: '通过现有接口发布讨论', body: `这是使用新增板块的普通讨论内容。\n${bodyImageMarker(image)}`, images: [image] });
  assert.equal(created.status, 201, await created.text());
  const toMove = store.createTopic({ board: 'qa', author: owner, title: '迁移板块测试主题', body: '这是一篇等待迁移到新增板块的测试讨论。' });
  assert.equal((await post(`topics/${toMove.id}/move`, { board })).status, 200);
  assert.equal(store.topic(toMove.id)?.board, board);
  assert.equal((await get(`moderation-contacts?board=${board}`, 'reader')).status, 200);
  const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try { assert.ok(db.prepare("SELECT id FROM community_audit_events WHERE action='community-board-create'").get()); } finally { db.close(); }
});
test('migration always uses fixed source definitions even if a browser-side catalog was installed', async t => {
  const installed = [...defaultCommunityBoards, { ...defaultCommunityBoards[4], id: 'board-client-only', zh: '仅浏览器快照' }];
  assert.equal(installCommunityBoardCatalog({ version: 99, items: installed }), true);
  t.after(resetCommunityBoardCatalog);
  const { store } = await fixture(t);
  assert.deepEqual(store.boards.catalog(), { version: 0, items: defaultCommunityBoards });
  assert.equal(store.boards.has('board-client-only'), false);
});
test('separate connections reject stale reorder versions without restoring an obsolete order', async t => {
  const { store, directory } = await fixture(t);
  const other = createCommunityStore(directory);
  try {
    const original = store.boards.catalog();
    const ids = reversedOrdinaryOrder(original.items);
    const changed = other.boards.reorder(ids, owner, original.version);
    assert.throws(() => store.boards.reorder(original.items.map(board => board.id), owner, original.version), { status: 409 });
    assert.deepEqual(store.boards.catalog(), changed);
  } finally { other.close(); }
});
test('board writes roll back with failed audit recording rather than leaving an unaudited catalog', async t => {
  const { store } = await fixture(t);
  const before = store.boards.catalog();
  assert.throws(() => store.audit.run(owner, 'community-board-create', () => store.boards.create(input, owner), () => { throw Error('audit proof failed'); }), /audit proof failed/);
  assert.deepEqual(store.boards.catalog(), before);
});
