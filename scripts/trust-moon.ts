// 社区权限等级“月相”徽章：同一轮月亮逐级被照亮，L0 一弯新月、L1 半月、L2 盈凸月、L3 满月。
// 外形是立起的方形（菱形），与成长的圆盘、VIP 的六角区分；材质与 VIP 徽章一致：受光的本色缎面边框和从内部发光的深色玻璃。
// 每级一个自包含的矢量文件，深浅主题共用，由本模块确定性生成。
// 发布资产由 scripts/build-trust-moon.mjs 写入 public/assets/community/levels/，不手工修改。
// 设计约定见 docs/COMMUNITY-EXPERIENCE-RULES.md。图标内不含脚本、外链、位图或字体引用。
import { communityLevels } from '../src/community-rules.ts';

type Point = [number, number];
type Level = { tint: string; deep: string; glow: string };

const f = (n: number): number => Number(n.toFixed(2));
const rad = (d: number): number => d * Math.PI / 180;
const pt = (p: Point): string => `${f(p[0])} ${f(p[1])}`;
const hex = (c: string): number[] => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number): string => { const x = hex(a), y = hex(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const pol = (r: number, deg: number): Point => [100 + r * Math.cos(rad(deg)), 100 + r * Math.sin(rad(deg))];

const INK = '#080b15';
// One colour family per level, matching the level page's existing trust accents.
const levels: readonly Level[] = [
  { tint: '#8794ad', deep: '#353f55', glow: '#dbe7ff' }, // 初光
  { tint: '#35a896', deep: '#0f4a44', glow: '#7df2de' }, // 巡天
  { tint: '#3f8fde', deep: '#123c70', glow: '#86ccff' }, // 观测
  { tint: '#6a7cec', deep: '#222a7e', glow: '#ffd08a' }, // 守夜
];
// How much of the moon is lit at each level.
export const trustMoonPhases = [0.16, 0.5, 0.8, 1] as const;

const poly = (p: Point[]): string => `M${p.map(pt).join('L')}Z`;
// A square standing on its corner, each tip cut flat so nothing ends in a needle.
const diamond = (R: number, c = 6): Point[] => ([[c, -(R - c)], [R - c, -c], [R - c, c], [c, R - c], [-c, R - c], [-(R - c), c], [-(R - c), -c], [-c, -(R - c)]] as Point[]).map(([x, y]): Point => [100 + x, 100 + y]);
const band = (Ra: number, Rb: number): string => poly(diamond(Ra)) + poly(diamond(Rb, 3));
// A plate over one tip of the frame; k turns it to the top, right, bottom or left tip.
const cap = (k: number, Ra: number, Rb: number, u: number): string => {
  const c = 6, x = c + u, pts: Point[] = [[-x, -(Ra - x)], [-c, -(Ra - c)], [c, -(Ra - c)], [x, -(Ra - x)], [x, -(Rb - x)], [0, -Rb], [-x, -(Rb - x)]];
  return poly(pts.map((point): Point => { let p = point; for (let i = 0; i < k; i++) p = [-p[1], p[0]]; return [100 + p[0], 100 + p[1]]; }));
};
// Height-lit metal: the blurred silhouette is the relief, shaded and given a specular edge from the upper left.
const relief = (id: string, blur: number, scale: number, shine: number, grain: boolean): string => `<filter id="${id}" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="${blur}" result="b"/>`
  + `<feDiffuseLighting in="b" surfaceScale="${scale}" diffuseConstant="1.25" lighting-color="#fff" result="df"><feDistantLight azimuth="232" elevation="52"/></feDiffuseLighting><feComposite in="SourceGraphic" in2="df" operator="arithmetic" k1="1" k2=".12" result="lt"/>`
  + `<feSpecularLighting in="b" surfaceScale="${scale}" specularConstant="${shine}" specularExponent="24" lighting-color="#fff" result="sp"><feDistantLight azimuth="232" elevation="52"/></feSpecularLighting><feComposite in="sp" in2="SourceAlpha" operator="in" result="sp2"/><feComposite in="lt" in2="sp2" operator="arithmetic" k2="1" k3="1" result="m"/>`
  + (grain ? `<feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .5 .5 0 0 -.42" result="g"/><feComposite in="g" in2="SourceAlpha" operator="in" result="g2"/><feComposite in="m" in2="g2" operator="arithmetic" k2="1" k3=".14" result="m"/>` : '')
  + `<feComposite in="m" in2="SourceAlpha" operator="in"/></filter>`;

const R = 43, RO = 96, MOON = 30;

// The moon stays still; only light moves across and around it.
function moon(id: string, i: number, lv: Level): string {
  const r = MOON, lit = trustMoonPhases[i], rx = f(r * Math.abs(1 - 2 * lit));
  const shape = lit >= 1 ? `M${100 - r} 100a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z` : `M100 ${100 - r}A${r} ${r} 0 0 1 100 ${100 + r}A${rx} ${r} 0 0 ${lit < 0.5 ? 0 : 1} 100 ${100 - r}Z`;
  const craters = [[112, 88, 6], [118, 106, 4], [106, 116, 5], [96, 96, 7], [88, 112, 4.5], [100, 78, 3.5], [84, 92, 3]].map(([x, y, s]) => `<circle cx="${x}" cy="${y}" r="${s}"/>`).join('');
  const satellite = (rot: number, delay: number) => { const e = 'M58 100A42 14 0 1 1 142 100A42 14 0 1 1 58 100Z', at = ` style="animation-delay:${delay}s"`; return `<g data-satellite="1" transform="rotate(${rot} 100 100)" fill="none"><path d="${e}" stroke="${lv.glow}" stroke-width=".5" opacity=".35"/><path d="${e}" pathLength="100" stroke="${lv.tint}" stroke-width="4.4" stroke-dasharray="16 84" opacity=".8" filter="url(#${id}b)" class="ob"${at}/><path d="${e}" pathLength="100" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-dasharray=".1 99.9" class="obh"${at}/></g>`; };
  let out = `<g transform="rotate(-22 100 100)"><circle cx="100" cy="100" r="${r + 9}" fill="url(#${id}h)" opacity="${f(0.25 + lit * 0.6)}" class="core"/>`;
  if (i === 3) out += `<circle cx="100" cy="100" r="38.5" fill="none" stroke="${lv.glow}" stroke-width="3.6" opacity=".6" filter="url(#${id}b)" class="core"/><circle data-halo="1" cx="100" cy="100" r="38.5" fill="none" stroke="${mix(lv.glow, '#ffffff', 0.4)}" stroke-width=".8"/>`;
  out += `<circle cx="100" cy="100" r="${r}" fill="${mix(lv.deep, '#000000', 0.55)}"/><circle cx="100" cy="100" r="${r}" fill="none" stroke="${lv.tint}" stroke-width=".8" opacity=".55"/>`;
  out += `<path d="${shape}" fill="${lv.glow}" opacity=".7" filter="url(#${id}b)"/><path data-moon="${lit}" d="${shape}" fill="url(#${id}mn)"/>`;
  out += `<g clip-path="url(#${id}ml)"><g fill="${mix(lv.tint, lv.deep, 0.4)}" opacity=".22">${craters}</g>${i >= 1 ? `<g class="msh"><rect x="40" y="60" width="14" height="80" fill="#fff" opacity=".7" transform="skewX(-18)"/></g>` : ''}</g></g>`;
  if (i >= 2) out += satellite(-18, 0);
  if (i === 3) out += satellite(24, -2.2);
  return `<defs><radialGradient id="${id}mn" cx=".62" cy=".34" r=".9"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${mix(lv.glow, '#ffffff', 0.35)}"/><stop offset="1" stop-color="${mix(lv.tint, lv.glow, 0.35)}"/></radialGradient><clipPath id="${id}ml"><path d="${shape}"/></clipPath></defs>${out}`;
}

export function trustMoonSVG(level: number): string {
  const i = Number.isFinite(level) ? Math.max(0, Math.min(3, Math.trunc(level))) : 0;
  const lv = levels[i], id = `t${i}`, top = i === 3;
  const mLight = mix(lv.tint, '#ffffff', 0.72), mMid = mix(lv.tint, '#101421', 0.12), mDark = mix(lv.tint, '#000000', 0.8);
  // frame: one rim, then an inlaid line, then two rails, then two rails with glowing tip plates
  const RI = i < 2 ? 85 : 80;
  const metal = i < 2 ? band(RO, 85) : band(RO, 90) + band(86, 80);
  const track = i < 2 ? 0 : 88;
  const hot = top ? [0, 1, 2, 3].map(k => cap(k, 98, 79, 9)).join('') : '';
  const defs = `<linearGradient id="${id}ma" x1="20" y1="10" x2="180" y2="190" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${mix(mMid, mLight, 0.6)}"/><stop offset=".34" stop-color="${mMid}"/><stop offset=".66" stop-color="${top ? mix(mMid, '#b98a4a', 0.35) : mix(mMid, mDark, 0.5)}"/><stop offset="1" stop-color="${mix(mMid, mLight, 0.3)}"/></linearGradient>`
    + `<radialGradient id="${id}c" cx="100" cy="116" r="98" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${mix(lv.tint, '#ffffff', 0.1)}"/><stop offset=".42" stop-color="${mix(lv.tint, INK, 0.55)}"/><stop offset="1" stop-color="${INK}"/></radialGradient>`
    + `<radialGradient id="${id}h"><stop offset="0" stop-color="${lv.glow}" stop-opacity=".9"/><stop offset=".4" stop-color="${lv.glow}" stop-opacity=".3"/><stop offset="1" stop-color="${lv.glow}" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="${id}g" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="${mix('#050914', lv.tint, 0.3)}"/><stop offset="1" stop-color="#050914"/></radialGradient>`
    + `<linearGradient id="${id}gs" x1="0" y1="14" x2="0" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity=".01"/></linearGradient>`
    + `<linearGradient id="${id}is" x1="30" y1="20" x2="170" y2="176" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity=".9"/><stop offset=".55" stop-color="#000" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="${id}sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity="${f(0.18 + i * 0.03)}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + relief(`${id}fm`, 1.5, 5, 0.9, true) + relief(`${id}ft`, 0.7, 2.4, 0.75, false)
    + `<filter id="${id}d" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="5"/></filter><filter id="${id}b" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="1.9"/></filter>`
    + `<clipPath id="${id}k"><path d="${poly(diamond(RO))}"/></clipPath><clipPath id="${id}c2"><path d="${poly(diamond(RI + 1, 3))}"/></clipPath><clipPath id="${id}a"><circle cx="100" cy="100" r="${R}"/></clipPath>`;

  let out = `<path d="${poly(diamond(RO - 5))}" transform="translate(0 7)" fill="#000" opacity=".42" filter="url(#${id}d)"/>`;
  if (top) out += `<path d="${poly(diamond(RO + 3))}" fill="${lv.tint}" filter="url(#${id}d)" class="br"/>`;
  out += `<path d="${poly(diamond(RO + 1.2))}" fill="${mix(mDark, '#000000', 0.55)}"/><path d="${poly(diamond(RO - 0.6))}" fill="${INK}"/>`;

  // glass: dark, lit from within, with a ground of its own per level
  let ground = '';
  if (i === 0) for (let r = 16; r < 92; r += 10) ground += poly(diamond(r, 0));
  if (i === 1) for (let r = 52; r < 96; r += 7) ground += `M${100 - r} 100a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  if (i === 2) for (let k = -8; k <= 8; k++) ground += `M${100 + k * 10} 10V190M10 ${100 + k * 10}H190`;
  if (i === 3) for (let k = 0; k < 48; k++) ground += `M${pt(pol(50, k * 7.5))}L${pt(pol(96, k * 7.5))}`;
  let stone = `<path d="${poly(diamond(RI + 1, 3))}" fill="url(#${id}c)"/><path data-ground="${i}" d="${ground}" fill="none" stroke="${lv.glow}" stroke-width=".4" opacity=".2"/>`;
  stone += `<path d="M0 0H200V62Q100 92 0 62Z" fill="url(#${id}gs)"/><path d="${poly(diamond(RI + 1, 3))}" fill="none" stroke="url(#${id}is)" stroke-width="13" filter="url(#${id}b)"/>`;
  out += `<g clip-path="url(#${id}c2)">${stone}</g>`;

  // rank: a light in each of the four tips, one more lit per level
  for (let k = 0; k < 4; k++) {
    const [x, y] = pol(RI - 14.5, -90 + k * 90), d = `M${f(x)} ${f(y - 5)}L${f(x + 5)} ${f(y)}L${f(x)} ${f(y + 5)}L${f(x - 5)} ${f(y)}Z`;
    out += k <= i ? `<path d="${d}" fill="${lv.tint}" stroke="${lv.tint}" stroke-width="4" opacity=".8" filter="url(#${id}b)"/><path d="${d}" fill="${mix(lv.glow, '#ffffff', 0.5)}" data-rank="lit"${k === i ? ' class="core"' : ''}/>` : `<path d="${d}" fill="none" stroke="${lv.glow}" stroke-width=".9" opacity=".35" data-rank="unlit"/>`;
  }

  // the moon sits in a well in the glass, ringed in the same lit metal as the frame
  out += `<circle cx="100" cy="100" r="${R + 6.5}" fill="${mix(mDark, '#000000', 0.5)}"/><circle cx="100" cy="100" r="${R}" fill="url(#${id}g)"/>`;
  out += `<g clip-path="url(#${id}a)">${moon(id, i, lv)}<circle cx="100" cy="100" r="${R}" fill="none" stroke="#000" stroke-width="6" opacity=".34"/></g>`;
  out += `<g filter="url(#${id}ft)"><path fill-rule="evenodd" d="M${100 - R - 5.6} 100a${R + 5.6} ${R + 5.6} 0 1 0 ${2 * R + 11.2} 0a${R + 5.6} ${R + 5.6} 0 1 0 ${-2 * R - 11.2} 0ZM${100 - R} 100a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0Z" fill="url(#${id}ma)"/></g>`;

  // frame, the light in its groove, and at the top level its glowing tip plates and lit edge
  if (i === 1) out += `<path data-inlay="1" d="${poly(diamond(81, 2))}" fill="none" stroke="${lv.glow}" stroke-width=".8" opacity=".75"/>`;
  if (track) out += `<path d="${poly(diamond(track, 4))}" fill="none" stroke="${lv.glow}" stroke-width="3.4" opacity=".55" filter="url(#${id}b)"/><path d="${poly(diamond(track, 4))}" fill="none" stroke="${lv.glow}" stroke-width=".9" opacity=".9"/>`;
  out += `<g filter="url(#${id}fm)"><path data-frame="${i}" fill-rule="evenodd" d="${metal}" fill="url(#${id}ma)"/></g>`;
  if (hot) out += `<g clip-path="url(#${id}k)"><path d="${hot}" fill="${lv.glow}" stroke="${lv.glow}" stroke-width="5" opacity=".8" filter="url(#${id}b)"/></g><g filter="url(#${id}ft)"><path data-hot="1" d="${hot}" fill="${mix(lv.glow, '#ffffff', 0.55)}"/></g><path d="${poly(diamond(RO - 1))}" fill="none" stroke="${mix(lv.glow, '#ffffff', 0.4)}" stroke-width="1.5" class="br"/>`;
  if (track) { const d = poly(diamond(track, 4)), n = top ? 2 : 1, gap = 400 / n; out += `<g fill="none"><path d="${d}" pathLength="400" stroke="${top ? lv.glow : lv.tint}" stroke-width="7" stroke-dasharray="54 ${gap - 54}" opacity=".8" filter="url(#${id}b)" class="run"/><path d="${d}" pathLength="400" stroke="#fff" stroke-width="1.6" stroke-dasharray="54 ${gap - 54}" opacity=".9" class="run"/></g>`; }
  out += `<g clip-path="url(#${id}k)"><g class="sheen"><rect x="-90" y="0" width="${36 + i * 3}" height="200" fill="url(#${id}sh)" transform="skewX(-20)"/></g></g>`;

  // Only the rules a level uses are written, so each file states exactly what moves in it.
  const rules = [
    `.core{animation:core ${f(5.6 - i * 0.4)}s ease-in-out infinite}@keyframes core{0%,100%{opacity:.45}50%{opacity:1}}`,
    `.sheen{animation:sheen ${f(10 - i * 0.8)}s ease-in-out infinite}@keyframes sheen{0%,50%{transform:translateX(0)}86%,100%{transform:translateX(360px)}}`,
    i >= 1 && `.msh{animation:msh ${f(8 - i)}s ease-in-out infinite}@keyframes msh{0%,45%{transform:translateX(0)}80%,100%{transform:translateX(120px)}}`,
    i >= 2 && `.ob{animation:ob ${f(5.4 - i * 0.4)}s linear infinite}@keyframes ob{to{stroke-dashoffset:-100}}.obh{stroke-dashoffset:-15.9;animation:obh ${f(5.4 - i * 0.4)}s linear infinite}@keyframes obh{to{stroke-dashoffset:-115.9}}`,
    i >= 2 && `.run{animation:run ${top ? 5.5 : 7}s linear infinite}@keyframes run{to{stroke-dashoffset:-400}}`,
    top && `.br{animation:br 5s ease-in-out infinite}@keyframes br{0%,100%{opacity:.4}50%{opacity:1}}`,
    `@media (prefers-reduced-motion:reduce){*{animation:none!important}.msh,.ob,.obh,.sheen,.run{display:none}}`,
  ].filter(Boolean).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="L${i} ${communityLevels[i].name}"><style>${rules}</style><defs>${defs}</defs>${out}</svg>`;
}
