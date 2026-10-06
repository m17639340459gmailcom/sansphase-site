import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';
import { createCommunityPreviewStore } from './fixtures/community-preview-store.ts';

const member = { kind: 'reader' as const, id: 'published-catalog-reader' };
const now = Date.parse('2026-10-07T02:00:00.000Z');
const context = { level: 1, owner: false, joinedAt: '2026-01-01T00:00:00.000Z', now };
const input = { cat: 'digital' as const, name: '作者正式发布的资源', description: '经作者确认上架', price: 40, stock: null,
  limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '正式资源内容', note: '', active: true };
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'shop-publication-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => rm(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'shop-publication-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  acceptCommunityConvention(store, [member]);
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const service = createCommunityService({ store, siteOrigin: origin, directory, ownerId: 'owner',
    identify: async () => ({ ...member, name: '正式读者', vip: false }),
    people: async authors => new Map(authors.map(author => [`${author.kind}:${author.id}`, { name: '正式读者', uid: '10001', avatar: null, bio: '', vip: false, joinedAt: context.joinedAt }])),
    findMember: async () => member, findByNames: async () => new Map(), avatarFile: async () => null,
  });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const get = (path: string) => fetch(`${origin}/api/community/${path}`);
  const redeem = (id: string) => fetch(`${origin}/api/community/shop/redeem`, { method: 'POST',
    headers: { Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ item: id }) });
  return { directory, store, get, redeem };
}

test('a fresh formal shop publishes no preview items and rejects their IDs without charging the reader', async t => {
  const { store, get, redeem } = await fixture(t);
  store.ledger.credit(member, 1000, 'test', null, new Date(now).toISOString());
  const catalog = await get('shop');
  assert.equal(catalog.status, 200);
  assert.deepEqual((await catalog.json()).items, []);
  for (const id of ['frame-gold', 'frame-orbit', 'frame-nebula', 'color-gold', 'color-aurora', 'cover-aurora', 'cover-abyss', 'card-makeup', 'card-pin', 'card-highlight']) {
    const response = await redeem(id);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /下架/);
  }
  assert.equal(store.ledger.balance(member), 1000);
  assert.deepEqual(store.economy.orders(member), []);
  assert.deepEqual(store.economy.inventory(member), { makeup: 0, pin: 0, highlight: 0 });
  assert.equal(store.economy.customItems().length, 0, 'sample definitions are not migrated into persistent product rows');
});

test('formal publication remains controlled by the author and survives reopening without activating samples', async t => {
  const { directory, store, get, redeem } = await fixture(t);
  const published = store.economy.saveItem(null, input, now);
  const draft = store.economy.saveItem(null, { ...input, name: '尚未上架的草稿', active: false }, now);
  store.ledger.credit(member, 100, 'test', null, new Date(now).toISOString());
  const reopened = createCommunityStore(directory);
  try {
    assert.deepEqual(reopened.economy.items().filter(item => item.active).map(item => item.id), [published]);
    assert.equal(reopened.economy.item(draft)?.active, false);
  } finally { reopened.close(); }
  assert.deepEqual((await (await get('shop')).json()).items.map((item: { id: string }) => item.id), [published]);
  assert.equal((await redeem(draft)).status, 409);
  assert.equal((await redeem(published)).status, 201);
  assert.equal(store.ledger.balance(member), 60);
  assert.equal(store.economy.delivery(member, published).delivery, input.delivery);
});

test('withdrawing preview sales preserves prior orders, ledger labels and already-owned decorations', async t => {
  const { directory, store, get, redeem } = await fixture(t);
  const preview = createCommunityPreviewStore(directory);
  try {
    assert.equal(preview.economy.items().filter(item => item.active).length, 10);
    preview.ledger.credit(member, 1000, 'test', null, new Date(now).toISOString());
    preview.economy.redeem(member, 'frame-gold', context);
    preview.economy.redeem(member, 'card-highlight', context);
  } finally { preview.close(); }
  const balance = store.ledger.balance(member);
  const mine = await (await get('shop/mine')).json();
  assert.deepEqual(mine.looks.map((item: { id: string; active: boolean }) => [item.id, item.active]), [['frame-gold', false]]);
  assert.equal(mine.orders.length, 2);
  assert.equal(mine.inventory.highlight, 1);
  assert.equal(store.economy.equip(member, 'frame', null).frame, null);
  assert.equal(store.economy.equip(member, 'frame', 'gold').frame, 'gold');
  const stardust = await (await get('stardust')).json();
  assert.equal(stardust.ledger.find((row: { reason: string; detail: string }) => row.reason === 'shop' && row.detail === '金环头像框')?.detail, '金环头像框');
  assert.equal((await redeem('card-highlight')).status, 409);
  assert.equal(store.ledger.balance(member), balance);
  assert.equal(store.economy.orders(member).length, 2);
});
