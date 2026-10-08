import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createStableCommunityFrame } from '../../src/community-layout/stable-frame.ts';
import { nameLabelHTML, whoHTML, type CommunityPerson } from '../../src/community.ts';

interface TestWindow extends Window {
  close(): void;
  Event: typeof Event;
  IntersectionObserver: typeof IntersectionObserver;
}
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => { window: TestWindow };
};
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><style>.glow{animation:glow 4s linear infinite}@keyframes glow{to{opacity:.6}}</style><defs><linearGradient id="motion-gradient"><stop stop-color="#fff"/></linearGradient></defs><circle class="glow" cx="100" cy="100" r="50" fill="url(#motion-gradient)"/></svg>';
const reply = () => new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
const person: CommunityPerson = { name: '测试读者', uid: '10001', role: 'reader', level: 3, vip: true,
  growth: { level: 10, points: 72000, configured: true },
  vipGrowth: { active: true, level: 8, days: 365, nextDays: null, remaining: 0, multiplier: 1, progress: 1 } };
const common = { t: (zh: string) => zh, esc: (value?: unknown) => String(value ?? ''), icons: {} };
const headerTemplate = (name = person.name, unread = 0) => `<header id="site-header"><div class="community-brand-group">社区</div><nav id="navigation" class="nav community-nav"><a href="#/community/home">首页</a></nav><div class="header-actions">${nameLabelHTML({ ...person, name }, common)}<button aria-label="通知">通知<span class="community-nav-dot">${unread}</span></button></div></header>`;
const header = headerTemplate();
const page = `<section data-community="member"><p>${whoHTML(person, common)}</p><form><textarea>未发送的回复</textarea></form></section>`;
const summary = '<section data-community="home"><div class="community-banner-side"><dl class="community-stats"><dd>1</dd></dl></div></section>';

function setup(t: TestContext, mobile: boolean, supplied?: typeof fetch) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { window } = new JSDOM(`<body class="community-open">${header}<main id="main"></main></body>`, { url: 'http://localhost/#/community/u/10001/badges', pretendToBeVisual: true });
  window.matchMedia = (query: string) => ({
    matches: mobile && query.includes('max-width'), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true,
  });
  const observers: Observer[] = [];
  const rect: DOMRectReadOnly = { x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200, toJSON: () => ({}) };
  class Observer implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly thresholds = [0];
    readonly targets = new Set<Element>();
    disconnected = false;
    private callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) { this.callback = callback; observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    enter(targets = [...this.targets]) {
      this.callback(targets.map(target => ({ target, time: 0, isIntersecting: true, intersectionRatio: 1,
        boundingClientRect: rect, intersectionRect: rect, rootBounds: null })), this);
    }
  }
  window.IntersectionObserver = Observer;
  const calls: string[] = [];
  const request: typeof fetch = async (input, init) => { calls.push(String(input)); return supplied ? supplied(input, init) : reply(); };
  const frame = createStableCommunityFrame(window.document, window, request);
  const main = window.document.getElementById('main')!;
  frame.render(main, page, summary);
  const marks = [...window.document.querySelectorAll<HTMLElement>('.community-level-marks [data-level-icon]')];
  assert.equal(marks.length, 6, 'the fixture includes growth, trust and VIP marks in both the real header and content');
  const images = marks.map(mark => mark.querySelector('img')!);
  const canvas = (mark: HTMLElement) => mark.querySelector<HTMLElement>('.community-level-motion-canvas');
  const states = () => marks.map(mark => canvas(mark)?.style.getPropertyValue('--community-level-play-state'));
  const host = mobile ? window.document.documentElement : frame.center()!;
  // Model actual user input, which cancels the frame's pending layout restore.
  const input = () => host.dispatchEvent(new window.Event(mobile ? 'touchstart' : 'wheel', { bubbles: true }));
  const scroll = (top: number) => {
    host.scrollTop = top;
    (mobile ? window.document : host).dispatchEvent(new window.Event('scroll'));
  };
  const enter = async () => {
    await turn();
    assert.equal(observers.reduce((count, observer) => count + observer.targets.size, 0), 6, 'the frame observes compact header and content marks');
    for (const observer of observers) observer.enter();
    await turn(); await turn();
  };
  t.after(() => { frame.dispose(); window.close(); });
  return { window, frame, main, marks, images, canvas, states, host, input, scroll, enter, calls, observers };
}

for (const mobile of [false, true]) test(`${mobile ? 'mobile document' : 'desktop center'} scrolling pauses header and content marks together, then resumes after the last 600ms`, async t => {
  const x = setup(t, mobile);
  await x.enter();
  const canvases = x.marks.map(mark => x.canvas(mark)!);
  const shadows = canvases.map(canvas => canvas.shadowRoot);
  const content = x.main.querySelector('[data-community]');
  const field = x.main.querySelector<HTMLTextAreaElement>('textarea')!;
  field.focus({ preventScroll: true });
  assert.deepEqual(x.states(), Array(6).fill('running'), 'resting header and body marks are dynamic');
  assert.ok(shadows.every(shadow => shadow?.querySelector('svg')));
  assert.equal(x.window.document.querySelector('#motion-gradient'), null, 'isolated artwork never adds its SVG IDs to the document');
  const requests = x.calls.length;
  x.input();
  x.scroll(0);
  assert.deepEqual(x.states(), Array(6).fill('running'), 'a scroll event without actual movement does not pause artwork');
  x.scroll(100);
  assert.deepEqual(x.states(), Array(6).fill('paused'));
  t.mock.timers.tick(500);
  x.scroll(200);
  t.mock.timers.tick(599);
  assert.deepEqual(x.states(), Array(6).fill('paused'), 'each movement restarts the idle deadline for both locations');
  t.mock.timers.tick(1);
  assert.deepEqual(x.states(), Array(6).fill('running'));
  assert.equal(x.host.scrollTop, 200, 'decoration cannot change the reading position');
  assert.equal(x.main.querySelector('[data-community]'), content);
  assert.equal(x.main.querySelector('textarea'), field);
  assert.equal(field.value, '未发送的回复');
  assert.equal(x.window.document.activeElement, field);
  assert.equal(x.calls.length, requests, 'scrolling never reloads decorative artwork');
  for (let i = 0; i < x.marks.length; i++) {
    assert.equal(x.marks[i].querySelector('img'), x.images[i], 'the static fallback image stays mounted');
    assert.equal(x.canvas(x.marks[i]), canvases[i], 'scrolling never swaps an animated layer or its source node');
    assert.equal(canvases[i].shadowRoot, shadows[i]);
    assert.match(x.images[i].getAttribute('src')!, /\/compact\/[^/]+\.webp$/);
  }
});

test('independent right-rail scrolling pauses both sets of marks without moving or marking the center', async t => {
  const x = setup(t, false);
  await x.enter();
  const canvases = x.marks.map(mark => x.canvas(mark)!);
  const shadows = canvases.map(canvas => canvas.shadowRoot);
  const right = x.main.querySelector<HTMLElement>('[data-frame-right]')!;
  const field = x.main.querySelector<HTMLTextAreaElement>('textarea')!;
  x.input();
  x.host.scrollTop = 240;
  field.focus({ preventScroll: true });
  assert.equal(x.host.hasAttribute('data-frame-scrolling'), false);
  right.scrollTop = 80;
  right.dispatchEvent(new x.window.Event('scroll'));
  assert.deepEqual(x.states(), Array(6).fill('paused'), 'a moving independent rail pauses header and body artwork together');
  assert.equal(x.host.scrollTop, 240);
  assert.equal(x.window.document.activeElement, field);
  assert.equal(x.host.hasAttribute('data-frame-scrolling'), false, 'right-rail activity never marks the center scrollbar as active');
  t.mock.timers.tick(599);
  assert.deepEqual(x.states(), Array(6).fill('paused'));
  t.mock.timers.tick(1);
  assert.deepEqual(x.states(), Array(6).fill('running'));
  assert.equal(x.host.scrollTop, 240);
  assert.equal(x.window.document.activeElement, field);
  assert.equal(field.value, '未发送的回复');
  assert.equal(x.host.hasAttribute('data-frame-scrolling'), false);
  for (let i = 0; i < x.marks.length; i++) {
    assert.equal(x.canvas(x.marks[i]), canvases[i]);
    assert.equal(canvases[i].shadowRoot, shadows[i]);
    assert.equal(x.marks[i].querySelector('img'), x.images[i]);
  }
});

test('an unchanged enhanced header keeps its artwork mounted while real account updates respect the active scroll pause', async t => {
  const x = setup(t, false);
  await x.enter();
  const bar = x.window.document.getElementById('site-header')!;
  const actions = bar.querySelector('.header-actions')!;
  const originalMarks = [...actions.querySelectorAll<HTMLElement>('[data-level-icon]')];
  const canvases = originalMarks.map(mark => x.canvas(mark)!);
  const shadows = canvases.map(canvas => canvas.shadowRoot);
  const requests = x.calls.length;
  assert.equal(x.frame.header(header), true);
  assert.equal(bar.querySelector('.header-actions'), actions, 'enhancement-only fields must not make unchanged account markup look different');
  await turn();
  assert.equal(x.calls.length, requests, 'an unchanged header must not schedule another artwork read');
  for (let i = 0; i < originalMarks.length; i++) {
    assert.equal(originalMarks[i].querySelector('img'), x.images[i]);
    assert.equal(x.canvas(originalMarks[i]), canvases[i]);
    assert.equal(canvases[i].shadowRoot, shadows[i]);
  }
  x.input(); x.scroll(180);
  assert.equal(x.frame.header(headerTemplate('已更新的读者', 2)), true);
  const updated = bar.querySelector('.header-actions')!;
  assert.notEqual(updated, actions, 'real nickname and unread changes still update the header');
  assert.equal(updated.querySelector('.community-uname')!.textContent, '已更新的读者');
  assert.equal(updated.querySelector('.community-nav-dot')!.textContent, '2');
  const newMarks = [...updated.querySelectorAll<HTMLElement>('[data-level-icon]')];
  await turn();
  for (const observer of x.observers) observer.enter(newMarks);
  await turn();
  const assertNotRunning = () => {
    for (const mark of newMarks) assert.notEqual(x.canvas(mark)?.style.getPropertyValue('--community-level-play-state'), 'running', 'new visible header marks cannot outrun the active scroll pause');
  };
  assertNotRunning();
  t.mock.timers.tick(599); assertNotRunning();
  t.mock.timers.tick(1); await turn();
  for (const mark of newMarks) assert.equal(x.canvas(mark)?.style.getPropertyValue('--community-level-play-state'), 'running', 'the updated header joins the same 600ms idle recovery');
  assert.equal(x.host.scrollTop, 180);
});

test('disposing a scrolling frame releases header motion and its pending SVG without a late idle restart', async t => {
  let finish: (response: Response) => void = () => { throw Error('pending SVG request was not started'); };
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  let signal: AbortSignal | null | undefined;
  const x = setup(t, false, async (input, init) => {
    if (String(input).endsWith('/vip-8.svg')) { signal = init?.signal; return pending; }
    return reply();
  });
  await x.enter();
  assert.ok(x.marks.filter(mark => mark.dataset.levelIcon !== 'vip-8').every(mark => x.canvas(mark)), 'completed artwork is already present');
  assert.ok(x.marks.filter(mark => mark.dataset.levelIcon === 'vip-8').every(mark => !x.canvas(mark)), 'a second shared source is still pending');
  x.input(); x.scroll(180);
  t.mock.timers.tick(500);
  x.frame.dispose();
  const bar = x.window.document.getElementById('site-header')!;
  const afterRelease = bar.innerHTML;
  assert.equal(bar.querySelector('.community-level-motion-canvas'), null);
  assert.equal(bar.querySelector('[data-level-motion-ready]'), null);
  assert.ok(x.observers.every(observer => observer.disconnected));
  assert.equal(signal?.aborted, true, 'leaving the frame aborts its unfinished artwork read');
  assert.equal(bar.querySelector('img'), x.images[0]);
  // A detached old scroll host and a queued visibility callback are harmless.
  x.host.scrollTop = 240; x.host.dispatchEvent(new x.window.Event('scroll'));
  for (const observer of x.observers) observer.enter(x.marks);
  finish(reply()); await turn();
  t.mock.timers.tick(1000); await turn();
  assert.equal(bar.innerHTML, afterRelease, 'neither the idle timer nor a late response may revive released header artwork');
  assert.equal(x.main.querySelector('[data-community-frame]'), null);
});
