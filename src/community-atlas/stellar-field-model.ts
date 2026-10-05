/**
 * Static pure-space composition, not an observed sky map. Open space and a few
 * compact star groups provide depth through point density alone.
 * No camera, text rectangle or animation time changes this geometry.
 */
export function fieldHash(seed: number): number {
  let n = Math.imul(Math.floor(seed * 4096), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (n: number) => { const v = clamp(n); return v * v * (3 - 2 * v); };
function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), u = smooth(x - ix), v = smooth(y - iy);
  const a = fieldHash(ix * 37 + iy * 257 + 417);
  const b = fieldHash((ix + 1) * 37 + iy * 257 + 417);
  const c = fieldHash(ix * 37 + (iy + 1) * 257 + 417);
  const d = fieldHash((ix + 1) * 37 + (iy + 1) * 257 + 417);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
export interface StellarFieldSample {
  density: number;
  warmth: number;
}

const STAR_GROUPS = [
  { x: .19, y: .62, spread: .082, strength: .66 },
  { x: .73, y: .19, spread: .066, strength: .6 },
  { x: .61, y: .84, spread: .072, strength: .39 },
] as const;

/** Broad composition only; the centre eases back without a text-shaped hole. */
export function stellarCompositionFocus(x: number, y: number): number {
  return Math.exp(-1.35 * (((x - .5) / .37) ** 2 + ((y - .5) / .45) ** 2));
}

export function sampleStellarField(x: number, y: number, aspect: number): StellarFieldSample {
  const scale = Math.max(.65, Math.min(1.6, aspect));
  const u = (x - .5) * scale, v = y - .5;
  const broad = noise(u * 3.4 + 17, v * 3.4 + 9);
  const detail = noise(u * 12.7 - 6, v * 12.7 + 21);
  let groups = 0;
  for (const group of STAR_GROUPS) {
    const dx = (x - group.x) * scale / group.spread;
    const dy = (y - group.y) / group.spread;
    groups += Math.exp(-(dx * dx + dy * dy)) * group.strength;
  }
  const focus = stellarCompositionFocus(x, y);
  const density = clamp((.18 + broad * .16 + detail * .065
    + groups * (.5 + detail * .5)) * (1 - .12 * focus));
  return {
    density,
    warmth: .1 + detail * .26,
  };
}
