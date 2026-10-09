import test from 'node:test';
import assert from 'node:assert/strict';
import { communityIconCatalogue, communityIconAvailable, communityIconDefinition, communityIconState } from '../src/community-icon-policy.ts';
import type { CommunityIconEligibility } from '../src/community-icon-policy.ts';
const empty: CommunityIconEligibility = { growthLevel: null, trustLevel: -1, vipLevel: null, staffRole: null, badges: [] };
test('the typed catalogue contains precisely the approved artwork refs', () => {
  assert.equal(communityIconCatalogue.length, 43); assert.equal(new Set(communityIconCatalogue.map(item => item.ref)).size, 43);
  for (const item of communityIconCatalogue) { assert.equal(communityIconDefinition(item.ref), item); assert.ok(item.name && item.en); }
  assert.equal(communityIconDefinition('growth:01'), null); assert.equal(communityIconDefinition('staff:owner'), null);
});
test('default, explicit removal and invalid historical choices have separate meanings', () => {
  const current = { ...empty, vipLevel: 4, staffRole: 'assistant' as const };
  assert.equal(communityIconState(null, current).equipped, 'staff:assistant');
  assert.equal(communityIconState('', current).equipped, null);
  assert.deepEqual(communityIconState('staff:general', current).selected, 'staff:general');
  assert.equal(communityIconState('staff:general', current).equipped, null);
  assert.equal(communityIconState(null, { ...current, staffRole: null }).equipped, 'vip:4');
  assert.equal(communityIconState(null, empty).equipped, null);
});
test('eligibility uses present qualifications without inferring prior offices or missing achievement tiers', () => {
  assert.deepEqual(communityIconAvailable({ ...empty, growthLevel: 2, trustLevel: 1, vipLevel: 2, staffRole: 'moderator', badges: [{ family: 'writing', tier: 'diamond' }] }),
    ['growth:1', 'growth:2', 'trust:0', 'trust:1', 'vip:1', 'vip:2', 'staff:moderator', 'badge:writing:diamond']);
});
