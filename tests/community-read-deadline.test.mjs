import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';

const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = data => ({ ok: true, json: async () => structuredClone(data) });
const person = { name: '读取回归读者', uid: '10001', role: 'reader', owner: false, agreed: true,
  unread: { all: 0 }, balance: 0, checkedIn: true, streak: 1, nextReward: { total: 1 } };
const topic = id => ({ id, board: 'qa', title: `读取回归-${id}`, author: person, createdAt: '2026-10-01T00:00:00Z', likes: 0, replies: 0 });
const thread = id => ({ topic: { ...topic(id), body: `正文-${id}`, canReply: true, images: [], liked: false, bookmarked: false },
  author: person, related: [], replies: [] });

async function setup(t, handle = () => null) {
  const w = new JSDOM('<main></main>', { url: 'http://localhost/#/post/p1', pretendToBeVisual: true }).window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement',
    'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  w.scrollTo = () => {};
  // Fire the real controller's ten-second deadline explicitly, without a slow
  // suite or a fake Promise implementation. Other timers keep their behavior.
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map();
  globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = originalSet(callback, delay, ...args);
    timers.set(timer, { callback, delay, args }); return timer;
  };
  globalThis.clearTimeout = timer => { timers.delete(timer); originalClear(timer); };
  const fire = delay => {
    for (const [timer, work] of [...timers]) if (work.delay === delay) {
      timers.delete(timer); originalClear(timer); work.callback(...work.args);
    }
  };
  const calls = [], notices = [];
  const request = async (url, init = {}) => {
    calls.push({ url, init }); const supplied = handle(url, init); if (supplied) return supplied;
    if (url.endsWith('/me')) return response(person);
    if (url.endsWith('/summary')) return response({ total: 1, boards: {}, hot: [] });
    if (url.includes('/topics?')) return response({ items: [topic('p1')], total: 1, page: 1, pageSize: 20 });
    const id = /^\/api\/community\/topics\/([^/]+)$/.exec(url)?.[1];
    if (id) return response(thread(id));
    if (init.method === 'POST') return response({ ok: true });
    throw Error(url);
  };
  const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    icons: {}, notify: message => notices.push(message) };
  const ui = createCommunityUI({ request }), main = w.document.querySelector('main');
  let cleanup = () => {};
  const enter = async hash => {
    w.history.replaceState(null, '', hash); cleanup(); main.innerHTML = ui.html(common); cleanup = ui.mount(main, common); await flush();
  };
  t.after(() => {
    cleanup(); ui.clear();
    for (const timer of timers.keys()) originalClear(timer);
    globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
    w.close();
    for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
  });
  await enter('#/post/p1');
  assert.match(main.textContent, /正文-p1/);
  return { w, main, ui, calls, notices, enter, fire, deadlines: () => [...timers.values()].filter(timer => timer.delay === 10000).length };
}

test('a hung identity GET leaves its route handoff with an error and can retry without signing out', async t => {
  const hold = deferred(); let hanging = false;
  const f = await setup(t, url => hanging && url.endsWith('/me') ? hold.promise : null);
  hanging = true; await f.enter('#/post/p2');
  assert.ok(f.main.querySelector('[data-community-pending-route][inert]'));
  f.fire(10000); await flush();
  assert.equal(f.main.querySelector('[data-community-pending-route]'), null, 'a read deadline releases the old inert pane');
  assert.ok(f.main.querySelector('[data-content-state="error"]'));
  assert.equal(f.ui.me()?.uid, person.uid, 'timeout is not an account denial');
  assert.equal(f.calls.at(-1).init.signal.aborted, true);
  hanging = false; f.main.querySelector('[data-action="community-retry"]').click(); await flush();
  assert.match(f.main.textContent, /正文-p2/);
  hold.resolve(response({ ...person, name: '晚到的旧身份' })); await flush();
  assert.equal(f.ui.me()?.name, person.name);
  assert.equal(f.deadlines(), 0, 'settled reads dispose their timers');
});

for (const phase of ['request', 'json']) test(`a hung core GET ${phase} phase releases the pane, supports retry and ignores late old content`, async t => {
  const hold = deferred(); let hanging = true;
  const f = await setup(t, url => url.endsWith('/topics/p2') && hanging
    ? phase === 'request' ? hold.promise : { ok: true, json: () => hold.promise } : null);
  await f.enter('#/post/p2');
  assert.ok(f.main.querySelector('[data-community-pending-route][inert]'));
  const core = f.calls.find(call => call.url.endsWith('/topics/p2'));
  f.fire(10000); await flush();
  assert.equal(f.main.querySelector('[data-community-pending-route]'), null);
  assert.ok(f.main.querySelector('[data-content-state="error"]'));
  assert.equal(core.init.signal.aborted, true);
  hanging = false; f.main.querySelector('[data-action="community-retry"]').click(); await flush();
  assert.match(f.main.textContent, /正文-p2/);
  const late = { ...thread('p2'), topic: { ...thread('p2').topic, body: '旧请求迟到的正文' } };
  hold.resolve(phase === 'request' ? response(late) : late); await flush();
  assert.doesNotMatch(f.main.textContent, /旧请求迟到的正文/);
  assert.equal(f.deadlines(), 0);
});

test('a delayed POST remains owned by the existing writer and is never timed out or resent by read deadlines', async t => {
  const hold = deferred();
  const f = await setup(t, (url, init) => init.method === 'POST' && url.endsWith('/topics/p1/like') ? hold.promise : null);
  const button = f.main.querySelector('[data-action="community-like"][data-kind="topic"]');
  assert.ok(button); button.click(); await flush();
  const writes = () => f.calls.filter(call => call.init.method === 'POST');
  assert.equal(writes().length, 1); assert.equal(writes()[0].init.signal, undefined);
  assert.equal(f.deadlines(), 0, 'writes are excluded from GET deadlines');
  f.fire(10000); await flush();
  assert.equal(writes().length, 1); assert.equal(button.disabled, true);
  assert.equal(f.notices.some(message => /超时/.test(message)), false);
  hold.resolve(response({ ok: true })); await flush();
  assert.equal(writes().length, 1);
});

for (const available of [true, false]) test(`the passive caller abort settles an uncooperative GET with AbortSignal.any ${available ? 'available' : 'unavailable'}`, async t => {
  if (!available) {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
    t.after(() => { if (descriptor) Object.defineProperty(AbortSignal, 'any', descriptor); else delete AbortSignal.any; });
  }
  const hold = deferred(); let passiveRead;
  const f = await setup(t, (url, init) => {
    if (url.endsWith('/me') && new Headers(init.headers).get('X-Community-Passive') === '1') {
      passiveRead = init; return hold.promise;
    }
    return null;
  });
  const body = f.main.querySelector('.community-thread');
  f.fire(15000); await flush();
  assert.ok(passiveRead?.signal);
  f.fire(10000); await flush();
  assert.equal(passiveRead.signal.aborted, true);
  assert.equal(f.main.querySelector('.community-thread'), body);
  assert.equal(f.main.querySelector('[data-content-state="error"]'), null);
  assert.equal(f.deadlines(), 0, 'caller cancellation removes the internal read deadline too');
  hold.resolve(response({ ...person, name: '失效被动读取' })); await flush();
  assert.equal(f.ui.me()?.name, person.name);
});

test('passive GETs succeed without AbortSignal.any and retain the existing reading DOM', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
  t.after(() => { if (descriptor) Object.defineProperty(AbortSignal, 'any', descriptor); else delete AbortSignal.any; });
  const f = await setup(t);
  const body = f.main.querySelector('.community-thread');
  f.fire(15000); await flush();
  const passiveCalls = f.calls.filter(call => new Headers(call.init.headers).get('X-Community-Passive') === '1');
  assert.equal(passiveCalls.length, 3);
  for (const call of passiveCalls) assert.equal(call.init.signal.aborted, false);
  assert.equal(f.main.querySelector('.community-thread'), body);
  assert.equal(f.deadlines(), 0);
  assert.equal(f.main.querySelector('[data-content-state="error"]'), null);
});
