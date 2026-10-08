import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';

const artwork = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const person = { name: '读者', uid: '10001', role: 'reader', level: 2, owner: false, mod: false, balance: 100, checkedIn: true, streak: 1, nextReward: { total: 10 }, unread: { all: 0 }, inventory: {}, agreed: true };
const product = { id: 'published-card', cat: 'digital', kind: 'digital', image: artwork, name: '补签卡', desc: '第一段说明。\n第二段 <参数> 说明。', price: 8, stock: 99, limit: { per: 'month', n: 1 }, minLevel: 1, builtin: false, active: true, state: { owned: false, left: 98, ok: true, code: 'ok', why: '' } };
const merchandise = { balance: 100, level: 2, owner: false, inventory: { makeup: 0, pin: 0, highlight: 0 }, decorations: { frame: null, color: null, cover: null }, items: [product] };
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const response = data => ({ ok: true, status: 200, json: async () => structuredClone(data) });

async function fixture(t, { hash = '#/community/shop', viewer = person, data = structuredClone(merchandise), owned = false } = {}) {
  const dom = new JSDOM('<header><button>导航</button></header><main></main><aside inert></aside>', { url: `http://localhost/${hash}`, pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event', 'CustomEvent', 'getComputedStyle'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  w.document.querySelector('aside').inert = true;
  w.scrollTo = () => {};
  const requests = [];
  const currentViewer = structuredClone(viewer);
  const ui = createCommunityUI({ request: async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith('/me')) return response(currentViewer);
    if (url.endsWith('/summary')) return response({ total: 0, boards: {}, hot: [] });
    if (url.endsWith('/shop')) return response(data);
    if (url.endsWith('/shop/mine')) return response({ balance: 100, inventory: data.inventory, decorations: { frame: 'gold', color: null, cover: null }, looks: owned ? [{ ...product, id: 'frame-gold', kind: 'frame', ref: 'gold', image: null }] : [], digital: [], orders: [] });
    if (url.includes('/topics?')) return response({ items: [], total: 0, page: 1, pageSize: 20 });
    throw Error(`Unexpected request: ${url}`);
  } });
  const ctx = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {}, members: false };
  const main = w.document.querySelector('main');
  main.innerHTML = ui.html(ctx);
  let cleanup = ui.mount(main, ctx);
  const remount = async route => {
    w.history.replaceState(null, '', route);
    cleanup(); main.innerHTML = ui.html(ctx); cleanup = ui.mount(main, ctx);
    await turn(); await turn();
  };
  t.after(() => {
    cleanup(); ui.clear(); w.close();
    for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
  });
  await turn(); await turn();
  const retry = () => { const control = w.document.createElement('button'); control.dataset.action = 'community-retry'; main.append(control); control.click(); control.remove(); };
  return { w, main, ui, requests, data, viewer: currentViewer, remount, retry };
}

for (const entry of ['.community-sitem-art', '.community-sitem-title']) test(`product ${entry} opens a complete left-art/right-description dialog without reading or redeeming again`, async t => {
  const { w, main, requests } = await fixture(t);
  const page = main.querySelector('[data-community="shop"]');
  const entryButton = page.querySelector(entry);
  const before = requests.length;
  entryButton.focus(); entryButton.click();
  const dialog = w.document.querySelector('.community-shop-dialog[role="dialog"]');
  assert.ok(dialog);
  assert.equal(dialog.parentElement, w.document.body, 'the popup is outside the scrolling community frame');
  assert.equal(main.querySelector('[data-community="shop"]'), page, 'reading details must not replace or stretch the collection');
  assert.equal(page.querySelector('details'), null);
  assert.equal(dialog.querySelector('.community-shop-detail-art img').getAttribute('src'), `/api/community/images/${artwork}.webp`);
  assert.equal(dialog.querySelector('.community-shop-detail-description').textContent, product.desc);
  assert.equal(dialog.querySelector('.community-shop-detail-description').querySelector('参数'), null, 'description remains escaped plain text');
  assert.match(dialog.querySelector('.community-shop-detail-info').textContent, /每月限 1 次/);
  assert.match(dialog.querySelector('.community-stock').textContent, /剩 98 \/ 99/);
  assert.equal(dialog.querySelector('.community-price b').textContent, '8');
  assert.ok(dialog.querySelector('[data-action="community-redeem"][data-id="published-card"]'));
  assert.equal(requests.length, before, 'opening details uses the already-loaded product without spending stardust');
  assert.equal(main.inert, true);
  assert.equal(w.document.querySelector('header').inert, true);
  assert.equal(w.document.body.style.overflow, 'hidden');
  const close = dialog.querySelector('[data-shop-detail-close]');
  assert.equal(w.document.activeElement, close, 'the upper-right close control is initially focused');
  close.click(); await turn();
  assert.equal(w.document.querySelector('.community-shop-dialog'), null);
  assert.equal(w.document.activeElement, entryButton);
  assert.equal(main.inert, false);
  assert.equal(w.document.querySelector('aside').inert, true, 'pre-existing inert states survive closing');
  assert.equal(w.document.body.style.overflow, '');
});

test('uploaded card art follows the pointer inside a stable collection and restores on exit', async t => {
  const data = structuredClone(merchandise); data.items[0] = { ...data.items[0], cat: 'card', kind: 'card', ref: 'makeup' };
  const { w, main, requests } = await fixture(t, { data });
  const page = main.querySelector('[data-community="shop"]'), entry = page.querySelector('.community-sitem-art');
  const outer = entry.closest('.community-sitem'), holo = entry.querySelector('[data-community-card-art]');
  assert.ok(holo);
  entry.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
  const before = requests.length;
  entry.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 180, clientY: 10 }));
  assert.equal(holo.style.getPropertyValue('--holo-rx'), '2.4deg');
  assert.equal(holo.style.getPropertyValue('--holo-ry'), '3.2deg');
  assert.equal(holo.style.getPropertyValue('--holo-x'), '90%');
  assert.equal(holo.style.getPropertyValue('--holo-y'), '10%');
  assert.equal(outer.style.transform, '', 'the list card itself must not shift, rotate or change layout');
  assert.equal(main.querySelector('[data-community="shop"]'), page);
  entry.dispatchEvent(new w.MouseEvent('pointerout', { bubbles: true, relatedTarget: holo.querySelector('img') }));
  assert.equal(holo.style.getPropertyValue('--holo-rx'), '2.4deg', 'crossing child artwork must not reset the hover');
  entry.dispatchEvent(new w.MouseEvent('pointerout', { bubbles: true, relatedTarget: w.document.body }));
  for (const property of ['--holo-rx', '--holo-ry', '--holo-x', '--holo-y']) assert.equal(holo.style.getPropertyValue(property), '');
  entry.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 180, clientY: 10 }));
  entry.dispatchEvent(new w.MouseEvent('pointercancel', { bubbles: true, relatedTarget: holo.querySelector('img') }));
  assert.equal(holo.style.getPropertyValue('--holo-rx'), '', 'pointer cancellation resets even with an internal relatedTarget');
  assert.equal(requests.length, before, 'artwork interaction does not start reads, animations in JS or writes');
});

test('uploaded card masks resolve on the document origin when stylesheets are delivered by the CDN', async t => {
  const data = structuredClone(merchandise); data.items[0] = { ...data.items[0], cat: 'card', kind: 'card', ref: 'makeup' };
  const { w, main } = await fixture(t, { data });
  const stylesheet = w.document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = 'https://static.sansphase.com/release/community.css'; w.document.head.append(stylesheet);
  const art = main.querySelector('[data-community-card-art]');
  assert.equal(art.style.getPropertyValue('--card-image'), `url("http://localhost/api/community/images/${artwork}.webp")`, 'a root-relative custom property would otherwise resolve against the consuming stylesheet origin');
  main.querySelector('.community-sitem-title').click();
  const detail = w.document.querySelector('.community-shop-detail-art [data-community-card-art]');
  assert.equal(detail.style.getPropertyValue('--card-image'), art.style.getPropertyValue('--card-image'));
  assert.equal(detail.querySelector('img').src, `http://localhost/api/community/images/${artwork}.webp`);
});

test('detail card interaction survives stock refresh without replacing its animated artwork', async t => {
  const data = structuredClone(merchandise); data.items[0] = { ...data.items[0], cat: 'card', kind: 'card', ref: 'makeup' };
  const { w, main, retry } = await fixture(t, { data });
  main.querySelector('.community-sitem-title').click();
  const dialog = w.document.querySelector('.community-shop-dialog'), stage = dialog.querySelector('.community-shop-detail-art');
  const holo = stage.querySelector('[data-community-card-art]'); assert.ok(holo);
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
  stage.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 180, clientY: 10 }));
  assert.equal(holo.style.getPropertyValue('--holo-ry'), '3.2deg');
  data.items[0].state.left = 97; retry(); await turn(); await turn();
  assert.equal(dialog.querySelector('.community-shop-detail-art'), stage);
  assert.equal(stage.querySelector('[data-community-card-art]'), holo, 'passive data refresh must not restart the card sheen or pointer state');
  assert.match(dialog.querySelector('.community-stock').textContent, /剩 97 \/ 99/);
  stage.dispatchEvent(new w.MouseEvent('pointerout', { bubbles: true, relatedTarget: w.document.body }));
  assert.equal(holo.style.getPropertyValue('--holo-ry'), '');
});

for (const field of ['stock', 'description']) test(`a ${field} retry retains keyboard focus on the preserved detail artwork`, async t => {
  const data = structuredClone(merchandise); data.items[0] = { ...data.items[0], cat: 'card', kind: 'card', ref: 'makeup' };
  const { w, main, retry } = await fixture(t, { data });
  main.querySelector('.community-sitem-title').click();
  const dialog = w.document.querySelector('.community-shop-dialog');
  const stage = dialog.querySelector('.community-shop-detail-art');
  assert.equal(stage.getAttribute('tabindex'), '0');
  stage.focus(); assert.equal(w.document.activeElement, stage);
  if (field === 'stock') data.items[0].state.left = 96;
  else data.items[0].desc = '更新后的完整卡片说明。';
  retry(); for (let i = 0; i < 6; i++) await turn();
  assert.equal(w.document.querySelector('.community-shop-dialog'), dialog);
  assert.equal(dialog.querySelector('.community-shop-detail-art'), stage);
  if (field === 'stock') assert.match(dialog.querySelector('.community-stock').textContent, /剩 96 \/ 99/);
  else assert.equal(dialog.querySelector('.community-shop-detail-description').textContent, data.items[0].desc);
  assert.equal(w.document.activeElement, stage, 'refreshing text around a retained focusable artwork must not jump focus to the close button');
});

test('reduced-motion and touch artwork do not receive pointer tilt', async t => {
  const data = structuredClone(merchandise); data.items[0] = { ...data.items[0], cat: 'card', kind: 'card', ref: 'makeup' };
  const { w, main } = await fixture(t, { data });
  const entry = main.querySelector('.community-sitem-art'), holo = entry.querySelector('[data-community-card-art]'); assert.ok(holo);
  let reads = 0; entry.getBoundingClientRect = () => { reads++; return { left: 0, top: 0, width: 200, height: 100 }; };
  w.matchMedia = () => ({ matches: true });
  entry.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 180, clientY: 10 }));
  assert.equal(holo.style.getPropertyValue('--holo-rx'), '');
  w.matchMedia = () => ({ matches: false });
  const touch = new w.MouseEvent('pointermove', { bubbles: true, clientX: 180, clientY: 10 });
  Object.defineProperty(touch, 'pointerType', { value: 'touch' }); entry.dispatchEvent(touch);
  assert.equal(holo.style.getPropertyValue('--holo-rx'), '');
  assert.equal(reads, 0, 'touch/reduced motion must not compute an interactive artwork transform');
});

test('product details close on Escape and backdrop, restore focus, and leave no hidden duplicate dialog', async t => {
  const { w, main } = await fixture(t);
  for (const action of ['escape', 'backdrop']) {
    const opener = main.querySelector('.community-sitem-title'); opener.focus(); opener.click();
    const dialog = w.document.querySelector('.community-shop-dialog');
    if (action === 'escape') w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else dialog.querySelector('[data-a11y-dialog-hide]').click();
    await turn();
    assert.equal(w.document.querySelector('.community-shop-dialog'), null);
    assert.equal(w.document.activeElement, opener);
    assert.equal(main.inert, false);
  }
});

test('Tab and Shift+Tab wrap between the detail close and existing action without focusing the background', async t => {
  const { w, main } = await fixture(t);
  main.querySelector('.community-sitem-title').click();
  const dialog = w.document.querySelector('.community-shop-dialog');
  const first = dialog.querySelector('[data-shop-detail-close]'), last = dialog.querySelector('[data-action="community-redeem"]');
  // JSDOM has no layout engine. Give the two visible controls a painted rect
  // so the installed dialog library can apply its normal visibility filter.
  for (const control of [first, last]) control.getClientRects = () => [{ width: 44, height: 44 }];
  last.focus();
  const forward = new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); last.dispatchEvent(forward);
  assert.equal(forward.defaultPrevented, true);
  assert.equal(w.document.activeElement, first);
  const backward = new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }); first.dispatchEvent(backward);
  assert.equal(backward.defaultPrevented, true);
  assert.equal(w.document.activeElement, last);
});

test('refreshing the shop updates detail conditions but preserves its original artwork and open dialog', async t => {
  const { w, main, retry, data } = await fixture(t);
  main.querySelector('.community-sitem-title').click();
  const dialog = w.document.querySelector('.community-shop-dialog'), image = dialog?.querySelector('img');
  assert.ok(dialog);
  data.items[0].state.left = 97;
  retry(); for (let i = 0; i < 6; i++) await turn();
  assert.equal(w.document.querySelector('.community-shop-dialog'), dialog);
  assert.equal(dialog.querySelector('img'), image, 'a stock update must not restart the image');
  assert.match(dialog.querySelector('.community-stock').textContent, /剩 97 \/ 99/);
  assert.ok(dialog.contains(w.document.activeElement), 'refreshing detail text keeps keyboard focus inside the dialog');
});

test('a description-only refresh updates the open detail even when the compact collection HTML stays unchanged', async t => {
  const { w, main, retry, data } = await fixture(t);
  main.querySelector('.community-sitem-title').click();
  const dialog = w.document.querySelector('.community-shop-dialog');
  assert.ok(dialog);
  const page = main.querySelector('[data-community="shop"]'), image = dialog.querySelector('img'), art = dialog.querySelector('.community-shop-detail-art');
  data.items[0].desc = '作者更新的完整说明。';
  retry(); for (let i = 0; i < 6; i++) await turn();
  assert.equal(main.querySelector('[data-community="shop"]'), page, 'unchanged collection markup keeps its existing page');
  assert.equal(dialog.querySelector('.community-shop-detail-description').textContent, data.items[0].desc);
  assert.equal(dialog.querySelector('img'), image);
  assert.equal(dialog.querySelector('.community-shop-detail-art'), art, 'a text-only change preserves the artwork and decorative animation');
});

test('owned-frame details retain the existing unequip control and do not show a purchase action', async t => {
  const { w, main, requests } = await fixture(t, { hash: '#/community/shop/mine', owned: true });
  main.querySelector('.community-sitem-title').click();
  const dialog = w.document.querySelector('.community-shop-dialog');
  assert.ok(dialog);
  assert.ok(dialog.querySelector('[data-action="community-equip"][data-kind="frame"][data-ref=""]'));
  assert.equal(dialog.querySelector('[data-action="community-redeem"]'), null);
  assert.equal(dialog.querySelector('.community-price'), null);
  assert.equal(requests.some(call => call.init.method === 'POST'), false);
});

test('read-only management browsing can view product details while the existing write authority remains unchanged', async t => {
  const { w, main, requests } = await fixture(t, { viewer: { ...person, management: { role: 'owner', browsingAsReader: true } } });
  main.querySelector('.community-sitem-title').click();
  const dialog = w.document.querySelector('.community-shop-dialog');
  assert.ok(dialog, 'description viewing is a read-only action');
  dialog.querySelector('[data-action="community-redeem"]').click(); await turn();
  assert.equal(requests.some(call => call.init.method === 'POST'), false);
  assert.ok(w.document.querySelector('.community-shop-dialog'));
});

test('navigation retires the product dialog and unlocks the next page without retaining a previous item', async t => {
  const { w, main, remount } = await fixture(t);
  main.querySelector('.community-sitem-title').click();
  assert.ok(w.document.querySelector('.community-shop-dialog'));
  await remount('#/community/home');
  assert.equal(w.document.querySelector('.community-shop-dialog'), null);
  assert.equal(main.inert, false);
  assert.equal(w.document.body.style.overflow, '');
});

for (const change of ['account', 'permission']) test(`a confirmed ${change} change retires the old product dialog immediately`, async t => {
  const { w, main, retry, viewer } = await fixture(t, { viewer: { ...person, vip: true } });
  main.querySelector('.community-sitem-title').click();
  assert.ok(w.document.querySelector('.community-shop-dialog'));
  if (change === 'account') viewer.uid = '10002'; else viewer.vip = false;
  retry(); for (let i = 0; i < 6; i++) await turn();
  assert.equal(w.document.querySelector('.community-shop-dialog'), null);
  assert.equal(main.inert, false);
  assert.equal(w.document.body.style.overflow, '');
});
