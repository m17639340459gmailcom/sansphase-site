import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei/core/Environment.js";
import { useTexture } from "@react-three/drei/core/Texture.js";
import { RenderTexture } from "@react-three/drei/core/RenderTexture.js";
import { ScreenSpace } from "@react-three/drei/core/ScreenSpace.js";
import { PerspectiveCamera } from "@react-three/drei/core/PerspectiveCamera.js";
import { Image } from "@react-three/drei/core/Image.js";
import { skyLayerOpacity, skyLayerOffset, photographsCoverPanorama } from "./library-layout.mjs";
import {
  ShaderMaterial,
  Matrix4,
  Vector3,
  BackSide,
  AdditiveBlending,
  EquirectangularReflectionMapping,
  SRGBColorSpace,
} from "three";
import source from "./vendor/space-3d/nebula.glsl";
import noise from "./vendor/space-3d/classic-noise-4d.glsl";
import milkyWayURL from "./vendor/eso-milky-way/eso0932a.jpg";
import galacticURL from "./vendor/eso-galactic-centre/eso0934a.jpg";
import nebulaURL from "./vendor/eso-scene-photographs/eso1105a.jpg";
import galaxyURL from "./vendor/eso-scene-photographs/eso1424a.jpg";

// The existing Space-3D nebula shader is baked once by Drei's cube camera.
// There is no model-generated shader or expensive full-screen noise each frame.
const [vertexShader, fragmentShader] = source
  .replace(/#version 100/g, "")
  .replace("__noise4d__", noise)
  .replace("vec3 displace;", "vec3 displace = vec3(0.0);")
  .split("__split__");
function NebulaLayer({ color, offset, scale, intensity, falloff }) {
  const mesh = useRef();
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: BackSide,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uModel: { value: new Matrix4() },
          uView: { value: new Matrix4() },
          uProjection: { value: new Matrix4() },
          uColor: { value: new Vector3(...color) },
          uOffset: { value: new Vector3(...offset) },
          uScale: { value: scale },
          uIntensity: { value: intensity },
          uFalloff: { value: falloff },
        },
      }),
    [color, offset, scale, intensity, falloff],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      ref={mesh}
      onBeforeRender={(gl, scene, camera, geometry, mat) => {
        mat.uniforms.uModel.value.copy(mesh.current.matrixWorld);
        mat.uniforms.uView.value.copy(camera.matrixWorldInverse);
        mat.uniforms.uProjection.value.copy(camera.projectionMatrix);
      }}
    >
      <sphereGeometry
        args={[50, 32, 16]}
        onUpdate={(geometry) =>
          geometry.setAttribute("aPosition", geometry.attributes.position)
        }
      />
      <primitive attach="material" object={material} dispose={null} />
    </mesh>
  );
}
const blue = [0.045, 0.22, 0.65],
  violet = [0.32, 0.06, 0.38];
const blueOffset = [12.3, 28.1, 6.8],
  violetOffset = [-21.7, 11.4, 40.2];
function Panorama({ rotation, model }) {
  const map = useTexture(milkyWayURL);
  const width = useThree((state) => state.size.width);
  map.mapping = EquirectangularReflectionMapping;
  map.colorSpace = SRGBColorSpace;
  useEffect(() => {
    model.panoramaReady = true;
    return () => {
      model.panoramaReady = false;
    };
  }, [model, map]);
  useFrame(({ scene }) => scene.backgroundRotation.copy(rotation), -0.2);
  return (
    <Environment
      background="only"
      frames={1}
      resolution={width < 700 ? 1024 : 1536}
      backgroundBlurriness={0}
      backgroundIntensity={0.72}
    >
      <Environment map={map} background="only" backgroundIntensity={0.8} />
      <NebulaLayer
        color={blue}
        offset={blueOffset}
        scale={0.55}
        intensity={1.05}
        falloff={5.5}
      />
      <NebulaLayer
        color={violet}
        offset={violetOffset}
        scale={0.8}
        intensity={1.05}
        falloff={6}
      />
    </Environment>
  );
}

// RenderTexture gives the panorama its own wider lens. The glass camera and
// scroll composition are unaffected, and a small crop is no longer enlarged.
export const scenePhotographs = [
  {
    chapter: 1,
    name: "works-galactic-photograph",
    url: galacticURL,
    color: "#b9c8df",
    rate: 0.07,
    phase: 0,
  },
  {
    chapter: 2,
    name: "journal-nebula-photograph",
    url: nebulaURL,
    color: "#b1c5e0",
    rate: 0.06,
    phase: 1.3,
  },
  {
    chapter: 3,
    name: "community-galaxy-photograph",
    url: galaxyURL,
    color: "#9dafc9",
    rate: 0.05,
    phase: 2.6,
  },
];
export function SpaceBackdrop({ model }) {
  const { camera, size, scene } = useThree();
  const photographs = useRef([]);
  const panorama = useRef();
  const depth = 150;
  const height = 2 * Math.tan((camera.fov * Math.PI) / 360) * depth;
  const width = (height * size.width) / size.height;
  useFrame(() => {
    for (const spec of scenePhotographs) {
      const photograph = photographs.current[spec.chapter];
      if (!photograph?.material?.map) continue;
      const material = photograph.material;
      if (material.map.colorSpace !== SRGBColorSpace) {
        material.map.colorSpace = SRGBColorSpace;
        material.map.needsUpdate = true;
      }
      material.depthWrite = false;
      material.depthTest = false;
      const p = model.progress.get();
      const opacity = skyLayerOpacity(p, spec.chapter);
      photograph.visible =
        opacity > 0.0001 &&
        (spec.chapter === 3 || skyLayerOpacity(p, spec.chapter + 1) < 1);
      material.opacity = opacity;
      // Idle drift and the shared scroll progress drive the photograph.
      // Incoming/outgoing skies pass the lens at a different rate from the R.
      // Pointer input is never read outside the opening panorama.
      const time = model.time * spec.rate + spec.phase;
      const travel = skyLayerOffset(p, spec.chapter);
      const cover = (spec.cover ?? 1.12) + 2.1 * Math.abs(travel);
      photograph.scale.set(width * cover, height * cover, 1);
      photograph.position.x =
        width * ((spec.offsetX ?? 0) + 0.025 * Math.sin(time));
      photograph.position.y = height * (travel + 0.018 * Math.sin(time * 0.8));
      photograph.rotation.z = 0.012 * Math.sin(time * 0.55);
      material.zoom = 1.035 + 0.022 * Math.sin(time * 0.7);
    }
    // Keep the panorama texture live for an immediate reverse transition, but
    // do not draw its covered plane again in each refraction/final scene pass.
    if (panorama.current)
      panorama.current.visible = !photographsCoverPanorama(photographs.current);
  });
  return (
    <ScreenSpace depth={depth}>
      <mesh
        ref={panorama}
        name="galactic-backdrop"
        scale={[(height * size.width) / size.height, height, 1]}
        renderOrder={-100}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial depthWrite={false} depthTest={false} fog={false}>
          <RenderTexture
            attach="map"
            samples={0}
            depthBuffer={false}
            renderPriority={-0.1}
            compute={() => false}
          >
            <PerspectiveCamera makeDefault fov={70} near={0.1} far={1000} />
            <Panorama rotation={scene.backgroundRotation} model={model} />
          </RenderTexture>
        </meshBasicMaterial>
      </mesh>
      {scenePhotographs.map((spec) => (
        <Suspense key={spec.chapter} fallback={null}>
          <Image
            ref={(mesh) => {
              photographs.current[spec.chapter] = mesh;
            }}
            name={spec.name}
            url={spec.url}
            scale={[
              width * (spec.cover ?? 1.12),
              height * (spec.cover ?? 1.12),
            ]}
            position={[0, 0, spec.chapter * 0.1]}
            visible={false}
            opacity={0}
            transparent
            toneMapped={false}
            color={spec.color}
            renderOrder={-100 + spec.chapter}
            frustumCulled={false}
          />
        </Suspense>
      ))}
    </ScreenSpace>
  );
}
