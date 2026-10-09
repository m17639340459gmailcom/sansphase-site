import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { buildCommunityVipFrameArt } from '../scripts/community-vip-frame-art.ts';
import { moonFrameCSS, moonFrameSVG } from '../scripts/vip-moon-frame.ts';

const sourceDirectory = new URL('../public/assets/community/vip-frame/', import.meta.url);
const relativeDirectory = 'assets/community/vip-frame';
const approvedHashes: Record<string, string> = {
  'base-640.webp': '0d0e5899b72ef3364062263ebe2cf6485841541b700eb5395b3751ec7da6b096',
  'still-640.webp': 'ccd1b9205024f7bb70942c782fe21bbdfabb42f5caae2939f530894750e43a0a',
  'ribbon-640.webp': 'a7c9bbc2a89d9c3467046e89559ee9a590b108770d0cef029a98d83d5b4b6383',
  'mask-gold.png': '6fe7f435aa0cc41f5c261c5ba645b80e2a00d98d35bf0276d0a918458c668368',
  'mask-blue.png': '60f72d555be82494b3c98689468924a52bce0c66efab303790e6e97975ab6488',
  'mask-pale.png': '30227a8fb0482270ec5b8287c7c9882be2d3ffbd7ae24edad3914075714fc1fc',
  'wave.png': 'd3610569d1e8a2d9cce92683ae908abd239c73a46ed8dea781690f77b99cfaf7',
  'env.png': '6c71931a4494bbc674bbcd360c26d601a2e7ffc45156c4501a2cc465242f4f1c',
};
const digest = (body: Buffer): string => createHash('sha256').update(body).digest('hex');

test('the formal generator retains every path, coordinate and animation setting from the original first frame', () => {
  const svg = moonFrameSVG({
    'mask-gold.png': 'mask-gold.png', 'mask-blue.png': 'mask-blue.png', 'mask-pale.png': 'mask-pale.png',
    'wave.png': 'wave.png', 'env.png': 'env.png', 'ribbon-640.webp': 'ribbon-640.webp', 'still-640.webp': 'still-640.webp',
  }).replace(/<style>[\s\S]*?<\/style>/, '');
  // Recorded directly from frame.js at the provenance commit, independent of
  // the formal implementation and without reading the archived prototype.
  assert.equal(digest(Buffer.from(svg)), '6d56d1a8614db491a79890c5c92fe67bde33061ea0f6818bd29ca9c3c6fadaf9');
  assert.equal(digest(Buffer.from(moonFrameCSS)), 'bddeb96073fc4a37cd737ae22f1e9f28468286d6ab06f053cd1d66ccb2b6beed');
});

test('formal VIP frame sources retain the collaborator commit and every approved raster byte', async () => {
  const manifest = JSON.parse(await readFile(new URL('sources.json', sourceDirectory), 'utf8'));
  assert.equal(manifest.repository, 'https://github.com/m17639340459gmailcom/sansphase-site');
  assert.equal(manifest.commit, 'c78bcdbb5df9f21d2c27819f7b53ac6ac99ab9c4');
  assert.equal(manifest.sourceDirectory, 'outputs/vip-moon-frame-v1');
  assert.equal(manifest.generator.file, 'frame.js');
  assert.equal(manifest.generator.sha256, 'c75acd23e54c356d3838d4c77516be4cf2bc6af0938e0cebbe03b4d7c81cd0b0');
  assert.deepEqual(Object.keys(manifest.files).sort(), Object.keys(approvedHashes).sort());
  for (const [file, hash] of Object.entries(approvedHashes)) {
    const body = await readFile(new URL(file, sourceDirectory));
    assert.equal(digest(body), hash, `${file} is the unmodified collaborator source`);
    assert.equal(manifest.files[file].sha256, hash);
    assert.equal(manifest.files[file].bytes, body.length);
  }
});

test('fresh releases embed the original VIP animation and build a bounded transparent still deterministically', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-vip-frame-'));
  const directory = resolve(root, relativeDirectory);
  try {
    await cp(sourceDirectory, directory, { recursive: true });
    const originals = new Map<string, Buffer>();
    for (const file of Object.keys(approvedHashes)) originals.set(file, await readFile(resolve(directory, file)));
    await buildCommunityVipFrameArt(root);
    const svgBytes = await readFile(resolve(directory, 'frame-moon.svg'));
    const svg = svgBytes.toString('utf8');
    assert.ok(svgBytes.length < 700 * 1024, 'the self-contained dynamic frame remains bounded');
    assert.match(svg, /<svg[^>]*viewBox="0 0 1265 1265"[^>]*class="moon-frame"/);
    assert.match(svg, /<style>[\s\S]*\.moon-frame \.mo\{animation:mf-mo 4s ease-in-out infinite\}/);
    assert.match(svg, /<feOffset in="w0" dx="0" result="w"><animate attributeName="dx" from="0" to="-421\.6666666666667" dur="6s" repeatCount="indefinite"\/><\/feOffset>/);
    assert.match(svg, /<feDisplacementMap in="SourceGraphic" in2="m" scale="46" xChannelSelector="G" yChannelSelector="R"\/>/);
    assert.match(svg, /@media \(prefers-reduced-motion:reduce\)/);
    assert.equal((svg.match(/class="tw"/g) ?? []).length, 56, 'all original deterministic twinkles remain');
    assert.equal((svg.match(/class="du"/g) ?? []).length, 18, 'all original ribbon dust particles remain');
    assert.equal((svg.match(/class="fl"/g) ?? []).length, 16, 'all original crystal flares remain');
    assert.equal((svg.match(/class="ph"/g) ?? []).length, 7, 'all original moon phases remain');
    for (const animation of ['mo', 'ph', 'flow', 'tw', 'ring', 'sheen', 'du', 'fl']) {
      assert.match(svg, new RegExp(`@keyframes mf-${animation}\\{`));
    }
    const references = [...svg.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    assert.equal(references.length, 7);
    const embeddedHashes = references.map(reference => {
      assert.match(reference, /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/=]+$/);
      return digest(Buffer.from(reference.slice(reference.indexOf(',') + 1), 'base64'));
    }).sort();
    assert.deepEqual(embeddedHashes, Object.entries(approvedHashes).filter(([file]) => file !== 'base-640.webp').map(([, hash]) => hash).sort());
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|(?:src|href)="https?:/i);

    const compact = await readFile(resolve(directory, 'compact/frame-moon.webp'));
    assert.ok(compact.length < 96 * 1024, 'repeated avatar rows get a compact static frame');
    const metadata = await sharp(compact).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height, metadata.hasAlpha, metadata.pages ?? 1], ['webp', 256, 256, true, 1]);
    const rendered = await sharp(compact).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const original = await sharp(originals.get('base-640.webp')).resize(256, 256).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual(rendered.data, original.data, 'the still preserves the downsampled original painting rather than a rendered light layer');
    let clear = 0;
    let center = 0;
    let coloured = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * rendered.info.channels;
      const [r, g, b, a] = [rendered.data[i], rendered.data[i + 1], rendered.data[i + 2], rendered.data[i + 3]];
      // The approved ornamental moons overlap the outer opening; retain them
      // while checking the transparent core through which the avatar appears.
      if (Math.hypot(x - 127.5, y - 127.5) < 50) { center++; if (a <= 16) clear++; }
      if (a > 128 && Math.max(r, g, b) - Math.min(r, g, b) > 32) coloured++;
    }
    assert.ok(clear / center >= .98, 'the central opening leaves the avatar visible');
    assert.ok(coloured > 256 * 256 * .03, 'original gold and blue details remain visible');
    for (const [x, y] of [[0, 0], [255, 0], [0, 255], [255, 255]]) assert.equal(rendered.data[(y * 256 + x) * 4 + 3], 0, 'all canvas corners remain transparent');
    for (const [file, original] of originals) assert.deepEqual(await readFile(resolve(directory, file)), original);
    await buildCommunityVipFrameArt(root);
    assert.deepEqual(await readFile(resolve(directory, 'frame-moon.svg')), svgBytes);
    assert.deepEqual(await readFile(resolve(directory, 'compact/frame-moon.webp')), compact);
    t.diagnostic(JSON.stringify({ svgBytes: svgBytes.length, compactBytes: compact.length, centerClear: clear / center }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing VIP frame sources fail the build instead of shipping broken avatar URLs', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-vip-frame-missing-'));
  try { await assert.rejects(buildCommunityVipFrameArt(root), /ENOENT/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('a manifest cannot hide a missing original ribbon source in a fresh release', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-vip-frame-missing-ribbon-'));
  const directory = resolve(root, relativeDirectory);
  try {
    await cp(sourceDirectory, directory, { recursive: true });
    await rm(resolve(directory, 'ribbon-640.webp'));
    await assert.rejects(buildCommunityVipFrameArt(root), (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'ENOENT'
      && 'path' in error && error.path === resolve(directory, 'ribbon-640.webp'));
    await assert.rejects(readFile(resolve(directory, 'frame-moon.svg')), /ENOENT/);
    await assert.rejects(readFile(resolve(directory, 'compact/frame-moon.webp')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt source rasters fail integrity validation before either delivery asset is written', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-vip-frame-corrupt-'));
  const directory = resolve(root, relativeDirectory);
  try {
    await cp(sourceDirectory, directory, { recursive: true });
    const damaged = Buffer.from('corrupt approved source fixture');
    await writeFile(resolve(directory, 'wave.png'), damaged);
    await assert.rejects(buildCommunityVipFrameArt(root), /VIP frame source integrity mismatch: wave\.png/);
    assert.deepEqual(await readFile(resolve(directory, 'wave.png')), damaged);
    await assert.rejects(readFile(resolve(directory, 'frame-moon.svg')), /ENOENT/);
    await assert.rejects(readFile(resolve(directory, 'compact/frame-moon.webp')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
