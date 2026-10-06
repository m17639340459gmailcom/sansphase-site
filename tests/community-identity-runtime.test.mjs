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
  const code = `import assert from 'node:assert/strict'; import {createPayloadRuntime} from './server/payload/runtime.ts'; const runtime=await createPayloadRuntime(process.argv[1]); try {await runtime.healthCheck(); const req={headers:{cookie:'sansphase_author_session='+process.env.COMMUNITY_IDENTITY_TEST_OWNER_TOKEN}}; assert.deepEqual(await runtime.authorService.identityStrict(req),{name:'Owner'}); const original=runtime.payload.findByID; runtime.payload.findByID=async()=>{throw Error('injected account storage failure');}; assert.equal(await runtime.authorService.identity(req),null); await assert.rejects(runtime.authorService.identityStrict(req),/injected account storage failure/); runtime.payload.findByID=original; console.log(JSON.stringify({enabled:runtime.communityEnabled,destination:runtime.communityDestination,authority:!!runtime.identityAuthority,strict:typeof runtime.readerService.identityStrict,strictOwner:typeof runtime.authorService.identityStrict}));}finally{await runtime.close();}`;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code, config], { cwd: process.cwd(), env: { ...process.env, SITE_ORIGIN: settings.siteOrigin, COMMUNITY_IDENTITY_TEST_OWNER_TOKEN: ownerToken }, windowsHide: true });
  assert.deepEqual(JSON.parse(stdout.trim().split('\n').at(-1)), { enabled: false, destination: 'https://community.sansphase.com', authority: true, strict: 'function', strictOwner: 'function' });
});
