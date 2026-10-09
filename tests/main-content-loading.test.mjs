import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { createContentReader, contentQuery } from '../src/content-reader.ts';
import { parseRoute } from '../src/core.ts';
import { publicRoute } from '../src/access-policy.ts';
import { communityHostRoute, communityEntryDestination } from '../src/community-entry.ts';
import { rewriteCommunityMainSiteLinks } from '../src/community-entry.ts';
import { communityView, communityRoute, inCommunityArea } from '../src/community-routing.ts';
import { communityLandingHTML } from '../src/community-introduction.ts';
import { communityHeaderHTML, communityAccountHTML } from '../src/community.ts';
import { readerGate } from '../src/reader-ui.ts';
import { setContentHTML } from '../src/content-images.ts';
import { createRouteTransitions } from '../src/route-transition.ts';
import { createCommunityAppearance } from '../src/community-appearance.ts';
import { ensureRouteStyle } from '../src/route-styles.ts';
import { communityHostDocument } from '../server/community-host-document.ts';

const app = readFileSync(new URL('../src/app.mjs', import.meta.url), 'utf8');
const renderSource = app.slice(app.indexOf('async function render(options={})'), app.indexOf('function renderView('));
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const slowTurn = () => new Promise(resolve => setTimeout(resolve, 145));
const result = items => ({ items, total: items.length, page: 1, pages: 1 });

// Run the formal render dispatcher and real request/cache implementation. Only
// the unrelated page templates and WebGL/widget mounts are replaced here.
function setup(t) {
  const dom = new JSDOM('<main id="main"></main>', { url: 'https://www.sansphase.com/#/notes' });
  const main = dom.window.document.querySelector('main'), calls = [], rendered = [];
  const contentReader = createContentReader((url, init) => new Promise((resolve, reject) => {
    calls.push({ url, init, resolve });
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }));
  const siteContent = { delivery: 'paged-v1', reader: { nickname: '读者' }, author: null, notes: [], works: [], resources: [], software: [], 'resource-center': [] };
  let promptOpened = 0;
  const context = { siteContent, contentReader, main, window: dom.window, document: dom.window.document,
    parseRoute, publicRoute, contentQuery, communityHostRoute, communityEntryDestination,
    location: { hash: '#/notes', pathname: '/', search: '', assign() {} }, history: { replaceState() {} },
    communityOnly: () => false, communityEnabled: () => false, communityEntry: { cancel() {} },
    readerAccessEnabled: true, renderGeneration: 0, loadedContentKey: '', remotePage: null,
    filterPage: '', activeCategory: 'all', activeQuery: '', catalogPageNumber: 1,
    communityView: () => 'unknown', inCommunityArea, communityModule: {}, communityStyleReady: false, ensureRouteStyle: async () => {},
    prepareCommunityLanding: async () => {}, catalogState: () => ({ page: context.catalogPageNumber, category: context.activeCategory, query: context.activeQuery }),
    vipBookPrompt: { open() { promptOpened++; } }, loadAdminReaders: async () => ({}), adminReadersModule: null,
    acceptContent(query, value) {
      siteContent[query.get('kind')] = query.get('view') === 'detail' ? value.item ? [value.item] : [] : value.items;
      context.remotePage = query.get('view') === 'list' ? value : null;
      context.loadedContentKey = query.toString();
    },
    renderView(options = {}) {
      contentReader.presentation?.clear();
      rendered.push({ ...options, route: context.location.hash });
      const route = parseRoute(context.location.hash), query = contentQuery(route);
      const items = query ? siteContent[query.get('kind')] ?? [] : [];
      const preview = siteContent.preview?.id === route.id ? siteContent.preview.title : '';
      main.innerHTML = `<section data-state="${options.contentStatus ?? 'ready'}">${options.contentStatus ?? preview ?? ''}${items.map(item => item.title).join('|')}</section>`;
    },
  };
  vm.createContext(context);
  vm.runInContext(renderSource + '\nglobalThis.render = render;', context);
  const navigate = hash => { context.location.hash = hash; context.loadedContentKey = ''; return context.render(); };
  const respond = (index, value, status = 200, headers = {}) => calls[index].resolve(new Response(status === 304 ? null : JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } }));
  const seed = async () => { const loading = context.render(); respond(calls.length - 1, result([{ id: 'one', title: '已验证公开列表' }]), 200, { etag: '"one"' }); await loading; };
  t.after(() => { contentReader.clear(); dom.window.close(); });
  return { context, contentReader, siteContent, main, dom, calls, rendered, navigate, respond, seed, promptOpened: () => promptOpened };
}

test('a failed first forum stylesheet exposes the existing retry state without painting unstyled forum controls', async t => {
  const s = setup(t);
  s.context.communityEnabled = () => true;
  s.context.communityView = () => 'home';
  let attempts = 0;
  s.context.ensureRouteStyle = async () => { if (++attempts === 1) throw new Error('CSS read expired'); };
  await s.navigate('#/community/home');
  assert.equal(s.context.communityStyleReady, false);
  assert.equal(s.rendered.at(-1).contentStatus, 'error');
  await s.context.render();
  assert.equal(attempts, 2);
  assert.equal(s.context.communityStyleReady, true);
  assert.equal(s.rendered.at(-1).contentStatus, undefined);
});

test('a fast validated public navigation commits its target once without a loading flash', async t => {
  const s = setup(t); await s.seed();
  const before = s.rendered.length, rendering = s.navigate('#/works');
  assert.equal(s.rendered.length, before, 'do not replace the already verified page before a fast response');
  assert.match(s.main.textContent, /已验证公开列表/);
  assert.equal(s.main.hasAttribute('inert'), true);
  assert.equal(s.main.getAttribute('aria-busy'), 'true');
  s.respond(1, result([{ id: 'work', title: '已验证目标作品' }])); await rendering;
  assert.equal(s.rendered.length, before + 1);
  assert.match(s.main.textContent, /已验证目标作品/);
  assert.equal(s.main.hasAttribute('inert'), false);
  assert.equal(s.main.hasAttribute('aria-busy'), false);
  await slowTurn(); assert.equal(s.rendered.length, before + 1, 'settled requests dispose the delayed loading timer');
});

test('a slow public navigation retains the previous inert page briefly, then shows the existing loading state', async t => {
  const s = setup(t); await s.seed();
  const before = s.rendered.length, rendering = s.navigate('#/software');
  assert.equal(s.rendered.length, before); await slowTurn();
  assert.equal(s.rendered.length, before + 1);
  assert.equal(s.main.querySelector('section').dataset.state, 'loading');
  assert.equal(s.main.hasAttribute('inert'), false);
  s.respond(1, result([{ id: 'software', title: '软件资料' }])); await rendering;
  assert.equal(s.main.querySelector('section').dataset.state, 'ready');
  assert.equal(s.main.hasAttribute('aria-busy'), false);
});

test('first loads, author previews, private book details and non-content pages cannot be retained', async t => {
  const s = setup(t);
  let rendering = s.context.render();
  assert.equal(s.rendered[0].contentStatus, 'loading');
  s.respond(0, result([{ id: 'one', title: '公开列表' }])); await rendering;
  s.siteContent.preview = { id: 'draft', title: '私有作者预览' };
  await s.navigate('#/note/draft');
  assert.match(s.main.textContent, /私有作者预览/);
  rendering = s.navigate('#/works');
  assert.equal(s.rendered.at(-1).contentStatus, 'loading', 'a private preview is removed synchronously');
  assert.doesNotMatch(s.main.textContent, /私有作者预览/);
  s.respond(1, result([])); await rendering;
  delete s.siteContent.preview;
  rendering = s.navigate('#/resource-center/book');
  s.respond(2, { item: { id: 'book', title: '书籍内容' } }); await rendering;
  rendering = s.navigate('#/notes');
  assert.equal(s.rendered.at(-1).contentStatus, 'loading', 'book reading content is never eligible for deferred replacement');
  s.respond(3, result([])); await rendering;
  await s.navigate('#/contact');
  rendering = s.navigate('#/works');
  assert.equal(s.rendered.at(-1).contentStatus, 'loading');
  s.respond(4, result([])); await rendering;
});

test('quick route changes abort earlier requests and their late replies and timers cannot replace the current page', async t => {
  const s = setup(t); await s.seed();
  const before = s.rendered.length;
  const first = s.navigate('#/works'), second = s.navigate('#/software');
  assert.equal(s.calls[1].init.signal.aborted, true);
  assert.equal(s.rendered.length, before);
  s.respond(2, result([{ id: 'current', title: '当前软件' }])); await second;
  s.respond(1, result([{ id: 'late', title: '已过期作品' }])); await first;
  assert.match(s.main.textContent, /当前软件/); assert.doesNotMatch(s.main.textContent, /已过期作品/);
  await slowTurn(); assert.equal(s.rendered.length, before + 1);
  assert.equal(s.main.hasAttribute('inert'), false);
});

test('navigation adopts an actual pending prefetch without painting its unvalidated target', async t => {
  const s = setup(t); await s.seed();
  const query = contentQuery({ page: 'works' });
  const prefetch = s.contentReader.prefetch(query);
  const before = s.rendered.length, rendering = s.navigate('#/works');
  assert.equal(s.calls.length, 2, 'the real reader shares the pending request');
  assert.equal(s.rendered.length, before);
  assert.match(s.main.textContent, /已验证公开列表/);
  s.respond(1, result([{ id: 'work', title: '已确认预取作品' }]));
  await prefetch; await rendering;
  assert.equal(s.rendered.length, before + 1);
  assert.match(s.main.textContent, /已确认预取作品/);
  assert.equal(s.main.hasAttribute('inert'), false);
});

test('a content reply does not release retained controls while a required book stylesheet is still pending', async t => {
  const s = setup(t); await s.seed();
  let ready;
  s.context.ensureRouteStyle = () => new Promise(resolve => { ready = resolve; });
  const before = s.rendered.length, rendering = s.navigate('#/resource-center/book');
  s.respond(1, { item: { id: 'book', title: '已确认书籍' } }); await turn();
  assert.equal(s.rendered.length, before);
  assert.equal(s.main.hasAttribute('inert'), true);
  await slowTurn();
  assert.equal(s.rendered.at(-1).contentStatus, 'loading');
  ready(); await rendering;
  assert.match(s.main.textContent, /已确认书籍/);
  assert.equal(s.main.hasAttribute('inert'), false);
});

test('revalidated cached targets are committed only after 304 and withdrawn targets become 404 instead of cached content', async t => {
  const s = setup(t); await s.seed();
  let rendering = s.navigate('#/note/article');
  s.respond(1, { item: { id: 'article', title: '上次公开文章' } }, 200, { etag: '"article"' }); await rendering;
  rendering = s.navigate('#/notes'); s.respond(2, null, 304); await rendering;
  const before = s.rendered.length;
  rendering = s.navigate('#/note/article');
  assert.equal(s.calls[3].init.headers['If-None-Match'], '"article"');
  assert.doesNotMatch(s.main.textContent, /上次公开文章/);
  assert.equal(s.rendered.length, before);
  s.respond(3, null, 304); await rendering;
  assert.match(s.main.textContent, /上次公开文章/);
  rendering = s.navigate('#/notes'); s.respond(4, null, 304); await rendering;
  rendering = s.navigate('#/note/article'); s.respond(5, { error: 'withdrawn' }, 404); await rendering;
  assert.equal(s.main.querySelector('section').dataset.state, 'ready');
  assert.doesNotMatch(s.main.textContent, /上次公开文章/);
  assert.deepEqual(s.siteContent.notes, []);
  assert.equal(s.main.hasAttribute('inert'), false);
});

test('VIP and unavailable responses replace retained public content with the existing permission or retry state', async t => {
  const s = setup(t); await s.seed();
  let rendering = s.navigate('#/resource-center/locked');
  s.respond(1, { code: 'VIP_REQUIRED', error: 'locked' }, 403); await rendering;
  assert.equal(s.main.querySelector('section').dataset.state, 'vip');
  assert.equal(s.promptOpened(), 1); assert.equal(s.main.hasAttribute('inert'), false);
  rendering = s.navigate('#/notes'); s.respond(2, result([])); await rendering;
  rendering = s.navigate('#/works'); s.respond(3, { error: 'unavailable' }, 503); await rendering;
  assert.equal(s.main.querySelector('section').dataset.state, 'error');
  assert.equal(s.main.hasAttribute('aria-busy'), false);
  assert.equal(s.main.hasAttribute('inert'), false);
  const count = s.rendered.length; await slowTurn(); assert.equal(s.rendered.length, count);
});

test('reader identity changes synchronously cancel a retained navigation and preserve the actual auth gate against late responses', async t => {
  const s = setup(t); await s.seed();
  const eventStart = app.indexOf("window.addEventListener('author:identity',event=>{");
  const eventEnd = app.indexOf('readerUI=mountReaderUI(', eventStart);
  s.context.communityUI = { clear() {} };
  vm.runInContext(app.slice(eventStart, eventEnd), s.context);
  const rendering = s.navigate('#/works');
  assert.equal(s.main.hasAttribute('inert'), true);
  s.dom.window.dispatchEvent(new s.dom.window.CustomEvent('reader:identity', { detail: null }));
  assert.equal(s.main.querySelector('section').dataset.state, 'auth');
  assert.equal(s.main.hasAttribute('inert'), false);
  assert.equal(s.calls[1].init.signal.aborted, true);
  s.respond(1, result([{ id: 'late', title: '旧身份请求' }])); await rendering;
  await slowTurn(); assert.equal(s.main.querySelector('section').dataset.state, 'auth');
  assert.doesNotMatch(s.main.textContent, /旧身份请求/);
});

test('author identity changes invalidate retained pages synchronously even when the new identity can still read the target', async t => {
  const s = setup(t); await s.seed();
  const eventStart = app.indexOf("window.addEventListener('author:identity',event=>{");
  const eventEnd = app.indexOf('readerUI=mountReaderUI(', eventStart);
  s.context.communityUI = { clear() {} };
  vm.runInContext(app.slice(eventStart, eventEnd), s.context);
  const first = s.navigate('#/works');
  assert.equal(s.main.hasAttribute('inert'), true);
  s.dom.window.dispatchEvent(new s.dom.window.CustomEvent('author:identity', { detail: { role: 'owner' } }));
  assert.equal(s.main.querySelector('section').dataset.state, 'loading', 'identity invalidation must not retain the old publication page');
  assert.equal(s.main.hasAttribute('inert'), false);
  assert.equal(s.calls[1].init.signal.aborted, true);
  s.respond(2, result([{ id: 'fresh', title: '新身份已验证内容' }])); await turn(); await first;
  assert.match(s.main.textContent, /新身份已验证内容/);
  const count = s.rendered.length; await slowTurn(); assert.equal(s.rendered.length, count);
});

test('an author publication event retires a pending navigation before waiting for its new background resource', async t => {
  const s = setup(t); await s.seed();
  const eventStart = app.indexOf("window.addEventListener('author:content',async event=>{");
  const eventEnd = app.indexOf('\nblogWeather.bind();', eventStart);
  let backgroundReady;
  Object.assign(s.context, { scrollY: 0, resourceCenter: [], notes: [], resources: [], software: [], works: [],
    blogPhoto: { getAttribute: () => 'old.jpg' }, imageSourceSet: () => '',
    Image: class { decode() { return new Promise(resolve => { backgroundReady = resolve; }); } },
  });
  s.dom.window.scrollTo = () => {};
  vm.runInContext(app.slice(eventStart, eventEnd), s.context);
  const rendering = s.navigate('#/works'), before = s.rendered.length;
  s.dom.window.dispatchEvent(new s.dom.window.CustomEvent('author:content', {
    detail: { ...s.siteContent, profile: { background: 'new.jpg' } },
  }));
  assert.equal(s.calls[1].init.signal.aborted, true);
  await turn(); await rendering;
  assert.equal(s.rendered.length, before, 'aborting the old read while the publication background prepares must not paint an old-route error');
  assert.match(s.main.textContent, /已验证公开列表/);
  assert.equal(s.main.hasAttribute('inert'), false);
  backgroundReady(); await turn();
  assert.equal(s.rendered.at(-1).contentStatus, 'loading', 'new publication data invalidates retention until freshly read');
  s.respond(2, result([{ id: 'fresh', title: '新发布版本作品' }])); await turn();
  assert.match(s.main.textContent, /新发布版本作品/);
  const count = s.rendered.length; await slowTurn(); assert.equal(s.rendered.length, count);
});

test('render replacement and page cancellation restore the exact previous busy/inert attributes', async t => {
  const s = setup(t); await s.seed();
  s.main.setAttribute('aria-busy', 'false');
  const rendering = s.navigate('#/works');
  assert.equal(s.main.getAttribute('aria-busy'), 'true');
  s.contentReader.cancel();
  assert.equal(s.main.hasAttribute('inert'), false);
  assert.equal(s.main.getAttribute('aria-busy'), 'false');
  s.respond(1, result([])); await rendering;
  await slowTurn();
  assert.equal(s.main.hasAttribute('inert'), false);
  assert.match(app, /function renderView\([^\n]+\) \{\s*contentReader\.presentation\?\.clear\(\)/,
    'the actual render mount must release retained DOM before replacing it');
});

// Preserve the formal dispatcher, header, DOM commit and boot/arrival path.
// Only unrelated widgets and the forum's business payload are substituted.
const foundationCSS = readFileSync(new URL('../src/styles-foundation.css', import.meta.url), 'utf8');
const appFunction = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const bootViewStart = app.indexOf('function renderView(');
const bootViewSource = app.slice(bootViewStart, app.indexOf("  cleanReaderAdmin=page==='admin'", bootViewStart)) + '\n}';
function setupCommunityBoot(t, { only = true, hash = '#/community/home', reader = { nickname: '读者', uid: '10001' }, destination, reduced = false } = {}) {
  const html = `<html><head><style>${foundationCSS}</style></head><body><header id="site-header"></header><div id="blog-backdrop"></div><main id="main"></main></body></html>`;
  const dom = new JSDOM(only ? communityHostDocument(html) : html, { url: `https://${only ? 'community' : 'www'}.sansphase.com/${hash}`, pretendToBeVisual: true });
  const { document } = dom.window, main = document.querySelector('main'), noop = () => {};
  dom.window.matchMedia = () => ({ matches: reduced });
  const siteContent = { communityOnly: only, communityEnabled: true, reader, author: null, mainSiteOrigin: 'https://www.sansphase.com',
    ...(destination ? { communityDestination: destination } : {}) };
  const transitions = createRouteTransitions(document), appearance = createCommunityAppearance(document, dom.window);
  if (only) appearance.sync(true);
  let arrivals = 0, skyMounts = 0, lastRender;
  const commits = [];
  const context = {
    siteContent, window: dom.window, document, main, location: dom.window.location, history: dom.window.history,
    parseRoute, publicRoute, communityHostRoute, communityEntryDestination, rewriteCommunityMainSiteLinks,
    communityView, communityRoute, inCommunityArea, communityHeaderHTML, communityAccountHTML, communityLandingHTML, readerGate,
    setContentHTML(root, markup) { commits.push(markup); setContentHTML(root, markup); },
    communityOnly: () => siteContent.communityOnly === true, communityEnabled: () => siteContent.communityEnabled === true,
    readerAccessEnabled: true, communityEntry: { cancel: noop, state: () => 'idle' },
    // These existing stylesheet/DOM tests already own the forum controller;
    // the separate runtime-loading suite covers the cold module boundary.
    renderGeneration: 0, loadedContentKey: '', remotePage: null, communityModule: {}, communityStyleReady: false, ensureRouteStyle,
    prepareCommunityLanding: async () => {}, contentReader: { cancel: noop, presentation: { release: noop, clear: noop } },
    filterPage: '', activeCategory: 'all', activeQuery: '', catalogPageNumber: 1, catalogState: () => ({}), contentQuery: () => null,
    vipBookPrompt: null, language: 'zh', t: zh => zh, icons: {}, arrow: '', esc: value => String(value ?? ''),
    routeTransitions: { ...transitions, arrive() { arrivals++; transitions.arrive(); } }, communityAppearance: appearance,
    mountCommunitySky(host) { skyMounts++; const canvas = document.createElement('canvas'); canvas.className = 'community-sky'; host.append(canvas); return () => canvas.remove(); },
    communityUI: { me: () => null, html: () => '<section data-community="home"><p>社区已就绪</p></section>', frameHTML: () => '', renderManagement: () => false, mount: () => noop },
    communityFrame: { enabled: () => false, dispose: noop, header: () => false, render: () => false }, communityContext: () => ({}),
    syncContentCollections: noop, setupStage: noop, musicModule: null, applyCardAppearance: noop, personalPage: () => false,
    blogPhoto: null, syncBlogBackdrop: noop, blogTheme: 'dark', homeRoot: null, cleanStage: { setCovered: noop, setLanguage: noop },
    siteSections: [{ id: 'notes', zh: '博客', en: 'Blog' }], cleanNavSlider: noop, mountNavSlider: () => noop, homeMusicControls: () => '', closeMenu: noop,
    home: () => '', worksPage: () => '', blogPage: { html: () => '' }, resourcesPage: () => '', softwarePage: () => '', resourceCenterPage: () => '',
    supportPage: () => '', contactPage: () => '', accountPage: () => '', readerPage: () => '', adminPage: () => '', libraryDetail: () => '', articlePage: () => '', postPage: () => '',
    categoryUI: undefined, blogClock: { unmount: noop }, cleanGlassSurfaces: noop, cleanArticleReading: noop, cleanBookReading: noop,
    cleanContentImages: noop, cleanMobileBlogOrder: noop, cleanReaderAdmin: noop, cleanCommunity: noop, readerUI: null,
    vipBookGate: () => '', closedPage: () => '<section class="page">社区未开放</section>',
  };
  vm.createContext(context);
  vm.runInContext([
    appFunction('function header(page)', 'function home()'), appFunction('function communityPage()', 'function sectionsHTML('),
    appFunction('function notFound(', "document.addEventListener('visibilitychange'"), appFunction('function contentMessage(', 'function acceptContent('),
    appFunction('let communityArrived =', 'let cleanCommunity ='), appFunction('let cleanCommunitySky = null;', '// The header reads'),
    bootViewSource, renderSource, 'globalThis.render = render; globalThis.commitView = renderView;',
    appFunction('document.addEventListener("click", (e) => {', 'document.addEventListener("input", (e) => {'),
  ].join('\n'), context);
  const actualRender = context.render;
  context.render = (...args) => { lastRender = actualRender(...args); return lastRender; };
  t.after(() => { context.syncCommunitySky(false); transitions.dispose(); dom.window.close(); });
  return { context, document, dom, main, commits, siteContent,
    get arrivals() { return arrivals; }, get skyMounts() { return skyMounts; },
    get boot() { return document.body.dataset.communityBoot; }, get opacity() { return dom.window.getComputedStyle(document.body).opacity; },
    style() { return document.querySelector('[data-route-style="community"]'); },
    retry() { main.querySelector('[data-action="retry-content"]').click(); return lastRender; },
  };
}
function assertVisibleTerminal(s) {
  assert.equal(s.boot, undefined, 'the committed terminal page releases the first-visit curtain');
  assert.notEqual(s.opacity, '0');
  assert.equal(s.arrivals, 0, 'a recovery page does not consume the forum first arrival');
}
function assertSharedRecovery(s) {
  assert.equal(s.document.querySelector('#site-header').classList.contains('community-header'), false);
  assert.equal(s.document.querySelector('[data-action="community-theme-toggle"], .community-account, .community-nav'), null);
  assert.ok(s.document.querySelector('#site-header .brand'), 'the shared, already styled header remains usable');
  assert.equal(s.document.querySelector('#site-header .nav a').href, 'https://www.sansphase.com/#/notes');
  assert.equal(s.skyMounts, 0, 'there is no unstyled canvas or animation work before community CSS is ready');
  assert.equal(s.document.querySelector('.community-sky'), null);
}

test('first community stylesheet error commits a visible shared recovery page and the real retry restores the forum once', async t => {
  const s = setupCommunityBoot(t), reading = s.context.render();
  assert.equal(s.boot, 'pending'); assert.equal(s.commits.length, 0);
  const failedLink = s.style(); failedLink.dispatchEvent(new s.dom.window.Event('error')); await reading;
  assert.ok(s.main.querySelector('[data-action="retry-content"]'));
  assert.equal(s.context.communityStyleReady, false); assertVisibleTerminal(s); assertSharedRecovery(s);
  const retry = s.retry(), retryLink = s.style(); assert.notEqual(retryLink, failedLink);
  failedLink.dispatchEvent(new s.dom.window.Event('load')); failedLink.dispatchEvent(new s.dom.window.Event('error'));
  assert.equal(s.style(), retryLink); assert.equal(s.main.querySelector('[data-community]'), null);
  assert.equal(s.skyMounts, 0, 'the recovery page stays usable until a fresh stylesheet succeeds');
  retryLink.dispatchEvent(new s.dom.window.Event('load')); await retry;
  assert.equal(s.context.communityStyleReady, true); assert.equal(s.arrivals, 1); assert.notEqual(s.opacity, '0');
  assert.ok(s.main.querySelector('[data-community="home"]')); assert.ok(s.document.querySelector('.community-header .community-nav'));
  assert.equal(s.skyMounts, 1); await s.context.render(); assert.equal(s.arrivals, 1); assert.equal(s.skyMounts, 1);
});

test('the actual ten-second stylesheet deadline reveals recovery without retaining its link or mounting unstyled sky', async t => {
  const s = setupCommunityBoot(t); t.mock.timers.enable({ apis: ['setTimeout'] });
  const reading = s.context.render(), old = s.style(); t.mock.timers.tick(10_000); await reading;
  assert.equal(old.isConnected, false); assert.equal(s.style(), null); assert.ok(s.main.querySelector('[data-action="retry-content"]'));
  assertSharedRecovery(s); assertVisibleTerminal(s);
  const retry = s.retry(); s.style().dispatchEvent(new s.dom.window.Event('load')); await retry;
  assert.equal(s.arrivals, 1); t.mock.timers.tick(20_000); assert.equal(s.style().isConnected, true);
});

test('generic and forum loading leave the first community curtain closed until real forum readiness', async t => {
  const s = setupCommunityBoot(t);
  s.context.commitView({ contentStatus: 'loading' }); assert.equal(s.boot, 'pending'); assert.equal(s.opacity, '0'); assert.equal(s.arrivals, 0);
  s.context.communityStyleReady = true;
  s.context.communityUI.html = () => '<section data-community="home"><div data-content-state="loading">正在加载社区</div></section>';
  s.context.commitView(); assert.equal(s.boot, 'pending'); assert.equal(s.opacity, '0'); assert.equal(s.arrivals, 0);
  s.context.communityUI.html = () => '<section data-community="home">就绪</section>';
  s.context.commitView(); assert.equal(s.boot, undefined); assert.equal(s.arrivals, 1); s.context.commitView(); assert.equal(s.arrivals, 1);
});

test('a retained invalid community route commits visible 404 with shared recovery chrome and no CSS request', async t => {
  const s = setupCommunityBoot(t, { hash: '#/community/invalid' });
  assert.equal(communityHostRoute(s.siteContent, s.context.location.hash).hash, '#/community/invalid');
  await s.context.render(); assert.match(s.main.textContent, /404 \/ A LITTLE OFF TRACK/); assert.equal(s.style(), null);
  assertVisibleTerminal(s); assertSharedRecovery(s);
});

test('defensive missing-identity terminal content is visible without claiming the dedicated host bypasses its server entry gate', async t => {
  const s = setupCommunityBoot(t, { reader: null }); await s.context.render();
  assert.ok(s.main.querySelector('.reader-gate-action')); assert.equal(s.main.querySelector('.reader-gate-action').href, 'https://www.sansphase.com/#/account');
  assertVisibleTerminal(s); assertSharedRecovery(s);
});

for (const stale of ['success', 'failure']) test(`a late ${stale} from an old render cannot reveal or replace a newer pending community page`, async t => {
  const s = setupCommunityBoot(t), styles = [];
  s.context.ensureRouteStyle = () => new Promise((resolve, reject) => styles.push({ resolve, reject }));
  const old = s.context.render(); s.context.location.hash = '#/community/shop'; const current = s.context.render();
  if (stale === 'success') styles[0].resolve(); else styles[0].reject(new Error('old stylesheet failure'));
  await old; assert.equal(s.commits.length, 0); assert.equal(s.boot, 'pending'); assert.equal(s.opacity, '0'); assert.equal(s.arrivals, 0); assert.equal(s.skyMounts, 0);
  styles[1].resolve(); await current; assert.equal(s.commits.length, 1); assert.equal(s.boot, undefined); assert.equal(s.arrivals, 1);
});

test('main-site landing failure remains visible and the dedicated entry keeps its existing home normalization', async t => {
  const s = setupCommunityBoot(t, { only: false, hash: '#/community', destination: 'https://community.sansphase.com' });
  s.context.communityStyleReady = true; s.context.prepareCommunityLanding = async () => { throw new Error('landing unavailable'); };
  await s.context.render(); assert.ok(s.main.querySelector('[data-action="retry-content"]')); assert.equal(s.boot, undefined); assert.notEqual(s.opacity, '0'); assert.equal(s.arrivals, 0);
  const dedicated = setupCommunityBoot(t, { hash: '#/community' }); const reading = dedicated.context.render();
  assert.equal(dedicated.context.location.hash, '#/community/home'); dedicated.style().dispatchEvent(new dedicated.dom.window.Event('load')); await reading;
  assert.equal(dedicated.arrivals, 1); assert.ok(dedicated.main.querySelector('[data-community="home"]'));
});

for (const reduced of [false, true]) test(`successful first forum arrival releases boot once with reduced-motion=${reduced} and no animation API`, async t => {
  const s = setupCommunityBoot(t, { reduced }), reading = s.context.render();
  s.style().dispatchEvent(new s.dom.window.Event('load')); await reading;
  assert.equal(s.boot, undefined); assert.notEqual(s.opacity, '0'); assert.equal(s.arrivals, 1);
  await s.context.render(); assert.equal(s.arrivals, 1);
});
