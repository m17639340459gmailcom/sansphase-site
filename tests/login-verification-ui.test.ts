import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createLoginVerificationAcquirer } from '../src/login-verification.ts';

const challenge = {
  id: 'a'.repeat(32), token: 'signed-test-token', expiresAt: Math.floor(Date.now() / 1000) + 120, backgroundImage: 'data:image/jpeg;base64,YQ==', templateImage: 'data:image/png;base64,Yg==', backgroundImageWidth: 600, backgroundImageHeight: 360, templateImageWidth: 110, templateImageHeight: 360,
};
function fixture(origin = 'https://www.sansphase.com') {
  const dom = new JSDOM('<form><input name="email" value="reader@example.test"><input name="password" type="password" value="original-password"><button type="submit">登录</button></form>', { url: `${origin}/#/account`, runScripts: 'outside-only', pretendToBeVisual: true });
  return { dom, form: dom.window.document.querySelector('form')! };
}

test('disabled login verification does not load the slider or change the existing form', async () => {
  const { dom, form } = fixture(); let loads = 0;
  const before = form.innerHTML;
  const acquire = createLoginVerificationAcquirer({ request: async () => new Response(JSON.stringify({ enabled: false })), load: async () => { loads++; throw new Error('must stay lazy'); } });
  try { assert.equal(await acquire(form, 'reader'), null); assert.equal(loads, 0); assert.equal(form.innerHTML, before); }
  finally { dom.window.close(); }
});

test('each login requests a fresh same-origin challenge and returns proof without persisting credentials', async () => {
  const { dom, form } = fixture(); const calls: { path: string; options: RequestInit }[] = []; const statuses: string[] = []; let loads = 0, solves = 0;
  const acquire = createLoginVerificationAcquirer({
    request: async (path, options) => { calls.push({ path: String(path), options: options! }); return new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge })); },
    load: async () => { loads++; return { solveLoginChallenge: async (_form, value) => { assert.deepEqual(value, challenge); return `proof-${++solves}`; } }; },
  });
  try {
    assert.equal(await acquire(form, 'reader', { onStatus: status => statuses.push(status) }), 'proof-1');
    assert.equal(await acquire(form, 'author'), 'proof-2');
    assert.equal(loads, 1); assert.equal(calls.length, 2);
    assert.equal(calls[0].path, '/api/reader/login-challenge'); assert.equal(calls[1].path, '/api/author/login-challenge');
    assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.credentials, 'same-origin');
    assert.deepEqual(calls[0].options.headers, { 'X-Reader-Request': '1', 'Content-Type': 'application/json' });
    assert.deepEqual(calls[1].options.headers, { 'X-Author-Request': '1', 'Content-Type': 'application/json' });
    assert.equal(calls[0].options.body, '{}', 'challenge request never sends email or password');
    assert.deepEqual(statuses, ['checking', 'verifying', 'complete']);
    assert.equal(form.querySelector<HTMLInputElement>('[name="password"]')!.value, 'original-password');
    assert.equal(dom.window.localStorage.length, 0); assert.equal(dom.window.sessionStorage.length, 0);
  } finally { dom.window.close(); }
});

test('invalid challenge responses and HTTP failures stop login instead of falling through as disabled', async () => {
  const { dom, form } = fixture(); let loads = 0;
  try {
    for (const body of [{}, { enabled: true }, { enabled: 'false' }, { enabled: true, engine: 'slider', challenge: { ...challenge, backgroundImage: 'https://example.test/image.jpg' } }]) {
      const acquire = createLoginVerificationAcquirer({ request: async () => new Response(JSON.stringify(body)), load: async () => { loads++; throw new Error('must not reach library'); } });
      await assert.rejects(acquire(form, 'reader'), /验证/);
    }
    const failed = createLoginVerificationAcquirer({ request: async () => new Response(JSON.stringify({ error: 'retry' }), { status: 503 }) });
    await assert.rejects(failed(form, 'reader'), /验证/); assert.equal(loads, 0);
  } finally { dom.window.close(); }
});

test('cancelled and detached forms abort verification and cannot return stale proof', async () => {
  const { dom, form } = fixture(); const controller = new AbortController(); let workerSignal: AbortSignal | undefined;
  const acquire = createLoginVerificationAcquirer({ request: async () => new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge })), load: async () => ({ solveLoginChallenge: async (_form, _value, signal) => { workerSignal = signal; return new Promise(() => {}); } }) });
  try {
    const cancelled = acquire(form, 'reader', { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' }); assert.equal(workerSignal?.aborted, true);
    const detached = acquire(form, 'reader');
    await new Promise(resolve => setTimeout(resolve, 0)); form.remove();
    await assert.rejects(detached, { name: 'AbortError' }); assert.equal(workerSignal?.aborted, true);
  } finally { dom.window.close(); }
});

test('timeout bounds challenge fetch and solver work, and a failed import is retryable', async () => {
  const { dom, form } = fixture();
  try {
    const slow = createLoginVerificationAcquirer({ timeoutMs: 15, request: async () => new Promise(() => {}) });
    await assert.rejects(slow(form, 'reader'), /超时/);
    let loads = 0;
    const acquire = createLoginVerificationAcquirer({ request: async () => new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge })), load: async () => { if (++loads === 1) throw new Error('library unavailable'); return { solveLoginChallenge: async () => 'retried-proof' }; } });
    await assert.rejects(acquire(form, 'reader'), /unavailable/);
    assert.equal(await acquire(form, 'reader'), 'retried-proof'); assert.equal(loads, 2);
    const stuck = createLoginVerificationAcquirer({ interactionTimeoutMs: 15, request: async () => new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge })), load: async () => ({ solveLoginChallenge: async () => new Promise(() => {}) }) });
    await assert.rejects(stuck(form, 'reader'), /超时/);
  } finally { dom.window.close(); }
});

test('already cancelled and disconnected login forms never issue network requests', async () => {
  const { dom, form } = fixture(); let calls = 0;
  const acquire = createLoginVerificationAcquirer({ request: async () => { calls++; throw new Error('must not fetch'); } });
  const controller = new AbortController(); controller.abort();
  try { await assert.rejects(acquire(form, 'author', { signal: controller.signal }), { name: 'AbortError' }); form.remove(); await assert.rejects(acquire(form, 'reader'), { name: 'AbortError' }); assert.equal(calls, 0); }
  finally { dom.window.close(); }
});

test('challenge lifetime comes from HTTP Date and elapsed transport time with a bounded no-Date fallback', async () => {
  const { dom, form } = fixture(); const serverTime = 1_800_000_000_000;
  try {
    for (const header of [new Date(serverTime).toUTCString(), undefined, 'unusable-date']) {
      let elapsed = 100;
      const acquire = createLoginVerificationAcquirer({ now: () => elapsed, request: async () => {
        elapsed += 700;
        const response = new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: { ...challenge, expiresAt: serverTime / 1000 + 20 } }), { headers: header ? { Date: header } : {} });
        const read = response.json.bind(response);
        response.json = async () => { elapsed += 300; return read(); };
        return response;
      } });
      const value = await acquire.prepare(form, 'reader'); assert.equal(value.enabled, true);
      if (!value.enabled) throw new Error('enabled challenge expected');
      const initial = header === new Date(serverTime).toUTCString() ? 19_000 : 119_000;
      assert.equal(acquire.remainingLifetimeMs(value.challenge), initial, String(header));
      elapsed += 5_000; assert.equal(acquire.remainingLifetimeMs(value.challenge), initial - 5_000);
      elapsed += 120_000; assert.equal(acquire.remainingLifetimeMs(value.challenge), 0, 'elapsed challenge life cannot restart');
    }
  } finally { dom.window.close(); }
});

const entryBundles = new Map<string, Promise<string>>();
async function loginUI(namespace: 'reader' | 'author', scenario: 'success' | 'failure' | 'timeout' | 'cancel' | 'pending', verifyFirst = true, enabled = true, deviceOffset = 0) {
  const { dom } = fixture(); const w = dom.window, d = w.document;
  d.body.innerHTML = '<header id="site-header"><button data-author-login>作者模式</button></header><main id="main"></main><div id="home-stage"></div><footer id="site-footer"></footer><script id="site-content" type="application/json">{"author":null}</script>';
  const calls: { path: string; options: RequestInit }[] = []; const identities: unknown[] = [];
  let solverSignal: AbortSignal | undefined;
  let finishLogin: (() => void) | undefined;
  const pendingLogins: (() => void)[] = [];
  Object.assign(w, { TextEncoder, TextDecoder, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), __verificationLibrary: { solveLoginChallenge: async (_form: HTMLFormElement, _challenge: unknown, signal: AbortSignal) => { solverSignal = signal; return scenario === 'cancel' ? new Promise<string>(() => {}) : 'fresh-login-proof'; } } });
  w.Date.now = () => Date.now() + deviceOffset;
  const timer = w.setTimeout.bind(w);
  w.setTimeout = ((callback: TimerHandler, ms?: number, ...args: unknown[]) => timer(callback, ms === 30_000 && scenario !== 'pending' ? 40 : ms, ...args)) as typeof w.setTimeout;
  Object.assign(w, { fetch: async (path: string, options: RequestInit = {}) => {
    calls.push({ path, options });
    if (path.endsWith('/session')) return new Response('null');
    if (path.endsWith('/login-challenge')) return new Response(JSON.stringify(enabled ? { enabled: true, engine: 'slider', challenge } : { enabled: false }), { status: scenario === 'failure' ? 503 : 200, headers: { Date: new Date().toUTCString() } });
    if (path.endsWith('/login')) {
      if (scenario === 'timeout') return new Promise<Response>((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }));
      if (scenario === 'pending') return new Promise<Response>(resolve => {
        finishLogin = () => resolve(new Response(JSON.stringify(namespace === 'reader' ? { email: 'reader@example.test', nickname: '读者', role: 'reader' } : { name: '作者' })));
        pendingLogins.push(finishLogin);
      });
      return new Response(JSON.stringify(namespace === 'reader' ? { email: 'reader@example.test', nickname: '读者', role: 'reader' } : { name: '作者' }));
    }
    return new Response('{}');
  } });
  if (!entryBundles.has(namespace)) entryBundles.set(namespace, build({
    entryPoints: [fileURLToPath(new URL(namespace === 'reader' ? '../src/reader-ui.ts' : '../src/author-entry.mjs', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'LoginUI', platform: 'browser', target: 'es2022', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    plugins: [{ name: 'test-login-library-boundary', setup(build) {
      build.onResolve({ filter: /\/login-verification\.mjs$/ }, () => ({ path: 'test-login-adapter', namespace: 'login-test' }));
      build.onLoad({ filter: /^test-login-adapter$/, namespace: 'login-test' }, () => ({ contents: `export * from ${JSON.stringify(fileURLToPath(new URL('../src/login-verification.ts', import.meta.url)))}; import {createLoginVerificationAcquirer} from ${JSON.stringify(fileURLToPath(new URL('../src/login-verification.ts', import.meta.url)))}; export const acquireLoginVerification=createLoginVerificationAcquirer({load:async()=>globalThis.__verificationLibrary});`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) }));
    } }],
  }).then(output => output.outputFiles[0].text));
  vm.runInContext(await entryBundles.get(namespace)!, dom.getInternalVMContext());
  let readerUI: ReturnType<typeof import('../src/reader-ui.ts')['mountReaderUI']> | undefined;
  if (namespace === 'reader') {
    const ui = vm.runInContext('LoginUI', dom.getInternalVMContext()) as Pick<typeof import('../src/reader-ui.ts'), 'readerPage' | 'mountReaderUI'>;
    d.getElementById('main')!.innerHTML = ui.readerPage('account', '', null);
    readerUI = ui.mountReaderUI({ render: () => {}, onIdentity: identity => identities.push(identity) });
  } else {
    d.querySelector<HTMLButtonElement>('[data-author-login]')!.click();
    for (let i = 0; !d.querySelector('[data-author-form]') && i < 30; i++) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const form = d.querySelector<HTMLFormElement>(namespace === 'reader' ? '[data-reader-form]' : '[data-author-form]')!;
  assert.ok(form);
  form.querySelector<HTMLInputElement>('[name="email"]')!.value = `${namespace}@example.test`;
  form.querySelector<HTMLInputElement>('[name="password"]')!.value = 'original-password';
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const verification = form.querySelector<HTMLButtonElement>('[data-login-verification-control]');
  assert.ok(verification, 'both account entrypoints visibly offer slider verification before login');
  await settle(() => !verification.disabled);
  if (verifyFirst) {
    verification.click();
    if (scenario !== 'cancel') {
      await settle(() => !verification.disabled || verification.dataset.state === 'verified');
      form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    }
  } else form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  return { dom, form, button, verification, calls, identities, readerUI, pendingLogins, signal: () => solverSignal, finishLogin: () => finishLogin?.() };
}
const settle = async (predicate: () => boolean) => {
  for (let i = 0; !predicate() && i < 60; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate(), 'login state settles without waiting indefinitely');
};

test('actual reader and author login handlers send proof only as a header and preserve their original successful behavior', async () => {
  for (const namespace of ['reader', 'author'] as const) {
    const f = await loginUI(namespace, 'success');
    try {
      await settle(() => namespace === 'reader' ? f.identities.length === 1 : f.dom.window.document.querySelector('#author-dialog-title')!.textContent === '作者模式');
      const login = f.calls.find(call => call.path === `/api/${namespace}/login`); assert.ok(login);
      assert.equal(new Headers(login.options.headers).get('X-Login-Verification'), 'fresh-login-proof');
      assert.deepEqual(JSON.parse(String(login.options.body)), { email: `${namespace}@example.test`, password: 'original-password' });
      assert.equal(namespace === 'reader' ? f.identities.length : f.dom.window.document.querySelector('#author-dialog-title')!.textContent === '作者模式' ? 1 : 0, 1);
      assert.equal(JSON.stringify(f.dom.window.localStorage).includes('fresh-login-proof'), false);
    } finally { f.dom.window.close(); }
  }
});

test('both real login entrypoints accept valid verification with device dates one day ahead or behind', async () => {
  for (const namespace of ['reader', 'author'] as const) for (const offset of [-86_400_000, 86_400_000]) {
    const f = await loginUI(namespace, 'success', true, true, offset);
    try {
      await settle(() => namespace === 'reader' ? f.identities.length === 1 : f.dom.window.document.querySelector('#author-dialog-title')!.textContent === '作者模式');
      const login = f.calls.find(call => call.path === `/api/${namespace}/login`); assert.ok(login, `${namespace}: ${offset}`);
      assert.equal(new Headers(login.options.headers).get('X-Login-Verification'), 'fresh-login-proof');
      assert.equal(f.calls.filter(call => call.path.endsWith('/login-challenge')).length, 1, 'device skew causes no redundant challenge refresh');
    } finally { f.dom.window.close(); }
  }
});

test('reader and author login cannot automatically solve or submit before the visible control is clicked', async () => {
  for (const namespace of ['reader', 'author'] as const) {
    const f = await loginUI(namespace, 'success', false);
    try {
      assert.equal(f.verification.hidden, false);
      assert.equal(f.verification.dataset.state, 'ready');
      assert.match(f.verification.textContent!, /滑块验证/);
      assert.equal(f.button.disabled, true);
      assert.equal(f.calls.some(call => call.path.endsWith('/login')), false);
      assert.equal(f.signal(), undefined, 'preparing the gate never starts the solver');
      assert.equal(f.identities.length, 0);
    } finally { f.dom.window.close(); }
  }
});

test('pending reader and author login stay locked during repeat submit, reverify and input changes in both configuration modes', async () => {
  for (const namespace of ['reader', 'author'] as const) for (const enabled of [true, false]) {
    const f = await loginUI(namespace, 'pending', true, enabled);
    try {
      await settle(() => f.calls.filter(call => call.path.endsWith('/login')).length === 1);
      const worker = f.signal();
      assert.equal(f.button.disabled, true);
      assert.equal(f.verification.disabled, true);
      assert.equal(f.verification.getAttribute('aria-busy'), 'true');
      assert.match(f.verification.textContent!, /正在登录/);
      f.verification.dispatchEvent(new f.dom.window.MouseEvent('click', { bubbles: true }));
      f.form.querySelector<HTMLInputElement>('[name="password"]')!.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
      f.form.dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(f.button.disabled, true);
      assert.equal(f.verification.disabled, true);
      assert.equal(f.calls.filter(call => call.path.endsWith('/login')).length, 1);
      assert.equal(f.calls.find(call => call.path.endsWith('/login'))!.options.signal!.aborted, false, 'repeat submission does not cancel the first pending login');
      assert.equal(f.signal(), worker, 'no second solver starts while a login is in flight');
      f.finishLogin();
      await settle(() => namespace === 'reader' ? f.identities.length === 1 : f.dom.window.document.querySelector('#author-dialog-title')!.textContent === '作者模式');
    } finally { f.finishLogin(); f.dom.window.close(); }
  }
});

test('reader route departure cancels pending login before the old account form leaves the DOM', async () => {
  for (const enabled of [true, false]) {
    const f = await loginUI('reader', 'pending', true, enabled);
    try {
      const request = f.calls.find(call => call.path === '/api/reader/login')!;
      assert.ok(request, 'The verified login has reached its existing API');
      f.dom.window.history.pushState(null, '', '/work/selected');
      f.readerUI!.route('work', 'selected');
      assert.equal(f.form.isConnected, true, 'A route transition can retain the outgoing form until its animation finishes');
      assert.equal(request.options.signal!.aborted, true, 'The route lifecycle must cancel the outgoing login immediately');
      f.finishLogin();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(f.identities.length, 0, 'A late response must not publish the old form identity or its navigation');
      assert.equal(f.dom.window.location.pathname, '/work/selected');
      assert.equal(f.dom.window.location.hash, '');
    } finally { f.finishLogin(); f.dom.window.close(); }
  }
});

test('reader late login response checks the full URL even before a path router notifies its lifecycle', async () => {
  const f = await loginUI('reader', 'pending');
  try {
    f.dom.window.history.pushState(null, '', '/resources/chosen');
    f.finishLogin();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.form.isConnected, true);
    assert.equal(f.identities.length, 0, 'pushState changes the path without dispatching hashchange');
    assert.equal(f.dom.window.location.pathname, '/resources/chosen');
    assert.equal(f.dom.window.location.hash, '');
  } finally { f.finishLogin(); f.dom.window.close(); }
});

test('reader pending login survives an unchanged account route refresh', async () => {
  const f = await loginUI('reader', 'pending');
  try {
    f.readerUI!.route('account', '');
    assert.equal(f.calls.find(call => call.path === '/api/reader/login')!.options.signal!.aborted, false);
    f.finishLogin();
    await settle(() => f.identities.length === 1);
    assert.equal(f.dom.window.location.hash, '#/notes', 'The existing V1 successful login destination is preserved');
  } finally { f.finishLogin(); f.dom.window.close(); }
});

test('reader legacy hash departure still cancels a pending login with its outgoing form retained', async () => {
  const f = await loginUI('reader', 'pending');
  try {
    f.dom.window.location.hash = '#/works';
    f.dom.window.dispatchEvent(new f.dom.window.HashChangeEvent('hashchange'));
    assert.equal(f.calls.find(call => call.path === '/api/reader/login')!.options.signal!.aborted, true);
    f.finishLogin();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.identities.length, 0);
    assert.equal(f.dom.window.location.hash, '#/works');
  } finally { f.finishLogin(); f.dom.window.close(); }
});

test('a late canceled reader login cannot release a newer request on the same retained form in either verification mode', async () => {
  for (const enabled of [true, false]) {
    const f = await loginUI('reader', 'pending', true, enabled);
    try {
      const accountURL = f.dom.window.location.href;
      f.dom.window.history.pushState(null, '', '/work/selected'); f.readerUI!.route('work', 'selected');
      f.dom.window.history.pushState(null, '', accountURL); f.readerUI!.route('account', '');
      assert.equal(f.dom.window.document.querySelector('[data-reader-form="login"]'), f.form);
      await settle(() => !f.verification.disabled);
      if (enabled) {
        f.verification.click();
        await settle(() => f.verification.dataset.state === 'verified');
      }
      f.form.dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true }));
      assert.equal(f.pendingLogins.length, 2);
      f.pendingLogins[0]();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(f.identities.length, 0);
      assert.equal(f.button.disabled, true, 'Only the current request may release this submit button');
      assert.equal(f.verification.disabled, true, 'Only the current request may release this verification control');
      assert.equal(f.verification.getAttribute('aria-busy'), 'true');
      assert.equal(f.calls.filter(call => call.path === '/api/reader/login')[1].options.signal!.aborted, false);
      f.pendingLogins[1]();
      await settle(() => f.identities.length === 1);
    } finally { for (const finish of f.pendingLogins) finish(); f.dom.window.close(); }
  }
});

test('failed verification and pending login timeout keep both account forms usable and retain typed credentials', async () => {
  for (const namespace of ['reader', 'author'] as const) for (const scenario of ['failure', 'timeout'] as const) {
    const f = await loginUI(namespace, scenario);
    try {
      const feedbackSelector = namespace === 'reader' ? '[data-reader-message]' : '.author-feedback';
      await settle(() => new RegExp(scenario === 'timeout' ? '登录请求超时' : '验证').test(f.dom.window.document.querySelector(feedbackSelector)!.textContent!));
      assert.equal(f.form.querySelector<HTMLInputElement>('[name="email"]')!.value, `${namespace}@example.test`);
      assert.equal(f.form.querySelector<HTMLInputElement>('[name="password"]')!.value, 'original-password');
      assert.equal(f.calls.filter(call => call.path.endsWith('/login')).length, scenario === 'timeout' ? 1 : 0);
      const message = f.dom.window.document.querySelector(namespace === 'reader' ? '[data-reader-message]' : '.author-feedback');
      assert.match(message!.textContent!, scenario === 'timeout' ? /登录请求超时/ : /验证/);
      assert.equal(f.identities.length, 0);
      assert.equal(f.button.disabled, true, 'failure cannot re-enable login before a new explicit verification');
    } finally { f.dom.window.close(); }
  }
});

test('reader navigation and author Escape cancel pending verification promptly without submitting a login', async () => {
  for (const namespace of ['reader', 'author'] as const) {
    const f = await loginUI(namespace, 'cancel');
    try {
      await settle(() => Boolean(f.signal()));
      if (namespace === 'reader') { f.dom.window.location.hash = '#/notes'; f.dom.window.dispatchEvent(new f.dom.window.HashChangeEvent('hashchange')); }
      else f.dom.window.document.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await settle(() => Boolean(f.signal()?.aborted));
      assert.equal(f.signal()!.aborted, true);
      assert.equal(f.calls.some(call => call.path.endsWith('/login')), false);
      if (namespace === 'author') assert.equal(f.dom.window.document.querySelector('#author-dialog')!.getAttribute('aria-hidden'), 'true');
    } finally { f.dom.window.close(); }
  }
});
