import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { communityBadgeFamilies, communityBadgeTiers, emptyBadgeMetrics, evaluateCommunityBadges, legacyBadgeFamily } from '../src/community-badge-policy.ts';
import type { BadgeAward, BadgeFamilyId, BadgeMetrics, BadgeTier, LegacyBadgeAward } from '../src/community-badge-policy.ts';
import { beijingDay } from '../src/community-rules.ts';
import { day, fail, iso, memberKey, parseJson } from './community-db.ts';
import type { CommunityAuthor, Transaction } from './community-db.ts';

type BadgeContext = { now?: number; joinedAt?: string | null };
export type BadgeSource = { kind: 'topic' | 'reply' | 'reaction' | 'acceptance' | 'featured' | 'checkin' | 'contributor'; id: string; actor?: string };
export type BadgeReview = { family: BadgeFamilyId; tier: BadgeTier; reason: string; sources?: BadgeSource[]; legacyBadge?: string };
type Evidence = { version: 1; at: string; metrics: BadgeMetrics; sources: BadgeSource[] };
type HonorRow = { family: BadgeFamilyId; tier: BadgeTier; created_at: string; revoked_at: string | null; restored_at: string | null; evidence: string };
type Content = { kind: 'topic' | 'reply'; id: string; parent_id: string; created_at: string; stable_since: string; featured: number; featured_at: string | null; featured_since: string | null; accepted_at: string | null; asker: string; first_accepted_at: string | null };
type Reaction = { target_kind: 'topic' | 'reply'; target_id: string; actor: string; created_at: string; first_at: string };
const sourceKey = (source: BadgeSource) => `${source.kind}:${source.id}:${source.actor || ''}`;
const unique = (values: string[]) => new Set(values).size;
const month = (at: string) => beijingDay(Date.parse(at)).slice(0, 7);
const previous = (key: string) => new Date(Date.parse(`${key}T00:00:00Z`) - day).toISOString().slice(0, 10);
const effectiveRevokedAt = (row: HonorRow) => row.revoked_at && (!row.restored_at || row.restored_at < row.revoked_at) ? row.revoked_at : null;

/** Current progress is disposable; confirmed honors and their evidence are durable. */
export function createCommunityBadges(db: DatabaseSync, tx: Transaction, notify: (member: CommunityAuthor, text: string, data: Record<string, unknown>, at: string) => void) {
  const contents = db.prepare(`SELECT 'topic' AS kind,t.id,t.id AS parent_id,t.created_at,
      MAX(t.created_at,COALESCE(t.edited_at,t.created_at),COALESCE(t.badge_visible_since,t.created_at)) AS stable_since,
      t.featured,t.featured_at,COALESCE(t.badge_featured_since,t.featured_at) AS featured_since,
      NULL AS accepted_at,'' AS asker,NULL AS first_accepted_at
    FROM community_topics t WHERE t.author_kind=$kind AND t.author_id=$id AND t.pending=0 AND t.hidden_at IS NULL AND t.deleted_at IS NULL AND t.board!='vip'
    UNION ALL SELECT 'reply',r.id,t.id,r.created_at,
      MAX(r.created_at,COALESCE(r.edited_at,r.created_at),COALESCE(r.badge_visible_since,r.created_at),t.created_at,COALESCE(t.edited_at,t.created_at),COALESCE(t.badge_visible_since,t.created_at)),
      0,NULL,NULL,CASE WHEN t.accepted_reply_id=r.id THEN t.accepted_at ELSE NULL END,
      t.author_kind || ':' || t.author_id,COALESCE(e.first_at,t.accepted_at)
    FROM community_replies r JOIN community_topics t ON t.id=r.topic_id
    LEFT JOIN community_badge_events e ON e.kind='acceptance' AND e.source_id=t.id AND e.actor_key=r.author_kind || ':' || r.author_id
    WHERE r.author_kind=$kind AND r.author_id=$id AND r.hidden_at IS NULL AND r.deleted_at IS NULL
      AND t.pending=0 AND t.hidden_at IS NULL AND t.deleted_at IS NULL AND t.board!='vip'`);
  const reactions = db.prepare(`SELECT x.target_kind,x.target_id,x.member_kind || ':' || x.member_id AS actor,x.created_at,COALESCE(e.first_at,x.created_at) AS first_at
    FROM community_reactions x LEFT JOIN community_badge_events e
      ON e.kind='reaction' AND e.source_id=x.target_kind || ':' || x.target_id AND e.actor_key=x.member_kind || ':' || x.member_id
    WHERE EXISTS(SELECT 1 FROM community_topics t WHERE x.target_kind='topic' AND t.id=x.target_id AND t.author_kind=$kind AND t.author_id=$id)
      OR EXISTS(SELECT 1 FROM community_replies r WHERE x.target_kind='reply' AND r.id=x.target_id AND r.author_kind=$kind AND r.author_id=$id)`);
  const exclusions = db.prepare('SELECT kind,source_id AS id,actor_key AS actor FROM community_badge_exclusions');
  const checkins = db.prepare('SELECT day,reward,created_at FROM community_checkins WHERE member_kind=? AND member_id=? AND day<=? ORDER BY day DESC');
  const early = db.prepare(`SELECT c.day,c.created_at FROM community_badge_events e
    JOIN community_checkins c ON c.day=e.source_id AND c.member_kind || ':' || c.member_id=e.actor_key
    WHERE e.kind='early' AND e.actor_key=? AND c.reward>0 AND c.day<=?`);
  const violations = db.prepare(`SELECT COUNT(*) AS count FROM (
      SELECT 'penalty' AS kind,id,created_at FROM community_ledger WHERE member_kind=$kind AND member_id=$id AND kind='penalty'
      UNION ALL SELECT 'sanction',id,created_at FROM community_sanctions WHERE member_kind=$kind AND member_id=$id
    ) v WHERE v.created_at >= $since AND v.created_at <= $until AND NOT EXISTS(
      SELECT 1 FROM community_badge_violation_reviews r WHERE r.kind=v.kind AND r.source_id=v.id)`);
  const joined = db.prepare('SELECT created_at,badge_account_created_at FROM community_members WHERE member_kind=? AND member_id=?');
  // Payload owns account age; the community member row is created lazily.
  const readerRegistration = (db.prepare('PRAGMA table_info(readers)').all() as Array<{ name: string }>).some(column => column.name === 'created_at')
    ? db.prepare('SELECT created_at FROM readers WHERE id=?') : null;
  const setJoined = db.prepare('UPDATE community_members SET badge_account_created_at=? WHERE member_kind=? AND member_id=?');
  const honors = db.prepare('SELECT family,tier,created_at,revoked_at,restored_at,evidence FROM community_badge_honors WHERE member_kind=? AND member_id=?');
  // Public names only need confirmed eligibility, never progress or evidence recomputation.
  const iconHonors = db.prepare("SELECT family,tier FROM community_badge_honors WHERE member_kind=? AND member_id=? AND (revoked_at IS NULL OR revoked_at='' OR restored_at>=revoked_at)");
  const iconHonor = db.prepare("SELECT 1 FROM community_badge_honors WHERE member_kind=? AND member_id=? AND family=? AND tier=? AND (revoked_at IS NULL OR revoked_at='' OR restored_at>=revoked_at)");
  const legacy = db.prepare('SELECT badge AS id,created_at AS achievedAt,revoked_at AS revokedAt FROM community_badges WHERE member_kind=? AND member_id=? ORDER BY created_at,rowid');
  const insertHonor = db.prepare('INSERT OR IGNORE INTO community_badge_honors(member_kind,member_id,family,tier,created_at,evidence) VALUES(?,?,?,?,?,?)');
  const insertExclusion = db.prepare('INSERT OR IGNORE INTO community_badge_exclusions(kind,source_id,actor_key,reason,by_kind,by_id,created_at) VALUES(?,?,?,?,?,?,?)');
  const revokeHonor = db.prepare('UPDATE community_badge_honors SET revoked_at=?,revoked_reason=?,restored_at=NULL WHERE member_kind=? AND member_id=? AND family=? AND tier=?');
  const revokeLegacy = db.prepare('UPDATE community_badges SET revoked_at=?,revoked_reason=? WHERE member_kind=? AND member_id=? AND badge=? AND revoked_at IS NULL');
  const recordReview = db.prepare('INSERT INTO community_badge_honor_reviews(id,member_kind,member_id,family,tier,action,reason,evidence,by_kind,by_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  function assertReview(input: BadgeReview, actor: CommunityAuthor) {
    if (actor.kind !== 'owner') throw fail('只有作者能复核徽章荣誉。', 403);
    if (!communityBadgeFamilies.some(item => item.id === input.family) || !(communityBadgeTiers as readonly string[]).includes(input.tier)) throw fail('徽章系列或材质无效。');
    if (typeof input.reason !== 'string' || input.reason.trim().length < 2 || input.reason.length > 200) throw fail('请填写复核依据（2–200 字）。');
    if (input.legacyBadge && legacyBadgeFamily(input.legacyBadge) !== input.family) throw fail('历史徽章不属于这个系列。');
    if (!Array.isArray(input.sources ?? []) || (input.sources?.length ?? 0) > 200) throw fail('复核来源格式无效。');
    for (const source of input.sources || []) {
      if (!['topic', 'reply', 'reaction', 'acceptance', 'featured', 'checkin', 'contributor'].includes(source.kind)
        || typeof source.id !== 'string' || !source.id.trim() || source.id.length > 200
        || (source.actor !== undefined && (typeof source.actor !== 'string' || !/^(reader|owner):[^\s]{1,100}$/.test(source.actor)))
        || (['reaction', 'checkin'].includes(source.kind) && !source.actor)) throw fail('请填写有效的复核来源。');
    }
  }

  function collect(member: CommunityAuthor, { now = Date.now(), joinedAt }: BadgeContext = {}) {
    const at = iso(now), key = memberKey(member), cutoff = iso(now - 7 * day), today = beijingDay(now), metrics = emptyBadgeMetrics();
    if (joinedAt && Number.isFinite(Date.parse(joinedAt)) && Date.parse(joinedAt) <= now) setJoined.run(joinedAt, member.kind, member.id);
    const account = joined.get(member.kind, member.id) as { created_at: string; badge_account_created_at: string | null } | undefined;
    const registered = member.kind === 'reader' ? readerRegistration?.get(member.id) as { created_at: string } | undefined : undefined;
    const accountAt = registered?.created_at || account?.badge_account_created_at || account?.created_at;
    metrics.accountDays = accountAt ? Math.max(0, Math.floor((now - Date.parse(accountAt)) / day)) : 0;
    metrics.violations180 = Number(violations.get({ kind: member.kind, id: member.id, since: iso(now - 180 * day), until: at })?.count || 0);
    const excluded = new Set((exclusions.all() as BadgeSource[]).map(sourceKey));
    const invalid = (source: BadgeSource) => excluded.has(sourceKey(source));
    const invalidPerson = (person: string) => invalid({ kind: 'contributor', id: person });
    const all = (contents.all({ kind: member.kind, id: member.id }) as Content[]).filter(row => row.created_at <= at
      && !invalid({ kind: row.kind, id: row.id }) && !invalid({ kind: 'topic', id: row.parent_id }) && !invalidPerson(key));
    const contentMap = new Map(all.map(row => [`${row.kind}:${row.id}`, row]));
    const likes = (reactions.all({ kind: member.kind, id: member.id }) as Reaction[]).filter(row => row.actor !== key && !invalidPerson(row.actor)
      && row.created_at <= at && contentMap.has(`${row.target_kind}:${row.target_id}`)
      && !invalid({ kind: 'reaction', id: `${row.target_kind}:${row.target_id}`, actor: row.actor }));
    const stableLikes = likes.filter(row => row.created_at <= cutoff && contentMap.get(`${row.target_kind}:${row.target_id}`)!.stable_since <= cutoff);
    const topics = all.filter(row => row.kind === 'topic'), stableTopics = topics.filter(row => row.stable_since <= cutoff);
    const recognized = (rows: Content[], liked: Reaction[]) => rows.filter(row => unique(liked.filter(like => like.target_kind === 'topic' && like.target_id === row.id).map(like => like.actor)) >= 3);
    const featured = topics.filter(row => row.featured === 1 && row.featured_at && row.featured_at <= at && !invalid({ kind: 'featured', id: row.id }));
    const stableFeatured = featured.filter(row => row.stable_since <= cutoff && row.featured_since && row.featured_since <= cutoff);
    const answers = all.filter(row => row.kind === 'reply' && row.accepted_at && row.accepted_at <= at && row.asker !== key && !invalidPerson(row.asker)
      && !invalid({ kind: 'acceptance', id: row.parent_id }));
    const stableAnswers = answers.filter(row => row.stable_since <= cutoff && row.accepted_at! <= cutoff);
    const months = (rows: Content[], time: 'created_at' | 'featured_at' | 'first_accepted_at') => unique(rows.map(row => month(row[time]!)));
    const days = (checkins.all(member.kind, member.id, today) as Array<{ day: string; reward: number; created_at: string }>).filter(row => row.created_at <= at && !invalidPerson(key) && !invalid({ kind: 'checkin', id: row.day, actor: key }));
    const earlyDays = (early.all(key, today) as Array<{ day: string; created_at: string }>).filter(row => row.created_at <= at && !invalidPerson(key) && !invalid({ kind: 'checkin', id: row.day, actor: key }));
    metrics.attendance.checkins = days.length;
    let expected = days[0]?.day === today ? today : previous(today);
    for (const row of days) { if (row.day !== expected) break; metrics.attendance.streak++; expected = previous(expected); }
    metrics.early = { days: earlyDays.length, months: unique(earlyDays.map(row => row.day.slice(0, 7))) };
    metrics.writing = { topics: topics.length, recognized: recognized(topics, likes).length, featured: featured.length, months: months(topics, 'created_at'), stableTopics: stableTopics.length, stableRecognized: recognized(stableTopics, stableLikes).length, stableFeatured: stableFeatured.length, stableMonths: months(stableTopics, 'created_at') };
    metrics.appreciation = { likes: likes.length, people: unique(likes.map(row => row.actor)), contents: unique(likes.map(row => `${row.target_kind}:${row.target_id}`)), months: unique(likes.map(row => month(row.first_at))), stableLikes: stableLikes.length, stablePeople: unique(stableLikes.map(row => row.actor)), stableContents: unique(stableLikes.map(row => `${row.target_kind}:${row.target_id}`)), stableMonths: unique(stableLikes.map(row => month(row.first_at))) };
    metrics.answers = { count: answers.length, people: unique(answers.map(row => row.asker)), months: months(answers, 'first_accepted_at'), stableCount: stableAnswers.length, stablePeople: unique(stableAnswers.map(row => row.asker)), stableMonths: months(stableAnswers, 'first_accepted_at') };
    metrics.featured = { count: featured.length, months: months(featured, 'featured_at'), stableCount: stableFeatured.length, stableMonths: months(stableFeatured, 'featured_at') };
    const likeSources = (rows: Reaction[]): BadgeSource[] => rows.flatMap(row => {
      const content = contentMap.get(`${row.target_kind}:${row.target_id}`)!;
      return [{ kind: 'reaction', id: `${row.target_kind}:${row.target_id}`, actor: row.actor }, { kind: row.target_kind, id: row.target_id },
        { kind: 'topic', id: content.parent_id }, { kind: 'contributor', id: row.actor }];
    });
    const featureSources = (rows: Content[]): BadgeSource[] => rows.flatMap(row => [{ kind: 'featured', id: row.id }, { kind: 'topic', id: row.id }]);
    function sources(family: BadgeFamilyId, tier: BadgeTier): BadgeSource[] {
      const high = tier !== 'gold';
      let proof: BadgeSource[] = [];
      if (family === 'attendance') proof = (high ? days.slice(0, metrics.attendance.streak) : days).map(row => ({ kind: 'checkin', id: row.day, actor: key }));
      if (family === 'early') proof = earlyDays.map(row => ({ kind: 'checkin', id: row.day, actor: key }));
      if (family === 'writing') {
        proof = (high ? stableTopics : topics).map(row => ({ kind: 'topic', id: row.id }));
        if (high) {
          const recognizedIds = new Set(recognized(stableTopics, stableLikes).map(row => row.id));
          proof.push(...likeSources(stableLikes.filter(row => row.target_kind === 'topic' && recognizedIds.has(row.target_id))));
        }
        if (tier === 'aurora') proof.push(...featureSources(stableFeatured));
      }
      if (family === 'appreciation') proof = likeSources(high ? stableLikes : likes);
      if (family === 'answers') proof = (high ? stableAnswers : answers).flatMap(row => [{ kind: 'acceptance', id: row.parent_id }, { kind: 'reply', id: row.id }, { kind: 'topic', id: row.parent_id }, { kind: 'contributor', id: row.asker }]);
      if (family === 'featured') proof = featureSources(high ? stableFeatured : featured);
      proof.push({ kind: 'contributor', id: key });
      return [...new Map(proof.map(source => [sourceKey(source), source])).values()];
    }
    return { metrics, sources, at };
  }
  const awards = (member: CommunityAuthor): BadgeAward[] => (honors.all(member.kind, member.id) as HonorRow[]).map(row => ({ family: row.family, tier: row.tier, achievedAt: row.created_at, revokedAt: effectiveRevokedAt(row) }));
  function state(member: CommunityAuthor, context: BadgeContext = {}) {
    return tx(() => {
      const evidence = collect(member, context), existing = awards(member);
      const eligible = evaluateCommunityBadges(evidence.metrics, existing);
      for (const family of eligible.families) {
        let highest: BadgeTier | null = null;
        for (const tier of family.tiers) {
          if (!tier.eligible || tier.achieved) continue;
          const snapshot: Evidence = { version: 1, at: evidence.at, metrics: evidence.metrics, sources: evidence.sources(family.id, tier.tier) };
          if (insertHonor.run(member.kind, member.id, family.id, tier.tier, evidence.at, JSON.stringify(snapshot)).changes) highest = tier.tier;
        }
        if (highest) {
          const name = communityBadgeFamilies.find(item => item.id === family.id)!.name;
          notify(member, `获得徽章「${name} · ${{ gold: '黄金', diamond: '钻石', aurora: '炫彩' }[highest]}」`, { family: family.id, tier: highest }, evidence.at);
        }
      }
      return evaluateCommunityBadges(evidence.metrics, awards(member), legacy.all(member.kind, member.id) as LegacyBadgeAward[]);
    });
  }
  function review(member: CommunityAuthor, input: BadgeReview, actor: CommunityAuthor, at = new Date().toISOString()) {
    assertReview(input, actor);
    return tx(() => {
      const sources = input.sources || [], rejected = new Set(sources.map(sourceKey));
      for (const source of sources) insertExclusion.run(source.kind, source.id, source.actor || '', input.reason, actor.kind, actor.id, at);
      const revoked: Array<{ member: CommunityAuthor; family: BadgeFamilyId; tier: BadgeTier }> = [];
      const allHonors = db.prepare('SELECT member_kind,member_id,family,tier,created_at,revoked_at,restored_at,evidence FROM community_badge_honors').all() as Array<HonorRow & { member_kind: CommunityAuthor['kind']; member_id: string }>;
      for (const honor of allHonors) {
        const selected = honor.member_kind === member.kind && honor.member_id === member.id && honor.family === input.family && communityBadgeTiers.indexOf(honor.tier) >= communityBadgeTiers.indexOf(input.tier);
        const evidence = parseJson<Evidence | null>(honor.evidence, null);
        const implicated = evidence?.sources.some(source => rejected.has(sourceKey(source))) === true;
        if ((!selected && !implicated) || effectiveRevokedAt(honor)) continue;
        revokeHonor.run(at, input.reason, honor.member_kind, honor.member_id, honor.family, honor.tier);
        recordReview.run(randomUUID(), honor.member_kind, honor.member_id, honor.family, honor.tier, 'revoke', input.reason, honor.evidence, actor.kind, actor.id, at);
        revoked.push({ member: { kind: honor.member_kind, id: honor.member_id }, family: honor.family, tier: honor.tier });
      }
      const legacyRows = legacy.all(member.kind, member.id) as LegacyBadgeAward[];
      // Legacy records have no source snapshot. Never infer that a new family's
      // review disproves every old honor; the reviewer must name the old badge.
      for (const honor of legacyRows) if (!honor.revokedAt && input.legacyBadge === honor.id) {
        revokeLegacy.run(at, input.reason, member.kind, member.id, honor.id);
        recordReview.run(randomUUID(), member.kind, member.id, input.family, input.tier, 'revoke', input.reason,
          JSON.stringify({ version: 1, at, metrics: emptyBadgeMetrics(), sources: [], legacyBadge: honor.id, achievedAt: honor.achievedAt }), actor.kind, actor.id, at);
      }
      notify(member, '徽章荣誉已完成复核，相关荣誉已撤销。', { family: input.family, tier: input.tier, reason: input.reason }, at);
      return { revoked, excluded: sources.length };
    });
  }
  function restore(member: CommunityAuthor, input: BadgeReview, actor: CommunityAuthor, at = new Date().toISOString()) {
    assertReview(input, actor);
    return tx(() => {
      const honor = (honors.all(member.kind, member.id) as HonorRow[]).find(row => row.family === input.family && row.tier === input.tier);
      const oldHonor = input.legacyBadge ? (legacy.all(member.kind, member.id) as LegacyBadgeAward[]).find(row => row.id === input.legacyBadge && row.revokedAt) : undefined;
      if ((!honor || !effectiveRevokedAt(honor)) && !oldHonor) throw fail('该档荣誉没有待恢复的撤销记录。', 409);
      // An overturned source decision is explicit and appears in the same audit transaction.
      for (const source of input.sources || []) db.prepare('DELETE FROM community_badge_exclusions WHERE kind=? AND source_id=? AND actor_key=?').run(source.kind, source.id, source.actor || '');
      if (honor && effectiveRevokedAt(honor)) {
        const receipt = parseJson<Evidence | null>(honor.evidence, null);
        let originallyEligible = false;
        try { originallyEligible = Boolean(receipt?.version === 1 && Array.isArray(receipt.sources)
          && evaluateCommunityBadges(receipt.metrics).families.find(row => row.id === input.family)?.tiers.find(row => row.tier === input.tier)?.eligible); } catch { /* Damaged evidence cannot grant an honor. */ }
        const rejected = new Set((exclusions.all() as BadgeSource[]).map(sourceKey));
        if (!originallyEligible || receipt?.sources.some(source => rejected.has(sourceKey(source)))) throw fail('原达成证据仍有确认无效的来源，不能恢复。', 409);
        // Restore the proven historical achievement; ordinary later progress
        // loss never forces someone to earn that same honor for a second time.
        db.prepare('UPDATE community_badge_honors SET restored_at=? WHERE member_kind=? AND member_id=? AND family=? AND tier=?').run(at, member.kind, member.id, input.family, input.tier);
        recordReview.run(randomUUID(), member.kind, member.id, input.family, input.tier, 'restore', input.reason, honor.evidence, actor.kind, actor.id, at);
      }
      if (oldHonor) {
        db.prepare('UPDATE community_badges SET revoked_at=NULL,revoked_reason=NULL WHERE member_kind=? AND member_id=? AND badge=?').run(member.kind, member.id, oldHonor.id);
        if (!honor) recordReview.run(randomUUID(), member.kind, member.id, input.family, input.tier, 'restore', input.reason,
          JSON.stringify({ version: 1, at, metrics: emptyBadgeMetrics(), sources: [], legacyBadge: oldHonor.id, achievedAt: oldHonor.achievedAt }), actor.kind, actor.id, at);
      }
      notify(member, '经复核，徽章荣誉已恢复。', { family: input.family, tier: input.tier, reason: input.reason }, at);
      return { restored: true, family: input.family, tier: input.tier };
    });
  }
  function reverseViolation(kind: 'penalty' | 'sanction', id: string, reason: string, actor: CommunityAuthor, at = new Date().toISOString()) {
    if (actor.kind !== 'owner') throw fail('只有作者能撤销已确认违规记录。', 403);
    if (!['penalty', 'sanction'].includes(kind) || reason.trim().length < 2 || reason.length > 200) throw fail('请填写有效的申诉复核依据。');
    const source = db.prepare(kind === 'penalty' ? "SELECT member_kind,member_id FROM community_ledger WHERE id=? AND kind='penalty'" : 'SELECT member_kind,member_id FROM community_sanctions WHERE id=?').get(id) as { member_kind: CommunityAuthor['kind']; member_id: string } | undefined;
    if (!source) throw fail('找不到这条已确认违规记录。', 404);
    return tx(() => {
      const changed = Number(db.prepare('INSERT OR IGNORE INTO community_badge_violation_reviews(kind,source_id,reason,by_kind,by_id,created_at) VALUES(?,?,?,?,?,?)').run(kind, id, reason, actor.kind, actor.id, at).changes) > 0;
      return { changed, member: { kind: source.member_kind, id: source.member_id } };
    });
  }
  return { state, metrics: (member: CommunityAuthor, context: BadgeContext = {}) => collect(member, context).metrics, review, restore, reverseViolation,
    iconHonors: (member: CommunityAuthor) => iconHonors.all(member.kind, member.id) as Array<{ family: BadgeFamilyId; tier: BadgeTier }>,
    hasIconHonor: (member: CommunityAuthor, family: BadgeFamilyId, tier: BadgeTier) => Boolean(iconHonor.get(member.kind, member.id, family, tier)),
    reviewDetails: (member: CommunityAuthor) => ({ honors: honors.all(member.kind, member.id), reviews: db.prepare('SELECT family,tier,action,reason,evidence,by_kind,by_id,created_at FROM community_badge_honor_reviews WHERE member_kind=? AND member_id=? ORDER BY created_at DESC').all(member.kind, member.id) }),
  };
}
