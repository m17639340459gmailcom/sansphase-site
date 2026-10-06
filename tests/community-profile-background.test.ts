import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity, communitySchemaReady } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';

const reader = { kind: 'reader' as const, id: 'reader-a' };
const other = { kind: 'reader' as const, id: 'reader-b' };
const owner = { kind: 'owner' as const, id: 'owner' };
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-background-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  const store = createCommunityStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const add = (uploader = reader, purpose: 'profile' | 'content' = 'profile') => {
    const id = randomUUID();
    store.addImage({ id, uploader, width: 1200, height: 400, purpose, now: '2026-01-01T00:00:00.000Z' });
    return id;
  };
  return { directory, store, add };
}

test('custom backgrounds remain private until the owner approves and replacements keep the approved background', async t => {
  const { store, add } = await fixture(t), first = add(), replacement = add();
  assert.deepEqual(store.profileBackgrounds.state(reader), { approved: null, pending: null });
  store.profileBackgrounds.submit(reader, first);
  assert.equal(store.profileBackgrounds.state(reader).approved, null);
  assert.equal(store.profileBackgrounds.state(reader).pending?.id, first);
  assert.equal(store.profileBackgrounds.imageVisible(first, reader), true);
  assert.equal(store.profileBackgrounds.imageVisible(first, owner), true);
  assert.equal(store.profileBackgrounds.imageVisible(first, other), false);
  assert.throws(() => store.profileBackgrounds.review(reader, first, true, other, ''), { status: 403 });
  store.profileBackgrounds.review(reader, first, true, owner, '');
  assert.equal(store.profileBackgrounds.state(reader).approved?.id, first);
  assert.equal(store.profileBackgrounds.state(reader).pending, null);
  assert.equal(store.profileBackgrounds.imageVisible(first, other), true);
  store.profileBackgrounds.submit(reader, replacement);
  assert.equal(store.profileBackgrounds.state(reader).approved?.id, first);
  assert.equal(store.profileBackgrounds.state(reader).pending?.id, replacement);
  assert.equal(store.profileBackgrounds.imageVisible(replacement, other), false);
  assert.throws(() => store.profileBackgrounds.review(reader, replacement, false, owner, ''), { status: 400 });
  store.profileBackgrounds.review(reader, replacement, false, owner, '图片内容不适合公开展示');
  assert.equal(store.profileBackgrounds.state(reader).approved?.id, first);
  assert.equal(store.profileBackgrounds.state(reader).pending, null);
  assert.equal(store.profileBackgrounds.imageVisible(replacement, reader), false);
});

test('background submission cannot use another member upload, a post image or author brand identity', async t => {
  const { store, add } = await fixture(t);
  assert.throws(() => store.profileBackgrounds.submit(reader, add(other)), { status: 400 });
  assert.throws(() => store.profileBackgrounds.submit(reader, add(reader, 'content')), { status: 400 });
  assert.throws(() => store.profileBackgrounds.submit(owner, add()), { status: 403 });
  assert.throws(() => store.profileBackgrounds.remove(owner), { status: 403 });
  const image = add(); store.profileBackgrounds.submit(reader, image);
  assert.throws(() => store.createTopic({ board: 'qa', author: reader, title: '不能混用图片', body: '背景不应被挪用到帖子', images: [image] }), /图片已失效/);
});

test('stale approvals conflict instead of approving a replacement; reset removes both custom states without changing equipped covers', async t => {
  const { store, add } = await fixture(t), first = add(), next = add();
  store.profileBackgrounds.submit(reader, first);
  store.profileBackgrounds.submit(reader, next);
  assert.throws(() => store.profileBackgrounds.review(reader, first, true, owner, ''), { status: 409 });
  assert.equal(store.profileBackgrounds.state(reader).pending?.id, next);
  store.profileBackgrounds.review(reader, next, true, owner, '');
  store.members.equip(reader, 'cover', 'aurora');
  store.profileBackgrounds.submit(reader, first);
  store.profileBackgrounds.remove(reader);
  assert.deepEqual(store.profileBackgrounds.state(reader), { approved: null, pending: null });
  assert.equal(store.members.decorations(reader).cover, 'aurora');
});

test('approved and pending backgrounds survive upload retention; withdrawn images are reclaimed and account purge is idempotent', async t => {
  const { store, add } = await fixture(t), approved = add(), pending = add(), unused = add();
  store.profileBackgrounds.submit(reader, approved);
  store.profileBackgrounds.review(reader, approved, true, owner, '');
  store.profileBackgrounds.submit(reader, pending);
  const retained = add(other); store.profileBackgrounds.submit(other, retained);
  assert.deepEqual(store.sweepImages(Date.now()), [unused]);
  const queued: string[] = [];
  const result = store.purgeReaderData(reader.id, filename => queued.push(filename));
  assert.equal(result.images, 2);
  assert.deepEqual(queued.sort(), [approved, pending].flatMap(id => [`community-image-${id}.webp`, `community-thumb-${id}.webp`]).sort());
  assert.deepEqual(store.profileBackgrounds.state(reader), { approved: null, pending: null });
  assert.equal(store.profileBackgrounds.state(other).pending?.id, retained);
  assert.equal(store.purgeReaderData(reader.id, filename => queued.push(filename)).images, 0);
});

test('background review stores reviewer, decision and reason without awarding stars, experience or inventory', async t => {
  const { directory, store, add } = await fixture(t), image = add();
  store.profileBackgrounds.submit(reader, image);
  store.profileBackgrounds.review(reader, image, false, owner, '不适合展示');
  const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try {
    const review = db.prepare('SELECT approved,reason,by_kind,by_id FROM community_profile_background_reviews').get();
    assert.deepEqual({ ...review }, { approved: 0, reason: '不适合展示', by_kind: 'owner', by_id: 'owner' });
    for (const table of ['community_experience_ledger', 'community_ledger', 'community_owned'])
      assert.equal(Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n), 0);
  } finally { db.close(); }
});

for (const legacy of ["'content','shop'", "'content','shop','banner'"]) test(`profile image migration widens legacy ${legacy} checks once and preserves indexes, triggers and existing references`, async t => {
  const { directory, store } = await fixture(t), image = randomUUID();
  store.addImage({ id: image, uploader: owner, width: 100, height: 100, purpose: 'shop' });
  const item = store.economy.saveItem(null, { cat: 'digital', name: '保留素材', description: '保留正式数据和图片引用', price: 10, stock: null, limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '正式内容', image, note: '', active: true });
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    const source = String(db.prepare("SELECT sql FROM sqlite_master WHERE name='community_images'").get()?.sql);
    const old = source.replace('CREATE TABLE community_images', 'CREATE TABLE legacy_images').replace(/CHECK\s*\(purpose IN \([^)]*\)\)/i, `CHECK(purpose IN (${legacy}))`);
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec(`${old}; INSERT INTO legacy_images SELECT * FROM community_images; DROP TABLE community_images; ALTER TABLE legacy_images RENAME TO community_images;
      CREATE INDEX profile_legacy_image_idx ON community_images(purpose);
      CREATE TABLE profile_trigger_receipts(id TEXT);
      CREATE TRIGGER profile_legacy_image_trigger AFTER UPDATE OF width ON community_images BEGIN INSERT INTO profile_trigger_receipts VALUES(NEW.id); END;`);
    assert.equal(communitySchemaReady(db), false);
  } finally { db.close(); }
  const before = (await readdir(resolve(directory, 'schema-backups'))).length;
  assert.equal((await migrateCommunity(directory)).changed, true);
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, before + 1);
  assert.equal((await migrateCommunity(directory)).changed, false);
  const migrated = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    assert.equal(communitySchemaReady(migrated), true);
    assert.equal(migrated.prepare('SELECT image FROM community_shop_items WHERE id=?').get(item)?.image, image);
    assert.equal(migrated.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='index' AND name='profile_legacy_image_idx'").get()?.ok, 1);
    migrated.prepare('UPDATE community_images SET width=101 WHERE id=?').run(image);
    assert.equal(migrated.prepare('SELECT id FROM profile_trigger_receipts').get()?.id, image);
    assert.equal(migrated.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { migrated.close(); }
});
