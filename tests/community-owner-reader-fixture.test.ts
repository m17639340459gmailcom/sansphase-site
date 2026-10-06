import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createCommunityDemo } from '../scripts/fixtures/community-demo.mjs';

test('local preview performs owner personal editing and approval through real services while preserving the public brand', { timeout: 40000 }, async t => {
  const demo = await createCommunityDemo();
  let community: ReturnType<typeof demo.service>, reader: ReturnType<typeof demo.readerService>;
  const server = createServer((req, res) => { void (String(req.url).startsWith('/api/reader/') ? reader.handle(req, res)
    : String(req.url).startsWith('/api/author/') ? demo.authorService.handle(req, res) : community.handle(req, res)); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port, origin = `http://127.0.0.1:${port}`;
  community = demo.service(port); reader = demo.readerService(port);
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); demo.close(); });
  const ownerCookie = 'preview_as=owner', personalCookie = ownerCookie + '; community_browse=reader';
  const get = (path: string, cookie = personalCookie) => fetch(origin + path, { headers: { cookie } });
  const post = (path: string, value: unknown, cookie = personalCookie, requestOrigin = origin) => fetch(origin + path, {
    method: 'POST', headers: { Cookie: cookie, Origin: requestOrigin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  const brand = await (await get('/api/author/session', ownerCookie)).json();
  assert.equal(brand.name, '無相');
  let response = await post('/api/community/browse-mode', { reader: true }, ownerCookie);
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie') || '', /community_browse=reader/);
  const me = await (await get('/api/community/me')).json();
  assert.equal(me.uid, '10008'); assert.equal(me.role, 'reader'); assert.equal(me.owner, false); assert.equal(me.mod, false);
  assert.deepEqual(me.management, { role: 'owner', browsingAsReader: true, interactive: true });
  assert.equal(me.balance, 0); assert.deepEqual(me.inventory, { makeup: 0, pin: 0, highlight: 0 });
  const stardust = await (await get('/api/community/stardust')).json(); assert.equal(stardust.balance, 0); assert.deepEqual(stardust.ledger, []);
  assert.equal((await get('/api/community/manage?tab=profiles')).status, 403);
  const profile = await (await get('/api/community/profile')).json(); assert.equal(profile.canEditProfile, true); assert.equal(profile.person.uid, '10008');
  assert.equal((await post('/api/community/browse-mode', { reader: true }, 'preview_as=demo')).status, 403, 'the mode cookie alone never grants owner delegation');
  const forged = await (await get('/api/community/me', 'preview_as=demo; community_browse=reader')).json(); assert.equal(forged.uid, '10001'); assert.equal(forged.management, null);
  assert.equal((await post('/api/community/profile', { signature: 'wrong origin' }, personalCookie, 'https://outside.example')).status, 403);

  // Complete the real server-side reading interval for both identities instead
  // of inventing consent or disabling the posting guard in the demo adapter.
  const convention = await (await get('/api/community/convention')).json();
  for (const cookie of [ownerCookie, personalCookie]) assert.equal((await post('/api/community/convention/read', { version: convention.version }, cookie)).status, 200);
  await new Promise<void>(done => setTimeout(done, 10050));
  for (const cookie of [ownerCookie, personalCookie]) assert.equal((await post('/api/community/agree', { version: convention.version }, cookie)).status, 200);
  assert.equal((await post('/api/community/profile', { signature: '我自己的个人签名', readerId: 'demo' })).status, 400);
  response = await post('/api/community/profile', { signature: '我自己的个人签名' }); assert.equal(response.status, 200);
  assert.equal((await response.json()).pendingSignature, '我自己的个人签名');
  const png = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#aabbdd' } }).png().toBuffer();
  const form = new FormData(); form.set('file', new Blob([png], { type: 'image/png' }), 'owner-personal.png');
  response = await fetch(origin + '/api/community/profile/avatar', { method: 'POST', headers: { Cookie: personalCookie, Origin: origin, 'X-Reader-Request': '1' }, body: form });
  assert.equal(response.status, 200); assert.equal((await response.json()).pendingAvatar, true);
  assert.equal((await get('/api/community/profile/avatar/pending.webp', 'preview_as=demo')).status, 404);
  response = await get('/api/community/manage?tab=profiles', ownerCookie); assert.equal(response.status, 200);
  const queue = await response.json(); assert.equal(queue.profiles.length, 2);
  for (const proposal of queue.profiles) {
    assert.equal(proposal.uid, '10008'); assert.equal((await post(`/api/community/manage/profiles/${proposal.id}/approve`, {}, personalCookie)).status, 403);
    assert.equal((await post(`/api/community/manage/profiles/${proposal.id}/approve`, {}, ownerCookie)).status, 200);
  }
  const main = await (await get('/api/reader/session')).json(); assert.equal(main.uid, '10008'); assert.equal(main.signature, '我自己的个人签名'); assert.match(main.avatar || '', /^\/api\/reader\/avatar\/[0-9a-f-]{36}\.webp$/);
  assert.equal((await get(main.avatar)).status, 200, 'main avatar uses the same approved file');
  const publicMember = await (await get('/api/community/members/10008', 'preview_as=demo')).json();
  assert.equal(publicMember.bio, '我自己的个人签名'); assert.match(publicMember.person.avatar || '', /^\/api\/community\/avatar\/10008\.webp/);
  assert.deepEqual(await (await get('/api/author/session', ownerCookie)).json(), brand);
  const publicBrand = await (await get('/api/community/members/owner', 'preview_as=demo')).json(); assert.equal(publicBrand.person.name, '無相'); assert.equal(publicBrand.person.avatar, null);
  const ordinaryProfile = await (await get('/api/community/profile', 'preview_as=demo')).json(); assert.equal(ordinaryProfile.person.uid, '10001'); assert.notEqual(ordinaryProfile.signature, '我自己的个人签名');
});
