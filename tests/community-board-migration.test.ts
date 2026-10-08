import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCommunityStore, communityTablesReady } from '../server/community-store.ts';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { defaultCommunityBoards } from '../src/community.ts';

test('upgrading only the board catalog backs up the old database and preserves every existing table and row', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-board-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  const store = createCommunityStore(directory);
  const owner = { kind: 'owner' as const, id: 'owner' }, moderator = { kind: 'reader' as const, id: 'moderator' };
  const topic = store.createTopic({ board: 'qa', author: moderator, title: '升级前的讨论内容', body: '这份隔离测试讨论和管理权限不能被板块升级改写。' });
  store.staff.appoint(owner, moderator, { role: 'moderator', boards: ['qa'], permissions: ['content.inspect'], delegable: [] });
  store.banners.replace('qa', 0, [{ topicId: topic.id, title: '已有横幅', cover: null }], { actor: owner, browsingAsReader: false, canSeeBoard: () => true });
  store.close();
  const old = new DatabaseSync(resolve(directory, 'content.db'));
  old.exec('DROP TABLE community_boards; DROP TABLE community_board_catalog;');
  const schema = old.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tables = old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
  const rows = tables.map(({ name }) => ({ name, rows: old.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() }));
  old.close();
  assert.equal(communityTablesReady(directory), false);
  const migrated = await migrateCommunity(directory);
  assert.equal(migrated.changed, true);
  assert.ok(migrated.backup);
  const snapshot = new DatabaseSync(migrated.backup!, { readOnly: true });
  try {
    assert.equal(snapshot.prepare("SELECT name FROM sqlite_master WHERE name='community_boards'").get(), undefined);
    assert.equal(snapshot.prepare('SELECT title FROM community_topics WHERE id=?').get(topic.id)?.title, '升级前的讨论内容');
  } finally { snapshot.close(); }
  const current = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try {
    assert.deepEqual(current.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND tbl_name NOT IN ('community_boards','community_board_catalog') ORDER BY type,name").all(), schema);
    for (const table of rows) assert.deepEqual(current.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}"`).all(), table.rows, `${table.name} is untouched`);
    assert.equal(current.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  } finally { current.close(); }
  const upgraded = createCommunityStore(directory);
  try {
    assert.deepEqual(upgraded.boards.catalog(), { version: 0, items: defaultCommunityBoards });
    assert.deepEqual(upgraded.members.moderationBoards(moderator), ['qa']);
    assert.equal(upgraded.banners.get('qa', () => true).items[0].title, '已有横幅');
  } finally { upgraded.close(); }
  const backups = (await readdir(resolve(directory, 'schema-backups'))).length;
  assert.deepEqual(await migrateCommunity(directory), { changed: false });
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, backups);
});
