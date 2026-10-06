import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import type { CommunityProfileAccess } from '../server/community-profile-access.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const ownerPersonalId = 'ffffffff-ffff-4fff-8fff-fffffffffff8';
const ownerPersonalCookie = 'owner; community_browse=reader';

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-background-http-'));
  new DatabaseSync(resolve(directory, 'content.db')).close(); await migrateCommunity(directory); await mkdir(resolve(directory, 'uploads'));
  const store = createCommunityStore(directory);
  const users = new Map([['10001', 'reader'], ['10002', 'other'], ['10003', 'mod'], ['10008', ownerPersonalId]]);
  acceptCommunityConvention(store, [{ kind: 'owner', id: 'owner' }, ...[...users.values()].map(id => ({ kind: 'reader' as const, id }))]);
  store.members.setSteward({ kind: 'reader', id: 'mod' }, true, ['qa']);
  const pendingOnly = async () => { throw Object.assign(Error('No test avatar'), { status: 404 }); };
  const state = async (req: { headers: { cookie?: string } }) => {
    const cookie = String(req.headers.cookie || '');
    const principal = cookie.split(';')[0];
    const id = principal === 'owner' && /(?:^|;\s*)community_browse=reader(?:;|$)/.test(cookie) ? ownerPersonalId : principal;
    return { id, uid: [...users].find(([, name]) => name === id)?.[0] || null, nickname: id, signature: '已审核个签', avatar: null, pendingSignature: null, pendingAvatar: false };
  };
  const profile: CommunityProfileAccess = { state, signature: state, avatar: state, removeAvatar: state, pendingAvatar: pendingOnly, reviewImage: pendingOnly, review: pendingOnly, reviews: async () => [] };
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const audits: Array<{ action: string; details: Record<string, unknown> }> = [];
  service = createCommunityService({ store, directory, siteOrigin: origin, profile,
    ownerReaderIdentity: async req => String(req.headers.cookie || '').split(';')[0] === 'owner'
      ? { kind: 'reader', id: ownerPersonalId, name: '站长个人', vip: false } : null,
    identify: async req => { const id = String(req.headers.cookie || '').split(';')[0]; return id === 'owner' || [...users.values()].includes(id) ? { kind: id === 'owner' ? 'owner' : 'reader', id, name: id, vip: false } : null; },
    people: async authors => new Map(authors.map(member => [`${member.kind}:${member.id}`, { name: member.id, uid: member.kind === 'owner' ? 'owner' : [...users].find(([, id]) => id === member.id)?.[0] || null, avatar: null, vip: false, joinedAt: '2026-01-01T00:00:00.000Z', bio: '已审核个签' }])),
    findMember: async uid => users.has(uid) ? { kind: 'reader', id: users.get(uid)! } : null,
    audit: async (action, details) => { audits.push({ action, details }); },
  });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const get = (path: string, as = 'reader') => fetch(`${origin}/api/community/${path}`, { headers: { cookie: as } });
  const post = (path: string, body: unknown, as = 'reader', validOrigin = true) => fetch(`${origin}/api/community/${path}`, { method: 'POST', headers: { cookie: as, origin: validOrigin ? origin : 'https://outside.invalid', 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const upload = (bytes: Buffer, type = 'image/png', as = 'reader') => { const body = new FormData(); body.set('file', new Blob([new Uint8Array(bytes)], { type }), 'background.png'); return fetch(`${origin}/api/community/profile/background`, { method: 'POST', headers: { cookie: as, origin, 'X-Reader-Request': '1' }, body }); };
  const png = () => sharp({ create: { width: 2800, height: 1000, channels: 3, background: '#315a74' } }).png().toBuffer();
  return { directory, store, get, post, upload, png, audits };
}

test('profile background upload is re-encoded and pending images are private to owner and author identity', async t => {
  const { directory, get, upload, png, post } = await fixture(t);
  const response = await upload(await png()); assert.equal(response.status, 200);
  const profile = await response.json(), pending = profile.background.pending;
  assert.equal(profile.background.approved, null); assert.ok(pending.id);
  assert.equal(pending.url, `/api/community/images/${pending.id}.webp`);
  const metadata = await sharp(await readFile(resolve(directory, 'uploads', `community-image-${pending.id}.webp`))).metadata();
  assert.equal(metadata.format, 'webp'); assert.ok((metadata.width || 0) <= 2048);
  const path = pending.url.slice('/api/community/'.length);
  assert.equal((await get(path)).status, 200);
  assert.equal((await get(path, 'owner')).status, 200);
  assert.equal((await get(path, 'other')).status, 404);
  assert.equal((await get(path, 'mod')).status, 404);
  assert.equal((await get(path, 'owner; community_browse=reader')).status, 404);
  assert.equal((await get(path, '')).status, 401);
  const member = await (await get('members/10001', 'other')).json();
  assert.equal(member.background, null); assert.ok(!JSON.stringify(member).includes(pending.id));
  const moderation = await (await get('manage?tab=profiles', 'mod')).json(); assert.deepEqual(moderation.backgrounds, []);
  assert.equal((await post('manage/profile-background', { memberUid: '10001', imageId: pending.id, approve: true, reason: '' }, 'mod')).status, 403);
  assert.equal((await post('manage/profile-background', { memberUid: '10001', imageId: pending.id, approve: true, reason: '' }, 'owner')).status, 200);
  assert.equal((await get(path, 'other')).status, 200);
  assert.equal((await (await get('members/10001', 'other')).json()).background.id, pending.id);
});

test('the latest expected background review wins; rejected replacement retains approved image and reset cancels pending', async t => {
  const { get, upload, png, post, audits } = await fixture(t);
  const first = (await (await upload(await png())).json()).background.pending;
  assert.equal((await post('manage/profile-background', { memberUid: '10001', imageId: first.id, approve: true, reason: '' }, 'owner')).status, 200);
  const next = (await (await upload(await png())).json()).background.pending;
  const third = (await (await upload(await png())).json()).background.pending;
  assert.equal((await post('manage/profile-background', { memberUid: '10001', imageId: next.id, approve: true, reason: '' }, 'owner')).status, 409);
  assert.equal((await post('manage/profile-background', { memberUid: '10001', imageId: third.id, approve: false, reason: '' }, 'owner')).status, 400);
  assert.equal((await post('manage/profile-background', { memberUid: '10001', imageId: third.id, approve: false, reason: '背景内容不适合公开' }, 'owner')).status, 200);
  const after = await (await get('profile')).json(); assert.equal(after.background.approved.id, first.id); assert.equal(after.background.pending, null);
  await upload(await png());
  assert.equal((await post('profile/background/remove', {})).status, 200);
  assert.deepEqual((await (await get('profile')).json()).background, { approved: null, pending: null });
  assert.equal((await get(first.url.slice('/api/community/'.length), 'other')).status, 404);
  assert.ok(audits.some(item => item.action === 'community-profile-background-review'));
});

test('profile background writes require self-reader identity and correct origin, with bounded valid raster uploads', async t => {
  const { directory, upload, png, post, get, store } = await fixture(t);
  assert.equal((await upload(await png(), 'image/png', 'owner')).status, 403);
  assert.equal((await post('profile/background/remove', {}, 'reader', false)).status, 403);
  assert.equal((await post('profile/background/remove', { readerId: 'other' })).status, 400);
  assert.equal((await upload(Buffer.from('<svg/>'), 'image/svg+xml')).status, 415);
  assert.equal((await upload(Buffer.from('not a PNG'), 'image/png')).status, 400);
  assert.equal((await upload(Buffer.concat([await png(), Buffer.alloc(2 * 1024 * 1024)]))).status, 413);
  assert.deepEqual((await (await get('profile')).json()).background, { approved: null, pending: null });
  assert.deepEqual(await readdir(resolve(directory, 'uploads')), []);
  assert.equal(store.profileBackgrounds.pending().length, 0);
});

test('the owner personal reader may submit its own background without exposing other pending backgrounds or retaining management power', async t => {
  const { get, upload, png, post, store } = await fixture(t);
  const otherPending = (await (await upload(await png())).json()).background.pending;
  const response = await upload(await png(), 'image/png', ownerPersonalCookie);
  assert.equal(response.status, 200);
  const profile = await response.json(), pending = profile.background.pending;
  assert.equal(profile.person.uid, '10008'); assert.equal(profile.canEditProfile, true);
  assert.equal(profile.person.role, 'reader'); assert.equal(profile.background.approved, null);
  assert.equal(store.profileBackgrounds.state({ kind: 'reader', id: ownerPersonalId }).pending?.id, pending.id);
  assert.equal(store.profileBackgrounds.state({ kind: 'owner', id: 'owner' }).pending, null, 'personal changes never alter the brand background');
  const path = pending.url.slice('/api/community/'.length);
  assert.equal((await get(path, ownerPersonalCookie)).status, 200);
  assert.equal((await get(otherPending.url.slice('/api/community/'.length), ownerPersonalCookie)).status, 404);
  assert.equal((await get(path, 'reader')).status, 404);
  assert.equal((await get(path, 'owner')).status, 200);
  assert.equal((await post('manage/profile-background', { memberUid: '10008', imageId: pending.id, approve: true, reason: '' }, ownerPersonalCookie)).status, 403);
  assert.equal((await post('manage/profile-background', { memberUid: '10008', imageId: pending.id, approve: true, reason: '' }, 'owner')).status, 200);
  assert.equal((await get(path, 'reader')).status, 200);
  assert.equal((await (await get('members/10008', 'reader')).json()).background.id, pending.id);
});

test('switching between published and personal backgrounds uses one current choice and reset clears the selected cover', async t => {
  const { store, get, post, upload, png } = await fixture(t), member = { kind: 'reader' as const, id: 'reader' };
  const id = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
  store.addImage({ id, uploader: { kind: 'owner', id: 'owner' }, width: 640, height: 320, purpose: 'shop' });
  const item = store.economy.saveItem(null, { cat: 'look', kind: 'cover', name: '正式上架背景', description: '正式作者审核并上架的主页背景', price: 20, stock: null, limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '', image: id, note: '', active: true });
  store.ledger.credit(member, 100, 'test', null, new Date().toISOString());
  const ref = `image:${id}`;
  assert.equal((await post('shop/redeem', { item })).status, 201);
  let state = await (await get('profile')).json();
  assert.equal(state.cover, ref); assert.equal(state.coverName, '正式上架背景'); assert.equal(state.background.approved, null);
  const pending = (await (await upload(await png())).json()).background.pending;
  state = await (await get('profile')).json();
  assert.equal(state.cover, ref, 'pending replacement does not change the current owned background');
  assert.equal((await post('manage/profile-background', { memberUid: '10001', imageId: pending.id, approve: false, reason: '请换一张合适的图片' }, 'owner')).status, 200);
  assert.equal((await (await get('profile')).json()).cover, ref, 'rejection keeps the selected owned background');
  const replacement = (await (await upload(await png())).json()).background.pending;
  assert.equal((await post('manage/profile-background', { memberUid: '10001', imageId: replacement.id, approve: true, reason: '' }, 'owner')).status, 200);
  state = await (await get('profile')).json(); assert.equal(state.cover, null); assert.equal(state.background.approved.id, replacement.id);
  assert.equal((await post('shop/equip', { kind: 'cover', ref: 'image:../../outside' })).status, 403);
  for (const ref of [undefined, false, 0, [], {}]) assert.equal((await post('shop/equip', { kind: 'cover', ref })).status, 400);
  assert.equal((await (await get('profile')).json()).background.approved.id, replacement.id, 'rejected equip cannot clear the current personal background');
  assert.equal((await post('shop/equip', { kind: 'cover', ref: null })).status, 200);
  assert.deepEqual((await (await get('profile')).json()).background, { approved: null, pending: null }, 'restoring the default is the same single-background action from owned inventory');
  const again = (await (await upload(await png())).json()).background.pending;
  assert.equal((await post('manage/profile-background', { memberUid: '10001', imageId: again.id, approve: true, reason: '' }, 'owner')).status, 200);
  assert.equal((await post('shop/equip', { kind: 'cover', ref })).status, 200);
  state = await (await get('profile')).json(); assert.equal(state.cover, ref); assert.deepEqual(state.background, { approved: null, pending: null });
  assert.equal((await post('profile/background/remove', {})).status, 200);
  state = await (await get('profile')).json(); assert.equal(state.cover, null); assert.equal(state.coverImage, null); assert.equal(state.coverName, null);
  assert.deepEqual(state.background, { approved: null, pending: null });
  assert.ok(store.economy.owned(member).has(item), 'restoring the default retains the purchased background in owned inventory');
});
