import assert from "node:assert/strict";
import test from "node:test";
import {
  ORBIT_PITCH_LIMIT,
  ORBIT_SENSITIVITY,
  ORBIT_YAW_LIMIT,
  createHeroOrbit,
  createHeroTelemetry,
  scrollScatter,
  stepHeroOrbit,
} from "../src/components/three/hero-interaction.ts";

const FRAME = 1 / 60;

function drag(orbit, frames, dx, dy) {
  for (let i = 0; i < frames; i += 1) stepHeroOrbit(orbit, FRAME, { dragging: true, dx, dy });
}

function release(orbit, frames) {
  const trace = [];
  for (let i = 0; i < frames; i += 1) {
    stepHeroOrbit(orbit, FRAME, { dragging: false, dx: 0, dy: 0 });
    trace.push({ ...orbit });
  }
  return trace;
}

test("dragging turns the model with the pointer, then inertia and a damped return restore the pose", () => {
  const orbit = createHeroOrbit();
  drag(orbit, 10, 0.01, -0.005);
  assert.ok(Math.abs(orbit.yaw - 10 * 0.01 * ORBIT_SENSITIVITY) < 1e-9, "drag right turns the model right");
  assert.ok(Math.abs(orbit.pitch - 10 * 0.005 * ORBIT_SENSITIVITY) < 1e-9, "drag down tips it forward");
  assert.ok(orbit.yawVelocity > 0, "release velocity is measured while dragging");

  const trace = release(orbit, 240);
  const peak = Math.max(...trace.map((state) => state.yaw));
  assert.ok(peak > 10 * 0.01 * ORBIT_SENSITIVITY, "inertia carries the turn on after release");
  const minimum = Math.min(...trace.map((state) => state.yaw));
  assert.ok(minimum > -peak * 0.25, "the return overshoots only slightly");
  assert.deepEqual(trace.at(-1), { yaw: 0, pitch: 0, yawVelocity: 0, pitchVelocity: 0 }, "back to the automatic pose");
});

test("rubber-band limits stop long drags from exposing the pre-culled back faces", () => {
  const orbit = createHeroOrbit();
  drag(orbit, 600, 0.05, 0.05);
  assert.ok(orbit.yaw > ORBIT_YAW_LIMIT && orbit.yaw < ORBIT_YAW_LIMIT * 1.6 + 1e-9, `yaw ${orbit.yaw}`);
  assert.ok(orbit.pitch < -ORBIT_PITCH_LIMIT && orbit.pitch > -ORBIT_PITCH_LIMIT * 1.6 - 1e-9, `pitch ${orbit.pitch}`);
  // Dragging back towards the centre is never resisted.
  const yaw = orbit.yaw;
  drag(orbit, 1, -0.05, 0);
  assert.ok(Math.abs(yaw - orbit.yaw - 0.05 * ORBIT_SENSITIVITY) < 1e-9);
  const trace = release(orbit, 600);
  for (const state of trace) {
    assert.ok(Math.abs(state.yaw) <= ORBIT_YAW_LIMIT * 1.6 + 1e-9);
    assert.ok(Math.abs(state.pitch) <= ORBIT_PITCH_LIMIT * 1.6 + 1e-9);
  }
  assert.equal(trace.at(-1).yaw, 0);
});

test("paused, invalid and huge frame deltas cannot fling the model", () => {
  const orbit = createHeroOrbit();
  drag(orbit, 5, 0.02, 0);
  const before = { ...orbit };
  for (const delta of [0, -1, Number.NaN, -Infinity]) {
    stepHeroOrbit(orbit, delta, { dragging: false, dx: 0, dy: 0 });
    assert.deepEqual(orbit, before);
  }
  stepHeroOrbit(orbit, 3600, { dragging: false, dx: 0, dy: 0 });
  assert.ok(Number.isFinite(orbit.yaw) && Math.abs(orbit.yaw) <= ORBIT_YAW_LIMIT * 1.6);
});

test("scroll dispersal is 0 while the hero is in view, rises as it leaves, and saturates at 1", () => {
  const viewport = 900, height = 800;
  // Canvas rect top as the page scrolls: the hero starts near the top of the page.
  const at = (scroll) => scrollScatter(60 - scroll, height, viewport);
  assert.equal(at(0), 0);
  assert.equal(at(100), 0, "a little scrolling keeps the model intact");
  let previous = 0;
  for (let scroll = 0; scroll <= 1600; scroll += 10) {
    const value = at(scroll);
    assert.ok(value >= previous - 1e-12 && value >= 0 && value <= 1, "monotonic and clamped");
    previous = value;
  }
  assert.ok(at(500) > 0.2 && at(500) < 0.9, `mid scroll disperses partially (${at(500)})`);
  assert.equal(at(1600), 1);
  for (const [top, rect, view] of [[0, 0, 900], [0, 800, 0], [NaN, 800, 900], [0, -5, 900], [Infinity, 800, 900], [0, NaN, 900]]) {
    assert.equal(scrollScatter(top, rect, view), 0, "unmeasurable layouts never disperse the hero");
  }
  assert.equal(scrollScatter(-Infinity, 800, 900), 0);
});

test("telemetry starts in a well-formed idle state", () => {
  const telemetry = createHeroTelemetry();
  assert.deepEqual(Object.keys(telemetry).sort(), [
    "entrance", "fps", "holdProgress", "mode", "morphProgress", "particleCount", "phase", "pointer", "running", "scatter",
  ]);
  assert.equal(telemetry.running, false);
  assert.equal(telemetry.fps, 0);
  assert.deepEqual(telemetry.pointer, { x: 0, y: 0, inside: false });
  assert.notStrictEqual(createHeroTelemetry().pointer, telemetry.pointer, "each HUD gets its own object");
});
