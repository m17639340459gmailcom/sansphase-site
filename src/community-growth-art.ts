import {communityGrowthLevel} from './community-growth.mjs';

// Approved level art for all three ladders. URLs are fixed site assets, never member-supplied values.
// Growth: constellation medallions.
// Colour, rank track and motion live inside each self-contained SVG (scripts/growth-constellation.ts).
// Permission levels use the approved moon-phase badges. One file serves both themes.
export function communityTrustArtHTML(level: number, compact = false): string {
  const rank = Math.max(0, Math.min(3, Math.trunc(level) || 0));
  return `<span class="community-trust-art" data-trust-art="${rank}" data-level-icon="trust-l${rank}" aria-hidden="true"><img class="community-trust-art-image" src="${artSource(`trust-l${rank}`, compact)}" width="512" height="512" alt="" decoding="async" draggable="false"></span>`;
}
// VIP ranks use the approved hexagonal badges. One file serves both themes.
export function communityVipArtHTML(level: number, compact = false): string {
  const rank = Math.max(1, Math.min(8, Math.trunc(level) || 1));
  return `<span class="community-vip-art" data-vip-art="${rank}" data-level-icon="vip-${rank}" aria-hidden="true"><img class="community-vip-art-image" src="${artSource(`vip-${rank}`, compact)}" width="512" height="512" alt="" decoding="async" draggable="false"></span>`;
}
export function communityGrowthArtHTML(level = 1, compact = false): string {
  const grade = communityGrowthLevel(level).level;
  const slug = `constellation-g${grade}`;
  return `<span class="community-growth-art" data-growth-art="${grade}" data-level-icon="${slug}" aria-hidden="true"><img class="community-growth-art-image" src="${artSource(slug, compact)}" width="512" height="512" alt="" decoding="async" draggable="false"></span>`;
}
const artSource = (slug: string, compact: boolean): string => `/assets/community/levels/${compact ? `compact/${slug}.webp` : `${slug}.svg`}`;
