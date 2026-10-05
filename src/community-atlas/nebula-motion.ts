import { atlasSourceCrop } from "./atlas-camera.ts";
import { NEBULA_PERIOD, NEBULA_VOLUME_GLSL } from "./nebula-volume.ts";

/** Source-image anchors shared with the overlaid starlight, not catalog positions. */
export const ATLAS_SOURCE_STARS = [
  [227, 166, 1.35, 0], [419.3, 18.5, 1.15, 0], [623.8, 101.9, 1.2, 0],
  [1568.8, 35.8, 1.2, 0], [1396.1, 197.8, 1.15, 0], [224.8, 490.5, 1.1, 0],
  [1421.4, 504.4, 1.1, 0], [187.9, 314.6, 1, 0], [101, 428, 1, 0],
  [1133, 130.2, 1.1, 1], [1100.1, 336.7, 1.05, 0], [287, 598, 1.1, 0],
  [249.3, 789.1, 1.1, 1], [107.7, 847.9, 1, 0], [580, 662.3, 1.05, 0],
  [70, 746.7, 1, 0], [361, 811.7, 1, 0], [1074.2, 676, 1, 0],
  [1251.1, 886.9, 1.15, 0], [1303.6, 890.6, 1.05, 0],
] as const;

export interface NebulaMotion {
  render(width: number, height: number, time: number): CanvasImageSource | null;
  dispose(): void;
}

export interface NebulaMotionOptions {
  canvasFactory?: () => HTMLCanvasElement;
  pixelRatio?: number;
  /** Wake the caller's existing frame scheduler after context loss or restore. */
  onChange?: () => void;
}

const SOURCE_WIDTH = 1672, SOURCE_HEIGHT = 941;
const MAX_PIXELS = 2_000_000, MAX_EDGE = 4096;
const MOTION = {
  quiet: { x: .51, y: .45, sx: .19, sy: .27 },
  edge: .045, starInner: 12 / SOURCE_WIDTH, starOuter: 36 / SOURCE_WIDTH,
} as const;
const secondsAt = (time: number) => Number.isFinite(time) ? Math.max(0, time) % NEBULA_PERIOD : 0;
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Fixed sky and image edges cannot inherit the cloud material's deformation. */
export function sampleNebulaMask(x: number, y: number, time: number): number {
  if (!Number.isFinite(x + y)) return 0;
  let nearest = 2;
  for (const [sx, sy] of ATLAS_SOURCE_STARS) {
    const a = x - sx / SOURCE_WIDTH, b = (y - sy / SOURCE_HEIGHT) * SOURCE_HEIGHT / SOURCE_WIDTH;
    nearest = Math.min(nearest, a * a + b * b);
  }
  const edge = smooth(0, MOTION.edge, Math.min(x, y, 1 - x, 1 - y));
  const quietDistance = ((x - MOTION.quiet.x) / MOTION.quiet.sx) ** 2 + ((y - MOTION.quiet.y) / MOTION.quiet.sy) ** 2;
  const reveal = smooth(0, 2, Number.isFinite(time) ? Math.max(0, time) : 0);
  return edge * smooth(1, 1.7, quietDistance) *
    smooth(MOTION.starInner ** 2, MOTION.starOuter ** 2, nearest) * reveal;
}

const glNumber = (value: number) => Number.isInteger(value) ? `${value}.0` : String(value);
const vector = (x: number, y: number) => `vec2(${glNumber(x)}, ${glNumber(y)})`;
const MASK_GLSL = `
float materialMask(vec2 uv) {
  float nearest = 2.0;
  vec2 d;
  ${ATLAS_SOURCE_STARS.map(([x, y]) => `d = (uv - ${vector(x / SOURCE_WIDTH, y / SOURCE_HEIGHT)}) * ${vector(1, SOURCE_HEIGHT / SOURCE_WIDTH)}; nearest = min(nearest, dot(d, d));`).join("\n  ")}
  float edge = smoothstep(0.0, ${glNumber(MOTION.edge)}, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
  vec2 q = (uv - ${vector(MOTION.quiet.x, MOTION.quiet.y)}) / ${vector(MOTION.quiet.sx, MOTION.quiet.sy)};
  return edge * smoothstep(1.0, 1.7, dot(q, q)) *
    smoothstep(${glNumber(MOTION.starInner ** 2)}, ${glNumber(MOTION.starOuter ** 2)}, nearest) * uReveal;
}`;
const vertexSource = (precision: "highp" | "mediump") => `
attribute vec2 aPosition;
varying ${precision} vec2 vUv;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
}`;
const fragment = (precision: "highp" | "mediump") => `
precision ${precision} float;
varying ${precision} vec2 vUv;
uniform sampler2D uImage;
uniform vec4 uCrop;
uniform float uTime;
uniform float uReveal;
${MASK_GLSL}
${NEBULA_VOLUME_GLSL}
void orderPair(inout vec3 a, inout vec3 b) {
  vec3 lo = min(a, b); b = max(a, b); a = lo;
}
// Preserve the fine point-light residual at its original coordinates. Median
// separation is approximate: it is not an astronomical star-removal algorithm.
vec3 cloudAt(vec2 uv) {
  vec2 texel = vec2(1.8 / ${glNumber(SOURCE_WIDTH)}, 1.8 / ${glNumber(SOURCE_HEIGHT)});
  vec3 a = texture2D(uImage, uv).rgb;
  vec3 b = texture2D(uImage, uv + texel).rgb;
  vec3 c = texture2D(uImage, uv - texel).rgb;
  vec3 d = texture2D(uImage, uv + vec2(texel.x, -texel.y)).rgb;
  vec3 e = texture2D(uImage, uv + vec2(-texel.x, texel.y)).rgb;
  orderPair(a,b); orderPair(b,c); orderPair(c,d); orderPair(d,e);
  orderPair(a,b); orderPair(b,c); orderPair(c,d);
  orderPair(a,b); orderPair(b,c); orderPair(a,b);
  return c;
}
void main() {
  vec2 uv = uCrop.xy + vUv * uCrop.zw;
  vec4 original = texture2D(uImage, uv);
  float mask = materialMask(uv);
  if (mask < .001) { gl_FragColor = original; return; }
  vec3 base = cloudAt(uv);
  float envelope = smoothstep(.01, .09, dot(base, vec3(.2126, .7152, .0722)));
  if (envelope < .001) { gl_FragColor = original; return; }
  vec4 volume = volumeAt(uv, uTime);
  vec3 fine = original.rgb - base;
  vec3 transported = cloudAt(uv - volume.zw * mask);
  vec3 scatterColor = max(base, vec3(.045, .065, .09));
  vec3 material = transported * (1.0 - volume.x * .65) + scatterColor * volume.y * .9 + fine;
  gl_FragColor = vec4(mix(original.rgb, material, mask * envelope), original.a);
}
`;
interface Resources {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  texture: WebGLTexture;
  crop: WebGLUniformLocation;
  time: WebGLUniformLocation;
  reveal: WebGLUniformLocation;
}

// SVGImageElement belongs to CanvasImageSource but is not a WebGL texture source.
function textureSource(source: CanvasImageSource): source is Exclude<CanvasImageSource, SVGImageElement> {
  return !(typeof SVGImageElement !== "undefined" && source instanceof SVGImageElement);
}

/** A detached GPU canvas. It owns no animation clock, event loop, or fetch. */
export function createNebulaMotion(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: NebulaMotionOptions = {},
): NebulaMotion | null {
  if (!Number.isFinite(sourceWidth + sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0 || !textureSource(source)) return null;
  let canvas: HTMLCanvasElement, gl: WebGLRenderingContext;
  try {
    canvas = options.canvasFactory ? options.canvasFactory() : document.createElement("canvas");
    const context = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
    if (!context) return null;
    gl = context;
  } catch { return null; }

  let disposed = false, lost = false;
  let resources: Resources | null = null;
  const requestedRatio = options.pixelRatio ?? (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  const ratio = Number.isFinite(requestedRatio) && requestedRatio > 0 ? Math.min(1.5, requestedRatio) : 1;
  const edgeLimit = Math.min(MAX_EDGE, Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || MAX_EDGE);
  const destroy = (resource: Resources | null) => {
    if (!resource) return;
    gl.deleteTexture(resource.texture); gl.deleteBuffer(resource.buffer); gl.deleteProgram(resource.program);
  };
  const releaseContext = () => {
    try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* Optional eager GPU release. */ }
  };
  const initialize = (): Resources | null => {
    let vertex: WebGLShader | null = null, pixel: WebGLShader | null = null;
    let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null, texture: WebGLTexture | null = null;
    let success = false;
    try {
      if (sourceWidth > Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || sourceHeight > Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))) return null;
      const compile = (type: number, code: string) => {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, code); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
        return shader;
      };
      const high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      const precision = high && high.precision > 0 ? "highp" : "mediump";
      vertex = compile(gl.VERTEX_SHADER, vertexSource(precision));
      pixel = compile(gl.FRAGMENT_SHADER, fragment(precision));
      if (!vertex || !pixel) return null;
      program = gl.createProgram();
      if (!program) return null;
      gl.attachShader(program, vertex); gl.attachShader(program, pixel); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
      buffer = gl.createBuffer(); texture = gl.createTexture();
      if (!buffer || !texture) return null;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "aPosition");
      if (position < 0) return null;
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // vUv is already top-left based. Keep the source rows in their DOM order.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (gl.getError() !== gl.NO_ERROR) return null;
      const crop = gl.getUniformLocation(program, "uCrop"), time = gl.getUniformLocation(program, "uTime");
      const reveal = gl.getUniformLocation(program, "uReveal");
      const image = gl.getUniformLocation(program, "uImage");
      if (!crop || !time || !reveal || !image) return null;
      gl.uniform1i(image, 0);
      success = true;
      return { program, buffer, texture, crop, time, reveal };
    } catch { return null; }
    finally {
      if (vertex) gl.deleteShader(vertex);
      if (pixel) gl.deleteShader(pixel);
      if (!success) {
        if (texture) gl.deleteTexture(texture);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
      }
    }
  };
  resources = initialize();
  if (!resources) { canvas.width = canvas.height = 0; releaseContext(); return null; }
  const onLost = (event: Event) => {
    if (disposed) return;
    event.preventDefault();
    lost = true; resources = null;
    options.onChange?.();
  };
  const onRestored = () => {
    if (disposed || !lost) return;
    lost = false;
    resources = initialize();
    options.onChange?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  return {
    render(width, height, time) {
      if (disposed || lost || !resources || !Number.isFinite(width + height) || width <= 0 || height <= 0 || gl.isContextLost()) return null;
      try {
        const density = Math.min(ratio, Math.sqrt(MAX_PIXELS / (width * height)), edgeLimit / Math.max(width, height));
        const w = Math.max(1, Math.floor(width * density)), h = Math.max(1, Math.floor(height * density));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const crop = atlasSourceCrop(width, height, sourceWidth, sourceHeight);
        gl.viewport(0, 0, w, h);
        gl.uniform4f(resources.crop, crop.x, crop.y, crop.width, crop.height);
        gl.uniform1f(resources.time, secondsAt(time));
        gl.uniform1f(resources.reveal, smooth(0, 2, Number.isFinite(time) ? Math.max(0, time) : 0));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return canvas;
      } catch {
        destroy(resources); resources = null;
        return null;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (!lost) destroy(resources);
      resources = null;
      canvas.width = canvas.height = 0;
      releaseContext();
    },
  };
}
