import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import postcss from 'postcss';
import sharp from 'sharp';
import { composeCommunityStyles } from '../scripts/compose-community-styles.mjs';
import { packageStaticFiles } from '../scripts/static-package.mjs';

const atlasPath = 'assets/community/badges/badge-atlas.png';
const atlasSource = new URL(`../public/${atlasPath}`, import.meta.url);
const publicAsset = path => new URL(`../public/${path}`, import.meta.url);
const assetPath = path => path.replace(/^\.?\//, '');
function communityImageReferences(css) {
  const references = [];
  postcss.parse(css).walkDecls(declaration => {
    for (const match of declaration.value.matchAll(/url\(\s*(['"]?)([^'"()]+)\1\s*\)/g)) {
      if (/^\.?\/assets\/community\//.test(match[2]))
        references.push({ property: declaration.prop, path: match[2], selector: declaration.parent.selector });
    }
  });
  assert.deepEqual(references.filter(reference => assetPath(reference.path) === atlasPath).map(reference => reference.property).sort(), ['background-image', 'mask-image'],
    'both the approved drawing and its aurora mask use the atlas');
  for (const path of ['assets/community/atlas-space.webp', 'assets/community/checkin-astral-depth-v2.webp'])
    assert.ok(references.some(reference => assetPath(reference.path) === path), `${path} stays in the actual composed CSS`);
  return references;
}

test('community CSS image references stay available locally and the approved atlas contains visible pixels', async () => {
  const css = await composeCommunityStyles();
  const bytes = await readFile(atlasSource);
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.format, metadata.width, metadata.height], ['png', 1536, 1024]);
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.ok(data.some((value, index) => index % info.channels === info.channels - 1 && value > 0), 'the approved PNG is decoded and contains visible ink');
  for (const reference of communityImageReferences(css)) {
    const resolved = new URL(reference.path, 'http://127.0.0.1:4220/community.css');
    assert.equal(resolved.href, `http://127.0.0.1:4220/${assetPath(reference.path)}`, reference.selector);
    const image = await sharp(await readFile(publicAsset(assetPath(reference.path)))).metadata();
    assert.ok(image.width && image.height, `${reference.selector} points to a real image`);
  }
});

test('all community CSS images resolve inside the immutable stylesheet package on either site', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sansphase-badge-delivery-'));
  try {
    const composed = await composeCommunityStyles();
    const references = communityImageReferences(composed);
    for (const path of new Set(references.map(reference => assetPath(reference.path)))) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await copyFile(publicAsset(path), join(root, path));
    }
    await writeFile(join(root, 'index.html'), '<html><head><script type="module" src="./app.mjs"></script></head></html>');
    await writeFile(join(root, 'app.mjs'), 'export const community = true;');
    await writeFile(join(root, 'community.css'), composed);
    const delivery = await packageStaticFiles(root, 'https://static.example');
    const atlas = delivery.files.find(file => file.path === atlasPath);
    assert.ok(atlas, 'reviewed atlas is included in the public snapshot');
    assert.deepEqual(await readFile(join(root, delivery.prefix, atlasPath)), await readFile(atlasSource),
      'publication preserves the approved image bytes');
    const css = await readFile(join(root, delivery.prefix, 'community.css'), 'utf8');
    const html = await readFile(join(root, 'index.html'), 'utf8');
    for (const page of ['https://www.sansphase.com/', 'https://community.sansphase.com/']) {
      const base = /data-static-base="([^"]+)"/.exec(html)?.[1];
      assert.ok(base);
      const stylesheet = new URL('community.css', new URL(base, page));
      for (const reference of communityImageReferences(css)) {
        const resolved = new URL(reference.path, stylesheet);
        const path = assetPath(reference.path);
        assert.equal(resolved.href, `${delivery.origin}/${delivery.prefix}/${path}`, `${page}: ${reference.selector}`);
        assert.ok(delivery.files.some(file => file.path === path), `${path} is present in the same published manifest`);
        const packagedPath = resolved.pathname.slice(`/${delivery.prefix}/`.length);
        assert.deepEqual(await readFile(join(root, delivery.prefix, packagedPath)), await readFile(publicAsset(path)));
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
