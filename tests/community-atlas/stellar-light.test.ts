import assert from "node:assert/strict";
import test from "node:test";
import { stellarIntensity, paintStellarPoint } from "../../src/community-atlas/stellar-light.ts";

test("scintillation is deterministic, bounded, continuous and independent per star", () => {
  const first: number[] = [],
    second: number[] = [];
  for (let frame = 0; frame < 1800; frame++) {
    const time = frame / 30;
    const a = stellarIntensity(19, time),
      b = stellarIntensity(733, time);
    assert.equal(a, stellarIntensity(19, time));
    assert.ok(a >= 0.55 && a <= 1.12, "stars must never blink off or flare");
    if (first.length)
      assert.ok(Math.abs(a - first.at(-1)!) < 0.025, "the pure sky breathes slowly without rapid scintillation steps");
    first.push(a);
    second.push(b);
  }
  assert.ok(
    Math.max(...first) - Math.min(...first) > 0.18,
    "visible but restrained light variation",
  );
  assert.notDeepEqual(first, second);
  assert.ok(
    first.some(
      (value, i) =>
        i > 0 && (value - first[i - 1]!) * (second[i]! - second[i - 1]!) < 0,
    ),
    "stars must not breathe together",
  );
});

test("scintillation stays finite and stable over long-running sessions", () => {
  for (const time of [0, 1, 1e5, 1e7, NaN, Infinity]) {
    assert.ok(Number.isFinite(stellarIntensity(733, time)));
  }
});

test("both catalog and background stars vary gently and independently over twenty seconds", () => {
  for (const seed of [1390.09, 1086.95, 971, 733, 19, 288.1]) {
    const values = Array.from({ length: 600 }, (_, frame) =>
      stellarIntensity(seed, frame / 30),
    );
    assert.ok(
      Math.max(...values) - Math.min(...values) > 0.18,
      `star ${seed} has imperceptible variation`,
    );
    assert.ok(
      Math.min(...values) < 0.85,
      "a star must have a gentle dim phase between glints",
    );
    assert.ok(
      Math.max(...values) > 0.88,
      "the bright phase must remain legible",
    );
  }
});

test("point-source geometry is fixed while its light changes, with no painted backdrop", () => {
  function draw(time: number) {
    const geometry: number[][] = [],
      light: string[] = [];
    const ctx = {
      beginPath() {},
      fill() {},
      stroke() {},
      arc(...values: number[]) {
        geometry.push(values);
      },
      moveTo(...values: number[]) {
        geometry.push(values);
      },
      lineTo(...values: number[]) {
        geometry.push(values);
      },
      createRadialGradient(...values: number[]) {
        geometry.push(values);
        return {
          addColorStop(_p: number, color: string) {
            light.push(color);
          },
        };
      },
      createLinearGradient(...values: number[]) {
        geometry.push(values);
        return { addColorStop(_p: number, color: string) { light.push(color); } };
      },
      set fillStyle(value: string | CanvasGradient) {
        if (typeof value === "string") light.push(value);
      },
      set strokeStyle(value: string | CanvasGradient) {
        if (typeof value === "string") light.push(value);
      },
      fillRect() {
        assert.fail("no background/mask permitted");
      },
    } as unknown as CanvasRenderingContext2D;
    paintStellarPoint(
      ctx,
      {
        x: 25,
        y: 45,
        radius: 1.2,
        opacity: 0.8,
        color: "214,224,238",
        seed: 733,
        prominence: 1,
      },
      time,
    );
    return { geometry, light };
  }
  assert.deepEqual(
    draw(3).geometry,
    draw(9).geometry,
    "twinkle must not turn into moving or pulsing circles",
  );
  assert.notDeepEqual(draw(3).light, draw(9).light);
  assert.deepEqual(draw(3), draw(3));
});

test("bright sources have a small luminous corona and continuous fading rays, without flooding the field", () => {
  const radialRadii: number[] = [], rays: string[][] = [];
  const ctx = {
    beginPath() {}, fill() {}, stroke() {}, arc() {}, moveTo() {}, lineTo() {},
    createRadialGradient(_x: number, _y: number, _r: number, _x2: number, _y2: number, radius: number) {
      radialRadii.push(radius);
      return { addColorStop() {} };
    },
    createLinearGradient() {
      const stops: string[] = []; rays.push(stops);
      return { addColorStop(_at: number, value: string) { stops.push(value); } };
    },
    fillRect() { assert.fail("no screen-wide haze"); },
  } as unknown as CanvasRenderingContext2D;
  paintStellarPoint(ctx, {x: 60, y: 60, radius: 1.6, opacity: .9, color: "190,216,239", seed: 733, prominence: 1}, 3);
  assert.ok(radialRadii.some(r => r > 3 && r < 14), "the bright point needs a soft luminous shoulder");
  assert.ok(Math.max(...radialRadii) > 12 && Math.max(...radialRadii) <= 20, "the reference's tight star light must not expand into broad fog");
  assert.ok(rays.length >= 4, "a bright star must read as a light source rather than a round node");
  assert.ok(rays.every(stops => stops.at(-1)?.endsWith(",0)")), "rays must disappear continuously into the sky");
});

test("ordinary luminous points have no photographic cross and bright anchors keep a compact halo", () => {
  function draw(prominence: number) {
    const radii: number[] = [], rayLengths: number[] = [], haloEnergy: number[] = [];
    const ctx = {
      beginPath() {}, fill() {}, arc() {}, moveTo() {}, lineTo() {},
      createRadialGradient(_x: number, _y: number, _r: number, _x2: number, _y2: number, radius: number) {
        radii.push(radius);
        return { addColorStop(at: number, color: string) {
          if (radii.length === 1 && at === 0) haloEnergy.push(Number(color.match(/,([\d.e+-]+)\)$/)?.[1]));
        } };
      },
      createLinearGradient(x: number, y: number, x2: number, y2: number) {
        rayLengths.push(Math.hypot(x2 - x, y2 - y));
        return { addColorStop() {} };
      },
    } as unknown as CanvasRenderingContext2D;
    paintStellarPoint(ctx, { x: 60, y: 60, radius: 1.6, opacity: .9, color: "204,224,244", seed: 733, prominence }, 3);
    return { radii, rayLengths, haloEnergy };
  }
  assert.equal(draw(.6).rayLengths.length, 0, "ordinary foreground points should not all become crosses");
  const anchor = draw(1);
  assert.equal(anchor.rayLengths.length, 4, "only sparse bright anchors receive four short rays");
  assert.ok(Math.max(...anchor.radii) <= 28, "the halo must not become broad foreground haze");
  assert.ok(Math.max(...anchor.rayLengths) <= 15, "short rays remain local to their node");
  assert.ok(anchor.haloEnergy[0]! < .18, "halo light should stay below the graded stellar core");
});

test("a catalog node can have a compact luminous shoulder without acquiring a broad halo or rays", () => {
  const radii: number[] = [];
  let rays = 0;
  const ctx = {
    beginPath() {}, fill() {}, arc() {}, moveTo() {}, lineTo() {},
    createRadialGradient(_x: number, _y: number, _r: number, _x2: number, _y2: number, radius: number) {
      radii.push(radius); return { addColorStop() {} };
    },
    createLinearGradient() { rays++; return { addColorStop() {} }; },
  } as unknown as CanvasRenderingContext2D;
  paintStellarPoint(ctx, { x: 40, y: 30, radius: 1.5, opacity: .8, color: "204,224,244", seed: 733, prominence: 0, corona: .4 }, 3);
  assert.equal(radii.length, 2, "network nodes need a graded near-light shoulder as well as a small core");
  assert.ok(Math.max(...radii) > 3 && Math.max(...radii) < 5, "the shoulder stays local instead of becoming fog");
  assert.equal(rays, 0);
});
