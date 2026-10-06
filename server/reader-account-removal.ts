import { appendFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { uuidPattern } from './content-service.ts';
import { cleanReaderFiles } from './reader-file-cleanup.ts';
import type { createReaderWorkflow } from './reader-workflow.ts';
import type { CleanupPayload } from './reader-file-cleanup.ts';
import type { Payload } from 'payload';
import { readerCleanupDue } from './reader-retention-policy.ts';

type ReaderAccount = { id: string; avatar?: string | null };
type Audit = (action: string, readerId: string, details?: Record<string, unknown>) => Promise<void>;
type CleanupReaderPayload = CleanupPayload & {
  findByID?: (options: { collection: string; id: string }) => Promise<unknown>;
  config?: Pick<Payload['config'], 'collections'>;
};
export type PurgeCommunity = (readerId: string) => unknown | Promise<unknown>;
type CleanupCondition = { now: number; unverifiedOnly?: boolean };
type RemovalOptions = { payload: CleanupReaderPayload & { delete: (options: { collection: string; id: string }) => Promise<unknown> }; directory: string; uidStore: { get: (id: string) => string | null }; row: ReaderAccount; audit: Audit; action: string; workflow?: ReturnType<typeof createReaderWorkflow>; purgeCommunity?: PurgeCommunity; cleanupCondition?: CleanupCondition };
type FollowUpOptions = { payload: CleanupReaderPayload; directory: string; workflow: ReturnType<typeof createReaderWorkflow>; purgeCommunity?: PurgeCommunity };
async function readerStillExists(payload: CleanupReaderPayload, id: string) {
  if (!payload.findByID) throw Error('Reader lookup is required for durable account cleanup.');
  try { return Boolean(await payload.findByID({ collection: 'readers', id })); }
  catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 404) return false;
    throw error;
  }
}
async function finishReaderCleanup({ payload, directory, workflow, purgeCommunity }: FollowUpOptions, row: { reader_id: string; avatar: string | null }) {
  if (await readerStillExists(payload, row.reader_id)) return false;
  await purgeCommunity?.(row.reader_id);
  workflow.removeProfilesFor(row.reader_id);
  if (uuidPattern.test(row.avatar || '')) workflow.queueFile(`reader-avatar-${row.avatar}.webp`, 'reader-deleted');
  workflow.accountCleaned(row.reader_id);
  await cleanReaderFiles({ workflow, payload, directory });
  return true;
}

export async function resumeReaderCleanup(options: FollowUpOptions) {
  const result = { cleaned: 0, failed: 0, protected: 0 };
  for (const row of options.workflow.cleanupAccounts()) {
    try {
      if (await finishReaderCleanup(options, row)) result.cleaned++;
      else result.protected++;
    } catch (error) { options.workflow.accountFailed(row.reader_id, error instanceof Error ? error.message : 'cleanup failed'); result.failed++; }
  }
  return result;
}
export const readerAudit = (directory: string, actorId: string): Audit => async (action, readerId, details = {}) => {
  const entry = { at: new Date().toISOString(), actorId, action, readerId, ...details };
  await appendFile(resolve(directory, 'reader-admin-audit.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
};

function assertAutomaticCleanupSchema(db: DatabaseSync, payload: CleanupReaderPayload) {
  const collection = payload.config?.collections.find(item => item.slug === 'readers');
  if (payload.config && (!collection || collection.upload || collection.versions || collection.trash ||
    collection.hooks.beforeDelete.length || collection.hooks.afterDelete.length ||
    collection.hooks.beforeOperation.length || collection.hooks.afterOperation.length)) {
    throw Error('Reader cleanup cannot bypass an unsupported Payload collection configuration.');
  }
  const requiredColumns: Record<string, string[]> = {
    readers: ['id', 'created_at', '_verified', 'vip_until', 'avatar'],
    login_events: ['actor_type', 'actor_id', 'happened_at'],
    readers_sessions: ['_parent_id'],
    payload_locked_documents_rels: ['readers_id'],
    payload_preferences_rels: ['readers_id', 'parent_id', 'path'],
    payload_preferences: ['id', 'key'],
  };
  for (const [table, names] of Object.entries(requiredColumns)) {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
    if (names.some(name => !columns.some(column => column.name === name))) throw Error(`Unsupported reader cleanup schema: ${table}`);
  }
  const requiredRelations = new Map([
    ['readers_sessions', '_parent_id'], ['payload_locked_documents_rels', 'readers_id'], ['payload_preferences_rels', 'readers_id'],
  ]);
  for (const table of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    if (typeof table.name !== 'string') throw Error('Invalid reader cleanup schema.');
    const quoted = table.name.replaceAll('"', '""');
    for (const foreignKey of db.prepare(`PRAGMA foreign_key_list("${quoted}")`).all()) {
      if (foreignKey.table !== 'readers') continue;
      if (requiredRelations.get(table.name) !== foreignKey.from || foreignKey.to !== 'id' || foreignKey.on_delete !== 'CASCADE') {
        throw Error(`Unsupported reader cleanup reference: ${table.name}`);
      }
      requiredRelations.delete(table.name);
    }
  }
  if (requiredRelations.size) throw Error('Reader cleanup requires verified cascading account references.');
}

function deleteAutomaticReader({ payload, directory, row, workflow, cleanupCondition }: RemovalOptions & { cleanupCondition: CleanupCondition }) {
  const file = resolve(directory, 'content.db');
  if (!existsSync(file)) throw Error('Reader cleanup database is missing.');
  const db = new DatabaseSync(file);
  let transaction = false;
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    transaction = true;
    assertAutomaticCleanupSchema(db, payload);
    const current = db.prepare('SELECT created_at,_verified,vip_until,avatar FROM readers WHERE id=?').get(row.id);
    const login = db.prepare("SELECT happened_at FROM login_events WHERE actor_type='reader' AND actor_id=? ORDER BY happened_at DESC LIMIT 1").get(row.id);
    if (!current || (cleanupCondition.unverifiedOnly && current._verified === 1) || !readerCleanupDue({
      createdAt: String(current.created_at), _verified: current._verified === 1,
      vip_until: typeof current.vip_until === 'string' ? current.vip_until : null,
    }, cleanupCondition.unverifiedOnly ? null : typeof login?.happened_at === 'string' ? login.happened_at : null, cleanupCondition.now)) {
      db.exec('ROLLBACK'); transaction = false;
      return { deleted: false, avatar: row.avatar || null };
    }
    const avatar = typeof current.avatar === 'string' ? current.avatar : null;
    // Persist the final approved avatar before committing account removal. This
    // uses a separate workflow database synchronously; no await or account DB
    // writer runs between the final eligibility read and DELETE. On rollback,
    // the existing file queue protects an avatar still referenced by an account.
    if (workflow && uuidPattern.test(avatar || '')) workflow.queueFile(`reader-avatar-${avatar}.webp`, 'reader-deleted');
    // Match Payload's deletion of this auth user's preferences. Relation rows
    // and auth sessions then cascade through the verified foreign keys.
    db.prepare(`DELETE FROM payload_preferences WHERE key=? OR id IN
      (SELECT parent_id FROM payload_preferences_rels WHERE readers_id=? AND path='user')`).run(`collection-readers-${row.id}`, row.id);
    const removed = db.prepare('DELETE FROM readers WHERE id=?').run(row.id);
    if (removed.changes !== 1) throw Error('Reader cleanup did not delete exactly one account.');
    db.exec('COMMIT'); transaction = false;
    return { deleted: true, avatar };
  } catch (error) {
    if (transaction) db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }
}

export async function removeReaderAccount(options: RemovalOptions) {
  const { payload, directory, uidStore, row, audit, action, workflow, purgeCommunity, cleanupCondition } = options;
  const uid = uidStore.get(row.id);
  await audit(`request-${action}`, row.id, { uid });
  // This durable job uses reader-workflow.db, outside the account transaction.
  // A protected or rolled-back account removes the job; an uncertain committed
  // deletion retains it for retry without holding an account writer lock.
  workflow?.queueAccount(row.id, row.avatar || null, action);
  let finalAvatar = row.avatar || null;
  try {
    if (cleanupCondition) {
      // Keep implicit Payload transactions disabled: enabling native libsql
      // transactions crashes Windows Node 24.21 integration/batch regressions.
      // Only automatic retention uses the existing node:sqlite synchronous
      // writer transaction, with a supported collection/schema checked above.
      const result = deleteAutomaticReader({ ...options, cleanupCondition });
      if (!result.deleted) {
        workflow?.accountCleaned(row.id);
        return { id: row.id, uid, deleted: false };
      }
      finalAvatar = result.avatar;
    } else await payload.delete({ collection: 'readers', id: row.id });
  }
  catch (error) {
    // A failed delete must not remove content. An uncertain response after an
    // actual deletion retains its job for the next background sweep.
    if (workflow && await readerStillExists(payload, row.id)) workflow.accountCleaned(row.id);
    throw error;
  }
  // Keep the UID reservation and login events as an audit trail. Neither can
  // authenticate a removed account, and a later user must not inherit its UID.
  const followUp: Promise<unknown>[] = [audit(action, row.id, { uid })];
  if (workflow) {
    followUp.push(finishReaderCleanup({ payload, directory, workflow, purgeCommunity }, { reader_id: row.id, avatar: row.avatar || null }));
  } else for (const avatar of new Set([row.avatar, finalAvatar])) if (uuidPattern.test(avatar || '')) {
    followUp.push(unlink(resolve(directory, 'uploads', `reader-avatar-${avatar}.webp`)).catch((error: unknown) => {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
    }));
  }
  const outcomes = await Promise.allSettled(followUp);
  for (const result of outcomes) {
    if (result.status === 'rejected') process.stderr.write(JSON.stringify({ event: 'reader-delete-followup-error', action, message: result.reason instanceof Error ? result.reason.message : 'unknown' }) + '\n');
  }
  return { id: row.id, uid, deleted: true };
}
