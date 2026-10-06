import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CommunityGrowthNumber, CommunityGrowthState, CommunityVIPGrowthState, CommunityExperienceCatalogueItem, CommunityVIPCatalogueItem } from '../src/community-growth.ts';
import { beijingDay } from '../src/community-rules.ts';
import { bodyImageContent } from '../src/community-body-images.ts';
import { countOf, totalOf, same, fail } from './community-db.ts';
import type { CommunityAuthor, Transaction, Target } from './community-db.ts';
import type { CommunityConvention } from './community-convention.ts';
import { membershipState } from './reader-membership.ts';

// These rules govern experience only. Stardust, trust and appointments have
// independent policies. Public catalogues are projections of these server rules.
const thresholds = [0, 1200, 3600, 7200, 13200, 21600, 31200, 43200, 56400, 72000] as const;
const vipDays = [0, 30, 90, 180, 365, 540, 730, 1095] as const;
const multipliers = [2, 3, 4, 6, 8, 11, 15, 20] as const;
const awards = { topic: 20, reply: 10, accepted: 20 } as const;
type ContentReason = keyof typeof awards;
type Source = { author_kind: CommunityAuthor['kind']; author_id: string; board: string; body: string; topic_kind?: CommunityAuthor['kind']; topic_author?: string };
type AwardRow = { id: string; member_kind: CommunityAuthor['kind']; member_id: string; amount: number; ref_kind: 'topic' | 'reply'; ref_id: string };
const tier = (value: number, boundaries: readonly number[]) => Math.max(0, boundaries.findLastIndex(threshold => value >= threshold));
const fraction = (current: number, start: number, next: number | null) => next === null ? 1 : Math.max(0, Math.min(1, (current - start) / (next - start)));
export const experienceCatalogue: readonly CommunityExperienceCatalogueItem[] = thresholds.map((threshold, index) => ({ level: (index + 1) as CommunityGrowthNumber, threshold }));
export const vipCatalogue: readonly CommunityVIPCatalogueItem[] = multipliers.map((multiplier, index) => ({ level: index + 1, multiplier }));

export function createCommunityExperience(db: DatabaseSync, tx: Transaction, convention: CommunityConvention) {
  // Production shares Payload's readers table. Store-only fixtures have no
  // account table, or just an id placeholder; HTTP still uses identify().
  const readerColumns = new Set((db.prepare('PRAGMA table_info(readers)').all() as Array<{ name: string }>).map(row => row.name));
  const currentReader = ['_verified', 'disabled', 'vip_until'].every(column => readerColumns.has(column))
    ? db.prepare('SELECT _verified,disabled,vip_until FROM readers WHERE id=?') : null;
  type ReaderState = { _verified: number; disabled: number | null; vip_until: string | null };
  const readerState = (member: CommunityAuthor) => currentReader?.get(member.id) as ReaderState | undefined;
  const eligible = (member: CommunityAuthor) => {
    if (!currentReader) return true;
    const row = readerState(member);
    return Boolean(row && row._verified === 1 && !row.disabled);
  };
  const config = db.prepare('SELECT started_at FROM community_experience_config WHERE id=1');
  const visits = db.prepare('SELECT created_at FROM community_experience_visits WHERE member_kind=? AND member_id=? AND day=?');
  const insertVisit = db.prepare('INSERT INTO community_experience_visits(member_kind,member_id,day,vip,vip_level,multiplier,convention_version,created_at) VALUES(?,?,?,?,?,?,?,?)');
  const daysOf = db.prepare('SELECT COUNT(*) AS count FROM community_vip_growth_days WHERE member_kind=? AND member_id=?');
  const insertDay = db.prepare('INSERT INTO community_vip_growth_days(member_kind,member_id,day,created_at) VALUES(?,?,?,?)');
  const pointsOf = db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM community_experience_ledger WHERE member_kind=? AND member_id=?');
  const daily = db.prepare("SELECT COUNT(*) AS count FROM community_experience_ledger WHERE member_kind=? AND member_id=? AND reason=? AND day=? AND kind='earn'");
  const refUsed = db.prepare("SELECT COUNT(*) AS count FROM community_experience_ledger WHERE member_kind=? AND member_id=? AND reason=? AND ref_kind=? AND ref_id=? AND kind='earn'");
  const insert = db.prepare('INSERT INTO community_experience_ledger(id,member_kind,member_id,amount,kind,reason,day,ref_kind,ref_id,source_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const topicSource = db.prepare("SELECT author_kind,author_id,board,body FROM community_topics WHERE id=? AND deleted_at IS NULL AND pending=0 AND hidden_at IS NULL AND board<>'vip'");
  const replySource = db.prepare(`SELECT r.author_kind,r.author_id,r.body,t.board,t.author_kind AS topic_kind,t.author_id AS topic_author
    FROM community_replies r JOIN community_topics t ON t.id=r.topic_id WHERE r.id=? AND r.deleted_at IS NULL AND r.hidden_at IS NULL
    AND t.deleted_at IS NULL AND t.pending=0 AND t.hidden_at IS NULL AND t.board<>'vip'`);
  const acceptedSource = db.prepare(`SELECT r.author_kind,r.author_id,r.body,t.board,t.author_kind AS topic_kind,t.author_id AS topic_author
    FROM community_replies r JOIN community_topics t ON t.id=r.topic_id WHERE r.id=? AND t.accepted_reply_id=r.id
    AND r.deleted_at IS NULL AND r.hidden_at IS NULL AND t.deleted_at IS NULL AND t.pending=0 AND t.hidden_at IS NULL AND t.board='qa'`);
  const validAwards = db.prepare(`SELECT a.id,a.member_kind,a.member_id,a.amount,a.ref_kind,a.ref_id FROM community_experience_ledger a
    WHERE a.kind='earn' AND NOT EXISTS(SELECT 1 FROM community_experience_ledger r WHERE r.source_id=a.id)
    AND ((a.ref_kind=? AND a.ref_id=?) OR (?='topic' AND a.ref_kind='reply' AND a.ref_id IN(SELECT id FROM community_replies WHERE topic_id=?)))`);
  const startedAt = () => (config.get() as { started_at: string } | undefined)?.started_at;
  const enabledAt = (now: string) => {
    const started = startedAt();
    return Boolean(started && Number.isFinite(Date.parse(now)) && Date.parse(now) >= Date.parse(started));
  };
  const state = (member: CommunityAuthor): CommunityGrowthState | null => {
    if (member.kind === 'owner') return null;
    const points = Math.max(0, totalOf(pointsOf, member.kind, member.id));
    const index = tier(points, thresholds), nextThreshold = thresholds[index + 1] ?? null;
    return { level: (index + 1) as CommunityGrowthNumber, points, configured: Boolean(startedAt()), startThreshold: thresholds[index],
      nextLevel: nextThreshold === null ? null : (index + 2) as CommunityGrowthNumber, nextThreshold,
      remaining: nextThreshold === null ? 0 : Math.max(0, nextThreshold - points), progress: fraction(points, thresholds[index], nextThreshold) };
  };
  const vipState = (member: CommunityAuthor, active: boolean): CommunityVIPGrowthState | null => {
    if (member.kind === 'owner') return null;
    const days = countOf(daysOf, member.kind, member.id), index = tier(days, vipDays), nextDays = vipDays[index + 1] ?? null;
    return { active, level: active ? index + 1 : null, days, nextDays, remaining: nextDays === null ? 0 : nextDays - days,
      multiplier: active ? multipliers[index] : 1, progress: fraction(days, vipDays[index], nextDays) };
  };
  const addAward = (member: CommunityAuthor, amount: number, reason: 'login' | ContentReason, ref: { kind: 'day' | 'topic' | 'reply'; id: string }, now: string) => {
    insert.run(randomUUID(), member.kind, member.id, amount, 'earn', reason, beijingDay(Date.parse(now)), ref.kind, ref.id, null, now);
  };
  return {
    state, vipState,
    visit(member: CommunityAuthor, { vip, now = new Date().toISOString() }: { vip: boolean; now?: string }) {
      return tx(() => {
        if (member.kind === 'owner') return { awarded: 0, visited: false, growth: null, vipGrowth: null };
        if (!eligible(member)) throw fail('请使用有效账号重新登录后进入社区。', 401);
        if (currentReader) vip = membershipState(readerState(member), new Date(now)).vip;
        convention.assertAgreed(member);
        if (!enabledAt(now)) return { awarded: 0, visited: false, growth: state(member), vipGrowth: vipState(member, vip) };
        const day = beijingDay(Date.parse(now));
        if (visits.get(member.kind, member.id, day)) return { awarded: 0, visited: false, growth: state(member), vipGrowth: vipState(member, vip) };
        if (vip) insertDay.run(member.kind, member.id, day, now);
        const membership = vipState(member, vip)!;
        const awarded = 10 * membership.multiplier;
        insertVisit.run(member.kind, member.id, day, vip ? 1 : 0, membership.level, membership.multiplier, convention.current().version, now);
        addAward(member, awarded, 'login', { kind: 'day', id: day }, now);
        return { awarded, visited: true, growth: state(member), vipGrowth: membership };
      });
    },
    // Hooks run inside the content event transaction. No skipped event is banked
    // for a later visit, and no quota/ref is restored when experience is reversed.
    reward(member: CommunityAuthor, reason: ContentReason, ref: Target, now: string) {
      return tx(() => {
        if (member.kind !== 'reader' || !enabledAt(now) || !eligible(member)) return 0;
        const visit = visits.get(member.kind, member.id, beijingDay(Date.parse(now))) as { created_at: string } | undefined;
        if (!visit || Date.parse(visit.created_at) > Date.parse(now) || !convention.state(member).agreed) return 0;
        const expected = reason === 'topic' ? 'topic' : 'reply';
        if (ref.kind !== expected) throw fail('经验来源无效。');
        const source = (reason === 'topic' ? topicSource : reason === 'accepted' ? acceptedSource : replySource).get(ref.id) as Source | undefined;
        if (!source || !same(member, { kind: source.author_kind, id: source.author_id })) return 0;
        if (reason !== 'topic' && (same(member, { kind: source.topic_kind!, id: source.topic_author! }) || [...bodyImageContent(source.body).text.trim()].length < 10)) return 0;
        const day = beijingDay(Date.parse(now));
        if (countOf(daily, member.kind, member.id, reason, day) || countOf(refUsed, member.kind, member.id, reason, ref.kind, ref.id)) return 0;
        addAward(member, awards[reason], reason, ref, now);
        return awards[reason];
      });
    },
    revert(target: Target, now = new Date().toISOString()) {
      return tx(() => {
        let reclaimed = 0;
        for (const row of validAwards.all(target.kind, target.id, target.kind, target.id) as AwardRow[]) {
          insert.run(randomUUID(), row.member_kind, row.member_id, -row.amount, 'revert', 'revert', beijingDay(Date.parse(now)), row.ref_kind, row.ref_id, row.id, now);
          reclaimed += row.amount;
        }
        return reclaimed;
      });
    },
  };
}
export type CommunityExperience = ReturnType<typeof createCommunityExperience>;
