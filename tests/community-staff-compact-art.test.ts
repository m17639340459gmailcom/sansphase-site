import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { buildCompactCommunityStaffArt } from '../scripts/community-staff-compact-art.ts';

test('fresh releases get six static staff assets, preserving colours, transparency, lettering and original motion sources', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-staff-compact-'));
  const directory = resolve(root, 'assets/community/staff');
  try {
    await cp('public/assets/community/staff', directory, { recursive: true });
    const originals = new Map<string, Buffer>();
    for (const role of ['assistant', 'moderator', 'general']) {
      for (const kind of ['badge', 'frame']) {
        const slug = `${kind}-${role}`;
        originals.set(slug, await readFile(resolve(directory, `${slug}.svg`)));
      }
    }
    await buildCompactCommunityStaffArt(root);
    assert.equal((await readdir(resolve(directory, 'compact'))).length, 6);
    const firstBuild = new Map<string, Buffer>();
    for (const [slug, original] of originals) {
      const file = resolve(directory, 'compact', `${slug}.webp`);
      const bytes = await readFile(file);
      firstBuild.set(slug, bytes);
      const metadata = await sharp(bytes).metadata();
      const size = slug.startsWith('frame-') ? 256 : 192;
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.width, size); assert.equal(metadata.height, size);
      assert.equal(metadata.hasAlpha, true); assert.equal(metadata.pages ?? 1, 1);
      assert.ok(bytes.length < 96 * 1024, `${slug} remains bounded for repeated avatar rows`);
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let coloured = 0;
      let titleInk = 0;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (y * info.width + x) * info.channels;
          const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
          if (a > 128 && Math.max(r, g, b) - Math.min(r, g, b) > 32) coloured++;
          if (y > size * .77 && x > size * .22 && x < size * .78 && a > 128) titleInk++;
        }
      }
      assert.ok(coloured > size * size * .03, `${slug} preserves coloured gems rather than the animation's white light mask`);
      assert.ok(data[3] < 8, `${slug} keeps its corner transparent`);
      if (slug.startsWith('frame-')) {
        assert.ok(titleInk > 100, `${slug} keeps the original outlined role lettering`);
        const centerAlpha = data[(Math.floor(size / 2) * size + Math.floor(size / 2)) * info.channels + 3];
        assert.ok(centerAlpha < 16, `${slug} leaves the user avatar visible through the centre`);
      }
      assert.deepEqual(await readFile(resolve(directory, `${slug}.svg`)), original);
    }
    await buildCompactCommunityStaffArt(root);
    for (const [slug, first] of firstBuild) {
      assert.deepEqual(await readFile(resolve(directory, 'compact', `${slug}.webp`)), first, `${slug} builds deterministically`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing staff sources fail a release instead of shipping broken decoration URLs', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-staff-compact-missing-'));
  try { await assert.rejects(buildCompactCommunityStaffArt(root), /ENOENT/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('moderator and general backlights fade radially before the square canvas edge', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'community-staff-backdrop-'));
  const directory = resolve(root, 'assets/community/staff');
  try {
    await cp('public/assets/community/staff', directory, { recursive: true });
    for (const role of ['moderator', 'general']) {
      const file = resolve(directory, `frame-${role}.svg`);
      const body = await readFile(file, 'utf8');
      const front = body.indexOf('<use href="#art"/><g mask="url(#am)">', body.indexOf('</defs>') + 7);
      assert.ok(front > 0, 'the approved foreground is separate from the backlight');
      // Render the actual backlight alone so opaque jewels and the bottom title
      // cannot hide a square background or falsely fail its radial fade check.
      await writeFile(file, `${body.slice(0, front)}</svg>`);
    }
    await buildCompactCommunityStaffArt(root);
    for (const role of ['moderator', 'general']) {
      const { data, info } = await sharp(await readFile(resolve(directory, 'compact', `frame-${role}.webp`)))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const radius = info.width / 2;
      const bins = { inner: [] as number[], middle: [] as number[], outer: [] as number[] };
      let edgeAlpha = 0;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const a = data[(y * info.width + x) * info.channels + 3];
          if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) edgeAlpha = Math.max(edgeAlpha, a);
          const r = Math.hypot(x + .5 - radius, y + .5 - radius) / radius;
          if (r >= .76 && r < .84) bins.inner.push(a);
          if (r >= .89 && r < .93) bins.middle.push(a);
          if (r >= .97 && r < 1) bins.outer.push(a);
          if (r >= 1.01) assert.equal(a, 0, `${role} backlight has no square corner pixels`);
        }
      }
      const mean = (items: number[]) => items.reduce((sum, alpha) => sum + alpha, 0) / items.length;
      assert.ok(edgeAlpha <= 2, `${role} backlight reaches transparent before the canvas clips it`);
      assert.ok(mean(bins.inner) > mean(bins.middle), `${role} retains its glow while fading towards the outside`);
      assert.ok(mean(bins.outer) < mean(bins.middle) / 2, `${role} fades continuously rather than ending in a hard square`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
