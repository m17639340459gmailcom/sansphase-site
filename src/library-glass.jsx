import React, {
  createContext,
  useContext,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { useFrame } from "@react-three/fiber";
import { useFBO } from "@react-three/drei/core/Fbo.js";
import { useTexture } from "@react-three/drei/core/Texture.js";
import {
  NoToneMapping,
  RepeatWrapping,
  ShaderMaterial,
  Vector2,
  DoubleSide,
  UnsignedByteType,
} from "three";
import { programs } from "./vendor/active-theory-glass/shaders.mjs";
import { referenceReveal } from "./library-entrance.mjs";

const Refraction = createContext(null);
export const useRefractionBuffer = () => useContext(Refraction);

// Separate background, cursor/refraction and final glass passes. A refractor
// must never sample its own previous output: that feeds brightness back forever.
export function GlassSceneBuffer({ children, model }) {
  // The published FXLayer/SnapshotFrame default to UNSIGNED_BYTE. Their
  // soft-light equations consume [0,1] inputs, including the video replacement.
  // A half-float refraction buffer lets cursor highlights escape that range.
  const first = useFBO({ samples: 2, type: UnsignedByteType }),
    second = useFBO({ samples: 2, type: UnsignedByteType });
  const buffer = useRef({ texture: second.texture });
  useFrame(({ gl, scene, camera }) => {
    if (model.paused) return;
    const glass = [],
      tubes = [];
    scene.traverse((object) => {
      if (
        object.isMesh &&
        object.visible &&
        object.material?.userData?.referenceGlass
      ) {
        glass.push(object);
        object.visible = false;
      }
      if (
        object.isMesh &&
        object.visible &&
        object.material?.userData?.referenceTubes
      ) {
        tubes.push(object);
        object.visible = false;
      }
    });
    const previous = gl.getRenderTarget(),
      tone = gl.toneMapping;
    try {
      gl.toneMapping = NoToneMapping;
      gl.setRenderTarget(second);
      gl.render(scene, camera);
      tubes.forEach((object) => {
        object.visible = true;
        object.material.uniforms.tRefraction.value = second.texture;
      });
      gl.setRenderTarget(first);
      gl.render(scene, camera);
    } finally {
      gl.setRenderTarget(previous);
      gl.toneMapping = tone;
      [...glass, ...tubes].forEach((object) => {
        object.visible = true;
      });
    }
    buffer.current.texture = second.texture;
    scene.traverse((object) => {
      const material = object.material;
      if (material?.userData?.referenceGlass) {
        material.uniforms.tRefraction.value = first.texture;
        if (material.uniforms.tVideo)
          material.uniforms.tVideo.value = second.texture;
      }
    });
  }, 0.9);
  return (
    <Refraction.Provider value={buffer.current}>{children}</Refraction.Provider>
  );
}

export function makeGlassMaterial(program = "HomeLogoShader", offset = 0) {
  // Keep the published glass program intact; use Three's existing Neutral
  // operator at its output to compress highlights before the bloom pass.
  const fragmentShader =
    `#include <tonemapping_pars_fragment>\nuniform float uGlassExposure;\n${programs[program].fragmentShader}`.replace(
      /\}\s*$/,
      "gl_FragColor.rgb = NeutralToneMapping(max(gl_FragColor.rgb, vec3(0.0)) * uGlassExposure);\n}",
    );
  const material = new ShaderMaterial({
    ...programs[program],
    fragmentShader,
    transparent: true,
    side: DoubleSide,
    toneMapped: false,
    uniforms: {
      time: { value: 0 },
      resolution: { value: new Vector2(1280, 720) },
      tMap: { value: null },
      tNormal: { value: null },
      tRefraction: { value: null },
      tVideo: { value: null },
      uAlpha: { value: 1 },
      uGlassExposure: { value: 0.85 },
      toneMappingExposure: { value: 1 },
      uNormalScale: { value: 1 },
      uScrollDelta: { value: 0 },
      uVisible: { value: 1 },
      uScroll: { value: 0 },
      uFooter: { value: 0 },
      uPhone: { value: 0 },
      uOffset: { value: offset },
      uDirection: { value: 1 },
    },
  });
  material.userData = {
    referenceGlass: true,
    program,
    source: "Active Theory public shader",
  };
  return material;
}

function MaterialBinding({ model, program, offset, textures }) {
  const buffer = useContext(Refraction);
  const material = useMemo(
    () => makeGlassMaterial(program, offset),
    [program, offset],
  );
  const previous = useRef(0);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ gl, size }) => {
    const uniforms = material.uniforms;
    uniforms.time.value = model.time;
    gl.getDrawingBufferSize(uniforms.resolution.value);
    uniforms.uScrollDelta.value = (model.progress.get() - previous.current) * 3;
    previous.current = model.progress.get();
    uniforms.uScroll.value = model.progress.get() / 3;
    uniforms.uPhone.value = size.width < 600 ? 1 : 0;
    const reveal = referenceReveal(model.entrance?.get());
    uniforms.uVisible.value = reveal.model;
    uniforms.uAlpha.value = reveal.model;
    uniforms.tRefraction.value = buffer?.texture ?? null;
    // The original site's video is replaced by our live universe illumination.
    uniforms.tVideo.value = buffer?.texture ?? null;
    if (textures) {
      uniforms.tMap.value = textures[0];
      uniforms.tNormal.value = textures[1];
    }
  });
  return <primitive attach="material" object={material} dispose={null} />;
}

function TexturedGlass(props) {
  const textures = useTexture([
    "/assets/materials/reference-matcap.jpg",
    "/assets/materials/reference-glass-normal.png",
  ]);
  textures.forEach((texture) => {
    texture.wrapS = texture.wrapT = RepeatWrapping;
  });
  return <MaterialBinding {...props} textures={textures} />;
}
export function GlassFinish({
  gpu = true,
  model,
  program = "HomeLogoShader",
  offset = 0,
}) {
  return gpu ? (
    <TexturedGlass model={model} program={program} offset={offset} />
  ) : (
    <MaterialBinding model={model} program={program} offset={offset} />
  );
}
