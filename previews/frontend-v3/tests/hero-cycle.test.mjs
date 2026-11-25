import assert from "node:assert/strict";
import test from "node:test";
import {
  ENTRANCE_DURATION,
  ENTRANCE_FLIGHT,
  ENTRANCE_JITTER,
  ENTRANCE_ORDER_SPAN,
  FLIGHT_DURATION,
  HOLD,
  MORPH_DURATION,
  PLAYBACK_ORDER,
  REDUCED_PHASE,
  RELEASE_SPAN,
  SETTLE_DURATION,
  createHeroCycle,
  createHeroEntrance,
  holdProgress,
  morphProgress,
  requestNext,
  stepHeroCycle,
  stepHeroEntrance,
} from "../src/components/three/hero-cycle.ts";

const FRAME = 0.05;
const ACTIVE = { active: true, reduced: false };
const INACTIVE = { active: false, reduced: false };
const REDUCED = { active: true, reduced: true };
// Shader IDs: 0 monogram (reserved, removed from playback), 1 database, 2 network, 3 lattice.
const OWNER_ORDER = [2, 1, 3];

function runFrames(cycle, count, options = ACTIVE) {
  const transitions = [];
  for (let frame = 0; frame < count; frame += 1) {
    const next = stepHeroCycle(cycle, FRAME, options);
    if (next !== null) transitions.push(next);
  }
  return transitions;
}

function nextTransition(cycle) {
  const maxFrames = Math.ceil((HOLD + MORPH_DURATION) / FRAME) + 2;
  for (let frame = 1; frame <= maxFrames; frame += 1) {
    const next = stepHeroCycle(cycle, FRAME, ACTIVE);
    if (next !== null) return { next, frames: frame };
  }
  assert.fail("The visible particle cycle must continue to its next shape");
}

test("choreography constants compose the morph window and keep the monogram out of playback", () => {
  assert.deepEqual(PLAYBACK_ORDER, OWNER_ORDER);
  assert.ok(!PLAYBACK_ORDER.includes(0), "the owner removed the TDX monogram (ID 0) from playback");
  assert.equal(REDUCED_PHASE, 1, "reduced motion shows the static database");
  assert.ok(PLAYBACK_ORDER.includes(REDUCED_PHASE));
  assert.ok(Math.abs(MORPH_DURATION - (RELEASE_SPAN + FLIGHT_DURATION + SETTLE_DURATION)) < 1e-12,
    "the last particle departs, flies and settles inside one morph window");
  assert.ok(HOLD > MORPH_DURATION, "shapes are held longer than they take to form");
  assert.ok(Math.abs(ENTRANCE_DURATION - (ENTRANCE_ORDER_SPAN + ENTRANCE_JITTER + ENTRANCE_FLIGHT)) < 1e-12);
  for (const value of [HOLD, MORPH_DURATION, FLIGHT_DURATION, SETTLE_DURATION, ENTRANCE_DURATION]) {
    assert.ok(Number.isFinite(value) && value > 0);
  }
});

test("autoplay starts at the network and repeats the owner's order for eight rounds", () => {
  const cycle = createHeroCycle();
  assert.equal(cycle.to, 2);
  assert.equal(cycle.from, 2);

  const seen = [cycle.to];
  for (let transition = 0; transition < 24; transition += 1) {
    const previous = cycle.to;
    const { next } = nextTransition(cycle);
    seen.push(next);
    assert.equal(cycle.from, previous);
    assert.equal(cycle.to, next);
    assert.equal(cycle.elapsed, 0);
  }

  assert.deepEqual(seen, Array.from({ length: 25 }, (_, index) => OWNER_ORDER[index % 3]));
  assert.ok(!seen.includes(0), "the monogram never plays");
});

test("every automatic transition keeps the same hold and morph cadence without user input", () => {
  const cycle = createHeroCycle();
  const first = nextTransition(cycle);
  assert.ok(Math.abs(first.frames * FRAME - HOLD) <= FRAME);

  for (let transition = 0; transition < 12; transition += 1) {
    const startedAt = cycle.time;
    const { frames } = nextTransition(cycle);
    assert.ok(Math.abs(frames * FRAME - (HOLD + MORPH_DURATION)) <= FRAME);
    assert.ok(Math.abs(cycle.time - startedAt - (HOLD + MORPH_DURATION)) <= FRAME);
  }
});

test("each morph finishes before the next shape begins its full hold", () => {
  const cycle = createHeroCycle();
  assert.equal(nextTransition(cycle).next, 1);

  assert.deepEqual(runFrames(cycle, Math.ceil(MORPH_DURATION / FRAME)), []);
  assert.equal(cycle.from, 2);
  assert.equal(cycle.to, 1);
  assert.equal(cycle.elapsed, MORPH_DURATION);
  assert.equal(cycle.hold, 0);
  assert.deepEqual(runFrames(cycle, Math.round(HOLD / FRAME) - 1), []);
  assert.equal(cycle.to, 1);
  assert.equal(stepHeroCycle(cycle, FRAME, ACTIVE), 3);
  assert.equal(cycle.from, 1);
  assert.equal(cycle.elapsed, 0);
});

test("offscreen or background frames freeze hold and morph, then autoplay resumes without input", () => {
  const cycle = createHeroCycle();
  runFrames(cycle, 20);
  const before = structuredClone(cycle);
  assert.deepEqual(runFrames(cycle, 400, INACTIVE), []);
  assert.deepEqual(cycle, before);

  assert.equal(stepHeroCycle(cycle, 0, ACTIVE), null);
  assert.deepEqual(cycle, before);
  const resumedHold = nextTransition(cycle);
  assert.equal(resumedHold.next, 1);
  assert.ok(Math.abs(resumedHold.frames * FRAME - (HOLD - before.hold)) <= FRAME);

  runFrames(cycle, 12);
  const midMorph = structuredClone(cycle);
  assert.deepEqual(runFrames(cycle, 400, INACTIVE), []);
  assert.deepEqual(cycle, midMorph);
  assert.equal(stepHeroCycle(cycle, 0, ACTIVE), null);
  assert.deepEqual(cycle, midMorph);

  const resumedMorph = nextTransition(cycle);
  assert.equal(resumedMorph.next, 3);
  assert.equal(cycle.from, 1);
  assert.ok(Math.abs(resumedMorph.frames * FRAME - (MORPH_DURATION - midMorph.elapsed + HOLD)) <= FRAME);
});

test("reduced motion stays static indefinitely", () => {
  const cycle = createHeroCycle(true);
  const before = structuredClone(cycle);
  assert.equal(cycle.to, REDUCED_PHASE);
  assert.equal(cycle.from, REDUCED_PHASE);
  assert.deepEqual(runFrames(cycle, 2000, REDUCED), []);
  assert.deepEqual(cycle, before);
});

test("turning reduced motion on settles immediately and turning it off restores autoplay", () => {
  const cycle = createHeroCycle();
  nextTransition(cycle);
  runFrames(cycle, 10);
  assert.ok(cycle.elapsed < MORPH_DURATION, "the preference arrives mid-morph");
  assert.equal(stepHeroCycle(cycle, FRAME, REDUCED), REDUCED_PHASE);
  assert.equal(cycle.from, REDUCED_PHASE);
  assert.equal(cycle.to, REDUCED_PHASE);
  assert.equal(cycle.elapsed, MORPH_DURATION);
  const staticState = structuredClone(cycle);
  assert.deepEqual(runFrames(cycle, 2000, REDUCED), []);
  assert.deepEqual(cycle, staticState);

  assert.equal(stepHeroCycle(cycle, 0, ACTIVE), null);
  assert.equal(cycle.from, REDUCED_PHASE);
  assert.equal(cycle.to, REDUCED_PHASE);
  const resumed = nextTransition(cycle);
  assert.equal(resumed.next, PLAYBACK_ORDER[(PLAYBACK_ORDER.indexOf(REDUCED_PHASE) + 1) % PLAYBACK_ORDER.length]);
  assert.ok(Math.abs(resumed.frames * FRAME - HOLD) <= FRAME);
});

test("invalid or negative delta cannot corrupt time, hold, or an in-progress morph", () => {
  const invalid = [Number.NaN, Infinity, -Infinity, -1, -0.05, 0];
  for (const midMorph of [false, true]) {
    const cycle = createHeroCycle();
    if (midMorph) nextTransition(cycle);
    runFrames(cycle, 10);
    const before = structuredClone(cycle);
    for (const delta of invalid) {
      assert.equal(stepHeroCycle(cycle, delta, ACTIVE), null);
      assert.deepEqual(cycle, before);
    }
  }
});

test("large frame gaps are bounded instead of skipping through multiple shapes", () => {
  const cycle = createHeroCycle();
  assert.equal(stepHeroCycle(cycle, 3600, ACTIVE), null);
  assert.ok(cycle.time > 0 && cycle.time <= FRAME);
  assert.ok(cycle.hold > 0 && cycle.hold <= FRAME);
  assert.equal(cycle.to, PLAYBACK_ORDER[0]);
  assert.equal(nextTransition(cycle).next, 1);
  assert.equal(stepHeroCycle(cycle, 3600, ACTIVE), null);
  assert.ok(cycle.elapsed > 0 && cycle.elapsed <= FRAME);
  assert.equal(cycle.to, 1);
});

test("a click advances during a hold and autoplay continues with a full morph and hold", () => {
  const cycle = createHeroCycle();
  runFrames(cycle, 20);
  requestNext(cycle);
  assert.equal(stepHeroCycle(cycle, FRAME, ACTIVE), 1);
  assert.equal(cycle.from, 2);
  assert.equal(cycle.elapsed, 0);
  assert.equal(cycle.hold, 0);
  assert.equal(cycle.pending, false);

  const resumed = nextTransition(cycle);
  assert.equal(resumed.next, 3);
  assert.ok(Math.abs(resumed.frames * FRAME - (MORPH_DURATION + HOLD)) <= FRAME);
  assert.equal(nextTransition(cycle).next, 2);
});

test("clicks during a morph merge into one queued transition without interrupting its origin", () => {
  const cycle = createHeroCycle();
  assert.equal(nextTransition(cycle).next, 1);
  runFrames(cycle, 12);

  for (let click = 0; click < 5; click += 1) requestNext(cycle);
  const remainingFrames = Math.round((MORPH_DURATION - cycle.elapsed) / FRAME);
  assert.deepEqual(runFrames(cycle, remainingFrames - 1), []);
  assert.equal(cycle.from, 2);
  assert.equal(cycle.to, 1);
  assert.equal(cycle.pending, true);

  assert.equal(stepHeroCycle(cycle, FRAME, ACTIVE), 3);
  assert.equal(cycle.from, 1);
  assert.equal(cycle.elapsed, 0);
  assert.equal(cycle.pending, false);
  const resumed = nextTransition(cycle);
  assert.equal(resumed.next, 2);
  assert.ok(Math.abs(resumed.frames * FRAME - (MORPH_DURATION + HOLD)) <= FRAME);
});

test("a click on the automatic deadline advances once and starts a fresh cadence", () => {
  const cycle = createHeroCycle();
  runFrames(cycle, Math.round(HOLD / FRAME) - 1);
  requestNext(cycle);
  assert.equal(stepHeroCycle(cycle, FRAME, ACTIVE), 1);
  assert.equal(cycle.pending, false);
  assert.equal(stepHeroCycle(cycle, FRAME, ACTIVE), null);
  assert.equal(cycle.to, 1);
  const resumed = nextTransition(cycle);
  assert.equal(resumed.next, 3);
  assert.ok(Math.abs((resumed.frames + 1) * FRAME - (MORPH_DURATION + HOLD)) <= FRAME);
});

test("offscreen frames preserve a queued click until rendering resumes", () => {
  const cycle = createHeroCycle();
  requestNext(cycle);
  const before = structuredClone(cycle);
  assert.deepEqual(runFrames(cycle, 400, INACTIVE), []);
  assert.deepEqual(cycle, before);
  assert.equal(stepHeroCycle(cycle, 0, ACTIVE), 1);
  assert.equal(cycle.pending, false);
});

test("reduced motion allows immediate manual changes and restores autoplay from the selected shape", () => {
  const cycle = createHeroCycle(true);
  for (const expected of [3, 2]) {
    requestNext(cycle);
    assert.equal(stepHeroCycle(cycle, FRAME, REDUCED), expected);
    assert.equal(cycle.from, expected);
    assert.equal(cycle.to, expected);
    assert.equal(cycle.elapsed, MORPH_DURATION);
    const selected = structuredClone(cycle);
    assert.deepEqual(runFrames(cycle, 2000, REDUCED), []);
    assert.deepEqual(cycle, selected);
  }

  assert.equal(stepHeroCycle(cycle, 0, ACTIVE), null);
  const resumed = nextTransition(cycle);
  assert.equal(resumed.next, 1);
  assert.ok(Math.abs(resumed.frames * FRAME - HOLD) <= FRAME);
});

test("20,000 mixed frames never leave the owner's shapes or corrupt the timeline", () => {
  const cycle = createHeroCycle();
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let lastTime = 0;
  for (let frame = 0; frame < 20000; frame += 1) {
    const roll = random();
    if (roll < 0.01) requestNext(cycle);
    const options = roll < 0.05 ? INACTIVE : roll < 0.06 ? REDUCED : ACTIVE;
    const delta = roll > 0.995 ? 30 : random() * 0.06;
    const next = stepHeroCycle(cycle, delta, options);
    if (next !== null) assert.ok(OWNER_ORDER.includes(next));
    assert.ok(OWNER_ORDER.includes(cycle.to) && OWNER_ORDER.includes(cycle.from));
    assert.ok(cycle.elapsed >= 0 && cycle.elapsed <= MORPH_DURATION);
    assert.ok(cycle.hold >= 0 && cycle.hold < HOLD + 0.051);
    assert.ok(cycle.time >= lastTime && cycle.time - lastTime <= 0.05 + 1e-12);
    lastTime = cycle.time;
  }
});

test("morph and hold progress report 0..1 for a HUD", () => {
  const cycle = createHeroCycle();
  assert.equal(morphProgress(cycle), 1);
  assert.equal(holdProgress(cycle), 0);
  runFrames(cycle, Math.round(HOLD / 2 / FRAME));
  assert.ok(Math.abs(holdProgress(cycle) - 0.5) < 0.02);
  nextTransition(cycle);
  assert.equal(morphProgress(cycle), 0);
  assert.equal(holdProgress(cycle), 0, "no hold progress while morphing");
  runFrames(cycle, Math.round(MORPH_DURATION / 2 / FRAME));
  assert.ok(Math.abs(morphProgress(cycle) - 0.5) < 0.02);
  for (let frame = 0; frame < 2000; frame += 1) {
    stepHeroCycle(cycle, FRAME, ACTIVE);
    for (const value of [morphProgress(cycle), holdProgress(cycle)]) assert.ok(value >= 0 && value <= 1);
  }
});

test("the entrance waits for activation and the intro hold, then completes exactly once", () => {
  const entrance = createHeroEntrance();
  assert.deepEqual(entrance, { elapsed: 0, done: false });
  for (let frame = 0; frame < 200; frame += 1) {
    assert.equal(stepHeroEntrance(entrance, FRAME, { active: false, reduced: false, hold: false }), false);
    assert.equal(stepHeroEntrance(entrance, FRAME, { active: true, reduced: false, hold: true }), false);
  }
  assert.deepEqual(entrance, { elapsed: 0, done: false }, "offscreen or held entrances consume no time");

  const frames = Math.round(ENTRANCE_DURATION / FRAME);
  let completions = 0;
  for (let frame = 0; frame < frames + 50; frame += 1) {
    if (stepHeroEntrance(entrance, FRAME, { active: true, reduced: false, hold: false })) completions += 1;
  }
  assert.equal(completions, 1);
  assert.deepEqual(entrance, { elapsed: ENTRANCE_DURATION, done: true });
});

test("the entrance clamps frame gaps, rejects invalid deltas and is skipped by reduced motion", () => {
  const entrance = createHeroEntrance();
  for (const delta of [Number.NaN, -1, -Infinity, 0]) {
    stepHeroEntrance(entrance, delta, { active: true, reduced: false, hold: false });
    assert.equal(entrance.elapsed, 0);
  }
  stepHeroEntrance(entrance, 3600, { active: true, reduced: false, hold: false });
  assert.ok(entrance.elapsed > 0 && entrance.elapsed <= FRAME, "a stalled tab cannot skip the implosion");

  const reduced = createHeroEntrance();
  assert.equal(stepHeroEntrance(reduced, FRAME, { active: false, reduced: true, hold: true }), true);
  assert.equal(reduced.done, true);
  assert.deepEqual(createHeroEntrance(true), { elapsed: ENTRANCE_DURATION, done: true });
  assert.equal(stepHeroEntrance(reduced, FRAME, { active: true, reduced: false, hold: false }), false);
});
