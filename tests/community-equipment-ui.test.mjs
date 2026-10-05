import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { avatarHTML, nameHTML } from '../src/community.mjs';
import { communityManageHTML, communityShopHTML } from '../src/community-pages.mjs';
const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const person = { name: '装扮预览', uid: 'u1', role: 'reader', frame: `image:${id}`, color: `effect:${id}`, nameEffect: { style: 'shimmer', colors: ['#976223', '#236A7B'] } };
test('custom frames overlay real avatars and safe nickname effects appear through the shared person renderer', () => {
  const dom = new JSDOM(avatarHTML({ ...person, avatar: '/avatar.webp' }, common) + nameHTML(person, common));
  assert.equal(dom.window.document.querySelectorAll('.community-av img').length, 2);
  assert.match(dom.window.document.querySelector('.community-frame-image').src, new RegExp(id));
  assert.equal(dom.window.document.querySelector('.community-uname').dataset.nameEffect, 'shimmer');
  assert.match(nameHTML(person, common), /#976223/);
  assert.doesNotMatch(nameHTML({ ...person, nameEffect: { style: 'shimmer', colors: ['red;position:fixed', '#236A7B'] } }, common), /position:fixed/);
  dom.window.close();
});
test('author equipment form exposes wearable imports and category selection without effect editing controls', () => {
  const manage = { state: 'ready', data: { owner: true, counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 0, replies24h: 0 }, queue: { topics: [], replies: [] }, reports: [], orders: [], items: [], sanctions: [], categories: [{ id, name: '星海系列' }], data: null } };
  const html = communityManageHTML({ ...common, manage, tab: 'items', itemEditing: { id: null } });
  const dom = new JSDOM(html), doc = dom.window.document;
  assert.ok(doc.querySelector('[name="kind"][value="frame"]'));
  assert.ok(doc.querySelector('[name="kind"][value="color"]'));
  assert.equal(doc.querySelector(`select[name="category"] option[value="${id}"]`).textContent, '星海系列');
  assert.ok(doc.querySelector('[name="effectStyle"]'));
  assert.equal(doc.querySelector('[name="effectStyle"]').type, 'hidden');
  assert.equal(doc.querySelector('select[name="effectStyle"], input[type="color"]'), null);
  assert.ok(doc.querySelector('[data-community-effect-upload]'));
  assert.ok(doc.querySelector('[data-item-wear-preview]'));
  assert.ok(doc.querySelector('form[data-community-form="category"]'));
  assert.ok(doc.querySelector('form[data-community-form="category"] .community-field > input[name="name"]'), 'new categories use the shared themed input');
  dom.window.close();
});

test('custom shop category filters show assigned products without duplicating the main all-items listing', () => {
  const item = { id: 'frame', cat: 'look', kind: 'frame', category: id, image: id, ref: `image:${id}`, name: '动态星环', desc: '透明动态框', price: 20, active: true, builtin: false, state: { owned: false, ok: true } };
  const shop = { state: 'ready', data: { balance: 100, owner: false, categories: [{ id, name: '星海系列' }], items: [item], inventory: {}, decorations: {} } };
  const html = communityShopHTML({ ...common, shop, tab: id });
  assert.match(html, /星海系列/);
  assert.match(html, /动态星环/);
  const all = communityShopHTML({ ...common, shop, tab: 'all' });
  assert.equal(new JSDOM(all).window.document.querySelectorAll('.community-sitem').length, 1);
});
test('management loading retains its navigation, statistic slots and content shell', () => {
  const me = { name: '作者', uid: 'owner', role: 'owner', owner: true, mod: true };
  const loading = new JSDOM(communityManageHTML({ ...common, me, manage: { state: 'loading' }, tab: 'orders' }));
  const data = { owner: true, counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 0, replies24h: 0 }, queue: { topics: [], replies: [] }, reports: [], orders: [], items: [], sanctions: [], data: null };
  const ready = new JSDOM(communityManageHTML({ ...common, me, manage: { state: 'ready', data }, tab: 'orders' }));
  const links = dom => [...dom.window.document.querySelectorAll('.community-management-nav nav a')].map(link => link.getAttribute('href'));
  assert.deepEqual(links(loading), links(ready));
  assert.equal(loading.window.document.querySelectorAll('.community-kpis > div').length, 4);
  assert.ok(loading.window.document.querySelector('.community-management-body'));
  loading.window.close(); ready.window.close();
});
