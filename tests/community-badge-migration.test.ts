import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';

test('upgrading existing badge and check-in tables preserves legacy honors and snapshots real top-ten ranks exactly once', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-old-badge-migration-'));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec(`CREATE TABLE community_checkins(member_kind TEXT NOT NULL,member_id TEXT NOT NULL,day TEXT NOT NULL,
    streak INTEGER NOT NULL,reward INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(member_kind,member_id,day));
    CREATE TABLE community_badges(member_kind TEXT NOT NULL,member_id TEXT NOT NULL,badge TEXT NOT NULL,created_at TEXT NOT NULL,
    PRIMARY KEY(member_kind,member_id,badge));`);
  const insert = db.prepare('INSERT INTO community_checkins VALUES(?,?,?,?,?,?)');
  for (let i = 0; i < 11; i++) insert.run('reader', `old-${i}`, '2025-10-01', 1, 1, `2025-10-01T00:00:${String(i).padStart(2, '0')}.000Z`);
  insert.run('reader', 'makeup', '2025-10-01', 1, 0, '2025-10-02T00:00:00.000Z');
  db.prepare('INSERT INTO community_badges VALUES(?,?,?,?)').run('reader', 'old-0', 'streak365', '2025-10-01T00:00:00.000Z');
  db.close();
  const first = await migrateCommunity(directory), second = await migrateCommunity(directory);
  assert.equal(first.changed, true);
  assert.deepEqual(second, { changed: false });
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, 1);
  const store = createCommunityStore(directory), sql = new DatabaseSync(resolve(directory, 'content.db'));
  t.after(async () => { store.close(); sql.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const reader = (id: string) => ({ kind: 'reader' as const, id });
  assert.deepEqual(store.members.badges(reader('old-0')), ['streak365']);
  assert.equal(store.members.badgeMetrics(reader('old-0')).early.days, 1);
  assert.equal(store.members.badgeMetrics(reader('old-10')).early.days, 0);
  assert.equal(store.members.badgeMetrics(reader('makeup')).early.days, 0);
  assert.equal(sql.prepare("SELECT count FROM community_badge_checkin_ranks WHERE day='2025-10-01'").get()?.count, 11);
  assert.equal(store.members.badgeState(reader('old-0')).families[0].tier, 'gold', 'an old streak365 is never evidence of a new aurora');
});
