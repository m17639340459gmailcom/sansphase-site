import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';
import { createStableCommunityFrame } from '../src/community-layout/stable-frame.ts';

const flush = async () => { for (let i = 0; i < 12; i++) await setImmediate(); };
const until = async check => { const end = performance.now() + 3000; while (!check()) { assert.ok(performance.now() < end, 'observable operation settles within 3s'); await flush(); } };
const wait = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = data => ({ ok: true, json: async () => structuredClone(data) });
const failure = status => ({ ok: false, status, json: async () => ({ error: `服务错误${status}` }) });
const person = { name: '读者', uid: '10001', role: 'reader', owner: false, vip: true, agreed: true, unread: { all: 0 }, balance: 0, checkedIn: true, streak: 1, nextReward: { total: 5 } };
const summary = { total: 1, repliesToday: 0, checkinsToday: 0, boards: {}, tags: {}, hot: [] };
const topic = { id: 'p1', board: 'qa', title: '原讨论', author: person, createdAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-01T00:00:00Z', likes: 0, replies: 0 };
const listing = { items: [topic], total: 2, page: 1, pageSize: 1 };
const thread = { topic: { ...topic, body: '正在阅读的正文', canReply: true, images: [], liked: false, bookmarked: false }, author: person, related: [], replies: [] };
const passive = init => new Headers(init.headers).get('X-Community-Passive') === '1';

test('active nested scrolling cancels a pending passive repaint without changing the reading DOM', async t => {
  const slow = wait();
  const { w, main, tick } = await setup(t, (url, init) => {
    if (!passive(init)) return null;
    if (url.endsWith('/summary')) return slow.promise;
    if (url.includes('/topics?')) return response({ ...listing, items: [{ ...topic, title: '后台更新' }] });
    return null;
  });
  const content = main.querySelector('.community-main');
  await tick(15000);
  content.dispatchEvent(new w.Event('scroll'));
  slow.resolve(response({ ...summary, total: 88 }));
  await flush();
  assert.equal(main.querySelector('.community-main'), content, 'an in-flight background response cannot replace content while it is being scrolled');
});

test('clicking one notification marks only it read, updates the bell and locates the reply after rendering', async t => {
  let read = false;
  const notices = [{ id: 'n1', type: 'reply', topicId: 'p1', replyId: 'r2', actor: person, text: '回复了你的主题', data: {}, link: null, count: 1, createdAt: topic.createdAt, read: false, topicTitle: topic.title }];
  const reply = { id: 'r2', body: '目标回复', author: person, createdAt: topic.createdAt, likes: 0 };
  const { w, main, ui, calls, remount, frame } = await setup(t, (url, init) => {
    if (url.endsWith('/inbox/read')) { assert.deepEqual(JSON.parse(init.body), { id: 'n1' }); read = true; return response({ ok: true }); }
    if (url.endsWith('/me')) return response({ ...person, unread: { all: read ? 1 : 2, reply: read ? 1 : 2, thanks: 0, system: 0 } });
    if (url.includes('/inbox?')) return response({ tab: 'all', items: notices, unread: { all: 2, reply: 2 } });
    if (url.endsWith('/topics/p1')) return response({ ...thread, replies: [reply] });
    return null;
  }, '#/community/inbox', { frame: true });
  assert.equal(read, false, 'opening the inbox must not mark unseen messages read');
  main.querySelector('[data-action="community-notice"]').click();
  await until(() => w.location.hash === '#/post/p1/reply/r2');
  assert.equal(ui.me().unread.all, 1);
  assert.equal(calls.filter(call => call.url.endsWith('/inbox/read')).length, 1);
  assert.equal(calls.some(call => call.url.endsWith('/inbox/read-all')), false);
  const located = [];
  w.HTMLElement.prototype.scrollIntoView = function () { located.push(this.id); frame.center().scrollTop = 950; };
  await remount(w.location.hash);
  await until(() => located.length > 0);
  assert.deepEqual(located, ['reply-r2']);
  assert.equal(w.document.activeElement.id, 'reply-r2');
  await new Promise(resolve => w.requestAnimationFrame(resolve));
  assert.equal(frame.center().scrollTop, 950, 'the frame must retain the located reply after all restoration callbacks finish');
});

test('a failed notification read keeps its unread state and offers a retry without navigating', async t => {
  const { w, main } = await setup(t, url => {
    if (url.endsWith('/inbox/read')) return failure(503);
    if (url.includes('/inbox?')) return response({ tab: 'all', unread: { all: 1 }, items: [{ id: 'n1', type: 'reply', topicId: 'p1', replyId: 'r2', actor: person, data: {}, read: false, createdAt: topic.createdAt }] });
    return null;
  }, '#/community/inbox');
  const button = main.querySelector('[data-action="community-notice"]');
  button.click(); await flush();
  assert.equal(w.location.hash, '#/community/inbox');
  assert.equal(button.disabled, false);
  assert.ok(button.classList.contains('is-unread'));
});

test('post image zoom uses the original, pauses background repaint and closes on leaving or clearing the account', async t => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { w, main, ui, tick, calls, remount } = await setup(t, url => url.endsWith('/topics/p1')
    ? response({ ...thread, topic: { ...thread.topic, images: [{ id, width: 1200, height: 3600 }] } }) : null, '#/post/p1');
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  main.querySelector('[data-action="community-lightbox"]').click();
  assert.equal(w.document.querySelector('dialog img').getAttribute('src'), `/api/community/images/${id}.webp`);
  await tick(15000);
  assert.equal(calls.filter(call => passive(call.init)).length, 0);
  await remount('#/community/home');
  assert.equal(w.document.querySelector('dialog'), null);
  await remount('#/post/p1');
  main.querySelector('[data-action="community-lightbox"]').click();
  ui.clear();
  assert.equal(w.document.querySelector('dialog'), null);
});
async function setup(t, handle = () => null, hash = '#/community/home', { frame: framed = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 7) });
  const w = new JSDOM('<main></main>', { url: `http://localhost/${hash}`, pretendToBeVisual: true }).window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  w.scrollTo = () => {};
  const calls = [], request = async (url, init = {}) => {
    calls.push({ url, init }); const supplied = handle(url, init); if (supplied) return supplied;
    if (url.endsWith('/me')) return response(person);
    if (url.endsWith('/summary')) return response(summary);
    if (url.includes('/topics?')) return response(listing);
    if (url.endsWith('/topics/p1')) return response(thread);
    if (url.startsWith('/api/community/banners')) return response({ scope: 'home', version: 1, items: [] });
    throw Error(url);
  };
  const common = { t: zh => zh, esc: x => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'), icons: {}, members: true };
  const ui = createCommunityUI({ request }), main = w.document.querySelector('main');
  const frame = framed ? createStableCommunityFrame(w.document, w, request) : null;
  if (frame) { common.painted = () => frame.sync(ui.frameHTML(common)); common.beforePaint = () => frame.preserveReadingPosition(); }
  if (!frame?.render(main, ui.html(common), ui.frameHTML(common))) main.innerHTML = ui.html(common);
  let cleanup = ui.mount(main, common); await flush();
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });
  const tick = async ms => { t.mock.timers.tick(ms); await flush(); };
  const remount = async hash => { w.history.replaceState(null, '', hash); cleanup(); if (!frame?.render(main, ui.html(common), ui.frameHTML(common))) main.innerHTML = ui.html(common); cleanup = ui.mount(main, common); await flush(); };
  return { w, ui, main, calls, tick, remount, common, frame };
}

test('visible idle pages passively stage me, current data and summary without active visit or loading flash', async t => {
  const slowSummary = wait(); let updated = false;
  const { main, calls, tick } = await setup(t, (url, init) => {
    if (!passive(init)) return null;
    if (url.endsWith('/me')) return response({ ...person, balance: 15 });
    if (url.endsWith('/summary')) return slowSummary.promise;
    if (url.includes('/topics?')) return response({ ...listing, items: [{ ...topic, title: '最新讨论' }] });
    return null;
  });
  const old = main.querySelector('.community-topic');
  await tick(15000);
  assert.equal(calls.filter(x => passive(x.init)).length, 3);
  assert.equal(main.querySelector('.community-topic'), old);
  assert.match(main.textContent, /原讨论/);
  assert.doesNotMatch(main.textContent, /正在读取/);
  slowSummary.resolve(response(summary)); await flush(); updated = true;
  assert.match(main.textContent, /最新讨论/);
  assert.equal(calls.some(x => x.url.endsWith('/active/visit')), false);
  for (const call of calls.filter(x => passive(x.init))) assert.ok(call.init.signal);
  assert.equal(updated, true);
});

test('unchanged passive DTOs keep core DOM, images and reading position', async t => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { main, tick, w } = await setup(t, url => url.endsWith('/topics/p1') ? response({ ...thread, topic: { ...thread.topic, images: [{ id, url: `/api/community/images/${id}.webp` }] } }) : null, '#/post/p1');
  const core = main.querySelector('.community-text'), image = main.querySelector(`img[src*="${id}"]`);
  assert.ok(image);
  let scrolls = 0; w.scrollTo = () => { scrolls++; };
  await tick(15000);
  assert.equal(main.querySelector('.community-text'), core); assert.equal(main.querySelector(`img[src*="${id}"]`), image);
  assert.equal(scrolls, 0);
});

for (const blocker of ['focus', 'draft', 'selection', 'composition', 'upload']) test(`passive reads pause for ${blocker} and never overwrite it`, async t => {
  const { main, calls, tick, w } = await setup(t, () => null, '#/post/p1');
  const field = main.querySelector('textarea[name="body"]');
  if (blocker === 'focus') field.focus();
  if (blocker === 'draft') { field.value = '未发送草稿'; field.dispatchEvent(new w.Event('input', { bubbles: true })); }
  if (blocker === 'selection') { const range = w.document.createRange(); range.selectNodeContents(main.querySelector('.community-text')); w.getSelection().addRange(range); }
  if (blocker === 'composition') field.dispatchEvent(new w.Event('compositionstart', { bubbles: true }));
  if (blocker === 'upload') main.querySelector('form').dataset.uploading = 'true';
  await tick(15000);
  assert.equal(calls.some(x => passive(x.init)), false);
  assert.equal(main.contains(field), true);
});

test('interaction that begins after a passive batch started prevents applying its late DTOs', async t => {
  const slow = wait();
  const { main, tick, w } = await setup(t, (url, init) => passive(init) && url.includes('/topics?') ? slow.promise : null);
  await tick(15000);
  const core = main.querySelector('.community-topic-main h3 a');
  const range = w.document.createRange(); range.selectNodeContents(core); w.getSelection().addRange(range);
  slow.resolve(response({ ...listing, items: [{ ...topic, title: '不能覆盖选区' }] })); await flush();
  assert.equal(main.querySelector('.community-topic-main h3 a'), core);
  assert.equal(w.getSelection().toString(), '原讨论');
});

for (const status of [401, 403, 503]) test(`passive ${status} ${status === 503 ? 'keeps the confirmed page' : 'retires all protected data'}`, async t => {
  const { main, ui, tick } = await setup(t, (url, init) => passive(init) && url.endsWith('/me') ? failure(status) : null);
  const core = main.querySelector('.community-topic'); await tick(15000);
  if (status === 503) { assert.equal(main.querySelector('.community-topic'), core); assert.equal(ui.me().uid, person.uid); }
  else { assert.equal(main.querySelector('.community-topic'), null); assert.equal(ui.me(), null); assert.ok(main.querySelector(`[data-content-state="${status === 401 ? 'auth' : 'forbidden'}"]`)); }
});

test('navigation and identity clear abort old batches whose late response cannot restore an old account', async t => {
  const slow = wait();
  const { main, ui, calls, tick, remount } = await setup(t, (url, init) => passive(init) && url.endsWith('/me') ? slow.promise : null);
  await tick(15000);
  const signal = calls.find(x => passive(x.init)).init.signal;
  await remount('#/post/p1'); assert.equal(signal.aborted, true);
  slow.resolve(response({ ...person, uid: '99999' })); await flush();
  assert.equal(ui.me().uid, person.uid); assert.ok(main.querySelector('.community-thread'));
  ui.clear(); await tick(30000); assert.equal(ui.me(), null);
});

test('multi-page lists only refresh side data and never truncate loaded pages', async t => {
  const { main, calls, tick, w } = await setup(t, url => url.includes('/topics?') && url.includes('page=2') ? response({ ...listing, page: 2, items: [{ ...topic, id: 'p2', title: '第二页' }] }) : null);
  let selectionSettled = false;
  w.document.addEventListener('selectionchange', () => { selectionSettled = true; }, { once: true });
  main.querySelector('[data-action="community-more"]').click(); await flush();
  w.document.activeElement?.blur(); await flush();
  // JSDOM queues selectionchange from focus/blur on setTimeout(0). Drain those
  // events before advancing the passive clock, so their invalidation starts now.
  await tick(0); assert.equal(selectionSettled, true);
  await tick(15000);
  assert.match(main.textContent, /第二页/);
  assert.equal(calls.filter(x => passive(x.init) && x.url.includes('/topics?')).length, 0);
  assert.equal(calls.filter(x => passive(x.init) && x.url.endsWith('/summary')).length, 1, JSON.stringify(calls.map(x => [x.url, passive(x.init)])));
});

test('a foreground write cancels old passive counts and pauses until its related reads complete', async t => {
  const slow = wait(), ownMe = wait(); let submitted = false;
  const { main, calls, tick } = await setup(t, (url, init) => {
    if (passive(init) && url.endsWith('/topics/p1')) return slow.promise;
    if (url.endsWith('/topics/p1/like')) { submitted = true; return response({ likes: 1 }); }
    if (submitted && !passive(init) && url.endsWith('/me')) return ownMe.promise;
    return null;
  }, '#/post/p1');
  await tick(15000);
  const signal = calls.find(x => passive(x.init)).init.signal;
  main.querySelector('[data-action="community-like"]').click(); await flush();
  assert.equal(signal.aborted, true);
  const count = calls.filter(x => passive(x.init)).length;
  await tick(30000); assert.equal(calls.filter(x => passive(x.init)).length, count);
  slow.resolve(response({ ...thread, topic: { ...thread.topic, likes: 0 } }));
  ownMe.resolve(response(person)); await flush();
  assert.equal(calls.filter(x => x.init.method === 'POST' && x.url.endsWith('/like')).length, 1);
  assert.ok(calls.some(x => !passive(x.init) && x.url.endsWith('/summary')));
});

test('permission shrink retires the old VIP pixels immediately and retries scoped reads after an outage', async t => {
  let outage = true;
  const { main, ui, calls, tick } = await setup(t, (url, init) => {
    if (!passive(init)) return null;
    if (url.endsWith('/me')) return response({ ...person, vip: false });
    if (url.endsWith('/summary') && outage) return failure(503);
    return null;
  }, '#/community/boards/vip');
  assert.ok(main.querySelector('.community-topic'));
  await tick(15000);
  assert.equal(main.querySelector('.community-topic'), null, 'old private pixels retire before support succeeds');
  assert.equal(ui.me().vip, false);
  outage = false; await tick(15000);
  assert.equal(calls.filter(x => passive(x.init) && x.url.endsWith('/me')).length, 2);
  assert.equal(main.querySelector('.community-topic'), null);
  assert.match(main.textContent, /VIP/);
  assert.equal(calls.filter(x => passive(x.init) && x.url.includes('board=vip')).length, 0);
  assert.equal(calls.some(x => x.url.endsWith('/active/visit')), false);
});

test('a newly detected account drops old pixels then reads only passive resources for its own account', async t => {
  const { main, ui, tick, calls } = await setup(t, (url, init) => {
    if (!passive(init)) return null;
    if (url.endsWith('/me')) return response({ ...person, uid: '10002', name: '第二账号' });
    if (url.includes('/topics?')) return response({ ...listing, items: [{ ...topic, title: '第二账号的范围' }] });
    return null;
  });
  await tick(15000);
  assert.equal(ui.me().uid, '10002'); assert.match(main.textContent, /第二账号的范围/);
  assert.equal(calls.filter(x => x.url.endsWith('/me') && !passive(x.init)).length, 1);
  assert.equal(calls.some(x => x.url.endsWith('/active/visit')), false);
});

test('a newer foreground refresh supersedes already staged passive data in the same route', async t => {
  const slow = wait(); let foreground = false;
  const { main, calls, tick, w } = await setup(t, (url, init) => {
    if (passive(init) && url.includes('/topics?')) return slow.promise;
    if (!passive(init) && foreground && url.includes('/topics?')) return response({ ...listing, items: [{ ...topic, title: '主动最新结果' }] });
    return null;
  });
  await tick(15000); foreground = true;
  const retry = w.document.createElement('button'); retry.dataset.action = 'community-retry'; main.append(retry); retry.click(); await flush();
  assert.equal(calls.find(x => passive(x.init)).init.signal.aborted, true);
  slow.resolve(response({ ...listing, items: [{ ...topic, title: '过时后台结果' }] })); await flush();
  assert.match(main.textContent, /主动最新结果/); assert.doesNotMatch(main.textContent, /过时后台结果/);
});

test('own reply is committed once and immediately synchronizes me, summary and the current thread', async t => {
  let saved = false;
  const { main, ui, w, calls } = await setup(t, (url, init) => {
    if (url.endsWith('/topics/p1/replies') && init.method === 'POST') { saved = true; return response({ id: 'r1', earned: 1 }); }
    if (saved && url.endsWith('/me')) return response({ ...person, balance: 1 });
    if (saved && url.endsWith('/topics/p1')) return response({ ...thread, replies: [{ id: 'r1', author: person, body: '成功的新回复', createdAt: topic.createdAt, likes: 0 }] });
    return null;
  }, '#/post/p1');
  const form = main.querySelector('form[data-community-form="reply"]'); form.elements.namedItem('body').value = '成功的新回复';
  const priorSummary = calls.filter(x => x.url.endsWith('/summary')).length;
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => main.textContent.includes('成功的新回复') && ui.me()?.balance === 1);
  assert.equal(calls.filter(x => x.url.endsWith('/replies') && x.init.method === 'POST').length, 1);
  assert.equal(calls.filter(x => x.url.endsWith('/summary')).length, priorSummary + 1);
});

test('successful own reply followed by failed reads cannot display a sending failure or send it again', async t => {
  let saved = false;
  const { main, w, calls } = await setup(t, (url, init) => {
    if (url.endsWith('/topics/p1/replies') && init.method === 'POST') { saved = true; return response({ id: 'r1', earned: 1 }); }
    if (saved && (url.endsWith('/topics/p1') || url.endsWith('/me') || url.endsWith('/summary'))) return failure(503);
    return null;
  }, '#/post/p1');
  const form = main.querySelector('form[data-community-form="reply"]'); form.elements.namedItem('body').value = '已成功的回复';
  const priorSummary = calls.filter(x => x.url.endsWith('/summary')).length;
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => saved && calls.filter(x => x.url.endsWith('/summary')).length === priorSummary + 1); await flush();
  assert.equal(calls.filter(x => x.url.endsWith('/replies') && x.init.method === 'POST').length, 1);
  assert.equal(form.elements.namedItem('body').value, '');
  assert.doesNotMatch(form.querySelector('.community-form-status').textContent, /失败|服务错误/);
});

test('check-in on its own calendar page also immediately refreshes summary', async t => {
  let saved = false;
  const calendar = () => ({ checkedIn: saved, streak: 1, balance: 5, gainedToday: 0, behaviourToday: 0, vip: true, month: '2026-10', days: [], checkinsToday: 0, earlyBirds: [], badges: [], makeup: { used: 0, allowed: 2, left: 2, cards: 0, cost: 30, days: [] } });
  const { main, ui, calls } = await setup(t, (url, init) => {
    if (url.endsWith('/me')) return response({ ...person, checkedIn: saved });
    if (url.endsWith('/checkin') && init.method === 'POST') { saved = true; return response({ reward: 5, bonus: 0, streak: 1 }); }
    if (url.endsWith('/checkin')) return response(calendar());
    return null;
  }, '#/community/checkin', { frame: true });
  const priorSummary = calls.filter(x => x.url.endsWith('/summary')).length;
  main.querySelector('[data-action="community-checkin"]').click(); await flush();
  assert.equal(ui.me().checkedIn, true);
  assert.equal(calls.filter(x => x.url.endsWith('/summary')).length, priorSummary + 1);
  assert.equal(calls.filter(x => x.url.endsWith('/checkin') && x.init.method === 'POST').length, 1);
});

test('hidden pages stop and resume one passive batch; a cleared UI stops its timer', async t => {
  const { w, ui, calls, tick } = await setup(t);
  let hidden = true;
  Object.defineProperty(w.document, 'hidden', { get: () => hidden });
  Object.defineProperty(w.document, 'visibilityState', { get: () => hidden ? 'hidden' : 'visible' });
  w.document.dispatchEvent(new w.Event('visibilitychange')); await tick(60000);
  assert.equal(calls.some(x => passive(x.init)), false);
  hidden = false; w.document.dispatchEvent(new w.Event('visibilitychange')); await tick(1000);
  assert.equal(calls.filter(x => passive(x.init) && x.url.endsWith('/me')).length, 1);
  ui.clear(); const count = calls.length; await tick(60000); assert.equal(calls.length, count);
});

for (const status of [403, 404, 410]) test(`passive topic ${status} retires only that old body and images while keeping the confirmed login`, async t => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { main, ui, tick } = await setup(t, (url, init) => url.endsWith('/topics/p1')
    ? passive(init) ? failure(status) : response({ ...thread, topic: { ...thread.topic, images: [{ id, url: `/api/community/images/${id}.webp` }] } }) : null, '#/post/p1');
  assert.match(main.textContent, /正在阅读的正文/); assert.ok(main.querySelector(`img[src*="${id}"]`));
  await tick(15000);
  assert.equal(main.querySelector('.community-thread'), null); assert.equal(main.querySelector(`img[src*="${id}"]`), null);
  assert.doesNotMatch(main.textContent, /正在阅读的正文/);
  assert.equal(ui.me().uid, person.uid);
});

test('passive resource 401 retires the entire expired session', async t => {
  const { main, ui, tick } = await setup(t, (url, init) => passive(init) && url.endsWith('/topics/p1') ? failure(401) : null, '#/post/p1');
  await tick(15000); assert.equal(ui.me(), null); assert.equal(main.querySelector('.community-thread'), null);
  assert.ok(main.querySelector('[data-content-state="auth"]'));
});

test('a definite hidden thread retires immediately even when its passive summary cannot settle', async t => {
  const slow = wait();
  const { main, ui, tick, calls } = await setup(t, (url, init) => {
    if (!passive(init)) return null;
    if (url.endsWith('/topics/p1')) return failure(403);
    if (url.endsWith('/summary')) return slow.promise;
    return null;
  }, '#/post/p1');
  await tick(15000);
  assert.equal(main.querySelector('.community-thread'), null);
  assert.equal(ui.me().uid, person.uid);
  assert.equal(calls.find(x => passive(x.init)).init.signal.aborted, false);
  await tick(10000);
  assert.equal(calls.find(x => passive(x.init)).init.signal.aborted, true, 'support is still owned by the batch timeout');
  slow.resolve(failure(503)); await flush();
  assert.equal(main.querySelector('.community-thread'), null);
});

test('core denial cannot mask simultaneous support outages or reset their growing backoff', async t => {
  const { main, ui, tick, calls } = await setup(t, (url, init) => {
    if (!passive(init)) return null;
    if (url.endsWith('/topics/p1')) return failure(404);
    if (url.endsWith('/summary')) return failure(503);
    return null;
  }, '#/post/p1');
  await tick(15000); assert.equal(main.querySelector('.community-thread'), null); assert.equal(ui.me().uid, person.uid);
  await tick(15000);
  const count = calls.filter(x => passive(x.init) && x.url.endsWith('/me')).length;
  assert.equal(count, 2);
  await tick(15000); assert.equal(calls.filter(x => passive(x.init) && x.url.endsWith('/me')).length, count);
  await tick(15000); assert.equal(calls.filter(x => passive(x.init) && x.url.endsWith('/me')).length, count + 1);
});

test('an old route supporting read neither blocks the new route nor overwrites its newer passive summary', async t => {
  const old = wait(); let normalSummaries = 0;
  const { main, ui, tick, remount, common, calls } = await setup(t, (url, init) => {
    if (url.endsWith('/summary') && !passive(init) && ++normalSummaries === 1) return old.promise;
    if (url.endsWith('/summary') && passive(init)) return response({ ...summary, hot: [{ ...topic, title: '后台最新热帖' }] });
    return null;
  });
  await remount('#/post/p1'); assert.ok(main.querySelector('.community-thread'));
  await tick(15000);
  assert.equal(calls.filter(x => passive(x.init) && x.url.endsWith('/me')).length, 1);
  assert.match(ui.frameHTML(common), /后台最新热帖/);
  old.resolve(response({ ...summary, hot: [{ ...topic, title: '旧页面过时热帖' }] })); await flush();
  assert.match(ui.frameHTML(common), /后台最新热帖/);
  assert.doesNotMatch(ui.frameHTML(common), /旧页面过时热帖/);
});

test('the existing custom select trigger and its body portal pause passive repaint while choosing', async t => {
  const { main, w, tick, calls } = await setup(t);
  const trigger = w.document.createElement('button'); trigger.className = 'community-select-trigger'; trigger.setAttribute('role', 'combobox'); trigger.dataset.state = 'open'; main.append(trigger);
  const menu = w.document.createElement('div'); menu.className = 'community-select-menu'; menu.setAttribute('role', 'listbox'); w.document.body.append(menu);
  trigger.focus(); await tick(0); await tick(15000);
  assert.equal(calls.some(x => passive(x.init)), false); assert.equal(main.contains(trigger), true);
  menu.remove(); trigger.dataset.state = 'closed'; trigger.blur(); await tick(0); await tick(15000);
  assert.equal(calls.filter(x => passive(x.init) && x.url.endsWith('/me')).length, 1);
});

test('passive polling never repeats the real entrance reward even for a configured growth account', async t => {
  const growth = { level: 1, configured: true, points: 0, startThreshold: 0, nextThreshold: 1000, remaining: 1000, progress: 0 };
  const { calls, tick } = await setup(t, url => {
    if (url.endsWith('/me')) return response({ ...person, growth });
    if (url.endsWith('/active/visit')) return response({ uid: person.uid, visited: true, awarded: 0, growth, vipGrowth: null });
    return null;
  });
  assert.equal(calls.filter(x => x.url.endsWith('/active/visit')).length, 1);
  await tick(15000); await tick(15000);
  assert.equal(calls.filter(x => x.url.endsWith('/active/visit')).length, 1);
  assert.equal(calls.filter(x => passive(x.init) && x.url.endsWith('/me')).length, 2);
});

test('ordinary management updates passively while an open real product form pauses that page', async t => {
  const owner = { ...person, uid: 'owner', role: 'owner', owner: true, mod: true, management: { role: 'owner', browsingAsReader: false } };
  const management = { owner: true, tab: 'items', counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 1, replies24h: 0 }, queue: { topics: [], replies: [] }, reports: [], content: [], items: [], orders: [], sanctions: [], data: null };
  const { main, tick, calls, remount } = await setup(t, url => url.endsWith('/me') ? response(owner) : url.includes('/manage?') ? response({ ...management, tab: new URL(url, 'http://localhost').searchParams.get('tab') }) : null, '#/community/manage/queue');
  await tick(15000); assert.equal(calls.filter(x => passive(x.init) && x.url.includes('/manage?')).length, 1);
  await remount('#/community/manage/items');
  main.querySelector('[data-action="community-item-edit"]').click(); await flush();
  assert.ok(main.querySelector('form[data-community-form="item"]'));
  const count = calls.filter(x => passive(x.init)).length; await tick(15000);
  assert.equal(calls.filter(x => passive(x.init)).length, count);
});
