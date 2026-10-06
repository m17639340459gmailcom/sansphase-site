import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityFrameAuthority, createCommunityFrameBridge } from '../server/community-frame-authority.ts';
import { createCommunityFrameClient } from '../server/community-frame-client.ts';
import { signIdentityRequest } from '../server/community-identity-protocol.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const reader = { kind: 'reader' as const, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const other = { kind: 'reader' as const, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const secret = 'limited-frame-bridge-secret-with-32-characters';
const path = '/api/community-identity/decorations';
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-frame-'));
  new DatabaseSync(resolve(directory, 'content.db')).close(); await migrateCommunity(directory); await mkdir(resolve(directory, 'uploads'));
  const store = createCommunityStore(directory), db = new DatabaseSync(resolve(directory, 'content.db'));
  const deleted = new Set<string>();
  const authority = createCommunityFrameAuthority({ store, directory, readerDeleted: id => deleted.has(id) });
  const used = new Set<string>();
  const bridge = createCommunityFrameBridge({ authority, secret, consumeNonce: nonce => { if (used.has(nonce)) return false; used.add(nonce); return true; } });
  const server = createServer((req, res) => { void bridge.handle(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = createCommunityFrameClient({ origin: 'https://community.sansphase.com', secret, fetch: (input, init) => fetch(local + new URL(String(input)).pathname, init) });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); db.close(); store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const own = (item: string, member = reader) => db.prepare('INSERT OR IGNORE INTO community_owned(member_kind,member_id,item,created_at) VALUES(?,?,?,?)').run(member.kind, member.id, item, new Date().toISOString());
  const custom = async () => {
    const id = randomUUID(); store.addImage({ id, uploader: { kind: 'owner', id: 'owner' }, width: 96, height: 96, purpose: 'shop', frameReady: true });
    const item = store.economy.saveItem(null, { cat: 'look', kind: 'frame', name: '已审核星环', description: '保持正式头像框画面。', price: 20, stock: null, limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '', image: id, note: '', active: false });
    await writeFile(resolve(directory, 'uploads', `community-image-${id}.webp`), Buffer.from('RIFF0000WEBP-original-animation'));
    own(item); return { id, item };
  };
  return { directory, store, db, deleted, authority, client, own, custom, local };
}

test('main-site frame reads remain projections and do not create community membership or duplicate inventory', async t => {
  const { client, db } = await fixture(t);
  assert.deepEqual(await client.state(reader.id), { frame: null, frameImage: null, items: [], available: true });
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM community_members').get()?.n), 0);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM community_owned').get()?.n), 0);
});

test('frame equip uses the actual owned community inventory and current convention, preserving inactive owned products', async t => {
  const { authority, store, client, own, custom, db } = await fixture(t);
  own('frame-gold');
  assert.throws(() => authority.equip(reader.id, 'gold'), { status: 428 });
  acceptCommunityConvention(store, [reader, other]);
  assert.throws(() => authority.equip(other.id, 'gold'), { status: 403 });
  assert.throws(() => authority.equip(reader.id, 'image:cccccccc-cccc-4ccc-8ccc-cccccccccccc'), { status: 403 });
  assert.throws(() => authority.equip(reader.id, 'url:https://bad.example/frame.svg'), { status: 400 });
  const frame = await custom();
  const state = await client.equip(reader.id, `image:${frame.id}`);
  assert.equal(state.frame, `image:${frame.id}`);
  assert.equal(state.frameImage, `/api/reader/frame/${frame.id}.webp`);
  assert.ok(state.items.some(item => item.ref === 'gold'));
  assert.ok(state.items.some(item => item.ref === `image:${frame.id}` && item.image === `/api/reader/frame/${frame.id}.webp`));
  assert.equal(store.members.decorations(reader).frame, state.frame);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM community_owned').get()?.n), 2);
  assert.equal((await client.equip(reader.id, null)).frame, null);
  for (const table of ['community_ledger', 'community_experience_ledger']) assert.equal(Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n), 0);
});

test('frame bridge requires exact signatures and nonces, rejects wrong ids and deleted accounts', async t => {
  const { local, client, deleted } = await fixture(t);
  const body = JSON.stringify({ operation: 'frame-state', input: { readerId: reader.id } });
  assert.equal((await fetch(local + path, { method: 'POST', body })).status, 403);
  const headers = signIdentityRequest({ secret, method: 'POST', path, body });
  assert.equal((await fetch(local + path, { method: 'POST', body, headers })).status, 200);
  assert.equal((await fetch(local + path, { method: 'POST', body, headers })).status, 403);
  const otherOperation = JSON.stringify({ operation: 'frame-state', input: { readerId: '../private' } });
  assert.equal((await fetch(local + path, { method: 'POST', body: otherOperation, headers: signIdentityRequest({ secret, method: 'POST', path, body: otherOperation }) })).status, 400);
  deleted.add(reader.id);
  await assert.rejects(client.state(reader.id), { status: 404 });
});

test('frame image proxy preserves animated bytes and refuses another member or unrelated artwork', async t => {
  const { custom, client, store, deleted } = await fixture(t), frame = await custom();
  assert.deepEqual(await client.image(reader.id, frame.id), Buffer.from('RIFF0000WEBP-original-animation'));
  await assert.rejects(client.image(other.id, frame.id), { status: 404 });
  const otherImage = randomUUID(); store.addImage({ id: otherImage, uploader: reader, width: 20, height: 20, purpose: 'content' });
  await assert.rejects(client.image(reader.id, otherImage), { status: 404 });
  deleted.add(reader.id);
  await assert.rejects(client.image(reader.id, frame.id), { status: 404 });
});

test('frame client validates fixed origin, media type, payload paths and limits before returning remote data', async t => {
  assert.throws(() => createCommunityFrameClient({ origin: 'https://outside.example', secret }), /community|origin/i);
  const bad = createCommunityFrameClient({ origin: 'https://community.sansphase.com', secret, fetch: async () => new Response(JSON.stringify({ frame: 'gold', frameImage: 'https://bad.example/frame.webp', items: [], available: true }), { headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(bad.state(reader.id), { status: 503 });
  const wrongType = createCommunityFrameClient({ origin: 'https://community.sansphase.com', secret, fetch: async () => new Response('<svg>unsafe</svg>', { headers: { 'Content-Type': 'image/svg+xml' } }) });
  await assert.rejects(wrongType.image(reader.id, randomUUID()), { status: 503 });
});

const emptyFrameState = { frame: null, frameImage: null, items: [], available: true };
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
test('concurrent display queries share a short cached projection and cannot overwrite a completed equip with an older response', async () => {
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const state = (frame: 'gold' | 'orbit') => ({ ...emptyFrameState, frame, items: ['gold', 'orbit'].map(ref => ({ id: `frame-${ref}`, name: ref, ref, image: null })) });
  const client = createCommunityFrameClient({ origin: 'https://community.sansphase.com', secret, fetch: async (_input, init) => {
    const operation = JSON.parse(String(init?.body)).operation;
    if (operation === 'frame-equip') return jsonResponse(state('orbit'));
    calls++; await gate; return jsonResponse(state('gold'));
  } });
  const first = client.state(reader.id), second = client.state(reader.id);
  const equipped = await client.equip(reader.id, 'orbit');
  release();
  assert.equal(equipped.frame, 'orbit');
  assert.equal((await first).frame, 'orbit');
  assert.equal((await second).frame, 'orbit');
  assert.equal((await client.state(reader.id)).frame, 'orbit');
  assert.equal(calls, 1);
});

test('unavailable decoration projection is bounded to one second and repeated displays reuse a short failure result', async () => {
  let calls = 0;
  const client = createCommunityFrameClient({ origin: 'https://community.sansphase.com', secret, fetch: async (_input, init) => {
    calls++;
    return await new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }); });
  } });
  const started = Date.now();
  await assert.rejects(client.state(reader.id), { status: 503 });
  assert.ok(Date.now() - started < 1800, 'a decoration outage must not hold the main display for the former eight seconds');
  await assert.rejects(client.state(reader.id), { status: 503 });
  assert.equal(calls, 1);
});

test('display projection cache is bounded across accounts and never mixes reader inventory', async () => {
  let calls = 0;
  const client = createCommunityFrameClient({ origin: 'https://community.sansphase.com', secret, fetch: async () => { calls++; return jsonResponse(emptyFrameState); } });
  const ids = Array.from({ length: 257 }, () => randomUUID());
  for (const id of ids) await client.state(id);
  await client.state(ids[0]);
  assert.equal(calls, 258, 'the oldest entry must leave the 256-account bound');
  await client.state(ids[256]);
  assert.equal(calls, 258, 'recent independent entries remain cached');
});
