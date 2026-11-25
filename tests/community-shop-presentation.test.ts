import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { communitySchemaReady, migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import type { CustomItemInput } from '../server/community-economy.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
const buyer: CommunityAuthor = { kind: 'reader', id: 'presentation-buyer' };
const now = Date.parse('2026-10-10T10:00:00+08:00');
const context = { level: 3, owner: false, joinedAt: '2026-01-01T00:00:00Z', now };
const base: CustomItemInput = { cat: 'digital', name: '月卡商品合成测试', description: '保持数字资源权益的卡片展示测试。', price: 1500, stock: 18,
  limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '兑换后联系作者领取。', note: '', active: true };
const cleanup = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-shop-presentation-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close(); await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function fixture(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-shop-presentation-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  let closed = false;
  const close = () => { if (!closed) { store.close(); closed = true; } };
  t.after(async () => { close(); await cleanup(directory); });
  const image = (purpose: 'shop' | 'content' = 'shop', uploader = owner) => {
    const id = randomUUID(); store.addImage({ id, uploader, width: 700, height: 1000, purpose }); return id;
  };
  const sql = <T>(read: (db: DatabaseSync) => T): T => {
    const db = new DatabaseSync(resolve(directory, 'content.db'));
    try { return read(db); } finally { db.close(); }
  };
  return { directory, store, image, sql, close };
}

async function api(t: TestContext) {
  const f = await fixture(t); acceptCommunityConvention(f.store, [owner, buyer]);
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing isolated server address');
  const origin = `http://127.0.0.1:${address.port}`;
  service = createCommunityService({ store: f.store, directory: f.directory, siteOrigin: origin,
    identify: async req => req.headers.cookie === 'buyer' ? { ...buyer, name: '测试读者', vip: false } : { ...owner, name: '测试作者', vip: true },
    people: async authors => new Map(authors.map(author => [`${author.kind}:${author.id}`, { name: author.id, uid: author.id, avatar: null,
      vip: author.kind === 'owner', joinedAt: '2026-01-01T00:00:00Z', bio: '', active: true }])),
  });
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const post = (path: string, body: unknown, identity = 'owner') => fetch(`${origin}/api/community/${path}`, { method: 'POST',
    headers: { Cookie: identity, Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const get = (path: string, identity = 'buyer') => fetch(`${origin}/api/community/${path}`, { headers: { Cookie: identity } });
  return { ...f, post, get };
}

test('a holographic digital product persists its presentation without changing redemption, stock or counted inventory', async t => {
  const f = await fixture(t), image = f.image();
  const id = f.store.economy.saveItem(null, { ...base, image, artStyle: 'holo-card', deliveryContact: 'author-qq' }, now);
  const item = f.store.economy.item(id)!;
  assert.equal(item.cat, 'digital'); assert.equal(item.kind, 'digital'); assert.equal(item.artStyle, 'holo-card');
  assert.equal(f.store.economy.customItems().find(entry => entry.id === id)!.deliveryContact, 'author-qq');
  assert.deepEqual(f.sql(db => ({ ...db.prepare('SELECT kind,art_style,delivery_contact FROM community_shop_items WHERE id=?').get(id) })),
    { kind: null, art_style: 'holo-card', delivery_contact: 'author-qq' });
  const catalogue = f.store.economy.catalogue(buyer, context).items.find(entry => entry.id === id)!;
  assert.equal(catalogue.artStyle, 'holo-card'); assert.equal(catalogue.delivery, undefined);
  assert.equal(Object.hasOwn(catalogue, 'deliveryContact'), false); assert.equal(Object.hasOwn(catalogue, 'contact'), false);
  assert.throws(() => f.store.economy.delivery(buyer, id), /兑换后才能查看/);
  f.store.ledger.credit(buyer, 2000, 'test', null, new Date(now).toISOString());
  const beforeInventory = f.store.economy.inventory(buyer);
  const result = f.store.economy.redeem(buyer, id, context);
  assert.equal(result.item.kind, 'digital'); assert.equal(result.balance, 500);
  assert.equal(f.store.economy.item(id)!.left, 17); assert.equal(f.store.economy.owned(buyer).has(id), true);
  assert.deepEqual(f.store.economy.inventory(buyer), beforeInventory);
  assert.deepEqual(f.store.economy.delivery(buyer, id), { name: base.name, delivery: base.delivery, contact: 'author-qq' });
  assert.throws(() => f.store.economy.redeem(buyer, id, context), /已拥有/);
  assert.equal(f.store.ledger.balance(buyer), 500); assert.equal(f.store.economy.item(id)!.left, 17);
});

test('ordinary existing digital product DTOs and deliveries omit new optional fields', async t => {
  const { store } = await fixture(t), id = store.economy.saveItem(null, base, now);
  const item = store.economy.item(id)!;
  assert.equal(Object.hasOwn(item, 'artStyle'), false); assert.equal(Object.hasOwn(item, 'deliveryContact'), false);
  store.ledger.credit(buyer, 2000, 'test', null, new Date(now).toISOString()); store.economy.redeem(buyer, id, context);
  assert.deepEqual(store.economy.delivery(buyer, id), { name: base.name, delivery: base.delivery });
});

test('an ordinary edit preserves presentation and contact, explicit null removes them, and stock retains sold units', async t => {
  const f = await fixture(t), image = f.image();
  const id = f.store.economy.saveItem(null, { ...base, image, artStyle: 'holo-card', deliveryContact: 'author-qq' }, now);
  f.store.ledger.credit(buyer, 2000, 'test', null, new Date(now).toISOString()); f.store.economy.redeem(buyer, id, context);
  f.store.economy.saveItem(id, { ...base, name: '调整后的月卡名称', stock: 20 }, now + 1);
  const edited = f.store.economy.item(id)!;
  assert.equal(edited.artStyle, 'holo-card'); assert.equal(edited.image, image); assert.equal(edited.left, 19);
  assert.equal(f.store.economy.delivery(buyer, id).contact, 'author-qq');
  f.store.economy.saveItem(id, { ...base, stock: 20, artStyle: null, deliveryContact: null }, now + 2);
  assert.equal(Object.hasOwn(f.store.economy.item(id)!, 'artStyle'), false);
  assert.equal(Object.hasOwn(f.store.economy.delivery(buyer, id), 'contact'), false);
  assert.equal(f.store.ledger.balance(buyer), 500); assert.equal(f.store.economy.item(id)!.left, 19);
});

test('removing the image clears omitted holographic presentation but retains contact and rejects explicitly retained holo', async t => {
  const f = await fixture(t), id = f.store.economy.saveItem(null, { ...base, image: f.image(), artStyle: 'holo-card', deliveryContact: 'author-qq' }, now);
  assert.throws(() => f.store.economy.saveItem(id, { ...base, image: null, artStyle: 'holo-card' }, now + 1), /图片/);
  f.store.economy.saveItem(id, { ...base, image: null }, now + 2);
  const item = f.store.economy.customItems().find(entry => entry.id === id)!;
  assert.equal(item.image, null); assert.equal(Object.hasOwn(item, 'artStyle'), false); assert.equal(item.deliveryContact, 'author-qq');
});

test('changing an unredeemed product purpose clears omitted presentation/contact and rejects explicit incompatible values', async t => {
  const f = await fixture(t), image = f.image();
  const id = f.store.economy.saveItem(null, { ...base, image, artStyle: 'holo-card', deliveryContact: 'author-qq' }, now);
  const card: CustomItemInput = { ...base, cat: 'card', kind: 'makeup', delivery: '' };
  assert.throws(() => f.store.economy.saveItem(id, { ...card, artStyle: 'holo-card' }, now + 1), /数字资源/);
  assert.throws(() => f.store.economy.saveItem(id, { ...card, deliveryContact: 'author-qq' }, now + 1), /数字资源/);
  f.store.economy.saveItem(id, card, now + 2);
  const item = f.store.economy.item(id)!;
  assert.equal(item.kind, 'card'); assert.equal(item.ref, 'makeup'); assert.equal(item.image, image);
  assert.equal(Object.hasOwn(item, 'artStyle'), false); assert.equal(Object.hasOwn(item, 'deliveryContact'), false);
});

test('holographic products require an undeleted, unattached shop upload and reject unknown presentation/contact values', async t => {
  const f = await fixture(t), deleted = f.image(), attached = f.image();
  const malformed = 'f'.repeat(36);
  f.store.addImage({ id: malformed, uploader: owner, width: 700, height: 1000, purpose: 'shop' });
  f.sql(db => { db.prepare('UPDATE community_images SET deleted_at=? WHERE id=?').run(new Date(now).toISOString(), deleted);
    db.prepare('UPDATE community_images SET topic_id=? WHERE id=?').run('unrelated-topic', attached); });
  for (const image of [undefined, randomUUID(), 'not-an-image-id', malformed, f.image('content'), deleted, attached]) {
    assert.throws(() => f.store.economy.saveItem(null, { ...base, image, artStyle: 'holo-card' }, now), /图片/);
  }
  for (const extra of [{ artStyle: 'unknown' }, { artStyle: '' }, { artStyle: 1 }, { deliveryContact: 'unknown' }, { deliveryContact: '' }, { deliveryContact: {} }]) {
    assert.throws(() => f.store.economy.saveItem(null, { ...base, image: f.image(), ...extra } as unknown as CustomItemInput, now), /展示|领取|联系/);
  }
  assert.equal(f.store.economy.customItems().length, 0);
});

test('nullable presentation constraints reject unsupported or cross-purpose database writes', async t => {
  const f = await fixture(t), image = f.image(), id = f.store.economy.saveItem(null, { ...base, image }, now);
  f.sql(db => {
    for (const value of ['unknown', '']) assert.throws(() => db.prepare('UPDATE community_shop_items SET art_style=? WHERE id=?').run(value, id), /CHECK/);
    assert.throws(() => db.prepare('UPDATE community_shop_items SET delivery_contact=? WHERE id=?').run('unknown', id), /CHECK/);
    assert.throws(() => db.prepare("UPDATE community_shop_items SET cat='goods',art_style='holo-card' WHERE id=?").run(id), /CHECK/);
    assert.throws(() => db.prepare("UPDATE community_shop_items SET cat='goods',delivery_contact='author-qq' WHERE id=?").run(id), /CHECK/);
    assert.throws(() => db.prepare("UPDATE community_shop_items SET kind='frame',art_style='holo-card' WHERE id=?").run(id), /CHECK/);
    assert.throws(() => db.prepare("UPDATE community_shop_items SET image=NULL,art_style='holo-card' WHERE id=?").run(id), /CHECK/);
    assert.deepEqual({ ...db.prepare('SELECT art_style,delivery_contact,stock,stock_left FROM community_shop_items WHERE id=?').get(id) },
      { art_style: null, delivery_contact: null, stock: 18, stock_left: 18 });
  });
});

test('contact metadata can be enabled without card imagery and availability changes preserve presentation settings', async t => {
  const f = await api(t), image = f.image();
  const onlyContact = await f.post('manage/items', { ...base, deliveryContact: 'author-qq' });
  assert.equal(onlyContact.status, 201); const { id: contactId } = await onlyContact.json() as { id: string };
  assert.equal(Object.hasOwn(f.store.economy.item(contactId)!, 'artStyle'), false);
  const card = await f.post('manage/items', { ...base, image, artStyle: 'holo-card', deliveryContact: 'author-qq' });
  assert.equal(card.status, 201); const { id } = await card.json() as { id: string };
  for (const active of [false, true]) {
    assert.equal((await f.post(`manage/items/${id}`, { active })).status, 200);
    const item = f.store.economy.item(id)!;
    assert.equal(item.active, active); assert.equal(item.artStyle, 'holo-card'); assert.equal(item.deliveryContact, 'author-qq');
  }
});

test('existing manage/item API persists supported fields and owned delivery gates the contact entry', async t => {
  const f = await api(t), image = f.image();
  const response = await f.post('manage/items', { ...base, kind: 'digital', image, artStyle: 'holo-card', deliveryContact: 'author-qq' });
  assert.equal(response.status, 201); const { id } = await response.json() as { id: string };
  const catalogue = await (await f.get('shop')).json() as { items: Array<Record<string, unknown>> };
  const item = catalogue.items.find(entry => entry.id === id)!;
  assert.equal(item.artStyle, 'holo-card'); assert.equal(item.kind, 'digital');
  assert.equal(Object.hasOwn(item, 'delivery'), false); assert.equal(Object.hasOwn(item, 'deliveryContact'), false); assert.equal(Object.hasOwn(item, 'contact'), false);
  assert.equal((await f.get(`shop/items/${id}/delivery`)).status, 403);
  f.store.ledger.credit(buyer, 2000, 'test', null, new Date(now).toISOString()); f.store.economy.redeem(buyer, id, context);
  const delivery = await f.get(`shop/items/${id}/delivery`); assert.equal(delivery.status, 200);
  assert.deepEqual(await delivery.json(), { name: base.name, delivery: base.delivery, contact: 'author-qq' });
  const updated = await f.post(`manage/items/${id}`, { ...base, kind: 'digital', name: '旧编辑器保存后的月卡', stock: 20 });
  assert.equal(updated.status, 200); assert.equal(f.store.economy.item(id)!.artStyle, 'holo-card');
  assert.equal(f.store.economy.delivery(buyer, id).contact, 'author-qq'); assert.equal(f.store.economy.item(id)!.left, 19);
  assert.equal((await f.post(`manage/items/${id}`, { ...base, image: null, artStyle: 'holo-card' })).status, 400);
  assert.equal((await f.post(`manage/items/${id}`, { ...base, image: null })).status, 200);
  assert.equal(Object.hasOwn(f.store.economy.item(id)!, 'artStyle'), false);
});

test('manage/item rejects invalid metadata and another actor\'s upload while preserving ordinary management permissions', async t => {
  const f = await api(t), image = f.image();
  const bad: Array<Record<string, unknown>> = [
    { artStyle: 'unknown' }, { artStyle: '' }, { artStyle: [] }, { deliveryContact: 'unknown' }, { deliveryContact: false },
    { image: null, artStyle: 'holo-card' }, { image: randomUUID(), artStyle: 'holo-card' },
    { image: f.image('shop', buyer), artStyle: 'holo-card' },
    { cat: 'goods', kind: 'goods', artStyle: 'holo-card' }, { cat: 'goods', kind: 'goods', deliveryContact: 'author-qq' },
    { cat: 'card', kind: 'card', ref: 'makeup', deliveryContact: 'author-qq' },
  ];
  for (const change of bad) assert.equal((await f.post('manage/items', { ...base, kind: 'digital', image, ...change })).status, 400, JSON.stringify(change));
  assert.equal((await f.post('manage/items', { ...base, image, artStyle: 'holo-card' }, 'buyer')).status, 403);
  assert.equal(f.store.economy.customItems().length, 0);
});

test('presentation migration adds nullable columns without rebuilding products or changing durable economy records, and is idempotent', async t => {
  const f = await fixture(t), id = f.store.economy.saveItem(null, base, now);
  f.store.ledger.credit(buyer, 2000, 'test', null, new Date(now).toISOString()); f.store.economy.redeem(buyer, id, context); f.close();
  const db = new DatabaseSync(resolve(f.directory, 'content.db'));
  try {
    const names = new Set(db.prepare('PRAGMA table_info(community_shop_items)').all().map(row => row.name));
    for (const column of ['art_style', 'delivery_contact']) if (names.has(column)) db.exec(`ALTER TABLE community_shop_items DROP COLUMN ${column}`);
    db.exec('CREATE INDEX presentation_legacy_name_idx ON community_shop_items(name); CREATE TABLE presentation_trigger_receipts(item TEXT); CREATE TRIGGER presentation_legacy_name_trigger AFTER UPDATE OF name ON community_shop_items BEGIN INSERT INTO presentation_trigger_receipts VALUES(NEW.id); END;');
  } finally { db.close(); }
  const snapshot = () => f.sql(database => Object.fromEntries(['community_shop_items', 'community_orders', 'community_owned', 'community_ledger', 'community_members'].map(table => [table,
    database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => { const copy = { ...row }; delete copy.art_style; delete copy.delivery_contact; return copy; })])));
  await mkdir(resolve(f.directory, 'schema-backups'), { recursive: true });
  const before = snapshot(), count = (await readdir(resolve(f.directory, 'schema-backups'))).length;
  assert.equal(f.sql(communitySchemaReady), false);
  const migrated = await migrateCommunity(f.directory); assert.equal(migrated.changed, true);
  assert.deepEqual(snapshot(), before); assert.equal(f.sql(communitySchemaReady), true);
  assert.equal((await readdir(resolve(f.directory, 'schema-backups'))).length, count + 1);
  assert.equal((await migrateCommunity(f.directory)).changed, false);
  assert.equal((await readdir(resolve(f.directory, 'schema-backups'))).length, count + 1);
  f.sql(database => {
    assert.deepEqual({ ...database.prepare('SELECT art_style,delivery_contact FROM community_shop_items WHERE id=?').get(id) }, { art_style: null, delivery_contact: null });
    assert.equal(database.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok'); assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE name='presentation_legacy_name_idx'").get());
    database.prepare('UPDATE community_shop_items SET name=? WHERE id=?').run('迁移后仍有效的商品', id);
    assert.equal(database.prepare('SELECT item FROM presentation_trigger_receipts').get()!.item, id);
  });
  const reopened = createCommunityStore(f.directory);
  try { assert.equal(reopened.ledger.balance(buyer), 500); assert.equal(reopened.economy.item(id)!.left, 17);
    assert.deepEqual(reopened.economy.delivery(buyer, id), { name: '迁移后仍有效的商品', delivery: base.delivery });
  } finally { reopened.close(); }
});
