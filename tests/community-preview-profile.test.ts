import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage } from 'node:http';
import sharp from 'sharp';
import { createCommunityPreviewProfile } from '../scripts/fixtures/community-preview-profile.ts';

const req = (id: string) => ({ headers: { cookie: `preview_as=${id}` } }) as IncomingMessage;
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-preview-profile-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return createCommunityPreviewProfile(directory, { demo: { name: '演示读者', uid: '10001', bio: '已通过的签名' }, steward: { name: '演示版主', uid: '10002', bio: '' } });
}
test('isolated preview reuses actual review commands without showing unapproved signatures', async t => {
  const demo = await fixture(t), access = demo.access;
  await access.signature(req('demo'), '待审的个签');
  assert.equal(demo.publicRow('demo')?.signature, '已通过的签名');
  assert.equal((await access.state(req('demo'))).pendingSignature, '待审的个签');
  const owner = { role: 'owner' as const, actor: { kind: 'owner' as const, id: 'owner' } };
  const rows = await access.reviews(req('owner'), owner, () => {});
  assert.equal(rows.length, 1);
  await access.review(req('owner'), rows[0].id, 'approve', owner, () => {});
  assert.equal(demo.publicRow('demo')?.signature, '待审的个签');
  assert.equal((await access.state(req('demo'))).pendingSignature, null);
});
test('isolated preview avatar approval remains private until a moderator reviews it', async t => {
  const demo = await fixture(t), access = demo.access;
  const bytes = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#315a74' } }).webp().toBuffer();
  await access.avatar(req('demo'), bytes);
  assert.equal(await demo.avatarFile('10001'), null);
  const moderator = { role: 'steward' as const, actor: { kind: 'reader' as const, id: 'steward' } };
  const rows = await access.reviews(req('steward'), moderator, () => {});
  assert.equal(rows[0].kind, 'avatar');
  await access.review(req('steward'), rows[0].id, 'approve', moderator, () => {});
  assert.deepEqual(await readFile((await demo.avatarFile('10001'))!), bytes);
  await access.removeAvatar(req('demo'));
  assert.equal(await demo.avatarFile('10001'), null);
});
test('isolated preview retains actor guards and moderator signature restrictions', async t => {
  const { access } = await fixture(t);
  await access.signature(req('demo'), '待审');
  const owner = { role: 'owner' as const, actor: { kind: 'owner' as const, id: 'owner' } };
  const row = (await access.reviews(req('owner'), owner, () => {}))[0];
  const moderator = { role: 'steward' as const, actor: { kind: 'reader' as const, id: 'steward' } };
  await assert.rejects(access.review(req('steward'), row.id, 'approve', moderator, () => {}), { status: 403 });
  await assert.rejects(access.signature(req('owner'), '越权'), { status: 403 });
  await assert.rejects(access.reviews(req('demo'), owner, () => {}), { status: 403 });
});
