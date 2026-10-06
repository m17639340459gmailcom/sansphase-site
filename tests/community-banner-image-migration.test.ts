import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity, communitySchemaReady } from '../server/payload/community-migration.ts';

async function legacy(t: TestContext, brokenReference = false) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-banner-images-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  new DatabaseSync(resolve(directory, 'content.db')).close(); await migrateCommunity(directory);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec(`PRAGMA foreign_keys=OFF; DROP TABLE community_banner_entries;
    CREATE TABLE community_banner_entries(scope TEXT NOT NULL,position INTEGER NOT NULL CHECK(position>=0 AND position<5),topic_id TEXT NOT NULL,topic_board TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',cover TEXT,PRIMARY KEY(scope,position),UNIQUE(scope,topic_id));
    CREATE INDEX community_banner_cover_idx ON community_banner_entries(cover);
    CREATE INDEX legacy_banner_title_idx ON community_banner_entries(title);
    CREATE TABLE legacy_banner_receipts(title TEXT);
    CREATE TRIGGER legacy_banner_title AFTER UPDATE OF title ON community_banner_entries BEGIN INSERT INTO legacy_banner_receipts VALUES(NEW.title); END;
    INSERT INTO community_banner_entries VALUES('home',0,'existing-post','qa','已上线推荐','old-cover');
    UPDATE community_banners SET version=9 WHERE scope='home';
    CREATE TABLE legacy_banner_reference(id TEXT PRIMARY KEY,scope TEXT,position INTEGER,FOREIGN KEY(scope,position) REFERENCES community_banner_entries(scope,position) ON DELETE CASCADE);`);
  db.prepare('INSERT INTO legacy_banner_reference VALUES(?,?,?)').run('reference', 'home', brokenReference ? 4 : 0);
  const rows = db.prepare('SELECT * FROM community_banner_entries').all();
  const objects = db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='community_banner_entries' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name").all();
  db.close();
  return { directory, rows, objects };
}

test('nullable banner migration preserves existing rows, version, indexes, triggers, references and one backup, then is idempotent', async t => {
  const f = await legacy(t);
  const before = new DatabaseSync(resolve(f.directory, 'content.db')); assert.equal(communitySchemaReady(before), false); before.close();
  const count = (await readdir(resolve(f.directory, 'schema-backups'))).length;
  const migrated = await migrateCommunity(f.directory); assert.equal(migrated.changed, true);
  assert.equal((await readdir(resolve(f.directory, 'schema-backups'))).length, count + 1);
  assert.deepEqual(await migrateCommunity(f.directory), { changed: false });
  assert.equal((await readdir(resolve(f.directory, 'schema-backups'))).length, count + 1);
  const db = new DatabaseSync(resolve(f.directory, 'content.db'));
  try {
    assert.equal(communitySchemaReady(db), true);
    assert.equal(db.prepare('PRAGMA table_info(community_banner_entries)').all().find(column => column.name === 'topic_id')?.notnull, 0);
    assert.deepEqual(db.prepare('SELECT * FROM community_banner_entries').all(), f.rows);
    assert.equal(db.prepare("SELECT version FROM community_banners WHERE scope='home'").get()?.version, 9);
    assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='community_banner_entries' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name").all(), f.objects);
    assert.equal(db.prepare('SELECT position FROM legacy_banner_reference').get()?.position, 0);
    db.exec("UPDATE community_banner_entries SET title='新的标题' WHERE scope='home' AND position=0");
    assert.equal(db.prepare('SELECT title FROM legacy_banner_receipts').get()?.title, '新的标题');
    db.exec("INSERT INTO community_banner_entries VALUES('home',1,NULL,'','独立图一','cover-one'),('home',2,NULL,'','独立图二','cover-two')");
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_banner_entries WHERE topic_id IS NULL').get()?.n, 2);
    assert.throws(() => db.exec("INSERT INTO community_banner_entries VALUES('home',3,'existing-post','qa','重复帖子',NULL)"), /UNIQUE/);
    assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
  const backup = new DatabaseSync(migrated.backup!, { readOnly: true });
  try { assert.equal(backup.prepare('PRAGMA table_info(community_banner_entries)').all().find(column => column.name === 'topic_id')?.notnull, 1); assert.deepEqual(backup.prepare('SELECT * FROM community_banner_entries').all(), f.rows); }
  finally { backup.close(); }
});

test('banner migration rolls back the rebuilt table and old data when foreign-key validation fails', async t => {
  const f = await legacy(t, true);
  await assert.rejects(migrateCommunity(f.directory), /invalid foreign-key references/);
  const db = new DatabaseSync(resolve(f.directory, 'content.db'));
  try {
    assert.equal(db.prepare('PRAGMA table_info(community_banner_entries)').all().find(column => column.name === 'topic_id')?.notnull, 1);
    assert.deepEqual(db.prepare('SELECT * FROM community_banner_entries').all(), f.rows);
    assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='community_banner_entries' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name").all(), f.objects);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'community_banner_entries%upgrade'").get()?.n, 0);
  } finally { db.close(); }
});
