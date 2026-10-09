import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunityImageCompressError, compressCommunityImage } from '../src/community-image-compress.ts';

const cap = 2 * 1024 ** 2;
const picture = (bytes, name = 'photo.png', type = 'image/png') => new File([new Uint8Array(bytes)], name, { type });
// A stand-in encoder: output size follows the pixel count and quality, as a real one roughly does.
function codec({ width, height, bytesPerPixel = 1, type: forced } = {}) {
  const log = { decoded: 0, closed: 0, encodes: [] };
  return {
    log,
    decode: async () => {
      log.decoded++;
      return {
        width, height,
        encode: async (w, h, type, quality) => { log.encodes.push({ w, h, type, quality }); return new Blob([new Uint8Array(Math.round(w * h * quality * bytesPerPixel))], { type: forced || type }); },
        close: () => { log.closed++; },
      };
    },
  };
}

test('a picture already within the limit is returned untouched, without decoding it', async () => {
  const { decode, log } = codec({ width: 4000, height: 3000 });
  const file = picture(cap);
  assert.equal(await compressCommunityImage(file, cap, decode), file);
  assert.equal(log.decoded, 0);
});

test('an oversized picture is scaled to the 2048 edge the server keeps and re-encoded as WebP', async () => {
  const { decode, log } = codec({ width: 6000, height: 4000, bytesPerPixel: 0.3 });
  const result = await compressCommunityImage(picture(cap + 1, '我的 截图.final.png'), cap, decode);
  assert.deepEqual(log.encodes, [{ w: 2048, h: 1365, type: 'image/webp', quality: 0.86 }]);
  assert.equal(result.type, 'image/webp');
  assert.equal(result.name, '我的 截图.final.webp');
  assert.ok(result.size <= cap);
  assert.equal(log.closed, 1);
});

test('a picture smaller than 2048 is never enlarged', async () => {
  const { decode, log } = codec({ width: 1200, height: 900, bytesPerPixel: 0.5 });
  await compressCommunityImage(picture(cap + 1), cap, decode);
  assert.deepEqual([log.encodes[0].w, log.encodes[0].h], [1200, 900]);
});

test('quality is lowered first, then the edge, until the picture fits', async () => {
  const { decode, log } = codec({ width: 4096, height: 4096, bytesPerPixel: 1 });
  const result = await compressCommunityImage(picture(cap + 1), cap, decode);
  const tried = log.encodes.map(step => `${step.w}@${step.quality}`);
  assert.deepEqual(tried.slice(0, 4), ['2048@0.86', '2048@0.74', '2048@0.62', '1600@0.86']);
  assert.ok(result.size <= cap);
  assert.ok(log.encodes.at(-1).w < 2048);
  assert.equal(log.closed, 1);
});

test('a browser that cannot write WebP falls back to JPEG, with a matching name and type', async () => {
  const log = { types: [] };
  const decode = async () => ({
    width: 3000, height: 2000,
    encode: async (w, h, type, quality) => { log.types.push(type); return new Blob([new Uint8Array(Math.round(w * h * quality * 0.3))], { type: type === 'image/webp' ? 'image/png' : type }); },
    close() {},
  });
  const result = await compressCommunityImage(picture(cap + 1, 'shot.png'), cap, decode);
  assert.deepEqual(log.types.slice(0, 2), ['image/webp', 'image/jpeg']);
  assert.equal(result.type, 'image/jpeg');
  assert.equal(result.name, 'shot.jpg');
});

test('a picture that cannot be brought under the limit, or cannot be read, fails with its reason and releases the bitmap', async () => {
  const stubborn = codec({ width: 2048, height: 2048, bytesPerPixel: 4 });
  await assert.rejects(compressCommunityImage(picture(cap + 1), cap, stubborn.decode), error => error instanceof CommunityImageCompressError && error.reason === 'too-large');
  assert.equal(stubborn.log.closed, 1);
  await assert.rejects(compressCommunityImage(picture(cap + 1), cap, async () => { throw new Error('decode failed'); }), error => error instanceof CommunityImageCompressError && error.reason === 'unreadable');
  const blank = async () => ({ width: 3000, height: 2000, encode: async () => null, close() {} });
  await assert.rejects(compressCommunityImage(picture(cap + 1), cap, blank), error => error.reason === 'unreadable');
});
