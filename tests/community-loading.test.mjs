import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = data => ({ ok: true, json: async () => structuredClone(data) });
const person = { name: '读者', uid: '10001', role: 'reader', owner: false, agreed: true, unread: { all: 0 }, balance: 0, checkedIn: true, streak: 1, nextReward: { total: 5 } };
const summary = { total: 1, repliesToday: 0, checkinsToday: 0, boards: {}, tags: {}, hot: [] };
const listing = { items: [{ id: 'p1', board: 'qa', title: '可以立即阅读的讨论', author: person, createdAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-01T00:00:00Z', likes: 0, replies: 0 }], total: 1, page: 1, pageSize: 20 };
const slowSupport = (url, wait) => url.endsWith('/summary') ? wait.promise
  : url.startsWith('/api/community/banners') ? wait.promise.then(() => response({ scope: 'home', version: 1, items: [] })) : null;
const errorResponse = status => ({ ok: false, status, json: async () => ({ error: `读取失败 ${status}` }) });
const thread = { topic: { ...listing.items[0], body: '保留正在阅读的正文。', canReply: true, images: [], liked: false, bookmarked: false }, author: person, related: [], replies: [] };
async function setup(t, handle, { hash = '#/community/home', painted = () => {}, members = false } = {}) {
  const w = new JSDOM('<main></main>', { url: `http://localhost/${hash}`, pretendToBeVisual: true }).window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name]; w.scrollTo = () => {};
  const calls = [], request = async (url, init = {}) => {
    calls.push({ url, init }); const supplied = handle(url, init); if (supplied) return supplied;
    if (url.endsWith('/me')) return response(person);
    if (url.endsWith('/summary')) return response(summary);
    if (url.includes('/topics?')) return response(listing);
    if (url.endsWith('/topics/p1')) return response(thread);
    if (url.startsWith('/api/community/banners')) return response({ scope: 'home', version: 1, items: [] });
    throw Error(url);
  };
  const common = { t: zh => zh, esc: x => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'), icons: {}, members, painted };
  const ui = createCommunityUI({ request }), main = w.document.querySelector('main'); main.innerHTML = ui.html(common);
  let cleanup = ui.mount(main, common);
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });
  await settle();
  const retry = () => { const b = w.document.createElement('button'); b.dataset.action = 'community-retry'; main.append(b); b.click(); };
  const remount = async hash => { w.history.replaceState(null, '', hash); cleanup(); main.innerHTML = ui.html(common); cleanup = ui.mount(main, common); await settle(); };
  return { w, ui, main, calls, retry, remount, common };
}

test('ready community discussions paint while slow supporting summary and banners are still pending', async t => {
  const slow = deferred();
  const { main } = await setup(t, url => slowSupport(url, slow));
  assert.match(main.textContent, /可以立即阅读的讨论/);
  slow.resolve(response(summary)); await settle();
  assert.match(main.textContent, /可以立即阅读的讨论/);
});

for (const status of [401, 403]) test(`me ${status} removes ready protected content and controls before slow supporting reads finish`, async t => {
  const slow = deferred();
  const { main, ui } = await setup(t, url => {
    if (url.endsWith('/me')) return errorResponse(status);
    const support = slowSupport(url, slow); if (support) return support;
    return null;
  });
  assert.equal(main.querySelector('.community-topic'), null);
  assert.equal(main.querySelector('a[href="#/community/new"]'), null);
  assert.ok(main.querySelector(`[data-content-state="${status === 401 ? 'auth' : 'forbidden'}"]`));
  assert.equal(ui.me(), null);
  slow.resolve(response(summary)); await settle();
  assert.equal(main.querySelector('.community-topic'), null, 'late reads cannot restore rejected content');
});

test('a definite identity denial removes a previously readable post and its reply controls', async t => {
  let denied = false;
  const { main, ui, retry } = await setup(t, url => url.endsWith('/me') && denied ? errorResponse(401) : null, { hash: '#/post/p1' });
  assert.ok(main.querySelector('.community-thread'));
  assert.ok(main.querySelector('form[data-community-form="reply"]'));
  denied = true; retry(); await settle();
  assert.equal(main.querySelector('.community-thread'), null);
  assert.equal(main.querySelector('form[data-community-form="reply"]'), null);
  assert.ok(main.querySelector('[data-content-state="auth"]'));
  assert.equal(ui.me(), null);
});

test('identity service failure is visible without discarding the last confirmed account', async t => {
  let unavailable = false;
  const { main, ui, remount, common, w } = await setup(t, url => url.endsWith('/me') && unavailable ? errorResponse(503) : null);
  unavailable = true; await remount('#/post/p1');
  assert.ok(main.querySelector('[data-content-state="error"]'));
  assert.equal(main.querySelector('[data-content-state="not-open"]'), null);
  assert.match(main.textContent, /身份服务暂时不可用/);
  assert.doesNotMatch(main.textContent, /社区尚未开放/);
  assert.equal(main.querySelector('.community-topic'), null);
  assert.equal(main.querySelector('.community-thread'), null);
  assert.equal(main.querySelector('form[data-community-form="reply"]'), null);
  assert.equal(ui.me()?.uid, person.uid, '503 is not a sign-out response');
  const frame = w.document.createElement('template'); frame.innerHTML = ui.frameHTML(common);
  assert.ok(frame.content.querySelector('[data-content-state="error"]'));
  assert.equal(frame.content.querySelector('[data-content-state="not-open"]'), null);
  assert.match(frame.content.textContent, /身份服务暂时不可用/);
  assert.doesNotMatch(frame.content.textContent, /社区尚未开放/);
  assert.equal(frame.content.querySelector('.community-topic'), null);
  assert.equal(frame.content.querySelector('a.community-post'), null);
  assert.ok(frame.content.querySelector('button[data-action="community-retry"]'));
  const retry = main.querySelector('button[data-action="community-retry"]');
  assert.ok(retry, 'the actual error page offers its existing retry action');
  unavailable = false; retry.click(); await settle();
  assert.ok(main.querySelector('.community-thread'));
  assert.equal(main.querySelector('[data-content-state="error"]'), null);
  assert.equal(ui.me()?.uid, person.uid);
});

test('actual community closure keeps its existing 503 closed presentation', async t => {
  const { main, ui } = await setup(t, url => url.includes('/topics?') || url.endsWith('/summary') ? errorResponse(503) : null);
  assert.ok(main.querySelector('[data-content-state="not-open"]'));
  assert.match(main.textContent, /社区尚未开放/);
  assert.doesNotMatch(main.textContent, /身份服务暂时不可用/);
  assert.equal(ui.me()?.uid, person.uid);
});

test('the configured service closure response from me retains the genuine closed presentation', async t => {
  const { main, ui, common } = await setup(t, url => url.endsWith('/me')
    ? { ok: false, status: 503, json: async () => ({ error: '社区尚未开放。' }) } : null);
  assert.ok(main.querySelector('[data-content-state="not-open"]'));
  assert.match(main.textContent, /社区尚未开放/);
  assert.doesNotMatch(main.textContent, /身份服务暂时不可用/);
  assert.equal(main.querySelector('button[data-action="community-retry"]'), null);
  assert.match(ui.frameHTML(common), /data-content-state="not-open"/);
});

test('ready topics cannot paint until the current identity read succeeds', async t => {
  const identity = deferred();
  const { main } = await setup(t, url => url.endsWith('/me') ? identity.promise : null);
  assert.equal(main.querySelector('.community-topic'), null);
  identity.resolve(response(person)); await settle();
  assert.ok(main.querySelector('.community-topic'));
});

test('a new identity response wins over an older successful response in the same frame', async t => {
  const old = deferred(); let reads = 0;
  const { ui, retry } = await setup(t, url => {
    if (url.endsWith('/me')) return ++reads === 1 ? old.promise : response({ ...person, vip: false });
    return null;
  });
  retry(); await settle();
  assert.equal(ui.me()?.vip, false);
  old.resolve(response({ ...person, vip: true })); await settle();
  assert.equal(ui.me()?.vip, false);
});

test('old successful identity cannot undo a newer definite rejection', async t => {
  const old = deferred(); let reads = 0;
  const { ui, main, retry } = await setup(t, url => url.endsWith('/me') ? ++reads === 1 ? old.promise : errorResponse(403) : null);
  retry(); await settle();
  assert.ok(main.querySelector('[data-content-state="forbidden"]'));
  old.resolve(response(person)); await settle();
  assert.equal(ui.me(), null);
  assert.ok(main.querySelector('[data-content-state="forbidden"]'));
});

test('a newly confirmed different account discards old caches and ignores older identity reads', async t => {
  const old = deferred(); let reads = 0;
  const newReader = { ...person, uid: '10002', name: '新读者' };
  const { ui, retry } = await setup(t, url => {
    if (url.endsWith('/me')) return ++reads === 2 ? old.promise : response(reads >= 3 ? newReader : person);
    return null;
  });
  retry(); retry(); await settle();
  assert.equal(ui.me()?.uid, newReader.uid);
  old.resolve(response(person)); await settle();
  assert.equal(ui.me()?.uid, newReader.uid);
});

test('confirmed identity starts the protected daily receipt without waiting for summary or banners', async t => {
  const slow = deferred();
  const { calls, main } = await setup(t, url => {
    if (url.endsWith('/me')) return response({ ...person, growth: { configured: true, points: 0 } });
    const support = slowSupport(url, slow); if (support) return support;
    if (url.endsWith('/active/visit')) return response({ uid: person.uid, awarded: 20, visited: true, growth: { configured: true, points: 20 }, vipGrowth: null });
    return null;
  });
  assert.equal(calls.filter(x => x.url.endsWith('/active/visit')).length, 1);
  const visit = calls.find(x => x.url.endsWith('/active/visit'));
  assert.equal(visit.init.method, 'POST');
  assert.equal(visit.init.headers['X-Reader-Request'], '1');
  assert.deepEqual(JSON.parse(visit.init.body), {}, 'the server determines the daily award');
  assert.ok(main.querySelector('.community-topic'));
  slow.resolve(response(summary)); await settle();
});

for (const hash of ['#/community/home', '#/post/p1']) test(`supporting reads preserve readable core nodes and text selection on ${hash}`, async t => {
  const slowSummary = deferred(), slowBanners = deferred();
  const { main, w } = await setup(t, url => url.endsWith('/summary') ? slowSummary.promise : url.startsWith('/api/community/banners') ? slowBanners.promise : null, { hash });
  const selector = hash.endsWith('/home') ? '.community-topic-main h3 a' : '.community-text';
  const title = main.querySelector(selector), section = main.querySelector('[data-community]');
  assert.ok(title);
  const selection = w.getSelection(), range = w.document.createRange(); range.selectNodeContents(title); selection.addRange(range);
  const selected = selection.toString();
  slowSummary.resolve(response(summary)); await settle();
  slowBanners.resolve(response({ scope: 'home', version: 1, items: [] })); await settle();
  assert.equal(main.querySelector(selector), title);
  assert.equal(main.querySelector('[data-community]'), section);
  assert.equal(title.isConnected, true);
  assert.equal(selection.toString(), selected);
});

test('staged paints retain a promoted full community image on the same route and account', async t => {
  const imageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let revision = 0;
  const slow = deferred();
  const { main, retry } = await setup(t, url => {
    if (url.includes('/topics?')) return response({ ...listing, items: [{ ...listing.items[0], board: 'showcase', thumbs: [imageId], likes: revision }] });
    if (url.endsWith('/summary')) return slow.promise;
    return null;
  });
  const image = main.querySelector('.community-topic-thumbs img');
  assert.ok(image); image.src = `/api/community/images/${imageId}.webp`;
  slow.resolve(response(summary)); await settle();
  assert.equal(main.querySelector('.community-topic-thumbs img'), image);
  revision++; retry(); await settle();
  assert.equal(main.querySelector('.community-topic-thumbs img'), image);
  assert.equal(image.getAttribute('src'), `/api/community/images/${imageId}.webp`, 'a full image never reverts to its thumbnail');
});

test('explicit concurrent refreshes each reach the authority and a later refresh does not reuse completed identity', async t => {
  const slow = deferred(); let pending = true;
  const { calls, retry } = await setup(t, url => url.endsWith('/me') && pending ? slow.promise : null);
  retry(); retry(); await settle();
  assert.equal(calls.filter(x => x.url.endsWith('/me')).length, 3);
  pending = false; slow.resolve(response(person)); await settle();
  retry(); await settle();
  assert.equal(calls.filter(x => x.url.endsWith('/me')).length, 4, 'completed identity reads are never reused as an authorization cache');
});

test('a cleared identity cannot paint late ready discussions from the previous account', async t => {
  const slow = deferred();
  const { ui, main } = await setup(t, url => url.includes('/topics?') ? slow.promise : null);
  ui.clear(); main.innerHTML = '<section data-community="home">已切换账号</section>';
  slow.resolve(response(listing)); await settle();
  assert.equal(main.textContent, '已切换账号');
});

test('a failed identity network refresh keeps existing reading nodes but cannot display newly fetched content', async t => {
  let offline = false;
  const { main, ui, retry } = await setup(t, url => {
    if (offline && url.endsWith('/me')) return Promise.reject(Error('断网'));
    if (offline && url.includes('/topics?')) return response({ ...listing, items: [{ ...listing.items[0], title: '新一轮受保护内容' }] });
    return null;
  });
  const title = main.querySelector('.community-topic-main h3 a');
  offline = true; retry(); await settle();
  assert.equal(main.querySelector('.community-topic-main h3 a'), title);
  assert.doesNotMatch(main.textContent, /新一轮受保护内容/);
  assert.equal(ui.me()?.uid, person.uid);
});

test('a route return cannot expose cached controls until its own identity read confirms access', async t => {
  let held = false;
  const identity = deferred();
  const { main, remount } = await setup(t, url => held && url.endsWith('/me') ? identity.promise : null);
  await remount('#/post/p1');
  held = true;
  await remount('#/community/home');
  assert.equal(main.querySelector('.community-topic'), null);
  assert.equal(main.querySelector('a[href="#/community/new"]'), null);
  identity.resolve(errorResponse(403)); await settle();
  assert.ok(main.querySelector('[data-content-state="forbidden"]'));
});

test('a local list sort remains attached when previously pending supporting reads finish', async t => {
  const slow = deferred();
  const { main, w } = await setup(t, url => url.endsWith('/summary') ? slow.promise : null);
  main.querySelector('[data-action="community-sort"][data-sort="newest"]').click(); await settle();
  const title = main.querySelector('.community-topic-main h3 a');
  const range = w.document.createRange(); range.selectNodeContents(title); w.getSelection().removeAllRanges(); w.getSelection().addRange(range);
  assert.equal(w.getSelection().toString(), title.textContent);
  slow.resolve(response(summary)); await settle();
  assert.equal(main.querySelector('.community-topic-main h3 a'), title);
  assert.equal(w.getSelection().toString(), title.textContent);
  assert.equal(main.querySelector('[data-sort="newest"]').getAttribute('aria-pressed'), 'true');
});

test('protected full images are not reused across accounts, routes or external origins', async t => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let reader = person;
  const { main, ui, remount, retry } = await setup(t, url => {
    if (url.endsWith('/me')) return response(reader);
    if (url.includes('/topics?')) return response({ ...listing, items: [{ ...listing.items[0], board: 'showcase', thumbs: [id] }] });
    return null;
  });
  const first = main.querySelector('.community-topic-thumbs img'); first.src = `/api/community/images/${id}.webp`;
  reader = { ...person, uid: '10002' }; retry(); await settle();
  const second = main.querySelector('.community-topic-thumbs img');
  assert.notEqual(second, first); assert.equal(ui.me()?.uid, reader.uid);
  second.src = `https://other.example/api/community/images/${id}.webp`;
  // A same-route structural change forces the image matching path.
  main.querySelector('[data-action="community-sort"][data-sort="newest"]').click(); await settle();
  const third = main.querySelector('.community-topic-thumbs img');
  assert.notEqual(third, second); assert.equal(new URL(third.src).origin, 'http://localhost');
  await remount('#/post/p1'); await remount('#/community/home');
  assert.notEqual(main.querySelector('.community-topic-thumbs img'), third);
});

test('current me VIP loss overrides an old startup membership flag on the tea-room board', async t => {
  let vip = true;
  const { main, retry } = await setup(t, url => url.endsWith('/me') ? response({ ...person, vip }) : null, { hash: '#/community/boards/vip', members: true });
  assert.ok(main.querySelector('.community-topic'));
  vip = false; retry(); await settle();
  assert.equal(main.querySelector('.community-topic'), null);
  assert.equal(main.querySelector('a[href="#/community/new/vip"]'), null);
  assert.ok(main.querySelector('[data-content-state="members"]'));
});

test('same-account management withdrawal cannot expose an old ready management response', async t => {
  let mod = true;
  const manage = { owner: false, tab: 'queue', counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 1, replies24h: 2 }, queue: { topics: [], replies: [] }, reports: [], content: [], items: [], orders: [], sanctions: [], data: null };
  const { main, ui, retry } = await setup(t, url => {
    if (url.endsWith('/me')) return response({ ...person, mod, management: mod ? { role: 'steward', browsingAsReader: false } : null });
    if (url.includes('/manage?')) return response(manage);
    return null;
  }, { hash: '#/community/manage' });
  assert.ok(main.querySelector('a[data-community-management-switch]'));
  mod = false; retry(); await settle();
  assert.equal(ui.me()?.mod, false);
  assert.equal(main.querySelector('a[data-community-management-switch]'), null);
  assert.ok(main.querySelector('[data-content-state="forbidden"]'));
});
