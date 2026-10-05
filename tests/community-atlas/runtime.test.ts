import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test, type TestContext } from "node:test";
import { build } from "esbuild";
import type { AstralState } from "../../src/community-atlas/types.ts";

interface TestWindow extends Window {
  eval(code: string): unknown;
  Event: typeof Event;
  EventTarget: typeof EventTarget;
  KeyboardEvent: typeof KeyboardEvent;
  HTMLCanvasElement: typeof HTMLCanvasElement;
  SVGElement: typeof SVGElement;
  DOMRect: typeof DOMRect;
  __astral: { mountAstral(host: HTMLElement, options?: { scene?: "atlas"; onError?: () => void }): () => void };
  __paint(id: string, state: AstralState): void;
  __resetFocus(): void;
  __createBackdrop(ctx: CanvasRenderingContext2D, options?: { onReady?: () => void }): {
    paint(width: number, height: number, time: number): void;
    dispose(): void;
  };
}
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (
    html: string,
    options: { url: string; runScripts: string },
  ) => { window: TestWindow };
};
const bundle = await build({
  entryPoints: ["src/community-atlas/runtime.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "__astral",
  plugins: [
    {
      name: "canvas-painter-fixture",
      setup(build) {
        build.onResolve({ filter: /^\.\/cinematic-backdrop\.ts$/ }, ({ path }) => ({ path, namespace: "backdrop" }));
        build.onLoad({ filter: /.*/, namespace: "backdrop" }, () => ({ loader: "js",
          contents: "export const createCinematicBackdrop=(ctx,options)=>window.__createBackdrop(ctx,options);" }));
        build.onResolve(
          { filter: /^\.\/(constellation-field)\.ts$/ },
          ({ path }) => ({ path, namespace: "painters" }),
        );
        build.onLoad({ filter: /.*/, namespace: "painters" }, () => ({
          loader: "js",
          contents: `
        export const paintConstellation=(_ctx,state)=>window.__paint('constellation',state);
        export const resetConstellationFocus=()=>window.__resetFocus();
      `,
        }));
      },
    },
  ],
});

function fixture(t: TestContext, initiallyReduced = false, orbit = "astral-constellation", press = false, scene?: "atlas") {
  const dom = new JSDOM(
    '<main><section class="community-landing"><div class="community-orbits" aria-hidden="true"><i></i></div><div class="eyebrow">• COMMUNITY · 社区交流</div><h1>無相社区</h1><p>社区介绍保持不变</p><div class="community-landing-actions"><a href="#/community/all">进入社区</a></div></section></main>',
    {
      url: `http://127.0.0.1:4211/?orbit=${orbit}${press ? "&interaction=press" : ""}${scene ? `&scene=${scene}` : ""}#/community`,
      runScripts: "outside-only",
    },
  );
  const window = dom.window;
  const document = window.document;
  let now = 0;
  let nextFrame = 0;
  let hidden = false;
  let reduced = initiallyReduced;
  let disconnected = 0;
  let focusResets = 0;
  let nextTimer = 0;
  let backdropCreated = 0, backdropDisposed = 0;
  let failPaint = false, paintAttempts = 0, renderErrors = 0;
  let backdropReady: (() => void) | undefined;
  const backdropPaints: Array<{ width: number; height: number; time: number; mode: string }> = [];
  const paintOrder: string[] = [];
  const callbacks = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { callback: () => void; due: number }>();
  const paints: Array<{ id: string; state: AstralState }> = [];
  window.__paint = (id, state) => {
    paintAttempts++;
    if (failPaint) throw new Error("Simulated asynchronous renderer failure");
    paintOrder.push(id); paints.push({ id, state });
  };
  window.__createBackdrop = (ctx, options) => {
    backdropCreated++;
    backdropReady = options?.onReady;
    return {
      paint(width, height, time) { paintOrder.push("backdrop"); backdropPaints.push({ width, height, time, mode: ctx.globalCompositeOperation }); },
      dispose() { backdropDisposed++; },
    };
  };
  window.__resetFocus = () => { focusResets += 1; };
  window.requestAnimationFrame = (callback) => {
    const id = ++nextFrame;
    callbacks.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    callbacks.delete(id);
  };
  Object.defineProperty(window, "setTimeout", {
    value: (callback: () => void, delay = 0) => {
      const id = ++nextTimer;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
  });
  Object.defineProperty(window, "clearTimeout", {
    value: (id: number) => timers.delete(id),
  });
  Object.defineProperty(window.performance, "now", { value: () => now });
  Object.defineProperty(document, "hidden", { get: () => hidden });
  Object.defineProperty(document, "fonts", {
    value: { ready: Promise.resolve() },
  });
  Object.defineProperty(window, "devicePixelRatio", { value: 2 });
  const motion = new window.EventTarget();
  Object.defineProperty(motion, "matches", { get: () => reduced });
  window.matchMedia = () => motion as MediaQueryList;
  const compositeStack: string[] = [];
  const context = {
    globalCompositeOperation: "source-over",
    setTransform() {},
    save() { compositeStack.push(this.globalCompositeOperation); },
    restore() { this.globalCompositeOperation = compositeStack.pop()!; },
    fillText() {},
    measureText(text: string) { return { width: text.length * 6 }; },
  };
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    value: () => context,
  });
  Object.defineProperty(window.SVGElement.prototype, "setPointerCapture", {
    value: () => {},
  });
  Object.defineProperty(window.SVGElement.prototype, "hasPointerCapture", {
    value: () => false,
  });
  const host = document.querySelector<HTMLElement>(".community-orbits")!;
  host.getBoundingClientRect = () => new window.DOMRect(100, 20, 800, 700);
  document.querySelector<HTMLElement>("h1")!.getBoundingClientRect = () =>
    new window.DOMRect(290, 240, 420, 90);
  let onIntersection: IntersectionObserverCallback = () => {};
  Object.defineProperty(window, "ResizeObserver", {
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {
        disconnected += 1;
      }
    },
  });
  Object.defineProperty(window, "IntersectionObserver", {
    value: class {
      constructor(callback: IntersectionObserverCallback) {
        onIntersection = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnected += 1;
      }
    },
  });
  window.eval(`${bundle.outputFiles[0]!.text}\nwindow.__astral = __astral;`);
  const dispose = window.__astral.mountAstral(host, { scene, onError: () => { renderErrors++; } });
  t.after(() => {
    dispose();
    window.close();
  });
  function step(milliseconds = 40) {
    now += milliseconds;
    for (const [id, timer] of timers) {
      if (timer.due > now) continue;
      timers.delete(id);
      timer.callback();
    }
    const batch = [...callbacks.values()];
    callbacks.clear();
    batch.forEach((callback) => callback(now));
  }
  function pointer(type: string, x: number, y: number, options: {
    pointerType?: string;
    pointerId?: number;
    target?: Element;
    buttons?: number;
  } = {}) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: options.pointerId ?? 1 },
      button: { value: 0 },
      buttons: { value: options.buttons ?? 0 },
      pointerType: { value: options.pointerType ?? "mouse" },
      clientX: { value: x },
      clientY: { value: y },
      timeStamp: { value: now },
    });
    (options.target ?? document.querySelector(".community-landing")!).dispatchEvent(event);
    return event;
  }
  return {
    window,
    document,
    host,
    paints,
    backdropPaints,
    paintOrder,
    failPaint: () => { failPaint = true; },
    paintAttempts: () => paintAttempts,
    renderErrors: () => renderErrors,
    backdropCreated: () => backdropCreated,
    backdropDisposed: () => backdropDisposed,
    readyBackdrop: () => backdropReady?.(),
    dispose,
    step,
    elapse(milliseconds: number) { now += milliseconds; },
    pointer,
    queued: () => callbacks.size,
    timers: () => timers.size,
    focusResets: () => focusResets,
    disconnected: () => disconnected,
    setReduced(value: boolean) {
      reduced = value;
      motion.dispatchEvent(new window.Event("change"));
    },
    setHidden(value: boolean) {
      hidden = value;
      document.dispatchEvent(new window.Event("visibilitychange"));
    },
    setVisible(value: boolean) {
      onIntersection(
        [{ isIntersecting: value } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    },
  };
}

test("landing mounts no preview controls or status in normal and reduced-motion modes", (t) => {
  for (const reduced of [false, true]) {
    const view = fixture(t, reduced, "astral-constellation", false, "atlas");
    view.step();
    assert.equal(view.document.querySelector(".astral-controls, .astral-pause, .astral-status"), null);
    assert.equal(view.document.querySelectorAll("canvas").length, 1);
    assert.equal(view.document.querySelector("h1")!.textContent, "無相社区");
    assert.equal(view.host.hasAttribute("data-frames"), false);
    assert.equal(Number(view.host.dataset.orbitTime), view.backdropPaints.at(-1)!.time);
  }
});

test("asynchronous render failure notifies once and cannot restart through lifecycle events", (t) => {
  const view = fixture(t, false, "astral-constellation", false, "atlas");
  view.step();
  view.failPaint();
  view.step();
  assert.equal(view.paintAttempts(), 2);
  assert.equal(view.renderErrors(), 1);
  assert.equal(view.queued(), 0);
  view.readyBackdrop();
  view.setReduced(true); view.setReduced(false);
  view.setHidden(true); view.setHidden(false);
  view.setVisible(false); view.setVisible(true);
  view.window.dispatchEvent(new view.window.Event("resize"));
  view.pointer("pointermove", 700, 210);
  view.step(5000);
  assert.equal(view.paintAttempts(), 2);
  assert.equal(view.renderErrors(), 1);
  assert.equal(view.queued(), 0);
  view.dispose(); view.dispose();
  assert.equal(view.backdropDisposed(), 1);
  assert.equal(view.disconnected(), 2);
  assert.equal(view.document.querySelector("canvas"), null);
});

test("content entrance completion and cancellation refresh hover bounds and clean up on exit", (t) => {
  const view = fixture(t, true);
  const title = view.document.querySelector<HTMLElement>("h1")!;
  view.step();
  assert.equal(view.paints.at(-1)!.state.quietRects[0]!.top, 208);
  title.getBoundingClientRect = () => new view.window.DOMRect(290, 222, 420, 90);
  title.dispatchEvent(new view.window.Event("animationend", { bubbles: true }));
  view.step();
  assert.equal(view.paints.at(-1)!.state.quietRects[0]!.top, 190);
  title.getBoundingClientRect = () => new view.window.DOMRect(290, 230, 420, 90);
  title.dispatchEvent(new view.window.Event("animationcancel", { bubbles: true }));
  view.step();
  assert.equal(view.paints.at(-1)!.state.quietRects[0]!.top, 198);
  view.dispose();
  title.dispatchEvent(new view.window.Event("animationend", { bubbles: true }));
  assert.equal(view.queued(), 0);
});

test("retired selection parameters are ignored without rewriting the page URL", (t) => {
  for (const orbit of ["", "original", "rings", "deep", "obs-veil", "astral-bands", "astral-instrument", "astral-weave", "astral-startrails", "unknown", "astral-constellation"]) {
    const view = fixture(t, false, orbit, true); view.step();
    assert.equal(view.paints.at(-1)!.id, "constellation", orbit);
    assert.equal(view.host.dataset.astralComponent, "constellation");
    assert.equal(view.document.querySelectorAll("canvas").length, 1);
    assert.equal(view.document.querySelector(".astral-controls, .astral-pause, .astral-status"), null);
    assert.equal(view.document.querySelector(".astral-choices, .portal-interaction, .press-preview, details"), null);
    const url = new URL(view.window.location.href);
    assert.equal(url.searchParams.get("orbit"), orbit, "mounting a renderer does not own page history");
    assert.equal(url.searchParams.get("interaction"), "press", "retired controls stay inactive without mutating the link");
    assert.equal(view.document.querySelector("h1")!.textContent, "無相社区");
    assert.equal(view.document.querySelector(".community-landing > p")!.textContent, "社区介绍保持不变");
    assert.equal(view.document.querySelector(".community-landing-actions a")!.getAttribute("href"), "#/community/all");
    assert.equal(view.document.querySelector("canvas")!.width, 1280);
  }
});

test("constellation hides only its eyebrow while preserving its layout slot and content", (t) => {
  const view = fixture(t, true, "astral-constellation");
  view.document.body.dataset.orbitExperiment = "astral";
  const style = view.document.createElement("style");
  style.textContent = readFileSync(new URL("../../src/community-atlas/styles.css", import.meta.url), "utf8");
  view.document.head.append(style);
  view.step();
  const eyebrow = view.document.querySelector<HTMLElement>(".eyebrow")!;
  const readContent = () => [...view.document.querySelectorAll(".community-landing > :is(h1, p, .community-landing-actions)")]
    .map((element) => element.outerHTML);
  const originalContent = readContent();
  assert.equal(view.window.getComputedStyle(eyebrow).visibility, "hidden");
  assert.notEqual(view.window.getComputedStyle(eyebrow).display, "none", "the hidden row keeps its layout slot");
  assert.equal(view.window.getComputedStyle(view.document.querySelector("h1")!).visibility, "visible");
  assert.equal(view.paints.at(-1)!.state.quietRects.length, 3, "the invisible eyebrow no longer excludes labels or hover");
  assert.deepEqual(readContent(), originalContent);
});


test("reduced motion is static, visibility suspends frames, and resumption has no time jump", (t) => {
  const view = fixture(t, true);
  view.step();
  assert.equal(view.paints.at(-1)!.state.time, 0);
  assert.equal(view.queued(), 0);
  view.setReduced(false);
  view.step();
  const beforeHidden = view.paints.at(-1)!.state.time;
  view.setHidden(true);
  assert.equal(view.queued(), 0);
  view.step(5000);
  view.setHidden(false);
  view.step();
  assert.ok(view.paints.at(-1)!.state.time - beforeHidden <= 0.05);
  view.setVisible(false);
  assert.equal(view.queued(), 0);
  view.setVisible(true);
  assert.equal(view.queued(), 1);
});


test("dispose removes the canvas and active listeners and is idempotent", async (t) => {
  const view = fixture(t);
  view.step();
  view.dispose();
  view.dispose();
  await Promise.resolve();
  assert.equal(
    view.document.querySelector(
      "canvas, .portal-interaction, .astral-controls",
    ),
    null,
  );
  assert.equal(view.queued(), 0);
  assert.equal(view.disconnected(), 2);
  view.window.dispatchEvent(new view.window.Event("resize"));
  view.window.dispatchEvent(new view.window.Event("blur"));
  view.setReduced(true);
  view.setHidden(false);
  assert.equal(view.queued(), 0);
  assert.equal(view.host.hasAttribute("data-frames"), false);
});


test("constellation sends frame and reduced-motion state, and mouse or pen hover repaints a frozen view once", (t) => {
  const view = fixture(t, false, "astral-constellation");
  view.step();
  assert.equal(view.paints.at(-1)!.state.deltaSeconds, .04);
  assert.equal(view.paints.at(-1)!.state.reducedMotion, false);
  view.setReduced(true);
  view.step();
  const landing = view.document.querySelector(".community-landing")!;
  for (const pointerType of ["mouse", "pen"]) {
    const event = view.pointer("pointermove", 700, 210, { pointerType, target: landing });
    view.step();
    const state = view.paints.at(-1)!.state;
    assert.equal(state.pointerX, 600);
    assert.equal(state.pointerY, 190);
    assert.equal(state.hover, 1);
    assert.equal(state.deltaSeconds, 0);
    assert.equal(state.reducedMotion, true);
    assert.equal(event.defaultPrevented, false);
    assert.equal(view.queued(), 0);
  }
  view.setReduced(false);
  view.step();
  assert.equal(view.paints.at(-1)!.state.reducedMotion, false);
});


test("a blank-sky touch tap briefly activates a constellation without intercepting the page", (t) => {
  const view = fixture(t, true, "astral-constellation");
  view.step();
  const target = view.document.querySelector(".community-landing")!;
  const down = view.pointer("pointerdown", 700, 210, { pointerType: "touch", target });
  view.step(100);
  assert.equal(view.paints.at(-1)!.state.hover, 0, "touch-down alone does not select a star group");
  const up = view.pointer("pointerup", 704, 213, { pointerType: "touch", target });
  view.step();
  assert.equal(view.paints.at(-1)!.state.pointerX, 604);
  assert.equal(view.paints.at(-1)!.state.pointerY, 193);
  assert.equal(view.paints.at(-1)!.state.hover, 1);
  assert.equal(view.queued(), 0);
  assert.equal(view.timers(), 1);
  assert.equal(down.defaultPrevented, false);
  assert.equal(up.defaultPrevented, false);
  let clicks = 0;
  target.addEventListener("click", () => { clicks += 1; });
  const click = new view.window.Event("click", { bubbles: true, cancelable: true });
  target.dispatchEvent(click);
  assert.equal(clicks, 1);
  assert.equal(click.defaultPrevented, false);
  view.step(1800);
  assert.equal(view.paints.at(-1)!.state.pointerX, undefined);
  assert.equal(view.paints.at(-1)!.state.pointerY, undefined);
  assert.equal(view.paints.at(-1)!.state.hover, 0);
  assert.equal(view.queued(), 0);
  assert.equal(view.timers(), 0);
});


test("touch drags, long presses, canceled gestures and scroll never activate a constellation", (t) => {
  const scenarios = ["drag", "long", "cancel", "scroll", "multitouch"] as const;
  for (const scenario of scenarios) {
    const view = fixture(t, true, "astral-constellation");
    view.step();
    const target = view.document.querySelector(".community-landing")!;
    const options = { pointerType: "touch", target };
    view.pointer("pointerdown", 700, 210, options);
    if (scenario === "drag") {
      view.pointer("pointermove", 710, 210, options);
      view.pointer("pointermove", 700, 210, options);
    } else if (scenario === "long") view.step(501);
    else if (scenario === "cancel") view.pointer("pointercancel", 700, 210, options);
    else if (scenario === "scroll") view.window.dispatchEvent(new view.window.Event("scroll"));
    else view.pointer("pointerdown", 740, 210, { ...options, pointerId: 2 });
    const up = view.pointer("pointerup", 700, 210, options);
    view.step();
    assert.equal(view.paints.at(-1)!.state.hover, 0, scenario);
    assert.equal(view.timers(), 0, scenario);
    assert.equal(view.queued(), 0, scenario);
    assert.equal(up.defaultPrevented, false, scenario);
  }
});


test("constellation never activates from content or outside its bounds", (t) => {
  const view = fixture(t, true, "astral-constellation");
  view.step();
  const landing = view.document.querySelector(".community-landing")!;
  const targets = ["h1", ".community-landing > p", ".community-landing-actions a"];
  for (const selector of targets) {
    const target = view.document.querySelector(selector)!;
    view.pointer("pointermove", 700, 210, { target });
    view.pointer("pointerdown", 700, 210, { pointerType: "touch", target });
    view.pointer("pointerup", 700, 210, { pointerType: "touch", target });
    view.step();
    assert.equal(view.paints.at(-1)!.state.hover, 0, selector);
    assert.equal(view.paints.at(-1)!.state.pointerX, undefined, selector);
    assert.equal(view.timers(), 0, selector);
  }
  view.pointer("pointermove", 910, 210, { target: landing });
  view.pointer("pointerdown", 910, 210, { pointerType: "touch", target: landing });
  view.pointer("pointerup", 910, 210, { pointerType: "touch", target: landing });
  view.step();
  assert.equal(view.paints.at(-1)!.state.pointerX, undefined);
  assert.equal(view.paints.at(-1)!.state.hover, 0);
  assert.equal(view.timers(), 0);
});


test("constellation clears touch timers and pointers on scroll, leaving, hiding and disposal", (t) => {
  const scenarios = ["scroll", "leave", "blur", "hidden", "offscreen", "dispose"] as const;
  for (const scenario of scenarios) {
    const view = fixture(t, true, "astral-constellation");
    view.step();
    const target = view.document.querySelector(".community-landing")!;
    view.pointer("pointerdown", 700, 210, { pointerType: "touch", target });
    view.pointer("pointerup", 700, 210, { pointerType: "touch", target });
    view.step();
    assert.equal(view.paints.at(-1)!.state.hover, 1);
    if (scenario === "scroll") view.window.dispatchEvent(new view.window.Event("scroll"));
    else if (scenario === "leave") view.document.dispatchEvent(new view.window.Event("pointerleave"));
    else if (scenario === "blur") view.window.dispatchEvent(new view.window.Event("blur"));
    else if (scenario === "hidden") view.setHidden(true);
    else if (scenario === "offscreen") view.setVisible(false);
    else view.dispose();
    assert.equal(view.timers(), 0, scenario);
    if (scenario === "hidden") view.setHidden(false);
    if (scenario === "offscreen") view.setVisible(true);
    view.step();
    if (scenario !== "dispose") {
      assert.equal(view.paints.at(-1)!.state.pointerX, undefined, scenario);
      assert.equal(view.paints.at(-1)!.state.pointerY, undefined, scenario);
      assert.equal(view.paints.at(-1)!.state.hover, 0, scenario);
    }
    const count = view.paints.length;
    view.step(2000);
    assert.equal(view.paints.length, count, scenario);
    assert.equal(view.queued(), 0, scenario);
  }
});


test("touch thresholds are inclusive and mouse hover replaces the temporary touch timer", (t) => {
  const view = fixture(t, true, "astral-constellation");
  view.step();
  const target = view.document.querySelector(".community-landing")!;
  view.pointer("pointerdown", 700, 210, { pointerType: "touch", target });
  view.step(500);
  view.pointer("pointerup", 708, 210, { pointerType: "touch", target });
  view.step();
  assert.equal(view.paints.at(-1)!.state.pointerX, 608);
  assert.equal(view.paints.at(-1)!.state.hover, 1);
  view.pointer("pointermove", 680, 190, { target });
  view.step();
  assert.equal(view.timers(), 0);
  const count = view.paints.length;
  view.step(2000);
  assert.equal(view.paints.length, count);
  assert.equal(view.paints.at(-1)!.state.pointerX, 580);
  assert.equal(view.paints.at(-1)!.state.hover, 1);
  view.pointer("pointermove", 680, 190, { pointerType: "pen", buttons: 1, target });
  view.step();
  assert.equal(view.paints.at(-1)!.state.pointerX, undefined);
  assert.equal(view.paints.at(-1)!.state.hover, 0, "pen contact is not a hover gesture");
});


test("an unfinished touch cannot activate after a page visibility transition", (t) => {
  const scenarios = ["hidden", "offscreen", "blur"] as const;
  for (const scenario of scenarios) {
    const view = fixture(t, true, "astral-constellation");
    view.step();
    const target = view.document.querySelector(".community-landing")!;
    view.pointer("pointerdown", 700, 210, { pointerType: "touch", target });
    if (scenario === "hidden") { view.setHidden(true); view.setHidden(false); }
    else if (scenario === "offscreen") { view.setVisible(false); view.setVisible(true); }
    else if (scenario === "blur") view.window.dispatchEvent(new view.window.Event("blur"));
    view.pointer("pointerup", 700, 210, { pointerType: "touch", target });
    view.step();
    assert.equal(view.paints.at(-1)!.state.hover, 0, scenario);
    assert.equal(view.paints.at(-1)!.state.pointerX, undefined, scenario);
    assert.equal(view.timers(), 0, scenario);
  }
});


test("full-viewport constellation accepts blank main and body targets outside the title section", (t) => {
  const view = fixture(t, true, "astral-constellation");
  view.step();
  const main = view.document.querySelector("main")!;
  view.pointer("pointermove", 150, 650, { target: main });
  view.step();
  assert.equal(view.paints.at(-1)!.state.pointerX, 50);
  assert.equal(view.paints.at(-1)!.state.pointerY, 630);
  assert.equal(view.paints.at(-1)!.state.hover, 1);
  view.pointer("pointerdown", 800, 650, { pointerType: "touch", target: view.document.body });
  view.pointer("pointerup", 800, 650, { pointerType: "touch", target: view.document.body });
  view.step();
  assert.equal(view.paints.at(-1)!.state.pointerX, 700);
  assert.equal(view.paints.at(-1)!.state.pointerY, 630);
  assert.equal(view.paints.at(-1)!.state.hover, 1);
});


test("mount and disposal reset retained constellation focus, while hover preserves it", (t) => {
  const view = fixture(t, true); view.step();
  assert.equal(view.focusResets(), 1);
  view.pointer("pointermove", 700, 210); view.step();
  assert.equal(view.focusResets(), 1);
  view.dispose(); assert.equal(view.focusResets(), 2);
  view.dispose(); assert.equal(view.focusResets(), 2);
});

test("constellation hover keeps its viewport fixed under hover, scrolling and reduced motion", (t) => {
  const view = fixture(t, false, "astral-constellation");
  const target = view.document.querySelector("main")!;
  view.step();
  view.pointer("pointermove", 800, 630, { target });
  for (let i = 0; i < 5; i++) view.step();
  const active = view.paints.at(-1)!.state;
  assert.equal(active.width, 800);
  assert.equal(active.height, 700);
  assert.ok(active.hover > 0);
  assert.equal(active.pointerX, 700);
  assert.equal(active.pointerY, 610);
  view.window.dispatchEvent(new view.window.Event("scroll"));
  view.step();

  view.setReduced(true); view.step();
  view.pointer("pointermove", 750, 620, { pointerType: "pen", target }); view.step();
  assert.equal(view.paints.at(-1)!.state.hover, 1);
  assert.equal(view.queued(), 0);
});

test("resize remeasures the full viewport and preserves reduced-motion time", (t) => {
  const view = fixture(t, true); view.step();
  view.host.getBoundingClientRect = () => new view.window.DOMRect(0, 0, 1100, 700);
  view.window.dispatchEvent(new view.window.Event("resize")); view.step();
  assert.equal(view.paints.at(-1)!.state.width, 1100);
  assert.equal(view.paints.at(-1)!.state.height, 700);
  assert.equal(view.paints.at(-1)!.state.time, 0);
  assert.equal(view.queued(), 0);
});

test("reduced motion freezes time and resuming after a long wait does not skip forward", (t) => {
  const view = fixture(t); view.step();
  view.setReduced(true); view.step();
  const time = view.paints.at(-1)!.state.time;
  const frames = view.paints.length;
  view.step(5000);
  assert.equal(view.paints.length, frames);
  assert.equal(view.queued(), 0);
  view.setReduced(false); view.step();
  assert.ok(view.paints.at(-1)!.state.time - time <= .05);
  assert.equal(view.queued(), 1);
});

test("only atlas constructs a backdrop, after constellation clearing and behind its pixels", (t) => {
  const original = fixture(t); original.step();
  assert.equal(original.backdropCreated(), 0);
  assert.equal(original.paints.at(-1)!.state.scene, undefined);
  const atlas = fixture(t, false, "original", true, "atlas"); atlas.step();
  assert.equal(atlas.backdropCreated(), 1);
  assert.deepEqual(atlas.paintOrder, ["constellation", "backdrop"]);
  const frame = atlas.backdropPaints.at(-1)!;
  assert.equal(frame.mode, "destination-over");
  assert.equal(frame.width, 800); assert.equal(frame.height, 700);
  assert.equal(frame.time, atlas.paints.at(-1)!.state.time);
  assert.equal(atlas.paints.at(-1)!.state.scene, "atlas");
  assert.equal(new URL(atlas.window.location.href).searchParams.get("scene"), "atlas");
  atlas.dispose(); atlas.dispose();
  assert.equal(atlas.backdropDisposed(), 1);
});

test("atlas image readiness shares the frozen clock without adding a second animation loop", (t) => {
  const view = fixture(t, true, "astral-constellation", false, "atlas"); view.step();
  assert.equal(view.backdropPaints.at(-1)!.time, 0);
  assert.equal(view.queued(), 0);
  view.readyBackdrop();
  assert.equal(view.queued(), 1, "a loaded image must redraw even when reduced motion has stopped the loop");
  view.readyBackdrop(); assert.equal(view.queued(), 1);
  view.step(); assert.equal(view.queued(), 0);
  assert.equal(view.backdropPaints.at(-1)!.time, 0);
  view.setReduced(false); view.step();
  view.setReduced(true); view.step();
  const frozenTime = view.backdropPaints.at(-1)!.time;
  view.readyBackdrop(); view.step(2000);
  assert.equal(view.backdropPaints.at(-1)!.time, frozenTime);
  assert.equal(view.queued(), 0);
  view.setHidden(true); view.readyBackdrop(); assert.equal(view.queued(), 0);
  view.setHidden(false); view.step();
  assert.equal(view.backdropPaints.at(-1)!.time, frozenTime);
  view.dispose(); view.readyBackdrop();
  assert.equal(view.backdropDisposed(), 1);
  assert.equal(view.queued(), 0);
});

test("slow frames retain real active sky time while interaction deltas stay bounded", (t) => {
  for (const interval of [100, 250]) {
    const view = fixture(t, false, "astral-constellation", false, "atlas");
    let elapsed = 0;
    for (let frame = 0; frame < 8; frame++) {
      view.step(interval); elapsed += interval / 1000;
      const state = view.paints.at(-1)!.state;
      assert.ok(Math.abs(state.time - elapsed) < 1e-9, `${interval}ms frames must not slow the sky clock`);
      assert.equal(state.deltaSeconds, .05, "hover integration still receives a bounded step");
      assert.equal(view.backdropPaints.at(-1)!.time, state.time, "clouds and constellation light share exactly one clock");
      assert.equal(view.queued(), 1, "the existing scheduler remains the only queued animation frame");
    }
  }
});

test("frame throttling retains elapsed time until the next actual paint", (t) => {
  const view = fixture(t, false, "astral-constellation", false, "atlas");
  view.step(17); assert.equal(view.paints.length, 1);
  view.step(17); assert.equal(view.paints.length, 1, "the 30fps ceiling still skips the intermediate callback");
  view.step(17); assert.equal(view.paints.length, 2);
  assert.ok(Math.abs(view.paints.at(-1)!.state.time - .051) < 1e-9);
  assert.equal(view.paints.at(-1)!.state.deltaSeconds, .034);
  assert.equal(view.backdropPaints.at(-1)!.time, view.paints.at(-1)!.state.time);
});

test("active time ends at motion or visibility boundaries and excludes long inactive gaps", (t) => {
  for (const scenario of ["hidden", "offscreen", "reduced", "collapsed"] as const) {
    const view = fixture(t, false, "astral-constellation", false, "atlas");
    view.step(100);
    // The user changes state between rendered frames. This active portion must
    // be kept, while the following inactive five seconds must be excluded.
    view.elapse(80);
    if (scenario === "hidden") view.setHidden(true);
    else if (scenario === "offscreen") view.setVisible(false);
    else if (scenario === "reduced") view.setReduced(true);
    else {
      view.host.getBoundingClientRect = () => new view.window.DOMRect(100, 20, 0, 0);
      view.window.dispatchEvent(new view.window.Event("resize"));
    }
    view.step(5000);
    view.readyBackdrop(); view.step(1000);
    if (scenario === "reduced") {
      assert.ok(Math.abs(view.backdropPaints.at(-1)!.time - .18) < 1e-9, scenario);
      assert.equal(view.paints.at(-1)!.state.deltaSeconds, 0);
    }
    if (scenario === "hidden") view.setHidden(false);
    else if (scenario === "offscreen") view.setVisible(true);
    else if (scenario === "reduced") view.setReduced(false);
    else {
      view.host.getBoundingClientRect = () => new view.window.DOMRect(100, 20, 800, 700);
      view.window.dispatchEvent(new view.window.Event("resize"));
    }
    view.step(250);
    const state = view.paints.at(-1)!.state;
    assert.ok(Math.abs(state.time - .43) < 1e-9, `${scenario}: only .18s before the gap and .25s after it are active`);
    assert.equal(state.deltaSeconds, .05);
    assert.equal(view.backdropPaints.at(-1)!.time, state.time);
  }
});
