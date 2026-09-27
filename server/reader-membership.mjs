export function addCalendarMonth(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw Error('Invalid membership date.');
  const year = date.getUTCFullYear(), month = date.getUTCMonth(), day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + 1, Math.min(day, lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds())).toISOString();
}

export function addMembershipDays(value, days) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw Error('Membership days must be an integer from 1 to 365.');
  const base = Date.parse(value);
  if (!Number.isFinite(base)) throw Error('Invalid membership date.');
  const until = new Date(base + days * 86400000);
  if (!Number.isFinite(until.getTime())) throw Error('Invalid membership date.');
  return until.toISOString();
}

export function membershipState(row, now = new Date()) {
  const until = row?.vip_until || null;
  return { vip: Boolean(until && Date.parse(until) > now.getTime()), vipStartedAt: row?.vip_started_at || null, vipUntil: until };
}
