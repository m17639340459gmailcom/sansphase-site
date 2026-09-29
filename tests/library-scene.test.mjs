import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import React from "react";
import { create } from "@react-three/test-renderer";
import { motionValue, frameSteps, frameData } from "motion";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Motion checks this type before selecting WAAPI. The numeric timeline used by
// our WebGL scene deliberately runs through its JS engine in this Node harness.
globalThis.HTMLElement ??= class HTMLElement {};
globalThis.SVGElement ??= class SVGElement {};
const flushMotion = () => {
  Object.assign(frameData, {
    timestamp: performance.now(),
    delta: 1000 / 60,
    isProcessing: true,
  });
  for (const step of Object.values(frameSteps)) step.process(frameData);
  frameData.isProcessing = false;
};
await build({
  entryPoints: ["src/library-cosmos-scene.jsx"],
  outfile: "outputs/verification/library-scene-test.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  loader: { ".glsl": "text", ".jpg": "file" },
  external: [
    "react",
    "react/*",
    "react-dom",
    "react-dom/*",
    "three",
    "three/*",
    "@react-three/*",
    "motion",
  ],
});
const { LibraryCosmosScene } =
  await import("../outputs/verification/library-scene-test.mjs");

const createModel = (extra = {}) => ({
  progress: motionValue(0),
  yaw: motionValue(0),
  pitch: motionValue(0),
  pointer: { x: 0, y: 0 },
  pointerActive: false,
  pointerAt: -10,
  gaze: { x: 0, y: 0 },
  time: 0,
  paused: false,
  interactionEpoch: 0,
  reduced: false,
  ...extra,
});

test("actual library scene: black hole opening, persistent scroll presentation, home-only input and disposal", async () => {
  const model = createModel();
  let state;
  const renderer = await create(
    React.createElement(LibraryCosmosScene, {
      model,
      lighting: false,
      onFrame: (p, s) => (state = s),
    }),
    { width: 1600, height: 900 },
  );
  await renderer.advanceFrames(2, 1 / 60);
  assert.equal(model.openingReady, true, "the opening reports readiness to the page");
  const scene = state.scene,
    find = (name) => {
      const obj = scene.getObjectByName(name);
      assert.ok(obj, `missing ${name}`);
      return obj;
    };
  for (const retired of ["r-signature", "opening-ring", "orbital-particle-emitter", "reference-cursor-tubes"])
    assert.equal(scene.getObjectByName(retired), undefined, `${retired} is detached from the live scene`);
  assert.equal(scene.getObjectByName("galaxy-0"), undefined, "works uses the photographic backdrop");
  const hole = find("event-horizon");
  const composite = hole.material,
    ray = composite.userData.ray;
  assert.equal(composite.userData.blackHole, true);
  assert.equal(hole.visible, true, "the opening shows the black hole");
  assert.equal(composite.uniforms.uEmerge.value, 0);
  assert.equal(composite.uniforms.uBlackout.value, 0);
  assert.equal(find("autonomous-stellar-field").visible, false,
    "unlensed stars never sit in front of the horizon");
  const initialPosition = state.camera.position.clone();
  const restingCamera = ray.uniforms.uCam.value.clone();
  assert.ok(Math.abs(restingCamera.length() - 14) < 0.001, "the opening orbits at 14 Rs");

  // The pointer only tilts the view a little; nothing is drawn at the cursor.
  assert.equal(composite.uniforms.uLens, undefined, "the opening draws no cursor ring");
  model.pointerActive = true;
  model.pointerAt = model.time;
  model.pointer.x = -0.8;
  await renderer.advanceFrames(1, 1 / 60);
  model.pointer.x = -0.4;
  model.pointerAt = model.time;
  await renderer.advanceFrames(1, 1 / 60);
  assert.ok(
    state.camera.position.distanceTo(initialPosition) < 0.000001,
    "the autonomous sky must not pan in response to the mouse",
  );
  for (let i = 0; i < 30; i++) {
    model.pointerAt = model.time;
    await renderer.advanceFrames(1, 1 / 60);
  }
  assert.ok(
    ray.uniforms.uCam.value.distanceTo(restingCamera) > 0.01,
    "the pointer gently tilts the view of the hole",
  );
  model.pointerActive = false;
  model.pulse = { x: 0.2, y: -0.1, at: model.time };
  await renderer.advanceFrames(12, 1 / 60);
  assert.ok(composite.uniforms.uWave.value.w > 0.5, "a click sends a ripple");
  assert.ok(composite.uniforms.uWave.value.z > 50, "the ripple travels outwards");
  for (let i = 0; i < 90; i++) await renderer.advanceFrames(1, 1 / 60);
  assert.equal(composite.uniforms.uWave.value.w, 0, "the ripple ends");

  const beforeSkyDrift = state.scene.backgroundRotation.y;
  for (let i = 0; i < 90; i++) await renderer.advanceFrames(1, 1 / 60);
  assert.ok(Math.abs(state.scene.backgroundRotation.y - beforeSkyDrift - 1.5 * 0.0022) < 1e-8,
    "opening panorama turns continuously at the gentle leftward speed");

  // Dragging orbits the camera around the hole without moving the scene camera.
  model.reduced = true;
  model.yaw.set(0);
  await renderer.advanceFrames(1, 1 / 60);
  const unturned = ray.uniforms.uCam.value.clone();
  model.yaw.set(1.8);
  await renderer.advanceFrames(1, 1 / 60);
  const turned = ray.uniforms.uCam.value.clone();
  assert.ok(Math.abs(turned.length() - unturned.length()) < 1e-6, "an orbit keeps its radius");
  assert.ok(turned.distanceTo(unturned) > 5, "dragging visibly orbits the hole");
  assert.ok(Math.abs(turned.y - unturned.y) < 1e-6, "vertical input never tilts the orbit");
  const heldSky = state.scene.backgroundRotation.y;
  for (const chapter of [1, 2, 3]) {
    model.progress.set(chapter);
    model.yaw.set(5);
    await renderer.advanceFrames(1, 1 / 60);
    assert.ok(
      Math.abs(state.scene.backgroundRotation.y - heldSky - chapter * 0.14) < 1e-8,
      "later scenes do not consume opening-turn input or spin the panorama",
    );
  }
  model.reduced = false;
  model.yaw.set(0);

  // Falling in: blackout, then the next chapter opens from the centre.
  model.progress.set(0.5);
  await renderer.advanceFrames(1, 1 / 60);
  assert.ok(ray.uniforms.uCam.value.length() < 8, "the camera dives towards the hole");
  assert.equal(hole.visible, true);
  model.progress.set(0.95);
  await renderer.advanceFrames(1, 1 / 60);
  assert.equal(composite.uniforms.uBlackout.value, 1, "crossing the horizon goes dark first");
  assert.ok(composite.uniforms.uEmerge.value > 0.5, "then the next chapter opens outwards");
  assert.equal(find("autonomous-stellar-field").visible, true);
  for (const chapter of [1, 2, 3]) {
    model.progress.set(chapter);
    await renderer.advanceFrames(1, 1 / 60);
    assert.equal(hole.visible, false, "later chapters do not render the hole");
  }
  model.progress.set(0);
  await renderer.advanceFrames(1, 1 / 60);
  assert.equal(hole.visible, true, "reverse scroll returns to the opening");
  assert.equal(composite.uniforms.uEmerge.value, 0);

  let previous = state.camera.position.clone();
  for (let p = 0.025; p <= 3; p += 0.025) {
    model.progress.set(p);
    await renderer.advanceFrames(1, 1 / 60);
    assert.ok(state.camera.position.distanceTo(previous) < 0.8, "no position jump between chapters");
    previous.copy(state.camera.position);
  }
  assert.ok(
    state.camera.position.distanceTo(initialPosition) > 8,
    "scroll moves through the world instead of just replacing background colours",
  );
  model.progress.set(1);
  await renderer.advanceFrames(1, 1 / 60);
  const before = state.camera.position.clone();
  model.pointer.x = 1;
  for (let i = 0; i < 60; i++) await renderer.advanceFrames(1, 1 / 60);
  assert.ok(state.camera.position.distanceTo(before) < 0.000001, "later scenes must not follow the mouse");

  model.progress.set(0);
  await renderer.advanceFrames(1, 1 / 60);
  model.paused = true;
  const at = model.time;
  const pausedCamera = ray.uniforms.uCam.value.clone();
  model.yaw.set(2.5);
  await renderer.advanceFrames(10, 1 / 60);
  assert.equal(model.time, at, "covered pages pause the scene clock");
  assert.ok(ray.uniforms.uCam.value.equals(pausedCamera), "covered pages stop rendering the hole");
  model.paused = false;
  model.reduced = true;
  model.pulse = { x: 0, y: 0, at: model.time };
  await renderer.advanceFrames(10, 1 / 60);
  assert.equal(composite.uniforms.uWave.value.w, 0, "reduced motion sends no ripple");

  const holeDisposals = [];
  composite.addEventListener("dispose", () => holeDisposals.push("composite"));
  ray.addEventListener("dispose", () => holeDisposals.push("ray"));
  hole.geometry.addEventListener("dispose", () => holeDisposals.push("geometry"));
  await renderer.unmount();
  assert.equal(model.openingReady, false);
  assert.deepEqual(holeDisposals.sort(), ["composite", "geometry", "ray"],
    "the black hole releases its programs and geometry exactly once");
  for (const key of ["progress", "yaw", "pitch"]) model[key].destroy();
});

test("entry flies in towards the hole while its disk warms, and pauses with the scene", async () => {
  const model = createModel({ entrance: motionValue(0) });
  let state;
  const renderer = await create(
    React.createElement(LibraryCosmosScene, {
      model,
      lighting: false,
      onFrame: (p, s) => (state = s),
    }),
    { width: 1600, height: 900 },
  );
  try {
    await renderer.advanceFrames(1, 1 / 60);
    const ray = state.scene.getObjectByName("event-horizon").material.userData.ray;
    const firstDistance = ray.uniforms.uCam.value.length();
    const firstHeat = ray.uniforms.uHeat.value;
    assert.ok(firstDistance > 20, "the entrance starts further out");
    assert.ok(firstHeat < 0.05, "the disk is still cold before the entrance");
    await renderer.advanceFrames(30, 1 / 60);
    flushMotion();
    await renderer.advanceFrames(1, 1 / 60);
    model.paused = true;
    const pausedAt = model.entrance.get();
    await renderer.advanceFrames(60, 1 / 60);
    assert.equal(model.entrance.get(), pausedAt);
    model.paused = false;
    await renderer.advanceFrames(300, 1 / 60);
    flushMotion();
    await renderer.advanceFrames(1, 1 / 60);
    assert.equal(model.entrance.get(), 1);
    assert.ok(Math.abs(ray.uniforms.uCam.value.length() - 14) < 0.001, "the entrance settles at 14 Rs");
    assert.equal(ray.uniforms.uHeat.value, 1);
  } finally {
    await renderer.unmount();
    for (const key of ["progress", "yaw", "pitch", "entrance"]) model[key].destroy();
  }
});
