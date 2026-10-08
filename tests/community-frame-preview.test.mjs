import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';
import { communityHeaderHTML, communityRoute, communityBoardHTML, communityBoards } from '../src/community.ts';
import { createStableCommunityFrame } from '../src/community-layout/stable-frame.ts';
import { startCommunityLayout } from '../src/community-layout/runtime.ts';

const turn = () => new Promise(resolve => setTimeout(resolve, 30));
const person = { name: '测试成员', uid: 'u1', role: 'reader', level: 1, owner: false, mod: false, vip: true, balance: 30, checkedIn: false, streak: 1, nextReward: { total: 1, bonus: 0 }, unread: { all: 0 }, inventory: {}, agreed: true };
const topic = id => ({ id, board: 'qa', title: `讨论 ${id}`, pinned: id === 'p1' || id === 'p2', author: person, createdAt: '2026-10-01T10:00:00Z', lastActivityAt: '2026-10-01T10:00:00Z', replies: 2, likes: 1 });
const listing = { items: ['p1', 'p2', 'p3'].map(topic), total: 3, page: 1, pageSize: 20 };
const boardListing = board => ({ ...listing, posters: [{ author: person, topics: 3 }], items: listing.items.map(item => ({ ...item, id: `${board}-${item.id}`, board, title: `${board} ${item.pinned ? '置顶公告' : '讨论'} ${item.id}` })) });
const bannerConfig = scope => ({ scope, version: 1, items: (scope === 'home' ? listing : boardListing(scope)).items.slice(0, 2).map(item => ({ topicId: item.id, title: '', topicTitle: item.title, board: item.board, cover: null, image: null })) });
const thread = { topic: { ...topic('p1'), body: '正在阅读的帖子正文', images: [], canReply: true, liked: false, bookmarked: false }, author: { ...person, topics: 3, replies: 4 }, related: [], replies: [] };
const response = data => ({ ok: true, json: async () => structuredClone(data) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function setup(t, firstHash = '#/community/home', intercept = () => null, simpleCompose = true) {
  const dom = new JSDOM('<html lang="zh"><header id="site-header" class="community-header"></header><main id="main"></main></html>', { url: `http://localhost:4212/?interior=feed&layout=stable${firstHash}`, pretendToBeVisual: true });
  const w = dom.window;
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  let viewportWidth = 1600, reducedMotion = false;
  const queries = new Map();
  const matches = query => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return max ? viewportWidth <= Number(max[1]) : query.includes('prefers-reduced-motion') && reducedMotion;
  };
  w.matchMedia = query => {
    if (!queries.has(query)) {
      const callbacks = new Set();
      queries.set(query, { matches: matches(query), callbacks, addEventListener: (_type, callback) => callbacks.add(callback), removeEventListener: (_type, callback) => callbacks.delete(callback) });
    }
    return queries.get(query);
  };
  const resizeWidth = width => {
    viewportWidth = width;
    const changed = [...queries].filter(([query, media]) => media.matches !== matches(query));
    for (const [query, media] of changed) media.matches = matches(query);
    for (const [, media] of changed) for (const callback of [...media.callbacks]) callback(new w.Event('change'));
  };
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  let me = structuredClone(person);
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, options });
    const supplied = intercept(url, options);
    if (supplied) return supplied;
    if (url.endsWith('/me')) return response(me);
    if (url.endsWith('/summary')) return response({ total: 3, boards: { qa: { topics: 3, repliesToday: 2 } }, hot: [topic('p1')], tags: {}, repliesToday: 2, checkinsToday: me.checkedIn ? 2 : 1 });
    if (url.endsWith('/topics/p1')) return response(thread);
    if (url.includes('/banners?')) return response(bannerConfig(new URL(url, w.location.origin).searchParams.get('scope')));
    if (url.includes('/topics?')) {
      const params = new URL(url, w.location.origin).searchParams;
      const board = params.get('board'), data = board ? boardListing(board) : listing;
      return response({ ...data, pageSize: params.get('sort') === 'curated' ? 6 : 20 });
    }
    if (url.endsWith('/bookmarks')) return response(listing);
    if (url.endsWith('/like')) return response({ likes: 2 });
    if (url.endsWith('/checkin') && options.method === 'POST') { me.checkedIn = true; me.streak = 2; me.balance += 1; return response({ reward: 1, bonus: 0, streak: 2, balance: me.balance }); }
    throw new Error(`Unexpected request ${url}`);
  };
  const ui = createCommunityUI({ request });
  const frame = createStableCommunityFrame(w.document, w, request);
  const main = w.document.getElementById('main');
  const ctx = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {}, members: true, showPostingTips: false, showActiveMembers: false, showHomeCompose: false, simpleCompose,
    painted: () => frame.sync(ui.frameHTML(ctx)), beforePaint: () => frame.preserveReadingPosition(), headerChanged: () => header() };
  function header() {
    const html = communityHeaderHTML({ view: communityRoute(w.location.hash).view, t: ctx.t, actionsHTML: '<button>账号</button>', unchecked: !ui.me()?.checkedIn });
    if (!frame.header(html)) w.document.getElementById('site-header').innerHTML = html;
  }
  let unmount = () => {};
  function render(hash) {
    w.history.replaceState(null, '', hash);
    header(); unmount();
    frame.render(main, ui.html(ctx), ui.frameHTML(ctx));
    unmount = ui.mount(main, ctx);
  }
  const releaseDesign = startCommunityLayout(w.document, w, request);
  t.after(() => {
    w.history.replaceState(null, '', '#/home');
    unmount(); releaseDesign(); frame.dispose();
    for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
    w.close();
  });
  render(firstHash); await turn();
  return { w, main, frame, render, calls, ui, resizeWidth, resize(narrow) { reducedMotion = narrow; resizeWidth(narrow ? 390 : 1600); } };
}

for (const width of [1600, 390]) for (const first of ['identity', 'content']) test(`ordinary navigation at ${width}px keeps the actual readable page until fresh identity and core finish (${first} first)`, async t => {
  let navigating = false;
  const identity = deferred(), content = deferred();
  const { w, main, frame, render, calls, resizeWidth } = await setup(t, '#/community/home', url => {
    if (navigating && url.endsWith('/me')) return identity.promise;
    if (navigating && url.endsWith('/topics/p1')) return content.promise;
    return null;
  });
  resizeWidth(width); await turn();
  const source = main.querySelector('[data-community="home"]'), title = source.querySelector('.community-curated-title[href^="#/post/"]');
  assert.ok(title, 'the initial curated page has a real readable post link');
  const sideAction = main.querySelector('[data-action="community-checkin"]');
  const scroll = width === 390 ? w.document.documentElement : frame.center();
  scroll.dispatchEvent(new w.Event('wheel', { bubbles: true })); scroll.scrollTop = 280;
  navigating = true; render('#/post/p1'); await turn();
  assert.equal(main.querySelector('[data-community="home"]'), source, 'the frame must retain the real source DOM');
  assert.equal(title.isConnected, true);
  assert.equal(source.getAttribute('data-community-pending-route'), 'true');
  assert.equal(source.hasAttribute('inert'), true);
  assert.equal(source.getAttribute('aria-busy'), 'true');
  assert.equal(main.querySelector('[data-content-state="loading"]'), null);
  assert.equal(scroll.scrollTop, 280, 'waiting does not jump the still-visible source page');
  const navigation = w.document.querySelector('#navigation a[href="#/community/home"]');
  assert.ok(navigation, 'use the real primary navigation in the desktop rail or mobile header');
  assert.equal(navigation.closest('[inert]'), null);
  let navigationBlocked = null;
  const observeNavigation = event => { if (event.target === navigation) { navigationBlocked = event.defaultPrevented; event.preventDefault(); } };
  w.document.addEventListener('click', observeNavigation);
  navigation.dispatchEvent(new w.MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
  w.document.removeEventListener('click', observeNavigation);
  assert.equal(navigationBlocked, false, 'the controller and frame must allow real desktop/mobile navigation while waiting');
  const writes = calls.filter(call => call.options.method === 'POST').length;
  sideAction.click(); await turn();
  assert.equal(calls.filter(call => call.options.method === 'POST').length, writes, 'retained sidebar actions are blocked while navigation awaits authority');
  (first === 'identity' ? identity : content).resolve(response(first === 'identity' ? person : thread)); await turn();
  assert.equal(main.querySelector('[data-community="home"]'), source, 'one finished read cannot hand over the page');
  assert.equal(main.querySelector('.community-thread'), null);
  (first === 'identity' ? content : identity).resolve(response(first === 'identity' ? thread : person)); await turn();
  assert.equal(source.isConnected, false);
  assert.ok(main.querySelector('.community-thread'));
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
  assert.equal(main.querySelector('[data-content-state="loading"]'), null);
  assert.equal(scroll.scrollTop, 0, 'the new page starts at the top only when handed over');
});

test('pending navigation blocks retained reply submissions and cannot release an older target after a newer navigation', async t => {
  let navigating = false;
  const oldIdentity = deferred(), latestIdentity = deferred(); let reads = 0;
  const { w, main, render, calls } = await setup(t, '#/post/p1', url => navigating && url.endsWith('/me') ? (++reads === 1 ? oldIdentity.promise : latestIdentity.promise) : null);
  const source = main.querySelector('[data-community="post"]'), form = source.querySelector('form[data-community-form="reply"]');
  const field = form.querySelector('textarea'); field.focus();
  navigating = true; render('#/community/boards/qa'); await turn();
  assert.equal(main.querySelector('[data-community="post"]'), source);
  assert.notEqual(w.document.activeElement, field, 'a retained form cannot keep keyboard focus');
  const shortcut = new w.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
  field.dispatchEvent(shortcut); assert.equal(shortcut.defaultPrevented, true);
  field.value = '不得向新路由提交旧页内容';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  field.dispatchEvent(new w.Event('input', { bubbles: true }));
  await turn();
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 0);
  render('#/community/boards/tools'); await turn();
  oldIdentity.resolve(response(person)); await turn();
  assert.equal(main.querySelector('[data-community="post"]'), source, 'the older authority result cannot release the retained page');
  latestIdentity.resolve(response(person)); await turn();
  assert.match(main.querySelector('[data-frame-route]').textContent, /tools/);
  assert.equal(main.querySelector('[data-frame-route]').textContent.includes('qa 讨论'), false);
  assert.equal(source.isConnected, false);
});

for (const status of [401, 403, 503]) test(`fresh me ${status} immediately retires a held page and exposes the real error action`, async t => {
  let navigating = false;
  const identity = deferred(), content = deferred();
  const { main, render, ui } = await setup(t, '#/community/home', url => {
    if (navigating && url.endsWith('/me')) return identity.promise;
    if (navigating && url.endsWith('/topics/p1')) return content.promise;
    return null;
  });
  const source = main.querySelector('[data-community="home"]');
  navigating = true; render('#/post/p1'); await turn();
  identity.resolve({ ok: false, status, json: async () => ({ error: 'identity unavailable' }) }); await turn();
  assert.equal(source.isConnected, false);
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
  assert.equal(main.querySelector('.community-topic'), null);
  assert.equal(main.querySelector('.community-thread'), null);
  assert.equal(main.querySelector('form[data-community-form="reply"]'), null);
  assert.ok(main.querySelector(`[data-content-state="${status === 401 ? 'auth' : status === 403 ? 'forbidden' : 'error'}"]`));
  if (status === 503) { assert.ok(main.querySelector('button[data-action="community-retry"]')); assert.equal(ui.me()?.uid, person.uid); }
  else assert.equal(ui.me(), null);
  content.resolve(response(thread)); await turn();
  assert.equal(main.querySelector('.community-thread'), null);
});

test('handoff between posts keeps each reply draft with its own topic', async t => {
  let navigating = false;
  const identity = deferred();
  const { w, main, render } = await setup(t, '#/post/p1', url => {
    if (navigating && url.endsWith('/me')) return identity.promise;
    if (url.endsWith('/topics/p2')) return response({ ...thread, topic: { ...thread.topic, id: 'p2', title: '第二篇讨论' } });
    return null;
  });
  const oldField = main.querySelector('form[data-community-form="reply"] textarea');
  oldField.value = '只属于第一篇的草稿'; oldField.dispatchEvent(new w.Event('input', { bubbles: true }));
  navigating = true; render('#/post/p2'); await turn();
  assert.equal(oldField.isConnected, true);
  identity.resolve(response(person)); await turn();
  assert.equal(main.querySelector('form[data-community-form="reply"] textarea').value, '', 'old visible form values cannot migrate to another topic');
  navigating = false; render('#/post/p1'); await turn();
  assert.equal(main.querySelector('form[data-community-form="reply"] textarea').value, '只属于第一篇的草稿');
});

for (const change of ['account', 'permission']) test(`a confirmed ${change} change retires held content before target core finishes`, async t => {
  let navigating = false;
  const identity = deferred(), content = deferred();
  const next = change === 'account' ? { ...person, uid: 'u2' } : { ...person, vip: false };
  const { main, render, ui } = await setup(t, '#/community/home', url => {
    if (navigating && url.endsWith('/me')) return identity.promise;
    if (navigating && url.endsWith('/topics/p1')) return content.promise;
    return null;
  });
  const source = main.querySelector('[data-community="home"]');
  navigating = true; render('#/post/p1'); await turn();
  identity.resolve(response(next)); await turn();
  assert.equal(source.isConnected, false);
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
  assert.equal(main.querySelector('.community-topic'), null);
  assert.equal(main.querySelector('form[data-community-form="reply"]'), null);
  assert.equal(ui.me()?.uid, next.uid); assert.equal(ui.me()?.vip, next.vip);
  content.resolve(response(thread)); await turn();
  assert.ok(main.querySelector('.community-thread'));
});

for (const count of [1, 2]) for (const outcome of ['ready', 'abort', 'denied']) test(`real hashchange keeps the held ${count}-image feed enhancement and releases it once after ${outcome}`, async t => {
  const imageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let navigating = false;
  const identity = deferred(), content = deferred();
  const { w, main, render } = await setup(t, '#/community/home', url => {
    if (navigating && url.endsWith('/me')) return identity.promise;
    if (navigating && url.endsWith('/topics/p1')) return content.promise;
    if (url.includes('/topics?') && !new URL(url, 'http://localhost').searchParams.get('board'))
      return response({ ...listing, items: [{ ...topic('p1'), board: count === 2 ? 'showcase' : 'qa', thumbs: Array(count).fill(imageId) }] });
    return null;
  }, count === 1);
  const newest = main.querySelector('[data-action="community-sort"][data-sort="newest"]'); assert.ok(newest);
  newest.click(); await turn();
  const source = main.querySelector('[data-community="home"]'), image = source.querySelector('.community-topic-thumbs img');
  assert.ok(image); assert.equal(image.getAttribute('src'), `/api/community/images/${imageId}.webp`);
  let releases = 0; const setAttribute = image.setAttribute.bind(image);
  image.setAttribute = (name, value) => { if (name === 'src' && value.endsWith('.thumb.webp')) releases++; setAttribute(name, value); };
  // The real layout registers its listener before app.mjs registers rendering.
  // Dispatch in that order; marking the route before hashchange hides the bug.
  const renderRoute = () => render(w.location.hash);
  w.addEventListener('hashchange', renderRoute); t.after(() => w.removeEventListener('hashchange', renderRoute));
  const changeRoute = hash => { w.history.replaceState(null, '', hash); w.dispatchEvent(new w.HashChangeEvent('hashchange')); };
  navigating = true; changeRoute('#/post/p1'); await turn();
  assert.equal(source.dataset.homeDesign, 'feed');
  assert.equal(image.isConnected, true); assert.equal(releases, 0);
  assert.equal(image.getAttribute('src'), `/api/community/images/${imageId}.webp`);
  if (outcome === 'abort') { changeRoute('#/community/boards/tools'); await turn(); }
  identity.resolve(outcome === 'denied' ? { ok: false, status: 401, json: async () => ({ error: 'signed out' }) } : response(person));
  content.resolve(response(thread)); await turn();
  assert.equal(source.isConnected, false); assert.equal(releases, count === 1 ? 0 : 1, 'single previews stay complete; converted multi-image sources restore exactly once after the held page retires');
  assert.equal(source.hasAttribute('data-home-design'), false);
  if (outcome === 'ready') assert.equal(main.querySelector('[data-community="post"]').dataset.threadDesign, 'feed');
  if (outcome === 'abort') assert.equal(main.querySelector('[data-community="board"]').dataset.homeDesign, 'feed');
  if (outcome === 'denied') assert.ok(main.querySelector('[data-content-state="auth"]'));
});

for (const width of [1100, 800, 390]) test(`at ${width}px the relocated check-in still calls the real controller once`, async t => {
  const { main, ui, calls, resizeWidth } = await setup(t, '#/community/boards/qa');
  const button = main.querySelector('[data-action="community-checkin"]');
  resizeWidth(width); await turn();
  assert.equal(main.querySelectorAll('[data-action="community-checkin"]').length, 1);
  assert.equal(main.querySelector('[data-frame-checkin] [data-action="community-checkin"]'), button);
  button.click(); await turn();
  assert.equal(ui.me().checkedIn, true);
  assert.equal(calls.filter(call => call.url.endsWith('/checkin') && call.options.method === 'POST').length, 1);
  assert.equal(main.querySelector('[data-action="community-checkin"]'), null);
  assert.ok(main.querySelector('[data-frame-checkin] .community-ck-pill.is-done'));
  resizeWidth(1600); await turn();
  assert.ok(main.querySelector('[data-frame-right] .community-ck-pill.is-done'));
  assert.equal(main.querySelector('[data-frame-checkin]').hidden, true);
});

test('the check-in page uses only the right-rail action and refreshes its monthly star after a check-in', async t => {
  let checked = false;
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const { main, calls } = await setup(t, '#/community/checkin', (url, options) => {
    if (!url.endsWith('/checkin')) return null;
    if (options.method === 'POST') { checked = true; return null; }
    return response({ checkedIn: checked, streak: checked ? 2 : 1, balance: checked ? 31 : 30, vip: false,
      month: today.slice(0, 7), days: checked ? [today] : [], monthBonus: 0, checkinsToday: 1, earlyBirds: [], badges: [],
      makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: [] } });
  });
  assert.equal(main.querySelectorAll('[data-action="community-checkin"]').length, 1);
  const action = main.querySelector('[data-frame-right] [data-action="community-checkin"]');
  assert.ok(action);
  assert.equal(main.querySelector('[data-frame-center] [data-action="community-checkin"]'), null);
  action.click();
  await turn();
  assert.equal(calls.filter(call => call.options.method === 'POST' && call.url.endsWith('/checkin')).length, 1);
  assert.ok(main.querySelector('.community-star-map .community-cs.is-now.is-on'));
  assert.ok(main.querySelector('[data-frame-right] .community-ck-pill.is-done'));
  assert.equal(main.querySelectorAll('[data-action="community-checkin"]').length, 0);
});

test('check-in calendar month controls still update the grouped dates and keep the stable frame', async t => {
  const current = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
  const { w, main, calls, frame } = await setup(t, '#/community/checkin', (url, options) => {
    const requestUrl = new URL(url, 'http://localhost:4212');
    if (!requestUrl.pathname.endsWith('/checkin') || options.method === 'POST') return null;
    const month = requestUrl.searchParams.get('month') || current;
    return response({ checkedIn: false, streak: 1, balance: 30, vip: false, month, days: [`${month}-01`], monthBonus: 0,
      checkinsToday: 1, earlyBirds: [], badges: [],
      makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: [] } });
  });
  const center = frame.center(), right = main.querySelector('[data-frame-right]');
  const previous = main.querySelector('[data-action="community-month"][aria-label="上个月"]');
  const previousMonth = previous.dataset.month;
  center.dispatchEvent(new w.Event('wheel'));
  center.scrollTop = 260;
  previous.querySelector('svg path').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await turn();
  assert.equal(center.scrollTop, 260);
  assert.ok(calls.some(call => call.url.endsWith(`/checkin?month=${previousMonth}`)));
  const [year, month] = previousMonth.split('-');
  assert.ok(main.querySelector('.community-ck-calendar .community-card-h').textContent.includes(`${year} 年 ${Number(month)} 月`));
  assert.equal(main.querySelectorAll('.community-ck-calendar-body .community-cal-day.is-ok').length, 1);
  const next = main.querySelector('[data-action="community-month"][aria-label="下个月"]');
  assert.equal(next.disabled, false);
  assert.equal(next.dataset.month, current);
  center.dispatchEvent(new w.Event('wheel'));
  center.scrollTop = 260;
  next.querySelector('svg path').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await turn();
  assert.equal(center.scrollTop, 260);
  assert.equal(main.querySelector('[data-action="community-month"][aria-label="下个月"]').disabled, true);
  assert.equal(frame.center(), center);
  assert.equal(main.querySelector('[data-frame-right]'), right);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 0, 'month navigation never checks in or spends stardust');
});

for (const width of [1600, 390]) test(`at ${width}px calendar changes keep the latest reading position through an asynchronous repaint`, async t => {
  const current = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
  const calendar = month => response({ checkedIn: false, streak: 1, balance: 30, vip: false, month, days: [], monthBonus: 0,
    checkinsToday: 1, earlyBirds: [], badges: [], makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: [] } });
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { w, main, frame, resizeWidth } = await setup(t, '#/community/checkin', url => {
    if (!url.includes('/checkin')) return null;
    const month = new URL(url, 'http://localhost').searchParams.get('month') || current;
    return month === current ? calendar(month) : pending;
  });
  resizeWidth(width); await turn();
  const scroll = width === 390 ? w.document.documentElement : frame.center();
  scroll.dispatchEvent(new w.Event('wheel', { bubbles: true })); scroll.scrollTop = 320;
  const previous = main.querySelector('[data-action="community-month"][aria-label="上个月"]');
  previous.click();
  assert.equal(scroll.scrollTop, 320, 'starting a month request does not move the page');
  // A reader can keep scrolling while waiting. Restore that latest position.
  scroll.dispatchEvent(new w.Event('wheel', { bubbles: true })); scroll.scrollTop = 360;
  const section = main.querySelector('[data-community="checkin"]');
  const replace = section.replaceWith.bind(section);
  section.replaceWith = (...nodes) => { replace(...nodes); scroll.scrollTop = 0; };
  resolve(calendar(previous.dataset.month)); await turn();
  assert.equal(scroll.scrollTop, 360, 'content replacement restores the active desktop/mobile scroll host');
});

test('check-in calendar make-up keeps its two-click confirmation and lights the recorded date', async t => {
  const missed = new Date(Date.now() + 8 * 3600e3 - 24 * 3600e3).toISOString().slice(0, 10);
  let madeUp = false;
  const { main, calls, frame } = await setup(t, '#/community/checkin', (url, options) => {
    if (url.endsWith('/checkin/makeup') && options.method === 'POST') {
      madeUp = true;
      return response({ streak: 2, bonus: 0 });
    }
    if (!url.endsWith('/checkin') || options.method === 'POST') return null;
    return response({ checkedIn: false, streak: madeUp ? 2 : 1, balance: 30, vip: false, month: missed.slice(0, 7),
      days: madeUp ? [missed] : [], monthBonus: 0, checkinsToday: 1, earlyBirds: [], badges: [],
      makeup: { used: madeUp ? 1 : 0, allowed: 2, left: madeUp ? 1 : 2, free: false, cards: 1, cost: 30, days: madeUp ? [] : [missed] } });
  });
  const center = frame.center();
  const button = main.querySelector('.community-ck-calendar-body [data-action="community-makeup"]');
  assert.equal(button.dataset.day, missed);
  button.click(); await turn();
  assert.equal(button.dataset.confirm, 'true');
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 0);
  button.click(); await turn();
  const posts = calls.filter(call => call.options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.ok(posts[0].url.endsWith('/checkin/makeup'));
  assert.deepEqual(JSON.parse(posts[0].options.body), { day: missed });
  assert.equal(main.querySelector('.community-ck-calendar-body [data-action="community-makeup"]'), null);
  assert.equal(main.querySelectorAll('.community-star-map .is-on').length, 1);
  assert.equal(main.querySelector('.community-cal-day.is-ok').textContent, String(Number(missed.slice(-2))));
  assert.equal(frame.center(), center);
});

for (const board of communityBoards) test(`${board.zh}: the simple composer requires a cover and submits to the route board without metadata`, async t => {
  const { w, main, frame, calls } = await setup(t, `#/community/new/${board.id}`, (url, options) =>
    url.endsWith('/topics') && options.method === 'POST' ? { ok: false, status: 503, json: async () => ({ error: '测试发布失败，保留内容' }) } : null);
  const form = main.querySelector('form[data-community-form="topic"]');
  const center = frame.center(), right = main.querySelector('[data-frame-right]'), rail = main.querySelector('.community-feed-rail');
  assert.equal(main.querySelector('[data-frame-boards] [aria-current="page"]').getAttribute('href'), `#/community/boards/${board.id}`);
  assert.equal(form.querySelector('input[name="board"]').type, 'hidden');
  form.elements.board.value = 'tools'; // A stale form value must not change the destination.
  form.elements.title.value = '必填标题';
  form.elements.body.value = '文字';
  form.elements.body.dispatchEvent(new w.Event('input', { bubbles: true }));
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(calls.filter(call => call.url.endsWith('/topics') && call.options.method === 'POST').length, 0);
  assert.match(form.querySelector('.community-form-status').textContent, /封面/);
  const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const body = `文字\n\n![图片](/api/community/images/${image}.webp)`;
  form.elements.body.value = body;
  center.dispatchEvent(new w.Event('wheel')); center.scrollTop = 175;
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await turn();
  const posts = calls.filter(call => call.url.endsWith('/topics') && call.options.method === 'POST');
  assert.equal(posts.length, 1);
  const payload = JSON.parse(posts[0].options.body);
  assert.equal(payload.board, board.id); assert.equal(payload.body, body);
  assert.equal(payload.title, '必填标题'); assert.deepEqual(payload.images, [image]);
  assert.equal('price' in payload || 'promptPrice' in payload || 'bounty' in payload, false);
  assert.equal(form.elements.body.value, body);
  assert.equal(form.querySelector('.community-form-status').textContent, '测试发布失败，保留内容');
  assert.equal(main.querySelector('[data-frame-right]'), right); assert.equal(main.querySelector('.community-feed-rail'), rail);
  assert.equal(center.scrollTop, 175);
});

test('the simple work composer submits author-defined integer unlock amounts and validates them before posting', async t => {
  const { w, main, calls } = await setup(t, '#/community/new/showcase', (url, options) =>
    url.endsWith('/topics') && options.method === 'POST' ? { ok: false, status: 503, json: async () => ({ error: '保留当前内容' }) } : null);
  const form = main.querySelector('form[data-community-form="topic"]');
  form.querySelector('[data-compose-extras]').open = true;
  form.elements.title.value = '带提示词的作品';
  form.elements.body.value = '作品说明\n\n![图片](/api/community/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp)';
  form.elements.prompt.value = 'silver stars';
  const row = form.querySelector('[data-price-row]'), price = form.elements.promptPrice;
  const choose = mode => {
    const radio = form.querySelector(`[name="promptMode"][value="${mode}"]`);
    radio.checked = true; radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  assert.equal(price.disabled, true);
  choose('paid');
  assert.equal(row.hidden, false); assert.equal(price.disabled, false); assert.equal(price.required, true);
  const posts = () => calls.filter(call => call.url.endsWith('/topics') && call.options.method === 'POST');
  for (const amount of ['', '4', '51', '17.5']) {
    form.querySelector('[data-compose-extras]').open = false;
    price.value = amount;
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(posts().length, 0);
    assert.equal(price.getAttribute('aria-invalid'), 'true');
    assert.equal(form.querySelector('[data-compose-extras]').open, true);
    assert.match(form.querySelector('.community-form-status').textContent, /5.*50.*整数/);
  }
  for (const amount of [5, 17, 50]) {
    price.value = String(amount);
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
    const payload = JSON.parse(posts().at(-1).options.body);
    assert.equal(payload.promptMode, 'paid'); assert.equal(payload.promptPrice, amount);
    assert.equal(payload.prompt, 'silver stars');
    assert.equal(form.querySelector('[data-compose-extras]').open, true);
  }
  assert.equal(posts().length, 3);
  choose('hidden');
  assert.equal(row.hidden, true); assert.equal(price.disabled, true); assert.equal(price.required, false);
  price.value = '51';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  const privatePayload = JSON.parse(posts().at(-1).options.body);
  assert.equal(privatePayload.promptMode, 'hidden'); assert.equal('promptPrice' in privatePayload, false);
  assert.equal('price' in privatePayload || 'bounty' in privatePayload, false);
});

test('simple compose rejects empty body and videos, while image upload preserves the editor, extras and scroll', async t => {
  let finishUpload;
  const { w, main, frame, calls } = await setup(t, '#/community/new/tools', (url, options) => {
    if (url.endsWith('/images') && options.method === 'POST') return new Promise(resolve => { finishUpload = resolve; });
    return null;
  });
  const center = frame.center();
  let form = main.querySelector('form[data-community-form="topic"]');
  form.elements.title.value = '只有标题';
  form.elements.body.value = ' \n ';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 0);
  assert.equal(form.elements.body.getAttribute('aria-invalid'), 'true');
  const choose = (file) => {
    const picker = main.querySelector('[data-community-upload]');
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    picker.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  choose(Object.assign(new Blob(['video'], { type: 'video/mp4' }), { name: 'test.mp4' }));
  assert.equal(calls.filter(call => call.url.endsWith('/images')).length, 0);
  assert.match(form.querySelector('.community-editor-upload-status').textContent, /不支持视频/);
  const rich = form.querySelector('.community-rich-body');
  assert.ok(rich);
  rich.focus({ preventScroll: true });
  const paste = new w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { files: [], items: [], getData: kind => kind === 'text/plain' ? '实际截图及说明' : '' } });
  rich.dispatchEvent(paste);
  form.elements.url.value = 'https://example.com/';
  form.elements.platform.value = 'Windows';
  form.querySelector('[data-compose-extras]').open = true;
  center.dispatchEvent(new w.Event('wheel')); center.scrollTop = 260;
  choose(Object.assign(new Blob(['mock-png'], { type: 'image/png' }), { name: 'demo.png' }));
  await turn();
  assert.ok(finishUpload);
  finishUpload(response({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
  await turn();
  form = main.querySelector('form[data-community-form="topic"]');
  assert.match(form.elements.body.value, /实际截图及说明/);
  assert.match(form.elements.body.value, /!\[图片\]\(\/api\/community\/images\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\.webp\)/);
  assert.equal(form.elements.url.value, 'https://example.com/');
  assert.equal(form.elements.platform.value, 'Windows');
  assert.equal(form.querySelector('[data-compose-extras]').open, true);
  assert.equal(form.querySelector('.community-rich-body'), rich);
  assert.equal(main.ownerDocument.activeElement, rich);
  assert.equal(center.scrollTop, 260);
  assert.ok(form.querySelector('.community-inline-upload img'));
  assert.equal(form.querySelector('.community-uploads'), null);
});

test('real controller and design runtime retain both rails through home, board, post, bookmarks and back', async t => {
  const { w, main, frame, render, resize } = await setup(t);
  const root = main.firstElementChild;
  const rail = main.querySelector('.community-feed-rail');
  const right = main.querySelector('[data-frame-right]');
  const nav = w.document.getElementById('navigation');
  const hot = right.querySelector('.community-hot');
  const hotSlot = right.querySelector('[data-frame-hot]');
  assert.ok(rail && right && hot);
  assert.equal(rail.querySelector('.community-feed-rail-compose'), null);
  assert.equal(nav.querySelector('a[href="#/community/boards"]'), null);
  frame.center().dispatchEvent(new w.Event('wheel'));
  frame.center().scrollTop = 220; right.scrollTop = 50;
  for (const [hash, view] of [['#/community/boards/qa', 'board'], ['#/post/p1', 'post'], ['#/community/bookmarks', 'bookmarks'], ['#/community/home', 'home']]) {
    render(hash); await turn();
    assert.equal(main.firstElementChild, root);
    assert.equal(main.querySelector('.community-feed-rail'), rail);
    assert.equal(main.querySelector('[data-frame-right]'), right);
    assert.equal(w.document.getElementById('navigation'), nav);
    const publish = rail.querySelector('.community-feed-rail-compose');
    if (view === 'board') assert.equal(publish?.getAttribute('href'), '#/community/new/qa');
    else assert.equal(publish, null);
    assert.equal(right.querySelector('[data-frame-hot]'), hotSlot);
    assert.equal(right.scrollTop, 50);
    assert.equal(frame.center().querySelector('[data-community]').dataset.community, view);
    assert.equal(frame.center().scrollTop, 0);
    assert.equal(main.querySelectorAll('[data-community-frame]').length, 1);
  }
  assert.equal(frame.center().scrollTop, 0);
  resize(true);
  assert.equal(w.document.querySelector('#site-header > #navigation'), nav);
  resize(false);
  assert.equal(main.querySelector('.community-feed-rail #navigation'), nav);
});

test('left board navigation stays stable while highlights belong exclusively to the current board', async t => {
  const { main, frame, render, calls, w } = await setup(t);
  const carousel = main.querySelector('[data-frame-showcase] .community-feed-showcase');
  const boardNav = main.querySelector('.community-feed-rail [data-frame-boards]');
  assert.ok(carousel && boardNav);
  assert.equal(boardNav.querySelectorAll(':scope > a').length, communityBoards.length);
  const allBoardsLink = boardNav.querySelector('h2 > a');
  assert.equal(allBoardsLink?.getAttribute('href'), '#/community/boards');
  assert.equal(frame.center().querySelector('.community-feed-categories'), null);
  assert.equal(frame.center().querySelector('a.community-post'), null);
  const track = carousel.querySelector('.community-feed-showcase-track');
  Object.defineProperty(track, 'clientWidth', { value: 600 });
  track.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(track.scrollLeft, 600);
  assert.equal(carousel.querySelector('button'), null);
  const firstLink = boardNav.querySelector(':scope > a');
  for (const board of ['showcase', 'qa', 'tools']) {
    render(`#/community/boards/${board}`); await turn();
    const current = main.querySelector('[data-frame-showcase] .community-feed-showcase');
    assert.notEqual(current, carousel);
    assert.deepEqual([...current.querySelectorAll('.community-feed-showcase-card')].map(card => card.getAttribute('href')), [`#/post/${board}-p1`, `#/post/${board}-p2`]);
    assert.equal(main.querySelector('.community-feed-rail [data-frame-boards]'), boardNav);
    assert.equal(boardNav.querySelector(':scope > a'), firstLink);
    assert.equal(boardNav.querySelector('h2 > a'), allBoardsLink);
    assert.equal(boardNav.querySelector('[aria-current="page"]').getAttribute('href'), `#/community/boards/${board}`);
    assert.equal(main.querySelector('.community-feed-rail-compose').getAttribute('href'), `#/community/new/${board}`);
    assert.equal(frame.center().querySelectorAll('.community-feed-showcase').length, 1);
    const currentTrack = current.querySelector('.community-feed-showcase-track');
    Object.defineProperty(currentTrack, 'clientWidth', { value: 600 });
    currentTrack.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    render(`#/community/boards/${board}`); await turn();
    assert.equal(main.querySelector('[data-frame-showcase] .community-feed-showcase'), current);
    assert.equal(currentTrack.scrollLeft, 600);
    assert.equal(current.querySelector('button'), null);
  }
  render('#/community/home'); await turn();
  assert.deepEqual([...main.querySelectorAll('[data-frame-showcase] .community-feed-showcase-card')].map(card => card.getAttribute('href')), ['#/post/p1', '#/post/p2']);
  assert.equal(calls.filter(call => call.url === '/api/community/banners?scope=home').length, 2, 'returning home refreshes only its independent configuration');
});

test('rapid board switching never displays the homepage or a late response from another board', async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { main, frame, render, calls } = await setup(t, '#/community/boards/qa', url => url === '/api/community/banners?scope=qa' ? pending : null);
  const showcaseSlot = main.querySelector('[data-frame-showcase]');
  render('#/community/boards/showcase');
  render('#/community/boards/tools');
  resolve(response(bannerConfig('qa'))); await turn();
  assert.equal(main.querySelector('[data-frame-showcase]'), showcaseSlot);
  assert.ok(showcaseSlot.querySelector('.community-feed-showcase'));
  assert.deepEqual([...showcaseSlot.querySelectorAll('.community-feed-showcase-card')].map(card => card.getAttribute('href')), ['#/post/tools-p1', '#/post/tools-p2']);
  assert.equal(frame.center().querySelector('[data-community="board"]').dataset.board, 'tools');
  assert.equal(calls.filter(call => call.url === '/api/community/banners?scope=home').length, 0);
  assert.equal(calls.filter(call => call.url === '/api/community/banners?scope=qa').length, 1);
});

test('empty and failed boards do not borrow homepage announcements; the banner slot stays mounted', async t => {
  const { main, render } = await setup(t, '#/community/home', url => {
    if (url === '/api/community/banners?scope=tools') return response({ ...bannerConfig('tools'), items: [] });
    if (url === '/api/community/banners?scope=meta') return { ok: false, status: 503, json: async () => ({ error: '暂时无法读取' }) };
    if (url.includes('board=tools')) return response({ ...listing, items: [], total: 0 });
    if (url.includes('board=meta')) return { ok: false, status: 503, json: async () => ({ error: '暂时无法读取' }) };
    return null;
  });
  const slot = main.querySelector('[data-frame-showcase]');
  for (const board of ['tools', 'meta']) {
    render(`#/community/boards/${board}`); await turn();
    assert.equal(main.querySelector('[data-frame-showcase]'), slot);
    assert.equal(slot.querySelector('.community-feed-showcase-card'), null);
    assert.doesNotMatch(slot.textContent, /讨论 p1|正在读取/);
    if (board === 'tools') { assert.equal(slot.hidden, true); assert.equal(slot.children.length, 0); }
    else assert.match(slot.textContent, /暂时无法读取/);
  }
});

test('board highlights stay scoped and independent of sort and search controls', async t => {
  const { main, render, calls } = await setup(t, '#/community/boards/qa', url => {
    const params = new URL(url, 'http://localhost').searchParams;
    return url.includes('/topics?') && (params.has('q') || params.get('sort') === 'newest') ? response({ ...listing, items: [], total: 0 }) : null;
  });
  const qa = main.querySelector('[data-frame-showcase] .community-feed-showcase');
  main.querySelector('[data-sort="newest"]').click(); await turn();
  assert.equal(main.querySelector('[data-frame-showcase] .community-feed-showcase'), qa);
  render('#/community/boards/showcase'); await turn();
  const showcase = main.querySelector('[data-frame-showcase] .community-feed-showcase');
  assert.deepEqual([...showcase.querySelectorAll('.community-feed-showcase-card')].map(card => card.getAttribute('href')), ['#/post/showcase-p1', '#/post/showcase-p2']);
  const search = main.querySelector('#community-search');
  search.value = '不存在的帖子';
  search.form.dispatchEvent(new main.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true })); await turn();
  render('#/community/boards/showcase'); await turn();
  assert.equal(main.querySelector('[data-frame-showcase] .community-feed-showcase'), showcase);
  assert.equal(calls.filter(call => call.url === '/api/community/banners?scope=showcase').length, 1);
  assert.equal(calls.filter(call => call.url === '/api/community/banners?scope=home').length, 0);
});

test('route switches never fade the content, including loading completion and narrow layouts', async t => {
  const { main, render, resize } = await setup(t);
  const route = main.querySelector('[data-frame-route]');
  const animations = [];
  route.animate = (frames, timing) => { animations.push({ frames, timing }); return { cancel() {} }; };
  render('#/community/boards/showcase');
  assert.equal(animations.length, 0, 'do not fade a loading placeholder');
  await turn();
  assert.equal(animations.length, 0, 'ready data must not start a dim-to-bright animation');
  resize(true); // The test's media stub also enables reduced motion.
  render('#/community/boards/tools'); await turn();
  assert.equal(animations.length, 0);
  assert.ok(main.querySelector('[data-frame-center] > [data-frame-boards]'));
  assert.ok(main.querySelector('[data-community="board"] a.community-post'));
});

test('an identity reset drops a board-highlight response from the previous session', async t => {
  let resolve;
  let first = true;
  const pending = new Promise(done => { resolve = done; });
  const { main, ui, render } = await setup(t, '#/community/boards/qa', url => {
    if (first && url === '/api/community/banners?scope=qa') { first = false; return pending; }
    return null;
  });
  ui.clear();
  render('#/post/p1');
  resolve(response({ ...bannerConfig('qa'), items: [{ ...bannerConfig('qa').items[0], title: 'previous-session-highlight' }] }));
  await turn();
  assert.doesNotMatch(main.querySelector('[data-frame-showcase]').textContent, /previous-session-highlight/);
  render('#/community/boards/qa');
  assert.doesNotMatch(main.querySelector('[data-frame-showcase]').textContent, /previous-session-highlight/, 'cleared recommendation caches must not be repopulated by the old request');
  await turn();
  assert.match(main.querySelector('[data-frame-showcase]').textContent, /qa 置顶公告/);
});

test('only the current board can contribute cards even if a mixed recommendation configuration is returned', async t => {
  const mixed = { ...bannerConfig('qa'), items: [...bannerConfig('qa').items, ...bannerConfig('meta').items] };
  const { main } = await setup(t, '#/community/boards/qa', url => url === '/api/community/banners?scope=qa' ? response(mixed) : null);
  assert.deepEqual([...main.querySelectorAll('[data-frame-showcase] .community-feed-showcase-card')].map(card => card.getAttribute('href')), ['#/post/qa-p1', '#/post/qa-p2']);
});

test('direct post entry shows the author in the right rail and keeps central likes functional', async t => {
  const { main, frame, calls } = await setup(t, '#/post/p1');
  const right = main.querySelector('[data-frame-right]');
  assert.ok(right.querySelector('.community-author-card'));
  assert.equal(right.querySelector('[data-frame-overview]').hidden, true);
  assert.equal(right.querySelector('[data-frame-hot]').hidden, true);
  assert.equal(frame.center().querySelector('.community-post-side'), null);
  assert.ok(calls.some(call => call.url.endsWith('/summary')));
  const center = frame.center(); center.dispatchEvent(new main.ownerDocument.defaultView.Event('wheel')); center.scrollTop = 280;
  const body = center.querySelector('.community-text');
  const like = center.querySelector('.community-actbar [data-action="community-like"]');
  like.click(); await turn();
  assert.equal(like.getAttribute('aria-pressed'), 'true');
  assert.equal(center.querySelector('.community-text'), body);
  assert.equal(center.scrollTop, 280);
  assert.equal(main.querySelector('[data-frame-right]'), right);
});

test('right-rail follow, paid-prompt unlock and related links retain the real controller behaviour', async t => {
  const supplied = structuredClone(thread);
  supplied.author = { ...supplied.author, uid: 'u2', name: '作品作者', following: false };
  supplied.topic.board = 'showcase';
  supplied.topic.meta = { tools: 'Midjourney', model: 'v7', usage: '个人创作', promptMode: 'paid', price: 20, prompt: null, preview: 'x xxx', unlocked: false, unlocks: 0 };
  supplied.related = [{ ...topic('other-work'), board: 'showcase' }];
  const { main, frame, calls } = await setup(t, '#/post/p1', (url, options) => {
    if (url.endsWith('/members/u2/follow') && options.method === 'POST') {
      supplied.author.following = true;
      return response({});
    }
    if (url.endsWith('/topics/p1/unlock') && options.method === 'POST') {
      Object.assign(supplied.topic.meta, { prompt: '已解锁的实际提示词', unlocked: true, unlocks: 1 });
      return response({});
    }
    if (url.endsWith('/topics/p1')) return response(supplied);
    return null;
  });
  const right = main.querySelector('[data-frame-right]');
  assert.match(right.textContent, /作品信息/);
  assert.equal(right.querySelector('.community-related a').getAttribute('href'), '#/post/other-work');
  const center = frame.center();
  center.dispatchEvent(new main.ownerDocument.defaultView.Event('wheel')); center.scrollTop = 230;
  const follow = right.querySelector('[data-action="community-follow"]');
  follow.focus(); follow.click(); await turn();
  assert.equal(calls.filter(call => call.url.endsWith('/members/u2/follow') && call.options.method === 'POST').length, 1);
  assert.equal(right.querySelector('[data-action="community-follow"]').getAttribute('aria-pressed'), 'true');
  assert.equal(main.ownerDocument.activeElement, right.querySelector('[data-action="community-follow"]'), 'refreshing a relocated control retains keyboard focus');
  const unlock = right.querySelector('[data-action="community-unlock"]');
  unlock.click();
  assert.equal(unlock.dataset.confirm, 'true');
  unlock.click(); await turn();
  assert.equal(calls.filter(call => call.url.endsWith('/topics/p1/unlock') && call.options.method === 'POST').length, 1);
  assert.equal(main.querySelectorAll('.community-post-side').length, 1);
  assert.equal(center.querySelector('.community-post-side'), null);
  assert.equal(right.querySelector('[data-prompt]').textContent, '已解锁的实际提示词');
  assert.equal(center.scrollTop, 230);
});

test('a center repaint restores reading position after a temporary short DOM clamps the scroll', async t => {
  const { frame, main } = await setup(t, '#/post/p1');
  const center = frame.center();
  // A real user scroll cancels an initial route restoration still queued for RAF.
  center.dispatchEvent(new main.ownerDocument.defaultView.Event('wheel'));
  center.scrollTop = 310;
  const restored = frame.preserveReadingPosition();
  center.scrollTop = 0; // Model a browser clamping scroll while content is replaced.
  restored(); await turn();
  assert.equal(center.scrollTop, 310);
  assert.ok(main.querySelector('[data-frame-right]'));
});

test('reply sorting keeps its reading position without rebuilding the thread or losing the reply draft', async t => {
  const data = { ...thread, replies: [1, 2].map(i => ({ id: `r${i}`, body: `回复 ${i}`, author: person,
    createdAt: `2026-10-01T10:0${i}:00Z`, likes: i, canDelete: false, byTopicAuthor: false })) };
  const { w, main, frame } = await setup(t, '#/post/p1', url => url.endsWith('/topics/p1') ? response(data) : null);
  const center = frame.center(), section = main.querySelector('[data-community]');
  const field = main.querySelector('#community-reply');
  field.value = '继续保留正在写的回复'; field.dispatchEvent(new w.Event('input', { bubbles: true }));
  const rows = [...main.querySelector('.community-replies').children];
  center.dispatchEvent(new w.Event('wheel')); center.scrollTop = 360;
  main.querySelector('[data-action="community-reply-sort"][data-sort="likes"]').click(); await turn();
  assert.equal(center.scrollTop, 360);
  assert.equal(main.querySelector('[data-community]'), section);
  assert.equal(main.querySelector('#community-reply'), field);
  assert.equal(field.value, '继续保留正在写的回复');
  assert.deepEqual([...main.querySelector('.community-replies').children], rows.toReversed());
});

test('cancelled draft navigation keeps its route, draft and current reading position', async t => {
  const { w, main, frame } = await setup(t, '#/community/new/qa');
  const center = frame.center(), field = main.querySelector('#community-title');
  field.value = '尚未发布的草稿'; field.dispatchEvent(new w.Event('input', { bubbles: true }));
  center.dispatchEvent(new w.Event('wheel')); center.scrollTop = 180;
  const section = center.querySelector('[data-community]');
  let confirmations = 0;
  w.confirm = () => { confirmations++; return false; };
  main.querySelector('.community-frame-boards a[href="#/community/boards/showcase"]').click(); await turn();
  assert.equal(confirmations, 1);
  assert.equal(w.location.hash, '#/community/new/qa');
  assert.equal(center.scrollTop, 180);
  assert.equal(center.querySelector('[data-community]'), section);
  assert.equal(main.querySelector('#community-title'), field);
  assert.equal(field.value, '尚未发布的草稿');
});

for (const board of communityBoards) test(`${board.zh}: sorting, searching and pagination keep the reading frame stable`, async t => {
  let deferred;
  const data = boardListing(board.id);
  const firstPage = { ...data, pageSize: 6, total: 12, items: [...data.items, ...data.items.map(item => ({ ...item, id: `${item.id}-extra`, title: `${item.title} 附加讨论` }))] };
  const { w, main, frame } = await setup(t, `#/community/boards/${board.id}`, url => {
    if (!url.includes('/topics?')) return null;
    const params = new URL(url, 'http://localhost').searchParams;
    if (params.get('board') !== board.id) return null;
    if (deferred) return deferred.promise;
    const page = Number(params.get('page'));
    return response({ ...firstPage, page, items: page === 2 ? firstPage.items.map(item => ({ ...item, id: `${item.id}-next` })) : firstPage.items });
  });
  const center = frame.center(), right = main.querySelector('[data-frame-right]');
  const rail = main.querySelector('.community-feed-rail');
  const banner = main.querySelector('[data-frame-showcase]');
  const header = main.querySelector('.community-board-hero');
  const results = main.querySelector('.community-results');
  const search = main.querySelector('#community-search');
  // Model the browser's temporary clamp during a list replacement. JSDOM has no layout engine.
  const replace = results.replaceChildren.bind(results);
  results.replaceChildren = (...nodes) => { replace(...nodes); center.scrollTop = 0; };
  const steady = (top = 240) => {
    assert.equal(frame.center(), center); assert.equal(center.scrollTop, top);
    assert.equal(main.querySelector('[data-frame-right]'), right); assert.equal(right.scrollTop, 55);
    assert.equal(main.querySelector('.community-feed-rail'), rail); assert.equal(rail.scrollTop, 35);
    assert.equal(main.querySelector('[data-frame-showcase]'), banner);
    assert.equal(main.querySelector('.community-board-hero'), header);
    assert.equal(main.querySelector('#community-search'), search);
  };
  center.dispatchEvent(new w.Event('wheel')); center.scrollTop = 240; right.scrollTop = 55; rail.scrollTop = 35;
  for (const sort of ['newest', 'active', 'following']) {
    center.dispatchEvent(new w.Event('wheel'));
    center.scrollTop = 240;
    let resolve;
    deferred = { promise: new Promise(done => { resolve = done; }) };
    const oldRows = results.querySelector('.community-topics, .community-curated-list'); assert.ok(oldRows);
    const button = main.querySelector(`[data-sort="${sort}"]`);
    assert.ok(button, 'exercise a real current sorting control');
    button.click(); steady();
    assert.equal(results.querySelector('.community-topics, .community-curated-list'), oldRows, 'pending requests must keep the old rows');
    resolve(response(firstPage)); deferred = null;
    await turn(); steady();
    assert.equal(w.document.activeElement, button);
  }
  const curated = main.querySelector('[data-sort="curated"]'); assert.ok(curated);
  curated.click(); steady();
  assert.deepEqual([...results.querySelectorAll('.community-topic-replies')].map(row => row.getAttribute('href')), firstPage.items.map(item => `#/post/${item.id}`), 'returning to the cached curated board page immediately displays ordinary posts');
  assert.equal(results.querySelector('.community-curated'), null, 'compact rankings belong to the home page');
  assert.equal(results.querySelector('[data-content-state="loading"]'), null);
  await turn(); steady();
  assert.equal(w.document.activeElement, curated);
  center.scrollTop = 240;
  search.value = '测试'; search.focus(); search.setSelectionRange?.(1, 1);
  search.form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn(); steady();
  assert.equal(w.document.activeElement, search);
  center.scrollTop = 240;
  main.querySelector('[data-action="community-search-clear"]').click(); await turn(); steady();
  const posts = results.querySelector('.community-topics'); assert.ok(posts);
  const rows = [...posts.children];
  center.dispatchEvent(new w.Event('wheel'));
  center.scrollTop = 240;
  main.querySelector('[data-action="community-more"]').click(); await turn(); steady(240);
  assert.equal(results.querySelector('.community-topics'), posts, 'expanded ordinary posts retain their original container');
  assert.deepEqual([...posts.children].slice(0, 6), rows);
  assert.equal(posts.children.length, 12);
});

test('late calendar responses cannot replace the selected month or disturb a newly opened board', async t => {
  const current = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
  const [year, month] = current.split('-').map(Number);
  const previousMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const calendar = month => response({ checkedIn: false, streak: 1, balance: 30, vip: false, month, days: [], monthBonus: 0,
    checkinsToday: 1, earlyBirds: [], badges: [], makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: [] } });
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { w, main, frame, render } = await setup(t, '#/community/checkin', url => {
    if (!url.includes('/checkin')) return null;
    return url.endsWith(`month=${previousMonth}`) ? pending : calendar(current);
  });
  const center = frame.center(), section = center.querySelector('[data-community]');
  center.dispatchEvent(new w.Event('wheel')); center.scrollTop = 200;
  main.querySelector('[data-action="community-month"][aria-label="上个月"]').click();
  assert.equal(center.scrollTop, 200);
  assert.equal(center.querySelector('[data-community]'), section, 'keep the calendar visible while the request is pending');
  // A delayed request can outlive the route which started it.
  render('#/community/boards/tools'); await turn();
  const board = center.querySelector('[data-community]');
  center.dispatchEvent(new w.Event('wheel')); center.scrollTop = 180;
  resolve(calendar(previousMonth)); await turn();
  assert.equal(center.querySelector('[data-community]'), board, 'a late month response must not repaint the new board');
  assert.equal(center.scrollTop, 180);
  render('#/community/checkin');
  // The previous month was explicitly chosen, so it remains selected on re-entry.
  await turn();
  main.querySelector('[data-action="community-month"][aria-label="下个月"]').click(); await turn();
  assert.ok(main.querySelector('.community-ck-calendar .community-card-h').textContent.includes(`${year} 年 ${month} 月`));
});

test('rapid calendar selection keeps only the latest month response', async t => {
  const current = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
  const [year, month] = current.split('-').map(Number);
  const earlierMonth = new Date(Date.UTC(year, month - 3, 1)).toISOString().slice(0, 7);
  let pending = false, resolve;
  const old = new Promise(done => { resolve = done; });
  const calendar = month => response({ checkedIn: false, streak: 1, balance: 30, vip: false, month, days: [],
    checkinsToday: 1, earlyBirds: [], badges: [], makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: [] } });
  const { w, main, frame } = await setup(t, '#/community/checkin', url => {
    if (!url.includes('/checkin')) return null;
    const requested = new URL(url, 'http://localhost').searchParams.get('month') || current;
    return pending && requested === earlierMonth ? old : calendar(requested);
  });
  main.querySelector('[data-action="community-month"][aria-label="上个月"]').click(); await turn();
  pending = true;
  main.querySelector('[data-action="community-month"][aria-label="上个月"]').click();
  main.querySelector('[data-action="community-month"][aria-label="下个月"]').click(); await turn();
  const calendarNode = main.querySelector('.community-ck-calendar');
  frame.center().dispatchEvent(new w.Event('wheel')); frame.center().scrollTop = 160;
  resolve(calendar(earlierMonth)); await turn();
  assert.equal(main.querySelector('.community-ck-calendar'), calendarNode, 'an obsolete response must not repaint');
  assert.equal(frame.center().scrollTop, 160);
  assert.ok(calendarNode.querySelector('.community-card-h').textContent.includes(`${year} 年 ${month} 月`));
});

test('ledger filters keep the reading position and controls during loading and ignore late selections', async t => {
  const ledger = flow => response({ balance: 30, gainedToday: 1, behaviourToday: 0, dailyCap: 30, checkedIn: true,
    month: { gained: 1, spent: 0 }, flow, ledger: [{ id: flow, amount: flow === 'out' ? -1 : 1, kind: 'test', reason: flow,
      createdAt: '2026-10-01T10:00:00Z', reverted: false, topic: null }], level: 1, owner: false, steward: false, stats: {}, progress: null });
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { w, main, frame } = await setup(t, '#/community/stardust', url => {
    if (!url.includes('/stardust')) return null;
    const flow = new URL(url, 'http://localhost').searchParams.get('flow') || 'all';
    return flow === 'in' ? pending : ledger(flow);
  });
  const center = frame.center(), table = main.querySelector('.community-ledger');
  const incoming = main.querySelector('[data-flow="in"]'), outgoing = main.querySelector('[data-flow="out"]');
  center.dispatchEvent(new w.Event('wheel')); center.scrollTop = 280;
  incoming.click();
  assert.equal(center.scrollTop, 280);
  assert.equal(main.querySelector('.community-ledger'), table, 'the old ledger stays visible while loading');
  assert.equal(incoming.getAttribute('aria-pressed'), 'true');
  assert.ok(outgoing.isConnected, 'the user can choose a different filter during loading');
  outgoing.click(); await turn();
  assert.equal(main.querySelector('[data-flow="out"]').getAttribute('aria-pressed'), 'true');
  assert.equal(main.querySelector('.community-ledger tbody td:nth-child(2)').textContent, 'out');
  const selected = main.querySelector('[data-community]');
  center.dispatchEvent(new w.Event('wheel')); center.scrollTop = 180;
  resolve(ledger('in')); await turn();
  assert.equal(main.querySelector('[data-community]'), selected);
  assert.equal(center.scrollTop, 180);
});

test('returning quickly to the same ledger filter ignores its older request', async t => {
  const ledger = (flow, reason) => response({ balance: 30, gainedToday: 1, behaviourToday: 0, dailyCap: 30, checkedIn: true,
    month: { gained: 1, spent: 0 }, flow, ledger: [{ id: reason, amount: 1, kind: 'test', reason,
      createdAt: '2026-10-01T10:00:00Z', reverted: false, topic: null }], level: 1, owner: false, steward: false, stats: {}, progress: null });
  let resolve, incomingCalls = 0;
  const older = new Promise(done => { resolve = done; });
  const { w, main, frame } = await setup(t, '#/community/stardust', url => {
    if (!url.includes('/stardust')) return null;
    const flow = new URL(url, 'http://localhost').searchParams.get('flow') || 'all';
    if (flow === 'in' && ++incomingCalls === 1) return older;
    return ledger(flow, flow === 'in' ? '最新收入' : flow);
  });
  main.querySelector('[data-flow="in"]').click();
  main.querySelector('[data-flow="out"]').click(); await turn();
  main.querySelector('[data-flow="in"]').click(); await turn();
  const section = main.querySelector('[data-community]');
  frame.center().dispatchEvent(new w.Event('wheel')); frame.center().scrollTop = 210;
  resolve(ledger('in', '过时收入')); await turn();
  assert.equal(main.querySelector('[data-community]'), section);
  assert.equal(main.querySelector('.community-ledger tbody td:nth-child(2)').textContent, '最新收入');
  assert.equal(frame.center().scrollTop, 210);
});

for (const width of [1600, 390]) test(`at ${width}px repeated navigation clicks and back/forward start at the top`, async t => {
  const { w, main, frame, render, calls, resizeWidth } = await setup(t, '#/community/boards/qa');
  resizeWidth(width); await turn();
  const center = frame.center(), right = main.querySelector('[data-frame-right]');
  const scroll = width === 390 ? w.document.documentElement : center;
  const nav = w.document.getElementById('navigation');
  const current = main.querySelector('.community-frame-boards a[href="#/community/boards/qa"]');
  const section = center.querySelector('[data-community]');
  scroll.dispatchEvent(new w.Event('wheel', { bubbles: true })); scroll.scrollTop = 270;
  right.scrollTop = 44;
  const count = calls.length;
  current.click(); await turn();
  assert.equal(scroll.scrollTop, 0, 'the selected board resets without a hashchange');
  assert.equal(center.querySelector('[data-community]'), section, 'a repeated click does not remount the page');
  assert.equal(calls.length, count, 'a repeated click does not reload its data');
  // Use real hash navigation and history traversal, rather than calling render directly.
  const changed = () => render(w.location.hash);
  w.addEventListener('hashchange', changed);
  t.after(() => w.removeEventListener('hashchange', changed));
  scroll.scrollTop = 270;
  main.querySelector('.community-frame-boards a[href="#/community/boards/showcase"]').click(); await turn();
  assert.equal(w.location.hash, '#/community/boards/showcase');
  assert.equal(scroll.scrollTop, 0);
  scroll.dispatchEvent(new w.Event('wheel', { bubbles: true })); scroll.scrollTop = 280;
  w.history.back(); await turn();
  assert.equal(w.location.hash, '#/community/boards/qa');
  assert.equal(scroll.scrollTop, 0);
  scroll.dispatchEvent(new w.Event('wheel', { bubbles: true })); scroll.scrollTop = 290;
  w.history.forward(); await turn();
  assert.equal(w.location.hash, '#/community/boards/showcase');
  assert.equal(scroll.scrollTop, 0);
  assert.equal(frame.center(), center);
  assert.equal(main.querySelector('[data-frame-right]'), right);
  assert.equal(w.document.getElementById('navigation'), nav);
  assert.equal(right.scrollTop, 44);
  scroll.dispatchEvent(new w.Event('wheel', { bubbles: true })); scroll.scrollTop = 200;
  nav.querySelector('a[href="#/community/home"]').click(); await turn();
  const home = center.querySelector('[data-community]');
  scroll.dispatchEvent(new w.Event('wheel', { bubbles: true })); scroll.scrollTop = 220;
  nav.querySelector('a[href="#/community/home"]').click(); await turn();
  assert.equal(scroll.scrollTop, 0, 'the primary navigation also handles a repeated click');
  assert.equal(center.querySelector('[data-community]'), home);
});

test('narrow screens preserve document scroll and deliberate scrolling cancels a pending restore', async t => {
  const { w, frame, render, resize } = await setup(t, '#/community/boards/qa');
  resize(true); await turn();
  const scroll = w.document.documentElement;
  scroll.scrollTop = 310;
  const restore = frame.preserveReadingPosition();
  scroll.scrollTop = 0; restore(); await turn();
  assert.equal(scroll.scrollTop, 310);
  render('#/community/boards/showcase'); await turn();
  assert.equal(scroll.scrollTop, 0);
  render('#/community/boards/qa'); await turn();
  assert.equal(scroll.scrollTop, 0, 'returning to a visited board starts at the top on mobile too');
  scroll.scrollTop = 310;
  const again = frame.preserveReadingPosition(); again();
  w.document.dispatchEvent(new w.Event('wheel', { bubbles: true }));
  scroll.scrollTop = 140; await turn();
  assert.equal(scroll.scrollTop, 140);
});

test('board navigation does not replay the old rise animation', async t => {
  const { main, render } = await setup(t);
  for (const board of communityBoards) {
    render(`#/community/boards/${board.id}`);
    assert.equal(main.classList.contains('community-entering'), false, board.id);
    await turn();
  }
});

test('every board omits posting tips in the stable preview while keeping the board title and real list controls', async t => {
  const { frame, render } = await setup(t);
  for (const board of communityBoards) {
    render(`#/community/boards/${board.id}`); await turn();
    const page = frame.center().querySelector('[data-community="board"]');
    assert.equal(page.querySelector('.community-ticks'), null, board.id);
    assert.equal(page.querySelector('.community-rank'), null, board.id);
    assert.equal(page.querySelector('.community-bh-text h1').textContent, board.zh);
    assert.ok(page.querySelector('[data-action="community-sort"]'));
    assert.ok(page.querySelector('#community-search'));
  }
});

test('each board has its own sidebar counts and trending, retaining rails and the global check-in control', async t => {
  const stats = Object.fromEntries(communityBoards.map((board, i) => [board.id, { topics: 20 + i, repliesToday: i + 1 }]));
  const { main, render, calls } = await setup(t, '#/community/home', url => url.endsWith('/summary')
    ? response({ total: 135, repliesToday: 21, checkinsToday: 8, boards: stats, tags: {}, hot: [topic('p1')] }) : null);
  const right = main.querySelector('[data-frame-right]');
  const signIn = right.querySelector('[data-action="community-checkin"]');
  for (const board of communityBoards) {
    render(`#/community/boards/${board.id}`); await turn();
    assert.equal(main.querySelector('[data-frame-right]'), right);
    assert.equal(right.querySelector('[data-action="community-checkin"]'), signIn);
    assert.equal(right.querySelector('h2').textContent, `${board.zh}动态`);
    assert.deepEqual([...right.querySelectorAll('.community-stats dd')].map(node => node.textContent), [String(stats[board.id].topics), String(stats[board.id].repliesToday)]);
    assert.deepEqual([...right.querySelectorAll('.community-hot a')].map(node => node.getAttribute('href')), [`#/post/${board.id}-p3`]);
    assert.ok(calls.some(call => call.url === `/api/community/topics?board=${board.id}&sort=hot&page=1`));
  }
  render('#/community/new/tools'); await turn();
  assert.equal(right.querySelector('h2').textContent, '工具资源动态');
  render('#/post/p1'); await turn();
  assert.equal(right.querySelector('h2').textContent, '学习问答动态');
});

test('posting tips remain in the baseline; hiding them does not delete the active-member card', () => {
  const options = { board: 'showcase', t: zh => zh, esc: String, icons: {}, members: true, sort: 'active',
    summary: { state: 'ready', data: { total: 3, boards: {}, tags: {}, hot: [], repliesToday: 0, checkinsToday: 0 } },
    list: { state: 'ready', data: { ...listing, posters: [{ author: person, topics: 3 }] } } };
  const baseline = JSDOM.fragment(communityBoardHTML(options));
  const candidate = JSDOM.fragment(communityBoardHTML({ ...options, showPostingTips: false }));
  assert.ok(baseline.querySelector('.community-ticks'));
  assert.equal(candidate.querySelector('.community-ticks'), null);
  assert.match(candidate.querySelector('.community-aside').textContent, /本版活跃/);
  assert.equal(candidate.querySelector('.community-rank .community-uname').textContent, person.name);
  const empty = JSDOM.fragment(communityBoardHTML({ ...options, showPostingTips: false, list: { state: 'ready', data: listing } }));
  assert.equal(empty.querySelector('.community-aside'), null);
});
