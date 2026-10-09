// Re-centres the reference artwork so the ring's centre is the centre of a square overlay, then runs the
// same centre-transparency test as usableFrame() in server/community-images.ts. Not release source.
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('.', import.meta.url));
// measured with measure.mjs: the opening spans x 252-1003 and starts at y 213, so the ring is centred on (627.5, 588.5)
export const SIZE = 1265, LEFT = 5, TOP = 44, SOURCE = 1254;
const base = await sharp(`${root}source.webp`).extract({ left: 0, top: 0, width: SOURCE, height: SIZE - TOP })
  .extend({ left: LEFT, top: TOP, right: SIZE - SOURCE - LEFT, bottom: 0, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
await sharp(base).toFile(`${root}base.png`);
await sharp(base).resize(640, 640).webp({ quality: 92, alphaQuality: 100 }).toFile(`${root}base-640.webp`);

// Three masks cut from the painting itself, so every moving light lands only on the material it belongs to:
// gold metalwork, the saturated blue ribbons and backing, and the pale moon glass and crystals.
{
  const M = 640, { data: px } = await sharp(base).resize(M, M).raw().toBuffer({ resolveWithObject: true });
  const masks = { gold: Buffer.alloc(M * M * 4), blue: Buffer.alloc(M * M * 4), pale: Buffer.alloc(M * M * 4) };
  for (let p = 0; p < M * M; p++) {
    const r = px[p * 4] / 255, g = px[p * 4 + 1] / 255, b = px[p * 4 + 2] / 255, a = px[p * 4 + 3];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, sat = max ? d / max : 0;
    let hue = 0;
    if (d) { hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; hue = (hue * 60 + 360) % 360; }
    const hit = { gold: hue >= 22 && hue <= 62 && sat >= 0.2 && max >= 0.4, blue: hue >= 195 && hue <= 250 && sat >= 0.38, pale: sat < 0.3 && max > 0.82 };
    for (const k in masks) { masks[k].fill(255, p * 4, p * 4 + 3); masks[k][p * 4 + 3] = hit[k] && a > 128 ? 255 : 0; }
  }
  for (const k in masks) await sharp(masks[k], { raw: { width: M, height: M, channels: 4 } }).blur(0.8).png().toFile(`${root}mask-${k}.png`);
}

// The ribbons wave. The painting is one flat picture, so it is split in two: everything in the ribbon zone that is
// not gold goes to a layer that is bent by a travelling wave; the gold and everything outside the zone stays put on top.
// `env` says how far each point may move: nothing where the ribbons are tied to the frame, most at their free ends.
export const WAVE = SIZE / 3;
{
  const M = 640, k = SIZE / M, { data: px } = await sharp(base).resize(M, M).raw().toBuffer({ resolveWithObject: true });
  const step = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const env = (x, y) => {
    let e = step(330, 560, Math.abs(x - SIZE / 2)) * step(770, 850, y);
    for (const xp of [230, 1035]) e *= 1 - (1 - step(20, 40, Math.abs(x - xp))) * step(940, 975, y); // the pendants hang still
    return e;
  };
  const gold = new Uint8Array(M * M), zone = new Float32Array(M * M);
  for (let p = 0; p < M * M; p++) {
    const r = px[p * 4] / 255, g = px[p * 4 + 1] / 255, b = px[p * 4 + 2] / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let hue = 0; if (d) { hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; hue = (hue * 60 + 360) % 360; }
    gold[p] = px[p * 4 + 3] > 40 && hue >= 15 && hue <= 70 && d / (max || 1) >= 0.15 && max >= 0.15 ? 1 : 0;
    zone[p] = env((p % M + 0.5) * k, (Math.floor(p / M) + 0.5) * k);
  }
  const fixed = new Uint8Array(M * M);
  for (let y = 1; y < M - 1; y++) for (let x = 1; x < M - 1; x++) { const p = y * M + x; fixed[p] = gold[p] || gold[p - 1] || gold[p + 1] || gold[p - M] || gold[p + M] ? 1 : 0; }
  const still = Buffer.from(px), ribbon = Buffer.alloc(M * M * 4);
  for (let p = 0; p < M * M; p++) if (zone[p] > 0.004 && !fixed[p]) { px.copy(ribbon, p * 4, p * 4, p * 4 + 4); still[p * 4 + 3] = 0; }
  // carry the ribbon on underneath the gold it passes behind, so no gap opens beside the metal when it moves
  let front = ribbon;
  for (let pass = 0; pass < 14; pass++) {
    const next = Buffer.from(front);
    for (let y = 1; y < M - 1; y++) for (let x = 1; x < M - 1; x++) {
      const p = y * M + x; if (!(zone[p] > 0.004 && fixed[p]) || front[p * 4 + 3]) continue;
      let n = 0, a = 0, c = [0, 0, 0];
      for (const q of [p - 1, p + 1, p - M, p + M, p - M - 1, p - M + 1, p + M - 1, p + M + 1]) { const w = front[q * 4 + 3]; if (!w) continue; n++; a += w; for (let i = 0; i < 3; i++) c[i] += front[q * 4 + i] * w; }
      if (n >= 2) { for (let i = 0; i < 3; i++) next[p * 4 + i] = c[i] / a; next[p * 4 + 3] = a / n; }
    }
    front = next;
  }
  const raw = { raw: { width: M, height: M, channels: 4 } };
  await sharp(still, raw).webp({ quality: 92, alphaQuality: 100 }).toFile(`${root}still-640.webp`);
  await sharp(front, raw).webp({ quality: 92, alphaQuality: 100 }).toFile(`${root}ribbon-640.webp`);
  // displacement maps: red moves a point up and down, green side to side; the wave repeats every WAVE units across
  const E = 320, e = Buffer.alloc(E * E * 3);
  for (let p = 0; p < E * E; p++) e.fill(Math.round(255 * env((p % E + 0.5) * SIZE / E, (Math.floor(p / E) + 0.5) * SIZE / E)), p * 3, p * 3 + 3);
  await sharp(e, { raw: { width: E, height: E, channels: 3 } }).png().toFile(`${root}env.png`);
  const WW = 512, WH = 256, w = Buffer.alloc(WW * WH * 3);
  for (let y = 0; y < WH; y++) for (let x = 0; x < WW; x++) {
    const a = 2 * Math.PI * x / (WW / 4), t = 2 * Math.PI * y / WH;
    const v = 0.72 * Math.sin(a + 1.6 * t) + 0.28 * Math.sin(2 * a - 2.3 * t + 1.7), h = 0.6 * Math.cos(a + 1.6 * t + 0.8);
    w[(y * WW + x) * 3] = Math.round(127.5 + 127 * v); w[(y * WW + x) * 3 + 1] = Math.round(127.5 + 127 * h); w[(y * WW + x) * 3 + 2] = 128;
  }
  await sharp(w, { raw: { width: WW, height: WH, channels: 3 } }).png().toFile(`${root}wave.png`);
}

const { data, info } = await sharp(base).resize(64, 64, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
let center = 0, clear = 0;
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if ((x - 31.5) ** 2 + (y - 31.5) ** 2 < 18 ** 2) { center++; if (data[(y * 64 + x) * info.channels + 3] <= 16) clear++; }
console.log(`centre clear ${(clear / center * 100).toFixed(1)}% (upload needs 98)`);
