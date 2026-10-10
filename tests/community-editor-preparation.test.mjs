import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';
import { editorHTML } from '../src/community-post.ts';
import * as richModule from '../src/community-compose-editor.ts';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { typedBrowserModules } from '../scripts/typed-browser-modules.mjs';
import { uploadImageFile } from './fixtures/upload-image-file.mjs';

const flush = async () => { for (let i = 0; i < 12; i++) await setImmediate(); };
const waitFor = async (ready, message) => {
  const started = performance.now();
  while (!ready() && performance.now() - started < 2000) await setImmediate();
  assert.ok(ready(), message);
};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const response = value => ({ ok: true, json: async () => structuredClone(value) });
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
async function setup(t, load = deferred(), handle = () => null) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 10) });
  const w = new JSDOM('<main></main><button id="outside">外部按钮</button>', { url: 'http://localhost/#/post/p1', pretendToBeVisual: true }).window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  w.scrollTo = () => {};
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  const person = { name: '读者', uid: '10001', owner: false, vip: false, level: 2, agreed: true, inventory: {}, unread: {} };
  const thread = { topic: { id: 'p1', board: 'qa', title: '讨论', body: '正文', author: person, canReply: true, images: [] }, author: person, related: [], replies: [{ id: 'r1', body: '原回复', author: person, createdAt: '2026-10-05T01:00:00Z', canEdit: true }] };
  const calls = []; let loads = 0, currentLoad = load;
  const ui = createCommunityUI({ loadComposeEditor: () => { loads++; return currentLoad.promise; }, request: async (url, init = {}) => {
    calls.push({ url, init });
    const supplied = handle(url, init); if (supplied) return supplied;
    if (url.endsWith('/me')) return response(person);
    if (url.endsWith('/topics/p1')) return response(thread);
    if (url.endsWith('/topics/p1/replies')) return response({ id: 'r2' });
    if (url.endsWith('/summary')) return response({ total: 1, repliesToday: 1, checkinsToday: 0, boards: {}, tags: {}, hot: [] });
    throw Error(`Unexpected ${url}`);
  } });
  const main = w.document.querySelector('main');
  const ctx = { t: zh => zh, esc, icons: {}, members: true, simpleCompose: true };
  main.innerHTML = ui.html(ctx); let cleanup = ui.mount(main, ctx); await flush();
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });
  const tick = async ms => { t.mock.timers.tick(ms); await flush(); };
  const root = () => main.querySelector('.community-reply-form [data-inline-editor]');
  const send = () => root().closest('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const type = value => { root().querySelector('textarea').value = value; root().querySelector('textarea').dispatchEvent(new w.Event('input', { bubbles: true })); };
  const remount = async hash => { w.history.replaceState(null, '', hash); cleanup(); main.innerHTML = ui.html(ctx); cleanup = ui.mount(main, ctx); await flush(); };
  return { w, main, ui, calls, load, tick, root, send, type, remount, loads: () => loads, setLoad: next => { currentLoad = next; } };
}

test('inline editor HTML is gated before mounting while legacy plain editors are unchanged', () => {
  const opts = { id: 'community-body', rows: 4, value: '已有草稿', label: '正文', placeholder: '正文', limits: [1, 10000] };
  const w = new JSDOM(editorHTML({ ...opts, inlineImages: true, imageMax: 4 }, { t: zh => zh, esc })).window;
  const root = w.document.querySelector('[data-inline-editor]');
  assert.equal(root.getAttribute('aria-busy'), 'true');
  assert.equal(root.querySelector('textarea').disabled, true);
  assert.equal(root.querySelector('input[type=file]').disabled, true);
  assert.ok([...root.querySelectorAll('button')].every(button => button.disabled));
  assert.match(root.querySelector('[role=status]').textContent, /准备/);
  assert.equal(root.querySelector('textarea').value, '已有草稿');
  assert.doesNotMatch(editorHTML(opts, { t: zh => zh, esc }), /disabled|aria-busy|data-inline-editor/);
  w.close();
});

test('actual UI imports immediately but blocks text, image, formatting, preview and submission until rich is ready', async t => {
  const f = await setup(t); const root = f.root(), field = root.querySelector('textarea');
  assert.equal(f.loads(), 1, 'the seam preserves immediate import, not lazy loading');
  assert.equal(field.disabled, true);
  assert.equal(root.getAttribute('aria-busy'), 'true');
  field.value = '恢复的有效草稿';
  f.send(); await flush();
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 0);
  assert.match(root.closest('form').querySelector('.community-form-status').textContent, /准备/);
  root.querySelector('[data-action="community-md"]').dispatchEvent(new f.w.Event('click', { bubbles: true }));
  root.querySelector('[data-action="community-md-preview"]').dispatchEvent(new f.w.Event('click', { bubbles: true }));
  assert.equal(field.value, '恢复的有效草稿'); assert.equal(field.hidden, false);
  f.load.resolve(richModule); await flush();
  assert.equal(field.hidden, true); assert.equal(field.disabled, false);
  assert.notEqual(root.getAttribute('aria-busy'), 'true');
  assert.equal(root.querySelector('input[type=file]').disabled, false);
  assert.equal(root.querySelector('.community-rich-body').textContent, '恢复的有效草稿');
});

test('failed import recovers stable native text with explicit retry and keeps images disabled', async t => {
  const f = await setup(t); f.load.reject(Error('module failed')); await flush();
  const root = f.root(), field = root.querySelector('textarea');
  assert.equal(field.disabled, false); assert.equal(field.hidden, false);
  assert.equal(root.querySelector('input[type=file]').disabled, true);
  assert.ok(root.querySelector('[data-community-editor-retry]'));
  assert.notEqual(root.getAttribute('aria-busy'), 'true');
  f.type('保留的正文 **格式**');
  f.main.querySelector('[data-action="community-quote"]').click(); await flush();
  assert.equal(f.root(), root, 'failed native editor is retained during quote repaint');
  assert.equal(field.value, '保留的正文 **格式**'); assert.equal(f.loads(), 1);
  const next = deferred(); f.setLoad(next); root.querySelector('[data-community-editor-retry]').click(); await f.tick(0);
  assert.equal(field.disabled, true); assert.equal(f.loads(), 2);
  next.resolve(richModule); await flush();
  assert.equal(field.hidden, true); assert.equal(field.value, '保留的正文 **格式**');
});

test('10s timeout restores text and late original module never replaces active fallback', async t => {
  const f = await setup(t); await f.tick(9999); assert.equal(f.root().querySelector('textarea').disabled, true);
  await f.tick(1); const root = f.root(), field = root.querySelector('textarea');
  assert.equal(field.disabled, false); assert.ok(root.querySelector('[data-community-editor-retry]'));
  f.type('超时后中文😀草稿'); field.focus(); field.setSelectionRange(4, 6);
  f.load.resolve(richModule); await flush();
  assert.equal(field.hidden, false); assert.equal(f.w.document.activeElement, field);
  assert.equal(field.selectionStart, 4); assert.equal(field.selectionEnd, 6);
  assert.equal(root.querySelector('.community-rich-body'), null);
});

test('quote repaint preserves pending root and only still-focused loading status receives rich focus', async t => {
  const f = await setup(t); const root = f.root();
  f.main.querySelector('[data-action="community-quote"]').click(); await flush();
  assert.equal(f.root(), root);
  assert.equal(f.w.document.activeElement, root.querySelector('[role=status]'));
  f.w.document.querySelector('#outside').focus();
  f.load.resolve(richModule); await flush();
  assert.equal(f.w.document.activeElement.id, 'outside', 'module arrival must not steal external focus');
});

test('explicit reply focus hands off from the still-focused preparation status to the ready rich editor', async t => {
  const f = await setup(t), root = f.root();
  f.main.querySelector('[data-action="community-quote"]').click(); await flush();
  assert.equal(f.w.document.activeElement, root.querySelector('[role=status]'));
  f.load.resolve(richModule); await flush();
  assert.equal(f.w.document.activeElement, root.querySelector('.community-rich-body'));
});

for (const outcome of ['failure', 'timeout']) for (const external of [false, true]) {
  test(`${outcome} returns still-focused preparation to native text and respects external focus=${external}`, async t => {
    const f = await setup(t), root = f.root();
    f.main.querySelector('[data-action="community-quote"]').click(); await flush();
    if (external) f.w.document.querySelector('#outside').focus();
    if (outcome === 'failure') { f.load.reject(Error('offline')); await flush(); } else await f.tick(10000);
    const field = root.querySelector('textarea');
    assert.equal(field.disabled, false); assert.equal(field.hidden, false);
    assert.equal(f.w.document.activeElement, external ? f.w.document.querySelector('#outside') : field);
  });
}

test('clear and navigation invalidate late preparation even while the old root remains connected', async t => {
  const f = await setup(t); const root = f.root();
  f.ui.clear(); f.load.resolve(richModule); await flush();
  assert.equal(root.querySelector('.community-rich-body'), null);
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 0);
});

test('explicit retry after timeout uses a new attempt and original late success cannot consume it', async t => {
  const f = await setup(t); await f.tick(10000);
  const root = f.root(), field = root.querySelector('textarea'); f.type('新尝试草稿');
  const next = deferred(); f.setLoad(next); root.querySelector('[data-community-editor-retry]').click(); await f.tick(0);
  assert.equal(f.loads(), 2); assert.equal(field.disabled, true);
  f.load.resolve(richModule); await flush();
  assert.equal(root.querySelector('.community-rich-body'), null); assert.equal(field.hidden, false);
  next.resolve(richModule); await flush();
  assert.equal(field.hidden, true); assert.equal(field.value, '新尝试草稿');
});

test('retry waits through compositionend and its final input task before converting the complete draft', async t => {
  const f = await setup(t); f.load.reject(Error('offline')); await flush();
  const root = f.root(), field = root.querySelector('textarea');
  f.type('原文 **加粗**\n\n重复段落😀'); field.focus();
  field.dispatchEvent(new f.w.Event('compositionstart', { bubbles: true }));
  const next = deferred(); f.setLoad(next);
  root.querySelector('[data-community-editor-retry]').click(); await f.tick(0);
  assert.equal(f.loads(), 1); assert.equal(field.disabled, false); assert.equal(field.hidden, false);
  field.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }));
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 0);
  field.dispatchEvent(new f.w.Event('compositionend', { bubbles: true }));
  assert.equal(field.disabled, false, 'compositionend does not install in a microtask');
  await flush(); assert.equal(field.disabled, false);
  f.type('原文 **加粗**\n\n重复段落😀最后中文');
  await f.tick(0); assert.equal(field.disabled, true); assert.equal(f.loads(), 2);
  next.resolve(richModule); await flush();
  assert.equal(field.value, '原文 **加粗**\n\n重复段落😀最后中文');
  assert.match(root.querySelector('.community-rich-body').textContent, /最后中文/);
});

test('native fallback mixed image paste inserts text once; pure image and file drop never upload', async t => {
  const f = await setup(t); f.load.reject(Error('offline')); await flush();
  const root = f.root(), field = root.querySelector('textarea'); f.type('前文后文'); field.setSelectionRange(2, 2);
  const photo = Object.assign(new Blob(['image'], { type: 'image/png' }), { name: 'photo.png' });
  const paste = text => {
    const event = new f.w.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [photo], items: [], getData: kind => kind === 'text/plain' ? text : '' } });
    field.dispatchEvent(event); return event;
  };
  assert.equal(paste('一次😀').defaultPrevented, true);
  assert.equal(field.value, '前文一次😀后文');
  assert.equal(paste('').defaultPrevented, true); assert.equal(field.value, '前文一次😀后文');
  const drop = new f.w.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { files: [photo] } }); field.dispatchEvent(drop);
  assert.equal(drop.defaultPrevented, true);
  const picker = root.querySelector('input[type=file]'); Object.defineProperty(picker, 'files', { configurable: true, value: [photo] });
  picker.dispatchEvent(new f.w.Event('change', { bubbles: true }));
  assert.match(root.querySelector('[role=status]').textContent, /图片.*重试/);
  assert.equal(f.calls.filter(call => call.url.endsWith('/images')).length, 0);
  const plain = new f.w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(plain, 'clipboardData', { value: { files: [], items: [], getData: () => '原生文字' } }); field.dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, false, 'ordinary native paste is left to the browser');
});

test('fallback preview and drafts survive quote repaint, then explicit retry keeps the preview open', async t => {
  const f = await setup(t); f.load.reject(Error('offline')); await flush();
  const root = f.root(); f.type('预览 **草稿** 😀');
  root.querySelector('[data-action="community-md-preview"]').click();
  assert.equal(root.querySelector('textarea').hidden, true);
  f.main.querySelector('[data-action="community-quote"]').click(); await flush();
  assert.equal(f.root(), root); assert.equal(root.querySelector('.community-ed-preview').hidden, false);
  const next = deferred(); f.setLoad(next); root.querySelector('[data-community-editor-retry]').click(); await f.tick(0);
  next.resolve(richModule); await flush();
  assert.equal(root.querySelector('textarea').value, '预览 **草稿** 😀');
  assert.equal(root.querySelector('[data-community-rich]').hidden, true);
  assert.equal(root.querySelector('input[type=file]').disabled, true);
  root.querySelector('[data-action="community-md-preview"]').click();
  assert.equal(root.querySelector('[data-community-rich]').hidden, false);
  assert.equal(root.querySelector('input[type=file]').disabled, false);
});

test('two editors share loading but retain separate root ownership, original edit text, and timers', async t => {
  const f = await setup(t); const reply = f.root(); reply.querySelector('textarea').value = '保留回复';
  f.main.querySelector('[data-action="community-edit-reply"]').click(); await flush();
  const edit = f.main.querySelector('.community-reply-edit [data-inline-editor]');
  assert.equal(f.root(), reply); assert.equal(edit.querySelector('textarea').value, '原回复'); assert.equal(f.loads(), 1);
  f.load.resolve(richModule); await flush();
  assert.equal(edit.querySelector('textarea').hidden, true); assert.equal(reply.querySelector('textarea').hidden, true);
  assert.equal(edit.querySelector('textarea').value, '原回复'); assert.equal(reply.querySelector('textarea').value, '保留回复');
  await f.tick(10000);
  assert.equal(edit.dataset.editorState, 'ready'); assert.equal(reply.dataset.editorState, 'ready');
  assert.equal(f.main.querySelector('[data-community-editor-retry]'), null, 'successful mounts cancel both deadlines');
});

test('cleanup cancels old attempts while a new main can mount from the same module without stealing focus', async t => {
  const f = await setup(t); const old = f.root();
  await f.remount('#/post/p1'); const root = f.root(); assert.notEqual(root, old);
  f.w.document.querySelector('#outside').focus();
  f.load.resolve(richModule); await flush();
  assert.equal(old.querySelector('.community-rich-body'), null); assert.equal(root.querySelector('textarea').hidden, true);
  assert.equal(f.w.document.activeElement.id, 'outside');
});

test('hash change without remount still rejects late original preparation', async t => {
  const f = await setup(t); const root = f.root(); f.w.history.replaceState(null, '', '#/post/p2');
  f.load.resolve(richModule); await flush();
  assert.equal(root.querySelector('.community-rich-body'), null);
});

test('module mount failure restores a stable native editor and does not discard the draft', async t => {
  const f = await setup(t); const root = f.root(); root.querySelector('textarea').value = '已有编辑草稿';
  f.load.resolve({ ...richModule, mountCommunityComposeEditor: element => { element.querySelector('textarea').hidden = true; element.querySelector('[data-community-rich]').hidden = false; throw Error('mount failed'); } });
  await flush();
  assert.equal(root.querySelector('textarea').hidden, false); assert.equal(root.querySelector('textarea').disabled, false);
  assert.equal(root.querySelector('textarea').value, '已有编辑草稿');
  assert.equal(root.querySelector('[data-community-rich]').hidden, true); assert.ok(root.querySelector('[data-community-editor-retry]'));
  assert.equal(root.querySelector('input[type=file]').disabled, true);
});

test('text fallback submits once and an explicit retry cannot unlock or restart its pending write', async t => {
  const write = deferred(); const f = await setup(t, deferred(), (url, init) => url.endsWith('/topics/p1/replies') && init.method === 'POST' ? write.promise : null);
  f.load.reject(Error('offline')); await flush(); const root = f.root(); f.type('文字回复可以提交');
  f.send(); await waitFor(() => f.calls.some(call => call.init.method === 'POST'), 'the asynchronous write fingerprint must finish before checking its pending request');
  const button = root.closest('form').querySelector('button[type=submit]');
  assert.equal(button.disabled, true); assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1);
  root.querySelector('[data-community-editor-retry]').click(); await f.tick(0);
  assert.equal(f.loads(), 1); assert.equal(root.querySelector('textarea').disabled, false);
  f.send(); await flush(); assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1);
  write.resolve(response({ id: 'r2' })); await flush();
  assert.equal(f.root().dataset.editorState, 'text'); assert.equal(f.root().querySelector('textarea').value, '');
  await f.tick(0); assert.equal(f.loads(), 1, 'rejected retry does not remain queued after the write');
});

test('fallback write retains its submit lock and retry ownership through quote and unquote repaint', async t => {
  const write = deferred(); const f = await setup(t, deferred(), (url, init) => url.endsWith('/topics/p1/replies') && init.method === 'POST' ? write.promise : null);
  f.load.reject(Error('offline')); await flush(); const root = f.root(); f.type('等待提交中的回复'); f.send();
  await waitFor(() => f.calls.some(call => call.url.endsWith('/topics/p1/replies') && call.init.method === 'POST'), 'quote repaint starts after the pending request has reached the transport');
  const originalButton = root.closest('form').querySelector('button[type=submit]');
  f.main.querySelector('[data-action="community-quote"]').click(); await flush();
  assert.equal(f.root(), root); assert.equal(root.closest('form').querySelector('button[type=submit]').disabled, true);
  root.querySelector('[data-community-editor-retry]').click(); await f.tick(0);
  assert.equal(f.loads(), 1); assert.equal(root.dataset.editorState, 'text');
  f.send(); await flush(); assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1);
  f.main.querySelector('[data-action="community-unquote"]').click(); await flush();
  assert.equal(root.closest('form').querySelector('button[type=submit]').disabled, true);
  write.resolve(response({ id: 'r2' })); await flush();
  assert.equal(root.closest('form').querySelector('button[type=submit]').disabled, false);
  assert.equal(root.closest('form').querySelector('button[type=submit]'), originalButton);
  assert.equal(root.querySelector('textarea').value, '');
});

test('failed fallback write after quote reports to the retained form and never retries an unknown POST', async t => {
  const write = deferred(); const f = await setup(t, deferred(), (url, init) => url.endsWith('/topics/p1/replies') && init.method === 'POST' ? write.promise : null);
  f.load.reject(Error('offline')); await flush(); const root = f.root(); f.type('失败也保留草稿'); f.send();
  await waitFor(() => f.calls.some(call => call.url.endsWith('/topics/p1/replies') && call.init.method === 'POST'), 'the deferred failure belongs to an already started request');
  f.main.querySelector('[data-action="community-quote"]').click(); await flush();
  write.resolve({ ok: false, status: 503, json: async () => ({ error: '服务稍后恢复' }) }); await flush();
  assert.match(root.closest('form').querySelector('.community-form-status').textContent, /服务稍后恢复/);
  assert.equal(root.closest('form').querySelector('button[type=submit]').disabled, false);
  assert.equal(root.querySelector('textarea').value, '失败也保留草稿');
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1);
});

for (const changed of ['identity', 'hash']) {
  test(`late fallback write failure cannot transfer feedback after ${changed} changes while the old root is connected`, async t => {
    const write = deferred(); const f = await setup(t, deferred(), (url, init) => url.endsWith('/topics/p1/replies') && init.method === 'POST' ? write.promise : null);
    f.load.reject(Error('offline')); await flush(); const root = f.root(); f.type('原账号提交'); f.send();
    await waitFor(() => f.calls.some(call => call.url.endsWith('/topics/p1/replies') && call.init.method === 'POST'), 'identity changes only after the late-response scenario has started its request');
    const line = root.closest('form').querySelector('.community-form-status'), before = line.textContent;
    if (changed === 'identity') f.ui.clear(); else f.w.history.replaceState(null, '', '#/post/p2');
    assert.equal(root.isConnected, true);
    write.resolve({ ok: false, status: 400, json: async () => ({ error: '旧提交失败' }) }); await flush();
    assert.equal(line.textContent, before, 'frame/hash ownership, not only connected DOM, controls feedback handoff');
    assert.equal(root.querySelector('textarea').value, '原账号提交');
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1);
  });
}

test('first image selection after preparation uploads exactly once and preparation never queues files', async t => {
  const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const f = await setup(t, deferred(), url => url.endsWith('/images') ? response({ id: image }) : null);
  const root = f.root(), picker = root.querySelector('input[type=file]');
  const photo = uploadImageFile('first.png');
  assert.equal(picker.disabled, true);
  Object.defineProperty(picker, 'files', { configurable: true, value: [photo] });
  picker.dispatchEvent(new f.w.Event('change', { bubbles: true })); await flush();
  assert.equal(f.calls.filter(call => call.url.endsWith('/images')).length, 0);
  Object.defineProperty(picker, 'files', { configurable: true, value: [] });
  f.load.resolve(richModule); await flush(); assert.equal(picker.disabled, false);
  assert.equal(f.calls.filter(call => call.url.endsWith('/images')).length, 0);
  Object.defineProperty(picker, 'files', { configurable: true, value: [photo] });
  picker.dispatchEvent(new f.w.Event('change', { bubbles: true })); await flush();
  await waitFor(() => root.querySelector('textarea').value.includes(image), 'prepared valid image upload completes after its async header inspection');
  assert.equal(f.calls.filter(call => call.url.endsWith('/images')).length, 1);
  assert.match(root.querySelector('textarea').value, new RegExp(image));
});

test('typed preparation source is registered in the actual browser emitter and preserves existing editor geometry and focus rules', async () => {
  const name = 'community-editor-preparation';
  assert.ok(typedBrowserModules.has(`${name}.mjs`));
  assert.equal((await readFile(`src/${name}.mjs`, 'utf8')).trim(), `// Source adapter for Node tests while the browser receives compiled output.\nexport * from './${name}.ts';`);
  const builder = await readFile('scripts/build-cosmos.mjs', 'utf8');
  assert.match(builder, /"community-editor-preparation\.mjs"/);
  const output = (await transform(await readFile(`src/${name}.ts`, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' })).code;
  assert.doesNotMatch(output, /(?:from\s*|import\s*\()["'][^"']*\.(?:ts)["']/);
  assert.doesNotMatch(output, /(?:from\s*|import\s*\()["'][^"']*community-compose-editor/);
  const module = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
  assert.equal(typeof module.createCommunityEditorPreparation, 'function');
  const base = await readFile('src/community.css', 'utf8'), layout = await readFile('src/community-layout/stable-frame.css', 'utf8');
  assert.match(base, /\.community-editor textarea\s*\{[^}]*min-height:\s*152px/);
  assert.match(layout, /\[data-inline-editor\] \.community-rich-body\s*\{[^}]*min-height:\s*152px/);
  assert.match(base, /\.community-editor:focus-within\s*\{\s*border-color:\s*var\(--focus-edge\)/);
  assert.doesNotMatch(layout, /\.community-editor-upload-status[^{}]*\{[^}]*\b(?:outline|box-shadow):\s*(?!none)/);
});
