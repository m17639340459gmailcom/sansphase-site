/** One silver-blue art direction; these are display tints, not stellar spectra. */
export const STELLAR_PALETTE = {
  line: "166,195,222",
  lineHalo: "114,153,193",
  active: "219,232,247",
  coolStar: "204,224,244",
  neutralStar: "230,235,241",
  warmStar: "240,237,227",
} as const;

/** Retain the catalog's existing broad B-V classes with restrained saturation. */
export function catalogStarTint(colorIndex: number): string {
  if (!Number.isFinite(colorIndex)) return STELLAR_PALETTE.neutralStar;
  return colorIndex > .55 ? STELLAR_PALETTE.warmStar
    : colorIndex < .05 ? STELLAR_PALETTE.coolStar : STELLAR_PALETTE.neutralStar;
}
