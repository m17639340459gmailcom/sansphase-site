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

const ease = (x, low, high) => {
  const t = MathUtils.clamp((x - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
// Chapters 1-3 share one full-screen sky. Every change of chapter is a flight
// through the current photograph: it rushes past with speed lines while the
// next one opens from the centre like an iris, rimmed with a thin light, the
// same grammar as leaving the black hole. A pure function of the shared
// progress, so reverse scroll replays it exactly backwards.
// Indices a/b are photographs 0..2 (chapters 1..3).
export function skyChoreography(progress = 0) {
  const p = MathUtils.clamp(finite(progress), 0, 3);
  if (p < 1) {
    // Emerging from the hole: the first photograph settles from close up.
    return { a: 0, b: 0, zoomA: 1.3 - 0.3 * ease(p, 0.86, 1), zoomB: 1, streak: 0, iris: 0, rim: 0, shade: 0 };
  }
  const rest = (index) => ({ a: index, b: index, zoomA: 1, zoomB: 1, streak: 0, iris: 0, rim: 0, shade: 0 });
  if (p >= 3) return rest(2);
  const chapter = Math.floor(p),
    t = p - chapter;
  if (t <= 0) return rest(chapter - 1);
  const open = ease(t, 0.25, 0.95);
  return {
    a: chapter - 1,
    b: chapter,
    zoomA: 1 + 0.9 * ease(t, 0, 0.9) ** 1.4,
    zoomB: 0.9 + 0.1 * ease(t, 0.3, 1),
    streak: ease(t, 0.05, 0.55) * (1 - ease(t, 0.8, 1)),
    iris: open,
    rim: Math.sin(Math.PI * open) * 0.55,
    shade: 0.35 * ease(t, 0.2, 0.9),
  };
}
// Slow idle drift of a resting photograph (screen-height units and a zoom).
export function skyDrift(spec, time = 0) {
  const phase = finite(time) * spec.rate + spec.phase;
  return {
    x: 0.025 * Math.sin(phase),
    y: 0.018 * Math.sin(phase * 0.8),
    zoom: 1.035 + 0.022 * Math.sin(phase * 0.7),
  };
}
