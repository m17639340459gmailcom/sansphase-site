export type CommunityGrowthNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type CommunityGrowthState = {
  level: CommunityGrowthNumber; points: number; configured: boolean;
  startThreshold?: number; nextLevel?: CommunityGrowthNumber | null; nextThreshold?: number | null;
  remaining?: number; progress?: number;
};
export type CommunityVIPGrowthState = {
  active: boolean; level: number | null; days: number; nextDays: number | null;
  remaining: number; multiplier: number; progress: number;
};
export type CommunityExperienceCatalogueItem = { level: CommunityGrowthNumber; threshold: number };
export type CommunityVIPCatalogueItem = { level: number; multiplier: number };
export type CommunityGrowthDefinition = { level: CommunityGrowthNumber; name: string; en: string };

// The ten growth titles are independent of earned trust and moderation appointments.
// Names are presentation data. Experience thresholds and settlement belong to the server.
export const communityGrowthLevels: readonly CommunityGrowthDefinition[] = [
  { level: 1, name: '星芽', en: 'STAR SEED' },
  { level: 2, name: '星火', en: 'SPARK' },
  { level: 3, name: '拾光', en: 'LIGHT SEEKER' },
  { level: 4, name: '寻星', en: 'STAR SEEKER' },
  { level: 5, name: '观星', en: 'STAR GAZER' },
  { level: 6, name: '巡星', en: 'STAR WALKER' },
  { level: 7, name: '织星', en: 'STAR WEAVER' },
  { level: 8, name: '引星', en: 'STAR GUIDE' },
  { level: 9, name: '星河', en: 'GALAXY' },
  { level: 10, name: '星海', en: 'SEA OF STARS' },
];

export function communityGrowthLevel(level = 1): CommunityGrowthDefinition {
  const index = Number.isFinite(level) ? Math.max(0, Math.min(9, Math.trunc(level) - 1)) : 0;
  return communityGrowthLevels[index];
}
