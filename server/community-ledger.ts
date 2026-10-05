import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { communityRules, beijingDay } from '../src/community-rules.mjs';
import { fail, countOf, totalOf, day } from './community-db.ts';
import type { CommunityAuthor, Target } from './community-db.ts';

type LedgerRef = { kind: string; id: string } | null;
type LedgerRow = { id: string; amount: number; kind: string; reason: string; ref_kind: string | null; ref_id: string | null; created_at: string; reverted_at: string | null };
export type LedgerKind = 'earn' | 'spend' | 'in' | 'out' | 'penalty' | 'revert';

// 星尘流水：只追加；余额是流水之和，冲正是另一条反向记录，余额最低到 0。
// These helpers never open a transaction themselves: callers wrap them.
export function createLedger(db: DatabaseSync) {
  const rules = communityRules;
  const insert = db.prepare(`INSERT INTO community_ledger (id, member_kind, member_id, amount, kind, reason, ref_kind, ref_id, day, capped, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const balanceOf = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM community_ledger WHERE member_kind = ? AND member_id = ?');
  const cappedToday = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM community_ledger WHERE member_kind = ? AND member_id = ? AND day = ? AND capped = 1 AND kind = 'earn'`);
  const gainedOn = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM community_ledger WHERE member_kind = ? AND member_id = ? AND day = ? AND amount > 0`);
  const growthPoints = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM community_ledger
    WHERE member_kind = ? AND member_id = ? AND amount > 0 AND kind = 'earn' AND capped = 1 AND reverted_at IS NULL`);
  const reasonsOn = db.prepare(`SELECT COUNT(*) AS count FROM community_ledger WHERE member_kind = ? AND member_id = ? AND day = ? AND reason = ?`);
  const refExists = db.prepare(`SELECT COUNT(*) AS count FROM community_ledger WHERE member_kind = ? AND member_id = ? AND reason = ? AND ref_kind = ? AND ref_id = ?`);
  const featuredInMonth = db.prepare(`SELECT COUNT(*) AS count FROM community_ledger
    WHERE member_kind = ? AND member_id = ? AND day LIKE ? AND kind = 'earn' AND reason = 'featured' AND amount > 0`);
  const earnedFor = db.prepare(`SELECT id, member_kind, member_id, amount FROM community_ledger WHERE ref_kind = ? AND ref_id = ? AND kind = 'earn' AND reverted_at IS NULL`);
  const markReverted = db.prepare('UPDATE community_ledger SET reverted_at = ? WHERE id = ?');
  const history = db.prepare(`SELECT id, amount, kind, reason, ref_kind, ref_id, created_at, reverted_at FROM community_ledger
    WHERE member_kind = $kind AND member_id = $id AND ($flow = 'all' OR ($flow = 'in' AND amount > 0) OR ($flow = 'out' AND amount < 0))
    ORDER BY created_at DESC, rowid DESC LIMIT $limit`);
  const monthFlow = db.prepare(`SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS gained, COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END), 0) AS spent
    FROM community_ledger WHERE member_kind = ? AND member_id = ? AND day LIKE ?`);
  // System issuance against what was spent, burned or taken back (the owner's data tab).
  const flowByDay = db.prepare(`SELECT day, COALESCE(SUM(CASE WHEN amount > 0 AND kind = 'earn' THEN amount END), 0) AS issued,
    COALESCE(SUM(CASE WHEN amount < 0 AND kind IN ('spend', 'penalty', 'revert') THEN -amount END), 0) AS recovered
    FROM community_ledger WHERE day >= ? GROUP BY day`);

  const balance = (member: CommunityAuthor) => totalOf(balanceOf, member.kind, member.id);
  function entry(member: CommunityAuthor, amount: number, kind: LedgerKind, reason: string, ref: LedgerRef, now: string, capped = false) {
    insert.run(randomUUID(), member.kind, member.id, amount, kind, reason, ref?.kind ?? null, ref?.id ?? null, beijingDay(Date.parse(now)), capped ? 1 : 0, now);
  }
  return {
    balance,
    // Uncapped income: check-ins, 精华, transfers, bounties and refunds.
    credit(member: CommunityAuthor, amount: number, reason: string, ref: LedgerRef, now: string, kind: LedgerKind = 'earn') {
      if (amount > 0) entry(member, amount, kind, reason, ref, now);
      return Math.max(0, amount);
    },
    // Spending: refuses when the balance is short.
    debit(member: CommunityAuthor, amount: number, reason: string, ref: LedgerRef, now: string, kind: LedgerKind = 'spend') {
      if (amount <= 0) return 0;
      const have = balance(member);
      if (have < amount) throw fail(`星尘不足：需要 ${amount}，你现在有 ${have}。`, 402);
      entry(member, -amount, kind, reason, ref, now);
      return amount;
    },
    // Topic, reply and accepted-answer rewards share the daily cap. A historical
    // reference and its quota remain consumed after reversal or on another day.
    reward(member: CommunityAuthor, amount: number, reason: string, ref: LedgerRef, now: string, perDay: number) {
      if (amount <= 0 || perDay <= 0 || (ref && countOf(refExists, member.kind, member.id, reason, ref.kind, ref.id))) return 0;
      const today = beijingDay(Date.parse(now));
      if (countOf(reasonsOn, member.kind, member.id, today, reason) >= perDay) return 0;
      const room = rules.dailyCap - totalOf(cappedToday, member.kind, member.id, today);
      const granted = Math.max(0, Math.min(amount, room));
      if (granted) entry(member, granted, 'earn', reason, ref, now, true);
      return granted;
    },
    rewardedFor(member: CommunityAuthor, reason: string, ref: { kind: string; id: string }) {
      return countOf(refExists, member.kind, member.id, reason, ref.kind, ref.id) > 0;
    },
    // First-feature awards do not consume the daily quota. Cancelled awards still
    // consume their original monthly slot and content can never receive a second one.
    feature(member: CommunityAuthor, ref: { kind: string; id: string }, now: string) {
      if (countOf(refExists, member.kind, member.id, 'featured', ref.kind, ref.id)) return 0;
      const month = beijingDay(Date.parse(now)).slice(0, 7);
      if (countOf(featuredInMonth, member.kind, member.id, `${month}-%`) >= rules.featureMonthly) return 0;
      entry(member, rules.featureReward, 'earn', 'featured', ref, now);
      return rules.featureReward;
    },
    // Takes back what a piece of content earned; a balance never goes below zero.
    revert(ref: Target | { kind: string; id: string }, now: string) {
      let taken = 0;
      for (const row of earnedFor.all(ref.kind, ref.id) as Array<{ id: string; member_kind: CommunityAuthor['kind']; member_id: string; amount: number }>) {
        const member = { kind: row.member_kind, id: row.member_id };
        const amount = Math.min(row.amount, balance(member));
        markReverted.run(now, row.id);
        if (amount > 0) { entry(member, -amount, 'revert', 'revert', ref, now); taken += amount; }
      }
      return taken;
    },
    penalise(member: CommunityAuthor, ref: LedgerRef, now: string, amount: number = rules.penalty) {
      const taken = Math.min(amount, balance(member));
      if (taken > 0) entry(member, -taken, 'penalty', 'penalty', ref, now);
      return taken;
    },
    history(member: CommunityAuthor, { flow = 'all', limit = 50 }: { flow?: 'all' | 'in' | 'out'; limit?: number } = {}) {
      return (history.all({ kind: member.kind, id: member.id, flow, limit }) as LedgerRow[]).map(row => ({
        id: row.id, amount: row.amount, kind: row.kind, reason: row.reason, createdAt: row.created_at, reverted: Boolean(row.reverted_at),
        ref: row.ref_kind && row.ref_id ? { kind: row.ref_kind, id: row.ref_id } : null,
      }));
    },
    month(member: CommunityAuthor, now = Date.now()) {
      const row = monthFlow.get(member.kind, member.id, `${beijingDay(now).slice(0, 7)}-%`) as { gained: number; spent: number };
      return { gained: Number(row.gained), spent: Number(row.spent) };
    },
    gainedToday: (member: CommunityAuthor, now = Date.now()) => totalOf(gainedOn, member.kind, member.id, beijingDay(now)),
    // Accumulated valid behaviour awards, independent of balance and spending.
    growthPoints: (member: CommunityAuthor) => totalOf(growthPoints, member.kind, member.id),
    behaviourToday: (member: CommunityAuthor, now = Date.now()) => totalOf(cappedToday, member.kind, member.id, beijingDay(now)),
    flow(days = 7, now = Date.now()) {
      const from = beijingDay(now - (days - 1) * day);
      const rows = new Map((flowByDay.all(from) as Array<{ day: string; issued: number; recovered: number }>).map(row => [row.day, row]));
      return Array.from({ length: days }, (_, i) => {
        const key = beijingDay(now - (days - 1 - i) * day);
        const row = rows.get(key);
        return { day: key, issued: Number(row?.issued ?? 0), recovered: Number(row?.recovered ?? 0) };
      });
    },
  };
}
export type Ledger = ReturnType<typeof createLedger>;
