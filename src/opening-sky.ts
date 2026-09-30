import {
  AdditiveBlending, BackSide, CubeCamera, EquirectangularReflectionMapping,
  HalfFloatType, LinearMipmapLinearFilter, LinearSRGBColorSpace, Matrix4, Mesh,
  NoToneMapping, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector3,
  WebGLCubeRenderTarget,
} from 'three';
import type { Texture, WebGLRenderer } from 'three';
import source from './vendor/space-3d/nebula.glsl';
import noise from './vendor/space-3d/classic-noise-4d.glsl';

// The pre-visual-upgrade panorama's exact Space-3D layers and exposure.
// Keep these shared with the archived scene component rather than inventing a tint.
export const openingSkyIntensity = 0.72;
export const openingPhotoIntensity = 0.8;
// Match the legacy panorama's detail; never silently halve it for narrow windows.
export function openingSkyResolution(width: number, maxCubeSize: number) {
  return Math.min(width < 700 ? 1024 : 1536, maxCubeSize);
}
export const openingSkyLayers = [
  { color: [0.045, 0.22, 0.65], offset: [12.3, 28.1, 6.8], scale: 0.55, intensity: 1.05, falloff: 5.5 },
  { color: [0.32, 0.06, 0.38], offset: [-21.7, 11.4, 40.2], scale: 0.8, intensity: 1.05, falloff: 6 },
] as const;
type NebulaSpec = {
  color: readonly [number, number, number]; offset: readonly [number, number, number];
  scale: number; intensity: number; falloff: number;
};
const [vertexShader, fragmentShader] = source
  .replace(/#version 100/g, '')
  .replace('__noise4d__', noise)
  .replace('vec3 displace;', 'vec3 displace = vec3(0.0);')
  .split('__split__');

export function createNebulaMaterial(spec: NebulaSpec) {
  return new ShaderMaterial({
    vertexShader, fragmentShader, side: BackSide, transparent: true,
    blending: AdditiveBlending, depthWrite: false, depthTest: false,
    uniforms: {
      uModel: { value: new Matrix4() }, uView: { value: new Matrix4() },
      uProjection: { value: new Matrix4() }, uColor: { value: new Vector3(...spec.color) },
      uOffset: { value: new Vector3(...spec.offset) }, uScale: { value: spec.scale },
      uIntensity: { value: spec.intensity }, uFalloff: { value: spec.falloff },
    },
  });
}

// Bake the existing photograph and nebula once. The black hole samples this cube
// along its bent light rays; no procedural nebula is evaluated per display frame.
// The caller owns the returned target, but the shared photograph is never disposed.
export function bakeOpeningSky(renderer: WebGLRenderer, photo: Texture, resolution = 1536) {
  photo.mapping = EquirectangularReflectionMapping;
  photo.colorSpace = SRGBColorSpace;
  photo.needsUpdate = true;
  const scene = new Scene();
  scene.background = photo;
  scene.backgroundIntensity = openingPhotoIntensity;
  const geometry = new SphereGeometry(50, 32, 16);
  geometry.setAttribute('aPosition', geometry.getAttribute('position'));
  const materials = openingSkyLayers.map(createNebulaMaterial);
  for (const material of materials) {
    const mesh = new Mesh(geometry, material);
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      material.uniforms.uModel.value.copy(mesh.matrixWorld);
      material.uniforms.uView.value.copy(camera.matrixWorldInverse);
      material.uniforms.uProjection.value.copy(camera.projectionMatrix);
    };
    scene.add(mesh);
  }
  const target = new WebGLCubeRenderTarget(resolution, {
    type: HalfFloatType, colorSpace: LinearSRGBColorSpace,
    generateMipmaps: true, minFilter: LinearMipmapLinearFilter, depthBuffer: false,
  });
  const camera = new CubeCamera(0.1, 100, target);
  const previous = {
    target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(),
    mip: renderer.getActiveMipmapLevel(), toneMapping: renderer.toneMapping,
    autoClear: renderer.autoClear, xr: renderer.xr.enabled,
  };
  try {
    renderer.toneMapping = NoToneMapping;
    renderer.autoClear = true;
    camera.update(renderer, scene);
    return target;
  } catch (error) {
    target.dispose();
    throw error;
  } finally {
    renderer.setRenderTarget(previous.target, previous.face, previous.mip);
    renderer.toneMapping = previous.toneMapping;
    renderer.autoClear = previous.autoClear;
    renderer.xr.enabled = previous.xr;
    geometry.dispose();
    for (const material of materials) material.dispose();
  }
}
