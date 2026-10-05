import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readerCleanupDue, createReaderRetention } from '../server/reader-retention.ts';
import { createLoginLedger } from '../server/login-ledger.ts';
import { loginEventsSchema } from '../server/payload/reader-migration.ts';

// Atomic account cleanup uses the same schema/FK boundary in unit fixtures;
// actual Payload and concurrent writers are covered in the race regressions.
function accountFixture(directory, rows) {
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec(`CREATE TABLE readers (id TEXT PRIMARY KEY,created_at TEXT,_verified INTEGER,vip_until TEXT,avatar TEXT);
    CREATE TABLE readers_sessions (_parent_id TEXT REFERENCES readers(id) ON DELETE CASCADE);
    CREATE TABLE payload_locked_documents_rels (readers_id TEXT REFERENCES readers(id) ON DELETE CASCADE);
    CREATE TABLE payload_preferences (id TEXT PRIMARY KEY,key TEXT);
    CREATE TABLE payload_preferences_rels (parent_id TEXT,path TEXT,readers_id TEXT REFERENCES readers(id) ON DELETE CASCADE);`);
  db.exec(loginEventsSchema);
  for (const row of rows.values()) db.prepare('INSERT INTO readers VALUES (?,?,1,NULL,NULL)').run(row.id, row.createdAt);
  return { db, payload: {
    findByID: async ({ id }) => db.prepare('SELECT id,created_at AS createdAt,_verified,vip_until,avatar FROM readers WHERE id=?').get(id) ? rows.get(id) : null,
    delete: async ({ id }) => db.prepare('DELETE FROM readers WHERE id=?').run(id),
  }, ledger: { inactiveReaderIds: (_cutoff, _now, limit, offset) => db.prepare('SELECT id FROM readers ORDER BY id LIMIT ? OFFSET ?').all(limit, offset).map(row => row.id), latest: () => null } };
}

test('six-month cleanup uses the last successful login and protects active VIP membership', () => {
  const now = Date.parse('2026-10-31T12:00:00.000Z');
  const verified = { _verified: true, createdAt: '2026-04-30T12:00:00.000Z', updatedAt: '2026-10-30T12:00:00.000Z' };
  const due = Date.parse('2026-10-30T12:00:00.000Z');
  assert.equal(readerCleanupDue(verified, null, due - 1), false);
  assert.equal(readerCleanupDue(verified, null, due), true);
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

test('six calendar months clamp month ends in Beijing time, including leap years', () => {
  for (const [anchor, deadline] of [
    ['2025-08-30T16:00:00.000Z', '2026-02-27T16:00:00.000Z'],
    ['2023-08-30T16:00:00.000Z', '2024-02-28T16:00:00.000Z'],
    ['2026-03-31T02:00:00.000Z', '2026-09-30T02:00:00.000Z'],
  ]) {
    const row = { id: 'reader', _verified: true, createdAt: anchor };
    assert.equal(readerCleanupDue(row, null, Date.parse(deadline) - 1), false);
    assert.equal(readerCleanupDue(row, null, deadline), true);
  }
});

test('inactive account lookup uses registration time, not later profile edits', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-ledger-retention-'));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    db.exec('CREATE TABLE readers (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, _verified INTEGER, vip_until TEXT);');
    db.exec(loginEventsSchema);
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
  const fixture = accountFixture(directory, rows);
  const retention = createReaderRetention({
    payload: fixture.payload,
    directory,
    uidStore: { get: () => '123456' },
    loginLedger: fixture.ledger,
  });
  try {
    assert.equal((await retention.sweep({ now: '2027-02-01T00:00:00.000Z', dryRun: true })).eligible, 120);
    assert.equal((await retention.sweep({ now: '2027-02-01T00:00:00.000Z' })).deleted, 120);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM readers').get().n, 0);
  } finally {
    await retention.close();
    fixture.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('content and stardust do not exempt inactive accounts; dry runs do not delete data', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-retention-keep-'));
  const rows = new Map(['quiet', 'poster'].map(id => [id, { id, _verified: true, createdAt: '2026-08-01T00:00:00.000Z' }]));
  const fixture = accountFixture(directory, rows);
  const retention = createReaderRetention({
    payload: fixture.payload,
    directory,
    uidStore: { get: () => '123456' },
    loginLedger: fixture.ledger,
  });
  try {
    assert.equal((await retention.sweep({ now: '2027-02-01T00:00:00.000Z', dryRun: true })).eligible, 2);
    assert.equal(rows.size, 2);
    const result = await retention.sweep({ now: '2027-02-01T00:00:00.000Z' });
    assert.deepEqual(result, { checked: 2, eligible: 2, deleted: 2, kept: 0 });
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM readers').get().n, 0);
  } finally {
    await retention.close();
    fixture.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('month-end candidate lookup includes dates clamped to the shorter destination month', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-retention-month-end-'));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec('CREATE TABLE readers (id TEXT PRIMARY KEY, created_at TEXT, vip_until TEXT);');
  db.exec(loginEventsSchema);
  db.prepare('INSERT INTO readers VALUES (?,?,NULL)').run('end', '2025-08-30T16:00:00.000Z');
  const ledger = createLoginLedger(directory);
  const retention = createReaderRetention({ directory, loginLedger: ledger, uidStore: { get: () => '123456' },
    payload: { findByID: async () => ({ id: 'end', _verified: true, createdAt: '2025-08-30T16:00:00.000Z' }), delete: async () => {} } });
  try {
    assert.equal((await retention.sweep({ now: '2026-02-27T15:59:59.999Z', dryRun: true })).eligible, 0);
    assert.equal((await retention.sweep({ now: '2026-02-27T16:00:00.000Z', dryRun: true })).eligible, 1);
  } finally { await retention.close(); ledger.close(); db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('candidate cutoff does not miss late-day registrations when the current month is longer', async () => {
  const { readerInactiveCutoff } = await import('../server/reader-retention-policy.ts');
  const now = new Date('2026-08-31T04:00:00.000Z');
  const anchor = '2026-02-28T10:00:00.000Z';
  assert.equal(readerCleanupDue({ id: 'reader', _verified: true, createdAt: anchor }, null, now), true);
  assert.ok(anchor <= readerInactiveCutoff(now));
});
