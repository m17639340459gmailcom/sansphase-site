import assert from "node:assert/strict";
import test from "node:test";
import { paintConstellation } from "../../src/community-atlas/constellation-field.ts";
import { constellationLayout, CONSTELLATION_EDGES } from "../../src/community-atlas/constellation-layout.ts";
import type { AstralState } from "../../src/community-atlas/types.ts";

type Stop = { at: number; alpha: number; color: string };
type Gradient = { stops: Stop[]; addColorStop(at: number, value: string): void };
type Stroke = { path: number[]; width: number; style: string | Gradient };
const alpha = (value: string) => Number(value.match(/,([\d.e+-]+)\)$/)?.[1] ?? 0);

function record(state: AstralState) {
  const strokes: Stroke[] = [], radial: { x: number; y: number; radius: number; stops: Stop[] }[] = [];
  let path: number[] = [];
  const gradient = (): Gradient => ({ stops: [], addColorStop(at, value) { this.stops.push({ at, alpha: alpha(value), color: value }); } });
  const context = {
    lineWidth: 0, strokeStyle: "" as string | Gradient,
    save() {}, restore() {}, clearRect() {}, beginPath() { path = []; }, fill() {}, arc() {},
    moveTo(x: number, y: number) { path.push(x, y); }, lineTo(x: number, y: number) { path.push(x, y); },
    stroke() { strokes.push({ path: [...path], width: this.lineWidth, style: this.strokeStyle }); },
    createLinearGradient: gradient,
    createRadialGradient(x: number, y: number, _r: number, _x2: number, _y2: number, radius: number) {
      const value = gradient(); radial.push({ x, y, radius, stops: value.stops }); return value;
    },
    measureText: (text: string) => ({ width: text.length * 7 }), fillText() {},
  };
  paintConstellation(context as unknown as CanvasRenderingContext2D, state);
  return { strokes, radial };
}
const state: AstralState = { width: 1050, height: 850, time: 12, hover: 0, quietRects: [] };
const EDGE_PASSES = 4;
const edgeCores = (strokes: Stroke[]) => strokes.filter((_, i) => i % EDGE_PASSES === EDGE_PASSES - 1);

test("resting connections have legible fine cores with weak feathered shoulders instead of luminous bands", () => {
  const { strokes } = record(state);
  assert.equal(strokes.length, CONSTELLATION_EDGES.length * EDGE_PASSES);
  for (let edge = 0; edge < CONSTELLATION_EDGES.length; edge++) {
    const layers = strokes.slice(edge * EDGE_PASSES, (edge + 1) * EDGE_PASSES);
    const core = layers.at(-1)!;
    assert.ok(core.width >= .65 && core.width <= .95, "all six figures need readable subpixel-to-one-pixel cores");
    assert.ok(layers[0]!.width - core.width >= 2 && layers[0]!.width - core.width <= 4,
      "the optical shoulder extends at most two pixels on each side");
    for (let pass = 1; pass < layers.length; pass++) {
      assert.ok(layers[pass]!.width < layers[pass - 1]!.width);
    }
    const peak = (stroke: Stroke) => Math.max(...(stroke.style as Gradient).stops.map(stop => stop.alpha));
    const share = peak(core) / layers.reduce((sum, layer) => sum + peak(layer), 0);
    assert.ok(share > .6 && share < .85,
      "the actual connection stays clear while weaker shoulders prevent a hard neon edge");
  }
});

test("all annotation lines share silver-blue light while Orion retains the stronger outline", () => {
  const nodes = constellationLayout(state), cores = edgeCores(record(state).strokes);
  const foreground: Stroke[] = [], background: Stroke[] = [];
  cores.forEach((core, index) => {
    const isOrion = nodes[CONSTELLATION_EDGES[index]![0]]!.group === 0;
    (isOrion ? foreground : background).push(core);
    for (const stop of (core.style as Gradient).stops) {
      const channels = stop.color.match(/^rgba\((\d+),(\d+),(\d+),/)!;
      const red = Number(channels[1]), blue = Number(channels[3]);
      assert.ok(blue > red, "foreground and distant outlines belong to the same cool palette");
    }
  });
  const mean = (edges: Stroke[]) => edges.reduce((sum, edge) => sum + edge.width, 0) / edges.length;
  assert.ok(mean(foreground) > mean(background), "Orion keeps a modest emphasis without suppressing supporting figures");
});

test("all six constellations and all 63 connections are visible without hover across viewport sizes", () => {
  for (const [width, height] of [[390, 640], [1050, 850], [1920, 1080]]) {
    const input = { ...state, width: width!, height: height! };
    const nodes = constellationLayout(input), cores = edgeCores(record(input).strokes);
    assert.equal(cores.length, 63, "no catalog link is dropped from the normal view");
    const groups = new Map<number, number[]>();
    cores.forEach((edge, index) => {
      const peak = Math.max(...(edge.style as Gradient).stops.map(stop => stop.alpha));
      assert.ok(peak >= .11 && peak <= .24, "every idle link stays visible but subordinate to its bright nodes");
      const group = nodes[CONSTELLATION_EDGES[index]![0]]!.group;
      groups.set(group, [...(groups.get(group) ?? []), peak]);
    });
    assert.equal(groups.size, 6);
    const means = [...groups.values()].map(values => values.reduce((sum, v) => sum + v, 0) / values.length);
    assert.ok(Math.max(...means) / Math.min(...means) < 1.8,
      "supporting constellations must not disappear behind a multi-fold hierarchy");
  }
});

test("every catalog connection retains its source geometry even when its light fades", () => {
  const nodes = constellationLayout(state), { strokes } = record(state);
  assert.equal(strokes.length, CONSTELLATION_EDGES.length * EDGE_PASSES, "all original edges retain a core and graded soft shoulders");
  CONSTELLATION_EDGES.forEach(([a, b], index) => {
    const from = nodes[a]!, to = nodes[b]!;
    for (const stroke of strokes.slice(index * EDGE_PASSES, (index + 1) * EDGE_PASSES)) {
      const expected = [from.x, from.y, to.x, to.y];
      assert.ok(stroke.path.every((value, i) => Math.abs(value - expected[i]!) < 1e-7), "the line must run under both stellar cores");
    }
  });
});

test("idle connections fade only near their stars while the full linking span stays readable", () => {
  const cores = edgeCores(record(state).strokes);
  const widths = cores.map(edge => edge.width);
  assert.ok(Math.max(...widths) - Math.min(...widths) > 0.08, "restrained line-weight differences remain");
  assert.ok(Math.min(...widths) >= .65 && Math.max(...widths) <= .95);
  for (const core of cores) {
    assert.notEqual(typeof core.style, "string", "the light must soften continuously between stars");
    const stops = (core.style as Gradient).stops;
    const centre = stops.find(stop => stop.at === 0.5)!;
    assert.equal(stops[0]!.alpha, 0, "the annotation dissolves into the first star halo");
    assert.equal(stops.at(-1)!.alpha, 0, "the annotation dissolves into the last star halo");
    assert.ok(centre && centre.alpha >= .11, "the middle is readable even in the faintest source edge");
    assert.ok(centre.alpha < .25, "annotation lines must not compete with luminous star cores");
    const length = Math.hypot(core.path[2]! - core.path[0]!, core.path[3]! - core.path[1]!);
    const opticalEnd = Math.min(6, length * .25);
    const span = stops.filter(stop => stop.at * length >= opticalEnd && (1 - stop.at) * length >= opticalEnd);
    assert.ok(span.length > 0);
    assert.ok(span.every(stop => Math.abs(stop.alpha - centre.alpha) < 1e-10),
      "outside short optical ends, cloud texture cannot punch gaps into the catalog connection");
  }
});

test("resting edge exposure stays independent of the background's cloud position", () => {
  const peaks = (input: AstralState) => edgeCores(record(input).strokes)
    .map(edge => Math.max(...(edge.style as Gradient).stops.map(stop => stop.alpha)));
  assert.deepEqual(peaks({ ...state, width: 390, height: 640 }), peaks(state));
  assert.deepEqual(peaks({ ...state, width: 1920, height: 1080 }), peaks(state));
});

test("catalog star cores span a clear light hierarchy while preserving apparent-magnitude ordering", () => {
  const nodes = constellationLayout(state), { radial } = record(state);
  const profiles = nodes.map(node => {
    const core = radial.filter(g => g.x === node.x && g.y === node.y).sort((a, b) => a.radius - b.radius)[0]!;
    return { magnitude: node.magnitude, radius: core.radius, peak: core.stops[0]!.alpha };
  }).sort((a,b) => a.magnitude - b.magnitude);
  assert.ok(profiles[0]!.radius / profiles.at(-1)!.radius > 2.3, "bright anchors must read distinctly from faint outline stars");
  assert.ok(Math.max(...profiles.map(p => p.peak)) - Math.min(...profiles.map(p => p.peak)) > 0.6);
  for (let i = 1; i < profiles.length; i++) assert.ok(profiles[i]!.radius <= profiles[i - 1]!.radius + 1e-7, "larger optical cores follow observed brightness, not invented distance");
});

test("only selected anchor stars receive a broad corona while linework stays subordinate", () => {
  for (const [width, height] of [[390, 640], [1050, 850]]) {
    const input = { ...state, width: width!, height: height! };
    const nodes = constellationLayout(input), { radial, strokes } = record(input);
    let anchors = 0;
    const pointPeaks: number[] = [];
    for (const node of nodes) {
      const profiles = radial.filter(g => g.x === node.x && g.y === node.y).sort((a, b) => a.radius - b.radius);
      pointPeaks.push(profiles[0]!.stops[0]!.alpha);
      if (!node.major) {
        assert.equal(profiles.length, node.magnitude <= 2.2 ? 2 : 1,
          "only brighter connecting stars gain compact near-light; faint nodes keep their small core");
        assert.ok(profiles.at(-1)!.radius <= profiles[0]!.radius * 3,
          "secondary nodes must not acquire the broad halos of primary anchors");
      }
      if (profiles.at(-1)!.radius > profiles[0]!.radius * 5) anchors++;
    }
    assert.ok(anchors > 2 && anchors <= nodes.length * .25, "only a small set of peripheral anchors leads the composition");
    const linePeak = Math.max(...edgeCores(strokes).flatMap(stroke => (stroke.style as Gradient).stops.map(stop => stop.alpha)));
    const leading = [...pointPeaks].sort((a, b) => b - a).slice(0, 5);
    assert.ok(leading.every(peak => peak > linePeak * 3), "points must visibly lead rather than the line framework");
  }
});

test("content rectangles only soften annotation lines, preserving stars and geometry in idle, hover and reduced-motion views", () => {
  for (const [width, height] of [[390, 640], [1050, 850]]) {
    const input = { ...state, width: width!, height: height! };
    const anchor = constellationLayout(input)[0]!;
    for (const hover of [0, 1]) for (const reducedMotion of [false, true]) {
      const sample = { ...input, hover, reducedMotion, pointerX: anchor.x, pointerY: anchor.y };
      const plain = record(sample);
      const rect = { left: width! * 0.3, right: width! * 0.7, top: 0, bottom: height! };
      const text = record({ ...sample, quietRects: [rect] });
      assert.deepEqual(text.radial, plain.radial, "copy must never dim or move stellar cores and halos");
      assert.equal(text.strokes.length, plain.strokes.length);
      let attenuated = 0, feathered = 0, untouched = 0;
      text.strokes.forEach((stroke, index) => {
        const original = plain.strokes[index]!;
        assert.deepEqual(stroke.path, original.path, "line endpoints must remain registered with their stars");
        assert.equal(stroke.width, original.width);
        const stops = (stroke.style as Gradient).stops, initial = (original.style as Gradient).stops;
        assert.equal(stops.length, initial.length);
        stops.forEach((stop, i) => {
          const before = initial[i]!;
          assert.equal(stop.at, before.at);
          if (before.alpha === 0) return assert.equal(stop.alpha, 0);
          const x = stroke.path[0]! + (stroke.path[2]! - stroke.path[0]!) * stop.at;
          const y = stroke.path[1]! + (stroke.path[3]! - stroke.path[1]!) * stop.at;
          const distance = Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
          const ratio = stop.alpha / before.alpha;
          if (distance === 0) {
            assert.ok(Math.abs(ratio - .5) < 1e-10, "annotation lines inside copy are exactly half as bright");
            attenuated++;
          } else if (distance >= 24) {
            assert.ok(Math.abs(ratio - 1) < 1e-10, "lines outside the 24px transition retain their original light");
            untouched++;
          } else {
            assert.ok(ratio > .5 && ratio < 1, "the 24px margin must interpolate instead of cutting out a rectangle");
            feathered++;
          }
        });
      });
      assert.ok(attenuated > 0 && feathered > 0 && untouched > 0, "each viewport exercises the interior, soft margin and unaffected sky");
    }
  }
});
