import { CONSTELLATION_CATALOG } from "./constellation-catalog.ts";
import { paintStellarPoint } from "./stellar-light.ts";
import { catalogStarTint, STELLAR_PALETTE } from "./stellar-palette.ts";
import { stellarCompositionFocus } from "./stellar-field-model.ts";
import {
  paintConstellationLabels,
  resetConstellationLabels,
} from "./constellation-labels.ts";
import {
  constellationScene,
  constellationHitGroup,
  createConstellationFocus,
  clamp,
  smooth,
  type ConstellationNode,
  type ConstellationFocus,
} from "./constellation-layout.ts";
import type { AstralState } from "./types.ts";

const color = (rgb: string, alpha: number) => `rgba(${rgb},${clamp(alpha)})`;
// Modest emphasis within one readable sky chart, not physical stellar distances.
interface OutlineAppearance { strength: number; width: number }
const SUPPORTING: OutlineAppearance = { strength: 0.78, width: 0.68 };
const GROUP_APPEARANCE: Readonly<Record<string, OutlineAppearance>> = {
  Ori: { strength: 0.9, width: 0.82 },
  Lyr: { strength: 0.84, width: 0.75 },
  Cyg: { strength: 0.82, width: 0.72 },
  Sco: { strength: 0.8, width: 0.7 },
  Cas: SUPPORTING,
  UMa: { strength: 0.8, width: 0.7 },
};
const apparentLight = (magnitude: number) => smooth((5.2 - magnitude) / 5.2);
type FocusController = ReturnType<typeof createConstellationFocus>;
const sessions = new WeakMap<
  CanvasRenderingContext2D,
  { focus: FocusController; time: number }
>();

/** Release a mounted field's interaction state, even when its clock is frozen. */
export function resetConstellationFocus(ctx: CanvasRenderingContext2D): void {
  sessions.delete(ctx);
  resetConstellationLabels(ctx);
}

function focusFor(
  ctx: CanvasRenderingContext2D,
  state: AstralState,
  nodes: readonly ConstellationNode[],
): readonly ConstellationFocus[] {
  let session = sessions.get(ctx);
  if (!session || state.time < session.time) {
    session = { focus: createConstellationFocus(), time: state.time };
    sessions.set(ctx, session);
  }
  session.time = state.time;
  return session.focus.step(
    constellationHitGroup(state, nodes),
    state.deltaSeconds ?? 1 / 30,
    Boolean(state.reducedMotion),
  );
}

function segment(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function star(
  ctx: CanvasRenderingContext2D,
  state: AstralState,
  node: ConstellationNode,
  strength: number,
  field = false,
): void {
  if (node.visible === false || node.x < 0 || node.y < 0 || node.x > state.width || node.y > state.height)
    return;
  const flux = 10 ** (-0.4 * node.magnitude);
  const luminosity = clamp(flux ** 0.33, 0.04, 1);
  const exposure = apparentLight(node.magnitude);
  const radius =
    (field ? 0.38 + luminosity * 0.55 : 0.45 + luminosity * 2.3) *
    (state.width < 700 ? 0.88 : 1);
  const centre = stellarCompositionFocus(node.x / state.width, node.y / state.height);
  const opacity = field ? (0.14 + luminosity * 0.3) * (1 - centre * .3)
    : node.major ? .28 + exposure * .68 : .16 + exposure * .48;
  paintStellarPoint(
    ctx,
    {
      x: node.x,
      y: node.y,
      radius,
      opacity,
      color: catalogStarTint(node.colorIndex),
      seed: node.group * 131 + node.id * 7.73 + 971,
      prominence: !field && node.major ? (.2 + .62 * smooth((2 - node.magnitude) / 2)) * (1 - centre * .75) : 0,
      // A few bright connecting stars need near-light even when they are not
      // the group's main anchor. It joins points to lines without large halos.
      corona: field || node.major ? undefined
        : node.magnitude <= 2.2 ? (.08 + .12 * smooth((2.2 - node.magnitude) / .7)) * (1 - centre * .55) : 0,
    },
    state.time,
    strength,
  );
}

// Propagation distances are structural, not a particle proximity graph.
const paths = CONSTELLATION_CATALOG.map((group) => {
  const root = group.stars.reduce(
    (best, star, index) =>
      star.magnitude < group.stars[best]!.magnitude ? index : best,
    0,
  );
  const distance = group.stars.map(() => Infinity);
  distance[root] = 0;
  const queue = [root];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!;
    for (const [a, b] of group.edges) {
      const target = a === current ? b : b === current ? a : -1;
      if (target >= 0 && distance[target] === Infinity) {
        distance[target] = distance[current]! + 1;
        queue.push(target);
      }
    }
  }
  const max = Math.max(1, ...distance.filter(Number.isFinite)) + 1;
  return { distance, max };
});

function drawEdge(
  ctx: CanvasRenderingContext2D,
  state: AstralState,
  from: ConstellationNode,
  to: ConstellationNode,
  alpha: number,
  width: number,
  rgb: string,
  start = 0,
  end = 1,
  lightFront = false,
): void {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const a = clamp(start), b = clamp(end);
  if (b <= a) return;
  const ax = from.x + dx * a,
    ay = from.y + dy * a,
    bx = from.x + dx * b,
    by = from.y + dy * b;
  ctx.lineWidth = width;
  const gradient = ctx.createLinearGradient(ax, ay, bx, by);
  for (const t of edgeSamples(Math.hypot(bx - ax, by - ay))) {
    const travelLight = lightFront ? .3 + .7 * t * t : 1;
    const quiet = lineClarity(state, ax + (bx - ax) * t, ay + (by - ay) * t);
    const worldAt = a + (b - a) * t;
    gradient.addColorStop(t, color(rgb, alpha * travelLight * quiet * edgeEnvelope(worldAt, Math.hypot(dx, dy))));
  }
  ctx.strokeStyle = gradient;
  segment(ctx, ax, ay, bx, by);
}

/** Only annotation lines yield to the copy. Stars, the sky and geometry do not. */
function lineClarity(state: AstralState, x: number, y: number): number {
  let strength = 1;
  for (const rect of state.quietRects) {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    strength = Math.min(strength, .5 + .5 * smooth(Math.hypot(dx, dy) / 24));
  }
  return strength;
}
function edgeSamples(length: number): number[] {
  const count = Math.max(8, Math.ceil(length / 18));
  const feather = edgeFeather(length);
  return [...new Set([0, feather, .16, .5, .84, 1 - feather, 1, ...Array.from({ length: count + 1 }, (_, i) => i / count)])].sort((a, b) => a - b);
}
// Keep the complete catalog span legible, fading only beside the stellar core.
function edgeEnvelope(at: number, length: number): number {
  const feather = edgeFeather(length);
  return smooth(at / feather) * smooth((1 - at) / feather);
}
const edgeFeather = (length: number) => Math.min(.16, 6 / Math.max(1, length));

/** Source geometry stays continuous; its low-energy light dissolves into the sky. */
function restingEdge(
  ctx: CanvasRenderingContext2D,
  state: AstralState,
  from: ConstellationNode,
  to: ConstellationNode,
  appearance: OutlineAppearance,
): void {
  const fromLight = apparentLight(from.magnitude), toLight = apparentLight(to.magnitude);
  const salience = Math.sqrt(fromLight * toLight);
  const width = appearance.width + 0.08 * salience;
  const middle = (0.22 + salience * .08) * appearance.strength;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = edgeSamples(length);
  // A clear, thin core carries the connection. The weak optical shoulders
  // soften its edge without replacing it with a wide, barely visible band.
  const layers = [[2.4, .05], [1.2, .11], [.5, .18], [0, .72]] as const;
  for (const [extra, energy] of layers) {
    const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    for (const t of samples) {
      const along = middle * edgeEnvelope(t, length);
      const quiet = lineClarity(state, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      gradient.addColorStop(t, color(extra ? STELLAR_PALETTE.lineHalo : STELLAR_PALETTE.line, along * energy * quiet));
    }
    ctx.strokeStyle = gradient;
    ctx.lineWidth = width + extra;
    segment(ctx, from.x, from.y, to.x, to.y);
  }
}

/** Real star patterns as a transparent, art-directed constellation atlas. */
export function paintConstellation(
  ctx: CanvasRenderingContext2D,
  state: AstralState,
): void {
  if (
    !Number.isFinite(state.width + state.height) ||
    state.width <= 0 ||
    state.height <= 0
  )
    return;
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 0;
  const { nodes, field } = constellationScene(state),
    focus = focusFor(ctx, state, nodes);
  const time = Number.isFinite(state.time) ? state.time : 0;
  // Adjacent catalog neighbourhoods can contain the same HIP star. A shared
  // celestial projection must paint that point once, not add its light twice.
  const seen = state.scene === "atlas" ? new Set(nodes.map(node => `${node.x}:${node.y}`)) : null;
  for (const node of field) {
    const key = `${node.x}:${node.y}`;
    if (seen?.has(key)) continue;
    seen?.add(key);
    star(ctx, state, node, 0, true);
  }
  let offset = 0;
  CONSTELLATION_CATALOG.forEach((group, index) => {
    const active = focus[index]!,
      path = paths[index]!,
      appearance = GROUP_APPEARANCE[group.id] ?? SUPPORTING,
      groupNodes = nodes.slice(offset, offset + group.stars.length);
    for (const [edgeIndex, [a, b]] of group.edges.entries()) {
      const from = groupNodes[a]!,
        to = groupNodes[b]!;
      if (from.visible === false || to.visible === false) continue;
      restingEdge(ctx, state, from, to, appearance);
      const forward = path.distance[a]! <= path.distance[b]!;
      const start = forward ? from : to,
        end = forward ? to : from;
      const depth = Math.min(path.distance[a]!, path.distance[b]!) / path.max;
      const reveal = smooth((active.reveal - depth) / (1 / path.max));
      if (active.strength > 0.001 && reveal > 0) {
        drawEdge(ctx, state, start, end, active.strength * 0.08, 3, STELLAR_PALETTE.lineHalo, 0, reveal);
        drawEdge(
          ctx,
          state,
          start,
          end,
          active.strength * 0.45,
          0.8,
          STELLAR_PALETTE.active,
          0,
          reveal,
          true,
        );
      }
      if (active.strength > 0.001 && !state.reducedMotion) {
        // Flow only marks the hovered structure; the idle sky is not a circuit.
        const sweep = ((time * 0.036 + index * 0.173) % 1) * group.edges.length;
        if (Math.floor(sweep) === edgeIndex) {
          const head = sweep % 1,
            fade = Math.sin(head * Math.PI) ** 2;
          drawEdge(
            ctx,
            state,
            start,
            end,
            fade * active.strength * 0.32,
            1.2,
            STELLAR_PALETTE.line,
            Math.max(0, head - 0.16),
            head,
            true,
          );
        }
      }
    }
    groupNodes.forEach((node, nodeIndex) => {
      const arrival = path.distance[nodeIndex]! / path.max;
      const lit = smooth((active.reveal - arrival) * path.max);
      star(ctx, state, node, active.strength * lit);
    });
    offset += group.stars.length;
  });
  paintConstellationLabels(ctx, state, nodes, focus);
  ctx.restore();
}
