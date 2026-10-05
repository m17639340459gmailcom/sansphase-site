import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { getPayload } from 'payload';
import { makePayloadConfig } from '../server/payload/config.ts';
import { loginEventsSchema } from '../server/payload/reader-migration.ts';
import { createLoginLedger } from '../server/login-ledger.ts';
import { createReaderRetention } from '../server/reader-retention.ts';
import { createReaderWorkflow } from '../server/reader-workflow.ts';

let directory, payload, ledger, database;
const at = new Date('2027-02-01T00:00:00.000Z'), old = '2026-01-01T00:00:00.000Z', fresh = '2027-01-31T00:00:00.000Z';
test.before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'reader-retention-race-'));
  payload = await getPayload({ config: makePayloadConfig({ directory, secret: randomBytes(48).toString('hex'), push: true,
    emailAdapter: () => ({ name: 'test', defaultFromAddress: 'test@example.test', defaultFromName: 'Test', sendEmail: async () => {} }) }) });
  database = new DatabaseSync(resolve(directory, 'content.db')); database.exec(loginEventsSchema); ledger = createLoginLedger(directory);
});
test.after(async () => {
  ledger?.close(); database?.close(); await payload?.destroy(); await payload?.db.client.close();
  // Match the existing author integration fixture: libSQL may retain its
  // Windows schema-inspection handle until this test process exits. This is
  // only a freshly created tmpdir fixture, never the private application store.
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }).catch(error => {
    if (process.platform !== 'win32' || error.code !== 'EBUSY') throw error;
  });
});
async function reader(slug) {
  const row = await payload.create({ collection: 'readers', data: { email: `${slug}@example.test`, nickname: '回归读者', password: 'test-password-123', phone: '13800138000' } });
  database.prepare('UPDATE readers SET created_at=?,updated_at=?,_verified=1 WHERE id=?').run(old, old, row.id);
  return payload.findByID({ collection: 'readers', id: row.id });
}
const serviceWith = options => ({ config: payload.config, find: args => payload.find(args), findByID: args => payload.findByID(args), delete: args => payload.delete(args), ...options });
const retention = (service = serviceWith()) => createReaderRetention({ payload: service, directory, loginLedger: ledger, uidStore: { get: () => '123456' } });
const updateAfterCandidate = (id, update) => {
  let seen = false;
  return serviceWith({ findByID: async args => {
    const row = await payload.findByID(args);
    if (!seen && args.id === id) { seen = true; await update(); }
    return row;
  } });
};

test('automatic cleanup leaves implicit Payload transactions disabled', async () => {
  assert.equal(await payload.db.beginTransaction(), null);
  const row = await reader('ordinary-payload');
  await payload.update({ collection: 'readers', id: row.id, data: { signature: '正常操作' } });
  assert.equal((await payload.findByID({ collection: 'readers', id: row.id })).signature, '正常操作');
  await payload.delete({ collection: 'readers', id: row.id });
});
test('a successful login after candidate selection preserves the account', async () => {
  const row = await reader('login-wins');
  const cleanup = retention(updateAfterCandidate(row.id, () => {
    database.prepare('INSERT INTO login_events VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), fresh, 'reader', row.id, row.email, '192.0.2.1', '', 'direct', 'test');
  }));
  try { assert.equal((await cleanup.sweep({ now: at })).deleted, 0); assert.equal((await payload.findByID({ collection: 'readers', id: row.id })).id, row.id); }
  finally { await cleanup.close(); }
});
test('a VIP renewal after candidate selection preserves the account', async () => {
  const row = await reader('vip-wins');
  const cleanup = retention(updateAfterCandidate(row.id, () => payload.update({ collection: 'readers', id: row.id, data: { vip_until: '2027-03-01T00:00:00.000Z' } })));
  try { assert.equal((await cleanup.sweep({ now: at })).deleted, 0); assert.equal((await payload.findByID({ collection: 'readers', id: row.id })).vip_until, '2027-03-01T00:00:00.000Z'); }
  finally { await cleanup.close(); }
});
test('a concurrent writer renewal is rechecked after acquiring the cleanup writer lock', async () => {
  const row = await reader('writer-renewal');
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(workerData.file); db.exec('BEGIN IMMEDIATE'); parentPort.postMessage('locked');
    setTimeout(() => { db.prepare('UPDATE readers SET vip_until=? WHERE id=?').run('2027-03-01T00:00:00.000Z', workerData.id); db.exec('COMMIT'); db.close(); }, 150);
  `, { eval: true, workerData: { file: resolve(directory, 'content.db'), id: row.id } });
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  const exited = new Promise((resolve, reject) => { worker.once('exit', code => code ? reject(Error(`worker ${code}`)) : resolve()); worker.once('error', reject); });
  const cleanup = retention();
  try { assert.equal((await cleanup.sweep({ now: at })).deleted, 0); assert.equal((await payload.findByID({ collection: 'readers', id: row.id })).vip_until, '2027-03-01T00:00:00.000Z'); }
  finally { await exited; await cleanup.close(); }
});
test('the final eligibility read and delete exclude a competing writer with one lock', async () => {
  const row = await reader('writer-excluded'), avatar = randomUUID();
  database.prepare('UPDATE readers SET avatar=? WHERE id=?').run(avatar, row.id);
  const signal = new Int32Array(new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT));
  const worker = new Worker(`
    const { workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const signal = new Int32Array(workerData.signal), db = new DatabaseSync(workerData.file);
    db.exec('PRAGMA busy_timeout=30'); Atomics.wait(signal,0,0);
    try { db.prepare('UPDATE readers SET vip_until=? WHERE id=?').run('2027-03-01T00:00:00.000Z',workerData.id); Atomics.store(signal,2,1); }
    catch (error) { if (!/locked|busy/i.test(error.message)) Atomics.store(signal,2,2); }
    finally { db.close(); Atomics.store(signal,1,1); Atomics.notify(signal,1); }
  `, { eval: true, workerData: { file: resolve(directory, 'content.db'), id: row.id, signal: signal.buffer } });
  const exited = new Promise((resolve, reject) => { worker.once('exit', code => code ? reject(Error(`worker ${code}`)) : resolve()); worker.once('error', reject); });
  const workflow = createReaderWorkflow(directory, payload.config.secret), queueFile = workflow.queueFile;
  let checkpoint = false;
  workflow.queueFile = (...args) => {
    queueFile(...args);
    if (!checkpoint) {
      checkpoint = true; Atomics.store(signal,0,1); Atomics.notify(signal,0);
      assert.notEqual(Atomics.wait(signal,1,0,3000), 'timed-out');
      assert.equal(Atomics.load(signal,2), 0, 'a different connection cannot write between final eligibility and delete');
    }
  };
  const cleanup = createReaderRetention({ directory, loginLedger: ledger, uidStore: { get: () => '123456' }, workflow, payload: serviceWith() });
  try { assert.equal((await cleanup.sweep({ now: at })).deleted, 1); assert.equal(checkpoint,true); assert.equal(database.prepare('SELECT id FROM readers WHERE id=?').get(row.id),undefined); }
  finally { Atomics.store(signal,0,1); Atomics.notify(signal,0); await exited; await cleanup.close(); }
});
test('a failed atomic deletion rolls back preferences without purging community data', async () => {
  const row = await reader('delete-fails');
  database.prepare('INSERT INTO payload_preferences (id,key,value,created_at,updated_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), `collection-readers-${row.id}`, '{}', old, old);
  database.exec(`CREATE TRIGGER fail_reader_cleanup BEFORE DELETE ON readers BEGIN SELECT RAISE(ABORT,'injected deletion failure'); END`);
  let purged = false;
  const cleanup = createReaderRetention({ directory, loginLedger: ledger, uidStore: { get: () => '123456' }, purgeCommunity: () => { purged = true; }, payload: serviceWith() });
  try {
    await assert.rejects(cleanup.sweep({ now: at }), /injected deletion failure/); assert.equal(purged, false);
    assert.ok(database.prepare('SELECT id FROM readers WHERE id=?').get(row.id));
    assert.ok(database.prepare('SELECT id FROM payload_preferences WHERE key=?').get(`collection-readers-${row.id}`));
  } finally { database.exec('DROP TRIGGER fail_reader_cleanup'); await cleanup.close(); await payload.delete({ collection: 'readers', id: row.id }); }
});
test('unknown reader references fail closed before deleting an account', async () => {
  const row = await reader('unknown-schema'); database.exec('CREATE TABLE unknown_reader_relation (reader_id TEXT REFERENCES readers(id) ON DELETE SET NULL)');
  const cleanup = retention();
  try { await assert.rejects(cleanup.sweep({ now: at }), /schema|reference|cascade/i); assert.ok(database.prepare('SELECT id FROM readers WHERE id=?').get(row.id)); }
  finally { database.exec('DROP TABLE unknown_reader_relation'); await cleanup.close(); await payload.delete({ collection: 'readers', id: row.id }); }
});
test('legacy candidates survive completed verification before the final atomic read', async t => {
  const workflow = createReaderWorkflow(directory, payload.config.secret);
  for (const membership of [false, true]) await t.test(membership ? 'verification and VIP grant' : 'verification alone', async () => {
    const row = await reader(membership ? 'verified-vip' : 'verified-reader'); database.prepare('UPDATE readers SET _verified=0 WHERE id=?').run(row.id);
    let candidateSeen = false;
    const cleanup = createReaderRetention({ directory, loginLedger: ledger, uidStore: { get: () => '123456' }, workflow,
      payload: serviceWith({ find: async args => {
        const candidates = await payload.find(args); candidateSeen = candidates.docs.some(candidate => candidate.id === row.id);
        await payload.update({ collection: 'readers', id: row.id, data: { _verified: true, ...(membership ? { vip_until: '2027-03-01T00:00:00.000Z' } : {}) } }); return candidates;
      } }) });
    try { assert.equal((await cleanup.sweepPending(at)).legacy, 0); assert.equal(candidateSeen, true); assert.equal((await payload.findByID({ collection: 'readers', id: row.id }))._verified, true); assert.equal(workflow.cleanupAccounts().length, 0); }
    finally { await cleanup.close(); }
  });
});
test('automatic deletion cascades auth sessions and removes preferences without affecting other readers', async () => {
  const row = await reader('cascade-cleanup'), other = await reader('cascade-other');
  database.prepare('UPDATE readers SET vip_until=? WHERE id=?').run('2027-03-01T00:00:00.000Z', other.id);
  for (const id of [row.id, other.id]) database.prepare('INSERT INTO readers_sessions (_order,_parent_id,id,expires_at) VALUES (?,?,?,?)').run(0, id, randomUUID(), '2027-03-01T00:00:00.000Z');
  database.prepare('INSERT INTO payload_preferences (id,key,value,created_at,updated_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), `collection-readers-${row.id}`, '{}', old, old);
  const workflow = createReaderWorkflow(directory, payload.config.secret);
  const cleanup = createReaderRetention({ directory, loginLedger: { ...ledger, inactiveReaderIds: (_cutoff, _now, _limit, offset) => offset ? [] : [row.id] }, uidStore: { get: () => '123456' }, workflow, payload: serviceWith() });
  try {
    assert.equal((await cleanup.sweep({ now: at })).deleted, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM readers_sessions WHERE _parent_id=?').get(row.id).n, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM readers_sessions WHERE _parent_id=?').get(other.id).n, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM payload_preferences WHERE key=?').get(`collection-readers-${row.id}`).n, 0);
    assert.equal(workflow.cleanupAccounts().length, 0);
  } finally { await cleanup.close(); }
});
test('the final approved avatar is durably queued before deletion when follow-up fails', async () => {
  const row = await reader('final-avatar'), original = randomUUID(), final = randomUUID();
  await mkdir(resolve(directory, 'uploads'), { recursive: true }); await writeFile(resolve(directory, 'uploads', `reader-avatar-${final}.webp`), 'avatar');
  database.prepare('UPDATE readers SET avatar=? WHERE id=?').run(original, row.id);
  const workflow = createReaderWorkflow(directory, payload.config.secret);
  const cleanup = createReaderRetention({ directory, loginLedger: { ...ledger, inactiveReaderIds: (_cutoff, _now, _limit, offset) => offset ? [] : [row.id] }, uidStore: { get: () => '123456' }, workflow,
    purgeCommunity: () => { throw Error('injected follow-up failure'); },
    payload: updateAfterCandidate(row.id, () => payload.update({ collection: 'readers', id: row.id, data: { avatar: final } })) });
  try { assert.equal((await cleanup.sweep({ now: at })).deleted, 1); assert.ok(workflow.cleanupFiles().some(job => job.filename === `reader-avatar-${final}.webp`)); await access(resolve(directory, 'uploads', `reader-avatar-${final}.webp`)); }
  finally { await cleanup.close(); }
});
test('a 60-account batch and following ordinary Payload create/update stay stable', { timeout: 60000 }, async () => {
  const ids = []; for (let index = 0; index < 60; index++) ids.push((await reader(`batch-${index}`)).id);
  const cleanup = retention();
  try {
    assert.ok((await cleanup.sweep({ now: at })).deleted >= ids.length);
    for (const id of ids) assert.equal(database.prepare('SELECT COUNT(*) AS n FROM readers WHERE id=?').get(id).n, 0);
    assert.equal(await payload.db.beginTransaction(), null);
    const active = await reader('after-batch'); await payload.update({ collection: 'readers', id: active.id, data: { signature: '批量清理后' } });
    assert.equal((await payload.findByID({ collection: 'readers', id: active.id })).signature, '批量清理后');
  } finally { await cleanup.close(); }
});
