import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountCommunityComposeEditor } from '../src/community-compose-editor.ts';
import { editorHTML } from '../src/community-post.ts';
import { bodyImageContent } from '../src/community-body-images.ts';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const turn = () => new Promise(resolve => setTimeout(resolve, 25));
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function setup(t, content = '前文\n\n后文', request = async () => ({ ok: true, json: async () => ({ id }) }), owner = false, prepare = async file => file) {
  const dom = new JSDOM(`<form>${editorHTML({ id: 'community-body', rows: 10, value: content, placeholder: '正文', label: '正文', limits: [1, 10000], inlineImages: true, imageMax: 4 }, { t: zh => zh, esc })}</form>`, { pretendToBeVisual: true, url: 'http://localhost:4212/' });
  const w = dom.window;
  const names = ['window', 'document', 'Node', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  const calls = [];
  const wrapper = w.document.querySelector('[data-inline-editor]');
  const control = mountCommunityComposeEditor(wrapper, { t: zh => zh, owner, prepare, request: async (...args) => { calls.push(args); return request(...args); } });
  t.after(() => { control.destroy(); for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } w.close(); });
  const paste = (files, text = '') => {
    const event = new w.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files, items: [], getData: kind => kind === 'text/plain' ? text : '' } });
    control.editor.view.dom.dispatchEvent(event);
    return event;
  };
  const file = (name = 'image.png', type = 'image/png') => Object.assign(new Blob(['fixture'], { type }), { name });
  return { w, control, calls, wrapper, paste, file };
}

test('an oversized pasted image is rejected before preparation or upload; surrounding text is kept', async t => {
  const { wrapper, control, paste, calls } = setup(t, '原文');
  const large = Object.assign(new Blob([new Uint8Array(25 * 1024 ** 2 + 1)], { type: 'image/png' }), { name: 'large.png' });
  paste([large], '粘贴文字');
  await turn();
  assert.equal(calls.length, 0);
  assert.match(wrapper.querySelector('[role=status]').textContent, /25MB/);
  assert.match(control.field.value, /粘贴文字/);
  assert.equal(wrapper.querySelector('.community-inline-upload'), null);
});

test('a reader large image is prepared before upload and retains its inline position and converted filename', async t => {
  const preparations = [];
  const compressed = new File(['compressed'], 'large.webp', { type: 'image/webp' });
  const { control, paste, calls } = setup(t, '前文', undefined, false, async (source, signal) => {
    preparations.push({ source, signal }); return compressed;
  });
  const original = new File([new Uint8Array(3 * 1024 ** 2)], 'large.png', { type: 'image/png' });
  paste([original], '粘贴文字'); await turn();
  assert.equal(preparations.length, 1);
  assert.equal(preparations[0].source, original);
  assert.equal(preparations[0].signal.aborted, false);
  assert.equal(calls.length, 1);
  const sent = calls[0][1].body.get('file');
  assert.equal(sent.name, 'large.webp'); assert.equal(sent.size, compressed.size);
  assert.match(control.field.value, /粘贴文字/);
  assert.match(control.field.value, new RegExp(id));
});

test('a malformed preparation result exceeding the reader ceiling never uploads', async t => {
  const { control, paste, calls, file } = setup(t, '前文', undefined, false, async () => new File([new Uint8Array(2 * 1024 ** 2 + 1)], 'large.webp', { type: 'image/webp' }));
  paste([file()]); await turn();
  assert.equal(calls.length, 0); assert.equal(control.state().failed, true);
});

test('the author can paste an image above the reader limit, and a reset clears the rich editor', async t => {
  const { control, paste, calls } = setup(t, '说明', undefined, true);
  const large = Object.assign(new Blob([new Uint8Array(6 * 1024 ** 2)], { type: 'image/png' }), { name: 'large.png' });
  paste([large]);
  await turn();
  assert.equal(calls.length, 1);
  control.clear();
  assert.equal(control.field.value, '');
  assert.equal(control.editor.isEmpty, true);
});

test('pasting an image at the caret uploads inline, preserves surrounding text and survives undo/redo', async t => {
  let finish;
  const { control, wrapper, paste, file } = setup(t, '前文\n\n后文', async () => new Promise(resolve => { finish = resolve; }));
  control.editor.commands.setTextSelection(3);
  const event = paste([file()]);
  assert.equal(event.defaultPrevented, true);
  await turn();
  assert.equal(control.state().pending, true);
  assert.ok(wrapper.querySelector('.community-inline-upload'));
  finish({ ok: true, json: async () => ({ id }) }); await turn();
  assert.equal(control.state().pending, false);
  assert.deepEqual(bodyImageContent(control.field.value).images, [id]);
  assert.ok(control.field.value.indexOf('前文') < control.field.value.indexOf(id));
  assert.ok(control.field.value.indexOf(id) < control.field.value.indexOf('后文'));
  control.editor.commands.undo(); await turn();
  assert.deepEqual(bodyImageContent(control.field.value).images, []);
  control.editor.commands.redo(); await turn();
  assert.deepEqual(bodyImageContent(control.field.value).images, [id]);
  assert.equal(control.state().pending, false);
});

test('deleting an uploading image never resurrects it when the request finishes', async t => {
  let finish;
  const { control, wrapper, paste, file } = setup(t, '正文', async () => new Promise(resolve => { finish = resolve; }));
  paste([file()]); await turn();
  wrapper.querySelector('.community-inline-remove').click();
  finish({ ok: true, json: async () => ({ id }) }); await turn();
  assert.equal(wrapper.querySelector('.community-inline-upload'), null);
  assert.deepEqual(bodyImageContent(control.field.value).images, []);
  assert.equal(control.field.value, '正文');
});

test('clipboard videos are rejected, plain text paste is untouched, and image-only content is not body text', async t => {
  const { control, wrapper, calls, paste, file } = setup(t, '');
  paste([file('movie.mp4', 'video/mp4')]); await turn();
  assert.equal(calls.length, 0); assert.match(wrapper.textContent, /不支持视频/);
  assert.equal(paste([], '普通文字').defaultPrevented, true); // ProseMirror handles native text paste.
  assert.equal(control.editor.getText().trim(), '普通文字');
  control.editor.commands.clearContent();
  paste([file()]); await turn();
  assert.equal(bodyImageContent(control.field.value).text.trim(), '');
  assert.deepEqual(bodyImageContent(control.field.value).images, [id]);
});

test('image upload errors remain visible and remote pasted images cannot be imported', async t => {
  const { control, wrapper, paste, file } = setup(t, '正文', async () => ({ ok: false, json: async () => ({ error: '上传失败，请重试' }) }));
  paste([file()]); await turn();
  assert.equal(control.state().failed, true); assert.match(wrapper.textContent, /上传失败/);
  wrapper.querySelector('.community-inline-remove').click();
  assert.equal(control.state().failed, false);
  control.editor.commands.insertContent('<img src="https://remote.invalid/photo.png"><video src="/v.mp4"></video>');
  assert.equal(wrapper.querySelector('img, video'), null);
});

test('undo during upload and redo after completion restores the finished image instead of a stuck placeholder', async t => {
  let finish;
  const { control, paste, file } = setup(t, '正文', async () => new Promise(resolve => { finish = resolve; }));
  paste([file()]); await turn();
  control.editor.commands.undo();
  finish({ ok: true, json: async () => ({ id }) }); await turn();
  assert.deepEqual(bodyImageContent(control.field.value).images, []);
  control.editor.commands.redo(); await turn();
  assert.deepEqual(bodyImageContent(control.field.value).images, [id]);
  assert.equal(control.state().pending, false);
});

test('pending pictures count toward the limit and late responses cannot update an unmounted editor', async t => {
  const pending = [];
  const { control, wrapper, paste, file, calls } = setup(t, '正文', async () => new Promise(resolve => pending.push(resolve)));
  paste(Array.from({ length: 5 }, () => file())); await turn();
  assert.equal(calls.length, 4);
  assert.equal(wrapper.querySelectorAll('.community-inline-upload').length, 4);
  assert.match(wrapper.textContent, /最多 4 张/);
  const body = control.field.value;
  control.destroy();
  assert.ok(calls.every(([, options]) => options.signal.aborted));
  pending.forEach(resolve => resolve({ ok: true, json: async () => ({ id }) }));
  await turn();
  assert.equal(control.field.value, body);
});

test('the first body picture is marked as the cover and removing it promotes the next picture', async t => {
  const ids = [id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  const { control, wrapper, paste, file } = setup(t, '正文', async () => ({ ok: true, json: async () => ({ id: ids.shift() }) }));
  paste([file(), file()]); await turn();
  const pictures = [...wrapper.querySelectorAll('.community-inline-upload')];
  assert.deepEqual(pictures.map(node => node.dataset.cover), ['true', 'false']);
  pictures[0].querySelector('button').click(); await turn();
  assert.equal(wrapper.querySelector('.community-inline-upload').dataset.cover, 'true');
  assert.equal(bodyImageContent(control.field.value).images[0], 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
});
