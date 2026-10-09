import { communityLevelRules } from '../src/community-rules.ts';
import { evaluateCommunityBadges, emptyBadgeMetrics, communityBadgeTiers } from '../src/community-badge-policy.ts';
import type { CommunityBadgeState } from '../src/community-badge-policy.ts';
import { maximumCommunityExperienceProjection } from './community-experience.ts';

// Only the verified, explicitly linked owner-personal reader receives this
// presentation, including its public profile. It changes DTOs, never account
// membership, balances, awards or management authority.
export function createOwnerReaderPreview() {
  const badgeState: CommunityBadgeState = evaluateCommunityBadges(emptyBadgeMetrics());
  badgeState.families = badgeState.families.map(family => ({
    ...family, tier: communityBadgeTiers[communityBadgeTiers.length - 1], achievedAt: null,
    tiers: family.tiers.map(tier => ({
      ...tier, achieved: true, achievedAt: null, eligible: true, blockedReasons: [],
      requirements: tier.requirements.map(requirement => ({ ...requirement, have: requirement.need, met: true })),
    })),
  }));
  return { ...maximumCommunityExperienceProjection(), trustLevel: Math.max(...Object.keys(communityLevelRules).map(Number)), badgeState };
}
export type OwnerReaderPreview = ReturnType<typeof createOwnerReaderPreview>;
