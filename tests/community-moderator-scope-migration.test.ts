import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { communityBoards } from '../src/community.mjs';

test('moderator scope migration retains legacy global assignments, member data and a recoverable backup', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-scopes-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec(`CREATE TABLE durable_fixture (content TEXT); INSERT INTO durable_fixture VALUES ('作者内容保留');
    CREATE TABLE community_members (member_kind TEXT NOT NULL, member_id TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 0,
    level_day TEXT, steward INTEGER NOT NULL DEFAULT 0, frame TEXT, name_color TEXT, cover TEXT, agreed_at TEXT,
    created_at TEXT NOT NULL, PRIMARY KEY(member_kind, member_id));
    INSERT INTO community_members (member_kind, member_id, level, steward, frame, created_at)
    VALUES ('reader', 'legacy', 2, 1, 'aurora', '2026-01-01');`);
  db.close();
  const migrated = await migrateCommunity(directory);
  assert.equal(migrated.changed, true);
  assert.ok(migrated.backup);
  const current = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    const row = current.prepare("SELECT steward, steward_boards, level, frame FROM community_members WHERE member_id='legacy'").get();
    assert.deepEqual({ ...row }, { steward: 1, steward_boards: null, level: 2, frame: 'aurora' });
    assert.deepEqual({ ...current.prepare('SELECT content FROM durable_fixture').get() }, { content: '作者内容保留' });
  } finally { current.close(); }
  const snapshot = new DatabaseSync(migrated.backup!, { readOnly: true });
  try { assert.equal((snapshot.prepare('PRAGMA table_info(community_members)').all() as Array<{ name: string }>).some(row => row.name === 'steward_boards'), false); }
  finally { snapshot.close(); }
  const store = createCommunityStore(directory);
  try { assert.deepEqual(store.members.moderationBoards({ kind: 'reader', id: 'legacy' }), communityBoards.map(board => board.id)); }
  finally { store.close(); }
  assert.deepEqual(await migrateCommunity(directory), { changed: false });
});
