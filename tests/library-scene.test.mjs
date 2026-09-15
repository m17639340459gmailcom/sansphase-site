import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import React from "react";
import { create } from "@react-three/test-renderer";
import { motionValue, frameSteps, frameData } from "motion";
import { Vector3 } from "three";

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
  loader: { ".glsl": "text" },
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

test("actual library scene: glass, persistent scroll presentation, home-only input and disposal", async () => {
  const model = {
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
  };
  let state;
  const renderer = await create(
    React.createElement(LibraryCosmosScene, {
      model,
      lighting: false,
      onFrame: (p, s) => (state = s),
    }),
    { width: 1600, height: 900 },
  );
  await renderer.advanceFrames(1, 1 / 60);
  const scene = state.scene,
    find = (name) => {
      const obj = scene.getObjectByName(name);
      assert.ok(obj, `missing ${name}`);
      return obj;
    };
  const ring = find("orbital-frame"),
    r = find("r-signature");
  const fixed = ring.quaternion.clone(),
    initialPosition = state.camera.position.clone();
  assert.equal(
    scene.getObjectByName("galaxy-0"),
    undefined,
    "works uses the photographic backdrop instead of a procedural spiral",
  );
  assert.equal(scene.getObjectByName("galaxy-1"), undefined);
  assert.equal(scene.getObjectByName("galaxy-2"), undefined);
  const initialMilkyWayTurn = state.scene.backgroundRotation.y;
  assert.ok(find("library-r").geometry.attributes.normal.count > 100);
  const frameMesh = find("opening-ring");
  for (const name of ["opening-ring", "opening-band", "library-r"]) {
    const material = find(name).material;
    assert.equal(material.userData.referenceGlass, true);
    assert.ok(
      material.uniforms.tRefraction,
      `${name} must use the shared scene refraction`,
    );
    assert.ok(
      material.uniforms.tMap,
      `${name} keeps the reference's highlight texture`,
    );
  }
  frameMesh.geometry.computeBoundingBox();
  const frameDepth =
    frameMesh.geometry.boundingBox.max.z - frameMesh.geometry.boundingBox.min.z;
  assert.ok(
    frameDepth > 0.13,
    "the orbital frame has a real side wall visible when turned",
  );
  assert.equal(frameMesh.scale.z, 1, "do not flatten the frame into a sheet");
  const ribbon = find("opening-band");
  assert.equal(ribbon.geometry.parameters.height, 20);
  assert.equal(ribbon.geometry.parameters.heightSegments, 100);
  assert.equal(ribbon.material.userData.program, "HomeColumnShader");
  assert.equal(ribbon.material.uniforms.uOffset.value, 0);
  assert.equal(find("opening-band-return").material.uniforms.uOffset.value, 3);
  const glyph = find("library-r");
  scene.updateMatrixWorld(true);
  glyph.geometry.computeBoundingBox();
  const center = glyph.geometry.boundingBox
    .clone()
    .applyMatrix4(glyph.matrixWorld)
    .getCenter(new Vector3());
  assert.ok(
    Math.abs(center.x) < 0.02,
    `R must be centred inside its independent ring: ${center.x}`,
  );
  const tube = find("reference-cursor-tubes");
  model.pointerActive = true;
  model.pointerAt = model.time;
  model.pointer.x = -0.8;
  await renderer.advanceFrames(1, 1 / 60);
  assert.equal(
    tube.geometry.instanceCount,
    0,
    "first entry creates no origin-to-pointer chain",
  );
  model.pointer.x = -0.4;
  model.pointerAt = model.time;
  await renderer.advanceFrames(1, 1 / 60);
  assert.ok(
    state.camera.position.distanceTo(initialPosition) < 0.000001,
    "the autonomous sky must not pan in response to the mouse",
  );
  assert.equal(
    tube.geometry.instanceCount,
    1,
    "movement emits a new discrete chain",
  );
  model.pointerActive = false;
  await renderer.advanceFrames(1, 1 / 60);
  const beforeReentry = tube.geometry.instanceCount;
  model.pointerActive = true;
  model.pointerAt = model.time;
  model.pointer.x = 0.8;
  await renderer.advanceFrames(1, 1 / 60);
  assert.equal(
    tube.geometry.instanceCount,
    beforeReentry,
    "re-entry cannot join an old cursor location",
  );
  model.pointerActive = false;
  const cluster = find("orbital-particle-field");
  const particles = find("orbital-particle-emitter").system;
  const particleSamples = particles.particles
    .slice(0, particles.particleNum)
    .filter((particle) => particle.life - particle.age > 5)
    .slice(0, 12);
  assert.equal(
    particleSamples.length,
    12,
    "the library warms the orbital field before entry",
  );
  const beforeParticles = particleSamples.map((particle) =>
    particle.position.clone(),
  );
  const initialClusterTurn = cluster.quaternion.clone();
  const initialSpin = find("autonomous-stellar-field").rotation.y;
  for (let i = 0; i < 90; i++) await renderer.advanceFrames(1, 1 / 60);
  assert.ok(
    Math.abs(find("autonomous-stellar-field").rotation.y - initialSpin) > 0.002,
    "the deep star field moves while no input is present",
  );
  assert.ok(state.scene.backgroundRotation.y > initialMilkyWayTurn);
  assert.ok(
    cluster.quaternion.equals(initialClusterTurn),
    "the container must not rotate as one rigid cloud",
  );
  assert.equal(
    r.rotation.y,
    0,
    "particle orbits do not rotate the central model",
  );
  for (let i = 0; i < particleSamples.length; i++) {
    const position = particleSamples[i].position;
    assert.ok(
      position.distanceTo(beforeParticles[i]) > 0.1,
      "each particle advances along its own orbit without input",
    );
    assert.ok(
      Math.abs(position.length() - beforeParticles[i].length()) < 1e-6,
      "the orbital engine preserves each particle's radius",
    );
  }
  assert.ok(
    particleSamples
      .slice(1)
      .some(
        (particle, i) =>
          Math.abs(
            particle.position.distanceTo(particleSamples[0].position) -
              beforeParticles[i + 1].distanceTo(beforeParticles[0]),
          ) > 0.03,
      ),
    "different particle speeds must change their relative spacing, unlike rigid group rotation",
  );
  const independentParticles = particleSamples.map((particle) =>
    particle.position.clone(),
  );
  model.reduced = true;
  const skyAtRest = state.scene.backgroundRotation.clone();
  const starsAtRest = find("autonomous-stellar-field").rotation.clone();
  model.yaw.set(1.8);
  model.pitch.set(0.2);
  await renderer.advanceFrames(1, 1 / 60);
  assert.equal(r.rotation.y, 1.8);
  assert.equal(r.rotation.x, 0, "the model never responds to vertical input");
  assert.ok(
    state.scene.backgroundRotation.y - skyAtRest.y > 0.3 &&
      state.scene.backgroundRotation.y - skyAtRest.y < 1.8,
    "dragging the opening turns the panorama visibly but more gently than the R",
  );
  assert.equal(state.scene.backgroundRotation.x, skyAtRest.x);
  assert.equal(state.scene.backgroundRotation.z, skyAtRest.z);
  const skyResponse = (state.scene.backgroundRotation.y - skyAtRest.y) / 1.8;
  for (const yaw of [6.27, 6.29, 12.58, -1.8, 0, 1.8]) {
    model.yaw.set(yaw);
    await renderer.advanceFrames(1, 1 / 60);
    assert.ok(
      Math.abs(
        state.scene.backgroundRotation.y - skyAtRest.y - yaw * skyResponse,
      ) < 1e-8,
      "the panoramic view stays continuous across full turns and reversals",
    );
    assert.ok(
      Math.abs(
        find("autonomous-stellar-field").rotation.y -
          starsAtRest.y -
          yaw * skyResponse,
      ) < 1e-8,
      "depth stars follow the same horizontal view as the panorama",
    );
  }
  const heldSky = state.scene.backgroundRotation.y;
  for (const chapter of [1, 2, 3]) {
    model.progress.set(chapter);
    model.yaw.set(5);
    await renderer.advanceFrames(1, 1 / 60);
    assert.ok(
      Math.abs(state.scene.backgroundRotation.y - heldSky - chapter * 0.14) <
        1e-8,
      "later scenes do not consume model-turn input or spin the panorama with transitions",
    );
  }
  model.progress.set(0);
  model.yaw.set(1.8);
  await renderer.advanceFrames(1, 1 / 60);
  assert.equal(
    particleSamples.every((particle, i) =>
      particle.position.equals(independentParticles[i]),
    ),
    true,
    "rotating the R cannot drag its particle orbits when simulation is frozen",
  );
  model.reduced = false;
  assert.ok(
    !ring.quaternion.equals(fixed),
    "the circular frame responds to dragging too",
  );
  const firstResponse = ring.rotation.y;
  for (let i = 0; i < 60; i++) await renderer.advanceFrames(1, 1 / 60);
  assert.ok(
    ring.rotation.y > 1.5 && Math.abs(ring.rotation.y - firstResponse) < 0.001,
    "the ring and attached ribbons keep the selected turn when input stops",
  );
  assert.ok(
    Math.abs(ring.rotation.y - r.rotation.y) < 0.001,
    "frame and R use the same turn, preserving their composed offset",
  );
  model.pointerActive = true;
  model.pointerAt = model.time;
  model.pointer.x = 0.8;
  model.pointer.y = 0.5;
  for (let i = 0; i < 45; i++) {
    model.pointerAt = model.time;
    await renderer.advanceFrames(1, 1 / 60);
  }
  assert.equal(tube.material.userData.referenceTubes, true);
  assert.equal(tube.geometry.getAttribute("cNumber").count, 1365);
  for (let i = 0; i < 150; i++) await renderer.advanceFrames(1, 1 / 60);
  model.pointer.x = model.pointer.y = 0;
  model.pointerActive = false;
  model.yaw.set(0);
  model.pitch.set(0);
  model.gaze.x = model.gaze.y = 0;
  model.reduced = true;
  const retreatFrames = new Map();
  const projectedRing = () => {
    scene.updateMatrixWorld(true);
    const mesh = find("opening-ring");
    const center = mesh.getWorldPosition(new Vector3()).project(state.camera);
    const bottom = mesh
      .localToWorld(new Vector3(0, -0.84, 0))
      .project(state.camera);
    const top = mesh
      .localToWorld(new Vector3(0, 0.84, 0))
      .project(state.camera);
    return {
      center: center.toArray(),
      height: top.y - bottom.y,
      visible: find("opening-installation").visible,
    };
  };
  const checkpoints = [0, 0.1, 0.2, 0.5, 1, 1.5, 2, 2.5, 3];
  for (const chapter of [0, 1, 2]) {
    model.progress.set(chapter);
    await renderer.advanceFrames(1, 1 / 60);
    const settled = projectedRing().center[1];
    model.progress.set(chapter + 0.45);
    await renderer.advanceFrames(1, 1 / 60);
    assert.ok(
      projectedRing().center[1] < settled - 0.1,
      "during descent the model visibly leads the camera downwards instead of remaining screen-locked",
    );
  }
  for (const p of checkpoints) {
    model.yaw.set(p > 0 ? 1.8 : 0);
    model.progress.set(p);
    await renderer.advanceFrames(1, 1 / 60);
    if (p > 0 && Number.isInteger(p)) {
      assert.ok(
        Math.cos(r.rotation.y) > 0.999999,
        "every chapter faces forward even after an opening drag",
      );
      assert.ok(Math.cos(ring.rotation.y) > 0.999999);
    }
    const frame = projectedRing();
    assert.ok(
      Math.abs(frame.center[0]) < 0.8 && Math.abs(frame.center[1]) < 0.55,
      "scroll keeps the glass installation inside the viewport",
    );
    assert.ok(
      frame.height > 0.2 && frame.height < 0.7,
      "the model stays readable while the camera passes through the environment",
    );
    assert.equal(
      frame.visible,
      true,
      "do not remove the model at a chapter boundary",
    );
    retreatFrames.set(p, frame);
  }
  assert.equal(
    retreatFrames.get(3).visible,
    true,
    "the complete homepage keeps one continuous installation",
  );
  for (const p of checkpoints.toReversed()) {
    model.progress.set(p);
    await renderer.advanceFrames(1, 1 / 60);
    const frame = projectedRing(),
      expected = retreatFrames.get(p);
    assert.ok(
      frame.center.every((v, i) => Math.abs(v - expected.center[i]) < 1e-7),
      "reverse scroll returns to the same spatial position",
    );
    assert.ok(
      Math.abs(frame.height - expected.height) < 1e-7,
      "reverse scroll restores the same model size",
    );
    assert.equal(frame.visible, expected.visible);
  }
  model.reduced = false;
  let previous = state.camera.position.clone();
  for (let p = 0.025; p <= 3; p += 0.025) {
    model.progress.set(p);
    await renderer.advanceFrames(1, 1 / 60);
    assert.ok(
      state.camera.position.distanceTo(previous) < 0.8,
      "no position jump between chapters",
    );
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
  assert.ok(
    state.camera.position.distanceTo(before) < 0.000001,
    "later scenes must not follow the mouse",
  );
  assert.equal(find("library-spatial-effects").visible, false);
  model.paused = true;
  const at = model.time;
  const frozenParticle = particles.particles[0].position.clone();
  await renderer.advanceFrames(10, 1 / 60);
  assert.equal(model.time, at);
  assert.ok(
    particles.particles[0].position.equals(frozenParticle),
    "covered pages pause the orbital simulation",
  );
  assert.equal(
    find("library-spatial-effects").visible,
    false,
    "covered pages hide the cursor effect",
  );
  model.paused = false;
  model.reduced = true;
  await renderer.advanceFrames(10, 1 / 60);
  assert.equal(
    find("library-spatial-effects").visible,
    false,
    "reduced motion hides the animated trail",
  );
  const trailDisposals = [];
  const particleDisposals = [];
  for (const key of ["geometry", "material"])
    find("stellar-grains")[key].addEventListener("dispose", () =>
      particleDisposals.push(key),
    );
  for (const key of ["geometry", "material"])
    tube[key].addEventListener("dispose", () => trailDisposals.push(key));
  await renderer.unmount();
  assert.equal(scene.getObjectByName("orbital-particle-batch"), undefined);
  assert.equal(
    particleDisposals.length,
    2,
    "particle batch geometry and material release exactly once",
  );
  assert.equal(
    trailDisposals.length,
    2,
    "the instanced reference geometry and material release exactly once",
  );
  for (const key of ["progress", "yaw", "pitch"]) model[key].destroy();
});

test("entry reveals particles before glass with a turning approach and pauses with the scene", async () => {
  const model = {
    progress: motionValue(0),
    yaw: motionValue(0),
    pitch: motionValue(0),
    entrance: motionValue(0),
    pointer: { x: 0, y: 0 },
    pointerActive: false,
    pointerAt: -10,
    gaze: { x: 0, y: 0 },
    time: 0,
    paused: false,
    interactionEpoch: 0,
    reduced: false,
  };
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
    const find = (name) => state.scene.getObjectByName(name);
    const firstDistance = find("opening-installation").position.distanceTo(
      state.camera.position,
    );
    const firstTurn = find("r-signature").rotation.y;
    assert.ok(find("opening-ring").material.uniforms.uAlpha.value < 0.01);
    await renderer.advanceFrames(30, 1 / 60);
    flushMotion();
    await renderer.advanceFrames(1, 1 / 60);
    assert.ok(
      find("stellar-grains").material.opacity >
        find("opening-ring").material.uniforms.uAlpha.value,
    );
    model.paused = true;
    const pausedAt = model.entrance.get();
    await renderer.advanceFrames(60, 1 / 60);
    assert.equal(model.entrance.get(), pausedAt);
    model.paused = false;
    await renderer.advanceFrames(300, 1 / 60);
    flushMotion();
    await renderer.advanceFrames(1, 1 / 60);
    assert.equal(model.entrance.get(), 1);
    assert.equal(find("opening-ring").material.uniforms.uAlpha.value, 1);
    assert.equal(find("opening-band").material.uniforms.uVisible.value, 1);
    assert.ok(firstTurn - find("r-signature").rotation.y > 3);
    assert.ok(
      firstDistance -
        find("opening-installation").position.distanceTo(
          state.camera.position,
        ) >
        6,
    );
  } finally {
    await renderer.unmount();
    for (const key of ["progress", "yaw", "pitch", "entrance"])
      model[key].destroy();
  }
});
