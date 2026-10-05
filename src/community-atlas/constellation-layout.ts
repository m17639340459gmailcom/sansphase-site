import { CONSTELLATION_CATALOG } from "./constellation-catalog.ts";
import { projectAtlasPoint } from "./atlas-camera.ts";
import type { AstralState } from "./types.ts";

export interface ConstellationNode {
  id: number;
  group: number;
  x: number;
  y: number;
  major: boolean;
  magnitude: number;
  colorIndex: number;
  /** False outside the Atlas projection's forward celestial hemisphere. */
  visible?: boolean;
}
type ProjectedStar = Omit<ConstellationNode, "x" | "y"> & {
  u: number;
  v: number;
};
type Placement = readonly [number, number, number, number];
const RAD = Math.PI / 180;
export const clamp = (n: number, lo = 0, hi = 1) =>
  Math.min(hi, Math.max(lo, n));
export const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const finite = (n: number, fallback = 0) => (Number.isFinite(n) ? n : fallback);

// Each real pattern is projected independently and arranged as an illustrated
// atlas. These placements do not represent one geographically accurate sky.
// Orion and Cygnus frame the desktop copy as the two main silhouettes. The
// smaller figures occupy the upper/lower field, never the title's centre.
// On phones the broad copy bands need more room: three compact outlines sit
// above them and three below, using only rigid rotation and uniform scaling.
const DESKTOP: readonly Placement[] = [
  [0.105, 0.47, 0.35, 0.1],
  [0.35, 0.16, 0.2, 0.08],
  [0.9, 0.42, 0.28, -0.52],
  [0.69, 0.12, 0.24, -0.09],
  [0.23, 0.82, 0.19, 0.16],
  [0.68, 0.84, 0.43, 0.87],
];
const MOBILE: readonly Placement[] = [
  [0.16, 0.19, 0.15, -0.1],
  [0.5, 0.17, 0.16, 0.08],
  [0.18, 0.82, 0.16, -0.32],
  [0.81, 0.16, 0.12, -0.09],
  [0.43, 0.93, 0.11, 0.16],
  [0.77, 0.81, 0.17, 0.87],
];

let nextId = 0;
const projected = CONSTELLATION_CATALOG.map((group, index) => {
  const ra0 = Math.atan2(
    group.stars.reduce((s, p) => s + Math.sin(p.ra * RAD), 0),
    group.stars.reduce((s, p) => s + Math.cos(p.ra * RAD), 0),
  );
  const dec0 =
    (group.stars.reduce((s, p) => s + p.dec, 0) / group.stars.length) * RAD;
  const project = (star: (typeof group.stars)[number]) => {
    const ra = star.ra * RAD - ra0,
      dec = star.dec * RAD;
    const denominator = Math.max(
      0.05,
      Math.sin(dec0) * Math.sin(dec) +
        Math.cos(dec0) * Math.cos(dec) * Math.cos(ra),
    );
    return {
      u: (-Math.cos(dec) * Math.sin(ra)) / denominator,
      v:
        -(
          Math.cos(dec0) * Math.sin(dec) -
          Math.sin(dec0) * Math.cos(dec) * Math.cos(ra)
        ) / denominator,
    };
  };
  const points = group.stars.map(project);
  const minX = Math.min(...points.map((p) => p.u)),
    maxX = Math.max(...points.map((p) => p.u));
  const minY = Math.min(...points.map((p) => p.v)),
    maxY = Math.max(...points.map((p) => p.v));
  const span = Math.max(maxX - minX, maxY - minY, 0.001);
  const magnitude = Math.min(...group.stars.map((p) => p.magnitude));
  const offset = nextId;
  const toSeed = (
    star: (typeof group.stars)[number],
    id: number,
    field = false,
  ): ProjectedStar => {
    const point = project(star);
    return {
      id,
      group: index,
      u: (point.u - (minX + maxX) / 2) / span,
      v: (point.v - (minY + maxY) / 2) / span,
      major: !field && star.magnitude <= magnitude + 0.55,
      magnitude: star.magnitude,
      colorIndex: star.colorIndex ?? 0.15,
    };
  };
  const stars = group.stars.map((star) => toSeed(star, nextId++));
  const field = group.fieldStars.map((star, i) => toSeed(star, -1 - i, true));
  const edges = group.edges.map(([a, b]) => [offset + a, offset + b] as const);
  return { stars, field, edges };
});

export const CONSTELLATION_EDGES = Object.freeze(
  projected.flatMap((group) => group.edges),
);

// A single north-polar stereographic sky (STG), not six rearranged figures.
// Astropy's STG radius is 2 cos(dec)/(1 + sin(dec)) before angular unit scaling:
// https://docs.astropy.org/en/stable/api/astropy.modeling.projections.Sky2Pix_Stereographic.html
// Every catalog entry uses the same RA origin, roll and scale. RA increases to
// the left as seen looking outward at the sky. The northern hemisphere is our
// projection domain, not an observer's horizon: no location/date is implied.
// The generated cloud artwork has no astrometric metadata and is not registered
// to these catalog positions. Sharing a camera does not make it an observation.
const ATLAS_ROLL = 2.4;
const ATLAS_ASPECT = 1672 / 941;
const atlasProjected = CONSTELLATION_CATALOG.map((group, index) => {
  const project = (star: (typeof group.stars)[number], seed: ProjectedStar) => {
    const ra = star.ra * RAD, dec = star.dec * RAD;
    const radius = 2 * Math.cos(dec) / Math.max(1e-8, 1 + Math.sin(dec));
    const east = -radius * Math.sin(ra), north = radius * Math.cos(ra);
    return {
      ...seed,
      u: east * Math.cos(ATLAS_ROLL) - north * Math.sin(ATLAS_ROLL),
      v: east * Math.sin(ATLAS_ROLL) + north * Math.cos(ATLAS_ROLL),
      visible: star.dec >= 0,
    };
  };
  return {
    stars: group.stars.map((star, i) => project(star, projected[index]!.stars[i]!)),
    field: group.fieldStars.map((star, i) => project(star, projected[index]!.field[i]!)),
  };
});

function atlasScene(width: number, height: number) {
  // One cover crop across desktop and mobile, with no per-group fitting. Stars
  // beyond the viewport retain their real projected coordinates and IDs so
  // existing topology remains stable; the canvas crops the projected sky.
  const scale = Math.max(height, width / ATLAS_ASPECT) * .5;
  const place = (star: (typeof atlasProjected)[number]["stars"][number]): ConstellationNode => ({
    id: star.id, group: star.group,
    ...projectAtlasPoint(width / 2 + star.u * scale, height / 2 + star.v * scale, width, height),
    major: star.major, magnitude: star.magnitude, colorIndex: star.colorIndex,
    visible: star.visible,
  });
  return {
    nodes: atlasProjected.flatMap(group => group.stars.map(place)),
    field: atlasProjected.flatMap(group => group.field.map(place)),
  };
}

export function constellationScene(state: AstralState): {
  nodes: ConstellationNode[];
  field: ConstellationNode[];
} {
  const width = Math.max(0, finite(state.width)),
    height = Math.max(0, finite(state.height));
  if (state.scene === "atlas") return atlasScene(width, height);
  const scale = Math.min(height, width < 700 ? width * 1.65 : width * 0.78);
  const placements = width < 700 ? MOBILE : DESKTOP;
  const nodes: ConstellationNode[] = [],
    field: ConstellationNode[] = [];
  projected.forEach((group, index) => {
    const [u, v, size, rotation] = placements[index]!;
    const cos = Math.cos(rotation),
      sin = Math.sin(rotation),
      extent = scale * size;
    const rotate = (p: ProjectedStar) => ({
      x: (p.u * cos - p.v * sin) * extent,
      y: (p.u * sin + p.v * cos) * extent,
    });
    const shape = group.stars.map(rotate);
    const minX = Math.min(...shape.map((p) => p.x)),
      maxX = Math.max(...shape.map((p) => p.x));
    const minY = Math.min(...shape.map((p) => p.y)),
      maxY = Math.max(...shape.map((p) => p.y));
    const padding = Math.min(Math.min(width, height) / 3, scale * 0.03 + 8);
    const fit = Math.min(
      1,
      Math.max(0, width - padding * 2) / Math.max(maxX - minX, 1),
      Math.max(0, height - padding * 2) / Math.max(maxY - minY, 1),
    );
    // Fixed sky coordinates. Hover reveals the atlas without shifting its stars.
    const cx = clamp(
      width * u,
      padding - minX * fit,
      width - padding - maxX * fit,
    );
    const cy = clamp(
      height * v,
      padding - minY * fit,
      height - padding - maxY * fit,
    );
    const place = (p: ProjectedStar): ConstellationNode => {
      const point = rotate(p);
      return {
        id: p.id,
        group: p.group,
        x: cx + point.x * fit,
        y: cy + point.y * fit,
        major: p.major,
        magnitude: p.magnitude,
        colorIndex: p.colorIndex,
      };
    };
    nodes.push(...group.stars.map(place));
    field.push(...group.field.map(place));
  });
  return { nodes, field };
}

export function constellationLayout(state: AstralState): ConstellationNode[] {
  return constellationScene(state).nodes;
}

export function constellationHitGroup(
  state: AstralState,
  nodes: readonly ConstellationNode[],
): number {
  const x = state.pointerX,
    y = state.pointerY;
  if (
    x === undefined ||
    y === undefined ||
    !Number.isFinite(x + y) ||
    state.hover < 0.02 ||
    x < 0 ||
    y < 0 ||
    x > state.width ||
    y > state.height
  )
    return -1;
  const overText = state.quietRects.some(
    (rect) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  );
  if (overText) return -1;
  let distance = clamp(Math.min(state.width, state.height) * 0.085, 32, 70),
    selected = -1;
  for (const node of nodes) {
    if (node.visible === false) continue;
    const d = Math.hypot(x - node.x, y - node.y);
    if (d < distance) {
      distance = d;
      selected = node.group;
    }
  }
  for (const [a, b] of CONSTELLATION_EDGES) {
    const from = nodes[a]!,
      to = nodes[b]!;
    if (from.visible === false || to.visible === false) continue;
    const dx = to.x - from.x,
      dy = to.y - from.y;
    const t = clamp(
      ((x - from.x) * dx + (y - from.y) * dy) / (dx * dx + dy * dy || 1),
    );
    const d = Math.hypot(x - from.x - dx * t, y - from.y - dy * t) + 8;
    if (d < distance) {
      distance = d;
      selected = from.group;
    }
  }
  return selected;
}

export interface ConstellationFocus {
  strength: number;
  reveal: number;
}
export function createConstellationFocus() {
  const values = CONSTELLATION_CATALOG.map(() => ({ strength: 0, reveal: 0 }));
  return {
    step(
      selected: number,
      dt: number,
      frozen: boolean,
    ): readonly ConstellationFocus[] {
      const elapsed = clamp(finite(dt), 0, 0.05);
      values.forEach((value, index) => {
        const active = index === selected;
        value.strength = frozen
          ? Number(active)
          : value.strength +
            (Number(active) - value.strength) * (1 - Math.exp(-elapsed * 6));
        value.reveal = frozen
          ? Number(active)
          : active
            ? clamp(value.reveal + elapsed / 0.95)
            : Math.max(0, value.reveal - elapsed * 0.7);
      });
      return values;
    },
  };
}
