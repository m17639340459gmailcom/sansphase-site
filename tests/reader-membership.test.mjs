import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarMonth, addMembershipDays, membershipState } from '../server/reader-membership.mjs';

test('one month means the same UTC time next calendar month, clamping short months', () => {
  assert.equal(addCalendarMonth('2026-01-31T12:30:00.000Z'), '2026-02-28T12:30:00.000Z');
  assert.equal(addCalendarMonth('2028-01-31T12:30:00.000Z'), '2028-02-29T12:30:00.000Z');
  assert.equal(addCalendarMonth('2026-12-15T12:30:00.000Z'), '2027-01-15T12:30:00.000Z');
});

test('VIP ends at the expiration instant, even if stored expiration remains', () => {
  assert.equal(membershipState({ vip_until: '2026-10-24T08:00:00.000Z' }, new Date('2026-10-24T07:59:59.999Z')).vip, true);
  assert.equal(membershipState({ vip_until: '2026-10-24T08:00:00.000Z' }, new Date('2026-10-24T08:00:00.000Z')).vip, false);
  assert.equal(membershipState({ vip_until: null }, new Date('2026-10-24T08:00:00.000Z')).vip, false);
});

test('adding membership days preserves the current expiry time and rejects unsafe amounts', () => {
  assert.equal(addMembershipDays('2026-10-24T08:30:00.000Z', 7), '2026-10-31T08:30:00.000Z');
  assert.equal(addMembershipDays('2028-02-28T08:30:00.000Z', 1), '2028-02-29T08:30:00.000Z');
  for (const days of [0, -1, 1.5, 366, '7', null]) assert.throws(() => addMembershipDays('2026-10-24T08:30:00.000Z', days));
  assert.throws(() => addMembershipDays('invalid', 1));
});
