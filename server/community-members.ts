import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  communityLevelRules, communityCleanDays, communityNoticeGroups, communityBadges, beijingDay, decorationKinds,
} from '../src/community-rules.mjs';
import type { LevelStat, DecorationKind } from '../src/community-rules.ts';
import { countOf, same, memberKey, parseJson, day, iso, fail } from './community-db.ts';
import type { CommunityAuthor } from './community-db.ts';
import { storedModerationContact, validateModerationContact } from './community-moderation-contact.ts';
import type { createCommunityConvention } from './community-convention.ts';
import { createCommunityBadges } from './community-badges.ts';
import type { Transaction } from './community-db.ts';
import type { createCommunityStaff } from './community-staff.ts';

type MemberRow = { level: number; level_day: string | null; steward: number; steward_boards: string | null; frame: string | null; name_color: string | null; cover: string | null; agreed_at: string | null; created_at: string };
type NoticeRow = {
  id: string; type: string; actor_kind: CommunityAuthor['kind'] | null; actor_id: string | null; topic_id: string | null; reply_id: string | null;
  text: string; data: string | null; link: string | null; count: number; created_at: string; read_at: string | null;
};
type SanctionRow = {
  id: string; member_kind: CommunityAuthor['kind']; member_id: string; days: number; reason: string;
  until: string; created_at: string; lifted_at: string | null;
};
export type Notice = { type: string; actor?: CommunityAuthor | null; topicId?: string | null; replyId?: string | null; text: string; data?: Record<string, unknown>; link?: string; group?: string };
export type MemberStats = {
  visitDays: number; visits100: number; topicsViewed: number; approved: number; likesRecv: number; distinctReplies: number;
  accepted: number; featured: number; topics: number; replies: number; violations30: number; violations180: number;
};
const monthStart = (now: number) => iso(Date.parse(`${beijingDay(now).slice(0, 7)}-01T00:00:00+08:00`));

// Members: trust levels, visits, stewards, decorations, follows, notifications, badges and sanctions.
export function createMembers(db: DatabaseSync, convention: Pick<ReturnType<typeof createCommunityConvention>, 'state'>, tx: Transaction, staff: ReturnType<typeof createCommunityStaff>, boardIds:()=>string[]) {
  const validModerationBoards = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0
    && value.every(board => typeof board === 'string' && boardIds().includes(board)) && new Set(value).size === value.length;
  const orderedModerationBoards = (boards: readonly string[]) => boardIds().filter(board => boards.includes(board));
  const ensureRow = db.prepare('INSERT OR IGNORE INTO community_members (member_kind, member_id, created_at) VALUES (?, ?, ?)');
  const memberRow = db.prepare('SELECT level, level_day, steward, steward_boards, frame, name_color, cover, agreed_at, created_at FROM community_members WHERE member_kind = ? AND member_id = ?');
  const saveLevel = db.prepare('UPDATE community_members SET level = ?, level_day = ? WHERE member_kind = ? AND member_id = ?');
  const setStewardRow = db.prepare('UPDATE community_members SET steward = ?, steward_boards = ? WHERE member_kind = ? AND member_id = ?');
  const contactRow = db.prepare('SELECT contact_qq, contact_email FROM community_members WHERE member_kind = ? AND member_id = ?');
  const setContactRow = db.prepare('UPDATE community_members SET contact_qq = ?, contact_email = ? WHERE member_kind = ? AND member_id = ?');
  const clearContactRow = db.prepare('UPDATE community_members SET contact_qq = NULL, contact_email = NULL WHERE member_kind = ? AND member_id = ?');
  const setDecoration = {
    frame: db.prepare('UPDATE community_members SET frame = ? WHERE member_kind = ? AND member_id = ?'),
    color: db.prepare('UPDATE community_members SET name_color = ? WHERE member_kind = ? AND member_id = ?'),
    cover: db.prepare('UPDATE community_members SET cover = ? WHERE member_kind = ? AND member_id = ?'),
  };
  const addVisit = db.prepare('INSERT OR IGNORE INTO community_visits (member_kind, member_id, day) VALUES (?, ?, ?)');
  // Level statistics.
  const visits = db.prepare('SELECT COUNT(*) AS count FROM community_visits WHERE member_kind = ? AND member_id = ? AND day >= ?');
  const viewed = db.prepare('SELECT COUNT(DISTINCT topic_id) AS count FROM community_views WHERE viewer = ?');
  const published = db.prepare('SELECT COUNT(*) AS count FROM community_topics WHERE author_kind = ? AND author_id = ? AND deleted_at IS NULL AND pending = 0');
  const liveReplies = db.prepare(`SELECT COUNT(*) AS count FROM community_replies r JOIN community_topics t ON t.id = r.topic_id
    WHERE r.author_kind = ? AND r.author_id = ? AND r.deleted_at IS NULL AND t.deleted_at IS NULL`);
  const repliedTopics = db.prepare(`SELECT COUNT(DISTINCT r.topic_id) AS count FROM community_replies r JOIN community_topics t ON t.id = r.topic_id
    WHERE r.author_kind = ? AND r.author_id = ? AND r.deleted_at IS NULL AND t.deleted_at IS NULL`);
  const likesReceived = db.prepare(`SELECT COUNT(*) AS count FROM community_reactions x
    LEFT JOIN community_topics t ON x.target_kind = 'topic' AND t.id = x.target_id
    LEFT JOIN community_replies r ON x.target_kind = 'reply' AND r.id = x.target_id
    WHERE (t.author_kind = $kind AND t.author_id = $id AND t.deleted_at IS NULL) OR (r.author_kind = $kind AND r.author_id = $id AND r.deleted_at IS NULL)`);
  const acceptedAnswers = db.prepare(`SELECT COUNT(*) AS count FROM community_topics t JOIN community_replies r ON r.id = t.accepted_reply_id
    WHERE r.author_kind = ? AND r.author_id = ? AND t.deleted_at IS NULL AND r.deleted_at IS NULL`);
  const featuredTopics = db.prepare('SELECT COUNT(*) AS count FROM community_topics WHERE author_kind = ? AND author_id = ? AND featured = 1 AND deleted_at IS NULL');
  const violationsSince = db.prepare(`SELECT (SELECT COUNT(*) FROM community_ledger WHERE member_kind = $kind AND member_id = $id AND kind = 'penalty' AND created_at >= $since)
    + (SELECT COUNT(*) FROM community_sanctions WHERE member_kind = $kind AND member_id = $id AND created_at >= $since) AS count`);
  // Follows.
  const addFollow = db.prepare('INSERT OR IGNORE INTO community_follows (follower_kind, follower_id, followee_kind, followee_id, created_at) VALUES (?, ?, ?, ?, ?)');
  const dropFollow = db.prepare('DELETE FROM community_follows WHERE follower_kind = ? AND follower_id = ? AND followee_kind = ? AND followee_id = ?');
  const isFollowing = db.prepare('SELECT COUNT(*) AS count FROM community_follows WHERE follower_kind = ? AND follower_id = ? AND followee_kind = ? AND followee_id = ?');
  const followerCount = db.prepare('SELECT COUNT(*) AS count FROM community_follows WHERE followee_kind = ? AND followee_id = ?');
  const followingCount = db.prepare('SELECT COUNT(*) AS count FROM community_follows WHERE follower_kind = ? AND follower_id = ?');
  const followersOf = db.prepare('SELECT follower_kind, follower_id FROM community_follows WHERE followee_kind = ? AND followee_id = ?');
  const followingOf = db.prepare('SELECT followee_kind, followee_id FROM community_follows WHERE follower_kind = ? AND follower_id = ? ORDER BY created_at DESC');
  // Notifications.
  const insertNotice = db.prepare(`INSERT INTO community_notifications (id, member_kind, member_id, type, actor_kind, actor_id, topic_id, reply_id, text, data, link, group_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const groupedNotice = db.prepare(`SELECT id FROM community_notifications WHERE member_kind = ? AND member_id = ? AND group_key = ? AND read_at IS NULL`);
  const bumpNotice = db.prepare('UPDATE community_notifications SET count = count + 1, actor_kind = ?, actor_id = ?, created_at = ? WHERE id = ?');
  const noticeList = db.prepare(`SELECT id, type, actor_kind, actor_id, topic_id, reply_id, text, data, link, count, created_at, read_at FROM community_notifications
    WHERE member_kind = ? AND member_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`);
  const oneNotice = db.prepare('SELECT id, topic_id, reply_id, link FROM community_notifications WHERE id = ? AND member_kind = ? AND member_id = ?');
  const unreadRows = db.prepare('SELECT type, COUNT(*) AS count FROM community_notifications WHERE member_kind = ? AND member_id = ? AND read_at IS NULL GROUP BY type');
  const readOne = db.prepare('UPDATE community_notifications SET read_at = ? WHERE id = ? AND member_kind = ? AND member_id = ? AND read_at IS NULL');
  const readAllRows = db.prepare('UPDATE community_notifications SET read_at = ? WHERE member_kind = ? AND member_id = ? AND read_at IS NULL');
  // Badges.
  const addBadge = db.prepare('INSERT OR IGNORE INTO community_badges (member_kind, member_id, badge, created_at) VALUES (?, ?, ?, ?)');
  const badgeRows = db.prepare('SELECT badge FROM community_badges WHERE member_kind = ? AND member_id = ? AND revoked_at IS NULL ORDER BY created_at');
  // Sanctions.
  const insertSanction = db.prepare(`INSERT INTO community_sanctions (id, member_kind, member_id, days, reason, until, by_kind, by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const activeSanction = db.prepare(`SELECT id, days, reason, until FROM community_sanctions WHERE member_kind = ? AND member_id = ? AND lifted_at IS NULL AND until > ? ORDER BY until DESC LIMIT 1`);
  const oneSanction = db.prepare('SELECT id, member_kind, member_id, lifted_at FROM community_sanctions WHERE id = ?');
  const liftSanction = db.prepare('UPDATE community_sanctions SET lifted_at = ? WHERE id = ? AND lifted_at IS NULL');
  const sanctionList = db.prepare(`SELECT id, member_kind, member_id, days, reason, until, created_at, lifted_at FROM community_sanctions
    ORDER BY (lifted_at IS NULL AND until > ?) DESC, created_at DESC, rowid DESC LIMIT 100`);
  // Contribution this month: likes received + accepted ×5 + 精华 ×10 (the ranking page).
  const monthLikes = db.prepare(`SELECT kind, id, COUNT(*) AS count FROM (
      SELECT t.author_kind AS kind, t.author_id AS id FROM community_reactions x JOIN community_topics t ON x.target_kind = 'topic' AND t.id = x.target_id
      WHERE x.created_at >= $from AND t.deleted_at IS NULL
      UNION ALL
      SELECT r.author_kind AS kind, r.author_id AS id FROM community_reactions x JOIN community_replies r ON x.target_kind = 'reply' AND r.id = x.target_id
      WHERE x.created_at >= $from AND r.deleted_at IS NULL
    ) GROUP BY kind, id`);
  const monthAccepted = db.prepare(`SELECT r.author_kind AS kind, r.author_id AS id, COUNT(*) AS count FROM community_topics t JOIN community_replies r ON r.id = t.accepted_reply_id
    WHERE t.accepted_at >= $from AND t.deleted_at IS NULL AND r.deleted_at IS NULL GROUP BY r.author_kind, r.author_id`);
  const monthFeatured = db.prepare(`SELECT author_kind AS kind, author_id AS id, COUNT(*) AS count FROM community_topics
    WHERE featured = 1 AND featured_at >= $from AND deleted_at IS NULL GROUP BY author_kind, author_id`);

  const ensure = (member: CommunityAuthor, now = new Date().toISOString()) => { ensureRow.run(member.kind, member.id, now); };
  const row = (member: CommunityAuthor) => { ensure(member); return memberRow.get(member.kind, member.id) as MemberRow; };

  function stats(member: CommunityAuthor, now = Date.now()): MemberStats {
    const k = member.kind, id = member.id;
    const since = (days: number) => ({ kind: k, id, since: iso(now - days * day) });
    return {
      visitDays: countOf(visits, k, id, ''), visits100: countOf(visits, k, id, beijingDay(now - 99 * day)),
      topicsViewed: countOf(viewed, memberKey(member)), approved: countOf(published, k, id),
      likesRecv: countOf(likesReceived, { kind: k, id }), distinctReplies: countOf(repliedTopics, k, id),
      accepted: countOf(acceptedAnswers, k, id), featured: countOf(featuredTopics, k, id),
      topics: countOf(published, k, id), replies: countOf(liveReplies, k, id),
      violations30: countOf(violationsSince, since(communityCleanDays[2])), violations180: countOf(violationsSince, since(communityCleanDays[3])),
    };
  }
  const statValue = (value: MemberStats, key: LevelStat) => key === 'honor' ? (value.featured >= 1 || value.accepted >= 3 ? 1 : 0) : value[key];
  const meets = (value: MemberStats, level: 1 | 2 | 3) => communityLevelRules[level].every(rule => statValue(value, rule.key) >= rule.need);
  function computeLevel(value: MemberStats) {
    let level = 0;
    if (meets(value, 1)) level = 1;
    if (level === 1 && meets(value, 2) && value.violations30 === 0) level = 2;
    if (level === 2 && meets(value, 3) && value.violations180 === 0) level = 3;
    return level;
  }

  function notify(member: CommunityAuthor, notice: Notice, now = new Date().toISOString()) {
    if (notice.actor && same(notice.actor, member)) return;
    if (notice.group) {
      const existing = groupedNotice.get(member.kind, member.id, notice.group) as { id: string } | undefined;
      if (existing) { bumpNotice.run(notice.actor?.kind ?? null, notice.actor?.id ?? null, now, existing.id); return; }
    }
    insertNotice.run(randomUUID(), member.kind, member.id, notice.type, notice.actor?.kind ?? null, notice.actor?.id ?? null,
      notice.topicId ?? null, notice.replyId ?? null, notice.text, notice.data ? JSON.stringify(notice.data) : null, notice.link ?? null, notice.group ?? null, now);
  }
  function award(member: CommunityAuthor, badge: string, now = new Date().toISOString()) {
    if (!communityBadges[badge]) return false;
    const added = Number(addBadge.run(member.kind, member.id, badge, now).changes) > 0;
    if (added) notify(member, { type: 'badge', text: `获得徽章「${communityBadges[badge].name}」`, data: { badge } }, now);
    return added;
  }
  const achievements = createCommunityBadges(db, tx, (member, text, data, at) => notify(member, { type: 'badge', text, data }, at));
  function trustLevel(member: CommunityAuthor, now = Date.now()) {
    if (member.kind === 'owner') return 4;
    const current = row(member);
    const today = beijingDay(now);
    if (current.level_day === today) return Math.min(current.level, 3);
    const next = Math.max(computeLevel(stats(member, now)), Math.min(current.level, 2));
    saveLevel.run(next, today, member.kind, member.id);
    if (next > current.level) notify(member, { type: 'level', text: '升到了新的等级', data: { level: next } }, iso(now));
    return next;
  }
  function moderationScope(current: MemberRow | undefined): string[] {
    if (!current?.steward) return [];
    if (current.steward_boards === null) return boardIds();
    const stored = parseJson<unknown>(current.steward_boards, null);
    // Damaged scope data must never restore an unrestricted appointment.
    return validModerationBoards(stored) ? orderedModerationBoards(stored) : [];
  }
  function moderationBoards(member: CommunityAuthor): string[] {
    return staff.state(member)?.boards ?? [];
  }

  return {
    ensure,
    visit(member: CommunityAuthor, now = Date.now()) { ensure(member, iso(now)); addVisit.run(member.kind, member.id, beijingDay(now)); },
    stats,
    // The trust level, recomputed once a Beijing day. Levels 1 and 2 stay once earned;
    // level 3 falls back to 2 when its conditions lapse. Stewards are level 4; the owner is above levels.
    level(member: CommunityAuthor, now = Date.now()) {
      if (member.kind === 'owner') return 4;
      return staff.state(member) ? 4 : trustLevel(member, now);
    },
    trustLevel,
    moderationBoards,
    // Signed reviewer confirmation must not create a member or award a visit.
    storedModerationBoards: (member: CommunityAuthor) => staff.state(member)?.boards ?? [],
    moderationContact(member: CommunityAuthor) {
      if (!moderationBoards(member).length) return null;
      const contact = contactRow.get(member.kind, member.id) as { contact_qq: string | null; contact_email: string | null } | undefined;
      return storedModerationContact(contact?.contact_qq ?? null, contact?.contact_email ?? null);
    },
    setModerationContact(member: CommunityAuthor, input: Record<string, unknown>) {
      if (!moderationBoards(member).length) throw fail('只有作者和现任版主能设置管理联系方式。', 403);
      const contact = validateModerationContact(input);
      ensure(member);
      setContactRow.run(contact.qq || null, contact.email || null, member.kind, member.id);
      return contact;
    },
    levelProgress(member: CommunityAuthor, level: number, now = Date.now()) {
      if (level >= 3) return null;
      const next = (level + 1) as 1 | 2 | 3;
      const value = stats(member, now);
      return {
        next, rows: communityLevelRules[next].map(rule => ({ key: rule.key, label: rule.label, labelEn: rule.labelEn, need: rule.need, have: statValue(value, rule.key) })),
        clean: next === 1 ? true : (next === 2 ? value.violations30 : value.violations180) === 0,
      };
    },
    steward: (member: CommunityAuthor) => member.kind === 'reader' && Boolean(staff.state(member)),
    setSteward(member: CommunityAuthor, on: boolean, boards?: readonly string[], now = new Date().toISOString()) {
      if (on && boards !== undefined && !validModerationBoards(boards)) throw fail('请至少选择一个有效的管理板块。');
      ensure(member, now);
      const wasSteward = Boolean(row(member).steward);
      const assigned = on && boards !== undefined ? orderedModerationBoards(boards) : null;
      setStewardRow.run(on ? 1 : 0, assigned ? JSON.stringify(assigned) : null, member.kind, member.id);
      staff.legacy(member, on, on ? moderationScope(row(member)) : [], now);
      if (!on) clearContactRow.run(member.kind, member.id);
      saveLevel.run(row(member).level, null, member.kind, member.id);
      notify(member, { type: 'system', text: on ? wasSteward ? '你的管理板块已更新' : '你被任命为协管' : '你的协管职务已撤销', data: { steward: on, boards: on ? moderationBoards(member) : [], ...(wasSteward && on ? { scopeChanged: true } : {}) } }, now);
    },
    stewards: () => staff.roster().filter(member => staff.state(member)),
    decorations(member: CommunityAuthor) {
      const value = row(member);
      return { frame: value.frame, color: value.name_color, cover: value.cover };
    },
    // Main-site frame projections must not create a membership or award a visit.
    storedDecorations(member: CommunityAuthor) {
      const value = memberRow.get(member.kind, member.id) as MemberRow | undefined;
      return value ? { frame: value.frame, color: value.name_color, cover: value.cover } : null;
    },
    storedLevel(member: CommunityAuthor) {
      return (memberRow.get(member.kind, member.id) as MemberRow | undefined)?.level ?? null;
    },
    equip(member: CommunityAuthor, kind: DecorationKind, ref: string | null) {
      if (!(decorationKinds as readonly string[]).includes(kind)) return;
      ensure(member);
      setDecoration[kind].run(ref, member.kind, member.id);
    },
    agreed: (member: CommunityAuthor) => convention.state(member).agreed,
    joinedAt: (member: CommunityAuthor) => row(member).created_at,

    /* ---------- 关注 ---------- */
    follow(follower: CommunityAuthor, followee: CommunityAuthor, on: boolean, now = new Date().toISOString()) {
      if (on) {
        const added = Number(addFollow.run(follower.kind, follower.id, followee.kind, followee.id, now).changes) > 0;
        if (added) notify(followee, { type: 'follow', actor: follower, text: '关注了你' }, now);
      } else dropFollow.run(follower.kind, follower.id, followee.kind, followee.id);
      return { following: on, followers: countOf(followerCount, followee.kind, followee.id) };
    },
    following: (follower: CommunityAuthor, followee: CommunityAuthor) => countOf(isFollowing, follower.kind, follower.id, followee.kind, followee.id) > 0,
    followCounts: (member: CommunityAuthor) => ({ followers: countOf(followerCount, member.kind, member.id), following: countOf(followingCount, member.kind, member.id) }),
    followersOf: (member: CommunityAuthor) => (followersOf.all(member.kind, member.id) as Array<{ follower_kind: CommunityAuthor['kind']; follower_id: string }>).map(item => ({ kind: item.follower_kind, id: item.follower_id })),
    followingOf: (member: CommunityAuthor) => (followingOf.all(member.kind, member.id) as Array<{ followee_kind: CommunityAuthor['kind']; followee_id: string }>).map(item => ({ kind: item.followee_kind, id: item.followee_id })),

    /* ---------- 通知 ---------- */
    notify,
    inbox(member: CommunityAuthor, tab = 'all', limit = 60) {
      const types = communityNoticeGroups[tab] ?? null;
      return (noticeList.all(member.kind, member.id, 200) as NoticeRow[])
        .filter(notice => !types || types.includes(notice.type)).slice(0, limit)
        .map(notice => ({
          id: notice.id, type: notice.type, actor: notice.actor_kind && notice.actor_id ? { kind: notice.actor_kind, id: notice.actor_id } : null,
          topicId: notice.topic_id, replyId: notice.reply_id, text: notice.text, data: parseJson<Record<string, unknown>>(notice.data, {}),
          link: notice.link, count: notice.count, createdAt: notice.created_at, read: Boolean(notice.read_at),
        }));
    },
    unread(member: CommunityAuthor) {
      const byType = new Map((unreadRows.all(member.kind, member.id) as Array<{ type: string; count: number }>).map(item => [item.type, Number(item.count)]));
      const counts: Record<string, number> = {};
      for (const [tab, types] of Object.entries(communityNoticeGroups))
        counts[tab] = [...byType].filter(([type]) => !types || types.includes(type)).reduce((sum, [, count]) => sum + count, 0);
      return counts;
    },
    notice: (member: CommunityAuthor, id: string) => (oneNotice.get(id, member.kind, member.id) as { id: string; topic_id: string | null; reply_id: string | null; link: string | null } | undefined) || null,
    read(member: CommunityAuthor, id: string, now = new Date().toISOString()) { readOne.run(now, id, member.kind, member.id); },
    readAll(member: CommunityAuthor, now = new Date().toISOString()) { return Number(readAllRows.run(now, member.kind, member.id).changes); },

    /* ---------- 徽章 ---------- */
    award,
    badges: (member: CommunityAuthor) => (badgeRows.all(member.kind, member.id) as Array<{ badge: string }>).map(item => item.badge),
    badgeState(member: CommunityAuthor, context: { now?: number; joinedAt?: string | null } = {}) {
      ensure(member, iso(context.now ?? Date.now()));
      return achievements.state(member, context);
    },
    badgeMetrics: achievements.metrics,
    reviewBadges: achievements.review,
    restoreBadges: achievements.restore,
    badgeReviewDetails: achievements.reviewDetails,
    reverseBadgeViolation: achievements.reverseViolation,
    // Historical badges are retained; automatic issuance now follows the shared family policy.
    checkBadges(member: CommunityAuthor, now = new Date().toISOString()) {
      ensure(member, now);
      return achievements.state(member, { now: Date.parse(now) });
    },

    /* ---------- 禁言 ---------- */
    mute(member: CommunityAuthor, days: number, reason: string, by: CommunityAuthor, now = Date.now()) {
      const id = randomUUID(), until = iso(now + days * day);
      ensure(member, iso(now));
      insertSanction.run(id, member.kind, member.id, days, reason, until, by.kind, by.id, iso(now));
      notify(member, { type: 'penalty', text: `你被禁言 ${days} 天`, data: { days, reason, until } }, iso(now));
      return { id, until };
    },
    muted(member: CommunityAuthor, now = Date.now()) {
      return (activeSanction.get(member.kind, member.id, iso(now)) as { id: string; days: number; reason: string; until: string } | undefined) || null;
    },
    sanctionMember(id:string) {
      const sanction=oneSanction.get(id) as {member_kind:CommunityAuthor['kind'];member_id:string}|undefined;
      return sanction?{kind:sanction.member_kind,id:sanction.member_id}:null;
    },
    lift(id: string, now = new Date().toISOString()) {
      const sanction = oneSanction.get(id) as { member_kind: CommunityAuthor['kind']; member_id: string; lifted_at: string | null } | undefined;
      if (!sanction || sanction.lifted_at) return null;
      liftSanction.run(now, id);
      const member = { kind: sanction.member_kind, id: sanction.member_id };
      notify(member, { type: 'system', text: '你的禁言已被提前解除', data: { lifted: true } }, now);
      return member;
    },
    sanctions(now = Date.now()) {
      // History stays durable; the management display limit never changes enforcement or trust statistics.
      const at = iso(now);
      return (sanctionList.all(at) as SanctionRow[]).map(item => {
        const active = !item.lifted_at && item.until > at;
        const state: 'active' | 'expired' | 'lifted' = item.lifted_at ? 'lifted' : active ? 'active' : 'expired';
        return {
          id: item.id, member: { kind: item.member_kind, id: item.member_id }, days: item.days, reason: item.reason,
          until: item.until, createdAt: item.created_at, liftedAt: item.lifted_at, active, state,
        };
      });
    },

    /* ---------- 本月贡献 ---------- */
    contributions(now = Date.now()) {
      const from = monthStart(now);
      const scores = new Map<string, { member: CommunityAuthor; likes: number; accepted: number; featured: number; score: number }>();
      const add = (rows: unknown[], field: 'likes' | 'accepted' | 'featured', weight: number) => {
        for (const item of rows as Array<{ kind: CommunityAuthor['kind']; id: string; count: number }>) {
          if (item.kind === 'owner') continue;
          const key = `${item.kind}:${item.id}`;
          const entry = scores.get(key) || { member: { kind: item.kind, id: item.id }, likes: 0, accepted: 0, featured: 0, score: 0 };
          entry[field] += Number(item.count);
          entry.score += Number(item.count) * weight;
          scores.set(key, entry);
        }
      };
      add(monthLikes.all({ from }), 'likes', 1);
      add(monthAccepted.all({ from }), 'accepted', 5);
      add(monthFeatured.all({ from }), 'featured', 10);
      return [...scores.values()].filter(entry => entry.score > 0).sort((a, b) => b.score - a.score);
    },
  };
}
export type Members = ReturnType<typeof createMembers>;
