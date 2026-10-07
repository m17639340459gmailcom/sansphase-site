import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createCommunityPassiveRefresh } from '../src/community-passive-refresh.ts';

interface TestWindow extends Window { Event: typeof Event }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => { window: TestWindow };
};
type Request = { signal: AbortSignal; resolve: (value: boolean) => void; reject: (reason: unknown) => void };
type Options = Parameters<typeof createCommunityPassiveRefresh>[0];
const flush = async () => { for (let step = 0; step < 4; step++) await Promise.resolve(); };

function fixture(t: test.TestContext, options: Partial<Pick<Options, 'run' | 'intervalMs' | 'timeoutMs'>> = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const { window } = new JSDOM('<main></main>', { url: 'http://localhost/#/community/home' });
  let hidden = false, allowed = true, allowedReads = 0;
  Object.defineProperty(window.document, 'hidden', { get: () => hidden });
  const requests: Request[] = [];
  const setTimer = t.mock.fn(setTimeout), clearTimer = t.mock.fn(clearTimeout);
  const refresh = createCommunityPassiveRefresh({ document: window.document, window,
    allowed: () => { allowedReads++; return allowed; },
    run: signal => new Promise<boolean>((resolve, reject) => { requests.push({ signal, resolve, reject }); }),
    setTimer, clearTimer, ...options });
  t.after(() => { refresh.stop(); window.close(); });
  return { refresh, requests, window, setTimer, clearTimer,
    allowedReads: () => allowedReads,
    allowed: (value: boolean) => { allowed = value; },
    visible: (value: boolean) => { hidden = !value; window.document.dispatchEvent(new window.Event('visibilitychange')); },
    focus: () => window.dispatchEvent(new window.Event('focus')),
    advance: async (ms: number) => { t.mock.timers.tick(ms); await flush(); } };
}

test('start waits fifteen seconds and does not overlap an unfinished visible refresh', async t => {
  const f = fixture(t);
  f.refresh.start(); f.refresh.start();
  assert.equal(f.requests.length, 0);
  await f.advance(14999); assert.equal(f.requests.length, 0);
  await f.advance(1); assert.equal(f.requests.length, 1);
  f.focus(); f.visible(true);
  await f.advance(9000); assert.equal(f.requests.length, 1);
  f.requests[0].resolve(true); await flush();
  await f.advance(14999); assert.equal(f.requests.length, 1);
  await f.advance(1); assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].signal.aborted, false);
});

test('a blocked refresh checks again only on its next scheduled cycle', async t => {
  const f = fixture(t); f.allowed(false); f.refresh.start();
  await f.advance(15000);
  assert.equal(f.allowedReads(), 1); assert.equal(f.requests.length, 0);
  f.allowed(true);
  await f.advance(14999); assert.equal(f.allowedReads(), 1);
  await f.advance(1); assert.equal(f.allowedReads(), 2); assert.equal(f.requests.length, 1);
});

test('hidden pages cancel pending work and timers, then resume with a delayed refresh', async t => {
  const f = fixture(t); f.refresh.start();
  await f.advance(15000); const previous = f.requests[0];
  f.visible(false); assert.equal(previous.signal.aborted, true);
  const scheduled = f.setTimer.mock.callCount();
  await f.advance(60000); f.focus(); await f.advance(15000);
  assert.equal(f.requests.length, 1); assert.equal(f.setTimer.mock.callCount(), scheduled);
  previous.resolve(true); await flush();
  assert.equal(f.setTimer.mock.callCount(), scheduled, 'late hidden-page results do not schedule work');
  f.visible(true);
  await f.advance(999); assert.equal(f.requests.length, 1);
  await f.advance(1); assert.equal(f.requests.length, 2);
});

test('starting while hidden waits for visibility and keeps the first refresh delayed', async t => {
  const f = fixture(t); f.visible(false); f.refresh.start();
  await f.advance(60000); assert.equal(f.requests.length, 0); assert.equal(f.setTimer.mock.callCount(), 0);
  f.visible(true);
  await f.advance(999); assert.equal(f.requests.length, 0);
  await f.advance(1); assert.equal(f.requests.length, 1);
});

test('focus and visibility bursts bring a refresh forward without restarting its delay or polling continuously', async t => {
  const f = fixture(t); f.refresh.start();
  await f.advance(5000); f.focus();
  await f.advance(500); for (let count = 0; count < 20; count++) { f.focus(); f.visible(true); }
  await f.advance(499); assert.equal(f.requests.length, 0);
  await f.advance(1); assert.equal(f.requests.length, 1);
  f.requests[0].resolve(true); await flush();
  for (let second = 0; second < 9; second++) { f.focus(); await f.advance(1000); }
  assert.equal(f.requests.length, 1, 'a focus storm cannot create a refresh each second');
  f.focus(); await f.advance(1000); assert.equal(f.requests.length, 2);
});

test('a ten-second timeout aborts and releases a run even when it ignores the signal', async t => {
  const f = fixture(t); f.refresh.start();
  await f.advance(15000); const previous = f.requests[0];
  await f.advance(9999); assert.equal(previous.signal.aborted, false);
  await f.advance(1); assert.equal(previous.signal.aborted, true);
  await f.advance(14999); assert.equal(f.requests.length, 1);
  await f.advance(1); assert.equal(f.requests.length, 2);
  const scheduled = f.setTimer.mock.callCount();
  previous.resolve(true); await flush();
  assert.equal(f.setTimer.mock.callCount(), scheduled, 'late completion cannot release or reschedule a newer run');
  await f.advance(9999); assert.equal(f.requests[1].signal.aborted, false);
  await f.advance(1); assert.equal(f.requests[1].signal.aborted, true);
  await f.advance(29999); assert.equal(f.requests.length, 2);
  await f.advance(1); assert.equal(f.requests.length, 3, 'the old success cannot reset the timeout backoff');
});

test('failures back off fifteen, thirty and sixty seconds, capped at sixty; success resets the interval', async t => {
  const f = fixture(t); f.refresh.start(); await f.advance(15000);
  for (const delay of [15000, 30000, 60000, 60000]) {
    const count = f.requests.length;
    f.requests.at(-1)!.reject(new Error('network failure')); await flush();
    await f.advance(delay - 1); assert.equal(f.requests.length, count);
    await f.advance(1); assert.equal(f.requests.length, count + 1);
  }
  f.requests.at(-1)!.resolve(true); await flush();
  const count = f.requests.length;
  await f.advance(14999); assert.equal(f.requests.length, count);
  await f.advance(1); assert.equal(f.requests.length, count + 1);
});

for (const failures of [2, 3]) {
  const retryDelay = failures === 2 ? 30000 : 60000;
  test(`focus and visibility storms cannot shorten a ${retryDelay / 1000}-second failure backoff`, async t => {
    const f = fixture(t); f.refresh.start(); await f.advance(15000);
    for (let failure = 1; failure < failures; failure++) {
      f.requests.at(-1)!.reject(new Error('network failure')); await flush();
      await f.advance(failure === 1 ? 15000 : 30000);
    }
    f.requests.at(-1)!.reject(new Error('network failure')); await flush();
    const count = f.requests.length;
    for (let second = 0; second < retryDelay / 1000 - 1; second++) {
      f.focus(); f.visible(true); await f.advance(1000);
      assert.equal(f.requests.length, count, 'wake-up events must obey the failure retry deadline');
    }
    f.focus(); f.visible(true); await f.advance(999); assert.equal(f.requests.length, count);
    await f.advance(1); assert.equal(f.requests.length, count + 1);
  });

  test(`returning from a hidden page preserves the ${retryDelay / 1000}-second failure retry deadline`, async t => {
    const f = fixture(t); f.refresh.start(); await f.advance(15000);
    for (let failure = 1; failure < failures; failure++) {
      f.requests.at(-1)!.reject(new Error('network failure')); await flush();
      await f.advance(failure === 1 ? 15000 : 30000);
    }
    f.requests.at(-1)!.reject(new Error('network failure')); await flush();
    const count = f.requests.length;
    await f.advance(5000); f.visible(false); await f.advance(10000); f.visible(true); f.focus();
    await f.advance(retryDelay - 15000 - 1); assert.equal(f.requests.length, count);
    await f.advance(1); assert.equal(f.requests.length, count + 1);
  });
}

test('false and disallowed cycles do not count as failures or reset an earlier backoff', async t => {
  const f = fixture(t); f.refresh.start(); await f.advance(15000);
  f.requests[0].reject(new Error('first failure')); await flush(); await f.advance(15000);
  f.requests[1].reject(new Error('second failure')); await flush(); await f.advance(30000);
  f.requests[2].resolve(false); await flush();
  await f.advance(29999); assert.equal(f.requests.length, 3);
  await f.advance(1); assert.equal(f.requests.length, 4);
  f.allowed(false); f.requests[3].resolve(false); await flush();
  await f.advance(30000); assert.equal(f.requests.length, 4);
  f.allowed(true); await f.advance(29999); assert.equal(f.requests.length, 4);
  await f.advance(1); assert.equal(f.requests.length, 5);
  f.requests[4].reject(new Error('third failure')); await flush();
  await f.advance(59999); assert.equal(f.requests.length, 5);
  await f.advance(1); assert.equal(f.requests.length, 6);
});

test('invalidate aborts the old run, resets the interval, and permits later runs without restarting', async t => {
  const f = fixture(t); f.refresh.start(); await f.advance(15000);
  f.requests[0].reject(new Error('first failure')); await flush(); await f.advance(15000);
  f.requests[1].reject(new Error('second failure')); await flush(); await f.advance(30000);
  const previous = f.requests[2]; f.refresh.invalidate();
  assert.equal(previous.signal.aborted, true);
  await f.advance(14999); assert.equal(f.requests.length, 3);
  await f.advance(1); assert.equal(f.requests.length, 4);
  previous.reject(new Error('late cancelled failure')); await flush();
  f.requests[3].resolve(true); await flush();
  await f.advance(15000); assert.equal(f.requests.length, 5);
});

test('explicit invalidation clears a failure deadline so later wake-up events can refresh the new state', async t => {
  const f = fixture(t); f.refresh.start(); await f.advance(15000);
  for (const wait of [15000, 30000]) {
    f.requests.at(-1)!.reject(new Error('network failure')); await flush(); await f.advance(wait);
  }
  f.requests.at(-1)!.reject(new Error('network failure')); await flush();
  await f.advance(5000); f.refresh.invalidate(); f.focus();
  await f.advance(4999); assert.equal(f.requests.length, 3);
  await f.advance(1); assert.equal(f.requests.length, 4);
});

test('stop removes listeners and all work, is idempotent, and ignores late rejected promises', async t => {
  const f = fixture(t);
  const removeDocument = t.mock.method(f.window.document, 'removeEventListener');
  const removeWindow = t.mock.method(f.window, 'removeEventListener');
  f.refresh.start(); await f.advance(15000); const previous = f.requests[0];
  f.refresh.stop(); f.refresh.stop(); f.refresh.invalidate();
  assert.equal(previous.signal.aborted, true);
  assert.equal(removeDocument.mock.calls.filter(call => call.arguments[0] === 'visibilitychange').length, 1);
  assert.equal(removeWindow.mock.calls.filter(call => call.arguments[0] === 'focus').length, 1);
  const scheduled = f.setTimer.mock.callCount();
  previous.reject(new Error('late cancelled failure')); await flush();
  f.focus(); f.visible(true); await f.advance(120000);
  assert.equal(f.requests.length, 1); assert.equal(f.setTimer.mock.callCount(), scheduled);
  assert.ok(f.clearTimer.mock.callCount() > 0);
});

test('invalidating an idle cycle replaces its pending timer with a new full interval', async t => {
  const f = fixture(t); f.refresh.start(); await f.advance(10000);
  f.refresh.invalidate();
  await f.advance(14999); assert.equal(f.requests.length, 0);
  await f.advance(1); assert.equal(f.requests.length, 1);
  f.visible(false); f.refresh.invalidate();
  await f.advance(60000); assert.equal(f.requests.length, 1);
  f.visible(true); await f.advance(1000); assert.equal(f.requests.length, 2);
});

test('stopping before the first cycle clears it and a later start attaches a fresh delayed cycle', async t => {
  const f = fixture(t); f.refresh.start(); await f.advance(10000);
  f.refresh.stop(); await f.advance(60000); assert.equal(f.requests.length, 0);
  f.refresh.start(); await f.advance(14999); assert.equal(f.requests.length, 0);
  await f.advance(1); assert.equal(f.requests.length, 1);
  const previous = f.requests[0];
  f.refresh.stop(); f.refresh.start(); previous.resolve(true); await flush();
  await f.advance(14999); assert.equal(f.requests.length, 1);
  await f.advance(1); assert.equal(f.requests.length, 2);
});

test('custom intervals and deadlines are honored through the injected timers', async t => {
  const f = fixture(t, { intervalMs: 2000, timeoutMs: 3000 });
  f.refresh.start(); await f.advance(1999); assert.equal(f.requests.length, 0);
  await f.advance(1); assert.equal(f.requests.length, 1);
  await f.advance(2999); assert.equal(f.requests[0].signal.aborted, false);
  await f.advance(1); assert.equal(f.requests[0].signal.aborted, true);
  await f.advance(1999); assert.equal(f.requests.length, 1);
  await f.advance(1); assert.equal(f.requests.length, 2);
});
