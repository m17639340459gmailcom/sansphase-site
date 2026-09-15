import {escapeHTML} from './core.mjs';
export const imageWidths = [384, 768, 960, 1280, 1920, 2560, 3840];
export function imageSourceSet(source) {
  if (!/^\/api\/media\/[0-9a-f-]{36}(?:\?|$)/i.test(source || '')) return '';
  const url = new URL(source, 'https://site.invalid');
  return imageWidths.map(width => {
    url.searchParams.set('w', width);
    return `${url.pathname}${url.search} ${width}w`;
  }).join(', ');
}
export function imageSources(source, sizes = '100vw') {
  const candidates = imageSourceSet(source);
  return candidates ? `srcset="${escapeHTML(candidates)}" sizes="${escapeHTML(sizes)}"` : '';
}
