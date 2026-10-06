import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityShopHTML, communityShopMineHTML } from '../src/community-pages.mjs';
import { createCommunityUI } from '../src/community-ui.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const frame = ref => ({ id: `frame-${ref}`, cat: 'look', kind: 'frame', ref, name: ref === 'gold' ? '金环头像框' : '轨道头像框', desc: '已有装扮', price: 80, builtin: true, active: false });
const mine = () => ({ balance: 100, inventory: { makeup: 0, pin: 0, highlight: 0 }, decorations: { frame: 'gold', color: null, cover: null }, looks: [frame('gold'), frame('orbit')], digital: [], orders: [] });
const person = { name: '测试读者', uid: '10001', role: 'reader', level: 1, owner: false, mod: false, balance: 100, checkedIn: true, streak: 1, nextReward: { total: 1 }, unread: { all: 0 }, inventory: {}, agreed: true };
const response = data => ({ ok: true, json: async () => structuredClone(data) });
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

test('owned backgrounds show actual artwork, apply directly and identify the current single background', () => {
  const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const cover = { id: 'custom-cover', cat: 'look', kind: 'cover', ref: `image:${image}`, image, name: '林间背景', desc: '已有背景', price: 120, active: false, builtin: false };
  const value = { ...mine(), looks: [cover], decorations: { frame: 'gold', color: null, cover: cover.ref } };
  const dom = new JSDOM(communityShopMineHTML({ mine: { state: 'ready', data: value }, ...common }));
  try {
    const card = dom.window.document.querySelector('.community-sitem');
    assert.equal(card.querySelector('img').getAttribute('src'), `/api/community/images/${image}.webp`);
    assert.equal(card.querySelector('.community-owned-tag').textContent, '使用中');
    const reset = card.querySelector('[data-action="community-equip"]');
    assert.equal(reset.textContent, '恢复默认');
    assert.equal(reset.dataset.kind, 'cover');
    assert.equal(reset.dataset.ref, '');
    assert.equal(reset.getAttribute('aria-label'), '恢复默认主页背景');
    assert.equal(reset.disabled, false);
    assert.equal(card.querySelector('[data-action="community-redeem"]'), null);
  } finally { dom.window.close(); }
  const unused = new JSDOM(communityShopMineHTML({ mine: { state: 'ready', data: { ...value, decorations: { ...value.decorations, cover: null } } }, ...common }));
  try {
    const apply = unused.window.document.querySelector('[data-action="community-equip"]');
    assert.equal(apply.textContent, '使用');
    assert.equal(apply.getAttribute('aria-label'), '使用林间背景');
    assert.equal(apply.dataset.ref, cover.ref);
    assert.equal(apply.disabled, false, 'owned backgrounds remain usable after delisting');
  } finally { unused.window.close(); }
});

test('the exchange entry and inventory clearly identify owned items', () => {
  const value = mine();
  const shop = { balance: value.balance, level: 1, owner: false, items: [], inventory: value.inventory, decorations: value.decorations };
  const dom = new JSDOM(communityShopHTML({ shop: { state: 'ready', data: shop }, tab: 'all', ...common }) + communityShopMineHTML({ mine: { state: 'ready', data: value }, ...common }));
  try {
    assert.equal(dom.window.document.querySelector('a[href="#/community/shop/mine"]').textContent, '已拥有');
    assert.equal(dom.window.document.querySelector('.community-page-head h1').textContent, '已拥有');
    assert.match(dom.window.document.querySelector('[data-tab="mine"]').textContent, /头像框的佩戴状态与主站同步/);
  } finally { dom.window.close(); }
});

test('owned frames distinguish current wear, wear and remove without changing the equipment contract', () => {
  const dom = new JSDOM(communityShopMineHTML({ mine: { state: 'ready', data: mine() }, ...common }));
  try {
    const [gold, orbit] = dom.window.document.querySelectorAll('.community-sitem');
    assert.equal(gold.querySelector('.community-owned-tag').textContent, '已佩戴');
    const remove = gold.querySelector('[data-action="community-equip"]');
    assert.equal(remove.textContent, '卸下');
    assert.equal(remove.dataset.kind, 'frame');
    assert.equal(remove.dataset.ref, '');
    assert.equal(remove.getAttribute('aria-label'), '卸下金环头像框');
    assert.equal(orbit.querySelector('.community-owned-tag').textContent, '已拥有');
    const wear = orbit.querySelector('[data-action="community-equip"]');
    assert.equal(wear.textContent, '佩戴');
    assert.equal(wear.dataset.ref, 'orbit');
    assert.equal(wear.getAttribute('aria-label'), '佩戴轨道头像框');
    assert.equal(wear.disabled, false, 'off-sale owned frames remain wearable');
    assert.equal(dom.window.document.querySelector('[data-action="community-redeem"]'), null, 'inventory does not offer another purchase');
  } finally { dom.window.close(); }
});

test('wearing and removing an owned frame use the existing server equip action and reconcile the displayed state', async t => {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost/#/community/shop/mine', pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  const value = mine(), calls = [];
  const ui = createCommunityUI({ request: async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/me')) return response({ ...person, frame: value.decorations.frame });
    if (url.endsWith('/shop/mine')) return response(value);
    if (url.endsWith('/shop/equip')) {
      const input = JSON.parse(init.body);
      assert.equal(input.kind, 'frame');
      assert.ok(input.ref === null || value.looks.some(item => item.ref === input.ref));
      value.decorations.frame = input.ref;
      return response(value.decorations);
    }
    throw new Error(`Unexpected request: ${url}`);
  } });
  const main = w.document.querySelector('main');
  main.innerHTML = ui.html(common);
  const cleanup = ui.mount(main, common);
  t.after(() => {
    w.history.replaceState(null, '', '#/home');
    cleanup();
    for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
    w.close();
  });
  await turn();
  main.querySelector('[data-action="community-equip"][data-ref="orbit"]').click();
  for (let i = 0; i < 10 && !main.querySelector('[aria-label="卸下轨道头像框"]'); i++) await turn();
  assert.ok(main.querySelector('[aria-label="卸下轨道头像框"]'));
  assert.equal(main.querySelector('[aria-label="佩戴金环头像框"]').dataset.ref, 'gold');
  main.querySelector('[aria-label="卸下轨道头像框"]').click();
  for (let i = 0; i < 10 && main.querySelector('[aria-label="卸下轨道头像框"]'); i++) await turn();
  assert.equal(main.querySelector('.community-owned-tag').textContent, '已拥有');
  assert.equal(main.querySelectorAll('[data-action="community-equip"][data-ref=""]').length, 0);
  assert.deepEqual(calls.filter(call => call.init.method === 'POST').map(call => [call.url, JSON.parse(call.init.body)]), [
    ['/api/community/shop/equip', { kind: 'frame', ref: 'orbit' }],
    ['/api/community/shop/equip', { kind: 'frame', ref: null }],
  ]);
  assert.equal(value.balance, 100);
  assert.deepEqual(value.inventory, { makeup: 0, pin: 0, highlight: 0 });
});
