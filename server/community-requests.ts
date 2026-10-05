import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { fail } from './community-db.ts';
import type { CommunityAuthor, Transaction } from './community-db.ts';

type CompletedRequest = { fingerprint: string; result: string };

// Canonical JSON hashes field values rather than browser property insertion order.
// Only the hash is persisted: posts, prompts and recipient details are not copied.
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw fail('请求内容层级过深，请简化后重试。');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key], depth + 1)}`).join(',')}}`;
  }
  throw fail('请求内容无效。');
}

// The caller checks the current identity and permissions before replaying, and
// resolves asynchronous lookups before entering this synchronous transaction.
// Successful results and their business mutations commit together; errors leave
// no key behind. Records stay durable, so an old key cannot become a new charge.
export function createCommunityRequests(db: DatabaseSync, tx: Transaction) {
  const completed = db.prepare(`SELECT fingerprint,result FROM community_requests
    WHERE member_kind=? AND member_id=? AND operation=? AND request_key=?`);
  const insert = db.prepare(`INSERT INTO community_requests(member_kind,member_id,operation,request_key,fingerprint,result,created_at)
    VALUES(?,?,?,?,?,?,?)`);
  return {
    run<T>(member: CommunityAuthor, operation: string, key: string | string[] | undefined, payload: unknown, execute: () => T, before?: () => void): T {
      if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)))
        throw fail('请求标识无效，请重新操作。');
      const fingerprint = key === undefined ? null : createHash('sha256').update(canonical(payload)).digest('hex');
      const outcome = tx((): { value: T } | { error: unknown } => {
        if (key !== undefined) {
          const previous = completed.get(member.kind, member.id, operation, key) as CompletedRequest | undefined;
          if (previous) {
            if (previous.fingerprint !== fingerprint) throw fail('同一个请求标识不能用于不同内容，请重新操作。', 409);
            return { value: JSON.parse(previous.result) as T };
          }
        }
        // Reserve the account's action quota before the business savepoint.
        // A failed debit/creation still counts as an attempt, while a completed
        // replay never consumes quota. Only the failed business writes roll back.
        before?.();
        db.exec('SAVEPOINT community_request_operation');
        try {
          const result = execute();
          if (result && typeof result === 'object' && 'then' in result) throw Error('Community request operations must be synchronous.');
          if (key !== undefined) {
            const serialized = JSON.stringify(result);
            if (serialized === undefined) throw Error('Community request result cannot be persisted.');
            insert.run(member.kind, member.id, operation, key, fingerprint, serialized, new Date().toISOString());
          }
          db.exec('RELEASE community_request_operation');
          return { value: result };
        } catch (error) {
          db.exec('ROLLBACK TO community_request_operation');
          db.exec('RELEASE community_request_operation');
          return { error };
        }
      });
      if ('error' in outcome) throw outcome.error;
      return outcome.value;
    },
  };
}
