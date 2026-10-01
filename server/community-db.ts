import type { DatabaseSync, StatementSync } from 'node:sqlite';

// Shared pieces of the community store modules (content, ledger, members, economy).
export type Kind = 'reader' | 'owner';
// A community member: a reader account or the site owner.
export type CommunityAuthor = { kind: Kind; id: string };
export type Target = { kind: 'topic' | 'reply'; id: string };
export type ServiceError = Error & { status: number };

export const day = 24 * 60 * 60 * 1000;
export const fail = (message: string, status = 400): ServiceError => Object.assign(new Error(message), { status });
export const same = (a: CommunityAuthor, b: CommunityAuthor) => a.kind === b.kind && a.id === b.id;
export const memberKey = (member: CommunityAuthor) => `${member.kind}:${member.id}`;
export const iso = (ms: number) => new Date(ms).toISOString();
export const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

// One BEGIN IMMEDIATE around a whole operation; calls made inside it join it.
export function createTransaction(db: DatabaseSync) {
  let depth = 0;
  return <T>(operation: () => T): T => {
    if (depth) {
      depth++;
      try { return operation(); } finally { depth--; }
    }
    db.exec('BEGIN IMMEDIATE');
    depth = 1;
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally { depth = 0; }
  };
}
export type Transaction = ReturnType<typeof createTransaction>;

// COUNT(*) AS count / SUM(...) AS total helpers.
export const countOf = (statement: StatementSync, ...args: unknown[]) =>
  Number((statement.get(...(args as never[])) as { count?: number } | undefined)?.count ?? 0);
export const totalOf = (statement: StatementSync, ...args: unknown[]) =>
  Number((statement.get(...(args as never[])) as { total?: number } | undefined)?.total ?? 0);
