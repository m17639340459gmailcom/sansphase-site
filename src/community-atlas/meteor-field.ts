/**
 * A time-compressed meteor-shower study, not a physical sky simulation.
 * AMS: shared apparent radiant, irregular arrivals and varying visible tracks.
 * https://www.amsmeteors.org/faq/
 * NASA: ordinary rates are much lower than this deliberately visible web cadence.
 * https://science.nasa.gov/solar-system/meteors-meteorites/facts/
 * All tracks are sampled from the active sky clock: no wall-clock timers or backlog.
 */
export interface MeteorPoint {
  id: string;
  x: number;
  y: number;
  tailX: number;
  tailY: number;
  opacity: number;
  width: number;
  color: string;
}

const cadence = 3.8;
const onset = 1.15;
const hash = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
};
const smooth = (from: number, to: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Logical CSS pixels; the caller owns device-pixel scaling and its animation clock. */
export function sampleMeteorField(width: number, height: number, seconds: number): MeteorPoint[] {
  if (![width, height, seconds].every(Number.isFinite) || width <= 0 || height <= 0 || seconds <= 0) return [];
  const current = Math.floor((seconds - onset) / cadence);
  const scale = Math.min(width, height);
  const radiantX = width * 0.88;
  const radiantY = height * -0.35;
  const points: MeteorPoint[] = [];
  // Lifetimes are shorter than one interval; only the two nearest groups can exist.
  for (let offset = 1; offset >= 0; offset--) {
    const group = current - offset;
    if (group < 0) continue;
    const count = hash(group + 511) < 0.18 ? 2 : 1;
    for (let member = 0; member < count; member++) {
      const seed = group * 37 + member * 911 + 1973;
      const start = onset + group * cadence + hash(group * 19 + 7) * 1.05 +
        (member ? 0.35 + hash(seed + 31) * 0.45 : 0);
      const duration = 0.85 + hash(seed + 1) * 0.58;
      const progress = (seconds - start) / duration;
      if (progress <= 0 || progress >= 1) continue;
      const originX = width * (0.15 + hash(seed + 3) * 0.76);
      const originY = height * (0.05 + hash(seed + 5) * 0.59);
      const dx = originX - radiantX;
      const dy = originY - radiantY;
      const distanceToRadiant = Math.hypot(dx, dy);
      const ux = dx / distanceToRadiant;
      const uy = dy / distanceToRadiant;
      const distance = scale * (0.32 + hash(seed + 7) * 0.3);
      const travelled = distance * progress;
      const tailLength = Math.min(travelled, scale * (0.11 + hash(seed + 9) * 0.12));
      const x = originX + ux * travelled;
      const y = originY + uy * travelled;
      const envelope = smooth(0, 0.17, progress) * (1 - smooth(0.6, 1, progress));
      points.push({
        id: `${group}:${member}`,
        x, y,
        tailX: x - ux * tailLength,
        tailY: y - uy * tailLength,
        opacity: envelope * (0.56 + hash(seed + 11) * 0.34),
        width: 0.8 + hash(seed + 13) * 0.6,
        color: hash(seed + 17) < 0.2 ? "242,224,193" : "196,219,244",
      });
    }
  }
  return points;
}

export function paintMeteorField(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number): void {
  for (const point of sampleMeteorField(width, height, seconds)) {
    // Short-lived luminous wake only; no universal persistent smoke/ion trail.
    const glow = ctx.createLinearGradient(point.x, point.y, point.tailX, point.tailY);
    glow.addColorStop(0, `rgba(${point.color},${point.opacity * 0.15})`);
    glow.addColorStop(1, `rgba(${point.color},0)`);
    ctx.strokeStyle = glow;
    ctx.lineWidth = point.width * 4;
    ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(point.tailX, point.tailY); ctx.stroke();
    const trail = ctx.createLinearGradient(point.x, point.y, point.tailX, point.tailY);
    trail.addColorStop(0, `rgba(248,250,255,${point.opacity})`);
    trail.addColorStop(0.28, `rgba(${point.color},${point.opacity * 0.62})`);
    trail.addColorStop(1, `rgba(${point.color},0)`);
    ctx.strokeStyle = trail;
    ctx.lineWidth = point.width;
    ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(point.tailX, point.tailY); ctx.stroke();
    const radius = point.width * 5;
    const head = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    head.addColorStop(0, `rgba(248,250,255,${point.opacity * 0.65})`);
    head.addColorStop(0.16, `rgba(${point.color},${point.opacity * 0.22})`);
    head.addColorStop(1, `rgba(${point.color},0)`);
    ctx.fillStyle = head;
    ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(252,253,255,${point.opacity})`;
    ctx.beginPath(); ctx.arc(point.x, point.y, point.width * 0.48, 0, Math.PI * 2); ctx.fill();
  }
}
