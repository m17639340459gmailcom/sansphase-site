import type { DatabaseSync } from 'node:sqlite';
import { fail, countOf, day } from './community-db.ts';
import type { CommunityAuthor, Transaction } from './community-db.ts';

// Existing per-account thresholds; earned trust only scales the daily windows.
const limits = {
  topic: [[3, 10 * 60_000], [20, day]],
  reply: [[20, 10 * 60_000], [200, day]],
  image: [[30, 10 * 60_000], [100, day]],
  report: [[10, 10 * 60_000], [30, day]],
  action: [[120, 60_000], [3000, day]],
} as const;
export type CommunityActionKind = keyof typeof limits;

// The database, rather than a process-local Map, counts the actual account across
// restarts and connections. Expired events carry no continuing restriction.
export function createCommunityRateLimits(db: DatabaseSync, tx: Transaction) {
  const prune = db.prepare('DELETE FROM community_rate_events WHERE created_at <= ?');
  const count = db.prepare(`SELECT COUNT(*) AS count FROM community_rate_events
    WHERE member_kind=? AND member_id=? AND action=? AND created_at > ?`);
  const insert = db.prepare('INSERT INTO community_rate_events(member_kind,member_id,action,created_at) VALUES(?,?,?,?)');
  return {
    consume(member: CommunityAuthor, kind: CommunityActionKind, level: number, now = Date.now()) {
      return tx(() => {
        prune.run(now - day);
        for (const [limit, window] of limits[kind]) {
          const allowed = window >= day && level >= 2 ? Math.floor(limit * 1.5) : limit;
          if (countOf(count, member.kind, member.id, kind, now - window) >= allowed)
            throw fail('操作太频繁了，请稍后再试。', 429);
        }
        insert.run(member.kind, member.id, kind, now);
      });
    },
  };
}
