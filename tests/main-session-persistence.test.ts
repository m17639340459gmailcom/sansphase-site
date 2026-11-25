import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getPayload } from 'payload';
import { makePayloadConfig } from '../server/payload/config.ts';
import { createPayloadStore } from '../server/payload/store.ts';
import { createAuthorService } from '../server/author-service.ts';
import { createReaderService } from '../server/reader-service.ts';
import { readerUidsTableSql, readerUidsTriggerSql, createReaderUidStore } from '../server/reader-uids.ts';

const weekSeconds = 7 * 86400;
const tokenClaims = (cookie: string) => JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[1], 'base64url').toString()) as { iat: number; exp: number };

test('main-site account sessions last one week and distinguish storage faults from revoked sessions', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'main-session-persistence-'));
  const secret = randomBytes(48).toString('hex');
  const config = (push: boolean) => makePayloadConfig({ directory, secret, push });
  let payload = await getPayload({ config: config(true), key: `session-first-${directory}` });
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec(readerUidsTableSql); db.exec(readerUidsTriggerSql); db.close();
  const uidStore = createReaderUidStore(directory);
  const password = randomBytes(24).toString('hex');
  const owner = await payload.create({ collection: 'authors', data: { email: 'owner@example.test', password, first_name: 'Author', role: 'owner' } });
  await payload.create({ collection: 'readers', disableVerificationEmail: true, data: { email: 'reader@example.test', password, nickname: '模拟读者', _verified: true } });
  const server = createServer((req, res) => void (req.url?.startsWith('/api/author/') ? author.handle(req, res) : reader.handle(req, res)));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const services = () => {
    const store = createPayloadStore(payload, { directory, authorId: owner.id });
    const author = createAuthorService({ url: origin, siteOrigin: origin, authorId: owner.id, store });
    const reader = createReaderService({ payload, directory, siteOrigin: origin, authorService: author, uidStore });
    return { author, reader };
  };
  let { author, reader } = services();
  t.after(async () => {
    await new Promise<void>(done => server.close(() => done()));
    uidStore.close(); await payload.destroy(); await payload.db.client.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const post = (kind: 'author' | 'reader', operation: string, body: unknown, cookie = '') => fetch(`${origin}/api/${kind}/${operation}`, {
    method: 'POST', headers: { Origin: origin, [`X-${kind === 'author' ? 'Author' : 'Reader'}-Request`]: '1', 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body),
  });
  const cookies = new Map<'author' | 'reader', string>();
  for (const kind of ['author', 'reader'] as const) {
    const result = await post(kind, 'login', { email: `${kind === 'author' ? 'owner' : 'reader'}@example.test`, password });
    assert.equal(result.status, 200, await result.clone().text());
    const header = result.headers.get('set-cookie'); assert.ok(header);
    cookies.set(kind, header);
  }
  const session = (kind: 'author' | 'reader', cookie = cookies.get(kind)!.split(';')[0]) => fetch(`${origin}/api/${kind}/session`, { headers: { Cookie: cookie } });

  await t.test('both signed tokens and persistent cookies use the same seven-day lifetime', () => {
    for (const kind of ['author', 'reader'] as const) {
      const header = cookies.get(kind)!;
      assert.match(header, /; HttpOnly; SameSite=Strict; Path=\/; Max-Age=604800(?:;|$)/, `${kind} survives browser restart for one week`);
      const claims = tokenClaims(header);
      assert.equal(claims.exp - claims.iat, weekSeconds, `${kind} JWT must not expire before its cookie`);
    }
  });

  await t.test('persisted signed sessions survive an application restart', async () => {
    await payload.destroy(); await payload.db.client.close();
    payload = await getPayload({ config: config(false), key: `session-restarted-${directory}` });
    ({ author, reader } = services());
    for (const kind of ['author', 'reader'] as const) {
      const response = await session(kind); assert.equal(response.status, 200);
      assert.ok(await response.json(), `${kind} remains authenticated after restart`);
      assert.equal(response.headers.get('set-cookie'), null, 'session probes do not slide the absolute deadline');
    }
  });

  await t.test('a valid account remains signed in near the end of day seven, then expires', async clock => {
    const issuedAt = Math.max(...[...cookies.values()].map(value => tokenClaims(value).iat));
    clock.mock.timers.enable({ apis: ['Date'], now: (issuedAt + weekSeconds - 60) * 1000 });
    try {
      for (const kind of ['author', 'reader'] as const) {
        const response = await session(kind); assert.equal(response.status, 200);
        assert.ok(await response.json(), `${kind} remains signed in after six days of inactivity`);
      }
      clock.mock.timers.setTime((issuedAt + weekSeconds + 2) * 1000);
      for (const kind of ['author', 'reader'] as const) assert.equal(await (await session(kind)).json(), null, `${kind} expires at the fixed deadline`);
    } finally { clock.mock.timers.reset(); }
  });

  await t.test('temporary account lookup faults return 503 instead of a successful signed-out response', async fault => {
    fault.mock.method(payload, 'findByID', async () => { throw Object.assign(Error('isolated storage fault'), { status: 503 }); });
    for (const kind of ['author', 'reader'] as const) {
      const response = await session(kind);
      assert.equal(response.status, 503, `${kind} storage failure is not an absent account`);
      assert.equal(response.headers.get('set-cookie'), null, 'a transient fault must not delete the persistent cookie');
      assert.ok((await response.json()).error);
    }
  });

  await t.test('genuinely invalid tokens and explicit logout still require a new login', async () => {
    for (const kind of ['author', 'reader'] as const) {
      assert.equal(await (await session(kind, `sansphase_${kind}_session=invalid-token`)).json(), null);
      const response = await post(kind, 'logout', {}, cookies.get(kind)!.split(';')[0]);
      assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie')!, /Max-Age=0(?:;|$)/);
      assert.equal(await (await session(kind)).json(), null, `${kind} logout revokes the actual persisted session`);
    }
  });
});
