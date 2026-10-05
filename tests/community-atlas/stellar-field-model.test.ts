import assert from "node:assert/strict";
import test from "node:test";
import { sampleStellarField, stellarCompositionFocus } from "../../src/community-atlas/stellar-field-model.ts";
import type { StellarFieldSample } from "../../src/community-atlas/stellar-field-model.ts";

test("pure space exposes star population only with open areas and compact clusters", () => {
  for (const aspect of [390 / 640, 1050 / 850, 1920 / 1080]) {
    const samples: StellarFieldSample[] = [];
    for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) {
      const p = sampleStellarField((x + .5) / 120, (y + .5) / 80, aspect);
      assert.deepEqual(Object.keys(p).sort(), ["density", "warmth"], "cloud emission and dust extinction are removed");
      samples.push(p);
    }
    assert.ok(samples.every(p => Number.isFinite(p.density + p.warmth)
      && p.density > .08 && p.density <= 1 && p.warmth >= 0 && p.warmth <= 1));
    const densities = samples.map(p => p.density).sort((a,b) => a-b);
    assert.ok(densities.at(-1)! > densities[0]! * 1.8, "small star clusters must remain distinct from open space");
    assert.ok(samples.filter(p => p.density > .5).length < samples.length * .12,
      "star-rich patches occupy small areas instead of a continuous dense band");
  }
});

test("composition focus stays broad while the centre remains populated", () => {
  assert.equal(stellarCompositionFocus(.5, .5), 1);
  assert.ok(stellarCompositionFocus(.3, .5) > .55 && stellarCompositionFocus(.5, .25) > .55);
  assert.ok(stellarCompositionFocus(0, 0) < .08 && stellarCompositionFocus(1, 1) < .08);
  for (const aspect of [.61, 1.24, 1.78]) assert.ok(sampleStellarField(.5, .5, aspect).density > .1);
});

test("star populations are deterministic, continuous and independent of animation and pointer state", () => {
  for (let i = 0; i < 100; i++) {
    const x = (i * .61803398875) % 1, y = (i * .41421356) % 1;
    const point = sampleStellarField(x, y, 1.25);
    assert.deepEqual(sampleStellarField(x, y, 1.25), point);
    const neighbour = sampleStellarField(x + .00001, y + .00001, 1.25);
    assert.ok(Math.abs(point.density - neighbour.density) < .003);
    assert.ok(Math.abs(point.warmth - neighbour.warmth) < .003);
  }
});

test("no dominant diagonal star band crosses the viewport", () => {
  const along: number[] = [], outside: number[] = [];
  const aspect = 1.6;
  for (let y = 0; y < 100; y++) for (let x = 0; x < 160; x++) {
    const px = (x + .5) / 160, py = (y + .5) / 100;
    const across = (px - .5) * aspect * .67 + (py - .5) * .74 - .035;
    const density = sampleStellarField(px, py, aspect).density;
    if (Math.abs(across) < .14) along.push(density);
    if (Math.abs(across) > .3) outside.push(density);
  }
  const mean = (values: number[]) => values.reduce((sum,v) => sum+v,0) / values.length;
  assert.ok(mean(along) / mean(outside) < 1.6, "a long bright stellar strip must not survive the pure-space composition");
});
