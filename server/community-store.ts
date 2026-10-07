import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { communitySchemaReady } from './payload/community-migration.ts';
import { sortTopics, communityRules, beijingDay } from '../src/community.mjs';
import type { CommunitySort, CommunityTopic } from '../src/community.ts';
import type { PromptMode } from '../src/community-rules.ts';
import { createTransaction, fail, countOf, same, parseJson, day, iso } from './community-db.ts';
import type { CommunityAuthor, Target, Kind } from './community-db.ts';
import { createLedger } from './community-ledger.ts';
import { createMembers } from './community-members.ts';
import type { Notice } from './community-members.ts';
import { createEconomy } from './community-economy.ts';
import { bodyImageContent } from '../src/community-body-images.ts';
import { createCommunityBanners } from './community-banners.ts';
import { createCommunityRequests } from './community-requests.ts';
import { createCommunityRateLimits } from './community-rate-limits.ts';
import { createCommunityAudit } from './community-audit.ts';
import { purgeCommunityReaderData } from './community-reader-cleanup.ts';
import { createCommunityConvention } from './community-convention.ts';
import { createCommunityExperience } from './community-experience.ts';
import { createCommunityProfileBackgrounds } from './community-profile-backgrounds.ts';
import { createCommunityStaff } from './community-staff.ts';
import { createCommunityFeatureRecommendations } from './community-staff-features.ts';

export type { CommunityAuthor, Target } from './community-db.ts';
export type ShowcaseMeta = { tools: string; model: string; usage: string; prompt: string; promptMode: PromptMode; price: number };
export type ResourceMeta = { url: string; kind: string; price: string; platform: string };
type TopicRow = {
  id: string; board: string; author_kind: Kind; author_id: string; title: string; excerpt: string;
  created_at: string; last_activity_at: string; reply_count: number; pinned: number; featured: number; featured_at: string | null;
  last_kind: Kind | null; last_id: string | null; last_at: string | null;
  edited_at: string | null; accepted_reply_id: string | null; tags: string; likes: number; views: number; thumbs: string | null;
  locked: number; pending: number; pending_reason: string | null; hidden_at: string | null; hidden_reason: string | null;
  paid_pin_until: string | null; glow_until: string | null; bounty: number; bounty_state: string | null;
  meta: string | null; resource: string | null; alive: number; dead: number;
};
type ReplyRow = {
  id: string; topic_id: string; author_kind: Kind; author_id: string; body: string; created_at: string; edited_at: string | null;
  likes: number; quote_id: string | null; hidden_at: string | null;
};
export type StoredTopic = Omit<CommunityTopic, 'author' | 'authorRole' | 'lastReply' | 'meta' | 'resource'> & {
  author: CommunityAuthor;
  lastReply: { author: CommunityAuthor; at: string } | null;
  meta: Omit<ShowcaseMeta, 'prompt'> | null;
  resource: (ResourceMeta & { alive: number; dead: number }) | null;
};
export type BoardStats = { topics: number; repliesToday: number; latest: { id: string; title: string; lastActivityAt: string } | null };
export type NewTopic = {
  board: string; author: CommunityAuthor; title: string; body: string; tags?: readonly string[]; images?: readonly string[];
  bounty?: number; meta?: ShowcaseMeta | null; resource?: ResourceMeta | null; pending?: string | null; pin?: boolean; now?: string;
};

export function communityTablesReady(directory: string) {
  const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try { return communitySchemaReady(db); }
  finally { db.close(); }
}

// 兼容旧版没有标题的随想：列表和通知里用正文开头代替。
export const displayTitle = (title: string, body: string) => title || ([...body.replace(/\s+/g, ' ').trim()].slice(0, 36).join('') + ([...body].length > 36 ? '…' : ''));

// Community topics, replies and everything around them in content.db.
// Deletion is soft: rows stay for moderation and audit and stop being listed.
export type CommunityStoreOptions = { previewCatalog?: boolean; queueFile?: (filename: string, reason: string) => void };
export function createCommunityStore(directory: string, { previewCatalog = false, queueFile }: CommunityStoreOptions = {}) {
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  if (!communitySchemaReady(db)) {
    db.close();
    throw Error('Community migration is required: run node scripts/migrate-community.mjs <payload-directory>.');
  }
  const rules = communityRules;
  const tx = createTransaction(db);
  const ledger = createLedger(db);
  const convention = createCommunityConvention(db, tx);
  const experience = createCommunityExperience(db, tx, convention);
  const staff = createCommunityStaff(db, tx);
  const featureRecommendations = createCommunityFeatureRecommendations(db, tx, staff);
  const members = createMembers(db, convention, tx, staff);
  const banners = createCommunityBanners(db, tx, members, staff);
  const profileBackgrounds = createCommunityProfileBackgrounds(db, tx, (id, reason) => {
    // Queue both filenames durably before removing their registry. A rollback
    // leaves the picture registered, which protects it from queued cleanup.
    if (!queueFile || !unusedProfileImage.get(id)) return;
    queueImageFiles(id, reason);
    dropImage.run(id);
  });
  const economy = createEconomy(db, tx, ledger, members, { previewCatalog });
  const requests = createCommunityRequests(db, tx);
  const rateLimits = createCommunityRateLimits(db, tx);
  const audit = createCommunityAudit(db, tx);

  // Each listed topic carries its latest live reply, likes, views, up to four image ids and resource votes.
  const lastReply = (column: string) => `(SELECT r.${column} FROM community_replies r WHERE r.topic_id = t.id AND r.deleted_at IS NULL AND r.hidden_at IS NULL
    ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1)`;
  const topicColumns = `t.id, t.board, t.author_kind, t.author_id, t.title, substr(t.body, 1, 320) AS excerpt, t.created_at, t.last_activity_at, t.reply_count, t.pinned, t.featured, t.featured_at,
    t.edited_at, t.accepted_reply_id, t.tags, t.locked, t.pending, t.pending_reason, t.hidden_at, t.hidden_reason, t.paid_pin_until, t.glow_until,
    t.bounty, t.bounty_state, t.meta, t.resource,
    ${lastReply('author_kind')} AS last_kind, ${lastReply('author_id')} AS last_id, ${lastReply('created_at')} AS last_at,
    (SELECT COUNT(*) FROM community_reactions x WHERE x.target_kind = 'topic' AND x.target_id = t.id) AS likes,
    (SELECT COUNT(*) FROM community_views v WHERE v.topic_id = t.id) AS views,
    (SELECT group_concat(id) FROM (SELECT i.id FROM community_images i WHERE i.topic_id = t.id AND i.reply_id IS NULL AND i.deleted_at IS NULL ORDER BY i.position LIMIT 4)) AS thumbs,
    (SELECT COUNT(*) FROM community_votes v WHERE v.topic_id = t.id AND v.value = 'alive') AS alive,
    (SELECT COUNT(*) FROM community_votes v WHERE v.topic_id = t.id AND v.value = 'dead') AS dead`;
  // Listed topics: published and not hidden, with optional board, tag, author and search filters.
  const liveTopics = db.prepare(`SELECT ${topicColumns}
    FROM community_topics t WHERE t.deleted_at IS NULL AND t.pending = 0 AND t.hidden_at IS NULL
    AND ($board IS NULL OR t.board = $board)
    AND ($tag IS NULL OR EXISTS (SELECT 1 FROM json_each(t.tags) WHERE json_each.value = $tag))
    AND ($authorKind IS NULL OR (t.author_kind = $authorKind AND t.author_id = $authorId))
    AND ($pattern IS NULL OR t.title LIKE $pattern ESCAPE '\\' OR t.body LIKE $pattern ESCAPE '\\')`);
  const oneTopic = db.prepare(`SELECT ${topicColumns}, t.body FROM community_topics t WHERE t.id = ? AND t.deleted_at IS NULL`);
  const queuedTopics = db.prepare(`SELECT ${topicColumns}, t.body FROM community_topics t WHERE t.deleted_at IS NULL AND (t.pending = 1 OR t.hidden_at IS NOT NULL) ORDER BY t.created_at`);
  const topicReplies = db.prepare(`SELECT r.id, r.topic_id, r.author_kind, r.author_id, r.body, r.created_at, r.edited_at, r.quote_id, r.hidden_at,
    (SELECT COUNT(*) FROM community_reactions x WHERE x.target_kind = 'reply' AND x.target_id = r.id) AS likes
    FROM community_replies r WHERE r.topic_id = ? AND r.deleted_at IS NULL ORDER BY r.created_at, r.rowid`);
  const oneReply = db.prepare(`SELECT id, topic_id, author_kind, author_id, body, created_at, edited_at, quote_id, hidden_at, 0 AS likes
    FROM community_replies WHERE id = ? AND deleted_at IS NULL`);
  const memberReplies = db.prepare(`SELECT r.id, r.topic_id, r.body, r.created_at, t.title, t.body AS topic_body, t.board,
    (SELECT COUNT(*) FROM community_reactions x WHERE x.target_kind = 'reply' AND x.target_id = r.id) AS likes
    FROM community_replies r JOIN community_topics t ON t.id = r.topic_id
    WHERE r.author_kind = ? AND r.author_id = ? AND r.deleted_at IS NULL AND r.hidden_at IS NULL AND t.deleted_at IS NULL AND t.pending = 0 AND t.hidden_at IS NULL
    ORDER BY r.created_at DESC LIMIT 50`);
  const hiddenReplies = db.prepare(`SELECT r.id, r.topic_id, r.author_kind, r.author_id, r.body, r.created_at, r.hidden_at, t.title, t.body AS topic_body
    FROM community_replies r JOIN community_topics t ON t.id = r.topic_id WHERE r.deleted_at IS NULL AND r.hidden_at IS NOT NULL AND t.deleted_at IS NULL ORDER BY r.hidden_at`);
  const recentReplies = db.prepare(`SELECT t.board AS board, COUNT(*) AS count FROM community_replies r
    JOIN community_topics t ON t.id = r.topic_id
    WHERE r.deleted_at IS NULL AND r.hidden_at IS NULL AND t.deleted_at IS NULL AND t.pending = 0 AND t.hidden_at IS NULL AND r.created_at >= ? GROUP BY t.board`);
  const topicsCreatedSince = db.prepare('SELECT COUNT(*) AS count FROM community_topics WHERE author_kind = ? AND author_id = ? AND created_at >= ?');
  const repliesCreatedSince = db.prepare('SELECT COUNT(*) AS count FROM community_replies WHERE author_kind = ? AND author_id = ? AND created_at >= ?');
  const newTopicsSince = db.prepare('SELECT COUNT(*) AS count FROM community_topics WHERE created_at >= ? AND deleted_at IS NULL');
  const newRepliesSince = db.prepare('SELECT COUNT(*) AS count FROM community_replies WHERE created_at >= ? AND deleted_at IS NULL');
  const newBoardTopicsSince = db.prepare('SELECT COUNT(*) AS count FROM community_topics WHERE created_at >= ? AND deleted_at IS NULL AND board = ?');
  const newBoardRepliesSince = db.prepare(`SELECT COUNT(*) AS count FROM community_replies r JOIN community_topics t ON t.id = r.topic_id
    WHERE r.created_at >= ? AND r.deleted_at IS NULL AND t.deleted_at IS NULL AND t.board = ?`);
  const boardCounts = db.prepare(`SELECT board, COUNT(*) AS count FROM community_topics WHERE deleted_at IS NULL AND pending = 0 GROUP BY board`);
  const insertTopic = db.prepare(`INSERT INTO community_topics (id, board, author_kind, author_id, title, body, tags, meta, resource, pending, pending_reason, pinned, created_at, last_activity_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateTopic = db.prepare('UPDATE community_topics SET title = ?, body = ?, tags = ?, meta = ?, resource = ?, edited_at = ? WHERE id = ?');
  const updateTags = db.prepare('UPDATE community_topics SET tags = ?, edited_at = ? WHERE id = ?');
  const insertReply = db.prepare(`INSERT INTO community_replies (id, topic_id, author_kind, author_id, body, quote_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const updateReply = db.prepare('UPDATE community_replies SET body = ?, edited_at = ? WHERE id = ?');
  const insertRevision = db.prepare(`INSERT INTO community_revisions (id, target_kind, target_id, title, body, tags, editor_kind, editor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const bumpTopic = db.prepare('UPDATE community_topics SET reply_count = reply_count + 1, last_activity_at = ? WHERE id = ?');
  const dropReplyCount = db.prepare('UPDATE community_topics SET reply_count = MAX(0, reply_count - 1) WHERE id = ?');
  const removeTopic = db.prepare('UPDATE community_topics SET deleted_at = ?, deleted_reason = ? WHERE id = ? AND deleted_at IS NULL');
  const removeReply = db.prepare('UPDATE community_replies SET deleted_at = ?, deleted_reason = ? WHERE id = ? AND deleted_at IS NULL');
  const setPinned = db.prepare('UPDATE community_topics SET pinned = ?, paid_pin_until = CASE WHEN ? = 0 THEN NULL ELSE paid_pin_until END WHERE id = ?');
  const setFeatured = db.prepare('UPDATE community_topics SET featured = ?, featured_at = CASE WHEN ? = 1 THEN COALESCE(featured_at, ?) ELSE featured_at END, badge_featured_since=? WHERE id = ?');
  const setLocked = db.prepare('UPDATE community_topics SET locked = ? WHERE id = ?');
  const setBoard = db.prepare("UPDATE community_topics SET board = ?, badge_visible_since=CASE WHEN board='vip' OR ?='vip' THEN ? ELSE badge_visible_since END WHERE id = ?");
  const setAccepted = db.prepare('UPDATE community_topics SET accepted_reply_id = ?, accepted_at = ? WHERE id = ?');
  const approve = db.prepare('UPDATE community_topics SET pending = 0, pending_reason = NULL, created_at = ?, last_activity_at = ? WHERE id = ? AND pending = 1');
  const hideTopic = db.prepare('UPDATE community_topics SET hidden_at = ?, hidden_reason = ? WHERE id = ? AND hidden_at IS NULL');
  const showTopic = db.prepare('UPDATE community_topics SET badge_visible_since=CASE WHEN hidden_at IS NOT NULL THEN ? ELSE badge_visible_since END, hidden_at = NULL, hidden_reason = NULL WHERE id = ?');
  const hideReply = db.prepare('UPDATE community_replies SET hidden_at = ? WHERE id = ? AND hidden_at IS NULL');
  const showReply = db.prepare('UPDATE community_replies SET badge_visible_since=CASE WHEN hidden_at IS NOT NULL THEN ? ELSE badge_visible_since END, hidden_at = NULL WHERE id = ?');
  const replyAuthorsOf = db.prepare(`SELECT DISTINCT author_kind, author_id FROM community_replies WHERE topic_id = ? AND deleted_at IS NULL`);
  // Likes, bookmarks and views.
  const hasReaction = db.prepare('SELECT COUNT(*) AS count FROM community_reactions WHERE target_kind = ? AND target_id = ? AND member_kind = ? AND member_id = ?');
  const addReaction = db.prepare('INSERT OR IGNORE INTO community_reactions (target_kind, target_id, member_kind, member_id, created_at) VALUES (?, ?, ?, ?, ?)');
  const rememberBadgeEvent = db.prepare('INSERT OR IGNORE INTO community_badge_events(kind,source_id,actor_key,first_at) VALUES(?,?,?,?)');
  const dropReaction = db.prepare('DELETE FROM community_reactions WHERE target_kind = ? AND target_id = ? AND member_kind = ? AND member_id = ?');
  const countReactions = db.prepare('SELECT COUNT(*) AS count FROM community_reactions WHERE target_kind = ? AND target_id = ?');
  const hasBookmark = db.prepare('SELECT COUNT(*) AS count FROM community_bookmarks WHERE topic_id = ? AND member_kind = ? AND member_id = ?');
  const addBookmark = db.prepare('INSERT OR IGNORE INTO community_bookmarks (topic_id, member_kind, member_id, created_at) VALUES (?, ?, ?, ?)');
  const dropBookmark = db.prepare('DELETE FROM community_bookmarks WHERE topic_id = ? AND member_kind = ? AND member_id = ?');
  const countBookmarks = db.prepare('SELECT COUNT(*) AS count FROM community_bookmarks WHERE topic_id = ?');
  const bookmarkedIds = db.prepare('SELECT topic_id FROM community_bookmarks WHERE member_kind = ? AND member_id = ? ORDER BY created_at DESC');
  const addView = db.prepare('INSERT OR IGNORE INTO community_views (topic_id, viewer, day) VALUES (?, ?, ?)');
  const thanksOn = db.prepare(`SELECT COUNT(*) AS count FROM community_ledger WHERE reason = 'thank-out' AND ref_kind = ? AND ref_id = ?`);
  const thankedBy = db.prepare(`SELECT COUNT(*) AS count FROM community_ledger WHERE member_kind = ? AND member_id = ? AND reason = 'thank-out' AND ref_kind = ? AND ref_id = ?`);
  // Resource votes.
  const myVote = db.prepare('SELECT value FROM community_votes WHERE topic_id = ? AND member_kind = ? AND member_id = ?');
  const putVote = db.prepare(`INSERT INTO community_votes (topic_id, member_kind, member_id, value, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (topic_id, member_kind, member_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`);
  const dropVote = db.prepare('DELETE FROM community_votes WHERE topic_id = ? AND member_kind = ? AND member_id = ?');
  const voteCounts = db.prepare(`SELECT COALESCE(SUM(value = 'alive'), 0) AS alive, COALESCE(SUM(value = 'dead'), 0) AS dead FROM community_votes WHERE topic_id = ?`);
  // Images.
  const insertImage = db.prepare(`INSERT INTO community_images (id, uploader_kind, uploader_id, width, height, created_at, purpose, frame_ready, banner_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const oneImage = db.prepare('SELECT id, uploader_kind, uploader_id, topic_id, reply_id, width, height, created_at, deleted_at, purpose, frame_ready, banner_scope FROM community_images WHERE id = ?');
  const topicImages = db.prepare('SELECT id, width, height FROM community_images WHERE topic_id = ? AND reply_id IS NULL AND deleted_at IS NULL ORDER BY position');
  const replyImages = db.prepare('SELECT id, width, height FROM community_images WHERE topic_id = ? AND reply_id = ? AND deleted_at IS NULL ORDER BY position');
  const threadReplyImages = db.prepare(`SELECT i.id, i.width, i.height, i.reply_id FROM community_images i
    JOIN community_replies r ON r.id = i.reply_id AND r.topic_id = i.topic_id
    WHERE i.topic_id = ? AND i.deleted_at IS NULL AND r.deleted_at IS NULL ORDER BY i.position, i.rowid`);
  const attachImage = db.prepare('UPDATE community_images SET topic_id = ?, reply_id = ?, position = ? WHERE id = ?');
  const removeImage = db.prepare('UPDATE community_images SET deleted_at = ? WHERE id = ?');
  const imageUnreferenced = `NOT EXISTS (SELECT 1 FROM community_shop_items WHERE image = community_images.id)
    AND NOT EXISTS (SELECT 1 FROM community_banner_entries WHERE cover = community_images.id)
    AND NOT EXISTS (SELECT 1 FROM community_profile_backgrounds WHERE approved_image = community_images.id OR pending_image = community_images.id)`;
  const staleImages = db.prepare(`SELECT id FROM community_images WHERE topic_id IS NULL AND reply_id IS NULL AND deleted_at IS NULL AND created_at < ? AND ${imageUnreferenced}`);
  const dropImage = db.prepare(`DELETE FROM community_images WHERE id = ? AND topic_id IS NULL AND reply_id IS NULL AND ${imageUnreferenced}`);
  const unusedProfileImage = db.prepare(`SELECT id FROM community_images WHERE id=? AND purpose='profile' AND topic_id IS NULL AND reply_id IS NULL AND ${imageUnreferenced}`);
  const queueImageFiles = (id: string, reason: string) => {
    queueFile?.(`community-image-${id}.webp`, reason);
    queueFile?.(`community-thumb-${id}.webp`, reason);
  };
  // Reports.
  const insertReport = db.prepare(`INSERT INTO community_reports (id, target_kind, target_id, reporter_kind, reporter_id, reporter_level, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const openReportBy = db.prepare(`SELECT COUNT(*) AS count FROM community_reports WHERE target_kind = ? AND target_id = ? AND reporter_kind = ? AND reporter_id = ? AND status = 'open'`);
  const openReportsFrom = db.prepare(`SELECT COUNT(*) AS count FROM community_reports WHERE target_kind = ? AND target_id = ? AND status = 'open' AND reporter_level >= ?`);
  const openReports = db.prepare(`SELECT id, target_kind, target_id, reporter_kind, reporter_id, reason, note, created_at FROM community_reports WHERE status = 'open' ORDER BY created_at`);
  const oneReport = db.prepare(`SELECT id, target_kind, target_id, reporter_kind, reporter_id, status FROM community_reports WHERE id = ?`);
  const reportsOn = db.prepare(`SELECT id, reporter_kind, reporter_id FROM community_reports WHERE target_kind = ? AND target_id = ? AND status = 'open'`);
  const closeReport = db.prepare(`UPDATE community_reports SET status = ?, resolved_at = ? WHERE id = ?`);

  const byActivity = <T extends { lastActivityAt: string }>(list: T[]) => [...list].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  const listed = (row: TopicRow, now = Date.now()): StoredTopic => {
    const paidPin = Boolean(row.paid_pin_until && Date.parse(row.paid_pin_until) > now);
    const meta = parseJson<ShowcaseMeta | null>(row.meta, null);
    const resource = parseJson<ResourceMeta | null>(row.resource, null);
    return {
      id: row.id, board: row.board, title: displayTitle(row.title, row.excerpt), hasTitle: Boolean(row.title), author: { kind: row.author_kind, id: row.author_id },
      createdAt: row.created_at, lastActivityAt: row.last_activity_at, replies: row.reply_count,
      likes: Number(row.likes), views: Number(row.views), pinned: Boolean(row.pinned), paidPin, featured: Boolean(row.featured),
      tags: parseJson<string[]>(row.tags, []), thumbs: row.thumbs ? row.thumbs.split(',') : [],
      solved: Boolean(row.accepted_reply_id), edited: Boolean(row.edited_at), locked: Boolean(row.locked),
      glow: Boolean(row.glow_until && Date.parse(row.glow_until) > now), bounty: row.bounty_state === 'open' || row.bounty_state === 'paid' ? row.bounty : 0,
      bountyState: row.bounty_state, pending: Boolean(row.pending), hidden: Boolean(row.hidden_at),
      excerpt: row.excerpt,
      meta: meta && { tools: meta.tools, model: meta.model, usage: meta.usage, promptMode: meta.promptMode, price: meta.price },
      resource: resource && { ...resource, alive: Number(row.alive), dead: Number(row.dead) },
      lastReply: row.last_kind && row.last_id && row.last_at ? { author: { kind: row.last_kind, id: row.last_id }, at: row.last_at } : null,
    };
  };
  const all = ({ board, query, tag, author, following }: { board?: string; query?: string; tag?: string; author?: CommunityAuthor; following?: readonly CommunityAuthor[] } = {}) => (liveTopics.all({
    board: board || null, tag: tag || null, authorKind: author?.kind ?? null, authorId: author?.id ?? null,
    pattern: query ? `%${query.replace(/[\\%_]/g, '\\$&')}%` : null,
  }) as TopicRow[]).map(row => listed(row)).filter(topic => !following || following.some(member => same(member, topic.author)));
  const topicRow = (id: string) => oneTopic.get(id) as (TopicRow & { body: string }) | undefined;
  const replyRow = (id: string) => oneReply.get(id) as ReplyRow | undefined;
  const authorOf = (row: { author_kind: Kind; author_id: string }): CommunityAuthor => ({ kind: row.author_kind, id: row.author_id });
  const notify = (member: CommunityAuthor, notice: Notice, now: string) => members.notify(member, notice, now);

  function saveImages(topicId: string, author: CommunityAuthor, images: readonly string[], now: string, replyId: string | null = null) {
    const current = ((replyId ? replyImages.all(topicId, replyId) : topicImages.all(topicId)) as Array<{ id: string }>).map(image => image.id);
    for (const id of images) {
      const image = oneImage.get(id) as { uploader_kind: Kind; uploader_id: string; topic_id: string | null; reply_id: string | null; deleted_at: string | null; purpose: string } | undefined;
      const attachedHere = image?.topic_id === topicId && image.reply_id === replyId;
      const ownsUpload = image?.uploader_kind === author.kind && image.uploader_id === author.id;
      if (!image || image.purpose !== 'content' || image.deleted_at || (!ownsUpload && !current.includes(id)) || (image.topic_id && !attachedHere))
        throw fail('图片已失效，请重新上传。');
    }
    // Images taken out of a post are soft-deleted like the post itself would be.
    for (const id of current) if (!images.includes(id)) removeImage.run(now, id);
    images.forEach((id, position) => attachImage.run(topicId, replyId, position, id));
  }
  // Publishing earns the configured daily topic award and the first-topic badge.
  function published(topicId: string, author: CommunityAuthor, now: string) {
    const earned = ledger.reward(author, rules.topicReward, 'topic', { kind: 'topic', id: topicId }, now, rules.topicDaily);
    experience.reward(author, 'topic', { kind: 'topic', id: topicId }, now);
    members.checkBadges(author, now);
    return earned;
  }
  // A moderated deletion (by the owner or a steward, of someone else's content) costs the author a penalty.
  function deleteTopicIn(id: string, { moderated = false, penalty = moderated, reason = '', note = '', now }: { moderated?: boolean; penalty?: boolean; reason?: string; note?: string; now: string }) {
    const row = topicRow(id);
    if (!row || !Number(removeTopic.run(now, reason || null, id).changes)) return false;
    experience.revert({ kind: 'topic', id }, now);
    ledger.revert({ kind: 'topic', id }, now);
    ledger.revert({ kind: 'topic', id: `featured:${id}` }, now);
    const author = authorOf(row);
    // The asker gets half of an unclaimed bounty back.
    const refund = economy.refundBounty(id, now);
    if (refund) notify(author, { type: 'system', topicId: id, text: '悬赏退回一半', data: { refund: refund.amount } }, now);
    if (moderated) {
      // Rejecting a post that was never public is not a violation.
      if (!row.pending && penalty) ledger.penalise(author, { kind: 'topic', id }, now);
      notify(author, { type: row.pending ? 'review' : 'penalty', text: row.pending ? `你的帖子没有通过审核：${reason || '其他'}。有异议可以在站务反馈发帖。` : `你的帖子因违规被删除：${reason}`, data: { what: 'topic', title: displayTitle(row.title, row.body), state: row.pending ? 'rejected' : undefined, reason: reason || '其他', note, penalty: row.pending || !penalty ? 0 : rules.penalty }, link: row.pending ? '#/community/boards/meta' : undefined }, now);
    } else if (reason) {
      notify(author, { type: 'system', text: `你的帖子已被删除：${reason}`, data: { what: 'topic', title: displayTitle(row.title, row.body), reason } }, now);
    }
    for (const report of reportsOn.all('topic', id) as Array<{ id: string }>) closeReport.run(moderated ? 'upheld' : 'dismissed', now, report.id);
    return true;
  }
  function deleteReplyIn(id: string, { moderated = false, penalty = moderated, reason = '', now }: { moderated?: boolean; penalty?: boolean; reason?: string; now: string }) {
    const row = replyRow(id);
    if (!row || !Number(removeReply.run(now, reason || null, id).changes)) return false;
    experience.revert({ kind: 'reply', id }, now);
    dropReplyCount.run(row.topic_id);
    ledger.revert({ kind: 'reply', id }, now);
    const topic = topicRow(row.topic_id);
    if (topic?.accepted_reply_id === id) setAccepted.run(null, null, row.topic_id);
    if (moderated) {
      if (penalty) ledger.penalise(authorOf(row), { kind: 'reply', id }, now);
      notify(authorOf(row), { type: 'penalty', topicId: row.topic_id, text: `你的一条回复因违规被删除：${reason}`, data: { what: 'reply', reason, penalty: penalty ? rules.penalty : 0 } }, now);
    } else if (reason) {
      notify(authorOf(row), { type: 'system', topicId: row.topic_id, text: `你的一条回复已被删除：${reason}`, data: { what: 'reply', reason } }, now);
    }
    for (const report of reportsOn.all('reply', id) as Array<{ id: string }>) closeReport.run(moderated ? 'upheld' : 'dismissed', now, report.id);
    return true;
  }

  return {
    ledger,
    experience,
    members,
    staff,
    featureRecommendations,
    convention,
    economy,
    banners,
    profileBackgrounds,
    requests,
    rateLimits,
    audit,
    transaction: tx,

    /* ---------- 帖子与回复 ---------- */
    createTopic({ board, author, title, body, tags = [], images = [], bounty = 0, meta = null, resource = null, pending = null, pin = false, now = new Date().toISOString() }: NewTopic) {
      return tx(() => {
        const id = randomUUID();
        insertTopic.run(id, board, author.kind, author.id, title, body, JSON.stringify(tags), meta ? JSON.stringify(meta) : null, resource ? JSON.stringify(resource) : null,
          pending ? 1 : 0, pending, pin ? 1 : 0, now, now);
        saveImages(id, author, images, now);
        if (bounty > 0) economy.freezeBounty(id, author, bounty, now);
        const earned = pending ? 0 : published(id, author, now);
        if (pending) notify(author, { type: 'review', topicId: id, text: '你的帖子正在等站长审核', data: { state: 'pending', title: displayTitle(title, body) } }, now);
        return { id, earned, pending: Boolean(pending) };
      });
    },
    // Review: a pending topic goes live now, earning as if just posted.
    approveTopic(id: string, now = new Date().toISOString()) {
      return tx(() => {
        const row = topicRow(id);
        if (!row || !Number(approve.run(now, now, id).changes)) throw fail('这个帖子不在待审列表里。', 409);
        const author = authorOf(row);
        const earned = published(id, author, now);
        notify(author, { type: 'review', topicId: id, text: '你的帖子通过了审核', data: { state: 'approved', title: displayTitle(row.title, row.body) } }, now);
        return { earned, author };
      });
    },
    // A review rejection is recorded separately from a violation deletion: it never penalises the author.
    rejectTopic(id: string, reason: string, note = '', now = new Date().toISOString()) {
      return tx(() => {
        const row = topicRow(id);
        if (!row || !row.pending || !Number(removeTopic.run(now, reason, id).changes)) throw fail('这个帖子不在待审列表里。', 409);
        const author = authorOf(row);
        notify(author, {
          type: 'review', topicId: id,
          text: `你的帖子没有通过审核：${reason}。有异议可以在站务反馈发帖。`,
          data: { what: 'topic', title: displayTitle(row.title, row.body), state: 'rejected', reason, note },
          link: '#/community/boards/meta',
        }, now);
        return { author };
      });
    },
    editTopic(id: string, { title, body, tags = [], images = [], meta = null, resource = null, clearResource = false, editor, now = new Date().toISOString() }:
      { title: string; body: string; tags?: readonly string[]; images?: readonly string[]; meta?: ShowcaseMeta | null; resource?: ResourceMeta | null; clearResource?: boolean; editor: CommunityAuthor; now?: string }) {
      return tx(() => {
        const row = topicRow(id);
        if (!row) throw fail('帖子不存在，或已被删除。', 404);
        insertRevision.run(randomUUID(), 'topic', id, row.title, row.body, row.tags, editor.kind, editor.id, now);
        updateTopic.run(title, body, JSON.stringify(tags), meta ? JSON.stringify(meta) : row.meta, resource ? JSON.stringify(resource) : clearResource ? null : row.resource, now, id);
        saveImages(id, authorOf(row), images, now);
        return true;
      });
    },
    // 守夜以上可以改别人帖子的标签。
    retag(id: string, tags: readonly string[], editor: CommunityAuthor, now = new Date().toISOString()) {
      return tx(() => {
        const row = topicRow(id);
        if (!row) throw fail('帖子不存在，或已被删除。', 404);
        insertRevision.run(randomUUID(), 'topic', id, row.title, row.body, row.tags, editor.kind, editor.id, now);
        updateTags.run(JSON.stringify(tags), now, id);
      });
    },
    addReply({ topicId, author, body, images = [], quoteId = null, now = new Date().toISOString() }: { topicId: string; author: CommunityAuthor; body: string; images?: readonly string[]; quoteId?: string | null; now?: string }) {
      return tx(() => {
        const topic = topicRow(topicId);
        if (!topic) throw fail('帖子不存在，或已被删除。', 404);
        if (topic.locked) throw fail('这个帖子已锁定，不能再回复。', 409);
        const quoted = quoteId ? replyRow(quoteId) : null;
        if (quoteId && (!quoted || quoted.topic_id !== topicId)) throw fail('引用的回复已不存在。');
        const id = randomUUID();
        insertReply.run(id, topicId, author.kind, author.id, body, quoted ? quoteId : null, now);
        saveImages(topicId, author, images, now, id);
        bumpTopic.run(now, topicId);
        // Only substantive replies on someone else's topic earn 星尘.
        const own = same(authorOf(topic), author);
        const earned = !own && [...bodyImageContent(body).text.trim()].length >= rules.replyMinLength
          ? ledger.reward(author, rules.replyReward, 'reply', { kind: 'reply', id }, now, rules.replyDaily) : 0;
        experience.reward(author, 'reply', { kind: 'reply', id }, now);
        const told: CommunityAuthor[] = [author];
        const tell = (member: CommunityAuthor, notice: Notice) => { if (told.some(item => same(item, member))) return; told.push(member); notify(member, notice, now); };
        tell(authorOf(topic), { type: 'reply', actor: author, topicId, replyId: id, text: '回复了你的主题', data: { kind: 'topic' } });
        if (quoted) tell(authorOf(quoted), { type: 'reply', actor: author, topicId, replyId: id, text: '回复了你', data: { kind: 'quote' } });
        return { id, earned, told };
      });
    },
    editReply(id: string, { body, images, editor, now = new Date().toISOString() }: { body: string; images?: readonly string[]; editor: CommunityAuthor; now?: string }) {
      return tx(() => {
        const row = replyRow(id);
        if (!row) throw fail('回复不存在，或已被删除。', 404);
        insertRevision.run(randomUUID(), 'reply', id, null, row.body, null, editor.kind, editor.id, now);
        updateReply.run(body, now, id);
        if ([...bodyImageContent(body).text.trim()].length < rules.replyMinLength) experience.revert({ kind: 'reply', id }, now);
        saveImages(row.topic_id, editor, images ?? bodyImageContent(body).images, now, id);
        return true;
      });
    },
    // The community is small: sorting reuses the same rules as the browser.
    listTopics({ board, query, tag, author, following, sort, page, pageSize }: { board?: string; query?: string; tag?: string; author?: CommunityAuthor; following?: readonly CommunityAuthor[]; sort: CommunitySort; page: number; pageSize: number }) {
      const sorted = sortTopics(all({ board, query, tag, author, following }), sort);
      const start = (page - 1) * pageSize;
      return { items: sorted.slice(start, start + pageSize), total: sorted.length, page, pageSize };
    },
    topics(ids: readonly string[]) {
      return ids.map(id => topicRow(id)).filter((row): row is TopicRow & { body: string } => Boolean(row && !row.pending && !row.hidden_at)).map(row => listed(row));
    },
    topic(id: string) {
      const row = topicRow(id);
      if (!row) return null;
      const replyRows = topicReplies.all(id) as ReplyRow[];
      // Hidden replies remain available for the service's viewer-specific mask;
      // deleted replies and images never enter the detail. Read attachments once
      // per fresh detail, retaining each reply's position and insertion order.
      const imagesByReply = new Map<string, Array<{ id: string; width: number; height: number }>>();
      if (replyRows.length) {
        for (const image of threadReplyImages.all(id) as Array<{ id: string; width: number; height: number; reply_id: string }>) {
          const images = imagesByReply.get(image.reply_id) || [];
          images.push({ id: image.id, width: image.width, height: image.height });
          imagesByReply.set(image.reply_id, images);
        }
      }
      const replies = replyRows.map(reply => ({
        id: reply.id, author: authorOf(reply), body: reply.body, createdAt: reply.created_at,
        images: imagesByReply.get(reply.id) || [],
        edited: Boolean(reply.edited_at), likes: Number(reply.likes), quoteId: reply.quote_id, hidden: Boolean(reply.hidden_at),
      }));
      const vote = voteCounts.get(id) as { alive: number; dead: number };
      return {
        ...listed(row), body: row.body, replyCount: row.reply_count, replies, acceptedReplyId: row.accepted_reply_id,
        rawTitle: row.title, fullMeta: parseJson<ShowcaseMeta | null>(row.meta, null), pendingReason: row.pending_reason, hiddenReason: row.hidden_reason,
        votes: { alive: Number(vote.alive), dead: Number(vote.dead) },
        images: topicImages.all(id) as Array<{ id: string; width: number; height: number }>,
        bookmarks: countOf(countBookmarks, id), thanks: countOf(thanksOn, 'topic', id), unlocks: economy.unlockCount(id),
      };
    },
    reply(id: string) {
      const row = replyRow(id);
      return row ? { id: row.id, topicId: row.topic_id, body: row.body, createdAt: row.created_at, author: authorOf(row), hidden: Boolean(row.hidden_at) } : null;
    },
    memberReplies(member: CommunityAuthor) {
      return (memberReplies.all(member.kind, member.id) as Array<{ id: string; topic_id: string; body: string; created_at: string; title: string; topic_body: string; board: string; likes: number }>)
        .map(row => ({ id: row.id, topicId: row.topic_id, topicTitle: displayTitle(row.title, row.topic_body), board: row.board, body: row.body, createdAt: row.created_at, likes: Number(row.likes), images: replyImages.all(row.topic_id, row.id) as Array<{ id: string; width: number; height: number }> }));
    },
    // Per-board totals, replies in the last 24 hours, the latest topic, tags, and today's check-ins.
    summary({ limit = 5, now = Date.now(), hiddenBoard = '' }: { limit?: number; now?: number; hiddenBoard?: string } = {}) {
      const topics = byActivity(all()).filter(topic => topic.board !== hiddenBoard);
      const boards: Record<string, BoardStats> = {};
      for (const topic of topics) {
        const board = boards[topic.board] ||= { topics: 0, repliesToday: 0, latest: { id: topic.id, title: topic.title, lastActivityAt: topic.lastActivityAt } };
        board.topics++;
      }
      for (const row of recentReplies.all(iso(now - day)) as Array<{ board: string; count: number }>)
        if (boards[row.board]) boards[row.board].repliesToday = Number(row.count);
      const tags: Record<string, number> = {};
      for (const topic of topics) for (const tag of topic.tags || []) tags[tag] = (tags[tag] || 0) + 1;
      const hot = sortTopics(topics.filter(topic => !topic.pinned), 'hot', now).slice(0, limit);
      return { boards, hot, tags, checkinsToday: economy.checkinsToday(now) };
    },
    authorStats(author: CommunityAuthor) {
      const value = members.stats(author);
      return { topics: value.topics, replies: value.replies, likes: value.likesRecv, accepted: value.accepted, featured: value.featured };
    },
    // Other recently active topics in the same board.
    related(topic: { id: string; board: string }, limit = 4) {
      return byActivity(all({ board: topic.board })).filter(item => item.id !== topic.id).slice(0, limit);
    },
    // Posting today: L0 limits and the owner's data tab.
    postedToday(member: CommunityAuthor, now = Date.now()) {
      const since = iso(Date.parse(`${beijingDay(now)}T00:00:00+08:00`));
      return { topics: countOf(topicsCreatedSince, member.kind, member.id, since), replies: countOf(repliesCreatedSince, member.kind, member.id, since) };
    },
    activity(now = Date.now(), boards?: readonly string[]) {
      const since = iso(now - day);
      const scope = boards === undefined ? null : [...new Set(boards)];
      return {
        topics24h: scope ? scope.reduce((total, board) => total + countOf(newBoardTopicsSince, since, board), 0) : countOf(newTopicsSince, since),
        replies24h: scope ? scope.reduce((total, board) => total + countOf(newBoardRepliesSince, since, board), 0) : countOf(newRepliesSince, since),
        boards: Object.fromEntries((boardCounts.all() as Array<{ board: string; count: number }>).filter(row => !scope || scope.includes(row.board)).map(row => [row.board, Number(row.count)])),
      };
    },
    deleteTopic(id: string, { moderated = false, penalty = moderated, reason = '', note = '', now = new Date().toISOString() }: { moderated?: boolean; penalty?: boolean; reason?: string; note?: string; now?: string } = {}) {
      return tx(() => deleteTopicIn(id, { moderated, penalty, reason, note, now }));
    },
    deleteReply(id: string, { moderated = false, penalty = moderated, reason = '', now = new Date().toISOString() }: { moderated?: boolean; penalty?: boolean; reason?: string; now?: string } = {}) {
      return tx(() => deleteReplyIn(id, { moderated, penalty, reason, now }));
    },
    // Permanent account cleanup is separate from reversible moderation deletes.
    purgeReaderData(readerId: string, queueFile: (filename: string, reason: string) => void) {
      return tx(() => purgeCommunityReaderData(db, readerId, { queueFile, cancelOrder: id => economy.cancel(id) }));
    },
    participants(topicId: string) {
      return (replyAuthorsOf.all(topicId) as Array<{ author_kind: Kind; author_id: string }>).map(authorOf);
    },

    /* ---------- 赞、收藏、浏览 ---------- */
    // Likes remain visible recognition. The legacy rewarding option cannot issue currency.
    like(target: Target, member: CommunityAuthor, on: boolean, { now = new Date().toISOString() }: { rewarding?: boolean; now?: string } = {}) {
      return tx(() => {
        const row = target.kind === 'topic' ? topicRow(target.id) : replyRow(target.id);
        if (!row) throw fail(target.kind === 'topic' ? '帖子不存在，或已被删除。' : '回复不存在，或已被删除。', 404);
        const author = authorOf(row);
        if (same(author, member)) throw fail('不能给自己点赞。');
        if (on) {
          rememberBadgeEvent.run('reaction', `${target.kind}:${target.id}`, `${member.kind}:${member.id}`, now);
          const added = Number(addReaction.run(target.kind, target.id, member.kind, member.id, now).changes) > 0;
          const topicId = target.kind === 'topic' ? target.id : (row as ReplyRow).topic_id;
          if (added) {
            notify(author, { type: 'like', actor: member, topicId, replyId: target.kind === 'reply' ? target.id : null, text: target.kind === 'topic' ? '赞了你的主题' : '赞了你的回复',
              data: { what: target.kind }, group: `like:${target.kind}:${target.id}:${beijingDay(Date.parse(now))}` }, now);
            members.checkBadges(author, now);
          }
        } else dropReaction.run(target.kind, target.id, member.kind, member.id);
        return { likes: countOf(countReactions, target.kind, target.id), liked: on, earned: 0 };
      });
    },
    liked: (target: Target, member: CommunityAuthor) => countOf(hasReaction, target.kind, target.id, member.kind, member.id) > 0,
    bookmark(topicId: string, member: CommunityAuthor, on: boolean, now = new Date().toISOString()) {
      if (on) addBookmark.run(topicId, member.kind, member.id, now);
      else dropBookmark.run(topicId, member.kind, member.id);
      return countOf(countBookmarks, topicId);
    },
    bookmarked: (topicId: string, member: CommunityAuthor) => countOf(hasBookmark, topicId, member.kind, member.id) > 0,
    bookmarks: (member: CommunityAuthor) => (bookmarkedIds.all(member.kind, member.id) as Array<{ topic_id: string }>).map(row => row.topic_id),
    view(topicId: string, viewer: CommunityAuthor, now = Date.now()) {
      addView.run(topicId, `${viewer.kind}:${viewer.id}`, beijingDay(now));
      members.visit(viewer, now);
    },

    /* ---------- 资源帖：仍可用 / 已失效 ---------- */
    vote(topicId: string, member: CommunityAuthor, value: 'alive' | 'dead' | null, now = new Date().toISOString()) {
      return tx(() => {
        const row = topicRow(topicId);
        if (!row || row.board !== 'tools') throw fail('只有资源帖可以投票。', 404);
        const before = (myVote.get(topicId, member.kind, member.id) as { value: string } | undefined)?.value;
        if (value) putVote.run(topicId, member.kind, member.id, value, now); else dropVote.run(topicId, member.kind, member.id);
        if (value === 'dead' && before !== 'dead')
          notify(authorOf(row), { type: 'system', actor: member, topicId, text: '反馈你推荐的资源已失效，请检查链接', data: { dead: true } }, now);
        const counts = voteCounts.get(topicId) as { alive: number; dead: number };
        return { vote: value, alive: Number(counts.alive), dead: Number(counts.dead) };
      });
    },
    myVote: (topicId: string, member: CommunityAuthor) => ((myVote.get(topicId, member.kind, member.id) as { value: 'alive' | 'dead' } | undefined)?.value) || null,

    /* ---------- 采纳、悬赏 ---------- */
    accept(replyId: string, now = new Date().toISOString()) {
      return tx(() => {
        const reply = replyRow(replyId);
        if (!reply) throw fail('回复不存在，或已被删除。', 404);
        const topic = topicRow(reply.topic_id);
        if (!topic) throw fail('帖子不存在，或已被删除。', 404);
        if (topic.accepted_reply_id) throw fail('这个问题已经采纳过回答了。', 409);
        if (same(authorOf(topic), authorOf(reply))) throw fail('不能采纳自己的回答。');
        setAccepted.run(replyId, now, topic.id);
        experience.reward(authorOf(reply), 'accepted', { kind: 'reply', id: replyId }, now);
        const answerer = authorOf(reply);
        rememberBadgeEvent.run('acceptance', topic.id, `${answerer.kind}:${answerer.id}`, now);
        const bounty = economy.payBounty(topic.id, answerer, now);
        const reward = ledger.reward(answerer, rules.acceptReward, 'accepted', { kind: 'reply', id: replyId }, now, rules.acceptDaily);
        notify(answerer, { type: 'accept', actor: authorOf(topic), topicId: topic.id, replyId, text: '采纳了你的回答', data: { amount: bounty + reward } }, now);
        members.checkBadges(answerer, now);
        return bounty + reward;
      });
    },
    // Unclaimed bounties older than 7 days: half goes back to the asker.
    expireBounties(now = Date.now()) {
      return tx(() => {
        let expired = 0;
        for (const id of economy.expiredBounties(now)) {
          const refund = economy.refundBounty(id, iso(now));
          if (!refund) continue;
          expired++;
          notify(refund.author, { type: 'system', topicId: id, text: '悬赏 7 天没人采纳，退回一半', data: { refund: refund.amount } }, iso(now));
        }
        return expired;
      });
    },

    /* ---------- 管理：置顶、精华、锁帖、移动、审核、隐藏 ---------- */
    setPinned(id: string, on: boolean) { return Number(setPinned.run(on ? 1 : 0, on ? 1 : 0, id).changes) > 0; },
    // Only a topic's first feature can award stars, subject to the author's monthly quota.
    setFeatured(id: string, on: boolean, { actor = null, now = new Date().toISOString() }: { actor?: CommunityAuthor | null; now?: string } = {}) {
      return tx(() => {
        const row = topicRow(id);
        if (!row || Boolean(row.featured) === on) return false;
        setFeatured.run(on ? 1 : 0, on ? 1 : 0, now, on ? now : null, id);
        const ref = { kind: 'topic', id: `featured:${id}` };
        const author = authorOf(row);
        if (on) {
          const earned = row.featured_at ? 0 : ledger.feature(author, ref, now);
          notify(author, { type: 'feature', actor, topicId: id, text: '把你的主题评为精华', data: { amount: earned } }, now);
          members.checkBadges(author, now);
        } else ledger.revert(ref, now);
        return true;
      });
    },
    setLocked(id: string, on: boolean) { return Number(setLocked.run(on ? 1 : 0, id).changes) > 0; },
    move(id: string, board: string, now = new Date().toISOString()) {
      return tx(() => {
        const row = topicRow(id);
        if (!row) throw fail('帖子不存在，或已被删除。', 404);
        if (row.board === board) return false;
        setBoard.run(board, board, now, id);
        if (board === 'vip') experience.revert({ kind: 'topic', id }, now);
        notify(authorOf(row), { type: 'system', topicId: id, text: '你的帖子被移动到了其他版块', data: { moved: board } }, now);
        return true;
      });
    },
    hide(target: Target, reason: string, now = new Date().toISOString()) {
      return tx(() => {
        const changed = target.kind === 'topic' ? Number(hideTopic.run(now, reason, target.id).changes) > 0 : Number(hideReply.run(now, target.id).changes) > 0;
        if (changed) experience.revert(target, now);
        return changed;
      });
    },
    restore(target: Target, now = new Date().toISOString()) {
      if (target.kind === 'topic') showTopic.run(now, target.id); else showReply.run(now, target.id);
      for (const report of reportsOn.all(target.kind, target.id) as Array<{ id: string }>) closeReport.run('dismissed', now, report.id);
    },
    // The review queue: pending topics, and topics and replies hidden after reports.
    queue() {
      const topics = (queuedTopics.all() as Array<TopicRow & { body: string }>).map(row => ({
        ...listed(row), body: row.body, pendingReason: row.pending_reason, hiddenReason: row.hidden_reason,
      }));
      const replies = (hiddenReplies.all() as Array<{ id: string; topic_id: string; author_kind: Kind; author_id: string; body: string; created_at: string; hidden_at: string; title: string; topic_body: string }>)
        .map(row => ({ id: row.id, topicId: row.topic_id, topicTitle: displayTitle(row.title, row.topic_body), author: authorOf(row), body: row.body, createdAt: row.created_at, hiddenAt: row.hidden_at }));
      return { topics, replies };
    },

    /* ---------- 感谢 ---------- */
    thank(target: Target, from: CommunityAuthor, to: CommunityAuthor, now = new Date().toISOString()) {
      return tx(() => {
        if (same(from, to)) throw fail('不能感谢自己。');
        if (countOf(thankedBy, from.kind, from.id, target.kind, target.id)) throw fail('你已经感谢过了。', 409);
        ledger.debit(from, rules.thankCost, 'thank-out', target, now, 'out');
        ledger.credit(to, rules.thankToAuthor, 'thank-in', target, now, 'in');
        const topicId = target.kind === 'topic' ? target.id : replyRow(target.id)?.topic_id ?? null;
        notify(to, { type: 'thank', actor: from, topicId, replyId: target.kind === 'reply' ? target.id : null, text: '感谢了你', data: { amount: rules.thankToAuthor, what: target.kind } }, now);
        return { balance: ledger.balance(from), thanks: countOf(thanksOn, target.kind, target.id) };
      });
    },
    thanked: (target: Target, member: CommunityAuthor) => countOf(thankedBy, member.kind, member.id, target.kind, target.id) > 0,
    thanks: (target: Target) => countOf(thanksOn, target.kind, target.id),

    /* ---------- 图片 ---------- */
    addImage({ id, uploader, width, height, purpose = 'content', frameReady = false, bannerScope = null, now = new Date().toISOString() }: { id: string; uploader: CommunityAuthor; width: number; height: number; purpose?: 'content' | 'shop' | 'banner' | 'profile'; frameReady?: boolean; bannerScope?: string | null; now?: string }) {
      insertImage.run(id, uploader.kind, uploader.id, width, height, now, purpose, frameReady ? 1 : 0, bannerScope);
    },
    image(id: string) {
      return (oneImage.get(id) as { id: string; uploader_kind: Kind; uploader_id: string; topic_id: string | null; reply_id: string | null; width: number; height: number; created_at: string; deleted_at: string | null; purpose: 'content' | 'shop' | 'banner' | 'profile'; frame_ready: number; banner_scope: string | null } | undefined) || null;
    },
    // Uploads never attached to a post within a day are removed; returns their ids so the files go too.
    sweepImages(now = Date.now()) {
      return tx(() => {
        const ids = (staleImages.all(iso(now - day)) as Array<{ id: string }>).map(row => row.id);
        return ids.filter(id => {
          queueImageFiles(id, 'unattached-community-upload');
          return dropImage.run(id).changes === 1;
        });
      });
    },

    /* ---------- 举报 ---------- */
    report({ target, reporter, reporterLevel = 0, reason, note = '', now = new Date().toISOString() }: { target: Target; reporter: CommunityAuthor; reporterLevel?: number; reason: string; note?: string; now?: string }) {
      if (countOf(openReportBy, target.kind, target.id, reporter.kind, reporter.id)) throw fail('你已经举报过了，站长会尽快处理。', 409);
      const id = randomUUID();
      insertReport.run(id, target.kind, target.id, reporter.kind, reporter.id, reporterLevel, reason, note, now);
      return { id };
    },
    // Open reports on the target from members of at least the given level.
    reportsFrom: (target: Target, level: number) => countOf(openReportsFrom, target.kind, target.id, level),
    openReports() {
      return (openReports.all() as Array<{ id: string; target_kind: 'topic' | 'reply'; target_id: string; reporter_kind: Kind; reporter_id: string; reason: string; note: string; created_at: string }>)
        .map(row => ({ id: row.id, target: { kind: row.target_kind, id: row.target_id }, reporter: { kind: row.reporter_kind, id: row.reporter_id } as CommunityAuthor, reason: row.reason, note: row.note, createdAt: row.created_at }));
    },
    // Upholding removes the content (with the penalty) and notifies every open reporter;
    // dismissing closes this report and shows the content again if nothing else holds it.
    resolveReport(id: string, uphold: boolean, now = new Date().toISOString(), decisionReason = '', penalty = true) {
      return tx(() => {
        const report = oneReport.get(id) as { id: string; target_kind: 'topic' | 'reply'; target_id: string; status: string; reason: string } | undefined;
        if (!report || report.status !== 'open') throw fail('这条举报已经处理过了。', 404);
        const target = { kind: report.target_kind, id: report.target_id };
        if (!uphold) {
          closeReport.run('dismissed', now, id);
          if (!countOf(openReportsFrom, target.kind, target.id, 0)) { if (target.kind === 'topic') showTopic.run(now, target.id); else showReply.run(now, target.id); }
          return { removed: false };
        }
        const reporters = reportsOn.all(target.kind, target.id) as Array<{ id: string; reporter_kind: Kind; reporter_id: string }>;
        const reason = decisionReason || `举报成立：${report.reason}`;
        const removed = target.kind === 'topic' ? deleteTopicIn(target.id, { moderated: true, penalty, reason, now }) : deleteReplyIn(target.id, { moderated: true, penalty, reason, now });
        for (const row of reporters) {
          closeReport.run('upheld', now, row.id);
          const reporter = { kind: row.reporter_kind, id: row.reporter_id };
          notify(reporter, { type: 'system', text: '你的举报成立', data: { report: 'upheld', amount: 0 } }, now);
        }
        return { removed };
      });
    },
    close() { db.close(); },
  };
}
export type CommunityStore = ReturnType<typeof createCommunityStore>;
