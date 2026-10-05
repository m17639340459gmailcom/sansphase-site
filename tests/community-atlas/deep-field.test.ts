import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { paintDeepField, resetDeepField } from "../../src/community-atlas/deep-field.ts";

type Paint =
  | { kind: "star"; x: number; y: number; radius: number; color: string; mode: string }
  | { kind: "cell"; x: number; y: number; width: number; height: number; color: string; mode: string }
  | { kind: "image"; source: object; x: number; y: number; width: number; height: number; mode: string };
interface SurfaceStub {
  width: number;
  height: number;
  ownerDocument?: { createElement(tag: string): SurfaceStub };
  getContext(kind: string): ReturnType<typeof recorder>["context"] | null;
}
function recorder(ratio = 1) {
  const paints: Paint[] = [];
  const uploaded: ImageData[] = [];
  let path = { x: 0, y: 0, radius: 0 };
  let transform = { a: ratio, b: 0, c: 0, d: ratio, e: 0, f: 0 };
  const stack: { fillStyle: string; globalAlpha: number; globalCompositeOperation: string; transform: typeof transform }[] = [];
  const context = {
    canvas: undefined as SurfaceStub | undefined,
    fillStyle: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    save() { stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation, transform: { ...transform } }); },
    restore() {
      const state = stack.pop();
      assert.ok(state, "restore must match save");
      this.fillStyle = state.fillStyle;
      this.globalAlpha = state.globalAlpha;
      this.globalCompositeOperation = state.globalCompositeOperation;
      transform = state.transform;
    },
    beginPath() {},
    arc(x: number, y: number, radius: number) {
      assert.ok([x, y, radius].every(Number.isFinite));
      assert.ok(radius > 0);
      path = { x, y, radius };
    },
    fill() { paints.push({ kind: "star", ...path, color: this.fillStyle, mode: this.globalCompositeOperation }); },
    fillRect(x: number, y: number, width: number, height: number) {
      assert.ok([x, y, width, height].every(Number.isFinite));
      assert.ok(width > 0 && height > 0);
      paints.push({ kind: "cell", x, y, width, height, color: this.fillStyle, mode: this.globalCompositeOperation });
    },
    drawImage(source: object, x: number, y: number, width: number, height: number) {
      assert.ok([x, y, width, height].every(Number.isFinite));
      paints.push({ kind: "image", source, x, y, width, height, mode: this.globalCompositeOperation });
    },
    getTransform() { return { ...transform }; },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { transform = { a, b, c, d, e, f }; },
    createImageData(width: number, height: number): ImageData {
      return { width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: "srgb" };
    },
    putImageData(pixels: ImageData, x: number, y: number) {
      assert.equal(x, 0); assert.equal(y, 0);
      uploaded.push(pixels);
    },
    clearRect() { assert.fail("deep field must not erase the original stars"); },
    set filter(_value: string) { assert.fail("no blur filters"); },
    set shadowBlur(_value: number) { assert.fail("no blur shadows"); },
  };
  return {
    context,
    ctx: context as unknown as CanvasRenderingContext2D,
    paints, uploaded,
    depth: () => stack.length,
    clear() { paints.length = 0; },
  };
}
function cacheFixture(ratio = 1, mode: "normal" | "null" | "throw" = "normal") {
  const main = recorder(ratio);
  const surfaces: { surface: SurfaceStub; drawing: ReturnType<typeof recorder> }[] = [];
  const allocate = (width = 0, height = 0) => {
    const drawing = recorder();
    const surface: SurfaceStub = {
      width, height,
      getContext(kind) {
        assert.equal(kind, "2d");
        if (mode === "throw") throw new Error("2d context unavailable");
        return mode === "null" ? null : drawing.context;
      },
    };
    drawing.context.canvas = surface;
    surfaces.push({ surface, drawing });
    return surface;
  };
  const ownerDocument = { createElement(tag: string) { assert.equal(tag, "canvas"); return allocate(); } };
  main.context.canvas = { width: 0, height: 0, ownerDocument, getContext: () => main.context };
  return { main, surfaces, allocate };
}
const stars = (paints: readonly Paint[]) => paints.filter((paint): paint is Extract<Paint, { kind: "star" }> => paint.kind === "star");
const cells = (paints: readonly Paint[]) => paints.filter((paint): paint is Extract<Paint, { kind: "cell" }> => paint.kind === "cell");
const alpha = (color: string) => Number(color.match(/,([\d.e+-]+)\)$/)?.[1]);
const geometry = (paints: readonly Paint[]) => paints.map(paint => paint.kind === "star"
  ? [paint.kind, paint.x, paint.y, paint.radius]
  : [paint.kind, paint.x, paint.y, paint.width, paint.height]);
function withoutOffscreen(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "OffscreenCanvas");
  Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, writable: true, value: undefined });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "OffscreenCanvas", original);
    else Reflect.deleteProperty(globalThis, "OffscreenCanvas");
  });
}

test("visible stars form three crisp size tiers without competing with catalog anchors", (t) => {
  withoutOffscreen(t);
  const drawing = recorder(), width = 1200, height = 800;
  paintDeepField(drawing.ctx, width, height, 0);
  const points = stars(drawing.paints);
  assert.ok(points.length >= 2800 && points.length <= 4500, "desktop pure space has a few thousand stars with open areas");
  assert.ok(points.every(point => point.radius >= .25 && point.radius < 1), "fine sources remain sharp and below one CSS px in radius");
  assert.ok(points.filter(point => point.radius < .46).length > points.length * .6);
  assert.ok(points.filter(point => point.radius >= .46 && point.radius < .72).length > points.length * .18);
  assert.ok(points.filter(point => point.radius >= .74).length > points.length * .025);
  const exposure = points.reduce((total, point) => total + alpha(point.color), 0) / points.length;
  assert.ok(exposure > .38 && exposure < .8,
    "subpixel coverage needs enough light to resolve real points while keeping larger anchors primary");
});

test("transparent pure space paints silver-blue stars without any fog, dust or background fills", (t) => {
  withoutOffscreen(t);
  const drawing = recorder();
  paintDeepField(drawing.ctx, 600, 400, 12);
  const rgb = (color: string) => color.slice(5, color.lastIndexOf(",")).split(",").map(Number);
  const points = stars(drawing.paints).map(point => rgb(point.color));
  assert.ok(points.every(([r, g, b]) => Math.max(r!, g!, b!) - Math.min(r!, g!, b!) < 36),
    "fine stars should not mix yellow and saturated blue speckles");
  assert.equal(cells(drawing.paints).length, 0);
  assert.ok(drawing.paints.every(paint => paint.kind === "star"));
  assert.ok(stars(drawing.paints).filter(point => alpha(point.color) > .5).length > points.length * .2);
});

test("vector fallback retains fixed stars, natural clustering and a populated centre", (t) => {
  withoutOffscreen(t);
  const first = recorder(), second = recorder();
  const width = 600, height = 400;
  paintDeepField(first.ctx, width, height, 0);
  paintDeepField(second.ctx, width, height, 0);
  assert.deepEqual(first.paints, second.paints);
  const points = stars(first.paints);
  assert.ok(points.length >= 760 && points.length <= 6500);
  assert.ok(points.every(point => point.x >= 0 && point.x < width && point.y >= 0 && point.y < height && point.radius <= 1.02));
  assert.equal(cells(first.paints).length, 0);
  assert.ok(first.paints.every(paint => paint.mode === "destination-over"));
  const bands = Array.from({ length: 8 }, () => 0);
  for (const point of points) bands[Math.min(7, Math.floor(point.x / width * 8))]!++;
  assert.ok(Math.max(...bands) / Math.min(...bands) > 1.15);
  assert.ok(points.some(point => point.x > width * .4 && point.x < width * .6 && point.y > height * .4 && point.y < height * .6));
  assert.equal(first.depth(), 0);
});

test("only a small independent star subset changes; frozen time, resize and reset remain deterministic", (t) => {
  withoutOffscreen(t);
  const drawing = recorder();
  paintDeepField(drawing.ctx, 600, 400, 0);
  const before = [...drawing.paints];
  drawing.clear(); paintDeepField(drawing.ctx, 600, 400, 8);
  const after = [...drawing.paints];
  assert.deepEqual(geometry(after), geometry(before));
  assert.deepEqual(cells(after), cells(before));
  const initialStars = stars(before), laterStars = stars(after);
  const changed = initialStars.filter((point, i) => point.color !== laterStars[i]!.color).length;
  assert.ok(changed > 0 && changed <= 80 && changed < initialStars.length * .05);
  drawing.clear(); paintDeepField(drawing.ctx, 600, 400, 8);
  assert.deepEqual(drawing.paints, after);
  drawing.clear(); paintDeepField(drawing.ctx, 390, 640, 200);
  drawing.clear(); paintDeepField(drawing.ctx, 600, 400, 0);
  assert.deepEqual(drawing.paints, before);
  resetDeepField(drawing.ctx);
  drawing.clear(); paintDeepField(drawing.ctx, 600, 400, 0);
  assert.deepEqual(drawing.paints, before);
});

test("DOM cache stores sharp stars once without allocating a diffuse-light raster", () => {
  const { main, surfaces } = cacheFixture(2);
  paintDeepField(main.ctx, 600, 400, 0);
  assert.equal(surfaces.length, 1, "only one transparent star canvas");
  const image = surfaces[0]!;
  assert.equal(image.surface.width, 1200); assert.equal(image.surface.height, 800);
  assert.equal(image.drawing.uploaded.length, 0, "no low-resolution cloud pixels are uploaded");
  assert.ok(image.drawing.paints.every(paint => paint.kind === "star"));
  assert.ok(stars(image.drawing.paints).length > 700, "steady sources are actually painted into the cached canvas");
  assert.deepEqual(image.drawing.context.getTransform(), { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
  assert.ok(main.paints.length <= 81);
  assert.ok(main.paints.slice(0, -1).every(paint => paint.kind === "star"));
  assert.deepEqual(main.paints.at(-1), { kind: "image", source: image.surface, x: 0, y: 0, width: 600, height: 400, mode: "destination-over" });
  const staticDraws = image.drawing.paints.length;
  main.clear(); paintDeepField(main.ctx, 600, 400, 20);
  assert.equal(surfaces.length, 1, "a new animation frame does not allocate or resample the static layer");
  assert.equal(image.drawing.paints.length, staticDraws);
  assert.equal(image.drawing.uploaded.length, 0);
  assert.ok(main.paints.every(paint => paint.mode === "destination-over"));
  assert.equal(main.depth(), 0);
});

test("cached star content is deterministic, transparent and populated in the centre", () => {
  const first = cacheFixture(), second = cacheFixture();
  paintDeepField(first.main.ctx, 600, 400, 0);
  paintDeepField(second.main.ctx, 600, 400, 50);
  const a = first.surfaces[0]!.drawing.paints, b = second.surfaces[0]!.drawing.paints;
  assert.deepEqual(a, b);
  assert.ok(a.every(paint => paint.kind === "star"));
  assert.ok(stars(a).some(p => p.x > 240 && p.x < 360 && p.y > 160 && p.y < 240));
});

test("resizing or DPR changes replace the current cached image and reset releases it", () => {
  const { main, surfaces } = cacheFixture();
  paintDeepField(main.ctx, 600, 400, 0);
  const first = surfaces[0]!.surface;
  main.context.setTransform(2, 0, 0, 2, 0, 0);
  main.clear(); paintDeepField(main.ctx, 600, 400, 1);
  assert.equal(surfaces.length, 2);
  assert.equal(first.width, 0); assert.equal(first.height, 0);
  const second = surfaces[1]!.surface;
  main.clear(); paintDeepField(main.ctx, 390, 640, 2);
  assert.equal(surfaces.length, 3);
  assert.equal(second.width, 0); assert.equal(second.height, 0);
  const third = surfaces[2]!.surface;
  resetDeepField(main.ctx);
  assert.equal(third.width, 0); assert.equal(third.height, 0);
  main.clear(); paintDeepField(main.ctx, 390, 640, 2);
  assert.equal(surfaces.length, 4);
});

test("large high-DPR screens stay inside the cache pixel and side budgets", () => {
  for (const [width, height] of [[2560, 1440], [3840, 2160], [7680, 4320], [3000, 1000]]) {
    const { main, surfaces } = cacheFixture(3);
    paintDeepField(main.ctx, width!, height!, 0);
    const image = surfaces[0]!.surface;
    assert.ok(image.width <= 3072 && image.height <= 3072);
    assert.ok(image.width * image.height <= 2400000, `cached ${image.width} × ${image.height} exceeds the 2.4M pixel budget`);
    assert.ok(stars(surfaces[0]!.drawing.paints).length + stars(main.paints).length <= 6500);
    resetDeepField(main.ctx);
  }
});

test("OffscreenCanvas is used when the canvas has no ownerDocument; DOM remains preferred", (t) => {
  withoutOffscreen(t);
  const fixture = cacheFixture(1);
  let calls = 0;
  Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, writable: true, value: function (width: number, height: number) { calls++; return fixture.allocate(width, height); } });
  paintDeepField(fixture.main.ctx, 390, 640, 0);
  assert.equal(calls, 0);
  const orphan = recorder();
  paintDeepField(orphan.ctx, 390, 640, 0);
  assert.equal(calls, 1);
  assert.ok(orphan.paints.at(-1)?.kind === "image");
  paintDeepField(orphan.ctx, 390, 640, 9);
  assert.equal(calls, 1, "OffscreenCanvas cache is reused");
  resetDeepField(orphan.ctx);
});

test("null and throwing 2d contexts fall back to the vector field without ending the frame", (t) => {
  withoutOffscreen(t);
  for (const mode of ["null", "throw"] as const) {
    const { main } = cacheFixture(1, mode);
    assert.doesNotThrow(() => paintDeepField(main.ctx, 390, 640, 0));
    assert.ok(stars(main.paints).length > 700);
    assert.equal(cells(main.paints).length, 0);
    assert.ok(main.paints.every(paint => paint.kind !== "image"));
    assert.equal(main.depth(), 0);
  }
});

test("invalid sizes draw nothing; invalid clocks freeze safely and caller state is restored", (t) => {
  withoutOffscreen(t);
  const drawing = recorder();
  for (const [width, height] of [[0, 640], [390, 0], [-1, 100], [NaN, 900], [1000, Infinity]]) paintDeepField(drawing.ctx, width!, height!, 5);
  assert.equal(drawing.paints.length, 0);
  drawing.ctx.globalCompositeOperation = "lighter";
  drawing.ctx.globalAlpha = .37; drawing.ctx.fillStyle = "#abc123";
  paintDeepField(drawing.ctx, 390, 640, 0);
  const still = [...drawing.paints];
  for (const time of [-1, NaN, Infinity]) {
    drawing.clear(); paintDeepField(drawing.ctx, 390, 640, time);
    assert.deepEqual(drawing.paints, still);
  }
  assert.equal(drawing.ctx.globalCompositeOperation, "lighter");
  assert.equal(drawing.ctx.globalAlpha, .37); assert.equal(drawing.ctx.fillStyle, "#abc123");
  assert.equal(drawing.depth(), 0);
});
