/** Opening-only camera treatment; rejoin the established dive before blackout. */
export function cinematicHolePose(progress: number) {
  const p = Number.isFinite(progress) ? Math.max(0, progress) : 0;
  const t = Math.max(0, Math.min(1, (p - 0.08) / 0.57));
  const weight = 1 - t * t * (3 - 2 * t);
  if (weight === 0) return { tilt: 0, roll: 0 };
  return { tilt: 0.155 * weight, roll: -0.20 * weight };
}
