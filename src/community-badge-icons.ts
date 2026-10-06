import { communityCheckinBadges } from './community-rules.mjs';
import { communityBadgeFamilies, communityBadgeTiers, legacyBadgeFamily } from './community-badge-policy.mjs';
import type { BadgeFamilyId, BadgeTier } from './community-badge-policy.ts';

// The approved atlas is 1536 × 1024. Its drawings are optically centred rather
// than equal tile crops; keep the reviewed 248 × 300 windows unchanged.
const columnCenters = [143, 398, 643, 885, 1150, 1405] as const;
const rowStarts = [50, 370, 683] as const;
export function communityBadgeAtlasPosition(column: number, tier: BadgeTier) {
  const row = communityBadgeTiers.indexOf(tier);
  if (!Number.isInteger(column) || column < 0 || column >= columnCenters.length || row < 0) throw new RangeError('Invalid badge atlas coordinate');
  return { x: `${(columnCenters[column] - 124) / (1536 - 248) * 100}%`, y: `${rowStarts[row] / (1024 - 300) * 100}%` };
}
export function communityBadgeArtHTML(id: BadgeFamilyId, tier: BadgeTier, earned = true): string {
  const family = communityBadgeFamilies.find(item => item.id === id);
  if (!family) return '';
  const position = communityBadgeAtlasPosition(family.column, tier);
  return `<span class="community-badge-art" data-badge-art="${family.id}" data-finish="${earned ? tier : 'locked'}" style="--atlas-x:${position.x};--atlas-y:${position.y}" aria-hidden="true"></span>`;
}
// Historical emblems reuse the family drawing in gold without acquiring a new
// material or animation. The surrounding legacy label retains the old award.
export function legacyBadgeArtHTML(id: string, earned = true): string {
  const family = legacyBadgeFamily(id);
  return family ? communityBadgeArtHTML(family, 'gold', earned) : '';
}

type CheckinBadge = (typeof communityCheckinBadges)[number];

// Original vector emblems; no external assets or gradient IDs. The existing
// badge renderer reuses them in the calendar, profile and author rail.
const spark = (x: number, y: number, arm: number, waist = arm * .24) =>
  `<path d="M${x} ${y - arm} ${x + waist} ${y - waist} ${x + arm} ${y} ${x + waist} ${y + waist} ${x} ${y + arm} ${x - waist} ${y + waist} ${x - arm} ${y} ${x - waist} ${y - waist}Z"/>`;
const orbit = (content: string) => `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" opacity=".55">${content}</g>`;
const bright = (content: string) => `<g class="community-emblem-light">${content}</g>`;
const symbols: Record<CheckinBadge, string> = {
  first_checkin:
    orbit('<path d="m32 5 22 24-22 26L10 29Z"/><path d="M32 11v7M15 29h7m20 0h7M32 41v7"/>')
    + spark(32, 29, 16, 3.8) + bright(spark(32, 29, 6, 1.4))
    + '<path d="M27 52c-9-1-15-7-17-16 6 2 11 7 13 12-1-6-3-11-7-15 8 2 13 9 11 19Zm10 0c9-1 15-7 17-16-6 2-11 7-13 12 1-6 3-11 7-15-8 2-13 9-11 19Z" opacity=".72"/>'
    + spark(32, 57, 3, .9),
  streak7:
    orbit('<path d="m32 8 16 12 3 16-11 15H23L12 36l5-17Z"/><path d="M24 15c-9 5-12 18-7 26m30-15c4 10-2 20-11 25"/>')
    + [[32, 8], [48, 20], [51, 36], [40, 51], [23, 51], [12, 36], [17, 19]].map(([x, y]) => spark(x, y, 3.5, .9)).join('')
    + spark(32, 30, 12, 3) + bright(spark(32, 30, 4.5, 1.2)),
  streak30:
    '<path d="M38 6C22 5 10 17 10 32c0 15 12 27 27 26 7 0 13-3 17-8-20 6-36-7-35-23 0-9 7-17 19-21Z"/>'
    + orbit('<path d="M32 12C14 18 16 42 32 50M42 11l9 9m-1 22-6 7"/>')
    + spark(40, 27, 12, 2.7) + bright(spark(40, 27, 4.5, 1))
    + spark(53, 9, 3, .8) + spark(47, 44, 3.4, .9),
  streak100:
    '<path d="m9 27 12 8 3-19 8 13 8-13 3 19 12-8-6 18H15Z" opacity=".3"/>'
    + orbit('<path d="m9 27 12 8 3-19 8 13 8-13 3 19 12-8-6 18H15Z"/><path d="M17 48h30M24 52h16"/>')
    + spark(32, 18, 11, 2.4) + bright(spark(32, 18, 4, 1))
    + '<path d="m32 33 6 6-6 6-6-6Zm-14 6 3 3-3 3-3-3Zm28 0 3 3-3 3-3-3Z"/>'
    + spark(32, 57, 3.4, 1),
  streak365:
    orbit('<circle cx="32" cy="32" r="23"/><ellipse cx="32" cy="32" rx="25" ry="10" transform="rotate(-35 32 32)"/><ellipse cx="32" cy="32" rx="25" ry="10" transform="rotate(35 32 32)"/><path d="M32 4v7m0 42v7M4 32h7m42 0h7M12 12l5 5m30 30 5 5M12 52l5-5m30-30 5-5"/>')
    + spark(32, 32, 17, 3.6) + bright(spark(32, 32, 6, 1.4))
    + spark(32, 6, 4, 1) + spark(32, 58, 4, 1),
  early:
    '<path d="M28 42C17 40 7 34 4 23c7 4 12 7 19 9-5-5-9-10-10-16 7 6 14 13 15 26Zm8 0c11-2 21-8 24-19-7 4-12 7-19 9 5-5 9-10 10-16-7 6-14 13-15 26Z" opacity=".88"/>'
    + orbit('<path d="M23 32a9 9 0 0 1 18 0M19 39h26M23 45h18m-14 5h10M20 24l-3-3m27 3 3-3"/>')
    + spark(32, 18, 10, 2.2) + bright(spark(32, 18, 4, 1))
    + spark(32, 56, 3.4, 1),
};

export function checkinBadgeIconHTML(id: string): string {
  const key = communityCheckinBadges.find(badge => badge === id);
  return key ? `<svg class="community-checkin-emblem" data-emblem="${key}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="currentColor" aria-hidden="true" focusable="false">${symbols[key]}</svg>` : '';
}
