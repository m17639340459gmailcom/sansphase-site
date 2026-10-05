import { CONSTELLATION_CATALOG } from "./constellation-catalog.ts";
import {
  clamp,
  constellationHitGroup,
  smooth,
  type ConstellationNode,
  type ConstellationFocus,
} from "./constellation-layout.ts";
import type { AstralState, QuietRect } from "./types.ts";
import { projectAtlasPoint, unprojectAtlasPoint } from "./atlas-camera.ts";

interface LabelAnchor {
  text: string;
  x: number;
  y: number;
  box: QuietRect;
}
const layouts = new WeakMap<
  CanvasRenderingContext2D,
  { key: string; anchors: Array<LabelAnchor | null> }
>();
const FONT = '10px ui-monospace, "Microsoft YaHei", monospace';

export function resetConstellationLabels(ctx: CanvasRenderingContext2D): void {
  layouts.delete(ctx);
}

function separation(a: QuietRect, b: QuietRect): number {
  const dx = Math.max(a.left - b.right, b.left - a.right, 0);
  const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
  return Math.hypot(dx, dy);
}

/** Choose all anchors together once, independent of which group is hovered. */
function arrange(
  state: AstralState,
  nodes: readonly ConstellationNode[],
  names: readonly string[],
  widths: readonly number[],
): Array<LabelAnchor | null> {
  const reserved: QuietRect[] = [];
  return CONSTELLATION_CATALOG.map((_group, index) => {
    const width = widths[index]!;
    const candidates = nodes
      .filter((node) => node.group === index && node.visible !== false)
      .sort((a, b) => a.magnitude - b.magnitude)
      .flatMap((anchor) => [
        { x: anchor.x + 16, y: anchor.y + 25 },
        { x: anchor.x - width - 16, y: anchor.y - 18 },
        { x: anchor.x - width / 2, y: anchor.y + 32 },
        { x: anchor.x + 16, y: anchor.y - 18 },
        { x: anchor.x - width - 16, y: anchor.y + 25 },
      ])
      .map((p) => ({
        ...p,
        text: names[index]!,
        box: { left: p.x, top: p.y - 12, right: p.x + width, bottom: p.y + 2 },
      }))
      .filter(
        (p) =>
          p.x >= 16 &&
          p.x + width < state.width - 16 &&
          p.y > 25 &&
          p.y < state.height - 22 &&
          reserved.every((rect) => separation(p.box, rect) >= 18),
      );
    // Content only influences initial placement or a real resize/font-layout change.
    // A later scroll may fade this anchor, but must never replace it with another.
    const chosen =
      candidates.find((p) =>
        state.quietRects.every((rect) => separation(p.box, rect) >= 18),
      ) ??
      candidates[0] ??
      null;
    if (chosen) reserved.push(chosen.box);
    return chosen;
  });
}

export function paintConstellationLabels(
  ctx: CanvasRenderingContext2D,
  state: AstralState,
  nodes: readonly ConstellationNode[],
  focus: readonly ConstellationFocus[],
): void {
  ctx.font = FONT;
  const names = CONSTELLATION_CATALOG.map(
    (group) => `${group.name}  /  ${group.englishName.toUpperCase()}`,
  );
  const widths = names.map((name) => ctx.measureText(name).width);
  const key = [state.scene ?? "pure", state.width, state.height, ...widths].join(":");
  let layout = layouts.get(ctx);
  if (!layout || layout.key !== key) {
    layout = { key, anchors: arrange(state, nodes, names, widths) };
    if (state.scene === "atlas") {
      // Store one anchor in chart coordinates. The shared camera moves it with
      // the stars; scrolling and hover must never choose another label position.
      layout.anchors = layout.anchors.map((anchor) => {
        if (!anchor) return null;
        const point = unprojectAtlasPoint(anchor.x, anchor.y, state.width, state.height);
        return { ...anchor, ...point };
      });
    }
    layouts.set(ctx, layout);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const selected = constellationHitGroup(state, nodes);
  layout.anchors.forEach((stored, index) => {
    const strength = focus[index]!.strength;
    // Only the currently inspected figure may show a name. Old hover lighting
    // can ease out, but its caption must not linger beside the next selection.
    if (!stored || index !== selected || strength < 0.2) return;
    let anchor = stored;
    if (state.scene === "atlas") {
      const point = projectAtlasPoint(stored.x, stored.y, state.width, state.height);
      anchor = { ...stored, ...point, box: { left: point.x, top: point.y - 12,
        right: point.x + widths[index]!, bottom: point.y + 2 } };
      if (anchor.box.left < 8 || anchor.box.right > state.width - 8 ||
        anchor.box.top < 8 || anchor.box.bottom > state.height - 8) return;
    }
    const distance = Math.min(
      18,
      ...state.quietRects.map((rect) => separation(anchor.box, rect)),
    );
    const visibility = smooth(distance / 18);
    if (visibility < 0.001) return;
    ctx.fillStyle = `rgba(191,217,233,${clamp((0.27 + strength * 0.55) * visibility)})`;
    ctx.fillText(anchor.text, anchor.x, anchor.y);
  });
}
