import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import {
  projectTubePointer,
  referenceCursorFov,
  referenceCursorRadius,
  referenceCursorPosition,
  referenceCursorTarget,
} from "../src/reference-pointer-projection.mjs";

test("reference cursor uses a spherical projection with depth while remaining under the pointer", () => {
  const camera = new PerspectiveCamera(42, 16 / 9, 0.1, 180);
  camera.position.set(0, 0.15, 8.8);
  camera.lookAt(0, -0.15, 0);
  camera.updateMatrixWorld(true);
  const projectionCamera = new PerspectiveCamera(
    referenceCursorFov,
    16 / 9,
    0.1,
    180,
  );
  projectionCamera.position.fromArray(referenceCursorPosition);
  projectionCamera.lookAt(...referenceCursorTarget);
  projectionCamera.updateMatrixWorld(true);
  const lensRatio =
    Math.tan((42 * Math.PI) / 360) / Math.tan((30 * Math.PI) / 360);
  const transform = camera.matrixWorld
    .clone()
    .multiply(
      new Matrix4().makeScale(
        (8.8 / 40) * lensRatio,
        (8.8 / 40) * lensRatio,
        8.8 / 40,
      ),
    )
    .multiply(projectionCamera.matrixWorldInverse);
  const ray = new Raycaster(),
    point = new Vector3();
  const cameraInSimulation = projectionCamera.position;
  const projected = [];
  for (const ndc of [
    new Vector2(0, 0),
    new Vector2(0.8, 0.6),
    new Vector2(-0.8, -0.6),
  ]) {
    projectTubePointer(ray, projectionCamera, ndc, point);
    assert.ok(
      Math.abs(point.distanceTo(cameraInSimulation) - 40) < 1e-7,
      "all projected points are 40 simulation units from the camera, matching ScreenProjection.unproject",
    );
    const onScreen = point.clone().applyMatrix4(transform).project(camera);
    assert.ok(
      Math.abs(onScreen.x - ndc.x) < 1e-7 &&
        Math.abs(onScreen.y - ndc.y) < 1e-7,
    );
    projected.push(point.clone());
  }
  assert.ok(
    projected[1].z - projected[0].z > 2,
    "edge strokes must gain depth instead of staying on a flat plane",
  );
  assert.ok(projected[1].x > projected[0].x && projected[1].y > projected[0].y);
  assert.ok(
    projected[2].x < projected[0].x && projected[2].y < projected[0].y,
    "left/down input must preserve its direction",
  );
});

test("tube frame stays continuous for 360 stroke directions through the screen centre", () => {
  const camera = new PerspectiveCamera(referenceCursorFov, 16 / 9, 0.1, 180);
  camera.position.fromArray(referenceCursorPosition);
  camera.lookAt(...referenceCursorTarget);
  camera.updateMatrixWorld(true);
  const ray = new Raycaster();
  for (let degrees = 0; degrees < 360; degrees++) {
    const radians = (degrees * Math.PI) / 180;
    const direction = new Vector2(Math.cos(radians), Math.sin(radians));
    let previousFrame;
    for (let step = -4; step <= 4; step++) {
      const a = projectTubePointer(
        ray,
        camera,
        direction.clone().multiplyScalar(step * 0.01),
        new Vector3(),
      );
      const b = projectTubePointer(
        ray,
        camera,
        direction.clone().multiplyScalar((step + 1) * 0.01),
        new Vector3(),
      );
      const tangent = b.clone().sub(a).normalize();
      // The original ProtonTube cross-section basis, evaluated at actual input
      // points. Centring this simulation at [0,0,0] collapses this cross product.
      const frame = tangent.clone().cross(a.clone().add(b).normalize());
      assert.ok(
        frame.length() > 0.1,
        "the tube must retain a finite cross-section through the centre",
      );
      frame.normalize();
      if (previousFrame)
        assert.ok(
          frame.dot(previousFrame) > 0.99,
          "adjacent sections must not flip over",
        );
      previousFrame = frame;
    }
  }
});
