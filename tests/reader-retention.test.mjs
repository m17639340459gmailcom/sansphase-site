import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readerCleanupDue, createReaderRetention } from '../server/reader-retention.mjs';
import { createLoginLedger } from '../server/login-ledger.mjs';

test('30-day cleanup uses the last successful login and protects active VIP membership', () => {
  const now = Date.parse('2026-10-31T12:00:00.000Z');
  const verified = { _verified: true, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-30T12:00:00.000Z' };
  assert.equal(readerCleanupDue(verified, null, now - 1), false);
  assert.equal(readerCleanupDue(verified, null, now), true);
  assert.equal(readerCleanupDue({ ...verified, updatedAt: '2026-10-31T11:00:00.000Z' }, null, now), true,
    'editing a profile does not reset the inactivity clock');
  assert.equal(readerCleanupDue(verified, '2026-10-30T12:00:00.000Z', now), false);
  assert.equal(readerCleanupDue({ ...verified, vip_until: '2026-11-01T00:00:00.000Z' }, null, now), false);
  assert.equal(readerCleanupDue({ ...verified, vip_until: '2026-10-31T12:00:00.000Z' }, null, now), true);
  const pending = { ...verified, _verified: false, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-30T12:00:00.000Z' };
  assert.equal(readerCleanupDue(pending, null, now), true, 'resending an email does not keep an unverified request forever');
  const recentPending = { ...pending, createdAt: '2026-10-31T11:55:00.000Z' };
  assert.equal(readerCleanupDue(recentPending, null, now - 1), false);
  assert.equal(readerCleanupDue(recentPending, null, now), true, 'legacy unverified accounts expire after five minutes');
});

test('inactive account lookup uses registration time, not later profile edits', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-ledger-retention-'));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    db.exec(`CREATE TABLE readers (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, _verified INTEGER, vip_until TEXT);
      CREATE TABLE login_events (id TEXT, happened_at TEXT, actor_type TEXT, actor_id TEXT, email TEXT, ip TEXT, peer_ip TEXT, source TEXT, user_agent TEXT);`);
    db.prepare('INSERT INTO readers VALUES (?,?,?,?,?)').run('reader-1', '2026-08-01T00:00:00.000Z', '2026-09-25T00:00:00.000Z', 1, null);
    const ledger = createLoginLedger(directory);
    try { assert.deepEqual(ledger.inactiveReaderIds('2026-08-31T00:00:00.000Z', '2026-09-26T00:00:00.000Z'), ['reader-1']); }
    finally { ledger.close(); }
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('a cleanup sweep handles more than one page without skipping accounts after deletion', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-retention-'));
  const rows = new Map(Array.from({ length: 120 }, () => {
    const id = randomUUID();
    return [id, { id, _verified: true, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }];
  }));
  const ledger = {
    inactiveReaderIds: (_cutoff, _now, limit, offset) => [...rows.keys()].slice(offset, offset + limit),
    latest: () => null,
  };
  const retention = createReaderRetention({
    payload: { findByID: async ({ id }) => rows.get(id) || null, delete: async ({ id }) => rows.delete(id) },
    directory,
    uidStore: { get: () => '123456' },
    loginLedger: ledger,
  });
  try {
    assert.equal((await retention.sweep({ now: '2026-09-01T00:00:00.000Z', dryRun: true })).eligible, 120);
    assert.equal((await retention.sweep({ now: '2026-09-01T00:00:00.000Z' })).deleted, 120);
    assert.equal(rows.size, 0);
  } finally {
    await retention.close();
    await rm(directory, { recursive: true, force: true });
  }
});
