import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
const member = (id: string): CommunityAuthor => ({ kind: 'reader', id });
const cleanup = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-icon-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close(); await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function fixture(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-icon-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  const accounts = new Map(['reader', 'other', 'staff'].map(id => [id, { active: true, vip: false }]));
  acceptCommunityConvention(store, [owner, ...[...accounts.keys()].map(member)]);
  const appoint = () => store.staff.appoint(owner, member('staff'), { role: 'general', boards: ['qa'], permissions: [], delegable: [] });
  appoint();
  let onPeople: (() => void | Promise<void>) | undefined;
  let onIdentify: (() => void | Promise<void>) | undefined;
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing fixture address');
  const origin = `http://127.0.0.1:${address.port}`;
  service = createCommunityService({ store, siteOrigin: origin, directory,
    identify: async req => {
      await onIdentify?.();
      const id = String(req.headers.cookie || 'reader').split(';')[0];
      return id === 'owner' ? { ...owner, name: '作者', vip: true } : accounts.get(id)?.active ? { ...member(id), name: id, vip: accounts.get(id)!.vip } : null;
    },
    people: async authors => {
      await onPeople?.();
      return new Map(authors.map(author => [`${author.kind}:${author.id}`, { name: author.id, uid: author.id, avatar: null,
        vip: author.kind === 'reader' && accounts.get(author.id)?.vip === true, active: author.kind === 'owner' || accounts.get(author.id)?.active === true,
        joinedAt: '2026-01-01T00:00:00Z', bio: '' }]));
    }, findMember: async id => accounts.has(id) ? member(id) : null,
  });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); store.close(); await cleanup(directory); });
  const get = (path: string, identity = 'reader') => fetch(`${origin}/api/community/${path}`, { headers: { Cookie: identity } });
  const post = (ref: unknown, identity = 'reader', extra = {}, headers = {}) => fetch(`${origin}/api/community/shop/equip`, {
    method: 'POST', headers: { Cookie: identity, Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ kind: 'icon', ref, ...extra }),
  });
  const sql = (action: (db: DatabaseSync) => void) => { const db = new DatabaseSync(resolve(directory, 'content.db')); try { action(db); } finally { db.close(); } };
  return { directory, store, accounts, get, post, sql, onPeople(hook: () => void | Promise<void>) { onPeople = hook; },
    onIdentify(hook: () => void | Promise<void>) { onIdentify = hook; } };
}

test('new members default to one current staff or VIP icon, ordinary readers default to none', async t => {
  const f = await fixture(t);
  const reader = await (await f.get('me')).json(); assert.equal(reader.icon, null);
  assert.equal((await (await f.get('me', 'staff')).json()).icon, 'staff:general');
  f.accounts.get('reader')!.vip = true;
  const vip = await (await f.get('me')).json(); assert.equal(vip.icon, 'vip:1');
  assert.deepEqual(vip.iconState, { selected: null, equipped: 'vip:1', available: ['growth:1', 'trust:0', 'vip:1'] });
});

test('the existing equipment endpoint preserves explicit selection, removal and default separately', async t => {
  const f = await fixture(t); f.accounts.get('reader')!.vip = true;
  const picked = await f.post('trust:0'); assert.equal(picked.status, 200, await picked.clone().text());
  assert.equal((await picked.json()).iconState.equipped, 'trust:0');
  assert.equal((await (await f.get('me')).json()).icon, 'trust:0');
  assert.equal((await f.post('')).status, 200);
  assert.deepEqual((await (await f.get('me')).json()).iconState, { selected: '', equipped: null, available: ['growth:1', 'trust:0', 'vip:1'] });
  assert.equal((await f.post(null)).status, 200);
  assert.equal((await (await f.get('me')).json()).icon, 'vip:1');
  const publicProfile = await (await f.get('members/reader', 'other')).json();
  assert.equal(publicProfile.person.icon, 'vip:1'); assert.equal(Object.hasOwn(publicProfile, 'iconState'), false);
  assert.equal(Object.hasOwn(publicProfile.person, 'iconState'), false);
  assert.equal((await (await f.get('members/reader')).json()).iconState.selected, null);
});

test('membership storage has a nullable icon selection without changing existing decorations', async t => {
  const f = await fixture(t);
  f.sql(db => { assert.ok(db.prepare('PRAGMA table_info(community_members)').all().some(row => row.name === 'name_icon')); });
  assert.deepEqual(f.store.members.decorations(member('reader')), { frame: null, color: null, cover: null });
});

test('earned lower growth and effective trust choices stay distinct from money and purchased equipment', async t => {
  const f = await fixture(t);
  f.sql(db => db.prepare("INSERT INTO community_experience_ledger(id,member_kind,member_id,amount,kind,reason,day,ref_kind,ref_id,created_at) VALUES('growth','reader','reader',3600,'earn','login','2026-10-01','day','2026-10-01','2026-10-01T00:00:00Z')").run());
  const before = f.store.members.decorations(member('reader')), points = f.store.experience.state(member('reader'))!.points;
  const balance = f.store.ledger.balance(member('reader'));
  for (const ref of ['growth:1', 'growth:2', 'growth:3', 'trust:0']) assert.equal((await f.post(ref)).status, 200, ref);
  for (const ref of ['growth:4', 'trust:1', 'vip:1', 'staff:general', 'badge:writing:gold']) assert.equal((await f.post(ref)).status, 403, ref);
  assert.equal((await f.post('trust:3', 'staff')).status, 200);
  assert.deepEqual(f.store.members.decorations(member('reader')), before);
  assert.equal(f.store.experience.state(member('reader'))!.points, points); assert.equal(f.store.ledger.balance(member('reader')), balance);
  f.store.staff.revoke(owner, member('staff'));
  const revoked = await (await f.get('me', 'staff')).json();
  assert.equal(revoked.icon, null); assert.equal(revoked.iconState.selected, 'trust:3');
  assert.equal(revoked.iconState.available.includes('trust:3'), false);
});

for (const invalid of [['growth:1'], 1, {}, 'growth:01', 'trust:4', 'staff:owner', 'badge:unknown:gold', 'badge:writing:bronze']) {
  test(`invalid or multiple icon selections are rejected (${JSON.stringify(invalid)})`, async t => {
    const f = await fixture(t); assert.equal((await f.post(invalid)).status, 400);
    assert.equal((await (await f.get('me')).json()).iconState.selected, null);
  });
}

test('VIP expiry preserves selection but hides it publicly and rejects wearing it again', async t => {
  const f = await fixture(t); f.accounts.get('reader')!.vip = true;
  assert.equal((await f.post('vip:1')).status, 200); f.accounts.get('reader')!.vip = false;
  const self = await (await f.get('me')).json(); assert.equal(self.icon, null);
  assert.equal(self.iconState.selected, 'vip:1'); assert.equal(self.iconState.available.includes('vip:1'), false);
  assert.equal((await (await f.get('members/reader', 'other')).json()).person.icon, null);
  assert.equal((await f.post('vip:1')).status, 403);
  f.accounts.get('reader')!.vip = true; assert.equal((await (await f.get('me')).json()).icon, 'vip:1');
});

for (const change of ['revoked', 'demoted', 'inactive'] as const) {
  test(`staff eligibility is rechecked after profile resolution (${change})`, async t => {
    const f = await fixture(t); let calls = 0;
    f.onPeople(() => {
      if (++calls !== 3) return;
      if (change === 'revoked') f.store.staff.revoke(owner, member('staff'));
      else if (change === 'demoted') f.store.staff.appoint(owner, member('staff'), { role: 'moderator', boards: ['qa'], permissions: [], delegable: [] });
      else f.accounts.get('staff')!.active = false;
    });
    assert.equal((await f.post('staff:general', 'staff')).status, change === 'inactive' ? 401 : 403);
    assert.equal(f.store.members.iconSelection(member('staff')), null);
  });
}

test('the final authenticated membership overrides an older profile batch', async t => {
  const f = await fixture(t); f.accounts.get('reader')!.vip = true; let calls = 0;
  f.onIdentify(() => { if (++calls === 2) f.accounts.get('reader')!.vip = false; });
  assert.equal((await f.post('vip:1')).status, 403);
  assert.equal(f.store.members.iconSelection(member('reader')), null);
});

test('an inactive appointment ancestor during the final identity lookup cannot authorize a staff icon', async t => {
  const f = await fixture(t);
  f.store.staff.appoint(owner, member('staff'), { role: 'general', boards: ['qa'], permissions: ['staff.appoint'], delegable: [] });
  f.store.staff.appoint(member('staff'), member('other'), { role: 'moderator', boards: ['qa'], permissions: [], delegable: [] });
  let calls = 0;
  f.onIdentify(() => { if (++calls === 2) f.accounts.get('staff')!.active = false; });
  assert.equal((await f.post('staff:moderator', 'other')).status, 403);
  assert.equal(f.store.members.iconSelection(member('other')), null);
});

for (const qualification of ['growth', 'honor'] as const) {
  test(`current ${qualification} eligibility is read again after asynchronous people resolves`, async t => {
    const f = await fixture(t);
    f.sql(db => {
      db.prepare("INSERT INTO community_experience_ledger(id,member_kind,member_id,amount,kind,reason,day,ref_kind,ref_id,created_at) VALUES('growth','reader','reader',1200,'earn','login','2026-10-01','day','2026-10-01','2026-10-01T00:00:00Z')").run();
      db.prepare("INSERT INTO community_badge_honors(member_kind,member_id,family,tier,created_at,evidence) VALUES('reader','reader','writing','gold','2026-10-01T00:00:00Z','{}')").run();
    });
    f.onPeople(() => f.sql(db => {
      if (qualification === 'growth') db.prepare("DELETE FROM community_experience_ledger WHERE id='growth'").run();
      else db.prepare("UPDATE community_badge_honors SET revoked_at='2026-10-02T00:00:00Z' WHERE member_id='reader'").run();
    }));
    assert.equal((await f.post(qualification === 'growth' ? 'growth:2' : 'badge:writing:gold')).status, 403);
    assert.equal(f.store.members.iconSelection(member('reader')), null);
  });
}

test('accumulated membership days allow earned lower VIP icons only while membership is active', async t => {
  const f = await fixture(t); f.accounts.get('reader')!.vip = true;
  f.sql(db => { for (let day = 1; day <= 30; day++) db.prepare("INSERT INTO community_vip_growth_days(member_kind,member_id,day,created_at) VALUES('reader','reader',?,?)").run(`2026-09-${String(day).padStart(2, '0')}`, '2026-09-01T00:00:00Z'); });
  assert.equal((await (await f.get('me')).json()).icon, 'vip:2');
  for (const ref of ['vip:1', 'vip:2']) assert.equal((await f.post(ref)).status, 200);
  assert.equal((await f.post('vip:3')).status, 403);
  f.accounts.get('reader')!.vip = false;
  assert.equal((await (await f.get('me')).json()).iconState.available.some((ref: string) => ref.startsWith('vip:')), false);
});

test('confirmed achievement tiers can be chosen, revoked and restored without using legacy or unearned progress', async t => {
  const f = await fixture(t);
  f.sql(db => {
    db.prepare("INSERT INTO community_badges(member_kind,member_id,badge,created_at) VALUES('reader','reader','first_topic','2026-10-01T00:00:00Z')").run();
    db.prepare("INSERT INTO community_badge_honors(member_kind,member_id,family,tier,created_at,evidence) VALUES('reader','reader','writing','diamond','2026-10-01T00:00:00Z','{}')").run();
  });
  assert.equal((await f.post('badge:writing:gold')).status, 403, 'legacy and higher-tier honors cannot invent an unawarded tier');
  assert.equal((await f.post('badge:writing:diamond')).status, 200);
  f.store.createTopic({ board: 'qa', author: member('reader'), title: '真实公开作者图标', body: '这里的昵称不需要重新结算成就进度。' });
  const original = f.store.members.badgeState; f.store.members.badgeState = () => { throw Error('Public authors must not recompute badges'); };
  t.after(() => { f.store.members.badgeState = original; });
  const page = await f.get('topics?board=qa', 'other'); assert.equal(page.status, 200, await page.clone().text());
  assert.equal((await page.json()).items[0].author.icon, 'badge:writing:diamond');
  f.sql(db => db.prepare("UPDATE community_badge_honors SET revoked_at='2026-10-02T00:00:00Z' WHERE member_id='reader'").run());
  assert.equal((await (await f.get('topics?board=qa', 'other')).json()).items[0].author.icon, null);
  assert.equal((await f.post('badge:writing:diamond')).status, 403);
  assert.equal(f.store.members.iconSelection(member('reader')), 'badge:writing:diamond');
  f.sql(db => db.prepare("UPDATE community_badge_honors SET restored_at='2026-10-03T00:00:00Z' WHERE member_id='reader'").run());
  assert.equal((await (await f.get('topics?board=qa', 'other')).json()).items[0].author.icon, 'badge:writing:diamond');
});

test('read-only perspectives, foreign origins, missing authentication and forged qualifications cannot set a selection', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('trust:0', 'staff; community_browse=reader')).status, 403);
  assert.equal((await f.post('trust:0', 'reader', {}, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.post('trust:0', 'missing')).status, 401);
  assert.equal((await f.post('vip:8', 'reader', { vip: true, available: ['vip:8'] })).status, 400);
  assert.equal(f.store.members.iconSelection(member('reader')), null);
});

test('owner technical permissions do not fabricate growth, VIP or an owner staff icon', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('growth:10', 'owner')).status, 403);
  assert.equal((await f.post('vip:8', 'owner')).status, 403);
  assert.equal((await f.post('trust:3', 'owner')).status, 200);
  assert.equal((await (await f.get('me', 'owner')).json()).icon, 'trust:3');
});

test('a member profile does not keep an old public icon when authority changes during its topic batch', async t => {
  const f = await fixture(t); assert.equal((await f.post('staff:general', 'staff')).status, 200);
  f.store.createTopic({ board: 'qa', author: member('staff'), title: '身份已变化的资料页', body: '资料昵称和文章作者必须使用当前有效选择。' });
  let calls = 0; f.onPeople(() => { if (++calls === 2) f.store.staff.revoke(owner, member('staff')); });
  const response = await f.get('members/staff', 'other'); assert.equal(response.status, 200);
  const profile = await response.json(); assert.equal(profile.person.icon, null);
  assert.equal(profile.topics[0].author.icon, null);
  assert.equal(f.store.members.iconSelection(member('staff')), 'staff:general');
});
