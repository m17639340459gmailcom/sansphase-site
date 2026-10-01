/** Opening-only cinematic counter-parallax, not physical sky rotation.
 * The camera samples at -observerYaw. Adding 2.5 times its actual yaw delta
 * makes visible sky features move oppositely with 1.5 times the displacement.
 * Accumulate the short arc so a 2π wrap never creates a background jump.
 */
export function advanceSkyParallax(offset: number, current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return offset;
  const delta = Math.atan2(Math.sin(current - previous), Math.cos(current - previous));
  return offset + delta * 2.5;
}
