import { plasmaMaterial } from './black-hole-plasma.ts';

// Schwarzschild-inspired ray integration; no spin/frame-dragging claim.
export const rayFragment = /* glsl */ `
uniform vec2 uCenter; uniform float uScale;
uniform float uTime; uniform vec3 uCam; uniform float uFocal;
uniform float uHeat; uniform float uRoll;
uniform float uFormationTurn;
// shadow growth, disk presence, remaining sky turn, remaining sky spread
uniform vec4 uFormation;
layout(location = 0) out vec4 outDisk;
layout(location = 1) out vec4 outEscape;
${plasmaMaterial}
vec3 acceleration(vec3 position, float h2) {
  float r2 = max(dot(position, position), 0.1);
  return -1.5 * uFormation.x * h2 * position / (r2 * r2 * sqrt(r2));
}
struct HoleRay {
  vec3 hit0; vec3 hit1; vec3 hit2;
  vec3 view0; vec3 view1; vec3 view2;
  vec3 valid;
  vec3 velocity;
  float escape;
  float h2;
};
HoleRay traceHole(vec3 dir) {
  vec3 pos = uCam, vel = dir;
  vec3 hv = cross(pos, vel); float h2 = dot(hv, hv);
  float mass = max(uFormation.x, 0.02);
  float critical = 6.75 * mass * mass;
  bool captured = h2 < critical && dot(pos, dir) < 0.0;
  bool done = captured;
  HoleRay ray;
  ray.hit0 = ray.hit1 = ray.hit2 = vec3(3.0 * mass, 0.0, 0.0);
  ray.view0 = ray.view1 = ray.view2 = vec3(0.0, 1.0, 0.0);
  ray.valid = vec3(0.0);
  int crossings = 0;
  for (int i = 0; i < 240; i++) {
    float r = length(pos);
    float dt = clamp(0.085 * r, 0.035, 1.2);
    vec3 p0 = pos;
    // Midpoint integration reduces stair-step deflection of thin images.
    vec3 halfVel = vel + acceleration(pos, h2) * (dt * 0.5);
    vec3 halfPos = pos + vel * (dt * 0.5);
    pos += halfVel * dt;
    vel += acceleration(halfPos, h2) * dt;
    if (p0.y * pos.y < 0.0) {
      vec3 pc = mix(p0, pos, p0.y / (p0.y - pos.y));
      if (crossings == 0) {
        ray.hit0 = pc; ray.view0 = -normalize(vel); ray.valid.x = 1.0;
      } else if (crossings == 1) {
        ray.hit1 = pc; ray.view1 = -normalize(vel); ray.valid.y = 1.0;
      } else if (crossings == 2) {
        ray.hit2 = pc; ray.view2 = -normalize(vel); ray.valid.z = 1.0;
      }
      crossings++;
    }
    if (dot(pos,pos) < mass * mass) { captured = true; done = true; break; }
    if (r > 60.0) { done = true; break; }
  }
  float escape = captured || !done ? 0.0 : smoothstep(0.04, 0.5, (h2 - critical) / (mass * mass));
  escape = mix(1.0, escape, smoothstep(0.0, 0.08, uFormation.x));
  ray.velocity = vel;
  ray.escape = escape;
  ray.h2 = h2;
  return ray;
}
void main() {
  vec2 uv = (gl_FragCoord.xy - uCenter) / uScale;
  float cr = cos(uRoll), sr = sin(uRoll);
  mat2 roll = mat2(cr, -sr, sr, cr);
  uv = roll * uv;
  vec3 fwd = normalize(-uCam);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  vec3 dir = normalize(fwd * uFocal + right * uv.x + up * uv.y);
  HoleRay centre = traceHole(dir);
  vec3 col = vec3(0.0), vel = centre.velocity;
  float trans = 1.0, escape = centre.escape, h2 = centre.h2;
  float mass = max(uFormation.x, 0.02);
  float edge = smoothstep(0.06, 0.65, abs(h2 - 6.75 * mass * mass) / (mass * mass));
  // Shade only after every pixel exits the divergent integration loop. All
  // pixels evaluate every slot, including empty ones, so screen derivatives
  // measure the actual lensed material instead of being undefined in a branch.
  // Three plane images cover primary/secondary light; more are unresolved.
  // Explicit calls also avoid driver-dependent derivative-loop unrolling.
  vec4 gas0 = disk(centre.hit0, max(length(centre.hit0.xz), 0.001), centre.view0);
  vec4 gas1 = disk(centre.hit1, max(length(centre.hit1.xz), 0.001), centre.view1);
  vec4 gas2 = disk(centre.hit2, max(length(centre.hit2.xz), 0.001), centre.view2);
  gas0.a *= centre.valid.x;
  gas1.a *= centre.valid.y;
  gas2.a *= centre.valid.z;
  col = gas0.rgb * gas0.a;
  trans = 1.0 - gas0.a;
  col += gas1.rgb * gas1.a * trans * 0.32 * edge;
  trans *= 1.0 - gas1.a;
  col += gas2.rgb * gas2.a * trans * 0.32 * edge;
  trans *= 1.0 - gas2.a;
  outDisk = vec4(col, trans);
  // Artistic weak-field fade: preserve near-centre deflection, then smoothly
  // settle to the distant sky. This screen-composition limit is not a physical
  // cutoff of gravity; the emitting disk still uses the integrated ray.
  // uv has already inherited the disk's camera roll. Gently extend the outer
  // envelope at its two sides, without distorting the shadow or emitting disk.
  // Fade this artistic silhouette out as the established dive moves inward.
  float side = uv.x * uv.x / max(dot(uv, uv), 0.0001);
  // Keep near-shadow rays untouched; shape only the outer weak-field envelope.
  // The broad side lobes follow the rolled disk instead of making a round rim.
  float shape = smoothstep(8.0, 14.0, length(uCam)) * smoothstep(18.0, 50.0, h2);
  float sideStretch = mix(0.78, 1.95, smoothstep(0.1, 0.9, side));
  float envelopeH2 = h2 / mix(1.0, sideStretch, shape);
  float lens = 1.0 - smoothstep(18.0, 90.0, envelopeH2);
  vec3 bent = normalize(mix(dir, normalize(vel), lens));
  // Local artistic refraction follows the SAME world-space gas field and
  // phase as the emitting disk. Distant stars have no separate spin/clock.
  vec3 radial = normalize(vec3(uCam.x, 0.0, uCam.z));
  float inclination = max(abs(normalize(uCam).y), 0.25);
  vec3 plane = right * uv.x - radial * uv.y / inclination;
  vec2 structure = gasStructure(clamp(sqrt(h2), 3.2, 10.0), atan(plane.z, plane.x));
  float coupling = smoothstep(6.9, 12.0, h2) * (1.0 - smoothstep(50.0, 110.0, envelopeH2));
  float innerRefraction = 1.0 - smoothstep(12.0, 22.0, h2);
  // The blue inner sliver is lensed sky, not emitting gas. Carry broad local
  // refraction with the same advected patches; never paint on the dark shadow.
  float flow = mix(structure.x, structure.y, innerRefraction);
  float bend = (flow - 0.5) * mix(0.10, 0.16, innerRefraction) * coupling * uFormation.x;
  vec3 tangent = cross(vec3(0.0,1.0,0.0), bent);
  vec3 skyRay = normalize(bent + tangent * bend);
  // Entrance only: remap the EXISTING sky around the same tilted disk plane.
  // The lookup angle decreases, so visible features advance with +phi gas.
  // Sampling spread decreases monotonically: features gather instead of
  // expanding then snapping back. Zero offsets restore the exact settled sky.
  if (uFormation.z > 0.0 || uFormation.w > 0.0) {
    float forward = dot(skyRay, fwd);
    if (forward > 0.05) {
      vec2 q = vec2(dot(skyRay, right), dot(skyRay, up)) / forward;
      float flatten = max(inclination, 0.55);
      vec2 planeSky = vec2(q.x, q.y / flatten);
      float local = 1.0 - smoothstep(0.15, 1.65, length(planeSky));
      float angle = uFormation.z * local;
      float c = cos(angle), s = sin(angle);
      planeSky = vec2(c * planeSky.x - s * planeSky.y, s * planeSky.x + c * planeSky.y);
      planeSky *= 1.0 - uFormation.w * local;
      skyRay = normalize(fwd + right * planeSky.x + up * planeSky.y * flatten);
    }
  }
  outEscape = vec4(skyRay, escape);
}`;


// Emission-only upsampling shared by the full-resolution composite.
export const diskReconstruction = /* glsl */ `
vec4 sampleDisk(vec2 uv) {
  // Positive cubic B-spline reconstruction: continuous slopes along enlarged
  // bright arcs, without the ringing of sharpening kernels. Four bilinear
  // taps combine the sixteen weights. Keep coverage and the sky unblurred.
  vec2 pixel = uv / uDiskTexel - 0.5;
  vec2 base = floor(pixel), f = fract(pixel), inv = 1.0 - f;
  vec2 w0 = inv * inv * inv / 6.0;
  vec2 w1 = (3.0 * f * f * f - 6.0 * f * f + 4.0) / 6.0;
  vec2 w2 = (-3.0 * f * f * f + 3.0 * f * f + 3.0 * f + 1.0) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 a = (base - 0.5 + w1 / g0) * uDiskTexel;
  vec2 b = (base + 1.5 + w3 / g1) * uDiskTexel;
  vec3 light = texture2D(tDisk, a).rgb * g0.x * g0.y
             + texture2D(tDisk, vec2(b.x, a.y)).rgb * g1.x * g0.y
             + texture2D(tDisk, vec2(a.x, b.y)).rgb * g0.x * g1.y
             + texture2D(tDisk, b).rgb * g1.x * g1.y;
  return vec4(light, texture2D(tDisk, uv).a);
}
`;
