export type CommunityGrowthNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type CommunityGrowthState = { level: CommunityGrowthNumber; points: number; configured: boolean };
export type CommunityGrowthDefinition = { level: CommunityGrowthNumber; name: string; en: string; threshold: number | null };

// The ten growth titles are independent of earned trust and moderation appointments.
// Experience thresholds and accounting await separate approval; no automatic upgrades run yet.
export const communityGrowthConfigured = false;
export const communityGrowthLevels: readonly CommunityGrowthDefinition[] = [
  { level: 1, name: '星芽', en: 'STAR SEED', threshold: 0 },
  { level: 2, name: '星火', en: 'SPARK', threshold: null },
  { level: 3, name: '拾光', en: 'LIGHT SEEKER', threshold: null },
  { level: 4, name: '寻星', en: 'STAR SEEKER', threshold: null },
  { level: 5, name: '观星', en: 'STAR GAZER', threshold: null },
  { level: 6, name: '巡星', en: 'STAR WALKER', threshold: null },
  { level: 7, name: '织星', en: 'STAR WEAVER', threshold: null },
  { level: 8, name: '引星', en: 'STAR GUIDE', threshold: null },
  { level: 9, name: '星河', en: 'GALAXY', threshold: null },
  { level: 10, name: '星海', en: 'SEA OF STARS', threshold: null },
];

export function communityGrowthLevel(level = 1): CommunityGrowthDefinition {
  const index = Number.isFinite(level) ? Math.max(0, Math.min(9, Math.trunc(level) - 1)) : 0;
  return communityGrowthLevels[index];
}

export function communityGrowthState(points: number): CommunityGrowthState {
  return { level: 1, points: Number.isFinite(points) ? Math.max(0, Math.trunc(points)) : 0, configured: communityGrowthConfigured };
}
