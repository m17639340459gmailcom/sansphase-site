import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import type { CommunityMe, CommunityPerson, CommunityListing } from '../src/community.ts';
import type { CommunityCheckin, CommunityMember, CommunityShop, CommunityStardust, CommunityRank } from '../src/community-pages.ts';
import type { CommunityIconRef, CommunityIconState } from '../src/community-icon-policy.ts';
import type { CommunityThread } from '../src/community-post.ts';
import { experienceCatalogue, vipCatalogue } from '../server/community-experience.ts';
import { communityBadgeFamilies } from '../src/community-badge-policy.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';
import { communityBoards } from '../src/community.ts';
import { communityStaffCapabilities } from '../src/community-staff.ts';

const owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
const reader: CommunityAuthor = { kind: 'reader', id: 'reader' };
const steward: CommunityAuthor = { kind: 'reader', id: 'steward' };
const personal: CommunityAuthor = { kind: 'reader', id: '11111111-1111-4111-8111-111111111111' };
const cleanup = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-owner-reader-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function setup(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-owner-reader-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  acceptCommunityConvention(store, [owner, reader, steward, personal]);
  store.members.setSteward(steward, true, ['qa']);
  const profiles = new Map<string, { name: string; uid: string; vip: boolean; ownerReader?: true; active?: boolean }>([
    ['owner:owner', { name: '站长', uid: 'owner', vip: true }],
    [`reader:${personal.id}`, { name: '个人身份', uid: '10008', vip: false, ownerReader: true }],
    ['reader:reader', { name: '真实读者', uid: '10001', vip: false }],
    ['reader:steward', { name: '真实协管', uid: '10002', vip: false }],
  ]);
  let ownerReaderAvailable = true;
  let ownerReaderLookup: (() => void) | undefined;
  let identifyLookup: (() => void) | undefined;
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  service = createCommunityService({
    store, siteOrigin: origin, directory, ownerId: owner.id,
    identify: async req => {
      identifyLookup?.();
      const id = String(req.headers.cookie || '').split(';')[0];
      const member = id === 'owner' ? owner : id === 'steward' ? steward : id === 'reader' ? reader : id === 'personal' ? personal : null;
      if (!member) return null;
      const info = profiles.get(`${member.kind}:${member.id}`)!;
      return info.active === false ? null : { ...member, name: info.name, vip: info.vip };
    },
    ownerReaderIdentity: async req => {
      ownerReaderLookup?.();
      const profile = profiles.get(`reader:${personal.id}`)!;
      return ownerReaderAvailable && profile.active !== false && String(req.headers.cookie).split(';')[0] === 'owner'
        ? { ...personal, name: '个人身份', vip: false } : null;
    },
    people: async authors => new Map(authors.flatMap(author => {
      const key = `${author.kind}:${author.id}`, profile = profiles.get(key);
      return profile ? [[key, { ...profile, avatar: null, joinedAt: author.kind === 'reader' ? '2026-10-01T00:00:00.000Z' : null, bio: '' }]] : [];
    })),
    findMember: async uid => uid === 'owner' ? owner : uid === '10001' ? reader : uid === '10002' ? steward : uid === '10008' ? personal : null,
  });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); store.close(); await cleanup(directory); });
  const get = (path: string, identity = 'owner; community_browse=reader') => fetch(`${origin}/api/community/${path}`, { headers: { cookie: identity } });
  const json = async <T>(path: string, identity?: string): Promise<T> => {
    const response = await get(path, identity);
    assert.equal(response.status, 200, path);
    return await response.json() as T;
  };
  const post = (path: string, body: Record<string, unknown> = {}, identity = 'owner; community_browse=reader') => fetch(`${origin}/api/community/${path}`, {
    method: 'POST', headers: { cookie: identity, Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { directory, store, get, json, post,
    revokeOwnerReader() {
      ownerReaderAvailable = false;
      delete profiles.get(`reader:${personal.id}`)!.ownerReader;
    },
    deactivatePersonal() { profiles.get(`reader:${personal.id}`)!.active = false; },
    deactivateOwner() { profiles.get('owner:owner')!.active = false; },
    enableExperience() {
      const db = new DatabaseSync(resolve(directory, 'content.db'));
      try { db.prepare('UPDATE community_experience_config SET started_at=? WHERE id=1').run(new Date(Date.now() - 86400000).toISOString()); }
      finally { db.close(); }
    },
    onOwnerReaderIdentity(hook: () => void) { ownerReaderLookup = hook; },
    onIdentify(hook: () => void) { identifyLookup = hook; },
  };
}

test('owner reader perspective uses the same reader DTO with top growth, VIP and ordinary trust', async t => {
  const { json } = await setup(t);
  const me = await json<CommunityMe & { trustLevel: number }>('me');
  assert.equal(me.role, 'reader');
  assert.equal(me.owner, false);
  assert.equal(me.mod, false);
  assert.deepEqual(me.moderationBoards, []);
  assert.deepEqual(me.management, { role: 'owner', browsingAsReader: true, interactive: true, staff: {
    role: 'owner', boards: communityBoards.map(board => board.id), permissions: communityStaffCapabilities.map(capability => capability.id),
    delegable: communityStaffCapabilities.map(capability => capability.id), parent: null,
  } }, 'switching back retains the original management scope without activating it for the reader');
  assert.equal(me.staff, null);
  assert.equal(me.level, 3, 'ordinary trust ends before appointed moderation');
  assert.equal(me.trustLevel, 3);
  assert.equal(me.vip, true);
  assert.equal(me.growth?.level, experienceCatalogue.at(-1)?.level);
  assert.equal(me.growth?.points, experienceCatalogue.at(-1)?.threshold);
  assert.equal(me.growth?.progress, 1);
  assert.equal(me.growth?.remaining, 0);
  assert.equal(me.vipGrowth?.active, true);
  assert.equal(me.vipGrowth?.level, vipCatalogue.at(-1)?.level);
  assert.equal(me.vipGrowth?.multiplier, vipCatalogue.at(-1)?.multiplier);
  assert.equal(me.vipGrowth?.progress, 1);
  const levels = await json<CommunityStardust>('stardust');
  assert.equal(levels.owner, false);
  assert.equal(levels.level, 3);
  assert.equal(levels.vip, true);
  assert.deepEqual(levels.growth, me.growth);
  assert.deepEqual(levels.vipGrowth, me.vipGrowth);
  assert.equal(levels.progress, null);
  const checkin = await json<CommunityCheckin>('checkin');
  assert.equal(checkin.owner, false);
  assert.equal(checkin.browsingAsReader, true);
  assert.equal(checkin.vip, true);
  assert.equal((await json<CommunityShop>('shop')).level, me.trustLevel, 'shop requirements use the same highest ordinary trust projection');
});

test('owner personal badge presentation is shared while other readers and author identity remain real', async t => {
  const { json } = await setup(t);
  const self = await json<CommunityMember>('members/10008?tab=badges');
  assert.equal(self.self, true);
  assert.equal(self.person.role, 'reader');
  assert.equal(self.badgeState?.families.length, communityBadgeFamilies.length);
  for (const family of self.badgeState!.families) {
    assert.equal(family.tier, 'aurora');
    assert.equal(family.achievedAt, null, 'a preview must not invent a real achievement date');
    assert.ok(family.tiers.every(tier => tier.achieved && tier.eligible && tier.achievedAt === null));
    assert.ok(family.tiers.flatMap(tier => tier.requirements).every(row => row.met && row.have === row.need));
  }
  const actualReader = await json<CommunityMember>('members/10001?tab=badges');
  assert.equal(actualReader.person.growth?.level, 1);
  assert.equal(actualReader.person.vip, false);
  assert.ok(actualReader.badgeState?.families.every(family => family.tier === null));
  const actualOwner = await json<CommunityMember>('members/owner?tab=badges', 'reader');
  assert.equal(actualOwner.person.role, 'owner');
  assert.equal(actualOwner.person.growth, null);
  assert.equal(actualOwner.person.vipGrowth, null);
  assert.ok(actualOwner.badgeState?.families.every(family => family.tier === null));
});

test('reader cookie forgery and moderator preview never receive owner presentation benefits', async t => {
  const { json } = await setup(t);
  for (const identity of ['reader', 'reader; community_browse=reader', 'steward; community_browse=reader']) {
    const me = await json<CommunityMe & { trustLevel: number }>('me', identity);
    assert.equal(me.vip, false, identity);
    assert.equal(me.growth?.level, 1, identity);
    assert.equal(me.vipGrowth?.active, false, identity);
    assert.equal(me.vipGrowth?.level, null, identity);
    assert.ok(me.badgeState?.families.every(family => family.tier === null), identity);
    assert.notEqual(me.trustLevel, 3, identity);
  }
});

test('top owner reader presentation preserves hidden-content and management boundaries', async t => {
  const { store, get, json, post } = await setup(t);
  const pending = store.createTopic({ board: 'qa', author: owner, title: '待审测试', body: '未公开的测试正文', pending: '待审' });
  const hidden = store.createTopic({ board: 'qa', author: owner, title: '隐藏测试', body: '隐藏的测试正文' });
  store.hide({ kind: 'topic', id: hidden.id }, '测试');
  const vip = store.createTopic({ board: 'vip', author: owner, title: '会员测试', body: '正式会员可见正文' });
  const thread = await json<CommunityThread>(`topics/${vip.id}`);
  assert.equal(thread.viewer?.level, 3, 'topic controls receive the same highest ordinary trust projection');
  assert.equal(thread.topic.canReply, true);
  assert.equal(thread.topic.canModerate, false);
  assert.equal(thread.topic.canFeature, false);
  assert.equal(thread.topic.mine, false);
  assert.equal((await get(`topics/${vip.id}`, 'reader; community_browse=reader')).status, 404, 'a forged reader cookie cannot access member content');
  assert.equal((await get(`topics/${pending.id}`)).status, 404);
  assert.equal((await get(`topics/${hidden.id}`)).status, 404);
  assert.equal((await get('manage')).status, 403);
  assert.equal((await post('manage/items')).status, 403);
  assert.equal((await post('inbox/read-all')).status, 200);
  assert.equal((await post('checkin')).status, 200);
  assert.equal(store.economy.checked(personal), true);
  assert.equal(store.economy.checked(owner), false);
  assert.equal((await json<CommunityMe>('me', 'owner')).owner, true);
  assert.equal((await get('manage', 'owner')).status, 200);
});

test('owner presentation never fills persistent experience, VIP days, badge honors, stardust or inventory', async t => {
  const { directory, store, json } = await setup(t);
  await json<CommunityMe>('me', 'owner');
  const tables = ['community_experience_ledger', 'community_experience_visits', 'community_vip_growth_days', 'community_badge_honors', 'community_badge_honor_reviews', 'community_badges', 'community_ledger', 'community_checkins', 'community_inventory', 'community_notifications'];
  const snapshot = () => {
    const db = new DatabaseSync(resolve(directory, 'content.db'));
    try { return tables.map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() })); }
    finally { db.close(); }
  };
  const before = snapshot();
  for (let repeat = 0; repeat < 2; repeat++) {
    const me = await json<CommunityMe>('me');
    const levels = await json<CommunityStardust>('stardust');
    await json<CommunityMember>('members/10008?tab=badges');
    await json<CommunityCheckin>('checkin');
    assert.equal(me.balance, 0);
    assert.equal(levels.balance, 0);
    assert.deepEqual(levels.ledger, []);
  }
  assert.deepEqual(snapshot(), before);
  assert.equal(store.experience.state(owner), null);
  assert.equal(store.experience.vipState(owner, true), null);
  const normal = await json<CommunityPerson>('me', 'owner');
  assert.equal(normal.role, 'owner');
  assert.equal(normal.growth, null);
  assert.equal(normal.vipGrowth, null);
});

const ownerTopIcons: readonly CommunityIconRef[] = [
  'growth:10', 'trust:3', 'vip:8',
  ...communityBadgeFamilies.map((family): CommunityIconRef => `badge:${family.id}:aurora`),
];

test('verified owner reader icon choices and default agree with its displayed top levels and achievements', async t => {
  const { json } = await setup(t);
  const me = await json<CommunityMe>('me');
  assert.equal(me.icon, 'vip:8', 'the default uses the displayed current VIP level');
  assert.equal(me.iconState?.equipped, me.icon);
  for (const ref of ownerTopIcons) assert.ok(me.iconState?.available.includes(ref), `${ref} agrees with displayed qualifications`);
  assert.equal(me.iconState?.available.some(ref => ref.startsWith('staff:')), false, 'personal owner presentation does not appoint a manager');
  const member = await json<CommunityMember>('members/10008?tab=icons');
  assert.deepEqual(member.iconState, me.iconState);
  assert.equal(member.person.icon, me.icon);
  const publicMember = await json<CommunityMember>('members/10008?tab=icons', 'reader');
  assert.equal(publicMember.person.icon, me.icon);
  assert.equal(Object.hasOwn(publicMember, 'iconState'), false, 'public profiles do not disclose the private selection catalogue');
});

for (const ref of ownerTopIcons) {
  test(`verified owner reader can select ${ref} and every author surface keeps the same icon`, async t => {
    const f = await setup(t);
    const topic = f.store.createTopic({ author: personal, board: 'qa', title: '作者个人图标一致性', body: '资料与公开文章的图标应使用同一份资格。' });
    f.store.addReply({ topicId: topic.id, author: personal, body: '回复作者也应保留相同的当前佩戴图标。' });
    f.store.like({ kind: 'topic', id: topic.id }, reader, true);
    const response = await f.post('shop/equip', { kind: 'icon', ref });
    assert.equal(response.status, 200, await response.clone().text());
    const selected = await response.json() as { icon: CommunityIconRef | null; iconState: CommunityIconState };
    assert.equal(selected.icon, ref); assert.equal(selected.iconState.selected, ref);
    assert.equal(selected.iconState.equipped, ref);
    const me = await f.json<CommunityMe>('me');
    const self = await f.json<CommunityMember>('members/10008?tab=icons');
    const publicMember = await f.json<CommunityMember>('members/10008', 'reader');
    assert.equal(me.icon, ref); assert.deepEqual(self.iconState, me.iconState);
    assert.equal(self.person.icon, ref); assert.equal(publicMember.person.icon, ref);
    assert.equal(publicMember.topics[0]?.author.icon, ref);
    const listing = await f.json<CommunityListing>('topics?board=qa', 'reader');
    const thread = await f.json<CommunityThread>(`topics/${topic.id}`, 'reader');
    const rank = await f.json<CommunityRank>('rank', 'reader');
    assert.equal(listing.items.find(item => item.id === topic.id)?.author.icon, ref);
    assert.equal(thread.topic.author.icon, ref); assert.equal(thread.author.icon, ref);
    assert.equal(thread.replies[0]?.author.icon, ref);
    assert.equal(rank.contributions.find(item => item.person.uid === '10008')?.person.icon, ref);
    assert.equal(f.store.members.iconSelection(personal), ref);
  });
}

test('verified owner reader removal and default remain separate without changing its qualifications', async t => {
  const f = await setup(t);
  assert.equal((await f.post('shop/equip', { kind: 'icon', ref: '' })).status, 200);
  const hidden = await f.json<CommunityMe>('me');
  assert.equal(hidden.icon, null); assert.equal(hidden.iconState?.selected, '');
  assert.ok(hidden.iconState?.available.includes('vip:8'));
  assert.equal((await f.json<CommunityMember>('members/10008', 'reader')).person.icon, null);
  assert.equal((await f.post('shop/equip', { kind: 'icon', ref: null })).status, 200);
  const restored = await f.json<CommunityMe>('me');
  assert.equal(restored.icon, 'vip:8'); assert.equal(restored.iconState?.selected, null);
  assert.deepEqual(restored.iconState?.available, hidden.iconState?.available);
});

test('ordinary readers, moderator previews and the author entity cannot borrow personal owner icon qualification', async t => {
  const f = await setup(t);
  for (const identity of ['reader', 'reader; community_browse=reader', 'steward; community_browse=reader', 'owner']) {
    const me = await f.json<CommunityMe>('me', identity);
    for (const ref of ownerTopIcons.filter(ref => ref !== 'trust:3')) {
      assert.equal(me.iconState?.available.includes(ref), false, `${identity}: ${ref}`);
      assert.equal((await f.post('shop/equip', { kind: 'icon', ref }, identity)).status, 403, `${identity}: ${ref}`);
    }
    if (identity !== 'owner') assert.equal((await f.post('shop/equip', { kind: 'icon', ref: 'trust:3' }, identity)).status, 403);
    assert.equal((await f.post('shop/equip', { kind: 'icon', ref: 'staff:owner' }, identity)).status, identity.startsWith('steward;') ? 403 : 400);
  }
  assert.equal(f.store.members.iconSelection(personal), null);
});

test('removing the verified owner-personal qualification hides but preserves its selected top icon', async t => {
  const f = await setup(t);
  assert.equal((await f.post('shop/equip', { kind: 'icon', ref: 'vip:8' })).status, 200);
  f.revokeOwnerReader();
  assert.equal((await f.get('me')).status, 503, 'a lost personal mapping cannot keep an author-personal execution session');
  const realReader = await f.json<CommunityMe>('me', 'personal');
  assert.equal(realReader.icon, null); assert.equal(realReader.iconState?.selected, 'vip:8');
  assert.equal(realReader.iconState?.available.includes('vip:8'), false, 'the saved icon remains unavailable for the grey catalogue item');
  assert.equal((await f.json<CommunityMember>('members/10008', 'reader')).person.icon, null);
  assert.equal((await f.post('shop/equip', { kind: 'icon', ref: 'vip:8' }, 'personal')).status, 403);
  assert.equal(f.store.members.iconSelection(personal), 'vip:8');
});

for (const change of ['mapping', 'account', 'principal'] as const) {
  test(`late ${change} invalidation cannot save a top owner-personal icon`, async t => {
    const f = await setup(t);
    if (change === 'principal') {
      let calls = 0;
      f.onIdentify(() => { if (++calls === 2) f.deactivateOwner(); });
    } else {
      let calls = 0;
      f.onOwnerReaderIdentity(() => {
        if (++calls !== 2) return;
        if (change === 'mapping') f.revokeOwnerReader(); else f.deactivatePersonal();
      });
    }
    const response = await f.post('shop/equip', { kind: 'icon', ref: 'vip:8' });
    assert.equal(response.status, 401, await response.clone().text());
    assert.equal(f.store.members.iconSelection(personal), null);
  });
}

test('owner top icon selection writes only decoration and never fills actual progression or rewards', async t => {
  const f = await setup(t);
  const tables = ['community_experience_ledger', 'community_experience_visits', 'community_vip_growth_days', 'community_badge_honors', 'community_badge_honor_reviews', 'community_badges', 'community_ledger', 'community_checkins', 'community_inventory', 'community_notifications'];
  const snapshot = () => {
    const db = new DatabaseSync(resolve(f.directory, 'content.db'), { readOnly: true });
    try { return tables.map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() })); }
    finally { db.close(); }
  };
  const before = snapshot();
  for (const ref of ownerTopIcons) {
    const response = await f.post('shop/equip', { kind: 'icon', ref });
    assert.equal(response.status, 200, await response.clone().text());
    await f.json<CommunityMe>('me'); await f.json<CommunityMember>('members/10008?tab=icons');
  }
  assert.deepEqual(snapshot(), before);
  assert.equal(f.store.experience.state(personal)?.points, 0);
  assert.equal(f.store.experience.vipState(personal, false)?.level, null);
  assert.deepEqual(f.store.members.iconHonors(personal), []);
  assert.equal(f.store.ledger.balance(personal), 0);
});

type OwnerPersonalVisit = {
  uid: string | null; awarded: number; visited: boolean;
  growth: CommunityMe['growth']; vipGrowth: CommunityMe['vipGrowth'];
};

test('the directly authenticated owner-personal reader keeps approved presentation but real business authority', async t => {
  const f = await setup(t);
  const me = await f.json<CommunityMe>('me', 'personal');
  const member = await f.json<CommunityMember>('members/10008?tab=badges', 'personal');
  const stardust = await f.json<CommunityStardust>('stardust', 'personal');
  assert.equal(me.vip, false, 'the real membership flag is not replaced with the decorative VIP8 projection');
  assert.equal(me.owner, false); assert.equal(me.mod, false); assert.equal(me.management, null);
  assert.equal(me.trustLevel, f.store.members.trustLevel(personal), 'normal reader authorization still uses earned trust');
  assert.equal(me.growth?.level, 10); assert.equal(me.vipGrowth?.level, 8);
  assert.deepEqual(me.growth, member.person.growth); assert.deepEqual(me.vipGrowth, member.person.vipGrowth);
  assert.deepEqual(stardust.growth, me.growth); assert.deepEqual(stardust.vipGrowth, me.vipGrowth);
  assert.deepEqual(me.badgeState, member.badgeState, 'the private account and public profile show the same approved achievements');
  assert.ok(me.badgeState?.families.every(family => family.tier === 'aurora'));
  assert.equal(me.icon, 'vip:8'); assert.equal(member.person.icon, me.icon);
  const vip = f.store.createTopic({ author: owner, board: 'vip', title: '真实会员业务边界', body: '装饰性的最高会员等级不会放大真实权限。' });
  assert.equal((await f.get(`topics/${vip.id}`, 'personal')).status, 404);
  assert.equal((await f.get('manage', 'personal')).status, 403);
  assert.equal((await f.post('manage/items', {}, 'personal')).status, 403);
});

for (const identity of ['owner; community_browse=reader', 'personal']) {
  test(`active entrance preserves top owner-personal presentation and settles the real non-VIP only once (${identity})`, async t => {
    const f = await setup(t); f.enableExperience();
    const before = await f.json<CommunityMe>('me', identity);
    const protectedTables = ['community_vip_growth_days', 'community_badge_honors', 'community_badge_honor_reviews', 'community_badges', 'community_ledger', 'community_checkins', 'community_inventory', 'community_notifications'];
    const snapshot = () => {
      const db = new DatabaseSync(resolve(f.directory, 'content.db'), { readOnly: true });
      try { return protectedTables.map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() })); }
      finally { db.close(); }
    };
    const original = snapshot();
    const response = await f.post('active/visit', {}, identity);
    assert.equal(response.status, 200, await response.clone().text());
    const first = await response.json() as OwnerPersonalVisit;
    assert.equal(first.uid, '10008'); assert.equal(first.visited, true);
    assert.equal(first.awarded, 10, 'the display VIP8 multiplier must never multiply actual non-VIP rewards');
    assert.deepEqual(first.growth, before.growth); assert.deepEqual(first.vipGrowth, before.vipGrowth);
    assert.equal(first.growth?.level, 10); assert.equal(first.vipGrowth?.level, 8);
    assert.equal(f.store.experience.state(personal)?.points, 10);
    assert.equal(f.store.experience.vipState(personal, false)?.days, 0);
    assert.equal(f.store.experience.state(owner), null, 'the author entity is not credited for its personal reader');
    const repeatedResponse = await f.post('active/visit', {}, identity);
    assert.equal(repeatedResponse.status, 200, await repeatedResponse.clone().text());
    const repeated = await repeatedResponse.json() as OwnerPersonalVisit;
    assert.equal(repeated.awarded, 0); assert.equal(repeated.visited, false);
    assert.deepEqual(repeated.growth, before.growth); assert.deepEqual(repeated.vipGrowth, before.vipGrowth);
    const after = await f.json<CommunityMe>('me', identity);
    assert.deepEqual(after.growth, before.growth); assert.deepEqual(after.vipGrowth, before.vipGrowth);
    assert.deepEqual(after.badgeState, before.badgeState); assert.equal(after.icon, 'vip:8');
    assert.equal(f.store.experience.state(personal)?.points, 10);
    const db = new DatabaseSync(resolve(f.directory, 'content.db'), { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_experience_visits WHERE member_kind=? AND member_id=?').get(personal.kind, personal.id)?.n, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_experience_ledger WHERE member_kind=? AND member_id=?').get(personal.kind, personal.id)?.n, 1);
    } finally { db.close(); }
    assert.deepEqual(snapshot(), original, 'one real entrance cannot fill VIP days, awards, balance or inventory');
  });
}
