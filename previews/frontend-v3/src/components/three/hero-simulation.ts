import * as THREE from "three";
import { simulationFragmentShader, simulationVertexShader } from "./hero-shaders";

/**
 * GPGPU particle state: two ping-ponged MRT render targets hold position
 * (xyz + interaction heat) and velocity. One full-screen pass integrates both
 * (semi-implicit Euler), which halves the passes of a separate
 * position/velocity setup and keeps stiff springs stable.
 */

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

export function rendererName(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return typeof name === "string" ? name : "";
}

export function isSoftwareRenderer(renderer: THREE.WebGLRenderer) {
  return SOFTWARE_RENDERER.test(rendererName(renderer));
}

/** The float type the simulation can render into, or null for the stateless fallback. */
export function detectSimulationType(renderer: THREE.WebGLRenderer): THREE.TextureDataType | null {
  const gl = renderer.getContext();
  if (typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) return null;
  if (renderer.capabilities.maxVertexTextures < 6 || renderer.capabilities.maxTextures < 6) return null;
  if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < 2 || isSoftwareRenderer(renderer)) return null;
  if (renderer.extensions.has("EXT_color_buffer_float")) return THREE.FloatType;
  if (renderer.extensions.has("EXT_color_buffer_half_float")) return THREE.HalfFloatType;
  return null;
}

export class HeroSimulation {
  readonly material: THREE.ShaderMaterial;
  private readonly targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly mesh: THREE.Mesh;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private current = 0;

  constructor(
    readonly side: number,
    readonly type: THREE.TextureDataType,
    shared: Record<string, THREE.IUniform>,
  ) {
    const options: THREE.RenderTargetOptions = {
      type,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
      count: 2,
    };
    this.targets = [new THREE.WebGLRenderTarget(side, side, options), new THREE.WebGLRenderTarget(side, side, options)];
    this.material = new THREE.ShaderMaterial({
      name: "HeroSimulation",
      glslVersion: THREE.GLSL3,
      defines: { SIDE: side },
      uniforms: {
        ...shared,
        tPosition: { value: null },
        tVelocity: { value: null },
        uDt: { value: 0 },
        uReset: { value: 0 },
      },
      vertexShader: simulationVertexShader,
      fragmentShader: simulationFragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    // One oversized triangle covers the whole target without a diagonal seam.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  get position(): THREE.Texture {
    return this.targets[this.current].textures[0];
  }

  get velocity(): THREE.Texture {
    return this.targets[this.current].textures[1];
  }

  private draw(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, this.camera);
    renderer.setRenderTarget(previous);
  }

  /** Compile without blocking the main thread where KHR_parallel_shader_compile exists. */
  compile(renderer: THREE.WebGLRenderer) {
    return renderer.compileAsync(this.mesh, this.camera);
  }

  /** Place every particle on its current guide with zero velocity (both buffers). */
  reset(renderer: THREE.WebGLRenderer) {
    const uniforms = this.material.uniforms;
    uniforms.uReset.value = 1;
    for (const target of this.targets) {
      const other = target === this.targets[0] ? this.targets[1] : this.targets[0];
      uniforms.tPosition.value = other.textures[0];
      uniforms.tVelocity.value = other.textures[1];
      this.draw(renderer, target);
    }
    uniforms.uReset.value = 0;
  }

  step(renderer: THREE.WebGLRenderer, dt: number) {
    const source = this.targets[this.current];
    const target = this.targets[1 - this.current];
    const uniforms = this.material.uniforms;
    uniforms.tPosition.value = source.textures[0];
    uniforms.tVelocity.value = source.textures[1];
    uniforms.uDt.value = dt;
    this.draw(renderer, target);
    this.current = 1 - this.current;
  }

  /**
   * Verify the float MRT really works on this device (complete framebuffer,
   * finite values). Float targets are read back once; half-float targets are
   * trusted after the completeness check to avoid unsupported readPixels calls.
   */
  verify(renderer: THREE.WebGLRenderer): boolean {
    const gl = renderer.getContext();
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.targets[this.current]);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    renderer.setRenderTarget(previous);
    if (!complete) return false;
    if (this.type !== THREE.FloatType) return true;
    const pixel = new Float32Array(4);
    const probes: [number, number][] = [[0, 0], [this.side - 1, this.side - 1], [this.side >> 1, this.side >> 2]];
    let magnitude = 0;
    for (const [x, y] of probes) {
      renderer.readRenderTargetPixels(this.targets[this.current], x, y, 1, 1, pixel, undefined, 0);
      for (const value of pixel) {
        if (!Number.isFinite(value) || Math.abs(value) > 100) return false;
        magnitude += Math.abs(value);
      }
    }
    return magnitude > 0;
  }

  dispose() {
    for (const target of this.targets) target.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
