// A cinematic reveal of the hole within the existing sky, not a collapse solver.
// Decreasing sampling offsets move sky features inward and forward without a
// reverse/reset at the end. All channels share the pausable entrance progress.
const smooth = (lo: number, hi: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
export function blackHoleFormation(progress: number) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 1;
  const growth = smooth(0.08, 0.98, p);
  return {
    // Shadow size, disk extent and entrance turn share one growth curve.
    // Gas becomes readable early enough to show rotation WHILE it expands.
    mass: growth,
    disk: smooth(0.08, 0.68, p),
    skyTurn: 0.65 * (1 - growth),
    skySpread: 0.24 * (1 - growth),
    turn: 1.8 * (1 - growth),
  };
}
