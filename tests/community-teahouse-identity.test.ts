import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import type { CommunityViewer, PersonInfo } from '../server/community-context.ts';
import type { CommunityAuthor } from '../server/community-db.ts';

const owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
const member = (id: string): CommunityAuthor => ({ kind: 'reader', id });
const cleanup = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-teahouse-identity-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-teahouse-identity-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  const profiles = new Map<string, PersonInfo>(['owner', 'reader', 'general', 'moderator', 'assistant', 'personal'].map((id, index) => [
    `${id === 'owner' ? 'owner' : 'reader'}:${id}`,
    { name: `当前昵称 ${id}`, uid: id === 'owner' ? 'owner' : String(10000 + index), avatar: null, bio: '', joinedAt: null,
      active: true, vip: false, vipUntil: null, ...(id === 'personal' ? { ownerReader: true } : {}) },
  ]));
  let identity: CommunityViewer | null = { ...member('reader'), name: '旧昵称', vip: false };
  let onPeople: (() => void | Promise<void>) | undefined;
  let onIdentify: (() => void | Promise<void>) | undefined;
  let active = true;
  const service = createCommunityService({
    directory, store, siteOrigin: 'https://community.test', ownerId: owner.id,
    identify: async () => { await onIdentify?.(); return identity && { ...identity }; },
    ownerReaderIdentity: async () => ({ ...member('personal'), name: '作者个人身份', vip: false }),
    assertActive: () => { if (!active) throw Object.assign(Error('Session revoked'), { status: 401 }); },
    people: async authors => {
      const snapshot = new Map(authors.flatMap(author => {
        const key = `${author.kind}:${author.id}`, value = profiles.get(key);
        return value ? [[key, { ...value }] as const] : [];
      }));
      await onPeople?.(); return snapshot;
    },
  });
  const request = (cookie = '') => {
    const req = new IncomingMessage(new Socket()); req.method = 'GET'; req.url = '/api/community/teahouse/session'; req.headers.cookie = cookie;
    return req;
  };
  const read = (cookie?: string) => service.teahouseIdentity(request(cookie));
  t.after(async () => { store.close(); await cleanup(directory); });
  return { directory, service, store, profiles, read, request,
    identifyAs(value: CommunityViewer | null) { identity = value; },
    onPeople(hook?: () => void | Promise<void>) { onPeople = hook; },
    onIdentify(hook?: () => void | Promise<void>) { onIdentify = hook; },
    revokeSession() { active = false; },
  };
}

test('tea-room identity uses current account, membership and approved presentation without recording passive visits', async t => {
  const f = await fixture(t), profile = f.profiles.get('reader:reader')!;
  profile.vip = true; profile.vipUntil = new Date(Date.now() + 60_000).toISOString();
  profile.avatar = '11111111-1111-4111-8111-111111111111';
  f.identifyAs({ ...member('reader'), name: '旧昵称', vip: true });
  const identity = await f.read();
  assert.equal(identity?.kind, 'reader'); assert.equal(identity?.id, 'reader'); assert.equal(identity?.name, profile.name);
  assert.equal(identity?.uid, profile.uid, 'account menu must use the public member UID, not the internal account id');
  assert.equal(identity?.role, null); assert.equal(identity?.vip, true);
  assert.equal(identity?.vipUntil, Date.parse(profile.vipUntil));
  assert.equal(identity?.avatarUrl, `/api/community/avatar/${profile.uid}.webp?v=${profile.avatar}`);
  assert.equal(identity?.icon, 'vip:1');
  const db = new DatabaseSync(resolve(f.directory, 'content.db'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_visits').get()?.n, 0); }
  finally { db.close(); }
});

test('tea-room authority expires VIP and does not grant membership for a staff role', async t => {
  const f = await fixture(t), profile = f.profiles.get('reader:reader')!;
  profile.vip = true; profile.vipUntil = new Date(Date.now() - 1000).toISOString();
  f.identifyAs({ ...member('reader'), name: '读者', vip: true });
  assert.equal((await f.read())?.vip, false);
  for (const role of ['general', 'moderator', 'assistant'] as const) {
    f.store.staff.appoint(owner, member(role), { role, boards: ['vip'], permissions: ['content.inspect'], delegable: [] });
    f.identifyAs({ ...member(role), name: role, vip: false });
    const value = await f.read(); assert.equal(value?.role, role); assert.equal(value?.vip, false);
  }
  f.identifyAs({ ...owner, name: '作者', vip: false });
  assert.equal((await f.read())?.role, 'owner'); assert.equal((await f.read())?.vip, false);
});

test('tea-room rechecks revoked staff appointments and disabled ancestors after an asynchronous profile read', async t => {
  const f = await fixture(t), permissions = ['content.inspect', 'staff.appoint'] as const;
  f.store.staff.appoint(owner, member('general'), { role: 'general', boards: ['vip'], permissions: [...permissions], delegable: [...permissions] });
  f.store.staff.appoint(member('general'), member('moderator'), { role: 'moderator', boards: ['vip'], permissions: ['content.inspect'], delegable: [] });
  f.identifyAs({ ...member('moderator'), name: '版主', vip: false });
  assert.equal((await f.read())?.role, 'moderator');
  f.profiles.get('reader:general')!.active = false;
  assert.equal((await f.read())?.role, null);
  f.profiles.get('reader:general')!.active = true;
  f.onPeople(() => { f.store.staff.revoke(owner, member('general')); f.onPeople(); });
  assert.equal((await f.read())?.role, null);
});

test('tea-room reader browsing cannot inherit management and owner personal cosmetics do not grant real VIP', async t => {
  const f = await fixture(t);
  f.store.staff.appoint(owner, member('moderator'), { role: 'moderator', boards: ['vip'], permissions: ['content.inspect'], delegable: [] });
  f.identifyAs({ ...member('moderator'), name: '版主', vip: true });
  await assert.rejects(f.read('community_browse=reader'), { status: 403 });
  f.identifyAs({ ...owner, name: '作者', vip: false });
  const personal = await f.read('community_browse=reader');
  assert.equal(personal?.id, 'personal'); assert.equal(personal?.role, null); assert.equal(personal?.vip, false);
  f.identifyAs({ ...member('reader'), name: '读者', vip: false });
  assert.equal((await f.read('community_browse=reader'))?.id, 'reader');
});

test('tea-room rejects inactive or missing users, forged owners and a session revoked during profile lookup', async t => {
  const f = await fixture(t);
  f.identifyAs(null); assert.equal(await f.read(), null);
  f.identifyAs({ kind: 'owner', id: 'forged', name: '伪造作者', vip: true });
  await assert.rejects(f.read(), { status: 401 });
  f.identifyAs({ ...member('reader'), name: '读者', vip: true });
  f.profiles.get('reader:reader')!.active = false;
  await assert.rejects(f.read(), { status: 401 });
  f.profiles.delete('reader:reader');
  await assert.rejects(f.read(), { status: 401 });
  f.identifyAs({ ...member('general'), name: '总版主', vip: false });
  f.onPeople(() => f.revokeSession()); await assert.rejects(f.read(), { status: 401 });
});

test('tea-room identity resolves fresh on each call and refuses a principal changed while awaiting profiles', async t => {
  const f = await fixture(t), req = f.request();
  assert.equal((await f.service.teahouseIdentity(req))?.id, 'reader');
  f.identifyAs(null); assert.equal(await f.service.teahouseIdentity(req), null);
  f.identifyAs({ ...member('reader'), name: '读者', vip: false });
  let identities = 0;
  f.onIdentify(() => { if (++identities === 2) f.identifyAs({ ...member('assistant'), name: '协管', vip: false }); });
  await assert.rejects(f.read(), { status: 401 });
});

test('tea-room identity projects current sanctions and explicit icon choice without granting or persisting privileges', async t => {
  const f = await fixture(t), profile = f.profiles.get('reader:reader')!;
  profile.vip = true; profile.vipUntil = new Date(Date.now() + 60_000).toISOString();
  f.identifyAs({ ...member('reader'), name: '读者', vip: true });
  assert.equal((await f.read())?.muted, false);
  const sanction = f.store.members.mute(member('reader'), 1, '测试禁言', owner);
  f.store.members.setIcon(member('reader'), '');
  const muted = await f.read(); assert.equal(muted?.muted, true); assert.equal(muted?.icon, null); assert.equal(muted?.vip, true);
  f.store.members.lift(sanction.id);
  f.store.members.setIcon(member('reader'), 'trust:0');
  const restored = await f.read(); assert.equal(restored?.muted, false); assert.equal(restored?.icon, 'trust:0');
  const db = new DatabaseSync(resolve(f.directory, 'content.db'));
  try {
    db.prepare("INSERT INTO community_badge_honors(member_kind,member_id,family,tier,created_at,evidence) VALUES('reader','reader','writing','gold','2026-10-01T00:00:00Z','{}')").run();
    f.store.members.setIcon(member('reader'), 'badge:writing:gold');
    assert.equal((await f.read())?.icon, 'badge:writing:gold');
    db.prepare("UPDATE community_badge_honors SET revoked_at='2026-10-02T00:00:00Z' WHERE member_id='reader'").run();
    assert.equal((await f.read())?.icon, null);
  } finally { db.close(); }
});

test('tea-room historical author display refreshes current names and icons in one batch rather than trusting message snapshots', async t => {
  const f = await fixture(t);
  const author = member('assistant'), profile = f.profiles.get('reader:assistant')!;
  profile.vip = true; profile.vipUntil = new Date(Date.now() + 60_000).toISOString();
  profile.avatar = '22222222-2222-4222-8222-222222222222';
  const snapshot = { ...author, name: '过期昵称', avatarUrl: '/old.webp', icon: 'vip:8' as const };
  let calls = 0; f.onPeople(() => { calls++; });
  const initial = await f.service.teahouseAuthors(f.request(), [snapshot, snapshot]);
  assert.equal(calls, 2, 'one author/ancestor batch plus one fresh caller authority batch, independent of message count');
  assert.deepEqual(initial.map(item => item.name), [profile.name, profile.name]);
  assert.equal(initial[0].icon, 'vip:1');
  assert.equal(initial[0].avatarUrl, `/api/community/avatar/${profile.uid}.webp?v=${profile.avatar}`);
  profile.vipUntil = new Date(Date.now() - 1000).toISOString();
  assert.equal((await f.service.teahouseAuthors(f.request(), [snapshot]))[0].icon, null);
  profile.active = false;
  assert.equal((await f.service.teahouseAuthors(f.request(), [snapshot]))[0].icon, null);
  f.profiles.delete('reader:assistant');
  const missing = (await f.service.teahouseAuthors(f.request(), [snapshot]))[0];
  assert.equal(missing.name, '已注销用户'); assert.equal(missing.avatarUrl, undefined); assert.equal(missing.icon, null);
});

test('tea-room author batches do not retain a revoked staff icon or return after viewer session loss', async t => {
  const f = await fixture(t), author = member('general');
  f.store.staff.appoint(owner, author, { role: 'general', boards: ['vip'], permissions: ['content.inspect'], delegable: [] });
  const snapshot = { ...author, name: '历史总版主', icon: 'staff:general' as const };
  assert.equal((await f.service.teahouseAuthors(f.request(), [snapshot]))[0].icon, 'staff:general');
  f.onPeople(() => { f.store.staff.revoke(owner, author); f.onPeople(); });
  assert.equal((await f.service.teahouseAuthors(f.request(), [snapshot]))[0].icon, null);
  f.onPeople(() => f.revokeSession());
  await assert.rejects(f.service.teahouseAuthors(f.request(), [snapshot]), { status: 401 });
});
