import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCommunityBadges, emptyBadgeMetrics } from '../src/community-badge-policy.ts';
import type { BadgeAward } from '../src/community-badge-policy.ts';

test('six families use approved gates and legacy honors never grant a new tier', () => {
  const metrics = emptyBadgeMetrics();
  const state = evaluateCommunityBadges(metrics, [], [{ id: 'streak365', achievedAt: '2025-01-01', revokedAt: null }]);
  assert.equal(state.families.length, 6);
  assert.equal(state.families.find(item => item.id === 'attendance')?.tier, null);
  metrics.attendance.checkins = 1;
  metrics.attendance.streak = 365;
  let attendance = evaluateCommunityBadges(metrics).families[0];
  assert.deepEqual(attendance.tiers.map(item => item.eligible), [true, true, false]);
  metrics.accountDays = 365;
  attendance = evaluateCommunityBadges(metrics).families[0];
  assert.equal(attendance.tiers[2].eligible, true);
  metrics.violations180 = 1;
  assert.equal(evaluateCommunityBadges(metrics).families[0].tiers[2].eligible, false);
});

test('higher content tiers require stable evidence, diverse people and real contribution months', () => {
  const metrics = emptyBadgeMetrics();
  metrics.accountDays = 500;
  metrics.appreciation = { likes: 1500, people: 300, contents: 50, months: 12, stableLikes: 1500, stablePeople: 300, stableContents: 50, stableMonths: 11 };
  let state = evaluateCommunityBadges(metrics).families.find(item => item.id === 'appreciation')!;
  assert.deepEqual(state.tiers.map(item => item.eligible), [true, true, false]);
  metrics.appreciation.stableMonths = 12;
  state = evaluateCommunityBadges(metrics).families.find(item => item.id === 'appreciation')!;
  assert.equal(state.tiers[2].eligible, true);
  assert.equal(state.tier, null, 'eligibility alone is never an awarded tier');
});

test('normal progress loss preserves confirmed highest honors; revoked honors do not return', () => {
  const metrics = emptyBadgeMetrics();
  const awards: BadgeAward[] = [{ family: 'attendance', tier: 'diamond', achievedAt: '2026-01-01', revokedAt: null }];
  assert.equal(evaluateCommunityBadges(metrics, awards).families[0].tier, 'diamond');
  awards[0].revokedAt = '2026-02-01';
  assert.equal(evaluateCommunityBadges(metrics, awards).families[0].tier, null);
});

test('every approved numerical gate is necessary for all eighteen material levels', () => {
  const metrics = emptyBadgeMetrics();
  metrics.accountDays = 365;
  metrics.attendance = { checkins: 365, streak: 365 };
  metrics.early = { days: 180, months: 12 };
  metrics.writing = { topics: 150, recognized: 50, featured: 3, months: 12, stableTopics: 150, stableRecognized: 50, stableFeatured: 3, stableMonths: 12 };
  metrics.appreciation = { likes: 1500, people: 300, contents: 50, months: 12, stableLikes: 1500, stablePeople: 300, stableContents: 50, stableMonths: 12 };
  metrics.answers = { count: 100, people: 40, months: 12, stableCount: 100, stablePeople: 40, stableMonths: 12 };
  metrics.featured = { count: 20, months: 12, stableCount: 20, stableMonths: 12 };
  const state = evaluateCommunityBadges(metrics);
  for (const family of state.families) for (const tier of family.tiers) {
    assert.equal(tier.eligible, true, `${family.id}/${tier.tier}`);
    assert.ok(tier.requirements.every(item => item.met));
  }
  assert.deepEqual(state.families[2].tiers[1].requirements.map(item => item.need), [50, 15]);
  assert.deepEqual(state.families[2].tiers[2].requirements.map(item => item.need), [150, 50, 3, 12, 365, 1]);
  assert.deepEqual(state.families[4].tiers[1].requirements.map(item => item.need), [30, 15]);
  assert.deepEqual(state.families[4].tiers[2].requirements.map(item => item.need), [100, 40, 12, 365, 1]);
  assert.deepEqual(state.families[5].tiers.map(item => item.requirements[0].need), [1, 5, 20]);
  metrics.violations180 = 1;
  assert.ok(evaluateCommunityBadges(metrics).families.every(family => !family.tiers[2].eligible));
});
