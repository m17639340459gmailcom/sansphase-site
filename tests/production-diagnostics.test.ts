import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createProductionDiagnostics } from '../server/production-diagnostics.ts';

const release = 'production-diagnostics-test';
const vital = { kind: 'vital', route: 'community-home', name: 'LCP', value: 1200 };

async function fixture(t: test.TestContext, origin = 'https://www.sansphase.com') {
  let remoteAddress: string | undefined;
  let random = 0;
  let service: ReturnType<typeof createProductionDiagnostics>;
  const server = createServer(async (req, res) => {
    if (remoteAddress) Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: remoteAddress });
    if (req.url === '/bootstrap') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(service.bootstrap(req) ?? null));
    } else if (!await service.handle(req, res)) { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  service = createProductionDiagnostics({ origin, port, release, random: () => random });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const call = (path: string, options: { method?: string; headers?: IncomingHttpHeaders; body?: string } = {}) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; text: string; json: () => unknown }>((resolve, reject) => {
      const req = request(`http://127.0.0.1:${port}${path}`, {
        method: options.method || 'GET', headers: options.headers,
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('error', reject);
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode || 0, headers: res.headers, text, json: () => JSON.parse(text) as unknown });
        });
      });
      req.on('error', reject);
      req.end(options.body);
    });
  const publicHeaders = { Host: new URL(origin).host, Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' };
  return { port, service, call, publicHeaders,
    remote: (address?: string) => { remoteAddress = address; },
    random: (value: number) => { random = value; },
    post: (events: unknown[] = [vital], headers: IncomingHttpHeaders = {}) => call('/api/diagnostics/events', {
      method: 'POST', headers: { ...publicHeaders, ...headers }, body: JSON.stringify({ events }),
    }),
  };
}

test('production diagnostics require one exact approved HTTPS origin and explicit loopback app port', () => {
  for (const origin of ['http://www.sansphase.com', 'https://sansphase.com', 'https://www.sansphase.com/',
    'https://www.sansphase.com:443', 'https://community.sansphase.com.evil.example', 'https://127.0.0.1:4176',
    'https://user:password@www.sansphase.com']) {
    assert.throws(() => createProductionDiagnostics({ origin, port: 4176, release }), /Production diagnostics configuration rejected/);
  }
  for (const port of [0, -1, 65536, 4176.5, NaN]) {
    assert.throws(() => createProductionDiagnostics({ origin: 'https://www.sansphase.com', port, release }), /Production diagnostics configuration rejected/);
  }
  assert.throws(() => createProductionDiagnostics({ origin: 'https://www.sansphase.com', port: 4176, release: 'unsafe private/value' }));
});

test('both production hosts receive anonymous same-origin events without a session or entry ticket', async t => {
  for (const origin of ['https://www.sansphase.com', 'https://community.sansphase.com']) {
    const env = await fixture(t, origin);
    const response = await env.post();
    assert.equal(response.status, 202);
    assert.deepEqual(response.json(), { accepted: 1 });
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    const report = await env.call('/api/diagnostics/report');
    assert.equal(report.status, 200);
    assert.equal((report.json() as { count: number }).count, 1);
  }
});

test('public events require the actual loopback proxy, exact public Host and exact same origin', async t => {
  const env = await fixture(t);
  for (const headers of [{ Host: 'evil.example' }, { Host: `127.0.0.1:${env.port}` }, { Origin: '' },
    { Origin: 'https://community.sansphase.com' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' }]) assert.equal((await env.post([vital], headers)).status, 403);
  env.remote('198.51.100.1');
  assert.equal((await env.post([vital], { 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '127.0.0.1' })).status, 403);
  env.remote();
  assert.equal((await env.post([vital], { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.1' })).status, 202);
});

test('report and config are private to local operator HTTP requests and reject proxy/browser headers', async t => {
  const env = await fixture(t);
  for (const kind of ['config', 'report']) {
    const path = `/api/diagnostics/${kind}`;
    assert.equal((await env.call(path)).status, 200);
    for (const headers of [{ Host: 'www.sansphase.com' }, { Origin: 'https://www.sansphase.com' },
      { 'Sec-Fetch-Site': 'none' }, { 'Sec-Fetch-Mode': 'navigate' }, { 'Sec-Fetch-Dest': 'document' },
      { 'X-Forwarded-For': '127.0.0.1' }, { 'X-Forwarded-Proto': 'https' }, { 'X-Forwarded-Host': 'www.sansphase.com' },
      { Forwarded: 'for=127.0.0.1' }, { 'X-Real-IP': '127.0.0.1' }]) {
      assert.equal((await env.call(path, { headers })).status, 403, JSON.stringify(headers));
    }
    env.remote('198.51.100.1');
    assert.equal((await env.call(path)).status, 403);
    env.remote();
  }
  const config = (await env.call('/api/diagnostics/config')).json() as { sampleRate: number };
  assert.equal(config.sampleRate, 0.1);
});

test('production schema, body bytes, write budgets and report budgets remain bounded', async t => {
  const env = await fixture(t);
  assert.equal((await env.post([{ ...vital, userId: 'private-account' }])).status, 400);
  assert.equal((await env.post(Array.from({ length: 21 }, () => vital))).status, 400);
  assert.equal((await env.call('/api/diagnostics/events', {
    method: 'POST', headers: env.publicHeaders, body: JSON.stringify({ events: [vital] }).padEnd(8193, ' '),
  })).status, 413);
  for (let i = 0; i < 117; i++) assert.equal((await env.post()).status, 202);
  assert.equal((await env.post()).status, 429);
  for (let i = 0; i < 30; i++) assert.equal((await env.call('/api/diagnostics/report')).status, 200);
  assert.equal((await env.call('/api/diagnostics/report')).status, 429);
});

test('bootstrap samples only ten percent of documents, honors privacy headers and exposes no identifier', async t => {
  const env = await fixture(t);
  assert.equal(env.service.sampleRate, 0.1);
  env.random(0.09999);
  assert.deepEqual((await env.call('/bootstrap')).json(), { enabled: true });
  env.random(0.1);
  assert.equal((await env.call('/bootstrap')).json(), null);
  env.random(0);
  for (const headers of [{ DNT: '1' }, { 'Sec-GPC': '1' }]) assert.equal((await env.call('/bootstrap', { headers })).json(), null);
  assert.deepEqual((await env.call('/bootstrap', { headers: { DNT: '0' } })).json(), { enabled: true });
  assert.equal(env.service.bootstrap({ headers: { dnt: ['1'] } } as unknown as IncomingMessage), undefined);
});
