import { assertParticleCount, hash, mortonOrder } from "./hero-math";

/**
 * The TDX monogram. Shader/phase ID 0 stays reserved for it, but the owner
 * removed it from playback; it is kept buildable for the registry only.
 */
type V2 = readonly [number, number];
type Stroke = { x: number; y: number; dx: number; dy: number; length: number; width: number };
type Sample = { x: number; y: number; z: number; order: number };

function line(strokes: Stroke[], a: V2, b: V2, width = 0.052) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  strokes.push({ x: a[0], y: a[1], dx, dy, length, width });
}

function polyline(strokes: Stroke[], points: readonly V2[], width = 0.052) {
  for (let i = 1; i < points.length; i++) line(strokes, points[i - 1], points[i], width);
}

function arc(strokes: Stroke[], cx: number, cy: number, radius: number, start: number, end: number, width = 0.052) {
  const segments = Math.max(4, Math.ceil(Math.abs(end - start) * 12));
  let previous: V2 = [cx + Math.cos(start) * radius, cy + Math.sin(start) * radius];
  for (let i = 1; i <= segments; i++) {
    const angle = start + ((end - start) * i) / segments;
    const next: V2 = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    line(strokes, previous, next, width);
    previous = next;
  }
}

function monogramStrokes() {
  const strokes: Stroke[] = [];
  // T: a full-width cap and a centred stem.
  line(strokes, [-1.99, 0.82], [-0.91, 0.82], 0.17);
  line(strokes, [-1.45, 0.82], [-1.45, -0.9], 0.17);
  // D: a straight back with a rounded right side, not a rectangular outline.
  polyline(strokes, [[-0.65, -0.82], [-0.65, 0.82], [-0.3, 0.82]], 0.16);
  arc(strokes, -0.3, 0, 0.82, Math.PI / 2, -Math.PI / 2, 0.16);
  line(strokes, [-0.3, -0.82], [-0.65, -0.82], 0.16);
  // X: two solid diagonal strokes with space clear of the D.
  line(strokes, [0.91, 0.84], [1.96, -0.86], 0.17);
  line(strokes, [0.91, -0.86], [1.96, 0.84], 0.17);
  return strokes;
}

/** Stroke samples at equal arc-length intervals, in Morton order. */
export function buildMonogram(count: number): { positions: Float32Array; styles: Float32Array } {
  assertParticleCount(count);
  const strokes = monogramStrokes();
  const totalLength = strokes.reduce((sum, stroke) => sum + stroke.length, 0);
  const samples: Sample[] = [];
  let segmentIndex = 0;
  let segmentStart = 0;
  const salt = 101;

  for (let i = 0; i < count; i++) {
    // One sample per equal arc-length interval, with small deterministic jitter.
    const distance = ((i + hash(i, salt)) / count) * totalLength;
    while (segmentIndex < strokes.length - 1 && distance > segmentStart + strokes[segmentIndex].length) {
      segmentStart += strokes[segmentIndex].length;
      segmentIndex++;
    }
    const segment = strokes[segmentIndex];
    const t = (distance - segmentStart) / segment.length;
    const offset = (hash(i, salt + 1) - 0.5) * segment.width;
    const x = segment.x + segment.dx * t - (segment.dy / segment.length) * offset;
    const y = segment.y + segment.dy * t + (segment.dx / segment.length) * offset;
    const z = (hash(i, salt + 2) - 0.5) * 0.08;
    samples.push({ x, y, z, order: mortonOrder(x, y) });
  }

  samples.sort((a, b) => a.order - b.order || a.x - b.x || a.y - b.y || a.z - b.z);
  const positions = new Float32Array(count * 3);
  const styles = new Float32Array(count * 3);
  samples.forEach((sample, index) => {
    positions.set([sample.x, sample.y, sample.z], index * 3);
    // The T keeps the accent; D and X use the neutral theme colour.
    styles.set([sample.x < -0.8 ? 1 : 0, 0.9, 0.82], index * 3);
  });
  return { positions, styles };
}
