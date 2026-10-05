import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test, type TestContext } from "node:test";
import { createFeedCarousel } from "../../src/community-layout/feed-carousel.ts";

interface TestWindow extends Window {
  Event: typeof Event;
  KeyboardEvent: typeof KeyboardEvent;
  MouseEvent: typeof MouseEvent;
  FocusEvent: typeof FocusEvent;
  MutationObserver: typeof MutationObserver;
}
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => { window: TestWindow };
};
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(t: TestContext, { count = 2, reduced = false, width = 640 } = {}) {
  const { window } = new JSDOM('<section><div class="track" tabindex="0"></div></section>', { url: "http://localhost", pretendToBeVisual: true });
  const document = window.document;
  const section = document.querySelector<HTMLElement>("section")!;
  const track = section.querySelector<HTMLElement>(".track")!;
  for (let index = 0; index < count; index++) {
    const card = document.createElement("a");
    card.className = "community-feed-showcase-card";
    card.href = `#/post/${index}`;
    card.textContent = `Post ${index}`;
    track.append(card);
  }
  const cards = Array.from(track.children);
  let viewportWidth = width;
  Object.defineProperty(track, "clientWidth", { get: () => viewportWidth });
  let hidden = false;
  Object.defineProperty(document, "hidden", { get: () => hidden });
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let sequence = 0;
  Object.defineProperty(window, "setTimeout", { value: (callback: () => void, delay: number) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; } });
  Object.defineProperty(window, "clearTimeout", { value: (id: number) => { timers.delete(id); } });
  const mediaCallbacks = new Set<EventListener>();
  const media = { matches: reduced, addEventListener: (_type: string, callback: EventListener) => mediaCallbacks.add(callback), removeEventListener: (_type: string, callback: EventListener) => mediaCallbacks.delete(callback) };
  Object.defineProperty(window, "matchMedia", { value: (query: string) => { assert.equal(query, "(prefers-reduced-motion: reduce)"); return media; } });
  let resizeCallback: (() => void) | null = null;
  let intersectionCallback: ((entries: Array<{ target: Element; isIntersecting: boolean }>) => void) | null = null;
  let resizeDisconnects = 0;
  let intersectionDisconnects = 0;
  Object.defineProperty(window, "ResizeObserver", { value: class {
    constructor(callback: () => void) { resizeCallback = callback; }
    observe(target: Element) { assert.equal(target, track); }
    disconnect() { resizeDisconnects++; }
  } });
  Object.defineProperty(window, "IntersectionObserver", { value: class {
    constructor(callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) { intersectionCallback = callback; }
    observe(target: Element) { assert.equal(target, section); }
    disconnect() { intersectionDisconnects++; }
  } });
  const scrolls: ScrollToOptions[] = [];
  track.scrollTo = options => {
    assert.ok(options && typeof options === "object");
    scrolls.push(options);
    track.scrollLeft = options.left || 0;
  };
  const carousel = createFeedCarousel({ section, track });
  carousel.refresh();
  const visibility = (visible: boolean) => {
    const callback = intersectionCallback as ((entries: Array<{ target: Element; isIntersecting: boolean }>) => void) | null;
    callback?.([{ target: section, isIntersecting: visible }]);
  };
  visibility(true);
  const tick = () => {
    assert.equal(timers.size, 1, "exactly one autoplay timer exists");
    const [id, timer] = [...timers][0];
    assert.equal(timer.delay, 5000);
    timers.delete(id);
    timer.callback();
  };
  const setHidden = (value: boolean) => { hidden = value; document.dispatchEvent(new window.Event("visibilitychange")); };
  const setReduced = (value: boolean) => { media.matches = value; for (const callback of mediaCallbacks) callback(new window.Event("change")); };
  const resize = (value: number) => { viewportWidth = value; (resizeCallback as (() => void) | null)?.(); };
  t.after(() => { carousel.release(); window.close(); });
  return { window, document, section, track, cards, carousel, timers, scrolls, tick, setHidden, setReduced, visibility, resize, mediaCallbacks, disconnects: () => [resizeDisconnects, intersectionDisconnects] };
}

test('carousel advances once every five seconds and wraps without controls or card replacement', t => {
  const { section, track, cards, scrolls, tick, timers } = fixture(t);
  assert.equal(section.querySelector('button'), null);
  tick(); assert.deepEqual(scrolls.at(-1), { left: 640, behavior: 'smooth' });
  tick(); assert.deepEqual(scrolls.at(-1), { left: 0, behavior: 'smooth' });
  assert.equal(timers.size, 1); assert.deepEqual([...track.children], cards);
});

test('five banners each receive one five-second interval before wrapping', t => {
  const { tick, track, cards } = fixture(t, { count: 5 });
  for (const left of [640, 1280, 1920, 2560, 0]) { tick(); assert.equal(track.scrollLeft, left); }
  assert.deepEqual([...track.children], cards);
});

test('arrow keys navigate without scrolling the page, while focused content holds autoplay', t => {
  const { window, section, track, timers, tick } = fixture(t);
  track.focus({ preventScroll: true }); assert.equal(timers.size, 0);
  const key = new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  track.dispatchEvent(key); assert.equal(key.defaultPrevented, true); assert.equal(track.scrollLeft, 640);
  assert.equal(timers.size, 0);
  section.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: track.firstElementChild }));
  assert.equal(timers.size, 0, 'moving focus inside the carousel does not resume it');
  track.blur(); assert.equal(timers.size, 1); tick(); assert.equal(track.scrollLeft, 0);
});

test('pointer and touch dragging suspend autoplay until release, including release outside the track', t => {
  const { window, track, timers, tick } = fixture(t);
  for (const [start, end] of [['pointerdown', 'pointerup'], ['touchstart', 'touchend'], ['pointerdown', 'pointercancel'], ['touchstart', 'touchcancel']]) {
    track.dispatchEvent(new window.Event(start, { bubbles: true })); assert.equal(timers.size, 0);
    track.scrollLeft = 640; track.dispatchEvent(new window.Event('scroll'));
    window.dispatchEvent(new window.Event(end)); assert.equal(timers.size, 1); tick(); assert.equal(track.scrollLeft, 0);
  }
});

test('hover and keyboard focus pause only while the user is interacting', t => {
  const { window, section, track, timers } = fixture(t);
  section.dispatchEvent(new window.Event('mouseenter')); assert.equal(timers.size, 0);
  track.focus({ preventScroll: true });
  section.dispatchEvent(new window.Event('mouseleave')); assert.equal(timers.size, 0, 'focus still protects the current banner');
  track.blur(); assert.equal(timers.size, 1);
});

test('hidden documents and offscreen sections suspend autoplay independently', t => {
  const { timers, setHidden, visibility } = fixture(t);
  setHidden(true); assert.equal(timers.size, 0);
  visibility(false); setHidden(false); assert.equal(timers.size, 0);
  visibility(true); assert.equal(timers.size, 1);
  setHidden(true); visibility(true); assert.equal(timers.size, 0);
  setHidden(false); assert.equal(timers.size, 1);
});

test('reduced motion disables autoplay and keeps manual navigation immediate', t => {
  const { window, track, timers, scrolls, setReduced } = fixture(t, { reduced: true });
  assert.equal(timers.size, 0);
  track.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.deepEqual(scrolls.at(-1), { left: 640, behavior: 'auto' });
  setReduced(false); assert.equal(timers.size, 1);
  setReduced(true); assert.equal(timers.size, 0);
});

test('zero or one banner never autoplays, and a zero-width track waits for resize', t => {
  for (const count of [0, 1]) {
    const { timers, scrolls } = fixture(t, { count }); assert.equal(timers.size, 0); assert.equal(scrolls.length, 0);
  }
  const { timers, scrolls, resize, tick } = fixture(t, { width: 0 });
  assert.equal(timers.size, 0); resize(320); tick(); assert.deepEqual(scrolls.at(-1), { left: 320, behavior: 'smooth' });
  resize(480); assert.deepEqual(scrolls.at(-1), { left: 480, behavior: 'auto' });
});

test('unchanged refresh preserves DOM and timer; release removes listeners, timers and observers', async t => {
  const { window, document, section, track, carousel, timers, scrolls, mediaCallbacks, disconnects, setHidden, setReduced, visibility, resize } = fixture(t);
  const originalTimer = [...timers.keys()][0]; let mutations = 0;
  const observer = new window.MutationObserver(records => { mutations += records.length; });
  observer.observe(section, { childList: true, subtree: true, attributes: true });
  for (let index = 0; index < 5; index++) carousel.refresh();
  await settle(); assert.equal(mutations, 0); assert.equal([...timers.keys()][0], originalTimer); observer.disconnect();
  carousel.release(); const after = section.outerHTML;
  track.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  track.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  window.dispatchEvent(new window.Event('pointerup'));
  for (const event of ['mouseenter', 'mouseleave', 'focusin', 'focusout']) section.dispatchEvent(new window.Event(event));
  document.dispatchEvent(new window.Event('visibilitychange'));
  setHidden(false); setReduced(true); visibility(true); resize(300); carousel.refresh();
  assert.equal(section.outerHTML, after); assert.equal(scrolls.length, 0); assert.equal(timers.size, 0);
  assert.equal(mediaCallbacks.size, 0); assert.deepEqual(disconnects(), [1, 1]);
  carousel.release(); assert.deepEqual(disconnects(), [1, 1]);
});
