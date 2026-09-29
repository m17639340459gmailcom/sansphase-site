import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei/core/Texture.js";
import {
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  MathUtils,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from "three";
import { blackHoleView } from "./black-hole-view.mjs";
import { milkyWayURL } from "./scene-images.mjs";
import { departure, journeyStep } from "./journey.mjs";

// The opening's own renderer: a Schwarzschild black hole. Two passes keep it
// both sharp and affordable:
//  1. A reduced-resolution ray march bends each light ray around the hole and
//     records the accretion disk it crosses plus the direction it finally
//     escapes in (or that it was captured).
//  2. A full-resolution composite looks the ESO Milky Way and the stars up
//     along those escape directions, so the sky keeps the screen's own
//     sharpness. A click's ripple is applied here too.
// Output stays linear HDR; the scene's bloom and tone mapping finish it.
const fullScreen = () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  geometry.setAttribute(
    "uv",
    new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2),
  );
  return geometry;
};
const clipVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const noiseChunk = /* glsl */ `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

const rayFragment = /* glsl */ `
uniform vec2 uCenter; uniform float uScale;
uniform float uTime; uniform vec3 uCam; uniform float uFocal;
uniform float uHeat; uniform float uGlow;
layout(location = 0) out vec4 outDisk;
layout(location = 1) out vec4 outEscape;
${noiseChunk}
float fbm(vec3 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; } return s; }
vec4 disk(vec3 p, float r) {
  float phi = atan(p.z, p.x);
  float a = phi + uTime * 0.9 * pow(r, -1.5);
  vec3 q = vec3(r * 2.3, cos(a) * 1.7, sin(a) * 1.7);
  float n = fbm(q + vec3(0.0, 0.0, uTime * 0.03));
  float streak = fbm(vec3(r * 7.0, cos(a) * 0.6, sin(a) * 0.6));
  float inner = smoothstep(2.3, 3.1, r); float outer = 1.0 - smoothstep(5.8, 10.5, r);
  float dens = inner * outer * (0.25 + 0.95 * n * n + 0.35 * streak);
  float heat = clamp(1.9 / (r - 1.5), 0.0, 1.0);
  vec3 c = mix(vec3(1.0, 0.36, 0.08), vec3(1.0, 0.82, 0.55), heat);
  c = mix(c, vec3(1.0, 0.97, 0.92), heat * heat * 0.7);
  vec3 v = normalize(vec3(-p.z, 0.0, p.x));
  float dop = clamp(1.0 + 0.5 * dot(v, normalize(uCam - p)), 0.35, 1.6);
  float I = dens * 0.62 * uHeat * dop * dop * dop * (0.4 + 1.6 / (r * 0.55));
  return vec4(c * I, clamp(dens * 1.1, 0.0, 0.96));
}
void main() {
  vec2 uv = (gl_FragCoord.xy - uCenter) / uScale;
  vec3 fwd = normalize(-uCam); vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd)); vec3 up = cross(fwd, right);
  vec3 dir = normalize(fwd * uFocal + right * uv.x + up * uv.y);
  vec3 pos = uCam; vec3 vel = dir;
  vec3 hv = cross(pos, vel); float h2 = dot(hv, hv);
  // Inward photons with an impact parameter below 3*sqrt(3)/2 Rs (b^2 < 27/4)
  // are captured. Deciding this analytically gives the shadow an exact edge
  // instead of one that depends on the integration step.
  bool captured = h2 < 6.75 && dot(pos, dir) < 0.0;
  bool done = captured;
  // Near the critical impact parameter the higher-order disk images and the
  // lensed sky become thinner than a buffer texel. Fade them into the smooth
  // photon ring below, so every quantity is continuous across the shadow's
  // edge and upscales without steps or shimmer.
  float edge = smoothstep(0.08, 1.1, abs(h2 - 6.75));
  vec3 col = vec3(0.0); float trans = 1.0; float crossings = 0.0;
  for (int i = 0; i < 220; i++) {
    float r2 = dot(pos, pos); float r = sqrt(r2);
    float dt = clamp(0.07 * r, 0.025, 0.9);
    vec3 p0 = pos;
    vel += -1.5 * h2 * pos / (r2 * r2 * r) * dt; pos += vel * dt;
    if (p0.y * pos.y < 0.0) {
      float t = p0.y / (p0.y - pos.y); vec3 pc = mix(p0, pos, t); float rr = length(pc.xz);
      if (rr > 2.3 && rr < 10.5) {
        vec4 d = disk(pc, rr);
        d.a *= crossings < 0.5 ? 1.0 : edge;
        col += d.rgb * d.a * trans; trans *= 1.0 - d.a;
      }
      crossings += 1.0;
    }
    if (dot(pos, pos) < 1.0) { captured = true; done = true; break; }
    if (r > 45.0 || trans < 0.02) { done = true; break; }
  }
  // Rays still circling the photon sphere have no settled direction yet.
  float escape = captured || !done ? 0.0 : smoothstep(0.05, 0.8, h2 - 6.75);
  // Photon ring: rays that skim the photon sphere, continuous across the edge
  // (a slower fall-off outside, a quick one into the shadow).
  float ring = (h2 > 6.75 ? exp(-(h2 - 6.75) * 1.4) : exp(-(6.75 - h2) * 7.0)) * 0.09 * uHeat * (1.0 + uGlow);
  outDisk = vec4(col + vec3(1.0, 0.72, 0.42) * ring * trans, trans);
  outEscape = vec4(normalize(vel), escape);
}`;

// Full-resolution sky, the click ripple, the horizon blackout and the
// widening "far side" opening over the next chapter's photograph.
const compositeFragment = /* glsl */ `
#define PI 3.14159265
uniform sampler2D tDisk; uniform sampler2D tEscape; uniform sampler2D uSky;
uniform vec2 uViewport; uniform float uSkyGain; uniform float uWarp; uniform vec3 uFwd;
uniform float uBlackout; uniform float uEmerge;
uniform vec4 uWave; uniform float uWaveWidth;
varying vec2 vUv;
${noiseChunk}
vec3 starField(vec3 d, float density, float threshold) {
  vec3 q = d * density; vec3 id = floor(q);
  float h = hash(id);
  vec3 centre = 0.25 + 0.5 * vec3(hash(id + 1.7), hash(id + 4.3), hash(id + 8.9));
  float s = pow(max(0.0, 1.0 - length(fract(q) - centre) * 2.6), 7.0) * step(threshold, h);
  vec3 tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.78, 0.86, 1.0), hash(id + 2.2));
  return tint * s * (0.25 + 1.1 * hash(id + 3.1));
}
vec3 milkyWay(vec3 d) {
  vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
  // Unwrap the longitude seam so mip selection never sees a jump of one.
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5); dy.x -= floor(dy.x + 0.5);
  return textureGrad(uSky, uv, dx, dy).rgb * uSkyGain;
}
vec3 sky(vec3 d) {
  return milkyWay(d) + starField(d, 260.0, 0.962) + 0.5 * starField(d, 520.0, 0.985);
}
void main() {
  vec2 frag = gl_FragCoord.xy; vec2 src = frag;
  float glint = 0.0;
  // A click sends one gravitational-wave ripple outwards.
  if (uWave.w > 0.0) {
    vec2 d = frag - uWave.xy; float r = length(d); float k = (r - uWave.z) / uWaveWidth;
    src += d / max(r, 1.0) * uWave.w * sin(k * PI) * exp(-k * k) * uWaveWidth * 0.45;
    glint += uWave.w * 0.35 * exp(-k * k * 4.0);
  }
  vec2 uv = src / uViewport;
  vec4 disk = texture2D(tDisk, uv); vec4 escape = texture2D(tEscape, uv);
  vec3 direction = normalize(escape.xyz + vec3(0.0, 1e-4, 0.0));
  vec3 s = sky(direction);
  // Speed streaks while diving: two extra Milky Way taps, no extra stars.
  if (uWarp > 0.02) {
    s += milkyWay(normalize(direction + uFwd * uWarp * 0.06)) + milkyWay(normalize(direction + uFwd * uWarp * 0.12));
    s *= (1.0 + uWarp * 0.8) / 3.0;
  }
  vec3 c = disk.rgb + s * disk.a * escape.w;
  c += vec3(1.0, 0.86, 0.66) * glint * 0.1;
  c *= 1.0 - uBlackout;
  float diagonal = length(uViewport);
  float radius = uEmerge * 0.62 * diagonal;
  float opening = uEmerge > 0.0 ? 1.0 - smoothstep(radius, radius + 0.16 * diagonal, length(frag - 0.5 * uViewport)) : 0.0;
  gl_FragColor = vec4(c, 1.0 - opening);
}`;

// Ray-marching is priced per pixel: keep a fixed sample budget whatever the
// device pixel ratio (280k at full quality, 210k once the frame-rate guard
// steps in). Only the disk and escape directions live at this size; the sky
// itself is looked up at full resolution.
export function holeBufferSize(width, height, quality = 1) {
  const budget = 140000 + 140000 * Math.min(1, Math.max(0.5, quality));
  const scale = Math.min(0.7, Math.sqrt(budget / Math.max(1, width * height)));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

// The lensed sky is the one texture this renderer loads. Tests run the scene
// without GPU textures (gpu=false), as they do for the rest of the home.
function SkyBinding({ model, parts }) {
  const gl = useThree((state) => state.gl);
  const sky = useTexture(milkyWayURL);
  useEffect(() => {
    sky.colorSpace = SRGBColorSpace;
    sky.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy());
    sky.needsUpdate = true;
    parts.composite.uniforms.uSky.value = sky;
    gl.compile(parts.scene, parts.camera);
    model.openingReady = true;
    return () => {
      model.openingReady = false;
      parts.composite.uniforms.uSky.value = null;
    };
  }, [gl, model, parts, sky]);
  return null;
}

export function BlackHole({ model, gpu = true }) {
  const parts = useMemo(() => {
    const target = new WebGLRenderTarget(1, 1, {
      count: 2,
      type: HalfFloatType,
      depthBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    const ray = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: clipVertex,
      fragmentShader: rayFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCenter: { value: new Vector2() },
        uScale: { value: 1 },
        uTime: { value: 40 },
        uCam: { value: new Vector3() },
        uFocal: { value: 1.8 },
        uHeat: { value: 1 },
        uGlow: { value: 0 },
      },
    });
    const composite = new ShaderMaterial({
      vertexShader: clipVertex,
      fragmentShader: compositeFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDisk: { value: target.textures[0] },
        tEscape: { value: target.textures[1] },
        uSky: { value: null },
        uViewport: { value: new Vector2(1, 1) },
        uSkyGain: { value: 0.5 },
        uWarp: { value: 0 },
        uFwd: { value: new Vector3(0, 0, 1) },
        uBlackout: { value: 0 },
        uEmerge: { value: 0 },
        uWave: { value: new Vector4() },
        uWaveWidth: { value: 46 },
      },
    });
    composite.userData = { blackHole: true, ray };
    const geometry = fullScreen();
    const scene = new Scene();
    const quad = new Mesh(geometry, ray);
    quad.frustumCulled = false;
    scene.add(quad);
    return { target, ray, composite, geometry, scene, camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, []);
  const motion = useRef({ disk: 40, last: 0, gazeX: 0, gazeY: 0 });
  useEffect(() => {
    if (gpu) return;
    model.openingReady = true;
    return () => {
      model.openingReady = false;
    };
  }, [gpu, model]);
  useEffect(
    () => () => {
      parts.target.dispose();
      parts.ray.dispose();
      parts.composite.dispose();
      parts.geometry.dispose();
    },
    [parts],
  );
  const mesh = useRef();
  useFrame((state, delta) => {
    if (model.paused) return;
    const step = Math.min(delta, 0.05);
    const p = journeyStep(model.progress.get(), model.jump).virtual;
    const { width, height } = state.size;
    const view = blackHoleView(p, {
      portrait: width / Math.max(1, height) < 0.85,
      entrance: model.entrance ? model.entrance.get() : 1,
    });
    mesh.current.visible = view.visible;
    const m = motion.current;
    const velocity = Math.abs(p - m.last) / Math.max(step, 1e-3);
    m.last = p;
    if (!view.visible) return;
    // Opening input: a drag orbits the hole, the pointer tilts the view a
    // little. Both hold while falling in, so the dive starts from where the
    // visitor left the camera.
    const interactive = model.pointerEnabled !== false && p < 0.01;
    const pointing = interactive && model.pointerActive;
    m.gazeX = MathUtils.damp(m.gazeX, pointing ? model.pointer.x : 0, 3, step);
    m.gazeY = MathUtils.damp(m.gazeY, pointing ? model.pointer.y : 0, 3, step);
    if (!model.reduced && !model.preparing) m.disk += step * view.timeRate ** 3;
    const azimuth = view.azimuth + model.yaw.get() * 0.5 + (model.reduced ? 0 : 0.06 * Math.sin(model.time * 0.07)) + 0.06 * m.gazeX;
    const tilt = view.tilt + 0.03 * m.gazeY;
    const [w, h] = holeBufferSize(width, height, model.quality ?? 1);
    if (parts.target.width !== w || parts.target.height !== h) parts.target.setSize(w, h);
    const u = parts.ray.uniforms;
    u.uCenter.value.set(view.centerX * w, view.centerY * h);
    u.uScale.value = width / Math.max(1, height) < 0.85 ? w * 0.9 : h * 0.5;
    u.uTime.value = m.disk;
    u.uCam.value.set(
      Math.sin(azimuth) * Math.cos(tilt) * view.distance,
      Math.sin(tilt) * view.distance,
      -Math.cos(azimuth) * Math.cos(tilt) * view.distance,
    );
    u.uFocal.value = view.focal;
    u.uHeat.value = view.heat;
    u.uGlow.value = view.glow;
    const c = parts.composite.uniforms;
    state.gl.getDrawingBufferSize(c.uViewport.value);
    const vw = c.uViewport.value.x,
      vh = c.uViewport.value.y,
      ratio = vw / Math.max(1, width);
    c.uFwd.value.copy(u.uCam.value).multiplyScalar(-1).normalize();
    const leave = model.reduced ? 0 : departure(model.depart, performance.now());
    c.uWarp.value = model.reduced ? 0 : Math.min(1, Math.max(velocity * 0.8, leave));
    c.uBlackout.value = Math.max(view.blackout, 0.94 * leave);
    c.uEmerge.value = view.emerge;
    // A click on the opening sends one ripple through the lensed sky; reduced
    // motion keeps the sky still.
    const pulse = model.pulse,
      age = pulse ? model.time - pulse.at : Infinity;
    if (interactive && !model.reduced && age >= 0 && age < 1.3)
      c.uWave.value.set(
        (pulse.x * 0.5 + 0.5) * vw,
        (pulse.y * 0.5 + 0.5) * vh,
        age * 650 * ratio,
        (1 - age / 1.3) ** 1.5,
      );
    else c.uWave.value.set(0, 0, 0, 0);
    c.uWaveWidth.value = 46 * ratio;
    if (!gpu) return;
    const previous = state.gl.getRenderTarget();
    state.gl.setRenderTarget(parts.target);
    state.gl.render(parts.scene, parts.camera);
    state.gl.setRenderTarget(previous);
  }, -0.8);
  return (
    <>
      <mesh
        ref={mesh}
        name="event-horizon"
        geometry={parts.geometry}
        material={parts.composite}
        renderOrder={-98.5}
        frustumCulled={false}
        dispose={null}
      />
      {gpu && (
        <Suspense fallback={null}>
          <SkyBinding model={model} parts={parts} />
        </Suspense>
      )}
    </>
  );
}
