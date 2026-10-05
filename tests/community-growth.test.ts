import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { communitySchema } from '../server/payload/community-migration.ts';
import { createLedger } from '../server/community-ledger.ts';
import { communityGrowthLevels, communityGrowthConfigured, communityGrowthLevel, communityGrowthState } from '../src/community-growth.ts';

test('the ten growth names are configured for display while unconfirmed upgrade thresholds remain inactive', () => {
  assert.equal(communityGrowthLevels.length, 10);
  assert.deepEqual(communityGrowthLevels.map(item => item.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(communityGrowthLevels.map(item => item.name), ['星芽', '星火', '拾光', '寻星', '观星', '巡星', '织星', '引星', '星河', '星海']);
  assert.deepEqual(communityGrowthLevels.map(item => item.threshold), [0, null, null, null, null, null, null, null, null, null]);
  assert.equal(communityGrowthConfigured, false);
  assert.equal(communityGrowthLevel(10).name, '星海');
  for (const points of [0, 5, 1000, 100000]) assert.deepEqual(communityGrowthState(points), { level: 1, points, configured: false });
  assert.equal(communityGrowthState(-10).points, 0);
  assert.equal(communityGrowthState(Number.NaN).points, 0);
});

test('growth counts valid positive behaviour awards rather than balance, transfers, attendance or extra bonuses', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(communitySchema);
    const ledger = createLedger(db), actor = { kind: 'reader' as const, id: 'reader' }, now = '2026-10-05T01:00:00.000Z';
    const post = { kind: 'topic', id: 'topic' };
    ledger.credit(actor, 100, 'preview-initial', null, now);
    ledger.credit(actor, 1, 'checkin', null, now);
    ledger.credit(actor, 8, 'thank-in', null, now, 'in');
    ledger.credit(actor, 8, 'unlock-in', null, now, 'in');
    ledger.credit(actor, 50, 'featured', post, now);
    assert.equal(ledger.growthPoints(actor), 0);
    ledger.reward(actor, 2, 'topic', post, now, 1);
    ledger.reward(actor, 1, 'reply', { kind: 'reply', id: 'reply' }, now, 1);
    ledger.reward(actor, 0, 'like', { kind: 'like', id: 'like' }, now, 0);
    ledger.reward(actor, 3, 'accepted', { kind: 'reply', id: 'answer' }, now, 1);
    ledger.reward(actor, 0, 'report', { kind: 'report', id: 'report' }, now, 0);
    assert.equal(ledger.growthPoints(actor), 6);
    ledger.debit(actor, 40, 'redeem', { kind: 'item', id: 'item' }, now);
    assert.equal(ledger.growthPoints(actor), 6, 'spending does not lower the growth value');
    ledger.revert(post, now);
    assert.equal(ledger.growthPoints(actor), 4, 'reverted behaviour awards no longer contribute');
    assert.equal(ledger.growthPoints({ kind: 'reader', id: 'another' }), 0);
  } finally { db.close(); }
});

test('a revoked reward stops contributing even if it was already spent and cannot be clawed back', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(communitySchema);
    const ledger = createLedger(db), actor = { kind: 'reader' as const, id: 'reader' }, now = '2026-10-05T01:00:00.000Z';
    const ref = { kind: 'reply', id: 'reply' };
    ledger.reward(actor, 1, 'reply', ref, now, 10);
    ledger.debit(actor, 1, 'redeem', null, now);
    assert.equal(ledger.growthPoints(actor), 1);
    assert.equal(ledger.revert(ref, now), 0);
    assert.equal(ledger.growthPoints(actor), 0);
  } finally { db.close(); }
});
