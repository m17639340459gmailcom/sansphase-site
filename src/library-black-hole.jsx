import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei/core/Texture.js";
import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  MathUtils,
  Matrix3,
  Matrix4,
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
import { bakeOpeningSky, openingSkyIntensity, openingSkyResolution } from "./opening-sky.ts";
import { departure, journeyStep } from "./journey.mjs";
import { rayFragment, diskReconstruction } from "./black-hole-shaders.ts";
import { holeBufferSize, advanceHoleClock, advanceHoleOrbit } from "./black-hole-render.ts";
import { cinematicHolePose } from "./black-hole-cinema.ts";
import { blackHoleFormation } from "./black-hole-formation.ts";
import { advanceSkyParallax } from "./black-hole-background.ts";

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
  return geometry;
};
const clipVertex = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Full-resolution sky, the click ripple, the horizon blackout and the
// widening "far side" opening over the next chapter's photograph.
const compositeFragment = /* glsl */ `
#define PI 3.14159265
uniform sampler2D tDisk; uniform sampler2D tEscape; uniform samplerCube uSky;
uniform vec2 uDiskTexel;
uniform mat3 uSkyRotation;
uniform float uSkyParallax;
uniform vec2 uViewport; uniform float uSkyGain; uniform float uWarp; uniform vec3 uFwd;
uniform float uBlackout; uniform float uEmerge;
uniform vec4 uWave; uniform float uWaveWidth;
vec3 milkyWay(vec3 d) {
  // Opening-only exposure, shared by normal and dive samples to avoid a flash.
  // Counter-parallax is tied to actual observer movement, not a second clock.
  float c = cos(uSkyParallax), s = sin(uSkyParallax);
  d = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  return textureCube(uSky, uSkyRotation * d).rgb * uSkyGain * 0.48;
}
vec3 sky(vec3 d) {
  return milkyWay(d);
}
${diskReconstruction}
void main() {
  vec2 frag = gl_FragCoord.xy; vec2 src = frag;
  float glint = 0.0;
  // Artistic click feedback, not a simulation of gravitational waves.
  if (uWave.w > 0.0) {
    vec2 d = frag - uWave.xy; float r = length(d); float k = (r - uWave.z) / uWaveWidth;
    src += d / max(r, 1.0) * uWave.w * sin(k * PI) * exp(-k * k) * uWaveWidth * 0.45;
    glint += uWave.w * 0.35 * exp(-k * k * 4.0);
  }
  vec2 uv = src / uViewport;
  vec4 disk = sampleDisk(uv); vec4 escape = texture2D(tEscape, uv);
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

// The lensed sky is the one texture this renderer loads. Tests run the scene
// without GPU textures (gpu=false), as they do for the rest of the home.
function SkyBinding({ model, parts }) {
  const gl = useThree((state) => state.gl);
  const resolution = useThree((state) => openingSkyResolution(state.size.width, state.gl.capabilities.maxCubemapSize));
  const sky = useTexture(milkyWayURL);
  useEffect(() => {
    sky.colorSpace = SRGBColorSpace;
    sky.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy());
    sky.needsUpdate = true;
    const baked = bakeOpeningSky(gl, sky, resolution);
    parts.composite.uniforms.uSky.value = baked.texture;
    gl.compile(parts.scene, parts.camera);
    model.openingReady = true;
    return () => {
      model.openingReady = false;
      parts.composite.uniforms.uSky.value = null;
      baked.dispose();
    };
  }, [gl, model, parts, sky, resolution]);
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
        uRoll: { value: 0 },
        uFormation: { value: new Vector4(1, 1, 0, 0) },
        uFormationTurn: { value: 0 },
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
        uDiskTexel: { value: new Vector2(1, 1) },
        uSky: { value: null },
        // Fixed base star-map orientation. Opening-only counter-parallax is
        // applied separately from actual observer deltas; no independent timer.
        uSkyRotation: { value: new Matrix3().setFromMatrix4(
          new Matrix4().makeRotationFromEuler(new Euler(0.32, Math.PI / 2, -0.5)),
        ).transpose() },
        uViewport: { value: new Vector2(1, 1) },
        uSkyGain: { value: openingSkyIntensity },
        uSkyParallax: { value: 0 },
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
  const motion = useRef({ disk: 40, orbit: 0, last: 0, gazeX: 0, gazeY: 0,
    lastYaw: model.yaw.get(), manualUntil: -Infinity, idleBlend: 1, orbitDirection: 1,
    lastPointerAt: -Infinity, lastViewAngle: 0, skyParallax: 0 });
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
    const yaw = model.yaw.get();
    const yawDelta = yaw - m.lastYaw;
    if (interactive && Math.abs(yawDelta) > 1e-6) m.orbitDirection = Math.sign(yawDelta);
    if (interactive && (model.orbiting || Math.abs(yawDelta) > 1e-6)) {
      m.manualUntil = model.time + 1.2;
      m.idleBlend = 0;
    }
    m.lastYaw = yaw;
    const manual = model.time < m.manualUntil;
    // Hold the selected angle on pointer leave and throughout a drag/dive.
    // Recentering would turn the sky backwards just as idle motion resumes.
    if (!manual && pointing && model.pointerAt > m.manualUntil) {
      if (model.pointerAt > m.lastPointerAt && Math.abs(model.pointer.x - m.gazeX) > 1e-4) {
        m.orbitDirection = Math.sign(model.pointer.x - m.gazeX);
      }
      m.gazeX = MathUtils.damp(m.gazeX, model.pointer.x, 3, step);
      m.gazeY = MathUtils.damp(m.gazeY, model.pointer.y, 3, step);
    }
    // Do not replay stale hover samples after the manual input hold expires.
    m.lastPointerAt = model.pointerAt;
    if (!model.reduced && !model.preparing && model.openingReady !== false) {
      m.disk = advanceHoleClock(m.disk, step, view.timeRate);
      const hoverMoving = pointing && model.time - model.pointerAt < 0.15;
      if (!manual && !hoverMoving && p < 0.01 && (!model.entrance || model.entrance.get() >= 1)) {
        m.idleBlend = MathUtils.damp(m.idleBlend, 1, 1.8, step);
        m.orbit = advanceHoleOrbit(m.orbit, step * m.idleBlend, m.orbitDirection);
      } else m.idleBlend = 0;
    }
    const viewAngle = yaw * 0.5 + m.orbit + 0.06 * m.gazeX;
    if (p < 0.01 && !model.preparing && model.openingReady !== false)
      m.skyParallax = advanceSkyParallax(m.skyParallax, viewAngle, m.lastViewAngle);
    m.lastViewAngle = viewAngle;
    const azimuth = view.azimuth + viewAngle;
    const cinema = cinematicHolePose(p);
    const tilt = view.tilt + cinema.tilt + 0.03 * m.gazeY;
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
    const formation = blackHoleFormation(model.entrance ? model.entrance.get() : 1);
    u.uHeat.value = formation.disk;
    u.uFormation.value.set(formation.mass, formation.disk, formation.skyTurn, formation.skySpread);
    u.uFormationTurn.value = formation.turn;
    u.uRoll.value = cinema.roll;
    const c = parts.composite.uniforms;
    c.uSkyParallax.value = m.skyParallax;
    c.uDiskTexel.value.set(1 / w, 1 / h);
    state.gl.getDrawingBufferSize(c.uViewport.value);
    const vw = c.uViewport.value.x,
      vh = c.uViewport.value.y,
      ratio = vw / Math.max(1, width);
    c.uFwd.value.copy(u.uCam.value).multiplyScalar(-1).normalize();
    const leave = model.reduced ? 0 : departure(model.depart, performance.now());
    c.uWarp.value = model.reduced ? 0 : Math.min(1, Math.max(velocity * 0.8, leave));
    c.uBlackout.value = Math.max(view.blackout, 0.94 * leave);
    c.uEmerge.value = view.emerge;
    // Preserve the opening's artistic click feedback; reduced motion disables it.
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
