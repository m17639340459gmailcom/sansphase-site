import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { createLoginLedger } from '../server/login-ledger.ts';
import { loginEventsSchema } from '../server/payload/reader-migration.ts';

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'login-ledger-limit-'));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec(loginEventsSchema);
  const ledger = createLoginLedger(directory);
  t.after(async () => { ledger.close(); db.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const record = (id: string, ip = '192.0.2.1', actorType = 'reader') => ledger.record({
    actorType, actorId: id, email: `${id}@example.test`, address: { ip, peerIp: ip, source: 'socket' },
  });
  const historical = (id: string, at: string, ip = '192.0.2.1') => db.prepare(`INSERT INTO login_events
    (id,happened_at,actor_type,actor_id,email,ip,peer_ip,source,user_agent) VALUES (?,?,'reader',?,?,?,?,'socket','')`)
    .run(randomUUID(), at, id, `${id}@example.test`, ip, ip);
  return { directory, db, ledger, record, historical };
}

function denied(operation: () => unknown) {
  assert.throws(operation, error => error instanceof Error && 'status' in error && error.status === 403 && /3|三个/.test(error.message));
}

test('one IP admits three reader accounts, repeated logins consume no extra slots, and owners are exempt', async t => {
  const { db, record } = await fixture(t);
  for (let i = 0; i < 8; i++) record('author', '192.0.2.1', 'owner');
  for (const id of ['first', 'second', 'third']) record(id);
  for (let i = 0; i < 8; i++) record('first');
  denied(() => record('fourth'));
  record('fourth', '192.0.2.2');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM login_events WHERE actor_id='fourth'").get()?.n, 1, 'blocked attempts must never enter the successful-login ledger');
  record('author', '192.0.2.1', 'owner');
});

test('historical accounts occupy slots after deletion and only the earliest three accounts remain eligible', async t => {
  const { db, record, historical } = await fixture(t);
  db.exec('CREATE TABLE readers(id TEXT PRIMARY KEY)');
  // Insertion order differs from first successful-login time.
  historical('fourth', '2020-01-04T00:00:00.000Z');
  historical('third', '2020-01-03T00:00:00.000Z');
  historical('first', '2020-01-01T00:00:00.000Z');
  historical('second', '2020-01-02T00:00:00.000Z');
  db.prepare('INSERT INTO readers VALUES (?)').run('first');
  db.prepare('DELETE FROM readers WHERE id=?').run('first');
  for (const id of ['first', 'second', 'third']) record(id);
  denied(() => record('fourth'));
  denied(() => record('new-account'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM login_events WHERE actor_id='fourth'").get()?.n, 1);
});

test('equal historical first-login timestamps use insertion order to choose the three accounts', async t => {
  const { record, historical } = await fixture(t);
  for (const id of ['one', 'two', 'three', 'four']) historical(id, '2020-01-01T00:00:00.000Z');
  for (const id of ['one', 'two', 'three']) record(id);
  denied(() => record('four'));
});

test('IPv4-mapped IPv6 and equivalent IPv6 spellings cannot bypass historical limits', async t => {
  const { record, historical } = await fixture(t);
  historical('v4-one', '2020-01-01T00:00:00.000Z', '::ffff:192.0.2.1');
  historical('v4-two', '2020-01-02T00:00:00.000Z', '0:0:0:0:0:FFFF:C000:0201');
  historical('v4-three', '2020-01-03T00:00:00.000Z', '192.0.2.1');
  denied(() => record('v4-four', '::ffff:c000:201'));
  record('v4-one', '192.0.2.1');
  historical('v6-one', '2020-01-01T00:00:00.000Z', '2001:0DB8:0000:0000:0000:0000:0000:0001');
  historical('v6-two', '2020-01-02T00:00:00.000Z', '2001:db8::1');
  historical('v6-three', '2020-01-03T00:00:00.000Z', '2001:db8:0:0:0:0:0:1');
  denied(() => record('v6-four', '2001:DB8::0001'));
  record('v6-two', '2001:db8::1');
});

test('the lifetime limit survives opening a new ledger connection', async t => {
  const { directory, record } = await fixture(t);
  for (const id of ['one', 'two', 'three']) record(id);
  const reopened = createLoginLedger(directory);
  try {
    denied(() => reopened.record({ actorType: 'reader', actorId: 'four', email: 'four@example.test', address: { ip: '192.0.2.1', peerIp: '192.0.2.1', source: 'socket' } }));
    reopened.record({ actorType: 'reader', actorId: 'two', email: 'two@example.test', address: { ip: '192.0.2.1', peerIp: '192.0.2.1', source: 'socket' } });
  } finally { reopened.close(); }
});

test('six independent SQLite connections racing for one IP admit exactly three distinct readers', { timeout: 20000 }, async t => {
  const { directory, db } = await fixture(t);
  const signal = new SharedArrayBuffer(4), workers: Worker[] = [];
  const ledgerURL = new URL('../server/login-ledger.ts', import.meta.url).href;
  const source = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { createLoginLedger } from ${JSON.stringify(ledgerURL)};
    const ledger=createLoginLedger(workerData.directory);
    parentPort.postMessage({ready:true});
    Atomics.wait(new Int32Array(workerData.signal),0,0);
    try {
      ledger.record({actorType:'reader',actorId:workerData.id,email:workerData.id+'@example.test',address:{ip:'192.0.2.1',peerIp:'192.0.2.1',source:'socket'}});
      parentPort.postMessage({ok:true});
    } catch(error) { parentPort.postMessage({ok:false,status:error.status}); }
    finally {ledger.close();}
  `;
  let ready = 0;
  try {
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => new Promise<{ ok: boolean; status?: number }>((resolveResult, reject) => {
      const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), { workerData: { directory, signal, id: `reader-${index}` } });
      workers.push(worker);
      let finished = false;
      worker.on('message', (message: { ready?: boolean; ok: boolean; status?: number }) => {
        if (message.ready) {
          if (++ready === 6) { Atomics.store(new Int32Array(signal), 0, 1); Atomics.notify(new Int32Array(signal), 0); }
        } else { finished = true; resolveResult(message); }
      });
      worker.on('error', reject);
      worker.on('exit', code => { if (!finished) reject(Error(`Login worker exited without result (${code})`)); });
    })));
    assert.equal(results.filter(result => result.ok).length, 3);
    assert.ok(results.filter(result => !result.ok).every(result => result.status === 403));
    assert.equal(db.prepare("SELECT COUNT(DISTINCT actor_id) AS n FROM login_events WHERE actor_type='reader'").get()?.n, 3);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
});
