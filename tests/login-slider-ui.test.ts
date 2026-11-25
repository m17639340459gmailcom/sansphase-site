import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLoginSliderSolver } from '../src/login-verification-library.ts';
import type { SliderLoginChallenge } from '../src/login-verification.ts';

const challenge = (): SliderLoginChallenge => ({ id: 'slider-test-id', token: 'signed-test-token', expiresAt: Math.floor(Date.now() / 1000) + 120, backgroundImage: 'data:image/jpeg;base64,YQ==', templateImage: 'data:image/png;base64,Yg==', backgroundImageWidth: 600, backgroundImageHeight: 360, templateImageWidth: 110, templateImageHeight: 360 });
function fixture() {
  const dom = new JSDOM('<form><input name="email" value="reader@example.test"><input name="password" value="secret"><button data-login-verification-control type="button">验证</button><button type="submit">登录</button></form>', { url: 'https://www.sansphase.com/#/account', pretendToBeVisual: true });
  const form = dom.window.document.querySelector('form')!;
  return { dom, form };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function ready(f: ReturnType<typeof fixture>) {
  const panel = f.form.querySelector<HTMLElement>('[data-login-slider]'); assert.ok(panel);
  for (const image of panel.querySelectorAll('img')) {
    Object.defineProperties(image, { naturalWidth: { configurable: true, value: image.hasAttribute('data-login-slider-background') ? 600 : 110 }, naturalHeight: { configurable: true, value: 360 } });
    image.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: image.hasAttribute('data-login-slider-background') ? 300 : 55, bottom: 180, width: image.hasAttribute('data-login-slider-background') ? 300 : 55, height: 180, toJSON: () => ({}) });
    image.dispatchEvent(new f.dom.window.Event('load'));
  }
  const track = panel.querySelector<HTMLElement>('[data-login-slider-track]')!;
  track.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 40, width: 300, height: 40, toJSON: () => ({}) });
  const thumb = panel.querySelector<HTMLButtonElement>('[data-login-slider-thumb]')!;
  thumb.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 40, bottom: 40, width: 40, height: 40, toJSON: () => ({}) });
  await tick(); return { panel, thumb };
}
function pointer(f: ReturnType<typeof fixture>, element: EventTarget, type: string, x: number, y = 25, id = 7) {
  const event = new f.dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: id }, clientX: { value: x }, clientY: { value: y }, button: { value: 0 }, isPrimary: { value: true } });
  element.dispatchEvent(event);
}
function resizeBackground(panel: HTMLElement, width: number, height: number) {
  panel.querySelector<HTMLImageElement>('[data-login-slider-background]')!.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) });
}

test('real slider records normalized pointer movement and only a verified server response releases a proof', async () => {
  const f = fixture(); const before = f.form.innerHTML; let time = Date.now(), calls = 0; let body: Record<string, unknown> | undefined;
  const solve = createLoginSliderSolver({ now: () => time, request: async (url, init) => { calls++; assert.equal(String(url), '/api/reader/login-challenge/verify'); assert.equal(init?.method, 'POST'); assert.equal(init?.credentials, 'same-origin'); assert.deepEqual(init?.headers, { 'X-Reader-Request': '1', 'Content-Type': 'application/json' }); body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ proof: 'server-approved-proof', expiresAt: Math.floor(time / 1000) + 60 })); } });
  try {
    const solving = solve(f.form, challenge(), new AbortController().signal, 'reader'); const { panel, thumb } = await ready(f);
    assert.equal(calls, 0); assert.equal(thumb.disabled, false); assert.equal(thumb.getAttribute('role'), 'slider');
    pointer(f, thumb, 'pointerdown', 60, 25);
    for (let n = 1; n <= 12; n++) { time += 40; pointer(f, f.dom.window, 'pointermove', 60 + n * 8, 25 + n % 3); }
    time += 40; pointer(f, f.dom.window, 'pointerup', 156, 27);
    assert.equal(await solving, 'server-approved-proof'); assert.equal(calls, 1); assert.equal(f.form.innerHTML, before); assert.equal(panel.isConnected, false);
    assert.ok(body); assert.deepEqual(Object.keys(body).sort(), ['token', 'track']); assert.equal(body.token, 'signed-test-token');
    const track = body.track as { bgImageWidth: number; bgImageHeight: number; templateImageWidth: number; templateImageHeight: number; left: number; top: number; startTime: number; stopTime: number; trackList: { x: number; y: number; t: number; type: string }[] };
    assert.equal(track.bgImageWidth, 300); assert.equal(track.bgImageHeight, 180); assert.equal(track.templateImageWidth, 55); assert.equal(track.templateImageHeight, 180); assert.equal(track.top, 0);
    assert.deepEqual(track.trackList[0], { x: 0, y: 0, t: 0, type: 'DOWN' }); assert.equal(track.trackList.length, 14); assert.equal(track.trackList.at(-1)?.type, 'UP'); assert.equal(track.left, track.trackList.at(-1)!.x - track.trackList[0].x, 'Tianai checks the actual pointer displacement, so the rendered piece must use the same coordinates'); assert.equal(track.stopTime - track.startTime, 520);
    assert.equal(JSON.stringify(body).includes('reader@example.test'), false); assert.equal(JSON.stringify(body).includes('secret'), false); assert.equal(f.dom.window.localStorage.length, 0);
  } finally { f.dom.window.close(); }
});

test('fractional pointer coordinates render and submit the same rounded piece displacement', async () => {
  const f = fixture(); let submitted: unknown;
  const solve = createLoginSliderSolver({ request: async (_url, init) => { submitted = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ proof: 'fractional-proof', expiresAt: Math.floor(Date.now() / 1000) + 60 })); } });
  try {
    const solving = solve(f.form, challenge(), new AbortController().signal, 'reader'); const { thumb, panel } = await ready(f);
    pointer(f, thumb, 'pointerdown', 52.25); pointer(f, f.dom.window, 'pointermove', 102.65);
    assert.equal(panel.querySelector<HTMLImageElement>('[data-login-slider-template]')!.style.transform, 'translateX(50px)');
    pointer(f, f.dom.window, 'pointerup', 102.65); await solving;
    const body = submitted as { track: { left: number; trackList: { x: number }[] } };
    assert.equal(Number.isInteger(body.track.left), true); assert.equal(body.track.left, 50); assert.ok(Math.abs(body.track.left - body.track.trackList.at(-1)!.x) < 1);
  } finally { f.dom.window.close(); }
});

test('server rejection or malformed proof fails closed and removes the slider without changing credentials', async () => {
  for (const response of [new Response('{}', { status: 403 }), new Response('{}'), new Response(JSON.stringify({ proof: 'stale', expiresAt: 1 }))]) {
    const f = fixture(); const solve = createLoginSliderSolver({ request: async () => response });
    try { const solving = solve(f.form, challenge(), new AbortController().signal, 'author'); const { thumb } = await ready(f); pointer(f, thumb, 'pointerdown', 0); pointer(f, f.dom.window, 'pointermove', 50); pointer(f, f.dom.window, 'pointerup', 50); await assert.rejects(solving, /验证|重试/); assert.equal(f.form.querySelector('[data-login-slider]'), null); assert.equal(f.form.querySelector<HTMLInputElement>('[name="password"]')!.value, 'secret'); }
    finally { f.dom.window.close(); }
  }
});

test('refresh, cancel, navigation and aborted requests remove the panel and release pointer capture', async () => {
  for (const action of ['refresh', 'cancel', 'navigation', 'abort', 'detach']) {
    const f = fixture(); const controller = new AbortController(); let captured = 0, released = 0, calls = 0;
    const solve = createLoginSliderSolver({ request: async () => { calls++; return new Promise(() => {}); } });
    try {
      const solving = solve(f.form, challenge(), controller.signal, 'reader'); const { panel, thumb } = await ready(f);
      thumb.setPointerCapture = () => { captured++; }; thumb.hasPointerCapture = () => true; thumb.releasePointerCapture = () => { released++; };
      pointer(f, thumb, 'pointerdown', 40);
      if (action === 'refresh' || action === 'cancel') panel.querySelector<HTMLButtonElement>(`[data-login-slider-${action}]`)!.click();
      else if (action === 'navigation') { f.dom.window.location.hash = '#/notes'; f.dom.window.dispatchEvent(new f.dom.window.Event('hashchange')); }
      else if (action === 'detach') f.form.remove(); else controller.abort();
      await assert.rejects(solving, error => error instanceof Error && (action === 'refresh' ? error.name === 'LoginVerificationRefreshError' : action === 'cancel' ? error.name === 'LoginVerificationCancelledError' : error.name === 'AbortError'));
      assert.equal(captured, 1); assert.equal(released, 1); assert.equal(panel.isConnected, false); assert.equal(calls, 0);
      pointer(f, f.dom.window, 'pointerup', 100); await tick(); assert.equal(calls, 0);
    } finally { f.dom.window.close(); }
  }
});

test('keyboard arrows record actual key actions, Enter asks the server, and Escape cancels', async () => {
  const f = fixture(); let time = Date.now(), calls = 0; let submitted: unknown;
  const solve = createLoginSliderSolver({ now: () => time, request: async (_url, init) => { calls++; submitted = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ proof: 'keyboard-proof', expiresAt: Math.floor(time / 1000) + 60 })); } });
  try {
    const solving = solve(f.form, challenge(), new AbortController().signal, 'author'); const { thumb } = await ready(f);
    for (let n = 0; n < 11; n++) { time += 50; thumb.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); }
    assert.equal(calls, 0); time += 50; thumb.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(await solving, 'keyboard-proof'); const body = submitted as { track: { trackList: unknown[] } }; assert.equal(body.track.trackList.length, 13, 'no synthetic extra movement points');
    const again = solve(f.form, challenge(), new AbortController().signal, 'reader'); const { thumb: second } = await ready(f); second.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await assert.rejects(again, { name: 'LoginVerificationCancelledError' });
  } finally { f.dom.window.close(); }
});

test('cancelling restores the form scroll containers without clearing credentials', async () => {
  const f = fixture(); const parent = f.dom.window.document.createElement('div'); f.form.replaceWith(parent); parent.append(f.form);
  let y = 40; const movements: number[] = [];
  Object.defineProperty(f.dom.window, 'scrollY', { get: () => y });
  f.dom.window.scrollTo = (options: unknown) => { y = (options as ScrollToOptions).top ?? y; movements.push(y); };
  parent.scrollTop = 20; parent.scrollTo = (options: unknown) => { parent.scrollTop = (options as ScrollToOptions).top ?? parent.scrollTop; };
  try {
    const solving = createLoginSliderSolver()(f.form, challenge(), new AbortController().signal, 'reader'); const { panel } = await ready(f);
    y = 300; parent.scrollTop = 160;
    panel.querySelector<HTMLButtonElement>('[data-login-slider-cancel]')!.click();
    await assert.rejects(solving, { name: 'LoginVerificationCancelledError' });
    assert.deepEqual(movements, [40]); assert.equal(parent.scrollTop, 20);
    assert.equal(f.form.querySelector<HTMLInputElement>('[name="email"]')!.value, 'reader@example.test');
    // A deferred focus restoration must not steal newly chosen input focus.
    const email = f.form.querySelector<HTMLInputElement>('[name="email"]')!; email.focus();
    await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(f.dom.window.document.activeElement, email);
  } finally { f.dom.window.close(); }
});

test('queued hash notifications for the current route leave the visible puzzle usable', async () => {
  const f = fixture();
  try {
    const solving = createLoginSliderSolver()(f.form, challenge(), new AbortController().signal, 'reader');
    const result = solving.then(() => 'resolved', error => error.name);
    const { panel } = await ready(f);
    f.dom.window.dispatchEvent(new f.dom.window.HashChangeEvent('hashchange', {
      oldURL: 'https://www.sansphase.com/#/notes', newURL: f.dom.window.location.href,
    }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(panel.isConnected, true);
    panel.querySelector<HTMLButtonElement>('[data-login-slider-cancel]')!.click();
    assert.equal(await result, 'LoginVerificationCancelledError');
  } finally { f.dom.window.close(); }
});

test('external cancellation and leaving the original route never restore an old page scroll', async () => {
  for (const action of ['abort', 'hashchange', 'pagehide', 'detach']) {
    const f = fixture(), controller = new AbortController(); let y = 40, movements = 0;
    Object.defineProperty(f.dom.window, 'scrollY', { get: () => y });
    f.dom.window.scrollTo = () => { movements++; };
    try {
      const solving = createLoginSliderSolver()(f.form, challenge(), controller.signal, 'reader'); await ready(f); y = 300;
      if (action === 'abort') controller.abort();
      else if (action === 'detach') f.form.remove();
      else { if (action === 'hashchange') f.dom.window.location.hash = '#/notes'; f.dom.window.dispatchEvent(new f.dom.window.Event(action)); }
      await assert.rejects(solving, { name: 'AbortError' }); assert.equal(movements, 0, action);
    } finally { f.dom.window.close(); }
  }
});

test('image loading, interaction and server checks have bounded deadlines and do not auto verify', async () => {
  for (const phase of ['image', 'interaction', 'request']) {
    const f = fixture(); let requestSignal: AbortSignal | undefined;
    const solve = createLoginSliderSolver({ imageTimeoutMs: phase === 'image' ? 10 : 1_000, interactionTimeoutMs: phase === 'interaction' ? 20 : 1_000, verifyTimeoutMs: 15, request: async (_url, init) => { requestSignal = init?.signal ?? undefined; return new Promise(() => {}); } });
    try {
      const solving = solve(f.form, challenge(), new AbortController().signal, 'reader');
      if (phase !== 'image') { const { thumb } = await ready(f); if (phase === 'request') { pointer(f, thumb, 'pointerdown', 0); pointer(f, f.dom.window, 'pointerup', 20); } }
      await assert.rejects(solving, /超时|重试/); assert.equal(f.form.querySelector('[data-login-slider]'), null); if (phase === 'request') assert.equal(requestSignal?.aborted, true); else assert.equal(requestSignal, undefined);
    } finally { f.dom.window.close(); }
  }
});

test('idle resize, phone orientation and missing resize events measure the current image before collecting a new drag', async () => {
  for (const event of ['resize', 'orientationchange', 'no-event']) {
    const f = fixture(); let submitted: unknown;
    const solve = createLoginSliderSolver({ request: async (_url, init) => { submitted = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ proof: 'resized-proof', expiresAt: Math.floor(Date.now() / 1000) + 60 })); } });
    try {
      const solving = solve(f.form, challenge(), new AbortController().signal, 'reader'); const { thumb, panel } = await ready(f);
      resizeBackground(panel, 240, 144); if (event !== 'no-event') f.dom.window.dispatchEvent(new f.dom.window.Event(event));
      pointer(f, thumb, 'pointerdown', 20); pointer(f, f.dom.window, 'pointermove', 100); pointer(f, f.dom.window, 'pointerup', 100);
      assert.equal(await solving, 'resized-proof');
      const body = submitted as { track: { bgImageWidth: number; bgImageHeight: number; templateImageWidth: number; left: number; trackList: { x: number }[] } };
      assert.equal(body.track.bgImageWidth, 240, event); assert.equal(body.track.bgImageHeight, 144, event); assert.equal(body.track.templateImageWidth, 44, event); assert.equal(body.track.left, 80); assert.equal(body.track.trackList.at(-1)!.x, 80);
    } finally { f.dom.window.close(); }
  }
});

test('dragging through a real size change cancels pointer and keyboard attempts without submitting old geometry', async () => {
  for (const action of ['pointer-resize', 'pointer-up-before-resize-event', 'keyboard-orientation']) {
    const f = fixture(); let calls = 0, released = 0;
    const solve = createLoginSliderSolver({ request: async () => { calls++; throw new Error('stale geometry must never reach the server'); } });
    try {
      const solving = solve(f.form, challenge(), new AbortController().signal, 'reader'); const { thumb, panel } = await ready(f);
      thumb.setPointerCapture = () => {}; thumb.hasPointerCapture = () => true; thumb.releasePointerCapture = () => { released++; };
      if (action.startsWith('pointer')) { pointer(f, thumb, 'pointerdown', 20); pointer(f, f.dom.window, 'pointermove', 70); }
      else thumb.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      resizeBackground(panel, 240, 144);
      if (action === 'pointer-up-before-resize-event') pointer(f, f.dom.window, 'pointerup', 100);
      else f.dom.window.dispatchEvent(new f.dom.window.Event(action === 'keyboard-orientation' ? 'orientationchange' : 'resize'));
      await assert.rejects(solving, /尺寸.*重新/); assert.equal(calls, 0); assert.equal(panel.isConnected, false); if (action.startsWith('pointer')) assert.equal(released, 1);
      f.dom.window.dispatchEvent(new f.dom.window.Event('resize')); pointer(f, f.dom.window, 'pointerup', 100); await tick(); assert.equal(calls, 0);
    } finally { f.dom.window.close(); }
  }
});

test('ResizeObserver watches the image only, refreshes idle geometry and disconnects when an active resize cancels', async () => {
  const f = fixture(); let notify: (() => void) | undefined, observed: Element | undefined, disconnected = 0, calls = 0;
  class TestResizeObserver {
    constructor(callback: ResizeObserverCallback) { notify = () => callback([], this as unknown as ResizeObserver); }
    observe(target: Element) { observed = target; }
    disconnect() { disconnected++; }
  }
  Object.defineProperty(f.dom.window, 'ResizeObserver', { value: TestResizeObserver });
  const solve = createLoginSliderSolver({ request: async () => { calls++; throw new Error('must never send a stale track'); } });
  try {
    const solving = solve(f.form, challenge(), new AbortController().signal, 'reader'); const { thumb, panel } = await ready(f);
    assert.equal(observed, panel.querySelector('[data-login-slider-background]')); assert.ok(notify);
    resizeBackground(panel, 240, 144); notify();
    pointer(f, thumb, 'pointerdown', 20); pointer(f, f.dom.window, 'pointermove', 70);
    resizeBackground(panel, 280, 168); notify(); await assert.rejects(solving, /尺寸.*重新/);
    assert.equal(disconnected, 1); assert.equal(calls, 0); assert.equal(panel.isConnected, false); notify(); assert.equal(disconnected, 1);
  } finally { f.dom.window.close(); }
});

test('resize during a pending server check aborts it and cannot apply a late approval', async () => {
  const f = fixture(); let requestSignal: AbortSignal | undefined, reply: ((response: Response) => void) | undefined;
  const solve = createLoginSliderSolver({ request: async (_url, init) => { requestSignal = init?.signal ?? undefined; return new Promise(resolve => { reply = resolve; }); } });
  try {
    const solving = solve(f.form, challenge(), new AbortController().signal, 'reader'); const { thumb, panel } = await ready(f);
    pointer(f, thumb, 'pointerdown', 20); pointer(f, f.dom.window, 'pointermove', 90); pointer(f, f.dom.window, 'pointerup', 90); assert.ok(reply); assert.equal(requestSignal?.aborted, false);
    resizeBackground(panel, 240, 144); f.dom.window.dispatchEvent(new f.dom.window.Event('resize'));
    await assert.rejects(solving, /尺寸.*重新/); assert.equal(requestSignal?.aborted, true); reply(new Response(JSON.stringify({ proof: 'late-proof', expiresAt: Math.floor(Date.now() / 1000) + 60 }))); await tick(); assert.equal(panel.isConnected, false);
  } finally { f.dom.window.close(); }
});

test('real slider tolerates device skew and clock corrections while keeping genuine movement duration', async () => {
  const originalNow = Date.now, serverTime = originalNow();
  for (const offset of [-86_400_000, -300_000, -5_000, 5_000, 300_000, 86_400_000]) {
    const f = fixture(); let elapsed = 0, deviceOffset = offset, submitted: unknown;
    const value = { ...challenge(), expiresAt: Math.floor(serverTime / 1000) + 120 };
    Date.now = () => serverTime + deviceOffset;
    const solve = createLoginSliderSolver({ now: () => elapsed, request: async (_url, init) => {
      submitted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ proof: 'server-approved-proof', expiresAt: Math.floor(serverTime / 1000) + 90 }), { headers: { Date: new Date(serverTime).toUTCString() } });
    } });
    try {
      const solving = solve(f.form, value, new AbortController().signal, 'reader', () => 120_000 - elapsed);
      const { thumb } = await ready(f); pointer(f, thumb, 'pointerdown', 40);
      for (let n = 1; n <= 12; n++) {
        elapsed += 40; if (n === 6) deviceOffset = -offset;
        pointer(f, f.dom.window, 'pointermove', 40 + n * 8, 25 + n % 3);
      }
      elapsed += 40; pointer(f, f.dom.window, 'pointerup', 136);
      assert.equal(await solving, 'server-approved-proof', `offset ${offset}`);
      const track = (submitted as { track: { startTime: number; stopTime: number; trackList: { t: number }[] } }).track;
      assert.equal(track.startTime, serverTime + offset, 'track retains its initial epoch-shaped timestamp');
      assert.equal(track.stopTime - track.startTime, 520, 'wall clock correction cannot alter drag duration');
      assert.equal(track.trackList.at(-1)!.t, 520);
      assert.ok(track.trackList.every((point, index, points) => index === 0 || point.t >= points[index - 1].t));
    } finally { Date.now = originalNow; f.dom.window.close(); }
  }
});

test('server-expired proof and transport-expired proof remain rejected even with a slow device clock', async () => {
  const originalNow = Date.now, serverTime = Math.floor(originalNow() / 1000) * 1000;
  for (const phase of ['server-expired', 'transport-expired'] as const) {
    const f = fixture(); let elapsed = 0;
    const value = { ...challenge(), expiresAt: serverTime / 1000 + 120 };
    Date.now = () => serverTime - 86_400_000;
    const solve = createLoginSliderSolver({ now: () => elapsed, request: async () => {
      const response = new Response(JSON.stringify({ proof: 'expired-proof', expiresAt: serverTime / 1000 + (phase === 'server-expired' ? 50 : 1) }), { headers: { Date: new Date(serverTime + (phase === 'server-expired' ? 60_000 : 0)).toUTCString() } });
      const read = response.json.bind(response);
      response.json = async () => { if (phase === 'transport-expired') elapsed += 1_100; return read(); };
      return response;
    } });
    try {
      const solving = solve(f.form, value, new AbortController().signal, 'reader', () => 120_000 - elapsed);
      const { thumb } = await ready(f); pointer(f, thumb, 'pointerdown', 0); elapsed += 500; pointer(f, f.dom.window, 'pointerup', 50);
      await assert.rejects(solving, /验证响应无效/); assert.equal(f.form.querySelector('[data-login-slider]'), null);
      assert.equal(f.form.querySelector<HTMLInputElement>('[name="password"]')!.value, 'secret');
    } finally { Date.now = originalNow; f.dom.window.close(); }
  }
});

test('missing server Date uses bounded interaction time rather than rejecting an otherwise valid proof by device date', async () => {
  const f = fixture(), originalNow = Date.now, serverTime = originalNow();
  const value = { ...challenge(), expiresAt: Math.floor(serverTime / 1000) + 120 };
  Date.now = () => serverTime + 86_400_000;
  try {
    const solve = createLoginSliderSolver({ request: async () => new Response(JSON.stringify({ proof: 'fallback-proof', expiresAt: Math.floor(serverTime / 1000) + 90 })) });
    const solving = solve(f.form, value, new AbortController().signal, 'reader');
    const { thumb } = await ready(f); pointer(f, thumb, 'pointerdown', 0); pointer(f, f.dom.window, 'pointerup', 50);
    assert.equal(await solving, 'fallback-proof');
    await assert.rejects(solve(f.form, value, new AbortController().signal, 'reader', () => 0), /过期/);
    assert.equal(f.form.querySelector('[data-login-slider]'), null);
  } finally { Date.now = originalNow; f.dom.window.close(); }
});
