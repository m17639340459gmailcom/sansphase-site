import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei/core/Texture.js";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import { chapterSkies } from "./scene-images.mjs";
import { skyChoreography, skyDrift } from "./library-layout.mjs";
import { departure, journeyStep } from "./journey.mjs";

// One full-screen layer draws the three chapter photographs (behind the black
// hole's composite and the depth stars). It replaces three separate photo
// planes and the always-covered panorama with a single cheap pass, and it is
// where the chapter-to-chapter flight happens (see skyChoreography).
const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const fragmentShader = /* glsl */ `
uniform sampler2D t0; uniform sampler2D t1; uniform sampler2D t2;
uniform float uIndexA; uniform float uIndexB;
uniform float uAspectA; uniform float uAspectB; uniform float uView;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uTintA; uniform vec3 uTintB;
uniform float uStreak; uniform float uIris; uniform float uRim; uniform float uShade;
uniform vec3 uRimColor; uniform vec2 uViewport; uniform vec2 uFocus;
varying vec2 vUv;
vec3 photo(float index, vec2 uv) {
  if (index < 0.5) return texture2D(t0, uv).rgb;
  if (index < 1.5) return texture2D(t1, uv).rgb;
  return texture2D(t2, uv).rgb;
}
// Cover-fit with a 12% margin, so a slow drift or a small zoom-out never
// reveals an edge. x = (offset x, offset y, zoom) in screen-height units.
vec2 cover(vec2 uv, float aspect, vec3 x) {
  vec2 p = (uv - 0.5) * vec2(uView, 1.0);
  p = p / x.z - x.xy;
  float k = max(uView / aspect, 1.0) * 1.12;
  return vec2(p.x / (aspect * k), p.y / k) + 0.5;
}
void main() {
  vec3 a = photo(uIndexA, cover(vUv, uAspectA, uA));
  // Speed lines: a radial blur towards the vanishing point. A per-pixel
  // jitter of the taps turns bright stars into continuous streaks instead of
  // rows of dots.
  if (uStreak > 0.01) {
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 sum = a;
    for (int i = 1; i < 8; i++) {
      float s = 1.0 - uStreak * 0.026 * (float(i) + jitter);
      sum += photo(uIndexA, cover(uFocus + (vUv - uFocus) * s, uAspectA, uA));
    }
    a = sum / 8.0;
  }
  vec3 col = a * uTintA * (1.0 - uShade);
  if (uIris > 0.0) {
    vec3 b = photo(uIndexB, cover(vUv, uAspectB, uB)) * uTintB;
    float d = length((vUv - 0.5) * uViewport) / (0.5 * length(uViewport));
    float r = uIris * 1.3 - 0.15;
    float m = 1.0 - smoothstep(r, r + 0.15, d);
    col = mix(col, b, m);
    col += uRimColor * uRim * exp(-pow((d - r - 0.075) / 0.03, 2.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const fullScreen = () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  return geometry;
};
const tints = chapterSkies.map((spec) => new Color(spec.tint));

export function SkyCompositor({ model }) {
  const textures = useTexture(chapterSkies.map((spec) => spec.url));
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          t0: { value: null },
          t1: { value: null },
          t2: { value: null },
          uIndexA: { value: 0 },
          uIndexB: { value: 0 },
          uAspectA: { value: 1 },
          uAspectB: { value: 1 },
          uView: { value: 1 },
          uA: { value: new Vector3(0, 0, 1) },
          uB: { value: new Vector3(0, 0, 1) },
          uTintA: { value: new Vector3(1, 1, 1) },
          uTintB: { value: new Vector3(1, 1, 1) },
          uStreak: { value: 0 },
          uIris: { value: 0 },
          uRim: { value: 0 },
          uShade: { value: 0 },
          uRimColor: { value: new Vector3(0.85, 0.72, 0.5) },
          uViewport: { value: new Vector2(1, 1) },
          uFocus: { value: new Vector2(0.5, 0.5) },
        },
      }),
    [],
  );
  const geometry = useMemo(fullScreen, []);
  useEffect(() => {
    textures.forEach((texture, i) => {
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
      material.uniforms[`t${i}`].value = texture;
    });
    model.skiesReady = true;
    return () => {
      model.skiesReady = false;
    };
  }, [material, model, textures]);
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );
  const mesh = useRef();
  useFrame((state) => {
    if (model.paused) return;
    const journey = journeyStep(model.progress.get(), model.jump);
    const p = journey.virtual;
    const u = material.uniforms,
      view = skyChoreography(p);
    const photo = (index) => journey.chapterOf(index + 1) - 1;
    // The first photograph is only seen once the dive opens into it.
    mesh.current.visible = p >= 0.86 || model.preparing === true;
    const setPhoto = (index, zoom, target, prefix) => {
      const spec = chapterSkies[index],
        drift = skyDrift(spec, model.time);
      target.set(drift.x, drift.y, drift.zoom * zoom);
      u[`uIndex${prefix}`].value = index;
      u[`uAspect${prefix}`].value = spec.aspect;
      const tint = tints[index];
      u[`uTint${prefix}`].value.set(tint.r, tint.g, tint.b);
    };
    const leave = model.reduced ? 0 : departure(model.depart, performance.now());
    setPhoto(photo(view.a), view.zoomA * (1 + 0.35 * leave), u.uA.value, "A");
    setPhoto(photo(view.b), view.zoomB, u.uB.value, "B");
    u.uStreak.value = model.reduced ? 0 : Math.max(view.streak, leave);
    u.uIris.value = view.iris;
    u.uRim.value = model.reduced ? 0 : view.rim;
    // The takeoff ends almost black: the page then opens out of that dark.
    u.uShade.value = Math.max(view.shade, 0.94 * leave);
    if (model.depart) u.uFocus.value.set(model.depart.x * 0.5 + 0.5, model.depart.y * 0.5 + 0.5);
    else u.uFocus.value.set(0.5, 0.5);
    state.gl.getDrawingBufferSize(u.uViewport.value);
    u.uView.value = state.size.width / Math.max(1, state.size.height);
  }, -0.7);
  return (
    <mesh
      ref={mesh}
      name="chapter-skies"
      geometry={geometry}
      material={material}
      renderOrder={-99}
      frustumCulled={false}
      dispose={null}
    />
  );
}
