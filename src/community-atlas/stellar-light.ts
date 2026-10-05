/** Ground-observer scintillation, art-directed for a dark webpage, not a physics simulation. */
export interface StellarPoint {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  color: string;
  seed: number;
  /** Only the brightest point sources receive short photographic diffraction. */
  prominence?: number;
  /** Compact near-light independent of the sparse photographic halo/rays. */
  corona?: number;
}

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const hash = (value: number) => {
  const n = Math.sin(value * 127.1 + 311.7) * 43758.5453123;
  return n - Math.floor(n);
};
function noise(seed: number, time: number): number {
  const cell = Math.floor(time),
    f = time - cell;
  const blend = f * f * (3 - 2 * f);
  return (
    (hash(seed + cell * 19.19) * (1 - blend) +
      hash(seed + (cell + 1) * 19.19) * blend) *
      2 -
    1
  );
}

/** Independent, band-limited fluctuations. No accumulated geometry or per-frame randomness. */
export function stellarIntensity(seed: number, seconds: number): number {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const phase = hash(seed + 3) * 100;
  const rate = 0.8 + hash(seed + 7) * 0.4;
  const variation =
    noise(seed, time * 0.26 * rate + phase) * 0.68 +
    noise(seed + 37, time * 0.7 * rate + phase) * 0.25 +
    noise(seed + 91, time * 1.8 * rate + phase) * 0.07;
  // Keep point sources legible through their dim phase. Slow independent
  // fluctuations provide life without synchronized breathing or rapid flashes.
  return 0.84 + Math.tanh(variation * 1.8) * 0.28;
}

const rgba = (rgb: string, alpha: number) => `rgba(${rgb},${clamp(alpha)})`;

/** A tapered photographic ray; its geometry does not pulse with the light. */
function ray(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, length: number, width: number,
  angle: number, color: string, energy: number,
): void {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const gradient = ctx.createLinearGradient(x, y, x + dx * length, y + dy * length);
  gradient.addColorStop(0, rgba("249,251,255", energy));
  gradient.addColorStop(0.14, rgba(color, energy * 0.65));
  gradient.addColorStop(0.46, rgba(color, energy * 0.18));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(x - dy * width, y + dx * width);
  ctx.lineTo(x + dx * length, y + dy * length);
  ctx.lineTo(x + dy * width, y - dx * width);
  ctx.fill();
}

/** Exposure-inspired light profile, not a physical stellar surface or a generated image. */
export function paintStellarPoint(
  ctx: CanvasRenderingContext2D,
  point: StellarPoint,
  seconds: number,
  emphasis = 0,
): void {
  const { x, y, radius, color } = point;
  const light = stellarIntensity(point.seed, seconds);
  const prominence = clamp(point.prominence ?? 0);
  const nearLight = clamp(point.corona ?? prominence);
  const nearRamp = clamp(nearLight / .12);
  const nearEnergy = nearRamp * nearRamp * (3 - 2 * nearRamp);
  const opacity = clamp(point.opacity * light + emphasis * 0.14);
  if (prominence > 0) {
    const reach = radius * (4.8 + prominence * 7.2);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, reach);
    const halo = opacity * (0.07 + prominence * 0.11 + emphasis * 0.04);
    glow.addColorStop(0, rgba(color, halo));
    glow.addColorStop(0.12, rgba(color, halo * 0.65));
    glow.addColorStop(0.38, rgba(color, halo * 0.16));
    glow.addColorStop(0.7, rgba(color, halo * 0.025));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, reach, 0, Math.PI * 2);
    ctx.fill();
  }
  if (nearLight > 0) {
    const shoulder = radius * (1.8 + nearLight * 1.4);
    const corona = ctx.createRadialGradient(x, y, 0, x, y, shoulder);
    corona.addColorStop(0, rgba("244,249,255", opacity * nearEnergy * 0.94));
    corona.addColorStop(0.16, rgba(color, opacity * nearEnergy * 0.72));
    corona.addColorStop(0.4, rgba(color, opacity * nearEnergy * 0.25));
    corona.addColorStop(0.72, rgba(color, opacity * nearEnergy * 0.045));
    corona.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(x, y, shoulder, 0, Math.PI * 2);
    ctx.fill();
  }
  if (prominence > 0.7) {
    const reach = radius * (2.8 + prominence * 4.6);
    const energy = opacity * prominence * (0.5 + emphasis * 0.1);
    for (let arm = 0; arm < 4; arm++) {
      ray(ctx, x, y, reach * (arm % 2 ? 0.82 : 1),
        0.13 + prominence * 0.16, Math.PI / 8 + arm * Math.PI / 2, color, energy);
    }
  }
  // A small graded core prevents the old solid-circle / diagram-node appearance.
  const core = ctx.createRadialGradient(x, y, 0, x, y, radius);
  core.addColorStop(0, rgba("253,252,248", opacity));
  core.addColorStop(0.38, rgba("244,249,255", opacity * 0.96));
  core.addColorStop(0.74, rgba(color, opacity * 0.78));
  core.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  // Preserve tiny background stars after optical falloff is introduced. At this
  // scale a sharp centre is necessary; raising the broad halo would add haze.
  ctx.fillStyle = rgba("250,250,248", opacity * (prominence > 0 ? 0.82 : 0.94));
  ctx.beginPath();
  ctx.arc(x, y, radius * (prominence > 0 ? 0.32 : 0.66), 0, Math.PI * 2);
  ctx.fill();
}
