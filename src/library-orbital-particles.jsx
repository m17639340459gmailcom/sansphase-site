import React, { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  IcosahedronGeometry,
  MeshPhysicalMaterial,
  Vector3,
  Vector4,
} from "three";
import {
  BatchedRenderer,
  ColorOverLife,
  ColorRange,
  ConstantValue,
  DonutEmitter,
  Gradient,
  IntervalValue,
  OrbitOverLife,
  ParticleSystem,
  RenderMode,
} from "three.quarks";
import { referenceReveal } from "./library-entrance.mjs";

// three.quarks 0.17.1: existing emitter, per-particle orbit behavior and mesh renderer.
// https://docs.quarks.art/docs/core-components/behaviors
// Only composition, timing and palette are bound to our scene here; no custom particle shader.
export function OrbitalParticles({ model }) {
  const scene = useThree((state) => state.scene);
  const anchor = useRef();
  const resources = useRef();
  useEffect(() => {
    const geometry = new IcosahedronGeometry(1, 1);
    const material = new MeshPhysicalMaterial({
      metalness: 0.55,
      roughness: 0.32,
      clearcoat: 1,
      envMapIntensity: 0.85,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const system = new ParticleSystem({
      duration: 32,
      looping: true,
      // Quarks' synchronous prewarm simulates 1,920 steps in the first frame.
      // Run the identical warmup through its public batch API over small frames.
      prewarm: false,
      autoDestroy: false,
      worldSpace: false,
      shape: new DonutEmitter({
        radius: 2.6,
        donutRadius: 1.2,
        thickness: 1,
      }),
      startLife: new IntervalValue(20, 32),
      startSpeed: new ConstantValue(0),
      startSize: new IntervalValue(0.006, 0.025),
      startColor: new ColorRange(
        new Vector4(0.18, 0.23, 0.46, 1),
        new Vector4(0.72, 0.81, 1, 1),
      ),
      emissionOverTime: new ConstantValue(75),
      instancingGeometry: geometry,
      material,
      renderMode: RenderMode.Mesh,
      behaviors: [
        // IntervalValue is sampled once per particle by OrbitOverLife. Relative
        // spacing changes continuously; the parent container has no spin.
        new OrbitOverLife(new IntervalValue(0.06, 0.14), new Vector3(0, 0, 1)),
        new ColorOverLife(
          new Gradient(
            [
              [new Vector3(1, 1, 1), 0],
              [new Vector3(1, 1, 1), 1],
            ],
            [
              [0, 0],
              [1, 0.06],
              [1, 0.8],
              [0, 1],
            ],
          ),
        ),
      ],
    });
    system.emitter.name = "orbital-particle-emitter";
    system.emitter.position.set(0.35, -2.5, -1.5);
    system.emitter.rotation.set(0.8, 0.25, -0.25);
    anchor.current.add(system.emitter);
    const batch = new BatchedRenderer();
    batch.name = "orbital-particle-batch";
    // Quarks writes world-space instances from the emitter matrix, so the batch
    // lives at the scene root to avoid applying the opening transform twice.
    scene.add(batch);
    batch.addSystem(system);
    model.particlesReady = false;
    resources.current = {
      system,
      batch,
      previousTime: model.time,
      warmSteps: 32 * 60,
    };
    return () => {
      resources.current = undefined;
      system.dispose();
      scene.remove(batch);
      for (const item of batch.batches) {
        item.dispose();
        item.material.dispose();
      }
      geometry.dispose();
      material.dispose();
    };
  }, [scene, model]);

  useFrame((state) => {
    const current = resources.current;
    if (!current) return;
    const { system, batch } = current;
    if (model.time < current.previousTime) system.restart();
    const delta =
      model.paused || model.reduced
        ? 0
        : Math.min(0.05, Math.max(0, model.time - current.previousTime));
    current.previousTime = model.time;
    system.emitter.updateWorldMatrix(true, false);
    if (current.warmSteps > 0 && !model.paused) {
      const steps = Math.min(24, current.warmSteps);
      for (let i = 0; i < steps; i++) batch.update(1 / 60);
      current.warmSteps -= steps;
      model.particlesReady = current.warmSteps === 0;
      // Reduced-motion mode renders on demand, but still needs a complete field.
      state.invalidate();
    }
    batch.update(delta);
    for (const item of batch.batches) {
      item.name = "stellar-grains";
      item.material.opacity =
        0.7 * referenceReveal(model.entrance?.get()).particles;
    }
  }, -0.25);
  return <group ref={anchor} name="orbital-particle-field" />;
}
