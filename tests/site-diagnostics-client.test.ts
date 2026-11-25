import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { startSiteDiagnostics } from '../src/site-diagnostics.ts';
import type { DiagnosticMetric, DiagnosticMetricHooks } from '../src/site-diagnostics.ts';

const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture(t: TestContext, options: { observer?: boolean; reject?: boolean; dnt?: boolean; staticBase?: string } = {}) {
  const dom = new JSDOM('<!doctype html><p>Private reader content</p>', { url: 'https://site.test/?private=secret#/community/u/357341' });
  const win = dom.window as unknown as Window;
  if (options.staticBase !== undefined) win.document.documentElement.dataset.staticBase = options.staticBase;
  const callbacks = new Map<string, (metric: DiagnosticMetric) => void>();
  const calls: { input: RequestInfo | URL; init: RequestInit }[] = [];
  const intervalCallbacks: (() => void)[] = [];
  let loads = 0, disconnected = 0, cleared = 0;
  let observerCallback: PerformanceObserverCallback | undefined;
  Object.defineProperty(win, 'setInterval', { value: (callback: () => void) => { intervalCallbacks.push(callback); return 25; } });
  Object.defineProperty(win, 'clearInterval', { value: () => { cleared++; } });
  if (options.dnt) Object.defineProperty(win.navigator, 'doNotTrack', { value: '1' });
  if (options.observer !== false) Object.defineProperty(win, 'PerformanceObserver', { value: class {
    static supportedEntryTypes = ['longtask'];
    constructor(callback: PerformanceObserverCallback) { observerCallback = callback; }
    observe() {}
    disconnect() { disconnected++; }
  } });
  const hook = (name: string) => (callback: (metric: DiagnosticMetric) => void, config?: unknown) => {
    assert.deepEqual(config, { reportAllChanges: false, reportSoftNavs: false });
    callbacks.set(name, callback);
  };
  const metricLoader = async (): Promise<DiagnosticMetricHooks> => { loads++; return {
    onCLS: hook('CLS'), onLCP: hook('LCP'), onINP: hook('INP'), onFCP: hook('FCP'), onTTFB: hook('TTFB'),
  }; };
  const request: typeof fetch = async (input, init = {}) => {
    calls.push({ input, init });
    if (options.reject) throw new Error('network failure with private URL');
    return Response.json({ ok: true });
  };
  const control = startSiteDiagnostics({ window: win, fetch: request, metricLoader });
  t.after(() => { control.destroy(); dom.window.close(); });
  const emitError = (name = 'TypeError', line = 12, filename = 'https://site.test/app.mjs?private=secret') => {
    const error = new dom.window.Error('private user message and account detail');
    error.name = name;
    win.dispatchEvent(new dom.window.ErrorEvent('error', { error, message: error.message, filename, lineno: line }));
  };
  const events = () => calls.flatMap(call => (JSON.parse(String(call.init.body)) as { events: unknown[] }).events);
  return { dom, win, control, callbacks, calls, intervalCallbacks, metricLoader, emitError, events,
    counts: () => ({ loads, disconnected, cleared }),
    longtask: (duration: number) => observerCallback?.({ getEntries: () => [{ entryType: 'longtask', duration, name: 'private target detail' }] } as unknown as PerformanceObserverEntryList, {} as PerformanceObserver),
  };
}

test('client sends only anonymous normalized metrics, long tasks and native error classes', async t => {
  const f = fixture(t); await settle();
  f.callbacks.get('LCP')!({ name: 'LCP', value: 1234.567 });
  f.longtask(67.89); f.emitError(); f.emitError();
  f.dom.window.history.replaceState(null, '', '/#/community/shop/digital');
  f.win.dispatchEvent(new f.dom.window.Event('pagehide')); await settle();
  assert.deepEqual(f.events(), [
    { kind: 'vital', name: 'LCP', value: 1234.6, route: 'community-profile' },
    { kind: 'longtask', duration: 67.9, route: 'community-profile' },
    { kind: 'error', source: 'script', name: 'TypeError', route: 'community-profile', line: 12 },
  ]);
  const sent = JSON.stringify(f.calls);
  assert.doesNotMatch(sent, /357341|private|secret|account detail|filename|stack|metricId|cookie/i);
  assert.equal(f.calls[0].input, '/api/diagnostics/events');
  assert.equal(f.calls[0].init.credentials, 'omit');
  assert.equal(f.calls[0].init.keepalive, true);
  assert.equal(f.calls[0].init.referrerPolicy, 'no-referrer');
});

test('rejection values and resource failures cannot leak messages, upload paths or cross-origin addresses', async t => {
  const f = fixture(t); await settle();
  const promiseEvent = new f.dom.window.Event('unhandledrejection');
  Object.defineProperty(promiseEvent, 'reason', { value: 'private form submission body' });
  f.win.dispatchEvent(promiseEvent);
  const image = f.dom.window.document.createElement('img'); image.src = '/uploads/private-avatar.jpg';
  f.dom.window.document.body.append(image); image.dispatchEvent(new f.dom.window.Event('error'));
  const remote = f.dom.window.document.createElement('script'); remote.src = 'https://external.test/private.js';
  f.dom.window.document.body.append(remote); remote.dispatchEvent(new f.dom.window.Event('error'));
  const script = f.dom.window.document.createElement('script'); script.src = '/app.mjs?private=secret';
  f.dom.window.document.body.append(script); script.dispatchEvent(new f.dom.window.Event('error'));
  f.control.flush(); await settle();
  assert.deepEqual(f.events(), [
    { kind: 'error', source: 'promise', name: 'UnknownError', route: 'community-profile' },
    { kind: 'error', source: 'resource', name: 'UnknownError', route: 'community-profile' },
  ]);
});

test('the current production CDN package is monitored without retaining its URLs or accepting other packages', async t => {
  const base = 'https://static.sansphase.com/assets/site/0123456789abcdef01234567/';
  const f = fixture(t, { staticBase: base }); await settle();
  f.emitError('TypeError', 24, base + 'app.mjs?token=PRIVATE_CDN_TOKEN');
  f.emitError('ReferenceError', 25, base.replace('0123456789abcdef01234567', 'abcdef0123456789abcdef01') + 'app.mjs');
  f.emitError('RangeError', 26, 'https://external.test/app.mjs');
  const script = f.dom.window.document.createElement('script'); script.src = base + 'chunks/example-ABC12345.mjs';
  f.dom.window.document.body.append(script); script.dispatchEvent(new f.dom.window.Event('error'));
  f.dom.window.history.replaceState(null, '', '/#/community/boards/qa');
  const style = f.dom.window.document.createElement('link'); style.rel = 'stylesheet'; style.href = base + 'community.css?private=secret';
  f.dom.window.document.head.append(style); style.dispatchEvent(new f.dom.window.Event('error'));
  f.control.flush(); await settle();
  assert.deepEqual(f.events(), [
    { kind: 'error', source: 'script', name: 'TypeError', route: 'community-profile', line: 24 },
    { kind: 'error', source: 'resource', name: 'UnknownError', route: 'community-profile' },
    { kind: 'error', source: 'resource', name: 'UnknownError', route: 'community-board' },
  ]);
  assert.doesNotMatch(JSON.stringify(f.calls), /static\.sansphase|0123456789abcdef|PRIVATE_CDN|app\.mjs|community\.css|external\.test/);
});

test('malformed or unapproved static base metadata cannot allow cross-origin script collection', async t => {
  const path = '/assets/site/0123456789abcdef01234567/';
  for (const staticBase of ['http://static.sansphase.com' + path, 'https://external.test' + path,
    'https://static.sansphase.com.evil.test' + path, 'https://user:password@static.sansphase.com' + path,
    'https://static.sansphase.com' + path + '?private=secret', 'https://static.sansphase.com' + path + '#private',
    'https://static.sansphase.com/assets/site/invalid/', 'https://static.sansphase.com/uploads/',
    'https://static.sansphase.com' + path.slice(0, -1)]) {
    const f = fixture(t, { staticBase }); await settle();
    f.emitError('TypeError', 24, 'https://static.sansphase.com' + path + 'app.mjs');
    f.control.flush(); await settle();
    assert.deepEqual(f.events(), [], staticBase);
  }
});

test('initialization is idempotent, destroy stops every owned listener and observer, delayed callbacks stay inert', async t => {
  const f = fixture(t); await settle();
  assert.equal(startSiteDiagnostics({ window: f.win, metricLoader: f.metricLoader }), f.control);
  assert.equal(f.counts().loads, 1);
  assert.equal(f.intervalCallbacks.length, 1);
  f.control.destroy();
  f.emitError(); f.longtask(123); f.callbacks.get('LCP')!({ name: 'LCP', value: 123 });
  f.win.dispatchEvent(new f.dom.window.Event('pagehide')); f.intervalCallbacks[0](); f.control.flush(); await settle();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.counts(), { loads: 1, disconnected: 1, cleared: 1 });
  assert.equal(startSiteDiagnostics({ window: f.win, metricLoader: f.metricLoader }), f.control);
});

test('document vitals retain their entry route after hash navigation while later errors use the current page', async t => {
  const f = fixture(t); await settle();
  f.dom.window.history.replaceState(null, '', '/#/community/shop/digital');
  f.callbacks.get('LCP')!({ name: 'LCP', value: 1500 });
  f.emitError(); f.control.flush(); await settle();
  assert.deepEqual(f.events(), [
    { kind: 'vital', name: 'LCP', value: 1500, route: 'community-profile' },
    { kind: 'error', source: 'script', name: 'TypeError', route: 'community-shop', line: 12 },
  ]);
});

test('unsupported observers and failed reporting remain harmless and never retry', async t => {
  const f = fixture(t, { observer: false, reject: true }); await settle();
  f.emitError(); f.control.flush(); await settle();
  for (let n = 0; n < 5; n++) f.intervalCallbacks[0]();
  await settle(); assert.equal(f.calls.length, 1);
  assert.equal(f.counts().disconnected, 0);
});

test('a main-thread stall over a minute is recorded instead of silently discarded', async t => {
  const f = fixture(t); await settle();
  f.longtask(125_000.123);
  f.control.flush(); await settle();
  assert.deepEqual(f.events(), [{ kind: 'longtask', duration: 125_000.1, route: 'community-profile' }]);
});

test('hidden documents flush final values and cross-origin script failures are ignored', async t => {
  const f = fixture(t); await settle();
  f.win.dispatchEvent(new f.dom.window.ErrorEvent('error', { filename: 'https://external.test/private.js', error: new TypeError('secret') }));
  Object.defineProperty(f.win.document, 'visibilityState', { configurable: true, value: 'hidden' });
  f.win.document.dispatchEvent(new f.dom.window.Event('visibilitychange'));
  // web-vitals emits final metrics during the same visibility event turn.
  f.callbacks.get('CLS')!({ name: 'CLS', value: 0.03456 });
  await settle();
  assert.deepEqual(f.events(), [{ kind: 'vital', name: 'CLS', value: 0.0346, route: 'community-profile' }]);
});

test('an unavailable metric loader and a synchronous network failure cannot escape the diagnostics boundary', async t => {
  const dom = new JSDOM('', { url: 'https://site.test/#/notes' });
  const win = dom.window as unknown as Window;
  let attempts = 0;
  const control = startSiteDiagnostics({ window: win,
    metricLoader: async () => { throw new Error('optional module unavailable'); },
    fetch: () => { attempts++; throw new Error('private network exception'); },
  });
  t.after(() => { control.destroy(); dom.window.close(); });
  await settle();
  win.dispatchEvent(new dom.window.ErrorEvent('error', { error: new Error('reader detail') }));
  assert.doesNotThrow(() => control.flush());
  await settle(); control.flush();
  assert.equal(attempts, 1);
});

test('events are bounded to twenty per batch and one hundred per page', async t => {
  const f = fixture(t); await settle();
  for (let n = 1; n <= 150; n++) f.emitError('TypeError', n);
  f.control.flush(); await settle();
  assert.equal(f.events().length, 100);
  for (const call of f.calls) {
    const payload = String(call.init.body);
    assert.ok(new TextEncoder().encode(payload).byteLength <= 8192);
    assert.ok((JSON.parse(payload) as { events: unknown[] }).events.length <= 20);
  }
});

test('do-not-track and global privacy control prevent collection and initialization', async t => {
  const dnt = fixture(t, { dnt: true }); await settle();
  dnt.emitError(); dnt.control.flush();
  assert.equal(dnt.control.enabled, false); assert.equal(dnt.counts().loads, 0); assert.equal(dnt.calls.length, 0);
  const dom = new JSDOM('', { url: 'https://site.test/' });
  Object.defineProperty(dom.window.navigator, 'globalPrivacyControl', { value: true });
  const gpc = startSiteDiagnostics({ window: dom.window as unknown as Window, metricLoader: async () => { throw new Error('must not initialize'); } });
  t.after(() => dom.window.close()); assert.equal(gpc.enabled, false);
});
