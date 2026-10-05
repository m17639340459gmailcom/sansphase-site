import { stellarIntensity } from "./stellar-light.ts";
import { fieldHash as hash, sampleStellarField } from "./stellar-field-model.ts";
import { STELLAR_PALETTE } from "./stellar-palette.ts";

interface FineStar {
  x: number; y: number; radius: number; color: string; opacity: number;
  seed: number; twinkle: boolean; stillColor: string;
}
type Surface = HTMLCanvasElement | OffscreenCanvas;
type SurfaceContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface DeepField {
  width: number; height: number; ratio: number;
  stars: readonly FineStar[];
  image: Surface | null;
}
const fields = new WeakMap<CanvasRenderingContext2D, DeepField>();
const TAU = Math.PI * 2;
const rgba = (color: string, opacity: number) => `rgba(${color},${Math.min(1, Math.max(0, opacity)).toFixed(4)})`;
// Crisp resolved points stay in the shared near-white palette. Their radius
// and exposure, rather than cloudy fills or glow discs, provide visible depth.
const FINE_TINTS = {
  warm: STELLAR_PALETTE.warmStar,
  cool: STELLAR_PALETTE.coolStar.split(",").map(channel => Math.round(Number(channel) * .8 + 235 * .2)).join(","),
  neutral: STELLAR_PALETTE.neutralStar,
};

function createStars(width: number, height: number): FineStar[] {
  const stars: FineStar[] = [];
  const target = Math.min(6500, Math.max(760, Math.round(width * height / 275)));
  // Rejection sampling tries many positions. Interpolate a small, fixed density
  // grid instead of recomputing all texture octaves for each rejected point.
  const columns = 80, rows = Math.max(48, Math.min(120, Math.round(80 * height / width)));
  const grid = Array.from({ length: (columns + 1) * (rows + 1) }, (_, index) =>
    sampleStellarField((index % (columns + 1)) / columns, Math.floor(index / (columns + 1)) / rows, width / height));
  const sample = (x: number, y: number) => {
    const gx = x * columns, gy = y * rows, ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy, base = iy * (columns + 1) + ix;
    const a = grid[base]!, b = grid[base + 1]!, c = grid[base + columns + 1]!, d = grid[base + columns + 2]!;
    return {
      density: (a.density * (1 - fx) + b.density * fx) * (1 - fy) + (c.density * (1 - fx) + d.density * fx) * fy,
      warmth: (a.warmth * (1 - fx) + b.warmth * fx) * (1 - fy) + (c.warmth * (1 - fx) + d.warmth * fx) * fy,
    };
  };
  let moving = 0;
  for (let index = 0; stars.length < target && index < target * 30; index++) {
    const seed = 1813 + index * 3.71;
    const x = hash(seed + 3), y = hash(seed + 11);
    const field = sample(x, y);
    if (hash(seed + 19) > field.density) continue;
    const rank = hash(seed + 21), tint = hash(seed + 29);
    const color = tint < field.warmth * .36 ? FINE_TINTS.warm : tint < .58 ? FINE_TINTS.cool : FINE_TINTS.neutral;
    // Three resolved tiers: numerous fine points, fewer clear stellar cores,
    // and scarce larger stars, all below one CSS px in radius and without halos.
    const radius = rank < .68 ? .26 + hash(seed + 37) * .16 : rank < .94 ? .46 + hash(seed + 37) * .24 : .74 + hash(seed + 37) * .24;
    const exposure = .82 + .18 * Math.min(1, field.density / .65);
    const opacity = (rank < .68 ? .38 + hash(seed + 31) * .28 : rank < .94 ? .62 + hash(seed + 31) * .24 : .82 + hash(seed + 31) * .16) * exposure;
    const twinkle = rank > .94 && hash(seed + 41) < .28 && moving < 80;
    if (twinkle) moving++;
    stars.push({ x: x * width, y: y * height, radius, color, opacity, seed, twinkle, stillColor: rgba(color, opacity) });
  }
  return stars;
}

function makeSurface(ctx: CanvasRenderingContext2D, width: number, height: number): Surface | null {
  try {
    const doc = ctx.canvas?.ownerDocument;
    const surface = doc ? doc.createElement("canvas") : typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : null;
    if (!surface || surface === ctx.canvas) return null;
    surface.width = width; surface.height = height;
    return surface;
  } catch { return null; }
}

function paintStars(ctx: SurfaceContext, stars: readonly FineStar[], moving: boolean, time: number): void {
  for (const star of stars) {
    if (star.twinkle !== moving) continue;
    ctx.fillStyle = moving ? rgba(star.color, star.opacity * (.64 + stellarIntensity(star.seed, time) * .36)) : star.stillColor;
    ctx.beginPath(); ctx.arc(star.x, star.y, star.radius, 0, TAU); ctx.fill();
  }
}

function createImage(ctx: CanvasRenderingContext2D, width: number, height: number, ratio: number, stars: readonly FineStar[]): Surface | null {
  const image = makeSurface(ctx, Math.max(1, Math.floor(width * ratio)), Math.max(1, Math.floor(height * ratio)));
  let complete = false;
  try {
    const painter = image?.getContext("2d") as SurfaceContext | null;
    if (!image || !painter || painter === ctx) return null;
    // Transparent, device-resolution stellar cores are cached once per size.
    painter.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintStars(painter, stars, false, 0);
    complete = true;
    return image;
  } catch {
    return null;
  } finally {
    if (!complete && image) image.width = image.height = 0;
  }
}

function release(field: DeepField | undefined): void {
  if (field?.image) field.image.width = field.image.height = 0;
}
export function resetDeepField(ctx: CanvasRenderingContext2D): void {
  release(fields.get(ctx));
  fields.delete(ctx);
}

/** Local only. Fixed geometry underneath original sky stars; no extra RAF. */
export function paintDeepField(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
  if (!Number.isFinite(width + height) || width <= 0 || height <= 0) return;
  const transform = ctx.getTransform?.();
  const deviceRatio = transform ? Math.max(Math.abs(transform.a), Math.abs(transform.d)) : 1;
  const ratio = Math.min(2, Math.max(1, deviceRatio), 3072 / Math.max(width, height), Math.sqrt(2400000 / (width * height)));
  let field = fields.get(ctx);
  if (!field || field.width !== width || field.height !== height || Math.abs(field.ratio - ratio) > .001) {
    release(field);
    const stars = createStars(width, height);
    field = { width, height, ratio, stars, image: createImage(ctx, width, height, ratio, stars) };
    fields.set(ctx, field);
  }
  const seconds = Number.isFinite(time) ? Math.max(0, time) : 0;
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.globalAlpha = 1;
  // Reverse paint stack: twinkling points first, then transparent steady stars.
  paintStars(ctx, field.stars, true, seconds);
  if (field.image) ctx.drawImage(field.image, 0, 0, width, height);
  else paintStars(ctx, field.stars, false, 0);
  ctx.restore();
}
