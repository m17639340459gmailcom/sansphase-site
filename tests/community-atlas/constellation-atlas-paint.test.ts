import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { CONSTELLATION_CATALOG } from "../../src/community-atlas/constellation-catalog.ts";
import { CONSTELLATION_EDGES, constellationScene, type ConstellationNode } from "../../src/community-atlas/constellation-layout.ts";
import type { AstralState } from "../../src/community-atlas/types.ts";

// Hidden catalog stars happen to sit beyond today's crop. Inject scene data only
// to exercise hemisphere culling independently of viewport clipping; the actual
// painter, hover selection, optics and label placement remain in this bundle.
const layoutPath = fileURLToPath(new URL("../../src/community-atlas/constellation-layout.ts", import.meta.url));
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../../src/community-atlas/constellation-field.ts", import.meta.url))],
  bundle: true, write: false, format: "iife", globalName: "atlasPainter",
  plugins: [{ name: "atlas-scene-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/constellation-layout\.ts$/ }, () => ({ path: "scene", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", resolveDir: fileURLToPath(new URL(".", import.meta.url)), contents:
      `export * from ${JSON.stringify(layoutPath)}; export const constellationScene = state => globalThis.__atlasScene(state);` }));
  } }],
});

function recorder(scene: typeof constellationScene = constellationScene) {
  const arcs: number[][] = [], edges: number[][] = [];
  const labels: Array<{ text: string; x: number; y: number }> = [];
  let path: number[] = [];
  const context = {
    save() {}, restore() {}, clearRect() {},
    beginPath() { path = []; },
    arc(...values: number[]) { arcs.push(values); },
    moveTo(...values: number[]) { path.push(...values); },
    lineTo(...values: number[]) { path.push(...values); },
    stroke() { edges.push([...path]); }, fill() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    measureText(text: string) { return { width: text.length * 7 }; },
    fillText(text: string, x: number, y: number) { labels.push({ text, x, y }); },
  };
  const ctx = context as unknown as CanvasRenderingContext2D;
  const api = runInNewContext(`${bundle.outputFiles[0]!.text}\natlasPainter;`, { __atlasScene: scene }) as {
    paintConstellation(ctx: CanvasRenderingContext2D, state: AstralState): void;
    resetConstellationFocus(ctx: CanvasRenderingContext2D): void;
  };
  return { arcs, edges, labels,
    paint(state: AstralState) { arcs.length = edges.length = labels.length = 0; api.paintConstellation(ctx, state); },
  };
}

const base: AstralState = { scene: "atlas", width: 1200, height: 800, time: 0, hover: 0, quietRects: [] };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-8;
const at = (point: readonly number[], node: ConstellationNode) => near(point[0]!, node.x) && near(point[1]!, node.y);

function withInFrameHiddenAnchor(state: AstralState) {
  const scene = constellationScene(state);
  const hiddenIndex = scene.nodes.findIndex(node => node.visible === false && node.major);
  assert.ok(hiddenIndex >= 0, "the catalog contains a bright star in the back hemisphere");
  scene.nodes[hiddenIndex] = { ...scene.nodes[hiddenIndex]!, x: 600, y: 400 };
  return { ...scene, hiddenIndex };
}

test("Atlas excludes back-facing main stars and every incident edge even inside the viewport", () => {
  const scene = withInFrameHiddenAnchor(base);
  const hidden = scene.nodes[scene.hiddenIndex]!;
  const drawing = recorder(() => scene);
  drawing.paint(base);
  assert.ok(drawing.arcs.length > 20 && drawing.edges.length > 20, "the forward sky is still actually rendered");
  assert.ok(!drawing.arcs.some(arc => at(arc, hidden)), "a back-facing major star must not leak a core, corona or halo");
  assert.ok(CONSTELLATION_EDGES.some(([a, b]) => a === scene.hiddenIndex || b === scene.hiddenIndex));
  const visibleEdges = CONSTELLATION_EDGES.filter(([a, b]) => scene.nodes[a]!.visible !== false && scene.nodes[b]!.visible !== false);
  for (const edge of drawing.edges) {
    assert.ok(visibleEdges.some(([a, b]) => at(edge, scene.nodes[a]!) && at(edge.slice(2), scene.nodes[b]!)),
      "every resting connection belongs to two forward-visible catalog endpoints");
  }
});

test("hovering a hidden star or its excluded connection cannot reveal a constellation label", () => {
  const scene = withInFrameHiddenAnchor(base);
  // Isolate the hidden branch from the nearest-star hover radius, preserving
  // real IDs and edge topology. Visible stars stay beyond the pointer's reach.
  scene.nodes = scene.nodes.map(node => node.visible === false ? { ...node, x: 600 + node.id * .2, y: 400 } : { ...node, x: -300 - node.id, y: -300 });
  const hidden = scene.nodes[scene.hiddenIndex]!;
  const drawing = recorder(() => scene);
  drawing.paint({ ...base, hover: 1, reducedMotion: true, pointerX: hidden.x, pointerY: hidden.y });
  assert.equal(drawing.labels.length, 0);
  assert.equal(drawing.edges.length, CONSTELLATION_EDGES.filter(([a, b]) => scene.nodes[a]!.visible !== false && scene.nodes[b]!.visible !== false).length * 4,
    "hidden hover must not add any reveal/active connection passes");
});

test("Atlas star positions and hover labels remain fixed while time advances and with reduced motion", () => {
  const drawing = recorder();
  drawing.paint(base);
  assert.equal(drawing.labels.length, 0, "names appear only while inspecting a constellation");
  const initialScene = constellationScene(base);
  const first = initialScene.nodes.find(node => node.visible !== false && node.x > 200 && node.x < 1000 && node.y > 100 && node.y < 600)!;
  assert.ok(first);
  const selected = { ...base, hover: 1, reducedMotion: true, pointerX: first.x, pointerY: first.y };
  drawing.paint(selected);
  assert.equal(drawing.labels.length, 1);
  const initial = { ...drawing.labels[0]! };
  assert.ok(initial.text.startsWith(CONSTELLATION_CATALOG[first.group]!.name));
  for (const time of [.1, .5, 1, 3, 6, 120, 10000]) {
    const current = constellationScene({ ...base, time });
    for (const layer of ["nodes", "field"] as const) {
      assert.equal(current[layer].length, initialScene[layer].length);
      current[layer].forEach((node, index) => assert.deepEqual(node, initialScene[layer][index],
        `${layer} star ${node.group}/${node.id}: catalog projection and metadata stay fixed at ${time}s`));
    }
    drawing.paint({ ...selected, reducedMotion: false, deltaSeconds: .05, time });
    assert.equal(drawing.labels.length, 1);
    assert.deepEqual(drawing.labels, [initial], "a stationary pointer retains the same name at the same anchor");
  }
  const frozen = { ...selected, time: 10000, deltaSeconds: 0 };
  drawing.paint(frozen); const stopped = { ...drawing.labels[0]! };
  drawing.paint({ ...frozen, quietRects: [{ left: -500, top: -500, right: -400, bottom: -400 }] });
  assert.deepEqual(drawing.labels, [stopped], "reduced-motion repaint and unrelated content scrolling keep exactly the same anchor");
  drawing.paint({ ...frozen, hover: 0 });
  assert.equal(drawing.labels.length, 0);
  drawing.paint(frozen);
  assert.deepEqual(drawing.labels, [stopped], "returning hover restores the original frozen anchor");
});

test("Atlas draws a star shared by a catalog outline and field only once without changing pure rendering", () => {
  for (const atlas of [true, false]) {
    const state = { ...base, scene: atlas ? "atlas" as const : undefined };
    const scene = constellationScene(state);
    const anchor = scene.nodes.find(node => node.visible !== false && node.x > 40 && node.y > 40 && node.x < state.width - 40 && node.y < state.height - 40)!;
    assert.ok(anchor);
    const plain = recorder(() => ({ nodes: scene.nodes, field: [] }));
    const duplicate = recorder(() => ({ nodes: scene.nodes, field: [{ ...anchor, major: false, id: -999 }] }));
    plain.paint(state); duplicate.paint(state);
    if (atlas) assert.deepEqual(duplicate.arcs, plain.arcs, "a catalog field duplicate must not double the registered star's optical light");
    else assert.ok(duplicate.arcs.length > plain.arcs.length, "the independently arranged pure-star mode keeps its original field handling");
  }
});
