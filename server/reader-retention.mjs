import { readerAudit, removeReaderAccount } from './reader-account-removal.mjs';
import { registrationLifetimeMs } from './reader-workflow.ts';
import { cleanReaderFiles } from './reader-file-cleanup.mjs';

const thirtyDays = 30 * 24 * 60 * 60 * 1000;
export const readerCleanupDue = (row, lastLoginAt, now = Date.now()) => {
  const time = typeof now === 'number' ? now : new Date(now).getTime();
  const anchor = Date.parse(lastLoginAt || row.createdAt);
  if (row._verified !== true) return Number.isFinite(time) && Number.isFinite(anchor) && time - anchor >= registrationLifetimeMs;
  const vipUntil = Date.parse(row.vip_until || '');
  return Number.isFinite(time) && Number.isFinite(anchor) && time - anchor >= thirtyDays &&
    (!Number.isFinite(vipUntil) || vipUntil <= time);
};

export function createReaderRetention({ payload, directory, uidStore, loginLedger, workflow, mediaRetention }) {
  if (!payload || !directory || !uidStore || !loginLedger) throw Error('Reader retention requires the private reader store and login ledger.');
  const audit = readerAudit(directory, 'system');
  let initial, interval, pendingInitial, pendingInterval, activeRun = null, pendingRun = null;
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
  const sweep = async ({ now = new Date(), limit = 1000, dryRun = false } = {}) => {
    const at = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(at.getTime())) throw Error('Invalid cleanup time');
    const cutoff = new Date(at.getTime() - thirtyDays).toISOString();
    const results = { checked: 0, eligible: 0, deleted: 0 };
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
        process.stderr.write(JSON.stringify({ event: 'reader-retention-error', message: error.message, at: new Date().toISOString() }) + '\n');
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
        process.stderr.write(JSON.stringify({ event: 'site-cleanup-error', message: error.message, at: new Date().toISOString() }) + '\n');
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
    async close() { clearTimeout(initial); clearInterval(interval); clearTimeout(pendingInitial); clearInterval(pendingInterval); initial = interval = pendingInitial = pendingInterval = null; await Promise.all([activeRun, pendingRun]); },
  };
}
