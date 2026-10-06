import type { DatabaseSync } from 'node:sqlite';

type CleanupOptions = { queueFile: (filename: string, reason: string) => void; cancelOrder: (id: string) => unknown };

// Called inside the store transaction, after the account authority has removed it.
// Inactivity is not a moderation penalty: other members' settled ledger stays.
export function purgeCommunityReaderData(db: DatabaseSync, readerId: string, { queueFile, cancelOrder }: CleanupOptions) {
  const hasLocalReaders = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='readers'").get());
  if (hasLocalReaders && db.prepare('SELECT 1 FROM readers WHERE id=?').get(readerId)) throw Error('Reader account still exists; cannot purge its data.');
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS reader_cleanup_topics (id TEXT PRIMARY KEY);
    CREATE TEMP TABLE IF NOT EXISTS reader_cleanup_replies (id TEXT PRIMARY KEY);
    CREATE TEMP TABLE IF NOT EXISTS reader_cleanup_parents (id TEXT PRIMARY KEY);
    CREATE TEMP TABLE IF NOT EXISTS reader_cleanup_images (id TEXT PRIMARY KEY);
    DELETE FROM reader_cleanup_topics; DELETE FROM reader_cleanup_replies;
    DELETE FROM reader_cleanup_parents; DELETE FROM reader_cleanup_images;`);
  db.prepare("INSERT INTO reader_cleanup_topics SELECT id FROM community_topics WHERE author_kind='reader' AND author_id=?").run(readerId);
  db.prepare("INSERT INTO reader_cleanup_replies SELECT id FROM community_replies WHERE (author_kind='reader' AND author_id=?) OR topic_id IN reader_cleanup_topics").run(readerId);
  db.exec(`INSERT INTO reader_cleanup_parents SELECT DISTINCT topic_id FROM community_replies
    WHERE id IN reader_cleanup_replies AND topic_id NOT IN reader_cleanup_topics;`);
  const topics = Number(db.prepare('SELECT COUNT(*) AS n FROM reader_cleanup_topics').get()?.n);
  const replies = Number(db.prepare('SELECT COUNT(*) AS n FROM reader_cleanup_replies').get()?.n);
  // Clear this account's references before removing its private profile uploads.
  // Other members' approved/pending backgrounds remain durable assets.
  db.prepare("DELETE FROM community_profile_backgrounds WHERE member_kind='reader' AND member_id=?").run(readerId);
  db.prepare("DELETE FROM community_profile_background_reviews WHERE member_kind='reader' AND member_id=?").run(readerId);
  // A moderator's upload can be in a surviving banner. Shared site assets stay.
  db.prepare(`INSERT INTO reader_cleanup_images SELECT i.id FROM community_images i
    WHERE ((i.uploader_kind='reader' AND i.uploader_id=? AND
      (i.topic_id IS NULL OR i.topic_id IN reader_cleanup_topics OR i.reply_id IN reader_cleanup_replies))
      OR i.topic_id IN reader_cleanup_topics OR i.reply_id IN reader_cleanup_replies)
    AND NOT EXISTS (SELECT 1 FROM community_shop_items s WHERE s.image=i.id)
    AND NOT EXISTS (SELECT 1 FROM community_banner_entries b WHERE b.cover=i.id AND (b.topic_id IS NULL OR b.topic_id NOT IN reader_cleanup_topics))
    AND NOT EXISTS (SELECT 1 FROM community_profile_backgrounds p WHERE p.approved_image=i.id OR p.pending_image=i.id)`).run(readerId);
  const images = db.prepare('SELECT id FROM reader_cleanup_images').all() as Array<{ id: string }>;
  // Persist filenames before losing their registry rows. If SQL rolls back, the
  // file cleaner sees those rows and protects the files until a successful retry.
  for (const image of images) {
    queueFile(`community-image-${image.id}.webp`, 'reader-deleted');
    queueFile(`community-thumb-${image.id}.webp`, 'reader-deleted');
  }
  for (const order of db.prepare("SELECT id FROM community_orders WHERE member_kind='reader' AND member_id=? AND status='pending'").all(readerId) as Array<{ id: string }>) cancelOrder(order.id);
  db.exec(`UPDATE community_banners SET version=version+1 WHERE scope IN
      (SELECT scope FROM community_banner_entries WHERE topic_id IN reader_cleanup_topics);
    DELETE FROM community_banner_entries WHERE topic_id IN reader_cleanup_topics;
    DELETE FROM community_images WHERE id IN reader_cleanup_images;
    UPDATE community_images SET topic_id=NULL,reply_id=NULL,purpose='banner'
      WHERE topic_id IN reader_cleanup_topics OR reply_id IN reader_cleanup_replies;
    UPDATE community_topics SET accepted_reply_id=NULL,accepted_at=NULL WHERE accepted_reply_id IN reader_cleanup_replies;
    UPDATE community_replies SET quote_id=NULL WHERE quote_id IN reader_cleanup_replies;`);
  const target = "(target_kind='topic' AND target_id IN reader_cleanup_topics) OR (target_kind='reply' AND target_id IN reader_cleanup_replies)";
  db.prepare(`DELETE FROM community_revisions WHERE ${target} OR (editor_kind='reader' AND editor_id=?)`).run(readerId);
  db.prepare(`DELETE FROM community_reports WHERE ${target} OR (reporter_kind='reader' AND reporter_id=?)`).run(readerId);
  db.prepare(`DELETE FROM community_reactions WHERE ${target} OR (member_kind='reader' AND member_id=?)`).run(readerId);
  const removedTopics = new Set((db.prepare('SELECT id FROM reader_cleanup_topics').all() as Array<{ id: string }>).map(row => row.id));
  const removedReplies = new Set((db.prepare('SELECT id FROM reader_cleanup_replies').all() as Array<{ id: string }>).map(row => row.id));
  // Other members keep earned honors, while deleted account/content identifiers
  // leave their evidence. Numeric achievement snapshots do not identify a person.
  for (const table of ['community_badge_honors', 'community_badge_honor_reviews']) {
    const receipts = db.prepare(`SELECT rowid,evidence FROM ${table} WHERE NOT(member_kind='reader' AND member_id=?)`).all(readerId) as Array<{ rowid: number; evidence: string }>;
    const save = db.prepare(`UPDATE ${table} SET evidence=? WHERE rowid=?`);
    for (const row of receipts) {
      const receipt = JSON.parse(row.evidence) as { version: number; at: string; metrics: unknown; sources: Array<{ kind: string; id: string; actor?: string }>; anonymizedSources?: number };
      const kept = receipt.sources.filter(source => {
        if (source.actor === `reader:${readerId}` || (source.kind === 'contributor' && source.id === `reader:${readerId}`)) return false;
        if (['topic', 'featured', 'acceptance'].includes(source.kind) && removedTopics.has(source.id)) return false;
        if (source.kind === 'reply' && removedReplies.has(source.id)) return false;
        return !(source.kind === 'reaction' && ((source.id.startsWith('topic:') && removedTopics.has(source.id.slice(6))) || (source.id.startsWith('reply:') && removedReplies.has(source.id.slice(6)))));
      });
      if (kept.length !== receipt.sources.length) save.run(JSON.stringify({ version: receipt.version, at: receipt.at, metrics: receipt.metrics, sources: kept,
        anonymizedSources: (receipt.anonymizedSources || 0) + receipt.sources.length - kept.length }), row.rowid);
    }
  }
  db.prepare(`DELETE FROM community_badge_events WHERE actor_key=? OR (kind='reaction' AND
    ((source_id LIKE 'topic:%' AND substr(source_id,7) IN reader_cleanup_topics) OR (source_id LIKE 'reply:%' AND substr(source_id,7) IN reader_cleanup_replies)))
    OR (kind='acceptance' AND source_id IN reader_cleanup_topics)`).run(`reader:${readerId}`);
  db.prepare(`DELETE FROM community_badge_exclusions WHERE actor_key=? OR (kind='contributor' AND source_id=?)
    OR (kind IN ('topic','featured','acceptance') AND source_id IN reader_cleanup_topics)
    OR (kind='reply' AND source_id IN reader_cleanup_replies)
    OR (kind='reaction' AND ((source_id LIKE 'topic:%' AND substr(source_id,7) IN reader_cleanup_topics)
      OR (source_id LIKE 'reply:%' AND substr(source_id,7) IN reader_cleanup_replies)))`).run(`reader:${readerId}`, `reader:${readerId}`);
  db.prepare(`DELETE FROM community_badge_violation_reviews WHERE (kind='penalty' AND source_id IN
    (SELECT id FROM community_ledger WHERE member_kind='reader' AND member_id=?)) OR (kind='sanction' AND source_id IN
    (SELECT id FROM community_sanctions WHERE member_kind='reader' AND member_id=?))`).run(readerId, readerId);
  // Inactive-account removal preserves other members' settled experience, just
  // like their currency. Remove references to permanently removed source content.
  db.prepare(`UPDATE community_experience_ledger SET ref_kind=NULL,ref_id=NULL
    WHERE NOT(member_kind='reader' AND member_id=?) AND
      ((ref_kind='topic' AND ref_id IN reader_cleanup_topics) OR (ref_kind='reply' AND ref_id IN reader_cleanup_replies))`).run(readerId);
  for (const table of ['community_bookmarks', 'community_unlocks', 'community_votes']) {
    db.prepare(`DELETE FROM ${table} WHERE topic_id IN reader_cleanup_topics OR (member_kind='reader' AND member_id=?)`).run(readerId);
  }
  db.prepare('DELETE FROM community_views WHERE topic_id IN reader_cleanup_topics OR viewer=?').run(`reader:${readerId}`);
  db.prepare(`DELETE FROM community_notifications WHERE (member_kind='reader' AND member_id=?) OR (actor_kind='reader' AND actor_id=?)
    OR topic_id IN reader_cleanup_topics OR reply_id IN reader_cleanup_replies`).run(readerId, readerId);
  db.prepare("DELETE FROM community_follows WHERE (follower_kind='reader' AND follower_id=?) OR (followee_kind='reader' AND followee_id=?)").run(readerId, readerId);
  for (const table of ['community_experience_ledger', 'community_experience_visits', 'community_vip_growth_days',
    'community_ledger', 'community_checkins', 'community_makeups', 'community_members', 'community_visits',
    'community_badges', 'community_badge_honors', 'community_badge_honor_reviews', 'community_sanctions', 'community_owned', 'community_inventory', 'community_orders', 'community_requests', 'community_rate_events']) {
    db.prepare(`DELETE FROM ${table} WHERE member_kind='reader' AND member_id=?`).run(readerId);
  }
  db.exec(`DELETE FROM community_replies WHERE id IN reader_cleanup_replies;
    DELETE FROM community_topics WHERE id IN reader_cleanup_topics;
    UPDATE community_topics SET reply_count=(SELECT COUNT(*) FROM community_replies r WHERE r.topic_id=community_topics.id AND r.deleted_at IS NULL),
      last_activity_at=MAX(created_at,COALESCE(edited_at,created_at),COALESCE((SELECT MAX(r.created_at) FROM community_replies r
        WHERE r.topic_id=community_topics.id AND r.deleted_at IS NULL AND r.hidden_at IS NULL),created_at))
      WHERE id IN reader_cleanup_parents;`);
  return { topics, replies, images: images.length };
}
