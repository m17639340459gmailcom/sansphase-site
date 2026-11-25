/** Deterministic helpers shared by the particle shape builders and samplers. */

/** Integer hash avoids mutable PRNG state and platform-dependent sine hashes. */
export function hash(index: number, salt: number) {
  let value = Math.imul(index + 1, 0x9e3779b1) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** Ordering domain: every shape fits inside this model-space rectangle. */
const X_LIMIT = 2.15;
const Y_LIMIT = 1.7;
const GRID = 1024;
/** Particle indices are packed below the curve key, so counts must stay under 2^20. */
export const MAX_ORDERED_PARTICLES = 1 << 20;

function cellX(x: number) {
  return Math.max(0, Math.min(GRID - 1, Math.floor(((x + X_LIMIT) / (X_LIMIT * 2)) * (GRID - 1))));
}

function cellY(y: number) {
  return Math.max(0, Math.min(GRID - 1, Math.floor(((y + Y_LIMIT) / (Y_LIMIT * 2)) * (GRID - 1))));
}

function spreadBits(value: number) {
  value = (value | (value << 8)) & 0x00ff00ff;
  value = (value | (value << 4)) & 0x0f0f0f0f;
  value = (value | (value << 2)) & 0x33333333;
  return (value | (value << 1)) & 0x55555555;
}

/** Z-order (Morton) key; kept for the reserved monogram, whose historic order uses it. */
export function mortonOrder(x: number, y: number) {
  return spreadBits(cellX(x)) | (spreadBits(cellY(y)) << 1);
}

/**
 * Hilbert-curve key (0..2^20-1). Unlike Z-order it never jumps across the
 * plane, so index neighbours stay spatial neighbours in every shape and
 * morphing streams stay coherent without blocky landing fronts.
 */
export function spatialOrder(x: number, y: number) {
  let ix = cellX(x);
  let iy = cellY(y);
  let key = 0;
  for (let s = GRID / 2; s > 0; s >>= 1) {
    const rx = (ix & s) > 0 ? 1 : 0;
    const ry = (iy & s) > 0 ? 1 : 0;
    key += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        ix = GRID - 1 - ix;
        iy = GRID - 1 - iy;
      }
      const swap = ix;
      ix = iy;
      iy = swap;
    }
  }
  return key;
}

/**
 * Indices sorted by screen-space locality (Hilbert key, then original index).
 * Matching indices across shapes therefore travel between nearby regions,
 * which keeps morphs coherent. Keys are packed into one float64 so the sort
 * runs natively instead of through a comparator.
 */
export function localityOrder(positions: Float32Array): Uint32Array {
  const count = Math.floor(positions.length / 3);
  if (count > MAX_ORDERED_PARTICLES) throw new RangeError("Too many particles to order.");
  const keys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    keys[i] = spatialOrder(positions[i * 3], positions[i * 3 + 1]) * MAX_ORDERED_PARTICLES + i;
  }
  keys.sort();
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = keys[i] % MAX_ORDERED_PARTICLES;
  return order;
}

/** Gather `stride`-sized records into a new array following `order`. */
export function reorder(values: Float32Array, stride: number, order: Uint32Array): Float32Array {
  const result = new Float32Array(order.length * stride);
  for (let i = 0; i < order.length; i++) {
    const source = order[i] * stride;
    for (let k = 0; k < stride; k++) result[i * stride + k] = values[source + k];
  }
  return result;
}

export function assertParticleCount(count: number) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("Particle count must be a non-negative safe integer.");
  }
}
