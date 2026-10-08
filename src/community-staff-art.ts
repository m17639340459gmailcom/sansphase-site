import type { CommunityStaffRole } from './community-staff.ts';

export type CommunityStaffArtRole = Exclude<CommunityStaffRole, 'owner'>;
export const communityStaffArtRevision = 'staff-20261009-r2';

// A fixed revision prevents a cached, pre-repair SVG from restoring the square glow.
export function communityStaffArtSource(slug: string, compact: boolean): string {
  if (!/^(?:badge|frame)-(?:assistant|moderator|general)$/.test(slug)) return '';
  return `/assets/community/staff/${compact ? `compact/${slug}.webp` : `${slug}.svg`}?v=${communityStaffArtRevision}`;
}

// Presentation follows an explicit current appointment, never a paid decoration or earned level.
export function communityStaffArtRole(role: unknown): CommunityStaffArtRole | null {
  return role === 'assistant' || role === 'moderator' || role === 'general' ? role : null;
}

export function communityStaffArtHTML(role: CommunityStaffArtRole, kind: 'badge' | 'frame'): string {
  const slug = `${kind}-${role}`;
  const className = kind === 'frame' ? 'community-staff-frame' : 'community-staff-art';
  const catalogue = kind === 'badge' ? ` data-staff-art-slot data-staff-role="${role}"` : '';
  return `<span class="${className}" data-staff-art="${slug}"${catalogue} aria-hidden="true"><img class="community-staff-art-image" src="${communityStaffArtSource(slug, true)}" width="400" height="400" alt="" decoding="async" draggable="false"></span>`;
}
