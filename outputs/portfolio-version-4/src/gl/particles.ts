// The hero's recent-post cover as ~80k GPU points that hold the image like a
// fine LED wall. A morph bursts one cover into a 3D cloud and re-forms it as
// the next; the pointer pushes a glowing crater into it.
import {
  BufferGeometry,
  Float32BufferAttribute,
  LinearFilter,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
} from 'three';
import type { Texture } from 'three';

export type Rect = { x: number; y: number; w: number; h: number };

const vertexShader = /* glsl */ `
attribute vec2 aGrid;
attribute vec4 aRand;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform vec2 uCoverA;
uniform vec2 uCoverB;
uniform vec2 uPlane;
uniform float uMorph;
uniform float uScatter;
uniform float uHover;
uniform vec2 uMouse;
uniform float uTime;
uniform float uPoint;
uniform float uPixelRatio;
uniform float uCameraZ;
uniform float uCalm;
uniform float uRadius;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 uvA = (aGrid - 0.5) * uCoverA + 0.5;
  vec2 uvB = (aGrid - 0.5) * uCoverB + 0.5;
  vec3 colourA = texture2D(uTexA, uvA).rgb;
  vec3 colourB = texture2D(uTexB, uvB).rgb;

  // The morph sweeps left to right with a little jitter.
  float delay = aGrid.x * 0.32 + aRand.x * 0.18;
  float m = clamp((uMorph - delay) / 0.5, 0.0, 1.0);
  float burst = sin(m * 3.14159265);
  float s = max(burst, uScatter);

  vec3 base = vec3((aGrid - 0.5) * uPlane, 0.0);
  vec3 dir = normalize(vec3(aRand.y - 0.5, aRand.z - 0.5, 0.25 + aRand.w * 0.75));
  float reach = (0.35 + aRand.x * 1.1) * uPlane.x * 0.34;
  vec3 swirl = vec3(sin(uTime * 0.8 + aRand.y * 6.2831), cos(uTime * 0.7 + aRand.z * 6.2831), sin(uTime * 0.5 + aRand.w * 6.2831));
  vec3 pos = base + dir * reach * s + swirl * uPlane.x * 0.035 * s;

  // Pointer crater: particles are pushed out and lifted toward the viewer.
  vec2 d = base.xy - uMouse;
  float r = length(d) / uPlane.x;
  float f = exp(-r * r / 0.0065) * uHover * (1.0 - s);
  pos.xy += normalize(d + 1e-5) * f * uPlane.x * 0.055;
  pos.z += f * uPlane.x * 0.16;

  // A slow breath across the surface when nothing else is happening.
  pos.z += sin(aGrid.x * 9.0 + uTime * 1.1) * cos(aGrid.y * 7.0 + uTime * 0.8) * uPlane.x * 0.004 * uCalm;

  vec3 colour = mix(colourA, colourB, smoothstep(0.35, 0.65, m));
  vColor = colour * (1.0 + f * 0.9) + vec3(0.17, 0.24, 1.0) * f * 0.25;

  // Rounded card corners.
  vec2 q = abs(aGrid - 0.5) * uPlane - (0.5 * uPlane - uRadius);
  float corner = length(max(q, 0.0)) - uRadius;
  vAlpha = (1.0 - step(0.0, corner)) * mix(1.0, 0.75, s);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  // Assembled, the points overlap enough to read as a clean image; once they
  // move they shrink to distinct grains.
  float grain = mix(1.6, 0.95, max(s, f));
  gl_PointSize = uPoint * uPixelRatio * (uCameraZ / -mv.z) * grain * (1.0 + s * 0.5);
}`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.36, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}`;

export class ParticleGallery {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.1, 200);
  readonly material: ShaderMaterial;
  readonly points: Points;
  readonly textures: (Texture | null)[];
  readonly aspects: number[];
  hover = 0;
  private hoverTarget = 0;
  private readonly cols: number;
  private readonly rows: number;
  private planeW = 1;
  private planeH = 1;
  private pxToWorld = 1;
  private media: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private readonly cameraZ = 10;

  constructor(urls: string[], onLoad: () => void) {
    this.cols = 380;
    this.rows = Math.round(this.cols * (9 / 16));
    const count = this.cols * this.rows;
    const grid = new Float32Array(count * 2);
    const rand = new Float32Array(count * 4);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        grid[i * 2] = (x + 0.5) / this.cols;
        grid[i * 2 + 1] = (y + 0.5) / this.rows;
        for (let k = 0; k < 4; k++) rand[i * 4 + k] = Math.random();
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aGrid', new Float32BufferAttribute(grid, 2));
    geometry.setAttribute('aRand', new Float32BufferAttribute(rand, 4));
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: NormalBlending,
      toneMapped: false,
      uniforms: {
        uTexA: { value: null },
        uTexB: { value: null },
        uCoverA: { value: new Vector2(1, 1) },
        uCoverB: { value: new Vector2(1, 1) },
        uPlane: { value: new Vector2(1, 0.5625) },
        uMorph: { value: 0 },
        uScatter: { value: 1 },
        uHover: { value: 0 },
        uMouse: { value: new Vector2(9, 9) },
        uTime: { value: 0 },
        uPoint: { value: 2 },
        uPixelRatio: { value: 1 },
        uCameraZ: { value: this.cameraZ },
        uCalm: { value: 1 },
        uRadius: { value: 0.02 },
      },
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.camera.position.set(0, 0, this.cameraZ);
    this.textures = urls.map(() => null);
    this.aspects = urls.map(() => 16 / 9);
    const loader = new TextureLoader();
    let pending = urls.length;
    urls.forEach((url, i) => {
      loader.load(
        url,
        (texture) => {
          texture.colorSpace = SRGBColorSpace;
          texture.minFilter = LinearFilter;
          texture.generateMipmaps = false;
          const image = texture.image as { width: number; height: number };
          this.aspects[i] = image.width / Math.max(1, image.height);
          this.textures[i] = texture;
          if (--pending === 0) onLoad();
        },
        undefined,
        () => {
          if (--pending === 0) onLoad();
        },
      );
    });
  }

  private cover(i: number) {
    const plane = this.planeW / this.planeH;
    const image = this.aspects[i] ?? plane;
    return new Vector2(Math.min(1, plane / image), Math.min(1, image / plane));
  }

  // media: the canvas box in viewport CSS pixels (the canvas fills it).
  layout(media: Rect, pixelRatio: number) {
    this.media = media;
    this.camera.aspect = media.w / Math.max(1, media.h);
    this.camera.updateProjectionMatrix();
    const viewH = 2 * this.cameraZ * Math.tan((this.camera.fov * Math.PI) / 360);
    this.pxToWorld = viewH / Math.max(1, media.h);
    this.planeW = media.w * this.pxToWorld;
    this.planeH = media.h * this.pxToWorld;
    this.points.position.set(0, 0, 0);
    const u = this.material.uniforms;
    u.uPlane.value.set(this.planeW, this.planeH);
    u.uPoint.value = media.w / this.cols;
    u.uPixelRatio.value = pixelRatio;
    u.uRadius.value = 14 * this.pxToWorld;
  }

  // f: fractional project index driven by scroll; scatter: 1 = cloud, 0 = card.
  set(f: number, scatter: number) {
    const n = this.textures.length;
    const clamped = Math.min(n - 1, Math.max(0, f));
    const i = Math.min(n - 2, Math.floor(clamped));
    const frac = clamped - i;
    const morph = frac <= 0.18 ? 0 : frac >= 0.82 ? 1 : (frac - 0.18) / 0.64;
    const u = this.material.uniforms;
    u.uTexA.value = this.textures[i] ?? this.textures.find(Boolean) ?? null;
    u.uTexB.value = this.textures[i + 1] ?? u.uTexA.value;
    u.uCoverA.value.copy(this.cover(i));
    u.uCoverB.value.copy(this.cover(i + 1));
    u.uMorph.value = morph;
    u.uScatter.value = scatter;
    return morph < 0.5 ? i : i + 1;
  }

  // Pointer in viewport CSS pixels; null when it is elsewhere.
  pointer(x: number | null, y: number | null) {
    if (x === null || y === null) {
      this.hoverTarget = 0;
      return false;
    }
    const m = this.media;
    const inside = x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h;
    this.hoverTarget = inside ? 1 : 0;
    const local = this.material.uniforms.uMouse.value;
    local.set((x - (m.x + m.w / 2)) * this.pxToWorld, -(y - (m.y + m.h / 2)) * this.pxToWorld);
    return inside;
  }

  calm(value: number) {
    this.material.uniforms.uCalm.value = value;
  }

  update(dt: number, time: number) {
    this.hover += (this.hoverTarget - this.hover) * (1 - Math.exp(-dt * 6));
    const u = this.material.uniforms;
    u.uHover.value = this.hover;
    u.uTime.value = time;
  }

}
