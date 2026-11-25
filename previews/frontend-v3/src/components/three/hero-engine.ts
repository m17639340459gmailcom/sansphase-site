import * as THREE from "three";
import {
  ENTRANCE_DURATION, MORPH_DURATION, holdProgress, morphProgress, stepHeroCycle, stepHeroEntrance,
  type HeroCycle, type HeroEntrance,
} from "./hero-cycle";
import {
  createHeroOrbit, stepHeroOrbit,
  type HeroInteraction, type HeroSimulationMode, type HeroTelemetry,
} from "./hero-interaction";
import { getNetworkLayers } from "./hero-network";
import {
  HERO_TUNING, overlayFragmentShader, overlayVertexShader, particleFragmentShader, particleVertexShader,
} from "./hero-shaders";
import { getHeroShape, motionElements, SHAPE_EFFECT_IDS, type ShapeAtlas } from "./hero-shapes";
import { HeroSimulation } from "./hero-simulation";
import type { ScenePalette } from "./palette";

export type HeroFrame = {
  /** Raw frame delta in seconds. */
  delta: number;
  /** First frame after a pause/offscreen period: count no time. */
  resume: boolean;
  active: boolean;
  reduced: boolean;
  holdEntrance: boolean;
  interaction: HeroInteraction;
  camera: THREE.Camera;
  /** Canvas size in CSS pixels and the fixed device pixel ratio. */
  width: number;
  height: number;
  pixelRatio: number;
  /** 0..1 scroll dispersal target. */
  scroll: number;
};

type ShapeSlot = { slot: number; effect: number; motion: THREE.Matrix4 };

const CAMERA_DISTANCE = 7;
const HALF_FOV_TAN = Math.tan(THREE.MathUtils.degToRad(38 / 2));
/** Model-space extent used to normalise sweeps (all shapes fit inside it). */
const SWEEP_EXTENT = 2.35;
const SWEEP_CORNERS: readonly [number, number][] = [[-2.35, -1.85], [-2.35, 1.85], [2.35, -1.85], [2.35, 1.85]];
/** Autoplay sweep directions (radians); clicks sweep radially from the click point instead. */
const SWEEP_ANGLES = [0.3, Math.PI + 0.55, -Math.PI / 2 + 0.25, Math.PI * 0.72, Math.PI / 2 + 0.4];
const PHYSICS_STEP = 1 / 30;

/** True when three linked the material's program and it is not runnable. */
function programFailed(renderer: THREE.WebGLRenderer, material: THREE.Material) {
  const program = (renderer.properties.get(material) as { currentProgram?: { diagnostics?: { runnable: boolean } } })
    .currentProgram;
  return program?.diagnostics?.runnable === false;
}

function dataTexture(data: Float32Array, width: number, height: number, format: THREE.PixelFormat) {
  const texture = new THREE.DataTexture(data, width, height, format, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export class HeroEngine {
  readonly object = new THREE.Group();
  readonly count: number;
  mode: HeroSimulationMode = "shader";

  private readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly overlay: THREE.Mesh;
  private readonly overlayMaterial: THREE.ShaderMaterial;
  private readonly textures: THREE.DataTexture[];
  private readonly placeholder = dataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat);
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly slots = new Map<number, ShapeSlot>();
  private sim: HeroSimulation | null = null;
  private needsReset = true;
  private wasReduced: boolean;

  // Interaction state (all preallocated; frames never allocate).
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly inverse = new THREE.Matrix4();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();
  private readonly lastHit = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly networkLayers = getNetworkLayers();
  private readonly orbit = createHeroOrbit();
  private readonly tilt = { x: 0, y: 0 };
  private hasLastHit = false;
  private pointerStrength = 0;
  private hoverTime = 0;
  private simTime = 0;
  private scatter = 0;
  private transitions = 0;
  private fps = 0;
  private readonly shocks = [
    { a: new THREE.Vector4(0, 0, 0, -99), b: new THREE.Vector4(0, 0, 1, 0), x: 0, y: 0 },
    { a: new THREE.Vector4(0, 0, 0, -99), b: new THREE.Vector4(0, 0, 1, 0), x: 0, y: 0 },
  ];
  private nextShock = 0;
  private clickPoint: [number, number] | null = null;
  // Reused option bags and overlay bounds keep the frame loop allocation-free.
  private readonly cycleOptions = { active: false, reduced: false };
  private readonly entranceOptions = { active: false, reduced: false, hold: false };
  private readonly orbitInput = { dragging: false, dx: 0, dy: 0 };
  private readonly bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, aspect: 1 };

  constructor(
    readonly atlas: ShapeAtlas,
    readonly cycle: HeroCycle,
    readonly entrance: HeroEntrance,
    simulationType: THREE.TextureDataType | null,
    palette: ScenePalette,
    reduced: boolean,
  ) {
    this.count = atlas.count;
    this.wasReduced = reduced;
    const side = atlas.side;
    const height = side * atlas.ids.length;
    this.textures = [
      dataTexture(atlas.positions, side, height, THREE.RGBAFormat),
      dataTexture(atlas.styles, side, height, THREE.RGBAFormat),
      dataTexture(atlas.details, side, height, THREE.RGFormat),
    ];
    atlas.ids.forEach((id, slot) => {
      const shape = getHeroShape(id);
      const motion = new THREE.Matrix4().fromArray(motionElements(shape.motion));
      this.slots.set(id, { slot, effect: SHAPE_EFFECT_IDS[shape.effect], motion });
    });

    const shared: Record<string, THREE.IUniform> = {
      tShapePos: { value: this.textures[0] },
      tShapeStyle: { value: this.textures[1] },
      tShapeDetail: { value: this.textures[2] },
      uFromSlot: { value: 0 },
      uToSlot: { value: 0 },
      uFromMotion: { value: new THREE.Matrix4() },
      uToMotion: { value: new THREE.Matrix4() },
      uTime: { value: 0 },
      uSimTime: { value: 0 },
      uElapsed: { value: MORPH_DURATION },
      uMovement: { value: 1 },
      uSweep: { value: new THREE.Vector4(1, 0, 0, 1 / (2 * SWEEP_EXTENT)) },
      uPhaseSeed: { value: 0 },
      uEntrance: { value: 0 },
      uScatter: { value: 0 },
      uPointerOrigin: { value: new THREE.Vector3() },
      uPointerDir: { value: new THREE.Vector3(0, 0, -1) },
      uPointerVelocity: { value: new THREE.Vector3() },
      uPointerStrength: { value: 0 },
      uPointerRadius: { value: HERO_TUNING.pointerRadius },
      uShockA0: { value: this.shocks[0].a },
      uShockB0: { value: this.shocks[0].b },
      uShockA1: { value: this.shocks[1].a },
      uShockB1: { value: this.shocks[1].b },
    };
    this.uniforms = shared;

    this.material = new THREE.ShaderMaterial({
      name: "HeroParticles",
      defines: { SIDE: side },
      uniforms: {
        ...shared,
        tPosition: { value: this.placeholder },
        tVelocity: { value: this.placeholder },
        uSimulated: { value: 0 },
        uFromEffect: { value: 0 },
        uToEffect: { value: 0 },
        uSize: { value: 2 },
        uPixelRatio: { value: 1 },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uHoverNode: { value: -1 },
        uHoverTime: { value: 0 },
        uHoverStrength: { value: 0 },
        uColor: { value: new THREE.Color() },
        uAccent: { value: new THREE.Color() },
        uHot: { value: new THREE.Color() },
        uOpacity: { value: 1 },
        uGlow: { value: 0 },
        uDof: { value: 1 },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    // Positions come from textures; the attribute only sizes the draw call.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.count * 3), 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;

    this.overlayMaterial = new THREE.ShaderMaterial({
      name: "HeroOverlay",
      uniforms: {
        uRect: { value: new THREE.Vector4(-1, -1, 1, 1) },
        uAspect: { value: 1 },
        uRing0: { value: new THREE.Vector4() },
        uRing1: { value: new THREE.Vector4() },
        uColor: { value: new THREE.Color() },
        uStrength: { value: 1 },
      },
      vertexShader: overlayVertexShader,
      fragmentShader: overlayFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.overlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.overlayMaterial);
    this.overlay.frustumCulled = false;
    // Beneath the particles: on bone white the glow must not veil the dots above it.
    this.overlay.renderOrder = -1;
    this.overlay.visible = false;
    this.object.add(this.points, this.overlay);

    if (simulationType !== null) {
      this.sim = new HeroSimulation(side, simulationType, shared);
      this.mode = "gpgpu";
    }
    this.setPalette(palette);
    this.syncShapes();
  }

  /**
   * Compile (off the main thread where KHR_parallel_shader_compile exists), force
   * each program's first use to surface link errors, and self-test the simulation.
   * A failing simulation falls back to the stateless path; failing particle
   * shaders throw so the wrapper shows its icon fallback. Nothing is logged.
   */
  async prepare(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    this.syncShapes();
    this.syncInputs(this.wasReduced);
    const debug = renderer.debug;
    const reportError = debug.onShaderError;
    debug.onShaderError = () => {};
    const probe = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    try {
      // Include the (normally hidden) overlay, so the first hover never hitches.
      this.overlay.visible = true;
      await renderer.compileAsync(this.object, camera);
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(probe);
      renderer.render(this.object, camera);
      renderer.setRenderTarget(previous);
      if (programFailed(renderer, this.material) || programFailed(renderer, this.overlayMaterial)) {
        throw new Error("Particle shaders failed to compile.");
      }
      if (!this.sim) return;
      try {
        await this.sim.compile(renderer);
        this.sim.reset(renderer);
        this.needsReset = false;
        if (programFailed(renderer, this.sim.material) || !this.sim.verify(renderer)) {
          throw new Error("Particle simulation self-test failed.");
        }
      } catch {
        this.sim.dispose();
        this.sim = null;
        this.mode = "shader";
      }
    } finally {
      debug.onShaderError = reportError;
      probe.dispose();
      this.overlay.visible = false;
    }
  }

  get simulated() {
    return this.sim !== null;
  }

  /** After a WebGL context restore the render targets come back empty: re-seed them. */
  restoreContext() {
    this.needsReset = true;
  }

  setPalette(palette: ScenePalette) {
    const u = this.material.uniforms;
    u.uColor.value.set(palette.point);
    u.uAccent.value.set(palette.accent);
    // Dark: amber embers glow additively. Light: a deeper accent reads as "hot" on bone white.
    u.uHot.value.set(palette.additive ? palette.amber : palette.accentStrong);
    u.uOpacity.value = palette.additive ? 0.62 : 0.92;
    u.uGlow.value = palette.additive ? 1 : 0;
    this.material.blending = palette.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.overlayMaterial.uniforms.uColor.value.set(palette.accent);
    this.overlayMaterial.uniforms.uStrength.value = palette.additive ? 0.9 : 0.55;
    this.overlayMaterial.blending = palette.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  }

  /** Click/Enter: a shockwave from the pointer (keyboard: centre). */
  shock(ndcX: number, ndcY: number, camera: THREE.Camera, reduced: boolean, strength = 1) {
    if (reduced) return;
    this.modelRay(ndcX, ndcY, camera);
    const shock = this.shocks[this.nextShock];
    this.nextShock = (this.nextShock + 1) % this.shocks.length;
    shock.a.set(this.origin.x, this.origin.y, this.origin.z, this.simTime);
    shock.b.set(this.direction.x, this.direction.y, this.direction.z, strength);
    shock.x = ndcX;
    shock.y = ndcY;
    if (strength >= 1) this.clickPoint = this.planeHit() ? [this.hit.x, this.hit.y] : null;
  }

  private modelRay(ndcX: number, ndcY: number, camera: THREE.Camera) {
    this.points.updateMatrixWorld();
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, camera);
    this.inverse.copy(this.points.matrixWorld).invert();
    this.origin.copy(this.raycaster.ray.origin).applyMatrix4(this.inverse);
    this.direction.copy(this.raycaster.ray.direction).transformDirection(this.inverse);
  }

  /** Intersect the current model-space ray with the model's z = 0 plane. */
  private planeHit() {
    if (Math.abs(this.direction.z) < 1e-4) return false;
    const t = -this.origin.z / this.direction.z;
    this.hit.copy(this.direction).multiplyScalar(t).add(this.origin);
    return true;
  }

  private syncShapes() {
    const c = this.cycle;
    const from = this.slots.get(c.from) ?? this.slots.get(c.to);
    const to = this.slots.get(c.to) ?? from;
    if (!from || !to) return;
    const u = this.material.uniforms;
    u.uFromSlot.value = from.slot;
    u.uToSlot.value = to.slot;
    u.uFromMotion.value.copy(from.motion);
    u.uToMotion.value.copy(to.motion);
    u.uFromEffect.value = from.effect;
    u.uToEffect.value = to.effect;
  }

  private syncInputs(reduced: boolean) {
    const u = this.material.uniforms;
    u.uTime.value = this.cycle.time;
    u.uSimTime.value = this.simTime;
    u.uElapsed.value = this.entrance.done ? this.cycle.elapsed : MORPH_DURATION;
    u.uMovement.value = reduced ? 0 : 1;
    u.uEntrance.value = reduced ? ENTRANCE_DURATION : this.entrance.elapsed;
    u.uScatter.value = reduced ? 0 : this.scatter;
    u.uDof.value = reduced ? 0 : 1;
  }

  private planSweep(fromClick: boolean) {
    this.transitions += 1;
    this.uniforms.uPhaseSeed.value = (this.transitions * 1.618) % 17;
    const sweep = this.uniforms.uSweep.value as THREE.Vector4;
    if (fromClick && this.clickPoint) {
      const [x, y] = this.clickPoint;
      // Normalise by the farthest corner so the radial sweep always spans the whole shape.
      let reach = 0;
      for (const [cx, cy] of SWEEP_CORNERS) reach = Math.max(reach, Math.hypot(cx - x, cy - y));
      sweep.set(x, y, 1, 1 / reach);
    } else {
      const angle = SWEEP_ANGLES[this.transitions % SWEEP_ANGLES.length];
      sweep.set(Math.cos(angle), Math.sin(angle), 0, 1 / (2 * SWEEP_EXTENT));
    }
    this.clickPoint = null;
  }

  /** Advances everything by one rendered frame; returns a new phase ID when the shape changed. */
  frame(renderer: THREE.WebGLRenderer, input: HeroFrame): number | null {
    const { active, reduced, interaction: pointer, camera } = input;
    const dt = input.resume || !active ? 0 : Math.min(Math.max(input.delta, 0), 0.05);
    const u = this.material.uniforms;
    const c = this.cycle;

    if (this.wasReduced && !reduced) this.needsReset = true;
    this.wasReduced = reduced;

    // 1. Entrance, then the autoplay cycle (which must not start before it).
    const entranceOptions = this.entranceOptions;
    entranceOptions.active = active;
    entranceOptions.reduced = reduced;
    entranceOptions.hold = input.holdEntrance;
    const entranceFinished = stepHeroEntrance(this.entrance, dt, entranceOptions);
    if (entranceFinished && !reduced) this.shock(0, 0, camera, reduced, 0.45);
    let changed: number | null = null;
    if (this.entrance.done) {
      const clicked = c.pending;
      this.cycleOptions.active = active;
      this.cycleOptions.reduced = reduced;
      changed = stepHeroCycle(c, dt, this.cycleOptions);
      if (changed !== null && !reduced && c.elapsed < MORPH_DURATION) this.planSweep(clicked);
    }
    if (dt > 0 && !reduced) this.simTime += dt;

    // 2. Scroll dispersal, smoothed so coarse scroll events still glide.
    this.scatter = reduced ? 0 : THREE.MathUtils.damp(this.scatter, input.scroll, 5, dt);

    // 3. Drag orbit (mouse only) plus the gentle pointer parallax.
    const dragX = pointer.dragX ?? 0;
    const dragY = pointer.dragY ?? 0;
    if (pointer.dragX !== undefined) pointer.dragX = 0;
    if (pointer.dragY !== undefined) pointer.dragY = 0;
    const inside = !reduced && pointer.inside;
    if (reduced) {
      this.orbit.yaw = this.orbit.pitch = this.orbit.yawVelocity = this.orbit.pitchVelocity = 0;
      this.tilt.x = this.tilt.y = 0;
    } else {
      this.orbitInput.dragging = Boolean(pointer.dragging);
      this.orbitInput.dx = dragX;
      this.orbitInput.dy = dragY;
      stepHeroOrbit(this.orbit, dt, this.orbitInput);
      const progress = THREE.MathUtils.smoothstep(c.elapsed, 0, MORPH_DURATION);
      const networkWeight = THREE.MathUtils.lerp(Number(c.from === 2), Number(c.to === 2), progress);
      const tiltX = inside ? -pointer.y * THREE.MathUtils.lerp(0.045, 0.028, networkWeight) : 0;
      const tiltY = inside ? pointer.x * THREE.MathUtils.lerp(0.065, 0.040, networkWeight) : 0;
      this.tilt.x = THREE.MathUtils.damp(this.tilt.x, tiltX, 3, dt);
      this.tilt.y = THREE.MathUtils.damp(this.tilt.y, tiltY, 3, dt);
    }
    this.points.rotation.set(this.tilt.x + this.orbit.pitch, this.tilt.y + this.orbit.yaw, 0);
    this.points.updateMatrixWorld();

    // 4. Network node hover: project each layer cuboid to a screen-space hit box.
    let hovered = -1;
    if (inside && this.entrance.done && c.to === 2 && c.elapsed >= MORPH_DURATION && this.scatter < 0.2) {
      const network = getHeroShape(2).motion;
      const angle = Math.sin(c.time * network.sway.speed) * network.sway.amplitude;
      let nearest = Infinity;
      const padX = 12 / Math.max(input.width, 1);
      const padY = 12 / Math.max(input.height, 1);
      for (let l = 0; l < this.networkLayers.length; l++) {
        const layer = this.networkLayers[l];
        let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
        for (let k = 0; k < layer.corners.length; k++) {
          this.probe.fromArray(layer.corners[k]).multiplyScalar(network.scale)
            .applyAxisAngle(this.axis, angle).applyMatrix4(this.points.matrixWorld).project(camera);
          left = Math.min(left, this.probe.x);
          right = Math.max(right, this.probe.x);
          bottom = Math.min(bottom, this.probe.y);
          top = Math.max(top, this.probe.y);
        }
        if (pointer.x < left - padX || pointer.x > right + padX || pointer.y < bottom - padY || pointer.y > top + padY) continue;
        const score = Math.abs(pointer.x - (left + right) / 2) / (right - left + padX * 2)
          + 0.15 * Math.abs(pointer.y - (top + bottom) / 2) / (top - bottom + padY * 2);
        if (score < nearest) { hovered = layer.id; nearest = score; }
      }
    }
    if (hovered >= 0 && hovered !== u.uHoverNode.value) {
      u.uHoverNode.value = hovered;
      this.hoverTime = 0;
    }
    const hoverTarget = hovered >= 0 ? 1 : 0;
    u.uHoverStrength.value = active && !reduced ? THREE.MathUtils.damp(u.uHoverStrength.value, hoverTarget, 12, dt) : hoverTarget;
    if (hovered < 0 && u.uHoverStrength.value < 0.002) u.uHoverNode.value = -1;
    if (active && !reduced) this.hoverTime += dt;
    u.uHoverTime.value = this.hoverTime;

    // 5. Pointer force field in model space. A hovered node is only nudged so it stays legible.
    const pointerTarget = inside ? (hovered >= 0 ? 0.35 : 1) : 0;
    this.pointerStrength = THREE.MathUtils.damp(this.pointerStrength, pointerTarget, inside ? 8 : 4, dt);
    const velocity = u.uPointerVelocity.value as THREE.Vector3;
    if (inside) {
      this.modelRay(pointer.x, pointer.y, camera);
      (u.uPointerOrigin.value as THREE.Vector3).copy(this.origin);
      (u.uPointerDir.value as THREE.Vector3).copy(this.direction);
      if (this.planeHit()) {
        if (this.hasLastHit && dt > 0) {
          this.probe.copy(this.hit).sub(this.lastHit).divideScalar(dt).clampLength(0, 6);
          velocity.lerp(this.probe, Math.min(1, dt * 12));
        }
        this.lastHit.copy(this.hit);
        this.hasLastHit = true;
      }
    } else {
      this.hasLastHit = false;
      velocity.multiplyScalar(Math.exp(-dt * 6));
    }
    u.uPointerStrength.value = reduced ? 0 : this.pointerStrength;

    // 6. Upload shared state, then advance the GPU simulation.
    this.syncShapes();
    this.syncInputs(reduced);
    u.uPixelRatio.value = input.pixelRatio;
    (u.uViewport.value as THREE.Vector2).set(input.width * input.pixelRatio, input.height * input.pixelRatio);
    // Keep the dot pattern's coverage consistent across canvas sizes and particle counts.
    u.uSize.value = 2.5 * Math.max(0.6, input.width / 560) * Math.sqrt(11000 / Math.max(this.count, 1));
    const simulate = this.sim !== null && !reduced;
    if (this.sim && simulate) {
      if (this.needsReset) {
        this.sim.reset(renderer);
        this.needsReset = false;
      }
      if (dt > 0) this.sim.step(renderer, Math.min(dt, PHYSICS_STEP));
      u.tPosition.value = this.sim.position;
      u.tVelocity.value = this.sim.velocity;
    } else {
      u.tPosition.value = this.placeholder;
      u.tVelocity.value = this.placeholder;
    }
    u.uSimulated.value = simulate ? 1 : 0;

    // 7. Shockwave rings (screen space, drawn only while visible).
    this.updateOverlay(input, reduced);

    if (dt > 0) {
      const instant = 1 / Math.max(input.delta, 1e-3);
      this.fps = this.fps === 0 ? instant : this.fps + (instant - this.fps) * Math.min(1, input.delta * 2.5);
    }
    return changed;
  }

  private include(x: number, y: number, radius: number) {
    const b = this.bounds;
    b.minX = Math.min(b.minX, x - radius / b.aspect);
    b.maxX = Math.max(b.maxX, x + radius / b.aspect);
    b.minY = Math.min(b.minY, y - radius);
    b.maxY = Math.max(b.maxY, y + radius);
  }

  private updateOverlay(input: HeroFrame, reduced: boolean) {
    const o = this.overlayMaterial.uniforms;
    const b = this.bounds;
    b.aspect = input.width / Math.max(input.height, 1);
    b.minX = b.minY = Infinity;
    b.maxX = b.maxY = -Infinity;
    o.uAspect.value = b.aspect;
    for (let index = 0; index < this.shocks.length; index++) {
      const shock = this.shocks[index];
      const ring = (index === 0 ? o.uRing0.value : o.uRing1.value) as THREE.Vector4;
      const age = this.simTime - shock.a.w;
      const life = HERO_TUNING.shockLife;
      if (reduced || shock.b.w <= 0 || age < 0 || age >= life) {
        ring.set(0, 0, 0, 0);
        continue;
      }
      const radius = (age * HERO_TUNING.shockSpeed) / (CAMERA_DISTANCE * HALF_FOV_TAN);
      const fade = (1 - age / life) ** 2 * Math.min(1, age * 12) * shock.b.w;
      ring.set(shock.x, shock.y, radius, fade * 0.55);
      this.include(shock.x, shock.y, radius + 0.12);
    }
    this.overlay.visible = b.minX < b.maxX;
    if (this.overlay.visible) {
      (o.uRect.value as THREE.Vector4).set(
        Math.max(-1, b.minX), Math.max(-1, b.minY), Math.min(1, b.maxX), Math.min(1, b.maxY),
      );
    }
  }

  writeTelemetry(target: HeroTelemetry, pointer: HeroInteraction, running: boolean, reduced: boolean) {
    target.phase = this.cycle.to;
    target.morphProgress = this.entrance.done ? morphProgress(this.cycle) : this.entrance.elapsed / ENTRANCE_DURATION;
    target.holdProgress = this.entrance.done ? holdProgress(this.cycle) : 0;
    target.particleCount = this.count;
    target.fps = running ? Math.round(this.fps * 10) / 10 : 0;
    target.pointer.x = pointer.x;
    target.pointer.y = pointer.y;
    target.pointer.inside = pointer.inside;
    target.mode = reduced ? "static" : this.mode;
    target.entrance = this.entrance.elapsed / ENTRANCE_DURATION;
    target.scatter = this.scatter;
    target.running = running;
  }

  dispose() {
    this.sim?.dispose();
    this.sim = null;
    this.points.geometry.dispose();
    this.material.dispose();
    this.overlay.geometry.dispose();
    this.overlayMaterial.dispose();
    for (const texture of this.textures) texture.dispose();
    this.placeholder.dispose();
    this.object.clear();
  }
}
