/** A shallow procedural cloud volume behind fixed stars. This is art-directed
 * density and light transport, not an astronomical or Navier–Stokes solver.
 * Low-frequency coordinates travel through the field instead of shifting a
 * pair of copies of the same photograph back and forth.
 */
export const NEBULA_PERIOD = 720;
const BEND_X = .0038, BEND_Y = .0034;
const fract = (v: number) => v - Math.floor(v);
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash = (x: number, y: number, z: number) => {
  let a = fract(x * .1031), b = fract(y * .1031), c = fract(z * .1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
};
const noise = (x: number, y: number, z: number) => {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const a = smooth(0, 1, fract(x)), b = smooth(0, 1, fract(y)), c = smooth(0, 1, fract(z));
  const plane = (dz: number) => mix(mix(hash(ix, iy, iz + dz), hash(ix + 1, iy, iz + dz), a),
    mix(hash(ix, iy + 1, iz + dz), hash(ix + 1, iy + 1, iz + dz), a), b);
  return mix(plane(0), plane(1), c);
};
const density = (x: number, y: number, z: number) => smooth(.34, .73,
  noise(x, y, z) * .68 + noise(x * 2.03 + 8, y * 2.03 + 3, z * 2.03 + 5) * .32);

export function sampleNebulaVolume(x: number, y: number, time: number) {
  if (!Number.isFinite(x + y)) return { opacity: 0, light: 0, dx: 0, dy: 0 };
  const t = Number.isFinite(time) ? Math.max(0, time) % NEBULA_PERIOD : 0;
  const angle = t / NEBULA_PERIOD * Math.PI * 2;
  const driftX = Math.sin(angle) * 16, driftY = (1 - Math.cos(angle)) * 11;
  const side = 1 - 2 * smooth(.35, .65, x);
  let transmittance = 1, light = 0, dx = 0, dy = 0;
  for (let i = 0; i < 4; i++) {
    const z = i * .72 + .3, speed = 1.25 - i * .22;
    const px = x * 9 + side * driftX * speed + i * .43;
    const py = y * 5.065 + (driftY - driftX * .28) * speed + i * .17;
    const d = density(px, py, z);
    const lit = density(px - .27, py - .18, z + .21);
    const alpha = 1 - Math.exp(-d * .32);
    const illumination = Math.max(.2, Math.min(1.8, .78 + (d - lit) * 1.6));
    light += transmittance * alpha * illumination;
    dx += (d - .5) * BEND_X;
    dy += (lit - .5) * BEND_Y;
    transmittance *= 1 - alpha;
  }
  return { opacity: 1 - transmittance, light, dx, dy };
}

// Same bounded field and integration as the CPU diagnostic, without frame
// history. Four depth samples, two density scales, a short light-direction probe.
export const NEBULA_VOLUME_GLSL = `
float volumeHash(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float volumeNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(volumeHash(i), volumeHash(i + vec3(1,0,0)), f.x),
        mix(volumeHash(i + vec3(0,1,0)), volumeHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(volumeHash(i + vec3(0,0,1)), volumeHash(i + vec3(1,0,1)), f.x),
        mix(volumeHash(i + vec3(0,1,1)), volumeHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float cloudDensity(vec3 p) {
  return smoothstep(.34, .73, volumeNoise(p) * .68 + volumeNoise(p * 2.03 + vec3(8,3,5)) * .32);
}
vec4 volumeAt(vec2 uv, float seconds) {
  float angle = seconds / ${NEBULA_PERIOD}.0 * 6.2831853;
  vec2 drift = vec2(sin(angle) * 16.0, (1.0 - cos(angle)) * 11.0);
  float side = 1.0 - 2.0 * smoothstep(.35, .65, uv.x);
  float transmittance = 1.0, light = 0.0;
  vec2 bend = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    float depth = float(i), speed = 1.25 - depth * .22;
    vec3 p = vec3(uv * vec2(9.0, 5.065) + vec2(side * drift.x, drift.y - drift.x * .28) * speed
      + depth * vec2(.43, .17), depth * .72 + .3);
    float d = cloudDensity(p), lit = cloudDensity(p + vec3(-.27, -.18, .21));
    float alpha = 1.0 - exp(-d * .32);
    float illumination = clamp(.78 + (d - lit) * 1.6, .2, 1.8);
    light += transmittance * alpha * illumination;
    bend += vec2((d - .5) * ${BEND_X}, (lit - .5) * ${BEND_Y});
    transmittance *= 1.0 - alpha;
  }
  return vec4(1.0 - transmittance, light, bend);
}
`;
