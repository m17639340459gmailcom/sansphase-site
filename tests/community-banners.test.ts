import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

async function setup(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-banners-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  await mkdir(resolve(directory, 'uploads'));
  const store = createCommunityStore(directory);
  const mod = { kind: 'reader' as const, id: 'mod' }, owner = { kind: 'owner' as const, id: 'owner' };
  acceptCommunityConvention(store, [owner, mod, { kind: 'reader', id: 'reader' }, { kind: 'reader', id: 'vip' }]);
  store.members.setSteward(mod, true, ['qa']);
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  service = createCommunityService({ store, directory, siteOrigin: origin,
    identify: async req => { const id = String(req.headers.cookie || 'reader').split(';')[0]; return { kind: id === 'owner' ? 'owner' : 'reader', id, name: id, vip: id === 'owner' || id === 'vip' }; },
    people: async authors => new Map(authors.map(author => [`${author.kind}:${author.id}`, { name: author.id, uid: author.id, avatar: null, vip: false, joinedAt: null, bio: '' }])), audit: async () => {},
  });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const get = (path: string, as = 'reader') => fetch(`${origin}/api/community/${path}`, { headers: { cookie: as } });
  const post = (body: unknown, as = 'owner') => fetch(`${origin}/api/community/manage/banners`, { method: 'POST', headers: { cookie: as, origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const upload = (scope: string, data: Buffer, as = 'mod') => { const form = new FormData(); form.set('file', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'banner.png'); return fetch(`${origin}/api/community/manage/banner-image?scope=${scope}`, { method: 'POST', headers: { cookie: as, origin, 'X-Reader-Request': '1' }, body: form }); };
  const topic = (board = 'qa', pending = false) => store.createTopic({ board, author: owner, title: `${board}展示测试帖子`, body: '独立横幅回归测试正文', ...(pending ? { pending: '审核中' } : {}) }).id;
  return { directory, store, get, post, upload, topic, mod, owner, origin };
}
const config = (scope: string, topicId: string, version = 0, cover: string | null = null) => ({ scope, version, items: [{ topicId, title: '', cover }] });

test('homepage is owner controlled, boards follow actual assignments, and reader perspective cannot save', async t => {
  const { get, post, topic } = await setup(t); const qa = topic(), tools = topic('tools');
  assert.equal((await post(config('home', qa), 'mod')).status, 403);
  assert.equal((await post(config('tools', tools), 'mod')).status, 403);
  assert.equal((await post(config('qa', tools), 'mod')).status, 400);
  assert.equal((await post(config('qa', qa), 'reader')).status, 403);
  assert.equal((await post(config('qa', qa), 'mod; community_browse=reader')).status, 403);
  assert.equal((await post(config('qa', qa), 'mod')).status, 200);
  const management = await (await get('manage?tab=banners', 'mod')).json();
  assert.equal(management.tab, 'banners'); assert.deepEqual(management.banners.map((item: { scope: string }) => item.scope), ['qa']);
  assert.ok((await (await get('manage?tab=banners', 'owner')).json()).banners.some((item: { scope: string }) => item.scope === 'home'));
});

test('banner settings are independent from pinning, preserve custom titles and reject stale versions atomically', async t => {
  const { get, post, topic, store } = await setup(t); const one = topic(), two = topic();
  assert.equal((await post({ ...config('home', one), items: [{ topicId: one, title: '自定义横幅标题', cover: null }] })).status, 200);
  store.setPinned(two, true); store.setFeatured(two, true, { actor: { kind: 'owner', id: 'owner' } });
  const saved = await (await get('banners?scope=home')).json();
  assert.equal(saved.version, 1); assert.deepEqual(saved.items.map((item: { topicId: string }) => item.topicId), [one]); assert.equal(saved.items[0].title, '自定义横幅标题');
  const parallel = await Promise.all([post(config('home', two, 1)), post(config('home', one, 1))]);
  assert.deepEqual(parallel.map(response => response.status).sort(), [200, 409]);
  assert.equal((await (await get('banners?scope=home')).json()).version, 2);
  assert.equal((await post({ scope: 'home', version: 2, items: Array.from({ length: 6 }, () => ({ topicId: one, title: '', cover: null })) })).status, 400);
  assert.equal((await post({ scope: 'home', version: 2, items: [{ topicId: one, title: '', cover: null }, { topicId: one, title: '', cover: null }] })).status, 400);
  assert.equal((await (await get('banners?scope=home')).json()).version, 2);
});

test('home and board configurations accept five unique slides, reject six and retain the saved version and order', async t => {
  const { get, post, topic } = await setup(t);
  const ids = Array.from({ length: 6 }, () => topic());
  const items = ids.map(topicId => ({ topicId, title: '', cover: null }));
  for (const [scope, as] of [['home', 'owner'], ['qa', 'mod']]) {
    assert.equal((await post({ scope, version: 0, items: items.slice(0, 5) }, as)).status, 200);
    assert.equal((await post({ scope, version: 1, items }, as)).status, 400);
    const saved = await (await get(`banners?scope=${scope}`)).json();
    assert.equal(saved.version, 1);
    assert.deepEqual(saved.items.map((item: { topicId: string }) => item.topicId), ids.slice(0, 5));
  }
});

test('existing four-slide schema upgrades capacity after backup without changing configured slides or versions', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-banner-capacity-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  const original = createCommunityStore(directory), owner = { kind: 'owner' as const, id: 'owner' };
  const ids = Array.from({ length: 5 }, () => original.createTopic({ board: 'qa', author: owner, title: '升级容量测试帖子', body: '迁移应保留已有横幅顺序' }).id);
  const access = { actor: owner, browsingAsReader: false, canSeeBoard: () => true };
  original.banners.replace('home', 0, ids.slice(0, 4).map(topicId => ({ topicId, title: '已保存的标题', cover: null })), access);
  original.close();
  const legacy = new DatabaseSync(resolve(directory, 'content.db'));
  legacy.exec(`ALTER TABLE community_banner_entries RENAME TO old_entries;
    CREATE TABLE community_banner_entries(scope TEXT NOT NULL,position INTEGER NOT NULL CHECK(position>=0 AND position<4),topic_id TEXT NOT NULL,topic_board TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',cover TEXT,PRIMARY KEY(scope,position),UNIQUE(scope,topic_id));
    INSERT INTO community_banner_entries SELECT * FROM old_entries;
    DROP TABLE old_entries;
    CREATE INDEX community_banner_cover_idx ON community_banner_entries(cover);`);
  legacy.close();
  const result = await migrateCommunity(directory); assert.equal(result.changed, true);
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, 2);
  const upgraded = createCommunityStore(directory);
  try {
    const before = upgraded.banners.get('home', () => true); assert.equal(before.version, 1);
    assert.deepEqual(before.items.map(item => item.topicId), ids.slice(0, 4)); assert.equal(before.items[0].title, '已保存的标题');
    assert.equal(upgraded.banners.replace('home', 1, ids.map(topicId => ({ topicId, title: '', cover: null })), access).items.length, 5);
  } finally { upgraded.close(); }
  assert.deepEqual(await migrateCommunity(directory), { changed: false });
});

test('public banners omit unavailable, VIP and moved topics without leaking their titles', async t => {
  const { get, post, topic, store } = await setup(t); const qa = topic(), vip = topic('vip'), pending = topic('qa', true);
  assert.equal((await post(config('qa', pending))).status, 400);
  assert.equal((await post({ scope: 'home', version: 0, items: [qa, vip].map(topicId => ({ topicId, title: '', cover: null })) })).status, 200);
  assert.deepEqual((await (await get('banners?scope=home')).json()).items.map((item: { topicId: string }) => item.topicId), [qa]);
  assert.equal((await get('banners?scope=vip')).status, 404);
  store.move(qa, 'tools');
  assert.deepEqual((await (await get('banners?scope=home')).json()).items, []);
  assert.equal((await post(config('tools', qa))).status, 200);
  store.hide({ kind: 'topic', id: qa }, '隐藏');
  assert.deepEqual((await (await get('banners?scope=tools', 'owner')).json()).items, []);
});

test('banner uploads stay private until a visible publication and cannot be reused across scopes or as content', async t => {
  const { upload, post, get, topic, store, directory, owner } = await setup(t); const qa = topic(), tools = topic('tools');
  const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#123456' } }).png().toBuffer();
  assert.equal((await upload('home', png)).status, 403);
  const response = await upload('qa', png); assert.equal(response.status, 201); const image = await response.json();
  const cover = image.id;
  assert.equal(store.image(image.id)?.purpose, 'banner'); assert.equal((await get(`images/${image.id}.webp`)).status, 404);
  assert.equal((await get(`images/${image.id}.webp`, 'mod')).status, 200);
  assert.equal((await post(config('qa', qa, 0, cover), 'mod')).status, 200);
  const published = await get(`images/${image.id}.webp`); assert.equal(published.status, 200);
  assert.equal(published.headers.get('cache-control'), 'private, no-store', 'banner visibility changes are never served from a stale private cache');
  assert.equal((await post(config('tools', tools, 0, cover))).status, 400);
  assert.equal((await post(config('qa', qa, 1, cover), 'owner')).status, 200, 'owner may retain an existing moderator cover');
  const stale = new DatabaseSync(resolve(directory, 'content.db')); stale.prepare('UPDATE community_images SET created_at=? WHERE id=?').run('2000-01-01T00:00:00Z', image.id); stale.close();
  assert.equal(store.sweepImages().includes(image.id), false, 'live custom cover survives upload cleanup');
  assert.throws(() => store.createTopic({ board: 'qa', author: owner, title: '非法复用横幅图片', body: '尝试直接作为帖子附件使用', images: [image.id] }));
  store.hide({ kind: 'topic', id: qa }, '隐藏');
  assert.equal((await get(`images/${image.id}.webp`)).status, 404); assert.equal((await get(`images/${image.id}.webp`, 'mod')).status, 404, 'published hidden covers are not uploader previews');
  const unrelated = randomUUID(); store.addImage({ id: unrelated, uploader: owner, width: 1, height: 1, purpose: 'shop' });
  await writeFile(resolve(directory, 'uploads', `community-image-${unrelated}.webp`), png);
  assert.equal((await post(config('tools', tools, 0, unrelated))).status, 400);
});

test('moderator uploads use 2 MB ceiling while author uploads use the existing author allowance', async t => {
  const { upload } = await setup(t);
  const large = Buffer.concat([await sharp({ create: { width: 10, height: 10, channels: 3, background: '#345678' } }).png().toBuffer(), Buffer.alloc(2 * 1024 ** 2)]);
  assert.equal((await upload('qa', large)).status, 413);
  assert.equal((await upload('qa', large, 'owner')).status, 201);
});

test('an appointment withdrawn during upload cannot record an image or leave decoded files behind', async t => {
  const { upload, store, mod, directory } = await setup(t);
  const original = store.banners.authorize;
  let initial = true;
  store.banners.authorize = (scope, access) => {
    original(scope, access);
    if (initial) { initial = false; queueMicrotask(() => store.members.setSteward(mod, false)); }
  };
  const png = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#334455' } }).png().toBuffer();
  assert.equal((await upload('qa', png)).status, 403);
  assert.deepEqual(await readdir(resolve(directory, 'uploads')), []);
  const db = new DatabaseSync(resolve(directory, 'content.db')); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM community_images WHERE purpose='banner'").get()?.n, 0); db.close();
});

test('configuration validation rejects malformed fields without replacing the saved order', async t => {
  const { post, get, topic } = await setup(t); const id = topic();
  assert.equal((await post(config('home', id))).status, 200);
  for (const body of [
    { scope: 'unknown', version: 1, items: [] },
    { scope: 'home', version: -1, items: [] },
    { scope: 'home', version: 1.1, items: [] },
    { scope: 'home', version: 1, items: 'not-array' },
    { scope: 'home', version: 1, items: [{ topicId: id, title: '过'.repeat(81), cover: null }] },
    { scope: 'home', version: 1, items: [{ topicId: id, title: '', cover: 'https://example.com/image.png' }] },
  ]) assert.ok([400, 404].includes((await post(body)).status));
  const after = await (await get('banners?scope=home')).json(); assert.equal(after.version, 1); assert.equal(after.items[0].topicId, id);
  assert.equal((await post({ scope: 'home', version: 1, items: [] })).status, 200);
  assert.deepEqual((await (await get('banners?scope=home')).json()).items, [], 'empty selection remains deliberately empty');
});

test('withdrawn board assignment cannot save a JSON body that started before the withdrawal', async t => {
  const { origin, topic, store, mod, get } = await setup(t); const id = topic();
  const payload = JSON.stringify(config('qa', id));
  let requestReady: () => void = () => {};
  const ready = new Promise<void>(done => { requestReady = done; });
  const pending = new Promise<number>(done => {
    const req = request(`${origin}/api/community/manage/banners`, { method: 'POST', headers: { cookie: 'mod', origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => { res.resume(); res.on('end', () => done(res.statusCode || 0)); });
    req.write(payload.slice(0, -1));
    setTimeout(() => { store.members.setSteward(mod, false); req.end(payload.slice(-1)); requestReady(); }, 30);
  });
  await ready; assert.equal(await pending, 403);
  assert.equal((await (await get('banners?scope=qa')).json()).version, 0);
});

test('pending custom covers expire while active cover references and independent selections survive cleanup and topic deletion', async t => {
  const { upload, post, get, topic, store, directory } = await setup(t); const id = topic();
  const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#778899' } }).png().toBuffer();
  const used = await (await upload('qa', png)).json(), unused = await (await upload('qa', png)).json();
  assert.equal((await post(config('qa', id, 0, used.id), 'mod')).status, 200);
  const db = new DatabaseSync(resolve(directory, 'content.db')); db.prepare("UPDATE community_images SET created_at='2000-01-01T00:00:00Z' WHERE purpose='banner'").run(); db.close();
  assert.deepEqual(store.sweepImages(), [unused.id]);
  assert.equal((await get(`images/${unused.id}.webp`, 'mod')).status, 404);
  store.deleteTopic(id, { moderated: false });
  assert.equal((await (await get('banners?scope=qa')).json()).items.length, 0);
  assert.equal((await get(`images/${used.id}.webp`)).status, 404);
  assert.equal(store.sweepImages().includes(used.id), false, 'a configured reference remains recoverable until managers remove it');
});

test('migration preserves old images, snapshots old selections once and remains idempotent', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-banner-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec(`CREATE TABLE community_topics(id TEXT PRIMARY KEY, board TEXT NOT NULL, author_kind TEXT NOT NULL, author_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,last_activity_at TEXT NOT NULL,reply_count INTEGER NOT NULL DEFAULT 0,pinned INTEGER NOT NULL DEFAULT 0,featured INTEGER NOT NULL DEFAULT 0,deleted_at TEXT);
    CREATE TABLE community_images(id TEXT PRIMARY KEY,uploader_kind TEXT NOT NULL,uploader_id TEXT NOT NULL,topic_id TEXT,position INTEGER NOT NULL DEFAULT 0,width INTEGER NOT NULL,height INTEGER NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT,purpose TEXT NOT NULL DEFAULT 'content' CHECK(purpose IN ('content','shop')));
    INSERT INTO community_topics(id,board,author_kind,author_id,title,body,created_at,last_activity_at,pinned) VALUES('before','qa','owner','owner','原始置顶标题','原始正文','2026-01-01','2026-01-01',1);
    INSERT INTO community_images(id,uploader_kind,uploader_id,width,height,created_at,purpose) VALUES('legacy-shop','owner','owner',40,40,'2026-01-01','shop');
    CREATE TABLE retained_image_refs(id TEXT PRIMARY KEY,image TEXT REFERENCES community_images(id) ON DELETE CASCADE);
    INSERT INTO retained_image_refs VALUES('ref','legacy-shop');
    CREATE TABLE image_insert_events(id TEXT);
    CREATE INDEX extra_image_lookup ON community_images(uploader_id);
    CREATE TRIGGER retained_image_insert AFTER INSERT ON community_images BEGIN INSERT INTO image_insert_events(id) VALUES(new.id); END;`);
  db.close(); await migrateCommunity(directory);
  const store = createCommunityStore(directory);
  try {
    assert.equal(store.image('legacy-shop')?.purpose, 'shop');
    const upgraded = new DatabaseSync(resolve(directory, 'content.db'));
    assert.equal(upgraded.prepare('SELECT image FROM retained_image_refs WHERE id=?').get('ref')?.image, 'legacy-shop', 'table rebuilding does not cascade delete existing references');
    assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE name='extra_image_lookup'").get(), 'original indexes remain');
    assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM community_banner_entries WHERE scope=?').get('qa')?.n, 1);
    const image = randomUUID(); upgraded.prepare("INSERT INTO community_images(id,uploader_kind,uploader_id,width,height,created_at,purpose,banner_scope) VALUES(?,?,?,?,?,?,?,?)").run(image, 'owner', 'owner', 10, 10, '2026-01-01', 'banner', 'qa');
    assert.equal(upgraded.prepare('SELECT id FROM image_insert_events').get()?.id, image, 'original triggers remain');
    upgraded.close(); store.setPinned('before', false);
  } finally { store.close(); }
  assert.deepEqual(await migrateCommunity(directory), { changed: false });
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, 1);
  const check = new DatabaseSync(resolve(directory, 'content.db'));
  assert.equal(check.prepare('SELECT COUNT(*) AS n FROM community_banner_entries WHERE scope=?').get('home')?.n, 1); check.close();
});

test('separate store connections enforce the same version and persist the independent order after reopening', async t => {
  const { directory, store, topic, owner } = await setup(t); const one = topic(), two = topic();
  const another = createCommunityStore(directory);
  try {
    const access = { actor: owner, browsingAsReader: false, canSeeBoard: () => true };
    store.banners.replace('home', 0, [{ topicId: one, title: '', cover: null }], access);
    assert.throws(() => another.banners.replace('home', 0, [{ topicId: two, title: '', cover: null }], access), { status: 409 });
    assert.deepEqual(another.banners.get('home', () => true).items.map(item => item.topicId), [one]);
    assert.equal(another.banners.get('home', () => true).version, 1);
    assert.throws(() => another.banners.replace('tools', 0, [], { ...access, actor: { kind: 'reader', id: 'mod' } }), { status: 403 }, 'storage also enforces real appointments');
  } finally { another.close(); }
});

const imageSlide = (cover: string | null, title = '') => ({ kind: 'image' as const, topicId: null, title, cover });
async function bannerImage(fixture: Awaited<ReturnType<typeof setup>>, scope: string, as = 'owner') {
  const png = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#456789' } }).png().toBuffer();
  const response = await fixture.upload(scope, png, as);
  assert.equal(response.status, 201);
  return (await response.json() as { id: string }).id;
}

test('independent image banners use the existing upload/save routes without creating posts and mix with unchanged post DTOs', async t => {
  const f = await setup(t), cover = await bannerImage(f, 'home');
  const response = await f.post({ scope: 'home', version: 0, items: [imageSlide(cover)] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, [{ kind: 'image', topicId: null, title: '', cover, board: '', topicTitle: '', topicImage: null, image: cover }]);
  assert.equal(f.store.listTopics({}).total, 0, 'an independent picture never creates a placeholder post');
  const id = f.topic();
  assert.equal((await f.post({ scope: 'home', version: 1, items: [{ kind: 'post', topicId: id, title: '原帖子', cover: null }, imageSlide(cover, '  图标题  ')] })).status, 200);
  const saved = await (await f.get('banners?scope=home')).json();
  assert.deepEqual(saved.items.map((item: { topicId: string | null }) => item.topicId), [id, null]);
  assert.equal(Object.hasOwn(saved.items[0], 'kind'), false, 'the historical post response shape stays unchanged');
  assert.equal(saved.items[1].title, '图标题');
  assert.equal((await f.get(`images/${cover}.webp`)).status, 200);
});

test('image banners retain scoped authority, uploaded-image ownership and strict saved fields', async t => {
  const f = await setup(t), cover = await bannerImage(f, 'qa', 'mod'), ownerCover = await bannerImage(f, 'qa');
  const save = (scope: string, items: unknown[], as = 'mod', version = 0) => f.post({ scope, version, items }, as);
  assert.equal((await save('home', [imageSlide(cover)])).status, 403);
  assert.equal((await save('tools', [imageSlide(cover)])).status, 403);
  assert.equal((await save('qa', [imageSlide(cover)], 'reader')).status, 403);
  assert.equal((await save('qa', [imageSlide(cover)], 'mod; community_browse=reader')).status, 403);
  assert.equal((await save('qa', [imageSlide(ownerCover)])).status, 400, 'a new cover cannot be taken from another uploader');
  const unrelated = randomUUID();
  f.store.addImage({ id: unrelated, uploader: f.mod, width: 1, height: 1, purpose: 'shop' });
  for (const invalid of [imageSlide(null), imageSlide(randomUUID()), imageSlide('https://example.com/banner.webp'), imageSlide(unrelated),
    { ...imageSlide(cover), kind: 'unknown' }, { ...imageSlide(cover), topicId: f.topic() },
    { ...imageSlide(cover), kind: undefined }, { ...imageSlide(cover), title: '字'.repeat(81) }, { ...imageSlide(cover), title: 'bad\nheading' }]) {
    assert.equal((await save('qa', [invalid])).status, 400);
    assert.equal((await (await f.get('banners?scope=qa')).json()).version, 0);
  }
  assert.equal((await save('qa', [{ ...imageSlide(cover), board: 'tools', image: 'https://example.com/banner.webp' }])).status, 200);
  const saved = await (await f.get('banners?scope=qa')).json();
  assert.equal(saved.items[0].board, 'qa', 'the board is derived from authorized scope');
  assert.equal(saved.items[0].image, cover, 'caller URLs cannot enter the published DTO');
  assert.equal((await save('tools', [imageSlide(cover)], 'owner')).status, 400, 'a banner cover cannot cross scopes');
  assert.equal((await save('qa', [imageSlide(cover)], 'owner', 1)).status, 200, 'a new manager can retain a currently configured cover');
  f.store.members.setSteward(f.mod, false);
  assert.equal((await save('qa', [imageSlide(cover)], 'mod', 2)).status, 403);
});

test('five independent image rows preserve order and concurrent versions while six slides fail atomically', async t => {
  const f = await setup(t), cover = await bannerImage(f, 'home');
  const items = Array.from({ length: 5 }, (_, index) => imageSlide(cover, `独立图${index}`));
  assert.equal((await f.post({ scope: 'home', version: 0, items })).status, 200);
  assert.equal((await f.post({ scope: 'home', version: 1, items: [...items, imageSlide(cover)] })).status, 400);
  const concurrent = await Promise.all([
    f.post({ scope: 'home', version: 1, items: [items[2], items[0]] }),
    f.post({ scope: 'home', version: 1, items: [items[3], items[1]] }),
  ]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
  const saved = await (await f.get('banners?scope=home')).json();
  assert.equal(saved.version, 2); assert.equal(saved.items.length, 2);
  const another = createCommunityStore(f.directory);
  try { assert.deepEqual(another.banners.get('home', () => true), saved); } finally { another.close(); }
});

test('new board appointments take effect for independent uploads and saves without granting other scopes', async t => {
  const f = await setup(t), reader = { kind: 'reader' as const, id: 'reader' };
  const png = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#456789' } }).png().toBuffer();
  assert.equal((await f.upload('tools', png, 'reader')).status, 403);
  f.store.members.setSteward(reader, true, ['tools']);
  const cover = await bannerImage(f, 'tools', 'reader');
  assert.equal((await f.post({ scope: 'tools', version: 0, items: [imageSlide(cover)] }, 'reader')).status, 200);
  assert.equal((await f.post({ scope: 'home', version: 0, items: [imageSlide(cover)] }, 'reader')).status, 403);
  assert.equal((await f.upload('qa', png, 'reader')).status, 403);
  assert.equal((await f.post({ scope: 'tools', version: 1, items: [] }, 'reader; community_browse=reader')).status, 403);
  f.store.members.setSteward(reader, false);
  assert.equal((await f.post({ scope: 'tools', version: 1, items: [] }, 'reader')).status, 403);
});

test('independent pictures survive unrelated hidden posts while post covers and private boards keep their visibility rules', async t => {
  const f = await setup(t), independent = await bannerImage(f, 'qa', 'mod'), postCover = await bannerImage(f, 'qa', 'mod'), id = f.topic();
  assert.equal((await f.post({ scope: 'qa', version: 0, items: [imageSlide(independent), { topicId: id, title: '帖子标题', cover: postCover }] }, 'mod')).status, 200);
  f.store.hide({ kind: 'topic', id }, '隐藏');
  assert.deepEqual((await (await f.get('banners?scope=qa')).json()).items.map((item: { cover: string }) => item.cover), [independent]);
  assert.equal((await f.get(`images/${independent}.webp`)).status, 200);
  assert.equal((await f.get(`images/${postCover}.webp`)).status, 404);
  const vipCover = await bannerImage(f, 'vip');
  assert.equal((await f.post({ scope: 'vip', version: 0, items: [imageSlide(vipCover)] })).status, 200);
  assert.equal((await f.get('banners?scope=vip')).status, 404);
  assert.equal((await f.get(`images/${vipCover}.webp`)).status, 404);
  assert.equal((await f.get(`images/${vipCover}.webp`, 'vip')).status, 200);
  const db = new DatabaseSync(resolve(f.directory, 'content.db'));
  db.prepare("UPDATE community_images SET deleted_at='2026-10-07T00:00:00Z' WHERE id=?").run(independent); db.close();
  assert.deepEqual((await (await f.get('banners?scope=qa')).json()).items, []);
  assert.equal((await f.get(`images/${independent}.webp`)).status, 404);
});

test('account purge and stale-upload cleanup retain independently configured moderator pictures but remove unused ones', async t => {
  const f = await setup(t), cover = await bannerImage(f, 'qa', 'mod'), unused = await bannerImage(f, 'qa', 'mod');
  assert.equal((await f.post({ scope: 'qa', version: 0, items: [imageSlide(cover)] }, 'mod')).status, 200);
  const db = new DatabaseSync(resolve(f.directory, 'content.db'));
  db.prepare("UPDATE community_images SET created_at='2000-01-01T00:00:00Z' WHERE id=?").run(cover); db.close();
  assert.equal(f.store.sweepImages().includes(cover), false);
  const queued: string[] = [];
  f.store.purgeReaderData(f.mod.id, filename => queued.push(filename));
  assert.ok(f.store.image(cover), 'a NULL topic reference still protects a shared configured image');
  assert.equal(queued.includes(`community-image-${cover}.webp`), false);
  assert.equal(f.store.image(unused), null);
  assert.equal(queued.includes(`community-image-${unused}.webp`), true);
  assert.equal((await f.get(`images/${cover}.webp`)).status, 200);
  assert.equal((await (await f.get('banners?scope=qa')).json()).items[0].cover, cover);
});
