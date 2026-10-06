import test from 'node:test';
import assert from 'node:assert/strict';
import { communityGrowthLevels, communityGrowthLevel } from '../src/community-growth.ts';
import { experienceCatalogue, vipCatalogue } from '../server/community-experience.ts';

test('growth titles stay presentation-only; live upgrade thresholds are supplied by the server', () => {
  assert.equal(communityGrowthLevels.length, 10);
  assert.deepEqual(communityGrowthLevels.map(item => item.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(communityGrowthLevels.map(item => item.name), ['星芽', '星火', '拾光', '寻星', '观星', '巡星', '织星', '引星', '星河', '星海']);
  assert.equal(communityGrowthLevel(10).name, '星海');
  assert.equal(communityGrowthLevel(-1).level, 1);
  assert.equal(communityGrowthLevel(Number.NaN).level, 1);
  assert.equal(communityGrowthLevel(100).level, 10);
  assert.deepEqual(experienceCatalogue.map(item => item.threshold), [0, 1200, 3600, 7200, 13200, 21600, 31200, 43200, 56400, 72000]);
  assert.deepEqual(vipCatalogue.map(item => item.multiplier), [2, 3, 4, 6, 8, 11, 15, 20]);
  assert.ok(vipCatalogue.every(item => Object.keys(item).sort().join(',') === 'level,multiplier'), 'VIP catalogue excludes upgrade-day thresholds');
});
