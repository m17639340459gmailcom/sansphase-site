import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import * as intro from "../src/components/fx/intro-bootstrap.ts";

function runIntro(pathname = "/", options = {}) {
  const dataset = {};
  const count = { textContent: "000" };
  const progress = { value: 0 };
  const events = [];
  const timers = new Map();
  const frames = [];
  const mutations = new Set();
  let stored = options.seen ? "1" : null;
  let content;
  let nextTimer = 0;
  const motion = Object.assign(new EventTarget(), { matches: options.reduced ?? false });
  const overlay = Object.assign(new EventTarget(), {
    hasAttribute: (name) => name === "data-home-preloader",
    querySelector: (selector) => selector === "progress" ? progress : count,
  });
  // Node requires the object form to match a capture listener when removing it.
  const document = Object.assign(new class extends EventTarget {
    addEventListener(type, listener, capture) {
      super.addEventListener(type, listener, { capture: Boolean(capture) });
    }
    removeEventListener(type, listener, capture) {
      super.removeEventListener(type, listener, { capture: Boolean(capture) });
    }
  }(), {
    documentElement: { dataset },
    body: {},
    readyState: options.readyState ?? "loading",
    currentScript: { previousElementSibling: overlay },
    querySelector: (selector) => {
      assert.equal(selector, "[data-home-intro-content]");
      return content;
    },
  });
  document.addEventListener(intro.INTRO_EVENT, () => events.push(dataset.intro));
  const window = new EventTarget();
  vm.runInNewContext(intro.createIntroScript(options.homePath ?? "/"), {
    document, window, Event,
    location: { pathname, hash: options.hash ?? "" },
    sessionStorage: {
      getItem(key) {
        assert.equal(key, intro.INTRO_STORAGE_KEY);
        if (options.storageBlocked) throw new Error("Storage denied");
        return stored;
      },
      setItem(key, value) {
        assert.equal(key, intro.INTRO_STORAGE_KEY);
        stored = value;
      },
    },
    matchMedia: () => motion,
    setTimeout(handler, delay) { timers.set(++nextTimer, { handler, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(handler) { frames.push(handler); },
    MutationObserver: class {
      constructor(handler) { this.handler = handler; }
      observe() { mutations.add(this.handler); }
      disconnect() { mutations.delete(this.handler); }
    },
  });
  return {
    dataset, count, progress, document, window, motion, events, mutations, timers, overlay,
    stored: () => stored,
    paint() { frames.shift()?.(); frames.shift()?.(); },
    showContent() {
      content = { ready: false, hasAttribute: () => content.ready };
      for (const mutation of mutations) mutation();
    },
    ready() {
      content.ready = true;
      document.dispatchEvent(new Event(intro.HOME_INTRO_READY_EVENT));
    },
    fire(delay) {
      const next = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(next, "expected an active timeout: " + delay);
      timers.delete(next[0]);
      next[1].handler();
    },
  };
}

for (const [pathname, homePath] of [["/", "/"], ["/en", "/en"], ["/en/", "/en"]]) {
  test(`${pathname} progresses only as the shell, page content and hydration become available`, () => {
    const result = runIntro(pathname, { homePath });
    const { dataset, count, progress, events } = result;
    assert.equal(result.stored(), "1");
    assert.equal(dataset.intro, "play");
    assert.equal(count.textContent, "000");
    result.paint();
    assert.equal(count.textContent, "030");
    result.showContent();
    assert.equal(count.textContent, "070");
    assert.equal(progress.value, 70);
    assert.deepEqual(events, []);
    result.ready();
    assert.equal(count.textContent, "100");
    assert.equal(progress.value, 100);
    assert.equal(dataset.intro, "play");
    result.fire(intro.INTRO_READY_HOLD_MS);
    assert.equal(dataset.intro, "opening");
    assert.deepEqual(events, ["opening"]);
    result.fire(intro.INTRO_CURTAIN_FALLBACK_MS);
    assert.equal(dataset.intro, "done");
    assert.equal(result.mutations.size, 0);
    assert.equal(result.timers.size, 0);
    assert.deepEqual(events, ["opening", "done"]);
  });
}

test("fast hydration preserves the first paint and still reaches real readiness", () => {
  const result = runIntro();
  result.showContent();
  result.ready();
  assert.equal(result.count.textContent, "000");
  result.paint();
  assert.equal(result.count.textContent, "100");
  result.fire(intro.INTRO_READY_HOLD_MS);
  assert.equal(result.dataset.intro, "opening");
});

test("scroll and tab locks can remain through the actual curtain movement", () => {
  const result = runIntro();
  function tab() {
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab" });
    result.document.dispatchEvent(event);
    return event.defaultPrevented;
  }
  assert.equal(tab(), true);
  result.paint();
  result.showContent();
  result.ready();
  result.fire(intro.INTRO_READY_HOLD_MS);
  assert.equal(tab(), true);
  result.overlay.dispatchEvent(Object.assign(new Event("animationend"), { animationName: "fx-pre-bottom" }));
  assert.equal(tab(), false);
  assert.deepEqual(result.events, ["opening", "done"]);
});

test("a slow or failed hydration unlocks the homepage without showing a false 100", () => {
  const result = runIntro();
  result.paint();
  result.showContent();
  result.fire(intro.INTRO_DEADLINE_MS);
  assert.equal(result.count.textContent, "070");
  assert.equal(result.progress.value, 70);
  assert.equal(result.dataset.intro, "done");
  assert.deepEqual(result.events, ["done"]);
  assert.equal(result.mutations.size, 0);
  assert.equal(result.timers.size, 0);
  result.ready();
  assert.equal(result.count.textContent, "070");
});

test("motion changes and page exit release the intro without leaving listeners or a scroll lock", () => {
  const preferred = runIntro();
  preferred.motion.matches = true;
  preferred.motion.dispatchEvent(new Event("change"));
  const leaving = runIntro();
  leaving.window.dispatchEvent(new Event("pagehide"));
  for (const result of [preferred, leaving]) {
    assert.equal(result.dataset.intro, "done");
    assert.equal(result.timers.size, 0);
    assert.equal(result.mutations.size, 0);
    assert.deepEqual(result.events, ["done"]);
  }
});

test("only a document entry at the homepage can consume the tab's intro", () => {
  for (const [path, options] of [
    ["/projects", {}], ["/", { hash: "#development" }], ["/", { seen: true }],
    ["/", { reduced: true }], ["/", { storageBlocked: true }], ["/", { readyState: "complete" }],
  ]) {
    const result = runIntro(path, options);
    assert.notEqual(result.dataset.intro, "play");
    assert.equal(result.stored(), options.seen ? "1" : null);
    assert.equal(result.mutations.size, 0);
    assert.equal(result.timers.size, 0);
    assert.deepEqual(result.events, []);
  }
});
