import React, { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei/core/Texture.js";
import {
  Color,
  RepeatWrapping,
  Vector2,
  Vector3,
  Raycaster,
  PerspectiveCamera,
  MathUtils,
  Matrix4,
} from "three";
import {
  ReferenceTubes,
  TubeInput,
} from "./vendor/active-theory-tubes/adapter.mjs";
import { useRefractionBuffer } from "./library-glass.jsx";
import { cosmosFraming } from "./library-layout.mjs";
import {
  projectTubePointer,
  referenceCursorFov,
  referenceCursorRadius,
  referenceCursorPosition,
  referenceCursorTarget,
} from "./reference-pointer-projection.mjs";

function Textures({ tubes }) {
  const textures = useTexture([
    "/assets/materials/reference-cliffs-MRO.png",
    "/assets/materials/reference-matcap.jpg",
    "/assets/materials/reference-glass-normal.png",
  ]);
  textures.forEach((t) => {
    t.wrapS = t.wrapT = RepeatWrapping;
  });
  useEffect(() => {
    ["tMRO", "tMatcap", "tNormal"].forEach((key, i) => {
      tubes.material.uniforms[key].value = textures[i];
    });
  }, [tubes, textures]);
  return null;
}

// Input/lifecycle adapter only: movement, extrusion and shading use the
// reference's published programs, with no second cursor renderer.
export function SpatialEffects({ model, gpu = true }) {
  const gl = useThree((state) => state.gl);
  const tubes = useMemo(() => new ReferenceTubes(gpu ? gl : null), [gl, gpu]);
  const input = useMemo(() => new TubeInput(), []),
    buffer = useRefractionBuffer();
  const projectionCamera = useMemo(() => {
    const camera = new PerspectiveCamera(referenceCursorFov, 1, 0.1, 180);
    camera.position.fromArray(referenceCursorPosition);
    camera.lookAt(...referenceCursorTarget);
    camera.updateMatrixWorld(true);
    return camera;
  }, []);
  const container = useRef(),
    epoch = useRef(model.interactionEpoch),
    phase = useRef(0);
  const vectors = useMemo(
    () => ({
      ray: new Raycaster(),
      ndc: new Vector2(),
      hit: new Vector3(),
      scaleMatrix: new Matrix4(),
      color: new Color("#98a9e9"),
    }),
    [],
  );
  useEffect(() => () => tubes.dispose(), [tubes]);
  useFrame(({ camera, size }, delta) => {
    if (epoch.current !== model.interactionEpoch) {
      epoch.current = model.interactionEpoch;
      tubes.reset();
      input.reset();
      phase.current = 0;
    }
    const active =
      model.pointerEnabled !== false &&
      model.progress.get() < 0.01 &&
      !model.paused &&
      !model.reduced;
    container.current.visible = active;
    if (!active) {
      input.reset();
      return;
    }
    // Leaving the canvas ends the input path, while existing chains keep fading.
    if (!model.pointerActive) input.reset();
    const distance = cosmosFraming(
      size.width / Math.max(1, size.height),
      0,
    ).distance;
    const { ray, ndc, hit, color, scaleMatrix } = vectors;
    const aspect = size.width / Math.max(1, size.height);
    if (projectionCamera.aspect !== aspect) {
      projectionCamera.aspect = aspect;
      projectionCamera.updateProjectionMatrix();
    }
    // Map the reference's 30-degree lens to the universe's wider lens, keeping
    // its emission spacing and thickness instead of crowding strokes together.
    const scale = distance / referenceCursorRadius;
    const lensRatio =
      Math.tan(MathUtils.degToRad(camera.fov / 2)) /
      Math.tan(MathUtils.degToRad(referenceCursorFov / 2));
    // Preserve the reference simulation's absolute origin and transform only
    // the rendered mesh into our camera. Recentring the positions would change
    // both the curl field and the tube's cross-section frame at directional turns.
    scaleMatrix.makeScale(scale * lensRatio, scale * lensRatio, scale);
    container.current.matrix
      .copy(camera.matrixWorld)
      .multiply(scaleMatrix)
      .multiply(projectionCamera.matrixWorldInverse);
    container.current.matrixWorldNeedsUpdate = true;
    container.current.updateWorldMatrix(true, false);
    phase.current = Math.min(phase.current + Math.min(delta, 0.05), 0.05);
    while (phase.current >= 1 / 60) {
      const fresh = model.pointerActive && model.time - model.pointerAt < 0.14;
      if (fresh) {
        ndc.set(model.pointer.x, model.pointer.y);
        projectTubePointer(ray, projectionCamera, ndc, hit);
        input.move(hit, (position, velocity) =>
          tubes.release(position, velocity, color),
        );
      }
      tubes.update(model.time);
      phase.current -= 1 / 60;
    }
    tubes.material.uniforms.time.value = model.time;
    gl.getDrawingBufferSize(tubes.material.uniforms.resolution.value);
    tubes.material.uniforms.tRefraction.value = buffer?.texture ?? null;
  }, -0.4);
  return (
    <group
      ref={container}
      name="library-spatial-effects"
      matrixAutoUpdate={false}
    >
      <mesh
        name="reference-cursor-tubes"
        position={[0, 0.886, 0]}
        geometry={tubes.geometry}
        material={tubes.material}
        frustumCulled={false}
        dispose={null}
      />
      {gpu && <Textures tubes={tubes} />}
    </group>
  );
}
