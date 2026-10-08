import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import postcss from 'postcss';
import { createCommunityLevelMotion } from '../../src/community-layout/level-motion.ts';
import { communityGrowthArtHTML, communityTrustArtHTML } from '../../src/community-growth-art.ts';

interface TestWindow extends Window {
  Event: typeof Event;
  MutationObserver: typeof MutationObserver;
  IntersectionObserver: typeof IntersectionObserver;
}
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => { window: TestWindow };
};
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><style>.spin{animation:spin 4s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style><defs><linearGradient id="paint"><stop stop-color="#fff"/></linearGradient></defs><circle class="spin" r="50" fill="url(#paint)"/></svg>';
const reply = (body = svg, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'image/svg+xml' } });
const turn = () => new Promise(resolve => setImmediate(resolve));

function setup(html: string, fetcher: typeof fetch = async () => reply()) {
  const { window } = new JSDOM(html, { url: 'http://localhost/#/community/home', pretendToBeVisual: true });
  let notify: IntersectionObserverCallback = () => {};
  const targets = new Set<Element>();
  let disconnected = false;
  class Observer implements IntersectionObserver {
    root = null; rootMargin = '0px'; thresholds = [0];
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe(target: Element) { targets.add(target); }
    unobserve(target: Element) { targets.delete(target); }
    disconnect() { targets.clear(); disconnected = true; }
    takeRecords() { return []; }
  }
  window.IntersectionObserver = Observer;
  let reduced = false;
  const motionListeners = new Set<() => void>();
  window.matchMedia = () => ({ get matches() { return reduced; }, addEventListener: (_: string, listener: () => void) => motionListeners.add(listener), removeEventListener: (_: string, listener: () => void) => motionListeners.delete(listener) }) as unknown as MediaQueryList;
  let hidden = false;
  Object.defineProperty(window.document, 'hidden', { get: () => hidden });
  const controller = createCommunityLevelMotion(window.document, fetcher);
  const mark = (index = 0) => window.document.querySelectorAll<HTMLElement>('[data-level-icon]')[index];
  const canvas = (index = 0) => mark(index).querySelector<HTMLElement>('.community-level-motion-canvas');
  const visible = (target: Element, value: boolean) => notify([{ target, isIntersecting: value, intersectionRatio: value ? 1 : 0 } as IntersectionObserverEntry], {} as IntersectionObserver);
  return { window, controller, mark, canvas, targets, disconnected: () => disconnected,
    visible, motion: (value: boolean) => { reduced = value; for (const listener of motionListeners) listener(); },
    hide: (value: boolean) => { hidden = value; window.document.dispatchEvent(new window.Event('visibilitychange')); },
    close: () => { controller.release(); window.close(); } };
}
const marks = (art: string) => `<span class="community-level-marks">${art}</span>`;

test('visible duplicate marks share one bounded SVG load and isolate IDs and animation styles', async () => {
  const calls: string[] = [];
  const x = setup(`<header>${marks(communityGrowthArtHTML(10, true))}</header><main>${marks(communityGrowthArtHTML(10, true))}</main>`, async input => { calls.push(String(input)); return reply(); });
  try {
    assert.equal(calls.length, 0, 'offscreen marks do not load dynamic artwork');
    const images = [x.mark(0).firstElementChild, x.mark(1).firstElementChild];
    x.visible(x.mark(0), true); x.visible(x.mark(1), true); await turn();
    assert.deepEqual(calls, ['/assets/community/levels/constellation-g10.svg']);
    assert.equal(x.targets.size, 2);
    for (let i = 0; i < 2; i++) {
      const shadow = x.canvas(i)!.shadowRoot!;
      assert.equal(shadow.querySelectorAll('#paint').length, 1);
      assert.match(shadow.textContent!, /animation-play-state:\s*var\(--community-level-play-state,\s*paused\)/);
      assert.equal(x.canvas(i)!.style.getPropertyValue('--community-level-play-state'), 'running');
      assert.equal(x.mark(i).firstElementChild, images[i], 'fallback image remains the same node');
    }
    assert.equal(x.window.document.querySelector('#paint'), null, 'SVG IDs never leak into the main document');
    const shadows = [x.canvas(0)!.shadowRoot, x.canvas(1)!.shadowRoot];
    x.controller.pause();
    assert.equal(x.canvas(0)!.style.getPropertyValue('--community-level-play-state'), 'paused');
    assert.equal(x.canvas(1)!.style.getPropertyValue('--community-level-play-state'), 'paused');
    x.controller.resume();
    assert.equal(x.canvas(0)!.shadowRoot, shadows[0]);
    assert.equal(x.canvas(1)!.shadowRoot, shadows[1]);
    assert.equal(calls.length, 1, 'pause and resume do not reload or replace artwork');
  } finally { x.close(); }
});

test('a late SVG response during scrolling waits until idle before mounting artwork', async () => {
  let resolve: (response: Response) => void = () => { throw Error('request did not start'); };
  const response = new Promise<Response>(done => { resolve = done; });
  const x = setup(marks(communityTrustArtHTML(3, true)), async () => response);
  try {
    x.visible(x.mark(), true); x.controller.pause(); resolve(reply()); await turn();
    assert.equal(x.canvas(), null, 'a network response must not add SVG nodes during scrolling');
    x.controller.resume();
    const canvas = x.canvas()!;
    assert.equal(canvas.style.getPropertyValue('--community-level-play-state'), 'running');
    x.controller.pause(); x.controller.resume();
    assert.equal(x.canvas(), canvas, 'subsequent scrolling only pauses the already-mounted SVG');
  } finally { x.close(); }
});

test('visibility, background tabs and reduced motion never undo a scroll pause', async () => {
  const x = setup(marks(communityTrustArtHTML(3, true)));
  try {
    x.visible(x.mark(), true); await turn();
    const state = () => x.canvas()!.style.getPropertyValue('--community-level-play-state');
    x.visible(x.mark(), false); assert.equal(state(), 'paused');
    x.visible(x.mark(), true); assert.equal(state(), 'running');
    x.hide(true); assert.equal(state(), 'paused');
    x.controller.pause(); x.hide(false); assert.equal(state(), 'paused');
    x.controller.resume(); assert.equal(state(), 'running');
    x.motion(true); assert.equal(state(), 'paused');
    x.controller.pause(); x.motion(false); assert.equal(state(), 'paused');
    x.controller.resume(); assert.equal(state(), 'running');
  } finally { x.close(); }
});

test('a long list keeps at most eighteen warm offscreen SVGs and mounts returning marks only at idle', async () => {
  let requests = 0;
  const x = setup(Array.from({ length: 60 }, () => marks(communityGrowthArtHTML(10, true))).join(''), async () => { requests++; return reply(); });
  try {
    for (let i = 0; i < 60; i++) { x.visible(x.mark(i), true); await turn(); x.visible(x.mark(i), false); }
    assert.ok(x.window.document.querySelectorAll('.community-level-motion-canvas').length <= 18);
    assert.equal(requests, 1, 'eviction does not refetch a shared original asset');
    const firstImage = x.mark().querySelector('img');
    x.controller.pause(); x.visible(x.mark(), true);
    assert.equal(x.canvas(), null, 'returning offscreen art stays static throughout scrolling');
    x.controller.resume();
    assert.equal(x.canvas()!.style.getPropertyValue('--community-level-play-state'), 'running');
    assert.equal(x.mark().querySelector('img'), firstImage);
    assert.equal(requests, 1);
  } finally { x.close(); }
});

test('new marks remain static during scrolling and removed marks cannot receive late artwork', async () => {
  let resolve: (response: Response) => void = () => { throw Error('request did not start'); };
  const pending = new Promise<Response>(done => { resolve = done; });
  const calls: string[] = [];
  const x = setup('<main></main>', async input => { calls.push(String(input)); return pending; });
  try {
    x.controller.pause();
    x.window.document.querySelector('main')!.innerHTML = marks(communityTrustArtHTML(3, true)); await turn();
    const mark = x.mark(); x.visible(mark, true); assert.equal(calls.length, 0);
    x.controller.resume(); assert.equal(calls.length, 1);
    mark.remove(); await turn(); resolve(reply()); await turn();
    assert.equal(mark.querySelector('.community-level-motion-canvas'), null);
    assert.equal(x.targets.size, 0);
  } finally { x.close(); }
});

test('failed or active SVG content leaves the original static image visible', async () => {
  for (const body of [svg.replace('<circle', '<script>alert(1)</script><circle'), svg.replace('url(#paint)', 'url(https://example.test/image)'), '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>', '<html>failed</html>']) {
    const x = setup(marks(communityTrustArtHTML(3, true)), async () => reply(body));
    try {
      x.visible(x.mark(), true); await turn();
      assert.equal(x.canvas(), null);
      assert.equal(x.mark().hasAttribute('data-level-motion-ready'), false);
      assert.match(x.mark().querySelector('img')!.src, /compact\/trust-l3\.webp$/);
    } finally { x.close(); }
  }
});

test('only approved compact marks load; unsupported browsers and large detail art stay unchanged', async () => {
  const calls: string[] = [];
  const x = setup(marks(communityTrustArtHTML(3)) + '<span class="community-level-marks"><span data-level-icon="../../other"><img src="/other.webp"></span></span>', async input => { calls.push(String(input)); return reply(); });
  try { assert.equal(x.targets.size, 0); assert.equal(calls.length, 0); } finally { x.close(); }
  const { window } = new JSDOM(marks(communityTrustArtHTML(3, true)), { url: 'http://localhost/#/community/home', pretendToBeVisual: true });
  const controller = createCommunityLevelMotion(window.document, async input => { calls.push(String(input)); return reply(); });
  controller.pause(); controller.resume(); controller.release();
  assert.equal(calls.length, 0); assert.equal(window.document.querySelector('.community-level-motion-canvas'), null); window.close();
});

test('release aborts pending requests and restores static marks without late DOM changes', async () => {
  let resolve: (response: Response) => void = () => { throw Error('request did not start'); };
  const pending = new Promise<Response>(done => { resolve = done; });
  let signal: AbortSignal | null | undefined;
  const x = setup(marks(communityTrustArtHTML(3, true)), async (_input, init) => { signal = init?.signal; return pending; });
  try {
    x.visible(x.mark(), true); x.controller.release();
    assert.equal(signal?.aborted, true); assert.equal(x.disconnected(), true);
    resolve(reply()); await turn();
    assert.equal(x.canvas(), null); assert.equal(x.mark().hasAttribute('data-level-motion-ready'), false);
    x.controller.resume(); assert.equal(x.canvas(), null);
  } finally { x.close(); }
});

test('all 22 original level assets can be controlled without rewriting their original shapes', async () => {
  const files = (await readdir('public/assets/community/levels')).filter(file => /^(?:constellation-g\d+|trust-l\d+|vip-\d+)\.svg$/.test(file));
  assert.equal(files.length, 22);
  for (const file of files) {
    const slug = file.replace('.svg', '');
    const source = await readFile(`public/assets/community/levels/${file}`, 'utf8');
    const x = setup(marks(`<span data-level-icon="${slug}"><img src="/assets/community/levels/compact/${slug}.webp"></span>`), async () => reply(source));
    try {
      x.visible(x.mark(), true); await turn();
      const shadow = x.canvas()!.shadowRoot!;
      assert.equal(shadow.querySelector('svg')!.getAttribute('viewBox'), '0 0 200 200');
      assert.ok(shadow.querySelector('style')!.textContent!.includes('@keyframes'));
      const controlledSvg = shadow.querySelector('svg')!;
      const control = postcss.parse(shadow.querySelector('style:last-child')!.textContent!);
      let controlSelector = '';
      control.walkRules(rule => {
        if (rule.nodes.some(node => node.type === 'decl' && node.prop === 'animation-play-state')) controlSelector = rule.selector;
      });
      assert.equal(controlledSvg.hasAttribute('data-level-motion-svg'), true);
      assert.equal(controlSelector, ':host svg[data-level-motion-svg], :host svg[data-level-motion-svg] *');
      // animation shorthand resets play-state to running. Its specificity must
      // stay below the control rule's (0, 2, 1), even though it appears earlier.
      postcss.parse(controlledSvg.querySelector('style')!.textContent!).walkRules(rule => {
        if (!rule.nodes.some(node => node.type === 'decl' && /^(animation|animation-play-state)$/.test(node.prop))) return;
        if (rule.parent?.type === 'atrule' && rule.parent.name === 'media') return;
        assert.ok(rule.nodes.every(node => node.type !== 'decl' || !/^(animation|animation-play-state)$/.test(node.prop) || !node.important), `${file} must not bypass shared playback with an important animation`);
        for (const selector of rule.selectors) {
          assert.match(selector, /^(?:\*|(?:\.[\w-]+)+)$/, `review newly introduced animation selectors in ${file}`);
          const classes = selector.match(/\.[\w-]+/g)?.length || 0;
          assert.ok(classes <= 2, `${file}: ${selector} cannot override shared playback`);
        }
      });
      x.controller.pause(); assert.equal(x.canvas()!.style.getPropertyValue('--community-level-play-state'), 'paused');
    } finally { x.close(); }
  }
});
