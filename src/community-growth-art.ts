import {communityGrowthLevel} from './community-growth.mjs';

// Approved C artwork. URLs are fixed site assets, never member-supplied values.
export function communityGrowthArtHTML(level = 1): string {
  const grade = communityGrowthLevel(level).level;
  const slug = grade === 1 ? 'feather' : `c-g${grade}-v3`;
  const file = grade === 1 ? 'feather.svg' : `${slug}.webp`;
  const url = `/assets/community/levels/${file}`;
  const moving = grade >= 7;
  const displayURL = moving ? `/assets/community/levels/c-g${grade}-motion-v2.svg` : url;
  const image = grade === 1
    ? '<span class="community-growth-art-mask" aria-hidden="true"></span>'
    : `<img class="community-growth-art-image" src="${displayURL}" width="512" height="512" alt="" decoding="async" draggable="false">`;
  return `<span class="community-growth-art community-level-mark" data-growth-art="${grade}" data-growth-motion="${moving ? grade : 0}"${moving ? ` data-growth-rig="${grade < 9 ? 'phoenix' : 'dragon'}"` : ''} data-tier="${grade}" data-level-icon="${slug}" style="--growth-art:url('${url}')" aria-hidden="true">${image}</span>`;
}
