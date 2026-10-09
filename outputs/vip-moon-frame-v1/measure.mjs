// Measures the reference artwork: painted bounds, the clear opening, and how it should sit on a square overlay.
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('.', import.meta.url));
const { data, info } = await sharp(`${root}source.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, A = (x, y) => data[(y * W + x) * 4 + 3];
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (A(x, y) > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
// the opening: everything clear that is connected to the middle of the picture
const seen = new Uint8Array(W * H), stack = [Math.round(H / 2) * W + Math.round(W / 2)];
let n = 0, sx = 0, sy = 0, ox0 = W, oy0 = H, ox1 = 0, oy1 = 0;
while (stack.length) {
  const p = stack.pop(); if (seen[p]) continue; const x = p % W, y = (p - x) / W; if (A(x, y) > 16) continue;
  seen[p] = 1; n++; sx += x; sy += y; if (x < ox0) ox0 = x; if (x > ox1) ox1 = x; if (y < oy0) oy0 = y; if (y > oy1) oy1 = y;
  if (x > 0) stack.push(p - 1); if (x < W - 1) stack.push(p + 1); if (y > 0) stack.push(p - W); if (y < H - 1) stack.push(p + W);
}
const leaked = ox0 === 0 || oy0 === 0 || ox1 === W - 1 || oy1 === H - 1;
const cx = sx / n, cy = sy / n;
let rMin = Infinity;
for (let a = 0; a < 720; a++) { const c = Math.cos(a * Math.PI / 360), s = Math.sin(a * Math.PI / 360); let r = 0; while (true) { const x = Math.round(cx + c * r), y = Math.round(cy + s * r); if (x < 0 || y < 0 || x >= W || y >= H || A(x, y) > 16) break; r++; } if (r < rMin) rMin = r; }
const half = Math.max(cx - x0, x1 - cx, cy - y0, y1 - cy);
console.log({ size: [W, H], painted: [x0, y0, x1, y1], opening: [ox0, oy0, ox1, oy1], leaked, centre: [cx.toFixed(1), cy.toFixed(1)], clearRadius: rMin, equivalentRadius: Math.sqrt(n / Math.PI).toFixed(1), squareHalf: half.toFixed(1), overlayRatio: (half / rMin).toFixed(3) });
