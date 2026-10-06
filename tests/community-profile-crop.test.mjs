import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const common = { t: zh => zh, esc: value => String(value).replaceAll('<', '&lt;') };
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
let w, createCommunityProfileCrop, CropperSelection, CropperImage;
const saved = new Map(), created = [], revoked = [], sources = new Map(), exports = [];
let encode = (callback, type) => callback(new w.Blob(['encoded-webp'], { type }));

test.before(async () => {
  w = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true }).window;
  for (const name of ['window', 'document', 'Image', 'HTMLElement', 'Element', 'Node', 'HTMLImageElement', 'HTMLCanvasElement', 'CustomEvent', 'Event', 'customElements', 'getComputedStyle']) {
    saved.set(name, globalThis[name]); globalThis[name] = name === 'window' ? w : w[name];
  }
  w.URL.createObjectURL = file => { const url = `blob:crop-${created.length + 1}`; created.push(url); sources.set(url, file); return url; };
  w.URL.revokeObjectURL = url => revoked.push(url);
  const dimensions = img => /portrait/.test(sources.get(img.src)?.name || '') ? [900, 2400] : [3600, 1800];
  Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.localName === 'cropper-canvas' ? 600 : 0; } });
  Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.localName === 'cropper-canvas' ? 360 : 0; } });
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const image = this.localName === 'cropper-image' ? this : this.localName === 'img' ? this.closest('cropper-image') || this.getRootNode()?.host : null;
    let left = 0, top = 0, width = 600, height = 360;
    if (image?.localName === 'cropper-image') {
      const candidate = image.style.transform.match(/^matrix\((.+)\)$/)?.[1].split(',').map(Number);
      const [nw, nh] = dimensions(image.$image), [a, , , d, e, f] = candidate || image.$getTransform();
      width = nw * a; height = nh * d; left = (600 - width) / 2 + e; top = (360 - height) / 2 + f;
    }
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() { return this; } };
  };
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, save() {}, translate() {}, transform() {}, drawImage() {}, restore() {} });
  w.HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) { exports.push({ width: this.width, height: this.height, type, quality }); encode(callback, type, quality); };
  ({ createCommunityProfileCrop } = await import('../src/community-profile-crop.mjs'));
  ({ CropperSelection, CropperImage } = await import('cropperjs'));
});
test.after(() => { w.close(); for (const [name, value] of saved) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });

async function open(t, kind = 'avatar', filename = 'landscape.png', broken = false) {
  const container = w.document.createElement('div'); w.document.body.append(container);
  const uses = [], cancels = [];
  const file = new w.File(['original'], filename, { type: 'image/png' });
  const pending = createCommunityProfileCrop({ container, kind, file, common, onUse: file => uses.push(file), onCancel: () => cancels.push(true) });
  await settle();
  const image = container.querySelector('cropper-image');
  const [nw, nh] = /portrait/.test(filename) ? [900, 2400] : [3600, 1800];
  Object.defineProperties(image.$image, { complete: { configurable: true, value: true }, naturalWidth: { configurable: true, value: broken ? 0 : nw }, naturalHeight: { configurable: true, value: broken ? 0 : nh } });
  image.$image.dispatchEvent(new w.Event(broken ? 'error' : 'load'));
  if (broken) { t.after(() => container.remove()); return { pending, container }; }
  const session = await pending;
  t.after(() => { session.destroy(); container.remove(); encode = (callback, type) => callback(new w.Blob(['encoded-webp'], { type })); });
  return { container, image, selection: container.querySelector('cropper-selection'), session, uses, cancels, file };
}
const button = (container, action) => container.querySelector(`[data-profile-crop-action="${action}"]`);

test('real Cropper 2 elements allow portrait source movement and keep the avatar selection square', async t => {
  const { container, selection, image, uses } = await open(t, 'avatar', 'portrait.png');
  assert.ok(selection instanceof CropperSelection); assert.ok(image instanceof CropperImage);
  assert.equal(selection.aspectRatio, 1); assert.equal(selection.movable, true); assert.equal(selection.resizable, true);
  assert.equal(container.querySelectorAll('cropper-selection').length, 1);
  selection.$resize('se-resize', -10, -20); assert.equal(selection.width, selection.height);
  button(container, 'zoom-in').click(); button(container, 'zoom-out').click();
  button(container, 'use').click(); await settle();
  assert.equal(uses.length, 1); assert.equal(uses[0].type, 'image/webp');
  assert.ok(uses[0].size <= 2 * 1024 ** 2);
  assert.deepEqual([exports.at(-1).width, exports.at(-1).height], [320, 320]);
});

test('background starts landscape but its real library selection can change to a portrait aspect', async t => {
  const { container, selection, image, uses } = await open(t, 'background');
  assert.ok(Number.isNaN(selection.aspectRatio)); assert.ok(selection.initialAspectRatio > 1);
  assert.ok(selection.width > selection.height);
  const bounds = image.getBoundingClientRect();
  selection.$change(bounds.left + 10, bounds.top + 10, 120, 220);
  assert.deepEqual([selection.width, selection.height], [120, 220]);
  button(container, 'use').click(); await settle();
  assert.equal(uses.length, 1);
  const { width, height } = exports.at(-1); assert.ok(height > width); assert.ok(Math.max(width, height) <= 2048);
  assert.ok(Math.abs(width / height - 120 / 220) < 0.01);
});

test('selection/image bounds prevent blank-space cropping and keyboard zoom is scoped to the crop canvas', async t => {
  const { container, selection, image } = await open(t, 'background');
  const before = [selection.x, selection.y, selection.width, selection.height];
  selection.$change(-1000, -1000, 40, 40); assert.deepEqual([selection.x, selection.y, selection.width, selection.height], before);
  const transform = image.$getTransform(); image.$move(10000, 10000); assert.deepEqual(image.$getTransform(), transform);
  const stage = container.querySelector('[data-profile-crop-stage]'); stage.focus();
  stage.dispatchEvent(new w.KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }));
  assert.ok(image.$getTransform()[0] > transform[0]);
  const next = image.$getTransform(); w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: '+', bubbles: true }));
  assert.deepEqual(image.$getTransform(), next, 'outside keyboard events do not operate a hidden/global selection');
});

test('reset restores the contained source and default selection after image movement and zoom', async t => {
  const { container, selection, image } = await open(t, 'background');
  const initial = image.$getTransform(), initialSelection = [selection.x, selection.y, selection.width, selection.height];
  button(container, 'zoom-in').click(); image.$move(10, 10);
  selection.$change(10, 20, 120, 120);
  assert.notDeepEqual(image.$getTransform(), initial);
  button(container, 'reset').click();
  assert.deepEqual(image.$getTransform(), initial);
  assert.deepEqual([selection.x, selection.y, selection.width, selection.height], initialSelection);
});

test('failed canvas encoding keeps the crop interface and supports another use attempt', async t => {
  const { container, uses } = await open(t);
  encode = callback => callback(null);
  button(container, 'use').click(); await settle();
  assert.equal(uses.length, 0); assert.ok(container.querySelector('cropper-canvas'));
  assert.match(container.querySelector('[data-profile-crop-status]').textContent, /未能|失败/);
  assert.equal(button(container, 'use').disabled, false);
  encode = (callback, type) => callback(new w.Blob(['valid'], { type }));
  button(container, 'use').click(); await settle(); assert.equal(uses.length, 1);
});

test('oversized output is compressed before returning a local WebP file within the existing reader limit', async t => {
  const { container, uses } = await open(t, 'background');
  let calls = 0;
  encode = (callback, type) => callback(new w.Blob([new Uint8Array(++calls === 1 ? 2 * 1024 ** 2 + 1 : 100)], { type }));
  button(container, 'use').click(); await settle();
  assert.equal(uses.length, 1); assert.ok(calls > 1); assert.ok(uses[0].size <= 2 * 1024 ** 2);
});

test('cancel/destroy release the original URL once and ignore a late canvas export', async t => {
  const { container, session, uses, cancels, image } = await open(t);
  const url = created.at(-1); let complete;
  encode = callback => { complete = callback; };
  button(container, 'use').click(); await settle();
  const retainedUse = button(container, 'use'), retainedCancel = button(container, 'cancel');
  retainedCancel.click(); session.destroy(); complete(new w.Blob(['late'], { type: 'image/webp' })); await settle();
  retainedUse.click(); retainedCancel.click();
  assert.equal(uses.length, 0); assert.equal(cancels.length, 1);
  assert.equal(revoked.filter(value => value === url).length, 1); assert.equal(container.querySelector('cropper-canvas'), null);
  assert.equal(image.$image.hasAttribute('src'), false);
});

test('removing the local editor during decode cancels pending work and releases its object URL', { timeout: 1000 }, async t => {
  const container = w.document.createElement('div'); w.document.body.append(container); t.after(() => container.remove());
  const uses = [], cancels = [];
  const pending = createCommunityProfileCrop({ container, kind: 'avatar', file: new w.File(['not-yet-decoded'], 'slow.png', { type: 'image/png' }), common, onUse: file => uses.push(file), onCancel: () => cancels.push(true) });
  const rejection = assert.rejects(pending, /图片|取消/), url = created.at(-1), image = container.querySelector('cropper-image');
  container.remove(); await rejection;
  assert.equal(uses.length, 0); assert.equal(cancels.length, 0);
  assert.equal(revoked.filter(value => value === url).length, 1);
  assert.equal(container.querySelector('cropper-canvas'), null); assert.equal(image.$image.hasAttribute('src'), false);
});

test('an output that remains over the reader limit never reaches onUse and can be retried', async t => {
  const { container, uses } = await open(t, 'background');
  encode = (callback, type) => callback(new w.Blob([new Uint8Array(2 * 1024 ** 2 + 1)], { type }));
  button(container, 'use').click(); await settle();
  assert.equal(uses.length, 0); assert.ok(container.querySelector('cropper-canvas'));
  assert.equal(button(container, 'use').disabled, false);
  assert.match(container.querySelector('[data-profile-crop-status]').textContent, /超过 2 MB/);
});

test('WebP export support and image decode errors are human readable and never return misleading image data', async t => {
  const { container, uses } = await open(t);
  encode = callback => callback(new w.Blob(['fallback'], { type: 'image/png' }));
  button(container, 'use').click(); await settle(); assert.equal(uses.length, 0);
  assert.match(container.querySelector('[data-profile-crop-status]').textContent, /WebP|浏览器/);
  const broken = await open(t, 'avatar', 'broken.png', true), url = created.at(-1);
  await assert.rejects(broken.pending, /图片.*(?:无法|未能|不能).*读取|图片.*失败/);
  assert.equal(revoked.filter(value => value === url).length, 1); assert.equal(broken.container.querySelector('cropper-canvas'), null);
});
