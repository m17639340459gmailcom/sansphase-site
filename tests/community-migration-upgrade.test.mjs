import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateCommunity, communityTables } from "../server/payload/community-migration.ts";
import { communityTablesReady, createCommunityStore } from "../server/community-store.ts";

// Its own file (its own process): see community-migration.test.mjs.
test("a database with the first community tables is upgraded in place, keeping its posts", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "sansphase-community-upgrade-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const db = new DatabaseSync(resolve(directory, "content.db"));
  db.exec(`CREATE TABLE community_topics (id TEXT PRIMARY KEY, board TEXT NOT NULL, author_kind TEXT NOT NULL, author_id TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, reply_count INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0, deleted_at TEXT);
    CREATE TABLE community_replies (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, author_kind TEXT NOT NULL, author_id TEXT NOT NULL,
    body TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE community_images (id TEXT PRIMARY KEY, uploader_kind TEXT NOT NULL, uploader_id TEXT NOT NULL, topic_id TEXT,
    position INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT);
    INSERT INTO community_topics (id, board, author_kind, author_id, title, body, created_at, last_activity_at)
    VALUES ('old', 'qa', 'reader', 'r1', '旧帖子标题', '旧帖子正文内容', '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z');
    INSERT INTO community_images (id, uploader_kind, uploader_id, topic_id, width, height, created_at)
    VALUES ('old-image', 'reader', 'r1', 'old', 1200, 800, '2026-09-29T00:00:00Z');`);
  db.close();
  assert.equal(communityTablesReady(directory), false, "missing tables and columns are not ready");
  const result = await migrateCommunity(directory);
  assert.equal(result.changed, true);
  assert.equal((await readdir(resolve(directory, "schema-backups"))).length, 1, "a snapshot first");
  assert.equal(communityTablesReady(directory), true);
  const migrated = new DatabaseSync(resolve(directory, "content.db"), { readOnly: true });
  const present = new Set(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const orderColumns = new Set(migrated.prepare("PRAGMA table_info(community_orders)").all().map((row) => row.name));
  migrated.close();
  assert.deepEqual(communityTables.filter((name) => !present.has(name)), [], "every community table exists");
  assert.ok(["community_ledger", "community_members", "community_notifications", "community_orders", "community_requests", "community_rate_events"].every((name) => communityTables.includes(name)));
  assert.deepEqual(["shipping_company", "tracking_number"].filter((name) => !orderColumns.has(name)), [], "shipping metadata is added in-place");
  const store = createCommunityStore(directory);
  try {
    const topic = store.topic("old");
    assert.equal(topic.title, "旧帖子标题");
    assert.deepEqual([topic.tags, topic.edited, topic.solved, topic.locked, topic.pending, topic.hidden, topic.bounty], [[], false, false, false, false, false, 0]);
    assert.deepEqual(topic.images.map(image => ({ ...image })), [{ id: 'old-image', width: 1200, height: 800 }]);
    assert.equal(store.image('old-image').reply_id, null, 'old topic pictures remain topic pictures after adding reply attachments');
    assert.deepEqual(store.listTopics({ sort: "active", page: 1, pageSize: 20 }).items.map((x) => x.id), ["old"], "old posts stay listed");
  } finally { store.close(); }
});
