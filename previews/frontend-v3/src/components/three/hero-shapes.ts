import { PLAYBACK_ORDER, REDUCED_PHASE } from "./hero-cycle";
import { buildDatabase, DATABASE_PITCH } from "./hero-database";
import { buildLattice } from "./hero-lattice";
import { assertParticleCount, hash, localityOrder, reorder } from "./hero-math";
import { buildMonogram } from "./hero-monogram";
import { buildNetwork, NETWORK_SCALE, NETWORK_SWAY } from "./hero-network";

/**
 * Particle shape registry.
 *
 * A shape only describes *where* particles rest and how they look there; the
 * simulation, choreography and rendering are generic. To add a shape, append a
 * definition here (or call `registerHeroShape`), give it a `Home.particles.<key>`
 * message, and list its `id` in `PLAYBACK_ORDER` when it should autoplay.
 * See docs/hero-particles.md.
 */

/** Bespoke per-particle styling the render shader knows about. */
export type ShapeEffect = "plain" | "database" | "network";
export const SHAPE_EFFECT_IDS: Record<ShapeEffect, number> = { plain: 0, database: 1, network: 2 };

/** Idle motion applied to the resting targets (all amplitudes in model units/radians). */
export type ShapeMotion = {
  /** Uniform scale applied to the built positions. */
  scale: number;
  /** Slow yaw oscillation: angle = sin(time * speed) * amplitude. */
  sway: { amplitude: number; speed: number };
  /** Coherent simplex undulation of the resting surface. */
  ripple: { amplitude: number; frequency: number; speed: number };
  /** Stack breathing along `axis`; `spread` separates groups around `center`. */
  breathe: { amplitude: number; spread: number; speed: number; center: number; axis: readonly [number, number, number] };
};

export type ShapeBuild = {
  /** xyz per particle, model units before `motion.scale`, already in locality order. */
  positions: Float32Array;
  /** accent (0..1), opacity, size multiplier per particle. */
  styles: Float32Array;
  /** Optional group per particle (database tier, network layer); drives breathing and effects. */
  groups?: Float32Array;
  /** Optional two effect-specific values per particle. */
  details?: Float32Array;
};

export type ShapeDefinition = {
  /** Stable shader/phase ID reported through `onPhaseChange`. */
  id: number;
  /** Translation key under `Home.particles`. */
  key: string;
  effect: ShapeEffect;
  motion: ShapeMotion;
  build(count: number): ShapeBuild;
};

export const STILL_MOTION: ShapeMotion = {
  scale: 1,
  sway: { amplitude: 0, speed: 0 },
  ripple: { amplitude: 0, frequency: 1, speed: 0 },
  breathe: { amplitude: 0, spread: 0, speed: 0, center: 0, axis: [0, 1, 0] },
};

/** Keep every attribute of one particle together in the shared locality order. */
function ordered(build: Required<ShapeBuild>): ShapeBuild {
  const order = localityOrder(build.positions);
  return {
    positions: reorder(build.positions, 3, order),
    styles: reorder(build.styles, 3, order),
    groups: reorder(build.groups, 1, order),
    details: reorder(build.details, 2, order),
  };
}

function buildDatabaseShape(count: number): ShapeBuild {
  const model = buildDatabase(count);
  const groups = new Float32Array(count);
  const details = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    groups[i] = model.details[i * 3]; // tier
    details[i * 2] = model.details[i * 3 + 1]; // normalized azimuth
    details[i * 2 + 1] = model.details[i * 3 + 2]; // surface kind
  }
  return ordered({ positions: model.positions, styles: model.styles, groups, details });
}

function buildNetworkShape(count: number): ShapeBuild {
  const model = buildNetwork(count);
  const groups = new Float32Array(count);
  const details = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    groups[i] = model.links[i * 3]; // source layer
    details[i * 2] = model.links[i * 3 + 1]; // target layer
    details[i * 2 + 1] = model.links[i * 3 + 2]; // edge t, -1 on surfaces
  }
  return ordered({ positions: model.positions, styles: model.styles, groups, details });
}

function buildLatticeShape(count: number): ShapeBuild {
  const { positions } = buildLattice(count);
  const order = localityOrder(positions);
  const styles = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // The same ~4% of particle indices that carried the accent before the registry.
    // With ~4.5× more particles than the old field, sheets need a little more weight to read.
    const accent = hash(i, 503) >= 0.96 ? 1 : 0;
    styles.set([accent, 0.96, accent ? 1.15 : 0.8], i * 3);
  }
  return { positions: reorder(positions, 3, order), styles };
}

export const HERO_SHAPES: readonly ShapeDefinition[] = [
  { id: 0, key: "monogram", effect: "plain", motion: STILL_MOTION, build: buildMonogram },
  {
    id: 1,
    key: "database",
    effect: "database",
    motion: {
      ...STILL_MOTION,
      // Whole tiers lift together; spacing may expand a little but never contracts.
      breathe: { amplitude: 0.055, spread: 0.035, speed: 1.15, center: 1, axis: [0, Math.cos(DATABASE_PITCH), Math.sin(DATABASE_PITCH)] },
    },
    build: buildDatabaseShape,
  },
  {
    id: 2,
    key: "network",
    effect: "network",
    motion: { ...STILL_MOTION, scale: NETWORK_SCALE, sway: { amplitude: NETWORK_SWAY, speed: 0.26 } },
    build: buildNetworkShape,
  },
  {
    id: 3,
    key: "lattice",
    effect: "plain",
    motion: { ...STILL_MOTION, sway: { amplitude: 0.22, speed: 0.15 }, ripple: { amplitude: 0.06, frequency: 0.9, speed: 0.12 } },
    build: buildLatticeShape,
  },
];

const registry = new Map<number, ShapeDefinition>(HERO_SHAPES.map((shape) => [shape.id, shape]));

/** Adds a shape (e.g. one made with `defineSampledShape`). IDs are permanent. */
export function registerHeroShape(shape: ShapeDefinition) {
  if (!Number.isInteger(shape.id) || shape.id < 0) throw new RangeError("Shape IDs are non-negative integers.");
  if (!shape.key) throw new Error("A shape needs a Home.particles message key.");
  if (registry.has(shape.id)) throw new Error(`Shape ID ${shape.id} is already registered.`);
  registry.set(shape.id, shape);
}

export function getHeroShape(id: number): ShapeDefinition {
  const shape = registry.get(id);
  if (!shape) throw new Error(`Unknown particle shape ${id}.`);
  return shape;
}

export function listHeroShapes(): ShapeDefinition[] {
  return [...registry.values()].sort((a, b) => a.id - b.id);
}

/** Shapes the hero can show: autoplay order plus the reduced-motion default. */
export function playbackShapeIds(): number[] {
  return [...new Set<number>([...PLAYBACK_ORDER, REDUCED_PHASE])];
}

/**
 * Column-major 4x4 motion block uploaded as one `mat4` uniform:
 * [scale, swayAmp, swaySpeed, rippleAmp], [rippleFreq, rippleSpeed, breatheAmp, breatheSpread],
 * [breatheSpeed, breatheCenter, 0, 0], [axis.x, axis.y, axis.z, 0].
 */
export function motionElements(motion: ShapeMotion, out = new Float32Array(16)) {
  const { scale, sway, ripple, breathe } = motion;
  out.set([
    scale, sway.amplitude, sway.speed, ripple.amplitude,
    ripple.frequency, ripple.speed, breathe.amplitude, breathe.spread,
    breathe.speed, breathe.center, 0, 0,
    breathe.axis[0], breathe.axis[1], breathe.axis[2], 0,
  ]);
  return out;
}

/** Shape data laid out as float textures: one `side × side` block per slot, stacked vertically. */
export type ShapeAtlas = {
  count: number;
  side: number;
  /** Shape IDs in slot order. */
  ids: number[];
  /** RGBA per texel: x, y, z, group. */
  positions: Float32Array;
  /** RGBA per texel: accent, opacity, size, detail0. */
  styles: Float32Array;
  /** RG per texel: detail1, unused. */
  details: Float32Array;
};

export function atlasSide(count: number) {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

function validateBuild(build: ShapeBuild, count: number, key: string) {
  const expected: [keyof ShapeBuild, number][] = [["positions", 3], ["styles", 3], ["groups", 1], ["details", 2]];
  for (const [name, stride] of expected) {
    const values = build[name];
    if (values === undefined && (name === "groups" || name === "details")) continue;
    if (!(values instanceof Float32Array) || values.length !== count * stride) {
      throw new Error(`Shape "${key}" returned ${name} with the wrong length.`);
    }
  }
}

function createAtlas(ids: readonly number[], count: number): ShapeAtlas {
  assertParticleCount(count);
  if (ids.length === 0) throw new Error("The atlas needs at least one shape.");
  if (new Set(ids).size !== ids.length) throw new Error("Atlas shape IDs must be unique.");
  const side = atlasSide(count);
  const texels = side * side * ids.length;
  return {
    count, side, ids: [...ids],
    positions: new Float32Array(texels * 4),
    styles: new Float32Array(texels * 4),
    details: new Float32Array(texels * 2),
  };
}

function writeSlot(atlas: ShapeAtlas, slot: number) {
  const shape = getHeroShape(atlas.ids[slot]);
  const build = shape.build(atlas.count);
  validateBuild(build, atlas.count, shape.key);
  const offset = slot * atlas.side * atlas.side;
  for (let i = 0; i < atlas.count; i++) {
    const texel = offset + i;
    atlas.positions[texel * 4] = build.positions[i * 3];
    atlas.positions[texel * 4 + 1] = build.positions[i * 3 + 1];
    atlas.positions[texel * 4 + 2] = build.positions[i * 3 + 2];
    atlas.positions[texel * 4 + 3] = build.groups ? build.groups[i] : 0;
    atlas.styles[texel * 4] = build.styles[i * 3];
    atlas.styles[texel * 4 + 1] = build.styles[i * 3 + 1];
    atlas.styles[texel * 4 + 2] = build.styles[i * 3 + 2];
    atlas.styles[texel * 4 + 3] = build.details ? build.details[i * 2] : 0;
    atlas.details[texel * 2] = build.details ? build.details[i * 2 + 1] : 0;
  }
}

export function packShapeAtlas(ids: readonly number[], count: number): ShapeAtlas {
  const atlas = createAtlas(ids, count);
  for (let slot = 0; slot < ids.length; slot++) writeSlot(atlas, slot);
  return atlas;
}

/** Same result as `packShapeAtlas`, one shape per task so page load stays responsive. */
export async function packShapeAtlasAsync(
  ids: readonly number[], count: number, pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
): Promise<ShapeAtlas> {
  const atlas = createAtlas(ids, count);
  for (let slot = 0; slot < ids.length; slot++) {
    await pause();
    writeSlot(atlas, slot);
  }
  return atlas;
}
