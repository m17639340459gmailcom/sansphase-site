import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// GPU allocation is a test double; React, the downloaded components and OGL
// vector maths are real. This verifies our lifecycle/event adapters, not pixels.
test("React Bits canvases survive pause/resume and release every loop/resource on unmount", async () => {
  const shim = `
    import {Vec3} from 'ogl/src/math/Vec3.js';
    import {Color} from 'ogl/src/math/Color.js';
    export {Vec3,Color};
    const record=globalThis.__gpuRecords;
    export class Renderer {
      constructor(){const canvas=document.createElement('canvas');this.gl={canvas,clearColor(){},enable(){},blendFunc(){},getExtension:()=>({loseContext(){record.lost++}})};record.renderers++;}
      setSize(w,h){this.gl.canvas.width=w;this.gl.canvas.height=h;}
      render(){record.frames++;}
    }
    export class Transform {}
    export class Program {constructor(gl,options){this.uniforms=options.uniforms;}remove(){record.programs++;}}
    export class Triangle {remove(){record.geometries++;}}
    export class Mesh {constructor(gl,o){Object.assign(this,o)}setParent(){}}
    export class Polyline {constructor(gl,options){this.geometry=new Triangle();this.program=new Program(gl,options);this.mesh=new Mesh(gl,{geometry:this.geometry,program:this.program});}resize(){}updateGeometry(){}}
  `;
  const bundled = await build({
    stdin: {
      contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import Ribbons from './src/vendor/react-bits/Ribbons.jsx';import Galaxy from './src/vendor/react-bits/Galaxy.jsx';
    const colors=['#d3e3ff','#7699dc','#a0a0d4'],clear=[0,0,0,0],focal=[.5,.5],rotation=[1,0];
    export function mount(container){const root=createRoot(container);return {update(paused){flushSync(()=>root.render(<><Ribbons paused={paused} eventSource={container} colors={colors} backgroundColor={clear}/><Galaxy paused={paused} eventSource={container} focal={focal} rotation={rotation}/></>));},dispose(){root.unmount();}};}
  `,
      resolveDir: process.cwd(),
      loader: "jsx",
    },
    bundle: true,
    write: false,
    outfile: "effects.mjs",
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "gpu-test-double",
        setup(b) {
          b.onResolve({ filter: /^ogl$/ }, () => ({
            path: "ogl",
            namespace: "gpu-test-double",
          }));
          b.onLoad({ filter: /.*/, namespace: "gpu-test-double" }, () => ({
            contents: shim,
            loader: "js",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const dom = new JSDOM('<div id="stage"></div>', {
      pretendToBeVisual: true,
      runScripts: "outside-only",
    }),
    w = dom.window;
  Object.defineProperties(w.HTMLElement.prototype, {
    clientWidth: { get: () => 1600 },
    offsetWidth: { get: () => 1600 },
    clientHeight: { get: () => 900 },
    offsetHeight: { get: () => 900 },
  });
  w.HTMLElement.prototype.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 1600,
    height: 900,
  });
  const records = (w.__gpuRecords = {
    renderers: 0,
    frames: 0,
    lost: 0,
    programs: 0,
    geometries: 0,
  });
  let id = 0,
    time = 0;
  const raf = new Map();
  w.requestAnimationFrame = (cb) => {
    raf.set(++id, cb);
    return id;
  };
  w.cancelAnimationFrame = (key) => raf.delete(key);
  w.performance.now = () => time;
  const module = new vm.SourceTextModule(
    bundled.outputFiles.find((f) => f.path.endsWith(".mjs")).text,
    { context: dom.getInternalVMContext() },
  );
  await module.link(() => {
    throw Error("unexpected external import");
  });
  await module.evaluate();
  const stage = w.document.querySelector("#stage"),
    api = module.namespace.mount(stage);
  const frame = () => {
    time += 16.67;
    const callbacks = [...raf.values()];
    raf.clear();
    callbacks.forEach((cb) => cb(time));
  };
  api.update(false);
  for (let i = 0; i < 8; i++) frame();
  const canvases = [...stage.querySelectorAll("canvas")];
  assert.equal(canvases.length, 2);
  assert.equal(records.renderers, 2);
  assert.equal(raf.size, 2);
  stage.dispatchEvent(
    new w.MouseEvent("mouseenter", { clientX: 200, clientY: 300 }),
  );
  stage.dispatchEvent(
    new w.MouseEvent("mousemove", { clientX: 750, clientY: 450 }),
  );
  frame();
  api.update(true);
  const pausedFrames = records.frames;
  assert.equal(raf.size, 0);
  for (let i = 0; i < 8; i++) frame();
  assert.equal(records.frames, pausedFrames);
  assert.deepEqual([...stage.querySelectorAll("canvas")], canvases);
  api.update(false);
  assert.equal(records.renderers, 2);
  assert.equal(raf.size, 2);
  frame();
  api.dispose();
  assert.equal(raf.size, 0);
  assert.equal(records.lost, 2);
  assert.equal(records.programs, 4);
  assert.equal(records.geometries, 4);
  assert.equal(stage.querySelectorAll("canvas").length, 0);
  dom.window.close();
});
