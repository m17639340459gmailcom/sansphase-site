// 管理身份「棱光守序」第八稿：头像框和身份徽标直接用原图切出来的像素（见 cut.py），这里只在上面叠动效和名字。
// 每件输出一个自包含的 SVG：切图以 WebP 内嵌，动效全部是 CSS，不含脚本和外链。仅供预览，不是发布源码。
import { readFile, writeFile } from 'node:fs/promises';

const here = new URL('.', import.meta.url);
const f = n => Number(n.toFixed(2));
const rad = d => d * Math.PI / 180;
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => { const x = hex(a), y = hex(b), k = Math.max(0, Math.min(1, t)); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
const pt = p => `${f(p[0])} ${f(p[1])}`;
// Angles run clockwise from the top.
const at = (c, r, deg) => [c[0] + r * Math.sin(rad(deg)), c[1] - r * Math.cos(rad(deg))];
const GOLD = ['#3a270f', '#86643a', '#c6a672', '#efdcb4', '#fffaf0'];
const names = ['协管', '版主', '总版主'], slugs = ['assistant', 'moderator', 'general'];

const geometry = JSON.parse(await readFile(new URL('geometry.json', here), 'utf8'));
// 名字用字：Ma Shan Zheng（马善政楷书，SIL OFL 1.1）的轮廓，由 glyphs.py 导出，图标里不引用字体。
const lettering = JSON.parse(await readFile(new URL('glyphs.json', here), 'utf8')).brush.glyphs;
const embed = async name => `data:image/webp;base64,${(await readFile(new URL(`assets/${name}.webp`, here))).toString('base64')}`;

let uid = 0;
const sparkle = (p, s, cls = 'tw', delay = 0, fill = '#fff') => `<path d="M${f(p[0])} ${f(p[1] - s)}Q${f(p[0] + s * 0.1)} ${f(p[1] - s * 0.1)} ${f(p[0] + s)} ${f(p[1])}Q${f(p[0] + s * 0.1)} ${f(p[1] + s * 0.1)} ${f(p[0])} ${f(p[1] + s)}Q${f(p[0] - s * 0.1)} ${f(p[1] + s * 0.1)} ${f(p[0] - s)} ${f(p[1])}Q${f(p[0] - s * 0.1)} ${f(p[1] - s * 0.1)} ${f(p[0])} ${f(p[1] - s)}Z" fill="${fill}"${cls ? ` class="${cls}" style="animation-delay:${delay}s"` : ''}/>`;
// A stone's own light: a soft bloom that swells and fades, and a glint on its lit corner.
const stone = (g, delay) => `<circle cx="${g.x}" cy="${g.y}" r="${f(g.s * 1.5)}" fill="url(#gg)" class="gb" style="mix-blend-mode:screen;animation-delay:${delay}s"/>` + sparkle([g.x - g.s * 0.16, g.y - g.s * 0.2], g.s * 0.5, 'tw', delay);
// A beam of light turning about the centre; shown through the art's own outline it runs over the metal and the stones.
const beam = (c, r, dur, delay = 0) => `<g class="sp" style="transform-origin:${c[0]}px ${c[1]}px;animation-duration:${dur}s;animation-delay:${delay}s">${[[15, 0.1], [9, 0.16], [4, 0.26]].map(([w, o]) => `<path d="M${c[0]} ${c[1]}L${pt(at(c, r, -w))}A${r} ${r} 0 0 1 ${pt(at(c, r, w))}Z" fill="#fff" opacity="${o}"/>`).join('')}</g>`;
const rays = (c, r0, r1, count) => {
  let d = ''; const id = `r${uid++}`, w = 360 / count * 0.17;
  for (let k = 0; k < count; k++) { const a = k * 360 / count; d += `M${pt(at(c, r0, a - w))}L${pt(at(c, r1, a - w * (k % 2 ? 0.4 : 0.8)))}L${pt(at(c, r1, a + w * (k % 2 ? 0.4 : 0.8)))}L${pt(at(c, r0, a + w))}Z`; }
  return `<radialGradient id="${id}" cx="${c[0]}" cy="${c[1]}" r="${r1}" gradientUnits="userSpaceOnUse"><stop offset="${f(r0 / r1)}" stop-color="#9cc8ff" stop-opacity=".5"/><stop offset="1" stop-color="#9cc8ff" stop-opacity="0"/></radialGradient><g class="ry" style="transform-origin:${c[0]}px ${c[1]}px"><path d="${d}" fill="url(#${id})"/></g>`;
};
const motes = (c, r, count) => Array.from({ length: count }, (_, k) => { const p = at(c, r + (k % 3) * 7, k * 360 / count + 14); return `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(1.1 + (k % 2) * 0.6)}" fill="#fff" class="rs" style="animation-delay:${f(-k * 0.55)}s"/>`; }).join('');
// Light for the 总版主 only. Every light fades out before the edge of the picture, so nothing is ever cut off.
// A point of light: a soft bloom that falls off, a bright core, and two thin streaks that taper to nothing.
const PRISM = ['#6ef3ff', '#8ea6ff', '#b98cff', '#ff9bd6', '#ffe7a6'];
// colour at position u along the spectrum, wrapping round so the sweep can run on past the last colour
const prism = u => { const k = ((u % 1) + 1) % 1 * PRISM.length, i = Math.floor(k); return mix(PRISM[i], PRISM[(i + 1) % PRISM.length], k - i); };
const lens = (p, s, cls = 'fl3', delay = 0, rot = 0) => {
  const [x, y] = p, L = s * 2.2, h = s * 0.14;
  return `<g class="${cls}" style="animation-delay:${delay}s"><g class="hueS"><circle cx="${f(x)}" cy="${f(y)}" r="${f(s * 2.2)}" fill="url(#blp)" opacity=".6"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(L)}" ry="${f(h)}" fill="url(#lfp)" filter="url(#b2w)" transform="rotate(${rot} ${f(x)} ${f(y)})"/></g><circle cx="${f(x)}" cy="${f(y)}" r="${f(s * 0.3)}" fill="#fff" filter="url(#b05)"/></g>`;
};
const stoneLight = (g, delay) => `<g class="hueS" style="animation-delay:${delay}s"><circle cx="${g.x}" cy="${g.y}" r="${f(g.s * 1.6)}" fill="url(#blp)" class="bsoft" style="mix-blend-mode:screen;animation-delay:${delay}s"/></g>` + lens([g.x - g.s * 0.2, g.y - g.s * 0.24], g.s * 0.22, 'fl3', delay);
// A specular glint: a band of light that is brightest in the middle and thins to nothing at both ends, drawn on a circle.
const sweep = (c, r, a0, a1, w, op, hue = 0) => {
  const n = 30, out = [], inn = [], segs = [];
  for (let i = 0; i <= n; i++) { const u = i / n, a = a0 + (a1 - a0) * u, k = (w / 2) * Math.sin(Math.PI * u) ** 0.8; out.push(at(c, r + k, a)); inn.push(at(c, r - k, a)); }
  for (let i = 0; i < n; i++) segs.push(`<path d="M${pt(out[i])}L${pt(out[i + 1])}L${pt(inn[i + 1])}L${pt(inn[i])}Z" fill="${prism(hue + i / n * 0.7)}" opacity="${op}"/>`);
  return `<g filter="url(#b2w)">${segs.join('')}</g>`;
};
const spikes = (c, r0, r1, n) => {
  const lens_ = [1, 0.86, 0.94, 0.82, 0.98, 0.84, 0.92, 0.8];
  return Array.from({ length: n }, (_, k) => {
    const a = k * 360 / n + (k * 7 % 5) - 2, L = r1 * lens_[k % lens_.length], w = 2.4;
    return `<path d="M${pt(at(c, r0, a - w))}L${pt(at(c, L, a))}L${pt(at(c, r0, a + w))}Z" fill="${prism(k / n)}" opacity="${k % 2 ? 0.1 : 0.16}" filter="url(#b2)"/>`;
  }).join('');
};
// The breathing halo outside the 总版主 frame, fading to nothing before the edge of the picture.
const haloFade = `<radialGradient id="hfg" cx="200" cy="200" r="200" gradientUnits="userSpaceOnUse"><stop offset=".8" stop-color="#fff"/><stop offset=".93" stop-color="#000"/></radialGradient><mask id="hfm" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400"><rect width="400" height="400" fill="url(#hfg)"/></mask>`;


// The title: solid gold lettering set level, with real depth, hovering in front of the foot of the frame.
// Front to back from the same outlines: a cast shadow on the frame, the stacked side walls, then the lit face.
function title(text, t) {
  const chars = [...text], S = chars.length === 3 ? 74 : 84, gap = chars.length === 3 ? 0 : 10, c = [200, 344], id = `n${uid++}`;
  const big = Math.max(...chars.map(ch => Math.max(lettering[ch].box[2] - lettering[ch].box[0], lettering[ch].box[3] - lettering[ch].box[1]))), k = S * 0.97 / big;
  const mid = (Math.min(...chars.map(ch => lettering[ch].box[1])) + Math.max(...chars.map(ch => lettering[ch].box[3]))) / 2, width = chars.length * S + (chars.length - 1) * gap, x0 = c[0] - width / 2;
  const place = (ch, i) => { const b = lettering[ch].box; return `translate(${f(x0 + i * (S + gap) + S / 2)} ${c[1]}) scale(${f(k * 1000) / 1000}) translate(${-(b[0] + b[2]) / 2} ${-mid})`; };
  const use = (dx, dy, attrs) => chars.map((_, i) => `<use href="#${id}g${i}" ${dx || dy ? `transform="translate(${f(dx)} ${f(dy)})" ` : ''}${attrs}/>`).join('');
  const depth = [8, 9, 11][t], side = t === 0 ? ['#0d1334', '#7c8abb'] : ['#1c1004', '#9a7a42'];
  let s = `<defs>${chars.map((ch, i) => `<path id="${id}g${i}" transform="${place(ch, i)}" d="${lettering[ch].d}"/>`).join('')}</defs><clipPath id="${id}c">${use(0, 0, '')}</clipPath>`
    + `<linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${GOLD[4]}"/><stop offset=".34" stop-color="${GOLD[3]}"/><stop offset=".55" stop-color="${GOLD[2]}"/><stop offset=".59" stop-color="${GOLD[1]}"/><stop offset=".8" stop-color="${GOLD[2]}"/><stop offset="1" stop-color="${GOLD[3]}"/></linearGradient>`;
  // a dark ground and a cool light behind the letters lift them off the avatar and the ring
  s += `<g filter="url(#b6)" opacity=".8">${use(0, depth * 0.6, `fill="#03061a" stroke="#03061a" stroke-width="${f(13 / k)}"`)}</g>${t >= 1 ? '<g class="hueS">' : ''}<g filter="url(#${t === 2 ? 'b6' : 'b2'})" opacity=".9">${use(0, depth * 0.5, `fill="${t === 2 ? '#8fe6ff' : t === 1 ? '#86c4ff' : '#3f7dff'}" stroke="${t === 2 ? '#8fe6ff' : t === 1 ? '#86c4ff' : '#3f7dff'}" stroke-width="${f(4 / k)}"`)}</g>${t >= 1 ? '</g>' : ''}`;
  // side walls: darkest at the back, catching a little light near the face
  for (let i = depth; i >= 1; i--) s += use(i * 0.32, i * 1.05, `fill="${mix(side[1], side[0], (i - 1) / (depth - 1))}" stroke="${mix(side[1], side[0], (i - 1) / (depth - 1))}" stroke-width="${f(1.1 / k)}" stroke-linejoin="round"`);
  s += use(depth * 0.32, depth * 1.05, `fill="none" stroke="#090511" stroke-width="${f(2.4 / k)}" stroke-linejoin="round" opacity=".55"`);
  // the face: a dark keyline, a pale bevel toward the light, a shaded one away from it, then the gold
  s += use(0, 0, `fill="#150c03" stroke="#150c03" stroke-width="${f(2.2 / k)}" stroke-linejoin="round"`) + use(0.9, 1.2, 'fill="#4a3312"') + use(-0.7, -0.9, `fill="${GOLD[4]}"`) + use(0, 0, `fill="url(#${id}t)"`)
    + `<g clip-path="url(#${id}c)"><path d="M${x0 - 10} ${c[1] - S * 0.2}Q${c[0]} ${c[1] - S * 0.02} ${x0 + width + 10} ${c[1] - S * 0.2}V${c[1] - S}H${x0 - 10}Z" fill="#fff" opacity=".2"/><rect x="${x0 - 60}" y="${c[1] - S * 0.7}" width="34" height="${S * 1.5}" fill="#fff" opacity=".9" transform="skewX(-20)" class="ns" style="--d:${width + 240}px"/></g>`;
  s += [-1, 1].map((d, i) => t === 2 ? lens([c[0] + d * (width / 2 + 8), c[1] - S * 0.34], 4.5, 'fl3', -i * 1.3) : sparkle([c[0] + d * (width / 2 + 8), c[1] - S * 0.34], 5.5, 'tw', -i * 1.3)).join('');
  // the shadow lies on the frame under the letters and tightens as they rise
  const foot = c[1] + S * 0.5 + (t === 2 ? depth * 0.5 + 1 : depth + 3);
  return `<ellipse cx="${c[0]}" cy="${foot}" rx="${f(width * 0.5)}" ry="${t === 2 ? 4 : 6}" fill="#02040f" opacity=".6" filter="url(#${t === 2 ? 'b2w' : 'b2'})" class="fs" style="transform-origin:${c[0]}px ${foot}px"/><ellipse cx="${c[0]}" cy="${foot - 1}" rx="${f(width * 0.42)}" ry="4" fill="${t === 2 ? '#ffd98a' : '#5fa2ff'}" opacity=".55" filter="url(#b6)" class="gb"/><g class="fl">${s}</g>`;
}

const css = t => [
  // breathing: the halo behind the piece and a faint lift of the whole surface, on one rhythm
  `.au{animation:au ${f(4.8 - t * 0.5)}s ease-in-out infinite}@keyframes au{0%,100%{opacity:.14}50%{opacity:${f(0.5 + t * 0.12)}}}`,
  `.bp{animation:bp ${f(4.8 - t * 0.5)}s ease-in-out infinite}@keyframes bp{0%,100%{opacity:0}50%{opacity:${t === 2 ? 0.03 : f(0.07 + t * 0.02)}}}`,
  `.gb{animation:gb ${f(4.2 - t * 0.5)}s ease-in-out infinite}@keyframes gb{0%,100%{opacity:.12}50%{opacity:.95}}`,
  `.tw{transform-box:fill-box;transform-origin:center;animation:tw ${f(3.4 - t * 0.5)}s ease-in-out infinite}@keyframes tw{0%,100%{opacity:0;transform:scale(.4)}50%{opacity:1;transform:scale(1)}}`,
  `.sp{animation:spin 9s linear infinite}.ry{animation:spin 60s linear infinite}.ob{animation:spin 18s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`,
  `.cm{animation:cm 6s linear infinite}@keyframes cm{to{stroke-dashoffset:-100}}`,
  `.sw{animation:sw 5.5s ease-in-out infinite}@keyframes sw{0%,40%{transform:skewX(-20deg) translateX(0)}80%,100%{transform:skewX(-20deg) translateX(var(--d))}}`,
  `.rs{opacity:0;animation:rs 4.4s ease-out infinite}@keyframes rs{0%{transform:translateY(8px);opacity:0}25%{opacity:1}100%{transform:translateY(-26px);opacity:0}}`,
  `.bu{opacity:0;animation:bu 5s ease-out infinite}@keyframes bu{0%{transform:scale(.4);opacity:0}8%{opacity:.9}40%,100%{transform:scale(2.6);opacity:0}}`,
  `.fl{animation:fl ${f(4.4 - t * 0.3)}s ease-in-out infinite}@keyframes fl{0%,100%{transform:translateY(1.5px)}50%{transform:translateY(-3.5px)}}.fs{animation:fs ${f(4.4 - t * 0.3)}s ease-in-out infinite}@keyframes fs{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(.86);opacity:.38}}`,
  `.ns{animation:ns ${f(6.5 - t * 1.2)}s ease-in-out infinite}@keyframes ns{0%,45%{transform:skewX(-20deg) translateX(0)}80%,100%{transform:skewX(-20deg) translateX(var(--d))}}`,
  `.gsw{animation:spin 7s linear infinite}.gfade{animation:gfade 7.2s ease-in-out infinite}@keyframes gfade{0%,100%{opacity:.18}50%{opacity:1}}`,
  `.fl3{transform-box:fill-box;transform-origin:center;animation:fl3 6.4s ease-in-out infinite}@keyframes fl3{0%,66%,100%{opacity:.25}74%{opacity:1}84%{opacity:.3}}`,
  `.bsoft{transform-box:fill-box;transform-origin:center;animation:bsoft 4.4s ease-in-out infinite}@keyframes bsoft{0%,100%{transform:scale(.85);opacity:.45}50%{transform:scale(1.08);opacity:1}}`,
  `.gosc{animation:gosc 9s ease-in-out infinite}@keyframes gosc{0%,100%{transform:rotate(-15deg)}50%{transform:rotate(15deg)}}`,
  `.hueS{animation:hueS 9s ease-in-out infinite}@keyframes hueS{0%,100%{filter:hue-rotate(-40deg) saturate(1.1)}50%{filter:hue-rotate(100deg) saturate(1.3)}}`,
  `@media (prefers-reduced-motion:reduce){*{animation:none!important}.sp,.cm,.sw,.rs,.bu,.tw,.ns,.ob,.gsw,.gfade,.gosc,.bsoft,.fl3,.hueS{display:none}}`,
].join('\n');
const shared = size => `<radialGradient id="blp"><stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset=".22" stop-color="#d8f6ff" stop-opacity=".5"/><stop offset=".5" stop-color="#b98cff" stop-opacity=".22"/><stop offset="1" stop-color="#6ef3ff" stop-opacity="0"/></radialGradient><linearGradient id="lfp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6ef3ff" stop-opacity="0"/><stop offset=".3" stop-color="#8ea6ff" stop-opacity=".8"/><stop offset=".5" stop-color="#ffffff" stop-opacity="1"/><stop offset=".7" stop-color="#ff9bd6" stop-opacity=".8"/><stop offset="1" stop-color="#ffe7a6" stop-opacity="0"/></linearGradient><radialGradient id="gsrcP"><stop offset="0" stop-color="#f7fdff" stop-opacity="1"/><stop offset=".3" stop-color="#7fe0ff" stop-opacity=".6"/><stop offset=".62" stop-color="#b98cff" stop-opacity=".28"/><stop offset="1" stop-color="#ff9bd6" stop-opacity="0"/></radialGradient><filter id="b2w" filterUnits="userSpaceOnUse" x="0" y="0" width="${size}" height="${size}"><feGaussianBlur stdDeviation="2"/></filter><filter id="bloomG" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.8  0 0 0 0 1  0.4 1 1.2 0 -1.1"/><feGaussianBlur stdDeviation="7"/></filter><linearGradient id="lf" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><radialGradient id="gsrc"><stop offset="0" stop-color="#eaf6ff" stop-opacity=".78"/><stop offset=".35" stop-color="#6fa8ff" stop-opacity=".34"/><stop offset="1" stop-color="#3f7dff" stop-opacity="0"/></radialGradient><radialGradient id="bl"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".25" stop-color="#cfe6ff" stop-opacity=".45"/><stop offset="1" stop-color="#3f7dff" stop-opacity="0"/></radialGradient><filter id="b05" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation=".5"/></filter><radialGradient id="gg"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".3" stop-color="#a9d2ff" stop-opacity=".7"/><stop offset=".6" stop-color="#3f7dff" stop-opacity=".3"/><stop offset="1" stop-color="#3f7dff" stop-opacity="0"/></radialGradient>`
  + `<filter id="b2" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2"/></filter><filter id="b6" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>`
  // the art's own outline, used to keep moving light on the piece and off the page around it
  + `<mask id="am" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="${size}" height="${size}"><use href="#art"/></mask>`;
// back: light behind the piece. lit: moving light kept to the piece's outline. over: light and lettering in front of it.
const wrap = (size, label, t, art, halo, back, lit, over, haloAttrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}"><style>${css(t)}</style><defs><image id="art" width="${size}" height="${size}" href="${art}"/>${shared(size)}</defs>`
  + `${back}${haloAttrs === 'none' ? '' : `<image href="${halo}" x="${-size * 0.03}" y="${-size * 0.03}" width="${size * 1.06}" height="${size * 1.06}" class="au" ${haloAttrs}/>`}<use href="#art"/><g mask="url(#am)"><rect width="${size}" height="${size}" fill="#fff" class="bp"/>${lit}</g>${over}</svg>`;

const C = [200, 200];
// Stones picked from what cut.py found, leaving out the blue enamel of the rings.
const frameStones = [
  [{ x: 202.2, y: 64, s: 25 }],
  [{ x: 57.5, y: 210.5, s: 25 }, { x: 348.8, y: 209.7, s: 25 }],
  [{ x: 202.3, y: 59, s: 25 }, { x: 65.5, y: 293.3, s: 31 }, { x: 336.4, y: 292.5, s: 31 }],
];
async function frame(t) {
  const g = geometry.frames[slugs[t]], mid = (g.hole + g.outer) / 2, band = g.outer - g.hole;
  const circ = (r, extra) => `<circle cx="200" cy="200" r="${f(r)}" fill="none" ${extra}/>`;
  let back = '', lit = t === 0 ? beam(C, 230, 10) : '', over = t === 0 ? frameStones[0].map((s, i) => stone(s, -i * 1.4)).join('') : '';
  if (t === 1) {
    // 版主: the 总版主's prismatic light, softer: a bloom from the art, a glow on each gem, and two glints running round the ring
    back = `<g class="hueS"><use href="#art" filter="url(#bloomG)" class="au" style="mix-blend-mode:screen;opacity:.8"/></g>` + frameStones[1].map((st, i) => `<g class="hueS" style="animation-delay:${-i * 3}s"><circle cx="${st.x}" cy="${st.y}" r="${f(st.s * 2.9)}" fill="url(#gsrcP)" class="bsoft" style="mix-blend-mode:screen;animation-delay:${f(-i * 0.4)}s;opacity:.95"/></g>`).join('');
    lit = [90, 270].map((a0, k) => `<g class="gosc" style="transform-origin:200px 200px;animation-delay:${-k * 4}s"><g class="gfade" style="animation-delay:${-k * 3.6}s">${sweep(C, mid, a0, a0 + 30, band * 0.9, 1, k * 0.5)}</g></g>`).join('');
  }
  if (t === 2) {
    // prismatic light: the art's own bloom and each gem's glow shimmer through cyan, violet and magenta
    back = `<g class="hueS"><use href="#art" filter="url(#bloomG)" class="au" style="mix-blend-mode:screen;opacity:1"/></g>` + frameStones[2].map((st, i) => `<g class="hueS" style="animation-delay:${-i * 3}s"><circle cx="${st.x}" cy="${st.y}" r="${f(st.s * 3.2)}" fill="url(#gsrcP)" class="bsoft" style="mix-blend-mode:screen;animation-delay:${f(-st.s * 0.05)}s"/></g>`).join('');
    // three spectral glints swing back and forth along the ring between the gems, never across one
    lit = [60, 180, 300].map((a0, k) => `<g class="gosc" style="transform-origin:200px 200px;animation-delay:${-k * 3}s"><g class="gfade" style="animation-delay:${-k * 2.4}s">${sweep(C, mid, a0, a0 + 34, band * 0.85, 1, k * 0.33)}</g></g>`).join('');
    // two spectral glints run round the hairline outside the ring, each leading a small flare
    over += `<g class="ob" style="transform-origin:200px 200px">${[0, 180].map((a0, i) => `<g transform="rotate(${a0} 200 200)">${sweep(C, g.hairline, -16, 16, 2.6, 1, 0.5 + i * 0.5)}${lens(at(C, g.hairline, 14), 2.8, 'fl3', -i * 1.6)}</g>`).join('')}</g>`;
    over = frameStones[2].map((st, i) => stoneLight(st, -i * 1.4)).join('') + over;
  }
  return wrap(400, `${names[t]}头像框`, t, await embed(`frame-${slugs[t]}`), await embed(`frame-${slugs[t]}-halo`), back, lit, over + title(names[t], t), t >= 1 ? 'none' : '');
}
async function badge(t) {
  const s = geometry.badges[slugs[t]].gems[0], B = [120, 120];
  let back = '', lit = t === 0 ? beam(B, 140, 9) : '', over = t === 0 ? stone({ x: s.x, y: s.y, s: s.size * 0.62 }, 0) : '';
  // the wings of the middle rank catch a passing light; the highest rank stands on turning rays and throws a ring of light
  if (t === 1) {
    // 版主: a softer version of the 总版主's light: a bloom from the art, a glow on the gem, one glint round the silver ring and a spectral bar across the wings
    back = `<g class="hueS"><use href="#art" filter="url(#bloomG)" class="au" style="mix-blend-mode:screen;opacity:.8"/></g><g class="hueS"><circle cx="${s.x}" cy="${s.y}" r="${f(s.size * 1.3)}" fill="url(#gsrcP)" class="bsoft" style="mix-blend-mode:screen;opacity:1"/></g>`;
    lit = `<g class="gosc" style="transform-origin:120px 120px"><g class="gfade">${sweep(B, 81, 38, 72, 6, 1, 0.3)}</g></g><rect x="-60" y="0" width="34" height="240" fill="url(#lfp)" opacity="1" class="sw" style="--d:360px"/>`;
  }
  if (t === 2) {
    back = `<g class="hueS"><use href="#art" filter="url(#bloomG)" class="au" style="mix-blend-mode:screen"/></g><g class="hueS"><circle cx="${s.x}" cy="${s.y}" r="46" fill="url(#gsrcP)" class="bsoft" style="mix-blend-mode:screen"/></g><g class="ry" style="transform-origin:120px 120px">${spikes(B, 58, 112, 8)}</g>`;
    lit = [35, 215].map((a0, k) => `<g class="gosc" style="transform-origin:120px 120px;animation-delay:${-k * 4}s"><g class="gfade" style="animation-delay:${-k * 3}s">${sweep(B, 81, a0, a0 + 30, 6, 1, k * 0.5)}</g></g>`).join('');
    over = stoneLight({ x: s.x, y: s.y, s: s.size * 0.62 }, 0) + [0, 90, 180, 270].map((a0, i) => lens(at(B, a0 % 180 ? 104 : 112, a0), 4.2, 'fl3', -i * 0.6, a0 % 180 === 0 ? 90 : 0)).join('');
  }
  return wrap(240, `${names[t]}徽标`, t, await embed(`badge-${slugs[t]}`), await embed(`badge-${slugs[t]}-halo`), back, lit, over, t >= 1 ? 'none' : '');
}

const uri = s => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;
const tiers = [];
for (const t of [2, 1, 0]) {
  const fr = await frame(t), bd = await badge(t);
  await writeFile(new URL(`assets/frame-${slugs[t]}.svg`, here), fr);
  await writeFile(new URL(`assets/badge-${slugs[t]}.svg`, here), bd);
  tiers.push({ name: names[t], slug: slugs[t], frame: uri(fr), badge: uri(bd), fkb: `${f(Buffer.byteLength(fr) / 1024)} KB`, bkb: `${f(Buffer.byteLength(bd) / 1024)} KB` });
}
const live = async name => uri(await readFile(new URL(`../../public/assets/community/levels/${name}`, here), 'utf8'));
const growth = await live('constellation-g6.svg'), trust = await live('trust-l2.svg'), vip = await live('vip-4.svg');
const ratio = Math.round(400 / (2 * geometry.frames.general.hole) * 100);

const page = `body{margin:0;padding:28px 20px 60px;background:#0d121c;color:#dfe5ee;font:15px/1.6 "Noto Serif SC","Songti SC",serif}
main{max-width:1240px;margin:0 auto}h1{margin:0 0 4px;font-size:24px;letter-spacing:.14em;color:#f0dfbe}main>p{margin:0 0 22px;color:#a5acb7}
section{margin:0 0 22px;padding:20px 22px 22px;border-radius:16px;background:linear-gradient(180deg,#1d2c47,#182338);border:1px solid #2b3850}
h2{margin:0 0 4px;font-size:17px;letter-spacing:.1em;font-weight:600;color:#f0dfbe}.lead{margin:0 0 14px;color:#a5acb7;font-size:13px;max-width:980px}
.pane{border-radius:12px;padding:18px 12px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.pane.dark{background:#0c1830;color:#e6e8ec}.pane.light{background:#f3efe6;color:#2b3445}
.tier{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}.tier b{font-size:15px;letter-spacing:.2em}.tier small{font:11px ui-monospace,monospace;opacity:.5}
.line{display:flex;align-items:center;justify-content:center;gap:16px}
.av{position:relative;display:inline-block;width:var(--s);height:var(--s);margin:calc(var(--s)*.32);border-radius:50%;background:linear-gradient(135deg,#f6b26b,#e06c9f 55%,#7a5cf0);flex:0 0 auto}
.av::before{content:"艾";position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:600 calc(var(--s)*.42)/1 "Noto Serif SC",serif}
.av img{position:absolute;inset:${-(ratio - 100) / 2}%;width:${ratio}%;height:${ratio}%;max-width:none}
.who{display:inline-flex;align-items:center;gap:6px;font:600 16px/1.4 system-ui}.marks{display:inline-flex;align-items:center;gap:5px}.m{display:inline-flex;flex:0 0 auto}.m img{display:block;width:100%;height:100%}
.m.g{width:40px;height:40px;margin:-6px}.m.t{width:28px;height:28px}.m.v{width:30px;height:30px;margin-inline:-3px}.m.s{width:38px;height:38px;margin:-4px}
.plain{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}.plain img{width:150px;height:150px}
@media(max-width:900px){.pane{grid-template-columns:1fr}}`;
const tier = b => `<div class="tier"><b>${b.name}</b><div class="line"><span class="av" style="--s:190px"><img alt="" src="${b.frame}"></span></div><div class="line"><span class="av" style="--s:96px"><img alt="" src="${b.frame}"></span><span class="av" style="--s:64px"><img alt="" src="${b.frame}"></span><span class="av" style="--s:40px"><img alt="" src="${b.frame}"></span></div><small>${b.fkb}</small></div>`;
const mark = b => `<div class="tier"><b>${b.name}</b><div class="line"><img alt="" width="170" height="170" src="${b.badge}"><img alt="" width="64" height="64" src="${b.badge}"></div><span class="who">艾特<span class="marks"><i class="m g"><img alt="" src="${growth}"></i><i class="m t"><img alt="" src="${trust}"></i><i class="m v"><img alt="" src="${vip}"></i><i class="m s"><img alt="" src="${b.badge}"></i></span></span><small>${b.bkb}</small></div>`;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>管理身份 · 棱光守序 第八稿</title><style>${page}</style><main><h1>管理身份 · 棱光守序 第八稿</h1><p>头像框和徽标都是原图的像素，没有重画；上面叠了呼吸和流动的光，头像框底部是悬浮的金字名字（马善政楷书）。头像框按头像的 ${ratio}% 叠加。</p>`
  + `<section><h2>头像框</h2><p class="lead">协管：整体呼吸，顶石明灭，一道光慢慢扫过。版主：再加两道绕环的流光，两侧宝石轮流亮，扫光变成两道。总版主：再加背后的光芒、沿外圈细环跑的两点光、上升的光点和顶石定时迸出的一圈光，流光三道。</p>${['dark', 'light'].map(t => `<div class="pane ${t}">${tiers.map(tier).join('')}</div>`).join('')}</section>`
  + `<section><h2>身份徽标</h2><p class="lead">协管：呼吸，宝石明灭，扫光。版主：再加一道掠过银翼的光。总版主：再加背后的光芒、四角的闪光和宝石迸出的一圈光。</p>${['dark', 'light'].map(t => `<div class="pane ${t}">${tiers.map(mark).join('')}</div>`).join('')}</section>`
  + `<section><h2>切出来的原图</h2><p class="lead">不带动效和名字的静态图，已清掉周围的雾边，可以单独使用。</p><div class="pane light"><div class="plain" style="grid-column:1/-1">${tiers.map(b => `<img alt="" src="assets/frame-${b.slug}.png"><img alt="" src="assets/badge-${b.slug}.png">`).join('')}</div></div></section></main></html>`;
await writeFile(new URL('index.html', here), html);
console.log(tiers.map(t => `${t.name} ${t.fkb} / ${t.bkb}`).join(' | '));
