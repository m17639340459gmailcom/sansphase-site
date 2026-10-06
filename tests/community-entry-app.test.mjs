import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { parseRoute } from '../src/core.ts';
import { communityHostRoute, communityEntryDestination, createCommunityEntry, communityEntryPageHTML } from '../src/community-entry.ts';
import { readerGate } from '../src/reader-ui.ts';

// Exercise the app's existing render dispatcher without importing its WebGL
// and desktop UI bundles or using a browser automation workaround.
const app = readFileSync(new URL('../src/app.mjs', import.meta.url), 'utf8');
const renderSource = app.slice(app.indexOf('async function render(options={})'), app.indexOf('function renderView('));
function setup(identity = true) {
  const dom = new JSDOM('<main id="main"></main>', { url: 'https://www.sansphase.com/#/community/home' });
  const config = { communityDestination: 'https://community.sansphase.com', communityEnabled: false, reader: identity ? { nickname: '读者' } : null, author: null };
  const calls = [], navigations = [], fades = [], rendered = [];
  let status = 200;
  const context = { siteContent: config, parseRoute, communityHostRoute, communityEntryDestination, location: { hash: '#/community/home', assign: url => navigations.push(url) }, communityOnly: () => config.communityOnly === true, communityEnabled: () => config.communityEnabled === true, renderGeneration: 0, contentReader: { cancel() {} }, loadedContentKey: '', remotePage: null, history: { replaceState: () => assert.fail('unexpected history rewrite') },
    renderView(options) {
      rendered.push(options);
      dom.window.document.querySelector('main').innerHTML = options.contentStatus === 'auth' ? readerGate() : config.communityDestination ? communityEntryPageHTML(context.communityEntry.state(), { t: zh => zh }) : '<section data-content-state="not-open">社区尚未开放</section>';
    },
  };
  context.communityEntry = createCommunityEntry({ config: () => config, request: async (url, init) => { calls.push({ url, init }); return { status, ok: status === 200, json: async () => ({ url: 'https://community.sansphase.com/community-enter#community-entry=' + 'a'.repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString() }) }; }, navigate: url => navigations.push(url), fadeOut: async () => { fades.push('fade'); }, restore: () => {}, changed: state => { if (state === 'auth') { config.reader = null; config.author = null; } void context.render({ preserveScroll: true }); } });
  vm.createContext(context);
  vm.runInContext(renderSource + '\nglobalThis.render = render;', context);
  return { context, dom, calls, navigations, fades, rendered, config, status: value => { status = value; }, close: () => dom.window.close() };
}
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

test('main app dispatcher reaches the login gate before the closed local community branch', async () => {
  const s = setup(false);
  try { await s.context.render(); assert.ok(s.dom.window.document.querySelector('[data-reader-return]')); assert.equal(s.calls.length, 0); assert.equal(s.rendered[0].contentStatus, 'auth'); }
  finally { s.close(); }
});

test('main app rendering and pending-state re-render issue only one server ticket and one departure', async () => {
  const s = setup();
  try {
    await Promise.all([s.context.render(), s.context.render()]); await turn();
    assert.equal(s.calls.length, 1); assert.equal(s.fades.length, 1); assert.equal(s.navigations.length, 1);
    assert.ok(s.dom.window.document.querySelector('[data-community-entry-retry][disabled]'));
  } finally { s.close(); }
});

test('main app recovers 401 as login and 503 as the original retry control', async () => {
  for (const status of [401, 503]) {
    const s = setup(); s.status(status);
    try {
      await s.context.render(); await turn();
      assert.equal(s.navigations.length, 0); assert.equal(s.fades.length, 0);
      assert.ok(s.dom.window.document.querySelector(status === 401 ? '[data-reader-return]' : '[data-community-entry-retry]:not([disabled])'));
      if (status === 401) assert.equal(s.config.reader, null);
    } finally { s.close(); }
  }
});

test('main app keeps a disabled destination closed and HK account routes leave before rendering a blog or login layer', async () => {
  const s = setup();
  try {
    delete s.config.communityDestination;
    await s.context.render(); assert.equal(s.calls.length, 0); assert.ok(s.dom.window.document.querySelector('[data-content-state="not-open"]'));
    s.config.communityOnly = true; s.config.mainSiteOrigin = 'https://www.sansphase.com'; s.context.location.hash = '#/account';
    const before = s.rendered.length;
    await s.context.render(); assert.equal(s.rendered.length, before); assert.equal(s.navigations.at(-1), 'https://www.sansphase.com/#/account');
  } finally { s.close(); }
});
