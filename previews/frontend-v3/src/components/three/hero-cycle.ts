/** Seconds a settled shape is shown before autoplay advances. */
export const HOLD = 6.4;
/** Seconds one particle spends between leaving a shape and landing on the next. */
export const FLIGHT_DURATION = 1.6;
/** Departures follow a spatial sweep across the shape... */
export const RELEASE_ORDER_SPAN = 0.8;
/** ...loosened by a little per-particle jitter so the front never looks mechanical. */
export const RELEASE_JITTER = 0.25;
/** Sums of decimal constants are rounded so frame arithmetic stays exact. */
const seconds = (value: number) => Math.round(value * 1e6) / 1e6;
/** The latest possible departure. */
export const RELEASE_SPAN = seconds(RELEASE_ORDER_SPAN + RELEASE_JITTER);
/** Time after the last landing for the springs to settle before the shape counts as "held". */
export const SETTLE_DURATION = 0.35;
/** Every particle has landed and settled once the whole morph window has elapsed. */
export const MORPH_DURATION = seconds(RELEASE_SPAN + FLIGHT_DURATION + SETTLE_DURATION);
// Shader IDs stay fixed: lettering(0), database(1), network(2), lattice(3).
// Monogram/TDX phase removed from playback.
export const PLAYBACK_ORDER = [2, 1, 3] as const;
export const REDUCED_PHASE = 1;
const TIME_EPSILON = 1e-9;
/** Frame deltas are clamped so a stalled tab can never skip through several shapes. */
const MAX_STEP = 0.05;

/** First activation: a wide dust cloud implodes into the first shape. */
export const ENTRANCE_ORDER_SPAN = 0.7;
export const ENTRANCE_JITTER = 0.35;
export const ENTRANCE_FLIGHT = 1.45;
export const ENTRANCE_DURATION = seconds(ENTRANCE_ORDER_SPAN + ENTRANCE_JITTER + ENTRANCE_FLIGHT);

export type HeroCycle = {
  index: number;
  from: number;
  to: number;
  elapsed: number;
  hold: number;
  time: number;
  pending: boolean;
  reduced: boolean;
};

export function createHeroCycle(reduced = false): HeroCycle {
  const phase = reduced ? REDUCED_PHASE : PLAYBACK_ORDER[0];
  return {
    index: PLAYBACK_ORDER.indexOf(phase),
    from: phase,
    to: phase,
    elapsed: MORPH_DURATION,
    hold: 0,
    time: 0,
    pending: false,
    reduced,
  };
}

/** A burst of clicks reserves only one transition after the current morph. */
export function requestNext(cycle: HeroCycle) {
  cycle.pending = true;
}

function advance(cycle: HeroCycle, instant: boolean) {
  cycle.index = (cycle.index + 1) % PLAYBACK_ORDER.length;
  const next = PLAYBACK_ORDER[cycle.index];
  cycle.from = instant ? next : cycle.to;
  cycle.to = next;
  cycle.elapsed = instant ? MORPH_DURATION : 0;
  cycle.hold = 0;
  cycle.pending = false;
  return next;
}

function clampDelta(delta: number) {
  return Number.isFinite(delta) ? Math.max(0, Math.min(delta, MAX_STEP)) : 0;
}

/** Advance a deterministic cycle; the scene supplies zero delta on resume. */
export function stepHeroCycle(
  cycle: HeroCycle,
  delta: number,
  { active, reduced }: { active: boolean; reduced: boolean },
): number | null {
  // Offscreen/background rendering must not consume time or queued interaction.
  if (!active) return null;

  if (reduced !== cycle.reduced) {
    cycle.reduced = reduced;
    if (reduced) {
      // A preference change supersedes any queued animated transition.
      cycle.index = PLAYBACK_ORDER.indexOf(REDUCED_PHASE);
      cycle.from = REDUCED_PHASE;
      cycle.to = REDUCED_PHASE;
      cycle.elapsed = MORPH_DURATION;
      cycle.hold = 0;
      cycle.pending = false;
      return REDUCED_PHASE;
    }
    // Resume autoplay with a full hold on the manually selected static phase.
    cycle.from = cycle.to;
    cycle.elapsed = MORPH_DURATION;
    cycle.hold = 0;
  }

  if (reduced) {
    return cycle.pending ? advance(cycle, true) : null;
  }

  const dt = clampDelta(delta);
  cycle.time += dt;

  if (cycle.elapsed < MORPH_DURATION) {
    cycle.elapsed = Math.min(MORPH_DURATION, cycle.elapsed + dt);
    if (cycle.elapsed < MORPH_DURATION - TIME_EPSILON) return null;
    cycle.elapsed = MORPH_DURATION;
    // Only use the completed target as a new origin, never an in-flight one.
    return cycle.pending ? advance(cycle, false) : null;
  }

  // Manual intent wins when a click and the automatic deadline share a frame.
  if (cycle.pending) return advance(cycle, false);

  cycle.hold += dt;
  if (cycle.hold >= HOLD - TIME_EPSILON) {
    return advance(cycle, false);
  }
  return null;
}

/** 0..1 progress of the current morph (1 once every particle has landed). */
export function morphProgress(cycle: HeroCycle) {
  return Math.max(0, Math.min(1, cycle.elapsed / MORPH_DURATION));
}

/** 0..1 progress towards the next automatic advance (0 while morphing). */
export function holdProgress(cycle: HeroCycle) {
  return cycle.elapsed < MORPH_DURATION ? 0 : Math.max(0, Math.min(1, cycle.hold / HOLD));
}

export type HeroEntrance = { elapsed: number; done: boolean };

/** Pass `skip` for reduced motion or when no entrance should play. */
export function createHeroEntrance(skip = false): HeroEntrance {
  return { elapsed: skip ? ENTRANCE_DURATION : 0, done: skip };
}

/**
 * The entrance only runs while the hero is active, not held by the site intro,
 * and motion is allowed. Reduced motion finishes it at once. Returns true on
 * the step that completes it; the autoplay cycle must not start before that.
 */
export function stepHeroEntrance(
  entrance: HeroEntrance,
  delta: number,
  { active, reduced, hold }: { active: boolean; reduced: boolean; hold: boolean },
): boolean {
  if (entrance.done) return false;
  if (reduced) {
    entrance.elapsed = ENTRANCE_DURATION;
    entrance.done = true;
    return true;
  }
  if (!active || hold) return false;
  entrance.elapsed = Math.min(ENTRANCE_DURATION, entrance.elapsed + clampDelta(delta));
  if (entrance.elapsed < ENTRANCE_DURATION - TIME_EPSILON) return false;
  entrance.elapsed = ENTRANCE_DURATION;
  entrance.done = true;
  return true;
}
