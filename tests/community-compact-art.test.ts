import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { buildCompactCommunityArt } from '../scripts/community-compact-art.ts';

test('a fresh release gets all 22 transparent, static level derivatives without changing approved SVGs', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-compact-art-'));
  const directory = resolve(root, 'assets/community/levels');
  try {
    await cp('public/assets/community/levels', directory, { recursive: true });
    const original = await readFile(resolve(directory, 'constellation-g10.svg'));
    await buildCompactCommunityArt(root);
    const files = await readdir(resolve(directory, 'compact'));
    assert.equal(files.length, 22);
    for (const file of files) {
      const bytes = await readFile(resolve(directory, 'compact', file));
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.width, 192); assert.equal(metadata.height, 192);
      assert.equal(metadata.hasAlpha, true); assert.equal(metadata.pages ?? 1, 1);
      assert.ok(bytes.length < 64 * 1024, `${file} stays bounded`);
      const { channels, isOpaque } = await sharp(bytes).stats();
      assert.equal(isOpaque, false, 'transparent image edges stay transparent');
      assert.ok(channels[3].max > 0, 'artwork is visible');
    }
    assert.deepEqual(await readFile(resolve(directory, 'constellation-g10.svg')), original);
    const first = await readFile(resolve(directory, 'compact', 'constellation-g10.webp'));
    await buildCompactCommunityArt(root);
    assert.deepEqual(await readFile(resolve(directory, 'compact', 'constellation-g10.webp')), first);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing required level artwork fails the build instead of publishing broken image URLs', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-compact-missing-'));
  try { await assert.rejects(buildCompactCommunityArt(root), /ENOENT/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
