// 把一件 SVG 内嵌进页面，并按 URL 里的 #t=毫秒 暂停所有 CSS 动画到该时刻，供无头 Chrome 截取某一帧。仅供检查。
import { readFile, writeFile } from 'node:fs/promises';
const [, , name, size = '600', bg = '#0c1830'] = process.argv;
const svg = (await readFile(new URL(`assets/${name}.svg`, import.meta.url), 'utf8')).replace(/<svg /, `<svg width="${size}" height="${size}" `);
const html = `<!doctype html><html><meta charset="utf-8"><style>html,body{margin:0;background:${bg};overflow:hidden}svg{display:block}</style><body>${svg}
<script>
const t = Number((location.hash.match(/t=([0-9.]+)/) || [0, 0])[1]);
document.getAnimations().forEach(a => { a.pause(); a.currentTime = t; });
</script></body></html>`;
await writeFile(new URL(`render/${name}.html`, import.meta.url), html);
console.log('wrote', `render/${name}.html`);
