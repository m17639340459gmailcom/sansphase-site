import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei/core/Float.js";
import { Text3D } from "@react-three/drei/core/Text3D.js";
import { Center } from "@react-three/drei/core/Center.js";
import { BufferGeometryLoader, Vector3, MathUtils } from "three";
import font from "./vendor/three-font/helvetiker_regular.typeface.json";
import ringData from "./vendor/active-theory-glass/ring.json";
import { cosmosFraming } from "./library-layout.mjs";
import { GlassFinish } from "./library-glass.jsx";
import { referenceReveal } from "./library-entrance.mjs";
import { OrbitalParticles } from "./library-orbital-particles.jsx";

// The published surrounding frame is retained; the reference's central glyph
// was removed during extraction. Drei Text3D supplies our replacement R.
export function Opening({ model, gpu = true }) {
  const opening = useRef(),
    signature = useRef(),
    orbit = useRef();
  const ringGeometry = useMemo(
    () => new BufferGeometryLoader().parse(ringData),
    [],
  );
  useEffect(() => () => ringGeometry.dispose(), [ringGeometry]);
  const travel = useMemo(
    () => ({ forward: new Vector3(), up: new Vector3(), right: new Vector3() }),
    [],
  );
  useFrame(({ camera, size }) => {
    if (model.paused) return;
    const progress = model.progress.get();
    const reveal = referenceReveal(model.entrance?.get());
    const view = cosmosFraming(size.width / Math.max(1, size.height), progress);
    const shift = MathUtils.smoothstep(progress, 0.3, 1);
    camera.getWorldDirection(travel.forward);
    travel.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    travel.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    opening.current.position
      .copy(camera.position)
      .addScaledVector(
        travel.forward,
        view.distance + view.journey * 2 + reveal.distance,
      )
      .addScaledVector(
        travel.up,
        (view.portrait ? 0.7 + shift * 1.35 : 0.15) - reveal.lift - view.fall,
      )
      .addScaledVector(travel.right, view.portrait ? 0 : shift * 2.1);
    opening.current.quaternion.copy(camera.quaternion);
    const manualWeight = 1 - MathUtils.smootherstep(progress, 0, 0.9);
    const turn = model.yaw.get() * manualWeight + view.yaw + reveal.turn;
    signature.current.rotation.set(0, turn, 0);
    orbit.current.rotation.copy(signature.current.rotation);
  }, -0.5);
  return (
    <group ref={opening} name="opening-installation">
      <Float
        enabled={!model.reduced}
        speed={1.3}
        rotationIntensity={0}
        floatIntensity={1}
        floatingRange={[-0.035, 0.035]}
      >
        <group ref={signature} name="r-signature">
          <Center precise={false}>
            <Text3D
              name="library-r"
              font={font}
              size={0.74}
              height={0.12}
              bevelEnabled
              bevelSize={0.012}
              bevelThickness={0.015}
              bevelSegments={5}
              curveSegments={24}
              onUpdate={(mesh) => {
                // Place this glyph's UV island in the published material's logo atlas.
                const geometry = mesh.geometry;
                if (!geometry?.attributes.uv || geometry.userData.referenceUV)
                  return;
                const uv = geometry.attributes.uv;
                for (let i = 0; i < uv.count; i++)
                  uv.setX(
                    i,
                    0.08 + 0.58 * MathUtils.clamp(uv.getX(i) / 0.7, 0, 1),
                  );
                uv.needsUpdate = true;
                geometry.userData.referenceUV = true;
              }}
            >
              R
              <GlassFinish model={model} gpu={gpu} />
            </Text3D>
          </Center>
        </group>
      </Float>
      <group ref={orbit} name="orbital-frame">
        <mesh name="opening-ring" geometry={ringGeometry} dispose={null}>
          <GlassFinish model={model} gpu={gpu} />
        </mesh>
        {[0, 3].map((offset, index) => (
          <mesh
            key={offset}
            name={index ? "opening-band-return" : "opening-band"}
            scale={0.414184}
            position={[0, -4.14184, 0]}
            frustumCulled={false}
          >
            <cylinderGeometry args={[0.1, 0.1, 20, 10, 100]} />
            <GlassFinish
              model={model}
              gpu={gpu}
              program="HomeColumnShader"
              offset={offset}
            />
          </mesh>
        ))}
      </group>
      <OrbitalParticles model={model} />
    </group>
  );
}
