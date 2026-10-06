import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPayload, jwtSign } from 'payload';
import { makePayloadConfig } from '../server/payload/config.ts';
import { createReaderService } from '../server/reader-service.ts';
import { createCommunityDirectory } from '../server/community-runtime.ts';
import { readMainCommunityIdentitySettings } from '../server/payload/runtime.ts';
import { prepareIdentityStore } from '../server/community-identity-store.ts';
import { migrateReaderAccounts } from '../server/payload/reader-migration.ts';
import { migrateCommunity } from '../server/payload/community-migration.ts';

test('strict reader identity distinguishes rejected sessions from backend failure without changing existing forgiving reads', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'strict-reader-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = { error: null, user: { collection: 'readers', id: 'reader-a', _verified: true, disabled: false, nickname: '读者', email: 'reader@example.invalid', createdAt: '2026-01-01T00:00:00Z', sessions: [{ id: 'session-a' }] } };
  const payload = { secret: 'actual-payload-derived-key'.repeat(2), collections: { readers: { config: { slug: 'readers', auth: { useSessions: true, verify: true, depth: 0 } } } }, config: { secret: 'test-reader-workflow-key'.repeat(3), auth: { jwtOrder: ['JWT'] } },
    auth: async () => ({ user: state.error ? null : state.user }), findByID: async () => { if (state.error) throw state.error; return state.user; } };
  const service = createReaderService({ payload, directory, siteOrigin: 'https://www.sansphase.com', uidStore: { get: () => '10001' } });
  const signed = await jwtSign({ fieldsToSign: { collection: 'readers', id: 'reader-a', sid: 'session-a' }, secret: payload.secret, tokenExpiration: 3600 });
  const req = { headers: { cookie: `sansphase_reader_session=${signed.token}` } };
  assert.equal((await service.identityStrict(req)).id, 'reader-a');
  for (const status of [401, 403, 404]) { state.error = Object.assign(Error('rejected session'), { status }); assert.equal(await service.identityStrict(req), null); }
  state.error = Error('database offline');
  assert.equal(await service.identity(req), null);
  await assert.rejects(service.identityStrict(req), /database offline/);
  state.error = null; state.user.disabled = true;
  assert.equal(await service.identityStrict(req), null);
  state.user.disabled = false; state.user.sessions = [];
  assert.equal(await service.identityStrict(req), null, 'a correctly signed JWT cannot restore a revoked persisted session');
  state.user.sessions = [{ id: 'session-a' }]; state.user._verified = false;
  assert.equal(await service.identityStrict(req), null);
  state.user._verified = true;
  const expired = await jwtSign({ fieldsToSign: { collection: 'readers', id: 'reader-a', sid: 'session-a' }, secret: payload.secret, tokenExpiration: -1 });
  assert.equal(await service.identityStrict({ headers: { cookie: `sansphase_reader_session=${expired.token}` } }), null);
  assert.equal(await service.identityStrict({ headers: {} }), null);
  assert.equal(await service.identityStrict({ headers: { cookie: 'sansphase_reader_session=invalid.token' } }), null);
});

test('shared directory exposes only approved records and reads avatars through the same existing source', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-directory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const id = randomUUID(), avatar = randomUUID();
  await mkdir(resolve(directory, 'uploads')); await writeFile(resolve(directory, 'uploads', `reader-avatar-${avatar}.webp`), 'approved-image');
  const row = { id, nickname: '读者', avatar, signature: '已审核签名', createdAt: '2026-01-01T00:00:00Z', vip_until: '2999-01-01T00:00:00Z', email: 'private@example.invalid', phone: '13800138000', pendingAvatar: 'not-approved' };
  const queries = [];
  const payload = { find: async options => { queries.push(options); return { docs: [row] }; } };
  const source = createCommunityDirectory({ payload, directory, authorId: 'owner-a', uidStore: { get: () => '10001', readerId: uid => uid === '10001' ? id : null }, ownerName: async () => '作者' });
  const profiles = await source.people([{ kind: 'reader', id }]);
  assert.deepEqual(profiles.get(`reader:${id}`), { name: '读者', uid: '10001', avatar, vip: true, joinedAt: row.createdAt, bio: row.signature });
  assert.deepEqual(await source.findMember('10001'), { kind: 'reader', id });
  assert.deepEqual(await source.findMember('owner'), { kind: 'owner', id: 'owner-a' });
  assert.deepEqual([...await source.findByNames(['读者'])], [['读者', { kind: 'reader', id }]]);
  const before = queries.length;
  assert.equal((await source.avatar('10001')).toString(), 'approved-image');
  assert.equal(queries.length, before + 1, 'bridge avatar uses one reader query');
  row.disabled = true; assert.equal(await source.avatar('10001'), null);
  assert.equal((await source.people([{ kind: 'owner', id: 'forged-owner' }])).size, 0);
  payload.find = async () => { throw Error('directory unavailable'); };
  await assert.rejects(source.people([{ kind: 'reader', id }]), /directory unavailable/);
});

test('owner brand avatar reads approved author media independently of the linked personal reader avatar', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-brand-avatar-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const personalId = randomUUID(), personalAvatar = randomUUID(), first = randomUUID(), second = randomUUID();
  await mkdir(resolve(directory, 'uploads')); await writeFile(resolve(directory, 'uploads', `reader-avatar-${personalAvatar}.webp`), 'personal-avatar');
  const personal = { id: personalId, nickname: '个人读者', avatar: personalAvatar, signature: '已审核个人签名' };
  const payload = { find: async () => ({ docs: [personal] }) };
  let current = first; const reads = [];
  const source = createCommunityDirectory({ payload, directory, authorId: 'owner-a', ownerReaderId: personalId,
    uidStore: { get: () => '10008', readerId: uid => uid === '10008' ? personalId : null }, ownerName: async () => '作者品牌',
    ownerAvatar: { current: async () => current, read: async id => { reads.push(id); return Buffer.from('brand-' + id); } } });
  let map = await source.people([{ kind: 'owner', id: 'owner-a' }, { kind: 'reader', id: personalId }]);
  assert.equal(map.get('owner:owner-a').avatar, first);
  assert.equal(map.get(`reader:${personalId}`).avatar, personalAvatar);
  assert.equal((await source.avatar('owner')).toString(), 'brand-' + first);
  assert.equal((await source.avatar('10008')).toString(), 'personal-avatar');
  assert.deepEqual(reads, [first], 'personal reads do not touch brand media');
  current = second;
  map = await source.people([{ kind: 'owner', id: 'owner-a' }]); assert.equal(map.get('owner:owner-a').avatar, second);
  assert.equal((await source.avatar('owner')).toString(), 'brand-' + second, 'the next request sees main-site brand avatar changes');
  current = null;
  assert.equal((await source.people([{ kind: 'owner', id: 'owner-a' }])).get('owner:owner-a').avatar, null);
  assert.equal(await source.avatar('owner'), null);
  current = '../../private'; assert.equal(await source.avatar('owner'), null);
  assert.deepEqual(reads, [first, second]);
});

test('main bridge config requires approved destination and independent private keys', () => {
  const secret = 'payload-private-key'.repeat(3);
  const valid = { communityOrigin: 'https://community.sansphase.com', bridgeSecret: 'separate-bridge-key'.repeat(3), stateEncryptionKey: 'main-only-state-key'.repeat(3) };
  assert.equal(readMainCommunityIdentitySettings({ secret }), null);
  assert.deepEqual(readMainCommunityIdentitySettings({ secret, communityIdentity: valid }), valid);
  for (const value of [false, {}, { ...valid, communityOrigin: 'https://other.example' }, { ...valid, bridgeSecret: secret }, { ...valid, stateEncryptionKey: valid.bridgeSecret }, { ...valid, stateEncryptionKey: secret }, { ...valid, bridgeSecret: 'short' }]) assert.throws(() => readMainCommunityIdentitySettings({ secret, communityIdentity: value }));
});

test('real main runtime optionally constructs the authority and keeps a migrated local forum closed', { timeout: 90_000 }, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'identity-runtime-')), data = resolve(directory, 'data');
  await mkdir(data); t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const settings = { directory: data, secret: randomBytes(48).toString('hex'), authorId: randomUUID(), siteOrigin: 'https://www.sansphase.com', sourceURL: 'http://127.0.0.1:8055', communityEnabled: true,
    communityIdentity: { communityOrigin: 'https://community.sansphase.com', bridgeSecret: randomBytes(48).toString('hex'), stateEncryptionKey: randomBytes(48).toString('hex') } };
  const payload = await getPayload({ config: makePayloadConfig({ ...settings, push: true }) });
  let ownerToken;
  try {
    await payload.create({ collection: 'site_profile', data: { name: 'isolated test owner' } });
    await payload.create({ collection: 'authors', data: { id: settings.authorId, email: 'owner@example.invalid', password: 'test-owner-password', first_name: 'Owner', role: 'owner' } });
    ownerToken = (await payload.login({ collection: 'authors', data: { email: 'owner@example.invalid', password: 'test-owner-password' } })).token;
  }
  finally { await payload.destroy(); payload.db.client.close(); }
  await writeFile(resolve(data, 'migration-complete.json'), JSON.stringify({ provider: 'payload' }));
  await migrateReaderAccounts(data); await migrateCommunity(data); prepareIdentityStore(data);
  const config = resolve(directory, 'private.json'); await writeFile(config, JSON.stringify(settings), { mode: 0o600 });
  const code = `
    import assert from 'node:assert/strict';
    import {createServer} from 'node:http';
    import sharp from 'sharp';
    import {createPayloadRuntime} from './server/payload/runtime.ts';
    import {createIdentityClient} from './server/community-identity-protocol.ts';
    const runtime=await createPayloadRuntime(process.argv[1]);
    try {
      await runtime.healthCheck(); const cookie='sansphase_author_session='+process.env.COMMUNITY_IDENTITY_TEST_OWNER_TOKEN;
      const req={headers:{cookie}}; assert.deepEqual(await runtime.authorService.identityStrict(req),{name:'Owner'});
      const original=runtime.payload.findByID; runtime.payload.findByID=async()=>{throw Error('injected account storage failure');};
      assert.equal(await runtime.authorService.identity(req),null); await assert.rejects(runtime.authorService.identityStrict(req),/injected account storage failure/); runtime.payload.findByID=original;
      const png=await sharp({create:{width:96,height:128,channels:3,background:'#7385ab'}}).png().toBuffer();
      const media=await runtime.payload.create({collection:'media',data:{title:'Public brand portrait',originalName:'portrait.png'},file:{data:png,name:'portrait.png',mimetype:'image/png',size:png.length}});
      const profile=(await runtime.payload.find({collection:'site_profile',limit:1,depth:0})).docs[0];
      await runtime.payload.update({collection:'site_profile',id:profile.id,data:{avatar:media.id}});
      const server=createServer((request,response)=>void(request.url==='/api/community-entry'?runtime.identityAuthority.handleEntry(request,response):runtime.identityAuthority.handleBridge(request,response)));
      await new Promise(done=>server.listen(0,'127.0.0.1',done)); const base='http://127.0.0.1:'+server.address().port;
      try {
        const entry=await fetch(base+'/api/community-entry',{method:'POST',headers:{Origin:runtime.settings.siteOrigin,'X-Reader-Request':'1',Cookie:cookie}});
        assert.equal(entry.status,200); const data=await entry.json(),ticket=new URL(data.url).hash.slice('#community-entry='.length);
        const binding=/sansphase_community_handoff=([^;]+)/.exec(entry.headers.get('set-cookie'))[1];
        const client=createIdentityClient({origin:runtime.settings.siteOrigin,secret:runtime.settings.communityIdentity.bridgeSecret,fetch:(input,options)=>fetch(base+new URL(String(input)).pathname,options)});
        const {sessionRef}=await client.request('exchange',{ticket,binding});
        const people=await client.request('people',{sessionRef,authors:[{kind:'owner',id:runtime.settings.authorId}]});
        assert.equal(people[0][1].avatar,media.id); assert.equal(people[0][1].uid,'owner');
        const image=await client.request('avatar',{sessionRef,uid:'owner'}),metadata=await sharp(Buffer.from(image.base64,'base64')).metadata();
        assert.equal(metadata.format,'webp');assert.equal(metadata.width,320);assert.equal(metadata.height,320);
        await runtime.payload.update({collection:'site_profile',id:profile.id,data:{avatar:null}});
        assert.equal(await client.request('avatar',{sessionRef,uid:'owner'}),null,'removed brand avatar is not retained as a stale copy');
      } finally {await new Promise(done=>server.close(done));}
      console.log(JSON.stringify({enabled:runtime.communityEnabled,destination:runtime.communityDestination,authority:!!runtime.identityAuthority,strict:typeof runtime.readerService.identityStrict,strictOwner:typeof runtime.authorService.identityStrict}));
    } finally {await runtime.close();}
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code, config], { cwd: process.cwd(), env: { ...process.env, SITE_ORIGIN: settings.siteOrigin, COMMUNITY_IDENTITY_TEST_OWNER_TOKEN: ownerToken }, windowsHide: true });
  assert.deepEqual(JSON.parse(stdout.trim().split('\n').at(-1)), { enabled: false, destination: 'https://community.sansphase.com', authority: true, strict: 'function', strictOwner: 'function' });
});
