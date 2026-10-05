import assert from "node:assert/strict";
import test from "node:test";
import { CONSTELLATION_CATALOG } from "../../src/community-atlas/constellation-catalog.ts";
import {
  CONSTELLATION_EDGES,
  constellationHitGroup,
  constellationLayout,
  type ConstellationNode,
} from "../../src/community-atlas/constellation-layout.ts";
import type { AstralState } from "../../src/community-atlas/types.ts";

const viewports = [
  [795, 603],
  [1050, 850],
  [1920, 1080],
  [390, 640],
] as const;
const base: AstralState = {
  width: 795,
  height: 603,
  time: 0,
  hover: 0,
  quietRects: [],
};
type Point = { x: number; y: number };
const groupIndex = (id: string) =>
  CONSTELLATION_CATALOG.findIndex((group) => group.id === id);
const cross = (a: Point, b: Point, p: Point) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
function pointDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const overlap =
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
  if (
    overlap &&
    cross(a, b, c) * cross(a, b, d) <= 0 &&
    cross(c, d, a) * cross(c, d, b) <= 0
  )
    return 0;
  return Math.min(
    pointDistance(a, c, d),
    pointDistance(b, c, d),
    pointDistance(c, a, b),
    pointDistance(d, a, b),
  );
}
function distanceBetween(
  nodes: readonly ConstellationNode[],
  a: string,
  b: string,
): number {
  const first = CONSTELLATION_EDGES.filter(
    ([id]) => nodes[id]!.group === groupIndex(a),
  );
  const second = CONSTELLATION_EDGES.filter(
    ([id]) => nodes[id]!.group === groupIndex(b),
  );
  return Math.min(
    ...first.flatMap(([i, j]) =>
      second.map(([k, l]) =>
        segmentDistance(nodes[i]!, nodes[j]!, nodes[k]!, nodes[l]!),
      ),
    ),
  );
}

test("Cygnus and Scorpius have separate readable silhouettes across viewport, time and pointer states", () => {
  for (const [width, height] of viewports) {
    for (const time of [0, 100, 10000]) {
      for (const pointerX of [-10, width / 2, width + 10]) {
        for (const pointerY of [-10, height / 2, height + 10]) {
          const nodes = constellationLayout({
            ...base,
            width,
            height,
            time,
            hover: 1, pointerX, pointerY,
          });
          const gap = distanceBetween(nodes, "Cyg", "Sco");
          assert.ok(
            gap >= (width < 700 ? 40 : 56),
            `${width}x${height}, t=${time}: Cyg/Sco gap ${gap.toFixed(1)}px`,
          );
          assert.ok(
            distanceBetween(nodes, "Sco", "Lyr") >= 36,
            "Scorpius must not be moved into Lyra",
          );
          assert.ok(
            distanceBetween(nodes, "Cyg", "UMa") >= 32,
            "Cygnus must not be moved into the Big Dipper",
          );
          for (let first = 0; first < CONSTELLATION_CATALOG.length; first++) {
            for (
              let second = first + 1;
              second < CONSTELLATION_CATALOG.length;
              second++
            ) {
              const a = CONSTELLATION_CATALOG[first]!.id,
                b = CONSTELLATION_CATALOG[second]!.id;
              const separation = distanceBetween(nodes, a, b);
              assert.ok(
                separation >= 24,
                `${width}x${height}: moving the figures must not crowd ${a}/${b} (${separation.toFixed(1)}px)`,
              );
            }
          }
        }
      }
    }
  }
});

test("separating the figures retains substantial size, rigid edges and viewport margins", () => {
  for (const [width, height] of viewports) {
    const initial = constellationLayout({ ...base, width, height });
    for (const id of ["Cyg", "Sco"]) {
      const group = initial.filter((node) => node.group === groupIndex(id));
      const extent = Math.max(
        Math.max(...group.map((p) => p.x)) - Math.min(...group.map((p) => p.x)),
        Math.max(...group.map((p) => p.y)) - Math.min(...group.map((p) => p.y)),
      );
      assert.ok(
        extent >= Math.min(width, height) * (width < 700 ? 0.22 : 0.32),
        `${id} remains a substantial figure at ${width}x${height}`,
      );
    }
    for (const hover of [0, 1]) {
      const next = constellationLayout({
        ...base,
        width,
        height,
        time: 120,
        hover, pointerX: width, pointerY: height,
      });
      assert.ok(
        next.every(
          (node) =>
            node.x >= 8 &&
            node.y >= 8 &&
            node.x <= width - 8 &&
            node.y <= height - 8,
        ),
      );
      for (const [a, b] of CONSTELLATION_EDGES) {
        const edgeLength = (nodes: readonly ConstellationNode[]) =>
          Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.y - nodes[b]!.y);
        assert.ok(
          Math.abs(edgeLength(next) - edgeLength(initial)) < 1e-8,
          "hover must not change a figure's edge lengths",
        );
      }
    }
  }
});

test("mobile constellation lines keep clear of the title, description and entry action", () => {
  // The actual copy bands used by the existing offline layout diagnostic.
  const nodes = constellationLayout({ ...base, width: 390, height: 640 });
  const bands = [
    { left: 45, right: 345, top: 194, bottom: 255 },
    { left: 38, right: 352, top: 309, bottom: 365 },
    { left: 130, right: 260, top: 432, bottom: 477 },
  ];
  for (const [a, b] of CONSTELLATION_EDGES) {
    for (let step = 0; step <= 40; step++) {
      const t = step / 40;
      const x = nodes[a]!.x * (1 - t) + nodes[b]!.x * t;
      const y = nodes[a]!.y * (1 - t) + nodes[b]!.y * t;
      assert.ok(!bands.some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom),
        `outline group ${nodes[a]!.group} crosses the mobile content at ${x.toFixed(1)}, ${y.toFixed(1)}`);
    }
  }
});

test("desktop title cores have no outline stars or connected tracks in their padded copy band", () => {
  // The 1050px diagnostic title is 530px wide; the site's desktop font caps at
  // 104px. These fixed composition checks protect its core without using masks
  // or making the stars move when the actual DOM rectangles scroll.
  for (const [width, height] of [[795, 603], [1050, 850], [1920, 1080]] as const) {
    const nodes = constellationLayout({ ...base, width, height });
    const halfWidth = Math.min(width * 0.27, 340);
    const core = { left: width / 2 - halfWidth - 16, right: width / 2 + halfWidth + 16,
      top: height * 0.27, bottom: height * 0.405 };
    const inside = (x: number, y: number) => x >= core.left && x <= core.right && y >= core.top && y <= core.bottom;
    assert.ok(nodes.every(node => !inside(node.x, node.y)), `${width}x${height}: a main star intrudes into the title core`);
    for (const [a, b] of CONSTELLATION_EDGES) for (let step = 0; step <= 40; step++) {
      const t = step / 40;
      assert.ok(!inside(nodes[a]!.x * (1 - t) + nodes[b]!.x * t, nodes[a]!.y * (1 - t) + nodes[b]!.y * t),
        `${width}x${height}: group ${nodes[a]!.group} runs across the padded title band`);
    }
  }
});

test("the composition has clear figure hierarchy and preserves every group's rigid geometry", () => {
  const reference = constellationLayout({ ...base, width: 1050, height: 850 });
  const span = (nodes: readonly ConstellationNode[]) => Math.max(
    Math.max(...nodes.map(p => p.x)) - Math.min(...nodes.map(p => p.x)),
    Math.max(...nodes.map(p => p.y)) - Math.min(...nodes.map(p => p.y)),
  );
  const group = (nodes: readonly ConstellationNode[], id: string) => nodes.filter(p => p.group === groupIndex(id));
  for (const large of ["Ori", "Cyg"]) for (const small of ["Cas", "Lyr"]) {
    assert.ok(span(group(reference, large)) > span(group(reference, small)) * 1.65,
      `${large} should read as a main figure against ${small}`);
  }
  for (const [width, height] of viewports) {
    const current = constellationLayout({ ...base, width, height });
    for (const constellation of CONSTELLATION_CATALOG) {
      const original = group(reference, constellation.id);
      const resized = group(current, constellation.id);
      const norm = (nodes: readonly ConstellationNode[]) => Math.hypot(nodes[1]!.x - nodes[0]!.x, nodes[1]!.y - nodes[0]!.y);
      for (let index = 1; index < original.length; index++) {
        const distance = (nodes: readonly ConstellationNode[]) => Math.hypot(nodes[index]!.x - nodes[0]!.x, nodes[index]!.y - nodes[0]!.y) / norm(nodes);
        assert.ok(Math.abs(distance(original) - distance(resized)) < 1e-8,
          `${constellation.id} must only translate, rotate and uniformly scale`);
      }
    }
    assert.deepEqual(constellationLayout({ ...base, width, height, quietRects: [
      { left: 0, top: 0, right: width, bottom: height },
    ] }), current, "scrolling copy must not make the sky avoid or follow it");
  }
});

test("text rectangles block pointer activation only inside their actual bounds", () => {
  const nodes = constellationLayout(base),
    anchor = nodes[0]!;
  const input = { ...base, hover: 1, pointerX: anchor.x, pointerY: anchor.y };
  const quietRects = [
    {
      left: anchor.x - 10,
      top: anchor.y - 10,
      right: anchor.x + 10,
      bottom: anchor.y + 10,
    },
  ];
  assert.equal(constellationHitGroup({ ...input, quietRects }, nodes), -1);
  assert.equal(
    constellationHitGroup(
      { ...input, pointerX: anchor.x + 11, quietRects },
      nodes,
    ),
    anchor.group,
    "no old alpha feather may suppress input outside a text rectangle",
  );
});
