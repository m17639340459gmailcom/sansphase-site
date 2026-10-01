import { readerAudit, removeReaderAccount } from './reader-account-removal.ts';
import { registrationLifetimeMs } from './reader-workflow.ts';
import { cleanReaderFiles } from './reader-file-cleanup.ts';
import type { createReaderWorkflow } from './reader-workflow.ts';

type ReaderRow = { id: string; createdAt: string; _verified?: boolean; vip_until?: string | null };
type ReaderPayload = {
  find?: (options: object) => Promise<{ docs: ReaderRow[] }>;
  findByID: (options: { collection: string; id: string }) => Promise<ReaderRow | null>;
  delete: (options: { collection: string; id: string }) => Promise<unknown>;
};
type LoginLedger = {
  inactiveReaderIds: (cutoff: string, now: string, limit: number, offset: number) => string[];
  latest: (actorType: string, id: string) => { at?: string } | null;
};
type RetentionOptions = {
  payload: ReaderPayload; directory: string; uidStore: { get: (id: string) => string | null };
  loginLedger: LoginLedger; workflow?: ReturnType<typeof createReaderWorkflow>;
  mediaRetention?: { sweep: () => Promise<unknown> };
  // Accounts to keep even when inactive: those with live community posts or
  // replies, so a quiet author's posts are not removed with the account.
  keepReader?: (id: string) => boolean;
};

const thirtyDays = 30 * 24 * 60 * 60 * 1000;
export const readerCleanupDue = (row: ReaderRow, lastLoginAt: string | null | undefined, now: number | string | Date = Date.now()) => {
  const time = typeof now === 'number' ? now : new Date(now).getTime();
  const anchor = Date.parse(lastLoginAt || row.createdAt);
  if (row._verified !== true) return Number.isFinite(time) && Number.isFinite(anchor) && time - anchor >= registrationLifetimeMs;
  const vipUntil = Date.parse(row.vip_until || '');
  return Number.isFinite(time) && Number.isFinite(anchor) && time - anchor >= thirtyDays &&
    (!Number.isFinite(vipUntil) || vipUntil <= time);
};

export function createReaderRetention({ payload, directory, uidStore, loginLedger, workflow, mediaRetention, keepReader }: RetentionOptions) {
  if (!payload || !directory || !uidStore || !loginLedger) throw Error('Reader retention requires the private reader store and login ledger.');
  const audit = readerAudit(directory, 'system');
  let initial: NodeJS.Timeout | null = null, interval: NodeJS.Timeout | null = null;
  let pendingInitial: NodeJS.Timeout | null = null, pendingInterval: NodeJS.Timeout | null = null;
  let activeRun: Promise<void> | null = null, pendingRun: Promise<void> | null = null;
  const sweepPending = async (at = new Date(), limit = 1000) => {
    const result = { requests: 0, legacy: 0 };
    if (!workflow) return result;
    result.requests = workflow.cleanupRegistrations(at.getTime(), limit).filter(row => row.deleted).length;
    if (payload.find) {
      const legacy = await payload.find({ collection: 'readers', depth: 0, limit,
        where: { and: [{ _verified: { equals: false } }, { createdAt: { less_than_equal: new Date(at.getTime() - registrationLifetimeMs).toISOString() } }] } });
      for (const row of legacy.docs) {
        await removeReaderAccount({ payload, directory, uidStore, row, audit, action: 'auto-delete-unverified', workflow });
        result.legacy++;
      }
    }
    return result;
  };
  const sweep = async ({ now = new Date(), limit = 1000, dryRun = false }: { now?: Date | string | number; limit?: number; dryRun?: boolean } = {}) => {
    const at = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(at.getTime())) throw Error('Invalid cleanup time');
    const cutoff = new Date(at.getTime() - thirtyDays).toISOString();
    const results = { checked: 0, eligible: 0, deleted: 0, kept: 0 };
    const candidates = [];
    while (candidates.length < limit) {
      const size = Math.min(100, limit - candidates.length);
      const ids = loginLedger.inactiveReaderIds(cutoff, at.toISOString(), size, candidates.length);
      candidates.push(...ids);
      if (ids.length < size) break;
    }
    for (const id of candidates) {
      results.checked++;
      const row = await payload.findByID({ collection: 'readers', id });
      if (!row || !readerCleanupDue(row, loginLedger.latest('reader', id)?.at, at)) continue;
      if (keepReader?.(id)) { results.kept++; continue; }
      results.eligible++;
      if (dryRun) continue;
      await removeReaderAccount({ payload, directory, uidStore, row, audit, action: 'auto-delete-inactive', workflow });
      results.deleted++;
    }
    if (workflow && !dryRun) await sweepPending(at, limit);
    return results;
  };
  const run = () => {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      try {
        const result = await sweep();
        if (result.deleted) process.stdout.write(JSON.stringify({ event: 'reader-retention', ...result, at: new Date().toISOString() }) + '\n');
      } catch (error) {
        process.stderr.write(JSON.stringify({ event: 'reader-retention-error', message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }) + '\n');
      } finally { activeRun = null; }
    })();
    return activeRun;
  };
  const runPending = () => {
    if (pendingRun) return pendingRun;
    pendingRun = (async () => {
      try {
        if (workflow) {
          await sweepPending();
          await cleanReaderFiles({ workflow, payload, directory });
        }
        if (mediaRetention) await mediaRetention.sweep();
      } catch (error) {
        process.stderr.write(JSON.stringify({ event: 'site-cleanup-error', message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }) + '\n');
      } finally { pendingRun = null; }
    })();
    return pendingRun;
  };
  return {
    sweep,
    sweepPending,
    start() {
      if (initial || interval) return;
      initial = setTimeout(run, 15 * 60 * 1000);
      interval = setInterval(run, 6 * 60 * 60 * 1000);
      initial.unref(); interval.unref();
      if (workflow || mediaRetention) {
        pendingInitial = setTimeout(runPending, 1000);
        pendingInterval = setInterval(runPending, 60 * 1000);
        pendingInitial.unref(); pendingInterval.unref();
      }
    },
    async close() { if (initial) clearTimeout(initial); if (interval) clearInterval(interval); if (pendingInitial) clearTimeout(pendingInitial); if (pendingInterval) clearInterval(pendingInterval); initial = interval = pendingInitial = pendingInterval = null; await Promise.all([activeRun, pendingRun]); },
  };
}
