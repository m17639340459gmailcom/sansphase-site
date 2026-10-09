import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { migrateCommunity } from "../server/payload/community-migration.ts";
import { createCommunityStore } from "../server/community-store.ts";
import { createCommunityPreviewStore } from './fixtures/community-preview-store.ts';
import { createCommunityService, communityContactReason } from "../server/community-service.ts";
import { createPreviewServer } from "../server.mjs";
import { beijingDay } from "../src/community-rules.mjs";
import { communityBoards } from '../src/community.mjs';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';
import { communityLegacyStaffPermissions } from '../server/community-staff.ts';

// Signed-in members, by cookie `reader=<id>` or `owner=yes`. uid is the public id
// used by member pages; r1 has an approved avatar.
const avatarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const allModerationBoards = communityBoards.map(board => board.id);
const members = {
  p1: { name: '無相', uid: 'u6', vip: false, ownerReader: true },
  r1: { name: "林间", uid: "u1", vip: false, avatar: avatarId, bio: "喜欢画画" },
  r2: { name: "远山", uid: "u2", vip: false },
  r3: { name: "新人", uid: "u3", vip: false },
  v1: { name: "墨白", uid: "u4", vip: true },
  s1: { name: "守望", uid: "u5", vip: false },
};
const authorOf = (uid) => uid === "owner" ? { kind: "owner", id: "owner" } : Object.entries(members).filter(([, m]) => m.uid === uid).map(([id]) => ({ kind: "reader", id }))[0] || null;
const cleanup = (directory) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

// One migrated database, copied for each test (see community-store.test.mjs).
let template;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), "sansphase-community-api-template-"));
  new DatabaseSync(resolve(template, "content.db")).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));

// r1, r2, v1 and s1 have agreed to the guidelines and reached 巡天 (L1); r3 is brand new.
async function setup(t, { store: withStore = true, simplePosting = false, useDefault = false, identifyOverride, ownerReaderIdentityOverride, peopleOverride, vipOverride, avatarBytes, profile } = {}) {
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  const siteOrigin = `http://127.0.0.1:${port}`;
  const directory = await mkdtemp(resolve(tmpdir(), "sansphase-community-api-"));
  await copyFile(resolve(template, "content.db"), resolve(directory, "content.db"));
  await mkdir(resolve(directory, "uploads"));
  await writeFile(resolve(directory, "uploads", `reader-avatar-${avatarId}.webp`), "avatar-bytes");
  const sql = (statement, ...args) => {
    const db = new DatabaseSync(resolve(directory, "content.db"));
    try { db.exec("PRAGMA busy_timeout = 5000"); return db.prepare(statement).run(...args); } finally { db.close(); }
  };
  const setLevel = (id, level) => {
    sql("INSERT OR IGNORE INTO community_members (member_kind, member_id, created_at) VALUES ('reader', ?, ?)", id, new Date().toISOString());
    sql("UPDATE community_members SET level = ?, level_day = ?, agreed_at = COALESCE(agreed_at, ?) WHERE member_kind = 'reader' AND member_id = ?", level, beijingDay(Date.now()), new Date().toISOString(), id);
  };
  for (const id of ["r1", "r2", "v1", "s1"]) setLevel(id, 1);
  const store = withStore ? createCommunityPreviewStore(directory) : null;
  if (store) acceptCommunityConvention(store, [{ kind: 'owner', id: 'owner' }, ...Object.keys(members).map(id => ({ kind: 'reader', id }))]);
  const audits = [];
  const actualVip = id => vipOverride?.[id] ?? members[id].vip;
  const communityService = createCommunityService({
    store, siteOrigin, directory, ownerId: "owner", ...(useDefault ? {} : { simplePosting }),
    identify: async (req) => {
      if (identifyOverride) return identifyOverride(req);
      const cookies = new Map(String(req.headers.cookie || '').split(';').map(part => part.trim().split('=')));
      if (cookies.get('owner') === 'yes') return { kind: "owner", id: "owner", name: "無相", vip: true };
      const id = cookies.get('reader');
      return members[id] ? { kind: "reader", id, name: members[id].name, vip: actualVip(id) } : null;
    },
    ownerReaderIdentity: async req => ownerReaderIdentityOverride ? ownerReaderIdentityOverride(req) : /(?:^|;\s*)owner=yes(?:;|$)/.test(String(req.headers.cookie || '')) ? {kind:'reader',id:'p1',name:members.p1.name,vip:actualVip('p1')} : null,
    people: async (authors) => {
      const map = new Map(authors.flatMap((author) => {
        const info = author.kind === "owner" ? { name: "無相", uid: "owner", vip: true } : members[author.id];
        return info ? [[`${author.kind}:${author.id}`, { name: info.name, uid: info.uid, avatar: info.avatar || null, vip: author.kind === 'owner' ? info.vip : actualVip(author.id),active:true, joinedAt: author.kind === "owner" ? null : "2026-01-01T00:00:00.000Z", bio: info.bio || "", ...(info.ownerReader ? {ownerReader:true} : {}) }]] : [];
      }));
      return peopleOverride ? peopleOverride(authors, map) : map;
    },
    findMember: async (uid) => authorOf(uid),
    findByNames: async (names) => new Map([...Object.entries(members).map(([id, m]) => [m.name, { kind: "reader", id }]), ["無相", { kind: "owner", id: "owner" }]].filter(([name]) => names.includes(name))),
    ...(avatarBytes ? { avatarBytes } : { avatarFile: async (uid) => uid === "u1" ? resolve(directory, "uploads", `reader-avatar-${avatarId}.webp`) : null }),
    ...(profile ? { profile } : {}),
    audit: async (action, details) => { audits.push({ action, ...details }); },
  });
  const server = createPreviewServer({ contentService: { snapshot: async () => ({ data: { notes: [] } }) }, communityService, communityEnabled: true });
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
  t.after(async () => {
    await new Promise((done) => server.close(done));
    store?.close();
    await cleanup(directory);
  });
  const get = (path, cookie = "reader=r1", headers = {}) => fetch(`${siteOrigin}/api/community/${path}`, { headers: { cookie, ...headers } });
  const post = (path, body, cookie = "reader=r1", headers = {}) => fetch(`${siteOrigin}/api/community/${path}`, {
    method: "POST",
    headers: { Origin: siteOrigin, "X-Reader-Request": "1", "Content-Type": "application/json", cookie, ...headers },
    body: JSON.stringify(body),
  });
  const upload = (bytes, type = "image/png", cookie = "reader=r1", headers = {}) => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), "picture.png");
    return fetch(`${siteOrigin}/api/community/images`, { method: "POST", headers: { Origin: siteOrigin, "X-Reader-Request": "1", cookie, ...headers }, body: form });
  };
  const credit = (id, amount) => store.ledger.credit(id === "owner" ? { kind: "owner", id } : { kind: "reader", id }, amount, "test", null, new Date().toISOString());
  return { get, post, upload, siteOrigin, store, audits, setLevel, credit, directory };
}
const json = async (response) => (await response).json();

test('VIP daily check-in responses use authoritative membership and ignore client reward and VIP fields', async t => {
  const { get, post, store } = await setup(t);
  for (const [cookie, base] of [['reader=r1', 1], ['reader=v1', 2]]) {
    const me = await json(get('me', cookie)), page = await json(get('checkin', cookie));
    assert.equal(me.nextReward.base, base);
    assert.equal(page.dailyReward, base);
    const result = await json(post('checkin', { vip: base === 1, reward: 999999, bonus: 999999 }, cookie));
    assert.equal(result.reward, base);
    assert.equal(result.bonus, 0);
    assert.equal((await post('checkin', { vip: true }, cookie)).status, 409);
    const member = { kind: 'reader', id: cookie.slice('reader='.length) };
    assert.equal(store.ledger.balance(member), base);
    assert.equal(store.ledger.history(member).filter(row => row.reason === 'checkin').length, 1);
    assert.equal((await json(get('me', cookie))).nextReward.base, base);
  }
});

test('VIP expiration and upgrade affect new daily eligibility without topping up an existing sign-in', async t => {
  const vipOverride = { v1: false, r1: false, r2: false };
  const { get, post, store } = await setup(t, { vipOverride });
  assert.equal((await json(get('checkin', 'reader=v1'))).dailyReward, 1, 'an expired VIP is ordinary');
  assert.equal((await json(post('checkin', { vip: true }, 'reader=v1'))).reward, 1);
  assert.equal((await json(post('checkin', {}))).reward, 1);
  vipOverride.r1 = true;
  assert.equal((await json(get('me'))).nextReward.base, 2);
  assert.equal((await post('checkin', {})).status, 409, 'same-day upgrade cannot top up the previous sign-in');
  assert.equal(store.ledger.balance({ kind: 'reader', id: 'r1' }), 1);
  vipOverride.r2 = true;
  assert.equal((await json(get('checkin', 'reader=r2'))).dailyReward, 2);
  assert.equal((await json(post('checkin', { vip: false }, 'reader=r2'))).reward, 2);
});

test('check-in rechecks membership and authentication after asynchronous request work', async t => {
  let calls = 0;
  const expired = await setup(t, { vipOverride: { v1: false }, identifyOverride: async () => { calls++; return { kind: 'reader', id: 'v1', name: '墨白', vip: calls === 1 }; } });
  assert.equal((await json(expired.post('checkin', { vip: true }, 'reader=v1'))).reward, 1, 'the original VIP snapshot cannot override expiry at commit');
  assert.equal(calls, 3, 'initial identity, completed body, and final account profile each have their authority boundary');
  calls = 0;
  const upgraded = await setup(t, { identifyOverride: async () => ({ kind: 'reader', id: 'v1', name: '墨白', vip: ++calls > 1 }) });
  assert.equal((await json(upgraded.get('me', 'reader=v1'))).nextReward.base, 2);
  calls = 0;
  assert.equal((await json(upgraded.post('checkin', { vip: false }, 'reader=v1'))).reward, 2, 'fresh account VIP qualification supersedes an older non-VIP request snapshot');
  assert.equal(calls, 3);
  calls = 0;
  const revoked = await setup(t, { identifyOverride: async () => ++calls === 1 ? { kind: 'reader', id: 'v1', name: '墨白', vip: true } : null });
  assert.equal((await revoked.post('checkin', {}, 'reader=v1')).status, 401);
  assert.equal(revoked.store.ledger.balance({ kind: 'reader', id: 'v1' }), 0);
  calls = 0;
  const changed = await setup(t, { identifyOverride: async () => ({ kind: 'reader', id: ++calls === 1 ? 'v1' : 'r2', name: '读者', vip: true }) });
  assert.equal((await changed.post('checkin', {}, 'reader=v1')).status, 401);
  assert.equal(changed.store.ledger.balance({ kind: 'reader', id: 'v1' }), 0);
});

test('check-in never consumes a daily slot when the authoritative account is missing or inactive', async t => {
  for (const missing of [true, false]) {
    const { post, store } = await setup(t, { peopleOverride: async (_authors, map) => missing ? new Map() : new Map([...map].map(([key, info]) => [key, { ...info, active: false }])) });
    assert.equal((await post('checkin', { vip: true }, 'reader=v1')).status, 401);
    const member = { kind: 'reader', id: 'v1' };
    assert.equal(store.economy.checked(member), false);
    assert.equal(store.ledger.balance(member), 0);
  }
});

test('owner personal reader uses real VIP qualification instead of the full-level display projection', async t => {
  for (const [vip, reward] of [[false, 1], [true, 2]]) {
    const { get, post, store } = await setup(t, { vipOverride: { p1: vip } });
    const cookie = 'owner=yes; community_browse=reader';
    const me = await json(get('me', cookie)), page = await json(get('checkin', cookie));
    assert.equal(me.vip, true, 'the display stays full-level in owner reader mode');
    assert.equal(me.nextReward.base, reward);
    assert.equal(page.dailyReward, reward);
    assert.equal((await json(post('checkin', { vip: !vip }, cookie))).reward, reward);
    assert.equal(store.ledger.balance({ kind: 'reader', id: 'p1' }), reward);
    assert.equal(store.ledger.balance({ kind: 'owner', id: 'owner' }), 0);
    assert.equal((await post('checkin', {}, 'owner=yes')).status, 403);
  }
  let personalCalls = 0;
  const revoked = await setup(t, { ownerReaderIdentityOverride: async () => ++personalCalls === 1 ? { kind: 'reader', id: 'p1', name: '無相', vip: true } : null });
  assert.equal((await revoked.post('checkin', {}, 'owner=yes; community_browse=reader')).status, 401);
  assert.equal(revoked.store.ledger.balance({ kind: 'reader', id: 'p1' }), 0);
});

test('VIP free makeup never reissues the daily or VIP stardust reward', async t => {
  const { get, post, store } = await setup(t);
  const cookie = 'reader=v1', member = { kind: 'reader', id: 'v1' };
  assert.equal((await json(post('checkin', {}, cookie))).reward, 2);
  const page = await json(get('checkin', cookie));
  assert.equal(page.makeup.free, true);
  const balance = store.ledger.balance(member);
  const result = await json(post('checkin/makeup', { day: page.makeup.days[0], vip: true, reward: 999999 }, cookie));
  assert.equal(result.cost, 'free'); assert.equal(result.bonus, 0); assert.equal(result.balance, balance);
  assert.equal(store.ledger.history(member).filter(row => row.reason === 'checkin').length, 1);
});

test('remote approved avatar bytes stay private and authority outages remain unavailable', async t => {
  let offline = false;
  const { get } = await setup(t, { avatarBytes: async uid => {
    if (offline) throw Object.assign(Error('Identity authority unavailable.'), { status: 503 });
    return uid === 'u1' ? Buffer.from('approved-remote-avatar') : null;
  } });
  const response = await get('avatar/u1.webp');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-cache');
  assert.equal(await response.text(), 'approved-remote-avatar');
  assert.equal((await get('avatar/u2.webp')).status, 404);
  offline = true;
  const unavailable = await get('avatar/u1.webp', 'reader=r1', { 'If-None-Match': response.headers.get('etag') });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('etag'), null);
  assert.equal(unavailable.headers.get('cache-control'), 'private, no-store');
});

test('approved avatar validators reauthorize every read, track actual bytes and never survive removal or logout', async t => {
  let enabled = true, bytes = Buffer.from('approved-first');
  const { get } = await setup(t, {
    identifyOverride: async () => enabled ? { kind: 'reader', id: 'r1', name: '林间', vip: false } : null,
    avatarBytes: async () => bytes,
  });
  const first = await get('avatar/u1.webp');
  assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'private, no-cache');
  assert.equal(first.headers.get('vary'), 'Cookie');
  const etag = first.headers.get('etag'); assert.match(etag, /^"[0-9a-f]{64}"$/);
  assert.equal(await first.text(), 'approved-first');
  for (const validator of [etag, 'W/' + etag, '"different", W/' + etag, '*']) {
    const reused = await get('avatar/u1.webp', 'reader=r1', { 'If-None-Match': validator });
    assert.equal(reused.status, 304); assert.equal(await reused.text(), '');
    assert.equal(reused.headers.get('etag'), etag); assert.equal(reused.headers.get('cache-control'), 'private, no-cache');
    assert.equal(reused.headers.get('content-length'), null);
  }
  bytes = Buffer.from('approved-next');
  const next = await get('avatar/u1.webp', 'reader=r1', { 'If-None-Match': etag });
  assert.equal(next.status, 200); assert.notEqual(next.headers.get('etag'), etag); assert.equal(await next.text(), 'approved-next');
  bytes = null;
  let denied = await get('avatar/u1.webp', 'reader=r1', { 'If-None-Match': etag });
  assert.equal(denied.status, 404); assert.equal(denied.headers.get('etag'), null); assert.equal(denied.headers.get('cache-control'), 'private, no-store');
  enabled = false;
  denied = await get('avatar/u1.webp', 'reader=r1', { 'If-None-Match': '*' });
  assert.equal(denied.status, 401); assert.equal(denied.headers.get('etag'), null); assert.equal(denied.headers.get('cache-control'), 'private, no-store');
});

test('approved avatar cannot return bytes or a validator after requester identity expires during the read', async t => {
  let enabled = true;
  const { get } = await setup(t, {
    identifyOverride: async () => enabled ? { kind: 'reader', id: 'r1', name: '林间', vip: false } : null,
    avatarBytes: async () => { enabled = false; return Buffer.from('approved-avatar'); },
  });
  const denied = await get('avatar/u1.webp', 'reader=r1', { 'If-None-Match': '*' });
  assert.equal(denied.status, 401); assert.equal(denied.headers.get('etag'), null);
  assert.equal(denied.headers.get('cache-control'), 'private, no-store');
});

test('community image validators preserve attachment ownership, variant bytes and withdrawn visibility', async t => {
  const { get, upload, store } = await setup(t);
  const image = await json(upload(await png()));
  const path = `images/${image.id}.webp`;
  const first = await get(path); const etag = first.headers.get('etag');
  assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.equal(etag, null); await first.arrayBuffer();
  assert.equal((await get(path, 'reader=r1', { 'If-None-Match': '*' })).status, 200);
  let denied = await get(path, 'reader=r2', { 'If-None-Match': '*' });
  assert.equal(denied.status, 404); assert.equal(denied.headers.get('etag'), null); assert.equal(denied.headers.get('cache-control'), 'private, no-store');
  const topic = store.createTopic({ ...topicBody, author: { kind: 'reader', id: 'r1' }, images: [image.id] });
  const published = await get(path, 'reader=r2'); const approvedTag=published.headers.get('etag');
  assert.ok(approvedTag); assert.equal(published.headers.get('cache-control'), 'private, no-cache'); await published.arrayBuffer();
  assert.equal((await get(path, 'reader=r2', { 'If-None-Match': approvedTag })).status, 304);
  const thumb = await get(`images/${image.id}.thumb.webp`, 'reader=r2', { 'If-None-Match': approvedTag });
  assert.equal(thumb.status, 200); assert.notEqual(thumb.headers.get('etag'), approvedTag);
  store.hide({ kind: 'topic', id: topic.id }, '隐藏后必须重新授权图片');
  const reviewOnly=await get(path,'owner=yes',{'If-None-Match':approvedTag});
  assert.equal(reviewOnly.status,200);assert.equal(reviewOnly.headers.get('cache-control'),'private, no-store');assert.equal(reviewOnly.headers.get('etag'),null);await reviewOnly.arrayBuffer();
  denied = await get(path, 'reader=r2', { 'If-None-Match': '*' });
  assert.equal(denied.status, 404); assert.equal(denied.headers.get('etag'), null); assert.equal(denied.headers.get('cache-control'), 'private, no-store');
});

test('pending topic and background images never cache or return 304 to uploaders or reviewers', async t => {
  const {get,upload,store,directory}=await setup(t),author={kind:'reader',id:'r1'};
  const image=await json(upload(await png()));
  const topic=store.createTopic({...topicBody,author,images:[image.id],pending:'待审'});
  const background='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  store.addImage({id:background,uploader:author,width:64,height:64,purpose:'profile'});
  await writeFile(resolve(directory,'uploads',`community-image-${background}.webp`),await png());
  await writeFile(resolve(directory,'uploads',`community-thumb-${background}.webp`),await png());
  store.profileBackgrounds.submit(author,background);
  for(const id of [image.id,background])for(const cookie of ['reader=r1','owner=yes'])for(const suffix of ['.webp','.thumb.webp']) {
    const response=await get(`images/${id}${suffix}`,cookie,{'If-None-Match':'*'});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('etag'),null);await response.arrayBuffer();
  }
  store.approveTopic(topic.id);store.profileBackgrounds.review(author,background,true,{kind:'owner',id:'owner'},'');
  for(const id of [image.id,background]) {
    const response=await get(`images/${id}.webp`,'reader=r2');const tag=response.headers.get('etag');
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-cache');assert.ok(tag);await response.arrayBuffer();
    assert.equal((await get(`images/${id}.webp`,'reader=r2',{'If-None-Match':tag})).status,304);
  }
});

test('matching image validator cannot skip the final visibility check after file reading', async t => {
  const { get, upload, store } = await setup(t);
  const image = await json(upload(await png()));
  const topic = store.createTopic({ ...topicBody, author: { kind: 'reader', id: 'r1' }, images: [image.id] });
  const path = `images/${image.id}.webp`;
  const first = await get(path, 'reader=r2'), etag = first.headers.get('etag'); await first.arrayBuffer();
  assert.ok(etag);
  const original = store.image.bind(store); let reads = 0;
  t.mock.method(store, 'image', id => {
    if (++reads === 2) store.hide({ kind: 'topic', id: topic.id }, '读取过程中撤回');
    return original(id);
  });
  const denied = await get(path, 'reader=r2', { 'If-None-Match': etag });
  assert.equal(denied.status, 404); assert.equal(reads, 2);
  assert.equal(denied.headers.get('etag'), null); assert.equal(denied.headers.get('cache-control'), 'private, no-store');
});

test('forged like amounts and identities, duplicates and unlike/re-like cannot mint stardust or experience', async t => {
  const { get, post, store } = await setup(t);
  const author = { kind: 'reader', id: 'r1' }, fan = { kind: 'reader', id: 'r2' };
  const topic = store.createTopic({ author, board: 'qa', title: '防刷数值接口验证', body: '这是验证账号去重和奖励边界的有效主题正文。' });
  const balances = [store.ledger.balance(author), store.ledger.balance(fan)];
  const attack = { on: true, earned: 999999, amount: 999999, likes: 999999, points: 999999, member_id: 'r3', author_id: 'r3', vip: true, level: 10, now: '2099-01-01T00:00:00Z' };
  for (let i = 0; i < 8; i++) {
    const value = await json(post(`topics/${topic.id}/like`, attack, 'reader=r2'));
    assert.deepEqual(value, { likes: 1, liked: true, earned: 0 });
  }
  assert.equal((await post(`topics/${topic.id}/like`, attack)).status, 400, 'self likes remain rejected');
  assert.equal((await post(`topics/${topic.id}/like`, attack, '')).status, 401);
  assert.equal((await post(`topics/${topic.id}/like`, attack, 'reader=r2', { Origin: 'https://evil.example' })).status, 403);
  assert.deepEqual(await json(post(`topics/${topic.id}/like`, { on: false }, 'reader=r2')), { likes: 0, liked: false, earned: 0 });
  assert.deepEqual(await json(post(`topics/${topic.id}/like`, attack, 'reader=r2')), { likes: 1, liked: true, earned: 0 });
  assert.deepEqual([store.ledger.balance(author), store.ledger.balance(fan)], balances);
  assert.equal((await json(get('me'))).growth.points, 0);
  assert.equal((await json(get('me', 'reader=r2'))).growth.points, 0);
});

test('check-in and redemption use server amounts and prices despite forged client currency fields', async t => {
  const { get, post, store, credit } = await setup(t);
  const member = { kind: 'reader', id: 'r1' };
  const checkin = await json(post('checkin', { reward: 999999, balance: 999999, vip: true, streak: 365 }));
  assert.equal(checkin.reward, 1);
  const balance = store.ledger.balance(member);
  await post('checkin', { reward: 999999 });
  assert.equal(store.ledger.balance(member), balance);
  assert.equal((await json(get('me'))).growth.points, 0, 'check-in is not a login experience route');
  credit('r1', 500);
  const item = store.economy.item('frame-gold'), before = store.ledger.balance(member);
  assert.ok(item);
  const response = await post('shop/redeem', { item: item.id, price: 0, amount: -999999, balance: 999999, level: 10, owner: true });
  assert.equal(response.status, 201);
  assert.equal(store.ledger.balance(member), before - item.price);
});
const png = async () => (await import("sharp")).default({ create: { width: 1200, height: 800, channels: 3, background: "#d9c49c" } }).png().toBuffer();
const topicBody = { board: "qa", title: "ComfyUI 人脸崩了", body: "IPAdapter 和 ControlNet 一起用就崩。" };
const imageMarker = id => `![图片](/api/community/images/${id}.webp)`;
const emptyGrowth = { level: 1, points: 0, configured: true, startThreshold: 0, nextLevel: 2, nextThreshold: 1200, remaining: 1200, progress: 0 };
const emptyVIPGrowth = { active: false, level: null, days: 0, nextDays: 30, remaining: 30, multiplier: 1, progress: 0 };

test('badge family state is public but reviewed evidence and revoke/restore operations require owner and are audited', async t => {
  const { get, post, store, audits } = await setup(t);
  const author = { kind: 'reader', id: 'r1' };
  const first = store.createTopic({ board: 'qa', author, title: '徽章复核测试主题', body: '检查荣誉授予、错误撤销、来源复核以及恢复过程。', now: '2025-10-01T00:00:00.000Z' });
  store.members.setSteward({ kind: 'reader', id: 's1' }, true, ['qa']);
  const profile = await json(get('members/u1'));
  assert.equal(profile.badgeState.families.find(item => item.id === 'writing').tier, 'gold');
  assert.equal(Object.hasOwn(profile.badgeState, 'evidence'), false);
  assert.equal((await get('manage/badges/u1', 'reader=s1')).status, 403);
  assert.equal((await get('manage/badges/u1', 'reader=r2')).status, 403);
  const review = { action: 'revoke', family: 'writing', tier: 'gold', reason: '复核认为来源有误', sources: [{ kind: 'topic', id: first.id }] };
  assert.equal((await post('manage/badges/u1/review', review, 'reader=s1')).status, 403);
  assert.equal((await post('manage/badges/u1/review', review, 'owner=yes; community_browse=reader')).status, 403);
  assert.equal((await post('manage/badges/u1/review', review, 'owner=yes')).status, 200);
  assert.equal((await json(get('members/u1'))).badgeState.families.find(item => item.id === 'writing').tier, null);
  assert.equal((await post('manage/badges/u1/review', { ...review, action: 'restore', sources: [] }, 'owner=yes')).status, 409, 'invalid progress cannot restore a revoked honor');
  assert.equal((await post('manage/badges/u1/review', { ...review, action: 'restore', reason: '申诉核实原复核有误' }, 'owner=yes')).status, 200);
  const owner = await json(get('manage/badges/u1', 'owner=yes'));
  assert.equal(owner.badgeState.families.find(item => item.id === 'writing').tier, 'gold');
  assert.equal(owner.reviews.length, 2);
  assert.ok(audits.some(item => item.action === 'community-badge-revoked'));
  assert.ok(audits.some(item => item.action === 'community-badge-restored'));
  const sanction = store.members.mute(author, 7, '其他', { kind: 'owner', id: 'owner' });
  assert.equal((await post(`manage/badge-violations/sanction/${sanction.id}/reverse`, { reason: '申诉复核认定处罚错误' }, 'reader=s1')).status, 403);
  assert.equal((await post(`manage/badge-violations/sanction/${sanction.id}/reverse`, { reason: '申诉复核认定处罚错误' }, 'owner=yes')).status, 200);
  assert.ok(audits.some(item => item.action === 'community-badge-violation-reversed'));
});

test('level catalogue receives independent experience and real current membership with new empty VIP day history', async t => {
  const { get, post } = await setup(t);
  const vip = await json(get('stardust', 'reader=v1'));
  assert.equal(vip.vip, true);
  assert.equal((await json(get('stardust', 'reader=r1'))).vip, false);
  assert.equal((await json(get('stardust', 'owner=yes'))).vip, false, 'owner access is not membership growth');
  await post('members/u4/steward', { on: true, role:'general',boards: ['qa'],permissions:communityLegacyStaffPermissions,delegable:[] }, 'owner=yes');
  const preview = await json(get('stardust', 'reader=v1; community_browse=reader'));
  assert.equal(preview.browsingAsReader, true);
  assert.equal(preview.vip, true, 'a read-only perspective does not expire actual membership');
  for (const entry of [vip, preview]) {
    assert.equal(Object.hasOwn(entry, 'vipLevel'), false);
    assert.equal(Object.hasOwn(entry, 'vipProgress'), false);
    assert.equal(entry.growth.configured, true);
    assert.equal(entry.growth.points, 0, 'GET never grants experience');
    assert.equal(entry.vipGrowth.days, 0, 'old membership duration is never converted');
    assert.equal(entry.vipGrowth.level, 1);
    assert.equal(entry.vipGrowth.multiplier, 2);
    assert.equal(entry.experienceCatalogue.length, 10);
    assert.equal(entry.vipCatalogue.length, 8);
    assert.ok(entry.vipCatalogue.every(item => Object.keys(item).sort().join(',') === 'level,multiplier'));
  }
});

test('only protected active visit POST settles login experience; reads, previews and injected values cannot grant', async t => {
  const { get, post, store } = await setup(t);
  const a = { kind: 'reader', id: 'r1' };
  for (const path of ['me', 'stardust', 'checkin', 'rank', 'me', 'stardust']) assert.equal((await get(path)).status, 200);
  assert.equal(store.experience.state(a).points, 0);
  assert.equal((await get('active/visit')).status, 404);
  assert.equal((await post('active/visit', {}, '')).status, 401);
  assert.equal((await post('active/visit', {}, 'reader=r1', { Origin: 'http://wrong-origin.test' })).status, 403);
  assert.equal((await post('active/visit', { points: 200, vip: true, multiplier: 20 })).status, 400);
  assert.equal((await post('active/visit', { day: '2020-01-01' })).status, 400);
  const results = await Promise.all(Array.from({ length: 5 }, () => json(post('active/visit', {}))));
  assert.ok(results.every(item => item.uid === 'u1'), 'the protected response is bound to the public account UID');
  assert.equal(results.reduce((sum, item) => sum + item.awarded, 0), 10);
  assert.equal(results.filter(item => item.visited).length, 1);
  const me = await json(get('me'));
  const progress = await json(get('stardust'));
  assert.deepEqual(me.growth, progress.growth);
  assert.deepEqual(me.vipGrowth, progress.vipGrowth);
  assert.equal(progress.growth.points, 10);
  assert.equal(progress.growth.remaining, 1190);
  assert.equal(progress.growth.level, 1);
  assert.equal(progress.vipGrowth.level, null);
  assert.equal(progress.vipGrowth.days, 0);
  assert.equal((await json(post('active/visit', {}, 'reader=v1'))).awarded, 20);
  assert.equal((await json(get('stardust', 'reader=v1'))).vipGrowth.days, 1);
  const owner = await json(post('active/visit', {}, 'owner=yes'));
  assert.deepEqual(owner, { uid: 'owner', awarded: 0, visited: false, growth: null, vipGrowth: null });
  await post('members/u4/steward', { on: true, role:'general',boards: ['qa'],permissions:communityLegacyStaffPermissions,delegable:[] }, 'owner=yes');
  assert.equal((await post('active/visit', {}, 'reader=v1; community_browse=reader')).status, 403);
});

test('active visits require the current convention and recheck revoked sessions before writing', async t => {
  const { post, store } = await setup(t);
  const a = { kind: 'reader', id: 'r1' };
  store.convention.replace({ kind: 'owner', id: 'owner' }, store.convention.current().version, '本次新公约需要重新阅读后同意。');
  assert.equal((await post('active/visit', {})).status, 428);
  assert.equal(store.experience.state(a).points, 0);
  let calls = 0;
  const revoked = await setup(t, { identifyOverride: async () => ++calls === 1 ? { kind: 'reader', id: 'r1', name: '林间', vip: true } : null });
  assert.equal((await revoked.post('active/visit', {})).status, 401);
  assert.equal(revoked.store.experience.state(a).points, 0);
  assert.equal(revoked.store.experience.vipState(a, true).days, 0);
});

test('passive GET across Beijing days does not record visits, thread reads, experience, VIP days or stardust', async t => {
  const { get, store } = await setup(t);
  const reader = { kind: 'reader', id: 'v1' };
  const topic = store.createTopic({ ...topicBody, author: { kind: 'reader', id: 'r2' } });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  assert.equal((await get(`topics/${topic.id}`, 'reader=v1')).status, 200);
  const state = () => ({
    visits: store.members.stats(reader).visitDays, reads: store.topic(topic.id).views,
    experience: store.experience.state(reader).points, vipDays: store.experience.vipState(reader, true).days,
    balance: store.ledger.balance(reader),
  });
  const before = state();
  assert.deepEqual(before, { visits: 1, reads: 1, experience: 0, vipDays: 0, balance: 0 });
  now += 24 * 3600_000;
  for (const path of ['me', 'summary', 'stardust', 'inbox', `topics/${topic.id}`, `topics/${topic.id}`]) {
    assert.equal((await get(path, 'reader=v1', { 'X-Community-Passive': '1' })).status, 200, path);
  }
  assert.deepEqual(state(), before, 'background reads must not create a new human visit or reading day');
  assert.equal((await get(`topics/${topic.id}`, 'reader=v1')).status, 200);
  assert.deepEqual(state(), { ...before, visits: 2, reads: 2 }, 'normal navigation remains a real visit and reading');
});

test('the passive header never exempts POST activity from settlement, identity, origin or consent checks', async t => {
  const { get, post, store } = await setup(t);
  const reader = { kind: 'reader', id: 'r1' }, passive = { 'X-Community-Passive': '1' };
  assert.equal((await get('me', 'reader=r1', passive)).status, 200);
  assert.equal(store.members.stats(reader).visitDays, 0);
  assert.equal((await post('active/visit', {}, '', passive)).status, 401);
  assert.equal((await post('active/visit', {}, 'reader=r1', { ...passive, Origin: 'http://wrong-origin.test' })).status, 403);
  const active = await post('active/visit', {}, 'reader=r1', passive);
  assert.equal(active.status, 200);
  assert.equal((await active.json()).awarded, 10, 'a marked POST remains an ordinary active visit');
  assert.equal(store.members.stats(reader).visitDays, 1);
  assert.equal(store.experience.state(reader).points, 10);
  assert.equal((await json(post('active/visit', {}, 'reader=r1', passive))).awarded, 0, 'the existing daily reward remains idempotent');
  store.convention.replace({ kind: 'owner', id: 'owner' }, store.convention.current().version, '变更公约后仍须重新阅读并同意。');
  assert.equal((await post('active/visit', {}, 'reader=r1', passive)).status, 428);
  assert.equal(store.experience.state(reader).points, 10);
});

test('passive GET retains current VIP, moderation, private image and authentication boundaries', async t => {
  let identifiedVip = true, signedIn = true;
  const { get, post, upload, store } = await setup(t, { identifyOverride: async req => {
    const id = String(req.headers.cookie || '') === 'reader=v1' ? 'v1' : 'r2';
    return signedIn ? { kind: 'reader', id, name: members[id].name, vip: id === 'v1' && identifiedVip } : null;
  } });
  const passive = { 'X-Community-Passive': '1' };
  const image = await json(upload(await png(), 'image/png', 'reader=v1'));
  assert.equal((await get(`images/${image.id}.webp`, 'reader=r2', passive)).status, 404, 'unattached uploads remain private');
  const published = await post('topics', { ...topicBody, board: 'vip', images: [image.id] }, 'reader=v1');
  assert.equal(published.status, 201);
  const topic = await published.json();
  assert.equal((await get(`topics/${topic.id}`, 'reader=v1', passive)).status, 200);
  assert.equal((await get(`images/${image.id}.webp`, 'reader=v1', passive)).status, 200);
  identifiedVip = false;
  assert.equal((await get(`topics/${topic.id}`, 'reader=v1', passive)).status, 404);
  assert.equal((await get(`images/${image.id}.webp`, 'reader=v1', passive)).status, 404);
  const viewer = { kind: 'reader', id: 'r2' };
  store.members.setSteward(viewer, true, ['vip']);
  assert.equal((await get(`topics/${topic.id}`, 'reader=r2', passive)).status, 200);
  store.members.setSteward(viewer, false);
  assert.equal((await get(`topics/${topic.id}`, 'reader=r2', passive)).status, 404);
  assert.equal((await get(`images/${image.id}.webp`, 'reader=r2', passive)).status, 404);
  signedIn = false;
  assert.equal((await get('me', 'reader=v1', passive)).status, 401);
  assert.equal((await get(`images/${image.id}.webp`, 'reader=v1', passive)).status, 401);
  assert.equal((await get('avatar/u1.webp', 'reader=v1', passive)).status, 401);
});

test('ordinary community media GET does not create human visits while POST uploads remain active', async t => {
  const { get, upload, store } = await setup(t);
  const reader = { kind: 'reader', id: 'r1' }, other = { kind: 'reader', id: 'r2' };
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  assert.equal((await get('avatar/u1.webp')).status, 200);
  assert.equal(store.members.stats(reader).visitDays, 0, 'an avatar download is not an active community visit');
  const uploaded = await upload(await png(), 'image/png', 'reader=r1', { 'X-Community-Passive': '1' });
  assert.equal(uploaded.status, 201);
  const image = await uploaded.json();
  assert.equal(store.members.stats(reader).visitDays, 1, 'the actual upload POST remains active');
  now += 24 * 3600_000;
  for (const path of [`images/${image.id}.webp`, `images/${image.id}.thumb.webp`, 'avatar/u1.webp?v=current']) {
    assert.equal((await get(path)).status, 200, path);
  }
  assert.equal(store.members.stats(reader).visitDays, 1, 'background media loading cannot create a new visit day');
  assert.equal((await get(`images/${image.id}.webp`, 'reader=r2')).status, 404, 'media reads still check private upload ownership');
  assert.equal(store.members.stats(other).visitDays, 0);
  assert.equal((await get('avatar/u1.webp', '')).status, 401);
});

test('pending avatar media keeps personal and moderator checks without recording a visit', async t => {
  const reviewId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let personalReads = 0, reviewReads = 0;
  const { get, store } = await setup(t, { profile: {
    pendingAvatar: async req => {
      personalReads++;
      if (req.headers.cookie !== 'reader=r1') throw Object.assign(Error('no personal pending image'), { status: 404 });
      return Buffer.from('personal-pending-avatar');
    },
    reviewImage: async (_req, id, moderation, check) => {
      reviewReads++; await check({action:'inspect',kind:'avatar'}); assert.equal(id, reviewId); assert.equal(moderation.role, 'moderator');
      return Buffer.from('moderator-pending-avatar');
    },
  } });
  const reader = { kind: 'reader', id: 'r1' }, moderator = { kind: 'reader', id: 'r2' };
  const mine = await get('profile/avatar/pending.webp', 'reader=r1', { 'If-None-Match': '*' });
  assert.equal(mine.status, 200); assert.equal(await mine.text(), 'personal-pending-avatar');
  assert.equal(mine.headers.get('cache-control'), 'private, no-store'); assert.equal(mine.headers.get('etag'), null);
  assert.equal((await get('profile/avatar/pending.webp', 'reader=r2')).status, 404);
  assert.equal(personalReads, 2);
  assert.equal(store.members.stats(reader).visitDays, 0);
  assert.equal(store.members.stats(moderator).visitDays, 0);
  const path = `manage/profiles/${reviewId}/avatar.webp`;
  assert.equal((await get(path, 'reader=r2')).status, 403);
  assert.equal(reviewReads, 0, 'a media path alone never grants reviewer access');
  store.members.setSteward(moderator, true, ['qa']);
  const review = await get(path, 'reader=r2', { 'If-None-Match': '*' });
  assert.equal(review.status, 200); assert.equal(await review.text(), 'moderator-pending-avatar');
  assert.equal(review.headers.get('cache-control'), 'private, no-store'); assert.equal(review.headers.get('etag'), null);
  store.members.setSteward(moderator, false);
  assert.equal((await get(path, 'reader=r2')).status, 403);
  assert.equal(reviewReads, 1, 'revoked moderation is checked before calling the profile bridge');
  assert.equal(store.members.stats(moderator).visitDays, 0);
});

test('bulk review checks the whole selection before changes and reuses approval and rejection accounting', async t => {
  const { post, store, audits } = await setup(t);
  const author = { kind: 'reader', id: 'r1' };
  const pending = () => store.createTopic({ ...topicBody, author, pending: '需要审核' }).id;
  const ids = [pending(), pending()];
  assert.equal((await post('manage/review', { action: 'approve', ids })).status, 403);
  assert.equal((await post('manage/review', { action: 'approve', ids: [ids[0], 'missing'] }, 'owner=yes')).status, 409);
  assert.equal(store.topic(ids[0]).pending, true, 'a stale selection must not partially approve');
  assert.equal((await post('manage/review', { action: 'approve', ids: [ids[0], ids[0]] }, 'owner=yes')).status, 400);
  store.members.setSteward({ kind: 'reader', id: 's1' }, true);
  const approved = await post('manage/review', { action: 'approve', ids }, 'reader=s1');
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).count, 2);
  assert.equal(store.topic(ids[0]).pending, false);
  const balance = store.ledger.balance(author);
  assert.equal((await post('manage/review', { action: 'approve', ids }, 'reader=s1')).status, 409);
  assert.equal(store.ledger.balance(author), balance, 'retry cannot issue review rewards twice');
  const rejected = [pending(), pending()];
  assert.equal((await post('manage/review', { action: 'reject', ids: rejected }, 'owner=yes')).status, 400);
  assert.equal((await post('manage/review', { action: 'reject', ids: rejected, reason: '重复内容', note: '内容已发布过' }, 'owner=yes')).status, 200);
  assert.equal(store.topic(rejected[0]), null);
  assert.equal(store.ledger.balance(author), balance, 'rejecting unpublished content never penalises');
  assert.ok(audits.some(audit => audit.action === 'community-bulk-reject-topics' && audit.reason === '重复内容'));
});

test('community images allow 2 MB for readers and VIP, and reuse the author image ceiling', async t => {
  const { upload } = await setup(t);
  const source = await png();
  const padded = size => Buffer.concat([source, Buffer.alloc(size - source.length)]);
  for (const cookie of ['reader=r1', 'reader=v1']) {
    assert.equal((await upload(padded(2 * 1024 ** 2), 'image/png', cookie)).status, 201);
    assert.equal((await upload(padded(2 * 1024 ** 2 + 1), 'image/png', cookie)).status, 413);
  }
  assert.equal((await upload(padded(6 * 1024 ** 2), 'image/png', 'owner=yes')).status, 201);
  assert.equal((await upload(padded(25 * 1024 ** 2 + 1), 'image/png', 'owner=yes')).status, 413);
  assert.equal((await upload(Buffer.from('video'), 'video/mp4', 'owner=yes')).status, 415);
});

test('moderation deletion requires a reason, stores it and tells the author', async t => {
  const { post, get, store, audits, directory } = await setup(t);
  const topic = await (await post('topics', { board: 'qa', title: '删除理由回归测试', body: '足够长的正文内容用于删除测试' })).json();
  await post('members/u5/steward', { on: true,role:'general', boards: allModerationBoards,permissions:communityLegacyStaffPermissions,delegable:[] }, 'owner=yes');
  assert.equal((await post(`topics/${topic.id}/delete`, {}, 'reader=s1')).status, 400);
  assert.ok(store.topic(topic.id));
  assert.equal((await post(`topics/${topic.id}/delete`, { reason: '重复发布同一内容', violation: false }, 'reader=s1')).status, 200);
  assert.equal(store.topic(topic.id), null);
  assert.match(JSON.stringify((await (await get('inbox?tab=system')).json()).items), /重复发布同一内容/);
  assert.equal(audits.at(-1).reason, '重复发布同一内容');
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  try { assert.equal(db.prepare('SELECT deleted_reason FROM community_topics WHERE id = ?').get(topic.id).deleted_reason, '重复发布同一内容'); }
  finally { db.close(); }
});

test('owner switches to a distinct interactive reader while steward perspective stays read-only', async t => {
  const { post, get, upload } = await setup(t);
  await post('members/u5/steward', { on: true,role:'general', boards: allModerationBoards,permissions:communityLegacyStaffPermissions,delegable:[] }, 'owner=yes');
  for (const identity of ['owner=yes', 'reader=s1']) {
    const before = await (await get('me', identity)).json();
    const switchResponse = await post('browse-mode', { reader: true }, identity);
    assert.equal(switchResponse.status, 200);
    assert.match(switchResponse.headers.get('set-cookie'), /community_browse=reader/);
    const cookie = `${identity}; community_browse=reader`;
    const during = await (await get('me', cookie)).json();
    assert.equal(during.name, before.name);
    assert.equal(during.owner, false);
    assert.equal(during.mod, false);
    assert.equal(during.management.browsingAsReader, true);
    assert.equal((await get('manage', cookie)).status, 403);
    assert.equal((await post('shop/redeem', { item: 'card-makeup' }, cookie)).status, identity === 'owner=yes' ? 402 : 403, 'a personal reader has no gifted balance or manager exemption');
    assert.equal(during.uid, identity === 'owner=yes' ? 'u6' : before.uid);
    assert.equal((await post('browse-mode', { reader: false }, cookie)).status, 200);
    assert.equal((await get('manage', identity)).status, 200);
  }
  assert.equal((await post('browse-mode', { reader: true })).status, 403);
  assert.equal((await get('manage', 'reader=r1; community_browse=reader')).status, 403);
  const cover = await json(upload(await png(), 'image/png', 'owner=yes'));
  const created = await post('topics', { board: 'showcase', title: '作者视角提示词测试', body: '这是足够长的作品说明正文内容。', images: [cover.id], tools: 'ComfyUI', prompt: 'private prompt', promptMode: 'paid', promptPrice: 20 }, 'owner=yes');
  assert.equal(created.status, 201, await created.clone().text());
  const work = await created.json();
  const preview = await (await get(`topics/${work.id}`, 'owner=yes; community_browse=reader')).json();
  assert.equal(preview.topic.meta.prompt, null, 'reader perspective masks the owner-only prompt');
  assert.equal(preview.topic.mine, false);
  assert.equal(preview.topic.canReply, true);
});

test('check-in reads distinguish manager preview from a reader and preserve real author eligibility', async t => {
  const { post, get, store } = await setup(t);
  await post('members/u5/steward', { on: true,role:'general', boards: allModerationBoards,permissions:communityLegacyStaffPermissions,delegable:[] }, 'owner=yes');
  for (const [identity, owner] of [['owner=yes', true], ['reader=s1', false]]) {
    const normal = await json(get('checkin?month=2026-09', identity));
    assert.equal(normal.owner, owner);
    assert.equal(normal.browsingAsReader, false);
    const cookie = `${identity}; community_browse=reader`;
    const preview = await json(get('checkin?month=2026-08', cookie));
    assert.equal(preview.owner, false, 'the preview uses the ordinary reader layout while writes remain blocked');
    assert.equal(preview.browsingAsReader, true);
    assert.equal(preview.month, '2026-08', 'month browsing remains read-only');
    const stardust = await json(get('stardust', cookie));
    assert.equal(stardust.owner, false, 'the preview shows reader progression without adding earned account state');
    assert.equal(stardust.browsingAsReader, true, 'stardust identifies a read-only moderator perspective');
    assert.deepEqual([(await json(get('stardust', identity))).owner, (await json(get('stardust', identity))).browsingAsReader], [owner, false]);
    assert.equal(preview.readOnly, !owner);
    assert.equal((await post('checkin', {}, cookie)).status, owner ? 200 : 403);
    if (!owner) assert.equal((await post('checkin/makeup', { day: '2026-09-29' }, cookie)).status, 403);
  }
  assert.equal((await post('checkin', {}, 'owner=yes')).status, 403);
  assert.equal(store.ledger.balance({ kind: 'owner', id: 'owner' }), 0);
  const normal = await json(get('checkin', 'reader=r2; community_browse=reader'));
  assert.deepEqual([normal.owner, normal.browsingAsReader], [false, false], 'a forged preview cookie gives a reader no management status');
  const readerStardust = await json(get('stardust', 'reader=r2; community_browse=reader'));
  assert.deepEqual([readerStardust.owner, readerStardust.browsingAsReader], [false, false]);
  assert.equal((await post('checkin', {}, 'reader=r2')).status, 200);
  assert.equal((await post('checkin', {}, 'reader=r2')).status, 409);
  assert.equal(store.ledger.balance({ kind: 'reader', id: 'r2' }), 1);
  assert.equal(store.ledger.history({ kind: 'reader', id: 'r2' }).filter(entry => entry.reason === 'checkin').length, 1);
  assert.equal((await post('checkin', {}, 'reader=s1')).status, 200, 'a real moderator may check in outside preview');
});

test('redemption request keys replay the original result without duplicate debit, inventory or notification', async t => {
  const { post, store, credit } = await setup(t);
  const headers = { 'X-Idempotency-Key': 'redeem-intent-000001' };
  credit('r1', 500); credit('r2', 500);
  const input = { item: 'card-highlight' };
  const first = await post('shop/redeem', input, 'reader=r1', headers);
  assert.equal(first.status, 201);
  const result = await first.json();
  const balance = store.ledger.balance({ kind: 'reader', id: 'r1' });
  const repeated = await post('shop/redeem', input, 'reader=r1', headers);
  assert.equal(repeated.status, 201);
  assert.deepEqual(await repeated.json(), result);
  assert.equal(store.ledger.balance({ kind: 'reader', id: 'r1' }), balance);
  assert.equal(store.economy.inventory({ kind: 'reader', id: 'r1' }).highlight, 1);
  assert.equal(store.economy.orders({ kind: 'reader', id: 'r1' }).length, 1);
  assert.equal((await post('shop/redeem', { item: 'card-pin' }, 'reader=r1', headers)).status, 409, 'a key cannot be reused with changed payload');
  assert.equal((await post('shop/redeem', input, 'reader=r1', { 'X-Idempotency-Key': 'redeem-intent-000002' })).status, 201);
  assert.equal(store.economy.inventory({ kind: 'reader', id: 'r1' }).highlight, 2, 'a new intent remains a legal repeat purchase');
  assert.equal((await post('shop/redeem', input, 'reader=r2', headers)).status, 201, 'request keys are isolated by real actor');
  for (const key of ['short', 'contains invalid spaces 1234', 'x'.repeat(129)])
    assert.equal((await post('shop/redeem', input, 'reader=r1', { 'X-Idempotency-Key': key })).status, 400);
  const item = store.economy.saveItem(null, { cat: 'goods', name: '去重实物', description: '', price: 10, stock: 2, limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '', note: '', active: true });
  const goods = { item, shipping: { name: '虚构测试', phone: '13800138000', address: '本地虚构测试地址' } };
  const goodsHeaders = { 'X-Idempotency-Key': 'goods-intent-000001' };
  const order = await json(post('shop/redeem', goods, 'reader=r1', goodsHeaders));
  assert.deepEqual(await json(post('shop/redeem', goods, 'reader=r1', goodsHeaders)), order);
  assert.equal(store.economy.item(item).left, 1);
  assert.equal(store.members.inbox({ kind: 'owner', id: 'owner' }).filter(notice => notice.data?.order === 'new').length, 1);
});

test('topic and reply request keys replay once, including their rewards and mentions', async t => {
  const { post, store } = await setup(t);
  const headers = { 'X-Idempotency-Key': 'topic-intent-000001' };
  const input = { ...topicBody, body: '这是测试发布请求去重的正文并且提及 @远山' };
  const created = await post('topics', input, 'reader=r1', headers);
  assert.equal(created.status, 201);
  const topic = await created.json();
  const reordered = { body: input.body, title: input.title, board: input.board };
  assert.deepEqual(await json(post('topics', reordered, 'reader=r1', headers)), topic, 'object field order does not change the fingerprint');
  assert.equal(store.postedToday({ kind: 'reader', id: 'r1' }).topics, 1);
  assert.equal(store.ledger.balance({ kind: 'reader', id: 'r1' }), 2);
  assert.equal(store.members.inbox({ kind: 'reader', id: 'r2' }).filter(notice => notice.type === 'mention').length, 1);
  assert.equal((await post('topics', { ...input, title: '修改内容的同一请求' }, 'reader=r1', headers)).status, 409);
  assert.equal((await post('topics', input, 'reader=r1', { 'X-Idempotency-Key': 'topic-intent-000002' })).status, 201);
  const replyHeaders = { 'X-Idempotency-Key': 'reply-intent-000001' }, path = `topics/${topic.id}/replies`;
  const replyInput = { body: '这是用于回复请求去重的有效内容并且提及 @林间' };
  const reply = await json(post(path, replyInput, 'reader=r2', replyHeaders));
  assert.deepEqual(await json(post(path, replyInput, 'reader=r2', replyHeaders)), reply);
  assert.equal(store.postedToday({ kind: 'reader', id: 'r2' }).replies, 1);
  assert.equal(store.ledger.balance({ kind: 'reader', id: 'r2' }), 1);
  assert.equal(store.members.inbox({ kind: 'reader', id: 'r1' }).filter(notice => notice.type === 'reply' || notice.type === 'mention').length, 1);
  assert.equal((await post(path, { body: '同一个请求修改了回复内容' }, 'reader=r2', replyHeaders)).status, 409);
  assert.equal((await post(path, replyInput, 'reader=r2', { 'X-Idempotency-Key': 'reply-intent-000002' })).status, 201);
});

test('thank request keys replay once and never grant permissions after a role or board change', async t => {
  const { post, store, credit } = await setup(t);
  const topic = await json(post('topics', topicBody));
  const reply = await json(post(`topics/${topic.id}/replies`, { body: '这是有效回复，用于感谢的去重测试' }));
  credit('r2', 100);
  for (const path of [`topics/${topic.id}/thank`, `replies/${reply.id}/thank`]) {
    const headers = { 'X-Idempotency-Key': 'thank-intent-000001' };
    const first = await post(path, {}, 'reader=r2', headers);
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.deepEqual(await json(post(path, {}, 'reader=r2', headers)), result);
    assert.equal((await post(path, { on: true }, 'reader=r2', headers)).status, 409);
  }
  assert.equal(store.ledger.balance({ kind: 'reader', id: 'r2' }), 80);
  assert.equal(store.members.inbox({ kind: 'reader', id: 'r1' }).filter(notice => notice.type === 'thank').length, 2);
  store.move(topic.id, 'vip');
  assert.equal((await post(`topics/${topic.id}/thank`, {}, 'reader=r2', { 'X-Idempotency-Key': 'thank-intent-000001' })).status, 404, 'cached results never bypass current board visibility');
  credit('owner', 100);
  const ownerHeaders = { 'X-Idempotency-Key': 'owner-redeem-000001' };
  assert.equal((await post('shop/redeem', { item: 'card-highlight' }, 'owner=yes', ownerHeaders)).status, 201);
  assert.equal((await post('shop/redeem', { item: 'card-highlight' }, 'owner=yes; community_browse=reader', ownerHeaders)).status, 402, 'a different real execution identity cannot replay the owner inventory grant or bypass its own balance');
});

test('economic actions share durable action throttling while completed request replay consumes no quota', async t => {
  const { post, store, credit } = await setup(t);
  const actor = { kind: 'reader', id: 'r2' }, headers = { 'X-Idempotency-Key': 'quota-redeem-000001' };
  credit('r2', 300);
  const first = await json(post('shop/redeem', { item: 'card-highlight' }, 'reader=r2', headers));
  const now = Date.now();
  for (let i = 0; i < 119; i++) store.rateLimits.consume(actor, 'action', 1, now);
  assert.deepEqual(await json(post('shop/redeem', { item: 'card-highlight' }, 'reader=r2', headers)), first, 'completed replay is not another action');
  assert.equal((await post('shop/redeem', { item: 'card-highlight' }, 'reader=r2', { 'X-Idempotency-Key': 'quota-redeem-000002' })).status, 429);
  assert.equal((await post('checkin', {}, 'reader=r2')).status, 429);
  const topic = store.createTopic({ ...topicBody, author: { kind: 'reader', id: 'r1' } });
  assert.equal((await post(`topics/${topic.id}/thank`, {}, 'reader=r2', { 'X-Idempotency-Key': 'quota-thank-000001' })).status, 429);
  const paid = store.createTopic({ board: 'showcase', title: '限速付费提示词', body: '', author: { kind: 'reader', id: 'r1' }, meta: { tools: 'test', model: '', usage: '', prompt: 'private prompt', promptMode: 'paid', price: 10 } });
  assert.equal((await post(`topics/${paid.id}/unlock`, {}, 'reader=r2')).status, 429);
  assert.equal(store.economy.inventory(actor).highlight, 1);
  assert.equal(store.economy.checked(actor), false);
});

test('private image and approved avatar responses require current permission rather than reuse a previous identity cache', async t => {
  const { post, get, upload } = await setup(t);
  const image = await json(upload(await png()));
  assert.equal((await get(`images/${image.id}.webp`)).headers.get('cache-control'), 'private, no-store');
  const topic = await json(post('topics', { ...topicBody, images: [image.id] }));
  assert.ok(topic.id);
  for (const suffix of ['.webp', '.thumb.webp']) {
    const response = await get(`images/${image.id}${suffix}`, 'reader=r2');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-cache');
  }
  assert.equal((await get('avatar/u1.webp', 'reader=r2')).headers.get('cache-control'), 'private, no-cache');
  const vipImage = await json(upload(await png(), 'image/png', 'reader=v1'));
  await post('topics', { ...topicBody, board: 'vip', images: [vipImage.id] }, 'reader=v1');
  assert.equal((await get(`images/${vipImage.id}.webp`, 'reader=v1')).headers.get('cache-control'), 'private, no-cache');
  assert.equal((await get(`images/${vipImage.id}.webp`, 'reader=r2')).status, 404);
  assert.equal((await get(`images/${vipImage.id}.webp`, '')).status, 401);
});

test('growth DTOs settle real experience independently of currency, earned trust and appointed moderation', async t => {
  const { get, post, store, credit } = await setup(t);
  const actor = { kind: 'reader', id: 'r1' };
  credit('r1', 100);
  await post('checkin', {}, 'reader=r1');
  assert.deepEqual((await json(get('me'))).growth, emptyGrowth, 'currency and attendance never substitute for active login');
  await post('active/visit', {});
  const topic = await json(post('topics', topicBody));
  const me = await json(get('me'));
  assert.deepEqual(me.growth, { ...emptyGrowth, points: 30, remaining: 1170, progress: 30 / 1200 });
  assert.equal(me.trustLevel, 1);
  const board = await json(get('stardust'));
  assert.deepEqual(board.growth, me.growth);
  assert.equal(board.level, 1, 'the existing trust field retains its permission meaning');
  const person = (await json(get(`topics/${topic.id}`))).topic.author;
  assert.deepEqual(person.growth, me.growth);
  store.members.setSteward(actor, true, ['qa']);
  const moderator = await json(get('me'));
  assert.deepEqual(moderator.growth, me.growth);
  assert.equal(moderator.trustLevel, 1);
  assert.equal(moderator.mod, true);
  assert.deepEqual((await json(get('me', 'owner=yes'))).growth, null, 'the real author does not display reader growth');
  assert.equal((await json(get('stardust', 'owner=yes; community_browse=reader'))).growth.level, 10, 'the real owner personal identity retains its approved highest growth presentation');
  store.deleteTopic(topic.id);
  assert.deepEqual((await json(get('me'))).growth, { ...emptyGrowth, points: 10, remaining: 1190, progress: 10 / 1200 }, 'content reversal retains valid login experience');
});

test('shop images are owner uploads, visible for active items and protected from orphan cleanup', async t => {
  const { post, get, siteOrigin: origin, store, directory, credit } = await setup(t);
  const sharp = (await import('sharp')).default;
  const source = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#b69b6b' } }).png().toBuffer();
  const upload = async cookie => {
    const form = new FormData(); form.append('file', new Blob([source], { type: 'image/png' }), 'product.png');
    return fetch(`${origin}/api/community/manage/item-image`, { method: 'POST', headers: { cookie, origin, 'x-reader-request': '1' }, body: form });
  };
  assert.equal((await upload('reader=r1')).status, 403);
  const image = await (await upload('owner=yes')).json();
  assert.ok(image.id);
  const item = await (await post('manage/items', { cat: 'goods', name: '商品图片测试', description: '用于检验商品图片的说明', price: 10, stock: 1, image: image.id }, 'owner=yes')).json();
  assert.equal((await get(`images/${image.id}.webp`)).status, 200);
  assert.equal((await (await get('shop')).json()).items.find(row => row.id === item.id).image, image.id);
  assert.ok(!store.sweepImages(Date.now() + 2 * 86400e3).includes(image.id));
  assert.equal((await post('manage/items', { cat: 'goods', name: '无效图片测试', description: '说明正文足够', price: 10, stock: 1, image: 'https://evil.example/a.gif' }, 'owner=yes')).status, 400);
  assert.equal((await post('topics', { board: 'qa', title: '商品图不能作帖子图', body: '这是足够长的帖子正文内容', images: [image.id] }, 'owner=yes')).status, 400);
  assert.ok(directory);
  credit('r2', 10);
  assert.equal((await post('shop/redeem', { item: item.id, shipping: { name: '测试收件人', phone: '13800138000', address: '测试地址一号街道' } }, 'reader=r2')).status, 201);
  await post(`manage/items/${item.id}`, { cat: 'goods', name: '商品图片测试', description: '用于检验商品图片的说明', price: 10, stock: 1, active: false }, 'owner=yes');
  assert.equal((await get(`images/${image.id}.webp`)).status, 404);
  assert.equal((await get(`images/${image.id}.webp`, 'reader=r2')).status, 200, 'members who redeemed an item can still see its artwork after it leaves the shop');
  assert.equal((await get(`images/${image.id}.webp`, 'owner=yes')).status, 200);
  const managed = await (await get('manage?tab=items', 'owner=yes')).json();
  assert.equal(managed.items.find(row => row.id === item.id).image, image.id, 'older clients updating text preserve product artwork');
  assert.ok(!store.sweepImages(Date.now() + 2 * 86400e3).includes(image.id), 'off-sale product artwork remains persistent');
});

test('product GIF and animated WebP keep frames and timing, with a static thumbnail', async t => {
  const { siteOrigin: origin, get, store } = await setup(t);
  const sharp = (await import('sharp')).default;
  const pixels = await sharp({ create: { width: 32, height: 64, channels: 4, background: '#b69b6b' } }).raw().toBuffer();
  pixels.fill(255, 32 * 32 * 4);
  for (const [format, type] of [['gif', 'image/gif'], ['webp', 'image/webp']]) {
    const source = await sharp(pixels, { raw: { width: 32, height: 64, channels: 4, pageHeight: 32 } })[format]({ delay: [100, 200], loop: 0 }).toBuffer();
    const form = new FormData(); form.append('file', new Blob([source], { type }), `product.${format}`);
    const response = await fetch(`${origin}/api/community/manage/item-image`, { method: 'POST', headers: { cookie: 'owner=yes', origin, 'x-reader-request': '1' }, body: form });
    assert.equal(response.status, 201);
    const image = await response.json();
    const full = await (await get(`images/${image.id}.webp`, 'owner=yes')).arrayBuffer();
    const meta = await sharp(Buffer.from(full), { animated: true }).metadata();
    assert.equal(meta.pages, 2); assert.deepEqual(meta.delay, [100, 200]);
    assert.deepEqual([store.image(image.id).width, store.image(image.id).height], [32, 32]);
    const thumb = await (await get(`images/${image.id}.thumb.webp`, 'owner=yes')).arrayBuffer();
    assert.equal((await sharp(Buffer.from(thumb)).metadata()).pages ?? 1, 1);
  }
});

test('reply images persist independently of the topic cover and respect ownership, edits and visibility', async t => {
  const { post, get, upload } = await setup(t, { simplePosting: true });
  const cover = await json(upload(await png()));
  const topic = await json(post('topics', { board: 'qa', title: '回复图片', body: '说明\n\n' + imageMarker(cover.id), images: [cover.id] }));
  const picture = await json(upload(await png(), 'image/png', 'reader=r2'));
  const body = '截图说明\n\n' + imageMarker(picture.id);
  assert.equal((await post(`topics/${topic.id}/replies`, { body }, 'reader=r1')).status, 400);
  assert.equal((await post(`topics/${topic.id}/replies`, { body: imageMarker(picture.id) }, 'reader=r2')).status, 400);
  const sent = await post(`topics/${topic.id}/replies`, { body }, 'reader=r2');
  assert.equal(sent.status, 201, await sent.clone().text());
  const reply = await sent.json();
  const thread = await json(get(`topics/${topic.id}`));
  assert.deepEqual(thread.topic.images.map(image => image.id), [cover.id]);
  assert.deepEqual(thread.replies[0].images.map(image => image.id), [picture.id]);
  assert.equal(thread.replies[0].body, body);
  assert.equal((await get(`images/${picture.id}.webp`)).status, 200);
  assert.equal((await post(`topics/${topic.id}/replies`, { body }, 'reader=r2')).status, 400);
  assert.equal((await post(`topics/${topic.id}/edit`, { title: '封面保持', body: '说明\n\n' + imageMarker(cover.id), images: [cover.id] })).status, 200);
  assert.equal((await get(`images/${picture.id}.webp`)).status, 200);
  assert.equal((await post(`replies/${reply.id}/edit`, { body: '编辑说明\n\n' + imageMarker(picture.id) }, 'reader=r2')).status, 200);
  assert.equal((await post(`replies/${reply.id}/edit`, { body: '移除图片' }, 'reader=r2')).status, 200);
  assert.equal((await get(`images/${picture.id}.webp`)).status, 404);
  const second = await json(upload(await png(), 'image/png', 'reader=r2'));
  const again = await json(post(`topics/${topic.id}/replies`, { body: '另一张图\n\n' + imageMarker(second.id) }, 'reader=r2'));
  assert.equal((await post(`replies/${again.id}/delete`, {}, 'reader=r2')).status, 200);
  assert.equal((await get(`images/${second.id}.webp`)).status, 404);
});

for (const board of ['qa', 'showcase', 'tools', 'moments', 'meta', 'vip']) {
  test(`simple local posting: ${board} requires title, body and a cover, but no metadata, and can be edited`, async t => {
    const { post, get, upload } = await setup(t, { useDefault: true });
    const cover = await json(upload(await png(), 'image/png', 'owner=yes'));
    const body = `文字\n\n${imageMarker(cover.id)}`;
    const emptyTitle = await post('topics', { board, title: '', body: '文字', agree: true }, 'owner=yes');
    assert.equal(emptyTitle.status, 400); assert.match((await emptyTitle.json()).error, /标题/);
    const missingCover = await post('topics', { board, title: '标题', body: '文字', agree: true }, 'owner=yes');
    assert.equal(missingCover.status, 400); assert.match((await missingCover.json()).error, /封面/);
    const created = await post('topics', { board, title: '标题', body, images: [cover.id], agree: true }, 'owner=yes');
    assert.equal(created.status, 201, await created.clone().text());
    const { id } = await created.json();
    const thread = await json(get(`topics/${id}`, 'owner=yes'));
    assert.equal(thread.topic.board, board);
    assert.equal(thread.topic.body, body);
    assert.equal(thread.topic.title, '标题');
    assert.equal(thread.topic.rawTitle, '标题');
    const list = await json(get(`topics?board=${board}`, 'owner=yes'));
    assert.equal(list.items.find(topic => topic.id === id).hasTitle, true);
    assert.equal(list.items.find(topic => topic.id === id).thumbs[0], cover.id);
    assert.equal(thread.topic.bounty, 0);
    assert.equal(thread.topic.resource, null);
    if (board === 'showcase') {
      assert.equal(thread.topic.meta.tools, '');
      assert.equal(thread.topic.meta.usage, '');
      assert.equal(thread.topic.meta.price, 0);
    }
    const edited = await post(`topics/${id}/edit`, { title: '修改标题', body: `修改\n\n${imageMarker(cover.id)}`, images: [cover.id] }, 'owner=yes');
    assert.equal(edited.status, 200, await edited.clone().text());
    assert.equal((await json(get(`topics/${id}`, 'owner=yes'))).topic.title, '修改标题');
  });
}

test('registered inline image IDs never trigger contact filtering, while visible text and captions still do', async t => {
  const { post, get, store } = await setup(t, { useDefault: true });
  const imageId = 'aaaaaaaa-aaaa-4aaa-8aaa-138001380001';
  store.addImage({ id: imageId, uploader: { kind: 'reader', id: 'r1' }, width: 100, height: 100 });
  const payload = { board: 'qa', title: '图片编号测试', body: '说明文字\n\n' + imageMarker(imageId), images: [imageId] };
  const created = await post('topics', payload);
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = await created.json();
  assert.equal((await json(get(`topics/${id}`))).topic.images[0].id, imageId);
  assert.equal((await post(`topics/${id}/edit`, { ...payload, body: '更新说明\n\n' + imageMarker(imageId) })).status, 200);
  for (const body of [payload.body + '\n13800138000', payload.body.replace('![图片]', '![13800138000]')]) {
    const rejected = await post(`topics/${id}/edit`, { ...payload, body });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /手机号/);
  }
});

test('long news-link identifiers pass topic creation, editing and replies without weakening phone filtering', async t => {
  const { post, get, store } = await setup(t, { useDefault: true });
  const imageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  store.addImage({ id: imageId, uploader: { kind: 'owner', id: 'owner' }, width: 100, height: 100 });
  const text = '公告公开转录：[消息来源](https://news.example.test/status/1891380013800012345)';
  const body = `${text}\n\n${imageMarker(imageId)}`;
  const payload = { board: 'qa', title: 'AI 产品更新公告', body, images: [imageId], agree: true };
  const created = await post('topics', payload, 'owner=yes');
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = await created.json();
  const edited = await post(`topics/${id}/edit`, { ...payload, body: `更新说明\n${body}` }, 'owner=yes');
  assert.equal(edited.status, 200, await edited.clone().text());
  const replied = await post(`topics/${id}/replies`, { body: text }, 'owner=yes');
  assert.equal(replied.status, 201, await replied.clone().text());
  const { id: replyId } = await replied.json();
  const replyEdited = await post(`replies/${replyId}/edit`, { body: `后续确认：${text}` }, 'owner=yes');
  assert.equal(replyEdited.status, 200, await replyEdited.clone().text());
  for (const [path, input] of [
    [`topics/${id}/edit`, { ...payload, body: `${body}\n请联系 138 0013 8000` }],
    [`replies/${replyId}/edit`, { body: `${text}\n请联系 138 0013 8000` }],
  ]) {
    const rejected = await post(path, input, 'owner=yes');
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /手机号/);
  }
  assert.equal((await json(get(`topics/${id}`, 'owner=yes'))).replies[0].body, `后续确认：${text}`);
});

test('simple posting requires body text even with a title or cover; tools accepts real inline images', async t => {
  const { post, upload, get } = await setup(t, { simplePosting: true });
  const uploaded = await json(upload(await png()));
  for (const board of ['qa', 'showcase', 'tools', 'moments', 'meta']) {
    const rejected = await post('topics', { board, title: '只有标题', body: ' \n ', images: [uploaded.id] });
    assert.equal(rejected.status, 400, board);
    assert.match((await rejected.json()).error, /正文|内容/);
  }
  const accepted = await post('topics', { board: 'tools', title: '截图', body: '实际使用截图\n\n' + imageMarker(uploaded.id), images: [uploaded.id] });
  assert.equal(accepted.status, 201, await accepted.clone().text());
  const { id } = await accepted.json();
  const thread = await json(get(`topics/${id}`));
  assert.equal(thread.topic.images[0].id, uploaded.id);
  const edited = await post(`topics/${id}/edit`, { title: '截图', body: '', images: [uploaded.id] });
  assert.equal(edited.status, 400);
  assert.equal((await upload(Buffer.from('video'), 'video/mp4')).status, 415);
  assert.equal((await upload(Buffer.from('video'), 'image/png')).status, 400);
});

test('simple posting validates optional links, forbids resource prices and bounties, and keeps board permissions', async t => {
  const { post, upload } = await setup(t, { simplePosting: true });
  const cover = await json(upload(await png()));
  const fields = { title: '标题', body: '正文\n\n' + imageMarker(cover.id), images: [cover.id] };
  const invalidLink = await post('topics', { ...fields, board: 'tools', url: 'broken' });
  assert.equal(invalidLink.status, 400); assert.match((await invalidLink.json()).error, /链接/);
  assert.equal((await post('topics', { board: 'vip', body: '文字' })).status, 403);
  const bounty = await post('topics', { ...fields, board: 'qa', bounty: 5 });
  assert.equal(bounty.status, 400); assert.match((await bounty.json()).error, /价格|悬赏/);
  const price = await post('topics', { ...fields, board: 'tools', url: 'https://example.com/', price: '付费' });
  assert.equal(price.status, 400); assert.match((await price.json()).error, /价格|悬赏/);
  const wrongBoard = await post('topics', { ...fields, board: 'qa', prompt: 'test', promptMode: 'paid', promptPrice: 17 });
  assert.equal(wrongBoard.status, 400);
});

test('simple work posting accepts every integer from 5 to 50 and unlocks at the author-defined amount', async t => {
  const { post, get, upload, credit } = await setup(t, { simplePosting: true });
  const cover = await json(upload(await png()));
  const fields = { board: 'showcase', title: '自定义解锁数量', body: '作品说明\n\n' + imageMarker(cover.id), images: [cover.id],
    prompt: 'silver nebula over a quiet star field', promptMode: 'paid' };
  for (const promptPrice of [4, 51, 17.5, '', 'invalid']) {
    const rejected = await post('topics', { ...fields, promptPrice });
    assert.equal(rejected.status, 400, String(promptPrice));
    assert.match((await rejected.json()).error, /解锁价格/);
  }
  const works = [];
  for (const promptPrice of [5, 17, 50]) {
    const nextCover = await json(upload(await png()));
    const content = { ...fields, body: '作品说明\n\n' + imageMarker(nextCover.id), images: [nextCover.id] };
    const created = await post('topics', { ...content, promptPrice });
    assert.equal(created.status, 201, await created.clone().text());
    const { id } = await created.json(); works.push({ id, content });
    const locked = await json(get(`topics/${id}`, 'reader=r2'));
    assert.equal(locked.topic.meta.price, promptPrice);
    assert.equal(locked.topic.meta.prompt, null);
    assert.equal(JSON.stringify(locked).includes(fields.prompt), false);
  }
  const { id, content } = works[1];
  credit('r2', 30);
  const unlocked = await json(post(`topics/${id}/unlock`, {}, 'reader=r2'));
  assert.deepEqual(unlocked, { share: 13, balance: 13 });
  assert.equal((await json(get(`topics/${id}`, 'reader=r2'))).topic.meta.prompt, fields.prompt);
  const edited = await post(`topics/${id}/edit`, { ...content, promptPrice: 32 });
  assert.equal(edited.status, 200, await edited.clone().text());
  assert.equal((await json(get(`topics/${id}`))).topic.meta.price, 32);
  assert.equal((await json(get(`topics/${id}`, 'reader=r2'))).topic.meta.unlocked, true, 'an existing unlock remains valid');
  const otherEdit = await post(`topics/${id}/edit`, { ...content, promptPrice: 8 }, 'reader=r2');
  assert.equal(otherEdit.status, 403);
  assert.equal((await json(get(`topics/${id}`))).topic.meta.price, 32);
});

test('simple edits can remove optional resource links and preserve existing paid prompts', async t => {
  const { post, get, store, upload } = await setup(t, { simplePosting: true });
  const cover = await json(upload(await png()));
  const resource = await json(post('topics', { board: 'tools', title: '标题', body: '工具说明\n\n' + imageMarker(cover.id), images: [cover.id], url: 'https://example.com/' }));
  assert.equal((await json(get(`topics/${resource.id}`))).topic.resource.url, 'https://example.com/');
  assert.equal((await post(`topics/${resource.id}/edit`, { title: '标题', body: '撤回资源链接\n\n' + imageMarker(cover.id), images: [cover.id], url: '' })).status, 200);
  assert.equal((await json(get(`topics/${resource.id}`))).topic.resource, null);
  const old = store.createTopic({ board: 'showcase', author: { kind: 'reader', id: 'r1' }, title: '旧作品', body: '旧作品的说明',
    meta: { tools: '旧工具', model: '', usage: '', prompt: '原先的付费提示词', promptMode: 'paid', price: 10 } });
  const second = await json(upload(await png()));
  const edited = await post(`topics/${old.id}/edit`, { title: '标题', body: '更新后的说明\n\n' + imageMarker(second.id), images: [second.id], tools: '旧工具' });
  assert.equal(edited.status, 200, await edited.clone().text());
  const thread = await json(get(`topics/${old.id}`));
  assert.equal(thread.topic.meta.promptMode, 'paid');
  assert.equal(thread.topic.meta.price, 10);
  assert.equal(thread.topic.meta.prompt, '原先的付费提示词');
});

test('no role can omit a cover and body image order determines the cover on create and edit', async t => {
  const { post, get, upload } = await setup(t, { simplePosting: true });
  for (const cookie of ['owner=yes', 'reader=r1', 'reader=v1', 'reader=s1']) {
    const result = await post('topics', { board: 'qa', title: '封面要求', body: '有正文但没有封面', agree: true }, cookie);
    assert.equal(result.status, 400); assert.match((await result.json()).error, /封面/);
  }
  const first = await json(upload(await png())), second = await json(upload(await png()));
  const payload = { board: 'qa', title: '封面顺序', body: `文字\n\n${imageMarker(second.id)}\n\n${imageMarker(first.id)}`, images: [first.id, second.id] };
  const created = await json(post('topics', payload));
  assert.ok(created.id);
  assert.equal((await json(get(`topics/${created.id}`))).topic.images[0].id, second.id);
  const edited = await post(`topics/${created.id}/edit`, { ...payload, body: `文字\n\n${imageMarker(first.id)}\n\n${imageMarker(second.id)}` });
  assert.equal(edited.status, 200);
  assert.equal((await json(get(`topics/${created.id}`))).topic.images[0].id, first.id);
  const missing = await post(`topics/${created.id}/edit`, { ...payload, body: '只留下文字', images: [] });
  assert.equal(missing.status, 400);
});

test('inline body pictures require real text, attached IDs and ownership; image markers do not use up the moment text limit', async t => {
  const { post, get, upload } = await setup(t, { simplePosting: true });
  const { id } = await json(upload(await png()));
  const marker = `![图片](/api/community/images/${id}.webp)`;
  const empty = await post('topics', { board: 'moments', title: '标题', body: marker, images: [id] });
  assert.equal(empty.status, 400); assert.match((await empty.json()).error, /正文/);
  const unbound = await post('topics', { board: 'moments', title: '标题', body: '说明\n\n' + marker, images: [] });
  assert.equal(unbound.status, 400); assert.match((await unbound.json()).error, /图片/);
  assert.equal((await post('topics', { board: 'moments', title: '标题', body: '说明\n\n' + marker, images: [id] }, 'reader=r2')).status, 400);
  const created = await post('topics', { board: 'moments', title: '标题', body: '文'.repeat(298) + '\n\n' + marker, images: [id] });
  assert.equal(created.status, 201, await created.clone().text());
  const result = await created.json();
  const topic = (await json(get(`topics/${result.id}`))).topic;
  assert.equal(topic.title, '标题'); assert.equal(topic.images[0].id, id); assert.ok(topic.body.includes(marker));
});

test("the community requires sign-in and a same-site request for every write", async (t) => {
  const { get, post, siteOrigin } = await setup(t);
  assert.equal((await get("summary", "")).status, 401);
  assert.equal((await post("topics", topicBody, "")).status, 401);
  const forged = await fetch(`${siteOrigin}/api/community/topics`, { method: "POST", headers: { Origin: "https://evil.example", "X-Reader-Request": "1", cookie: "reader=r1", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(forged.status, 403);
  assert.equal((await post("topics", topicBody, "reader=r1", { "X-Reader-Request": "" })).status, 403);
  assert.equal((await fetch(`${siteOrigin}/api/community/summary`, { method: "DELETE", headers: { cookie: "reader=r1" } })).status, 405);
});

test("readers post, list, read and reply; the owner can remove anything, readers only their own", async (t) => {
  const { get, post, audits } = await setup(t);
  const created = await post("topics", { board: "qa", title: "  ComfyUI 人脸崩了  ", body: "第一段：单独用没问题\r\n第二段：一起用就崩" });
  assert.equal(created.status, 201);
  const { id, earned, pending } = await created.json();
  assert.deepEqual([earned, pending], [2, false]);
  assert.equal((await post("topics", { board: "tools", title: "推荐一个工具", body: "这是一个很好用的工具。", url: "https://example.com/tool" }, "reader=r2")).status, 201);
  assert.equal((await post(`topics/${id}/replies`, { body: "试试降低强度" }, "reader=r2")).status, 201);

  const list = await json(get("topics?sort=active"));
  assert.equal(list.total, 2);
  assert.equal(list.items[0].id, id, "the replied topic is most recently active");
  assert.equal(list.items[0].title, "ComfyUI 人脸崩了", "titles are trimmed");
  assert.deepEqual(list.items[0].author, { name: "林间", role: "reader", uid: "u1", showUid: true, avatar: `/api/community/avatar/u1.webp?v=${avatarId}`, vip: false, level: 1, growth: emptyGrowth, vipGrowth: emptyVIPGrowth, steward: false,staffRole:null, icon:null, frame: null, color: null });
  assert.equal(list.items[0].replies, 1);
  assert.equal(list.items[0].lastReply.author.name, "远山", "a listed topic names its latest replier");
  assert.equal(list.items[1].lastReply, null);
  assert.equal(list.items[1].resource.url, "https://example.com/tool");
  assert.equal((await json(get("topics?board=tools"))).total, 1);
  assert.deepEqual((await json(get(`topics?q=${encodeURIComponent("人脸")}`))).items.map((x) => x.id), [id], "search");
  assert.equal((await get(`topics?q=${"字".repeat(41)}`)).status, 400, "search terms are bounded");
  assert.deepEqual((await json(get("topics?author=u2"))).items.map((x) => x.board), ["tools"], "a member's own topics");
  assert.equal((await get("topics?author=nobody")).status, 404);

  const summary = await json(get("summary"));
  assert.equal(summary.total, 2);
  assert.equal(summary.repliesToday, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(summary.boards).map(([board, stats]) => [board, [stats.topics, stats.repliesToday, stats.latest.title]])),
    { qa: [1, 1, "ComfyUI 人脸崩了"], tools: [1, 0, "推荐一个工具"] });
  const board = await json(get("topics?board=qa"));
  assert.deepEqual(board.posters.map((poster) => [poster.author.name, poster.topics]), [["林间", 1]], "a board lists its most active people");
  assert.equal((await json(get("topics"))).posters, undefined, "only a board page has them");

  const detail = await json(get(`topics/${id}`));
  assert.equal(detail.topic.body, "第一段：单独用没问题\n第二段：一起用就崩", "line endings are normalised");
  assert.deepEqual([detail.topic.canDelete, detail.topic.canEdit, detail.topic.canReply, detail.topic.replies], [true, true, true, 1]);
  assert.equal(detail.replies[0].author.name, "远山");
  assert.equal(detail.replies[0].canDelete, false, "a reader cannot delete someone else's reply");
  assert.equal(detail.replies[0].byTopicAuthor, false);
  assert.deepEqual([detail.author.name, detail.author.topics, detail.author.bio, detail.author.badges, detail.author.following], ["林间", 1, "喜欢画画", [], false]);
  assert.equal(detail.author.badgeState.families.find(item => item.id === 'writing').tier, 'gold');
  assert.deepEqual(detail.related, [], "no other topics in this board yet");
  assert.deepEqual(detail.viewer, { level: 1, muted: null });
  const replyId = detail.replies[0].id;
  assert.equal((await post(`replies/${replyId}/delete`, {})).status, 403);
  assert.equal((await post(`topics/${id}/delete`, {}, "reader=r2")).status, 403);
  assert.equal((await post(`replies/${replyId}/delete`, {}, "reader=r2")).status, 200);
  assert.equal((await json(get(`topics/${id}`))).replies.length, 0);
  assert.equal((await post(`topics/${id}/delete`, { reason: "违规内容处理" }, "owner=yes")).status, 200);
  assert.equal((await get(`topics/${id}`)).status, 404);
  assert.equal((await get("topics/not-a-topic")).status, 404);
  assert.deepEqual(audits.map((entry) => [entry.action, entry.moderated]), [["community-delete-topic", true]], "only moderation is audited");
  assert.equal((await json(get("inbox?tab=system"))).items[0].type, "penalty", "the author is told");
});

test("input is validated: boards, lengths, contact details, board fields and the members-only board", async (t) => {
  const { get, post } = await setup(t);
  const status = async (body, cookie) => (await post("topics", body, cookie)).status;
  assert.equal(await status({ board: "nope", title: "有效的标题", body: "足够长的正文内容" }), 400);
  assert.equal(await status({ board: "qa", title: "短", body: "足够长的正文内容" }), 400);
  assert.equal(await status({ board: "qa", title: "x".repeat(61), body: "足够长的正文内容" }), 400);
  assert.equal(await status({ board: "qa", title: "有效的标题", body: "太短" }), 400);
  assert.equal(await status({ board: "qa", title: "有效的标题", body: "x".repeat(10001) }), 400);
  assert.equal(await status({ board: "qa", title: "有效的\u0007标题", body: "足够长的正文内容" }), 400);
  const phone = await post("topics", { board: "qa", title: "有效的标题", body: "有问题打 138 0013 8000 找我" });
  assert.equal(phone.status, 400);
  assert.match((await phone.json()).error, /手机号/);
  assert.equal(await status({ board: "qa", title: "有效的标题", body: "教程合集加微信 lucky888xx 领取" }), 400);
  assert.equal(await status({ board: "qa", title: "有效的标题", body: "足够长的正文内容", bounty: 30 }), 400, "bounties come in fixed amounts");
  assert.equal(await status({ board: "showcase", title: "我的作品", body: "", tools: "Midjourney" }), 400, "a work needs an image");
  assert.equal(await status({ board: "tools", title: "推荐一个工具", body: "" }), 400, "a resource needs its link");
  assert.equal(await status({ board: "tools", title: "推荐一个工具", body: "", url: "ftp://example.com/tool" }), 400);
  assert.equal(await status({ board: "tools", title: "推荐一个工具", body: "", url: "https://example.com", kind: "破解" }), 400);
  assert.equal(await status({ board: "moments", body: "嗯" }, "reader=r2"), 400, "a moment needs two characters");
  assert.equal(await status({ board: "moments", body: "字".repeat(301) }, "reader=r2"), 400, "and at most 300");
  const moment = await json(post("topics", { board: "moments", title: "随想不需要标题", body: "今天试了一个新工具，挺好用。" }, "reader=r2"));
  assert.equal((await json(get(`topics/${moment.id}`))).topic.title, "今天试了一个新工具，挺好用。", "a moment is titled by its text");
  assert.equal(await status({ board: "qa", title: "微信小程序怎么接入 AI", body: "想在微信小程序里调用模型接口。" }), 201, "mentioning WeChat is fine");
  assert.equal(await status({ board: "vip", title: "会员的话题", body: "只有会员能看到的内容" }), 403);
  assert.equal(await status({ board: "vip", title: "会员的话题", body: "只有会员能看到的内容" }, "reader=v1"), 201);
  assert.equal((await json(get("topics"))).items.some((x) => x.board === "vip"), false, "non-members never see members-only topics");
  assert.deepEqual(Object.keys((await json(get("summary"))).boards).sort(), ["moments", "qa"], "non-members get no members-board stats");
  assert.equal((await json(get("topics", "reader=v1"))).items.some((x) => x.board === "vip"), true);
  assert.equal((await post("topics/x/replies", { body: "有效的回复" })).status, 404, "no such topic");
  assert.equal(communityContactReason("微信公众号的文章怎么总结"), null);
  assert.match(communityContactReason("vx：abcdef123"), /微信/);
});

test("posting is rate limited per account", async (t) => {
  const { post } = await setup(t);
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await post("topics", { board: "moments", body: `第 ${i} 条：今天试了一个新工具，挺好用。` })).status);
  assert.deepEqual(results, [201, 201, 201, 429]);
  assert.equal((await post("topics", { board: "moments", body: "别人的随想：今天试了一个新工具。" }, "reader=r2")).status, 201, "limits are per account");
});

test("without the community tables the service says it is not open, and the rest of the site is unaffected", async (t) => {
  const { get } = await setup(t, { store: false });
  const response = await get("summary");
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /尚未开放/);
});

test("the runtime maps site identities to community members and looks up their profiles", async (t) => {
  const { createCommunityRuntime } = await import("../server/community-runtime.ts");
  const directory = await mkdtemp(resolve(tmpdir(), "sansphase-community-runtime-"));
  t.after(() => cleanup(directory));
  await copyFile(resolve(template, "content.db"), resolve(directory, "content.db"));
  const finds = [];
  const options = {
    directory, siteOrigin: "http://127.0.0.1:1", authorId: "author-1",
    payload: { find: async (query) => { finds.push(query); return { docs: [{ id: "r1", nickname: "林间", signature: "你好", _verified: true, createdAt: "2026-01-01T00:00:00.000Z" }] }; } },
    readerIdentity: async (req) => req.reader ? { id: "r1", nickname: "林间", vip: true } : null,
    ownerIdentity: async (req) => req.owner ? { name: "作者" } : null,
    ownerName: async () => "無相",
    uidStore: { get: (id) => `u${id}`, readerId: (uid) => uid.startsWith("u") ? uid.slice(1) : null },
  };
  const runtime = createCommunityRuntime(options);
  try {
    assert.ok(runtime.store);
    runtime.store.createTopic({ board: "qa", author: { kind: "reader", id: "r1" }, title: "读者的帖子", body: "足够长的正文内容" });
    runtime.store.createTopic({ board: "qa", author: { kind: "owner", id: "author-1" }, title: "站长的帖子", body: "足够长的正文内容" });
    runtime.store.createTopic({ board: "qa", author: { kind: "reader", id: "gone" }, title: "注销者的帖子", body: "足够长的正文内容" });
    // Drive the service through a fake request/response pair.
    const call = async (req, url = "/api/community/topics") => {
      const res = { status: 0, body: "", headersSent: false, writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
      await runtime.service.handle({ method: "GET", url, headers: {}, ...req }, res);
      return { status: res.status, value: JSON.parse(res.body) };
    };
    assert.equal((await call({})).status, 401);
    const asReader = await call({ reader: true });
    assert.equal(asReader.status, 200, JSON.stringify(asReader.value));
    assert.deepEqual(asReader.value.items.map((x) => [x.author.name, x.author.uid]).sort(), [["已注销用户", null], ["林间", "ur1"], ["無相", "owner"]].sort());
    assert.deepEqual(finds.filter(query=>query.where?.id?.in).map(query=>[...query.where.id.in].sort()), [["gone","r1"],["r1"]], "one lookup for all author profiles and one bounded final actor confirmation");
    assert.equal((await call({ owner: true })).status, 200, "the owner can read too");
    const page = await call({ reader: true }, "/api/community/members/ur1");
    assert.deepEqual([page.status, page.value.person.name, page.value.bio, page.value.self], [200, "林间", "你好", true]);
    assert.equal((await call({ reader: true }, "/api/community/members/owner")).value.person.name, "無相");
  } finally { runtime.close(); }
  const empty = await mkdtemp(resolve(tmpdir(), "sansphase-community-runtime-"));
  t.after(() => cleanup(empty));
  new DatabaseSync(resolve(empty, "content.db")).close();
  const closed = createCommunityRuntime({ ...options, directory: empty });
  assert.equal(closed.store, null, "without the migration there is no store");
  closed.close();
});

test("likes, bookmarks, views, thanks, check-ins and the viewer's own state", async (t) => {
  const { get, post, setLevel } = await setup(t);
  const { id, earned } = await json(post("topics", { ...topicBody, tags: ["ComfyUI", "新手"] }));
  assert.equal(earned, 2, "posting earns 星尘");
  assert.deepEqual(await json(post(`topics/${id}/like`, { on: true }, "reader=r2")), { likes: 1, liked: true, earned: 0 }, "a 巡天 like gives no stars");
  assert.deepEqual(await json(post(`topics/${id}/bookmark`, { on: true }, "reader=r2")), { bookmarks: 1, bookmarked: true });
  const seen = await json(get(`topics/${id}`, "reader=r2"));
  assert.deepEqual([seen.topic.likes, seen.topic.liked, seen.topic.bookmarked, seen.topic.mine, seen.topic.canEdit], [1, true, true, false, false]);
  assert.deepEqual(seen.topic.tags, ["ComfyUI", "新手"]);
  assert.equal((await json(get(`topics/${id}`))).topic.liked, false, "likes are per viewer");
  assert.equal((await json(get(`topics?tag=${encodeURIComponent("新手")}`))).items[0].views, 2, "each viewer counts once a day");
  assert.equal((await get("topics?tag=nope")).status, 404);
  assert.equal((await json(get("bookmarks", "reader=r2"))).items[0].id, id);
  const poor = await post(`topics/${id}/thank`, {}, "reader=r2");
  assert.equal(poor.status, 402);
  assert.match((await poor.json()).error, /星尘不足/);
  assert.equal((await post("checkin", {}, "reader=r2")).status, 200);
  assert.equal((await post("checkin", {}, "reader=r2")).status, 409, "once a day");
  const me = await json(get("me", "reader=r2"));
  assert.deepEqual([me.name, me.checkedIn, me.streak, me.balance, me.nextReward.total, me.agreed], ["远山", true, 1, 1, 1, true]);
  const summary = await json(get("summary"));
  assert.deepEqual([summary.checkinsToday, summary.tags.ComfyUI], [1, 1]);
  assert.equal((await post(`topics/${id}/thank`, {})).status, 400, "not your own post");
  const board = await json(get("checkin", "reader=r2"));
  assert.equal(board.days.length, 1);
  assert.deepEqual(board.earlyBirds.map((bird) => bird.person.name), ["远山"]);
  assert.deepEqual(board.badges, []);
  assert.deepEqual(board.badgeState.families.slice(0, 2).map(item => item.tier), ['gold', 'gold']);
  assert.equal((await json(get("stardust", "reader=r2"))).ledger[0].reason, "checkin");
  setLevel("r2", 1);
  await post("checkin", {}, "reader=v1");
  await post("checkin", {}, "reader=v1");
  assert.equal((await json(get("me", "reader=v1"))).balance, 2, "VIP daily check-in earns its additional star only once");
  assert.equal((await post("topics", { ...topicBody, tags: ["不存在的标签"] })).status, 400);
  assert.equal((await post("topics", { ...topicBody, tags: ["新手", "提示词", "工作流", "Claude"] })).status, 400, "at most three tags");
});

test("editing, accepting answers and moderation tools are limited to the right people", async (t) => {
  const { get, post, audits } = await setup(t);
  const { id } = await json(post("topics", topicBody));
  const edit = (cookie, title = "ComfyUI 人脸崩了（已补充）") => post(`topics/${id}/edit`, { title, body: "补充：权重都是 0.8。", tags: ["ComfyUI"] }, cookie);
  assert.equal((await edit("reader=r2")).status, 403);
  assert.equal((await edit("reader=r1")).status, 200);
  assert.equal((await edit("owner=yes", "站长改过的标题")).status, 200, "the owner may edit anything");
  const detail = await json(get(`topics/${id}`));
  assert.deepEqual([detail.topic.title, detail.topic.edited], ["站长改过的标题", true]);

  const mine = await json(post(`topics/${id}/replies`, { body: "我自己补充一句" }));
  const answer = await json(post(`topics/${id}/replies`, { body: "把权重降到 0.5 试试看" }, "reader=r2"));
  assert.equal((await post(`replies/${answer.id}/edit`, { body: "别人的回复" })).status, 403);
  assert.equal((await post(`replies/${answer.id}/edit`, { body: "把权重降到 0.5 左右试试" }, "reader=r2")).status, 200);
  assert.equal((await post(`replies/${answer.id}/accept`, {}, "reader=r2")).status, 403, "only the asker accepts");
  assert.equal((await post(`replies/${mine.id}/accept`, {})).status, 400, "not your own reply");
  assert.deepEqual(await json(post(`replies/${answer.id}/accept`, {})), { earned: 3 });
  assert.equal((await post(`replies/${answer.id}/accept`, {})).status, 409);
  const solved = await json(get(`topics/${id}`));
  assert.deepEqual(solved.replies.map((reply) => [reply.id, reply.accepted]), [[answer.id, true], [mine.id, false]], "the accepted answer comes first");
  assert.equal(solved.replies[0].canAccept, false);
  const quoting = await json(post(`topics/${id}/replies`, { body: "同意楼上的办法", quote: answer.id }, "reader=v1"));
  assert.deepEqual((await json(get(`topics/${id}`))).replies.find((reply) => reply.id === quoting.id).quote, { id: answer.id, author: "远山", excerpt: "把权重降到 0.5 左右试试" });

  assert.equal((await post(`topics/${id}/pin`, { on: true })).status, 403);
  assert.equal((await post(`topics/${id}/feature`, { on: true })).status, 403);
  assert.equal((await post(`topics/${id}/pin`, { on: true }, "owner=yes")).status, 200);
  assert.equal((await post(`topics/${id}/feature`, { on: true }, "owner=yes")).status, 200);
  const flagged = (await json(get("topics"))).items[0];
  assert.deepEqual([flagged.pinned, flagged.featured, flagged.solved], [true, true, true]);
  assert.equal((await json(get("me"))).balance, 2 + 15, "a first 精华 pays the author 15");
  assert.equal((await json(get(`topics/${id}`, "owner=yes"))).topic.canModerate, true);
  assert.equal((await json(get(`topics/${id}`))).topic.canModerate, false);

  assert.equal((await post(`topics/${id}/lock`, { on: true }, "owner=yes")).status, 200);
  assert.equal((await post(`topics/${id}/replies`, { body: "锁了还能回复吗" }, "reader=r2")).status, 409);
  assert.equal((await json(get(`topics/${id}`, "reader=r2"))).topic.canReply, false);
  assert.equal((await post(`topics/${id}/move`, { board: "nowhere" }, "owner=yes")).status, 400);
  assert.equal((await post(`topics/${id}/move`, { board: "meta" }, "owner=yes")).status, 200);
  assert.equal((await json(get(`topics/${id}`))).topic.board, "meta");
  assert.equal((await json(get("inbox?tab=system"))).items.some((notice) => notice.data.moved === "meta"), true, "the author hears where it went");
  assert.deepEqual(audits.map((entry) => entry.action), ["community-pin", "community-feature", "community-lock", "community-move"]);
});

test("reports go to the owner; strong reports hide content at once", async (t) => {
  const { get, post, setLevel } = await setup(t);
  const { id } = await json(post("topics", topicBody));
  const reply = await json(post(`topics/${id}/replies`, { body: "广告广告广告广告" }, "reader=r2"));
  const report = (body, cookie = "reader=r1") => post("reports", body, cookie);
  assert.equal((await report({ kind: "topic", id, reason: "其他" })).status, 400, "not your own post");
  assert.equal((await report({ kind: "reply", id: reply.id, reason: "乱写的原因" })).status, 400);
  assert.deepEqual(await json(report({ kind: "reply", id: reply.id, reason: "垃圾广告 / 引流", note: "明显是广告" })), { hidden: false });
  assert.equal((await report({ kind: "reply", id: reply.id, reason: "其他" })).status, 409);
  assert.equal((await report({ kind: "reply", id: reply.id, reason: "其他" }, "reader=r3")).status, 403, "初光 cannot report");
  assert.equal((await get("manage")).status, 403);
  const queue = await json(get("manage?tab=reports", "owner=yes"));
  assert.equal(queue.counts.reports, 1);
  const [open] = queue.reports;
  assert.deepEqual([open.reporter.name, open.target.kind, open.target.author.name, open.target.topicId, open.target.excerpt], ["林间", "reply", "远山", id, "广告广告广告广告"]);
  assert.equal((await post(`manage/reports/${open.id}`, { uphold: true })).status, 403);
  assert.equal((await post(`manage/reports/${open.id}`, { uphold: true }, 'owner=yes')).status, 400);
  assert.deepEqual(await json(post(`manage/reports/${open.id}`, { uphold: true, reason: '核实为违规内容' }, "owner=yes")), { removed: true });
  assert.equal((await json(get(`topics/${id}`))).replies.length, 0);
  assert.equal((await json(get("manage?tab=reports", "owner=yes"))).reports.length, 0);
  assert.equal((await json(get("me"))).balance, 2, "reports do not mint stars");

  // A 守夜 (L3) report hides a 巡天 member's post at once; the author still sees it.
  setLevel("r2", 3);
  const second = await json(post("topics", { ...topicBody, title: "另一个问题的标题" }));
  assert.deepEqual(await json(report({ kind: "topic", id: second.id, reason: "与版块无关" }, "reader=r2")), { hidden: true });
  assert.equal((await get(`topics/${second.id}`, "reader=v1")).status, 404);
  assert.match((await json(get(`topics/${second.id}`))).topic.hiddenReason, /与版块无关/);
  assert.equal((await json(get("manage", "owner=yes"))).queue.topics[0].id, second.id);
  assert.equal((await post(`topics/${second.id}/restore`, {}, "owner=yes")).status, 200);
  assert.equal((await get(`topics/${second.id}`, "reader=v1")).status, 200);

  // Two 观测 (L2) reports hide it too.
  setLevel("v1", 2);
  setLevel("s1", 2);
  const third = await json(post("topics", { ...topicBody, title: "第三个问题的标题" }));
  assert.deepEqual(await json(report({ kind: "topic", id: third.id, reason: "其他" }, "reader=v1")), { hidden: false });
  assert.deepEqual(await json(report({ kind: "topic", id: third.id, reason: "其他" }, "reader=s1")), { hidden: true });
  assert.ok((await json(get("inbox", "owner=yes"))).items.some((notice) => notice.data.report === "new" && notice.data.hidden));
});

for (const kind of ['topic', 'reply']) test(`a failed ${kind} report notification rolls back the report and hiding while the attempt stays counted`, async t => {
  const { post, store, setLevel, directory } = await setup(t);
  const owner = { kind: 'owner', id: 'owner' };
  const topic = await json(post('topics', topicBody));
  const target = kind === 'topic' ? topic : await json(post(`topics/${topic.id}/replies`, { body: '有效回复用于举报通知失败回滚测试' }));
  setLevel('r2', 3);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    db.exec("CREATE TRIGGER reject_report_notification BEFORE INSERT ON community_notifications WHEN NEW.text = '收到一条举报' BEGIN SELECT RAISE(ABORT, 'synthetic report notification failure'); END");
    const input = { kind, id: target.id, reason: '垃圾广告 / 引流' };
    assert.equal((await post('reports', input, 'reader=r2')).status, 500);
    assert.equal(store.openReports().length, 0, 'an incomplete report is not retained');
    assert.equal((kind === 'topic' ? store.topic(target.id) : store.reply(target.id)).hidden, false, 'failed notification cannot leave content hidden');
    assert.equal(store.members.inbox(owner).filter(notice => notice.data?.report === 'new').length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM community_rate_events WHERE member_kind='reader' AND member_id='r2' AND action='report'").get().n, 1, 'a failed business operation still consumes a validated report attempt');
    db.exec('DROP TRIGGER reject_report_notification');
    const response = await post('reports', input, 'reader=r2');
    assert.equal(response.status, 201, 'a rolled-back report remains retryable');
    assert.deepEqual(await response.json(), { hidden: true });
    assert.equal(store.openReports().length, 1);
    assert.equal((kind === 'topic' ? store.topic(target.id) : store.reply(target.id)).hidden, true);
    assert.equal(store.members.inbox(owner).filter(notice => notice.data?.report === 'new').length, 1);
  } finally { db.close(); }
});

test('a failed prompt unlock notification rolls back buyer debit, author share and entitlement while the attempt stays counted', async t => {
  const { post, get, store, credit, directory } = await setup(t);
  const author = { kind: 'reader', id: 'r1' }, buyer = { kind: 'reader', id: 'r2' };
  const topic = store.createTopic({ author, board: 'showcase', title: '通知失败解锁测试', body: '用于隔离验证解锁事务的作品说明', meta: { tools: '', model: '', usage: '', prompt: 'paid private prompt', promptMode: 'paid', price: 10 } });
  credit('r2', 100);
  const authorBalance = store.ledger.balance(author);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    db.exec("CREATE TRIGGER reject_unlock_notification BEFORE INSERT ON community_notifications WHEN NEW.type = 'unlock' BEGIN SELECT RAISE(ABORT, 'synthetic unlock notification failure'); END");
    const path = `topics/${topic.id}/unlock`;
    assert.equal((await post(path, {}, 'reader=r2')).status, 500);
    assert.equal(store.ledger.balance(buyer), 100);
    assert.equal(store.ledger.balance(author), authorBalance);
    assert.equal(store.economy.unlocked(topic.id, buyer), false);
    assert.equal(store.economy.unlockCount(topic.id), 0);
    assert.equal(store.members.inbox(author).filter(notice => notice.type === 'unlock').length, 0);
    assert.equal((await json(get(`topics/${topic.id}`, 'reader=r2'))).topic.meta.prompt, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM community_rate_events WHERE member_kind='reader' AND member_id='r2' AND action='action'").get().n, 1);
    db.exec('DROP TRIGGER reject_unlock_notification');
    assert.deepEqual(await json(post(path, {}, 'reader=r2')), { share: 8, balance: 90 });
    assert.equal(store.ledger.balance(author), authorBalance + 8);
    assert.equal(store.economy.unlocked(topic.id, buyer), true);
    assert.equal(store.members.inbox(author).filter(notice => notice.type === 'unlock').length, 1);
    assert.equal((await post(path, {}, 'reader=r2')).status, 409, 'a completed unlock cannot debit again');
    assert.equal(store.ledger.balance(buyer), 90);
  } finally { db.close(); }
});

test("images: upload, re-encode, attach to a post and serve only to those who may see it", async (t) => {
  const { get, post, upload } = await setup(t);
  const bytes = await png();
  const image = await json(upload(bytes));
  assert.match(image.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual([image.width, image.height], [1200, 800]);
  assert.equal((await upload(Buffer.from("not an image"), "image/png")).status, 400);
  assert.equal((await upload(Buffer.from("GIF89a"), "image/gif")).status, 415);
  assert.equal((await get(`images/${image.id}.webp`, "reader=r2")).status, 404, "an unattached upload is private");
  assert.equal((await get(`images/${image.id}.thumb.webp`)).headers.get("content-type"), "image/webp");
  const { id } = await json(post("topics", { board: "showcase", title: "节气海报", body: "一组节气海报作品，欢迎提意见。", images: [image.id], tools: "Midjourney" }));
  assert.equal((await get(`images/${image.id}.webp`, "reader=r2")).status, 200, "attached images follow the post");
  const detail = await json(get(`topics/${id}`, "reader=r2"));
  assert.deepEqual(detail.topic.images, [{ id: image.id, width: 1200, height: 800 }]);
  assert.deepEqual((await json(get("topics"))).items[0].thumbs, [image.id]);
  assert.equal((await post("topics", { board: "moments", body: "随手记一笔内容", images: Array.from({ length: 5 }, (_, i) => `${image.id.slice(0, -1)}${i}`) })).status, 400, "随想 allows four images");
  assert.equal((await post("topics", { board: "tools", title: "推荐一个工具", body: "", url: "https://example.com", images: [image.id] })).status, 400, "resources have no images");
  const secret = await json(upload(bytes, "image/png", "reader=v1"));
  await post("topics", { board: "vip", title: "会员的图", body: "只有会员能看到的图片", images: [secret.id] }, "reader=v1");
  assert.equal((await get(`images/${secret.id}.webp`, "reader=r2")).status, 404, "members-board images stay with the board");
  assert.equal((await get(`images/${secret.id}.webp`, "owner=yes")).status, 200);
  const newcomer = [await json(upload(bytes, "image/png", "reader=r3")), await json(upload(bytes, "image/png", "reader=r3"))];
  const tooMany = await post("topics", { ...topicBody, agree: true, images: newcomer.map((x) => x.id) }, "reader=r3");
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).error, /初光等级每帖最多 1 张图/);
});

test("the guidelines come first, and 初光 members have limits and a review queue", async (t) => {
  const { get, post, store, directory } = await setup(t);
  const agreement = new DatabaseSync(resolve(directory, 'content.db'));
  agreement.prepare("UPDATE community_members SET agreed_version=NULL,convention_read_version=NULL,convention_read_at=NULL WHERE member_id='r3'").run();
  agreement.close();
  const first = await post("topics", topicBody, "reader=r3");
  assert.equal(first.status, 428, "the first post asks for the guidelines");
  assert.equal((await json(get("me", "reader=r3"))).agreed, false);
  assert.equal((await post("topics", { ...topicBody, agree: true }, "reader=r3")).status, 428, 'the old checkbox cannot bypass versioned consent');
  acceptCommunityConvention(store, [{ kind: 'reader', id: 'r3' }]);
  const plain = await json(post("topics", { ...topicBody, agree: true }, "reader=r3"));
  assert.deepEqual([plain.pending, plain.earned], [false, 2]);
  assert.equal((await json(get("me", "reader=r3"))).agreed, true);
  assert.equal((await post("topics", { ...topicBody, bounty: 20 }, "reader=r3")).status, 403, "初光 cannot offer bounties");
  const links = "看这几个链接 https://a.example https://b.example https://c.example";
  assert.equal((await post("topics", { ...topicBody, body: links }, "reader=r3")).status, 400, "at most two links");
  const linked = await json(post("topics", { ...topicBody, title: "带链接的问题标题", body: "参考了这个教程 https://a.example/guide" }, "reader=r3"));
  assert.deepEqual([linked.pending, linked.earned], [true, 0], "the first posts with links wait for review");
  assert.equal((await post("topics", { ...topicBody, title: "第三个问题标题" }, "reader=r3")).status, 429, "two topics a day");
  assert.equal((await get(`topics/${linked.id}`, "reader=r2")).status, 404, "others cannot see it yet");
  const own = await json(get(`topics/${linked.id}`, "reader=r3"));
  assert.deepEqual([own.topic.pending, own.topic.pendingReason, own.topic.canReply], [true, "初光等级，帖子带外链", false]);
  assert.equal((await json(get("topics"))).items.some((x) => x.id === linked.id), false);
  assert.ok((await json(get("inbox", "owner=yes"))).items.some((notice) => notice.type === "review" && notice.topicId === linked.id), "the owner is told");
  assert.equal((await json(get("manage", "owner=yes"))).queue.topics[0].id, linked.id);
  assert.equal((await post(`topics/${linked.id}/approve`, {}, "owner=yes")).status, 200);
  assert.equal((await get(`topics/${linked.id}`, "reader=r2")).status, 200);
  assert.equal((await json(get("inbox", "reader=r3"))).items[0].data.state, "approved");

  const other = await json(post("topics", { ...topicBody, title: "巡天的问题标题" }, "reader=r2"));
  assert.equal((await post(`topics/${other.id}/thank`, {}, "reader=r3")).status, 403, "初光 cannot thank");
  assert.equal((await json(post(`topics/${other.id}/like`, {}, "reader=r3"))).earned, 0, "an 初光 like gives no 星尘");
  assert.equal((await post(`topics/${other.id}/replies`, { body: links }, "reader=r3")).status, 400);
  assert.equal((await post(`topics/${other.id}/replies`, { body: "有道理，学到了" }, "reader=r3")).status, 201);
});

test("@mentions, notifications and follows", async (t) => {
  const { get, post } = await setup(t);
  const { id } = await json(post("topics", { ...topicBody, body: "请教 @远山 和 @無相 这个问题怎么解决" }));
  const mention = (await json(get("inbox?tab=reply", "reader=r2"))).items[0];
  assert.deepEqual([mention.type, mention.actor.name, mention.topicTitle], ["mention", "林间", "ComfyUI 人脸崩了"]);
  assert.ok((await json(get("inbox", "owner=yes"))).items.some((notice) => notice.type === "mention"));
  assert.deepEqual((await json(get(`topics/${id}`, "reader=r2"))).mentions, { 远山: "u2", 無相: "owner" });
  await post(`topics/${id}/replies`, { body: "@林间 我试试这个办法" }, "reader=r2");
  assert.deepEqual((await json(get("inbox?tab=reply"))).items.map((notice) => notice.type), ["reply"], "the topic's author is told once");
  assert.deepEqual((await json(get("me", "reader=r2"))).unread, { all: 1, reply: 1, thanks: 0, system: 0 });
  assert.deepEqual(await json(post("inbox/read-all", {}, "reader=r2")), { read: 1 });
  assert.equal((await json(get("me", "reader=r2"))).unread.all, 0);
  assert.equal((await post("inbox/read", { id: "missing" })).status, 404);
  const notice = (await json(get("inbox"))).items[0];
  assert.deepEqual(await json(post("inbox/read", { id: notice.id })), { ok: true });

  assert.deepEqual(await json(post("members/u1/follow", { on: true }, "reader=r2")), { following: true, followers: 1 });
  assert.equal((await post("members/u2/follow", { on: true }, "reader=r2")).status, 400, "not yourself");
  assert.equal((await post("members/nobody/follow", { on: true }, "reader=r2")).status, 404);
  assert.equal((await json(get("inbox?tab=system"))).items[0].type, "follow");
  const page = await json(get("members/u1", "reader=r2"));
  assert.deepEqual([page.person.name, page.bio, page.following, page.follows, page.self, page.quick, page.canMute], ["林间", "喜欢画画", true, { followers: 1, following: 0 }, false, null, false]);
  assert.deepEqual([page.counts.topics, page.topics.map((x) => x.id)], [1, [id]]);
  const replies = await json(get("members/u2?tab=replies"));
  assert.deepEqual(replies.replies.map((reply) => reply.topicTitle), ["ComfyUI 人脸崩了"]);
  const self = await json(get("members/u1?tab=bookmarks"));
  assert.deepEqual([self.self, self.quick.balance, self.bookmarks], [true, 2, []]);
  assert.deepEqual([(await json(get("members/owner"))).person.name, (await json(get("members/owner"))).joinedAt], ["無相", null]);
});

test("following sort filters to followed authors and does not create post notifications", async (t) => {
  const { get, post } = await setup(t);
  const own = await json(post("topics", { ...topicBody, title: "自己的主题" }, "reader=r1"));
  await post("members/u1/follow", { on: true }, "reader=r2");
  const followed = await json(post("topics", { ...topicBody, title: "关注者的主题" }, "reader=r1"));
  await post("topics", { ...topicBody, title: "别人的主题" }, "reader=r3");
  const listing = await json(get("topics?sort=following", "reader=r2"));
  assert.deepEqual(listing.items.map((item) => item.title), ["关注者的主题", "自己的主题"]);
  assert.equal((await json(get("topics?sort=following", "reader=r3"))).total, 0);
  assert.equal((await json(get("inbox?tab=system", "reader=r2"))).items.some((notice) => notice.topicId === followed.id), false);
  assert.notEqual(own.id, followed.id);
});

test("owner cannot check in or make up, and owner content is absent from every ranking", async (t) => {
  const { get, post } = await setup(t);
  assert.equal((await post("checkin", {}, "owner=yes")).status, 403);
  assert.match((await (await post("checkin", {}, "owner=yes")).json()).error, /站长不参与签到/);
  assert.equal((await post("checkin/makeup", { day: "2026-09-29" }, "owner=yes")).status, 403);
  await post("checkin", {}, "reader=r1");
  const rank = await json(get("rank", "owner=yes"));
  assert.equal(rank.streaks.some((entry) => entry.person.role === "owner"), false);
  assert.equal(rank.early.some((entry) => entry.person.role === "owner"), false);
  assert.equal(rank.contributions.some((entry) => entry.person.role === "owner"), false);
});

test("review rejection requires a fixed reason and records the appeal notice and audit", async (t) => {
  const { get, post, audits } = await setup(t);
  const pending = await json(post("topics", { board: "qa", title: "带外链的待审主题", body: "请看 https://example.com/guide", agree: true }, "reader=r3"));
  assert.equal(pending.pending, true);
  assert.equal((await json(get("me", "owner=yes"))).manageTodo, 1, "the owner menu count includes pending review work");
  assert.equal((await post(`manage/topics/${pending.id}/reject`, { reason: "随便写" }, "owner=yes")).status, 400);
  assert.equal((await post(`manage/topics/${pending.id}/reject`, { reason: "广告引流", note: "补充说明" }, "owner=yes")).status, 200);
  const notices = await json(get("inbox?tab=system", "reader=r3"));
  assert.match(notices.items[0].text, /广告引流/);
  assert.match(notices.items[0].link, /community\/boards\/meta/);
  assert.deepEqual([audits.at(-1).action, audits.at(-1).reason, audits.at(-1).note], ["community-reject-topic", "广告引流", "补充说明"]);
});

test("a steward can reject a pending topic and the audit names the steward", async (t) => {
  const { get, post, audits } = await setup(t);
  const pending = await json(post("topics", { board: "qa", title: "协管待审主题", body: "请看 https://example.com/steward", agree: true }, "reader=r3"));
  await post("members/u5/steward", { on: true,role:"general", boards: allModerationBoards,permissions:communityLegacyStaffPermissions,delegable:[] }, "owner=yes");
  const rejected = await post(`manage/topics/${pending.id}/reject`, { reason: "与版块无关", note: "请换到工具资源版块" }, "reader=s1");
  assert.equal(rejected.status, 200);
  const notice = (await json(get("inbox?tab=system", "reader=r3"))).items[0];
  assert.deepEqual([notice.data.title, notice.data.reason, notice.data.note, notice.link], ["协管待审主题", "与版块无关", "请换到工具资源版块", "#/community/boards/meta"]);
  assert.deepEqual([audits.at(-1).action, audits.at(-1).actor, audits.at(-1).reason], ["community-reject-topic", "reader:s1", "与版块无关"]);
});

test("withdrawing a pending post is silent for its author but audited and notified when moderated", async (t) => {
  const { get, post, audits } = await setup(t);
  const own = await json(post("topics", { board: "qa", title: "作者撤回的待审主题", body: "https://example.com/own", agree: true }, "reader=r3"));
  assert.equal((await post(`topics/${own.id}/delete`, {}, "reader=r3")).status, 200);
  const ownNotices = (await json(get("inbox?tab=system", "reader=r3"))).items;
  assert.equal(ownNotices.some((item) => /没有通过审核/.test(item.text)), false, "author withdrawal does not send rejection notice");
  const managed = await json(post("topics", { board: "qa", title: "管理员删除的待审主题", body: "https://example.com/managed", agree: true }, "reader=r3"));
  assert.equal((await post(`topics/${managed.id}/delete`, { reason: "广告引流", note: "审核示例" }, "owner=yes")).status, 200);
  const notice = (await json(get("inbox?tab=system", "reader=r3"))).items.find((item) => /没有通过审核/.test(item.text));
  assert.ok(notice);
  assert.match(notice.text, /没有通过审核/);
  assert.equal(notice.data.reason, "广告引流");
  assert.deepEqual([audits.at(-1).action, audits.at(-1).reason, audits.at(-1).note], ["community-delete-topic", "广告引流", "审核示例"]);
});

test("shipping company and tracking number survive resolution while recipient PII is removed", async (t) => {
  const { get, post, credit } = await setup(t);
  const item = await json(post("manage/items", { cat: "goods", name: "快递演示袋", description: "一个用于演示的帆布袋", price: 1, stock: 1 }, "owner=yes"));
  // The fixture account has enough balance for this small order.
  credit("r1", 5);
  const order = await json(post("shop/redeem", { item: item.id, shipping: { name: "林间", phone: "13800138000", address: "浙江省杭州市西湖区某路 1 号" } }));
  assert.equal((await post(`manage/orders/${order.order}/ship`, { company: "顺丰", tracking: "SF123456" }, "owner=yes")).status, 200);
  const mine = await json(get("shop/mine"));
  assert.deepEqual(mine.orders.find((row) => row.id === order.order).tracking, { company: "顺丰", number: "SF123456" });
  const notice = (await json(get("inbox?tab=system"))).items.find((row) => row.data.order === "shipped");
  assert.equal(notice.data.tracking, "SF123456");
  const managed = await json(get("manage?tab=orders", "owner=yes"));
  assert.equal(managed.orders.find((row) => row.id === order.order).shipping, null);
  assert.deepEqual(managed.orders.find((row) => row.id === order.order).tracking, { company: "顺丰", number: "SF123456" });
});

test("public post people keep a linkable UID while display follows viewer permissions", async (t) => {
  const { get, post } = await setup(t);
  const { id } = await json(post("topics", topicBody, "reader=r1"));
  await post("members/u5/steward", { on: true,role:"general", boards: allModerationBoards,permissions:communityLegacyStaffPermissions,delegable:[] }, "owner=yes");
  assert.deepEqual((await json(get(`topics/${id}`, "reader=r2"))).topic.author, { name: "林间", role: "reader", uid: "u1", showUid: false, avatar: `/api/community/avatar/u1.webp?v=${avatarId}`, vip: false, level: 1, growth: emptyGrowth, vipGrowth: emptyVIPGrowth, steward: false,staffRole:null, icon:null, frame: null, color: null });
  assert.equal((await json(get(`topics/${id}`, "reader=r1"))).topic.author.showUid, true);
  assert.equal((await json(get(`topics/${id}`, "reader=s1"))).topic.author.showUid, true);
  assert.equal((await json(get("me", "reader=r1"))).uid, "u1");
});

test("the shop: prices and states, decorations, goods with shipping details for the owner only, and digital items", async (t) => {
  const { get, post, credit } = await setup(t);
  const shop = await json(get("shop"));
  assert.equal(shop.items.find((item) => item.id === "frame-gold").state.code, "short");
  assert.equal((await json(get("shop", "reader=r3"))).items.find((item) => item.id === "card-pin").state.code, "level");
  credit("r1", 500);
  assert.equal((await json(post("shop/redeem", { item: "frame-gold" }))).balance, 420);
  assert.equal((await json(get("stardust"))).ledger[0].detail, "金环头像框", "the ledger names what was redeemed");
  assert.equal((await json(get("me"))).frame, "gold", "a new frame is worn at once");
  assert.equal((await json(post("shop/equip", { kind: "frame", ref: null }))).frame, null);
  assert.equal((await post("shop/equip", { kind: "frame", ref: "nebula" })).status, 403);
  assert.equal((await post("shop/redeem", { item: "nothing" })).status, 404);

  assert.equal((await post("manage/items", { cat: "goods", name: "帆布袋", description: "一个帆布袋子", price: 100, stock: 2 })).status, 403);
  assert.equal((await post("manage/items", { cat: "goods", name: "帆布袋", description: "一个帆布袋子", price: 100 }, "owner=yes")).status, 400, "goods need stock");
  const bag = await json(post("manage/items", { cat: "goods", name: "帆布袋", description: "一个帆布袋子", price: 100, stock: 2 }, "owner=yes"));
  assert.match((await (await post("shop/redeem", { item: bag.id })).json()).error, /手机号/);
  assert.equal((await post("shop/redeem", { item: bag.id, shipping: { name: "林间", phone: "138 0013 8000", address: "短" } })).status, 400);
  const shipping = { name: "林间", phone: "138 0013 8000", address: "浙江省杭州市西湖区某路 1 号" };
  const order = await json(post("shop/redeem", { item: bag.id, shipping }));
  assert.ok((await json(get("inbox", "owner=yes"))).items.some((notice) => notice.data.order === "new"));
  const orders = await json(get("manage?tab=orders", "owner=yes"));
  assert.deepEqual([orders.counts.orders, orders.orders[0].member.name, orders.orders[0].shipping], [1, "林间", { ...shipping, phone: "13800138000" }]);
  assert.equal((await json(get("shop/mine"))).orders.find((row) => row.id === order.order).shipping, undefined, "the member's own list has no address");
  assert.equal((await post(`manage/orders/${order.order}/ship`, {}, "owner=yes")).status, 200);
  assert.equal((await json(get("manage?tab=orders", "owner=yes"))).orders[0].shipping, null, "shipping details are deleted once shipped");
  assert.equal((await post(`manage/orders/${order.order}/ship`, {}, "owner=yes")).status, 409);
  assert.ok((await json(get("inbox?tab=system"))).items.some((notice) => notice.data.order === "shipped"));

  assert.equal((await post("manage/items", { cat: "digital", name: "提示词手册", description: "一份提示词手册", price: 20 }, "owner=yes")).status, 400, "digital items need their content");
  const pack = await json(post("manage/items", { cat: "digital", name: "提示词手册", description: "一份提示词手册", price: 20, delivery: "链接 https://example.com 提取码 abcd" }, "owner=yes"));
  assert.equal((await get(`shop/items/${pack.id}/delivery`)).status, 403);
  assert.equal((await json(get("shop"))).items.find((item) => item.id === pack.id).delivery, undefined, "the shop never lists the content");
  await post("shop/redeem", { item: pack.id });
  assert.match((await json(get(`shop/items/${pack.id}/delivery`))).delivery, /提取码 abcd/);
  const mine = await json(get("shop/mine"));
  assert.deepEqual([mine.looks.map((item) => item.id), mine.digital.map((item) => item.id), mine.orders.length], [["frame-gold"], [pack.id], 3]);
  assert.equal((await json(get("manage?tab=items", "owner=yes"))).items.length, 2);
});

test("stewards, mutes, moderated deletions, tag edits and the audit log", async (t) => {
  const { get, post, audits } = await setup(t);
  assert.equal((await post("members/u5/steward", { on: true })).status, 403, "only the owner appoints");
  assert.equal((await json(post("members/u5/steward", { on: true,role:"general", boards: allModerationBoards,permissions:communityLegacyStaffPermissions,delegable:[] }, "owner=yes"))).staff.role,"general");
  assert.deepEqual([(await json(get("me", "reader=s1"))).mod, (await json(get("me", "reader=s1"))).level], [true, 3]);
  assert.equal((await get("manage", "reader=s1")).status, 200);
  assert.equal((await get("manage?tab=items", "reader=s1")).status, 200, "an active general can manage shop products");
  assert.equal((await get("manage?tab=orders", "reader=s1")).status, 403);

  const { id } = await json(post("topics", topicBody));
  const reply = await json(post(`topics/${id}/replies`, { body: "这是一条违规的回复内容" }, "reader=r2"));
  assert.equal((await post(`topics/${id}/pin`, { on: true }, "reader=s1")).status, 200);
  assert.equal((await post(`topics/${id}/feature`, { on: true }, "reader=s1")).status, 403, "精华 is the owner's");
  assert.equal((await post(`topics/${id}/retag`, { tags: ["效率"] })).status, 403, "巡天 cannot retag");
  assert.equal((await post(`topics/${id}/retag`, { tags: ["效率"] }, "reader=s1")).status, 200);
  assert.deepEqual((await json(get(`topics/${id}`))).topic.tags, ["效率"]);
  assert.equal((await post(`replies/${reply.id}/delete`, { reason: "违规回复处理" }, "reader=s1")).status, 200);
  assert.equal((await json(get("inbox?tab=system", "reader=r2"))).items[0].type, "penalty");
  assert.equal((await post(`topics/${id}/delete`, { mute: 7, reason: "违规内容处理" }, "reader=s1")).status, 200);
  const muted = await post("topics", topicBody);
  assert.equal(muted.status, 403);
  assert.match((await muted.json()).error, /禁言/);
  assert.equal((await json(get("me"))).muted.reason, "发布违规内容");
  const sanctions = await json(get("manage?tab=sanctions", "reader=s1"));
  assert.equal(sanctions.sanctions[0].member.name, "林间");
  assert.equal((await post(`manage/sanctions/${sanctions.sanctions[0].id}/lift`, {}, "reader=s1")).status, 200);
  assert.equal((await post(`manage/sanctions/${sanctions.sanctions[0].id}/lift`, {}, "reader=s1")).status, 409);
  assert.equal((await post("topics", topicBody)).status, 201, "lifted");

  assert.equal((await post("members/u2/mute", { days: 2, reason: "人身攻击" }, "reader=s1")).status, 400);
  assert.equal((await post("members/u2/mute", { days: 1, reason: "人身攻击" })).status, 403);
  assert.equal((await post("members/owner/mute", { days: 1, reason: "人身攻击" }, "reader=s1")).status, 403);
  assert.equal((await post("members/u2/mute", { days: 1, reason: "人身攻击" }, "reader=s1")).status, 200);
  assert.equal((await post("topics", { board: "moments", body: "我被禁言了吗？试试看" }, "reader=r2")).status, 403);
  assert.equal((await json(get("members/u2", "reader=s1"))).muted.reason, "人身攻击");
  assert.deepEqual(audits.map((entry) => entry.action), [
    "community-staff-appointment", "community-pin", "community-retag", "community-delete-reply", "community-delete-topic", "community-lift", "community-mute",
  ]);
  assert.equal(audits[4].mute, 7);
  const other = await json(post("topics", topicBody, "reader=v1"));
  const noisy = await json(post(`topics/${other.id}/replies`, { body: "刷屏刷屏刷屏" }, "reader=r3"));
  assert.equal((await post(`replies/${noisy.id}/delete`, { mute: 30, reason: "违规回复处理" }, "reader=s1")).status, 200);
  assert.equal((await json(get("me", "reader=r3"))).muted.reason, "发布违规内容", "deleting a reply can mute its author too");
  assert.deepEqual([audits.at(-1).action, audits.at(-1).mute], ["community-delete-reply", 30]);
});

test("prompts, unlocks, resource votes, bounties, paid pins and highlights through the API", async (t) => {
  const { get, post, upload, credit } = await setup(t);
  const bytes = await png();
  const image = await json(upload(bytes));
  const work = { board: "showcase", title: "水彩猫咪", body: "", images: [image.id], tools: "Midjourney", model: "v7", usage: "可商用" };
  assert.equal((await post("topics", { ...work, prompt: "a cat, watercolor", promptMode: "paid", promptPrice: 60 })).status, 400, "unlock prices are 5 to 50");
  const { id } = await json(post("topics", { ...work, prompt: "a cat, watercolor", promptMode: "paid", promptPrice: 10 }));
  const locked = await json(get(`topics/${id}`, "reader=r2"));
  assert.equal(Object.hasOwn(locked.topic, "fullMeta"), false, "internal metadata must not bypass prompt payment");
  assert.equal(JSON.stringify(locked).includes("a cat, watercolor"), false, "the complete locked response must not contain the paid prompt");
  assert.deepEqual(locked.topic.meta, { tools: "Midjourney", model: "v7", usage: "可商用", promptMode: "paid", price: 10, prompt: null, preview: "x xxx, xxxxxxxxxx", unlocked: false, unlocks: 0 });
  assert.equal((await json(get(`topics/${id}`))).topic.meta.prompt, "a cat, watercolor", "the author always sees it");
  assert.equal((await post(`topics/${id}/unlock`, {}, "reader=r2")).status, 402);
  credit("r2", 50);
  assert.deepEqual(await json(post(`topics/${id}/unlock`, {}, "reader=r2")), { share: 8, balance: 40 });
  assert.equal((await json(get(`topics/${id}`, "reader=r2"))).topic.meta.prompt, "a cat, watercolor");
  assert.equal((await post(`topics/${id}/unlock`, {})).status, 400, "not your own");
  assert.ok((await json(get("inbox?tab=thanks"))).items.some((notice) => notice.type === "unlock"));
  const other = await json(upload(bytes, "image/png", "reader=v1"));
  const hidden = await json(post("topics", { ...work, images: [other.id], promptMode: "public" }, "reader=v1"));
  assert.equal((await json(get(`topics/${hidden.id}`))).topic.meta.promptMode, "hidden", "no prompt means not shared");

  const tool = await json(post("topics", { board: "tools", title: "一个好用的抠图网站", body: "", url: "https://example.com/app", kind: "网站", price: "部分免费", platform: "Web" }, "reader=r2"));
  assert.deepEqual(await json(post(`topics/${tool.id}/vote`, { value: "dead" })), { vote: "dead", alive: 0, dead: 1 });
  assert.deepEqual((await json(get(`topics/${tool.id}`))).topic.resource, { url: "https://example.com/app", kind: "网站", price: "部分免费", platform: "Web", alive: 0, dead: 1, myVote: "dead" });
  assert.equal((await post(`topics/${id}/vote`, { value: "dead" })).status, 404, "only resources take votes");

  assert.equal((await post("topics", { ...topicBody, bounty: 20 })).status, 402, "a bounty is paid up front");
  credit("r1", 100);
  const question = await json(post("topics", { ...topicBody, bounty: 20 }));
  assert.deepEqual((await json(get("topics?board=qa"))).items.map((x) => [x.id, x.bounty, x.bountyState]), [[question.id, 20, "open"]]);

  assert.equal((await post(`topics/${tool.id}/paid-pin`, {})).status, 403, "only your own topic");
  assert.equal((await post(`topics/${tool.id}/paid-pin`, {}, "reader=r2")).status, 402);
  credit("r2", 200);
  assert.equal((await json(post(`topics/${tool.id}/paid-pin`, {}, "reader=r2"))).card, false);
  const pinned = (await json(get("topics?board=tools"))).items[0];
  assert.deepEqual([pinned.id, pinned.paidPin, pinned.pinned], [tool.id, true, false]);
  assert.equal((await post(`topics/${tool.id}/highlight`, {}, "reader=r2")).status, 402, "a highlight needs a card");
  credit("r2", 100);
  assert.equal((await post("shop/redeem", { item: "card-highlight" }, "reader=r2")).status, 201);
  assert.equal((await post(`topics/${tool.id}/highlight`, {}, "reader=r2")).status, 200);
  assert.equal((await json(get("topics?board=tools"))).items[0].glow, true);
});

test("make-up check-ins, the 星尘 center, rankings and avatars", async (t) => {
  const { get, post, credit, siteOrigin } = await setup(t);
  assert.equal((await json(post("checkin", {}))).streak, 1);
  const board = await json(get("checkin"));
  assert.deepEqual([board.makeup.days.length, board.makeup.left, board.makeup.cost], [7, 2, 30]);
  assert.equal((await post("checkin/makeup", { day: board.makeup.days[0] })).status, 402);
  credit("r1", 100);
  assert.deepEqual(await json(post("checkin/makeup", { day: board.makeup.days[0] })), { streak: 2, cost: "stardust", bonus: 0, balance: 71 });
  assert.equal((await post("checkin/makeup", { day: "2020-01-01" })).status, 400);

  const stardust = await json(get("stardust"));
  assert.deepEqual([stardust.balance, stardust.level, stardust.progress.next], [71, 1, 2]);
  assert.deepEqual(stardust.ledger.map((row) => row.reason), ["makeup", "test", "checkin"]);
  assert.equal(stardust.ledger[0].detail, board.makeup.days[0], "a make-up names its day");
  assert.deepEqual((await json(get("stardust?flow=out"))).ledger.map((row) => row.amount), [-30]);

  const rank = await json(get("rank"));
  assert.deepEqual(rank.streaks.map((entry) => [entry.person.name, entry.streak]), [["林间", 2]]);
  assert.deepEqual(rank.early.map((entry) => entry.person.name), ["林间"]);
  assert.deepEqual(rank.contributions, []);

  const avatar = await get("avatar/u1.webp", "reader=r2");
  assert.deepEqual([avatar.status, avatar.headers.get("content-type"), await avatar.text()], [200, "image/webp", "avatar-bytes"]);
  assert.equal((await get("avatar/u2.webp", "reader=r2")).status, 404, "no approved avatar");
  assert.equal((await fetch(`${siteOrigin}/api/community/avatar/u1.webp`)).status, 401, "members only");
});
