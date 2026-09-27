import { MathUtils } from "three";
const finite = (value, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

// Later photographic layers reveal over the previous one, without fading both
// to black. An opaque next layer can cull the earlier photograph entirely.
export const skyLayerOpacity = (progress, chapter) =>
  MathUtils.smootherstep(finite(progress), chapter - 0.92, chapter - 0.05);

// SpaceBackdrop's photograph planes retain a cover margin throughout travel.
// Only a loaded, visible, completely opaque plane can hide the underlay.
export const photographsCoverPanorama = (photographs) =>
  photographs.some((mesh) =>
    mesh?.visible && mesh.material?.map && mesh.material.opacity >= 1,
  );

// Screen-height displacement: the next photograph arrives from below while
// the outgoing one passes upwards. Its existing Drei Image supplies rendering.
export const skyLayerOffset = (progress, chapter) =>
  0.16 * MathUtils.clamp(finite(progress) - chapter, -1, 1);

// One camera descends while the glass installation follows and turns.
// Our 0..3 content progress maps to the reference's continuous 0..1 journey.
export function cosmosFraming(aspect = 1.7, progress = 0) {
  const portrait = MathUtils.clamp(finite(aspect, 1.7), 0.3, 4) < 0.85;
  const phase = MathUtils.clamp(finite(progress), 0, 3);
  const journey = phase / 3;
  const chapter = Math.floor(phase);
  const turn = chapter + MathUtils.smootherstep(phase - chapter, 0, 1);
  const distance = portrait ? 12.8 : 8.8;
  return {
    x: 0,
    y: 0.15 - journey * 11.75,
    z: distance + journey * 3.75,
    targetX: 0,
    targetY: -0.15 - journey * 11.75,
    targetZ: journey * 3.75,
    yaw: turn === 0 ? 0 : -Math.PI * 2 * turn,
    distance,
    // The object leads the descending camera, then the camera catches up.
    // Zero slope at each stop keeps continuous/reverse scroll free of a seam.
    fall: (portrait ? 0.65 : 0.95) * Math.sin(Math.PI * (phase - chapter)) ** 2,
    elevation: -journey * 11.75,
    fov: 42,
    phase,
    journey,
    portrait,
  };
}
