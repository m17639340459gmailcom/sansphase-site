import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Payload } from 'payload';
import { createPreviewServer } from '../server.mjs';
import { createCommunityDirectory } from '../server/community-runtime.ts';
import { createIdentityAuthority } from '../server/community-identity-authority.ts';
import { prepareIdentityStore } from '../server/community-identity-store.ts';
import { createIdentityClient, signIdentityRequest } from '../server/community-identity-protocol.ts';
import { prepareCommunityHostDirectory } from '../server/community-host-store.ts';
import { createCommunityHostRuntime } from '../server/community-host-runtime.ts';

const main = 'https://www.sansphase.com', community = 'https://community.sansphase.com';
const secret = 'avatar-cache-bridge-secret-with-at-least-32-characters';
const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const readerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const firstVersion = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const nextVersion = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
type Row = { id: string; nickname: string; avatar: string | null; disabled: boolean; _verified: boolean };
type Gate = { started: () => void; held: Promise<void> };
const gate = () => {
  let started!: () => void, release!: () => void;
  const waiting = new Promise<void>(done => { started = done; });
  const held = new Promise<void>(done => { release = done; });
  return { started, held, waiting, release };
};
let template: string;
test.before(async () => { template = await mkdtemp(resolve(tmpdir(), 'avatar-cache-template-')); await prepareCommunityHostDirectory(template); });
test.after(() => rm(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

async function fixture(t: test.TestContext, legacy = false) {
  const base = await mkdtemp(resolve(tmpdir(), 'approved-avatar-cache-'));
  const directory = resolve(base, 'community'), mainDirectory = resolve(base, 'main'), root = resolve(base, 'public');
  await mkdir(directory); await mkdir(resolve(directory, 'uploads')); await mkdir(mainDirectory); await mkdir(resolve(mainDirectory, 'uploads')); await mkdir(root);
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  await copyFile(resolve(template, 'community-host.db'), resolve(directory, 'community-host.db'));
  await writeFile(resolve(root, 'index.html'), '<!doctype html><main id="app"></main>');
  prepareIdentityStore(mainDirectory);
  const row: Row = { id: readerId, nickname: '读者', avatar: firstVersion, disabled: false, _verified: true };
  const rows = new Map<string, Row>([['10001', row]]);
  const state = { enabled: true, unavailable: false, brand: firstVersion as string | null, sourceReads: 0, brandReads: 0, sourceSessionChecks: 0 };
  await writeFile(resolve(mainDirectory, 'uploads', `reader-avatar-${firstVersion}.webp`), 'reader-first');
  await writeFile(resolve(mainDirectory, 'uploads', `reader-avatar-${nextVersion}.webp`), 'reader-next');
  let sourceGate: Gate | null = null, clientGate: Gate | null = null;
  let override: { status: number; value: unknown } | null = null;
  const payload = { find: async (options: { where: { id?: { equals?: string; in?: string[] } } }) => ({ docs: [...rows.values()].filter(item => {
    const id = options.where.id; return !id || id.equals === item.id || id.in?.includes(item.id);
  }).map(item => ({ ...item })) }) } as unknown as Payload;
  const source = createCommunityDirectory({ payload, directory: mainDirectory, authorId: ownerId, ownerName: async () => '作者',
    uidStore: { get: id => [...rows].find(([, item]) => item.id === id)?.[0] || '', readerId: uid => rows.get(uid)?.id || null },
    ownerAvatar: { current: async () => state.brand, read: async id => { state.brandReads++; return Buffer.from('brand-' + id); } } });
  const holdSource = async () => { if (sourceGate) { const waiting = sourceGate; sourceGate = null; waiting.started(); await waiting.held; } };
  const authority = createIdentityAuthority({ directory: mainDirectory, siteOrigin: main, communityOrigin: community, ownerId, secret, stateEncryptionKey: 'avatar-cache-main-only-state-encryption-key',
    readerIdentity: async req => { state.sourceSessionChecks++; if (state.unavailable) throw Error('source unavailable'); return state.enabled && req.headers.cookie === 'sansphase_reader_session=reader.token' ? { id: readerId, uid: '10001', nickname: row.nickname, avatar: row.avatar, signature: '' } : null; },
    ownerIdentity: async () => null, people: source.people, findMember: source.findMember, findByNames: source.findByNames,
    avatar: async uid => { state.sourceReads++; const result = await source.avatar(uid); await holdSource(); return result; },
    ...(!legacy ? { approvedAvatar: async (uid: string, knownVersion: string | null) => {
      const result = await source.approvedAvatar(uid, knownVersion);
      if (result && 'bytes' in result) state.sourceReads++;
      await holdSource(); return result;
    } } : {}),
  });
  const mainServer = createServer((req, res) => { void (req.url === '/api/community-entry' ? authority.handleEntry(req, res) : authority.handleBridge(req, res)); });
  await new Promise<void>(done => mainServer.listen(0, '127.0.0.1', done));
  const localMain = `http://127.0.0.1:${(mainServer.address() as { port: number }).port}`;
  const messages: { input: Record<string, unknown>; status: number; value: unknown; bytes: number }[] = [];
  let sessionRef = '';
  const client = createIdentityClient({ origin: main, secret, fetch: async (input, options) => {
    const body = JSON.parse(String(options?.body)) as { operation: string; input: Record<string, unknown> };
    let response = await fetch(localMain + new URL(String(input)).pathname, options);
    if (body.operation === 'exchange' && response.ok) sessionRef = (await response.clone().json()).sessionRef;
    if (body.operation === 'avatar') {
      if (override) { const injected = override; override = null; response = new Response(JSON.stringify(injected.value), { status: injected.status, headers: { 'Content-Type': 'application/json' } }); }
      const text = await response.clone().text();
      messages.push({ input: body.input, status: response.status, value: JSON.parse(text), bytes: Buffer.byteLength(text) });
      if (clientGate) { const waiting = clientGate; clientGate = null; waiting.started(); await waiting.held; }
    }
    return response;
  } });
  const runtime = createCommunityHostRuntime({ directory, siteOrigin: community, mainSiteOrigin: main, bridgeSecret: secret, authorId: ownerId }, client);
  const server = createPreviewServer({ ...runtime, root });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => { sourceGate = null; clientGate = null; await new Promise<void>(done => server.close(() => done())); await new Promise<void>(done => mainServer.close(() => done())); authority.close(); await runtime.close(); await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const issued = await fetch(localMain + '/api/community-entry', { method: 'POST', headers: { Origin: main, 'X-Reader-Request': '1', Cookie: 'sansphase_reader_session=reader.token' } });
  assert.equal(issued.status, 200);
  const ticket = new URL((await issued.json()).url).hash.slice('#community-entry='.length);
  const binding = issued.headers.getSetCookie()[0].split(';')[0];
  const entered = await fetch(local + '/api/community-entry', { method: 'POST', headers: { Origin: community, 'X-Reader-Request': '1', Cookie: binding, 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }) });
  assert.equal(entered.status, 200);
  const cookie = entered.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))!.split(';')[0];
  const avatar = (uid = '10001', headers: Record<string, string> = {}, query = '') => fetch(local + `/api/community/avatar/${uid}.webp${query}`, { headers: { cookie, ...headers } });
  const pause = (where: 'source' | 'client') => { const waiting = gate(); if (where === 'source') sourceGate = waiting; else clientGate = waiting; return waiting; };
  const purge = async (targetId = readerId) => { const path = '/api/community-identity/purge', body = JSON.stringify({ operation: 'purge', input: { readerId: targetId } }); const response = await fetch(local + path, { method: 'POST', headers: signIdentityRequest({ secret, method: 'POST', path, body }), body }); assert.equal(response.status, 200); };
  return { state, row, rows, source, messages, avatar, pause, purge, client, sessionRef, local, cookie,
    inject: (value: unknown, status = 200) => { override = { value, status }; },
    removeApprovedFile: async () => rm(resolve(mainDirectory, 'uploads', `reader-avatar-${firstVersion}.webp`)),
    add: async (uid: string, bytes: Buffer) => { const version = randomUUID(); rows.set(uid, { id: randomUUID(), nickname: uid, avatar: version, disabled: false, _verified: true }); await writeFile(resolve(mainDirectory, 'uploads', `reader-avatar-${version}.webp`), bytes); return version; },
  };
}

test('warm approved avatar keeps fresh source checks but transfers no full bytes before HTTP 304', async t => {
  const f = await fixture(t), first = await f.avatar();
  assert.equal(first.status, 200); assert.equal(await first.text(), 'reader-first');
  assert.deepEqual(f.messages[0].value, { version: firstVersion, base64: Buffer.from('reader-first').toString('base64') });
  assert.equal(f.messages[0].input.knownVersion, null);
  const checks = f.state.sourceSessionChecks;
  const warm = await f.avatar('10001', { 'If-None-Match': first.headers.get('etag')! });
  assert.equal(warm.status, 304); assert.equal(await warm.text(), '');
  assert.equal(warm.headers.get('cache-control'), 'private, no-cache'); assert.equal(warm.headers.get('vary'), 'Cookie');
  assert.equal(f.state.sourceReads, 1, 'unchanged approval is checked without reading the avatar file again');
  assert.ok(f.state.sourceSessionChecks >= checks + 3, 'entry middleware and both ends of avatar authority still validate the source session');
  assert.deepEqual(f.messages[1].value, { version: firstVersion, unchanged: true });
  assert.equal(f.messages[1].input.knownVersion, firstVersion);
  assert.ok(f.messages[1].bytes < 100);
});

test('replacement uses actual source version despite forged URL hints and old HTTP validators', async t => {
  const f = await fixture(t), first = await f.avatar(); await first.text();
  f.row.avatar = nextVersion;
  const replaced = await f.avatar('10001', { 'If-None-Match': first.headers.get('etag')! }, `?v=${firstVersion}`);
  assert.equal(replaced.status, 200); assert.equal(await replaced.text(), 'reader-next');
  assert.deepEqual(f.messages.at(-1)?.value, { version: nextVersion, base64: Buffer.from('reader-next').toString('base64') });
  assert.equal(f.state.sourceReads, 2);
  assert.equal((await f.avatar('10001', { 'If-None-Match': replaced.headers.get('etag')! }, '?v=forged')).status, 304);
  assert.equal(f.state.sourceReads, 2);
});

test('missing approved reader file still returns 404 when its version has warm cached bytes', async t => {
  const f = await fixture(t), first = await f.avatar(); await first.text();
  await f.removeApprovedFile();
  const denied = await f.avatar('10001', { 'If-None-Match': first.headers.get('etag')! });
  assert.equal(denied.status, 404); assert.ok(!(await denied.text()).includes('reader-first'));
  assert.equal(f.messages.at(-1)?.value, null);
});

for (const change of ['removed', 'disabled', 'deleted'] as const) test(`warm avatar cannot survive target ${change}`, async t => {
  const f = await fixture(t), first = await f.avatar(); await first.text();
  if (change === 'removed') f.row.avatar = null;
  if (change === 'disabled') f.row.disabled = true;
  if (change === 'deleted') f.rows.delete('10001');
  const denied = await f.avatar('10001', { 'If-None-Match': first.headers.get('etag')! });
  assert.equal(denied.status, 404); assert.ok(!(await denied.text()).includes('reader-first'));
  assert.equal(f.messages.at(-1)?.value, null);
});

test('same UUID in brand and personal source namespaces never shares avatar bytes', async t => {
  const f = await fixture(t);
  assert.equal(await (await f.avatar()).text(), 'reader-first');
  assert.equal(await (await f.avatar('owner')).text(), 'brand-' + firstVersion);
  assert.equal(await (await f.avatar()).text(), 'reader-first');
  assert.equal(await (await f.avatar('owner')).text(), 'brand-' + firstVersion);
  assert.equal(f.state.sourceReads, 2); assert.equal(f.state.brandReads, 1);
  f.state.brand = null;
  assert.equal((await f.avatar('owner')).status, 404);
  assert.equal(await (await f.avatar()).text(), 'reader-first');
});

test('conditional warm bridge revalidates source identity after awaiting approval', async t => {
  const f = await fixture(t); await (await f.avatar()).text();
  const held = f.pause('source'), reading = f.avatar();
  try { await held.waiting; f.state.enabled = false; } finally { held.release(); }
  const denied = await reading;
  assert.equal(denied.status, 401); assert.ok(!(await denied.text()).includes('reader-first'));
  assert.equal(f.messages.at(-1)?.status, 401);
});

test('warm cached bytes remain unavailable when HK session is purged before a confirmed response returns', async t => {
  const f = await fixture(t); await (await f.avatar()).text();
  const held = f.pause('client'), reading = f.avatar();
  try { await held.waiting; await f.purge(); } finally { held.release(); }
  const denied = await reading;
  assert.equal(denied.status, 401); assert.ok(!(await denied.text()).includes('reader-first'));
});

for (const warm of [false, true]) test(`another member's ${warm ? 'warm' : 'cold'} avatar response cannot cross the local purge boundary`, async t => {
  const f = await fixture(t); await f.add('10009', Buffer.from('other-avatar'));
  const targetId = f.rows.get('10009')!.id;
  if (warm) assert.equal(await (await f.avatar('10009')).text(), 'other-avatar');
  const held = f.pause('client'), reading = f.avatar('10009');
  try { await held.waiting; f.rows.delete('10009'); await f.purge(targetId); } finally { held.release(); }
  const denied = await reading;
  assert.equal(denied.status, 404); assert.ok(!(await denied.text()).includes('other-avatar'));
  assert.equal(await (await f.avatar()).text(), 'reader-first', 'the observing reader remains authorized');
});

for (const status of [401, 404, 503]) test(`warm avatar never falls back after bridge ${status}`, async t => {
  const f = await fixture(t); await (await f.avatar()).text();
  f.inject({ error: 'source denied' }, status);
  const denied = await f.avatar(); assert.equal(denied.status, status); assert.ok(!(await denied.text()).includes('reader-first'));
});

for (const value of [
  { version: 'short', base64: Buffer.from('forged').toString('base64') },
  { version: nextVersion, unchanged: true },
  { version: firstVersion, unchanged: true, base64: Buffer.from('forged').toString('base64') },
  { version: firstVersion, base64: 'YR==' },
  { version: firstVersion, base64: '' },
]) test(`invalid conditional avatar response is refused: ${JSON.stringify(value)}`, async t => {
  const f = await fixture(t); await (await f.avatar()).text(); f.inject(value);
  const denied = await f.avatar(); assert.equal(denied.status, 503); assert.ok(!(await denied.text()).includes('reader-first'));
});

test('unchanged response without a cached byte reference cannot manufacture an avatar or HTTP 304', async t => {
  const f = await fixture(t); f.inject({ version: firstVersion, unchanged: true });
  assert.equal((await f.avatar('10001', { 'If-None-Match': '*' })).status, 503);
});

test('legacy avatar authority remains readable but unversioned responses are never cached', async t => {
  const f = await fixture(t, true);
  for (let i = 0; i < 3; i++) assert.equal(await (await f.avatar()).text(), 'reader-first');
  assert.equal(f.state.sourceReads, 3);
  assert.ok(f.messages.every(message => message.input.knownVersion === null));
  assert.ok(f.messages.every(message => JSON.stringify(message.value) === JSON.stringify({ base64: Buffer.from('reader-first').toString('base64') })));
});

test('bounded approved cache evicts beyond 64 entries without weakening fresh checks', async t => {
  const f = await fixture(t); await (await f.avatar()).text();
  for (let i = 0; i < 64; i++) { const uid = String(11000 + i); await f.add(uid, Buffer.from(uid)); assert.equal(await (await f.avatar(uid)).text(), uid); }
  await (await f.avatar()).text();
  assert.equal(f.messages.at(-1)?.input.knownVersion, null, 'oldest byte entry was evicted');
  assert.equal(f.state.sourceReads, 66);
});

test('bounded approved cache evicts by total bytes even before reaching 64 entries', async t => {
  const f = await fixture(t), bytes = Buffer.alloc(1_300_000, 7);
  for (let i = 0; i < 7; i++) { const uid = String(12000 + i); await f.add(uid, bytes); const response = await f.avatar(uid); assert.equal(response.status, 200); assert.equal((await response.arrayBuffer()).byteLength, bytes.length); }
  await (await f.avatar('12000')).arrayBuffer();
  assert.equal(f.messages.at(-1)?.input.knownVersion, null, '8 MiB cap evicts a byte-heavy entry before the item cap');
  assert.equal(f.state.sourceReads, 8);
});

test('existing avatar bridge validates full version hints and preserves legacy request shape', async t => {
  const f = await fixture(t);
  const legacy = await f.client.request('avatar', { sessionRef: f.sessionRef, uid: '10001' });
  assert.deepEqual(legacy, { base64: Buffer.from('reader-first').toString('base64') });
  for (const knownVersion of ['short', firstVersion.slice(0, 8), false, {}, firstVersion.toUpperCase()]) await assert.rejects(f.client.request('avatar', { sessionRef: f.sessionRef, uid: '10001', knownVersion }), { status: 400 });
});

for (const knownVersion of [null, firstVersion]) for (const change of ['removed', 'replaced', 'disabled', 'deleted'] as const) test(`approved version source rejects ${change} during ${knownVersion ? 'conditional' : 'cold'} read`, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'avatar-version-race-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  await mkdir(resolve(directory, 'uploads')); await writeFile(resolve(directory, 'uploads', `reader-avatar-${firstVersion}.webp`), 'reader-first');
  const row = { id: readerId, nickname: '读者', avatar: firstVersion as string | null, disabled: false };
  let reads = 0, deleted = false;
  const payload = { find: async () => {
    const snapshot = { ...row };
    if (++reads === 1) { if (change === 'removed') row.avatar = null; if (change === 'replaced') row.avatar = nextVersion; if (change === 'disabled') row.disabled = true; if (change === 'deleted') deleted = true; return { docs: [snapshot] }; }
    return { docs: deleted ? [] : [{ ...row }] };
  } } as unknown as Payload;
  const source = createCommunityDirectory({ payload, directory, authorId: ownerId, ownerName: async () => '作者', uidStore: { get: () => '10001', readerId: () => readerId } });
  assert.equal(await source.approvedAvatar('10001', knownVersion), null);
  assert.equal(reads, 2, 'both cold bytes and a warm version confirmation retain final target validation');
});
