import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { beijingDay } from '../src/community-rules.mjs';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const cleanup = directory => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-equipment-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function setup(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-equipment-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory), audits = [];
  let siteOrigin;
  const server = createServer((request, response) => service.handle(request, response));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  siteOrigin = `http://127.0.0.1:${server.address().port}`;
  const service = createCommunityService({
    store, directory, siteOrigin,
    identify: async request => {
      const id = String(request.headers.cookie || 'reader').split(';')[0];
      return id === 'owner' ? { kind: 'owner', id: 'owner', name: '無相', vip: true } : { kind: 'reader', id, name: id, vip: false };
    },
    people: async authors => new Map(authors.map(author => [`${author.kind}:${author.id}`, { name: author.id, uid: author.id, vip: false, joinedAt: '2026-01-01T00:00:00.000Z' }])),
    audit: async (action, details) => { audits.push({ action, ...details }); },
  });
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  for (const id of ['reader', 'other', 'steward']) {
    db.prepare("INSERT INTO community_members (member_kind, member_id, level, level_day, agreed_at, created_at, steward) VALUES ('reader', ?, ?, ?, ?, ?, ?)")
      .run(id, id === 'steward' ? 4 : 1, beijingDay(Date.now()), new Date().toISOString(), new Date().toISOString(), id === 'steward' ? 1 : 0);
    store.ledger.credit({ kind: 'reader', id }, 2000, 'test', null, new Date().toISOString());
  }
  db.close();
  acceptCommunityConvention(store, [{ kind: 'owner', id: 'owner' }, ...['reader', 'other', 'steward'].map(id => ({ kind: 'reader', id }))]);
  t.after(async () => { await new Promise(done => server.close(done)); store.close(); await cleanup(directory); });
  const get = (path, identity = 'reader') => fetch(`${siteOrigin}/api/community/${path}`, { headers: { cookie: identity } });
  const post = (path, body, identity = 'owner') => fetch(`${siteOrigin}/api/community/${path}`, { method: 'POST', headers: { cookie: identity, origin: siteOrigin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const upload = (bytes, type = 'image/png', identity = 'owner') => {
    const form = new FormData(); form.append('file', new Blob([bytes], { type }), 'frame.png');
    return fetch(`${siteOrigin}/api/community/manage/item-image`, { method: 'POST', headers: { cookie: identity, origin: siteOrigin, 'X-Reader-Request': '1' }, body: form });
  };
  return { directory, store, get, post, upload, audits };
}
const input = { cat: 'digital', name: '星图素材', description: '兑换后获得这套素材下载链接。', price: 30, stock: null, limitPer: null, minLevel: 0, minDays: 0, delivery: 'https://example.com/assets', note: '', active: true };
const frameBytes = async (transparent = true) => {
  const width = 96, rgba = Buffer.alloc(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    rgba[i] = 216; rgba[i + 1] = 188; rgba[i + 2] = 126;
    rgba[i + 3] = transparent && x > 18 && x < 77 && y > 18 && y < 77 ? 0 : 255;
  }
  return sharp(rgba, { raw: { width, height: width, channels: 4 } }).png().toBuffer();
};

test('only the author adds persistent shop groupings without changing the item function', async t => {
  const { post, get, store, audits } = await setup(t);
  assert.equal((await post('manage/categories', { name: '创作素材' }, 'reader')).status, 403);
  assert.equal((await post('manage/categories', { name: '创作素材' }, 'steward')).status, 403);
  const created = await post('manage/categories', { name: '创作素材' });
  assert.equal(created.status, 201);
  const category = await created.json();
  assert.match(category.id, /^[0-9a-f-]{36}$/);
  assert.equal((await post('manage/categories', { name: '创作素材' })).status, 409);
  assert.equal((await post('manage/categories', { name: '装扮' })).status, 400);
  assert.equal((await post('manage/items', { ...input, category: 'missing' })).status, 400);
  const item = await (await post('manage/items', { ...input, category: category.id })).json();
  const shop = await (await get('shop')).json();
  assert.equal(shop.categories.find(row => row.id === category.id).name, '创作素材');
  assert.equal(shop.items.find(row => row.id === item.id).kind, 'digital');
  assert.equal(store.economy.item(item.id).category, category.id);
  assert.deepEqual((await (await get('manage?tab=items', 'owner')).json()).categories, [category]);
  assert.ok(audits.some(row => row.action === 'community-category-create' && row.category === category.id));
  await post(`manage/items/${item.id}`, { ...input, name: '修改素材名称' });
  assert.equal(store.economy.item(item.id).category, category.id, 'older update clients retain the category');
});

test('a transparent custom frame is real owned equipment and remains usable after off-sale', async t => {
  const { post, get, upload, store } = await setup(t);
  const uploaded = await upload(await frameBytes());
  assert.equal(uploaded.status, 201);
  const image = await uploaded.json();
  assert.equal(image.frameReady, true);
  const frameInput = { ...input, cat: 'look', kind: 'frame', image: image.id, delivery: '' };
  const created = await post('manage/items', frameInput);
  assert.equal(created.status, 201);
  const { id } = await created.json(), ref = `image:${image.id}`;
  assert.equal(store.economy.item(id).kind, 'frame');
  assert.equal(store.economy.item(id).ref, ref);
  assert.equal((await post('shop/equip', { kind: 'frame', ref }, 'other')).status, 403);
  assert.equal((await post('shop/redeem', { item: id }, 'reader')).status, 201);
  assert.equal(store.members.decorations({ kind: 'reader', id: 'reader' }).frame, ref);
  assert.equal((await post('shop/redeem', { item: id }, 'reader')).status, 409);
  assert.ok((await (await get('shop/mine')).json()).looks.some(row => row.id === id));
  const replacement = await (await upload(await frameBytes())).json();
  assert.equal((await post(`manage/items/${id}`, { ...frameInput, image: replacement.id })).status, 400, 'already owned frame artwork must not be replaced');
  assert.equal(store.economy.item(id).image, image.id);
  assert.equal((await post('shop/redeem', { item: 'frame-gold' }, 'reader')).status, 201);
  assert.equal(store.members.decorations({ kind: 'reader', id: 'reader' }).frame, 'gold', 'built-in frames still equip normally');
  assert.equal((await post(`manage/items/${id}`, { ...frameInput, active: false })).status, 200);
  assert.equal((await post(`manage/items/${id}`, { ...frameInput, name: '改名后的头像框', description: '更新物品文字，但佩戴资源不变。', active: false })).status, 200);
  assert.equal(store.economy.item(id).image, image.id);
  assert.ok(store.economy.owned({ kind: 'reader', id: 'reader' }).has(id));
  assert.equal((await post('shop/equip', { kind: 'frame', ref: null }, 'reader')).status, 200);
  assert.equal((await get(`images/${image.id}.webp`, 'other')).status, 404, 'unworn off-sale frames are private to the owner and purchasers');
  assert.equal((await get(`images/${image.id}.webp`, 'reader')).status, 200, 'the purchaser keeps access before re-equipping');
  assert.equal((await post('shop/equip', { kind: 'frame', ref }, 'reader')).status, 200);
  assert.equal((await get(`images/${image.id}.webp`, 'other')).status, 200, 'other members can see an equipped off-sale frame');
  assert.equal((await post(`manage/items/${id}`, { ...frameInput, image: null })).status, 400);
});

test('opaque images, missing assets and fake frame references cannot become equipment', async t => {
  const { post, upload } = await setup(t);
  const opaque = await (await upload(await frameBytes(false))).json();
  assert.equal(opaque.frameReady, false);
  const frameInput = { ...input, cat: 'look', kind: 'frame', delivery: '' };
  assert.equal((await post('manage/items', frameInput)).status, 400);
  assert.equal((await post('manage/items', { ...frameInput, image: opaque.id })).status, 400);
  assert.equal((await post('manage/items', { ...frameInput, image: 'https://example.com/frame.png' })).status, 400);
  assert.equal((await post('shop/equip', { kind: 'frame', ref: 'image:../../secret' }, 'reader')).status, 403);
});

test('nickname effects are safe custom equipment with ownership, inventory and off-sale support', async t => {
  const { post, get, store } = await setup(t);
  const effect = { style: 'shimmer', colors: ['#976223', '#B13483'] };
  const colorInput = { ...input, cat: 'look', kind: 'color', name: '流光昵称', delivery: '', effect };
  const response = await post('manage/items', colorInput);
  assert.equal(response.status, 201);
  const { id } = await response.json(), ref = `effect:${id}`;
  assert.deepEqual(store.economy.nameEffect(ref), effect);
  assert.equal(store.economy.nameEffect('effect:../../secret'), null);
  assert.equal((await post('shop/equip', { kind: 'color', ref }, 'other')).status, 403);
  assert.equal((await post('shop/redeem', { item: id }, 'reader')).status, 201);
  assert.equal(store.members.decorations({ kind: 'reader', id: 'reader' }).color, ref);
  assert.ok((await (await get('shop/mine')).json()).looks.some(row => row.ref === ref));
  await post(`manage/items/${id}`, { ...colorInput, active: false });
  assert.equal((await post('shop/equip', { kind: 'color', ref: null }, 'reader')).status, 200);
  assert.equal((await post('shop/equip', { kind: 'color', ref }, 'reader')).status, 200);
  assert.deepEqual(store.economy.nameEffect(ref), effect);
  assert.equal((await post('shop/redeem', { item: 'color-aurora' }, 'reader')).status, 201);
  assert.equal(store.members.decorations({ kind: 'reader', id: 'reader' }).color, 'aurora', 'built-in nickname effects remain available');
  assert.equal((await post('shop/equip', { kind: 'color', ref }, 'reader')).status, 200);
  assert.equal((await post(`manage/items/${id}`, { ...colorInput, effect: { style: 'gradient', colors: ['#236F62', '#865294'] }, active: false })).status, 200);
  assert.deepEqual(store.economy.nameEffect(ref), { style: 'gradient', colors: ['#236F62', '#865294'] }, 'configured effect updates retain the owned reference');
  assert.equal((await post(`manage/items/${id}`, { ...input, cat: 'goods', stock: 2 })).status, 400, 'redeemed functional types cannot be changed');
});

test('nickname effects reject arbitrary CSS, unsupported styles and malformed colors', async t => {
  const { post } = await setup(t);
  const colorInput = { ...input, cat: 'look', kind: 'color', delivery: '' };
  for (const effect of [null, { style: 'css', colors: ['#976223'] }, { style: 'solid', colors: ['url(https://example.com)'] }, { style: 'gradient', colors: ['#976223'] }, { style: 'solid', colors: ['#976223', '#B13483'] }])
    assert.equal((await post('manage/items', { ...colorInput, effect })).status, 400);
  assert.equal((await post('manage/items', { ...colorInput, effect: { style: 'solid', colors: ['#976223'] } })).status, 201);
});

test('shop media bindings and frame suitability come from the stored upload, never client claims', async t => {
  const { post, get, upload, store } = await setup(t);
  const image = await (await upload(await frameBytes())).json();
  assert.equal((await get(`images/${image.id}.webp`, 'reader')).status, 404, 'unpublished upload stays private');
  assert.equal((await get(`images/${image.id}.webp`, 'owner')).status, 200);
  assert.equal((await upload(await frameBytes(), 'image/png', 'steward')).status, 403);
  const frameInput = { ...input, cat: 'look', kind: 'frame', delivery: '' };
  const otherImage = randomUUID(), forumImage = randomUUID();
  store.addImage({ id: otherImage, uploader: { kind: 'reader', id: 'other' }, width: 96, height: 96, purpose: 'shop', frameReady: true });
  store.addImage({ id: forumImage, uploader: { kind: 'owner', id: 'owner' }, width: 96, height: 96, purpose: 'content', frameReady: true });
  for (const id of [otherImage, forumImage]) assert.equal((await post('manage/items', { ...frameInput, image: id })).status, 400);
  const opaque = await (await upload(await frameBytes(false))).json();
  assert.equal((await post('manage/items', { ...frameInput, image: opaque.id, frameReady: true })).status, 400, 'fake readiness cannot approve an opaque frame');
});

test('animated equipment preserves timing and requires the avatar opening in every frame', async t => {
  const { post, get, upload } = await setup(t);
  const ring = await sharp(await frameBytes()).raw().toBuffer();
  const second = Buffer.from(ring);
  for (let i = 0; i < second.length; i += 4) second[i] = 136;
  for (const [format, type] of [['gif', 'image/gif'], ['webp', 'image/webp']]) {
    const source = await sharp(Buffer.concat([ring, second]), { raw: { width: 96, height: 192, channels: 4, pageHeight: 96 } })[format]({ delay: [100, 200], loop: 0 }).toBuffer();
    const response = await upload(source, type);
    assert.equal(response.status, 201);
    const image = await response.json();
    assert.equal(image.frameReady, true);
    const stored = Buffer.from(await (await get(`images/${image.id}.webp`, 'owner')).arrayBuffer());
    const metadata = await sharp(stored, { animated: true }).metadata();
    assert.equal(metadata.pages, 2); assert.deepEqual(metadata.delay, [100, 200]);
    const item = await post('manage/items', { ...input, cat: 'look', kind: 'frame', image: image.id, delivery: '' });
    assert.equal(item.status, 201);
    assert.equal((await post('shop/redeem', { item: (await item.json()).id }, 'reader')).status, 201);
  }
  const opaque = await sharp(await frameBytes(false)).raw().toBuffer();
  const mixed = await sharp(Buffer.concat([ring, opaque]), { raw: { width: 96, height: 192, channels: 4, pageHeight: 96 } }).webp({ delay: [100, 200], loop: 0 }).toBuffer();
  const mixedImage = await (await upload(mixed, 'image/webp')).json();
  assert.equal(mixedImage.frameReady, false, 'a later opaque frame must not hide the avatar');
  assert.equal((await post('manage/items', { ...input, cat: 'look', kind: 'frame', image: mixedImage.id, delivery: '' })).status, 400);
});
