type Vector3 = readonly [number, number, number];
type SurfaceKind = 0 | 1 | 2 | 3 | 4;
type Sample = { position: Vector3; style: Vector3; details: Vector3 };

export const DATABASE_TIERS = 3;
export const DATABASE_PITCH = 0.28;
export const DATABASE_RADIUS = 1.32;
export const DATABASE_SPACING = 0.72;
export const DATABASE_THICKNESS = 0.58;
const BEVEL = 0.055;
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const EYE: Vector3 = [0, 7 * Math.sin(DATABASE_PITCH), 7 * Math.cos(DATABASE_PITCH)];

function hash(index: number, salt: number) {
  let value = Math.imul(index + 1, 0x9e3779b1) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function radiusAt(y: number) {
  const shoulder = Math.max(0, Math.abs(y) - (DATABASE_THICKNESS / 2 - BEVEL)) / BEVEL;
  return DATABASE_RADIUS - BEVEL + BEVEL * Math.sqrt(Math.max(0, 1 - shoulder * shoulder));
}

/** Reject surfaces hidden behind another tier, rather than drawing see-through lids. */
function occluded([x, y, z]: Vector3, ownTier: number) {
  const dx = EYE[0] - x, dy = EYE[1] - y, dz = EYE[2] - z;
  const a = dx * dx + dz * dz;
  const b = 2 * (x * dx + z * dz);
  const c = x * x + z * z - DATABASE_RADIUS * DATABASE_RADIUS;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return false;
  const root = Math.sqrt(discriminant);
  const radialNear = (-b - root) / (2 * a);
  const radialFar = (-b + root) / (2 * a);
  for (let tier = 0; tier < DATABASE_TIERS; tier++) {
    if (tier === ownTier) continue;
    const center = (tier - 1) * DATABASE_SPACING;
    const low = (center - DATABASE_THICKNESS / 2 - y) / dy;
    const high = (center + DATABASE_THICKNESS / 2 - y) / dy;
    const near = Math.max(radialNear, Math.min(low, high), 0.0001);
    const far = Math.min(radialFar, Math.max(low, high), 1);
    if (far > near) return true;
  }
  return false;
}

function bake(position: Vector3): Vector3 {
  const [x, y, z] = position;
  const c = Math.cos(DATABASE_PITCH), s = Math.sin(DATABASE_PITCH);
  return [x, y * c - z * s, y * s + z * c];
}

function sample(position: Vector3, style: Vector3, tier: number, kind: SurfaceKind): Sample {
  const angle = (Math.atan2(position[2], position[0]) / TAU + 1) % 1;
  return { position, style, details: [tier, angle, kind] };
}

function visibleSamples(
  budget: number, tier: number, make: (index: number, count: number) => Sample,
): Sample[] {
  if (budget === 0) return [];
  // A bounded oversampling pass preserves exact particle budgets after occlusion.
  // Lower caps have only a small exposed crescent, so they need more candidates.
  let candidates: Sample[] = [];
  for (const multiplier of [3, 8, 20, 48]) {
    const count = Math.max(48, budget * multiplier);
    candidates = [];
    for (let i = 0; i < count; i++) {
      const point = make(i, count);
      if (!occluded(point.position, tier)) candidates.push(point);
    }
    if (candidates.length >= budget) break;
  }
  if (candidates.length === 0) throw new Error("A database surface has no visible samples.");
  // Jitter the selected index inside disjoint buckets. A fixed sampling stride
  // aliases both the wall grid and the Vogel disk into visible diagonal bands.
  return Array.from({ length: budget }, (_, index) => {
    const start = Math.floor(index * candidates.length / budget);
    const end = Math.floor((index + 1) * candidates.length / budget);
    const offset = Math.floor(hash(index, 731 + tier) * Math.max(1, end - start));
    return candidates[start + offset];
  });
}

/** Three compact, bevelled particle drums with only physically visible surfaces. */
export function buildDatabase(count: number): {
  positions: Float32Array; styles: Float32Array; details: Float32Array;
} {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("Particle count must be a non-negative safe integer.");
  }
  const samples: Sample[] = [];
  for (let tier = 0; tier < DATABASE_TIERS; tier++) {
    const budget = Math.floor(count / DATABASE_TIERS) + (tier < count % DATABASE_TIERS ? 1 : 0);
    const center = (tier - 1) * DATABASE_SPACING;
    const top = center + DATABASE_THICKNESS / 2;
    const bottom = center - DATABASE_THICKNESS / 2;
    const topCount = Math.floor(budget * (tier === 2 ? 0.32 : 0.07));
    const rimCount = Math.floor(budget * 0.13);
    const baseCount = Math.floor(budget * 0.04);
    const statusCount = Math.floor(budget * 0.025);
    const wallCount = budget - topCount - rimCount - baseCount - statusCount;

    samples.push(...visibleSamples(topCount, tier, (i, n) => {
      const radius = Math.sqrt((i + 0.5) / n) * (DATABASE_RADIUS - BEVEL - 0.006);
      const angle = i * GOLDEN_ANGLE + tier * 0.4;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      const light = 0.40 + 0.16 * (1 - radius / DATABASE_RADIUS) + 0.08 * (-x / DATABASE_RADIUS);
      return sample([x, top, z], [0.035, light, 0.70], tier, 1);
    }));

    samples.push(...visibleSamples(wallCount, tier, (i, n) => {
      // Stratified jitter breaks the old rows/columns without noisy clumping.
      const cols = Math.max(1, Math.ceil(Math.sqrt(n * DATABASE_RADIUS * 2 / DATABASE_THICKNESS)));
      const rows = Math.ceil(n / cols);
      const cell = Math.floor((i + 0.5) * cols * rows / n);
      const u = (cell % cols + 0.15 + hash(i, 91 + tier) * 0.70) / cols;
      const v = (Math.floor(cell / cols) + 0.15 + hash(i, 121 + tier) * 0.70) / rows;
      const localY = (v - 0.5) * DATABASE_THICKNESS;
      const radius = radiusAt(localY);
      const x = (u * 2 - 1) * radius;
      const z = Math.sqrt(Math.max(0, radius * radius - x * x));
      const facing = z / radius;
      const shoulder = Math.abs(localY) / (DATABASE_THICKNESS / 2);
      const shade = 0.36 + 0.46 * Math.pow(facing, 0.65) + 0.14 * (-x / radius)
        - 0.12 * Math.pow(shoulder, 6);
      return sample([x, center + localY, z], [0.025, shade, 0.78], tier, 0);
    }));

    // One restrained top outline per drum. Hidden rear arcs on lower tiers are
    // culled, so the silhouette reads as three volumes instead of six rings.
    samples.push(...visibleSamples(rimCount, tier, (i, n) => {
      const angle = (i + 0.5) / n * TAU;
      const radial = DATABASE_RADIUS - BEVEL;
      return sample([Math.cos(angle) * radial, top, Math.sin(angle) * radial],
        [0.50, 0.84, 0.82], tier, 2);
    }));
    samples.push(...visibleSamples(baseCount, tier, (i, n) => {
      const angle = (i + 0.5) / n * Math.PI;
      const y = -DATABASE_THICKNESS / 2 + BEVEL * 0.25;
      const radial = radiusAt(y);
      return sample([Math.cos(angle) * radial, bottom + BEVEL * 0.25, Math.sin(angle) * radial],
        [0.04, 0.40, 0.72], tier, 3);
    }));

    // Three tiny status indicators sit on the actual curved wall of each tier.
    for (let i = 0; i < statusCount; i++) {
      const dot = i % 3;
      const localIndex = Math.floor(i / 3);
      const dotCount = Math.floor(statusCount / 3) + (dot < statusCount % 3 ? 1 : 0);
      const radial = Math.sqrt((localIndex + 0.5) / dotCount) * 0.020;
      const angle = localIndex * GOLDEN_ANGLE;
      const x = -0.48 + dot * 0.11 + Math.cos(angle) * radial;
      const y = center + Math.sin(angle) * radial;
      const z = Math.sqrt(DATABASE_RADIUS * DATABASE_RADIUS - x * x) + 0.002;
      samples.push(sample([x, y, z], [dot === 0 ? 0.98 : 0.20, dot === 0 ? 1.4 : 0.70, 1.05], tier, 4));
    }
  }

  const positions = new Float32Array(count * 3);
  const styles = new Float32Array(count * 3);
  const details = new Float32Array(count * 3);
  samples.forEach((point, index) => {
    positions.set(bake(point.position), index * 3);
    styles.set(point.style, index * 3);
    details.set(point.details, index * 3);
  });
  return { positions, styles, details };
}
