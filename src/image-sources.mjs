import {escapeHTML} from './core.mjs';
export const imageWidths = [384, 768, 960, 1280, 1920, 2560, 3840];
export function imageSourceSet(source, maxWidth = 0) {
  if (!/^\/api\/(?:author\/)?media\/[0-9a-f-]{36}(?:\?|$)/i.test(source || '')) return '';
  const url = new URL(source, 'https://site.invalid');
  const candidates = maxWidth > 0 && maxWidth <= imageWidths.at(-1) ? [...imageWidths.filter(w=>w < maxWidth), maxWidth] : imageWidths;
  return candidates.map(width => {
    // withoutEnlargement caps the actual result at the original width. Keep
    // the descriptor honest while still using a supported encoded variant.
    url.searchParams.set('w', imageWidths.find(w=>w>=width));
    return `${url.pathname}${url.search} ${width}w`;
  }).join(', ');
}
export function imageSources(source, sizes = '100vw', maxWidth = 0) {
  const candidates = imageSourceSet(source, maxWidth);
  return candidates ? `srcset="${escapeHTML(candidates)}" sizes="${escapeHTML(sizes)}"` : '';
}
