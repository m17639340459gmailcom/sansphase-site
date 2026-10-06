import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity, communitySchemaReady } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';

test('cover equipment upgrade retains prior products, ownership, orders, custom indexes and triggers and is idempotent', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-cover-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  new DatabaseSync(resolve(directory, 'content.db')).close(); await migrateCommunity(directory);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  const source = String(db.prepare("SELECT sql FROM sqlite_master WHERE name='community_shop_items'").get()?.sql);
  const legacy = source.replace(/CREATE TABLE\s+["`\[]?community_shop_items["`\]]?/i, 'CREATE TABLE old_shop_items')
    .replace(/CHECK\s*\(\s*kind\s+IN\s*\([^)]*\)\s*\)/i, "CHECK(kind IN ('frame','color'))");
  db.exec(`PRAGMA foreign_keys=OFF; ${legacy}; INSERT INTO old_shop_items SELECT * FROM community_shop_items;
    DROP TABLE community_shop_items; ALTER TABLE old_shop_items RENAME TO community_shop_items;
    CREATE INDEX cover_legacy_item_idx ON community_shop_items(name);
    CREATE TABLE cover_trigger_receipts(item TEXT);
    CREATE TRIGGER cover_legacy_item_trigger AFTER UPDATE OF name ON community_shop_items BEGIN INSERT INTO cover_trigger_receipts VALUES(NEW.id); END;`);
  db.prepare('INSERT INTO community_shop_items(id,cat,name,description,price,stock,stock_left,created_at,updated_at,kind,image) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('legacy-frame', 'digital', '正式星环', '已兑换的正式头像框', 30, 12, 10, '2026-10-01', '2026-10-01', 'frame', '11111111-1111-4111-8111-111111111111');
  db.prepare('INSERT INTO community_owned(member_kind,member_id,item,created_at) VALUES(?,?,?,?)').run('reader', 'existing-reader', 'legacy-frame', '2026-10-01');
  db.prepare('INSERT INTO community_orders(id,member_kind,member_id,item,item_name,price,status,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('old-order', 'reader', 'existing-reader', 'legacy-frame', '正式星环', 30, 'done', '2026-10-01');
  assert.equal(communitySchemaReady(db), false);
  db.close();
  const count = (await readdir(resolve(directory, 'schema-backups'))).length;
  const migration = await migrateCommunity(directory); assert.equal(migration.changed, true);
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, count + 1);
  assert.equal((await migrateCommunity(directory)).changed, false);
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, count + 1);
  const migrated = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    assert.equal(communitySchemaReady(migrated), true);
    const old = migrated.prepare('SELECT kind,image,stock,stock_left FROM community_shop_items WHERE id=?').get('legacy-frame');
    assert.deepEqual({ ...old }, { kind: 'frame', image: '11111111-1111-4111-8111-111111111111', stock: 12, stock_left: 10 });
    assert.equal(migrated.prepare('SELECT item FROM community_owned').get()?.item, 'legacy-frame');
    assert.equal(migrated.prepare('SELECT status FROM community_orders WHERE id=?').get('old-order')?.status, 'done');
    assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE name='cover_legacy_item_idx'").get());
    migrated.prepare('UPDATE community_shop_items SET name=? WHERE id=?').run('新的文字名称', 'legacy-frame');
    assert.equal(migrated.prepare('SELECT item FROM cover_trigger_receipts').get()?.item, 'legacy-frame');
    assert.equal(migrated.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { migrated.close(); }
  const snapshot = new DatabaseSync(migration.backup!, { readOnly: true });
  try {
    assert.match(String(snapshot.prepare("SELECT sql FROM sqlite_master WHERE name='community_shop_items'").get()?.sql), /kind IN \('frame','color'\)/);
    assert.equal(snapshot.prepare('SELECT item FROM community_owned').get()?.item, 'legacy-frame');
  } finally { snapshot.close(); }
  const store = createCommunityStore(directory);
  try {
    const id = store.economy.saveItem(null, { cat: 'look', kind: 'cover', name: '晨曦背景', description: '新的正式主页背景', price: 20, stock: null, limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '', note: '', active: true, image: '22222222-2222-4222-8222-222222222222' });
    assert.equal(store.economy.item(id)?.kind, 'cover');
    assert.equal(store.economy.item('legacy-frame')?.kind, 'frame');
  } finally { store.close(); }
});
