import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { buildCompactCommunityArt } from '../scripts/community-compact-art.ts';

const atlasDirectory = 'assets/community/badges';
const atlasSource = new URL('../public/assets/community/badges/badge-atlas.png', import.meta.url);

async function approvedInputs(root: string, atlas = true) {
  await cp('public/assets/community/levels', resolve(root, 'assets/community/levels'), { recursive: true });
  if (atlas) {
    await mkdir(resolve(root, atlasDirectory), { recursive: true });
    await copyFile(atlasSource, resolve(root, atlasDirectory, 'badge-atlas.png'));
  }
}

test('a fresh release gets 22 static levels and a pixel-exact atlas without changing approved originals', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-compact-art-'));
  const directory = resolve(root, 'assets/community/levels');
  try {
    await approvedInputs(root);
    const original = await readFile(resolve(directory, 'constellation-g10.svg'));
    const originalAtlas = await readFile(resolve(root, atlasDirectory, 'badge-atlas.png'));
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
    const atlas = await readFile(resolve(root, atlasDirectory, 'badge-atlas.webp'));
    const metadata = await sharp(atlas).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height, metadata.hasAlpha, metadata.pages ?? 1], ['webp', 1536, 1024, true, 1]);
    const approvedPixels = await sharp(originalAtlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const deliveredPixels = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual(deliveredPixels.info, approvedPixels.info);
    assert.deepEqual(deliveredPixels.data, approvedPixels.data, 'all RGBA bytes, including transparent pixel colors, remain exact');
    t.diagnostic(JSON.stringify({ pngBytes: originalAtlas.length, webpBytes: atlas.length, width: metadata.width, height: metadata.height,
      rgbaBytes: deliveredPixels.data.length, rgbaHash: createHash('sha256').update(deliveredPixels.data).digest('hex') }));
    assert.ok(atlas.length < originalAtlas.length, 'lossless delivery is smaller than its approved PNG source');
    assert.deepEqual(await readFile(resolve(root, atlasDirectory, 'badge-atlas.png')), originalAtlas);
    assert.deepEqual(await readFile(atlasSource), originalAtlas, 'the source asset remains unchanged');
    await buildCompactCommunityArt(root);
    assert.deepEqual(await readFile(resolve(directory, 'compact', 'constellation-g10.webp')), first);
    assert.deepEqual(await readFile(resolve(root, atlasDirectory, 'badge-atlas.webp')), atlas);
    assert.deepEqual(await readFile(resolve(root, atlasDirectory, 'badge-atlas.png')), originalAtlas);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing approved atlas fails a fresh build instead of publishing broken badge URLs', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-atlas-missing-'));
  try {
    await approvedInputs(root, false);
    await assert.rejects(buildCompactCommunityArt(root), (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'ENOENT'
      && 'path' in error && error.path === resolve(root, atlasDirectory, 'badge-atlas.png'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt approved atlas fails encoding and never replaces the original input', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-atlas-corrupt-'));
  try {
    await approvedInputs(root);
    const invalid = Buffer.from('invalid PNG fixture');
    const path = resolve(root, atlasDirectory, 'badge-atlas.png');
    await writeFile(path, invalid);
    await assert.rejects(buildCompactCommunityArt(root), /unsupported image format/i);
    assert.deepEqual(await readFile(path), invalid);
    await assert.rejects(readFile(resolve(root, atlasDirectory, 'badge-atlas.webp')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing required level artwork fails the build instead of publishing broken image URLs', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-compact-missing-'));
  try { await assert.rejects(buildCompactCommunityArt(root), /ENOENT/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
