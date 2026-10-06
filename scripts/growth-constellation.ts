// 成长等级“命之座”星盘徽章：十枚自包含的矢量图标，由本模块确定性生成。
// 发布资产由 scripts/build-growth-constellation.mjs 写入 public/assets/community/levels/，不手工修改。
// 设计约定见 docs/COMMUNITY-EXPERIENCE-RULES.md。图标内不含脚本、外链或位图。
import { communityGrowthLevel } from '../src/community-growth.ts';

type Point = [number, number];
type Figure = { s: number[][]; e: number[][]; ghost: string; band?: boolean } | { galaxy: true };

const f = (n: number): number => Number(n.toFixed(2));
const rad = (d: number): number => d * Math.PI / 180;
const pol = (r: number, deg: number): Point => [100 + r * Math.cos(rad(deg)), 100 + r * Math.sin(rad(deg))];
const pt = (p: number[]): string => `${f(p[0])} ${f(p[1])}`;
function rng(seed: number): () => number { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function sparkle(cx: number, cy: number, R: number, r: number, rot = -90): string {
  let d = `M${f(cx + R * Math.cos(rad(rot)))} ${f(cy + R * Math.sin(rad(rot)))}`;
  for (let i = 1; i <= 4; i++) {
    const a = rot + i * 90;
    d += `Q${f(cx + r * Math.cos(rad(a - 45)))} ${f(cy + r * Math.sin(rad(a - 45)))} ${f(cx + R * Math.cos(rad(a)))} ${f(cy + R * Math.sin(rad(a)))}`;
  }
  return d + 'Z';
}

/* Hand-placed constellations. s: [x, y, magnitude 1-4]; e: index pairs; ghost: faint illustration under the lines. */
const figures: Figure[] = [
  { s: [[100, 134, 1], [99, 109, 2], [79, 88, 2], [121, 81, 4]], e: [[0, 1], [1, 2], [1, 3]],
    ghost: '<path d="M99 109Q83 107 79 88Q96 91 99 109Z"/><path d="M99 109Q103 86 121 81Q119 102 99 109Z"/>' },
  { s: [[100, 135, 2], [81, 117, 1], [87, 96, 2], [104, 64, 4], [119, 105, 2], [101, 114, 1]], e: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [5, 0]],
    ghost: '<path d="M100 135Q76 123 87 96Q94 84 104 64Q108 90 119 105Q125 125 100 135Z"/><path d="M100 135Q90 126 97 113Q101 107 103 98Q108 112 109 120Q109 130 100 135Z" opacity=".9"/>' },
  { s: [[100, 62, 1], [100, 78, 2], [83, 91, 2], [117, 91, 2], [85, 117, 1], [115, 117, 1], [100, 130, 2], [100, 104, 4]], e: [[0, 1], [1, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 6]],
    ghost: '<path d="M100 78L117 91L115 117L100 130L85 117L83 91Z"/><path d="M88 80Q100 54 112 80" fill="none" stroke="currentColor" stroke-width="1.2"/>' },
  { s: [[129, 66, 4], [119, 79, 2], [94, 91, 2], [108, 105, 2], [75, 127, 2], [68, 86, 1], [82, 70, 1], [101, 60, 1]], e: [[1, 2], [1, 3], [2, 4], [3, 4], [2, 3]],
    ghost: '<path d="M119 79L94 91L75 127Z"/><path d="M119 79L108 105L75 127Z" opacity=".5"/><path d="M68 86Q80 62 101 60" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1.5 4"/>' },
  { s: [[60, 100, 2], [80, 85, 1], [100, 79, 2], [120, 85, 1], [140, 100, 2], [120, 115, 1], [100, 121, 2], [80, 115, 1], [100, 100, 4]], e: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0]],
    ghost: '<path d="M60 100Q100 62 140 100Q100 138 60 100Z"/><circle cx="100" cy="100" r="15" fill="none" stroke="currentColor" stroke-width="1"/>' },
  { s: [[98, 60, 4], [98, 121, 2], [131, 112, 2], [73, 109, 2], [64, 121, 2], [136, 121, 2], [123, 136, 1], [79, 136, 1]], e: [[0, 1], [0, 2], [2, 1], [0, 3], [3, 1], [4, 5], [5, 6], [6, 7], [7, 4]],
    ghost: '<path d="M98 60L131 112L98 121Z"/><path d="M98 60L73 109L98 121Z" opacity=".55"/><path d="M64 121L136 121L123 136L79 136Z" opacity=".8"/>' },
  { s: [[72, 66, 2], [72, 89, 1], [72, 111, 1], [72, 134, 2], [128, 66, 2], [128, 89, 1], [128, 111, 1], [128, 134, 2], [100, 100, 4], [100, 77.5, 2], [100, 122.5, 2]],
    e: [[0, 5], [4, 1], [1, 6], [5, 2], [2, 7], [6, 3], [0, 3], [4, 7]],
    ghost: '<path d="M72 66L100 77.5L128 66L128 134L100 122.5L72 134Z" opacity=".7"/><path d="M100 77.5L128 100L100 122.5L72 100Z"/>' },
  { s: [[139, 70, 4], [127, 79, 2], [104, 98, 3], [74, 121, 2], [91, 80, 2], [69, 74, 2], [117, 116, 2], [118, 139, 2]], e: [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5], [2, 6], [6, 7], [5, 3], [7, 3]],
    ghost: '<path d="M104 98L91 80L69 74L74 121Z"/><path d="M104 98L117 116L118 139L74 121Z" opacity=".6"/>' },
  { s: [[60, 68, 2], [80, 63, 2], [101, 74, 3], [104, 97, 4], [97, 118, 3], [109, 134, 2], [134, 137, 2], [70, 90, 1], [132, 108, 1], [124, 72, 1], [76, 128, 1]], e: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]],
    ghost: '<path d="M54 70Q92 50 104 86Q112 122 146 138" fill="none" stroke="currentColor" stroke-width="26" stroke-linecap="round" opacity=".55"/><path d="M54 70Q92 50 104 86Q112 122 146 138" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>',
    band: true },
  { galaxy: true },
];

const gold = ['#573a10', '#d6b062', '#fff5d6'];
const prism: Record<number, string[]> = {
  8: ['#4df2d6', '#5aa2ff', '#b07bff'],
  9: ['#4df2d6', '#5aa2ff', '#b07bff', '#ff6fc8'],
  10: ['#4df2d6', '#5aa2ff', '#b07bff', '#ff6fc8', '#ffc85a'],
};
const rankMetal = [
  ['#232b38', '#6f7b8f', '#c3ccda'], // 铁
  ['#4a2412', '#c47a45', '#ffd9b0'], // 赤铜
  ['#39445a', '#b4c0d2', '#ffffff'], // 白银
  ['#0f4a44', '#3fc4a8', '#d6fff3'], // 翡翠
  ['#16337a', '#5a96f0', '#e2f0ff'], // 蓝宝
  ['#3a1f73', '#a47cf0', '#f1e6ff'], // 紫晶
  ['#573a10', '#d6b062', '#fff5d6'], // 鎏金
];
const rankNebula = [['#3f6f72'], ['#c8582a', '#7a2f4a'], ['#c9a94a', '#48608f'], ['#1fae9a', '#2c6fb0'], ['#2f6fe0', '#5a3fc0'], ['#8a4fe0', '#d04fa0'], ['#d09030', '#b03a5a']];
const rankInk = ['#cfe3dc', '#ffe2c8', '#fff6dc', '#d2fff3', '#d6e8ff', '#ecdcff', '#ffe8ba'];
const rankJewel = [['#e2f7ec', '#6fae98'], ['#ffe0b8', '#e0531f'], ['#fffbe0', '#e8b830'], ['#c9fff5', '#12a08a'], ['#d6ecff', '#1f5fe0'], ['#f0dcff', '#8a3fe0'], ['#ffc2cc', '#c0244f']];
const discR = [50, 52, 54, 56, 58, 60, 61, 59, 59, 59];
const bezelW = [2, 2.6, 3, 3.4, 3.8, 4.8, 5.2, 6.2, 6.6, 7.2];

/* ── frame parts ── */
// Crescent wing hugging the disc: inner edge follows radius Rc, outer edge bulges by t.
function crescent(rot: number, Rc: number, span: number, t: number, fill: string, stroke: string): string {
  const p1 = pol(Rc, -span);
  const p2 = pol(Rc, span);
  const c = Rc * Math.sin(rad(span));
  const s = Rc - Math.sqrt(Rc * Rc - c * c) + t;
  const r2 = (c * c + s * s) / (2 * s);
  const mid = pol(Rc + t * 0.55, 0);
  return `<g transform="rotate(${rot} 100 100)"><path d="M${pt(p1)}A${f(r2)} ${f(r2)} 0 0 1 ${pt(p2)}A${Rc} ${Rc} 0 0 0 ${pt(p1)}Z" fill="${fill}" stroke="${stroke}" stroke-width="0.8" stroke-linejoin="round"/><path d="M${pt(pol(Rc + t * 0.55, -span * 0.62))}Q${pt([mid[0] + t * 0.5, mid[1]])} ${pt(pol(Rc + t * 0.55, span * 0.62))}" fill="none" stroke="#fff" stroke-width=".6" opacity=".6" stroke-linecap="round"/></g>`;
}
// Faceted gem in a small setting, centred `dist` from the middle.
function gem(angle: number, dist: number, w: number, h: number, fill: string, stroke: string, cls = ''): string {
  const y = 100 - dist;
  return `<g transform="rotate(${angle} 100 100)"><path d="M100 ${f(y - h)}L${f(100 + w)} ${f(y)}L100 ${f(y + h)}L${f(100 - w)} ${f(y)}Z" fill="${fill}" stroke="${stroke}" stroke-width=".8" stroke-linejoin="round"/><path d="M100 ${f(y - h)}L${f(100 + w)} ${f(y)}L100 ${f(y + h)}Z" fill="#081022" opacity=".32"/><path d="M100 ${f(y - h * 0.62)}L${f(100 - w * 0.55)} ${f(y - h * 0.05)}L100 ${f(y + h * 0.1)}Z" fill="#fff" opacity=".7"${cls ? ` class="${cls}"` : ''}/></g>`;
}
// Slim concave blade for crowns.
function blade(angle: number, R0: number, len: number, w: number, fill: string, stroke: string): string {
  const tip = 100 - R0 - len;
  const sh = 100 - R0 - len * 0.22;
  const base = 100 - R0 + 2;
  return `<g transform="rotate(${angle} 100 100)"><path d="M100 ${f(tip)}Q${f(100 - w * 0.25)} ${f((tip + sh) / 2)} ${f(100 - w)} ${f(sh)}L100 ${f(base)}L${f(100 + w)} ${f(sh)}Q${f(100 + w * 0.25)} ${f((tip + sh) / 2)} 100 ${f(tip)}Z" fill="${fill}" stroke="${stroke}" stroke-width=".7" stroke-linejoin="round"/><path d="M100 ${f(tip)}L${f(100 + w)} ${f(sh)}L100 ${f(base)}Z" fill="#081022" opacity=".3"/></g>`;
}
function beads(Rb: number, n: number, r: number, fill: string, stroke: string): string {
  let out = '';
  for (let i = 0; i < n; i++) { const p = pol(Rb, i * 360 / n + 180 / n); out += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${r}"/>`; }
  return `<g fill="${fill}" stroke="${stroke}" stroke-width=".45">${out}</g>`;
}
// Four swooping arms that show from behind the disc.
function backplate(id: string, key: string, tip: number, waist: number, rot: number, fill: string, stroke: string): string {
  const d = sparkle(100, 100, tip, waist, rot);
  const enamel = fill.endsWith('p)');
  let shade = '';
  for (let i = 0; i < 4; i++) { const a = rot + i * 90; shade += `M${pt(pol(tip + 4, a))}L100 100L${pt(pol(tip + 4, a + 45))}Z`; }
  let glint = '';
  for (let i = 0; i < 4; i++) { const a = rot + i * 90; glint += `M${pt(pol(64, a))}L${pt(pol(tip - 3, a))}`; }
  return `<clipPath id="${id}b${key}"><path d="${d}"/></clipPath><path d="${d}" fill="${enamel ? `url(#${id}bp)` : fill}" stroke="${stroke}" stroke-width="${enamel ? 1.9 : 1.1}" stroke-linejoin="round"/>${enamel ? `<path d="${sparkle(100, 100, tip - 9, waist - 5, rot)}" fill="none" stroke="${fill}" stroke-width="1.4" stroke-linejoin="round"/>` : ''}<path d="${shade}" fill="#081022" opacity=".3" clip-path="url(#${id}b${key})"/><path d="${glint}" stroke="#fff" stroke-width=".7" opacity=".75" stroke-linecap="round" class="tw2"/>`;
}

// Comet on the outer orbit: flared head, colour-shifting tail that thins out behind it.
function comet(id: string, r: number, angle: number, tail: number, size: number, tints: string[], dir: 1 | -1): string {
  const n = 9;
  let out = '';
  for (let i = n - 1; i >= 0; i--) {
    const a1 = angle - dir * (tail * i / n);
    const a2 = angle - dir * (tail * (i + 1) / n);
    const k = 1 - i / n;
    out += `<path d="M${pt(pol(r, a1))}A${r} ${r} 0 0 ${dir > 0 ? 0 : 1} ${pt(pol(r, a2))}" fill="none" stroke="${tints[i % tints.length]}" stroke-width="${f(size * 1.7 * k + 0.3)}" stroke-linecap="round" opacity="${f(0.95 * k * k + 0.05)}"/>`;
  }
  out += `<path d="M${pt(pol(r, angle))}A${r} ${r} 0 0 ${dir > 0 ? 0 : 1} ${pt(pol(r, angle - dir * tail * 0.45))}" fill="none" stroke="#fff" stroke-width="${f(size * 0.42)}" stroke-linecap="round" opacity=".9"/>`;
  for (let i = 1; i <= 3; i++) { const p = pol(r + (i % 2 ? 3.2 : -3), angle - dir * tail * (0.35 + i * 0.22)); out += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(size * 0.3)}" fill="#fff" class="tw${i % 3}"/>`; }
  const h = pol(r, angle);
  out += `<circle cx="${f(h[0])}" cy="${f(h[1])}" r="${f(size * 2.4)}" fill="url(#${id}s)"/><path d="${sparkle(h[0], h[1], size * 2.4, size * 0.2)}" fill="#fff" opacity=".7" class="tw1"/><path d="${sparkle(h[0], h[1], size * 1.35, size * 0.32)}" fill="#fff"/>`;
  return out;
}
function gyro(id: string, tilt: number, part: 't' | 'b', tints: string[], k: number): string {
  const e = '<ellipse cx="100" cy="100" rx="97" ry="23" fill="none" ';
  return `<g transform="rotate(${tilt} 100 100)"><g clip-path="url(#${id}g${part})">${e}stroke="url(#${id}m)" stroke-width="1.1" opacity="${part === 't' ? 0.55 : 0.95}"/>${e}stroke="${tints[(k * 2 + 2) % tints.length]}" stroke-width="3.4" stroke-linecap="round" pathLength="100" class="run2" style="animation-delay:${-k * 2.1}s;stroke-dasharray:20 80" opacity=".6"/>${e}stroke="#fff" stroke-width="1.9" stroke-linecap="round" pathLength="100" class="run2" style="animation-delay:${-k * 2.1}s" opacity="${part === 't' ? 0.7 : 1}"/></g></g>`;
}
function starMark(id: string, x: number, y: number, mag: number, level: number, i: number, lift = 0): string {
  const tw = level >= 3 ? ` class="tw${i % 3}"` : '';
  const halo = (r: number): string => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}s)"/>`;
  if (mag === 1) return `<g${tw}>${halo(4)}<circle cx="${x}" cy="${y}" r="1.4" fill="#fff"/></g>`;
  if (mag === 2) return `<g${tw}>${halo(7.5)}<path d="${sparkle(x, y, 5.6, 0.9)}" fill="#fff"/></g>`;
  if (mag === 3) return `<g${tw}>${halo(11)}<path d="${sparkle(x, y, 8.6, 1.2)}" fill="#fff"/><path d="${sparkle(x, y, 3.6, 0.7, -45)}" fill="#fff" opacity=".8"/></g>`;
  const big = 10 + level * 0.45 + lift;
  return `<g${level >= 2 ? ' class="beat"' : ''} style="transform-origin:${x}px ${y}px">${halo(big * 1.9)}<path d="${sparkle(x, y, big * 1.75, 0.45)}" fill="#fff" opacity=".55"/><path d="${sparkle(x, y, big * 0.62, 0.9, -45)}" fill="#fff" opacity=".85"/><path d="${sparkle(x, y, big, 1.6)}" fill="#fff"/></g>`;
}

// 星海: a tilted spiral of stars turning around a supernova.
function galaxy(id: string, level: number, tints: string[], rand: () => number): string {
  let arms = '';
  let dots = '';
  let lines = '';
  for (let a = 0; a < 3; a++) {
    const pts: Point[] = [];
    for (let k = 0; k <= 7; k++) pts.push(pol(9 + k * 7.4, a * 120 + k * 34));
    let d = `M${pt(pts[0])}`;
    for (let k = 1; k < pts.length; k++) {
      const mid = pol(9 + (k - 0.5) * 7.4 + 1.6, a * 120 + (k - 0.5) * 34);
      d += `Q${pt(mid)} ${pt(pts[k])}`;
    }
    arms += `<path d="${d}" fill="none" stroke="${tints[(a * 2) % tints.length]}" stroke-width="15" stroke-linecap="round" opacity=".2"/><path d="${d}" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" opacity=".16"/>`;
    lines += d;
    pts.slice(1).forEach((p, k) => {
      const r = k % 3 === 1 ? 2.5 : 1.5;
      dots += `<g class="tw${(k + a) % 3}"><circle cx="${f(p[0])}" cy="${f(p[1])}" r="${r * 3.4}" fill="url(#${id}s)"/><circle cx="${f(p[0])}" cy="${f(p[1])}" r="${r}" fill="#fff"/></g>`;
    });
    for (let i = 0; i < 26; i++) {
      const k = rand() * 7.4;
      const p = pol(9 + k * 7.4 + (rand() - 0.5) * 12, a * 120 + k * 34 + (rand() - 0.5) * 16);
      dots += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(0.4 + rand() * 0.8)}" fill="#fff" opacity="${f(0.35 + rand() * 0.6)}"/>`;
    }
  }
  const core = `<circle cx="100" cy="100" r="30" fill="url(#${id}s)"/><circle cx="100" cy="100" r="50" fill="url(#${id}s)" class="nova"/><circle cx="100" cy="100" r="20" fill="none" stroke="#fff" stroke-width="1.2" class="novaring"/>`;
  let rays = '';
  for (let i = 0; i < 8; i++) rays += `M100 100L${pt(pol(i % 2 ? 22 : 40, i * 45 + 22.5))}`;
  return `<g transform="translate(100 100) rotate(-22) scale(1 .6) translate(-100 -100)"><g class="gal">${arms}<path d="${lines}" fill="none" stroke="#fff" stroke-width="1" opacity=".5"/><path d="${lines}" pathLength="100" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" class="run"/>${dots}</g></g>`
    + `${core}<path d="${rays}" stroke="#fff" stroke-width=".7" opacity=".5" stroke-linecap="round" class="tw1"/>${starMark(id, 100, 100, 4, level, 0, 4)}`;
}

export function growthConstellationSVG(grade: number): string {
  const { level, name } = communityGrowthLevel(grade);
  const id = `g${level}`;
  const mv = level >= 8;
  const R = discR[level - 1];
  const w = bezelW[level - 1];
  const m = mv ? gold : rankMetal[level - 1];
  const tints = mv ? prism[level] : rankNebula[level - 1];
  const line = mv ? '#ffffff' : rankInk[level - 1];
  const fig = figures[level - 1];
  const rand = rng(level * 7919 + 17);
  const M = `url(#${id}m)`;   // tier metal (gold for prism tiers)
  const P = `url(#${id}p)`;   // prism inlay
  const E = mv ? '#3a2708' : m[0];
  const J = mv ? P : `url(#${id}j)`;   // jewel

  let defs = `<linearGradient id="${id}m" x1="28" y1="20" x2="172" y2="180" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${m[2]}"/><stop offset=".22" stop-color="${m[1]}"/><stop offset=".48" stop-color="${m[0]}"/><stop offset=".7" stop-color="${m[2]}"/><stop offset="1" stop-color="${m[1]}"/></linearGradient>`
    + `<radialGradient id="${id}d" cx=".5" cy=".36" r=".72"><stop offset="0" stop-color="${mv ? '#261f5c' : level >= 6 ? '#20305a' : '#1a2848'}"/><stop offset=".6" stop-color="${mv ? '#0d0f2c' : '#0c1429'}"/><stop offset="1" stop-color="#05070f"/></radialGradient>`
    + `<radialGradient id="${id}s"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".28" stop-color="${mv ? tints[1] : line}" stop-opacity=".42"/><stop offset="1" stop-color="${mv ? tints[2] : tints[0]}" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="${id}v"><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".62"/></radialGradient>`
    + `<clipPath id="${id}k"><circle cx="100" cy="100" r="${R}"/></clipPath>`;
  if (mv) defs += `<linearGradient id="${id}p" x1="20" y1="20" x2="180" y2="180" gradientUnits="userSpaceOnUse">${[...tints, tints[0]].map((c, i, a) => `<stop offset="${f(i / (a.length - 1))}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  if (mv) defs += `<radialGradient id="${id}bp" cx="100" cy="100" r="96" gradientUnits="userSpaceOnUse"><stop offset=".45" stop-color="#3a2a8c"/><stop offset="1" stop-color="#0a0c24"/></radialGradient><radialGradient id="${id}ry" cx="100" cy="100" r="99" gradientUnits="userSpaceOnUse"><stop offset=".5" stop-color="${tints[1]}" stop-opacity=".75"/><stop offset=".78" stop-color="${tints[2]}" stop-opacity=".3"/><stop offset="1" stop-color="${tints[0]}" stop-opacity="0"/></radialGradient><clipPath id="${id}gt"><rect x="-20" y="-20" width="240" height="120"/></clipPath><clipPath id="${id}gb"><rect x="-20" y="100" width="240" height="120"/></clipPath>`;
  const jewel = rankJewel[level - 1];
  if (jewel) defs += `<linearGradient id="${id}j" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${jewel[0]}"/><stop offset="1" stop-color="${jewel[1]}"/></linearGradient>`;
  tints.forEach((c, i) => { defs += `<radialGradient id="${id}n${i}"><stop offset="0" stop-color="${c}" stop-opacity="${mv ? 0.36 : f(0.42 + level * 0.035)}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`; });

  let out = '';
  // ── aura
  if (level >= 2) out += `<circle cx="100" cy="100" r="${mv ? 96 : R + 16 + level * 1.6}" fill="url(#${id}n0)" opacity="${mv ? 0.8 : f(0.22 + level * 0.085)}"${level >= 5 ? ' class="breath"' : ''}/>`;
  if (level === 10) {
    let rays = '';
    for (let i = 0; i < 72; i++) rays += `M${pt(pol(R + 5, i * 5))}L${pt(pol(R + (i % 6 === 0 ? 30 : i % 2 ? 13 : 19), i * 5))}`;
    out += `<g class="spinr"><path d="${rays}" stroke="${M}" stroke-width=".7" opacity=".7" stroke-linecap="round" class="tw0"/></g>`;
  }

  if (level >= 9) {
    const rays = (n: number): string => { let d = ''; for (let i = 0; i < n; i++) { const a = i * 360 / n; const h = 360 / n * (i % 2 ? 0.1 : 0.17); d += `M100 100L${pt(pol(99, a - h))}L${pt(pol(99, a + h))}Z`; } return d; };
    out += `<g class="ray0"><path d="${rays(level === 10 ? 12 : 8)}" fill="url(#${id}ry)" opacity="${level === 10 ? 0.62 : 0.5}"/></g>`;
    if (level === 10) out += `<g class="ray1"><path d="${rays(10)}" fill="url(#${id}ry)" opacity=".42"/></g>`;
  }
  if (mv) {
    for (let i = 0; i < level - 5; i++) out += `<g class="au${i % 2}" style="animation-delay:${-i * 1.7}s"><circle cx="100" cy="100" r="${R + 13 + i * 4.5}" fill="none" stroke="${tints[i % tints.length]}" stroke-width="${8 - i}" stroke-linecap="round" stroke-dasharray="${46 + i * 14} ${150 + i * 30}" opacity="${f(0.3 - i * 0.03)}"/></g>`;
  }
  // ── structure behind the disc
  if (level === 8) out += backplate(id, 'a', 90, 40, -45, P, M);
  if (level === 9) out += blade(0, R - 4, 40, 9, P, M) + blade(180, R - 4, 34, 8, P, M) + backplate(id, 'a', 90, 40, -45, P, M);
  if (level === 10) out += backplate(id, 'b', 97, 36, -90, M, E) + backplate(id, 'a', 88, 40, -45, P, M);

  // ── crescent wings
  const wing = (rc: number, span: number, t: number, fill = M, stroke = E): string => { const g = crescent(0, rc, span, t, fill, stroke) + crescent(180, rc, span, t, fill, stroke); return level >= 6 ? `<g class="wing">${g}</g>` : g; };
  if (level === 4) out += wing(R + 7, 17, 4.5);
  if (level === 5) out += wing(R + 9.5, 29, 6.5);
  if (level === 6) out += wing(R + 10.5, 41, 8.5);
  if (level === 7) out += wing(R + 21.5, 24, 3.6) + wing(R + 10.5, 45, 9);
  if (level === 8) out += wing(R + 11, 33, 7.5, P, M);
  if (level === 9) out += wing(R + 23, 20, 3.4, M, E) + wing(R + 11, 35, 8, P, M);
  if (level === 10) out += wing(R + 25, 22, 4, M, E) + wing(R + 11.5, 36, 9.5, P, M);

  const gyros = level === 9 ? [-24] : level === 10 ? [-27, 27] : [];
  gyros.forEach((t, k) => { out += gyro(id, t, 't', tints, k); });
  // ── disc: enamel, nebula, dust
  let disc = `<circle cx="100" cy="100" r="${R}" fill="url(#${id}d)"/>`;
  const spots = [[78, 80, 44, 34, -24], [124, 118, 46, 30, 18], [112, 74, 34, 26, 40], [82, 124, 36, 26, -12], [100, 100, 30, 30, 0]];
  tints.forEach((_tint, i) => {
    const [x, y, rx, ry, r] = spots[i];
    disc += `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${r} ${x} ${y})" fill="url(#${id}n${i})"${level >= 4 ? ` class="drift${i % 2}"` : ''}/>`;
  });
  let dust = '';
  for (let i = 0; i < 14 + level * 5; i++) {
    const p = pol(Math.sqrt(rand()) * (R - 5), rand() * 360);
    dust += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(0.35 + rand() * 0.6)}" opacity="${f(0.25 + rand() * 0.55)}"/>`;
  }
  disc += `<g fill="${line}">${dust}</g>`;
  if (level >= 4) {
    let ticks = '';
    for (let i = 0; i < 60; i++) ticks += `M${pt(pol(R - w / 2 - 1.5, i * 6))}L${pt(pol(R - w / 2 - (i % 5 ? 4 : 6.5), i * 6))}`;
    disc += `<path d="${ticks}" stroke="${line}" stroke-width=".7" opacity=".42"${level >= 5 ? ' class="spinr"' : ''}/>`;
  }
  if (level >= 3) disc += `<circle cx="100" cy="100" r="${f(R - w / 2 - (level >= 4 ? 9 : 4))}" fill="none" stroke="${line}" stroke-width=".6" opacity=".3"/>`;

  // ── constellation
  let art = '';
  if ('galaxy' in fig) {
    art = galaxy(id, level, tints, rand);
  } else {
    art = `<g fill="${mv ? tints[1] : J}" color="${mv ? tints[0] : line}" opacity="${fig.band ? 0.11 : mv ? 0.4 : f(0.34 + level * 0.035)}">${fig.ghost}</g>`;
    if (fig.band) {
      let band = '';
      for (let i = 0; i < 46; i++) {
        const t = rand();
        const x = (1 - t) ** 2 * 54 + 2 * (1 - t) * t * (t < 0.5 ? 92 : 112) + t ** 2 * 146 + (rand() - 0.5) * 22;
        band += `<circle cx="${f(x)}" cy="${f(70 + t * 68 + (rand() - 0.5) * 22)}" r="${f(0.4 + rand() * 0.8)}" opacity="${f(0.4 + rand() * 0.6)}"/>`;
      }
      art += `<g fill="#fff" class="tw2">${band}</g>`;
    }
    const edges = fig.e.map(([a, b]) => `M${fig.s[a][0]} ${fig.s[a][1]}L${fig.s[b][0]} ${fig.s[b][1]}`).join('');
    art += `<path d="${edges}" fill="none" stroke="${line}" stroke-width="${f(0.9 + level * 0.04)}" stroke-linecap="round" opacity=".62"/>`;
    if (level >= 6) art += `<path d="${edges}" pathLength="100" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" class="run"/>`;
    const order = fig.s.map((s, i): [number[], number] => [s, i]).sort((a, b) => a[0][2] - b[0][2]);
    for (const [[x, y, mag], i] of order) art += starMark(id, x, y, mag, level, i);
    if (!mv) art = `<g class="motif">${art}</g>`;
  }
  if (level >= 7) art += `<g class="shoot"><path d="M0 0L18 -7" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".9"/><path d="M0 0L34 -13" stroke="#fff" stroke-width=".6" stroke-linecap="round" opacity=".45"/></g>`;
  if (level === 10) art += `<g class="shoot late"><path d="M0 0L16 -6" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".9"/><path d="M0 0L30 -11" stroke="#fff" stroke-width=".5" stroke-linecap="round" opacity=".45"/></g>`;
  disc += art + `<circle cx="100" cy="100" r="${R}" fill="url(#${id}v)"/>`;
  disc += `<path d="M${f(100 - R * 0.78)} ${f(100 - R * 0.3)}A${R} ${R} 0 0 1 ${f(100 + R * 0.3)} ${f(100 - R * 0.78)}A${f(R * 1.25)} ${f(R * 1.25)} 0 0 0 ${f(100 - R * 0.78)} ${f(100 - R * 0.3)}Z" fill="#fff" opacity=".055"/>`;
  out += `<g clip-path="url(#${id}k)">${disc}</g>`;

  // ── bezel
  out += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${E}" stroke-width="${f(w + 1.8)}"/>`;
  if (mv) {
    out += `<g class="spin"><circle cx="100" cy="100" r="${R}" fill="none" stroke="${P}" stroke-width="${w}"/></g>`;
    out += `<circle cx="100" cy="100" r="${f(R + w / 2 - 0.6)}" fill="none" stroke="${M}" stroke-width="1.7"/><circle cx="100" cy="100" r="${f(R - w / 2 + 0.6)}" fill="none" stroke="${M}" stroke-width="1.4"/>`;
    out += `<g class="sweep"><circle cx="100" cy="100" r="${R}" fill="none" stroke="#fff" stroke-width="${f(w - 2.6)}" stroke-linecap="round" stroke-dasharray="${14 + (level - 8) * 6} 400" opacity=".85"/></g>`;
  } else {
    out += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${M}" stroke-width="${w}"/>`;
    if (level >= 2) out += `<circle cx="100" cy="100" r="${f(R - w / 2 - 1.5)}" fill="none" stroke="${J}" stroke-width="${f(1 + level * 0.14)}" opacity=".9"/>`;
    out += `<circle cx="100" cy="100" r="${f(R + w / 2 - 0.5)}" fill="none" stroke="#fff" stroke-width=".5" opacity=".5"/>`;
    if (level >= 4) out += `<g class="sweep"><circle cx="100" cy="100" r="${R}" fill="none" stroke="#fff" stroke-width="${f(w - 2.4)}" stroke-linecap="round" stroke-dasharray="${f(level * 2.4 - 3)} 400" opacity="${f(0.3 + level * 0.06)}"/></g>`;
  }
  out += `<circle cx="100" cy="100" r="${f(R - w / 2 + 0.4)}" fill="none" stroke="#000" stroke-width=".8" opacity=".5"/>`;
  if (level >= 6 && !mv) out += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${E}" stroke-width=".7" stroke-dasharray=".8 3.2" opacity=".75"/>`;

  // ── outer rings and beading
  if (level === 3 || level === 4) out += `<circle cx="100" cy="100" r="${f(R + w / 2 + 3.6)}" fill="none" stroke="${M}" stroke-width="1"/>`;
  if (level === 5) out += beads(R + w / 2 + 3.4, 44, 1.15, M, E);
  if (level === 6 || level === 7) out += beads(R + w / 2 + 3.6, 48, 1.25, M, E);
  if (level === 7) out += `<circle cx="100" cy="100" r="${f(R + w / 2 + 6.8)}" fill="none" stroke="${M}" stroke-width=".9"/>`;
  if (mv) out += beads(R + w / 2 + 3.8, level === 10 ? 60 : 48, 1.2, M, E);

  // ── gems and crowns
  const top = R + w / 2 + 2;
  if (level === 2) out += gem(0, top, 2.8, 4.8, J, E);
  if (level === 3) out += gem(0, top + 1, 3.2, 5.8, J, E, 'gl1');
  if (level === 4) out += gem(0, top + 2, 3.6, 6.6, J, E, 'gl1');
  if (level === 5) out += blade(-21, R + 1, 9, 2.4, M, E) + blade(21, R + 1, 9, 2.4, M, E) + gem(0, top + 3, 4.2, 7.6, J, E, 'gl1');
  if (level === 6) out += blade(-20, R + 2, 11, 2.8, M, E) + blade(20, R + 2, 11, 2.8, M, E) + gem(0, top + 4, 4.8, 8.8, J, E, 'gl1');
  if (level === 7) out += blade(-34, R + 2, 9, 2.6, M, E) + blade(34, R + 2, 9, 2.6, M, E) + blade(-18, R + 2, 15, 3, M, E) + blade(18, R + 2, 15, 3, M, E) + gem(0, top + 6, 5.4, 10.5, J, E, 'gl1');
  if (level === 2) out += gem(90, top, 1.7, 3, J, E) + gem(270, top, 1.7, 3, J, E);
  if (level === 3) for (const a of [45, 135, 225, 315]) out += gem(a, top + 1.6, 1.9, 3.2, J, E);
  if (level === 4) out += gem(90, R + 9.4, 2.2, 3.6, J, E, 'gl0') + gem(270, R + 9.4, 2.2, 3.6, J, E, 'gl2');
  if (level === 5) out += gem(90, R + 13, 2.8, 4.6, J, E, 'gl0') + gem(270, R + 13, 2.8, 4.6, J, E, 'gl2');
  if (level === 6) { for (const a of [49, 131, 229, 311]) out += gem(a, R + 10.5, 2.2, 3.8, J, E); out += gem(90, R + 15.2, 3.1, 5.2, J, E, 'gl0') + gem(270, R + 15.2, 3.1, 5.2, J, E, 'gl2'); }
  if (level === 7) { for (const a of [45, 135, 225, 315]) out += gem(a, R + 10.5, 2.6, 4.4, J, E, 'gl0'); out += gem(90, R + 23.6, 3.1, 5.4, J, E, 'gl2') + gem(270, R + 23.6, 3.1, 5.4, J, E, 'gl1'); }
  if (level === 8) out += blade(-18, R + 3, 13, 3, M, E) + blade(18, R + 3, 13, 3, M, E) + gem(0, top + 6, 5.6, 11, P, M, 'gl1') + gem(180, top + 3, 4, 7.4, P, M, 'gl0');
  if (level === 9) out += blade(-30, R + 3, 10, 2.6, M, E) + blade(30, R + 3, 10, 2.6, M, E) + blade(-15, R + 3, 15, 3, M, E) + blade(15, R + 3, 15, 3, M, E) + gem(0, top + 7, 6, 12, P, M, 'gl1') + gem(180, top + 3, 4.2, 8, P, M, 'gl0') + gem(90, top + 9.5, 3, 5.4, P, M, 'gl2') + gem(270, top + 9.5, 3, 5.4, P, M, 'gl0');
  if (level === 10) {
    for (const [a, len] of [[-42, 8], [42, 8], [-28, 13], [28, 13], [-14, 18], [14, 18]]) out += blade(a, R + 3, len, 2.8, M, E);
    out += gem(0, top + 8, 6.6, 13.5, P, M, 'gl1') + gem(180, top + 4, 4.6, 8.8, P, M, 'gl0') + gem(90, top + 10, 3.4, 6, P, M, 'gl2') + gem(270, top + 10, 3.4, 6, P, M, 'gl0');
    for (const a of [45, 135, 225, 315]) { const p = pol(R + 23, a); out += `<path d="${sparkle(p[0], p[1], 4.4, 0.8)}" fill="#fff" class="tw${a % 2 + 1}"/>`; }
  }
  if (mv) {
    const y = 100 - (top + 6 + (level - 8)) - (11 + (level - 8) * 1.25) - 5;
    out += `<circle cx="100" cy="${f(y + 16)}" r="${15 + (level - 8) * 2}" fill="url(#${id}s)" class="tw1"/><path d="${sparkle(100, y, 5.5 + (level - 8), 0.9)}" fill="#fff" class="tw1"/>`;
  }
  gyros.forEach((t, k) => { out += gyro(id, t, 'b', tints, k); });
  if (mv) {
    const orbit = [93, 91, 90][level - 8];
    if (level >= 9) out += `<circle cx="100" cy="100" r="${orbit}" fill="none" stroke="${M}" stroke-width=".7" opacity=".45"${level === 10 ? ' stroke-dasharray="1 5"' : ''}/>`;
    const heads = level === 8 ? [0] : level === 9 ? [0, 180] : [0, 120, 240];
    out += `<g class="orbit">${heads.map(a => comet(id, orbit, a + 30, [40, 64, 80][level - 8], [2.2, 2.8, 3.2][level - 8], tints, 1)).join('')}</g>`;
    if (level === 10) out += `<g class="orbitr">${[70, 250].map(a => comet(id, 95, a, 48, 1.8, tints, -1)).join('')}</g>`;
    for (let i = 0; i < level - 7; i++) out += `<circle cx="100" cy="100" r="${R + 5}" fill="none" stroke="${P}" stroke-width="1.3" class="rip" style="animation-delay:${f(-i * 4.4 * [1, 0.85, 0.7][level - 8] / (level - 7))}s"/>`;
    const sparks = [0, 7, 12][level - 8];
    for (let i = 0; i < sparks; i++) { const p = pol(68 + (i % 3) * 9, i * 360 / sparks + 17); out += `<path d="${sparkle(p[0], p[1], 2.2 + (i % 2), 0.5)}" fill="${i % 2 ? '#fff' : tints[i % tints.length]}" class="rise" style="animation-delay:${f(-i * 0.63)}s"/>`; }
  }

  if (level === 6 || level === 7) {
    const n = level === 6 ? 3 : 6;
    for (let i = 0; i < n; i++) { const p = pol(72 + (i % 2) * 9, i * 360 / n - 60); out += `<path d="${sparkle(p[0], p[1], 2.2 + (i % 2) * 0.8, 0.5)}" fill="#fff3cf" class="rise" style="animation-delay:${f(-i * 1.1)}s"/>`; }
  }
  if (level === 7) { const p = pol(94, -50); out += `<g class="orbit"><circle cx="${f(p[0])}" cy="${f(p[1])}" r="6" fill="url(#${id}s)"/><path d="${sparkle(p[0], p[1], 3.6, 0.7)}" fill="#fff"/></g>`; }
  if (!mv) {
    const pr = R + w / 2 + (level === 7 ? 11.5 : level >= 5 ? 9 : level >= 3 ? 8.2 : 6.2);
    for (let i = 0; i < 7; i++) {
      const a = 180 + (3 - i) * 12.5;
      if (i < level) {
        const p = pol(pr, a - 90);
        out += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="6.5" fill="url(#${id}s)" opacity=".8"/>` + gem(a, pr, 2.5, 4, J, E, i === level - 1 ? 'gl1' : '');
      } else {
        out += `<path transform="rotate(${a} 100 100)" d="M100 ${f(100 - pr - 3.4)}L102.1 ${f(100 - pr)}L100 ${f(100 - pr + 3.4)}L97.9 ${f(100 - pr)}Z" fill="#070b16" stroke="${E}" stroke-width=".8" opacity=".95"/>`;
      }
    }
  }
  const sp = [3, 2.6, 2.3, 2, 1.8, 1.6, 1.4, 1, 0.85, 0.7][level - 1];
  const motion = [
    ['100px 134px', 6.5, '0%,100%{transform:rotate(-3.5deg)}50%{transform:rotate(3.5deg)}'],
    ['100px 135px', 2.3, '0%,100%{transform:scale(1,1) skewX(0)}30%{transform:scale(.96,1.07) skewX(-2.5deg)}62%{transform:scale(1.03,.97) skewX(2.5deg)}'],
    ['100px 62px', 5.2, '0%,100%{transform:rotate(-4.5deg)}50%{transform:rotate(4.5deg)}'],
    ['100px 100px', 6.4, '0%,100%{transform:rotate(-6deg)}35%{transform:rotate(5deg)}55%{transform:rotate(1deg)}78%{transform:rotate(6deg)}'],
    ['100px 100px', 7.5, '0%,100%{transform:translate(-3.5px,.5px)}50%{transform:translate(3.5px,-1px)}'],
    ['100px 128px', 5.4, '0%,100%{transform:rotate(-3.5deg) translateY(0)}50%{transform:rotate(3.5deg) translateY(-2.2px)}'],
    ['100px 100px', 4.2, '0%,100%{transform:scale(.98)}50%{transform:scale(1.035)}'],
  ][level - 1];
  const motifCss = motion ? `.motif{transform-origin:${motion[0]};animation:motif ${motion[1]}s ease-in-out infinite}\n@keyframes motif{${motion[2]}}\n` : '';
  const style = sp ? `<style>
.spin{transform-origin:100px 100px;animation:spin ${f(16 * sp)}s linear infinite}
.spinr{transform-origin:100px 100px;animation:spin ${f(90 * sp)}s linear infinite reverse}
.sweep{transform-origin:100px 100px;animation:spin ${f(6.5 * sp)}s linear infinite}
.gal{transform-origin:100px 100px;animation:spin ${f(46 * sp)}s linear infinite}
.orbit{transform-origin:100px 100px;animation:spin ${f(11 * sp)}s linear infinite}
.orbitr{transform-origin:100px 100px;animation:spin ${f(15 * sp)}s linear infinite reverse}
.rip{transform-origin:100px 100px;opacity:0;animation:rip ${f(4.4 * sp)}s ease-out infinite}
.wing{transform-origin:100px 100px;animation:wing ${f(4.4 * sp)}s ease-in-out infinite}
.rise{transform-box:fill-box;transform-origin:center;opacity:0;animation:rise ${f(4.2 * sp)}s ease-out infinite}
${motifCss}.ray0{transform-origin:100px 100px;animation:spin ${f(48 * sp)}s linear infinite}
.ray1{transform-origin:100px 100px;animation:spin ${f(70 * sp)}s linear infinite reverse}
.au0{transform-origin:100px 100px;animation:spin ${f(9 * sp)}s linear infinite}
.au1{transform-origin:100px 100px;animation:spin ${f(13 * sp)}s linear infinite reverse}
.run2{stroke-dasharray:9 91;animation:run ${f(5.2 * sp)}s linear infinite}
.nova{transform-origin:100px 100px;opacity:0;animation:nova ${f(6.5 * sp)}s ease-out infinite}
.novaring{transform-origin:100px 100px;opacity:0;animation:novaring ${f(6.5 * sp)}s ease-out infinite}
@keyframes nova{0%,72%{opacity:0;transform:scale(.3)}80%{opacity:1;transform:scale(1.15)}100%{opacity:0;transform:scale(1.5)}}
@keyframes novaring{0%,76%{opacity:0;transform:scale(.4)}82%{opacity:.9}100%{opacity:0;transform:scale(3)}}
.gl0{animation:gl ${f(2.8 * sp)}s ease-in-out infinite}
.gl1{animation:gl ${f(2.2 * sp)}s ease-in-out -.9s infinite}
.gl2{animation:gl ${f(3.4 * sp)}s ease-in-out -1.7s infinite}
@keyframes rip{0%{transform:scale(1);opacity:.75}100%{transform:scale(1.58);opacity:0}}
@keyframes wing{0%,100%{transform:scale(1)}50%{transform:scale(1.035)}}
@keyframes rise{0%{transform:translateY(7px) scale(.4);opacity:0}30%{opacity:1}100%{transform:translateY(-17px) scale(1);opacity:0}}
@keyframes gl{0%,100%{opacity:.15}50%{opacity:1}}
.breath{transform-origin:100px 100px;animation:breath ${f(5 * sp)}s ease-in-out infinite}
.beat{animation:beat ${f(3.4 * sp)}s ease-in-out infinite}
.drift0{animation:drift0 ${f(13 * sp)}s ease-in-out infinite alternate}
.drift1{animation:drift1 ${f(17 * sp)}s ease-in-out infinite alternate}
.tw0{animation:tw ${f(3.1 * sp)}s ease-in-out infinite}
.tw1{animation:tw ${f(2.3 * sp)}s ease-in-out -1.1s infinite}
.tw2{animation:tw ${f(4.2 * sp)}s ease-in-out -2.4s infinite}
.run{stroke-dasharray:7 93;animation:run ${f(5.5 * sp)}s linear infinite}
.shoot{opacity:0;animation:shoot ${f(7 * sp)}s ease-in infinite}
.shoot.late{animation-delay:${f(-3.2 * sp)}s;animation-name:shoot2}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes breath{0%,100%{opacity:.5;transform:scale(.95)}50%{opacity:.95;transform:scale(1.03)}}
@keyframes beat{0%,100%{transform:scale(.9);opacity:.82}50%{transform:scale(1.08);opacity:1}}
@keyframes drift0{from{transform:translate(-7px,4px)}to{transform:translate(9px,-6px)}}
@keyframes drift1{from{transform:translate(8px,6px)}to{transform:translate(-9px,-5px)}}
@keyframes tw{0%,100%{opacity:.5}50%{opacity:1}}
@keyframes run{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}
@keyframes shoot{0%{transform:translate(150px,58px);opacity:0}3%{opacity:1}13%{transform:translate(62px,92px);opacity:0}100%{transform:translate(62px,92px);opacity:0}}
@keyframes shoot2{0%{transform:translate(138px,104px);opacity:0}3%{opacity:1}12%{transform:translate(70px,130px);opacity:0}100%{transform:translate(70px,130px);opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.run,.run2,.shoot,.sweep,.nova,.novaring{display:none}}
</style>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="G${level} ${name}">${style}<defs>${defs}</defs>${out}</svg>`;
}

