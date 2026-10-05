import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';

test('shop grouping and equipment migration preserves legacy products and its pre-migration backup', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-shop-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec(`CREATE TABLE community_shop_items (
    id TEXT PRIMARY KEY, cat TEXT NOT NULL CHECK(cat IN ('digital','goods')),
    name TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL,
    stock INTEGER, stock_left INTEGER, limit_per TEXT CHECK(limit_per IN ('month','year','once')),
    limit_n INTEGER, min_level INTEGER NOT NULL DEFAULT 0, min_days INTEGER NOT NULL DEFAULT 0,
    delivery TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, image TEXT
  );`);
  db.prepare('INSERT INTO community_shop_items (id,cat,name,description,price,stock,stock_left,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('legacy-goods', 'goods', '旧版周边', '旧版上架的限量物品', 300, 10, 7, '2026-10-01', '2026-10-01');
  db.close();
  const migration = await migrateCommunity(directory);
  assert.equal(migration.changed, true);
  const store = createCommunityStore(directory);
  try {
    const old = store.economy.item('legacy-goods');
    assert.equal(old.cat, 'goods'); assert.equal(old.kind, 'goods');
    assert.equal(old.stock, 10); assert.equal(old.left, 7); assert.equal(old.category, null);
    assert.equal(store.economy.categories().length, 0);
  } finally { store.close(); }
  const snapshot = new DatabaseSync(migration.backup, { readOnly: true });
  try {
    assert.equal(snapshot.prepare('SELECT stock_left FROM community_shop_items WHERE id = ?').get('legacy-goods').stock_left, 7);
    assert.equal(snapshot.prepare("SELECT 1 FROM sqlite_master WHERE name = 'community_shop_categories'").get(), undefined);
    assert.equal(snapshot.prepare('PRAGMA table_info(community_shop_items)').all().some(row => row.name === 'kind'), false);
  } finally { snapshot.close(); }
});
