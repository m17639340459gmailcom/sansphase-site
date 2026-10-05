import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityManageHTML } from '../src/community-pages.mjs';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const reader = { name: '预览读者', uid: '10001', role: 'reader', owner: false, mod: false };
const denied = { state: 'error', status: 403, message: '只有站长和协管能进入社区管理。' };
const data = owner => ({ owner, tab: 'queue', counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 0, replies24h: 0 }, queue: { topics: [], replies: [] }, reports: [], orders: [], items: [], sanctions: [], data: null });
const render = options => new JSDOM(communityManageHTML({ ...common, tab: 'items', ...options }));

test('readers and unknown identities are never labelled as moderators or offered management controls', () => {
  for (const me of [reader, null, { ...reader, management: { role: 'owner', browsingAsReader: true } }]) {
    for (const manage of [denied, { state: 'loading' }]) {
      const dom = render({ me, manage }), doc = dom.window.document;
      assert.equal(doc.querySelector('.community-page-head h1').textContent, '社区管理');
      assert.equal(doc.querySelector('.community-management-role strong').textContent, '社区管理');
      assert.equal(doc.querySelector('.community-management-nav nav a'), null);
      assert.equal(doc.querySelector('.community-management-exits [data-action="community-browse-mode"]'), null);
      assert.equal(doc.querySelector('.community-management-exits a').getAttribute('href'), '#/community/home');
      assert.equal(doc.querySelector('.community-management-body').getAttribute('aria-busy'), String(manage.state === 'loading'));
      if (manage.state === 'error') assert.ok(doc.querySelector('[data-content-state="forbidden"]'));
      dom.window.close();
    }
  }
});

test('verified owners and moderators retain their correct workspaces while a management request is loading', () => {
  for (const owner of [true, false]) {
    const me = { ...reader, owner, mod: true };
    const dom = render({ me, manage: { state: 'loading' } }), doc = dom.window.document;
    assert.equal(doc.querySelector('.community-page-head h1').textContent, owner ? '作者社区管理' : '版主社区管理');
    assert.equal(doc.querySelector('.community-management-role strong').textContent, owner ? '作者' : '版主');
    assert.equal(Boolean(doc.querySelector('nav a[href="#/community/manage/items"]')), owner);
    assert.ok(doc.querySelector('.community-management-exits [data-action="community-browse-mode"]'));
    dom.window.close();
  }
});

test('successful management responses retain role-specific navigation without inferring a role from an ordinary reader', () => {
  for (const owner of [true, false]) {
    const dom = render({ me: null, manage: { state: 'ready', data: data(owner) }, tab: 'queue' }), doc = dom.window.document;
    assert.equal(doc.querySelector('.community-page-head h1').textContent, owner ? '作者社区管理' : '版主社区管理');
    assert.equal(Boolean(doc.querySelector('nav a[href="#/community/manage/items"]')), owner);
    assert.ok(doc.querySelector('.community-management-exits [data-action="community-browse-mode"]'));
    dom.window.close();
  }
});

test('forbidden management never offers an account impersonation picker to readers', () => {
  for (const communityTheme of ['light', 'dark']) {
    const dom = render({ me: { ...reader, previewIdentityHref: '/api/community/preview-identity' }, manage: denied, communityTheme });
    const link = dom.window.document.querySelector('[data-content-state="forbidden"] a[href^="/api/community/preview-identity"]');
    assert.equal(link, null, 'an ordinary reader cannot switch to an author or moderator');
    dom.window.close();
  }
  for (const previewIdentityHref of [undefined, 'https://evil.example/', 'javascript:alert(1)', '/api/community/preview-identity?role=owner']) {
    const dom = render({ me: { ...reader, previewIdentityHref }, manage: denied });
    assert.equal(dom.window.document.querySelector('[data-content-state="forbidden"] a[href^="/api/community/preview-identity"]'), null);
    dom.window.close();
  }
});
