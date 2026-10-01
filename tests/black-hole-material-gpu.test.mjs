import test from 'node:test';
import assert from 'node:assert/strict';
import { plasmaMaterial } from '../src/black-hole-plasma.ts';
import { rayFragment } from '../src/black-hole-shaders.ts';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

// Explicit opt-in keeps the ordinary Node suite usable without Chrome/GPU.
const browser = process.env.SANSPHASE_WEBGL_TEST_BROWSER;
test('actual GLSL: inner flow stays resolved, moving and continuous at late times',
  { skip: !browser, timeout: 60000 }, async () => {
    const check = (material, ray) => {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 128;
      const gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('WebGL2 is required for this explicit GPU test');
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      const program = source => {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}'));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\n' + source));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        gl.useProgram(p); return p;
      };
      const materialProgram = program('uniform float uTime,uFormationTurn,uScale,uFocal,uHeat;uniform vec3 uCam;uniform vec4 uFormation;out vec4 color;\n' + material + '\nvoid main(){float r=3.3+gl_FragCoord.x/256.0*1.5;float phi=gl_FragCoord.y/128.0*6.2831853;float v=gasStructure(r,phi).y;color=vec4(v,v,v,1);}');
      const pixels = () => {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const bytes = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        const error = gl.getError();
        if (error) throw new Error(`Actual GPU execution failed: ${error}`);
        return Array.from({ length: bytes.length / 4 }, (_, i) => bytes[i * 4]);
      };
      const sample = time => {
        gl.uniform1f(gl.getUniformLocation(materialProgram, 'uTime'), time);
        return pixels();
      };
      const difference = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
      const variance = a => {
        const mean = a.reduce((sum, v) => sum + v, 0) / a.length;
        return a.reduce((sum, v) => sum + (v - mean) ** 2, 0) / a.length;
      };
      const contrast = [40, 80, 180, 600, 3600].map(t => variance(sample(t)));
      const continuity = [20, 30, 40, 50, 600].map(t => difference(sample(t - .001), sample(t + .001)));
      const motion = difference(sample(180), sample(183));
      // Compile AND draw the full shader: D3D drivers may fail only at draw.
      const p = program(ray);
      const loc = name => gl.getUniformLocation(p, name);
      for (const [key, value] of Object.entries({ uTime: 180, uScale: 64, uFocal: 1.62, uHeat: 1, uRoll: -.2 }))
        gl.uniform1f(loc(key), value);
      gl.uniform2f(loc('uCenter'), 128, 64);
      gl.uniform3f(loc('uCam'), 5.5, 3.2, -12.5);
      gl.uniform4f(loc('uFormation'), 1, 1, 0, 0);
      const rendered = pixels();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return { contrast, continuity, motion, brightest: Math.max(...rendered) };
    };
    const result = await evaluateInWebGLBrowser(browser,
      `(${check.toString()})(${JSON.stringify(plasmaMaterial)},${JSON.stringify(rayFragment)})`);
    assert.ok(result.contrast.every(v => v > 40), 'late flow must retain broad patches, not shear into filtered grey');
    assert.ok(result.continuity.every(v => v < 1), 'renewal boundaries must not flash');
    assert.ok(result.motion > 2, 'filtering must not freeze the inner flow');
    assert.ok(result.brightest > 10, 'the full ray shader must actually render');
    console.log('Inner flow GPU checks:', result);
  });
