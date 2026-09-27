import test from "node:test";
import assert from "node:assert/strict";
import { motionValue } from "motion";
import {
  advanceReferenceTurn,
  createTurnInput,
} from "../src/reference-rotation.mjs";

const modelFor = () => ({
  yaw: motionValue(0),
  progress: motionValue(0),
  turnInput: createTurnInput(),
});
test("a short drag is visible within 100 ms and reverses without a long delayed turn", () => {
  for (const fps of [30, 60, 144]) {
    const model = modelFor();
    model.turnInput.pending = 1;
    for (let frame = 0; frame < Math.ceil(fps * 0.1); frame++)
      advanceReferenceTurn(model, 1 / fps);
    assert.ok(
      model.yaw.get() > 0.7,
      "at least 70% of a short stroke should be visible within 100 ms",
    );
    const atReverse = model.yaw.get();
    model.turnInput.pending = -1;
    for (let frame = 0; frame < Math.ceil(fps * 0.1); frame++)
      advanceReferenceTurn(model, 1 / fps);
    assert.ok(
      model.yaw.get() < atReverse - 0.45,
      "a reversed stroke must already be turning back",
    );
    model.yaw.destroy();
    model.progress.destroy();
  }
});
test("reference rotation carries a drag impulse into a smooth release at different frame rates", () => {
  for (const fps of [30, 60, 144]) {
    const model = modelFor();
    for (let frame = 0; frame < fps; frame++) {
      model.turnInput.pending += 1 / fps;
      advanceReferenceTurn(model, 1 / fps);
    }
    const released = model.yaw.get();
    assert.ok(released > 0.65 && released < 1);
    for (let frame = 0; frame < fps * 3; frame++)
      advanceReferenceTurn(model, 1 / fps);
    assert.ok(model.yaw.get() > released);
    assert.ok(
      Math.abs(model.yaw.get() - 1) < 0.001,
      "frame rate must not change total drag travel",
    );
    model.yaw.destroy();
    model.progress.destroy();
  }
});
test("turn inertia cannot leak into later scenes or a paused scene", () => {
  for (const state of [
    { progress: 1 },
    { progress: 2 },
    { progress: 3 },
    { paused: true },
    { reduced: true },
  ]) {
    const model = modelFor();
    model.turnInput.pending = 1;
    model.turnInput.velocity = 0.2;
    if (state.progress) model.progress.set(state.progress);
    else Object.assign(model, state);
    advanceReferenceTurn(model, 1 / 60);
    assert.equal(model.yaw.get(), 0);
    assert.equal(model.turnInput.pending, 0);
    assert.equal(model.turnInput.velocity, 0);
    model.yaw.destroy();
    model.progress.destroy();
  }
});
