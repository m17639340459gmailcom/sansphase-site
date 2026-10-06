import assert from "node:assert/strict";
import test from "node:test";
import { createCinematicBackdrop, type CinematicImageResource } from "../../src/community-atlas/cinematic-backdrop.ts";
import * as cinematic from "../../src/community-atlas/cinematic-backdrop.ts";
import { atlasSourceCrop } from "../../src/community-atlas/atlas-camera.ts";

type Gradient = { stops: [number, string][]; addColorStop(at: number, color: string): void };
type Paint = { kind: string; geometry: number[]; style: string | [number, string][]; alpha: number; mode: string; source?: CanvasImageSource };
function recorder() {
  const paints: Paint[] = [];
  const state = { fillStyle: "caller-style" as string | Gradient, strokeStyle: "caller-stroke" as string | Gradient,
    lineWidth: 2, globalAlpha: .37, globalCompositeOperation: "lighter" };
  const stack: typeof state[] = [];
  let path: number[] = [];
  let failingSource: CanvasImageSource | undefined;
  const snapshot = (style: string | Gradient): Paint["style"] => typeof style === "string"
    ? style : style.stops.map(([at, color]) => [at, color]);
  const context = {
    ...state,
    save() { stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
    restore() { const previous = stack.pop(); assert.ok(previous); Object.assign(this, previous); },
    beginPath() { path = []; },
    arc(...values: number[]) { path.push(...values); },
    moveTo(...values: number[]) { path.push(...values); },
    lineTo(...values: number[]) { path.push(...values); },
    fill() { paints.push({ kind: "star", geometry: [...path], style: snapshot(this.fillStyle), alpha: this.globalAlpha, mode: this.globalCompositeOperation }); },
    stroke() { paints.push({ kind: "meteor", geometry: [...path, this.lineWidth], style: snapshot(this.strokeStyle), alpha: this.globalAlpha, mode: this.globalCompositeOperation }); },
    fillRect(...geometry: number[]) { paints.push({ kind: "base", geometry, style: snapshot(this.fillStyle), alpha: this.globalAlpha, mode: this.globalCompositeOperation }); },
    drawImage(source: CanvasImageSource, ...geometry: number[]) {
      if (source === failingSource) throw new Error("image decode failed");
      paints.push({ kind: "image", source, geometry, style: snapshot(this.fillStyle), alpha: this.globalAlpha, mode: this.globalCompositeOperation });
    },
    createRadialGradient(): Gradient { return { stops: [], addColorStop(at, color) { this.stops.push([at, color]); } }; },
    createLinearGradient(): Gradient { return { stops: [], addColorStop(at, color) { this.stops.push([at, color]); } }; },
    getTransform() { return { a: 1.5, b: 0, c: 0, d: 1.5, e: 0, f: 0 }; },
    setTransform() { assert.fail("the backdrop must retain the caller's DPR transform"); },
    clearRect() { assert.fail("the backdrop must not erase the preceding constellation drawing"); },
  };
  return { ctx: context as unknown as CanvasRenderingContext2D, context, paints,
    depth: () => stack.length, clear: () => { paints.length = 0; },
    failImage: (source: CanvasImageSource) => { failingSource = source; } };
}

function imageFixture(ready = false) {
  let loaded = ready, width = ready ? 1600 : 0, height = ready ? 900 : 0;
  let load: (() => void) | undefined, error: (() => void) | undefined;
  let cancelled = 0;
  const urls: string[] = [];
  const source = {} as CanvasImageSource;
  const resource: CinematicImageResource = {
    source,
    get width() { return width; }, get height() { return height; }, get ready() { return loaded; },
    load(url, onLoad, onError) {
      urls.push(url); load = onLoad; error = onError;
      return () => { cancelled++; load = error = undefined; };
    },
  };
  return {
    resource, source, urls,
    factory: () => resource,
    loaded(w = 1600, h = 900) { width = w; height = h; loaded = true; load?.(); },
    failed() { loaded = false; error?.(); },
    pendingLoad: () => load,
    listenerCount: () => Number(Boolean(load)) + Number(Boolean(error)),
    cancelled: () => cancelled,
  };
}

test("image preparation waits for decoding, detaches its request and rejects unavailable resources", async () => {
  assert.equal(typeof cinematic.prepareCinematicImage, "function");
  const asset = imageFixture();
  let decoded!: () => void;
  let decoding = 0, complete = false;
  asset.resource.decode = () => { decoding++; return new Promise<void>(resolve => { decoded = resolve; }); };
  const preparing = cinematic.prepareCinematicImage(asset.resource, 1000).then(image => { complete = true; return image; });
  assert.equal(asset.urls.length, 1);
  asset.loaded(); await Promise.resolve();
  assert.equal(decoding, 1); assert.equal(complete, false);
  decoded(); assert.equal(await preparing, asset.resource);
  assert.equal(asset.listenerCount(), 0); assert.equal(asset.cancelled(), 1);
  const failed = imageFixture();
  const failing = cinematic.prepareCinematicImage(failed.resource, 1000);
  failed.failed(); await assert.rejects(failing, /background|image|sky/i);
  assert.equal(failed.listenerCount(), 0);
});

test("image preparation times out and a stale load cannot restart decoding", async () => {
  assert.equal(typeof cinematic.prepareCinematicImage, "function");
  const asset = imageFixture();
  let decodes = 0;
  asset.resource.decode = async () => { decodes++; };
  const preparing = cinematic.prepareCinematicImage(asset.resource, 5);
  const late = asset.pendingLoad()!;
  await assert.rejects(preparing, /timed out/i);
  assert.equal(asset.cancelled(), 1); assert.equal(asset.listenerCount(), 0);
  late(); await Promise.resolve(); assert.equal(decodes, 0);
});

test("the browser plate is decoded once and reused intact for the first paint of every mount", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const images: BrowserImage[] = [];
  class BrowserImage extends EventTarget {
    decoding = "";
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    src = "";
    decodes = 0;
    released = 0;
    decoded!: () => void;
    constructor() { super(); images.push(this); }
    decode() { this.decodes++; return new Promise<void>(resolve => { this.decoded = resolve; }); }
    removeAttribute(name: string) { if (name === "src") { this.src = ""; this.released++; } }
    loaded() { this.complete = true; this.naturalWidth = 1672; this.naturalHeight = 941; this.dispatchEvent(new Event("load")); }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: BrowserImage });
  t.after(() => { if (original) Object.defineProperty(globalThis, "Image", original); else Reflect.deleteProperty(globalThis, "Image"); });
  const firstRequest = cinematic.prepareCinematicBackdrop();
  await Promise.resolve();
  images[0]!.dispatchEvent(new Event("error"));
  await assert.rejects(firstRequest);
  const preparing = cinematic.prepareCinematicBackdrop();
  assert.equal(cinematic.prepareCinematicBackdrop(), preparing, "concurrent renders share the pending request");
  await Promise.resolve();
  assert.equal(images.length, 2, "a failed request is retried, without duplicating the pending image");
  const image = images[1]!;
  image.loaded(); await Promise.resolve();
  const drawing = recorder();
  assert.throws(() => createCinematicBackdrop(drawing.ctx), /prepared/, "the page cannot paint a substitute while decode is pending");
  image.decoded(); await preparing;
  for (let mount = 0; mount < 2; mount++) {
    await cinematic.prepareCinematicBackdrop();
    const scene = createCinematicBackdrop(drawing.ctx, { motionFactory: () => null });
    drawing.clear(); scene.paint(800, 600, 0);
    assert.ok(drawing.paints.some(paint => paint.kind === "image" && paint.source === image as unknown as CanvasImageSource));
    assert.ok(drawing.paints.filter(paint => paint.kind === "star").length < 100, "the generated fine-star loading layer never paints before the approved plate");
    scene.dispose();
    assert.equal(image.src, "/assets/community/atlas-space.webp");
    assert.equal(image.released, 0, "disposal only releases each renderer, keeping the decoded shared plate");
  }
  assert.equal(images.length, 2); assert.equal(image.decodes, 1);
  const failing = createCinematicBackdrop(drawing.ctx, { motionFactory: () => null });
  drawing.failImage(image as unknown as CanvasImageSource);
  assert.throws(() => failing.paint(800, 600, 0), /painted/);
  assert.equal(drawing.depth(), 0, "a painting failure still restores canvas state for explicit fallback handling");
  failing.dispose();
});

test("loading and unavailable images retain a star field without blocking existing content", () => {
  const drawing = recorder(), asset = imageFixture();
  const scene = createCinematicBackdrop(drawing.ctx, { imageFactory: asset.factory });
  assert.deepEqual(asset.urls, ["/assets/community/atlas-space.webp"]);
  scene.paint(600, 400, 0);
  assert.ok(drawing.paints.filter(p => p.kind === "star").length > 700, "the fallback must include actual fine and layered stars");
  assert.equal(drawing.paints.filter(p => p.kind === "image").length, 0);
  assert.equal(drawing.paints.at(-1)!.kind, "base");
  assert.ok(drawing.paints.every(p => p.mode === "destination-over"), "all new imagery belongs behind the already drawn constellations");
  asset.failed(); drawing.clear();
  assert.doesNotThrow(() => scene.paint(600, 400, 5));
  assert.ok(drawing.paints.some(p => p.kind === "star"));
  assert.equal(drawing.paints.filter(p => p.kind === "image").length, 0);
  scene.dispose();
});

test("loaded artwork uses the shared cinematic cover without stretching or exposing edges", () => {
  const drawing = recorder(), asset = imageFixture();
  const scene = createCinematicBackdrop(drawing.ctx, { imageFactory: asset.factory });
  asset.loaded();
  for (const [width, height] of [[1200, 800], [390, 720], [1920, 720]]) {
    drawing.clear(); scene.paint(width!, height!, 12);
    const image = drawing.paints.find(p => p.kind === "image" && p.source === asset.source)!;
    assert.ok(image, "loaded artwork is actually painted");
    const [sx, sy, sw, sh, dx, dy, dw, dh] = image.geometry;
    assert.deepEqual([dx, dy, dw, dh], [0, 0, width, height]);
    assert.ok(sx! >= 0 && sy! >= 0 && sx! + sw! <= 1600 + 1e-7 && sy! + sh! <= 900 + 1e-7);
    assert.ok(Math.abs(sw! / sh! - width! / height!) < 1e-10, "cover preserves the asset aspect ratio");
    const crop = atlasSourceCrop(width!, height!, 1600, 900);
    assert.deepEqual([sx, sy, sw, sh], [crop.x * 1600, crop.y * 900, crop.width * 1600, crop.height * 900]);
    assert.equal(image.alpha, 1, "there is no extra screen-wide dimming veil over the approved artwork");
  }
  scene.dispose();
});

test("2D fallback keeps fixed framing and live starlight, freezes deterministically and restores caller state", () => {
  const drawing = recorder(), asset = imageFixture(true);
  const scene = createCinematicBackdrop(drawing.ctx, { imageFactory: asset.factory });
  scene.paint(600, 400, 0);
  const initial = [...drawing.paints];
  drawing.clear(); scene.paint(600, 400, 0);
  assert.deepEqual(drawing.paints, initial);
  drawing.clear(); scene.paint(600, 400, 12);
  assert.deepEqual(drawing.paints.find(p => p.kind === "image")!.geometry, initial.find(p => p.kind === "image")!.geometry,
    "unsupported GPUs must not substitute the rejected whole-image sway for internal cloud motion");
  assert.notDeepEqual(drawing.paints.filter(p => p.kind === "star"), initial.filter(p => p.kind === "star"), "independent star light remains alive");
  assert.equal(drawing.context.globalAlpha, .37);
  assert.equal(drawing.context.globalCompositeOperation, "lighter");
  assert.equal(drawing.context.fillStyle, "caller-style");
  assert.equal(drawing.depth(), 0);
  scene.dispose();
});

test("cloud motion is created after decoding and follows the existing pausable sky clock", () => {
  const drawing = recorder(), asset = imageFixture();
  const frame = {} as CanvasImageSource;
  const times: number[][] = [];
  let creations = 0, releases = 0;
  const scene = createCinematicBackdrop(drawing.ctx, {
    imageFactory: asset.factory,
    motionFactory(source, width, height) {
      creations++;
      assert.equal(source, asset.source);
      assert.deepEqual([width, height], [1600, 900]);
      return {
        render(w, h, time) { times.push([w, h, time]); return frame; },
        dispose() { releases++; },
      };
    },
  });
  scene.paint(600, 400, 0);
  assert.equal(creations, 0, "do not create a texture from a pending image");
  asset.loaded();
  drawing.clear();
  for (const time of [0, 8, 8, 8.04]) scene.paint(600, 400, time);
  assert.equal(creations, 1, "reuse one renderer and texture");
  assert.deepEqual(times, [[600, 400, 0], [600, 400, 8], [600, 400, 8], [600, 400, 8.04]]);
  const frames = drawing.paints.filter(p => p.source === frame);
  assert.equal(frames.length, 4);
  assert.ok(frames.every(p => p.mode === "destination-over" && p.alpha === 1));
  assert.ok(frames.every(p => JSON.stringify(p.geometry) === "[0,0,600,400]"), "motion output already contains the cover crop");
  assert.ok(drawing.paints.every(p => p.source !== asset.source), "never paint the static plate over an animated frame");
  scene.dispose(); scene.dispose();
  assert.equal(releases, 1);
});

test("lost graphics context uses the original plate and restoration can wake a paused scene", () => {
  const drawing = recorder(), asset = imageFixture(true);
  const frame = {} as CanvasImageSource;
  let available = true, changed: (() => void) | undefined, signals = 0;
  const scene = createCinematicBackdrop(drawing.ctx, {
    imageFactory: asset.factory,
    onReady() { signals++; },
    motionFactory(_source, _width, _height, options) {
      changed = options?.onChange;
      return { render() { return available ? frame : null; }, dispose() {} };
    },
  });
  scene.paint(600, 400, 12);
  assert.ok(drawing.paints.some(p => p.source === frame));
  available = false; changed?.(); drawing.clear();
  scene.paint(600, 400, 12);
  assert.ok(drawing.paints.some(p => p.source === asset.source));
  assert.ok(drawing.paints.every(p => p.source !== frame));
  available = true; changed?.(); drawing.clear();
  scene.paint(600, 400, 12);
  assert.ok(drawing.paints.some(p => p.source === frame));
  assert.equal(signals, 2);
  scene.dispose(); changed?.();
  assert.equal(signals, 2, "late graphics events must not restart a disposed route");
});

test("unsupported or failing motion keeps the image and does not retry allocations each frame", () => {
  for (const failure of ["unsupported", "creation", "render", "copy"] as const) {
    const drawing = recorder(), asset = imageFixture(true);
    const frame = {} as CanvasImageSource;
    let creations = 0, releases = 0;
    if (failure === "copy") drawing.failImage(frame);
    const scene = createCinematicBackdrop(drawing.ctx, {
      imageFactory: asset.factory,
      motionFactory() {
        creations++;
        if (failure === "unsupported") return null;
        if (failure === "creation") throw new Error("graphics unavailable");
        return {
          render() { if (failure === "render") throw new Error("context invalid"); return frame; },
          dispose() { releases++; },
        };
      },
    });
    for (const time of [0, 3, 7]) {
      drawing.clear();
      assert.doesNotThrow(() => scene.paint(600, 400, time));
      assert.ok(drawing.paints.some(p => p.source === asset.source), `${failure} should preserve original artwork`);
      assert.equal(drawing.depth(), 0);
    }
    scene.dispose();
    assert.equal(creations, 1);
    assert.equal(releases, failure === "render" || failure === "copy" ? 1 : 0);
  }
});

test("dispose cancels listeners exactly once and late image completion cannot revive the scene", () => {
  const drawing = recorder(), asset = imageFixture();
  let readySignals = 0;
  const scene = createCinematicBackdrop(drawing.ctx, { imageFactory: asset.factory, onReady() { readySignals++; } });
  const lateLoad = asset.pendingLoad()!;
  assert.equal(asset.listenerCount(), 2);
  scene.dispose(); scene.dispose();
  assert.equal(asset.cancelled(), 1);
  assert.equal(asset.listenerCount(), 0);
  lateLoad();
  assert.equal(readySignals, 0, "late events must not request a new frame after disposal");
  scene.paint(600, 400, 20);
  assert.equal(drawing.paints.length, 0);
});

test("invalid dimensions, asset construction failures and decoding errors are safe", () => {
  const drawing = recorder();
  const missing = createCinematicBackdrop(drawing.ctx, { imageFactory: () => { throw new Error("Image unavailable"); } });
  for (const [width, height] of [[0, 400], [600, -1], [NaN, 800], [Infinity, 800]]) missing.paint(width!, height!, 0);
  assert.equal(drawing.paints.length, 0);
  assert.doesNotThrow(() => missing.paint(600, 400, NaN));
  assert.ok(drawing.paints.some(p => p.kind === "star"));
  missing.dispose();
  drawing.clear();
  const asset = imageFixture(true), scene = createCinematicBackdrop(drawing.ctx, { imageFactory: asset.factory });
  drawing.failImage(asset.source);
  assert.doesNotThrow(() => scene.paint(600, 400, 9));
  assert.equal(drawing.depth(), 0);
  assert.equal(drawing.context.globalAlpha, .37);
  assert.equal(drawing.context.globalCompositeOperation, "lighter");
  assert.ok(drawing.paints.some(p => p.kind === "base"), "a failing decoded asset still leaves the navy fallback");
  scene.dispose();
});

test("image completion requests one redraw for a frozen runtime without owning an animation loop", () => {
  const drawing = recorder(), asset = imageFixture();
  let readySignals = 0;
  const scene = createCinematicBackdrop(drawing.ctx, { imageFactory: asset.factory, onReady() { readySignals++; } });
  scene.paint(600, 400, 0);
  assert.equal(readySignals, 0);
  asset.loaded();
  assert.equal(readySignals, 1);
  asset.loaded();
  assert.equal(readySignals, 1, "a duplicate load event must not cause a redraw storm");
  drawing.clear(); scene.paint(600, 400, 0);
  assert.ok(drawing.paints.some(p => p.source === asset.source));
  scene.dispose();
});

test("the cinematic scene retains the existing finite meteor lifecycle on its frozen sky clock", () => {
  const drawing = recorder(), asset = imageFixture(true);
  const scene = createCinematicBackdrop(drawing.ctx, { imageFactory: asset.factory });
  scene.paint(600, 400, 3);
  const active = [...drawing.paints];
  assert.ok(active.some(p => p.kind === "meteor"));
  drawing.clear(); scene.paint(600, 400, 3);
  assert.deepEqual(drawing.paints, active, "frozen time keeps the meteor in place");
  drawing.clear(); scene.paint(600, 400, 4);
  assert.ok(drawing.paints.every(p => p.kind !== "meteor"));
  scene.dispose();
});
