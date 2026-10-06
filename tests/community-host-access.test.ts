import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommunityHostStore, prepareCommunityHostDirectory } from '../server/community-host-store.ts';
import { createCommunityHostAccess } from '../server/community-host-access.ts';
import { signIdentityRequest } from '../server/community-identity-protocol.ts';

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
  assert.equal((await fetch(env.url + '/api/community/summary')).status, 401);
  assert.equal((await fetch(env.url + '/server/community-host-store.ts')).status, 404);
  assert.equal((await fetch(env.url + '/assets/example.webp')).status, 200);
  assert.equal(env.calls.length, 0);
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
  assert.ok(!session.includes('Max-Age='));
  assert.match(response.headers.getSetCookie().join(' '), /sansphase_community_handoff=.*Max-Age=0/);
  const cookie = session.split(';')[0];
  assert.equal((await fetch(env.url + '/', { headers: { cookie } })).status, 200);
  assert.equal((await fetch(env.url + '/api/manage/readers', { headers: { cookie } })).status, 404);
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
