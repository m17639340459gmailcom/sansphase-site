import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import sharp from 'sharp';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import type { CommunityStaffInput } from '../server/community-staff.ts';
import { communityStaffCapabilities, communityStaffDefaultPermissions } from '../src/community-staff.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
const reader = (id: string): CommunityAuthor => ({ kind: 'reader', id });
const cleanup = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
const input = { cat: 'digital', name: '总版主上架的资源', description: '完整的商品管理权限回归说明', price: 20, stock: null,
  minLevel: 0, minDays: 0, delivery: '数字资源交付内容', active: true };
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-general-shop-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close(); await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function fixture(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-general-shop-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory), accounts = new Map(['general', 'moderator', 'assistant', 'reader'].map(id => [id, { active: true }]));
  acceptCommunityConvention(store, [owner, ...[...accounts.keys()].map(reader)]);
  const appoint = (id: string, role: CommunityStaffInput['role'], empty = false) => store.staff.appoint(owner, reader(id), {
    role, boards: ['qa'], permissions: empty ? [] : [...communityStaffDefaultPermissions[role]], delegable: [],
  });
  for (const id of ['general', 'moderator', 'assistant'] as const) appoint(id, id);
  let onPeople: ((authors: CommunityAuthor[]) => void | Promise<void>) | undefined;
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing fixture address');
  const origin = `http://127.0.0.1:${address.port}`;
  service = createCommunityService({ store, siteOrigin: origin, directory,
    identify: async req => {
      const id = String(req.headers.cookie || 'general').split(';')[0];
      return id === 'owner' ? { ...owner, name: '作者', vip: true } : accounts.get(id)?.active ? { ...reader(id), name: id, vip: false } : null;
    },
    people: async authors => {
      await onPeople?.(authors);
      return new Map(authors.map(author => [`${author.kind}:${author.id}`, { name: author.id, uid: author.id, avatar: null, vip: author.kind === 'owner', joinedAt: '2026-01-01T00:00:00Z', bio: '', active: author.kind === 'owner' || accounts.get(author.id)?.active === true }]));
    },
  });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); store.close(); await cleanup(directory); });
  const get = (path: string, identity = 'general', headers: Record<string, string> = {}) => fetch(`${origin}/api/community/${path}`, { headers: { Cookie: identity, ...headers } });
  const post = (path: string, body: unknown = {}, identity = 'general') => fetch(`${origin}/api/community/${path}`, {
    method: 'POST', headers: { Cookie: identity, Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const upload = (bytes: Uint8Array, path = 'manage/item-image', identity = 'general') => {
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'shop.png');
    return fetch(`${origin}/api/community/${path}`, { method: 'POST', headers: { Cookie: identity, Origin: origin, 'X-Reader-Request': '1' }, body: form });
  };
  const sql = (execute: (db: DatabaseSync) => void) => { const db = new DatabaseSync(resolve(directory, 'content.db')); try { execute(db); } finally { db.close(); } };
  const audit = () => { let actions: unknown[] = []; sql(db => { actions = db.prepare('SELECT action FROM community_audit_events ORDER BY rowid').all().map(row => row.action); }); return actions; };
  const image = (actor = owner, purpose: 'shop' | 'content' = 'shop') => {
    const id = randomUUID(); store.addImage({ id, uploader: actor, width: 640, height: 480, purpose }); return id;
  };
  const product = (imageId?: string, extra = {}) => store.economy.saveItem(null, { ...input, cat: 'digital', limitPer: null, limitN: null, note: '', image: imageId, ...extra });
  const invalidate = (change: 'revocation' | 'demotion' | 'inactive') => {
    if (change === 'revocation') store.staff.revoke(owner, reader('general'));
    else if (change === 'demotion') appoint('general', 'moderator');
    else accounts.get('general')!.active = false;
  };
  return { directory, store, accounts, appoint, get, post, upload, image, product, sql, audit, invalidate, onPeople(hook: (authors: CommunityAuthor[]) => void | Promise<void>) { onPeople = hook; } };
}

type ShopFixture = Awaited<ReturnType<typeof fixture>>;
const allPermissions = communityStaffCapabilities.map(cap => cap.id);
const fullGeneral = (f: ShopFixture) => f.store.staff.appoint(owner, reader('general'), {
  role: 'general', boards: ['qa'], permissions: allPermissions, delegable: [],
});

function seedItemReviewCounts(f: ShopFixture) {
  const at = new Date().toISOString();
  const topic = (board: string, pending = false) => f.store.createTopic({ board, author: reader('reader'), title: '商品管理计数合成主题',
    body: '不应在商品管理页读取的正文', pending: pending ? 'fixture' : null, now: at }).id;
  const qp = topic('qa', true), qh = topic('qa'), qph = topic('qa', true), qpublic = topic('qa');
  const tp = topic('tools', true), tpublic = topic('tools'), vh = topic('vip'), qdead = topic('qa', true);
  for (const id of [qh, qph, vh]) f.store.hide({ kind: 'topic', id }, 'fixture');
  const reply = (parent: string) => {
    const id = f.store.addReply({ topicId: parent, author: reader('reader'), body: '合成隐藏回复正文', now: at }).id;
    f.store.hide({ kind: 'reply', id }, 'fixture'); return id;
  };
  const rqpub = reply(qpublic), rqp = reply(qp), rqh = reply(qh), rt = reply(tpublic), rv = reply(vh);
  const rdeleted = reply(qpublic), rparentdead = reply(qdead);
  f.store.addReply({ topicId: qpublic, author: reader('reader'), body: '可见回复不计入待审', now: at });
  f.store.deleteReply(rdeleted); f.store.deleteTopic(qdead);
  // Delete closes existing reports; create the historical dangling fixtures afterwards.
  const targets = [
    { kind: 'topic', id: qpublic }, { kind: 'topic', id: qp }, { kind: 'reply', id: rqp }, { kind: 'reply', id: rqh },
    { kind: 'topic', id: tpublic }, { kind: 'topic', id: vh }, { kind: 'topic', id: qdead },
    { kind: 'reply', id: rdeleted }, { kind: 'reply', id: rparentdead },
    { kind: 'topic', id: randomUUID() }, { kind: 'reply', id: randomUUID() }, { kind: 'reply', id: qpublic },
  ] as const;
  for (const target of targets) f.store.report({ target, reporter: reader('reader'), reason: '本地合成举报', now: at });
  return { qp, qh, qph, qpublic, tp, tpublic, vh, qdead, rqpub, rqp, rqh, rt, rv, rdeleted, rparentdead };
}

function captureItemSQL(t: TestContext) {
  let recording = false, queries: string[] = [];
  const get = StatementSync.prototype.get, all = StatementSync.prototype.all, run = StatementSync.prototype.run;
  const record = (statement: StatementSync) => { if (recording) queries.push(statement.sourceSQL.replace(/\s+/g, ' ').trim()); };
  t.mock.method(StatementSync.prototype, 'get', function (this: StatementSync, ...args: Parameters<StatementSync['get']>) {
    record(this); return Reflect.apply(get, this, args) as ReturnType<StatementSync['get']>;
  });
  t.mock.method(StatementSync.prototype, 'all', function (this: StatementSync, ...args: Parameters<StatementSync['all']>) {
    record(this); return Reflect.apply(all, this, args) as ReturnType<StatementSync['all']>;
  });
  t.mock.method(StatementSync.prototype, 'run', function (this: StatementSync, ...args: Parameters<StatementSync['run']>) {
    record(this); return Reflect.apply(run, this, args) as ReturnType<StatementSync['run']>;
  });
  return async function capture<T>(read: () => Promise<T>) {
    queries = []; recording = true;
    try { return { value: await read(), queries }; } finally { recording = false; }
  };
}

for (const identity of ['owner', 'general', 'report-only', 'capability-free'] as const) {
  test(`items light DTO keeps original ${identity} counters and metadata while omitting other tab content`, async t => {
    const f = await fixture(t); seedItemReviewCounts(f);
    if (identity === 'general') fullGeneral(f);
    else if (identity === 'report-only') f.store.staff.appoint(owner, reader('general'), { role: 'general', boards: ['qa'], permissions: ['report.review'], delegable: [] });
    else if (identity === 'capability-free') f.appoint('general', 'general', true);
    f.product(); f.store.economy.saveCategory('合成商品分类');
    const actor = identity === 'owner' ? 'owner' : 'general';
    const oracle = await (await f.get('manage?tab=contact', actor)).json();
    const response = await f.get('manage?tab=items', actor); assert.equal(response.status, 200, await response.clone().text());
    const dto = await response.json();
    for (const property of ['owner', 'actorStaff', 'moderationBoards', 'allowedTabs', 'boardCatalog', 'counts', 'kpis']) assert.deepEqual(dto[property], oracle[property], property);
    assert.equal(dto.tab, 'items');
    assert.equal(dto.counts.queue, identity === 'owner' ? 10 : identity === 'general' ? 6 : 0);
    assert.equal(dto.counts.reports, identity === 'owner' ? 12 : identity === 'capability-free' ? 0 : 4);
    assert.deepEqual(dto.items, JSON.parse(JSON.stringify(f.store.economy.customItems())));
    assert.deepEqual(dto.categories, JSON.parse(JSON.stringify(f.store.economy.categories())));
    assert.deepEqual(dto.queue, { topics: [], replies: [] });
    for (const property of ['reports', 'orders', 'sanctions', 'content']) assert.deepEqual(dto[property], [], property);
    assert.equal(dto.data, null);
    if (actor === 'owner') { assert.deepEqual(oracle.items, dto.items); assert.deepEqual(oracle.categories, dto.categories); }
    else { assert.deepEqual(oracle.items, []); assert.deepEqual(oracle.categories, []); }
  });
}

test('items light count methods exactly retain old queue conditions, legacy hidden values and orphan report groups', async t => {
  const f = await fixture(t); const seeded = seedItemReviewCounts(f);
  const legacy = f.store.createTopic({ board: 'qa', author: reader('reader'), title: '旧隐藏值主题', body: '旧值条件精确保留' }).id;
  const legacyReply = f.store.addReply({ topicId: seeded.qpublic, author: reader('reader'), body: '旧隐藏值回复' }).id;
  f.sql(db => { db.prepare("UPDATE community_topics SET hidden_at='' WHERE id=?").run(legacy); db.prepare("UPDATE community_replies SET hidden_at='' WHERE id=?").run(legacyReply); });
  const old = f.store.queue(), counts = f.store.queueCounts(), reports = f.store.openReportCounts();
  for (const board of ['qa', 'tools', 'vip']) assert.equal(counts.find(row => row.board === board)?.count,
    old.topics.filter(topic => topic.board === board).length + old.replies.filter(reply => f.store.topicAccess(reply.topicId)?.board === board).length);
  assert.equal(counts.reduce((sum, row) => sum + row.count, 0), 12);
  assert.equal(reports.find(row => row.board === null)?.count, 6);
  assert.equal(reports.reduce((sum, row) => sum + row.count, 0), f.store.openReports().length);
});

test('items light counters keep the existing hundred-order and hundred-active-sanction caps', async t => {
  const f = await fixture(t); fullGeneral(f);
  const product = f.product(undefined, { cat: 'goods', stock: 200, price: 1, delivery: '' });
  const at = new Date().toISOString();
  f.sql(db => {
    const insert = db.prepare('INSERT INTO community_orders(id,member_kind,member_id,item,item_name,price,status,created_at) VALUES(?,?,?,?,?,?,?,?)');
    for (let i = 0; i < 101; i++) insert.run(randomUUID(), 'reader', 'reader', product, '合成待发货商品', 1, 'pending', at);
    for (const status of ['shipped', 'cancelled']) insert.run(randomUUID(), 'reader', 'reader', product, '合成已处理商品', 1, status, at);
  });
  for (let i = 0; i < 101; i++) f.store.members.mute(reader('reader'), 7, '合成有效处罚', owner);
  f.store.members.mute(reader('reader'), 1, '合成过期处罚', owner, Date.now() - 3 * 86400000);
  const lifted = f.store.members.mute(reader('reader'), 7, '合成已解除处罚', owner); f.store.members.lift(lifted.id);
  for (const actor of ['owner', 'general']) {
    const oracle = await (await f.get('manage?tab=contact', actor)).json(), dto = await (await f.get('manage?tab=items', actor)).json();
    assert.deepEqual(dto.counts, oracle.counts); assert.equal(dto.counts.orders, actor === 'owner' ? 100 : 0); assert.equal(dto.counts.sanctions, 100);
    assert.deepEqual(dto.orders, []); assert.deepEqual(dto.sanctions, []);
  }
});

for (const change of ['revocation', 'demotion', 'inactive', 'scope', 'capabilities'] as const) {
  test(`items light authority rechecks ${change} during its final empty people stage`, async t => {
    const f = await fixture(t); fullGeneral(f); f.product(); let changed = false;
    f.onPeople(authors => {
      if (changed || authors.length) return; changed = true;
      if (change === 'scope') f.store.staff.appoint(owner, reader('general'), { role: 'general', boards: ['tools'], permissions: allPermissions, delegable: [] });
      else if (change === 'capabilities') f.appoint('general', 'general', true);
      else f.invalidate(change);
    });
    const response = await f.get('manage?tab=items'); assert.equal(changed, true); assert.equal(response.status, 403);
    assert.equal((await response.text()).includes(input.delivery), false);
  });
}

for (const change of ['move', 'hide', 'delete'] as const) {
  test(`items light counts use current content after ${change} during the people wait`, async t => {
    const f = await fixture(t); fullGeneral(f);
    const subject = f.store.createTopic({ board: 'qa', author: reader('reader'), title: '等待中的最新计数', body: '只在最新聚合中计数', pending: change === 'hide' ? null : 'fixture' }).id;
    f.store.report({ target: { kind: 'topic', id: subject }, reporter: reader('reader'), reason: '合成计数举报' });
    let changed = false;
    f.onPeople(authors => {
      if (changed || authors.length) return; changed = true;
      if (change === 'move') f.store.move(subject, 'tools'); else if (change === 'hide') f.store.hide({ kind: 'topic', id: subject }, 'fixture'); else f.store.deleteTopic(subject);
    });
    const response = await f.get('manage?tab=items'); assert.equal(changed, true); assert.equal(response.status, 200, await response.clone().text());
    const dto = await response.json(); assert.equal(dto.counts.queue, change === 'hide' ? 1 : 0); assert.equal(dto.counts.reports, change === 'hide' ? 1 : 0);
  });
}

for (const actor of ['owner', 'general']) {
  test(`items light ${actor} GET has bounded SQL and no unrelated content or author hydration`, async t => {
    const f = await fixture(t); fullGeneral(f); f.product();
    const parent = f.store.createTopic({ board: 'qa', author: reader('reader'), title: '多回复的合成主题', body: '商品页面不读取这份正文' }).id;
    for (let i = 0; i < 25; i++) {
      const reply = f.store.addReply({ topicId: parent, author: reader('reader'), body: `隐藏回复合成正文 ${i}` }).id;
      f.store.hide({ kind: 'reply', id: reply }, 'fixture');
    }
    for (let i = 0; i < 100; i++) f.store.createTopic({ board: i % 2 ? 'qa' : 'tools', author: reader('reader'), title: `待审合成主题 ${i}`, body: '不应发送给商品管理标签的正文', pending: 'fixture' });
    await f.get('manage?tab=items', actor);
    const people: CommunityAuthor[][] = []; f.onPeople(authors => { people.push(authors); });
    const capture = captureItemSQL(t), read = async () => {
      const response = await f.get('manage?tab=items', actor); assert.equal(response.status, 200); return response.json();
    };
    const measured = await capture(read);
    t.diagnostic(JSON.stringify({ route: `manage/items/${actor}`, sql: measured.queries.length, bytes: Buffer.byteLength(JSON.stringify(measured.value)), queue: measured.value.counts.queue }));
    assert.equal(measured.value.counts.queue, actor === 'owner' ? 125 : 75);
    assert.ok(measured.queries.length <= (actor === 'owner' ? 35 : 160), `bounded aggregate phase; got ${measured.queries.length}`);
    assert.equal(measured.queries.some(sql => /\bt\.body\b|\br\.body\b/.test(sql)), false);
    assert.equal(measured.queries.some(sql => sql.startsWith('SELECT frame, name_color')), false);
    assert.equal(people.some(batch => batch.some(member => member.id === 'reader')), false);
    assert.ok(people.some(batch => batch.length === 0), 'the final identity refresh keeps an empty presentation stage');
    const queueSQL = measured.queries.filter(sql => sql.startsWith('SELECT board, COUNT(*) AS count FROM ('));
    const reportSQL = measured.queries.filter(sql => sql.startsWith('SELECT t.board, COUNT(*) AS count FROM community_reports q'));
    assert.equal(queueSQL.length, 1); assert.equal(reportSQL.length, 1);
    f.sql(db => {
      const queuePlan = db.prepare(`EXPLAIN QUERY PLAN ${queueSQL[0]}`).all().map(row => String(row.detail));
      const reportPlan = db.prepare(`EXPLAIN QUERY PLAN ${reportSQL[0]}`).all().map(row => String(row.detail));
      assert.ok(queuePlan.some(detail => /SEARCH r USING INDEX community_replies_topic_idx \(topic_id=\? AND deleted_at=\?\)/.test(detail)));
      assert.ok(reportPlan.some(detail => /SEARCH q USING INDEX community_reports_status_idx \(status=\?\)/.test(detail)));
      for (const alias of ['r', 't']) assert.ok(reportPlan.some(detail => new RegExp(`SEARCH ${alias} USING INDEX .* \\(id=\\?\\) LEFT-JOIN`).test(detail)));
    });
    for (let i = 0; i < 100; i++) f.store.createTopic({ board: i % 2 ? 'qa' : 'tools', author: reader('reader'), title: `更多待审合成主题 ${i}`, body: '更多队列只改变计数', pending: 'fixture' });
    const larger = await capture(read); assert.equal(larger.queries.length, measured.queries.length, 'more queue rows must not add per-subject SQL');
    assert.equal(larger.value.counts.queue, actor === 'owner' ? 225 : 125);
  });
}

test('items light branch preserves the fourteen management tab contracts and separate review payloads', async t => {
  const f = await fixture(t); fullGeneral(f); seedItemReviewCounts(f); f.product();
  for (const actor of ['owner', 'general']) {
    const oracle = await (await f.get('manage?tab=contact', actor)).json();
    for (const tab of ['queue', 'reports', 'content', 'orders', 'items', 'stewards', 'sanctions', 'data', 'banners', 'contact', 'convention', 'profiles', 'features', 'boards']) {
      const response = await f.get(`manage?tab=${tab}`, actor);
      assert.equal(response.status, oracle.allowedTabs.includes(tab) ? 200 : 403, `${actor}/${tab}`);
      if (response.status !== 200) continue;
      const dto = await response.json(); assert.equal(dto.tab, tab); assert.equal(dto.owner, actor === 'owner');
      if (tab === 'boards') { assert.ok(dto.boardCatalog); assert.equal('queue' in dto, false); continue; }
      assert.deepEqual(dto.counts, oracle.counts, `${actor}/${tab} shared counters`);
      if (tab !== 'items') { assert.equal(dto.queue.topics.length + dto.queue.replies.length, oracle.counts.queue); assert.equal(dto.reports.length, oracle.counts.reports); }
    }
  }
});

for (const empty of [false, true]) {
  test(`an existing ${empty ? 'capability-free' : 'default'} general manages categories and product create, edit, unlist and relist without appointment changes`, async t => {
    const f = await fixture(t); if (empty) f.appoint('general', 'general', true);
    const appointment = f.store.staff.stored(reader('general'));
    const category = await f.post('manage/categories', { name: '星海精选' }); assert.equal(category.status, 201, await category.clone().text());
    const { id: categoryId } = await category.json();
    const created = await f.post('manage/items', { ...input, category: categoryId }); assert.equal(created.status, 201, await created.clone().text());
    const { id } = await created.json();
    const page = await f.get('manage?tab=items'); assert.equal(page.status, 200, await page.clone().text());
    const dto = await page.json(); assert.equal(dto.owner, false); assert.ok(dto.allowedTabs.includes('items')); assert.equal(dto.allowedTabs.includes('orders'), false);
    assert.equal(dto.items.find((item: { id: string }) => item.id === id).category, categoryId); assert.equal(dto.categories[0].name, '星海精选');
    assert.equal((await f.post(`manage/items/${id}`, { ...input, name: '总版主编辑后的资源', price: 35 })).status, 200);
    assert.equal(f.store.economy.item(id)!.price, 35);
    assert.equal((await f.post(`manage/items/${id}`, { active: false })).status, 200); assert.equal(f.store.economy.item(id)!.active, false);
    assert.equal((await f.post(`manage/items/${id}`, { active: true })).status, 200); assert.equal(f.store.economy.item(id)!.active, true);
    assert.deepEqual(f.store.staff.stored(reader('general')), appointment);
    assert.deepEqual(f.audit(), ['community-category-create', 'community-item-create', 'community-item-update', 'community-item-update', 'community-item-update']);
  });
}

test('a general management DTO and endpoints keep orders, addresses, shipping, refunds and ledger flow owner-only', async t => {
  const f = await fixture(t), id = f.product(undefined, { cat: 'goods', stock: 2, delivery: '' });
  f.store.ledger.credit(reader('reader'), 100, 'test', null, new Date().toISOString());
  const order = f.store.economy.redeem(reader('reader'), id, { level: 1, owner: false, joinedAt: '2026-01-01T00:00:00Z', shipping: { name: '私有收货人', phone: '13800138000', address: '私有详细地址测试' } });
  const response = await f.get('manage?tab=items'); assert.equal(response.status, 200, await response.clone().text());
  const dto = await response.json(); assert.deepEqual(dto.orders, []); assert.equal(dto.counts.orders, 0); assert.equal(JSON.stringify(dto).includes('私有'), false);
  assert.equal((await f.get('manage?tab=orders')).status, 403);
  assert.equal((await f.post(`manage/orders/${order.order}/ship`, { company: '测试快递', tracking: '1234' })).status, 403);
  assert.equal((await f.post(`manage/orders/${order.order}/cancel`)).status, 403); assert.equal(f.store.economy.goodsOrders()[0].status, 'pending');
  const data = await (await f.get('manage?tab=data')).json(); assert.deepEqual(data.data.flow, []);
  assert.equal((await f.get('manage?tab=orders', 'owner')).status, 200);
});

test('other general management tabs advertise the item permission without loading product or delivery data', async t => {
  const f = await fixture(t); f.product();
  assert.equal((await f.post('manage/categories', { name: '测试专属分类' })).status, 201);
  const response = await f.get('manage?tab=contact'); assert.equal(response.status, 200);
  const dto = await response.json(); assert.ok(dto.allowedTabs.includes('items'));
  assert.deepEqual(dto.items, []); assert.deepEqual(dto.categories, []);
  assert.equal(JSON.stringify(dto).includes(input.delivery), false);
  const ownerDto = await (await f.get('manage?tab=contact', 'owner')).json();
  assert.equal(ownerDto.items.length, 1); assert.equal(ownerDto.categories.length, 1);
});

for (const identity of ['moderator', 'assistant', 'reader', 'general; community_browse=reader']) {
  test(`${identity} cannot manage the catalog or upload product artwork`, async t => {
    const f = await fixture(t), id = f.product();
    assert.equal((await f.get('manage?tab=items', identity)).status, 403);
    for (const [path, body] of [['manage/categories', { name: '无权分类' }], ['manage/items', input], [`manage/items/${id}`, input], [`manage/items/${id}`, { active: false }]] as const)
      assert.equal((await f.post(path, body, identity)).status, 403, path);
    assert.equal((await f.upload(new Uint8Array([1]), 'manage/item-image', identity)).status, 403);
    assert.equal(f.store.economy.customItems().length, 1); assert.equal(f.store.economy.item(id)!.active, true);
    if (!identity.includes('community_browse')) {
      const response = await f.get('manage?tab=contact', identity);
      if (identity !== 'reader') {
        assert.equal(response.status, 200); const dto = await response.json();
        assert.equal(dto.allowedTabs.includes('items'), false); assert.deepEqual(dto.items, []); assert.deepEqual(dto.categories, []);
      }
    }
  });
}

for (const change of ['revocation', 'demotion', 'inactive'] as const) {
  for (const operation of ['create', 'edit', 'toggle', 'category'] as const) {
    test(`a general loses ${operation} authority during the final audit await on ${change}`, async t => {
      const f = await fixture(t), id = f.product(); let calls = 0;
      f.onPeople(() => { if (++calls === 3) f.invalidate(change); });
      const path = operation === 'create' ? 'manage/items' : operation === 'category' ? 'manage/categories' : `manage/items/${id}`;
      const body = operation === 'toggle' ? { active: false } : operation === 'category' ? { name: '等待期间的分类' } : { ...input, price: 70 };
      const response = await f.post(path, body); assert.equal(response.status, 403, await response.clone().text());
      assert.equal(f.store.economy.customItems().length, 1); assert.equal(f.store.economy.item(id)!.price, 20); assert.equal(f.store.economy.item(id)!.active, true);
      assert.deepEqual(f.store.economy.categories(), []); assert.deepEqual(f.audit(), []);
    });
  }
  test(`the managed item read rechecks ${change} after loading profile data`, async t => {
    const f = await fixture(t); let calls = 0; f.onPeople(() => { if (++calls === 3) f.invalidate(change); });
    assert.equal((await f.get('manage?tab=items')).status, 403);
  });
}

test('a general retains this product author artwork while new products and replacements require its own valid shop upload', async t => {
  const f = await fixture(t), old = f.image(), id = f.product(old);
  assert.equal((await f.post(`manage/items/${id}`, { ...input, image: old })).status, 200);
  assert.equal(f.store.economy.item(id)!.image, old);
  assert.equal((await f.post('manage/items', { ...input, image: old })).status, 400);
  const other = f.image(), wrongPurpose = f.image(reader('general'), 'content'), own = f.image(reader('general'));
  assert.equal((await f.post(`manage/items/${id}`, { ...input, image: other })).status, 400);
  assert.equal((await f.post(`manage/items/${id}`, { ...input, image: wrongPurpose })).status, 400);
  assert.equal((await f.post(`manage/items/${id}`, { ...input, image: own })).status, 200);
  assert.equal((await f.post('manage/items', { ...input, image: own })).status, 201, 'an actor can keep reusing its own product artwork');
  const deleted = f.image(reader('general'));
  f.sql(db => db.prepare('UPDATE community_images SET deleted_at=? WHERE id=?').run(new Date().toISOString(), deleted));
  assert.equal((await f.post(`manage/items/${id}`, { ...input, image: deleted })).status, 400);
});

test('a general can retain the author existing cover image and the same redeemed-resource protections still reject replacements', async t => {
  const f = await fixture(t), image = f.image(), id = f.product(image, { cat: 'look', kind: 'cover', delivery: '' });
  const cover = { ...input, cat: 'look', kind: 'cover', image, delivery: '' };
  assert.equal((await f.post(`manage/items/${id}`, cover)).status, 200);
  f.store.ledger.credit(reader('reader'), 100, 'test', null, new Date().toISOString());
  f.store.economy.redeem(reader('reader'), id, { level: 1, owner: false, joinedAt: '2026-01-01T00:00:00Z' });
  const own = f.image(reader('general'));
  assert.equal((await f.post(`manage/items/${id}`, { ...cover, image: own })).status, 400);
  assert.equal(f.store.economy.item(id)!.image, image); assert.equal(f.store.economy.orders(reader('reader')).length, 1);
});

test('a general reads author artwork used by an inactive product while ordinary readers and unrelated orphan uploads stay private', async t => {
  const f = await fixture(t), image = f.image(), orphan = f.image(); f.product(image, { active: false });
  await mkdir(resolve(f.directory, 'uploads'), { recursive: true });
  for (const id of [image, orphan]) await writeFile(resolve(f.directory, 'uploads', `community-image-${id}.webp`), 'private fixture bytes');
  assert.equal((await f.get(`images/${image}.webp`)).status, 200);
  assert.equal((await f.get(`images/${image}.webp`, 'reader')).status, 404);
  assert.equal((await f.get(`images/${orphan}.webp`)).status, 404);
});

for (const change of ['revocation', 'demotion', 'inactive'] as const) {
  test(`a private product image read rechecks ${change} after reading bytes, even with its known validator`, async t => {
    const f = await fixture(t), image = f.image(); f.product(image, { active: false });
    await mkdir(resolve(f.directory, 'uploads'), { recursive: true });
    await writeFile(resolve(f.directory, 'uploads', `community-image-${image}.webp`), 'private fixture bytes');
    const first = await f.get(`images/${image}.webp`); assert.equal(first.status, 200); const etag = first.headers.get('etag')!;
    let calls = 0; f.onPeople(() => { if (++calls === 2) f.invalidate(change); });
    assert.equal((await f.get(`images/${image}.webp`, 'general', { 'If-None-Match': etag })).status, 404);
  });
}

test('the general product uploader accepts more than 2MiB while its ordinary forum uploader retains the 2MiB cap', async t => {
  const f = await fixture(t); const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#976223' } }).png().toBuffer();
  const padded = Buffer.concat([png, Buffer.alloc(2 * 1024 ** 2)]);
  const accepted = await f.upload(padded); assert.equal(accepted.status, 201, await accepted.clone().text());
  const { id } = await accepted.json(); assert.equal(f.store.image(id)!.purpose, 'shop'); assert.equal(f.store.image(id)!.uploader_id, 'general');
  assert.equal((await f.upload(padded, 'images')).status, 413);
  assert.equal((await f.upload(Buffer.alloc(25 * 1024 ** 2 + 1))).status, 413);
});

for (const change of ['revocation', 'demotion', 'inactive'] as const) {
  test(`product upload rejects ${change} after encoding and before recording files`, async t => {
    const f = await fixture(t); let calls = 0; f.onPeople(() => { if (++calls === 3) f.invalidate(change); });
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#976223' } }).png().toBuffer();
    assert.equal((await f.upload(png)).status, 403); assert.equal(calls, 3);
    assert.deepEqual(await readdir(resolve(f.directory, 'uploads')).catch(() => []), []);
    f.sql(db => assert.equal(db.prepare('SELECT COUNT(*) AS total FROM community_images').get()!.total, 0));
  });
  test(`product upload rechecks ${change} after writing encoded files and removes both bytes without registering an image`, async t => {
    const f = await fixture(t); let invalidated = false;
    f.onPeople(async () => {
      const files = await readdir(resolve(f.directory, 'uploads')).catch(() => []);
      if (!invalidated && files.some(name => name.startsWith('community-image-'))) { invalidated = true; f.invalidate(change); }
    });
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#976223' } }).png().toBuffer();
    const response = await f.upload(png); assert.equal(response.status, 403, await response.clone().text()); assert.equal(invalidated, true);
    assert.deepEqual(await readdir(resolve(f.directory, 'uploads')), []);
    f.sql(db => assert.equal(db.prepare('SELECT COUNT(*) AS total FROM community_images').get()!.total, 0));
  });
}
