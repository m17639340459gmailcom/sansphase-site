/** Fixed framing shared by the illustrated plate and celestial chart.
 * Motion belongs inside the cloud material; the sky must not sway like a card.
 */
const FRAME_SCALE = 1.14;

export function projectAtlasPoint(x: number, y: number, width: number, height: number) {
  return { x: (x - width / 2) * FRAME_SCALE + width / 2,
    y: (y - height / 2) * FRAME_SCALE + height / 2 };
}

export function unprojectAtlasPoint(x: number, y: number, width: number, height: number) {
  return { x: (x - width / 2) / FRAME_SCALE + width / 2,
    y: (y - height / 2) / FRAME_SCALE + height / 2 };
}

/** Normalized source rectangle, shared by GPU sampling and the 2D fallback. */
export function atlasSourceCrop(width: number, height: number, sourceWidth: number, sourceHeight: number) {
  const cover = Math.max(width / sourceWidth, height / sourceHeight);
  const sw = width / cover / sourceWidth, sh = height / cover / sourceHeight;
  return {
    x: .5 - sw * .5 / FRAME_SCALE,
    y: .5 - sh * .5 / FRAME_SCALE,
    width: sw / FRAME_SCALE,
    height: sh / FRAME_SCALE,
  };
}
