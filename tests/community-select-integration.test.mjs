import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const bundle = await build({
  stdin: { contents: "export { createCommunityUI } from './community-ui.ts'; export { mountCommunitySelect } from './community-select.tsx';", resolveDir: resolve('src'), sourcefile: 'select-integration.ts' },
  bundle: true, write: false, format: 'iife', globalName: 'CommunitySelectIntegration', platform: 'browser',
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  footer: { js: 'window.CommunitySelectIntegration = CommunitySelectIntegration;' },
});
const wait = () => new Promise(resolve => setTimeout(resolve, 40));
const person = { name: '無相', uid: 'owner', role: 'owner', level: 4, owner: true, mod: true, balance: 0, checkedIn: true, streak: 0, nextReward: { total: 0 }, unread: { all: 0 }, inventory: {}, agreed: true, management: { role: 'owner', browsingAsReader: false } };
const data = { owner: true, counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 1, replies24h: 2 }, queue: { topics: [], replies: [] }, reports: [], content: [], items: [], sanctions: [], data: null, categories: [{ id: 'first', name: '星海系列' }, { id: 'second', name: '流光系列' }], orders: [{ id: 'o1', item: 'goods', itemName: '物品', price: 10, member: person, status: 'pending', createdAt: '2026-10-05T02:00:00Z', shipping: { name: '用户', phone: '13900000000', address: '测试地址' } }] };

async function setup(t, tab) {
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  virtualConsole.on('error', error => errors.push(error));
  const dom = new JSDOM('<main></main>', { url: `https://example.test/#/community/manage/${tab}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window, doc = w.document;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.HTMLElement.prototype.hasPointerCapture = function () { return false; };
  w.HTMLElement.prototype.releasePointerCapture = function () {};
  w.HTMLElement.prototype.setPointerCapture = function () {};
  const focusCalls = [], nativeFocus = w.HTMLElement.prototype.focus;
  w.HTMLElement.prototype.focus = function (options) { focusCalls.push({ node: this, options }); nativeFocus.call(this, options); };
  w.eval(bundle.outputFiles[0].text);
  const { createCommunityUI, mountCommunitySelect } = w.CommunitySelectIntegration;
  const request = async url => {
    if (url.endsWith('/me')) return { ok: true, json: async () => structuredClone(person) };
    if (url.includes('/manage?')) return { ok: true, json: async () => structuredClone(data) };
    throw new Error(`Unexpected request: ${url}`);
  };
  const main = doc.querySelector('main');
  const ctx = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {}, members: true, mountSelect: mountCommunitySelect };
  const ui = createCommunityUI({ request });
  main.innerHTML = ui.html(ctx);
  const cleanups = [ui.mount(main, ctx)];
  t.after(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    dom.window.close();
    assert.deepEqual(errors, [], 'the real dropdown and community controller must run without runtime errors');
  });
  await wait();
  return { w, doc, main, ui, ctx, cleanups, mountCommunitySelect, focusCalls };
}

test('Escape closes the dropdown before its enclosing management dialog', async t => {
  const env = await setup(t, 'orders'), { w, doc, main } = env;
  main.querySelector('[data-action="community-ship"]').click();
  const dialog = main.querySelector('[role="dialog"][aria-modal="true"]');
  assert.ok(dialog);
  // Exercise the shared select inside a real management modal. This protects
  // later dialog fields as well as the portal's existing nested-dialog contract.
  const container = doc.createElement('div');
  container.innerHTML = '<label for="dialog-category">类别</label><select id="dialog-category"><option value="a">星海</option><option value="b">流光</option></select>';
  dialog.querySelector('form').prepend(container);
  const control = env.mountCommunitySelect(container.querySelector('select'), {});
  t.after(() => control.dispose());
  container.querySelector('.community-select-trigger').click();
  await wait();
  assert.ok(dialog.querySelector('.community-select-menu'));
  doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait();
  assert.ok(main.querySelector('[role="dialog"][aria-modal="true"]') === dialog, 'the first Escape belongs to the dropdown');
  assert.equal(dialog.querySelector('.community-select-menu'), null);
  assert.ok(doc.activeElement === container.querySelector('.community-select-trigger'), 'closing the dropdown restores trigger focus');
  doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait();
  assert.equal(main.querySelector('[role="dialog"][aria-modal="true"]'), null, 'the next Escape closes the outer dialog');
});

for (const inDialog of [false, true]) test(`a structural repaint restores focus from a ${inDialog ? 'dialog' : 'body'}-portal option to the rebuilt stable trigger`, async t => {
  const env = await setup(t, 'items'), { w, doc, main, ui, ctx } = env;
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('form[data-community-form="item"]');
  form.elements.namedItem('name').value = '保留商品草稿';
  form.elements.namedItem('price').value = '40';
  const select = form.elements.namedItem('category');
  select.value = 'first';
  select.dispatchEvent(new w.Event('change', { bubbles: true }));
  if (inDialog) form.setAttribute('role', 'dialog');
  doc.getElementById('community-item-category-trigger').click();
  await wait();
  assert.ok(doc.activeElement.closest('.community-select-menu'));
  assert.equal(main.contains(doc.activeElement), inDialog, 'the selected option follows its configured portal container');
  env.cleanups.push(ui.mount(main, ctx));
  await wait();
  const rebuilt = main.querySelector('form[data-community-form="item"]');
  const trigger = doc.getElementById('community-item-category-trigger');
  assert.ok(doc.activeElement === trigger, 'repainting must retain keyboard position instead of dropping focus onto body');
  assert.equal(env.focusCalls.at(-1).options?.preventScroll, true);
  assert.equal(rebuilt.elements.namedItem('name').value, '保留商品草稿');
  assert.equal(rebuilt.elements.namedItem('price').value, '40');
  assert.equal(rebuilt.elements.namedItem('category').value, 'first');
  assert.equal([...new w.FormData(rebuilt)].filter(([name]) => name === 'category').length, 1, 'the shared dropdown must preserve one submitted value');
});
