import test from 'node:test';
import assert from 'node:assert/strict';
import { createUploadImagePreparer as createPreparer } from '../src/upload-image.ts';
// These are policy/queue tests. The actual header parser and actual codec have
// separate real-byte tests, so this suite isolates them as explicit dependencies.
const createUploadImagePreparer = (load: Parameters<typeof createPreparer>[0], timeoutMs = 45_000) => createPreparer(load, timeoutMs, async () => {});

const limit = 2 * 1024 ** 2;
const file = (size: number, type = 'image/png', name = 'art.png') => {
  const bytes = new Uint8Array(size);
  if (type === 'image/png' && size >= 16) bytes.set(new TextEncoder().encode('IDAT'), 12);
  return new File([bytes], name, { type });
};

test('small uploads retain exact bytes and do not load a compressor', async () => {
  let loads = 0;
  const prepare = createUploadImagePreparer(async () => { loads++; throw new Error('must stay lazy'); });
  const input = file(limit);
  assert.equal(await prepare(input), input);
  assert.equal(loads, 0);
});

test('large static uploads use the library and preserve transparent output and a matching extension', async () => {
  const calls: unknown[] = [];
  const prepare = createUploadImagePreparer(async () => ({ compressStaticImage: async (_file, options) => {
    calls.push(options);
    return file(1024, 'image/webp', 'ignored.png');
  } }));
  const output = await prepare(file(limit + 1));
  assert.equal(output.size, 1024);
  assert.equal(output.type, 'image/webp');
  assert.equal(output.name, 'art.webp');
  assert.deepEqual(calls, [{ maxWidth: 2048, maxHeight: 2048, quality: .92, mimeType: 'image/webp', convertTypes: [], retainExif: false }]);
});

test('the actual output size is checked and bounded retries continue from the original', async () => {
  const input = file(limit + 1, 'image/jpeg', 'photo.jpg');
  const sources: File[] = [];
  const prepare = createUploadImagePreparer(async () => ({ compressStaticImage: async (source) => {
    sources.push(source); return file(sources.length === 1 ? limit + 10 : limit, 'image/jpeg');
  } }));
  assert.equal((await prepare(input)).size, limit);
  assert.deepEqual(sources, [input, input]);
});

test('a library returning oversized, empty or unaccepted output cannot send it to the server', async () => {
  for (const output of [file(limit + 1), file(0), file(100, 'image/gif')]) {
    let calls = 0;
    const prepare = createUploadImagePreparer(async () => ({ compressStaticImage: async () => { calls++; return output; } }));
    await assert.rejects(prepare(file(limit + 1)), /图片/);
    assert.ok(calls <= 4);
  }
});

test('unknown file formats and originals over 25MiB fail before loading a library', async () => {
  let loads = 0;
  const prepare = createUploadImagePreparer(async () => { loads++; throw new Error('must not load'); });
  await assert.rejects(prepare(file(10, 'image/svg+xml')), /图片/);
  await assert.rejects(prepare(file(25 * 1024 ** 2 + 1)), /25MB/);
  assert.equal(loads, 0);
});

test('animated product artwork bypasses the static codec, and a forum cannot bypass its byte ceiling', async () => {
  let loads = 0;
  const prepare = createUploadImagePreparer(async () => { loads++; throw new Error('must not flatten'); });
  const gif = file(limit + 1, 'image/gif', 'frame.gif');
  assert.equal(await prepare(gif, { allowAnimation: true }), gif);
  const header = new Uint8Array(30);
  header.set(new TextEncoder().encode('RIFF'), 0); header.set(new TextEncoder().encode('WEBPVP8X'), 8); header[20] = 2;
  const webp = new File([header, new Uint8Array(limit)], 'frame.webp', { type: 'image/webp' });
  assert.equal(await prepare(webp, { allowAnimation: true }), webp);
  await assert.rejects(prepare(webp), /动态图/);
  assert.equal(loads, 0);
});

test('cancelled preparation never runs a codec or resolves as a successful upload', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const prepare = createUploadImagePreparer(async () => ({ compressStaticImage: async () => { calls++; return file(10); } }));
  await assert.rejects(prepare(file(limit + 1), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('concurrent uploads share one lazy import and decode one image at a time', async () => {
  let active = 0, highest = 0, loads = 0;
  const prepare = createUploadImagePreparer(async () => { loads++; return { compressStaticImage: async () => {
    active++; highest = Math.max(highest, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--; return file(10, 'image/webp');
  } }; });
  await Promise.all([prepare(file(limit + 1)), prepare(file(limit + 2)), prepare(file(limit + 3))]);
  assert.equal(loads, 1); assert.equal(highest, 1);
});

test('a failed library import is retryable rather than permanently poisoning uploads', async () => {
  let loads = 0;
  const prepare = createUploadImagePreparer(async () => {
    if (++loads === 1) throw new Error('network');
    return { compressStaticImage: async () => file(10, 'image/webp') };
  });
  await assert.rejects(prepare(file(limit + 1)), /network/);
  assert.equal((await prepare(file(limit + 1))).size, 10);
  assert.equal(loads, 2);
});

test('compression deadline ends a stalled library import and a later attempt can recover', async () => {
  let loads = 0;
  const prepare = createUploadImagePreparer(async () => {
    if (++loads === 1) return await new Promise(() => {});
    return { compressStaticImage: async () => file(10, 'image/webp') };
  }, 15);
  await assert.rejects(prepare(file(limit + 1)), /超时/);
  assert.equal((await prepare(file(limit + 1))).size, 10);
});

test('cancelling a queued picture rejects promptly and never lets it reach the codec', async () => {
  let finish: (() => void) | undefined;
  let calls = 0;
  const prepare = createUploadImagePreparer(async () => ({ compressStaticImage: async () => {
    calls++; if (calls === 1) await new Promise<void>(resolve => { finish = resolve; });
    return file(10, 'image/webp');
  } }));
  const first = prepare(file(limit + 1));
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  const controller = new AbortController();
  const second = prepare(file(limit + 2), { signal: controller.signal });
  controller.abort(); await assert.rejects(second, { name: 'AbortError' });
  finish(); await first;
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(calls, 1);
});

test('an APNG product cannot be silently flattened by static preparation', async () => {
  const header = new Uint8Array(28);
  new DataView(header.buffer).setUint32(8, 8); header.set(new TextEncoder().encode('acTL'), 12);
  const input = new File([header, new Uint8Array(limit)], 'animated.png', { type: 'image/png' });
  const prepare = createUploadImagePreparer(async () => { throw new Error('must not flatten'); });
  assert.equal(await prepare(input, { allowAnimation: true }), input);
  await assert.rejects(prepare(input), /动态图/);
});

test('unknown or corrupt PNG animation metadata cannot be treated as a static picture', async () => {
  const prepare = createUploadImagePreparer(async () => { throw new Error('must not flatten'); });
  await assert.rejects(prepare(new File([new Uint8Array(limit + 1)], 'unknown.png', { type: 'image/png' })), /动画信息/);
  const truncated = new Uint8Array(16); new DataView(truncated.buffer).setUint32(8, 0xffffffff);
  await assert.rejects(prepare(new File([truncated, new Uint8Array(limit)], 'bad.png', { type: 'image/png' })), /格式/);
});
