// Opening-only controls. Other chapters retain their existing quality policy.
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export function holeBufferSize(width: number, height: number, quality = 1): [number, number] {
  const w = Math.max(1, finite(width, 1)), h = Math.max(1, finite(height, 1));
  const level = Math.min(1, Math.max(0.5, finite(quality, 1)));
  // 560k detailed / 320k performance: bounded even on 4K and high-DPI displays.
  const budget = 80000 + 480000 * level;
  const scale = Math.min(0.85, Math.sqrt(budget / (w * h)));
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}

export function advanceHoleClock(time: number, delta: number, timeRate: number) {
  // Keep the existing time-dilation feeling without freezing flow during a dive.
  // The caller still owns pause, preparation and reduced-motion handling.
  const step = Math.min(0.05, Math.max(0, finite(delta, 0)));
  const rate = Math.min(1, Math.max(0.6, finite(timeRate, 1) ** 3));
  return time + step * rate;
}

// Cinematic observer motion, not a claim about the black hole's spin rate.
// The caller holds this angle during scrolling and accessibility pauses.
export function advanceHoleOrbit(angle: number, delta: number, direction = 1) {
  const step = Math.min(0.05, Math.max(0, finite(delta, 0)));
  const sign = finite(direction, 1) < 0 ? -1 : 1;
  return (angle + step * 0.00675 * sign) % (2 * Math.PI);
}
