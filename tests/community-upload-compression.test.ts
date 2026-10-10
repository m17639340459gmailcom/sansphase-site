import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomFillSync } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { readerImageBytes, uploadLimits } from '../src/upload-policy.mjs';
import { compressCommunityUpload } from '../server/community-upload-compression.ts';
import { createCommunityListingFixture, owner, reader } from './fixtures/community-listing.mjs';

const setup = createCommunityListingFixture(test);
const hash = (input: Buffer) => createHash('sha256').update(input).digest('hex');
let staticImage: Buffer, animatedImage: Buffer, gifImage: Buffer;
const delay = Array.from({ length: 10 }, (_, frame) => 70 + frame * 10);
test.before(async () => {
  function pixels(width: number, height: number, pages: number) {
    const data = randomFillSync(Buffer.alloc(width * height * pages * 4));
    for (let frame = 0; frame < pages; frame++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      data[((frame * height + y) * width + x) * 4 + 3] = x < 32 && y < 32 ? 0 : 180;
    }
    return data;
  }
  staticImage = await sharp(pixels(2048, 2048, 1), { raw: { width: 2048, height: 2048, channels: 4 } }).webp({ quality: 82, effort: 4 }).toBuffer();
  const raw = pixels(768, 512, 10);
  const options = { raw: { width: 768, height: 5120, channels: 4 as const, pageHeight: 512 } };
  animatedImage = await sharp(raw, options).webp({ quality: 82, effort: 4, loop: 3, delay }).toBuffer();
  gifImage = await sharp(raw, options).gif({ effort: 1, loop: 3, delay }).toBuffer();
  assert.ok(staticImage.length > readerImageBytes);
  assert.ok(animatedImage.length > readerImageBytes);
  assert.ok(gifImage.length < uploadLimits.maxImageBytes);
});

test('already bounded static and animated WebP keep their exact buffers without another encoding', async t => {
  const tiny = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#4488aacc' } }).webp().toBuffer();
  const raw = Buffer.alloc(24 * 48 * 4, 180); raw.fill(255, 24 * 24 * 4);
  const animated = await sharp(raw, { raw: { width: 24, height: 48, channels: 4, pageHeight: 24 } }).webp({ loop: 2, delay: [90, 170] }).toBuffer();
  t.mock.method(sharp.prototype, 'toBuffer', () => { throw Error('bounded uploads must not be encoded again'); });
  for (const input of [tiny, animated]) assert.equal(await compressCommunityUpload(input), input);
});

test('oversized static WebP fits 2 MiB while retaining full proportions and transparency', async t => {
  const before = hash(staticImage), output = await compressCommunityUpload(staticImage);
  assert.ok(output.length <= readerImageBytes);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.width, metadata.height); assert.ok(metadata.width! <= 2048);
  const pixels = await sharp(output).ensureAlpha().raw().toBuffer();
  assert.equal(pixels[3], 0);
  assert.equal(pixels[(Math.floor(metadata.height! / 2) * metadata.width! + Math.floor(metadata.width! / 2)) * 4 + 3], 180);
  assert.equal(hash(staticImage), before);
  t.diagnostic(JSON.stringify({ kind: 'static', inputBytes: staticImage.length, outputBytes: output.length, width: metadata.width, height: metadata.height }));
});

test('oversized animated WebP retains every frame, loop, timing and alpha within 2 MiB', async t => {
  const before = hash(animatedImage), output = await compressCommunityUpload(animatedImage);
  assert.ok(output.length <= readerImageBytes);
  const metadata = await sharp(output, { animated: true }).metadata();
  assert.equal(metadata.pages, 10); assert.equal(metadata.loop, 3); assert.deepEqual(metadata.delay, delay);
  assert.equal(metadata.hasAlpha, true);
  assert.ok(Math.abs(metadata.width! * 512 - metadata.pageHeight! * 768) <= 768, 'aspect ratio differs by at most one rounded pixel');
  const { data, info } = await sharp(output, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let frame = 0; frame < 10; frame++) {
    assert.equal(data[frame * info.width * info.pageHeight! * 4 + 3], 0);
    assert.equal(data[((frame * info.pageHeight! + Math.floor(info.pageHeight! / 2)) * info.width + Math.floor(info.width / 2)) * 4 + 3], 180);
  }
  assert.notDeepEqual(data.subarray(0, info.width * info.pageHeight! * 4), data.subarray(info.width * info.pageHeight! * 4, info.width * info.pageHeight! * 8));
  assert.equal(hash(animatedImage), before);
  t.diagnostic(JSON.stringify({ kind: 'animated', inputBytes: animatedImage.length, outputBytes: output.length, width: metadata.width, height: metadata.pageHeight, pages: metadata.pages }));
});

test('an impossible byte target terminates with an explicit failure after bounded real encodes', async t => {
  const input = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#4488aacc' } }).webp().toBuffer();
  const original = sharp.prototype.toBuffer; let encodes = 0;
  t.mock.method(sharp.prototype, 'toBuffer', function (...args: Parameters<typeof original>) { encodes++; return Reflect.apply(original, this, args); });
  await assert.rejects(compressCommunityUpload(input, 1), (error: unknown) => error instanceof Error && 'status' in error && error.status === 413 && /压缩|2 MB/.test(error.message));
  assert.ok(encodes > 0 && encodes <= 5, 'compression must stop instead of retrying indefinitely');
  await assert.rejects(compressCommunityUpload(input, readerImageBytes + 1), /上限|limit/i);
});

test('general management GIF and animated WebP uploads remain animated, bounded, private and correctly registered', async t => {
  const f = await setup(t);
  f.store.staff.appoint(owner, reader('mod'), { role: 'general', boards: ['qa'], permissions: [], delegable: [] });
  for (const [input, mime] of [[gifImage, 'image/gif'], [animatedImage, 'image/webp']] as const) {
    const form = new FormData(); form.append('file', new Blob([Uint8Array.from(input)], { type: mime }), `synthetic.${mime === 'image/gif' ? 'gif' : 'webp'}`);
    const response = await fetch(`${f.origin}/api/community/manage/item-image`, { method: 'POST', headers: { Cookie: 'mod', Origin: f.origin, 'X-Reader-Request': '1' }, body: form });
    assert.equal(response.status, 201, await response.clone().text());
    const image = await response.json();
    const bytes = await readFile(resolve(f.directory, 'uploads', `community-image-${image.id}.webp`));
    assert.ok(bytes.length <= readerImageBytes);
    const metadata = await sharp(bytes, { animated: true }).metadata();
    assert.equal(metadata.pages, 10); assert.equal(metadata.loop, 3); assert.deepEqual(metadata.delay, delay); assert.equal(metadata.hasAlpha, true);
    assert.equal(image.width, metadata.width); assert.equal(image.height, metadata.pageHeight);
    assert.equal(f.store.image(image.id)?.purpose, 'shop');
    const thumbnail = await readFile(resolve(f.directory, 'uploads', `community-thumb-${image.id}.webp`));
    assert.equal((await sharp(thumbnail).metadata()).pages || 1, 1);
    assert.equal((await f.get(`images/${image.id}.webp`, 'reader')).status, 404);
  }
  assert.equal((await readdir(resolve(f.directory, 'incoming'))).length, 0);
});

test('bounded static uploads retain the existing q82 encoding exactly', async t => {
  const f = await setup(t);
  const input = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#4488aacc' } }).png().toBuffer();
  const baseline = await sharp(input, { limitInputPixels: 40_000_000, animated: false }).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer();
  const form = new FormData(); form.append('file', new Blob([Uint8Array.from(input)], { type: 'image/png' }), 'synthetic.png');
  const response = await fetch(`${f.origin}/api/community/images`, { method: 'POST', headers: { Cookie: 'reader', Origin: f.origin, 'X-Reader-Request': '1' }, body: form });
  assert.equal(response.status, 201, await response.clone().text());
  const image = await response.json();
  assert.deepEqual(await readFile(resolve(f.directory, 'uploads', `community-image-${image.id}.webp`)), baseline);
  assert.deepEqual([image.width, image.height], [80, 60]);
});

test('an encoder that cannot reach the byte limit fails before saving files or image registration', async t => {
  const f = await setup(t);
  const input = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#4488aacc' } }).png().toBuffer();
  const baseline = await sharp(input).webp().toBuffer({ resolveWithObject: true });
  const oversized = Buffer.concat([baseline.data, Buffer.alloc(readerImageBytes + 1)]);
  let encodes = 0;
  t.mock.method(sharp.prototype, 'toBuffer', (options?: { resolveWithObject?: boolean }) => {
    encodes++;
    return Promise.resolve(options?.resolveWithObject ? { data: oversized, info: baseline.info } : oversized);
  });
  const form = new FormData(); form.append('file', new Blob([Uint8Array.from(input)], { type: 'image/png' }), 'synthetic.png');
  const response = await fetch(`${f.origin}/api/community/images`, { method: 'POST', headers: { Cookie: 'reader', Origin: f.origin, 'X-Reader-Request': '1' }, body: form });
  assert.equal(response.status, 413); assert.match((await response.json()).error, /压缩到 2 MB/);
  assert.ok(encodes <= 6, 'one existing encode plus at most five compression attempts');
  assert.deepEqual(await readdir(resolve(f.directory, 'uploads')), []);
  assert.deepEqual(await readdir(resolve(f.directory, 'incoming')), []);
  const database = new DatabaseSync(resolve(f.directory, 'content.db'), { readOnly: true });
  try { assert.equal(database.prepare('SELECT COUNT(*) AS count FROM community_images').get()?.count, 0); }
  finally { database.close(); }
});
