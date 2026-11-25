import { assertParticleCount, hash, localityOrder, reorder } from "./hero-math";
import { STILL_MOTION, type ShapeBuild, type ShapeDefinition, type ShapeMotion } from "./hero-shapes";

/**
 * Turns any alpha mask (rasterised text, an SVG logo, an image) into particle
 * targets with a little depth. The sampling core is pure and deterministic;
 * the rasterisers below are thin browser helpers around a 2D canvas.
 */

/** Row-major pixels, top row first. `data` is RGBA (length w*h*4) or one alpha channel (w*h). */
export type ParticleMask = {
  width: number;
  height: number;
  data: ArrayLike<number>;
};

export type MaskSampleOptions = {
  /** Largest model-space width of the result (the hero frame is about 4.3 units wide). */
  width?: number;
  /** Largest model-space height of the result. */
  height?: number;
  /** Total z thickness; outlines stay flatter than fills so edges read crisply. */
  depth?: number;
  /** 0..1 coverage needed for a pixel to count as filled. */
  threshold?: number;
  /** Extra sampling weight for outline pixels (0 = uniform fill). */
  edgeWeight?: number;
  /** "color": saturated source pixels take the theme accent (RGBA masks only). */
  accent?: "none" | "color";
  salt?: number;
};

const DEFAULTS = { width: 3.6, height: 2.5, depth: 0.16, threshold: 0.5, edgeWeight: 1.5, accent: "none", salt: 907 } as const;

function channels(mask: ParticleMask) {
  const pixels = mask.width * mask.height;
  if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width <= 0 || mask.height <= 0) {
    throw new RangeError("Mask dimensions must be positive integers.");
  }
  if (mask.data.length === pixels * 4) return 4;
  if (mask.data.length === pixels) return 1;
  throw new RangeError("Mask data must hold one alpha value or four RGBA values per pixel.");
}

/** Accepts 0..255 (canvas) or 0..1 (float) values. */
function normalizer(mask: ParticleMask, stride: number) {
  let max = 0;
  for (let i = stride - 1; i < mask.data.length; i += stride) max = Math.max(max, mask.data[i]);
  return max > 1 ? 1 / 255 : 1;
}

/** Deterministically distribute `count` particles over the filled pixels of a mask. */
export function sampleMask(mask: ParticleMask, count: number, options: MaskSampleOptions = {}): Required<ShapeBuild> {
  assertParticleCount(count);
  const settings = { ...DEFAULTS, ...options };
  const stride = channels(mask);
  const scale = normalizer(mask, stride);
  const { width, height } = mask;
  const alpha = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : mask.data[(y * width + x) * stride + stride - 1] * scale;

  // Filled pixels, their outline flag and bounding box.
  const filled: number[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha(x, y) < settings.threshold) continue;
      filled.push(y * width + x);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x + 1);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y + 1);
    }
  }
  if (filled.length === 0) throw new Error("The mask has no filled pixels.");

  const edge = new Uint8Array(filled.length);
  const cumulative = new Float64Array(filled.length);
  let total = 0;
  filled.forEach((pixel, index) => {
    const x = pixel % width, y = Math.floor(pixel / width);
    const outline = alpha(x - 1, y) < settings.threshold || alpha(x + 1, y) < settings.threshold
      || alpha(x, y - 1) < settings.threshold || alpha(x, y + 1) < settings.threshold;
    edge[index] = outline ? 1 : 0;
    total += 1 + (outline ? settings.edgeWeight : 0);
    cumulative[index] = total;
  });

  const unit = Math.min(settings.width / (maxX - minX), settings.height / (maxY - minY));
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const positions = new Float32Array(count * 3);
  const styles = new Float32Array(count * 3);
  const salt = settings.salt;

  for (let i = 0; i < count; i++) {
    // Stratified: one sample per equal slice of the cumulative weight.
    const target = ((i + hash(i, salt)) / count) * total;
    let low = 0, high = filled.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (cumulative[middle] <= target) low = middle + 1; else high = middle;
    }
    const pixel = filled[low];
    const px = pixel % width + hash(i, salt + 1);
    const py = Math.floor(pixel / width) + hash(i, salt + 2);
    const outline = edge[low] === 1;
    const z = (hash(i, salt + 3) - 0.5) * settings.depth * (outline ? 0.35 : 1);
    positions.set([(px - centerX) * unit, (centerY - py) * unit, z], i * 3);

    let accent = 0;
    if (settings.accent === "color" && stride === 4) {
      const base = pixel * 4;
      const r = mask.data[base] * scale, g = mask.data[base + 1] * scale, b = mask.data[base + 2] * scale;
      const brightest = Math.max(r, g, b), darkest = Math.min(r, g, b);
      accent = brightest > 0.25 && brightest - darkest > 0.3 * brightest ? 1 : 0;
    }
    styles.set([accent, outline ? 0.95 : 0.72, outline ? 0.9 : 0.78], i * 3);
  }

  const order = localityOrder(positions);
  return {
    positions: reorder(positions, 3, order),
    styles: reorder(styles, 3, order),
    groups: new Float32Array(count),
    details: new Float32Array(count * 2),
  };
}

/** A registry entry that samples a prepared mask; register it with `registerHeroShape`. */
export function defineSampledShape({ id, key, mask, motion = STILL_MOTION, sample }: {
  id: number;
  key: string;
  mask: ParticleMask;
  motion?: ShapeMotion;
  sample?: MaskSampleOptions;
}): ShapeDefinition {
  return { id, key, effect: "plain", motion, build: (count) => sampleMask(mask, count, sample) };
}

// ---------------------------------------------------------------------------
// Browser rasterisers (not available during SSR or in Node tests).

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createContext(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas !== "undefined") {
    const context = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
    if (context) return context;
  }
  if (typeof document === "undefined") throw new Error("Rasterising a mask needs a browser canvas.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas is unavailable.");
  return context;
}

function toMask(context: Canvas2D, width: number, height: number): ParticleMask {
  const { data } = context.getImageData(0, 0, width, height);
  return { width, height, data };
}

/**
 * Rasterise text (a wordmark, a community name). Make sure the font has loaded
 * (`await document.fonts.load(font)`) before calling, or the fallback font is sampled.
 */
export function rasterizeText(text: string, { font = "700 160px sans-serif", padding = 12, letterSpacing = "0px" }: {
  font?: string; padding?: number; letterSpacing?: string;
} = {}): ParticleMask {
  const probe = createContext(8, 8);
  probe.font = font;
  if ("letterSpacing" in probe) (probe as { letterSpacing: string }).letterSpacing = letterSpacing;
  const metrics = probe.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || metrics.fontBoundingBoxAscent || 120;
  const descent = metrics.actualBoundingBoxDescent || metrics.fontBoundingBoxDescent || 30;
  const width = Math.max(1, Math.ceil(metrics.width + padding * 2));
  const height = Math.max(1, Math.ceil(ascent + descent + padding * 2));
  const context = createContext(width, height);
  context.font = font;
  if ("letterSpacing" in context) (context as { letterSpacing: string }).letterSpacing = letterSpacing;
  context.fillStyle = "#000";
  context.textBaseline = "alphabetic";
  context.fillText(text, padding, padding + ascent);
  return toMask(context, width, height);
}

/** Rasterise a decoded image, canvas or SVG <img>, fitted into `size` pixels. */
export function rasterizeImage(source: CanvasImageSource & { width: number; height: number }, size = 320): ParticleMask {
  const ratio = source.width / source.height || 1;
  const width = Math.max(1, Math.round(ratio >= 1 ? size : size * ratio));
  const height = Math.max(1, Math.round(ratio >= 1 ? size / ratio : size));
  const context = createContext(width, height);
  context.drawImage(source, 0, 0, width, height);
  return toMask(context, width, height);
}

/** Load an SVG/PNG URL (or `data:` / blob URL) and rasterise it. */
export async function loadImageMask(url: string, size = 320): Promise<ParticleMask> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  // SVGs without intrinsic size report 0; give them a square canvas.
  if (!image.width || !image.height) { image.width = size; image.height = size; }
  return rasterizeImage(image, size);
}
