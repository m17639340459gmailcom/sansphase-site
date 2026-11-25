/** Mutable pointer input avoids React renders on every mouse movement. */
export type HeroInteraction = {
  /** Pointer position in canvas NDC (-1..1, y up). */
  x: number;
  y: number;
  /** A fine pointer (mouse/pen) hovers the surface; touch never sets this. */
  inside: boolean;
  /** Mouse drag in progress (primary button held on the surface). */
  dragging?: boolean;
  /** Drag distance not yet consumed by the scene, in canvas NDC units. The scene resets them to 0. */
  dragX?: number;
  dragY?: number;
  /** Origin of the latest advance request in canvas NDC; keyboard requests use 0,0 (the centre). */
  clickX?: number;
  clickY?: number;
};

export type HeroSimulationMode = "gpgpu" | "shader" | "static";

/** Written by the scene every rendered frame; read it from rAF, never from React state. */
export type HeroTelemetry = {
  /** Shader/phase ID of the current (or incoming) shape: 1 database, 2 network, 3 lattice. */
  phase: number;
  /** 0..1 progress of the current morph; 1 when settled. */
  morphProgress: number;
  /** 0..1 progress towards the next automatic advance; 0 while morphing. */
  holdProgress: number;
  particleCount: number;
  /** Smoothed frames per second while rendering; 0 when paused. */
  fps: number;
  /** Pointer in canvas NDC; `inside` mirrors HeroInteraction.inside. */
  pointer: { x: number; y: number; inside: boolean };
  /** gpgpu: GPU physics; shader: stateless fallback; static: reduced motion. */
  mode: HeroSimulationMode;
  /** 0..1 progress of the first-activation implosion. */
  entrance: number;
  /** 0..1 scroll dispersal. */
  scatter: number;
  /** True while frames are being rendered continuously. */
  running: boolean;
};

export function createHeroTelemetry(): HeroTelemetry {
  return {
    phase: 2, morphProgress: 1, holdProgress: 0, particleCount: 0, fps: 0,
    pointer: { x: 0, y: 0, inside: false }, mode: "static", entrance: 0, scatter: 0, running: false,
  };
}

/** Drag-to-orbit state: offsets are added to the automatic rotation. */
export type HeroOrbit = { yaw: number; pitch: number; yawVelocity: number; pitchVelocity: number };

/** Radians per canvas NDC unit of drag. */
export const ORBIT_SENSITIVITY = 0.85;
/** Soft limits: the shapes are baked for a front view, so large turns would expose culled faces. */
export const ORBIT_YAW_LIMIT = 0.5;
export const ORBIT_PITCH_LIMIT = 0.28;
/** Release: inertia first, then a near-critically damped return to the automatic pose. */
const ORBIT_RETURN_STIFFNESS = 11;
const ORBIT_RETURN_DAMPING = 2 * 0.82 * Math.sqrt(ORBIT_RETURN_STIFFNESS);

export function createHeroOrbit(): HeroOrbit {
  return { yaw: 0, pitch: 0, yawVelocity: 0, pitchVelocity: 0 };
}

/** Moving past the limit gets progressively harder, like a rubber band. */
function resist(value: number, delta: number, limit: number) {
  if (delta === 0 || Math.sign(delta) !== Math.sign(value) || Math.abs(value) < limit) return delta;
  const excess = (Math.abs(value) - limit) / (limit * 0.6);
  return delta * Math.max(0, 1 - excess) ** 2;
}

/**
 * Advance the orbit by one frame. While dragging, offsets follow the pointer;
 * after release the measured velocity carries on and a damped spring returns
 * the model to its automatic pose.
 */
export function stepHeroOrbit(
  orbit: HeroOrbit,
  delta: number,
  { dragging, dx, dy }: { dragging: boolean; dx: number; dy: number },
) {
  const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.05)) : 0;
  if (dt === 0) return orbit;
  if (dragging) {
    const yawStep = resist(orbit.yaw, dx * ORBIT_SENSITIVITY, ORBIT_YAW_LIMIT);
    // Dragging up tips the front of the model up.
    const pitchStep = resist(orbit.pitch, -dy * ORBIT_SENSITIVITY, ORBIT_PITCH_LIMIT);
    orbit.yaw += yawStep;
    orbit.pitch += pitchStep;
    // Smoothed velocity estimate used as release inertia.
    const blend = Math.min(1, dt * 18);
    orbit.yawVelocity += (yawStep / dt - orbit.yawVelocity) * blend;
    orbit.pitchVelocity += (pitchStep / dt - orbit.pitchVelocity) * blend;
    return orbit;
  }
  orbit.yawVelocity += (-ORBIT_RETURN_STIFFNESS * orbit.yaw - ORBIT_RETURN_DAMPING * orbit.yawVelocity) * dt;
  orbit.pitchVelocity += (-ORBIT_RETURN_STIFFNESS * orbit.pitch - ORBIT_RETURN_DAMPING * orbit.pitchVelocity) * dt;
  orbit.yaw += orbit.yawVelocity * dt;
  orbit.pitch += orbit.pitchVelocity * dt;
  // Past the hard limits the spring alone is too slow; clamp and kill outward velocity.
  const yawMax = ORBIT_YAW_LIMIT * 1.6;
  const pitchMax = ORBIT_PITCH_LIMIT * 1.6;
  if (Math.abs(orbit.yaw) > yawMax) { orbit.yaw = Math.sign(orbit.yaw) * yawMax; orbit.yawVelocity = 0; }
  if (Math.abs(orbit.pitch) > pitchMax) { orbit.pitch = Math.sign(orbit.pitch) * pitchMax; orbit.pitchVelocity = 0; }
  if (Math.abs(orbit.yaw) < 1e-5 && Math.abs(orbit.yawVelocity) < 1e-4) { orbit.yaw = 0; orbit.yawVelocity = 0; }
  if (Math.abs(orbit.pitch) < 1e-5 && Math.abs(orbit.pitchVelocity) < 1e-4) { orbit.pitch = 0; orbit.pitchVelocity = 0; }
  return orbit;
}

/**
 * Scroll dispersal from the canvas rectangle: 0 while the model centre sits in
 * the upper-middle of the viewport or below, 1 once it has left the top.
 */
export function scrollScatter(rectTop: number, rectHeight: number, viewportHeight: number) {
  if (!(viewportHeight > 0) || !(rectHeight > 0) || !Number.isFinite(rectTop)) return 0;
  const center = rectTop + rectHeight / 2;
  const start = viewportHeight * 0.4;
  const span = viewportHeight * 0.4 + rectHeight * 0.35;
  return Math.max(0, Math.min(1, (start - center) / span));
}
