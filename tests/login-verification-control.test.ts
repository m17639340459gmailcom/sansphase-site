import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLoginVerificationAcquirer } from '../src/login-verification.ts';
import { createLoginVerificationControlMounter, loginVerificationControlHTML } from '../src/login-verification-control.ts';
import { createLoginSliderSolver } from '../src/login-verification-library.ts';

const challenge = () => ({
  id: 'a'.repeat(32), token: 'signed-test-token', expiresAt: Math.floor(Date.now() / 1000) + 120, backgroundImage: 'data:image/jpeg;base64,YQ==', templateImage: 'data:image/png;base64,Yg==', backgroundImageWidth: 600, backgroundImageHeight: 360, templateImageWidth: 110, templateImageHeight: 360,
});
function fixture() {
  const dom = new JSDOM(`<form><input name="email" type="email" value="reader@example.test"><input name="password" type="password" value="demo-password">${loginVerificationControlHTML()}<button type="submit">登录</button></form>`, { url: 'https://www.sansphase.com/#/account', pretendToBeVisual: true });
  const form = dom.window.document.querySelector('form')!;
  return { dom, form, button: form.querySelector<HTMLButtonElement>('[data-login-verification-control]')!, submit: form.querySelector<HTMLButtonElement>('[type="submit"]')! };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function settle() { await tick(); await tick(); }

test('visible login control initializes without calculating and requires one explicit click before login', async () => {
  const f = fixture(); let requests = 0, loads = 0, solves = 0;
  const acquire = createLoginVerificationAcquirer({
    request: async (url, init) => { requests++; assert.equal(String(url), '/api/reader/login-challenge'); assert.equal(init?.body, '{}'); return new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() })); },
    load: async () => { loads++; return { solveLoginChallenge: async () => { solves++; return 'visible-proof'; } }; },
  });
  const mount = createLoginVerificationControlMounter({ acquire });
  const controller = mount(f.form, 'reader');
  try {
    assert.equal(f.submit.disabled, true); assert.equal(f.button.dataset.state, 'loading');
    await settle(); assert.equal(requests, 1); assert.equal(loads, 0); assert.equal(f.button.dataset.state, 'ready');
    assert.throws(() => controller.consume(), /滑块.*验证/); assert.equal(f.dom.window.document.activeElement, f.button);
    f.button.click(); f.button.click(); await settle();
    assert.equal(loads, 1); assert.equal(solves, 1); assert.equal(requests, 1, 'fresh initial challenge is reused');
    assert.equal(f.button.dataset.state, 'verified'); assert.equal(f.submit.disabled, false);
    assert.equal(controller.consume(), 'visible-proof'); assert.equal(f.submit.disabled, true); assert.equal(f.button.dataset.state, 'ready');
    assert.throws(() => controller.consume(), /提交.*等待/);
    assert.equal(f.dom.window.localStorage.length, 0); assert.equal(f.dom.window.sessionStorage.length, 0);
  } finally { controller.dispose(); f.dom.window.close(); }
});

test('only an explicit disabled response hides the control and preserves the original login', async () => {
  const f = fixture(); let loads = 0;
  const mount = createLoginVerificationControlMounter({ acquire: createLoginVerificationAcquirer({ request: async () => new Response(JSON.stringify({ enabled: false })), load: async () => { loads++; throw new Error('must stay lazy'); } }) });
  const controller = mount(f.form, 'author');
  try { await settle(); assert.equal(f.button.hidden, true); assert.equal(f.button.dataset.state, 'disabled'); assert.equal(f.submit.disabled, false); assert.equal(controller.consume(), null); controller.reset(); controller.sync(); assert.equal(f.submit.disabled, true); controller.release(); assert.equal(f.submit.disabled, false); assert.equal(loads, 0); }
  finally { controller.dispose(); f.dom.window.close(); }
});

test('initial network failure stays closed and a click retries preparation and verification', async () => {
  const f = fixture(); let calls = 0; const errors: string[] = [];
  const mount = createLoginVerificationControlMounter({ acquire: createLoginVerificationAcquirer({ request: async () => ++calls === 1 ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() })), load: async () => ({ solveLoginChallenge: async () => 'retried-proof' }) }) });
  const controller = mount(f.form, 'reader', { onError: message => errors.push(message) });
  try { await settle(); assert.equal(f.button.dataset.state, 'error'); assert.equal(f.button.disabled, false); assert.equal(f.submit.disabled, true); assert.throws(() => controller.consume(), /验证/); f.button.click(); await settle(); assert.equal(f.button.dataset.state, 'verified'); assert.equal(controller.consume(), 'retried-proof'); assert.equal(errors.length, 1); }
  finally { controller.dispose(); f.dom.window.close(); }
});

test('a transport AbortError without an application cancellation leaves a retryable control', async () => {
  const f = fixture(); let requests = 0;
  const acquire = createLoginVerificationAcquirer({
    request: async () => {
      if (++requests === 1) throw new DOMException('Transport interrupted', 'AbortError');
      return new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() }));
    },
    load: async () => ({ solveLoginChallenge: async () => 'retried-proof' }),
  });
  const controller = createLoginVerificationControlMounter({ acquire })(f.form, 'reader');
  try {
    await settle(); assert.equal(f.button.dataset.state, 'error');
    assert.equal(f.button.disabled, false); assert.equal(f.submit.disabled, true);
    f.button.click(); await settle(); assert.equal(controller.consume(), 'retried-proof');
  } finally { controller.dispose(); f.dom.window.close(); }
});

test('email and password changes clear proof and changes during slider interaction cancel quietly', async () => {
  const f = fixture(); let solves = 0; let solvingSignal: AbortSignal | undefined; const errors: string[] = [];
  const mount = createLoginVerificationControlMounter({ acquire: createLoginVerificationAcquirer({ request: async () => new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() })), load: async () => ({ solveLoginChallenge: async (_form, _value, signal) => { solvingSignal = signal; return ++solves === 1 ? 'first-proof' : new Promise(() => {}); } }) }) });
  const controller = mount(f.form, 'reader', { onError: message => errors.push(message) });
  try {
    await settle(); f.button.click(); await settle(); assert.equal(f.submit.disabled, false);
    const email = f.form.querySelector<HTMLInputElement>('[name="email"]')!; email.value = 'other@example.test'; email.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
    assert.equal(f.button.dataset.state, 'ready'); assert.equal(f.submit.disabled, true); assert.throws(() => controller.consume(), /验证/);
    f.button.click(); await settle(); assert.equal(f.button.dataset.state, 'working');
    f.form.querySelector<HTMLInputElement>('[name="password"]')!.dispatchEvent(new f.dom.window.Event('change', { bubbles: true })); await settle();
    assert.equal(solvingSignal?.aborted, true); assert.equal(f.button.dataset.state, 'ready'); assert.equal(errors.length, 0);
  } finally { controller.dispose(); f.dom.window.close(); }
});

test('proof is rechecked against current credentials, expires visibly and cannot enable login after expiry', async () => {
  const f = fixture();
  const mount = createLoginVerificationControlMounter({ proofLifetimeMs: 20, acquire: createLoginVerificationAcquirer({ request: async () => new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() })), load: async () => ({ solveLoginChallenge: async () => 'proof' }) }) });
  const controller = mount(f.form, 'reader');
  try {
    await settle(); f.button.click(); await settle(); assert.equal(f.submit.disabled, false);
    f.form.querySelector<HTMLInputElement>('[name="email"]')!.value = 'autofill@example.test';
    assert.throws(() => controller.consume(), /验证/); assert.equal(f.submit.disabled, true);
    f.button.click(); await settle(); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(f.button.dataset.state, 'ready'); assert.match(f.button.textContent ?? '', /过期/); assert.equal(f.submit.disabled, true); assert.throws(() => controller.consume(), /验证/);
  } finally { controller.dispose(); f.dom.window.close(); }
});

test('near-expiry challenge is refreshed on click and proof deadline is bounded by server expiry', async () => {
  const f = fixture(); let calls = 0, elapsed = 0; const serverTime = Date.now(); let solvedNonce = '';
  const makeChallenge = () => { const value = challenge(); value.id = (++calls === 1 ? 'a' : 'd').repeat(32); value.expiresAt = Math.floor((serverTime + (calls === 1 ? 4_000 : 20_000)) / 1000); return value; };
  const mount = createLoginVerificationControlMounter({ now: () => elapsed, acquire: createLoginVerificationAcquirer({ now: () => elapsed, request: async () => new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: makeChallenge() }), { headers: { Date: new Date(serverTime).toUTCString() } }), load: async () => ({ solveLoginChallenge: async (_form, value) => { solvedNonce = value.id; return 'proof'; } }) }) });
  const controller = mount(f.form, 'reader');
  try { await settle(); f.button.click(); await settle(); assert.equal(calls, 2); assert.equal(solvedNonce, 'd'.repeat(32)); assert.equal(f.submit.disabled, false); elapsed += 16_000; controller.sync(); assert.equal(f.submit.disabled, true); assert.throws(() => controller.consume(), /验证/); }
  finally { controller.dispose(); f.dom.window.close(); }
});

test('mount is idempotent, navigation and detached forms cancel work without reporting an error', async () => {
  for (const action of ['hashchange', 'pagehide', 'detach', 'dispose']) {
    const f = fixture(); const signals: AbortSignal[] = []; const errors: string[] = []; let calls = 0;
    const mount = createLoginVerificationControlMounter({ acquire: createLoginVerificationAcquirer({ request: async () => { calls++; return new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() })); }, load: async () => ({ solveLoginChallenge: async (_form, _value, signal) => { signals.push(signal); return new Promise(() => {}); } }) }) });
    const controller = mount(f.form, 'reader', { onError: message => errors.push(message) });
    try { assert.equal(mount(f.form, 'reader'), controller); await settle(); assert.equal(calls, 1); f.button.click(); await settle(); if (action === 'detach') f.form.remove(); else if (action === 'dispose') controller.dispose(); else { if (action === 'hashchange') f.dom.window.location.hash = '#/notes'; f.dom.window.dispatchEvent(new f.dom.window.Event(action)); } await settle(); assert.equal(signals[0]?.aborted, true, action); assert.equal(errors.length, 0); assert.throws(() => controller.consume(), /取消|验证/); }
    finally { controller.dispose(); f.dom.window.close(); }
  }
});

test('a queued hash notification for the current URL preserves preparation and slider work', async () => {
  for (const namespace of ['reader', 'author'] as const) {
    const f = fixture(); let finishPreparation: ((response: Response) => void) | undefined;
    let finishSolve: ((proof: string) => void) | undefined;
    let requestSignal: AbortSignal | null | undefined, solverSignal: AbortSignal | undefined;
    const acquire = createLoginVerificationAcquirer({
      request: async (_url, init) => { requestSignal = init?.signal; return new Promise<Response>(resolve => { finishPreparation = resolve; }); },
      load: async () => ({ solveLoginChallenge: async (_form, _value, signal) => { solverSignal = signal; return new Promise<string>(resolve => { finishSolve = resolve; }); } }),
    });
    const controller = createLoginVerificationControlMounter({ acquire })(f.form, namespace);
    const notification = () => f.dom.window.dispatchEvent(new f.dom.window.HashChangeEvent('hashchange', {
      oldURL: 'https://www.sansphase.com/#/notes', newURL: f.dom.window.location.href,
    }));
    try {
      notification(); await settle();
      assert.equal(requestSignal?.aborted, false, 'a notification for the mounted route is not a departure');
      finishPreparation?.(new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() })));
      await settle(); assert.equal(f.button.dataset.state, 'ready');
      f.button.click(); await settle(); notification(); await settle();
      assert.equal(solverSignal?.aborted, false, 'the same route must not cancel an active puzzle');
      finishSolve?.('same-route-proof'); await settle();
      assert.equal(controller.consume(), 'same-route-proof');
    } finally { controller.dispose(); f.dom.window.close(); }
  }
});

test('back-forward cache restores a fresh preparation instead of retaining a stopped loading control', async () => {
  const f = fixture(); let requests = 0; let stoppedSignal: AbortSignal | null | undefined;
  const acquire = createLoginVerificationAcquirer({
    request: async (_url, init) => {
      if (++requests === 1) { stoppedSignal = init?.signal; return new Promise<Response>(() => {}); }
      return new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() }));
    },
    load: async () => ({ solveLoginChallenge: async () => 'restored-proof' }),
  });
  const mount = createLoginVerificationControlMounter({ acquire });
  const controller = mount(f.form, 'reader');
  try {
    f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pagehide', { persisted: true }));
    await settle(); assert.equal(stoppedSignal?.aborted, true);
    assert.equal(f.submit.disabled, true);
    f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    await settle(); assert.equal(requests, 2);
    assert.equal(mount(f.form, 'reader'), controller, 'restoration keeps the live form controller');
    assert.equal(f.button.dataset.state, 'ready'); assert.equal(f.button.disabled, false);
    assert.throws(() => controller.consume(), /验证/);
    f.button.click(); await settle(); assert.equal(controller.consume(), 'restored-proof');
  } finally { controller.dispose(); f.dom.window.close(); }
});

test('back-forward cache never restores an old proof or duplicates a pending login', async () => {
  for (const pending of [false, true]) {
    const f = fixture(); let requests = 0, proofs = 0;
    const acquire = createLoginVerificationAcquirer({
      request: async () => { requests++; return new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() })); },
      load: async () => ({ solveLoginChallenge: async () => `proof-${++proofs}` }),
    });
    const controller = createLoginVerificationControlMounter({ acquire })(f.form, 'reader');
    try {
      await settle(); f.button.click(); await settle();
      assert.equal(f.submit.disabled, false);
      if (pending) assert.equal(controller.consume(), 'proof-1');
      f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pagehide', { persisted: true }));
      f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pageshow', { persisted: true }));
      await settle(); assert.equal(f.submit.disabled, true);
      assert.throws(() => controller.consume(), /验证|提交.*等待/);
      assert.equal(requests, pending ? 1 : 2, 'a login already in flight must retain its submit lock');
      if (pending) controller.release();
      f.button.click(); await settle();
      assert.equal(controller.consume(), 'proof-2');
    } finally { controller.dispose(); f.dom.window.close(); }
  }
});

test('sync restores validation gate after callers release their submit lock and HTML remains accessible', async () => {
  const f = fixture(); let resolveSolve: ((proof: string) => void) | undefined;
  const mount = createLoginVerificationControlMounter({ acquire: createLoginVerificationAcquirer({ request: async () => new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() })), load: async () => ({ solveLoginChallenge: async () => new Promise<string>(resolve => { resolveSolve = resolve; }) }) }) });
  const controller = mount(f.form, 'reader', { english: () => true });
  try { await settle(); assert.match(f.button.textContent ?? '', /Click for slider verification/); assert.equal(f.button.type, 'button'); assert.equal(f.button.querySelector('input'), null); assert.equal(f.button.getAttribute('aria-live'), 'polite'); f.submit.disabled = false; controller.sync(); assert.equal(f.submit.disabled, true); f.button.click(); await settle(); assert.equal(f.button.disabled, true); assert.equal(f.button.getAttribute('aria-busy'), 'true'); resolveSolve?.('proof'); await settle(); assert.equal(f.button.getAttribute('aria-busy'), 'false'); assert.match(f.button.textContent ?? '', /Verified/); controller.consume(); f.submit.disabled = false; controller.sync(); assert.equal(f.submit.disabled, true); }
  finally { controller.dispose(); f.dom.window.close(); }
});

test('reset during initial preparation cancels it and lets an explicit click prepare again', async () => {
  const f = fixture(); let requests = 0; let initialSignal: AbortSignal | null | undefined;
  const mount = createLoginVerificationControlMounter({ acquire: createLoginVerificationAcquirer({ request: async (_url, init) => { if (++requests === 1) { initialSignal = init?.signal; return new Promise(() => {}); } return new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() })); }, load: async () => ({ solveLoginChallenge: async () => 'proof' }) }) });
  const controller = mount(f.form, 'reader');
  try { controller.reset(); await settle(); assert.equal(initialSignal?.aborted, true); assert.equal(f.button.dataset.state, 'ready'); assert.equal(f.submit.disabled, true); f.button.click(); await settle(); assert.equal(requests, 2); assert.equal(f.button.dataset.state, 'verified'); assert.equal(controller.consume(), 'proof'); }
  finally { controller.dispose(); f.dom.window.close(); }
});

test('failed library load leaves a retryable visible control and does not reuse a failed proof', async () => {
  const f = fixture(); let loads = 0; const errors: string[] = [];
  const mount = createLoginVerificationControlMounter({ acquire: createLoginVerificationAcquirer({ request: async () => new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() })), load: async () => { if (++loads === 1) throw new Error('verification library temporarily unavailable'); return { solveLoginChallenge: async () => 'retry-proof' }; } }) });
  const controller = mount(f.form, 'reader', { onError: message => errors.push(message) });
  try { await settle(); f.button.click(); await settle(); assert.equal(f.button.dataset.state, 'error'); assert.equal(f.button.disabled, false); assert.equal(f.submit.disabled, true); assert.throws(() => controller.consume(), /验证/); f.button.click(); await settle(); assert.equal(loads, 2); assert.equal(f.button.dataset.state, 'verified'); assert.equal(controller.consume(), 'retry-proof'); assert.equal(errors.length, 1); }
  finally { controller.dispose(); f.dom.window.close(); }
});

test('initial request timeout and malformed responses never masquerade as disabled verification', async () => {
  for (const response of ['timeout', 'malformed']) {
    const f = fixture(); const errors: string[] = [];
    const mount = createLoginVerificationControlMounter({ acquire: createLoginVerificationAcquirer({ timeoutMs: 10, request: async () => response === 'timeout' ? new Promise(() => {}) : new Response(JSON.stringify({ enabled: 'false' })), load: async () => { throw new Error('must never load on invalid configuration'); } }) });
    const controller = mount(f.form, 'reader', { onError: message => errors.push(message) });
    try { await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.button.hidden, false); assert.equal(f.button.dataset.state, 'error'); assert.equal(f.submit.disabled, true); assert.throws(() => controller.consume(), /验证/); assert.equal(errors.length, 1); }
    finally { controller.dispose(); f.dom.window.close(); }
  }
});

test('consuming enabled or disabled verification holds both controls locked until the login request releases them', async () => {
  for (const enabled of [true, false]) {
    const f = fixture(); let solves = 0, requests = 0;
    const mount = createLoginVerificationControlMounter({ acquire: createLoginVerificationAcquirer({ request: async () => { requests++; return new Response(JSON.stringify(enabled ? { enabled: true, engine: 'slider', challenge: challenge() } : { enabled: false })); }, load: async () => ({ solveLoginChallenge: async () => { solves++; return 'single-proof'; } }) }) });
    const controller = mount(f.form, 'reader');
    try {
      await settle();
      if (enabled) { f.button.click(); await settle(); }
      assert.equal(f.submit.disabled, false);
      assert.equal(controller.consume(), enabled ? 'single-proof' : null);
      assert.equal(f.submit.disabled, true, 'consume acquires the pending login lock');
      assert.equal(f.button.disabled, true, 'pending login cannot launch another verification');
      controller.sync(); assert.equal(f.submit.disabled, true);
      for (const name of ['email', 'password']) {
        f.form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
        controller.reset(); controller.sync();
        assert.equal(f.submit.disabled, true); assert.equal(f.button.disabled, true);
      }
      assert.throws(() => controller.consume(), /提交|等待/, 'a second consume cannot authorize a concurrent login');
      f.button.dispatchEvent(new f.dom.window.MouseEvent('click', { bubbles: true })); await settle();
      assert.equal(solves, enabled ? 1 : 0, 'pending clicks cannot start another solver');
      assert.equal(requests, 1);
      controller.release();
      assert.equal(f.submit.disabled, enabled, 'enabled mode needs a fresh proof, disabled mode resumes original login');
      if (enabled) { assert.equal(f.button.disabled, false); f.button.click(); await settle(); assert.equal(solves, 2); assert.equal(controller.consume(), 'single-proof'); }
      else assert.equal(controller.consume(), null);
      assert.equal(f.submit.disabled, true); controller.release();
    } finally { controller.dispose(); f.dom.window.close(); }
  }
});

test('slider refresh immediately obtains a fresh puzzle while cancel quietly returns to ready', async () => {
  for (const action of ['LoginVerificationRefreshError', 'LoginVerificationCancelledError']) {
    const f = fixture(); let requests = 0, solves = 0; const errors: string[] = [];
    const acquire = createLoginVerificationAcquirer({ request: async () => { requests++; return new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: challenge() })); }, load: async () => ({ solveLoginChallenge: async () => { solves++; if (solves === 1) { const error = new Error('user action'); error.name = action; throw error; } return 'fresh-proof'; } }) });
    const controller = createLoginVerificationControlMounter({ acquire })(f.form, 'reader', { onError: error => errors.push(error) });
    try {
      await settle(); f.button.click(); await settle(); await settle();
      assert.equal(errors.length, 0);
      if (action === 'LoginVerificationRefreshError') { assert.equal(requests, 2); assert.equal(solves, 2); assert.equal(f.button.dataset.state, 'verified'); assert.equal(controller.consume(), 'fresh-proof'); }
      else { assert.equal(requests, 1); assert.equal(solves, 1); assert.equal(f.button.dataset.state, 'ready'); assert.equal(f.submit.disabled, true); assert.equal(f.button.disabled, false); }
    } finally { controller.dispose(); f.dom.window.close(); }
  }
});

test('device clock offsets and corrections do not reject a server-fresh challenge or proof', async () => {
  const originalNow = Date.now;
  const serverTime = originalNow();
  for (const offset of [-86_400_000, -300_000, -5_000, 5_000, 300_000, 86_400_000]) {
    const f = fixture(); let deviceOffset = offset, calls = 0;
    const value = { ...challenge(), expiresAt: Math.floor(serverTime / 1000) + 120 };
    Date.now = () => serverTime + deviceOffset;
    const acquire = createLoginVerificationAcquirer({
      request: async () => { calls++; return new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: value }), { headers: { Date: new Date(serverTime).toUTCString() } }); },
      load: async () => ({ solveLoginChallenge: async () => { deviceOffset = -offset; return 'clock-tolerant-proof'; } }),
    });
    const controller = createLoginVerificationControlMounter({ acquire })(f.form, 'reader');
    try {
      await settle(); f.button.click(); await settle();
      assert.equal(calls, 1, `offset ${offset} does not cause an unnecessary refresh`);
      assert.equal(f.button.dataset.state, 'verified', `offset ${offset}`);
      deviceOffset += 86_400_000; controller.sync();
      assert.equal(f.submit.disabled, false, 'correcting the wall clock cannot revoke fresh proof');
      assert.equal(controller.consume(), 'clock-tolerant-proof');
    } finally { Date.now = originalNow; controller.dispose(); f.dom.window.close(); }
  }
});

test('monotonic expiry still clears proof after elapsed time even if the device clock goes backwards', async () => {
  const f = fixture(), originalNow = Date.now, serverTime = originalNow(); let elapsed = 0;
  const acquire = createLoginVerificationAcquirer({ now: () => elapsed,
    request: async () => new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: { ...challenge(), expiresAt: Math.floor(serverTime / 1000) + 120 } }), { headers: { Date: new Date(serverTime).toUTCString() } }),
    load: async () => ({ solveLoginChallenge: async () => 'proof' }),
  });
  const controller = createLoginVerificationControlMounter({ acquire, now: () => elapsed })(f.form, 'reader');
  try {
    await settle(); f.button.click(); await settle(); assert.equal(f.submit.disabled, false);
    Date.now = () => serverTime - 86_400_000; elapsed = 85_001; controller.sync();
    assert.equal(f.button.dataset.state, 'ready'); assert.match(f.button.textContent ?? '', /过期/);
    assert.equal(f.submit.disabled, true); assert.throws(() => controller.consume(), /验证/);
  } finally { Date.now = originalNow; controller.dispose(); f.dom.window.close(); }
});

test('actual solver proof transport delay shortens the visible login deadline instead of granting another 85 seconds', async () => {
  const f = fixture(), serverTime = Math.floor(Date.now() / 1000) * 1000; let elapsed = 0;
  const value = { ...challenge(), expiresAt: serverTime / 1000 + 120 };
  const solve = createLoginSliderSolver({ now: () => elapsed, request: async () => {
    elapsed += 15_000;
    return new Response(JSON.stringify({ proof: 'delayed-proof', expiresAt: serverTime / 1000 + 91 }), { headers: { Date: new Date(serverTime + 1_000).toUTCString() } });
  } });
  const acquire = createLoginVerificationAcquirer({ now: () => elapsed,
    request: async () => new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: value }), { headers: { Date: new Date(serverTime).toUTCString() } }),
    load: async () => ({ solveLoginChallenge: solve }),
  });
  const controller = createLoginVerificationControlMounter({ acquire, now: () => elapsed })(f.form, 'reader');
  try {
    await settle(); f.button.click(); await settle();
    for (const image of f.form.querySelectorAll('img')) {
      const background = image.hasAttribute('data-login-slider-background');
      Object.defineProperties(image, { naturalWidth: { configurable: true, value: background ? 600 : 110 }, naturalHeight: { configurable: true, value: 360 } });
      image.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: background ? 300 : 55, bottom: 180, width: background ? 300 : 55, height: 180, toJSON: () => ({}) });
      image.dispatchEvent(new f.dom.window.Event('load'));
    }
    const thumb = f.form.querySelector<HTMLButtonElement>('[data-login-slider-thumb]')!;
    thumb.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    elapsed = 500;
    thumb.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle(); assert.equal(elapsed, 15_500); assert.equal(f.submit.disabled, false);
    elapsed += 69_999; controller.sync(); assert.equal(f.submit.disabled, false);
    elapsed += 2; controller.sync(); assert.equal(f.submit.disabled, true, 'response transit consumes proof lifetime before the existing safety margin');
    assert.match(f.button.textContent ?? '', /过期/); assert.throws(() => controller.consume(), /验证/);
  } finally { controller.dispose(); f.dom.window.close(); }
});
