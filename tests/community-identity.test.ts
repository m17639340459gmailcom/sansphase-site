import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createIdentityAuthority } from '../server/community-identity-authority.ts';
import { prepareIdentityStore, createIdentityStore } from '../server/community-identity-store.ts';
import { createIdentityClient, signIdentityRequest, verifyIdentityRequest } from '../server/community-identity-protocol.ts';

const secret = 'bridge-test-key-with-at-least-32-characters';
const encryptionKey = 'authority-only-state-key-at-least-32-characters';
const token = 'private.session.token';
const origin = 'https://www.sansphase.com';
const communityOrigin = 'https://community.sansphase.com';
const path = '/api/community-identity/bridge';
const reader = { id: 'reader-a', uid: '10001', nickname: '测试读者', role: 'reader' as const, signature: '已审核签名', avatar: null, vip: true, vipStartedAt: '2026-10-01T00:00:00Z', vipUntil: '2026-12-01T00:00:00Z', email: 'private@example.invalid', phone: '13800138000', pendingSignature: '未审核签名' };
const person = { name: reader.nickname, uid: reader.uid, avatar: null, vip: true, joinedAt: '2026-01-01T00:00:00Z', bio: reader.signature };

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-identity-'));
  prepareIdentityStore(directory);
  const state = { at: Date.now(), enabled: true, vip: true, unavailable: false, purges: [] as string[] };
  const authority = createIdentityAuthority({ directory, siteOrigin: origin, communityOrigin, ownerId: 'owner-a', secret, stateEncryptionKey: encryptionKey, now: () => state.at,
    readerIdentity: async req => { if (state.unavailable) throw Error('private backend details'); return state.enabled && req.headers.cookie === `sansphase_reader_session=${token}` ? { ...reader, vip: state.vip } : null; },
    ownerIdentity: async req => req.headers.cookie === 'sansphase_author_session=owner.session.token' ? { name: '作者' } : null,
    people: async authors => new Map(authors.filter(author => author.id === reader.id).map(author => [`${author.kind}:${author.id}`, { ...person, vip: state.vip }])),
    findMember: async uid => uid === reader.uid ? { kind: 'reader', id: reader.id } : null,
    findByNames: async names => new Map(names.filter(name => name === reader.nickname).map(name => [name, { kind: 'reader' as const, id: reader.id }])),
    avatar: async () => Buffer.from('approved avatar'),
    purgeRemote: async id => { state.purges.push(id); },
  });
  const server = http.createServer((req, res) => { void (req.url === '/api/community-entry' ? authority.handleEntry(req, res) : authority.handleBridge(req, res)); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const local = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); authority.close(); await rm(directory, { recursive: true, force: true }); });
  const entry = async (cookie = `sansphase_reader_session=${token}`) => {
    const response = await fetch(local + '/api/community-entry', { method: 'POST', headers: { Origin: origin, 'X-Reader-Request': '1', Cookie: cookie } });
    const body = await response.json() as { url?: string; error?: string };
    const binding = /sansphase_community_handoff=([^;]+)/.exec(response.headers.get('set-cookie') || '')?.[1] || '';
    return { response, body, binding, ticket: body.url ? new URL(body.url).hash.slice('#community-entry='.length) : '' };
  };
  const bridge = async (operation: string, input: Record<string, unknown>, headers?: Record<string, string>) => {
    const body = JSON.stringify({ operation, input });
    return fetch(local + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers || signIdentityRequest({ secret, method: 'POST', path, body, timestamp: String(state.at) }) }, body });
  };
  const exchange = async () => { const issued = await entry(); const response = await bridge('exchange', { ticket: issued.ticket, binding: issued.binding }); assert.equal(response.status, 200); return await response.json() as { sessionRef: string; identity: typeof reader }; };
  return { authority, directory, state, local, entry, bridge, exchange };
}

test('bridge signature binds method, path and exact body, rejects stale requests and replay', () => {
  const at = Date.now(), body = '{"operation":"session","input":{}}';
  const headers = signIdentityRequest({ secret, method: 'POST', path, body, timestamp: String(at) });
  const used = new Set<string>();
  const consumeNonce = (nonce: string) => { if (used.has(nonce)) return false; used.add(nonce); return true; };
  for (const changed of [{ method: 'GET' }, { path: path + '/extra' }, { body: body + ' ' }]) assert.throws(() => verifyIdentityRequest({ secret, method: 'POST', path, body, headers, now: at, consumeNonce, ...changed }), { status: 401 });
  assert.throws(() => verifyIdentityRequest({ secret, method: 'POST', path, body, headers, now: at + 60_001, consumeNonce }), { status: 401 });
  verifyIdentityRequest({ secret, method: 'POST', path, body, headers, now: at, consumeNonce });
  assert.throws(() => verifyIdentityRequest({ secret, method: 'POST', path, body, headers, now: at, consumeNonce }), { status: 401 });
  assert.throws(() => verifyIdentityRequest({ secret, method: 'POST', path, body, headers: { ...headers, 'x-community-signature': [headers['x-community-signature'], headers['x-community-signature']] }, now: at, consumeNonce }), { status: 401 });
});

test('private identity database preparation is explicit, does not touch content.db, and limits survive restart', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'identity-explicit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(resolve(directory, 'content.db'), 'untouched authoritative data');
  assert.throws(() => createIdentityStore({ directory, stateEncryptionKey: encryptionKey }), /explicitly prepared/);
  prepareIdentityStore(directory);
  const first = createIdentityStore({ directory, stateEncryptionKey: encryptionKey }), at = Date.now();
  for (let i = 0; i < 8; i++) assert.equal(first.limit('member-limit', 8, 60_000, at), true);
  first.close();
  const next = createIdentityStore({ directory, stateEncryptionKey: encryptionKey });
  try { assert.equal(next.limit('member-limit', 8, 60_000, at + 1), false); assert.equal(next.limit('member-limit', 8, 60_000, at + 60_001), true); } finally { next.close(); }
  assert.equal(await readFile(resolve(directory, 'content.db'), 'utf8'), 'untouched authoritative data');
});

test('identity preparation refuses unexpected storage types before changing authoritative files', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'identity-storage-types-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ordinaryFile = resolve(root, 'account-data');
  await writeFile(ordinaryFile, 'unchanged account data');
  assert.throws(() => prepareIdentityStore(ordinaryFile), /real directory/i);
  assert.equal(await readFile(ordinaryFile, 'utf8'), 'unchanged account data');
  const directory = resolve(root, 'data'); await mkdir(directory);
  await mkdir(resolve(directory, 'community-identity.db'));
  assert.throws(() => prepareIdentityStore(directory), /regular file/i);
  assert.throws(() => createIdentityStore({ directory, stateEncryptionKey: encryptionKey }), /regular file/i);
});

test('identity preparation and startup refuse directory and database links without following them', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'identity-storage-links-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'data'); await mkdir(directory);
  prepareIdentityStore(directory);
  const originalFile = resolve(directory, 'community-identity.db');
  const originalBytes = await readFile(originalFile);
  const directoryLink = resolve(root, 'linked-directory');
  try { await symlink(directory, directoryLink, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (process.platform === 'win32' && error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') { t.skip('Directory links unavailable on this Windows account.'); return; }
    throw error;
  }
  for (const linked of [directoryLink, resolve(directoryLink, 'nested')]) assert.throws(() => prepareIdentityStore(linked), /symlink/i);
  assert.throws(() => createIdentityStore({ directory: directoryLink, stateEncryptionKey: encryptionKey }), /symlink/i);
  assert.deepEqual(await readFile(originalFile), originalBytes);
  const other = resolve(root, 'other'); await mkdir(other);
  await chmod(originalFile, 0o640);
  const originalMode = (await lstat(originalFile)).mode;
  try { await symlink(originalFile, resolve(other, 'community-identity.db'), 'file'); }
  catch (error) {
    if (process.platform === 'win32' && error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') { t.diagnostic('File links unavailable; directory-link protection was checked.'); return; }
    throw error;
  }
  assert.throws(() => prepareIdentityStore(other), /symlink/i);
  assert.throws(() => createIdentityStore({ directory: other, stateEncryptionKey: encryptionKey }), /symlink/i);
  assert.equal((await lstat(originalFile)).mode, originalMode);
  assert.deepEqual(await readFile(originalFile), originalBytes);
});

test('entry requires real main-site origin, request header and an existing real session', async t => {
  const f = await fixture(t);
  for (const headers of [{ Origin: communityOrigin, 'X-Reader-Request': '1' }, { Origin: origin }]) {
    const response = await fetch(f.local + '/api/community-entry', { method: 'POST', headers: { ...headers, Cookie: `sansphase_reader_session=${token}` } });
    assert.equal(response.status, 403);
  }
  assert.equal((await f.entry('')).response.status, 401);
  const issued = await f.entry();
  assert.equal(issued.response.status, 200);
  assert.ok(issued.body.url?.startsWith(communityOrigin + '/community-enter#community-entry='));
  assert.ok(!issued.body.url?.includes(token));
  const cookie = issued.response.headers.get('set-cookie') || '';
  for (const required of ['Domain=sansphase.com', 'Path=/api/community-entry', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=60']) assert.ok(cookie.includes(required));
  assert.equal(issued.response.headers.get('cache-control'), 'private, no-store');
});

test('exchange requires binding, permits only one consumer, and emits no original JWT or private profile fields', async t => {
  const f = await fixture(t), issued = await f.entry();
  assert.equal((await f.bridge('exchange', { ticket: issued.ticket, binding: 'invalid-binding' })).status, 401);
  const other = await f.entry();
  assert.equal((await f.bridge('exchange', { ticket: issued.ticket, binding: other.binding })).status, 401, 'another browser entry binding cannot exchange this ticket');
  const outcomes = await Promise.all([f.bridge('exchange', { ticket: issued.ticket, binding: issued.binding }), f.bridge('exchange', { ticket: issued.ticket, binding: issued.binding })]);
  assert.deepEqual(outcomes.map(response => response.status).sort(), [200, 401]);
  const response = outcomes.find(item => item.status === 200)!;
  const value = await response.text();
  for (const privateValue of [token, reader.email, reader.phone, reader.pendingSignature]) assert.ok(!value.includes(privateValue));
  const db = new DatabaseSync(resolve(f.directory, 'community-identity.db'), { readOnly: true });
  try { assert.ok(!JSON.stringify(db.prepare('SELECT * FROM identity_sessions').all()).includes(token)); } finally { db.close(); }
  for (const file of ['community-identity.db', 'community-identity.db-wal']) {
    const contents = await readFile(resolve(f.directory, file)).catch(() => Buffer.alloc(0));
    assert.ok(!contents.includes(Buffer.from(token)), 'persistent SQLite files must not contain raw login cookies');
  }
});

test('tickets expire after sixty seconds and a revoked original login cannot be exchanged', async t => {
  const f = await fixture(t), first = await f.entry();
  f.state.at += 60_001;
  assert.equal((await f.bridge('exchange', { ticket: first.ticket, binding: first.binding })).status, 401);
  const second = await f.entry(); f.state.enabled = false;
  assert.equal((await f.bridge('exchange', { ticket: second.ticket, binding: second.binding })).status, 401);
});

test('every bridge operation revalidates original identity and current VIP; faults are 503', async t => {
  const f = await fixture(t), { sessionRef } = await f.exchange();
  f.state.vip = false;
  let response = await f.bridge('session', { sessionRef });
  assert.equal(response.status, 200); assert.equal((await response.json()).viewer.vip, false);
  f.state.unavailable = true;
  response = await f.bridge('people', { sessionRef, authors: [{ kind: 'reader', id: reader.id }] });
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('private backend details'));
  f.state.unavailable = false; f.state.enabled = false;
  for (const [operation, input] of [['session', {}], ['people', { authors: [] }], ['member', { uid: reader.uid }], ['names', { names: [] }], ['avatar', { uid: reader.uid }]] as const) assert.equal((await f.bridge(operation, { sessionRef, ...input })).status, 401);
});

test('sessions enforce idle and absolute expiry and bridge replay survives database reopening', async t => {
  const f = await fixture(t), { sessionRef } = await f.exchange();
  f.state.at += 30 * 60_000 + 1;
  assert.equal((await f.bridge('session', { sessionRef })).status, 401);
  const second = await f.exchange();
  for (let i = 0; i < 24; i++) { f.state.at += 29 * 60_000; assert.equal((await f.bridge('session', { sessionRef: second.sessionRef })).status, 200); }
  f.state.at += 25 * 60_000;
  assert.equal((await f.bridge('session', { sessionRef: second.sessionRef })).status, 401);
  const nonce = 'persistent-replay-nonce-with-32-characters';
  const store = createIdentityStore({ directory: f.directory, stateEncryptionKey: encryptionKey });
  assert.equal(store.consumeNonce(nonce, f.state.at + 120_000), true); store.close();
  const reopened = createIdentityStore({ directory: f.directory, stateEncryptionKey: encryptionKey });
  try { assert.equal(reopened.consumeNonce(nonce, f.state.at + 120_000), false); } finally { reopened.close(); }
});

test('entry rate limits persist and bridge rejects unknown operations, malformed input and unsigned requests', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.local + path, { method: 'POST', body: '{}' })).status, 401);
  for (const [operation, input] of [['query-payload', {}], ['session', { sessionRef: 'bad' }], ['people', { sessionRef: 'bad', authors: [{ kind: 'owner', id: 'forged' }] }]] as const) assert.ok([400, 401].includes((await f.bridge(operation, { ...input })).status));
  let limited = false;
  for (let i = 0; i < 15; i++) if ((await f.entry()).response.status === 429) { limited = true; break; }
  assert.ok(limited);
  const large = 'x'.repeat(64 * 1024 + 1);
  assert.equal((await fetch(f.local + path, { method: 'POST', headers: signIdentityRequest({ secret, method: 'POST', path, body: large, timestamp: String(f.state.at) }), body: large })).status, 413);
  const malformed = '{not-json', headers = signIdentityRequest({ secret, method: 'POST', path, body: malformed, timestamp: String(f.state.at) });
  assert.equal((await fetch(f.local + path, { method: 'POST', headers, body: malformed })).status, 400);
  assert.equal((await fetch(f.local + path, { method: 'POST', headers, body: malformed })).status, 401);
});

test('approved profiles, UID lookup, mentions and avatars require a session and owner ID stays server-controlled', async t => {
  const f = await fixture(t), { sessionRef } = await f.exchange();
  const response = await f.bridge('people', { sessionRef, authors: [{ kind: 'reader', id: reader.id }] });
  assert.deepEqual(await response.json(), [[`reader:${reader.id}`, person]]);
  assert.deepEqual(await (await f.bridge('member', { sessionRef, uid: reader.uid })).json(), { kind: 'reader', id: reader.id });
  assert.deepEqual(await (await f.bridge('names', { sessionRef, names: [reader.nickname] })).json(), [[reader.nickname, { kind: 'reader', id: reader.id }]]);
  assert.deepEqual(await (await f.bridge('avatar', { sessionRef, uid: reader.uid })).json(), { base64: Buffer.from('approved avatar').toString('base64') });
  const issued = await f.entry('sansphase_author_session=owner.session.token');
  const owner = await (await f.bridge('exchange', { ticket: issued.ticket, binding: issued.binding, ownerId: 'forged' })).json();
  assert.deepEqual(owner.identity.viewer, { kind: 'owner', id: 'owner-a', name: '作者', vip: true });
  await f.authority.purgeReaderData(reader.id); assert.deepEqual(f.state.purges, [reader.id]);
});

test('identity client only accepts a fixed HTTPS peer, forbids redirects, limits response size and maps transport failures to 503', async () => {
  for (const bad of ['http://www.sansphase.com', 'https://user:pass@www.sansphase.com', 'https://www.sansphase.com/path', 'https://www.sansphase.com/?x=1']) assert.throws(() => createIdentityClient({ origin: bad, secret }));
  const client = createIdentityClient({ origin, secret, fetch: async (_input, init) => { assert.equal(init?.redirect, 'error'); return new Response(JSON.stringify({ ok: true }), { status: 200 }); } });
  assert.deepEqual(await client.request('session', { sessionRef: 'opaque' }), { ok: true });
  const failed = createIdentityClient({ origin, secret, fetch: async () => { throw Error('private network detail'); } });
  await assert.rejects(failed.request('session', {}), { status: 503 });
  const oversized = createIdentityClient({ origin, secret, fetch: async () => new Response('a'.repeat(2 * 1024 * 1024 + 1)) });
  await assert.rejects(oversized.request('session', {}), { status: 503 });
});
