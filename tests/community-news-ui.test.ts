import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { createCommunityUI, type CommunityContext } from '../src/community-ui.ts';
import { createStableCommunityFrame } from '../src/community-layout/stable-frame.ts';
import { defaultCommunityBoards, resetCommunityBoardCatalog, type CommunityBoard, type CommunityListing, type CommunityMe, type CommunitySummary, type CommunityTopic } from '../src/community.ts';
import type { CommunityThread } from '../src/community-post.ts';

interface TestWindow extends Window { close(): void; Event: typeof Event }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => { window: TestWindow };
};
type Call = { url: string; init: RequestInit };
type Intercept = (url: string, init: RequestInit) => Response | Promise<Response> | null;
const flush = async () => { for (let i = 0; i < 12; i++) await setImmediate(); };
const response = (data: unknown) => Response.json(structuredClone(data));
const params = (url: string) => new URL(url, 'http://localhost').searchParams;
const passive = (init: RequestInit) => new Headers(init.headers).get('X-Community-Passive') === '1';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const reader: CommunityMe = {
  name: '资讯读者', uid: '10001', role: 'reader', owner: false, mod: false, vip: true, agreed: true,
  unread: { all: 0, reply: 0, thanks: 0, system: 0 }, balance: 8, checkedIn: true, streak: 1,
  nextReward: { total: 2, bonus: 0 }, gainedToday: 0, behaviourToday: 0, dailyCap: 6,
  inventory: { makeup: 0, pin: 0, highlight: 0 }, muted: null,
};
const board: CommunityBoard = {
  ...defaultCommunityBoards[2], id: 'daily-agent-updates', zh: '  ai 资讯 ', en: 'AI updates',
};
const topic = (id: number, news = false): CommunityTopic => ({
  id: `${news ? 'n' : 'p'}${id}`, board: news ? board.id : 'showcase', title: `${news ? '资讯' : '精选'}-${id}`, author: reader,
  featured: !news && id <= 3, createdAt: '2026-10-09T01:30:00Z', lastActivityAt: '2026-10-09T02:00:00Z',
  likes: id, replies: id + 1, hasTitle: true, excerpt: `不应出现在榜单的正文-${id}`, tags: [],
});
const initial = Array.from({ length: 6 }, (_, i) => topic(i + 1));
const listing = (items: CommunityTopic[], page = 1, total = items.length): CommunityListing => ({ items, page, total, pageSize: 6 });
const curatedRows = (main: HTMLElement) => [...main.querySelectorAll<HTMLElement>('.community-curated-list > [data-topic-id]')];
const newsRows = (main: HTMLElement) => [...main.querySelectorAll<HTMLElement>('.community-news-list > [data-topic-id]')];
const publishedCalls = (calls: Call[]) => calls.filter(call => call.url.startsWith('/api/community/topics?') && params(call.url).get('sort') === 'published');

// A small real UI fixture, with the public catalog supplied by the same summary
// endpoint as production. It imports no test suite or imitation UI renderer.
async function fixture(t: TestContext, options: { catalog?: boolean; intercept?: Intercept; viewer?: CommunityMe } = {}) {
  resetCommunityBoardCatalog();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 9, 3) });
  const { window } = new JSDOM('<main></main>', { url: 'http://localhost/#/community/home', pretendToBeVisual: true });
  const globals = globalThis as unknown as Record<string, unknown>, environment = window as unknown as Record<string, unknown>;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globals[name]]));
  for (const name of names) globals[name] = name === 'window' ? window : environment[name];
  window.scrollTo = () => {};
  const calls: Call[] = [], notices: string[] = [];
  const catalog = { version: 1, items: [...defaultCommunityBoards, ...(options.catalog === false ? [] : [board])] };
  const summary: CommunitySummary = { total: 12, repliesToday: 4, checkinsToday: 2, boards: {}, tags: {}, hot: [], boardCatalog: catalog };
  const data = new Map<string, CommunityListing>([
    ['curated|1', listing(initial, 1, 12)],
    ['curated|2', listing(Array.from({ length: 6 }, (_, i) => topic(i + 7)), 2, 12)],
    ['newest|1', listing(initial)],
    ['published|1', listing([topic(1, true), topic(2, true)])],
  ]);
  let viewer = structuredClone(options.viewer || reader), intercept = options.intercept || (() => null);
  const request: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const supplied = intercept(url, init); if (supplied) return supplied;
    if (url.endsWith('/me')) return response(viewer);
    if (url.endsWith('/summary')) return response(summary);
    if (url.startsWith('/api/community/banners?')) return response({ scope: 'home', version: 1, items: [] });
    if (url.startsWith('/api/community/topics?')) {
      const query = params(url);
      return response(data.get(`${query.get('sort')}|${query.get('page')}`) || listing(initial));
    }
    throw Error(`Unexpected request: ${url}`);
  };
  const ctx: CommunityContext = {
    t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    icons: {}, members: true, simpleCompose: true, showHomeCompose: false, showPostingTips: false, showActiveMembers: false,
    notify: message => { notices.push(message); },
  };
  const ui = createCommunityUI({ request }), main = window.document.querySelector<HTMLElement>('main')!;
  const frame = createStableCommunityFrame(window.document, window, request);
  ctx.painted = () => frame.sync(ui.frameHTML(ctx));
  ctx.beforePaint = () => frame.preserveReadingPosition();
  const render = () => { if (!frame.render(main, ui.html(ctx), ui.frameHTML(ctx))) main.innerHTML = ui.html(ctx) || ''; };
  render(); let cleanup = ui.mount(main, ctx);
  t.after(() => {
    cleanup(); ui.clear(); frame.dispose(); window.close(); resetCommunityBoardCatalog();
    for (const [name, value] of previous) { if (value === undefined) delete globals[name]; else globals[name] = value; }
  });
  await flush();
  const click = async (selector: string) => {
    const control = main.querySelector<HTMLElement>(selector); assert.ok(control, `missing control: ${selector}`);
    control.click(); await flush();
  };
  const tick = async (ms: number) => { t.mock.timers.tick(ms); await flush(); };
  const remount = async (hash: string) => {
    window.history.replaceState(null, '', hash); cleanup(); render(); cleanup = ui.mount(main, ctx); await flush();
  };
  return { window, main, ui, calls, data, summary, notices, click, tick, remount,
    sort: (value: string) => click(`[data-action="community-sort"][data-sort="${value}"]`),
    more: () => click('[data-action="community-more"]'),
    identity: (person: CommunityMe) => { viewer = structuredClone(person); },
    intercept: (value: Intercept) => { intercept = value; },
  };
}

test('home curated reads the real AI资讯 catalog ID once and displays absolute Beijing publication dates', async t => {
  const f = await fixture(t), reads = publishedCalls(f.calls);
  assert.equal(reads.length, 1, 'the existing topics endpoint supplies one separate latest-news page');
  assert.equal(params(reads[0].url).get('board'), board.id, 'custom board IDs come from the public catalog rather than an assumed slug');
  assert.equal(params(reads[0].url).get('page'), '1');
  assert.equal(reads[0].init.method || 'GET', 'GET');
  assert.equal(curatedRows(f.main).length, 6);
  assert.deepEqual(newsRows(f.main).map(row => row.dataset.topicId), ['n1', 'n2']);
  assert.equal(f.main.querySelector('.community-news h2')?.textContent, '最新资讯');
  for (const row of newsRows(f.main)) {
    const time = row.querySelector('time'); assert.ok(time);
    assert.equal(time.getAttribute('datetime'), '2026-10-09T01:30:00Z');
    assert.equal(time.textContent, '2026/10/09 09:30');
    assert.equal(row.querySelector('.community-news-title')?.getAttribute('href'), `#/post/${row.dataset.topicId}`);
  }
  assert.equal(f.main.querySelector('.community-news-more')?.getAttribute('href'), `#/community/boards/${board.id}`);
  assert.doesNotMatch(f.main.querySelector('.community-news')?.textContent || '', /不应出现在榜单的正文/);
});

test('without an AI资讯 catalog entry, news never substitutes an unscoped community listing', async t => {
  const f = await fixture(t, { catalog: false });
  assert.equal(curatedRows(f.main).length, 6);
  assert.equal(publishedCalls(f.calls).length, 0);
  assert.equal(newsRows(f.main).length, 0);
  assert.ok(f.main.querySelector('[data-news-state="unconfigured"]'), 'a missing configured board is shown honestly');
});

test('a first news read outage displays an isolated error state and leaves the confirmed curated page readable', async t => {
  const f = await fixture(t, { intercept: url => params(url).get('sort') === 'published'
    ? Response.json({ error: '资讯服务临时不可用。' }, { status: 503 }) : null });
  assert.equal(publishedCalls(f.calls).length, 1);
  assert.equal(curatedRows(f.main).length, 6);
  assert.equal(f.ui.me()?.uid, reader.uid);
  assert.ok(f.main.querySelector('[data-news-state="error"]'));
  assert.equal(newsRows(f.main).length, 0);
  assert.doesNotMatch(f.main.querySelector('.community-curated')?.textContent || '', /正在读取|资讯服务临时不可用/);
});

test('slow latest-news loading allows the curated first page and later changes only the news region', async t => {
  const held = deferred<Response>();
  const f = await fixture(t, { intercept: url => params(url).get('sort') === 'published' ? held.promise : null });
  assert.equal(curatedRows(f.main).length, 6, 'readable featured/popular content does not wait for supporting news');
  assert.ok(f.main.querySelector('[data-news-state="loading"]'));
  await f.more();
  const rows = curatedRows(f.main), list = f.main.querySelector('.community-curated-list');
  assert.equal(rows.length, 12);
  held.resolve(response(listing([topic(3, true)]))); await flush();
  assert.equal(f.main.querySelector('.community-curated-list'), list, 'late supporting data preserves the established ranked list');
  assert.deepEqual(curatedRows(f.main), rows);
  assert.deepEqual(newsRows(f.main).map(row => row.dataset.topicId), ['n3']);
});

test('passive news refresh still updates an expanded curated page without reloading or truncating its rows', async t => {
  const f = await fixture(t); await f.more();
  (f.window.document.activeElement as HTMLElement | null)?.blur(); await flush(); await f.tick(0);
  const rows = curatedRows(f.main), list = f.main.querySelector('.community-curated-list');
  f.data.set('published|1', listing([topic(3, true)]));
  await f.tick(15000);
  const reads = f.calls.filter(call => passive(call.init));
  assert.equal(publishedCalls(reads).length, 1);
  assert.equal(reads.filter(call => call.url.startsWith('/api/community/topics?') && params(call.url).get('sort') === 'curated').length, 0);
  assert.equal(f.main.querySelector('.community-curated-list'), list, 'updating the separate news board must not detach accumulated curated rows');
  assert.deepEqual(curatedRows(f.main), rows);
  assert.deepEqual(newsRows(f.main).map(row => row.dataset.topicId), ['n3']);
  assert.equal(f.calls.some(call => call.url.endsWith('/active/visit')), false, 'supporting updates cannot award an active visit');
});

test('passive news updates preserve keyboard focus on the same post, or the news header when that post disappears', async t => {
  const f = await fixture(t), rows = curatedRows(f.main), list = f.main.querySelector('.community-curated-list');
  const link = f.main.querySelector<HTMLAnchorElement>('.community-news-title[href="#/post/n1"]'); assert.ok(link);
  const focus = HTMLElement.prototype.focus, focusCalls: Array<{ element: HTMLElement; options?: FocusOptions }> = [];
  t.mock.method(HTMLElement.prototype, 'focus', function (this: HTMLElement, options?: FocusOptions) {
    focusCalls.push({ element: this, options }); focus.call(this, options);
  });
  link.focus();
  await flush(); await f.tick(0);
  assert.equal(f.window.document.activeElement, link);
  f.data.set('published|1', listing([topic(3, true), { ...topic(1, true), title: '仍可阅读的原资讯' }]));
  // Settle focus/selection events before moving the fake clock, and yield
  // async work so an accelerated read is not also timed out in that jump.
  await f.tick(1000); await f.tick(14000);
  assert.deepEqual(newsRows(f.main).map(row => row.dataset.topicId), ['n3', 'n1'], 'the passive news batch actually applied');
  const updated = f.main.querySelector<HTMLAnchorElement>('.community-news-title[href="#/post/n1"]'); assert.ok(updated);
  assert.equal(updated.textContent, '仍可阅读的原资讯');
  assert.equal(f.window.document.activeElement, updated, 'the same post remains the keyboard reading target after replacement');
  assert.ok(focusCalls.some(call => call.element === updated && call.options?.preventScroll === true), 'focus restoration must not move the reading viewport');
  assert.equal(f.main.querySelector('.community-curated-list'), list);
  assert.deepEqual(curatedRows(f.main), rows);
  await flush(); await f.tick(0);
  f.data.set('published|1', listing([topic(4, true)]));
  await f.tick(1000); await f.tick(14000);
  const header = f.main.querySelector<HTMLAnchorElement>('.community-news-more'); assert.ok(header);
  assert.equal(f.window.document.activeElement, header, 'a removed post hands focus to the stable all-news navigation');
  assert.ok(focusCalls.some(call => call.element === header && call.options?.preventScroll === true));
  assert.equal(f.main.querySelector('.community-curated-list'), list);
  assert.deepEqual(curatedRows(f.main), rows);
});

test('the first passive catalog update that adds AI资讯 starts its scoped news read immediately without delaying curated content', async t => {
  const f = await fixture(t, { catalog: false }), held = deferred<Response>();
  const rows = curatedRows(f.main), list = f.main.querySelector('.community-curated-list');
  assert.equal(publishedCalls(f.calls).length, 0);
  f.summary.boardCatalog = { version: 2, items: [...defaultCommunityBoards, board] };
  f.intercept(url => params(url).get('sort') === 'published' ? held.promise : null);
  await f.tick(15000);
  const reads = publishedCalls(f.calls);
  assert.equal(reads.length, 1, 'the new directory source loads during the current refresh rather than waiting another interval');
  assert.equal(params(reads[0].url).get('board'), board.id);
  assert.equal(params(reads[0].url).get('page'), '1');
  assert.equal(f.main.querySelector('.community-curated-list'), list);
  assert.deepEqual(curatedRows(f.main), rows, 'a slow newly configured auxiliary board leaves confirmed curated rows attached');
  assert.ok(f.main.querySelector('[data-news-state="loading"]'));
  held.resolve(response(listing([topic(3, true)]))); await flush();
  assert.deepEqual(newsRows(f.main).map(row => row.dataset.topicId), ['n3']);
  assert.equal(f.main.querySelector('.community-curated-list'), list);
  assert.deepEqual(curatedRows(f.main), rows);
});

test('a resource-specific news 403 retires old news immediately while slow supporting reads leave curated rows and login intact', async t => {
  const f = await fixture(t), support = deferred<Response>(), rows = curatedRows(f.main);
  assert.equal(newsRows(f.main).length, 2);
  f.intercept((url, init) => {
    if (!passive(init)) return null;
    if (url.endsWith('/summary')) return support.promise;
    if (params(url).get('sort') === 'published') return Response.json({ error: '资讯权限已撤回。' }, { status: 403 });
    return null;
  });
  await f.tick(15000);
  assert.equal(newsRows(f.main).length, 0, 'the old permitted news pixels retire before a slower summary response');
  assert.ok(f.main.querySelector('[data-news-state="error"]'));
  assert.deepEqual(curatedRows(f.main), rows);
  assert.equal(f.ui.me()?.uid, reader.uid, 'this denial applies to the auxiliary board rather than the confirmed viewer');
  support.resolve(response(f.summary)); await flush();
  assert.equal(newsRows(f.main).length, 0);
  assert.equal(curatedRows(f.main).length, 6);
});

test('an old news read cannot restore the previous viewer rows after an actual account change', async t => {
  const held = deferred<Response>();
  const f = await fixture(t, { intercept: url => params(url).get('sort') === 'published' ? held.promise : null });
  assert.equal(curatedRows(f.main).length, 6);
  f.identity({ ...reader, uid: '10002', vip: false });
  f.data.set('published|1', listing([{ ...topic(3, true), title: '新账号可见资讯' }]));
  f.intercept(() => null); await f.remount('#/community/boards'); await f.remount('#/community/home');
  assert.equal(f.ui.me()?.uid, '10002');
  held.resolve(response(listing([{ ...topic(1, true), title: '旧账号迟到资讯' }]))); await flush();
  assert.doesNotMatch(f.main.textContent || '', /旧账号迟到资讯/);
  assert.deepEqual(newsRows(f.main).map(row => row.dataset.topicId), ['n3']);
  assert.ok(publishedCalls(f.calls).length >= 2, 'new authority does not trust the old in-flight news request');
});

test('a successful real content decision retires pending news reads instead of caching their late older result', async t => {
  const moderator: CommunityMe = { ...reader, mod: true, moderationBoards: ['showcase'], management: { role: 'moderator', browsingAsReader: false } };
  const held = deferred<Response>();
  const f = await fixture(t, { viewer: moderator, intercept: url => params(url).get('sort') === 'published' ? held.promise : null });
  let featured = true;
  const discussion = (): CommunityThread => ({
    topic: { ...initial[0], featured, body: '真实已发布的正文。', images: [], canDelete: false, canFeature: true, canReply: true },
    author: { ...reader, topics: 10, replies: 5 }, related: [], replies: [],
  });
  f.intercept((url, init) => {
    if (url.endsWith('/topics/p1')) return response(discussion());
    if (url.endsWith('/topics/p1/feature') && init.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { on: false }); featured = false;
      f.data.set('published|1', listing([{ ...topic(3, true), title: '操作后更新的资讯' }]));
      return response({ ok: true });
    }
    return null;
  });
  await f.remount('#/post/p1');
  await f.click('[data-action="community-post-menu"]'); await f.click('[data-action="community-feature"][data-id="p1"]');
  assert.equal(f.calls.filter(call => call.url.endsWith('/topics/p1/feature') && call.init.method === 'POST').length, 1);
  held.resolve(response(listing([{ ...topic(1, true), title: '操作前迟到资讯' }]))); await flush();
  await f.remount('#/community/home');
  assert.doesNotMatch(f.main.textContent || '', /操作前迟到资讯/);
  assert.deepEqual(newsRows(f.main).map(row => row.dataset.topicId), ['n3']);
  assert.equal(publishedCalls(f.calls).length, 2);
});

test('latest news is limited to unsearched home curated and does not add requests to normal flows or other scopes', async t => {
  const f = await fixture(t), reads = publishedCalls(f.calls).length;
  await f.sort('newest');
  assert.equal(f.main.querySelector('.community-news'), null);
  assert.equal(f.main.querySelectorAll('.community-results .community-topic').length, 6);
  assert.equal(publishedCalls(f.calls).length, reads);
  await f.sort('curated');
  const homeReads = publishedCalls(f.calls).length;
  const search = f.main.querySelector<HTMLFormElement>('[data-community-form="search"]');
  const field = search?.querySelector<HTMLInputElement>('[name="q"]'); assert.ok(search); assert.ok(field);
  field.value = '指定帖子'; search.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
  assert.equal(f.main.querySelector('.community-news'), null);
  await f.remount('#/community/boards/qa');
  assert.equal(f.main.querySelector('.community-news'), null);
  await f.remount('#/community/tag/提示词');
  assert.equal(f.main.querySelector('.community-news'), null);
  assert.equal(publishedCalls(f.calls).length, homeReads, 'latest news stays a home-only supporting request');
});
