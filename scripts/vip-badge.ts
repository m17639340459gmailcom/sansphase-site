// 社区 VIP 等级徽章：八枚六角形徽章，“VIP1”至“VIP8”各写成一行。
// 档位之间变的是构造而不只是颜色：边框样式、玻璃下的底纹、内部机构逐级不同；
// VIP5 起徽章“点亮”并有悬浮装甲伸出边框，VIP6 起整枚徽章带同一节奏的呼吸。
// 发布资产由 scripts/build-vip-badge.mjs 写入 public/assets/community/levels/，不手工修改。
// 设计约定见 docs/COMMUNITY-EXPERIENCE-RULES.md。图标内不含脚本、外链、位图或字体引用。
import { vipGlyphCapHeight, vipGlyphs } from './vip-badge-glyphs.ts';

type Point = [number, number];
type Tier = { name: string; acc: string; glow: string; second: string };

const f = (n: number): number => Number(n.toFixed(2));
const rad = (d: number): number => d * Math.PI / 180;
const pt = (p: Point): string => `${f(p[0])} ${f(p[1])}`;
const hex = (c: string): number[] => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number): string => { const x = hex(a), y = hex(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

const INK = '#080b15';
// One saturated colour per rank, carried by the frame as well as the light inside it.
export const vipBadgeTiers: readonly Tier[] = [
  { name: '银白', acc: '#aebdd2', glow: '#f2f6fc', second: '#8fa6d8' },
  { name: '翠绿', acc: '#2fbf62', glow: '#ccffd9', second: '#2fb7a8' },
  { name: '青蓝', acc: '#19b4d6', glow: '#c9f6ff', second: '#3f8cf0' },
  { name: '宝蓝', acc: '#2f6ff2', glow: '#d3e4ff', second: '#38c8ee' },
  { name: '绛紫', acc: '#9a4df0', glow: '#ecd9ff', second: '#e85fd0' },
  { name: '炽橙', acc: '#f5842a', glow: '#ffe6c2', second: '#ff5a4a' },
  { name: '绯红', acc: '#e8304a', glow: '#ffd3d6', second: '#ff8a3a' },
  { name: '星穹', acc: '#5a5cf5', glow: '#e4e6ff', second: '#c060ff' },
];

// Rewrites a glyph outline into icon coordinates, so fills, gradients and filters share one user space.
function place(d: string, s: number, ox: number, oy: number): string {
  const tk = d.match(/[MLHVQCZ]|-?\d+(?:\.\d+)?/g) ?? [], X = (v: number) => f(ox + v * s), Y = (v: number) => f(oy + v * s);
  let out = '', i = 0, cmd = '';
  while (i < tk.length) {
    if (/[A-Z]/.test(tk[i])) cmd = tk[i++];
    const n = () => Number(tk[i++]);
    if (cmd === 'Z') out += 'Z';
    else if (cmd === 'H') out += `H${X(n())}`;
    else if (cmd === 'V') out += `V${Y(n())}`;
    else if (cmd === 'Q') out += `Q${X(n())} ${Y(n())} ${X(n())} ${Y(n())}`;
    else if (cmd === 'C') out += `C${X(n())} ${Y(n())} ${X(n())} ${Y(n())} ${X(n())} ${Y(n())}`;
    else { out += `${cmd}${X(n())} ${Y(n())}`; if (cmd === 'M') cmd = 'L'; }
  }
  return out;
}
const CX = 100, CY = 98;
// The whole label is one line: VIP and the numeral share one face, height and weight.
function label(n: number, h: number): string {
  const s = h / vipGlyphCapHeight, chars = ['V', 'I', 'P', String(n)], gaps = [0.02 * h, 0.03 * h, 0.08 * h];
  const width = chars.reduce((w, ch, k) => w + vipGlyphs[ch].adv * s + (gaps[k] || 0), 0);
  let x = CX - width / 2, d = '';
  chars.forEach((ch, k) => { d += place(vipGlyphs[ch].d, s, x, CY - h / 2); x += vipGlyphs[ch].adv * s + (gaps[k] || 0); });
  return d;
}
const polar = (r: number, a: number): Point => [CX + r * Math.cos(rad(a)), CY + r * Math.sin(rad(a))];
const hexP = (R: number, rot = -90): Point[] => Array.from({ length: 6 }, (_, k) => polar(R, rot + 60 * k));
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const poly = (p: Point[]): string => `M${p.map(pt).join('L')}Z`;
const band = (Ra: number, Rb: number): string => poly(hexP(Ra)) + poly(hexP(Rb));
const all6 = (fn: (k: number) => string): string => [0, 1, 2, 3, 4, 5].map(fn).join('');
// A corner bracket: the frame only around one vertex, reaching `u` of the way along both sides.
const chevron = (k: number, Ra: number, Rb: number, u: number): string => { const A = hexP(Ra), B = hexP(Rb), p = (k + 5) % 6, q = (k + 1) % 6; return poly([lerp(A[k], A[p], u), A[k], lerp(A[k], A[q], u), lerp(B[k], B[q], u), B[k], lerp(B[k], B[p], u)]); };
// A plate across the middle of one side, from `a` to `b` along it.
const clasp = (k: number, Ra: number, Rb: number, a: number, b: number): string => { const A = hexP(Ra), B = hexP(Rb), q = (k + 1) % 6; return poly([lerp(A[k], A[q], a), lerp(A[k], A[q], b), lerp(B[k], B[q], b), lerp(B[k], B[q], a)]); };
// Height-lit metal: the blurred silhouette is the relief, shaded and given a specular edge from the upper left.
const relief = (id: string, blur: number, scale: number, shine: number, grain: boolean): string => `<filter id="${id}" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="${blur}" result="b"/>`
  + `<feDiffuseLighting in="b" surfaceScale="${scale}" diffuseConstant="1.25" lighting-color="#fff" result="df"><feDistantLight azimuth="232" elevation="52"/></feDiffuseLighting><feComposite in="SourceGraphic" in2="df" operator="arithmetic" k1="1" k2=".12" result="lt"/>`
  + `<feSpecularLighting in="b" surfaceScale="${scale}" specularConstant="${shine}" specularExponent="24" lighting-color="#fff" result="sp"><feDistantLight azimuth="232" elevation="52"/></feSpecularLighting><feComposite in="sp" in2="SourceAlpha" operator="in" result="sp2"/><feComposite in="lt" in2="sp2" operator="arithmetic" k2="1" k3="1" result="m"/>`
  + (grain ? `<feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .5 .5 0 0 -.42" result="g"/><feComposite in="g" in2="SourceAlpha" operator="in" result="g2"/><feComposite in="m" in2="g2" operator="arithmetic" k2="1" k3=".14" result="m"/>` : '')
  + `<feComposite in="m" in2="SourceAlpha" operator="in"/></filter>`;

const RO = 93;
// The hexagon is drawn at this share of the canvas on every rank, leaving room for what ranks 5-8 carry outside it.
const SCALE = 0.82;

export function vipBadgeSVG(level: number): string {
  const n = Number.isFinite(level) ? Math.max(1, Math.min(8, Math.trunc(level))) : 1;
  const t = vipBadgeTiers[n - 1], id = `v${n}`, top8 = n === 8;
  const mLight = mix(t.acc, '#ffffff', 0.72), mMid = mix(t.acc, '#101421', 0.12), mDark = mix(t.acc, '#000000', 0.8);
  // frame: its construction is what changes with rank
  // `caps` are raised metal; `hot` parts glow white, which is what sets ranks 5-8 apart at small sizes
  let metal: string, RI: number, track = 0, caps = '', hot = '';
  const powered = n >= 5;
  if (n <= 3) { metal = band(RO, 84.5); RI = 84.5; if (n === 3) caps = all6(k => chevron(k, 94.6, 81, 0.15)); }
  else if (n === 4) { metal = band(RO, 88) + band(84.5, 80.5); RI = 80.5; track = 86.25; caps = all6(k => clasp(k, 95, 78.6, 0.35, 0.65)); }
  else if (n === 5) { metal = band(RO, 88) + band(84.5, 80.5); RI = 80.5; track = 86.25; hot = all6(k => chevron(k, 95, 78.6, 0.14)); }
  else if (n <= 7) { metal = all6(k => chevron(k, RO, 86, 0.36)) + band(83.5, 80); RI = 80; track = 84.75; hot = all6(k => chevron(k, 95, 85, n === 7 ? 0.16 : 0.11)) + (n === 7 ? all6(k => clasp(k, 83.9, 79.6, 0.42, 0.58)) : ''); }
  else { metal = all6(k => chevron(k, RO, 89.6, 0.4) + chevron(k, 87.8, 85.6, 0.3)); RI = 80; track = 84.5; hot = band(83.6, 79.8) + all6(k => chevron(k, 95, 86.4, 0.13)); }
  const comets = [0, 0, 0, 0, 1, 2, 2, 3][n - 1];
  const S = hexP(RI + 1), O = hexP(RO);
  const satin = `<linearGradient id="${id}ma" x1="10" y1="6" x2="190" y2="190" gradientUnits="userSpaceOnUse">${powered
    ? `<stop offset="0" stop-color="${mix(t.acc, '#ffffff', 0.6)}"/><stop offset=".3" stop-color="${t.acc}"/><stop offset=".7" stop-color="${t.second}"/><stop offset="1" stop-color="${mix(t.second, '#ffffff', 0.55)}"/>`
    : `<stop offset="0" stop-color="${mix(mMid, mLight, 0.6)}"/><stop offset=".34" stop-color="${mMid}"/><stop offset=".66" stop-color="${mix(mMid, mDark, 0.5)}"/><stop offset="1" stop-color="${mix(mMid, mLight, 0.3)}"/>`}</linearGradient>`;
  const ink = top8 ? ['#ffffff', '#eef2fb', '#c3cee4'] : ['#ffffff', mix(t.glow, '#ffffff', 0.5), mix(t.acc, '#ffffff', 0.5)];

  let defs = satin
    + `<radialGradient id="${id}c" cx="${CX}" cy="${CY + 20}" r="98" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${mix(t.acc, top8 ? INK : '#ffffff', top8 ? 0.2 : 0.12)}"/><stop offset=".4" stop-color="${mix(t.acc, INK, top8 ? 0.78 : 0.5)}"/><stop offset="1" stop-color="${INK}"/></radialGradient>`
    + `<linearGradient id="${id}gs" x1="0" y1="${CY - 80}" x2="0" y2="${CY}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".01"/></linearGradient>`
    + `<linearGradient id="${id}is" x1="30" y1="20" x2="170" y2="176" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity=".9"/><stop offset=".55" stop-color="#000" stop-opacity="0"/></linearGradient><linearGradient id="${id}il" x1="30" y1="20" x2="170" y2="176" gradientUnits="userSpaceOnUse"><stop offset=".5" stop-color="${t.glow}" stop-opacity="0"/><stop offset="1" stop-color="${t.glow}" stop-opacity=".9"/></linearGradient>`
    + `<linearGradient id="${id}i" x1="0" y1="${CY - 18}" x2="0" y2="${CY + 18}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${ink[0]}"/><stop offset=".55" stop-color="${ink[1]}"/><stop offset="1" stop-color="${ink[2]}"/></linearGradient>`
    + `<linearGradient id="${id}sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity="${f(0.16 + n * 0.02)}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + `<radialGradient id="${id}gl"><stop offset="0" stop-color="${t.glow}" stop-opacity=".7"/><stop offset="1" stop-color="${t.acc}" stop-opacity="0"/></radialGradient>`
    + relief(`${id}fm`, 1.5, 5, 0.9, true) + relief(`${id}ft`, 0.7, 2.4, 0.75, false)
    + `<filter id="${id}d" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="5"/></filter><filter id="${id}s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.7"/></filter><filter id="${id}g" x="-40%" y="-80%" width="180%" height="260%"><feGaussianBlur stdDeviation="3.6"/></filter><filter id="${id}a" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="9"/></filter>`
    + `<clipPath id="${id}k"><path d="${poly(O)}"/></clipPath><clipPath id="${id}c2"><path d="${poly(S)}"/></clipPath>`;
  if (n >= 7) defs += `<clipPath id="${id}ha"><rect x="0" y="${CY - 100}" width="200" height="100"/></clipPath><clipPath id="${id}hb"><rect x="0" y="${CY}" width="200" height="100"/></clipPath>`;
  if (top8) defs += `<radialGradient id="${id}co" cx="${CX}" cy="${CY}" r="66" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".14" stop-color="#c9c9ff" stop-opacity=".26"/><stop offset="1" stop-color="${t.second}" stop-opacity="0"/></radialGradient><radialGradient id="${id}bu" cx="${CX}" cy="${CY}" r="82" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#cfd8ff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`;

  let out = `<path d="${poly(hexP(RO - 4))}" transform="translate(0 7)" fill="#000" opacity=".42" filter="url(#${id}d)"/>`;
  // ranks 5-8 carry floating armour outside the frame; ranks 6-8 breathe; rank 8 wears a ring around the whole badge
  let front = '';
  const breath = n >= 6 ? [5, 4.6, 4.2][n - 6] : 0;
  if (powered) {
    const armourStart = out.length;
    if (breath) out += `<path d="${poly(hexP(101))}" fill="${t.acc}" filter="url(#${id}d)" class="bh"/>`;
    // the armour is cut from the same hexagon: corner plates first, then stepped plates off the two upright sides
    const shards: string[] = [], struts: string[] = [];
    const corners = n === 5 ? [0, 3] : [0, 1, 2, 3, 4, 5];
    for (const k of corners) { shards.push(chevron(k, 108, 100.5, n >= 7 ? 0.26 : 0.2)); struts.push(`M${pt(polar(94, -90 + 60 * k))}L${pt(polar(101, -90 + 60 * k))}`); }
    if (top8) for (const k of [0, 3]) shards.push(chevron(k, 118, 112.5, 0.13));
    if (n >= 7) for (const k of [1, 4]) {
      const steps = top8 ? [[113, 105.5, 0.2, 0.8], [123, 117.5, 0.3, 0.7], [132, 128, 0.39, 0.61]] : [[113, 105.5, 0.24, 0.76], [122, 117.5, 0.36, 0.64]];
      for (const [Ra, Rb, a, b] of steps) shards.push(clasp(k, Ra, Rb, a, b));
      const A = hexP(98), B = hexP(top8 ? 130 : 120), q = (k + 1) % 6;
      for (const m of [0.42, 0.58]) struts.push(`M${pt(lerp(A[k], A[q], m))}L${pt(lerp(B[k], B[q], m))}`);
    }
    out += `<path d="${struts.join('')}" stroke="${t.acc}" stroke-width="3.4" opacity=".7" filter="url(#${id}s)"/><path d="${struts.join('')}" stroke="${t.glow}" stroke-width="1"/>`;
    const all = shards.join(''), under = mix(mDark, '#000000', 0.4);
    out += `<path d="${all}" fill="${t.acc}" stroke="${t.acc}" stroke-width="4" opacity=".6" filter="url(#${id}s)"/><path d="${all}" fill="${under}" stroke="${under}" stroke-width="1.6" stroke-linejoin="round"/><g filter="url(#${id}fm)"><path data-armour="${shards.length}" d="${all}" fill="url(#${id}ma)"/></g>`;
    out += `<g opacity=".5">${shards.map((d, k) => `<path d="${d}" fill="${mix(t.glow, '#ffffff', 0.5)}" class="${breath ? 'bg' : `gl${k % 3}`}"/>`).join('')}</g>`;
    if (breath) out = `${out.slice(0, armourStart)}<g class="br">${out.slice(armourStart)}</g>`;
    if (top8) {
      const e = `M${CX - 114} ${CY}A114 36 0 1 1 ${CX + 114} ${CY}A114 36 0 1 1 ${CX - 114} ${CY}Z`;
      defs += `<clipPath id="${id}ra"><rect x="-40" y="${CY - 60}" width="280" height="60"/></clipPath><clipPath id="${id}rb"><rect x="-40" y="${CY}" width="280" height="60"/></clipPath>`;
      const ring = (half: string) => `<g data-ring="${half}" transform="rotate(-16 ${CX} ${CY})"><g clip-path="url(#${id}r${half})" fill="none"><path d="${e}" stroke="${t.second}" stroke-width="6" opacity=".7" filter="url(#${id}s)"/><path d="${e}" stroke="${t.glow}" stroke-width="1.6"/><path d="${e}" stroke="#fff" stroke-width="3" pathLength="100" stroke-dasharray="9 41" class="ob"/><path d="${e}" stroke="#fff" stroke-width="5.5" stroke-linecap="round" pathLength="100" stroke-dasharray=".1 49.9" class="obh" style="stroke-dashoffset:-8.9"/></g></g>`;
      out += ring('a');
      front = ring('b');
    }
  }
  out += `<path d="${poly(hexP(RO + 1))}" fill="${mix(mDark, '#000000', 0.55)}"/><path d="${poly(hexP(RO - 0.6))}" fill="${INK}"/>`;

  // glass: dark, lit from within
  let stone = `<path d="${poly(S)}" fill="url(#${id}c)"/>`;
  // ranks 1-4 each have their own engraved ground under the glass
  let ground = '', groundWidth = 0.4, groundOpacity = 0.2;
  if (n === 1) { for (let r = 10; r < 90; r += 8) ground += poly(hexP(r)); for (let k = 0; k < 6; k++) ground += `M${CX} ${CY}L${pt(polar(90, -90 + 60 * k))}`; }
  else if (n === 2) { for (let k = 0; k < 18; k++) { const p = polar(21, k * 20); ground += `M${f(p[0] - 47)} ${f(p[1])}a47 47 0 1 0 94 0a47 47 0 1 0 -94 0`; } groundWidth = 0.3; groundOpacity = 0.16; }
  else if (n === 3) { const r = 10.5; for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) { const x = CX + (i + (j % 2 ? 0.5 : 0)) * r * Math.sqrt(3), y = CY + j * r * 1.5; ground += `M${f(x)} ${f(y - r)}L${f(x + r * 0.866)} ${f(y - r / 2)}V${f(y + r / 2)}L${f(x)} ${f(y + r)}`; } }
  else if (n === 4) { for (let k = 0; k < 72; k++) ground += `M${pt(polar(k % 2 ? 26 : 16, k * 5))}L${pt(polar(92, k * 5))}`; ground += `M${CX - 34} ${CY}a34 34 0 1 0 68 0a34 34 0 1 0 -68 0`; groundOpacity = 0.26; }
  if (ground) stone += `<path data-ground="${n}" d="${ground}" fill="none" stroke="${t.glow}" stroke-width="${groundWidth}" opacity="${groundOpacity}"/>`;
  // ranks 5-8 are lit: broad rays turning under the glass, a white-hot core, then a halo and ripples
  if (powered) {
    const count = [10, 12, 14, 16][n - 5];
    let rays = '';
    for (let k = 0; k < count; k++) { const a = k * 360 / count; rays += `M${CX} ${CY}L${pt(polar(100, a))}L${pt(polar(100, a + 180 / count))}Z`; }
    stone += `<g class="rays" style="mix-blend-mode:screen"><path d="${rays}" fill="${t.glow}" opacity="${f(top8 ? 0.12 : 0.13 + (n - 5) * 0.025)}"/></g>`;
    stone += `<g class="${breath ? 'bc' : ''}"><ellipse cx="${CX}" cy="${CY}" rx="46" ry="26" fill="#fff" opacity="${f(top8 ? 0.16 : 0.34 + (n - 5) * 0.05)}" filter="url(#${id}a)"/></g>`;
  }
  if (n === 6) stone += [0, -1.5, -3].map(dl => `<circle cx="${CX}" cy="${CY}" r="20" fill="none" stroke="${t.glow}" stroke-width=".5" class="rip" style="animation-delay:${dl}s"/>`).join('');
  if (n >= 6) stone += `<circle cx="${CX}" cy="${CY}" r="66.4" fill="none" stroke="${t.acc}" stroke-width="5" opacity=".9" filter="url(#${id}s)"/><circle cx="${CX}" cy="${CY}" r="66.4" fill="none" stroke="#fff" stroke-width="1.4"/>`;
  if (n >= 4) stone += `<ellipse cx="${CX - 26}" cy="${CY + 34}" rx="40" ry="22" fill="${t.acc}" opacity=".5" filter="url(#${id}a)" class="au1" style="mix-blend-mode:screen"/><ellipse cx="${CX + 30}" cy="${CY - 30}" rx="36" ry="20" fill="${t.second}" opacity=".42" filter="url(#${id}a)" class="au2" style="mix-blend-mode:screen"/>`;
  if (top8) stone += `<ellipse cx="${CX}" cy="${CY + 44}" rx="60" ry="16" fill="#7fffd9" opacity=".3" filter="url(#${id}a)" class="au2" style="mix-blend-mode:screen"/>`;
  if (n >= 2) stone += `<ellipse cx="${CX}" cy="${CY}" rx="56" ry="30" fill="url(#${id}gl)" class="glow"/>`;
  // a graduated dial turning behind the lettering
  if (n >= 5) {
    let ticks = '';
    for (let k = 0; k < 60; k++) { const a = k * 6, p = polar(k % 5 ? 59 : 56.5, a), q = polar(62, a); ticks += `M${pt(p)}L${pt(q)}`; }
    stone += `<g class="dial"><circle cx="${CX}" cy="${CY}" r="63.6" fill="none" stroke="${t.glow}" stroke-width=".4" opacity=".4"/><path d="${ticks}" stroke="${t.glow}" stroke-width=".6" opacity=".65"/>${[0, 120, 240].map(a => { const p = polar(53, a); return `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="1.3" fill="${t.glow}"/>`; }).join('')}</g>`;
  }
  if (n >= 7) {
    let ticks = '';
    for (let k = 0; k < 24; k++) { const a = k * 15; ticks += `M${pt(polar(46, a))}L${pt(polar(k % 2 ? 49 : 51, a))}`; }
    stone += `<g class="dial2"><path d="${ticks}" stroke="${t.glow}" stroke-width=".5" opacity=".5"/><circle cx="${CX}" cy="${CY}" r="45" fill="none" stroke="${t.glow}" stroke-width=".35" stroke-dasharray="1 3" opacity=".6"/></g>`;
  }
  // drifting motes
  if (n >= 6) for (let k = 0, count = [8, 12, 18][n - 6]; k < count; k++) {
    const x = CX - 58 + ((k * 53) % 117), y = CY + 30 + ((k * 29) % 36), r = 0.6 + ((k * 7) % 5) * 0.16, dur = 4.4 + ((k * 11) % 7) * 0.6;
    stone += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${k % 3 ? '#fff' : t.glow}" class="pt" style="animation-duration:${f(dur)}s;animation-delay:${f(-((k * 0.83) % dur))}s"/>`;
  }
  // rank 7: a constellation that draws itself above and below the lettering
  if (n === 7) {
    const stars: Point[][] = [[[-56, -27], [-36, -43], [-10, -35], [16, -49], [44, -36], [58, -22]], [[-52, 30], [-26, 44], [2, 36], [30, 47], [52, 31]]];
    stars.forEach((line, i) => {
      const P = line.map(([x, y]): Point => [CX + x, CY + y]);
      stone += `<path d="M${P.map(pt).join('L')}" fill="none" stroke="${t.glow}" stroke-width=".7" pathLength="100" stroke-dasharray="100" class="cn" style="animation-delay:${-i * 3.5}s"/>`;
      P.forEach((p, k) => { stone += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${k % 2 ? 1.5 : 2}" fill="#fff" class="gl${(k + i) % 3}"/>`; });
    });
  }
  // rank 8: a star behind the lettering, its corona turning both ways, and a nova every few seconds
  if (top8) {
    const rays = (count: number, r1: number, off: number) => { let d = ''; for (let k = 0; k < count; k++) { const a = k * 360 / count + off, len = r1 * (k % 2 ? 0.72 : 1); d += `M${pt(polar(7, a - 90))}L${pt(polar(len, a))}L${pt(polar(7, a + 90))}Z`; } return d; };
    stone += `<g class="cor"><circle cx="${CX}" cy="${CY}" r="66" fill="url(#${id}co)"/><g class="spa"><path d="${rays(12, 76, 0)}" fill="url(#${id}co)" opacity=".8"/></g><g class="spb"><path d="${rays(10, 62, 12)}" fill="url(#${id}co)" opacity=".55"/></g></g>`;
    stone += `<path d="${poly(S)}" fill="url(#${id}bu)" class="bf"/><circle cx="${CX}" cy="${CY}" r="10" fill="none" stroke="#fff" stroke-width=".34" class="bw"/><circle cx="${CX}" cy="${CY}" r="10" fill="none" stroke="${t.second}" stroke-width=".5" class="bw" style="animation-delay:.24s"/>`;
  }
  stone += `<path d="M${CX - 92} ${CY - 92}H${CX + 92}V${CY - 34}Q${CX} ${CY - 6} ${CX - 92} ${CY - 34}Z" fill="url(#${id}gs)"/>`;
  stone += `<path d="${poly(S)}" fill="none" stroke="url(#${id}is)" stroke-width="13" filter="url(#${id}s)"/><path d="${poly(hexP(RI - 2.5))}" fill="none" stroke="url(#${id}il)" stroke-width="2.2" filter="url(#${id}s)" opacity=".75"/>`;
  out += `<g clip-path="url(#${id}c2)">${stone}</g>`;
  if (n === 2 || n === 3) out += `<path data-inlay="1" d="${poly(hexP(80.8))}" fill="none" stroke="${t.glow}" stroke-width=".7" opacity=".7"/>`;

  // light in the groove and in the openings of the frame
  const line = (R: number, w: number, extra = '') => `<path d="${poly(hexP(R))}" fill="none" stroke="${t.glow}" stroke-width="${w}"${extra}/>`;
  if (track) out += line(track, 3.4, ` opacity=".55" filter="url(#${id}s)"`) + line(track, 0.9, n >= 7 ? ' stroke-dasharray="3 9" pathLength="600" class="cd"' : ' opacity=".9"');
  if (n >= 6) { const M = hexP(89.6); out += all6(k => { const a = lerp(M[k], M[(k + 1) % 6], 0.4), b = lerp(M[k], M[(k + 1) % 6], 0.6), d = `M${pt(a)}L${pt(b)}`; return `<g class="gap" style="animation-delay:${f(-k * 0.5)}s"><path d="${d}" stroke="${t.acc}" stroke-width="5" filter="url(#${id}s)"/><path d="${d}" stroke="#fff" stroke-width="1.2"/></g>`; }); }
  out += `<g filter="url(#${id}fm)"><path data-frame="${n}" fill-rule="evenodd" d="${metal}" fill="url(#${id}ma)"/>${caps ? `<path d="${caps}" fill="${mix(mMid, mLight, 0.25)}"/>` : ''}</g>`;
  // the glowing parts of the frame, and a lit edge around the whole badge
  if (hot) out += `<g clip-path="url(#${id}k)"><path fill-rule="evenodd" d="${hot}" fill="${t.acc}" stroke="${t.acc}" stroke-width="5" opacity=".9" filter="url(#${id}s)"/></g><g filter="url(#${id}ft)"><path data-hot="1" fill-rule="evenodd" d="${hot}" fill="${mix(t.glow, '#ffffff', 0.6)}"/></g>`;
  if (powered) out += `<path d="${poly(hexP(RO - 1))}" fill="none" stroke="${t.glow}" stroke-width="1.5" opacity=".95"${breath ? ' class="bc"' : ''}/>`;
  if (comets) {
    const gap = 600 / comets, d = poly(hexP(track));
    out += `<g fill="none"><path d="${d}" pathLength="600" stroke="${t.acc}" stroke-width="7" stroke-dasharray="70 ${gap - 70}" opacity=".8" filter="url(#${id}s)" class="run"/><path d="${d}" pathLength="600" stroke="#fff" stroke-width="1.6" stroke-dasharray="70 ${gap - 70}" opacity=".9" class="run"/><path d="${d}" pathLength="600" stroke="#fff" stroke-width="2.6" stroke-dasharray="10 ${gap - 10}" class="runh"/></g>`;
  }

  // light circling the lettering: the far half of each ring is drawn before the letters, the near half after
  const orbit = (rot: number, half: string, delay: number) => {
    const e = `M${CX - 64} ${CY}A64 22 0 1 1 ${CX + 64} ${CY}A64 22 0 1 1 ${CX - 64} ${CY}Z`, at = ` style="animation-delay:${delay}s"`;
    return `<g transform="rotate(${rot} ${CX} ${CY})"><g clip-path="url(#${id}${half})" fill="none"><path d="${e}" stroke="${t.glow}" stroke-width=".5" opacity=".4"/><path d="${e}" pathLength="100" stroke="${t.acc}" stroke-width="4.6" stroke-dasharray="18 82" opacity=".8" filter="url(#${id}s)" class="ob"${at}/><path d="${e}" pathLength="100" stroke="#fff" stroke-width="1" stroke-dasharray="18 82" class="ob"${at}/><path d="${e}" pathLength="100" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-dasharray=".1 99.9" class="obh"${at}/></g></g>`;
  };
  const orbits = top8 ? [[-20, 0], [20, -2.1]] : n === 7 ? [[-14, 0]] : [];
  for (const [rot, delay] of orbits) out += orbit(rot, 'ha', delay);

  // lettering: one line of satin metal inlaid on the glass
  const d = label(n, 36);
  defs += `<clipPath id="${id}tx"><path d="${d}"/></clipPath>`;
  if (n >= 4) out += `<path d="${d}" fill="${t.glow}" stroke="${t.glow}" stroke-width="4" filter="url(#${id}g)" class="glow"/>`;
  out += `<path d="${d}" transform="translate(0.5 2.4)" fill="#000" stroke="#000" stroke-width="1.6" opacity=".6" filter="url(#${id}s)"/>`;
  out += `<path d="${d}" fill="${INK}" stroke="${mix(t.acc, INK, 0.78)}" stroke-width="2.6" stroke-linejoin="round"/>`;
  out += `<g filter="url(#${id}ft)"><path data-lettering="1" d="${d}" fill="url(#${id}i)"/></g>`;
  if (n >= 3) out += `<g clip-path="url(#${id}tx)"><g class="tsh"><rect x="-50" y="${CY - 30}" width="24" height="60" fill="#fff" opacity=".85" transform="skewX(-20)"/></g></g>`;
  if (top8) out += `<path d="${d}" fill="#fff" class="bf"/>`;
  for (const [rot, delay] of orbits) out += orbit(rot, 'hb', delay);

  out += `<g clip-path="url(#${id}k)"><g class="sheen"><rect x="-90" y="0" width="${34 + n * 2}" height="200" fill="url(#${id}sh)" transform="skewX(-20)"/></g></g>`;

  // Only the rules a rank uses are written, so each file states exactly what moves in it.
  const o = `transform-origin:${CX}px ${CY}px`;
  const rules = [
    `.sheen{animation:sheen ${f(11 - n * 0.6)}s ease-in-out infinite}@keyframes sheen{0%,50%{transform:translateX(0)}86%,100%{transform:translateX(360px)}}`,
    n >= 3 && `.tsh{animation:tsh ${f(7.4 - n * 0.4)}s ease-in-out infinite}@keyframes tsh{0%,40%{transform:translateX(0)}70%,100%{transform:translateX(260px)}}`,
    n >= 2 && `.glow{animation:glow ${breath || f(5.6 - n * 0.3)}s ease-in-out infinite}@keyframes glow{0%,100%{opacity:.22}50%{opacity:${f(0.4 + n * 0.06)}}}`,
    n >= 4 && `.au1{animation:au1 11s ease-in-out infinite alternate}@keyframes au1{to{transform:translate(52px,-44px)}}.au2{animation:au2 14s ease-in-out infinite alternate}@keyframes au2{to{transform:translate(-56px,40px)}}`,
    breath && `.br{${o};animation:br ${breath}s ease-in-out infinite}@keyframes br{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}.bg{animation:bg ${breath}s ease-in-out infinite}@keyframes bg{0%,100%{opacity:.08}50%{opacity:1}}.bc{animation:bc ${breath}s ease-in-out infinite}@keyframes bc{0%,100%{opacity:.45}50%{opacity:1}}.bh{${o};animation:bh ${breath}s ease-in-out infinite}@keyframes bh{0%,100%{opacity:.12;transform:scale(.97)}50%{opacity:.6;transform:scale(1.05)}}`,
    powered && `.rays{${o};animation:spin ${f(120 - n * 9)}s linear infinite}.dial{${o};animation:spin ${f(150 - n * 12)}s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`,
    n === 6 && `.rip{${o};opacity:0;animation:rip 4.5s ease-out infinite}@keyframes rip{0%{transform:scale(.6);opacity:0}15%{opacity:.8}100%{transform:scale(3.4);opacity:0}}`,
    n >= 7 && `.dial2{${o};animation:spin 44s linear infinite reverse}.cd{animation:cd 3s linear infinite}@keyframes cd{to{stroke-dashoffset:-60}}`,
    n >= 6 && `.pt{opacity:0;animation:pt 5s linear infinite}@keyframes pt{0%{transform:translateY(0);opacity:0}15%{opacity:.8}100%{transform:translateY(-92px);opacity:0}}.gap{opacity:.25;animation:gap 3s ease-in-out infinite}@keyframes gap{0%,100%{opacity:.25}50%{opacity:1}}`,
    n === 7 && `.cn{stroke-dashoffset:100;animation:cn 7s ease-in-out infinite}@keyframes cn{0%{stroke-dashoffset:100;opacity:1}45%,82%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}`,
    comets > 0 && `.run{animation:run ${f(11 - n * 0.7)}s linear infinite}@keyframes run{to{stroke-dashoffset:-600}}.runh{stroke-dashoffset:-60;animation:runh ${f(11 - n * 0.7)}s linear infinite}@keyframes runh{to{stroke-dashoffset:-660}}`,
    n >= 7 && `.ob{animation:ob 4.2s linear infinite}@keyframes ob{to{stroke-dashoffset:-100}}.obh{stroke-dashoffset:-17.9;animation:obh 4.2s linear infinite}@keyframes obh{to{stroke-dashoffset:-117.9}}`,
    (n === 5 || n === 7) && `.gl0{animation:gl 3.2s ease-in-out infinite}.gl1{animation:gl 4.1s ease-in-out -1.4s infinite}.gl2{animation:gl 3.6s ease-in-out -2.3s infinite}@keyframes gl{0%,100%{opacity:.15}50%{opacity:1}}`,
    top8 && `.cor{${o};animation:cor 6s ease-in-out infinite}@keyframes cor{0%,100%{transform:scale(.9);opacity:.6}4%{transform:scale(1.2);opacity:1}40%{transform:scale(1);opacity:.75}}.spa{${o};animation:spin 38s linear infinite}.spb{${o};animation:spin 26s linear infinite reverse}`,
    top8 && `.bf{opacity:0;animation:bf 6s linear infinite}@keyframes bf{0%,100%{opacity:0}1.5%{opacity:.85}11%{opacity:0}}.bw{${o};opacity:0;animation:bw 6s ease-out infinite}@keyframes bw{0%{transform:scale(.3);opacity:0}2%{opacity:1}18%,100%{transform:scale(9);opacity:0}}`,
    `@media (prefers-reduced-motion:reduce){*{animation:none!important}.sheen,.tsh,.run,.runh,.pt,.bf,.bw,.ob,.obh,.rip{display:none}.cn{stroke-dashoffset:0}}`,
  ].filter(Boolean).join('\n');
  const c = f(100 * (1 - SCALE));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="VIP${n}"><style>${rules}</style><defs>${defs}</defs><g transform="translate(${c} ${c}) scale(${SCALE})">${out}${front}</g></svg>`;
}
