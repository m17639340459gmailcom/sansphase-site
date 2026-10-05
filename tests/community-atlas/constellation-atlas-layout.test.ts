import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CONSTELLATION_CATALOG } from "../../src/community-atlas/constellation-catalog.ts";
import { CONSTELLATION_EDGES, constellationHitGroup, constellationScene } from "../../src/community-atlas/constellation-layout.ts";
import type { AstralState } from "../../src/community-atlas/types.ts";
import { unprojectAtlasPoint } from "../../src/community-atlas/atlas-camera.ts";

const base: AstralState = { width: 1050, height: 850, time: 0, hover: 0, quietRects: [] };
const viewports = [[795, 603], [1050, 850], [1920, 1080], [390, 640], [430, 800]] as const;
const RAD = Math.PI / 180;

test("the celestial Atlas is opt-in and leaves approved pure-space coordinates unchanged", () => {
  for (const [width, height, hash] of [
    [1050, 850, "c0dbd76b9c76c5db27a8777f328961a477e22bb8ba2aa424867b1c156b16b347"],
    [390, 640, "8d0432e7a1e984ccf88f071277c182bee263f25ef27359acafe49318461152b5"],
  ] as const) {
    const state = { ...base, width, height }, pure = constellationScene(state);
    assert.equal(createHash("sha256").update(JSON.stringify(pure.nodes)).digest("hex"), hash);
    assert.notDeepEqual(constellationScene({ ...state, scene: "atlas" }).nodes, pure.nodes);
    assert.deepEqual(constellationScene(state), pure);
  }
});

test("every Atlas star inverse-projects to its catalog RA/Dec through one north-polar STG view", () => {
  const catalog = CONSTELLATION_CATALOG.flatMap(group => group.stars);
  for (const [width, height] of viewports) {
    const { nodes } = constellationScene({ ...base, width, height, scene: "atlas" });
    const scale = Math.max(height, width / (1672 / 941)) * .5;
    // Inverse polar STG: angular distance from the north pole = 2 atan(r/2).
    // This checks actual coordinates across groups, not their individual shape.
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!, star = catalog[i]!;
      const point = unprojectAtlasPoint(node.x, node.y, width, height);
      const rotatedX = (point.x - width / 2) / scale, rotatedY = (point.y - height / 2) / scale;
      const x = rotatedX * Math.cos(2.4) + rotatedY * Math.sin(2.4);
      const y = -rotatedX * Math.sin(2.4) + rotatedY * Math.cos(2.4);
      const dec = 90 - 2 * Math.atan(Math.hypot(x, y) / 2) / RAD;
      const ra = (Math.atan2(-x, y) / RAD + 360) % 360;
      assert.ok(Math.abs(dec - star.dec) < 1e-8, `${star.id}: declination differs`);
      const deltaRA = Math.abs(ra - star.ra);
      assert.ok(Math.min(deltaRA, 360 - deltaRA) < 1e-8, `${star.id}: right ascension differs`);
    }
  }
});

test("a shared catalog star has one sky position even when listed by two constellation fields", () => {
  const source = CONSTELLATION_CATALOG.flatMap(group => group.fieldStars);
  const { field } = constellationScene({ ...base, scene: "atlas" });
  let shared = 0;
  for (let a = 0; a < source.length; a++) for (let b = a + 1; b < source.length; b++) {
    if (source[a]!.id !== source[b]!.id) continue;
    shared++;
    assert.equal(field[a]!.x, field[b]!.x);
    assert.equal(field[a]!.y, field[b]!.y);
  }
  assert.ok(shared >= 3, "exercise genuinely shared HIP stars rather than only distinct groups");
});

test("one responsive crop preserves cross-constellation geometry instead of packing six figures", () => {
  const reference = constellationScene({ ...base, scene: "atlas" });
  const referenceScale = Math.max(base.height, base.width / (1672 / 941));
  for (const [width, height] of viewports) {
    const current = constellationScene({ ...base, width, height, scene: "atlas" });
    const ratio = Math.max(height, width / (1672 / 941)) / referenceScale;
    for (let a = 0; a < current.nodes.length; a++) for (let b = a + 1; b < current.nodes.length; b++) {
      const first = reference.nodes, next = current.nodes;
      const original = Math.hypot(first[a]!.x - first[b]!.x, first[a]!.y - first[b]!.y);
      const resized = Math.hypot(next[a]!.x - next[b]!.x, next[a]!.y - next[b]!.y);
      assert.ok(Math.abs(resized - original * ratio) < 1e-8, "all groups must share one zoom");
    }
    assert.ok(current.nodes.some(p => p.x < 0 || p.x > width || p.y < 0 || p.y > height),
      "off-screen figures remain cropped, not individually moved back inside");
  }
});

test("hemisphere clipping keeps catalog indices stable and cannot activate an invisible group", () => {
  const { nodes } = constellationScene({ ...base, scene: "atlas" });
  assert.equal(nodes.length, CONSTELLATION_CATALOG.reduce((sum, group) => sum + group.stars.length, 0));
  assert.ok(nodes.every((node, id) => node.id === id && Number.isFinite(node.x + node.y)));
  assert.ok(CONSTELLATION_EDGES.every(([a, b]) => nodes[a]!.group === nodes[b]!.group));
  for (const id of ["Cyg", "Lyr", "Cas", "UMa"]) {
    const index = CONSTELLATION_CATALOG.findIndex(group => group.id === id);
    assert.ok(nodes.filter(node => node.group === index).every(node => node.visible === true));
  }
  const scorpio = CONSTELLATION_CATALOG.findIndex(group => group.id === "Sco");
  assert.ok(nodes.filter(node => node.group === scorpio).every(node => node.visible === false));
  const invisible = nodes.map(node => ({ ...node, x: base.width / 2, y: base.height / 2, visible: false }));
  assert.equal(constellationHitGroup({ ...base, hover: 1, pointerX: base.width / 2, pointerY: base.height / 2 }, invisible), -1);
});

test("Atlas sky retains its projection without camera sway, local orbiting or pointer displacement", () => {
  const state: AstralState = { ...base, scene: "atlas" };
  const original = constellationScene(state);
  const later = constellationScene({ ...state, time: 40 });
  assert.deepEqual(later.nodes, original.nodes, "cloud material can flow while catalog star positions stay fixed");
  for (const collection of ["nodes", "field"] as const) {
    original[collection].forEach((node, index) => {
      const next = later[collection][index]!;
      const before = unprojectAtlasPoint(node.x, node.y, state.width, state.height);
      const after = unprojectAtlasPoint(next.x, next.y, state.width, state.height);
      assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 1e-8,
        "catalog stars must not drift independently of the sky camera");
    });
  }
  assert.deepEqual(constellationScene({ ...state, time: 40, hover: 1, pointerX: 20, pointerY: 20,
    quietRects: [{ left: 0, top: 0, right: state.width, bottom: state.height }] }), later);
});
