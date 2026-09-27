import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

test('the cropped site image is shipped as browser and touch icons', async () => {
  const source = await readFile('src/index.html', 'utf8');
  assert.match(source, /<link rel="icon" type="image\/png" sizes="32x32" href="\.\/favicon-32\.png\?v=photo-1"\s*\/>/);
  assert.match(source, /<link rel="shortcut icon" type="image\/x-icon" href="\.\/favicon\.ico\?v=photo-1"\s*\/>/);
  assert.match(source, /<link rel="apple-touch-icon" sizes="180x180" href="\.\/apple-touch-icon\.png\?v=photo-1"\s*\/>/);
  const svg = await readFile('public/favicon.svg', 'utf8');
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.match(svg, /data:image\/jpeg;base64,/);
  assert.doesNotMatch(svg, /<path|<circle|<rect/, 'legacy SVG URL must show the photo rather than the old drawn icon');
  assert.doesNotMatch(svg, /<script|(?:href|xlink:href)=["']https?:/i, 'favicon must be self-contained');
  for (const [file, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180]]) {
    const original = await readFile(`public/${file}`);
    assert.deepEqual(await readFile(`dist/${file}`), original);
    const image = await sharp(original).metadata();
    assert.equal(image.width, size);
    assert.equal(image.height, size);
  }
  assert.deepEqual(await readFile('dist/favicon.svg'), await readFile('public/favicon.svg'));
  const ico = await readFile('public/favicon.ico');
  assert(ico.length < 10_000, 'browser fallback icon should remain small');
  assert.deepEqual(ico.subarray(0, 4), Buffer.from([0, 0, 1, 0]));
  assert.deepEqual(await readFile('dist/favicon.ico'), ico);
});
