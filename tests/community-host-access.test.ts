import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommunityHostStore, prepareCommunityHostDirectory, hostSessionIdleMs } from '../server/community-host-store.ts';
import { createCommunityHostAccess } from '../server/community-host-access.ts';
import { signIdentityRequest } from '../server/community-identity-protocol.ts';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const origin = 'https://community.sansphase.com';
const main = 'https://www.sansphase.com';
const secret = 'unit-test-host-secret-must-be-at-least-32-characters';
const identity = (id: string, vip = false) => ({ viewer: { kind: 'reader' as const, id, name: id, vip }, reader: { id, uid: '10001', nickname: id, signature: '', avatar: null, role: 'reader' as const, vip, vipStartedAt: null, vipUntil: null }, author: null });
async function setup(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-access-'));
  await prepareCommunityHostDirectory(directory);
  const store = createCommunityHostStore(directory);
  let unavailable = false;
  let invalid = false;
  let vip = false;
  const calls: Array<{ operation: string; input: unknown }> = [];
  let purged = '';
  let heldResponse: { started: () => void; released: Promise<void> } | null = null;
  const releases: Array<() => void> = [];
  const client = { async request<T>(operation: string, input: unknown): Promise<T> {
    calls.push({ operation, input });
    if (unavailable) throw Object.assign(new Error('bridge unavailable'), { status: 503 });
    if (invalid) throw Object.assign(new Error('expired'), { status: 401 });
    const data = input as { ticket?: string; binding?: string; sessionRef?: string };
    if (operation === 'exchange') {
      assert.equal(data.binding, 'valid-binding');
      return { sessionRef: 'ref-' + data.ticket, identity: identity(data.ticket || '') } as T;
    }
    // A source response can already contain a verified snapshot while its
    // transport promise is still pending. New requests need their own check.
    const snapshot = identity(data.sessionRef?.slice(4) || '', vip);
    const gate = operation === 'session' ? heldResponse : null;
    if (gate) { heldResponse = null; gate.started(); await gate.released; }
    else await new Promise(done => setTimeout(done, data.sessionRef?.endsWith('slow') ? 20 : 1));
    return snapshot as T;
  } };
  const access = createCommunityHostAccess({ store, client, siteOrigin: origin, mainSiteOrigin: main, secret, purge: async readerId => { purged = readerId; return { topics: 0 }; } });
  const arrivals = new Map<string, () => void>();
  const server = createServer((req, res) => {
    const arrived = arrivals.get(req.url || ''); arrivals.delete(req.url || ''); arrived?.();
    void access.requestMiddleware(req, res, async () => {
    const value = access.current(req);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(value?.identity || { asset: true }));
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  t.after(async () => { for (const release of releases) release(); await new Promise<void>(done => server.close(() => done())); store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const url = `http://127.0.0.1:${port}`;
  const exchange = (ticket: string, headers = {}) => fetch(url + '/api/community-entry', { method: 'POST', headers: { Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json', Cookie: 'sansphase_community_handoff=valid-binding', ...headers }, body: JSON.stringify({ ticket }) });
  const holdNextSessionResponse = () => {
    let started!: () => void, release!: () => void;
    const waiting = new Promise<void>(done => { started = done; }), released = new Promise<void>(done => { release = done; });
    heldResponse = { started, released }; releases.push(release);
    return { waiting, release };
  };
  const waitForRequest = (path: string) => new Promise<void>(done => { arrivals.set(path, done); });
  return { url, exchange, calls, access, store, holdNextSessionResponse, waitForRequest, setUnavailable: (value: boolean) => { unavailable = value; }, setInvalid: (value: boolean) => { invalid = value; }, setVip: (value: boolean) => { vip = value; }, purged: () => purged };
}

test('direct HTML access gets only entry prompt while API and private files remain inaccessible', async t => {
  const env = await setup(t);
  const page = await fetch(env.url + '/');
  assert.equal(page.status, 200);
  const text = await page.text();
  assert.ok(text.includes('请从主站进入社区'));
  assert.ok(!text.includes('site-content'));
  assert.ok(!text.includes('app.mjs'));
  const dom = new JSDOM(text);
  try {
    assert.equal(dom.window.getComputedStyle(dom.window.document.documentElement).colorScheme, 'light');
    assert.equal(dom.window.getComputedStyle(dom.window.document.body).backgroundColor, 'rgb(232, 226, 214)');
    const style = dom.window.document.querySelector('style')!.textContent;
    const hash = createHash('sha256').update(style).digest('base64');
    assert.ok(page.headers.get('content-security-policy')!.includes(`style-src 'sha256-${hash}'`), 'entry style stays compatible with its restrictive CSP');
  } finally { dom.window.close(); }
  assert.equal((await fetch(env.url + '/api/community/summary')).status, 401);
  assert.equal((await fetch(env.url + '/server/community-host-store.ts')).status, 404);
  assert.equal((await fetch(env.url + '/assets/example.webp')).status, 200);
  assert.equal(env.calls.length, 0);
});

test('guest shared posts retain only a validated UUID when returning to the main-site login entrance', async t => {
  const env = await setup(t);
  const html = await (await fetch(env.url + '/')).text();
  const script = await (await fetch(env.url + '/community-entry-exchange.mjs')).text();
  const post = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  for (const hash of [`#/post/${post}`, '#/post/https://evil.example', '#/post/../admin', '#/community']) {
    const dom = new JSDOM(html, { url: origin + '/' + hash });
    try {
      await vm.runInNewContext(`(async () => {${script}\n})()`, { document: dom.window.document, location: { hash }, URL, URLSearchParams,
        fetch: () => assert.fail('a public share never creates a session without a main-site ticket') });
      assert.equal(dom.window.document.querySelector('a')!.href, hash === `#/post/${post}` ? `${main}/?post=${post}#/community` : main + '/#/community');
    } finally { dom.window.close(); }
  }
});

test('the handoff consumes its secret before exchange then returns to the shared post, with a safe home fallback', async t => {
  const env = await setup(t);
  const html = await (await fetch(env.url + '/community-enter')).text();
  const script = await (await fetch(env.url + '/community-entry-exchange.mjs')).text();
  const post = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ticket = 'a'.repeat(43);
  for (const suffix of [`&post=${post}`, '&post=https%3A%2F%2Fevil.example', `&post=${post}&post=${post}`, '']) {
    const hash = `#community-entry=${ticket}${suffix}`;
    const dom = new JSDOM(html, { url: origin + '/community-enter' + hash });
    const events: string[] = [];
    try {
      await vm.runInNewContext(`(async () => {${script}\n})()`, { document: dom.window.document, URL, URLSearchParams,
        location: { hash, pathname: '/community-enter', replace: (value: string) => events.push(value) },
        history: { replaceState: (_value: unknown, _title: string, value: string) => events.push('clear:' + value) },
        localStorage: { setItem: () => assert.fail('entry secrets must never enter storage') },
        sessionStorage: { setItem: () => assert.fail('entry secrets must never enter storage') },
        fetch: async (path: string, init: RequestInit) => {
          assert.deepEqual(events, ['clear:/community-enter']);
          assert.equal(path, '/api/community-entry'); assert.equal(init.credentials, 'same-origin');
          assert.deepEqual(JSON.parse(String(init.body)), { ticket });
          events.push('exchange'); return { ok: true };
        } });
      assert.deepEqual(events, ['clear:/community-enter', 'exchange', suffix === `&post=${post}` ? `/#/post/${post}` : '/#/community/home']);
    } finally { dom.window.close(); }
  }
});

test('a failed handoff keeps the shared destination on its retry link without redirecting or persisting the ticket', async t => {
  const env = await setup(t);
  const html = await (await fetch(env.url + '/community-enter')).text();
  const script = await (await fetch(env.url + '/community-entry-exchange.mjs')).text();
  const post = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', hash = '#community-entry=' + 'a'.repeat(43) + `&post=${post}`;
  const dom = new JSDOM(html, { url: origin + '/community-enter' + hash });
  try {
    await vm.runInNewContext(`(async () => {${script}\n})()`, { document: dom.window.document, URL, URLSearchParams,
      location: { hash, pathname: '/community-enter', replace: () => assert.fail('failed handoff must stay on recovery page') },
      history: { replaceState: () => {} }, fetch: async () => ({ ok: false, status: 403 }) });
    assert.equal(dom.window.document.querySelector('a')!.href, `${main}/?post=${post}#/community`);
    assert.match(dom.window.document.querySelector('[data-entry-status]')!.textContent!, /凭证已失效/);
  } finally { dom.window.close(); }
});

test('entry requires own Origin, custom header, binding and one-use ticket before setting host-only session cookie', async t => {
  const env = await setup(t);
  assert.equal((await env.exchange('r1', { Origin: main })).status, 403);
  assert.equal((await env.exchange('r1', { 'X-Reader-Request': '0' })).status, 403);
  assert.equal((await env.exchange('r1', { Cookie: '' })).status, 403);
  const response = await env.exchange('r1');
  assert.equal(response.status, 200);
  const session = response.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session=')) || '';
  assert.match(session, /HttpOnly/);
  assert.match(session, /Secure/);
  assert.match(session, /SameSite=Strict/);
  assert.ok(!session.includes('Domain='));
  const maxAge = Number(/(?:^|; )Max-Age=(\d+)(?:;|$)/.exec(session)?.[1]);
  assert.ok(maxAge >= 604798 && maxAge <= 604800, 'closing the browser must not discard a valid community login');
  assert.match(response.headers.getSetCookie().join(' '), /sansphase_community_handoff=.*Max-Age=0/);
  const cookie = session.split(';')[0];
  assert.equal((await fetch(env.url + '/', { headers: { cookie } })).status, 200);
  assert.equal((await fetch(env.url + '/api/manage/readers', { headers: { cookie } })).status, 404);
});

test('community login survives several idle days but revocation still clears its persistent cookie', async t => {
  const env = await setup(t);
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const entered = await env.exchange('r1');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  now += 6 * 24 * 60 * 60_000;
  const restored = await fetch(env.url + '/api/community/me', { headers: { cookie } });
  assert.equal(restored.status, 200);
  const persisted = restored.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session=')) || '';
  assert.match(persisted, /(?:^|; )Max-Age=86400(?:;|$)/, 'a restored cookie expires at the original login deadline, rather than another seven days');
  env.setUnavailable(true);
  const unavailable = await fetch(env.url + '/api/community/me', { headers: { cookie } });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('set-cookie'), null, 'temporary bridge errors must not log the user out');
  env.setUnavailable(false); env.setInvalid(true);
  const revoked = await fetch(env.url + '/api/community/me', { headers: { cookie } });
  assert.equal(revoked.status, 401);
  assert.match(revoked.headers.get('set-cookie') || '', /sansphase_community_session=;.*Max-Age=0/);
});

test('every protected request rechecks VIP and session revocation, bridge failure rejects with 503', async t => {
  const env = await setup(t);
  const entered = await env.exchange('r1');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  env.setVip(true);
  assert.equal((await (await fetch(env.url + '/api/community/me', { headers: { cookie } })).json()).viewer.vip, true);
  env.setVip(false);
  assert.equal((await (await fetch(env.url + '/api/community/me', { headers: { cookie } })).json()).viewer.vip, false);
  env.setUnavailable(true);
  assert.equal((await fetch(env.url + '/api/community/me', { headers: { cookie } })).status, 503);
  env.setUnavailable(false);
  env.setInvalid(true);
  assert.equal((await fetch(env.url + '/api/community/me', { headers: { cookie } })).status, 401);
  env.setInvalid(false);
  assert.equal((await fetch(env.url + '/api/community/me', { headers: { cookie } })).status, 401);
});

test('passive community GET keeps fresh authority checks without renewing the host idle session', async t => {
  const env = await setup(t);
  let now = Date.now();
  const enteredAt = now;
  t.mock.method(Date, 'now', () => now);
  const entered = await env.exchange('r1');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  const token = cookie.slice(cookie.indexOf('=') + 1);
  const headers = { cookie, 'X-Community-Passive': '1' };
  now += 20 * 60_000;
  env.setVip(true);
  assert.equal((await (await fetch(env.url + '/api/community/me', { headers })).json()).viewer.vip, true);
  assert.equal(env.store.session(token)!.touchedAt, enteredAt);
  now += 5 * 60_000;
  env.setVip(false);
  assert.equal((await (await fetch(env.url + '/api/community/me', { headers })).json()).viewer.vip, false);
  assert.equal(env.store.session(token)!.touchedAt, enteredAt);
  assert.equal(env.calls.filter(call => call.operation === 'session').length, 2, 'each passive request must recheck the main-site session');
  now = enteredAt + hostSessionIdleMs;
  const expired = await fetch(env.url + '/api/community/me', { headers });
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).code, 'COMMUNITY_ENTRY_REQUIRED');
  assert.equal(env.store.session(token), null);
  assert.equal(env.calls.filter(call => call.operation === 'session').length, 2, 'an idle-expired session is rejected locally before any source request');
});

test('POST, HEAD, normal GET and non-community requests cannot use the passive marker to alter idle behavior', async t => {
  const env = await setup(t);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const entered = await env.exchange('r1');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  const token = cookie.slice(cookie.indexOf('=') + 1);
  const cases = [
    { path: '/api/community/me', method: 'GET', marker: '' },
    { path: '/api/community/me', method: 'GET', marker: 'true' },
    { path: '/api/community/me', method: 'GET', marker: '01' },
    { path: '/api/community/me', method: 'GET', marker: '1, 1' },
    { path: '/api/community/me', method: 'POST', marker: '1' },
    { path: '/api/community/me', method: 'HEAD', marker: '1' },
    { path: '/api/reader/session', method: 'GET', marker: '1' },
    { path: '/api/content?view=bootstrap', method: 'GET', marker: '1' },
    { path: '/', method: 'GET', marker: '1' },
  ];
  for (const item of cases) {
    now += 60_000;
    const response = await fetch(env.url + item.path, { method: item.method, headers: { cookie, 'X-Community-Passive': item.marker } });
    assert.equal(response.status, 200, `${item.method} ${item.path} ${item.marker}`);
    assert.equal(env.store.session(token)!.touchedAt, now, `${item.method} ${item.path} is ordinary activity`);
  }
  assert.equal(env.calls.filter(call => call.operation === 'session').length, cases.length);
});

test('passive requests still fail closed after bridge outage, main-site revocation or local purge', async t => {
  const env = await setup(t);
  let now = Date.now();
  const enteredAt = now;
  t.mock.method(Date, 'now', () => now);
  const entered = await env.exchange('r1');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  const token = cookie.slice(cookie.indexOf('=') + 1), headers = { cookie, 'X-Community-Passive': '1' };
  now += 60_000;
  env.setUnavailable(true);
  assert.equal((await fetch(env.url + '/api/community/me', { headers })).status, 503);
  assert.equal(env.store.session(token)!.touchedAt, enteredAt);
  env.setUnavailable(false); env.setInvalid(true);
  assert.equal((await fetch(env.url + '/api/community/me', { headers })).status, 401);
  env.setInvalid(false);
  assert.equal((await fetch(env.url + '/api/community/me', { headers })).status, 401);
  assert.equal(env.store.session(token), null);
  const replacement = await env.exchange('r1');
  const newCookie = replacement.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  env.store.markReaderDeleted('r1');
  assert.equal((await fetch(env.url + '/api/community/me', { headers: { cookie: newCookie, 'X-Community-Passive': '1' } })).status, 401);
});

test('community image and avatar GET never renew idle while uploads and unrecognized webp paths remain active', async t => {
  const env = await setup(t);
  let now = Date.now();
  const enteredAt = now;
  t.mock.method(Date, 'now', () => now);
  const entered = await env.exchange('r1');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  const token = cookie.slice(cookie.indexOf('=') + 1);
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const media = [`images/${id}.webp`, `images/${id}.thumb.webp`, 'avatar/10001.webp?v=new', 'profile/avatar/pending.webp', `manage/profiles/${id}/avatar.webp`];
  for (const path of media) {
    now += 60_000;
    assert.equal((await fetch(env.url + '/api/community/' + path, { headers: { cookie } })).status, 200);
    assert.equal(env.store.session(token)!.touchedAt, enteredAt, path);
  }
  const activity = [
    { path: 'images', method: 'POST' }, { path: 'profile/avatar', method: 'POST' }, { path: 'profile/background', method: 'POST' },
    { path: `images/${id}.webp`, method: 'POST' }, { path: 'unrecognized.webp', method: 'GET' },
    { path: 'images/not-a-uuid.webp', method: 'GET' }, { path: `profile/background/${id}.webp`, method: 'GET' },
  ];
  for (const { path, method } of activity) {
    now += 60_000;
    assert.equal((await fetch(env.url + '/api/community/' + path, { method, headers: { cookie, ...(method === 'POST' ? { 'X-Community-Passive': '1' } : {}) } })).status, 200);
    assert.equal(env.store.session(token)!.touchedAt, now, `${method} ${path}`);
  }
  assert.equal(env.calls.filter(call => call.operation === 'session').length, media.length + activity.length, 'all media and activity requests still recheck authority');
});

test('a passive source response cannot resurrect a host session that expired while authorization was pending', async t => {
  const env = await setup(t);
  let now = Date.now();
  const enteredAt = now;
  t.mock.method(Date, 'now', () => now);
  const entered = await env.exchange('r1');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  now += 20 * 60_000;
  const gate = env.holdNextSessionResponse();
  const request = fetch(env.url + '/api/community/me', { headers: { cookie, 'X-Community-Passive': '1' } });
  await gate.waiting;
  now = enteredAt + hostSessionIdleMs;
  gate.release();
  assert.equal((await request).status, 401);
});

test('concurrent requests cannot share identity context and refresh needs the original session', async t => {
  const env = await setup(t);
  const responses = await Promise.all(['slow', 'fast'].map(id => env.exchange(id)));
  const cookies = responses.map(value => value.headers.getSetCookie().find(cookie => cookie.startsWith('sansphase_community_session='))!.split(';')[0]);
  const bodies = await Promise.all(cookies.map(async cookie => (await fetch(env.url + '/api/community/me', { headers: { cookie } })).json()));
  assert.deepEqual(bodies.map(value => value.viewer.id), ['slow', 'fast']);
  assert.equal(env.access.current(), null);
});

test('a next request sees changed VIP while an earlier verified source response is still pending', { timeout: 5000 }, async t => {
  const env = await setup(t), entered = await env.exchange('reader');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  env.setVip(true); const gate = env.holdNextSessionResponse();
  const earlier = fetch(env.url + '/api/community/me', { headers: { cookie } }); await gate.waiting;
  env.setVip(false);
  const nextPath = '/api/community/me?fresh=1', arrived = env.waitForRequest(nextPath);
  const later = fetch(env.url + nextPath, { headers: { cookie } });
  await arrived; gate.release();
  try {
    const current = await later; assert.equal(current.status, 200);
    assert.equal((await current.json()).viewer.vip, false, 'a new HTTP request cannot inherit the older pending VIP snapshot');
    assert.equal((await (await earlier).json()).viewer.vip, true);
    assert.equal(env.calls.filter(call => call.operation === 'session').length, 2);
  } finally { gate.release(); }
});

test('a next request rejects main-site logout while an earlier verified source response is still pending', { timeout: 5000 }, async t => {
  const env = await setup(t), entered = await env.exchange('reader');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  const gate = env.holdNextSessionResponse();
  const earlier = fetch(env.url + '/api/community/me', { headers: { cookie } }); await gate.waiting;
  env.setInvalid(true);
  const nextPath = '/api/community/me?fresh=1', arrived = env.waitForRequest(nextPath);
  const later = fetch(env.url + nextPath, { headers: { cookie } });
  await arrived; gate.release();
  try {
    assert.equal((await later).status, 401, 'main-site revocation applies even before the older network promise resolves');
    assert.equal((await earlier).status, 401, 'the old response cannot resurrect the now-revoked local session');
    assert.equal(env.calls.filter(call => call.operation === 'session').length, 2);
  } finally { gate.release(); }
});

test('new main-site handoff always uses exchange page even when an older host cookie is valid or revoked', async t => {
  const env = await setup(t);
  const response = await env.exchange('old-reader');
  const oldCookie = response.headers.getSetCookie().find(cookie => cookie.startsWith('sansphase_community_session='))!.split(';')[0];
  const before = env.calls.length;
  env.setUnavailable(true);
  const page = await fetch(env.url + '/community-enter', { headers: { Cookie: oldCookie } });
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('community-entry-exchange.mjs'));
  assert.equal(env.calls.length, before, 'handoff page must not depend on an older account or bridge availability');
  env.setUnavailable(false);
  const replaced = await env.exchange('new-reader', { Cookie: `sansphase_community_handoff=valid-binding; ${oldCookie}` });
  const newCookie = replaced.headers.getSetCookie().find(cookie => cookie.startsWith('sansphase_community_session='))!.split(';')[0];
  assert.equal((await (await fetch(env.url + '/api/community/me', { headers: { Cookie: newCookie } })).json()).viewer.id, 'new-reader');
  assert.equal((await fetch(env.url + '/api/community/me', { headers: { Cookie: oldCookie } })).status, 401);
});

test('purge is signed, persists nonce replay defense and never accepts browser session as authority', async t => {
  const env = await setup(t);
  const path = '/api/community-identity/purge';
  const body = JSON.stringify({ operation: 'purge', input: { readerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
  assert.equal((await fetch(env.url + path, { method: 'POST', body })).status, 403);
  const headers = signIdentityRequest({ secret, method: 'POST', path, body });
  assert.equal((await fetch(env.url + path, { method: 'POST', headers, body })).status, 200);
  assert.equal(env.purged(), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal((await fetch(env.url + path, { method: 'POST', headers, body })).status, 403);
});

test('long-lived tea-room requests establish a fresh context on every operation and never renew idle time by checking', async t => {
  const env = await setup(t);
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const entered = await env.exchange('reader');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  const token = cookie.slice(cookie.indexOf('=') + 1), createdAt = now;
  const req = new IncomingMessage(new Socket()); req.method = 'GET'; req.url = '/api/teahouse/socket.io/'; req.headers.cookie = cookie;
  now += 20 * 60_000; env.setVip(true);
  assert.equal(await env.access.runWithSession(req, async () => env.access.current(req)!.identity.viewer.vip), true);
  assert.equal(env.access.current(req), null, 'the operation must not leave request context on a long-lived socket');
  env.setVip(false);
  assert.equal(await env.access.runWithSession(req, async () => env.access.current(req)!.identity.viewer.vip), false);
  assert.equal(env.store.session(token)?.touchedAt, createdAt);
  now += 5 * 60_000; env.access.touchSession(req);
  assert.equal(env.store.session(token)?.touchedAt, now, 'only the explicit successful-action callback renews idle time');
  now += hostSessionIdleMs;
  await assert.rejects(env.access.runWithSession(req, async () => true), { status: 401 });
  assert.throws(() => env.access.touchSession(req), { status: 401 }, 'an expired connection cannot renew itself');
});

test('concurrent tea-room checks on the same request isolate pending identity and reject revocation during an awaited callback', async t => {
  const env = await setup(t), entered = await env.exchange('reader');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  const req = new IncomingMessage(new Socket()); req.method = 'GET'; req.url = '/api/teahouse/socket.io/'; req.headers.cookie = cookie;
  const gate = env.holdNextSessionResponse(); env.setVip(true);
  const first = env.access.runWithSession(req, async () => env.access.current(req)!.identity.viewer.vip); await gate.waiting;
  env.setVip(false);
  assert.equal(await env.access.runWithSession(req, async () => env.access.current(req)!.identity.viewer.vip), false);
  gate.release(); assert.equal(await first, true);
  await assert.rejects(env.access.runWithSession(req, async () => {
    env.store.revokeSession(cookie.slice(cookie.indexOf('=') + 1)); await Promise.resolve(); return 'old-result';
  }), { status: 401 });
});

test('tea-room authority outages fail closed without treating an unavailable session as logged out', async t => {
  const env = await setup(t), entered = await env.exchange('reader');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  const req = new IncomingMessage(new Socket()); req.method = 'GET'; req.url = '/api/teahouse/socket.io/'; req.headers.cookie = cookie;
  env.setUnavailable(true); await assert.rejects(env.access.runWithSession(req, async () => true), { status: 503 });
  assert.ok(env.store.session(cookie.slice(cookie.indexOf('=') + 1)));
  env.setUnavailable(false); env.setInvalid(true);
  await assert.rejects(env.access.runWithSession(req, async () => true), { status: 401 });
  env.setInvalid(false);
  await assert.rejects(env.access.runWithSession(req, async () => true), { status: 401 });
});

test('tea-room checks cap concurrent same-session work and release their slots without reusing identity', { timeout: 20_000 }, async t => {
  const f = await setup(t), entered = await f.exchange('reader');
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  const request = () => { const req = new IncomingMessage(new Socket()); req.headers.cookie = cookie; return req; };
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const pending = Array.from({ length: 8 }, () => f.access.runWithSession(request(), async () => { await gate; return true; }));
  try { await assert.rejects(f.access.runWithSession(request(), async () => true), { status: 429 }); }
  finally { release(); }
  assert.deepEqual(await Promise.all(pending), Array(8).fill(true));
  f.setVip(true);
  assert.equal(await f.access.runWithSession(request(), async () => f.access.current()!.identity.viewer.vip), true);
  f.setVip(false);
  assert.equal(await f.access.runWithSession(request(), async () => f.access.current()!.identity.viewer.vip), false);
});
