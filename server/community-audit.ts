import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CommunityAuthor, Transaction } from './community-db.ts';

export type CommunityAuditEvent = {
  id: string; actor: CommunityAuthor; action: string; details: Record<string, unknown>; createdAt: string;
};
type AuditRow = { id: string; actor_kind: CommunityAuthor['kind']; actor_id: string; action: string; details: string; created_at: string };
export type CommunityAuditDetails<T> = Record<string, unknown> | ((result: T) => Record<string, unknown>);
type Mirror = (event: CommunityAuditEvent) => Promise<void>;

/** The private database is the durable audit; the JSONL file is its retryable mirror. */
export function createCommunityAudit(db: DatabaseSync, tx: Transaction) {
  const insert = db.prepare(`INSERT INTO community_audit_events(id,actor_kind,actor_id,action,details,created_at)
    VALUES(?,?,?,?,?,?)`);
  const pending = db.prepare(`SELECT id,actor_kind,actor_id,action,details,created_at FROM community_audit_events
    WHERE mirrored_at IS NULL ORDER BY rowid LIMIT 100`);
  const mirrored = db.prepare('UPDATE community_audit_events SET mirrored_at=? WHERE id=? AND mirrored_at IS NULL');
  let flushing: Promise<void> | null = null;
  return {
    run<T>(actor: CommunityAuthor, action: string, execute: () => T, details: CommunityAuditDetails<T> = {}): T {
      return tx(() => {
        const result = execute();
        if (result && typeof result === 'object' && 'then' in result) throw Error('Community audit operations must be synchronous.');
        const values = typeof details === 'function' ? details(result) : details;
        if (!values || typeof values !== 'object' || Array.isArray(values)) throw Error('Community audit details must be an object.');
        insert.run(randomUUID(), actor.kind, actor.id, action, JSON.stringify(values), new Date().toISOString());
        return result;
      });
    },
    async flush(mirror?: Mirror): Promise<void> {
      if (!mirror) return;
      if (flushing) return flushing;
      const task = Promise.resolve().then(async () => {
        for (const row of pending.all() as AuditRow[]) {
          try {
            await mirror({ id: row.id, actor: { kind: row.actor_kind, id: row.actor_id }, action: row.action,
              details: JSON.parse(row.details) as Record<string, unknown>, createdAt: row.created_at });
            mirrored.run(new Date().toISOString(), row.id);
          } catch (error) {
            // Never log the action payload, account, address or private filename.
            // The committed row remains pending for the next mirror attempt.
            const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
              && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'AUDIT_MIRROR_FAILED';
            process.stderr.write(JSON.stringify({ event: 'community-audit-mirror-failed', auditEventId: row.id, code, at: new Date().toISOString() }) + '\n');
            break;
          }
        }
      }).catch(() => {
        // A closed/unavailable database does not reverse already committed work.
        process.stderr.write(JSON.stringify({ event: 'community-audit-mirror-failed', code: 'AUDIT_QUEUE_UNAVAILABLE', at: new Date().toISOString() }) + '\n');
      }).finally(() => { if (flushing === task) flushing = null; });
      flushing = task;
      await task;
    },
  };
}
