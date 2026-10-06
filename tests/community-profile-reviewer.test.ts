import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityFrameAuthority, createCommunityFrameBridge } from '../server/community-frame-authority.ts';
import { createCommunityProfileReviewerAuthority, createCommunityProfileReviewerClient } from '../server/community-profile-reviewer.ts';
import { signIdentityRequest } from '../server/community-identity-protocol.ts';

const owner = { kind: 'owner' as const, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' };
const moderator = { kind: 'reader' as const, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const stranger = { kind: 'reader' as const, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const origin = 'https://community.sansphase.com', path = '/api/community-identity/decorations';
const secret = 'profile-reviewer-peer-secret-at-least-32-chars';
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-profile-reviewer-'));
  new DatabaseSync(resolve(directory, 'content.db')).close(); await migrateCommunity(directory); await mkdir(resolve(directory, 'uploads'));
  const store = createCommunityStore(directory), db = new DatabaseSync(resolve(directory, 'content.db')), deleted = new Set<string>(), used = new Set<string>();
  const authority = createCommunityProfileReviewerAuthority({ store, ownerId: owner.id, readerDeleted: id => deleted.has(id) });
  const bridge = createCommunityFrameBridge({ authority: createCommunityFrameAuthority({ store, directory }), profileReviewer: authority, secret,
    consumeNonce: nonce => { if (used.has(nonce)) return false; used.add(nonce); return true; } });
  const server = createServer((req, res) => { void bridge.handle(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const transport: typeof fetch = (input, init) => fetch(local + new URL(String(input)).pathname, init);
  const client = createCommunityProfileReviewerClient({ origin, secret, fetch: transport });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); db.close(); store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { directory, store, db, deleted, authority, client, local, transport };
}

test('reviewer confirmation is read only and grants only the fixed owner or a current scoped moderator', async t => {
  const f = await fixture(t);
  f.authority(owner, 'owner');
  assert.throws(() => f.authority({ ...owner, id: stranger.id }, 'owner'), { status: 403 });
  assert.throws(() => f.authority(stranger, 'steward'), { status: 403 });
  assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM community_members').get()?.n), 0);
  f.store.members.setSteward(moderator, true, ['qa']);
  f.authority(moderator, 'steward');
  assert.throws(() => f.authority(moderator, 'owner'), { status: 403 });
  assert.throws(() => f.authority(owner, 'steward'), { status: 403 });
  f.db.prepare('UPDATE community_members SET steward_boards=? WHERE member_id=?').run('[]', moderator.id);
  assert.throws(() => f.authority(moderator, 'steward'), { status: 403 });
  f.db.prepare('UPDATE community_members SET steward_boards=? WHERE member_id=?').run('corrupt', moderator.id);
  assert.throws(() => f.authority(moderator, 'steward'), { status: 403 });
  f.store.members.setSteward(moderator, true, ['qa']); f.deleted.add(moderator.id);
  assert.throws(() => f.authority(moderator, 'steward'), { status: 403 });
  for (const table of ['community_ledger', 'community_experience_ledger']) assert.equal(Number(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n), 0);
});

test('signed HTTP confirmations re-read moderator appointments without positive caching', async t => {
  const f = await fixture(t);
  await f.client(owner, 'owner');
  f.store.members.setSteward(moderator, true, ['qa']); await f.client(moderator, 'steward');
  f.store.members.setSteward(moderator, false);
  await assert.rejects(f.client(moderator, 'steward'), { status: 403 });
  f.store.members.setSteward(moderator, true, ['qa']); f.deleted.add(moderator.id);
  await assert.rejects(f.client(moderator, 'steward'), { status: 403 });
});

test('a delayed outbound HTTP confirmation denies a moderator removed while approval waits', async t => {
  const f = await fixture(t); f.store.members.setSteward(moderator, true, ['qa']);
  let forwarded!: () => void, resume!: () => void;
  const sent = new Promise<void>(done => { forwarded = done; }), gate = new Promise<void>(done => { resume = done; });
  const delayed = createCommunityProfileReviewerClient({ origin, secret, fetch: async (input, init) => { forwarded(); await gate; return f.transport(input, init); } });
  const decision = delayed(moderator, 'steward'); await sent;
  f.store.members.setSteward(moderator, false); resume();
  await assert.rejects(decision, { status: 403 });
});

test('reviewer bridge rejects unsigned callers, replay, forged input, and wrong identities', async t => {
  const f = await fixture(t);
  const body = JSON.stringify({ operation: 'profile-reviewer', input: { actor: owner, role: 'owner' } });
  assert.equal((await fetch(f.local + path, { method: 'POST', body })).status, 403);
  const headers = signIdentityRequest({ secret, method: 'POST', path, body });
  assert.equal((await fetch(f.local + path, { method: 'POST', body, headers })).status, 200);
  assert.equal((await fetch(f.local + path, { method: 'POST', body, headers })).status, 403);
  for (const input of [{ actor: owner, role: 'owner', readerId: stranger.id }, { actor: { ...owner, command: 'any' }, role: 'owner' }, { actor: { ...owner, id: '../private' }, role: 'owner' }]) {
    const invalid = JSON.stringify({ operation: 'profile-reviewer', input });
    assert.equal((await fetch(f.local + path, { method: 'POST', body: invalid, headers: signIdentityRequest({ secret, method: 'POST', path, body: invalid }) })).status, 400);
  }
});

test('reviewer peer fails closed for malformed, oversized, redirected, or slow responses', async () => {
  assert.throws(() => createCommunityProfileReviewerClient({ origin: 'https://outside.example', secret }), /origin/i);
  for (const response of [new Response('{"ok":true,"extra":"ignored"}', { headers: { 'Content-Type': 'application/json' } }), new Response('approved', { headers: { 'Content-Type': 'text/html' } }), new Response('{"ok":false}', { headers: { 'Content-Type': 'application/json' } }), new Response('x'.repeat(17 * 1024), { headers: { 'Content-Type': 'application/json' } })]) {
    const client = createCommunityProfileReviewerClient({ origin, secret, fetch: async () => response });
    await assert.rejects(client(owner, 'owner'), { status: 503 });
  }
  const failed = createCommunityProfileReviewerClient({ origin, secret, fetch: async (_input, init) => new Promise((_done, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); }) });
  const started = Date.now(); const keeper = setTimeout(() => {}, 1800);
  try { await assert.rejects(failed(owner, 'owner'), { status: 503 }); assert.ok(Date.now() - started < 1500); }
  finally { clearTimeout(keeper); }
});
