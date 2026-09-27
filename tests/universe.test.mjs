import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { universeMarkup, mountUniverse } from "../dist/universe.mjs";

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
async function setup({
  reduced = false,
  failure = false,
  deferred = false,
  synchronousReady = false,
  synchronousError = false,
  autoProgress = true,
  prepareContent,
  initiallyCovered = false,
  onPrepared,
} = {}) {
  const dom = new JSDOM(universeMarkup(), {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const w = dom.window,
    root = w.document.querySelector(".universe-home");
  const motion = Object.assign(new w.EventTarget(), { matches: reduced });
  w.matchMedia = () => motion;
  let time = 0,
    sequence = 0;
  const timers = new Map();
  w.setTimeout = (callback, delay = 0) => {
    timers.set(++sequence, { callback, at: time + delay });
    return sequence;
  };
  w.clearTimeout = (id) => timers.delete(id);
  const advance = (ms) => {
    const end = time + ms;
    while (true) {
      const next = [...timers]
        .filter(([, v]) => v.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    time = end;
  };
  let blocked = false,
    settings,
    resolveImport;
  const calls = [],
    api = {};
  for (const method of [
    "setPointer",
    "setOrbit",
    "beginOrbit",
    "endOrbit",
    "pulse",
    "setChapter",
    "setPaused",
    "setReducedMotion",
    "resize",
    "dispose",
    "startPresentation",
  ])
    api[method] = (...args) => calls.push([method, ...args]);
  api.setChapter = (value, options) => {
    calls.push(["setChapter", value, options]);
    if (autoProgress) settings.onProgress(value);
  };
  const mod = {
    mountCosmos(canvas, options) {
      settings = options;
      calls.push(["mount", canvas]);
      if (synchronousReady) options.onReady();
      if (synchronousError) options.onError(new Error("sync failure"));
      return api;
    },
  };
  const loader = () =>
    failure
      ? Promise.reject(new Error("No GPU"))
      : deferred
        ? new Promise((resolve) => (resolveImport = resolve))
        : Promise.resolve(mod);
  const clean = mountUniverse(root, {
    isBlocked: () => blocked,
    loadRenderer: loader,
    prepareContent,
    initiallyCovered,
    onPrepared,
  });
  await flush();
  const stage = root.querySelector(".universe-stage");
  stage.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 1000,
    height: 600,
  });
  const captures = new Set();
  stage.setPointerCapture = (id) => captures.add(id);
  stage.hasPointerCapture = (id) => captures.has(id);
  stage.releasePointerCapture = (id) => captures.delete(id);
  const pointer = (
    type,
    x,
    y,
    id = 1,
    pointerType = "mouse",
    isPrimary = true,
  ) => {
    const e = new w.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
    Object.defineProperty(e, "pointerId", { value: id });
    Object.defineProperty(e, "pointerType", { value: pointerType });
    Object.defineProperty(e, "isPrimary", { value: isPrimary });
    stage.dispatchEvent(e);
  };
  return {
    w,
    root,
    stage,
    calls,
    rendererApi: api,
    clean,
    motion,
    advance,
    captures,
    callbacks: () => settings,
    ready: () => settings.onReady(),
    error: () => settings.onError(new Error("lost")),
    block: (value = true) => (blocked = value),
    pointer,
    key: (key, options = {}) =>
      w.dispatchEvent(
        new w.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      ),
    resolve: () => resolveImport(mod),
    close() {
      clean();
      w.close();
    },
  };
}
test("optional background warmup starts once after homepage readiness", async () => {
  let notifications = 0, release;
  const s = await setup({prepareContent: () => new Promise(resolve => {release=resolve;}),onPrepared:()=>notifications++});
  try {
    s.ready(); await flush();
    assert.equal(notifications, 0);
    release(); await flush();
    assert.equal(notifications, 1);
    assert.equal(s.root.classList.contains('is-ready'), true);
    s.ready(); await flush();
    assert.equal(notifications, 1, 'repeated renderer callbacks must not duplicate background downloads');
  } finally {s.close();}
});

test("home loading indicator follows actual readiness without adding permanent visual controls", async () => {
  const s = await setup();
  try {
    assert.equal(s.root.querySelectorAll("canvas").length, 1);
    assert.equal(s.root.querySelector("img,video"), null);
    assert.equal(
      s.root.querySelector(
        ".universe-heading,.universe-entry,.universe-next,.universe-motion,.universe-hint,.universe-count",
      ),
      null,
    );
    assert.equal(s.root.querySelector("h1").className, "sr-only");
    assert.equal(
      s.root.querySelector("#universe-instructions").className,
      "sr-only",
    );
    assert.equal(s.root.querySelector(".universe-feedback").hidden, true);
    assert.equal(s.root.querySelector(".universe-status").textContent, "");
    assert.equal(s.root.getAttribute("aria-busy"), "true");
    assert.equal(s.root.querySelector('.universe-loader').getAttribute('aria-hidden'), 'false');
    assert(s.root.querySelector('.universe-loader svg'), 'use the existing Lucide icon family');
    assert.ok(!s.root.classList.contains("is-ready"));
    s.ready();
    assert.equal(s.root.getAttribute("aria-busy"), "false");
    assert.equal(s.root.querySelector('.universe-loader').getAttribute('aria-hidden'), 'true');
    assert.ok(s.root.classList.contains("is-ready"));
  } finally {
    s.close();
  }
});

test('entry waits for images after GPU readiness and only then reaches 100 percent', async () => {
  let complete,options;
  const s=await setup({prepareContent:settings=>{options=settings;return new Promise(resolve=>complete=resolve);}});
  try {
    s.callbacks().onLoadProgress(.5);s.ready();await flush();
    assert.equal(s.root.classList.contains('is-ready'),false);
    options.onProgress(.5);assert.equal(s.root.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'82');
    options.onProgress(.1);assert.equal(s.root.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'82','progress cannot run backwards');
    assert.equal(s.calls.some(([method])=>method==='startPresentation'),false);
    complete();await flush();
    assert.equal(s.root.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'100');
    assert.equal(s.root.classList.contains('is-ready'),true);
    assert(s.calls.some(([method])=>method==='startPresentation'));
  } finally {s.close();}
});

test('image failure offers retry and an old successful completion cannot reveal a new attempt', async () => {
  const attempts=[];
  const s=await setup({prepareContent:({signal})=>new Promise((resolve,reject)=>attempts.push({resolve,reject,signal}))});
  try {
    s.ready();await flush();s.advance(15001);
    assert(s.root.classList.contains('has-error'));assert(attempts[0].signal.aborted);
    s.root.querySelector('.universe-retry').click();await flush();
    s.ready();await flush();attempts[0].resolve();await flush();
    assert.equal(s.root.classList.contains('is-ready'),false);
    attempts[1].reject(new Error('image failure'));await flush();
    assert(s.root.classList.contains('has-error'));
    assert.equal(s.root.querySelector('.universe-continue').getAttribute('href'),'#/notes');
  } finally{s.close();}
});

test('direct content visits defer the 3D import until the homepage is opened', async () => {
  const s=await setup({initiallyCovered:true});
  try {
    assert.equal(s.calls.some(([method])=>method==='mount'),false);
    s.clean.setCovered(false);await flush();
    assert.equal(s.calls.filter(([method])=>method==='mount').length,1);
    s.ready();s.clean.setCovered(true);s.clean.setCovered(false);await flush();
    assert.equal(s.calls.filter(([method])=>method==='mount').length,1,'returning keeps the prepared scene');
  }finally{s.close();}
});

test('loading hides surrounding site controls and restores them only when ready or browsing content', async () => {
  const s=await setup();
  try {
    s.w.document.body.insertAdjacentHTML('beforeend','<header id="site-header"><a href="#/notes">Blog</a></header><footer id="site-footer">Footer</footer>');
    s.callbacks().onLoadProgress(.5);
    assert(s.w.document.documentElement.classList.contains('is-site-preparing'));
    assert.equal(s.w.document.querySelector('#site-header').inert,true);
    s.ready();
    assert.equal(s.w.document.documentElement.classList.contains('is-site-preparing'),false);
    assert.equal(s.w.document.querySelector('#site-header').inert,false);
    s.error();assert(s.w.document.documentElement.classList.contains('is-site-preparing'));
    s.clean.setCovered(true);
    assert.equal(s.w.document.documentElement.classList.contains('is-site-preparing'),false);
  }finally{s.close();}
});

test("scroll progress introduces real section links with a quiet opening and finite ends", async (t) => {
  const s = await setup({ autoProgress: false });
  t.after(() => s.close());
  s.ready();
  const copy = s.root.querySelector(".chapter-copy");
  assert.ok(copy.hidden, "the accepted opening must stay free of added copy");
  s.key("ArrowUp");
  assert.equal(
    s.root.dataset.index,
    "0",
    "do not wrap backwards from the opening",
  );
  s.key(" ");
  s.callbacks().onProgress(0.51);
  assert.equal(copy.querySelector("h2").textContent, "博客");
  assert.equal(copy.querySelector("a").getAttribute("href"), "#/notes");
  assert.equal(copy.inert, true, "fading copy cannot receive keyboard focus");
  s.callbacks().onProgress(1);
  s.advance(950);
  assert.equal(copy.inert, false);
  assert.equal(s.root.classList.contains("is-transitioning"), false);
  s.key(" ");
  s.callbacks().onProgress(2);
  assert.deepEqual(
    [...copy.querySelectorAll("a")].map((a) => a.hash),
    ["#/works", "#/resources"],
  );
  s.clean.setLanguage(true);
  assert.equal(copy.querySelector("h2").textContent, "Works / Materials");
  s.key(" ");
  s.callbacks().onProgress(3);
  assert.equal(copy.querySelector("a").hash, "#/community");
  s.key(" ");
  assert.equal(
    s.root.dataset.index,
    "3",
    "the last chapter must not unexpectedly loop",
  );
});

test("chapter links use the existing route without rotating the R; overlay and language changes keep the chapter", async (t) => {
  const s = await setup({ reduced: true });
  t.after(() => s.close());
  s.ready();
  s.key(" ");
  const copy = s.root.querySelector(".chapter-copy");
  const link = copy.querySelector("a");
  const before = s.calls.length;
  link.dispatchEvent(
    new s.w.MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  link.dispatchEvent(
    new s.w.KeyboardEvent("keydown", { bubbles: true, key: " " }),
  );
  assert.equal(s.calls.length, before);
  s.clean.setCovered(true);
  assert.equal(copy.inert, true);
  s.clean.setLanguage(true);
  s.clean.setCovered(false);
  assert.equal(copy.querySelector("h2").textContent, "Blog");
  assert.equal(s.root.dataset.index, "1");
  assert.equal(copy.inert, false);
  s.key("ArrowUp");
  assert.equal(copy.hidden, true);
});

test("covering or hiding during a chapter change settles its copy and cancels stale reveal timers", async (t) => {
  const s = await setup();
  t.after(() => s.close());
  s.ready();
  s.key(" ");
  s.advance(100);
  s.clean.setCovered(true);
  assert.equal(s.root.querySelector(".chapter-copy h2").textContent, "博客");
  assert.equal(s.root.classList.contains("is-transitioning"), false);
  s.clean.setCovered(false);
  s.key(" ");
  Object.defineProperty(s.w.document, "hidden", {
    value: true,
    configurable: true,
  });
  s.w.document.dispatchEvent(new s.w.Event("visibilitychange"));
  assert.equal(
    s.root.querySelector(".chapter-copy h2").textContent,
    "作品 资料",
  );
  s.advance(3000);
  Object.defineProperty(s.w.document, "hidden", {
    value: false,
    configurable: true,
  });
  s.w.document.dispatchEvent(new s.w.Event("visibilitychange"));
  assert.equal(s.root.dataset.index, "2");
  assert.equal(s.root.querySelector(".chapter-copy").inert, false);
});
test("pointer changes viewpoint; dragging orbits without triggering click pulse", async () => {
  const s = await setup();
  try {
    s.ready();
    s.pointer("pointermove", 750, 150);
    assert.deepEqual(s.calls.filter((c) => c[0] === "setPointer").at(-1), [
      "setPointer",
      0.5,
      0.5,
    ]);
    s.pointer("pointerdown", 500, 300);
    s.pointer("pointermove", 640, 360);
    s.pointer("pointerup", 640, 360);
    assert.ok(s.calls.some((c) => c[0] === "setOrbit" && Math.abs(c[1]) > 0));
    assert.equal(s.calls.filter((c) => c[0] === "pulse").length, 0);
    s.pointer("pointerdown", 700, 200);
    s.pointer("pointerup", 700, 200);
    assert.equal(s.calls.filter((c) => c[0] === "pulse").length, 1);
  } finally {
    s.close();
  }
});
test("leaving the scene, covering content and losing focus reset the pointer without a flow gesture", async () => {
  const s = await setup();
  const lastPointer = () => s.calls.filter((c) => c[0] === "setPointer").at(-1);
  const assertReset = () =>
    assert.deepEqual(lastPointer(), ["setPointer", 0, 0, { reset: true }]);
  try {
    s.ready();
    s.pointer("pointermove", 800, 200);
    s.stage.dispatchEvent(new s.w.Event("pointerleave"));
    assertReset();
    s.pointer("pointerdown", 600, 300);
    s.pointer("pointermove", 700, 350);
    s.clean.setCovered(true);
    assertReset();
    assert.equal(s.captures.size, 0);
    s.clean.setCovered(false);
    s.pointer("pointerdown", 600, 300);
    s.pointer("pointermove", 700, 350);
    s.w.dispatchEvent(new s.w.Event("blur"));
    assertReset();
    assert.equal(s.captures.size, 0);
    const afterBlur = s.calls.length;
    s.pointer("pointerup", 700, 350);
    assert.equal(s.calls.length, afterBlur);
    s.pointer("pointermove", 700, 250);
    Object.defineProperty(s.w.document, "hidden", {
      value: true,
      configurable: true,
    });
    s.w.document.dispatchEvent(new s.w.Event("visibilitychange"));
    assertReset();
    assert.equal(s.calls.filter((c) => c[0] === "pulse").length, 0);
  } finally {
    s.close();
  }
});

test("drag release and a new gesture preserve the renderer's inertial view without reviving canceled input", async (t) => {
  const s = await setup();
  t.after(() => s.close());
  s.ready();
  s.rendererApi.getOrbit = () => ({ x: 0.4, y: 0.1 });
  s.pointer("pointerdown", 500, 300);
  assert.equal(s.calls.at(-1)[0], "beginOrbit");
  s.pointer("pointermove", 520, 300);
  const orbit = s.calls.filter((call) => call[0] === "setOrbit").at(-1);
  assert.ok(
    Math.abs(orbit[1] - (0.4 + 20 * 0.009)) < 1e-9,
    "continue from the settled view, not stale controller coordinates",
  );
  assert.deepEqual(orbit[3], { dragging: true });
  s.pointer("pointerup", 520, 300);
  assert.deepEqual(s.calls.filter((call) => call[0] === "endOrbit").at(-1), [
    "endOrbit",
    { cancel: false },
  ]);
  s.pointer("pointerdown", 500, 300);
  s.pointer("pointermove", 480, 300);
  s.clean.setCovered(true);
  assert.deepEqual(s.calls.filter((call) => call[0] === "endOrbit").at(-1), [
    "endOrbit",
    { cancel: true },
  ]);
  s.clean.setCovered(false);
  s.rendererApi.getOrbit = () => ({ x: 0.55, y: 0.1 });
  s.key("ArrowRight");
  const final = s.calls.filter((call) => call[0] === "setOrbit").at(-1);
  assert.ok(Math.abs(final[1] - (0.55 + Math.PI / 8)) < 1e-9);
});
test("drag sensitivity stays consistent across viewport widths with the more responsive desktop gain", async (t) => {
  const s = await setup();
  t.after(() => s.close());
  s.ready();
  let target = { x: 0, y: 0 };
  s.rendererApi.getOrbit = () => ({ ...target });
  s.rendererApi.setOrbit = (x, y, options) => {
    target = { x, y };
    s.calls.push(["setOrbit", x, y, options]);
  };
  for (let turn = 1; turn <= 3; turn++) {
    s.pointer("pointerdown", 0, 300);
    for (let step = 1; step <= 10; step++)
      s.pointer("pointermove", step * 100, 300);
    s.pointer("pointerup", 1000, 300);
    assert.ok(Math.abs(target.x - turn * 9) < 1e-9);
  }
  s.pointer("pointerdown", 500, 300);
  s.pointer("pointermove", 250, 300);
  assert.ok(Math.abs(target.x - 24.75) < 1e-9);
  s.pointer("pointerup", 250, 300);
  s.stage.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 390,
    height: 844,
  });
  s.pointer("pointerdown", 0, 400, 1, "touch");
  s.pointer("pointermove", 195, 400, 1, "touch");
  s.pointer("pointerup", 195, 400, 1, "touch");
  assert.ok(Math.abs(target.x - (24.75 + 195 * 0.015)) < 1e-9);
});
test("vertical dragging cannot tilt the model, including after an old vertical angle", async () => {
  const s = await setup();
  const orbitY = () => s.calls.filter((c) => c[0] === "setOrbit").at(-1)[2];
  try {
    s.ready();
    s.rendererApi.getOrbit = () => ({ x: 0.4, y: 0.3 });
    s.pointer("pointerdown", 500, 300);
    for (const y of [800, 1200, 1190, -800, -1000, -990]) {
      s.pointer("pointermove", 500, y);
      assert.equal(orbitY(), 0);
      assert.equal(s.calls.filter((c) => c[0] === "setOrbit").at(-1)[1], 0.4);
    }
    s.pointer("pointerup", 500, -990);
    assert.equal(s.calls.filter((c) => c[0] === "pulse").length, 0);
  } finally {
    s.close();
  }
});
test("content overlay preserves the canvas and chapter while blocking backdrop input", async () => {
  const s = await setup({ reduced: true });
  try {
    s.ready();
    s.key(" ");
    assert.equal(s.root.dataset.index, "1");
    const canvas = s.root.querySelector("canvas");
    s.clean.setCovered(true);
    const at = s.calls.length;
    s.pointer("pointerdown", 400, 100);
    s.pointer("pointerup", 400, 100);
    assert.equal(s.calls.slice(at).filter((c) => c[0] === "pulse").length, 0);
    assert.equal(s.root.getAttribute("aria-hidden"), "true");
    s.clean.setLanguage(true);
    assert.match(
      s.root.querySelector("#universe-instructions").textContent,
      /Space/,
    );
    s.clean.setCovered(false);
    assert.equal(s.root.querySelector("canvas"), canvas);
    assert.equal(s.root.dataset.index, "1");
    assert.equal(s.calls.filter((c) => c[0] === "mount").length, 1);
  } finally {
    s.close();
  }
});
test("one wheel gesture completes one scene while forms and the menu suppress shortcuts", async () => {
  const s = await setup({ reduced: true });
  try {
    s.ready();
    for (let i = 0; i < 5; i++)
      s.stage.dispatchEvent(
        new s.w.WheelEvent("wheel", {
          deltaY: 120,
          bubbles: true,
          cancelable: true,
        }),
      );
    assert.equal(Number(s.root.dataset.progress), 1,
      "one wheel gesture must finish a scene and its trailing events must not skip ahead");
    const index = s.root.dataset.index;
    const input = s.w.document.createElement("input");
    s.root.append(input);
    input.dispatchEvent(
      new s.w.KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    assert.equal(s.root.dataset.index, index);
    s.block();
    s.w.dispatchEvent(
      new s.w.KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    assert.equal(s.root.dataset.index, index);
  } finally {
    s.close();
  }
});
test("system reduced motion updates automatically without a visible motion control", async () => {
  const s = await setup({ reduced: true });
  try {
    s.ready();
    assert.ok(
      s.calls.some((c) => c[0] === "setReducedMotion" && c[1] === true),
    );
    s.motion.matches = false;
    s.motion.dispatchEvent(new s.w.Event("change"));
    assert.ok(
      s.calls.some((c) => c[0] === "setReducedMotion" && c[1] === false),
    );
    assert.equal(s.root.classList.contains("is-reduced"), false);
    s.motion.matches = true;
    s.motion.dispatchEvent(new s.w.Event("change"));
    s.clean.setCovered(true);
    s.clean.setCovered(false);
    assert.deepEqual(
      s.calls.filter((c) => c[0] === "setReducedMotion").at(-1),
      ["setReducedMotion", true],
    );
    assert.deepEqual(s.calls.filter((c) => c[0] === "setPaused").at(-1), [
      "setPaused",
      false,
    ]);
    assert.equal(s.root.querySelector(".universe-motion"), null);
  } finally {
    s.close();
  }
});
test("GPU failure exposes readable fallback and retry, with no fake successful background", async () => {
  const s = await setup({ failure: true });
  try {
    assert.ok(s.root.classList.contains("has-error"));
    assert.equal(s.root.querySelector(".universe-retry").hidden, false);
    assert.equal(s.root.querySelector(".universe-feedback").hidden, false);
    assert.match(
      s.root.querySelector(".universe-status").textContent,
      /顶部导航/,
    );
    assert.equal(s.root.classList.contains("is-ready"), false);
  } finally {
    s.close();
  }
});
test("context loss clears readiness; cleanup prevents late module mounting", async () => {
  const s = await setup();
  s.ready();
  s.error();
  assert.equal(s.root.classList.contains("is-ready"), false);
  s.close();
  assert.equal(s.calls.filter((c) => c[0] === "dispose").length, 1);
  const late = await setup({ deferred: true });
  late.clean();
  late.resolve();
  await flush();
  assert.equal(late.calls.filter((c) => c[0] === "mount").length, 0);
  late.close();
});

test("a late ready callback cannot revive a timed out or failed renderer", async () => {
  const s = await setup();
  try {
    s.advance(15000);
    assert.ok(s.root.classList.contains("has-error"));
    s.ready();
    assert.equal(s.root.classList.contains("is-ready"), false);
    s.clean.setCovered(true);
    s.clean.setCovered(false);
    s.w.document.dispatchEvent(new s.w.Event("visibilitychange"));
    assert.deepEqual(s.calls.filter((c) => c[0] === "setPaused").at(-1), [
      "setPaused",
      true,
    ]);
  } finally {
    s.close();
  }
});

test("synchronous callbacks respect renderer attachment and dispose failed mounts", async () => {
  const ready = await setup({ synchronousReady: true });
  try {
    assert.ok(ready.root.classList.contains("is-ready"));
    ready.key(" ");
    assert.equal(ready.root.dataset.index, "1");
  } finally {
    ready.close();
  }
  const failed = await setup({ synchronousError: true });
  try {
    assert.ok(failed.root.classList.contains("has-error"));
    assert.equal(failed.calls.filter((c) => c[0] === "dispose").length, 1);
    assert.equal(
      failed.calls.some((c) => c[0] === "setPaused" && c[1] === false),
      false,
    );
  } finally {
    failed.close();
  }
});

test("opening content before the first frame does not spend the render timeout while covered", async () => {
  const s = await setup();
  try {
    s.clean.setCovered(true);
    s.advance(20000);
    assert.equal(s.root.classList.contains("has-error"), false);
    s.clean.setCovered(false);
    s.advance(1000);
    s.ready();
    assert.ok(s.root.classList.contains("is-ready"));
  } finally {
    s.close();
  }
});

test("a small wheel input uses the complete keyboard transition in either direction", async () => {
  const s = await setup();
  try {
    s.ready();
    const wheel = (deltaY = 120) =>
      s.stage.dispatchEvent(
        new s.w.WheelEvent("wheel", {
          deltaY,
          bubbles: true,
          cancelable: true,
        }),
      );
    wheel(1);
    assert.equal(Number(s.root.dataset.progress), 1);
    wheel(24);
    wheel(-24);
    assert.equal(Number(s.root.dataset.progress), 1, "a burst, including its bounce, stays on one scene");
    s.advance(250);
    assert.equal(s.root.classList.contains("is-transitioning"), false);
    wheel(-1);
    assert.equal(Number(s.root.dataset.progress), 0);
    const wheelTransition=s.calls.filter(c=>c[0]==="setChapter").at(-1)[2];
    s.key(" ");
    assert.deepEqual(wheelTransition, s.calls.filter(c=>c[0]==="setChapter").at(-1)[2]);
    assert.equal(wheelTransition.continuous, false);
  } finally {
    s.close();
  }
});

test("wheel input cannot interrupt or queue chapters while a transition is still rendering", async () => {
  const s = await setup({ autoProgress: false });
  try {
    s.ready();
    const wheel = (deltaY) =>
      s.stage.dispatchEvent(
        new s.w.WheelEvent("wheel", { deltaY, cancelable: true }),
      );
    wheel(120);
    const at=s.calls.length;
    s.advance(800);
    s.callbacks().onProgress(0.5);
    wheel(120);
    wheel(-30);
    assert.equal(s.calls.slice(at).filter(c=>c[0]==="setChapter").length,0);
    s.advance(800);
    wheel(120);
    assert.equal(Number(s.root.dataset.progress),0.5);
    assert.equal(s.calls.slice(at).filter(c=>c[0]==="setChapter").length,0);
    s.advance(250);
    s.callbacks().onProgress(1);
    wheel(-30);
    assert.equal(s.calls.filter(c=>c[0]==="setChapter").at(-1)[1],0);
  } finally {
    s.close();
  }
});

test("a fast wheel burst cannot queue several unseen scenes", async (t) => {
  const s = await setup({ autoProgress: false });
  t.after(() => s.close());
  s.ready();
  for (let i = 0; i < 40; i++)
    s.stage.dispatchEvent(
      new s.w.WheelEvent("wheel", { deltaY: 1200, cancelable: true }),
    );
  const target = s.calls.filter((c) => c[0] === "setChapter").at(-1)[1];
  assert.equal(target, 1, `queued ${target} scenes`);
});

test("one wheel tick completes each adjacent scene regardless of desktop height", async (t) => {
  for (const height of [600, 900, 1440]) {
    const s = await setup();
    t.after(() => s.close());
    s.ready();
    s.stage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1600,
      height,
    });
    for (const start of [0, 1, 2]) {
      s.clean.returnToOpening();
      s.advance(1000);
      for (let scene = 0; scene < start; scene++) s.key("ArrowDown");
      s.stage.dispatchEvent(
          new s.w.WheelEvent("wheel", { deltaY: 120, cancelable: true }),
        );
      const reached = Number(s.root.dataset.progress);
      assert.equal(reached, start + 1, `${height}px display reached ${reached} from ${start}`);
    }
  }
});

test("long touchpad inertia cannot advance another chapter after the animation finishes", async (t) => {
  const s=await setup({autoProgress:false});
  t.after(()=>s.close());
  s.ready();
  const wheel=deltaY=>s.stage.dispatchEvent(new s.w.WheelEvent("wheel",{deltaY,cancelable:true}));
  const before=s.calls.filter(c=>c[0]==="setChapter").length;
  wheel(80);
  for(let frame=0;frame<48;frame++){
    s.advance(100);
    s.callbacks().onProgress(Math.min(1,(frame+1)/30));
    wheel(frame<30?12:0.2);
  }
  assert.equal(s.calls.filter(c=>c[0]==="setChapter").length,before+1);
  assert.equal(Number(s.root.dataset.progress),1);
  s.advance(250);
  wheel(1);
  assert.equal(s.calls.filter(c=>c[0]==="setChapter").at(-1)[1],2);
});

test("wheel input preserves zoom, horizontal scrolling and form controls and respects scene ends", async (t) => {
  const s=await setup({reduced:true});
  t.after(()=>s.close());s.ready();
  const wheel=(options,target=s.stage)=>{
    const event=new s.w.WheelEvent("wheel",{bubbles:true,cancelable:true,...options});
    target.dispatchEvent(event);return event;
  };
  const input=s.w.document.createElement("textarea");s.stage.append(input);
  for(const [options,target] of [
    [{deltaY:0},s.stage], [{deltaY:120,ctrlKey:true},s.stage],
    [{deltaY:1,deltaX:40},s.stage], [{deltaY:120},input],
  ])assert.equal(wheel(options,target).defaultPrevented,false);
  assert.equal(Number(s.root.dataset.progress),0);
  wheel({deltaY:-1});assert.equal(Number(s.root.dataset.progress),0);s.advance(250);
  for(const deltaMode of [0,1,2]){
    wheel({deltaY:1,deltaMode});s.advance(250);
  }
  assert.equal(Number(s.root.dataset.progress),3);
  wheel({deltaY:120});s.advance(250);
  assert.equal(Number(s.root.dataset.progress),3);
  wheel({deltaY:-1});assert.equal(Number(s.root.dataset.progress),2);
  s.advance(250);
  wheel({deltaY:-1},s.root.querySelector('.chapter-links a'));
  assert.equal(Number(s.root.dataset.progress),1,"hovering a scene link must still allow scene navigation");
});

test("wheel gestures wait for an existing Space transition without queuing another scene", async (t) => {
  const s=await setup({autoProgress:false});t.after(()=>s.close());s.ready();
  s.key(" ");const before=s.calls.length;
  s.callbacks().onProgress(0.4);
  s.stage.dispatchEvent(new s.w.WheelEvent("wheel",{deltaY:120,cancelable:true}));
  s.advance(250);s.callbacks().onProgress(1);
  assert.equal(s.calls.slice(before).filter(c=>c[0]==="setChapter").length,0);
  s.stage.dispatchEvent(new s.w.WheelEvent("wheel",{deltaY:120,cancelable:true}));
  assert.equal(s.calls.filter(c=>c[0]==="setChapter").at(-1)[1],2);
});

test("stopping halfway into works does not suddenly reveal its copy", async (t) => {
  const s = await setup({ autoProgress: false });
  t.after(() => s.close());
  s.ready();
  s.key("ArrowDown");
  s.callbacks().onProgress(0.55);
  s.stage.dispatchEvent(
    new s.w.WheelEvent("wheel", { deltaY: 24, cancelable: true }),
  );
  const before = Number(s.root.style.getPropertyValue("--chapter-visibility"));
  s.advance(500);
  const after = Number(s.root.style.getPropertyValue("--chapter-visibility"));
  assert.ok(before < 0.15);
  assert.equal(
    after,
    before,
    "visibility follows the journey, not an idle timer",
  );
  assert.equal(s.root.querySelector(".chapter-copy").inert, true);
  s.callbacks().onProgress(1);
  assert.equal(s.root.querySelector(".chapter-copy").inert, false);
});

test("logo only returns to the opening, retaining manual orientation and cancelling queued travel", async (t) => {
  const s = await setup();
  t.after(() => s.close());
  s.ready();
  s.pointer("pointerdown", 300, 200);
  s.pointer("pointermove", 480, 200);
  s.pointer("pointerup", 480, 200);
  const selectedTurn = s.calls
    .filter((call) => call[0] === "setOrbit")
    .at(-1)[1];
  const before = s.calls.length;
  s.clean.returnToOpening();
  assert.equal(
    s.calls.length,
    before,
    "clicking the logo in the opening is a no-op",
  );
  s.key("ArrowDown");
  const returning = s.calls.length;
  s.clean.returnToOpening();
  assert.equal(s.root.dataset.returning, "out");
  assert.equal(
    s.root.dataset.progress,
    "1.0000",
    "keep the old frame during fade-out",
  );
  s.clean.returnToOpening();
  s.advance(220);
  assert.deepEqual(
    s.calls.filter((call) => call[0] === "setChapter").at(-1),
    ["setChapter", 0, { immediate: true }],
    "return without replaying the journey backwards",
  );
  assert.equal(
    s.calls.slice(returning).some((call) => call[0] === "setOrbit"),
    false,
  );
  assert.equal(s.root.dataset.progress, "0.0000");
  assert.equal(s.root.dataset.returning, "in");
  s.advance(700);
  assert.equal(s.root.dataset.returning, "idle");
  s.pointer("pointerdown", 480, 200);
  s.pointer("pointermove", 500, 200);
  s.pointer("pointerup", 500, 200);
  assert.ok(
    s.calls.filter((call) => call[0] === "setOrbit").at(-1)[1] > selectedTurn,
    "a new drag continues from the user's previous angle",
  );
});

test("return fades cancel cleanly for reduced motion, a covered page and disposal", async (t) => {
  for (const ending of ["reduced", "covered", "dispose"]) {
    const s = await setup();
    t.after(() => s.close());
    s.ready();
    s.key("ArrowDown");
    s.clean.returnToOpening();
    s.advance(100);
    if (ending === "reduced") {
      s.motion.matches = true;
      s.motion.dispatchEvent(new s.w.Event("change"));
    } else if (ending === "covered") s.clean.setCovered(true);
    else s.clean();
    const after = s.calls.length;
    s.advance(2000);
    assert.equal(
      s.calls.length,
      after,
      "no delayed return may run after cancellation",
    );
    if (ending !== "dispose") {
      assert.equal(s.root.dataset.progress, "0.0000");
      assert.equal(s.root.dataset.returning, "idle");
    }
  }
});

test("mouse feedback belongs only to the opening and returning clears queued travel", async (t) => {
  const s = await setup();
  t.after(() => s.close());
  s.ready();
  for (let chapter = 1; chapter <= 3; chapter++) {
    s.key("ArrowDown");
    s.advance(3000);
    assert.equal(s.root.dataset.index, String(chapter));
    assert.equal(s.root.dataset.interactive, "false");
    const start = s.calls.length;
    s.pointer("pointermove", 300, 200);
    s.pointer("pointerdown", 300, 200);
    s.pointer("pointermove", 650, 300);
    s.pointer("pointerup", 650, 300);
    s.key("ArrowRight");
    assert.equal(
      s.calls
        .slice(start)
        .some(
          (c) =>
            ["pulse", "beginOrbit", "setOrbit"].includes(c[0]) ||
            (c[0] === "setPointer" && !c[3]?.reset),
        ),
      false,
      `chapter ${chapter} must not respond to mouse movement or rotation input`,
    );
  }
  s.clean.setCovered(true);
  s.clean.returnToOpening();
  s.clean.setCovered(false);
  s.advance(1000);
  assert.equal(s.root.dataset.progress, "0.0000");
  assert.equal(s.root.dataset.interactive, "true");
  s.pointer("pointermove", 300, 200);
  assert.ok(
    s.calls.filter((c) => c[0] === "setPointer").at(-1)[3]?.reset !== true,
  );
});

test("a second finger cannot hijack an active drag and covering releases pointer capture", async () => {
  const s = await setup();
  try {
    s.ready();
    s.pointer("pointerdown", 400, 300, 1);
    s.pointer("pointerdown", 700, 300, 2);
    s.pointer("pointermove", 550, 320, 1);
    assert.ok(s.calls.filter((c) => c[0] === "setOrbit").at(-1)[1] > 0);
    s.pointer("pointerup", 700, 300, 2);
    assert.equal(s.calls.filter((c) => c[0] === "pulse").length, 0);
    s.clean.setCovered(true);
    assert.equal(s.captures.size, 0);
    assert.equal(s.root.classList.contains("is-dragging"), false);
    s.clean.setCovered(false);
    s.pointer("pointerup", 550, 320, 1);
    assert.equal(s.calls.filter((c) => c[0] === "pulse").length, 0);
  } finally {
    s.close();
  }
});

test("modal and covered content suppress keyboard, wheel and pointer input", async () => {
  const s = await setup();
  try {
    s.ready();
    s.block();
    const at = s.calls.length;
    s.key(" ");
    s.key("ArrowRight");
    s.pointer("pointerdown", 200, 200);
    s.pointer("pointerup", 200, 200);
    s.stage.dispatchEvent(new s.w.WheelEvent("wheel", { deltaY: 120 }));
    assert.equal(s.calls.length, at);
    s.block(false);
    s.clean.setCovered(true);
    const after = s.calls.length;
    s.key(" ");
    s.key("ArrowRight");
    s.pointer("pointermove", 600, 300);
    s.stage.dispatchEvent(new s.w.WheelEvent("wheel", { deltaY: 120 }));
    assert.equal(s.calls.length, after);
  } finally {
    s.close();
  }
});

test("retry starts a new renderer generation and ignores old callbacks", async () => {
  const s = await setup();
  try {
    const old = s.callbacks();
    s.error();
    s.root.querySelector(".universe-retry").click();
    await flush();
    assert.equal(s.calls.filter((c) => c[0] === "mount").length, 2);
    assert.equal(s.root.classList.contains("is-ready"), false);
    old.onReady();
    assert.equal(s.root.classList.contains("is-ready"), false);
    s.ready();
    old.onError(new Error("obsolete context"));
    assert.ok(s.root.classList.contains("is-ready"));
    assert.equal(s.root.classList.contains("has-error"), false);
    assert.equal(s.root.querySelector(".universe-feedback").hidden, true);
  } finally {
    s.close();
  }
});

test("one vertical touch swipe completes one chapter on release without orbiting or pulsing", async () => {
  const s = await setup();
  try {
    s.ready();
    const orbitCount = s.calls.filter((c) => c[0] === "setOrbit").length;
    s.pointer("pointerdown", 500, 400, 1, "touch");
    s.pointer("pointermove", 507, 320, 1, "touch");
    assert.equal(Number(s.root.dataset.progress), 0);
    s.pointer("pointermove", 510, 100, 1, "touch");
    assert.equal(Number(s.root.dataset.progress), 0, "the gesture must not leave a partial scene before release");
    s.pointer("pointerup", 510, 100, 1, "touch");
    assert.equal(Number(s.root.dataset.progress), 1);
    assert.deepEqual(s.calls.filter(c=>c[0]==="setChapter").at(-1).slice(1), [1,{continuous:false}]);
    assert.equal(s.calls.filter((c) => c[0] === "setOrbit").length, orbitCount);
    assert.equal(s.calls.filter((c) => c[0] === "pulse").length, 0);
    s.pointer("pointerup", 510, 100, 1, "touch");
    assert.equal(s.root.dataset.index, "1");
    s.advance(1200);
    s.pointer("pointerdown", 500, 200, 1, "touch");
    s.pointer("pointerup", 500, 265, 1, "touch");
    assert.equal(Number(s.root.dataset.progress), 0);
  } finally {
    s.close();
  }
});

test("short or canceled touch swipes do not cross a chapter, and only an opening tap pulses", async () => {
  const s = await setup({ reduced: true });
  try {
    s.ready();
    s.pointer("pointerdown", 500, 400, 1, "touch");
    s.pointer("pointermove", 500, 336, 1, "touch");
    s.pointer("pointerup", 500, 336, 1, "touch");
    assert.equal(Number(s.root.dataset.progress), 0);
    s.pointer("pointerdown", 500, 400, 1, "touch");
    s.pointer("pointermove", 500, 200, 1, "touch");
    s.pointer("pointercancel", 500, 200, 1, "touch");
    assert.equal(Number(s.root.dataset.progress), 0);
    assert.equal(s.calls.filter((c) => c[0] === "pulse").length, 0);
    s.clean.returnToOpening();
    s.pointer("pointerdown", 500, 400, 1, "touch");
    s.pointer("pointerup", 500, 400, 1, "touch");
    assert.equal(s.calls.filter((c) => c[0] === "pulse").length, 1);
    assert.equal(s.root.dataset.index, "0");
  } finally {
    s.close();
  }
});

test("a touch gesture begun during a chapter transition never queues another chapter", async (t) => {
  const s=await setup({autoProgress:false});t.after(()=>s.close());s.ready();
  s.pointer("pointerdown",500,400,1,"touch");
  s.pointer("pointermove",500,320,1,"touch");
  s.pointer("pointerup",500,320,1,"touch");
  assert.equal(s.calls.filter(c=>c[0]==="setChapter").at(-1)[1],1);
  const before=s.calls.length;
  s.callbacks().onProgress(.5);
  s.pointer("pointerdown",500,400,2,"touch");
  s.pointer("pointermove",500,100,2,"touch");
  s.callbacks().onProgress(1);
  s.pointer("pointerup",500,100,2,"touch");
  assert.equal(s.calls.slice(before).filter(c=>c[0]==="setChapter").length,0);
  s.pointer("pointerdown",500,400,3,"touch");
  s.pointer("pointermove",500,320,3,"touch");
  s.pointer("pointerup",500,320,3,"touch");
  assert.equal(s.calls.filter(c=>c[0]==="setChapter").at(-1)[1],2);
});

test("touch release cannot add a chapter after the keyboard changed the original scene", async (t) => {
  const s=await setup({autoProgress:false});t.after(()=>s.close());s.ready();
  s.pointer("pointerdown",500,400,1,"touch");
  s.pointer("pointermove",500,300,1,"touch");
  s.key(" ");s.callbacks().onProgress(1);
  const before=s.calls.length;
  s.pointer("pointerup",500,200,1,"touch");
  assert.equal(s.calls.slice(before).filter(c=>c[0]==="setChapter").length,0);
  assert.equal(Number(s.root.dataset.progress),1);
});

test("short deliberate swipes traverse whole chapters and stay within both scene boundaries", async (t) => {
  for(const reduced of [false,true]){
    const s=await setup({reduced});t.after(()=>s.close());s.ready();
    const swipe=dy=>{
      s.pointer("pointerdown",500,400,1,"touch");
      s.pointer("pointermove",505,400+dy,1,"touch");
      s.pointer("pointerup",505,400+dy,1,"touch");
    };
    swipe(80);assert.equal(Number(s.root.dataset.progress),0);
    for(const chapter of [1,2,3]){swipe(-80);assert.equal(Number(s.root.dataset.progress),chapter);}
    swipe(-80);assert.equal(Number(s.root.dataset.progress),3);
    for(const chapter of [2,1,0]){swipe(80);assert.equal(Number(s.root.dataset.progress),chapter);}
  }
});

test("horizontal touch dragging locks to orbit even if the gesture later moves vertically", async () => {
  const s = await setup({ reduced: true });
  try {
    s.ready();
    s.pointer("pointerdown", 500, 400, 1, "touch");
    s.pointer("pointermove", 550, 402, 1, "touch");
    s.pointer("pointermove", 560, 100, 1, "touch");
    s.pointer("pointerup", 560, 100, 1, "touch");
    assert.ok(s.calls.some((c) => c[0] === "setOrbit" && c[1] > 0));
    assert.ok(
      s.calls.filter((c) => c[0] === "setOrbit").every((c) => c[2] === 0),
    );
    assert.equal(s.root.dataset.index, "0");
    assert.equal(s.calls.filter((c) => c[0] === "pulse").length, 0);
  } finally {
    s.close();
  }
});

test("a second touch cancels the whole gesture until every finger is lifted", async () => {
  const s = await setup({ reduced: true });
  try {
    s.ready();
    s.pointer("pointerdown", 500, 400, 1, "touch");
    s.pointer("pointermove", 500, 300, 1, "touch");
    s.pointer("pointerdown", 700, 400, 2, "touch", false);
    const at = s.calls.length;
    s.pointer("pointermove", 500, 100, 1, "touch");
    s.pointer("pointerup", 500, 100, 1, "touch");
    s.pointer("pointermove", 700, 100, 2, "touch", false);
    s.pointer("pointerup", 700, 100, 2, "touch", false);
    assert.equal(s.root.dataset.index, "0");
    assert.equal(s.captures.size, 0);
    assert.equal(s.calls.slice(at).length, 0);
    s.pointer("pointerdown", 500, 400, 3, "touch");
    s.pointer("pointerup", 500, 200, 3, "touch");
    assert.equal(s.root.dataset.index, "1");
  } finally {
    s.close();
  }
});

test("keyboard permits reverse chapters and orbit while leaving modified or repeated keys alone", async () => {
  const s = await setup({ reduced: true });
  try {
    s.ready();
    s.key("ArrowUp");
    assert.equal(s.root.dataset.index, "0");
    s.key("ArrowDown");
    assert.equal(s.root.dataset.index, "1");
    s.key("ArrowUp");
    assert.equal(s.root.dataset.index, "0");
    s.key(" ", { repeat: true });
    s.key(" ", { ctrlKey: true });
    s.key("ArrowDown", { metaKey: true });
    assert.equal(s.root.dataset.index, "0");
    s.key("ArrowRight");
    assert.equal(
      s.calls.filter((c) => c[0] === "setOrbit").at(-1)[1],
      Math.PI / 8,
    );
    s.key("ArrowLeft");
    assert.equal(s.calls.filter((c) => c[0] === "setOrbit").at(-1)[1], 0);
  } finally {
    s.close();
  }
});

test("hidden tabs suspend the first-frame deadline and cleanup releases an active drag", async () => {
  const s = await setup();
  try {
    Object.defineProperty(s.w.document, "hidden", {
      value: true,
      configurable: true,
    });
    s.w.document.dispatchEvent(new s.w.Event("visibilitychange"));
    s.advance(16000);
    assert.equal(s.root.classList.contains("has-error"), false);
    Object.defineProperty(s.w.document, "hidden", {
      value: false,
      configurable: true,
    });
    s.w.document.dispatchEvent(new s.w.Event("visibilitychange"));
    s.ready();
    s.pointer("pointerdown", 500, 300);
    assert.equal(s.captures.size, 1);
    s.clean();
    assert.equal(s.captures.size, 0);
    const at = s.calls.length;
    s.pointer("pointermove", 700, 400);
    s.ready();
    s.error();
    s.advance(20000);
    assert.equal(s.calls.length, at);
  } finally {
    s.close();
  }
});


