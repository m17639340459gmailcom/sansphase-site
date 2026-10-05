import { registrationLifetimeMs } from './reader-workflow.ts';

export type ReaderCleanupRow = { createdAt: string; _verified?: boolean; vip_until?: string | null };

export const readerCleanupDue = (row: ReaderCleanupRow, lastLoginAt: string | null | undefined, now: number | string | Date = Date.now()) => {
  const time = typeof now === 'number' ? now : new Date(now).getTime();
  const anchor = Date.parse(lastLoginAt || row.createdAt);
  if (row._verified !== true) return Number.isFinite(time) && Number.isFinite(anchor) && time - anchor >= registrationLifetimeMs;
  const vipUntil = Date.parse(row.vip_until || '');
  return Number.isFinite(time) && Number.isFinite(anchor) && time >= readerInactiveDeadline(lastLoginAt || row.createdAt) &&
    (!Number.isFinite(vipUntil) || vipUntil <= time);
};

const beijingOffset = 8 * 60 * 60 * 1000;

// Six calendar months, preserving Beijing local time and clamping short months.
export function readerInactiveDeadline(anchor: string): number {
  const date = new Date(Date.parse(anchor) + beijingOffset);
  if (!Number.isFinite(date.getTime())) return NaN;
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + 6;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()) - beijingOffset;
}

// Inverse of the deadline, including Aug 29–31 when all expire on Feb 28.
export function readerInactiveCutoff(now: Date): string {
  const date = new Date(now.getTime() + beijingOffset);
  const year = date.getUTCFullYear(), month = date.getUTCMonth(), day = date.getUTCDate();
  const currentLastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const sourceLastDay = new Date(Date.UTC(year, month - 5, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 6, day === currentLastDay ? sourceLastDay : Math.min(day, sourceLastDay),
    23, 59, 59, 999) - beijingOffset).toISOString();
}
