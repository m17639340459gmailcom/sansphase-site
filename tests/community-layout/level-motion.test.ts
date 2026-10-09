import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import postcss from 'postcss';
import { createCommunityLevelMotion } from '../../src/community-layout/level-motion.ts';
import { communityGrowthArtHTML, communityTrustArtHTML } from '../../src/community-growth-art.ts';
import { communityLevelExplorerHTML } from '../../src/community-level-explorer.ts';
import type { CommunityStardust } from '../../src/community-pages.ts';

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
  const mark = (index = 0) => window.document.querySelectorAll<HTMLElement>('[data-level-icon], [data-staff-art]')[index];
  const canvas = (index = 0) => mark(index).querySelector<HTMLElement>('.community-level-motion-canvas');
  const visible = (target: Element, value: boolean) => notify([{ target, isIntersecting: value, intersectionRatio: value ? 1 : 0 } as IntersectionObserverEntry], {} as IntersectionObserver);
  return { window, controller, mark, canvas, targets, disconnected: () => disconnected,
    visible, motion: (value: boolean) => { reduced = value; for (const listener of motionListeners) listener(); },
    hide: (value: boolean) => { hidden = value; window.document.dispatchEvent(new window.Event('visibilitychange')); },
    close: () => { controller.release(); window.close(); } };
}
const marks = (art: string) => `<span class="community-level-marks">${art}</span>`;
const staffSource = (slug: string, compact = false) => `/assets/community/staff/${compact ? 'compact/' : ''}${slug}.${compact ? 'webp' : 'svg'}?v=staff-20261009-r2`;
const staffMark = (slug: string) => `<span class="${slug.startsWith('frame-') ? 'community-staff-frame' : 'community-staff-art'}" data-staff-art="${slug}"><img class="community-staff-art-image" src="${staffSource(slug, true)}"></span>`;
const catalogueData: CommunityStardust = { balance: 0, gainedToday: 0, behaviourToday: 0, dailyCap: 6, checkedIn: false,
  month: { gained: 0, spent: 0 }, flow: 'all', ledger: [], level: 1, owner: false, steward: false, vip: false, stats: {}, progress: null };
const catalogueCommon = { t: (zh: string) => zh, esc: (value?: unknown) => String(value ?? ''), icons: {} };

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
    assert.equal(x.canvas(0)!.hidden, true, 'scrolling must remove the complex SVG from painting, rather than just freeze its animation');
    assert.equal(x.mark(0).dataset.levelMotionReady, 'paused', 'the compact static image is visible while its original canvas is parked');
    x.controller.resume();
    assert.equal(x.canvas(0)!.hidden, false);
    assert.equal(x.mark(0).dataset.levelMotionReady, 'true');
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

test('staff badges and avatar frames share the existing idle, visibility and bounded warm artwork controller', async () => {
  const slugs = ['badge-assistant', 'badge-moderator', 'badge-general', 'frame-assistant', 'frame-moderator', 'frame-general'];
  const sources = new Map(await Promise.all(slugs.map(async slug => [staffSource(slug), await readFile(`public/assets/community/staff/${slug}.svg`, 'utf8')] as const)));
  const calls: string[] = [];
  const x = setup(slugs.map(staffMark).join('') + staffMark('frame-general'), async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'force-cache');
    assert.equal(init?.redirect, 'error');
    return reply(sources.get(String(input))!);
  });
  try {
    assert.equal(x.targets.size, 7);
    assert.equal(calls.length, 0, 'offscreen staff decorations add no artwork requests');
    const images = [...x.targets].map(mark => mark.firstElementChild);
    for (const mark of x.targets) x.visible(mark, true);
    await turn(); await turn();
    assert.deepEqual([...calls].sort(), slugs.map(slug => staffSource(slug)).sort(), 'repeated staff frames share one bounded source read');
    const canvases = [...x.targets].map((_, index) => x.canvas(index)!);
    for (let i = 0; i < canvases.length; i++) {
      assert.ok(canvases[i]);
      const original = sources.get(staffSource(slugs[i] || 'frame-general'))!;
      assert.equal(canvases[i].shadowRoot!.querySelector('svg')!.getAttribute('viewBox'), i < 3 ? '0 0 240 240' : '0 0 400 400');
      assert.equal(x.mark(i).querySelector('img'), images[i], 'the same static fallback stays mounted');
      assert.match(original, /@keyframes/);
      postcss.parse(canvases[i].shadowRoot!.querySelector('svg style')!.textContent!).walkRules(rule => {
        if (!rule.nodes.some(node => node.type === 'decl' && /^(animation|animation-play-state)$/.test(node.prop))) return;
        if (rule.parent?.type === 'atrule' && rule.parent.name === 'media' && /prefers-reduced-motion:\s*reduce/.test(rule.parent.params)) return;
        assert.ok(rule.nodes.every(node => node.type !== 'decl' || !/^(animation|animation-play-state)$/.test(node.prop) || !node.important), 'staff animations must obey the shared pause rule');
        for (const selector of rule.selectors) {
          assert.match(selector, /^(?:\*|(?:\.[\w-]+)+)$/);
          assert.ok((selector.match(/\.[\w-]+/g)?.length || 0) <= 2, 'staff animation selectors cannot override shared playback');
        }
      });
      assert.equal(canvases[i].style.getPropertyValue('--community-level-play-state'), 'running');
    }
    x.controller.pause();
    x.hide(true); x.hide(false);
    for (const canvas of canvases) assert.equal(canvas.style.getPropertyValue('--community-level-play-state'), 'paused', 'background visibility changes cannot override active scrolling');
    x.controller.resume();
    x.hide(true);
    for (const canvas of canvases) assert.equal(canvas.style.getPropertyValue('--community-level-play-state'), 'paused');
    x.hide(false);
    for (let i = 0; i < canvases.length; i++) {
      assert.equal(x.canvas(i), canvases[i]);
      assert.equal(canvases[i].style.getPropertyValue('--community-level-play-state'), 'running');
    }
    assert.equal(calls.length, 6, 'playback changes never reload staff art');
    x.controller.release();
    assert.equal(x.window.document.querySelector('[data-level-motion-ready]'), null);
    assert.equal(x.window.document.querySelector('.community-level-motion-canvas'), null);
    assert.ok(images.every((image, index) => x.mark(index).firstElementChild === image));
  } finally { x.close(); }
});

test('staff avatar frames obey the shared eighteen-node warm limit and do not mount late responses during scrolling', async () => {
  let resolve: (response: Response) => void = () => { throw Error('staff artwork request not started'); };
  const pending = new Promise<Response>(done => { resolve = done; });
  let calls = 0;
  const x = setup(Array.from({ length: 60 }, () => staffMark('frame-assistant')).join(''), async () => { calls++; return pending; });
  try {
    x.visible(x.mark(), true); x.controller.pause();
    resolve(reply()); await turn();
    assert.equal(x.canvas(), null, 'late staff artwork waits until the scroll pause ends');
    x.controller.resume();
    for (let i = 0; i < 60; i++) { x.visible(x.mark(i), true); await turn(); x.visible(x.mark(i), false); }
    assert.equal(x.window.document.querySelectorAll('.community-level-motion-canvas').length, 18);
    assert.equal(calls, 1);
    x.controller.pause(); x.visible(x.mark(), true);
    assert.equal(x.canvas(), null);
    x.controller.resume();
    assert.ok(x.canvas());
    assert.equal(calls, 1);
  } finally { x.close(); }
});

test('staff-only embedded WebP and local shape references do not relax level SVG validation', async () => {
  const embedded = '<svg xmlns="http://www.w3.org/2000/svg"><defs><image id="art" href="data:image/webp;base64,UklGRgAAAABXRUJQ"/><path id="glyph" d="M0 0L1 1"/><mask id="mask"><use href="#art"/></mask></defs><use href="#glyph"/></svg>';
  const x = setup(staffMark('badge-assistant') + marks(communityTrustArtHTML(3, true)), async () => reply(embedded));
  try {
    x.visible(x.mark(0), true); x.visible(x.mark(1), true); await turn();
    assert.ok(x.canvas(0), 'staff artwork permits only its embedded WebP and local image/path references');
    assert.equal(x.canvas(1), null, 'ordinary level artwork still forbids image/use/mask/href');
  } finally { x.close(); }
  for (const body of [
    embedded.replace('data:image/webp;base64,UklGRgAAAABXRUJQ', 'https://example.test/frame.webp'),
    embedded.replace('data:image/webp;base64,UklGRgAAAABXRUJQ', 'data:image/svg+xml;base64,PHN2Zy8+'),
    embedded.replace('data:image/webp;base64,UklGRgAAAABXRUJQ', 'data:image/webp;base64,PHN2Zy8+'),
    embedded.replace('href="#glyph"', 'href="https://example.test/#glyph"'),
    embedded.replace('href="#glyph"', 'href="#missing"'),
    embedded.replace('<use href="#glyph"/>', '<use href="#self" id="self"/>'),
    embedded.replace('<use href="#glyph"/>', '<script>alert(1)</script>'),
    embedded.replace('<use href="#glyph"/>', '<use href="#glyph" onclick="alert(1)"/>'),
  ]) {
    const rejected = setup(staffMark('badge-assistant'), async () => reply(body));
    try { rejected.visible(rejected.mark(), true); await turn(); assert.equal(rejected.canvas(), null); } finally { rejected.close(); }
  }
});

test('staff art has its own bounded size and release aborts unfinished avatar-frame reads', async () => {
  const body = svg.replace('</svg>', `<!--${'x'.repeat(130 * 1024)}--></svg>`);
  const x = setup(staffMark('frame-general') + marks(communityTrustArtHTML(3, true)), async () => reply(body));
  try {
    x.visible(x.mark(0), true); x.visible(x.mark(1), true); await turn();
    assert.ok(x.canvas(0), 'the real general frame fits within the staff-only 160KB budget');
    assert.equal(x.canvas(1), null, 'the existing 128KB level budget stays unchanged');
  } finally { x.close(); }
  const large = setup(staffMark('frame-general'), async () => reply(svg.replace('</svg>', `<!--${'x'.repeat(161 * 1024)}--></svg>`)));
  try { large.visible(large.mark(), true); await turn(); assert.equal(large.canvas(), null); } finally { large.close(); }
  let resolve: (response: Response) => void = () => { throw Error('staff artwork request not started'); };
  const pending = new Promise<Response>(done => { resolve = done; });
  let signal: AbortSignal | null | undefined;
  const released = setup(staffMark('frame-general'), async (_input, init) => { signal = init?.signal; return pending; });
  try {
    released.visible(released.mark(), true); released.controller.release();
    assert.equal(signal?.aborted, true);
    resolve(reply()); await turn();
    assert.equal(released.canvas(), null);
    released.controller.resume(); assert.equal(released.canvas(), null);
    assert.equal(released.disconnected(), true);
  } finally { released.close(); }
});

test('staff artwork requires approved frame or badge markup and preserves its static fallback after removal', async () => {
  const calls: string[] = [];
  let resolve: (response: Response) => void = () => { throw Error('staff artwork request not started'); };
  const pending = new Promise<Response>(done => { resolve = done; });
  const x = setup('<main></main>', async input => { calls.push(String(input)); return pending; });
  try {
    x.controller.pause();
    x.window.document.querySelector('main')!.innerHTML = [
      staffMark('frame-assistant'),
      staffMark('frame-owner'),
      staffMark('frame-moderator').replace('/staff/compact/frame-moderator.webp', '/other.webp'),
      staffMark('badge-general').replace('class="community-staff-art"', 'class="community-staff-frame"'),
      staffMark('frame-general').replace('frame-general', '../../unapproved'),
    ].join('');
    await turn();
    assert.equal(x.targets.size, 1, 'unknown roles, source paths and mismatched display contracts cannot request dynamic artwork');
    const mark = x.mark();
    const image = mark.querySelector('img');
    x.visible(mark, true);
    assert.equal(calls.length, 0, 'new staff markup cannot load during scrolling');
    x.controller.resume();
    assert.deepEqual(calls, [staffSource('frame-assistant')]);
    mark.remove(); await turn();
    resolve(reply()); await turn();
    assert.equal(x.targets.size, 0);
    assert.equal(mark.querySelector('.community-level-motion-canvas'), null, 'a delayed source cannot recreate removed staff artwork');
    assert.equal(mark.querySelector('img'), image);
  } finally { x.close(); }
});

test('the real management-role carousel uses static artwork under reduced motion and joins badge/frame idle playback', async () => {
  const roles = ['assistant', 'moderator', 'general'];
  const sources = new Map(await Promise.all(roles.flatMap(role => ['badge', 'frame'].map(async kind =>
    [staffSource(`${kind}-${role}`), await readFile(`public/assets/community/staff/${kind}-${role}.svg`, 'utf8')] as const))));
  const readSources = new Set<string>();
  for (const [rank, role] of roles.entries()) {
    const catalogue = communityLevelExplorerHTML(catalogueData, catalogueCommon, { mode: 'staff', growth: null, trust: null, staff: rank });
    const calls: string[] = [];
    const x = setup(catalogue + roles.map(item => staffMark(`frame-${item}`)).join(''), async input => {
      const source = String(input); calls.push(source); readSources.add(source);
      assert.ok(sources.has(source));
      return reply(sources.get(source)!);
    });
    try {
      const selected = x.window.document.querySelector<HTMLElement>('[data-level-preview] [data-staff-art]')!;
      assert.equal(selected.dataset.staffArt, `badge-${role}`);
      assert.equal(selected.dataset.staffRole, role);
      assert.equal(selected.hasAttribute('data-staff-art-slot'), true, 'existing carousel controls and role labels retain their contract');
      assert.equal(selected.querySelector('img')!.getAttribute('src'), staffSource(`badge-${role}`, true));
      assert.equal(x.window.document.querySelector('img[src$=".svg"]'), null, 'reduced motion cannot trigger an uncontrolled animated SVG image');
      const targets = [...x.targets];
      const staticImages = targets.map(target => target.querySelector('img'));
      x.motion(true);
      for (const target of targets) x.visible(target, true);
      await turn();
      assert.equal(calls.length, 0, 'reduced-motion users keep the frozen original artwork without dynamic requests');
      assert.equal(x.window.document.querySelector('.community-level-motion-canvas'), null);
      x.controller.pause(); x.motion(false);
      assert.equal(calls.length, 0, 'changing the motion preference cannot bypass an active scroll pause');
      x.controller.resume(); await turn();
      const canvases = targets.map(target => target.querySelector<HTMLElement>('.community-level-motion-canvas')!);
      assert.ok(canvases.every(canvas => canvas?.style.getPropertyValue('--community-level-play-state') === 'running'));
      assert.equal(calls.length, new Set(targets.map(target => (target as HTMLElement).dataset.staffArt)).size);
      x.controller.pause();
      assert.ok(canvases.every(canvas => canvas.style.getPropertyValue('--community-level-play-state') === 'paused'));
      x.controller.resume();
      for (let i = 0; i < targets.length; i++) {
        assert.equal(targets[i].querySelector('.community-level-motion-canvas'), canvases[i]);
        assert.equal(targets[i].querySelector('img'), staticImages[i]);
      }
    } finally { x.close(); }
  }
  assert.deepEqual([...readSources].sort(), [...sources.keys()].sort(), 'all three catalogue badges and all three role frames use their actual approved SVG sources');
});

test('changing reduced motion after mounting staff art restores static frames and badges without changing level playback or refetching', async () => {
  const slugs = ['badge-assistant', 'badge-moderator', 'badge-general', 'frame-assistant', 'frame-moderator', 'frame-general'];
  const sources = new Map(await Promise.all(slugs.map(async slug =>
    [staffSource(slug), await readFile(`public/assets/community/staff/${slug}.svg`, 'utf8')] as const)));
  const levelSource = await readFile('public/assets/community/levels/trust-l3.svg', 'utf8');
  const calls: string[] = [];
  const x = setup(marks(communityTrustArtHTML(3, true)) + slugs.map(staffMark).join(''), async input => {
    calls.push(String(input));
    return reply(sources.get(String(input)) || levelSource);
  });
  try {
    const targets = [...x.targets];
    const images = targets.map(target => target.querySelector('img'));
    for (const target of targets) x.visible(target, true);
    await turn();
    const original = targets.map((_, index) => x.canvas(index)!);
    assert.ok(original.every(canvas => canvas?.style.getPropertyValue('--community-level-play-state') === 'running'));
    assert.equal(calls.length, 7);
    x.controller.pause(); x.controller.resume();
    for (let i = 0; i < targets.length; i++) assert.equal(x.canvas(i), original[i], 'ordinary scrolling preserves every mounted decoration');
    x.motion(true);
    assert.equal(x.canvas(0), original[0], 'existing level motion keeps its original reduced-motion behavior');
    assert.equal(original[0].style.getPropertyValue('--community-level-play-state'), 'paused');
    for (let i = 1; i < targets.length; i++) {
      assert.equal(x.canvas(i), null, 'the staff SVG white-light keyframes cannot leave an opaque layer when reduced motion disables animation');
      assert.equal(x.mark(i).hasAttribute('data-level-motion-ready'), false, 'the frozen compact image is made visible immediately');
      assert.equal(x.mark(i).querySelector('img'), images[i]);
    }
    x.controller.pause(); x.motion(false);
    assert.equal(x.canvas(0), original[0]);
    assert.equal(original[0].style.getPropertyValue('--community-level-play-state'), 'paused');
    for (let i = 1; i < targets.length; i++) assert.equal(x.canvas(i), null, 'reenabling motion must still wait for the active scroll pause to finish');
    assert.equal(calls.length, 7, 'preference changes preserve the approved template cache');
    x.controller.resume();
    const restored = targets.map((_, index) => x.canvas(index)!);
    assert.equal(restored[0], original[0]);
    for (let i = 1; i < targets.length; i++) {
      assert.ok(restored[i]);
      assert.notEqual(restored[i], original[i], 'a staff SVG is remounted only after leaving reduced motion at idle');
      assert.equal(x.mark(i).querySelector('img'), images[i]);
    }
    x.controller.pause(); x.controller.resume();
    for (let i = 0; i < targets.length; i++) {
      assert.equal(x.canvas(i), restored[i], 'normal subsequent scrolling never rebuilds staff layers');
      assert.equal(restored[i].style.getPropertyValue('--community-level-play-state'), 'running');
    }
    assert.equal(calls.length, 7);
  } finally { x.close(); }
});

test('only the fixed staff artwork revision is enhanced and shared requests cannot return to cached old artwork URLs', async () => {
  const valid = staffMark('frame-moderator');
  const src = staffSource('frame-moderator', true);
  const calls: string[] = [];
  const ineligible = [
    src.replace('?v=staff-20261009-r2', ''),
    src.replace('staff-20261009-r2', 'staff-20261009-r1'),
    src.replace('staff-20261009-r2', 'unapproved-revision'),
    `${src}&extra=1`,
  ].map(url => valid.replace(src, url));
  const x = setup(valid + valid + ineligible.join('') + marks(communityTrustArtHTML(3, true)), async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.cache, 'force-cache');
    return reply();
  });
  try {
    assert.equal(x.targets.size, 3, 'only the two current staff revisions and the unchanged level contract are observed');
    for (const target of x.targets) x.visible(target, true);
    await turn();
    assert.deepEqual([...calls].sort(), ['/assets/community/levels/trust-l3.svg', '/assets/community/staff/frame-moderator.svg?v=staff-20261009-r2'].sort());
    assert.ok(x.canvas(0)); assert.ok(x.canvas(1));
    for (let i = 2; i < 6; i++) assert.equal(x.canvas(i), null, 'old or arbitrary version markup cannot reload outdated dynamic artwork');
    x.controller.pause(); x.controller.resume();
    assert.equal(calls.length, 2, 'the fixed revision still shares its approved cache during scrolling');
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
