import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage } from 'node:http';
import sharp from 'sharp';
import { createCommunityPreviewProfile } from '../scripts/fixtures/community-preview-profile.ts';
import type { CommunityProfileModeration, CommunityProfileGuard } from '../server/community-profile-access.ts';

const reviewGuard = (moderation: CommunityProfileModeration): CommunityProfileGuard => async operation => {
  const allowed = moderation.role === 'owner' ? ['avatar','signature','nickname'] as const : ['avatar'] as const;
  if (operation.kind && !allowed.some(kind => kind === operation.kind)) throw Object.assign(Error('This preview role cannot review that profile kind.'), {status:403});
  return allowed;
};

const req = (id: string) => ({ headers: { cookie: `preview_as=${id}` } }) as IncomingMessage;
const ownerReaderId = 'ffffffff-ffff-4fff-8fff-fffffffffff8';
const personalReq = () => ({ headers: { cookie: 'preview_as=owner; community_browse=reader' } }) as IncomingMessage;
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-preview-profile-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return createCommunityPreviewProfile(directory, { demo: { name: '演示读者', uid: '10001', bio: '已通过的签名' }, steward: { name: '演示版主', uid: '10002', bio: '' },
    [ownerReaderId]: { name: '站长个人', uid: '10008', bio: '个人已通过签名' } }, { ownerReaderId });
}
test('isolated preview reuses actual review commands without showing unapproved signatures', async t => {
  const demo = await fixture(t), access = demo.access;
  await access.signature(req('demo'), '待审的个签');
  assert.equal(demo.publicRow('demo')?.signature, '已通过的签名');
  assert.equal((await access.state(req('demo'))).pendingSignature, '待审的个签');
  const owner = { role: 'owner' as const, actor: { kind: 'owner' as const, id: 'owner' } };
  const rows = await access.reviews(req('owner'), owner, reviewGuard(owner));
  assert.equal(rows.length, 1);
  await access.review(req('owner'), rows[0].id, 'approve', owner, reviewGuard(owner));
  assert.equal(demo.publicRow('demo')?.signature, '待审的个签');
  assert.equal((await access.state(req('demo'))).pendingSignature, null);
});
test('isolated preview avatar approval remains private until a moderator reviews it', async t => {
  const demo = await fixture(t), access = demo.access;
  const bytes = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#315a74' } }).webp().toBuffer();
  await access.avatar(req('demo'), bytes);
  assert.equal(await demo.avatarFile('10001'), null);
  const moderator = { role: 'steward' as const, actor: { kind: 'reader' as const, id: 'steward' } };
  const rows = await access.reviews(req('steward'), moderator, reviewGuard(moderator));
  assert.equal(rows[0].kind, 'avatar');
  await access.review(req('steward'), rows[0].id, 'approve', moderator, reviewGuard(moderator));
  assert.deepEqual(await readFile((await demo.avatarFile('10001'))!), bytes);
  await access.removeAvatar(req('demo'));
  assert.equal(await demo.avatarFile('10001'), null);
});
test('isolated preview retains actor guards and moderator signature restrictions', async t => {
  const { access } = await fixture(t);
  await access.signature(req('demo'), '待审');
  const owner = { role: 'owner' as const, actor: { kind: 'owner' as const, id: 'owner' } };
  const row = (await access.reviews(req('owner'), owner, reviewGuard(owner)))[0];
  const moderator = { role: 'steward' as const, actor: { kind: 'reader' as const, id: 'steward' } };
  await assert.rejects(access.review(req('steward'), row.id, 'approve', moderator, reviewGuard(moderator)), { status: 403 });
  await assert.rejects(access.signature(req('owner'), '越权'), { status: 403 });
  await assert.rejects(access.reviews(req('demo'), owner, reviewGuard(owner)), { status: 403 });
});

test('the verified fixture owner may edit its separate linked reader without changing the brand or another reader', async t => {
  const demo = await fixture(t);
  const personal = personalReq();
  const identity = await demo.ownerReaderIdentity(personal);
  assert.equal(identity?.id, ownerReaderId);
  await demo.access.signature(personal, '站长的个人新签名');
  const state = await demo.access.state(personal);
  assert.equal(state.uid, '10008'); assert.equal(state.id, ownerReaderId); assert.equal(state.pendingSignature, '站长的个人新签名');
  assert.equal(demo.publicRow('demo')?.signature, '已通过的签名');
  assert.equal(await demo.ownerReaderIdentity(req('demo')), null);
  assert.equal((await demo.ownerReaderIdentity(req('owner')))?.id, ownerReaderId, 'auth-only callback also supports the initial switch preflight');
  const forged = { headers: { cookie: 'preview_as=demo; community_browse=reader' } } as IncomingMessage;
  assert.equal(await demo.ownerReaderIdentity(forged), null);
  assert.equal((await demo.access.state(forged)).id, 'demo');
  await assert.rejects(demo.access.signature(req('owner'), '品牌不可改'), { status: 403 });
  const owner = { role: 'owner' as const, actor: { kind: 'owner' as const, id: 'owner' } };
  const [proposal] = await demo.access.reviews(req('owner'), owner, reviewGuard(owner));
  await demo.access.review(req('owner'), proposal.id, 'approve', owner, reviewGuard(owner));
  assert.equal(demo.publicRow(ownerReaderId)?.signature, '站长的个人新签名');
});

test('fixture main account reads the same approved owner reader avatar and signature through the actual reader service', async t => {
  const demo = await fixture(t), origin = 'http://127.0.0.1:4220';
  const main = demo.readerService(origin);
  const first = await main.displayIdentity(personalReq()); assert.equal(first?.uid, '10008'); assert.equal(first?.signature, '个人已通过签名');
  const image = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#5566aa' } }).webp().toBuffer();
  await demo.access.avatar(personalReq(), image); await demo.access.signature(personalReq(), '相同个人实体');
  const owner = { role: 'owner' as const, actor: { kind: 'owner' as const, id: 'owner' } };
  for (const proposal of await demo.access.reviews(req('owner'), owner, reviewGuard(owner))) await demo.access.review(req('owner'), proposal.id, 'approve', owner, reviewGuard(owner));
  const approved = await main.displayIdentity(personalReq()); assert.equal(approved?.signature, '相同个人实体'); assert.match(approved?.avatar || '', /^\/api\/reader\/avatar\/[0-9a-f-]{36}\.webp$/);
  assert.equal((await demo.access.state(personalReq())).avatar, demo.publicRow(ownerReaderId)?.avatar);
  assert.deepEqual(await readFile((await demo.avatarFile('10008'))!), image);
  assert.equal(await main.identity(req('owner')), null);
});
