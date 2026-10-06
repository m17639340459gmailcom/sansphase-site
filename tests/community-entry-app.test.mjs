import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { parseRoute } from '../src/core.ts';
import { communityHostRoute, communityEntryDestination, createCommunityEntry } from '../src/community-entry.ts';
import { communityLandingHTML } from '../src/community.ts';
import { readerGate } from '../src/reader-ui.ts';

// Exercise the app's existing render dispatcher without importing its WebGL
// and desktop UI bundles or using a browser automation workaround.
const app = readFileSync(new URL('../src/app.mjs', import.meta.url), 'utf8');
const renderSource = app.slice(app.indexOf('async function render(options={})'), app.indexOf('function renderView('));
function setup(identity = true) {
  const dom = new JSDOM('<main id="main"></main>', { url: 'https://www.sansphase.com/#/community' });
  const config = { communityDestination: 'https://community.sansphase.com', communityEnabled: false, reader: identity ? { nickname: '读者' } : null, author: null };
  const calls = [], navigations = [], fades = [], rendered = [];
  let status = 200;
  const context = { siteContent: config, parseRoute, communityHostRoute, communityEntryDestination, location: { hash: '#/community', pathname: '/', search: '', assign: url => navigations.push(url) }, communityOnly: () => config.communityOnly === true, communityEnabled: () => config.communityEnabled === true, renderGeneration: 0, contentReader: { cancel() {} }, loadedContentKey: '', remotePage: null, document: dom.window.document, communityStyleReady: false, ensureRouteStyle: async () => {}, prepareCommunityLanding: async () => {}, history: { replaceState: (_state, _title, path) => { context.location.hash = path.slice(path.indexOf('#')); } },
    renderView(options) {
      rendered.push(options);
      dom.window.document.querySelector('main').innerHTML = options.contentStatus === 'auth' ? readerGate() : config.communityDestination ? communityLandingHTML(zh => zh, {}, { entryState: context.communityEntry.state() }) : '<section data-content-state="not-open">社区尚未开放</section>';
    },
  };
  context.communityEntry = createCommunityEntry({ config: () => config, request: async (url, init) => { calls.push({ url, init }); return { status, ok: status === 200, json: async () => ({ url: 'https://community.sansphase.com/community-enter#community-entry=' + 'a'.repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString() }) }; }, navigate: url => navigations.push(url), fadeOut: async () => { fades.push('fade'); }, restore: () => {}, changed: state => { if (state === 'auth') { config.reader = null; config.author = null; } void context.render({ preserveScroll: true }); } });
  vm.createContext(context);
  vm.runInContext(renderSource + '\nglobalThis.render = render;', context);
  return { context, dom, calls, navigations, fades, rendered, config, status: value => { status = value; }, close: () => dom.window.close() };
}
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

test('the introduction commits once after its actual sky resource preparation, without painting an intermediate landing', async () => {
  const s = setup();
  let ready;
  s.context.prepareCommunityLanding = () => new Promise(resolve => { ready = resolve; });
  s.dom.window.document.querySelector('main').innerHTML = '<section data-previous-page>之前的页面</section>';
  try {
    const rendering = s.context.render(); await turn();
    assert.equal(s.rendered.length, 0, 'CSS readiness alone must not commit a sky that is still loading');
    assert.ok(s.dom.window.document.querySelector('[data-previous-page]'));
    assert.equal(s.dom.window.document.querySelector('[data-community="landing"]'), null);
    ready(); await rendering;
    assert.equal(s.rendered.length, 1);
    assert.ok(s.dom.window.document.querySelector('[data-community="landing"]'));
    assert.equal(s.dom.window.document.querySelector('.community-orbits i'), null, 'the retired three-ring layer is not present in the current markup');
    assert.equal(s.calls.length, 0);
  } finally { s.close(); }
});

test('late sky preparation cannot commit after a newer route cancelled the introduction', async () => {
  const s = setup();
  let ready;
  s.context.prepareCommunityLanding = () => new Promise(resolve => { ready = resolve; });
  try {
    const rendering = s.context.render(); await turn();
    delete s.config.communityDestination;
    await s.context.render();
    assert.ok(s.dom.window.document.querySelector('[data-content-state="not-open"]'));
    const count = s.rendered.length;
    ready(); await rendering;
    assert.equal(s.rendered.length, count);
    assert.equal(s.dom.window.document.querySelector('[data-community="landing"]'), null);
  } finally { s.close(); }
});

test('an unavailable landing bundle renders the existing explicit retry state instead of a substitute sky', async () => {
  const s = setup();
  s.context.prepareCommunityLanding = async () => { throw new Error('bundle unavailable'); };
  try {
    await s.context.render();
    assert.equal(s.rendered.length, 1);
    assert.equal(s.rendered[0].contentStatus, 'error');
    assert.equal(s.calls.length, 0);
  } finally { s.close(); }
});

test('a failed community stylesheet keeps readiness false and a later retry prepares the complete landing', async () => {
  const s = setup();
  let styles = 0;
  s.context.ensureRouteStyle = async () => { if (++styles === 1) throw new Error('CSS unavailable'); };
  try {
    await s.context.render();
    assert.equal(s.context.communityStyleReady, false);
    assert.equal(s.rendered.at(-1).contentStatus, 'error');
    await s.context.render();
    assert.equal(styles, 2);
    assert.equal(s.context.communityStyleReady, true);
    assert.equal(s.rendered.at(-1).contentStatus, undefined);
    assert.ok(s.dom.window.document.querySelector('[data-community="landing"] .community-enter'));
  } finally { s.close(); }
});

test('the landing never mounts the forum sky, while regular forum routes retain its shared canvas', () => {
  const source = app.slice(app.indexOf('let cleanCommunitySky ='), app.indexOf('function closeCommunityAccountOutside'));
  const end = source.indexOf('\n}', source.indexOf('function syncCommunitySky')) + 2;
  const dom = new JSDOM('<div id="blog-backdrop"></div>');
  let mounts = 0, disposed = 0;
  const context = { document: dom.window.document, window: dom.window, location: { hash: '#/community' }, communityRoute: hash => ({ view: hash === '#/community' ? 'landing' : 'home' }), mountCommunitySky: () => { mounts++; return () => disposed++; } };
  vm.createContext(context);
  vm.runInContext(source.slice(0, end) + '\nglobalThis.syncSky = syncCommunitySky;', context);
  try {
    context.syncSky(true); assert.equal(mounts, 0);
    context.location.hash = '#/community/home'; context.syncSky(true);
    assert.equal(mounts, 1); context.syncSky(true); assert.equal(mounts, 1);
    context.location.hash = '#/community'; context.syncSky(true);
    assert.equal(disposed, 1); assert.equal(mounts, 1);
    context.syncSky(false); assert.equal(disposed, 1);
    assert.equal(dom.window.document.body.classList.contains('community-open'), false);
  } finally { dom.window.close(); }
});

test('main navigation keeps the approved introduction and waits for its content button even when signed out', async () => {
  const s = setup(false);
  try {
    await s.context.render();
    assert.ok(s.dom.window.document.querySelector('[data-community="landing"] .community-enter'));
    assert.match(s.dom.window.document.body.textContent, /聊 AI 学习/);
    assert.equal(s.dom.window.document.querySelector('[data-reader-return]'), null);
    assert.equal(s.calls.length, 0); assert.equal(s.navigations.length, 0);
    await s.context.communityEntry.enter(false); await turn();
    assert.ok(s.dom.window.document.querySelector('[data-reader-return]'));
    assert.equal(s.calls.length, 0);
  }
  finally { s.close(); }
});

test('main rendering never mints a ticket; its content button activation and pending re-renders mint once', async () => {
  const s = setup();
  try {
    await Promise.all([s.context.render(), s.context.render()]); await turn();
    assert.equal(s.calls.length, 0); assert.equal(s.navigations.length, 0);
    assert.ok(s.dom.window.document.querySelector('[data-community="landing"]'));
    await Promise.all([s.context.communityEntry.enter(true), s.context.communityEntry.enter(true)]); await turn();
    assert.equal(s.calls.length, 1); assert.equal(s.fades.length, 1); assert.equal(s.navigations.length, 1);
    assert.ok(s.dom.window.document.querySelector('[data-community-entry-enter][disabled]'));
  } finally { s.close(); }
});

test('the original introduction content button alone owns the cross-host entry click', async () => {
  const s = setup();
  const start = app.indexOf("document.addEventListener('click', event => {\n  const button = event.target.closest?.('[data-community-entry-enter]');");
  const source = app.slice(start, app.indexOf('// Content queue switches', start));
  vm.runInContext(source, s.context);
  try {
    await s.context.render();
    const click = new s.dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    s.dom.window.document.querySelector('.community-enter span').dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);
    await turn();
    assert.equal(s.calls.length, 1); assert.equal(s.fades.length, 1); assert.equal(s.navigations.length, 1);
  } finally { s.close(); }
});

test('main app recovers 401 as login and 503 as the original retry control', async () => {
  for (const status of [401, 503]) {
    const s = setup(); s.status(status);
    try {
      await s.context.render(); await turn();
      await s.context.communityEntry.enter(true); await turn();
      assert.equal(s.navigations.length, 0); assert.equal(s.fades.length, 0);
      assert.ok(s.dom.window.document.querySelector(status === 401 ? '[data-reader-return]' : '[data-community-entry-enter]:not([disabled])'));
      if (status === 503) assert.ok(s.dom.window.document.querySelector('[data-community="landing"]'));
      if (status === 401) assert.equal(s.config.reader, null);
    } finally { s.close(); }
  }
});

test('old main-host forum routes resolve to the introduction without an automatic cross-host jump', async () => {
  for (const hash of ['#/community/home', '#/community/manage', '#/community/stardust/levels', '#/post/one']) {
    const s = setup();
    try {
      s.context.location.hash = hash;
      await s.context.render(); await turn();
      assert.equal(s.context.location.hash, '#/community');
      assert.equal(s.calls.length, 0); assert.equal(s.navigations.length, 0);
      assert.ok(s.dom.window.document.querySelector('[data-community="landing"]'));
    } finally { s.close(); }
  }
});

test('a successful sign-in restores the introduction and still waits for its enter button', async () => {
  const s = setup(false);
  try {
    await s.context.communityEntry.enter(false); await turn();
    s.config.reader = { nickname: '读者' };
    await s.context.render(); await turn();
    assert.ok(s.dom.window.document.querySelector('[data-community="landing"]'));
    assert.equal(s.calls.length, 0); assert.equal(s.navigations.length, 0);
  } finally { s.close(); }
});

test('returning to the main introduction through browser history restores its active enter button', async () => {
  const s = setup();
  const start = app.indexOf("window.addEventListener('pageshow', event => {");
  const source = app.slice(start, app.indexOf("window.addEventListener('author:identity'", start));
  s.context.window = s.dom.window;
  vm.runInContext(source, s.context);
  try {
    await s.context.render(); await s.context.communityEntry.enter(true); await turn();
    assert.ok(s.dom.window.document.querySelector('[data-community-entry-enter][disabled]'));
    s.dom.window.dispatchEvent(new s.dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    await turn();
    assert.ok(s.dom.window.document.querySelector('[data-community-entry-enter]:not([disabled])'));
    assert.equal(s.calls.length, 1, 'history restoration cannot mint a second ticket');
  } finally { s.close(); }
});

test('only the main introduction lazily loads its constellation enhancement', async () => {
  assert.doesNotMatch(app, /^import ['"]\.\/community-landing\.mjs['"];$/m);
  const source = app.slice(app.indexOf('let communityLandingModule ='), app.indexOf('function communityPage()'));
  let loads = 0;
  let preparations = 0;
  const dom = new JSDOM('<main><section data-community="home"></section></main>');
  const context = { communityOnly: () => context.only, only: true, main: dom.window.document.querySelector('main'), location: { hash: '#/community/home' }, communityRoute: hash => ({ view: hash === '#/community' ? 'landing' : 'home' }), loadLanding: async () => { loads++; return { prepareCommunityLanding: async () => { preparations++; } }; } };
  vm.createContext(context);
  vm.runInContext(source.replace("import('./community-landing.mjs')", 'loadLanding()') + '\nglobalThis.prepare = prepareCommunityLanding;', context);
  try {
    context.prepare(); await turn(); assert.equal(loads, 0);
    context.main.innerHTML = '<section data-community="landing"></section>';
    context.location.hash = '#/community';
    context.prepare(); await turn(); assert.equal(loads, 0, 'HK never requests the main introduction bundle');
    context.only = false;
    context.prepare(); context.prepare(); await turn(); assert.equal(loads, 1);
    assert.equal(preparations, 2, 'every render awaits the module resource readiness, while the import itself is shared');
    context.location.hash = '#/community/home';
    await context.prepare(); assert.equal(preparations, 2, 'ordinary forums never enter the main landing preparation');
  } finally { dom.window.close(); }
});

test('a verified management identity arriving while the account button is focused is applied when the header loses focus', async () => {
  const source = app.slice(app.indexOf('let communityHeaderPending ='), app.indexOf('const communityContext ='));
  const dom = new JSDOM('<header id="site-header" class="community-header"><button>作者</button></header><button id="outside">正文</button>', { pretendToBeVisual: true });
  let headers = 0;
  const doc = dom.window.document;
  const context = { document: doc, parseRoute, location: { hash: '#/community/home' }, queueMicrotask,
    header: () => { headers++; doc.querySelector('header').innerHTML = '<a href="#/community/manage">管理台</a>'; }, communityReady() {} };
  vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.refresh = refreshCommunityHeader;', context);
  try {
    doc.querySelector('header button').focus();
    context.refresh(); assert.equal(headers, 0, 'do not replace controls beneath active keyboard focus');
    doc.querySelector('#outside').focus(); await turn();
    assert.equal(headers, 1); assert.ok(doc.querySelector('a[href="#/community/manage"]'));
    await turn(); assert.equal(headers, 1, 'identity update is delivered once');
  } finally { dom.window.close(); }
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
