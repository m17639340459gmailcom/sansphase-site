// 月相 VIP 头像框试稿：原画做底，所有动效都是叠在原画上的光。不是发布源码。
// 画布 1265×1265，圆环圆心在画布正中，头像半径 380（框按头像的 166.4% 叠放）。
// 周期全部整除 12 秒，方便之后导出成循环的动图 WebP。
const S = 1265, C = S / 2, WAVE = S / 3;
let serial = 0;
// deterministic scatter, so every instance and every export frame agree
const rnd = seed => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const star = (L, w = L * 0.09) => `M0 ${-L}Q${w} ${-w} ${L} 0Q${w} ${w} 0 ${L}Q${-w} ${w} ${-L} 0Q${-w} ${-w} 0 ${-L}Z`;

// where the painting keeps its crystals: [x, y, flare length]
const crystals = [[631, 86, 62], [631, 262, 40], [631, 313, 26], [182, 224, 46], [361, 374, 28], [904, 374, 28], [63, 745, 26], [230, 1133, 54], [1035, 1133, 54], [230, 989, 26], [1035, 989, 26], [631, 1133, 58], [631, 1236, 30], [631, 845, 44], [552, 945, 26], [713, 945, 26]];
// the row of moon phases, left to right, with the full moon in the middle
const phases = [[380, 261, 26], [439, 215, 30], [504, 184, 36], [631, 172, 60], [760, 184, 36], [826, 215, 30], [885, 261, 26]];

export function moonFrameSVG() {
  const id = `mf${serial++}`, r = rnd(7);
  let twinkles = '';
  for (let k = 0; k < 56; k++) { const x = 40 + r() * (S - 80), y = 60 + r() * (S - 100), d = [2, 3, 4, 6][k % 4]; twinkles += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(5 + r() * 6).toFixed(1)}" class="tw" style="animation-duration:${d}s;animation-delay:${(-r() * d).toFixed(2)}s"/>`; }
  let dust = '';
  for (let k = 0; k < 18; k++) { const side = k % 2, x = side ? 1030 + r() * 200 : 35 + r() * 200, y = 420 + r() * 600, d = [4, 6, 6][k % 3]; dust += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(2.6 + r() * 3).toFixed(1)}" class="du" style="animation-duration:${d}s;animation-delay:${(-r() * d).toFixed(2)}s"/>`; }
  const flares = crystals.map(([x, y, len], k) => { const L = len * 0.72, d = [3, 4, 6][k % 3]; return `<g transform="translate(${x} ${y})"><g class="fl" style="animation-duration:${d}s;animation-delay:${(-(k * 0.83) % d).toFixed(2)}s"><circle r="${(L * 0.34).toFixed(0)}" fill="url(#${id}h)"/><path d="${star(L, L * 0.06)}" fill="#fff"/><path d="${star(L * 0.42, L * 0.04)}" fill="#fff" transform="rotate(45)"/></g></g>`; }).join('');
  const lit = phases.map(([x, y, R], k) => `<circle cx="${x}" cy="${y}" r="${R * 1.7}" fill="url(#${id}h)" class="ph" style="animation-delay:${(k * 0.45 - 6).toFixed(2)}s"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" class="moon-frame" style="isolation:isolate"><defs>`
    + ['gold', 'blue', 'pale'].map(k => `<mask id="${id}${k[0]}" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}"><image href="mask-${k}.png" width="${S}" height="${S}"/></mask>`).join('')
    + `<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff6dc" stop-opacity="0"/><stop offset=".5" stop-color="#fffdf2"/><stop offset="1" stop-color="#fff6dc" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="${id}f" x1="0" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="repeat"><stop offset=".3" stop-color="#bfe4ff" stop-opacity="0"/><stop offset=".5" stop-color="#d9f1ff" stop-opacity=".7"/><stop offset=".7" stop-color="#bfe4ff" stop-opacity="0"/></linearGradient>`
    + `<radialGradient id="${id}h"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".35" stop-color="#bfe0ff" stop-opacity=".55"/><stop offset="1" stop-color="#7fb4ff" stop-opacity="0"/></radialGradient>`
    + `<filter id="${id}x" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter><filter id="${id}t" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.4"/></filter><filter id="${id}w" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="${S + WAVE}" height="${S}" color-interpolation-filters="sRGB"><feImage href="wave.png" x="0" y="0" width="${S + WAVE}" height="${S}" preserveAspectRatio="none" result="w0"/><feOffset in="w0" dx="0" result="w"><animate attributeName="dx" from="0" to="${-WAVE}" dur="6s" repeatCount="indefinite"/></feOffset><feImage href="env.png" x="0" y="0" width="${S}" height="${S}" preserveAspectRatio="none" result="e"/><feComposite in="w" in2="e" operator="arithmetic" k1="1" k2="0" k3="-.5" k4=".5" result="m"/><feDisplacementMap in="SourceGraphic" in2="m" scale="46" xChannelSelector="G" yChannelSelector="R"/></filter><clipPath id="${id}c"><rect x="14" y="14" width="${S - 28}" height="${S - 28}"/></clipPath></defs>`
    // the ribbons are bent by a wave that travels along them; the rest of the painting lies still on top
    + `<g filter="url(#${id}w)"><image href="ribbon-640.webp" width="${S}" height="${S}"/></g><image href="still-640.webp" width="${S}" height="${S}"/>`
    // Every moving light is clipped a little inside the canvas, within its own masked group: a masked group's outermost pixel column can be composited unmasked at fractional positions.
    // the two moons breathe, out of step with each other
    + `<circle cx="631" cy="172" r="118" fill="url(#${id}h)" class="mo"/><circle cx="631" cy="934" r="128" fill="url(#${id}h)" class="mo" style="animation-delay:-2s"/>`
    // moonlight passing along the row of phases
    + lit
    // flowing light in the ribbons and the blue behind the crescents
    + `<g mask="url(#${id}b)" style="mix-blend-mode:screen"><g clip-path="url(#${id}c)"><g class="flow"><rect x="-640" y="0" width="${S + 1280}" height="${S}" fill="url(#${id}f)" transform="skewX(-18)"/></g></g></g>`
    // starlight inside the moon glass and crystals
    + `<g mask="url(#${id}p)" style="mix-blend-mode:screen" fill="#fff"><g clip-path="url(#${id}c)"><g filter="url(#${id}t)">${twinkles}</g></g></g>`
    // a light running round the gold ring, and a sheen crossing all the metalwork
    + `<g mask="url(#${id}g)" style="mix-blend-mode:screen"><g clip-path="url(#${id}c)"><g class="ring" fill="none" filter="url(#${id}x)"><circle cx="${C}" cy="${C}" r="388" stroke="#fff8e0" stroke-width="46" pathLength="600" stroke-dasharray="80 220"/></g>`
    + `<g class="sheen"><rect x="-420" y="-200" width="300" height="${S + 400}" fill="url(#${id}s)" transform="skewX(-22)"/></g></g></g>`
    // stardust rising beside the crescents, and flares on the crystals
    + `<g fill="#cfe6ff" filter="url(#${id}t)">${dust}</g>${flares}</svg>`;
}

export const moonFrameCSS = `
.moon-frame .mo{animation:mf-mo 4s ease-in-out infinite}@keyframes mf-mo{0%,100%{opacity:.08}50%{opacity:.6}}
.moon-frame .ph{opacity:0;animation:mf-ph 6s ease-in-out infinite}@keyframes mf-ph{0%,100%{opacity:0}8%{opacity:.95}22%{opacity:0}}
.moon-frame .flow{animation:mf-flow 3s linear infinite}@keyframes mf-flow{to{transform:translateX(320px)}}
.moon-frame .tw{opacity:0;animation:mf-tw 3s ease-in-out infinite}@keyframes mf-tw{0%,100%{opacity:0}50%{opacity:1}}
.moon-frame .ring{transform-origin:${C}px ${C}px;animation:mf-ring 6s linear infinite}@keyframes mf-ring{to{transform:rotate(120deg)}}
.moon-frame .sheen{animation:mf-sheen 4s ease-in-out infinite}@keyframes mf-sheen{0%,35%{transform:translateX(0)}85%,100%{transform:translateX(${S + 700}px)}}
.moon-frame .du{opacity:0;animation:mf-du 6s linear infinite}@keyframes mf-du{0%{transform:translateY(0);opacity:0}20%{opacity:.9}100%{transform:translateY(-150px);opacity:0}}
.moon-frame .fl{animation:mf-fl 4s ease-in-out infinite}@keyframes mf-fl{0%,62%,100%{transform:scale(0);opacity:0}80%{transform:scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){.moon-frame *{animation:none!important}.moon-frame :is(.flow,.sheen,.ring,.du,.fl,.ph,.tw){display:none}}
`;
