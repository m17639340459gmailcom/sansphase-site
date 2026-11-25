import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { searchAdminReaders } from '../server/reader-admin-search.ts';

test('private reader search combines literal matching with UID, paging, state and VIP ordering', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-reader-search-'));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec('CREATE TABLE readers(id TEXT PRIMARY KEY,email TEXT,nickname TEXT,phone TEXT,admin_remark TEXT,created_at TEXT,vip_until TEXT,disabled INTEGER,_verified INTEGER)');
  const insert = db.prepare('INSERT INTO readers VALUES(?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 27; i++) insert.run(String(i), `reader${i}@example.test`, `读者${i}`, '13800138000', i === 26 ? '其他备注' : '共同%_备注',
    `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, i < 6 ? `2026-12-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` : i < 12 ? `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` : null, i === 25 ? 1 : 0, i === 24 ? 0 : 1);
  db.close();
  const options = { q: '%_', status: 'all' as const, membership: 'all' as const, page: 1, now: '2026-10-12T00:00:00.000Z', uidMatch: null };
  try {
    const first = searchAdminReaders(directory, options), second = searchAdminReaders(directory, { ...options, page: 2 });
    assert.equal(first.total, 25); assert.equal(first.totalPages, 2); assert.equal(first.ids.length, 20); assert.equal(second.ids.length, 5);
    assert.equal(new Set([...first.ids, ...second.ids]).size, 25); assert.equal(first.ids[0], '25'); assert(!first.ids.includes('26')); assert(!first.ids.includes('24'));
    assert.equal(searchAdminReaders(directory, { ...options, status: 'active' }).total, 24);
    assert.deepEqual(searchAdminReaders(directory, { ...options, status: 'disabled' }).ids, ['25']);
    assert.deepEqual(searchAdminReaders(directory, { ...options, membership: 'vip' }).ids, ['0', '1', '2', '3', '4', '5']);
    assert.deepEqual(searchAdminReaders(directory, { ...options, membership: 'expired' }).ids, ['11', '10', '9', '8', '7', '6']);
    assert.equal(searchAdminReaders(directory, { ...options, membership: 'vip', status: 'disabled' }).total, 0);
    assert.deepEqual(searchAdminReaders(directory, { ...options, q: 'UID 10026', uidMatch: '26' }).ids, ['26']);
    assert.deepEqual(searchAdminReaders(directory, { ...options, q: 'READER26@EXAMPLE.TEST' }).ids, ['26']);
    assert.equal(searchAdminReaders(directory, { ...options, q: "%' OR 1=1 --" }).total, 0);
    assert.equal(searchAdminReaders(directory, { ...options, page: 9 }).ids.length, 0);
  } finally {
    assert.equal(resolve(tmpdir(), basename(directory)), directory); assert.match(basename(directory), /^sansphase-reader-search-/);
    await rm(directory, { recursive: true, force: true });
  }
});
