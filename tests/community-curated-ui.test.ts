import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { createCommunityUI, type CommunityContext } from '../src/community-ui.ts';
import { createStableCommunityFrame } from '../src/community-layout/stable-frame.ts';
import type { CommunityListing, CommunityMe, CommunitySummary, CommunityTopic } from '../src/community.ts';
import type { CommunityThread } from '../src/community-post.ts';
import type { CommunityManage } from '../src/community-pages.ts';

interface TestWindow extends Window {
  close(): void;
  Event: typeof Event;
}
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => { window: TestWindow };
};
type Call = { url: string; init: RequestInit };
type Intercept = (url: string, init: RequestInit) => Response | Promise<Response> | null;
const flush = async () => { for (let i = 0; i < 12; i++) await setImmediate(); };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const response = (data: unknown) => Response.json(structuredClone(data));
const passive = (init: RequestInit) => new Headers(init.headers).get('X-Community-Passive') === '1';
const params = (url: string) => new URL(url, 'http://localhost').searchParams;
const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reader: CommunityMe = {
  name: '测试读者', uid: '10001', role: 'reader', owner: false, mod: false, vip: true, agreed: true,
  unread: { all: 0, reply: 0, thanks: 0, system: 0 }, balance: 8, checkedIn: true, streak: 1,
  nextReward: { total: 2, bonus: 0 }, gainedToday: 0, behaviourToday: 0, dailyCap: 6,
  inventory: { makeup: 0, pin: 0, highlight: 0 }, muted: null,
};
const summary: CommunitySummary = { total: 18, repliesToday: 4, checkinsToday: 2, boards: {}, tags: {}, hot: [] };
const topic = (id: number, featured = false): CommunityTopic => ({
  id: `p${id}`, board: 'showcase', title: `精选帖子-${id}`, author: reader, featured,
  createdAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-02T00:00:00Z', likes: id, replies: id + 1,
  hasTitle: true, excerpt: `正文摘要-${id}`, thumbs: [image], tags: ['提示词'],
});
const initial = Array.from({ length: 6 }, (_, index) => topic(index + 1, index < 3));
const listing = (items: CommunityTopic[], page = 1, total = 18): CommunityListing => ({ items, page, pageSize: 6, total });
const curatedRows = (main: HTMLElement) => [...main.querySelectorAll<HTMLElement>('.community-curated-list > .community-curated-row')];
const ids = (main: HTMLElement) => curatedRows(main).map(row => row.dataset.topicId);
const titles = (main: HTMLElement) => curatedRows(main).map(row => row.querySelector('.community-curated-title')?.textContent);
const titleLinks = (main: HTMLElement) => curatedRows(main).map(row => row.querySelector<HTMLAnchorElement>('.community-curated-title'));

async function fixture(t: TestContext, options: { items?: CommunityTopic[]; hash?: string; intercept?: Intercept; frame?: boolean; viewer?: CommunityMe } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 9) });
  const { window } = new JSDOM('<main></main>', { url: `http://localhost/${options.hash || '#/community/home'}`, pretendToBeVisual: true });
  const globals = globalThis as unknown as Record<string, unknown>;
  const environment = window as unknown as Record<string, unknown>;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globals[name]]));
  for (const name of names) globals[name] = name === 'window' ? window : environment[name];
  window.scrollTo = () => {};
  const calls: Call[] = [], notices: string[] = [], data = new Map<string, CommunityListing>();
  data.set('curated|1', listing(options.items || initial));
  data.set('curated|2', listing([topic(6), topic(7), topic(8), topic(8), topic(9), topic(10)], 2));
  data.set('curated|3', listing([topic(10), topic(11), topic(12), topic(13), topic(14), topic(15)], 3));
  data.set('newest|1', listing(initial.map(item => ({ ...item, title: `普通帖子-${item.id}`, featured: false }))));
  let person = structuredClone(options.viewer || reader), intercept = options.intercept || (() => null);
  const request: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const supplied = intercept(url, init); if (supplied) return supplied;
    if (url.endsWith('/me')) return response(person);
    if (url.endsWith('/summary')) return response(summary);
    if (url.startsWith('/api/community/banners?')) return response({ scope: 'home', version: 1, items: [] });
    if (url.startsWith('/api/community/topics?')) {
      const query = params(url), selected = data.get(`${query.get('sort')}|${query.get('page')}`);
      return response(selected || listing(initial));
    }
    throw Error(`Unexpected request: ${url}`);
  };
  const ctx: CommunityContext = {
    t: zh => zh,
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    icons: {}, members: true, simpleCompose: true, showHomeCompose: false, showPostingTips: false, showActiveMembers: false,
    notify: message => { notices.push(message); },
  };
  const ui = createCommunityUI({ request }), main = window.document.querySelector<HTMLElement>('main')!;
  const frame = options.frame ? createStableCommunityFrame(window.document, window, request) : null;
  if (frame) {
    ctx.painted = () => frame.sync(ui.frameHTML(ctx));
    ctx.beforePaint = () => frame.preserveReadingPosition();
  }
  const render = () => { if (!frame?.render(main, ui.html(ctx), ui.frameHTML(ctx))) main.innerHTML = ui.html(ctx) || ''; };
  render();
  let cleanup = ui.mount(main, ctx);
  t.after(() => {
    cleanup(); ui.clear(); frame?.dispose(); window.close();
    for (const [name, value] of previous) { if (value === undefined) delete globals[name]; else globals[name] = value; }
  });
  await flush();
  const click = async (selector: string) => {
    const button = main.querySelector<HTMLButtonElement>(selector); assert.ok(button, `missing control: ${selector}`);
    button.click(); await flush();
  };
  const sort = (value: string) => click(`[data-action="community-sort"][data-sort="${value}"]`);
  const more = () => click('[data-action="community-more"]');
  const tick = async (ms: number) => { t.mock.timers.tick(ms); await flush(); };
  const idle = async () => { (window.document.activeElement as HTMLElement | null)?.blur(); await flush(); await tick(0); };
  const remount = async (hash: string) => {
    window.history.replaceState(null, '', hash); cleanup(); render(); cleanup = ui.mount(main, ctx); await flush();
  };
  return { window, main, ui, calls, data, notices, ctx, click, sort, more, tick, idle, remount,
    identity: (value: CommunityMe) => { person = structuredClone(value); },
    intercept: (value: Intercept) => { intercept = value; } };
}

test('default selection requests one curated first page and renders six compact ranked rows in the agreed tab order', async t => {
  const f = await fixture(t, { frame: true });
  const requests = f.calls.filter(call => call.url.startsWith('/api/community/topics?'));
  assert.equal(requests.length, 1, 'featured and popular share the existing listing request instead of two client requests');
  assert.equal(requests[0].init.method || 'GET', 'GET');
  assert.equal(params(requests[0].url).get('sort'), 'curated');
  assert.equal(params(requests[0].url).get('page'), '1');
  const tabs = [...f.main.querySelectorAll<HTMLButtonElement>('[data-action="community-sort"]')];
  assert.deepEqual(tabs.map(button => button.dataset.sort), ['curated', 'newest', 'active', 'following']);
  assert.deepEqual(tabs.map(button => button.textContent), ['精选', '最新发布', '最新回复', '关注']);
  assert.equal(tabs[0].getAttribute('aria-pressed'), 'true');
  assert.deepEqual(ids(f.main), initial.map(item => item.id));
  assert.deepEqual(titles(f.main), initial.map(item => item.title), 'server order keeps featured entries before popular supplements');
  assert.ok(f.main.querySelector('.community-curated > header'));
  assert.equal(f.main.querySelectorAll('.community-results .community-topic, .community-results .community-topic-excerpt, .community-results .community-topic-thumbs').length, 0);
  assert.equal(f.main.querySelector(`.community-results img[src*="${image}"]`), null);
  assert.doesNotMatch(f.main.querySelector('.community-results')?.textContent || '', /正文摘要/);
  for (const [index, row] of curatedRows(f.main).entries()) {
    assert.ok(row.querySelector('.community-curated-author'));
    assert.ok(row.querySelector('.community-curated-counts'));
    assert.equal(titleLinks(f.main)[index]?.getAttribute('href'), `#/post/${initial[index].id}`);
  }
});

test('curated pagination appends unique rows, retains the existing DOM, and advances by the returned page despite overlapping entries', async t => {
  const f = await fixture(t), firstRows = curatedRows(f.main), firstList = f.main.querySelector('.community-curated-list');
  await f.more();
  assert.deepEqual(ids(f.main), Array.from({ length: 10 }, (_, index) => `p${index + 1}`), 'duplicates against the old page and within one response appear only once');
  assert.equal(f.main.querySelector('.community-curated-list'), firstList, 'appending does not detach the established list');
  assert.deepEqual(curatedRows(f.main).slice(0, 6), firstRows, 'the reader keeps the existing row nodes');
  await f.more();
  assert.deepEqual(ids(f.main), Array.from({ length: 15 }, (_, index) => `p${index + 1}`));
  assert.deepEqual(f.calls.filter(call => call.url.startsWith('/api/community/topics?')).map(call => params(call.url).get('page')), ['1', '2', '3']);
  assert.equal(new Set(ids(f.main)).size, ids(f.main).length);
  assert.equal(f.main.querySelector('[data-action="community-more"]'), null, 'page 3 × page size 6 reaches the server total 18 even when overlap leaves only 15 unique rows');
  assert.ok(f.main.querySelector('.community-end'), 'the final server page ends the list');
});

test('a final second curated page with overlaps ends at the server boundary instead of offering an empty third page', async t => {
  const f = await fixture(t);
  f.data.set('curated|2', listing([topic(6), topic(7), topic(8), topic(8), topic(9), topic(10)], 2, 12));
  await f.more();
  assert.deepEqual(ids(f.main), Array.from({ length: 10 }, (_, index) => `p${index + 1}`));
  assert.equal(f.main.querySelector('[data-action="community-more"]'), null, 'page 2 × page size 6 exhausts all 12 server rows despite only 10 unique entries');
  assert.ok(f.main.querySelector('.community-end'));
  assert.deepEqual(f.calls.filter(call => call.url.startsWith('/api/community/topics?')).map(call => params(call.url).get('page')), ['1', '2']);
});

test('newest retains the regular post flow and returning to curated immediately reuses all cached pages without a loading flash or truncation', async t => {
  const f = await fixture(t);
  await f.more();
  const cached = ids(f.main), held = deferred<Response>();
  await f.sort('newest');
  assert.equal(f.main.querySelector('.community-curated'), null);
  assert.equal(f.main.querySelectorAll('.community-results .community-topic').length, 6);
  assert.match(f.main.querySelector('.community-results .community-topic-excerpt')?.textContent || '', /正文摘要\s*1/);
  assert.ok(f.main.querySelector(`.community-results .community-topic-thumbs img[src*="${image}"]`), 'only curated hides full feed previews');
  f.intercept(url => url.startsWith('/api/community/topics?') && params(url).get('sort') === 'curated' && params(url).get('page') === '1' ? held.promise : null);
  await f.sort('curated');
  assert.deepEqual(ids(f.main), cached, 'cached ranked entries are readable while a permitted background read is pending');
  assert.equal(f.main.querySelector('.community-results [data-content-state="loading"]'), null);
  assert.doesNotMatch(f.main.querySelector('.community-results')?.textContent || '', /正在读取/);
  held.resolve(response(listing(initial))); await flush();
  assert.deepEqual(ids(f.main), cached, 'a first-page revalidation cannot discard an accumulated second page');
});

test('idle curated first-page refresh uses the same scoped endpoint and applies complete staged data without blanking existing rows', async t => {
  const f = await fixture(t), support = deferred<Response>(), originalRows = curatedRows(f.main);
  const updated = initial.map(item => ({ ...item, title: `已更新-${item.id}`, likes: item.likes + 100, replies: item.replies + 50 }));
  f.intercept((url, init) => {
    if (!passive(init)) return null;
    if (url.endsWith('/summary')) return support.promise;
    if (url.startsWith('/api/community/topics?')) return response(listing(updated));
    return null;
  });
  await f.tick(15000);
  const reads = f.calls.filter(call => passive(call.init));
  assert.equal(reads.filter(call => call.url.endsWith('/me')).length, 1);
  const lists = reads.filter(call => call.url.startsWith('/api/community/topics?'));
  assert.equal(lists.length, 1);
  assert.equal(params(lists[0].url).get('sort'), 'curated');
  assert.equal(params(lists[0].url).get('page'), '1');
  assert.deepEqual(curatedRows(f.main), originalRows, 'slow supporting data keeps the confirmed list attached');
  assert.doesNotMatch(f.main.querySelector('.community-results')?.textContent || '', /正在读取/);
  support.resolve(response({ ...summary, repliesToday: 9 })); await flush();
  assert.deepEqual(titles(f.main), initial.map(item => `已更新-${item.id}`));
  assert.equal(curatedRows(f.main).length, 6);
  assert.match(curatedRows(f.main)[0].querySelector('.community-curated-counts')?.textContent || '', /101\s*个赞/);
  assert.match(curatedRows(f.main)[0].querySelector('.community-curated-counts')?.textContent || '', /52\s*条回复/);
  const updatedRows = curatedRows(f.main), list = f.main.querySelector('.community-curated-list');
  f.data.set('curated|1', listing(updated)); f.intercept(() => null);
  await f.tick(15000);
  assert.equal(f.main.querySelector('.community-curated-list'), list, 'the next unchanged batch does not redraw confirmed ranks repeatedly');
  assert.deepEqual(curatedRows(f.main), updatedRows);
  assert.equal(f.calls.some(call => call.url.endsWith('/active/visit')), false, 'passive refresh cannot award an active visit');
});

test('idle refresh never replaces an expanded curated list with its first page', async t => {
  const f = await fixture(t);
  await f.more(); await f.idle();
  const rows = curatedRows(f.main), list = f.main.querySelector('.community-curated-list');
  await f.tick(15000);
  assert.equal(f.calls.filter(call => passive(call.init) && call.url.startsWith('/api/community/topics?')).length, 0);
  assert.equal(f.calls.filter(call => passive(call.init) && call.url.endsWith('/summary')).length, 1);
  assert.deepEqual(curatedRows(f.main), rows);
  assert.equal(f.main.querySelector('.community-curated-list'), list);
  assert.deepEqual(ids(f.main), Array.from({ length: 10 }, (_, index) => `p${index + 1}`));
});

test('a VIP downgrade retires private curated cache before slower public reads and cannot reveal it by changing sort again', async t => {
  const privateItems = initial.map(item => ({ ...item, board: 'vip', title: `VIP精选-${item.id}` }));
  const f = await fixture(t, { items: privateItems }), held = deferred<Response>();
  assert.match(f.main.textContent || '', /VIP精选-p1/);
  f.identity({ ...reader, vip: false });
  f.intercept((url, init) => {
    if (passive(init) && url.startsWith('/api/community/topics?')) return held.promise;
    return null;
  });
  await f.tick(15000);
  assert.equal(f.ui.me()?.vip, false);
  assert.doesNotMatch(f.main.textContent || '', /VIP精选-/);
  assert.equal(f.main.querySelector(`.community-results img[src*="${image}"]`), null);
  const publicItems = Array.from({ length: 6 }, (_, index) => ({ ...topic(index + 101), title: `公开精选-${index + 101}` }));
  f.data.set('curated|1', listing(publicItems, 1, 6));
  held.resolve(response(listing(publicItems, 1, 6))); await flush();
  assert.deepEqual(ids(f.main), publicItems.map(item => item.id));
  f.intercept(() => null);
  await f.sort('newest'); await f.sort('curated');
  assert.deepEqual(ids(f.main), publicItems.map(item => item.id));
  assert.doesNotMatch(f.main.textContent || '', /VIP精选-/);
  assert.equal(f.calls.some(call => call.url.endsWith('/active/visit')), false);
});

for (const successful of [true, false]) test(`a ${successful ? 'successful' : 'rejected'} real feature decision ${successful ? 'invalidates stale expanded curated ranks' : 'retains the expanded curated cache'}`, async t => {
  const moderator: CommunityMe = { ...reader, mod: true, moderationBoards: ['showcase'], management: { role: 'moderator', browsingAsReader: false } };
  const f = await fixture(t, { viewer: moderator });
  await f.more();
  const original = ids(f.main);
  assert.equal(original.length, 10);
  await f.sort('newest');
  let featured = true;
  const discussion = (): CommunityThread => ({
    topic: { ...initial[0], featured, body: '这是已发布且可管理的帖子正文。', images: [], canDelete: false, canFeature: true, canReply: true },
    author: { ...reader, topics: 10, replies: 5 }, related: [], replies: [],
  });
  const updated = [topic(2, true), topic(3, true), topic(4), topic(5), topic(6), topic(11)];
  f.intercept((url, init) => {
    if (url.endsWith('/topics/p1')) return response(discussion());
    if (url.endsWith('/topics/p1/feature') && init.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { on: false });
      if (!successful) return Response.json({ error: '这次精华操作被拒绝。' }, { status: 403 });
      featured = false;
      f.data.set('curated|1', listing(updated));
      return response({ ok: true });
    }
    return null;
  });
  await f.remount('#/post/p1');
  await f.click('[data-action="community-post-menu"]');
  assert.equal(f.main.querySelector<HTMLElement>('#community-post-menu')?.hidden, false);
  const feature = f.main.querySelector<HTMLButtonElement>('[data-action="community-feature"][data-id="p1"]');
  assert.ok(feature);
  assert.equal(feature.getAttribute('aria-pressed'), 'true');
  assert.equal(feature.querySelector('span')?.textContent, '取消精华');
  await f.click('[data-action="community-feature"][data-id="p1"]');
  const writes = f.calls.filter(call => call.url.endsWith('/topics/p1/feature') && call.init.method === 'POST');
  assert.equal(writes.length, 1, 'the actual management action submits once');
  assert.equal(f.main.querySelector('[data-action="community-feature"]')?.getAttribute('aria-pressed'), String(!successful));
  if (!successful) assert.ok(f.notices.includes('这次精华操作被拒绝。'));
  await f.remount('#/community/home');
  assert.equal(f.main.querySelector('[data-sort="newest"]')?.getAttribute('aria-pressed'), 'true');
  const before = f.calls.length;
  await f.sort('curated');
  const curatedReads = f.calls.slice(before).filter(call => call.url.startsWith('/api/community/topics?') && params(call.url).get('sort') === 'curated');
  if (successful) {
    assert.equal(curatedReads.length, 1, 'a confirmed feature decision retires the old accumulated cache and reads a new first page');
    assert.equal(params(curatedReads[0].url).get('page'), '1');
    assert.deepEqual(ids(f.main), updated.map(item => item.id));
    assert.equal(f.main.querySelector('.community-curated-row[data-topic-id="p1"]'), null, 'an old featured rank does not return from cached pages');
  } else {
    assert.equal(curatedReads.length, 0, 'a rejected write cannot discard the readable expanded cache');
    assert.deepEqual(ids(f.main), original);
  }
});

test('a successful real batch approval invalidates expanded curated cache so newly public posts are visible', async t => {
  const owner: CommunityMe = { ...reader, uid: 'owner', role: 'owner', owner: true, mod: true, management: { role: 'owner', browsingAsReader: false } };
  const f = await fixture(t, { viewer: owner });
  await f.more(); await f.sort('newest');
  let approved = false;
  const management = (): CommunityManage => ({
    owner: true, tab: 'queue', counts: { queue: approved ? 0 : 2, reports: 0, orders: 0, sanctions: 0 },
    kpis: { topics24h: 2, replies24h: 0 }, reports: [], orders: [], items: [], sanctions: [], data: null,
    queue: { topics: approved ? [] : [21, 22].map(id => ({ ...topic(id, true), pending: true, body: '待审核的实际帖子内容。', pendingReason: '需要审核', hiddenReason: null, canApprove: true })), replies: [] },
  });
  const updated = [topic(21, true), topic(22, true), topic(2, true), topic(3, true), topic(4), topic(5)];
  f.intercept((url, init) => {
    if (url.startsWith('/api/community/manage?')) return response(management());
    if (url.endsWith('/manage/review') && init.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { action: 'approve', ids: ['p21', 'p22'] });
      approved = true;
      f.data.set('curated|1', listing(updated));
      return response({ ok: true, count: 2 });
    }
    return null;
  });
  await f.remount('#/community/manage/queue');
  const all = f.main.querySelector<HTMLInputElement>('[data-community-review-all]');
  assert.ok(all); all.checked = true; all.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  assert.equal(f.main.querySelectorAll('[data-community-review-select]:checked').length, 2);
  assert.equal(f.main.querySelector<HTMLButtonElement>('[data-action="community-batch-approve"]')?.disabled, false);
  await f.click('[data-action="community-batch-approve"]');
  assert.equal(f.calls.filter(call => call.url.endsWith('/manage/review') && call.init.method === 'POST').length, 1);
  assert.ok(f.notices.includes('已通过 2 个帖子。'));
  assert.equal(f.main.querySelectorAll('[data-community-review-select]').length, 0);
  await f.remount('#/community/home');
  const before = f.calls.length;
  await f.sort('curated');
  const curatedReads = f.calls.slice(before).filter(call => call.url.startsWith('/api/community/topics?') && params(call.url).get('sort') === 'curated');
  assert.equal(curatedReads.length, 1, 'the confirmed bulk review changes the public listing and requires a fresh curated page');
  assert.deepEqual(ids(f.main), updated.map(item => item.id));
});

test('a curated search response started before a successful feature decision cannot repopulate retired cache when it arrives late', async t => {
  const moderator: CommunityMe = { ...reader, mod: true, moderationBoards: ['showcase'], management: { role: 'moderator', browsingAsReader: false } };
  const f = await fixture(t, { viewer: moderator }), oldRead = deferred<Response>(), freshRead = deferred<Response>();
  await f.more();
  let featured = true;
  const query = '缓存检查';
  const discussion = (): CommunityThread => ({
    topic: { ...initial[0], featured, body: '这是已发布且可管理的帖子正文。', images: [], canDelete: false, canFeature: true, canReply: true },
    author: { ...reader, topics: 10, replies: 5 }, related: [], replies: [],
  });
  f.intercept((url, init) => {
    if (url.endsWith('/topics/p1')) return response(discussion());
    if (url.endsWith('/topics/p1/feature') && init.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { on: false }); featured = false;
      return response({ ok: true });
    }
    if (url.startsWith('/api/community/topics?') && params(url).get('sort') === 'curated' && params(url).get('q') === query)
      return featured ? oldRead.promise : freshRead.promise;
    return null;
  });
  const search = f.main.querySelector<HTMLFormElement>('[data-community-form="search"]');
  const field = search?.querySelector<HTMLInputElement>('[name="q"]');
  assert.ok(search); assert.ok(field); field.value = query;
  search.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
  const old = f.calls.find(call => call.url.startsWith('/api/community/topics?') && params(call.url).get('sort') === 'curated' && params(call.url).get('q') === query);
  assert.ok(old, 'the actual search form starts a curated request before moderation');
  await f.sort('newest'); await f.remount('#/post/p1');
  await f.click('[data-action="community-post-menu"]'); await f.click('[data-action="community-feature"][data-id="p1"]');
  assert.equal(f.calls.filter(call => call.url.endsWith('/topics/p1/feature') && call.init.method === 'POST').length, 1);
  assert.equal(f.main.querySelector('[data-action="community-feature"]')?.getAttribute('aria-pressed'), 'false');
  assert.ok(f.calls.indexOf(old) < f.calls.findIndex(call => call.url.endsWith('/topics/p1/feature')));
  oldRead.resolve(response(listing(initial.map(item => ({ ...item, title: `迟到的旧精选-${item.id}` }))))); await flush();
  await f.remount('#/community/home'); await f.sort('curated');
  const selectedReads = f.calls.filter(call => call.url.startsWith('/api/community/topics?') && params(call.url).get('sort') === 'curated' && params(call.url).get('q') === query);
  assert.equal(selectedReads.length, 2, 'the current selection requests a fresh page rather than trusting the late result');
  assert.equal(f.main.querySelector('.community-results .community-curated-row'), null, 'retired ranked rows do not flash back while their replacement is pending');
  assert.doesNotMatch(f.main.querySelector('.community-results')?.textContent || '', /迟到的旧精选-/);
  const updated = [topic(2, true), topic(3, true), topic(4), topic(5), topic(6), topic(11)];
  freshRead.resolve(response(listing(updated))); await flush();
  assert.deepEqual(ids(f.main), updated.map(item => item.id));
  assert.doesNotMatch(f.main.querySelector('.community-results')?.textContent || '', /迟到的旧精选-/);
});
