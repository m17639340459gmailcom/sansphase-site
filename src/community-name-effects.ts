import { communityNameEffect } from './community-rules.mjs';

type RGB = readonly [number, number, number];
type HSL = readonly [number, number, number];
type Theme = 'light' | 'dark';
const parseRGB = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
const encodeRGB = (rgb: RGB) => '#' + rgb.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const luminance = (rgb: RGB) => {
  const linear = rgb.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
};
const surfaces: Record<Theme, readonly number[]> = {
  light: ['#E8E2D5', '#F4EFE5'].map(colour => luminance(parseRGB(colour))),
  dark: ['#1B293E', '#23354D'].map(colour => luminance(parseRGB(colour))),
};
const readable = (hex: string, theme: Theme) => {
  const value = luminance(parseRGB(hex));
  return surfaces[theme].every(surface => (Math.max(value, surface) + .05) / (Math.min(value, surface) + .05) >= 4.5);
};

function toHSL(rgb: RGB): HSL {
  const [r, g, b] = rgb, high = Math.max(r, g, b), low = Math.min(r, g, b), difference = high - low;
  const lightness = (high + low) / 2;
  if (!difference) return [0, 0, lightness];
  const hue = high === r ? ((g - b) / difference + 6) % 6 : high === g ? (b - r) / difference + 2 : (r - g) / difference + 4;
  return [hue / 6, difference / (1 - Math.abs(2 * lightness - 1)), lightness];
}
function withLightness(hsl: HSL, lightness: number): string {
  const [hue, saturation] = hsl, amount = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => { const phase = (offset + hue * 12) % 12; return lightness - amount * Math.max(-1, Math.min(phase - 3, 9 - phase, 1)); };
  return encodeRGB([channel(0), channel(8), channel(4)]);
}
function adjusted(hex: string, theme: Theme): string {
  if (readable(hex, theme)) return hex;
  const hsl = toHSL(parseRGB(hex)), direction = theme === 'light' ? -1 : 1;
  for (let step = 1; step <= 1024; step++) {
    const colour = withLightness(hsl, Math.min(1, Math.max(0, hsl[2] + direction * step / 1024)));
    if (readable(colour, theme)) return colour;
  }
  return theme === 'light' ? '#000000' : '#FFFFFF';
}

// sRGB interpolation has convex luminance: its minimum can lie between two
// readable dark-theme endpoints. Check that minimum before accepting a pair.
function minimumGradientLuminance(start: string, end: string): number {
  const from = parseRGB(start), to = parseRGB(end);
  const value = (position: number) => luminance([from[0] + (to[0] - from[0]) * position, from[1] + (to[1] - from[1]) * position, from[2] + (to[2] - from[2]) * position]);
  let left = 0, right = 1;
  for (let step = 0; step < 28; step++) {
    const first = left + (right - left) / 3, second = right - (right - left) / 3;
    if (value(first) < value(second)) right = second; else left = first;
  }
  return Math.min(value(0), value(1), value((left + right) / 2));
}
function readableDarkPair(start: string, end: string): readonly [string, string] {
  const required = 4.5 * (Math.max(...surfaces.dark) + .05) - .05 + 1e-8;
  if (minimumGradientLuminance(start, end) >= required) return [start, end];
  const first = toHSL(parseRGB(start)), second = toHSL(parseRGB(end));
  for (let step = 1; step <= 1024; step++) {
    const a = withLightness(first, Math.min(1, first[2] + step / 1024));
    const b = withLightness(second, Math.min(1, second[2] + step / 1024));
    if (minimumGradientLuminance(a, b) >= required) return [a, b];
  }
  return ['#FFFFFF', '#FFFFFF'];
}

const cache = new Map<string, string>();
/** Emit only validated hex colours; retain source colours and adapt contrast per theme. */
export function nameEffectVariables(effect: unknown): string {
  const value = communityNameEffect(effect);
  if (!value) return '';
  const key = `${value.style}:${value.colors.join(',')}`, previous = cache.get(key);
  if (previous) return previous;
  const start = value.colors[0], end = value.colors[1] || start;
  const lightStart = adjusted(start, 'light'), lightEnd = adjusted(end, 'light');
  const [darkStart, darkEnd] = readableDarkPair(adjusted(start, 'dark'), adjusted(end, 'dark'));
  const variables = `--name-start:${start};--name-end:${end};--name-light-start:${lightStart};--name-light-end:${lightEnd};--name-dark-start:${darkStart};--name-dark-end:${darkEnd}`;
  if (cache.size >= 256) cache.clear();
  cache.set(key, variables);
  return variables;
}
