import {
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  CylinderGeometry,
  Matrix4,
  Vector2,
  Vector4,
  Vector3,
  Line3,
  ShaderMaterial,
  DataTexture,
  FloatType,
  RGBAFormat,
  NearestFilter,
  Color,
  NormalBlending,
} from "three";
import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js";
import { programs } from "./shaders.mjs";
const SIZE = 128,
  SEGMENTS = 12,
  SIDES = 3,
  COUNT = SIZE * SIZE;
const uniform = (value) => ({ value });
function texture() {
  const t = new DataTexture(
    new Float32Array(COUNT * 4),
    SIZE,
    SIZE,
    RGBAFormat,
    FloatType,
  );
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
// Published GenerateTube algorithm mapped to Three's BufferGeometry API.
// Extrusion and movement are performed by the original GLSL programs.
export function createTubeGeometry() {
  const cylinder = new CylinderGeometry(1, 1, 1, SIDES, SEGMENTS - 1, false);
  cylinder.applyMatrix4(new Matrix4().makeRotationZ(Math.PI / 2));
  const shape = cylinder.toNonIndexed(),
    position = shape.getAttribute("position");
  const angle = new Float32Array(position.count),
    index = new Float32Array(position.count),
    v = new Vector2();
  for (let i = 0; i < position.count; i++) {
    v.set(position.getY(i), position.getZ(i)).normalize();
    angle[i] = Math.atan2(v.y, v.x);
    index[i] = Math.abs(Math.round((position.getX(i) + 0.5) * (SEGMENTS - 2)));
  }
  const result = new InstancedBufferGeometry();
  result.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(position.count * 3), 3),
  );
  result.setAttribute("angle", new BufferAttribute(angle, 1));
  result.setAttribute("cIndex", new BufferAttribute(index, 1));
  result.setAttribute("tuv", shape.getAttribute("uv").clone());
  result.setAttribute("normal", shape.getAttribute("normal").clone());
  result.setAttribute("uv", shape.getAttribute("uv").clone());
  result.instanceCount = Math.floor(COUNT / SEGMENTS);
  result.setAttribute(
    "cNumber",
    new InstancedBufferAttribute(
      Float32Array.from({ length: result.instanceCount }, (_, i) => i),
      1,
    ),
  );
  cylinder.dispose();
  shape.dispose();
  return result;
}
// TubePlayer's release threshold and directional velocity, local input only.
export class TubeInput {
  constructor() {
    this.previous = null;
    this.lastEmission = null;
  }
  reset() {
    this.previous = this.lastEmission = null;
  }
  move(point, emit) {
    if (!this.previous) {
      this.previous = point.clone();
      this.lastEmission = point.clone();
      return;
    }
    const velocity = point
      .clone()
      .sub(this.previous)
      .normalize()
      .multiplyScalar(0.4);
    this.previous.copy(point);
    if (point.distanceTo(this.lastEmission) < 0.5) return;
    emit(point.clone(), velocity);
    this.lastEmission.copy(point);
  }
}
export class ReferenceTubes {
  constructor(renderer) {
    this.capacity = Math.floor(COUNT / SEGMENTS);
    this.next = 0;
    this.pending = [];
    this.disposed = false;
    this.emission = texture();
    this.velocity = texture();
    this.color = texture();
    this.indices = texture();
    this.random = texture();
    this.origin = texture();
    this.initialPosition = texture();
    this.initialLife = texture();
    this.ownedTextures = [
      this.emission,
      this.velocity,
      this.color,
      this.indices,
      this.random,
      this.origin,
      this.initialPosition,
      this.initialLife,
    ];
    for (let i = 0; i < COUNT; i++) {
      this.indices.image.data.set(
        [i % SEGMENTS, Math.floor(i / SEGMENTS), i % SEGMENTS === 0 ? 1 : 0, 1],
        i * 4,
      );
      this.random.image.data.set(
        [Math.random(), Math.random(), Math.random(), Math.random()],
        i * 4,
      );
      this.initialPosition.image.data[i * 4] = 9999;
    }
    this.geometry = createTubeGeometry();
    this.geometry.instanceCount = 0;
    this.material = new ShaderMaterial({
      vertexShader: programs.vertexShader,
      fragmentShader: programs.fragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: NormalBlending,
      toneMapped: false,
      uniforms: {
        time: uniform(0),
        resolution: uniform(new Vector2()),
        tPos: uniform(this.initialPosition),
        tLife: uniform(this.initialLife),
        tColor: uniform(this.color),
        tIndices: uniform(this.indices),
        textureSize: uniform(SIZE),
        lineSegments: uniform(SEGMENTS),
        radialSegments: uniform(SIDES),
        thickness: uniform(2),
        taper: uniform(0),
        tRefraction: uniform(null),
        tMRO: uniform(null),
        tMatcap: uniform(null),
        tNormal: uniform(null),
        uLight: uniform(new Vector4(1, 1, 1, 1)),
        uColor: uniform(new Color()),
        uNormalStrength: uniform(1),
      },
    });
    this.material.userData.referenceTubes = true;
    if (renderer) this.initialize(renderer);
  }
  initialize(renderer) {
    this.gpu = new GPUComputationRenderer(SIZE, SIZE, renderer);
    this.positionVariable = this.gpu.addVariable(
      "tInput",
      programs.positionShader,
      this.initialPosition,
    );
    this.lifeVariable = this.gpu.addVariable(
      "tSpawn",
      programs.lifecycleShader,
      this.initialLife,
    );
    this.gpu.setVariableDependencies(this.positionVariable, [
      this.positionVariable,
      this.lifeVariable,
    ]);
    this.gpu.setVariableDependencies(this.lifeVariable, [this.lifeVariable]);
    Object.assign(this.positionVariable.material.uniforms, {
      fSize: uniform(SIZE),
      time: uniform(0),
      HZ: uniform(1),
      timeScale: uniform(1),
      uMaxCount: uniform(SIZE),
      tOrigin: uniform(this.origin),
      tAttribs: uniform(this.random),
      tIndices: uniform(this.indices),
      tVelocity: uniform(this.velocity),
      textureSize: uniform(SIZE),
      lineSegments: uniform(SEGMENTS),
      uLerp: uniform(0.2),
      uResetDelta: uniform(1),
      uVelocityStrength: uniform(1),
      uCurlNoiseScale: uniform(0.5),
      uCurlTimeScale: uniform(1),
      uCurlNoiseSpeed: uniform(5),
    });
    Object.assign(this.lifeVariable.material.uniforms, {
      fSize: uniform(SIZE),
      time: uniform(0),
      HZ: uniform(1),
      timeScale: uniform(1),
      uMaxCount: uniform(SIZE),
      uSetup: uniform(0),
      tLife: uniform(this.emission),
      tAttribs: uniform(this.random),
      decay: uniform(1.73),
      decayRandom: uniform(new Vector2(1, 1)),
    });
    const error = this.gpu.init();
    if (error) {
      this.dispose();
      throw new Error(`Reference tube initialization: ${error}`);
    }
  }
  release(point, velocity, color, radius = 0.3) {
    const start = this.next * SEGMENTS;
    this.next = (this.next + 1) % this.capacity;
    this.geometry.instanceCount = Math.max(
      this.geometry.instanceCount,
      start / SEGMENTS + 1,
    );
    const pos = [
      point.x + (Math.random() * 2 - 1) * radius,
      point.y + (Math.random() * 2 - 1) * radius,
      point.z + (Math.random() * 2 - 1) * radius,
    ];
    // Give a newborn chain its measured direction before its first draw. All
    // nodes at one coincident point have no tangent; the first head movement
    // then exposes a sideways cap. Seed only one tube diameter of straight
    // geometry with Three's Line3; the original GPU movement takes over next.
    const head = new Vector3(...pos);
    const birthLength = this.material.uniforms.thickness.value * 0.13;
    const spine = new Line3(
      head,
      head.clone().addScaledVector(velocity.clone().normalize(), -birthLength),
    );
    const spawnPoint = new Vector3();
    for (let i = start; i < start + SEGMENTS; i++) {
      spine.at((i - start) / (SEGMENTS - 1), spawnPoint);
      this.emission.image.data.set(
        [1, spawnPoint.x, spawnPoint.y, spawnPoint.z],
        i * 4,
      );
      this.velocity.image.data.set(
        [velocity.x, velocity.y, velocity.z, 0],
        i * 4,
      );
      this.color.image.data.set([color.r, color.g, color.b, 1], i * 4);
      this.pending.push(i);
    }
    this.emission.needsUpdate =
      this.velocity.needsUpdate =
      this.color.needsUpdate =
        true;
  }
  update(time) {
    if (!this.gpu || this.disposed || this.geometry.instanceCount === 0) return;
    this.positionVariable.material.uniforms.time.value = time;
    this.lifeVariable.material.uniforms.time.value = time;
    this.gpu.compute();
    this.material.uniforms.tPos.value = this.gpu.getCurrentRenderTarget(
      this.positionVariable,
    ).texture;
    this.material.uniforms.tLife.value = this.gpu.getCurrentRenderTarget(
      this.lifeVariable,
    ).texture;
    for (const i of this.pending) this.emission.image.data[i * 4] = 0;
    if (this.pending.length) this.emission.needsUpdate = true;
    this.pending.length = 0;
  }
  reset() {
    this.emission.image.data.fill(0);
    this.emission.needsUpdate = true;
    this.next = 0;
    this.pending.length = 0;
    this.geometry.instanceCount = 0;
    if (this.gpu)
      for (const v of [this.positionVariable, this.lifeVariable])
        for (const target of v.renderTargets)
          this.gpu.renderTexture(v.initialValueTexture, target);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.gpu?.dispose();
    for (const t of this.ownedTextures)
      if (!this.gpu || (t !== this.initialPosition && t !== this.initialLife))
        t.dispose();
  }
}
