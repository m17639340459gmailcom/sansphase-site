import { communityGrowthLevels } from './community-growth.mjs';
import type { CommunityGrowthNumber } from './community-growth.ts';
import { communityLevels } from './community-rules.mjs';
import { communityStaffRoles } from './community-staff.mjs';
import type { CommunityStaffRole } from './community-staff.ts';
import { communityBadgeFamilies, communityBadgeTiers } from './community-badge-policy.mjs';
import type { BadgeFamilyId, BadgeTier } from './community-badge-policy.ts';

type TrustNumber = 0 | 1 | 2 | 3;
type VIPNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type IconStaffRole = Exclude<CommunityStaffRole, 'owner'>;
export type CommunityIconRef = `growth:${CommunityGrowthNumber}` | `trust:${TrustNumber}` | `vip:${VIPNumber}`
  | `staff:${IconStaffRole}` | `badge:${BadgeFamilyId}:${BadgeTier}`;
type Label = { ref: CommunityIconRef; name: string; en: string };
export type CommunityIconDefinition = Label & (
  { kind: 'growth'; level: CommunityGrowthNumber } | { kind: 'trust'; level: TrustNumber }
  | { kind: 'vip'; level: VIPNumber } | { kind: 'staff'; role: IconStaffRole }
  | { kind: 'badge'; family: BadgeFamilyId; tier: BadgeTier });
export type CommunityIconEligibility = {
  growthLevel: number | null; trustLevel: number; vipLevel: number | null; staffRole: IconStaffRole | null;
  badges: readonly { family: BadgeFamilyId; tier: BadgeTier }[];
};
export type CommunityIconState = { selected: string | null; equipped: CommunityIconRef | null; available: CommunityIconRef[] };
const tiers = { gold: ['黄金', 'Gold'], diamond: ['钻石', 'Diamond'], aurora: ['炫彩', 'Aurora'] } as const;
export const communityIconCatalogue: readonly CommunityIconDefinition[] = [
  ...communityGrowthLevels.map(({ level, name, en }): CommunityIconDefinition => ({ kind: 'growth', ref: `growth:${level}`, level, name, en })),
  ...([0, 1, 2, 3] as const).map((level): CommunityIconDefinition => ({ kind: 'trust', ref: `trust:${level}`, level, name: communityLevels[level].name, en: communityLevels[level].en })),
  ...([1, 2, 3, 4, 5, 6, 7, 8] as const).map((level): CommunityIconDefinition => ({ kind: 'vip', ref: `vip:${level}`, level, name: `VIP${level}`, en: `VIP${level}` })),
  ...communityStaffRoles.filter(role => role.id !== 'owner').map(({ id, name, nameEn }): CommunityIconDefinition => ({ kind: 'staff', ref: `staff:${id}`, role: id, name, en: nameEn })),
  ...communityBadgeFamilies.flatMap(family => communityBadgeTiers.map((tier): CommunityIconDefinition => ({ kind: 'badge', ref: `badge:${family.id}:${tier}`, family: family.id, tier, name: `${family.name} · ${tiers[tier][0]}`, en: `${family.en} · ${tiers[tier][1]}` }))),
];
const definitions = new Map(communityIconCatalogue.map(item => [item.ref as string, item]));
export const communityIconDefinition = (ref: unknown): CommunityIconDefinition | null => typeof ref === 'string' ? definitions.get(ref) ?? null : null;
const reached = (current: number | null, required: number) => current !== null && Number.isInteger(current) && current >= required;
/** Availability is presentation policy; callers supply verified server qualifications. */
export function communityIconAvailable(input: CommunityIconEligibility): CommunityIconRef[] {
  return communityIconCatalogue.filter(item => item.kind === 'growth' ? reached(input.growthLevel, item.level)
    : item.kind === 'trust' ? reached(input.trustLevel, item.level)
    : item.kind === 'vip' ? reached(input.vipLevel, item.level)
    : item.kind === 'staff' ? input.staffRole === item.role
    : input.badges.some(badge => badge.family === item.family && badge.tier === item.tier)).map(item => item.ref);
}
/** Null is default, empty string is deliberate removal; invalid historical selections remain recorded. */
export function communityIconState(selected: string | null, input: CommunityIconEligibility): CommunityIconState {
  const available = communityIconAvailable(input);
  const candidate = selected === null ? input.staffRole ? `staff:${input.staffRole}`
    : input.vipLevel !== null ? `vip:${input.vipLevel}` : null : selected;
  return { selected, equipped: available.find(ref => ref === candidate) ?? null, available };
}
