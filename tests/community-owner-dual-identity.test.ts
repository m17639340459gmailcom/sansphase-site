import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';
import type { PersonInfo } from '../server/community-context.ts';

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const personalId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const readerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function fixture(t: test.TestContext, linked = true) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-owner-dual-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  const store = createCommunityStore(directory);
  const owner = { kind: 'owner', id: ownerId } as const;
  const personal = { kind: 'reader', id: personalId } as const;
  const reader = { kind: 'reader', id: readerId } as const;
  acceptCommunityConvention(store, [owner, personal, reader]);
  let active = true;
  const profiles = new Map<string, PersonInfo>([
    [`owner:${ownerId}`, { name: '博客作者', uid: 'owner', vip: true, avatar: null, bio: '博客作者介绍', joinedAt: null }],
    [`reader:${personalId}`, { name: '个人读者', uid: '10008', vip: false, avatar: null, bio: '个人签名', joinedAt: '2026-10-01T00:00:00Z', ownerReader: true }],
    [`reader:${readerId}`, { name: '其他读者', uid: '10001', vip: false, avatar: null, bio: '', joinedAt: '2026-10-01T00:00:00Z' }],
  ]);
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  service = createCommunityService({
    directory, store, siteOrigin: origin, ownerId,
    identify: async req => {
      const isOwner = active && String(req.headers.cookie).includes('account=owner');
      return isOwner ? { ...owner, name: '博客作者', vip: true } : { ...reader, name: '其他读者', vip: false };
    },
    ownerReaderIdentity: async req => linked && active && String(req.headers.cookie).includes('account=owner')
      ? { ...personal, name: '个人读者', vip: false } : null,
    people: async authors => new Map(authors.flatMap(author => {
      const key = `${author.kind}:${author.id}`, value = profiles.get(key);
      return value ? [[key, value]] : [];
    })),
    findMember: async uid => uid === 'owner' ? owner : uid === '10008' ? personal : uid === '10001' ? reader : null,
  });
  const request = (path: string, body?: Record<string, unknown>, cookie = 'account=owner; community_browse=reader') => fetch(`${origin}/api/community/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const me = async (cookie?: string) => { const r = await request('me', undefined, cookie); assert.equal(r.status, 200); return r.json(); };
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { directory, store, owner, personal, reader, request, me, deactivate: () => { active = false; } };
}

test('owner reader mode uses its distinct real member and allows ordinary writes without management', async t => {
  const f = await fixture(t), me = await f.me();
  assert.equal(me.uid, '10008'); assert.equal(me.role, 'reader'); assert.equal(me.owner, false); assert.equal(me.mod, false);
  assert.deepEqual(me.management, { role: 'owner', browsingAsReader: true, interactive: true });
  assert.equal((await f.request('manage')).status, 403);
  assert.equal((await f.request('manage/items', {})).status, 403);
  const read = await f.request('inbox/read-all', {}); assert.equal(read.status, 200);
  const checked = await f.request('checkin', {}); assert.equal(checked.status, 200);
  assert.equal(f.store.economy.checked(f.personal), true); assert.equal(f.store.economy.checked(f.owner), false);
  const management = await f.me('account=owner'); assert.equal(management.uid, 'owner'); assert.equal(management.owner, true);
  assert.equal((await f.request('manage', undefined, 'account=owner')).status, 200);
});

test('other readers see the same owner personal badge display without filling persistent rewards', async t => {
  const f = await fixture(t);
  const a = await (await f.request('members/10008?tab=badges')).json();
  const b = await (await f.request('members/10008?tab=badges', undefined, 'account=reader')).json();
  assert.deepEqual(a.person, { ...b.person, showUid: true });
  assert.deepEqual(a.badgeState, b.badgeState); assert.ok(b.badgeState.families.every((v: { tier: string }) => v.tier === 'aurora'));
  const db = new DatabaseSync(resolve(f.directory, 'content.db'), { readOnly: true });
  try { for (const name of ['community_ledger', 'community_badge_honors', 'community_inventory']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get()?.n, 0); }
  finally { db.close(); }
});

test('forged reader mode cannot borrow the owner persona; missing or revoked linkage fails closed', async t => {
  const f = await fixture(t), ordinary = await f.me('account=reader; community_browse=reader');
  assert.equal(ordinary.uid, '10001'); assert.equal(ordinary.management, null); assert.equal(ordinary.owner, false);
  f.deactivate(); assert.equal((await f.request('manage')).status, 403);
  const missing = await fixture(t, false); assert.equal((await missing.request('me')).status, 503);
  assert.equal((await missing.request('browse-mode', { reader: true }, 'account=owner')).status, 503);
  assert.equal((await missing.request('browse-mode', { reader: false })).status, 200, 'an unavailable personal account cannot trap the management principal');
});
