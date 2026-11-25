import {
  ENTRANCE_FLIGHT, ENTRANCE_JITTER, ENTRANCE_ORDER_SPAN,
  FLIGHT_DURATION, RELEASE_JITTER, RELEASE_ORDER_SPAN,
} from "./hero-cycle";
import { DATABASE_PITCH } from "./hero-database";

/**
 * Tuning knobs for the particle hero. Physics values are per second (springs
 * in 1/s², forces in model units/s²); model units span roughly ±2.3 × ±1.8.
 */
export const HERO_TUNING = {
  /** Resting spring towards the shape: tight enough to stay crisp, soft enough to wobble. */
  restStiffness: 62,
  restDamping: 0.46,
  /** In flight (morph, entrance, dust) the spring loosens so the flow can carry particles. */
  looseStiffness: 15,
  looseDamping: 0.4,
  /** Share of a flight after which the spring locks back onto the (overshooting) guide. */
  lockAt: 0.74,
  /** Landing: stiffer, better damped spring for the last part of a flight. */
  landingStiffness: 110,
  landingDamping: 0.72,
  /** Curl-noise flow: a whisper at rest, a murmuration in flight. */
  restFlow: 0.07,
  looseFlow: 2.8,
  flowScale: 0.55,
  flowSpeed: 0.16,
  maxSpeed: 7.5,
  /** Pointer brush (fine pointers only), radius in model units. It only acts while the pointer
   *  moves: a resting cursor leaves the shape untouched, a stroke combs particles along it. */
  pointerRadius: 0.36,
  pointerPush: 5,
  pointerStir: 4.2,
  /** Pointer speed (model units/s) at which the brush reaches full strength. */
  pointerFullSpeed: 2.2,
  /** Click/Enter shockwave. */
  shockSpeed: 4.2,
  shockWidth: 0.3,
  shockLife: 1.25,
  shockPush: 30,
  shockLift: 10,
  /** Interaction heat fades with this rate (1/s). */
  heatDecay: 1.7,
  /** Share of particles that burn as accent sparks in flight. */
  sparkFraction: 0.028,
  /** Spark streak length: velocity × seconds, capped in device pixels. */
  streakTime: 0.035,
  streakMax: 22,
  /** Depth of field around the model centre (camera distance 7). */
  focus: 7,
  dofRange: 0.9,
  dofGain: 0.55,
  bokehSize: 1.9,
  /** Dust (entrance start and scroll dispersal) keeps this share of particles visible. */
  dustKeep: 0.42,
  dustAlpha: 0.62,
  maxPointSize: 72,
} as const;

/** GLSL float literal. */
function f(value: number) {
  const text = String(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

const T = HERO_TUNING;

// Simplex 3D noise — Ian McEwan / Ashima Arts (MIT). Kept verbatim for the lattice ripple.
const simplex = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Simplex noise gradient (McEwan/Gustavson, MIT); three of them give divergence-free curl flow.
vec3 snoiseGradient(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  vec3 gradient = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  gradient += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  return gradient * 105.0;
}

vec3 curlNoise(vec3 p) {
  vec3 a = snoiseGradient(p);
  vec3 b = snoiseGradient(p + vec3(31.416, -47.853, 12.679));
  vec3 c = snoiseGradient(p + vec3(-233.145, -113.408, -185.31));
  return vec3(c.y - b.z, a.z - c.x, b.x - a.y);
}
`;

/** Shared by the simulation and both render paths so every path follows one choreography. */
const common = /* glsl */ `
#define PI 3.141592653589793
#define TAU 6.283185307179586

uniform highp sampler2D tShapePos;
uniform highp sampler2D tShapeStyle;
uniform highp sampler2D tShapeDetail;
uniform float uFromSlot;
uniform float uToSlot;
uniform mat4 uFromMotion;
uniform mat4 uToMotion;
uniform float uTime;
uniform float uSimTime;
uniform float uElapsed;
uniform float uMovement;
uniform vec4 uSweep;
uniform float uPhaseSeed;
uniform float uEntrance;
uniform float uScatter;

${simplex}

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

/** Three stable uniforms in [0, 1) per particle and salt. */
vec3 random3(int index, uint salt) {
  return vec3(pcg3d(uvec3(uint(index), salt, 0x2545F491u))) * (1.0 / 4294967296.0);
}

ivec2 atlasTexel(ivec2 ij, float slot) {
  return ivec2(ij.x, ij.y + int(slot + 0.5) * SIDE);
}

vec3 turnY(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Resting position with the shape's idle motion (see ShapeMotion / motionElements).
vec3 restingTarget(mat4 m, vec4 data) {
  vec3 p = data.xyz;
  if (m[0].w > 0.0) {
    vec3 q = data.xyz * m[1].x + uTime * m[1].y;
    p += vec3(snoise(q), snoise(q + 31.7), snoise(q + 71.3)) * m[0].w * uMovement;
  }
  float wave = sin(uTime * m[2].x);
  float lift = (wave * m[1].z + (data.w - m[2].y) * (0.5 + 0.5 * wave) * m[1].w) * uMovement;
  p = (p + m[3].xyz * lift) * m[0].x;
  return turnY(p, sin(uTime * m[0].z) * m[0].y * uMovement);
}

// Sweep order: linear along uSweep.xy, or radial from uSweep.xy (a click point).
float releaseOrder(vec2 p) {
  float linear = dot(p, uSweep.xy) * uSweep.w + 0.5;
  float radial = length(p - uSweep.xy) * uSweep.w;
  return clamp(mix(linear, radial, uSweep.z), 0.0, 1.0);
}

// Departure time mixes where a particle leaves and where it lands (weighted to the
// landing, which is what the eye reads), so peel-off and assembly follow one sweep.
float morphT(vec4 fromData, vec4 toData, float jitter) {
  float order = mix(releaseOrder(fromData.xy * uFromMotion[0].x), releaseOrder(toData.xy * uToMotion[0].x), 0.7);
  float release = order * ${f(RELEASE_ORDER_SPAN)} + jitter * ${f(RELEASE_JITTER)};
  return clamp((uElapsed - release) / ${f(FLIGHT_DURATION)}, 0.0, 1.0);
}

// Wind-up, fast middle, a landing slightly past the target.
float travelEase(float t) {
  const float c2 = 1.1 * 1.525;
  float a = 2.0 * t;
  float b = 2.0 * t - 2.0;
  return t < 0.5 ? a * a * ((c2 + 1.0) * a - c2) * 0.5 : (b * b * ((c2 + 1.0) * b + c2) + 2.0) * 0.5;
}

// A coherent lift field: neighbours share one stream, bulging towards the viewer.
vec3 flightArc(vec3 a, vec3 b, float t) {
  vec3 m = (a + b) * 0.5;
  vec3 stream = vec3(
    sin(m.y * 1.7 + uPhaseSeed * 1.3) * 0.55,
    cos(m.x * 1.3 - uPhaseSeed) * 0.45 + 0.2,
    0.75 + 0.35 * sin((m.x - m.y) * 1.1 + uPhaseSeed * 2.1));
  return stream * sin(PI * t) * min(distance(a, b), 2.6) * 0.42;
}

// Wide depth-of-field dust used by the entrance and by scroll dispersal.
vec3 dustPosition(vec3 r) {
  float radius = min(sqrt(-2.0 * log(max(r.x, 1e-4))), 2.6);
  float angle = TAU * r.y;
  vec3 dust = vec3(cos(angle) * radius * 1.85, sin(angle) * radius * 1.2, mix(-4.0, 3.0, r.z));
  dust.xy += vec2(sin(uSimTime * 0.07 + r.x * TAU), cos(uSimTime * 0.05 + r.y * TAU)) * 0.22 * uMovement;
  return dust;
}

float entranceT(vec3 dust, float jitter) {
  float order = clamp(length(dust.xy) / 4.2, 0.0, 1.0);
  float start = order * ${f(ENTRANCE_ORDER_SPAN)} + jitter * ${f(ENTRANCE_JITTER)};
  return clamp((uEntrance - start) / ${f(ENTRANCE_FLIGHT)}, 0.0, 1.0);
}

float scatterT(float jitter) {
  float s = clamp(uScatter * 1.45 - jitter * 0.45, 0.0, 1.0);
  return s * s * (3.0 - 2.0 * s);
}

struct Guide {
  vec3 position;
  vec3 velocity;
  float morph;
  /** Flow and glow energy: peaks mid-flight. */
  float flight;
  /** Spring looseness: high in flight, back to 0 before landing so the guide's overshoot shows. */
  float loose;
  float entrance;
  float scatter;
};

// Where a particle should be right now; the simulation springs towards it,
// the stateless fallback renders it directly.
Guide heroGuide(vec4 fromData, vec4 toData, vec3 r0, vec3 r1, vec3 r2) {
  Guide g;
  g.morph = morphT(fromData, toData, r0.x);
  g.flight = sin(PI * g.morph) * uMovement;
  g.loose = sin(PI * clamp(g.morph / ${f(T.lockAt)}, 0.0, 1.0)) * uMovement;
  g.velocity = vec3(0.0);
  vec3 p = vec3(0.0);
  if (g.morph <= 0.0) {
    p = restingTarget(uFromMotion, fromData);
  } else if (g.morph >= 1.0) {
    p = restingTarget(uToMotion, toData);
  } else {
    vec3 a = restingTarget(uFromMotion, fromData);
    vec3 b = restingTarget(uToMotion, toData);
    float e = travelEase(g.morph);
    p = mix(a, b, e) + flightArc(a, b, g.morph);
    float ahead = min(g.morph + 0.02, 1.0);
    vec3 next = mix(a, b, travelEase(ahead)) + flightArc(a, b, ahead);
    g.velocity = (next - p) / max((ahead - g.morph) * ${f(FLIGHT_DURATION)}, 1e-4);
  }

  vec3 dust = dustPosition(r1);
  float te = entranceT(dust, r2.x);
  g.entrance = 1.0 - te;
  g.loose = max(g.loose, (1.0 - smoothstep(0.55, 0.9, te)) * uMovement);
  if (te < 1.0) {
    // Spiral in from a wider cloud; the remaining twist unwinds as particles land.
    float e = 1.0 - pow(1.0 - te, 3.0);
    float twist = (1.0 - e) * 2.3;
    float c = cos(twist);
    float s = sin(twist);
    vec3 start = dust * vec3(1.25, 1.25, 1.0);
    start.xy = mat2(c, s, -s, c) * start.xy;
    g.velocity = (p - start) * 3.0 * (1.0 - e);
    p = mix(start, p, e);
  }

  g.scatter = scatterT(r2.z);
  g.loose = max(g.loose, g.scatter);
  vec3 drift = dust + vec3(0.0, uScatter * 0.9, 0.0);
  p = mix(p, drift, g.scatter);
  g.position = p;
  return g;
}
`;

const interactionUniforms = /* glsl */ `
uniform vec3 uPointerOrigin;
uniform vec3 uPointerDir;
uniform vec3 uPointerVelocity;
uniform float uPointerStrength;
uniform float uPointerRadius;
uniform vec4 uShockA0;
uniform vec4 uShockB0;
uniform vec4 uShockA1;
uniform vec4 uShockB1;
`;

export const simulationVertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** One MRT pass: semi-implicit Euler over position (xyz + heat) and velocity. */
export const simulationFragmentShader = /* glsl */ `
precision highp float;
${common}
${interactionUniforms}
uniform highp sampler2D tPosition;
uniform highp sampler2D tVelocity;
uniform float uDt;
uniform float uReset;
layout(location = 0) out highp vec4 outPosition;
layout(location = 1) out highp vec4 outVelocity;

vec3 shockForce(vec3 pos, vec4 A, vec4 B, inout float energy) {
  vec3 force = vec3(0.0);
  float age = uSimTime - A.w;
  if (B.w > 0.0 && age >= 0.0 && age < ${f(T.shockLife)}) {
    vec3 rel = pos - A.xyz;
    vec3 radial = rel - dot(rel, B.xyz) * B.xyz;
    float d = length(radial);
    float x = (d - age * ${f(T.shockSpeed)}) / ${f(T.shockWidth)};
    float band = exp(-x * x);
    float fade = 1.0 - age / ${f(T.shockLife)};
    fade *= fade * B.w;
    vec3 n = radial / max(d, 1e-4);
    force = (n * ${f(T.shockPush)} - B.xyz * ${f(T.shockLift)}) * band * fade;
    energy = max(energy, band * fade);
  }
  return force;
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  int index = ij.y * SIDE + ij.x;
  vec3 r0 = random3(index, 1u);
  vec3 r1 = random3(index, 2u);
  vec3 r2 = random3(index, 3u);
  vec4 fromData = texelFetch(tShapePos, atlasTexel(ij, uFromSlot), 0);
  vec4 toData = texelFetch(tShapePos, atlasTexel(ij, uToSlot), 0);
  Guide g = heroGuide(fromData, toData, r0, r1, r2);

  vec4 P = texelFetch(tPosition, ij, 0);
  vec4 V = texelFetch(tVelocity, ij, 0);
  vec3 pos = P.xyz;
  vec3 vel = V.xyz;

  // Landing particles (locked, not yet arrived) get a stiffer, better damped spring so a
  // shape reads crisply as soon as its last particles arrive.
  float landing = step(${f(T.lockAt)}, g.morph) * (1.0 - step(1.0, g.morph)) * uMovement;
  float stiffness = mix(mix(${f(T.restStiffness)}, ${f(T.landingStiffness)}, landing), ${f(T.looseStiffness)}, g.loose);
  float zeta = mix(mix(${f(T.restDamping)}, ${f(T.landingDamping)}, landing), ${f(T.looseDamping)}, g.loose);
  float damping = 2.0 * zeta * sqrt(stiffness);
  vec3 acc = (g.position - pos) * stiffness - vel * damping;
  float flow = max(g.flight, max(g.entrance * g.loose, g.scatter));
  acc += curlNoise(pos * ${f(T.flowScale)} + vec3(0.0, uSimTime * ${f(T.flowSpeed)}, uPhaseSeed))
    * mix(${f(T.restFlow)}, ${f(T.looseFlow)}, flow) * uMovement;

  float energy = 0.0;
  if (uPointerStrength > 0.001) {
    vec3 rel = pos - uPointerOrigin;
    vec3 radial = rel - dot(rel, uPointerDir) * uPointerDir;
    float d2 = dot(radial, radial);
    float brush = clamp(length(uPointerVelocity) / ${f(T.pointerFullSpeed)}, 0.0, 1.0);
    float w = uPointerStrength * brush * exp(-d2 / (uPointerRadius * uPointerRadius));
    vec3 n = radial * inversesqrt(max(d2, 1e-6));
    acc += (n * ${f(T.pointerPush)} + uPointerVelocity * ${f(T.pointerStir)}) * w;
    energy = w;
  }
  acc += shockForce(pos, uShockA0, uShockB0, energy);
  acc += shockForce(pos, uShockA1, uShockB1, energy);

  vel += acc * uDt;
  float speed = length(vel);
  vel *= min(1.0, ${f(T.maxSpeed)} / max(speed, 1e-4));
  pos += vel * uDt;
  float heat = max(P.w * exp(-uDt * ${f(T.heatDecay)}), energy);

  outPosition = uReset > 0.5 ? vec4(g.position, 0.0) : vec4(pos, clamp(heat, 0.0, 1.0));
  outVelocity = uReset > 0.5 ? vec4(0.0) : vec4(vel, 0.0);
}
`;

export const particleVertexShader = /* glsl */ `
${common}
${interactionUniforms}
uniform highp sampler2D tPosition;
uniform highp sampler2D tVelocity;
uniform float uSimulated;
uniform float uFromEffect;
uniform float uToEffect;
uniform float uSize;
uniform float uPixelRatio;
uniform vec2 uViewport;
uniform float uHoverNode;
uniform float uHoverTime;
uniform float uHoverStrength;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform vec3 uHot;
uniform float uOpacity;
uniform float uGlow;
uniform float uDof;
varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
varying vec3 vStreak;

float databaseHeight(vec3 p) {
  return p.y * ${f(Math.cos(DATABASE_PITCH))} + p.z * ${f(Math.sin(DATABASE_PITCH))};
}

// x: accent, y: opacity, z: size. Distinct weights keep rims and synapses readable.
vec3 appearance(float effect, vec4 data, vec4 style, vec2 detail) {
  vec3 look = style.xyz;
  if (effect > 0.5 && effect < 1.5) {
    // Database: group = tier, style.w = azimuth, detail.x = surface kind.
    float tier = data.w;
    float kind = detail.x;
    float rim = 1.0 - step(0.5, abs(kind - 2.0));
    float wall = 1.0 - step(0.5, kind);
    float indicator = step(3.5, kind);
    // Opposite travelling highlights keep one scan visible on the front half.
    float head = fract(uTime * 0.20 - tier * 0.16);
    float gap = abs(style.w - head);
    gap = min(gap, 1.0 - gap);
    gap = min(gap, abs(gap - 0.5));
    float sweep = (1.0 - smoothstep(0.012, 0.065, gap)) * uMovement;
    // Enter and leave beyond the silhouette so the wrap never flashes in place.
    float readHead = mod(uTime * 0.82, 3.0) - 1.5;
    float read = (1.0 - smoothstep(0.035, 0.19, abs(databaseHeight(data.xyz) - readHead))) * uMovement;
    float activity = max(sweep * max(rim, wall * 0.45), read * max(wall * 0.82, indicator));
    float heartbeat = (0.5 + 0.5 * sin(uTime * 2.1 - tier * 1.4)) * indicator * uMovement;
    look = vec3(
      mix(style.x, 1.0, activity),
      style.y + activity * 0.60 + heartbeat * 0.16,
      style.z * (1.0 + activity * 0.28));
  } else if (effect > 1.5) {
    // Network: group = source layer, style.w = target layer, detail.x = edge t (-1 on surfaces).
    float source = data.w;
    float target = style.w;
    float edgeT = detail.x;
    float edge = step(0.0, edgeT);
    // Stage-index flow lights complete feature maps, then their outgoing paths.
    float stage = mix(source, mix(source, target, edgeT), edge);
    float wave = mod(uTime * 1.35, 9.5) - 1.0;
    float signal = (1.0 - smoothstep(0.12, 0.65, abs(stage - wave))) * uMovement;
    float hover = step(-0.5, uHoverNode) * clamp(uHoverStrength, 0.0, 1.0);
    float fromSelected = 1.0 - step(0.5, abs(source - uHoverNode));
    float toSelected = 1.0 - step(0.5, abs(target - uHoverNode));
    float selected = (1.0 - edge) * fromSelected * hover;
    float connected = edge * max(fromSelected, toSelected) * hover;
    // Reverse the edge parameter when the selected node is at its target end.
    float outwardT = mix(1.0 - edgeT, edgeT, fromSelected);
    float pulsePosition = mod(max(uHoverTime, 0.0) * 0.85, 1.5);
    float pulse = (1.0 - smoothstep(0.035, 0.16, abs(outwardT - pulsePosition))) * uMovement;
    // Keep automatic layer flow; hover emphasizes only adjacent connections.
    float automatic = signal * (1.0 - edge * hover);
    look = vec3(
      mix(style.x, 1.0, automatic * 0.9),
      mix(style.y, max(style.y, 0.85), automatic),
      style.z * (1.0 + signal * 0.10));
    float highlight = max(selected * 0.94, connected * (0.18 + pulse * 0.78));
    look.x = mix(look.x, 1.0, highlight);
    look.y = max(look.y, mix(look.y, 1.85, selected * 0.65));
    look.y = max(look.y, mix(look.y, 0.52 + pulse * 0.63, connected));
  }
  return look;
}

float isDatabase(float effect) {
  return step(0.5, effect) * (1.0 - step(1.5, effect));
}

vec3 shockOffset(vec3 pos, vec4 A, vec4 B, inout float energy) {
  vec3 offset = vec3(0.0);
  float age = uSimTime - A.w;
  if (B.w > 0.0 && age >= 0.0 && age < ${f(T.shockLife)}) {
    vec3 rel = pos - A.xyz;
    vec3 radial = rel - dot(rel, B.xyz) * B.xyz;
    float d = length(radial);
    float x = (d - age * ${f(T.shockSpeed)}) / ${f(T.shockWidth * 1.6)};
    float band = exp(-x * x);
    float fade = 1.0 - age / ${f(T.shockLife)};
    fade *= fade * B.w;
    offset = (radial / max(d, 1e-4) * 0.32 - B.xyz * 0.18) * band * fade;
    energy = max(energy, band * fade);
  }
  return offset;
}

void main() {
  int index = gl_VertexID;
  ivec2 ij = ivec2(index % SIDE, index / SIDE);
  vec3 r0 = random3(index, 1u);
  vec3 r1 = random3(index, 2u);
  vec3 r2 = random3(index, 3u);
  vec4 fromData = texelFetch(tShapePos, atlasTexel(ij, uFromSlot), 0);
  vec4 toData = texelFetch(tShapePos, atlasTexel(ij, uToSlot), 0);

  vec3 position = vec3(0.0);
  vec3 velocity = vec3(0.0);
  float heat = 0.0;
  float morph = 1.0;
  float entrance = 0.0;
  float scatter = 0.0;
  if (uSimulated > 0.5) {
    vec4 P = texelFetch(tPosition, ij, 0);
    position = P.xyz;
    heat = P.w;
    velocity = texelFetch(tVelocity, ij, 0).xyz;
    morph = morphT(fromData, toData, r0.x);
    entrance = 1.0 - entranceT(dustPosition(r1), r2.x);
    scatter = scatterT(r2.z);
  } else {
    // Stateless path (reduced motion, or no float render targets): same choreography, no inertia.
    Guide g = heroGuide(fromData, toData, r0, r1, r2);
    position = g.position;
    velocity = g.velocity;
    morph = g.morph;
    entrance = g.entrance;
    scatter = g.scatter;
    float loose = max(g.flight, max(entrance, scatter)) * uMovement;
    if (loose > 0.001) {
      position += curlNoise(position * ${f(T.flowScale)} + vec3(0.0, uSimTime * ${f(T.flowSpeed)}, uPhaseSeed)) * 0.05 * loose;
    }
    if (uPointerStrength > 0.001) {
      vec3 rel = position - uPointerOrigin;
      vec3 radial = rel - dot(rel, uPointerDir) * uPointerDir;
      float d2 = dot(radial, radial);
      float brush = clamp(length(uPointerVelocity) / ${f(T.pointerFullSpeed)}, 0.0, 1.0);
      float w = uPointerStrength * brush * exp(-d2 / (uPointerRadius * uPointerRadius));
      vec3 n = radial * inversesqrt(max(d2, 1e-6));
      position += (n * 0.05 + uPointerVelocity * 0.03) * w;
      heat = w * 0.8;
    }
    position += shockOffset(position, uShockA0, uShockB0, heat);
    position += shockOffset(position, uShockA1, uShockB1, heat);
  }

  // Shape styling: the landing shape's look, blended from the departing one mid-flight.
  vec4 styleTo = texelFetch(tShapeStyle, atlasTexel(ij, uToSlot), 0);
  vec2 detailTo = texelFetch(tShapeDetail, atlasTexel(ij, uToSlot), 0).xy;
  vec3 look = appearance(uToEffect, toData, styleTo, detailTo);
  float databaseWeight = isDatabase(uToEffect);
  if (morph < 1.0) {
    vec4 styleFrom = texelFetch(tShapeStyle, atlasTexel(ij, uFromSlot), 0);
    vec2 detailFrom = texelFetch(tShapeDetail, atlasTexel(ij, uFromSlot), 0).xy;
    float blend = smoothstep(0.25, 0.75, morph);
    look = mix(appearance(uFromEffect, fromData, styleFrom, detailFrom), look, blend);
    databaseWeight = mix(isDatabase(uFromEffect), databaseWeight, blend);
  }

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float depth = max(-mv.z, 0.5);
  // Depth fog; database surfaces already encode lighting, so they fade less.
  float fog = mix(1.12, 0.55, smoothstep(5.7, 8.3, depth));
  fog = mix(fog, mix(1.04, 0.76, smoothstep(5.2, 8.8, depth)), databaseWeight);

  float dusty = max(entrance, scatter);
  // Every particle shows on a formed shape; dust keeps only a sparse share (cheaper, cleaner bokeh).
  float keep = mix(1.08, ${f(T.dustKeep)}, dusty);
  float visible = 1.0 - smoothstep(keep - 0.08, keep, r2.y);
  float twinkle = 1.0 + (0.08 + 0.22 * dusty) * sin(uSimTime * (1.1 + r2.y * 2.4) + r2.z * TAU) * uMovement;

  // Energy: flight glow, entrance glow and interaction heat drive the accent ramp.
  float flight = sin(PI * morph) * uMovement;
  float arrival = sin(PI * clamp(entrance, 0.0, 1.0)) * uMovement;
  float energy = max(flight, arrival);
  float spark = step(1.0 - ${f(T.sparkFraction)}, r0.y);
  float sparkLevel = spark * max(energy, heat);
  float accent = max(look.x, max(energy * 0.3, heat * 0.9));
  accent = max(accent, sparkLevel);
  vec3 color = mix(uColor, uAccent, clamp(accent, 0.0, 1.0));
  vColor = mix(color, uHot, clamp(sparkLevel * 0.8 + heat * heat * 0.35, 0.0, 1.0));

  float baseSize = uSize * uPixelRatio * look.z * (0.85 + r0.z * 0.3) * (7.0 / depth);
  float size = baseSize * (1.0 + heat * 0.35);
  float alpha = look.y * (0.85 + r0.z * 0.15) * fog * twinkle * visible;
  alpha *= mix(1.0, ${f(T.dustAlpha)}, dusty) * uOpacity;

  vec4 clip = projectionMatrix * mv;
  vStreak = vec3(0.0);
  vSoft = 0.0;
  bool streaking = false;
  if (sparkLevel > 0.05 && uMovement > 0.5) {
    // Sparks become thin comets along their screen-space velocity.
    vec4 tail = projectionMatrix * (modelViewMatrix * vec4(position - velocity * ${f(T.streakTime)}, 1.0));
    vec2 delta = (clip.xy / clip.w - tail.xy / max(tail.w, 1e-3)) * 0.5 * uViewport;
    float travel = length(delta);
    float len = min(travel, ${f(T.streakMax)}) * sparkLevel;
    if (len > 2.0) {
      streaking = true;
      vec2 dir = delta / travel;
      float width = max(baseSize * 0.9, 1.6 * uPixelRatio);
      float total = width + len;
      vStreak = vec3(dir, len / total);
      alpha = min(alpha * (1.0 + sparkLevel), 1.0);
      // Shift the sprite back so the bright head sits on the particle.
      clip.xy -= dir * (len * 0.5) / (0.5 * uViewport) * clip.w;
      size = total;
    }
  }
  if (!streaking) {
    size *= 1.0 + sparkLevel * 0.5;
    float coc = clamp((abs(depth - ${f(T.focus)}) - ${f(T.dofRange)}) * ${f(T.dofGain)}, 0.0, 1.0);
    coc = max(coc, dusty * clamp(abs(depth - ${f(T.focus)}) * 0.32, 0.0, 1.0)) * uDof;
    float glow = uGlow * clamp(max(accent - 0.35, 0.0) * 0.5 + sparkLevel + heat * 0.5, 0.0, 1.0);
    size *= (1.0 + coc * ${f(T.bokehSize)}) * (1.0 + glow * 1.2);
    alpha /= (1.0 + coc * ${f(T.bokehSize * 1.3)}) * (1.0 + glow * 0.9);
    vSoft = max(coc, glow * 0.85);
  }
  vAlpha = alpha;
  gl_Position = clip;
  gl_PointSize = visible > 0.001 ? min(size, ${f(T.maxPointSize)}) : 0.0;
}
`;

export const particleFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
varying vec3 vStreak;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float d = length(c);
  float along = 1.0;
  float edge = mix(0.5, 0.0, vSoft);
  if (vStreak.z > 0.0) {
    // Capsule with a hard edge; brightness fades from the head to the tail.
    float h = vStreak.z;
    float t = clamp(dot(c, vStreak.xy), -h, h);
    d = length(c - vStreak.xy * t) / max(1.0 - h, 1e-3);
    along = mix(0.08, 1.0, t / h * 0.5 + 0.5);
    along *= along;
    edge = 0.72;
  }
  // Crisp dots in focus; soft, faintly rimmed bokeh discs when defocused.
  float disc = 1.0 - smoothstep(edge, 1.0, d);
  float rim = smoothstep(0.5, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d)) * vSoft * 0.3;
  float alpha = (disc + rim) * vAlpha * along;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(vColor, min(alpha, 1.0));
  #include <colorspace_fragment>
}
`;

/** Screen-space shockwave rings for click / Enter. */
export const overlayVertexShader = /* glsl */ `
uniform vec4 uRect;
varying vec2 vNdc;
void main() {
  vNdc = mix(uRect.xy, uRect.zw, uv);
  gl_Position = vec4(vNdc, 0.0, 1.0);
}
`;

export const overlayFragmentShader = /* glsl */ `
uniform float uAspect;
uniform vec4 uRing0;
uniform vec4 uRing1;
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vNdc;

float ring(vec4 r) {
  float d = length((vNdc - r.xy) * vec2(uAspect, 1.0)) - r.z;
  float line = exp(-pow(d / 0.006, 2.0));
  float haze = exp(-pow(d / 0.05, 2.0)) * 0.22;
  return (line + haze) * r.w;
}

void main() {
  float alpha = (ring(uRing0) + ring(uRing1)) * uStrength;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uColor, min(alpha, 1.0));
  #include <colorspace_fragment>
}
`;
