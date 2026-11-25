import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { createReaderAdminService } from '../server/reader-admin-service.ts';

type Options = Parameters<typeof createReaderAdminService>[0];
type Action = 'vip-grant' | 'vip-add-days' | 'vip-revoke';
type Reader = {
  id: string; email: string; nickname: string; _verified: boolean;
  createdAt: string; vip_started_at: string | null; vip_until: string | null;
};
const actions: Action[] = ['vip-grant', 'vip-add-days', 'vip-revoke'];
const initial: Reader = {
  id: 'b7831885-e54c-4e01-83f7-a467761f283e', email: 'synthetic@example.test',
  nickname: 'Synthetic reader', _verified: true, createdAt: '2026-01-01T00:00:00.000Z',
  vip_started_at: '2026-01-01T00:00:00.000Z', vip_until: '2099-06-15T12:00:00.000Z',
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

// Exercise the production HTTP service with a deterministic account-storage seam.
// Delaying a lookup makes the logout race observable without timing-dependent sleeps.
async function fixture(onLookup: (number: number) => Promise<void> = async () => {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'reader-vip-auth-test-'));
  let reader = { ...initial }, authorized = true, lookups = 0, writes = 0;
  const payload = {
    config: { secret: 'synthetic-test-only' },
    async findByID() { await onLookup(++lookups); return { ...reader }; },
    async update({ data }: { data: Partial<Reader> }) {
      writes++; reader = { ...reader, ...data }; return { ...reader };
    },
  } as unknown as Options['payload'];
  let service: ReturnType<typeof createReaderAdminService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  service = createReaderAdminService({
    payload, authorService: { identity: async () => authorized ? { id: 'synthetic-owner' } : null },
    siteOrigin: origin, directory, authorId: 'synthetic-owner',
    uidStore: { get: () => '10001' } as Options['uidStore'],
    workflow: {} as Options['workflow'], mediaRetention: {} as Options['mediaRetention'],
    profileCommands: {} as Options['profileCommands'],
  });
  return {
    setAuthorized(value: boolean) { authorized = value; },
    state: () => ({ reader: { ...reader }, lookups, writes }),
    request: (action: Action) => fetch(`${origin}/api/manage/readers/${initial.id}/${action}`, {
      method: 'POST', headers: { Origin: origin, 'X-Author-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmId: initial.id, ...(action === 'vip-add-days' ? { days: 2 } : {}) }),
      signal: AbortSignal.timeout(5000),
    }),
    async close() {
      await new Promise<void>(done => server.close(() => done()));
      assert.equal(resolve(tmpdir(), basename(directory)), directory);
      assert.match(basename(directory), /^reader-vip-auth-test-/);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

for (const action of actions) {
  test(`${action} rejects both in-flight and queued writes after owner logout`, { timeout: 15000 }, async t => {
    const entered = deferred(), release = deferred(), secondRead = deferred();
    const app = await fixture(async lookup => {
      if (lookup === 2) { entered.resolve(); await release.promise; }
      if (lookup === 3) secondRead.resolve();
    });
    t.after(app.close);
    const inFlight = app.request(action);
    await entered.promise;
    const queued = app.request(action);
    try {
      await secondRead.promise;
      app.setAuthorized(false);
    } finally { release.resolve(); }
    const responses = await Promise.all([inFlight, queued]);
    assert.deepEqual(responses.map(response => response.status), [403, 403]);
    assert.equal(app.state().writes, 0, 'forbidden responses must not mask successful VIP writes');
    assert.deepEqual(app.state().reader, initial, 'logout preserves existing VIP dates');
    assert.equal(app.state().lookups, 3, 'the queued command must stop before reading membership again');
    app.setAuthorized(true);
    assert.equal((await app.request(action)).status, 200, 'a rejected command must not poison the queue');
    assert.equal(app.state().writes, 1);
  });

  test(`${action} still applies once for an authorized owner`, { timeout: 15000 }, async t => {
    const app = await fixture(); t.after(app.close);
    const response = await app.request(action);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.id, initial.id);
    assert.equal(app.state().writes, 1);
    assert.equal(app.state().reader.vip_until, action === 'vip-grant' ? '2099-07-15T12:00:00.000Z'
      : action === 'vip-add-days' ? '2099-06-17T12:00:00.000Z' : null);
    assert.equal(app.state().reader.vip_started_at, action === 'vip-revoke' ? null : initial.vip_started_at);
  });
}
