import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Payload } from 'payload';
import { createCommunityDirectory } from '../server/community-runtime.ts';

const firstId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nextId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

for (const change of ['removed', 'replaced', 'disabled', 'deleted'] as const) {
  test(`approved reader avatar refuses an outdated projection after target is ${change}`, async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'community-approved-avatar-'));
    t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    await mkdir(resolve(directory, 'uploads'));
    await writeFile(resolve(directory, 'uploads', `reader-avatar-${firstId}.webp`), 'approved-avatar');
    const row = { id: 'reader', nickname: '读者', avatar: firstId as string | null, disabled: false };
    let reads = 0, gone = false;
    const payload = { find: async () => {
      const snapshot = { ...row };
      if (++reads === 1) {
        if (change === 'removed') row.avatar = null;
        if (change === 'replaced') row.avatar = nextId;
        if (change === 'disabled') row.disabled = true;
        if (change === 'deleted') gone = true;
        return { docs: [snapshot] };
      }
      return { docs: gone ? [] : [{ ...row }] };
    } } as unknown as Payload;
    const profiles = createCommunityDirectory({ payload, directory, authorId: 'owner', ownerName: async () => '站长',
      uidStore: { get: () => '10001', readerId: uid => uid === '10001' ? 'reader' : null } });
    assert.equal(await profiles.avatar('10001'), null, 'old approved bytes must not leave the account projection');
    assert.equal(reads, 2, 'the target projection is rechecked after reading the old file');
  });
}

test('community approved avatar URLs share full UUID versions for raw state and the existing main-site URL', async () => {
  const { communityApprovedAvatarURL } = await import('../server/community-avatar-url.ts');
  const expected = `/api/community/avatar/10001.webp?v=${firstId}`;
  assert.equal(communityApprovedAvatarURL('10001', firstId), expected);
  assert.equal(communityApprovedAvatarURL('10001', `/api/reader/avatar/${firstId}.webp`), expected);
  assert.equal(communityApprovedAvatarURL('owner', nextId), `/api/community/avatar/owner.webp?v=${nextId}`);
  assert.equal(communityApprovedAvatarURL('10001', null), null);
  assert.equal(communityApprovedAvatarURL(null, firstId), null);
  assert.equal(communityApprovedAvatarURL('10001', 'fixture-approved'), '/api/community/avatar/10001.webp', 'unknown legacy fixture values do not invent versions');
  assert.equal(communityApprovedAvatarURL('10001', `https://outside.invalid/api/reader/avatar/${firstId}.webp`), '/api/community/avatar/10001.webp', 'untrusted URL shapes cannot supply an avatar version');
});
