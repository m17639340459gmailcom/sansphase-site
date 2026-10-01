// Procedural emitting gas in the physical disk plane. This is a bounded,
// artistic flow field, not an MHD solver or an observed black-hole texture.
export const plasmaMaterial = /* glsl */ `
// All gas changes share one slower clock so shear, inward flow and evolution
// retain their relationship rather than changing angular speed in isolation.
float materialTime() { return uTime * 0.60; }
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1); p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Call only from uniform shading, AFTER ray integration has reconverged.
// Measure each advected octave in screen pixels: this includes lens compression,
// perspective, shear and the current ray-buffer resolution, unlike distance LOD.
float filteredNoise(vec3 p, float footprint) {
  return 0.5 + (noise(p) - 0.5) * (1.0 - smoothstep(0.3, 0.95, footprint));
}
float projectedNoise(vec3 p) {
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  return filteredNoise(p, footprint);
}
float filaments(float radius, float angle, float age) {
  // Log-radius stretches texture along the stream. Differential advection is
  // renewed before it can wind indefinitely into aliased concentric stripes.
  float flow = angle - age * 1.5 * pow(radius, -1.5);
  vec3 p = vec3(log(radius) * 15.0 + materialTime() * 0.035,
                cos(flow) * 4.5, sin(flow) * 4.5);
  float n = projectedNoise(p * 0.45 + 3.7) * 0.15;
  n += projectedNoise(p) * 0.56;
  n += projectedNoise(p * 2.03 + 7.1) * 0.24;
  n += projectedNoise(p * 4.09 - 3.4) * 0.05;
  return n;
}
float innerPatches(float r, float angle, float age, float time) {
  float innerFlow = 1.0 - smoothstep(3.0, 6.0, r);
  float knotAngle = angle - age * mix(0.12, 0.32, innerFlow) * innerFlow;
  float knotScale = mix(4.0, 2.4, innerFlow);
  return projectedNoise(vec3(cos(knotAngle) * knotScale,
                            sin(knotAngle) * knotScale, r * 0.55 + time * 0.06));
}
vec2 gasStructure(float r, float phi) {
  // Features advance in +phi, matching the velocity used for Doppler below.
  // Positive radial texture offset advects the pattern slowly inward.
  float time = materialTime();
  // A restrained bulk turn leaves the differential flow readable, especially
  // across the broad outer band. Longer-lived patches are easier to follow.
  float angle = phi + uFormationTurn - time * 0.07;
  float life = fract(time / 9.0);
  float blend = 0.5 - 0.5 * cos(life * 6.2831853);
  float stream = mix(filaments(r, angle, fract(life + 0.5) * 9.0),
                     filaments(r, angle, life * 9.0), blend);
  // These patches used to shear with TOTAL elapsed time, winding into ever
  // finer stripes even though filaments already renewed their age. Renew both
  // staggered fields while invisible, with zero-slope blends at each handoff.
  float patchLife = fract(time / 12.0);
  float patchBlend = 0.5 - 0.5 * cos(patchLife * 6.2831853);
  float clumps = mix(innerPatches(r, angle, fract(patchLife + 0.5) * 12.0, time),
                    innerPatches(r, angle, patchLife * 12.0, time), patchBlend);
  return vec2(stream, clumps);
}
vec4 disk(vec3 p, float r, vec3 toEye) {
  float extent = max(uFormation.x, 0.02);
  // Carry the same material patches outward with the growing disk. Normalized
  // radius avoids replacing them with unrelated noise as its boundary expands.
  float materialRadius = max(r / extent, 0.1);
  vec2 structure = gasStructure(materialRadius, atan(p.z, p.x));
  float stream = structure.x, clumps = structure.y;
  float ribbons = smoothstep(0.35, 0.72, stream);
  float mass = max(uFormation.x, 0.02);
  float inner = smoothstep(2.85 * mass, 3.15 * mass, r);
  float outer = 1.0 - smoothstep(6.8, 11.0, materialRadius);
  float coverage = inner * outer;
  // Approximated orbital Doppler + gravitational redshift: receding material
  // is dimmer, but a small exposure floor preserves readability on dark UI.
  vec3 tangent = normalize(vec3(-p.z, 0.0, p.x));
  float beta = sqrt(0.5 / max(r - 1.0, 1.0));
  float shift = sqrt(max(0.1, 1.0 - 1.0 / r)) * sqrt(1.0 - beta * beta)
              / max(0.3, 1.0 - beta * dot(tangent, toEye));
  float beam = 0.24 + pow(clamp(shift, 0.45, 1.6), 3.0);
  float heat = pow(3.0 / max(materialRadius, 3.0), 0.85);
  vec3 colour = mix(vec3(1.0,0.19,0.025), vec3(1.0,0.69,0.28), heat);
  colour = mix(colour, vec3(1.0,0.93,0.78), smoothstep(0.73,1.0,heat));
  float hotKnots = smoothstep(0.53,0.85,clumps) * ribbons;
  float luminosity = (0.13 + 1.35 * ribbons + 1.5 * hotKnots) * heat * heat;
  // Resolve moving inner patches rather than an overexposed solid white rim.
  // They are the same material, projected through the same rays as the outside.
  float innerFlow = 1.0 - smoothstep(3.6, 5.4, materialRadius);
  luminosity *= mix(1.0, 0.10 + 1.9 * pow(smoothstep(0.20, 0.78, clumps), 2.0), innerFlow);
  // Leave room for moving light/dark patches instead of a clipped white band.
  luminosity /= 1.0 + luminosity * 0.45 * innerFlow;
  luminosity *= mix(1.0, 0.65, innerFlow);
  beam = mix(beam, 0.45 + pow(clamp(shift, 0.45, 1.6), 1.6), innerFlow * 0.65);
  float opacity = coverage * (0.68 + 0.24 * ribbons) * uFormation.y;
  return vec4(colour * luminosity * beam * coverage * uHeat, opacity);
}
`;
