import { appendFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { uuidPattern } from './content-service.ts';
import { cleanReaderFiles } from './reader-file-cleanup.ts';
import type { createReaderWorkflow } from './reader-workflow.ts';
import type { CleanupPayload } from './reader-file-cleanup.ts';

type ReaderAccount = { id: string; avatar?: string | null };
type Audit = (action: string, readerId: string, details?: Record<string, unknown>) => Promise<void>;
type RemovalOptions = { payload: CleanupPayload & { delete: (options: { collection: string; id: string }) => Promise<unknown> }; directory: string; uidStore: { get: (id: string) => string | null }; row: ReaderAccount; audit: Audit; action: string; workflow?: ReturnType<typeof createReaderWorkflow> };
export const readerAudit = (directory: string, actorId: string): Audit => async (action, readerId, details = {}) => {
  const entry = { at: new Date().toISOString(), actorId, action, readerId, ...details };
  await appendFile(resolve(directory, 'reader-admin-audit.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
};

export async function removeReaderAccount({ payload, directory, uidStore, row, audit, action, workflow }: RemovalOptions) {
  const uid = uidStore.get(row.id);
  await audit(`request-${action}`, row.id, { uid });
  await payload.delete({ collection: 'readers', id: row.id });
  // Keep the UID reservation and login events as an audit trail. Neither can
  // authenticate a removed account, and a later user must not inherit its UID.
  const followUp: Promise<unknown>[] = [audit(action, row.id, { uid })];
  if (workflow) {
    for (const pending of workflow.removeProfilesFor(row.id)) if (pending.kind === 'avatar' && uuidPattern.test(pending.proposed_value))
      workflow.queueFile(`pending-reader-avatar-${pending.proposed_value}.webp`, 'reader-deleted');
    if (uuidPattern.test(row.avatar || '')) workflow.queueFile(`reader-avatar-${row.avatar}.webp`, 'reader-deleted');
    followUp.push(cleanReaderFiles({ workflow, payload, directory }));
  } else if (uuidPattern.test(row.avatar || '')) {
    followUp.push(unlink(resolve(directory, 'uploads', `reader-avatar-${row.avatar}.webp`)).catch((error: unknown) => {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
    }));
  }
  const outcomes = await Promise.allSettled(followUp);
  for (const result of outcomes) {
    if (result.status === 'rejected') process.stderr.write(JSON.stringify({ event: 'reader-delete-followup-error', action, message: result.reason instanceof Error ? result.reason.message : 'unknown' }) + '\n');
  }
  return { id: row.id, uid, deleted: true };
}
