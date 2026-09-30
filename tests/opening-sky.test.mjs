import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Texture, WebGLCoordinateSystem, ACESFilmicToneMapping, NoToneMapping } from 'three';

await build({ entryPoints: ['src/opening-sky.ts'], outfile: 'outputs/verification/opening-sky-test.mjs', bundle: true, platform: 'node', format: 'esm', loader: { '.glsl': 'text' }, external: ['three'] });
const { bakeOpeningSky, openingSkyResolution } = await import('../outputs/verification/opening-sky-test.mjs');

test('sky detail retains the legacy resolution within the GPU texture limit', () => {
  assert.equal(openingSkyResolution(1440, 16384), 1536);
  assert.equal(openingSkyResolution(640, 16384), 1024);
  assert.equal(openingSkyResolution(699, 16384), 1024);
  assert.equal(openingSkyResolution(700, 16384), 1536);
  assert.equal(openingSkyResolution(1920, 1024), 1024);
  assert.equal(openingSkyResolution(640, 512), 512);
});

function rendererFixture(fail = false) {
  const original = { name: 'active-page-target' };
  const renderer = {
    coordinateSystem: WebGLCoordinateSystem, reversedDepthBuffer: false,
    toneMapping: ACESFilmicToneMapping, autoClear: false, xr: { enabled: true },
    current: original, face: 2, mip: 1, renders: 0, materials: new Set(), geometry: null,
    getRenderTarget() { return this.current; },
    getActiveCubeFace() { return this.face; },
    getActiveMipmapLevel() { return this.mip; },
    setRenderTarget(target, face = 0, mip = 0) { this.current = target; this.face = face; this.mip = mip; },
    render(scene) {
      this.bakedTarget = this.current;
      this.renders++;
      assert.equal(this.toneMapping, NoToneMapping, 'baking must not tone-map the sky twice');
      assert.equal(this.autoClear, true, 'each cube face must be cleared independently');
      assert.equal(scene.backgroundIntensity, 0.8);
      assert.deepEqual(scene.children.map(m => m.material.uniforms.uColor.value.toArray()), [[0.045, 0.22, 0.65], [0.32, 0.06, 0.38]]);
      for (const mesh of scene.children) {
        if (!this.materials.has(mesh.material)) {
          this.materials.add(mesh.material);
          mesh.material.addEventListener('dispose', () => { this.materialDisposals = (this.materialDisposals || 0) + 1; });
        }
      }
      if (!this.geometry) {
        this.geometry = scene.children[0].geometry;
        this.geometry.addEventListener('dispose', () => { this.geometryDisposed = true; });
        this.bakedTarget.addEventListener('dispose', () => { this.targetDisposed = true; });
      }
      if (fail) throw Error('GPU bake failed');
    },
  };
  return { renderer, original };
}

for (const fail of [false, true]) test(`sky bake restores the live renderer and releases temporary GPU objects (${fail ? 'failure' : 'success'})`, () => {
  const { renderer, original } = rendererFixture(fail);
  const photo = new Texture();
  let photoDisposed = false;
  photo.addEventListener('dispose', () => { photoDisposed = true; });
  if (fail) assert.throws(() => bakeOpeningSky(renderer, photo, 64), /GPU bake failed/);
  else {
    const target = bakeOpeningSky(renderer, photo, 64);
    assert.equal(renderer.renders, 6, 'the static legacy sky is baked once, not per frame');
    assert.equal(target.width, 64);
    assert.equal(target.texture.isCubeTexture, true);
    assert.equal(renderer.targetDisposed, undefined, 'the returned texture stays alive for the black hole');
    target.dispose();
  }
  assert.equal(renderer.current, original);
  assert.equal(renderer.face, 2);
  assert.equal(renderer.mip, 1);
  assert.equal(renderer.toneMapping, ACESFilmicToneMapping);
  assert.equal(renderer.autoClear, false);
  assert.equal(renderer.xr.enabled, true);
  assert.equal(renderer.materialDisposals, 2);
  assert.equal(renderer.geometryDisposed, true);
  assert.equal(renderer.targetDisposed, true);
  assert.equal(photoDisposed, false, 'the shared photograph belongs to the texture cache');
});
