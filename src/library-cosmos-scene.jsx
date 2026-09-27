import React, { useEffect, useRef } from "react";
import { useFrame, extend } from "@react-three/fiber";
import { Stars } from "@react-three/drei/core/Stars.js";
import { Environment } from "@react-three/drei/core/Environment.js";
import { Lightformer } from "@react-three/drei/core/Lightformer.js";
import { MathUtils, Vector2 } from "three";
import { Opening } from "./library-opening.jsx";
import { SpatialEffects } from "./library-spatial-effects.jsx";
import { Effects } from "@react-three/drei/core/Effects.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SpaceBackdrop } from "./library-nebula.jsx";
import { GlassSceneBuffer } from "./library-glass.jsx";
extend({ UnrealBloomPass, OutputPass });
import { cosmosFraming } from "./library-layout.mjs";
import { createEntrance, entranceDuration } from "./library-entrance.mjs";
import { advanceReferenceTurn } from "./reference-rotation.mjs";

// This file composes library components and binds our navigation state.
// No custom shader, particle generator, material model, or trail solver.
export function LibraryCosmosScene({
  model,
  onFrame = () => {},
  lighting = true,
}) {
  const entrance = useRef(),
    deepStars = useRef(),
    openingSkyDrift = useRef(0),
    skyTurn = useRef(0);
  useEffect(() => {
    if (!model.entrance) return;
    entrance.current = createEntrance(model.entrance);
    return () => entrance.current?.stop();
  }, [model]);
  useFrame((state, delta) => {
    if (model.paused) return;
    if (!model.reduced && !model.preparing && model.particlesReady !== false)
      model.time += Math.min(delta, 0.05);
    advanceReferenceTurn(model, delta);
    if (model.entrance && model.entrance.get() < 1) {
      if (model.reduced || model.progress.get() > 0.01) model.entrance.set(1);
      else if (entrance.current)
        entrance.current.time = Math.min(entranceDuration, model.time);
    }
    const p = model.progress.get(),
      view = cosmosFraming(
        state.size.width / Math.max(1, state.size.height),
        p,
      );
    // Only an intentional opening turn changes the panoramic view. The yaw
    // already includes the model's inertia; hover and vertical input do not.
    // Hold the selected view through later scenes rather than unwinding it
    // with the R's full-turn chapter choreography.
    if (p < 0.01) {
      // A gentle, continuous leftward panorama turn. The previous sway peaked
      // at 0.00176 rad/s; this is slightly faster and never reverses direction.
      // Hold this offset in other chapters so their photographs stay unchanged.
      if (!model.reduced && !model.preparing && model.particlesReady !== false)
        openingSkyDrift.current += Math.min(delta, 0.05) * 0.0022;
      const target = model.yaw.get() * 0.35;
      skyTurn.current = model.reduced
        ? target
        : MathUtils.damp(skyTurn.current, target, 12, Math.min(delta, 0.05));
    }
    model.gaze.x = model.gaze.y = 0;
    state.camera.position.set(
      view.x + model.gaze.x,
      view.y + model.gaze.y,
      view.z,
    );
    state.camera.lookAt(view.targetX, view.targetY, view.targetZ);
    state.camera.updateMatrixWorld();
    state.scene.environmentRotation.y = model.time * 0.035;
    state.scene.backgroundRotation.set(
      0.32 + p * 0.18 + Math.sin(model.time * 0.017) * 0.025,
      Math.PI / 2 +
        p * 0.14 +
        openingSkyDrift.current +
        skyTurn.current,
      -0.5,
    );
    if (deepStars.current)
      deepStars.current.rotation.set(
        Math.sin(model.time * 0.025) * 0.025,
        model.time * 0.002 + skyTurn.current,
        0,
      );
    onFrame(p, state);
  }, -1);
  const Wrapper = lighting ? GlassSceneBuffer : React.Fragment;
  return (
    <Wrapper {...(lighting ? { model } : {})}>
      {!lighting && <color attach="background" args={["#04080d"]} />}
      <fog attach="fog" args={["#04080d", 28, 100]} />
      <ambientLight intensity={0.14} />
      <directionalLight color="#dbe8ff" position={[-4, 5, 5]} intensity={2.6} />
      <directionalLight color="#8aa9f3" position={[4, -2, 1]} intensity={2.2} />
      <pointLight color="#a4c8ff" position={[-3, -2, 3]} intensity={12} />
      {lighting && (
        <Environment resolution={512} frames={1}>
          <Lightformer
            position={[-6, 2, 4]}
            rotation={[0, Math.PI / 3, 0]}
            scale={[3, 10, 1]}
            intensity={3}
            color="#a7c4f7"
          />
          <Lightformer
            position={[6, -2, -1]}
            rotation={[0, -Math.PI / 2, 0]}
            scale={[4, 9, 1]}
            intensity={2.5}
            color="#ad91d7"
          />
          <Lightformer
            position={[0, 1, 5]}
            rotation={[0, 0, 0.4]}
            scale={[0.18, 8, 1]}
            intensity={8}
            color="#e1ecff"
          />
          <Lightformer
            position={[-3, 3, 3]}
            rotation={[0, Math.PI / 4, 0]}
            scale={[0.3, 8, 1]}
            intensity={8}
            color="#e1edff"
          />
          <Lightformer
            position={[3, -1, 2]}
            rotation={[0, -Math.PI / 4, 0]}
            scale={[0.5, 6, 1]}
            intensity={6}
            color="#97baff"
          />
          <Lightformer
            position={[0, -4, 2]}
            rotation={[Math.PI / 4, 0, 0]}
            scale={[7, 0.25, 1]}
            intensity={10}
            color="#e3d4f4"
          />
          <Lightformer
            position={[0, 3, -5]}
            rotation={[0, Math.PI, 0]}
            scale={[5, 0.4, 1]}
            intensity={7}
            color="#ecf4ff"
          />
        </Environment>
      )}
      {lighting && <SpaceBackdrop model={model} />}
      <group ref={deepStars} name="autonomous-stellar-field">
        <Stars
          name="library-deep-stars"
          radius={48}
          depth={60}
          count={8500}
          factor={1.1}
          saturation={0.2}
          fade
          speed={0.28}
        />
      </group>
      <Opening model={model} gpu={lighting} />
      <SpatialEffects model={model} gpu={lighting} />
      {lighting && (
        <Effects disableGamma multisamping={2}>
          <unrealBloomPass args={[new Vector2(512, 512), 0.3, 0.4, 0.82]} />
          <outputPass />
        </Effects>
      )}
    </Wrapper>
  );
}
