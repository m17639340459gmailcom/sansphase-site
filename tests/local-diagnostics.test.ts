import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLocalDiagnostics } from '../server/local-diagnostics.ts';

const release = 'local-diagnostics-test';
const vital = { kind: 'vital', route: 'community-home', name: 'LCP', value: 1200 };
const longtask = { kind: 'longtask', route: 'community-home', duration: 80 };
const error = { kind: 'error', route: 'community-home', source: 'script', name: 'TypeError' };

async function fixture(t: test.TestContext) {
  let time = 1_000;
  let remoteAddress: string | undefined;
  let received = 0;
  const requestWaiters: Array<{ count: number; resolve: () => void }> = [];
  let service: ReturnType<typeof createLocalDiagnostics>;
  const server = createServer(async (req, res) => {
    received++;
    for (const waiter of requestWaiters) if (received >= waiter.count) waiter.resolve();
    if (remoteAddress) Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: remoteAddress });
    if (!await service.handle(req, res)) { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  service = createLocalDiagnostics({ origin, release, now: () => time });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  });
  const call = (path: string, options: { method?: string; headers?: IncomingHttpHeaders; body?: string; chunked?: boolean } = {}) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; text: string; json: () => unknown }>((resolve, reject) => {
      const req = request(origin + path, {
        method: options.method || 'GET',
        headers: {
          ...(options.method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode || 0, headers: res.headers, text, json: () => JSON.parse(text) as unknown });
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      if (options.chunked && options.body) { req.write(options.body.slice(0, 4096)); req.end(options.body.slice(4096)); }
      else req.end(options.body);
    });
  return {
    origin, call,
    post: (events: unknown[], extra: Record<string, unknown> = {}) => call('/api/diagnostics/events', {
      method: 'POST', body: JSON.stringify({ events, ...extra }),
    }),
    report: () => call('/api/diagnostics/report'),
    advance: (milliseconds: number) => { time += milliseconds; },
    remote: (address?: string) => { remoteAddress = address; },
    requested: (count: number) => received >= count ? Promise.resolve() : new Promise<void>(resolve => requestWaiters.push({ count, resolve })),
  };
}

test('diagnostics cannot be constructed for public, ambiguous or production origins', () => {
  for (const origin of ['https://127.0.0.1:4248', 'http://localhost:4248', 'http://0.0.0.0:4248',
    'http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:04248',
    'http://127.0.0.1:4248/', 'http://127.0.0.1:4248?private', 'http://user:password@127.0.0.1:4248',
    'https://www.sansphase.com']) {
    assert.throws(() => createLocalDiagnostics({ origin, release }), /Local diagnostics configuration rejected/);
  }
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => createLocalDiagnostics({ origin: 'http://127.0.0.1:4248', release }), /Local diagnostics configuration rejected/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

test('local preview enables all documents while honoring privacy preferences', () => {
  const service = createLocalDiagnostics({ origin: 'http://127.0.0.1:4248', release });
  assert.equal(service.sampleRate, 1);
  assert.deepEqual(service.bootstrap({ headers: {} } as IncomingMessage), { enabled: true });
  assert.equal(service.bootstrap({ headers: { dnt: '1' } } as IncomingMessage), undefined);
  assert.equal(service.bootstrap({ headers: { 'sec-gpc': '1' } } as IncomingMessage), undefined);
});

test('only the three explicit local endpoints are handled and responses are never cached or CORS enabled', async t => {
  const env = await fixture(t);
  assert.equal((await env.call('/api/other')).status, 404);
  const config = await env.call('/api/diagnostics/config');
  assert.equal(config.status, 200);
  assert.equal((config.json() as { enabled: boolean }).enabled, true);
  assert.equal(config.headers['cache-control'], 'private, no-store');
  assert.equal(config.headers['x-content-type-options'], 'nosniff');
  assert.equal(config.headers['access-control-allow-origin'], undefined);
  assert.equal((await env.call('/api/diagnostics/events')).status, 405);
  assert.equal((await env.call('/api/diagnostics/report', { method: 'POST' })).status, 405);
  assert.equal((await env.call('/api/diagnostics/config?private=secret')).status, 400);
});

test('anonymous events are accepted atomically and reports expose only safe normalized values', async t => {
  const env = await fixture(t);
  assert.equal((await env.call('/api/diagnostics/events', {
    method: 'POST', body: JSON.stringify({ events: [vital, { ...vital, value: 800 }, longtask, error] }),
    headers: { Cookie: 'session=private-session', 'User-Agent': 'private-browser', 'X-Forwarded-For': '198.51.100.32' },
  })).status, 202);
  const response = await env.report();
  assert.equal(response.status, 200);
  const report = response.json() as {
    release: string; count: number; events: Array<Record<string, unknown>>;
    summary: { vitals: Record<string, { count: number; mean: number; max: number }>; longtasks: { count: number; total: number; max: number }; errors: { count: number } };
  };
  assert.equal(report.release, release);
  assert.equal(report.count, 4);
  assert.deepEqual(report.summary.vitals.LCP, { count: 2, mean: 1000, max: 1200 });
  assert.deepEqual(report.summary.longtasks, { count: 1, total: 80, max: 80 });
  assert.equal(report.summary.errors.count, 1);
  assert.deepEqual(report.events[0], { ...vital, receivedAt: 1000 });
  assert.doesNotMatch(response.text, /127\.0\.0\.1|198\.51\.100\.32|private-session|private-browser|cookie|userAgent|stack|query|hash|password/);
});

test('the whole batch is rejected for extra fields, private content, unsupported routes and invalid numbers', async t => {
  const env = await fixture(t);
  const invalid = [
    { ...error, message: 'private text' }, { ...error, stack: 'private stack' },
    { ...vital, route: '/community/u/10009' }, { ...vital, route: '/community/home?email=private@example.test' },
    { ...error, name: 'private arbitrary text' }, { ...vital, value: -1 },
    { ...vital, value: '1200' }, { ...vital, userId: '10009' }, { ...longtask, duration: null },
  ];
  for (const event of invalid) {
    const response = await env.post([vital, event]);
    assert.equal(response.status, 400);
    assert.doesNotMatch(response.text, /private|10009|stack|email/);
  }
  assert.equal((await env.post([vital], { account: 'private' })).status, 400);
  assert.equal((await env.post([])).status, 400);
  assert.equal((await env.post(Array.from({ length: 21 }, () => vital))).status, 400);
  assert.equal((await env.call('/api/diagnostics/events', { method: 'POST', body: '{invalid private' })).status, 400);
  assert.equal(((await env.report()).json() as { count: number }).count, 0);
});

test('Host, actual loopback peer and same origin are required without trusting forwarding headers', async t => {
  const env = await fixture(t);
  for (const path of ['/api/diagnostics/config', '/api/diagnostics/report', '/api/diagnostics/events']) {
    const method = path.endsWith('events') ? 'POST' : 'GET';
    const body = JSON.stringify({ events: [vital] });
    assert.equal((await env.call(path, { method, body, headers: { Host: 'evil.example' } })).status, 403);
    assert.equal((await env.call(path, { method, body, headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await env.call(path, { method, body, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await env.call(path, { method, body, headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
    env.remote('203.0.113.5');
    assert.equal((await env.call(path, { method, body, headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '127.0.0.1' } })).status, 403);
    env.remote();
  }
  assert.equal((await env.call('/api/diagnostics/events', { method: 'POST', body: JSON.stringify({ events: [vital] }), headers: { Origin: '' } })).status, 403);
  assert.equal((await env.call('/api/diagnostics/report', { headers: { Origin: env.origin, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
});

test('body bytes, MIME type, encoding and exact batch size have hard limits', async t => {
  const env = await fixture(t);
  const content = JSON.stringify({ events: [vital] });
  assert.equal((await env.call('/api/diagnostics/events', {
    method: 'POST', body: content.padEnd(8192, ' '), headers: { 'Content-Length': '8192' },
  })).status, 202);
  for (const chunked of [false, true]) {
    const response = await env.call('/api/diagnostics/events', {
      method: 'POST', body: content.padEnd(8193, ' '), chunked,
      headers: chunked ? {} : { 'Content-Length': '8193' },
    });
    assert.equal(response.status, 413);
  }
  const unicode = JSON.stringify({ events: [{ ...vital, extra: '界'.repeat(3000) }] });
  assert.ok(unicode.length < 8192 && Buffer.byteLength(unicode) > 8192);
  assert.equal((await env.call('/api/diagnostics/events', { method: 'POST', body: unicode, chunked: true })).status, 413);
  for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/jsonp' }, { 'Content-Encoding': 'gzip' }]) {
    assert.equal((await env.call('/api/diagnostics/events', { method: 'POST', body: content, headers })).status, 415);
  }
  assert.equal((await env.post(Array.from({ length: 20 }, () => vital))).status, 202);
});

test('global write and report budgets cannot be bypassed with forwarding headers and recover next minute', async t => {
  const env = await fixture(t);
  for (let i = 0; i < 120; i++) assert.equal((await env.post([vital])).status, 202);
  const denied = await env.call('/api/diagnostics/events', {
    method: 'POST', body: JSON.stringify({ events: [vital] }), headers: { 'X-Forwarded-For': '198.51.100.1' },
  });
  assert.equal(denied.status, 429);
  assert.equal(denied.headers['retry-after'], '60');
  for (let i = 0; i < 30; i++) assert.equal((await env.report()).status, 200);
  assert.equal((await env.report()).status, 429);
  env.advance(60_001);
  assert.equal((await env.post([vital])).status, 202);
  assert.equal((await env.report()).status, 200);
});

test('memory is bounded to the newest 5000 events and expires within 24 hours without persistence', async t => {
  const env = await fixture(t);
  let sent = 0;
  for (let round = 0; round < 3; round++) {
    for (let batch = 0; batch < 100; batch++) {
      assert.equal((await env.post(Array.from({ length: 20 }, () => ({ ...vital, value: sent++ })))).status, 202);
    }
    env.advance(60_001);
  }
  const report = (await env.report()).json() as { count: number; events: Array<{ value: number }> };
  assert.equal(report.count, 5000);
  assert.equal(report.events[0].value, 1000);
  assert.equal(report.events.at(-1)?.value, 5999);
  env.advance(86_400_001);
  assert.equal(((await env.report()).json() as { count: number }).count, 0);
  const fresh = await fixture(t);
  assert.equal(((await fresh.report()).json() as { count: number }).count, 0);
});

test('slow uploads time out without blocking config or leaking submitted text', async t => {
  const env = await fixture(t);
  const slow = new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request(env.origin + '/api/diagnostics/events', {
      method: 'POST', headers: { Origin: env.origin, 'Content-Type': 'application/json', 'Content-Length': '100' },
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { resolve({ status: res.statusCode || 0, text }); req.destroy(); });
    });
    req.on('error', reject);
    req.write('{"private":');
  });
  assert.equal((await env.call('/api/diagnostics/config')).status, 200);
  const timedOut = await slow;
  assert.equal(timedOut.status, 408);
  assert.doesNotMatch(timedOut.text, /private/);
  assert.equal((await env.post([vital])).status, 202);
});

test('at most eight unfinished upload bodies can occupy service capacity', async t => {
  const env = await fixture(t);
  const pending = Array.from({ length: 8 }, () => {
    let received: () => void;
    const headersFlushed = new Promise<void>(resolve => { received = resolve; });
    const outcome = new Promise<number>((resolve, reject) => {
      const req = request(env.origin + '/api/diagnostics/events', {
        method: 'POST', headers: { Origin: env.origin, 'Content-Type': 'application/json', 'Content-Length': '100' },
      }, res => {
        res.resume();
        res.on('end', () => { resolve(res.statusCode || 0); req.destroy(); });
      });
      req.on('error', reject);
      req.write('{', () => received());
    });
    return { headersFlushed, outcome };
  });
  await Promise.all(pending.map(value => value.headersFlushed));
  await env.requested(8);
  assert.equal((await env.call('/api/diagnostics/config')).status, 200);
  assert.equal((await env.post([vital])).status, 429);
  assert.deepEqual(await Promise.all(pending.map(value => value.outcome)), Array(8).fill(408));
  assert.equal((await env.post([vital])).status, 202);
});

test('a client abort does not become an uncaught server error and frees the body reader', async t => {
  const env = await fixture(t);
  const req = request(env.origin + '/api/diagnostics/events', {
    method: 'POST', headers: { Origin: env.origin, 'Content-Type': 'application/json', 'Content-Length': '100' },
  });
  req.on('error', () => {});
  req.write('{');
  await env.requested(1);
  req.destroy();
  assert.equal((await env.call('/api/diagnostics/config')).status, 200);
  assert.equal((await env.post([vital])).status, 202);
});
