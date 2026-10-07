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
const operation={action:'decide' as const,kind:'avatar' as const};
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
  const inactive=new Set<string>();let beforeAccounts:(()=>void|Promise<void>)|undefined;
  const accountsActive=async (authors:readonly {id:string}[])=>{await beforeAccounts?.();return authors.every(author=>!inactive.has(author.id)&&!deleted.has(author.id));};
  const client = createCommunityProfileReviewerClient({ origin, secret, fetch: transport,accountsActive });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); db.close(); store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { directory, store, db, deleted, authority, client, local, transport,inactive,accountsActive,onAccounts:(hook:()=>void|Promise<void>)=>{beforeAccounts=hook;} };
}

test('reviewer confirmation is read only and grants only the fixed owner or a current scoped moderator', async t => {
  const f = await fixture(t);
  f.authority(owner, 'owner', operation);
  assert.throws(() => f.authority({ ...owner, id: stranger.id }, 'owner', operation), { status: 403 });
  assert.throws(() => f.authority(stranger, 'moderator', operation), { status: 403 });
  assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM community_members').get()?.n), 0);
  f.store.members.setSteward(moderator, true, ['qa']);
  f.authority(moderator, 'moderator', operation);
  assert.throws(() => f.authority(moderator, 'owner', operation), { status: 403 });
  assert.throws(() => f.authority(owner, 'moderator', operation), { status: 403 });
  f.db.prepare('UPDATE community_members SET steward_boards=? WHERE member_id=?').run('[]', moderator.id);
  assert.throws(() => f.authority(moderator, 'moderator', operation), { status: 403 });
  f.db.prepare('UPDATE community_members SET steward_boards=? WHERE member_id=?').run('corrupt', moderator.id);
  assert.throws(() => f.authority(moderator, 'moderator', operation), { status: 403 });
  f.store.members.setSteward(moderator, true, ['qa']); f.deleted.add(moderator.id);
  assert.throws(() => f.authority(moderator, 'moderator', operation), { status: 403 });
  for (const table of ['community_ledger', 'community_experience_ledger']) assert.equal(Number(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n), 0);
});

test('signed HTTP confirmations re-read moderator appointments without positive caching', async t => {
  const f = await fixture(t);
  await f.client(owner, 'owner', operation);
  f.store.members.setSteward(moderator, true, ['qa']); await f.client(moderator, 'moderator', operation);
  f.store.members.setSteward(moderator, false);
  await assert.rejects(f.client(moderator, 'moderator', operation), { status: 403 });
  f.store.members.setSteward(moderator, true, ['qa']); f.deleted.add(moderator.id);
  await assert.rejects(f.client(moderator, 'moderator', operation), { status: 403 });
});
test('account checks cannot return an old HK permission proof after the appointment is revoked while waiting',async t=>{
  const f=await fixture(t);f.store.members.setSteward(moderator,true,['qa']);
  f.onAccounts(()=>{f.store.members.setSteward(moderator,false);});
  await assert.rejects(f.client(moderator,'moderator',operation),{status:403});
});
test('modern account profile authority is per-kind/global and confirms all current reader ancestors',async t=>{
  const f=await fixture(t),assistant={kind:'reader' as const,id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
  const permissions=['staff.appoint','profile.avatar.advise','profile.signature.decide'] as const;
  f.store.staff.appoint(owner,moderator,{role:'general',boards:['qa'],permissions:[...permissions],delegable:[...permissions]});
  f.store.staff.appoint(moderator,stranger,{role:'moderator',boards:['qa'],permissions:[...permissions],delegable:[...permissions]});
  f.store.staff.appoint(stranger,assistant,{role:'assistant',boards:['qa'],permissions:['profile.avatar.advise'],delegable:[]});
  assert.deepEqual(await f.client(assistant,'assistant',{action:'inspect'}),['avatar']);
  assert.deepEqual(await f.client(assistant,'assistant',{action:'advise',kind:'avatar'}),['avatar']);
  await assert.rejects(f.client(assistant,'assistant',{action:'decide',kind:'avatar'}),{status:403});
  await assert.rejects(f.client(assistant,'assistant',{action:'inspect',kind:'signature'}),{status:403});
  f.inactive.add(moderator.id);await assert.rejects(f.client(assistant,'assistant',{action:'advise',kind:'avatar'}),{status:403});
});

test('signed profile reviewer proofs accept every direct owner-appointed reader role without treating it as the owner',async t=>{
  const f=await fixture(t);
  for(const role of ['general','moderator','assistant'] as const){
    f.store.staff.appoint(owner,moderator,{role,boards:['qa'],permissions:['profile.avatar.advise'],delegable:[]});
    assert.deepEqual(f.authority(moderator,role,{action:'advise',kind:'avatar'}),{kinds:['avatar'],ancestors:[]});
    assert.deepEqual(await f.client(moderator,role,{action:'inspect'}),['avatar']);
    assert.deepEqual(await f.client(moderator,role,{action:'advise',kind:'avatar'}),['avatar']);
    await assert.rejects(f.client(moderator,'owner',{action:'advise',kind:'avatar'}),{status:403});
    await assert.rejects(f.client(moderator,role,operation),{status:403});
  }
  f.inactive.add(moderator.id);await assert.rejects(f.client(moderator,'assistant',{action:'advise',kind:'avatar'}),{status:403});
  f.inactive.clear();f.store.staff.revoke(owner,moderator);
  await assert.rejects(f.client(moderator,'assistant',{action:'advise',kind:'avatar'}),{status:403});
});

test('profile review for a direct owner moderator checks its descendants current chain and reader accounts',async t=>{
  const f=await fixture(t),permissions=['staff.appoint','profile.avatar.advise'] as const;
  f.store.staff.appoint(owner,moderator,{role:'moderator',boards:['qa'],permissions:[...permissions],delegable:[...permissions]});
  f.store.staff.appoint(moderator,stranger,{role:'assistant',boards:['qa'],permissions:['profile.avatar.advise'],delegable:[]});
  assert.deepEqual(f.authority(stranger,'assistant',{action:'advise',kind:'avatar'}),{kinds:['avatar'],ancestors:[moderator]});
  assert.deepEqual(await f.client(stranger,'assistant',{action:'advise',kind:'avatar'}),['avatar']);
  f.inactive.add(moderator.id);await assert.rejects(f.client(stranger,'assistant',{action:'advise',kind:'avatar'}),{status:403});
  f.inactive.clear();f.store.staff.appoint(owner,moderator,{role:'general',boards:['qa'],permissions:[...permissions],delegable:[...permissions]});
  await assert.rejects(f.client(stranger,'assistant',{action:'advise',kind:'avatar'}),{status:403});
  assert.equal(f.store.staff.state(stranger),null,'changing the directly appointed parent role revokes the previous subtree');
});

test('a delayed outbound HTTP confirmation denies a moderator removed while approval waits', async t => {
  const f = await fixture(t); f.store.members.setSteward(moderator, true, ['qa']);
  let forwarded!: () => void, resume!: () => void;
  const sent = new Promise<void>(done => { forwarded = done; }), gate = new Promise<void>(done => { resume = done; });
  const delayed = createCommunityProfileReviewerClient({ origin, secret,accountsActive:f.accountsActive, fetch: async (input, init) => { forwarded(); await gate; return f.transport(input, init); } });
  const decision = delayed(moderator, 'moderator', operation); await sent;
  f.store.members.setSteward(moderator, false); resume();
  await assert.rejects(decision, { status: 403 });
});

test('the final HK proof cannot return profile authority after a main account becomes inactive during that request',async t=>{
  const f=await fixture(t);f.store.members.setSteward(moderator,true,['qa']);let calls=0;
  const delayed=createCommunityProfileReviewerClient({origin,secret,accountsActive:f.accountsActive,fetch:async(input,init)=>{
    if(++calls===2)f.inactive.add(moderator.id);
    return f.transport(input,init);
  }});
  await assert.rejects(delayed(moderator,'moderator',operation),{status:403});assert.equal(calls,2);
});

test('reviewer bridge rejects unsigned callers, replay, forged input, and wrong identities', async t => {
  const f = await fixture(t);
  const body = JSON.stringify({ operation: 'profile-reviewer', input: { actor: owner, role: 'owner',operation } });
  assert.equal((await fetch(f.local + path, { method: 'POST', body })).status, 403);
  const headers = signIdentityRequest({ secret, method: 'POST', path, body });
  assert.equal((await fetch(f.local + path, { method: 'POST', body, headers })).status, 200);
  assert.equal((await fetch(f.local + path, { method: 'POST', body, headers })).status, 403);
  for (const input of [{ actor: owner, role: 'owner',operation, readerId: stranger.id }, { actor: { ...owner, command: 'any' }, role: 'owner',operation }, { actor: { ...owner, id: '../private' }, role: 'owner',operation }]) {
    const invalid = JSON.stringify({ operation: 'profile-reviewer', input });
    assert.equal((await fetch(f.local + path, { method: 'POST', body: invalid, headers: signIdentityRequest({ secret, method: 'POST', path, body: invalid }) })).status, 400);
  }
});

test('reviewer peer fails closed for malformed, oversized, redirected, or slow responses', async () => {
  assert.throws(() => createCommunityProfileReviewerClient({ origin: 'https://outside.example', secret }), /origin/i);
  for (const response of [new Response('{"ok":true,"extra":"ignored"}', { headers: { 'Content-Type': 'application/json' } }), new Response('approved', { headers: { 'Content-Type': 'text/html' } }), new Response('{"ok":false}', { headers: { 'Content-Type': 'application/json' } }), new Response('x'.repeat(17 * 1024), { headers: { 'Content-Type': 'application/json' } })]) {
    const client = createCommunityProfileReviewerClient({ origin, secret, fetch: async () => response });
    await assert.rejects(client(owner, 'owner', operation), { status: 503 });
  }
  const failed = createCommunityProfileReviewerClient({ origin, secret, fetch: async (_input, init) => new Promise((_done, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); }) });
  const started = Date.now(); const keeper = setTimeout(() => {}, 1800);
  try { await assert.rejects(failed(owner, 'owner', operation), { status: 503 }); assert.ok(Date.now() - started < 1500); }
  finally { clearTimeout(keeper); }
});
