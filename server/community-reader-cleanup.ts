import type { DatabaseSync } from 'node:sqlite';

type CleanupOptions = { queueFile: (filename: string, reason: string) => void; cancelOrder: (id: string) => unknown };

// Called inside the store transaction, after Payload has removed the account.
// Inactivity is not a moderation penalty: other members' settled ledger stays.
export function purgeCommunityReaderData(db: DatabaseSync, readerId: string, { queueFile, cancelOrder }: CleanupOptions) {
  if (db.prepare('SELECT 1 FROM readers WHERE id=?').get(readerId)) throw Error('Reader account still exists; cannot purge its data.');
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
  // A moderator's upload can be in a surviving banner. Shared site assets stay.
  db.prepare(`INSERT INTO reader_cleanup_images SELECT i.id FROM community_images i
    WHERE ((i.uploader_kind='reader' AND i.uploader_id=? AND
      (i.topic_id IS NULL OR i.topic_id IN reader_cleanup_topics OR i.reply_id IN reader_cleanup_replies))
      OR i.topic_id IN reader_cleanup_topics OR i.reply_id IN reader_cleanup_replies)
    AND NOT EXISTS (SELECT 1 FROM community_shop_items s WHERE s.image=i.id)
    AND NOT EXISTS (SELECT 1 FROM community_banner_entries b WHERE b.cover=i.id AND b.topic_id NOT IN reader_cleanup_topics)`).run(readerId);
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
  for (const table of ['community_bookmarks', 'community_unlocks', 'community_votes']) {
    db.prepare(`DELETE FROM ${table} WHERE topic_id IN reader_cleanup_topics OR (member_kind='reader' AND member_id=?)`).run(readerId);
  }
  db.prepare('DELETE FROM community_views WHERE topic_id IN reader_cleanup_topics OR viewer=?').run(`reader:${readerId}`);
  db.prepare(`DELETE FROM community_notifications WHERE (member_kind='reader' AND member_id=?) OR (actor_kind='reader' AND actor_id=?)
    OR topic_id IN reader_cleanup_topics OR reply_id IN reader_cleanup_replies`).run(readerId, readerId);
  db.prepare("DELETE FROM community_follows WHERE (follower_kind='reader' AND follower_id=?) OR (followee_kind='reader' AND followee_id=?)").run(readerId, readerId);
  for (const table of ['community_ledger', 'community_checkins', 'community_makeups', 'community_members', 'community_visits',
    'community_badges', 'community_sanctions', 'community_owned', 'community_inventory', 'community_orders', 'community_requests', 'community_rate_events']) {
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
