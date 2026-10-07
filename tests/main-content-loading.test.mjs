import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { createContentReader, contentQuery } from '../src/content-reader.ts';
import { parseRoute } from '../src/core.ts';
import { publicRoute } from '../src/access-policy.ts';
import { communityHostRoute, communityEntryDestination } from '../src/community-entry.ts';

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
    communityView: () => 'unknown', communityStyleReady: false, ensureRouteStyle: async () => {},
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
