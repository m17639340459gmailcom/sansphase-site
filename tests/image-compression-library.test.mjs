import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// Exercise the actual installed CompressorJS, with a Node-only canvas adapter.
// This verifies the integration/bytes; it is not a browser performance benchmark.
const urls = new Map();
let canvasMode = 'normal';
let canvasGate;
class ImageAdapter {
  complete = false;
  set src(value) {
    this.url = value;
    if (!value) return;
    void (async () => {
      const bytes = Buffer.from(await (urls.has(value) ? urls.get(value).arrayBuffer() : fetch(value).then(r => r.arrayBuffer())));
      const metadata = await sharp(bytes).metadata();
      this.bytes = bytes; this.naturalWidth = metadata.width; this.naturalHeight = metadata.height;
      this.width = metadata.width; this.height = metadata.height; this.complete = true;
      this.onload?.();
    })().catch(() => this.onerror?.());
  }
  get src() { return this.url || ''; }
}
class ReaderAdapter {
  readAsArrayBuffer(file) {
    void file.arrayBuffer().then(result => { this.result = result; this.onload?.({ target: this }); this.onloadend?.(); });
  }
  abort() { this.onabort?.(); }
}
class CanvasAdapter {
  width = 1; height = 1; rotation = 0;
  getContext() {
    return { fillRect() {}, save() {}, restore() {}, translate() {}, scale() {},
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: imageData => { this.imageData = imageData; },
      getImageData: () => this.imageData,
      rotate: radians => { this.rotation = Math.round(radians * 180 / Math.PI); },
      drawImage: image => { this.image = image; },
    };
  }
  toBlob(callback, type, quality) {
    void (async () => {
      if (canvasGate) await canvasGate;
      if (canvasMode === 'null') { callback(null); return; }
      if (canvasMode === 'oversized') { callback(new Blob([new Uint8Array(3 * 1024 ** 2)], { type })); return; }
      const codec = sharp(this.image.bytes).rotate(this.rotation).resize(this.width, this.height, { fit: 'fill' });
      const encoded = type === 'image/jpeg' ? await codec.jpeg({ quality: Math.round(quality * 100) }).toBuffer()
        : canvasMode === 'png-fallback' ? await codec.png().toBuffer() : await codec.webp({ quality: Math.round(quality * 100) }).toBuffer();
      callback(new Blob([encoded], { type: canvasMode === 'png-fallback' ? 'image/png' : type }));
    })().catch(error => { process.stderr.write(`Canvas adapter error: ${error.message}\n`); callback(null); });
  }
}
const document = { createElement: () => new CanvasAdapter() };
globalThis.window = { document, btoa, atob, navigator: { userAgent: 'Node canvas adapter' }, URL: {
  createObjectURL(file) { const url = `blob:test-${urls.size}-${Math.random()}`; urls.set(url, file); return url; },
  revokeObjectURL(url) { urls.delete(url); },
}, FileReader: ReaderAdapter, ArrayBuffer, HTMLCanvasElement: CanvasAdapter, Blob };
globalThis.document = document; globalThis.Image = ImageAdapter;
// The narrow fail/abort cleanup uses the browser global URL API too.
const revoke = URL.revokeObjectURL;
URL.revokeObjectURL = url => { urls.delete(url); };
const { compressStaticImage } = await import('../src/image-compression-library.ts');
const { prepareUploadImage } = await import('../src/upload-image.ts');
const options = { maxWidth: 2048, maxHeight: 2048, quality: .92, mimeType: 'image/webp', convertTypes: [], retainExif: false };
test.after(() => { URL.revokeObjectURL = revoke; });

test('the pinned actual codec preserves alpha and respects the configured display dimensions', async () => {
  const bytes = await sharp({ create: { width: 2400, height: 1200, channels: 4, background: '#34567880' } }).png().toBuffer();
  const input = new File([bytes], 'transparent.png', { type: 'image/png' });
  const output = await compressStaticImage(input, options, new AbortController().signal);
  const metadata = await sharp(Buffer.from(await output.arrayBuffer())).metadata();
  assert.equal(output.type, 'image/webp'); assert.equal(metadata.width, 2048); assert.equal(metadata.height, 1024);
  assert.equal(metadata.hasAlpha, true); assert.equal(urls.size, 0);
});

test('the actual codec handles EXIF 6 and 8 once and strips private camera metadata', async () => {
  for (const orientation of [6, 8]) {
    const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#789abc' } }).jpeg().withMetadata({ orientation }).toBuffer();
    const output = await compressStaticImage(new File([bytes], 'camera.jpg', { type: 'image/jpeg' }), { ...options, mimeType: 'image/jpeg' }, new AbortController().signal);
    const metadata = await sharp(Buffer.from(await output.arrayBuffer())).metadata();
    assert.equal(metadata.width, 80); assert.equal(metadata.height, 120); assert.equal(metadata.orientation, undefined);
    assert.equal(urls.size, 0);
  }
});

test('null browser encoding can return the original: the caller must still enforce its size limit', async () => {
  canvasMode = 'null';
  try {
    const bytes = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#34567880' } }).png().toBuffer();
    const input = new File([bytes], 'transparent.png', { type: 'image/png' });
    assert.equal(await compressStaticImage(input, options, new AbortController().signal), input);
    assert.equal(urls.size, 0);
  } finally { canvasMode = 'normal'; }
});

test('cancel during encoding rejects late success and releases the codec input URL', async () => {
  let finish; canvasGate = new Promise(resolve => { finish = resolve; });
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#34567880' } }).png().toBuffer();
  const controller = new AbortController();
  const pending = compressStaticImage(new File([bytes], 'transparent.png', { type: 'image/png' }), options, controller.signal);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(urls.size, 1); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(urls.size, 0);
  canvasGate = undefined; finish();
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(urls.size, 0);
});

test('invalid image bytes fail without retaining an object URL', async () => {
  await assert.rejects(compressStaticImage(new File(['broken'], 'bad.png', { type: 'image/png' }), options, new AbortController().signal));
  assert.equal(urls.size, 0);
});

test('even a tiny file declaring hundreds of megapixels fails before a preview or codec decode', async () => {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#34567880' } }).png().toBuffer();
  bytes.writeUInt32BE(100_000, 16); bytes.writeUInt32BE(100_000, 20);
  const input = new File([bytes], 'huge.png', { type: 'image/png' });
  assert.ok(input.size < 2 * 1024 ** 2);
  await assert.rejects(prepareUploadImage(input), /分辨率过大/); assert.equal(urls.size, 0);
});

test('a transparent PNG falsely labelled JPEG is rejected before white-background conversion', async () => {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#34567880' } }).png().toBuffer();
  await assert.rejects(prepareUploadImage(new File([bytes], 'fake.jpg', { type: 'image/jpeg' })), /内容与格式不一致/);
  assert.equal(urls.size, 0);
});
