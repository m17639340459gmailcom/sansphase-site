import assert from "node:assert/strict";
import test from "node:test";
import { ATLAS_SOURCE_STARS, createNebulaMotion, sampleNebulaMask } from "../../src/community-atlas/nebula-motion.ts";
import { atlasSourceCrop } from "../../src/community-atlas/atlas-camera.ts";

function fixture(options: { noContext?: boolean; compileFails?: boolean; uploadFails?: boolean; lowPrecision?: boolean } = {}) {
  const calls = { uploads: 0, draws: 0, textureDeletes: 0, programDeletes: 0, bufferDeletes: 0, shaderDeletes: 0, releases: 0 };
  const shaderSources: string[] = [];
  const uniforms = new Map<string, number[]>();
  const listeners = new Map<string, EventListener>();
  let lost = false;
  const gl = {
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, TEXTURE_2D: 3553, TEXTURE0: 33984,
    TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243,
    CLAMP_TO_EDGE: 33071, LINEAR: 9729, RGBA: 6408, UNSIGNED_BYTE: 5121, FLOAT: 5126,
    TRIANGLES: 4, UNPACK_FLIP_Y_WEBGL: 37440, MAX_TEXTURE_SIZE: 3379, MAX_RENDERBUFFER_SIZE: 34024,
    HIGH_FLOAT: 36338, NO_ERROR: 0,
    createShader: () => ({}), shaderSource(_shader: WebGLShader, code: string) { shaderSources.push(code); }, compileShader() {},
    getShaderParameter: () => !options.compileFails,
    getShaderPrecisionFormat: () => ({ precision: options.lowPrecision ? 0 : 23 }),
    deleteShader() { calls.shaderDeletes++; },
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true,
    deleteProgram() { calls.programDeletes++; },
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, deleteBuffer() { calls.bufferDeletes++; },
    createTexture: () => ({}), bindTexture() {}, activeTexture() {}, texParameteri() {}, pixelStorei() {},
    texImage2D() { calls.uploads++; if (options.uploadFails) throw new Error("source unavailable"); },
    deleteTexture() { calls.textureDeletes++; },
    getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {},
    getUniformLocation: (_program: WebGLProgram, name: string) => ({ name }),
    uniform1i() {}, uniform1f(location: { name: string }, value: number) { uniforms.set(location.name, [value]); },
    uniform4f(location: { name: string }, ...values: number[]) { uniforms.set(location.name, values); },
    useProgram() {}, viewport() {}, drawArrays() { calls.draws++; },
    getParameter: () => 4096, getError: () => 0, isContextLost: () => lost,
    getExtension: () => ({ loseContext() { calls.releases++; } }),
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => options.noContext ? null : gl,
    addEventListener(name: string, listener: EventListener) { listeners.set(name, listener); },
    removeEventListener(name: string, listener: EventListener) { if (listeners.get(name) === listener) listeners.delete(name); },
  };
  return {
    canvas, calls, uniforms, listeners, shaderSources,
    factory: () => canvas as unknown as HTMLCanvasElement,
    lose() { lost = true; const event = new Event("webglcontextlost", { cancelable: true }); listeners.get(event.type)?.(event); return event; },
    restore() { lost = false; listeners.get("webglcontextrestored")?.(new Event("webglcontextrestored")); },
  };
}
const source = {} as CanvasImageSource;

test("internal flow starts from the artwork and excludes the aperture, edges and measured bright stars", () => {
  for (let y = 0; y <= 1; y += .05) for (let x = 0; x <= 1; x += .05) {
    assert.equal(sampleNebulaMask(x, y, 0), 0);
  }
  for (const time of [5, 25, 180, 3600]) {
    for (const [x, y] of ATLAS_SOURCE_STARS) {
      assert.equal(sampleNebulaMask(x / 1672, y / 941, time), 0);
    }
    for (const [x, y] of [[.5, .45], [.5, .5], [.43, .42], [.58, .43], [0, .4], [1, .4], [.4, 0], [.4, 1]]) {
      assert.equal(sampleNebulaMask(x!, y!, time), 0);
    }
  }
});


test("a loaded texture is reused and the rendered cover shares the overlay camera at all viewport shapes", () => {
  const f = fixture(), scene = createNebulaMotion(source, 1672, 941, { canvasFactory: f.factory, pixelRatio: 2 });
  assert.ok(scene);
  for (const [width, height] of [[1200, 800], [390, 720], [7680, 4320]]) {
    assert.equal(scene.render(width!, height!, 5), f.canvas);
    assert.ok(f.canvas.width * f.canvas.height <= 2_000_000);
    assert.ok(f.canvas.width <= 4096 && f.canvas.height <= 4096);
    assert.ok(f.canvas.width <= width! * 1.5 && f.canvas.height <= height! * 1.5);
    const [x, y, w, h] = f.uniforms.get("uCrop")!;
    const crop = atlasSourceCrop(width!, height!, 1672, 941);
    assert.deepEqual([x, y, w, h], [crop.x, crop.y, crop.width, crop.height]);
    assert.ok(Math.abs(w! * 1672 / (h! * 941) - width! / height!) < 1e-10);
    assert.ok(w! <= 1 && h! <= 1);
  }
  scene.render(1200, 800, 5);
  const before = [...f.uniforms];
  scene.render(1200, 800, 5);
  assert.deepEqual([...f.uniforms], before);
  assert.equal(f.calls.uploads, 1, "changing frame or viewport never reuploads the original image");
  assert.equal(f.calls.draws, 5);
  scene.render(1200, 800, 720);
  assert.equal(f.uniforms.get("uTime")![0], 0);
  assert.equal(f.uniforms.get("uReveal")![0], 1, "a wrapped shader clock cannot reset the image fade");
  scene.dispose();
});

test("context loss falls back, restoring recreates GPU resources and wakes the existing paused clock", () => {
  const f = fixture(); let changed = 0;
  const scene = createNebulaMotion(source, 1672, 941, { canvasFactory: f.factory, onChange() { changed++; } });
  assert.ok(scene);
  scene.render(1200, 800, 5);
  assert.ok(f.lose().defaultPrevented, "context restoration remains allowed");
  assert.equal(scene.render(1200, 800, 5), null);
  assert.equal(changed, 1);
  f.restore();
  assert.equal(changed, 2);
  assert.equal(f.calls.uploads, 2, "restored contexts need a fresh texture upload");
  assert.equal(scene.render(1200, 800, 5), f.canvas);
  scene.dispose();
});

test("dispose releases resources once and detached late restore callbacks cannot revive it", () => {
  const f = fixture(); let changed = 0;
  const scene = createNebulaMotion(source, 1672, 941, { canvasFactory: f.factory, onChange() { changed++; } });
  assert.ok(scene);
  const lateRestore = f.listeners.get("webglcontextrestored")!;
  scene.render(1200, 800, 5);
  scene.dispose(); scene.dispose();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.calls.textureDeletes, 1);
  assert.equal(f.calls.bufferDeletes, 1);
  assert.equal(f.calls.programDeletes, 1);
  assert.equal(f.calls.releases, 1, "disposed previews eagerly return their scarce WebGL context slot");
  assert.equal(f.canvas.width * f.canvas.height, 0);
  lateRestore(new Event("webglcontextrestored"));
  assert.equal(f.calls.uploads, 1);
  assert.equal(changed, 0);
  assert.equal(scene.render(1200, 800, 5), null);
});

test("older fragment hardware uses matching varying precision and still has a bounded render target", () => {
  const f = fixture({ lowPrecision: true });
  const scene = createNebulaMotion(source, 1672, 941, { canvasFactory: f.factory });
  assert.ok(scene);
  assert.equal(f.shaderSources.length, 2);
  assert.ok(f.shaderSources.every(code => code.includes("varying mediump vec2 vUv;")), "WebGL 1 varyings must agree across both shaders");
  assert.equal(scene.render(390, 720, 5), f.canvas);
  scene.dispose();
});

test("unavailable WebGL, failed shaders or image upload, and invalid viewports safely use the caller fallback", () => {
  for (const options of [{ noContext: true }, { compileFails: true }, { uploadFails: true }]) {
    const f = fixture(options);
    assert.equal(createNebulaMotion(source, 1672, 941, { canvasFactory: f.factory }), null);
    assert.equal(f.listeners.size, 0);
    if (options.uploadFails) assert.equal(f.calls.textureDeletes, 1);
  }
  assert.equal(createNebulaMotion(source, 0, 941), null);
  assert.equal(createNebulaMotion(source, 1672, 941, { canvasFactory() { throw new Error("no canvas"); } }), null);
  const f = fixture(), scene = createNebulaMotion(source, 1672, 941, { canvasFactory: f.factory });
  assert.ok(scene);
  for (const [w, h] of [[0, 600], [100, -1], [NaN, 400], [Infinity, 400]]) assert.equal(scene.render(w!, h!, 5), null);
  assert.equal(f.calls.draws, 0);
  assert.equal(scene.render(1200, 800, NaN), f.canvas);
  assert.equal(f.uniforms.get("uTime")![0], 0);
  scene.dispose();
});
