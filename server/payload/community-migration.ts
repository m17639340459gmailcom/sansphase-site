import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { communityBoards } from '../../src/community.ts';

// Community posts are durable reader content, so they live in content.db and
// are covered by the existing content.db backups (reader_uids and
// login_events already live there). Payload uses push:false in production:
// this explicit, backed-up migration adds the community tables.
const member = (prefix = 'member') => `${prefix}_kind TEXT NOT NULL CHECK(${prefix}_kind IN ('reader','owner')), ${prefix}_id TEXT NOT NULL`;
const tables: Record<string, string> = {
  community_conventions: `CREATE TABLE community_conventions (
  version TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK(actor_kind='owner'),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);`,
  community_audit_events: `CREATE TABLE community_audit_events (
  id TEXT PRIMARY KEY,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('reader','owner')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL,
  mirrored_at TEXT
);
CREATE INDEX community_audit_pending_idx ON community_audit_events(mirrored_at,created_at);`,
  community_rate_events: `CREATE TABLE community_rate_events (
  id INTEGER PRIMARY KEY,
  ${member()},
  action TEXT NOT NULL CHECK(action IN ('topic','reply','image','report','action')),
  created_at INTEGER NOT NULL
);
CREATE INDEX community_rate_member_idx ON community_rate_events(member_kind,member_id,action,created_at);
CREATE INDEX community_rate_time_idx ON community_rate_events(created_at);`,
  // Completed request intents are kept independently of orders/content so that
  // cancellation, deletion and server restarts cannot turn retries into new writes.
  community_requests: `CREATE TABLE community_requests (
  ${member()},
  operation TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(member_kind, member_id, operation, request_key)
);`,
  community_banners: `CREATE TABLE community_banners (
  scope TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0)
);`,
  community_banner_entries: `CREATE TABLE community_banner_entries (
  scope TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0 AND position < 5),
  topic_id TEXT NOT NULL,
  topic_board TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  cover TEXT,
  PRIMARY KEY(scope, position),
  UNIQUE(scope, topic_id)
);
CREATE INDEX community_banner_cover_idx ON community_banner_entries(cover);`,
  community_topics: `CREATE TABLE community_topics (
  id TEXT PRIMARY KEY,
  board TEXT NOT NULL,
  ${member('author')},
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX community_topics_activity_idx ON community_topics(deleted_at, last_activity_at);
CREATE INDEX community_topics_board_idx ON community_topics(board, deleted_at);
CREATE INDEX community_topics_author_idx ON community_topics(author_id, deleted_at);`,
  community_replies: `CREATE TABLE community_replies (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES community_topics(id),
  ${member('author')},
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX community_replies_topic_idx ON community_replies(topic_id, deleted_at, created_at);
CREATE INDEX community_replies_author_idx ON community_replies(author_id, deleted_at);`,
  // Earlier text of edited topics and replies, kept for moderation.
  community_revisions: `CREATE TABLE community_revisions (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('topic','reply')),
  target_id TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  tags TEXT,
  ${member('editor')},
  created_at TEXT NOT NULL
);
CREATE INDEX community_revisions_target_idx ON community_revisions(target_kind, target_id);`,
  community_reactions: `CREATE TABLE community_reactions (
  target_kind TEXT NOT NULL CHECK(target_kind IN ('topic','reply')),
  target_id TEXT NOT NULL,
  ${member()},
  created_at TEXT NOT NULL,
  PRIMARY KEY (target_kind, target_id, member_kind, member_id)
);`,
  community_bookmarks: `CREATE TABLE community_bookmarks (
  topic_id TEXT NOT NULL,
  ${member()},
  created_at TEXT NOT NULL,
  PRIMARY KEY (topic_id, member_kind, member_id)
);
CREATE INDEX community_bookmarks_member_idx ON community_bookmarks(member_kind, member_id, created_at);`,
  // One row per viewer per day: the view count is the number of rows.
  community_views: `CREATE TABLE community_views (
  topic_id TEXT NOT NULL,
  viewer TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (topic_id, viewer, day)
);`,
  // Images are re-encoded to WebP in uploads/ (community-image-<id>.webp and
  // community-thumb-<id>.webp). Unattached uploads are removed after a day.
  community_images: `CREATE TABLE community_images (
  id TEXT PRIMARY KEY,
  ${member('uploader')},
  topic_id TEXT,
  reply_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX community_images_topic_idx ON community_images(topic_id, deleted_at, position);`,
  community_reports: `CREATE TABLE community_reports (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('topic','reply')),
  target_id TEXT NOT NULL,
  ${member('reporter')},
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','upheld','dismissed')),
  resolved_at TEXT
);
CREATE INDEX community_reports_status_idx ON community_reports(status, created_at);`,
  // 星尘流水：只追加。余额是流水之和；冲正是另一条反向记录。
  community_ledger: `CREATE TABLE community_ledger (
  id TEXT PRIMARY KEY,
  ${member()},
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('earn','spend','in','out','penalty','revert')),
  reason TEXT NOT NULL,
  ref_kind TEXT,
  ref_id TEXT,
  day TEXT NOT NULL,
  capped INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  reverted_at TEXT
);
CREATE INDEX community_ledger_member_idx ON community_ledger(member_kind, member_id, created_at);
CREATE INDEX community_ledger_ref_idx ON community_ledger(ref_kind, ref_id);`,
  community_checkins: `CREATE TABLE community_checkins (
  ${member()},
  day TEXT NOT NULL,
  streak INTEGER NOT NULL,
  reward INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (member_kind, member_id, day)
);
CREATE INDEX community_checkins_day_idx ON community_checkins(day, created_at);`,
  // 补签：补的是哪一天、在哪个月用掉的次数、花的是什么（卡、VIP 免费或星尘）。
  community_makeups: `CREATE TABLE community_makeups (
  ${member()},
  day TEXT NOT NULL,
  month TEXT NOT NULL,
  cost TEXT NOT NULL CHECK(cost IN ('card','free','stardust')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (member_kind, member_id, day)
);`,
  // Per-member community state: the trust level (recomputed once a Beijing day),
  // the owner's steward appointment, equipped decorations and the guidelines agreement.
  community_members: `CREATE TABLE community_members (
  ${member()},
  level INTEGER NOT NULL DEFAULT 0,
  level_day TEXT,
  steward INTEGER NOT NULL DEFAULT 0,
  frame TEXT,
  name_color TEXT,
  cover TEXT,
  agreed_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (member_kind, member_id)
);`,
  // A visit day is a Beijing day on which the member opened the community.
  community_visits: `CREATE TABLE community_visits (
  ${member()},
  day TEXT NOT NULL,
  PRIMARY KEY (member_kind, member_id, day)
);`,
  community_follows: `CREATE TABLE community_follows (
  ${member('follower')},
  ${member('followee')},
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_kind, follower_id, followee_kind, followee_id)
);
CREATE INDEX community_follows_followee_idx ON community_follows(followee_kind, followee_id);`,
  // Likes are merged per target and day through group_key.
  community_notifications: `CREATE TABLE community_notifications (
  id TEXT PRIMARY KEY,
  ${member()},
  type TEXT NOT NULL,
  actor_kind TEXT,
  actor_id TEXT,
  topic_id TEXT,
  reply_id TEXT,
  text TEXT NOT NULL,
  data TEXT,
  link TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  group_key TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX community_notifications_member_idx ON community_notifications(member_kind, member_id, created_at);
CREATE INDEX community_notifications_group_idx ON community_notifications(group_key);`,
  community_badges: `CREATE TABLE community_badges (
  ${member()},
  badge TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (member_kind, member_id, badge)
);`,
  // The twelve historical badges stay in their original table. New honors
  // keep their immutable achievement snapshot even when progress later drops.
  community_badge_honors: `CREATE TABLE community_badge_honors (
  ${member()}, family TEXT NOT NULL, tier TEXT NOT NULL CHECK(tier IN ('gold','diamond','aurora')),
  created_at TEXT NOT NULL, evidence TEXT NOT NULL, revoked_at TEXT, revoked_reason TEXT,
  restored_at TEXT, PRIMARY KEY(member_kind,member_id,family,tier)
);`,
  community_badge_events: `CREATE TABLE community_badge_events (
  kind TEXT NOT NULL, source_id TEXT NOT NULL, actor_key TEXT NOT NULL DEFAULT '',
  first_at TEXT NOT NULL, PRIMARY KEY(kind,source_id,actor_key)
);`,
  // Anonymous daily sequence survives account cleanup; rankings cannot move up.
  community_badge_checkin_ranks: `CREATE TABLE community_badge_checkin_ranks (
  day TEXT PRIMARY KEY, count INTEGER NOT NULL CHECK(count>=0)
);`,
  community_badge_honor_reviews: `CREATE TABLE community_badge_honor_reviews (
  id TEXT PRIMARY KEY, ${member()}, family TEXT NOT NULL, tier TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('revoke','restore')), reason TEXT NOT NULL, evidence TEXT NOT NULL,
  by_kind TEXT NOT NULL, by_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX community_badge_reviews_member_idx ON community_badge_honor_reviews(member_kind,member_id,created_at);`,
  // These are human review decisions, never an automatic same-IP heuristic.
  community_badge_exclusions: `CREATE TABLE community_badge_exclusions (
  kind TEXT NOT NULL, source_id TEXT NOT NULL, actor_key TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL, by_kind TEXT NOT NULL, by_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(kind,source_id,actor_key)
);`,
  community_badge_violation_reviews: `CREATE TABLE community_badge_violation_reviews (
  kind TEXT NOT NULL CHECK(kind IN ('penalty','sanction')), source_id TEXT NOT NULL,
  reason TEXT NOT NULL, by_kind TEXT NOT NULL, by_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(kind,source_id)
);`,
  // 禁言：到期自动失效，也可以由站长提前解除。
  community_sanctions: `CREATE TABLE community_sanctions (
  id TEXT PRIMARY KEY,
  ${member()},
  days INTEGER NOT NULL,
  reason TEXT NOT NULL,
  until TEXT NOT NULL,
  by_kind TEXT NOT NULL,
  by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  lifted_at TEXT
);
CREATE INDEX community_sanctions_member_idx ON community_sanctions(member_kind, member_id, until);`,
  // Author-defined grouping is separate from a product's functional type.
  community_shop_categories: `CREATE TABLE community_shop_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);`,
  // 兑换所：兼容初版 cat 约束，后加 kind 区分可佩戴装扮。
  community_shop_items: `CREATE TABLE community_shop_items (
  id TEXT PRIMARY KEY,
  cat TEXT NOT NULL CHECK(cat IN ('digital','goods')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL,
  stock INTEGER,
  stock_left INTEGER,
  limit_per TEXT CHECK(limit_per IN ('month','year','once')),
  limit_n INTEGER,
  min_level INTEGER NOT NULL DEFAULT 0,
  min_days INTEGER NOT NULL DEFAULT 0,
  delivery TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  // Redemptions. Shipping details exist only while a goods order waits to be shipped.
  community_orders: `CREATE TABLE community_orders (
  id TEXT PRIMARY KEY,
  ${member()},
  item TEXT NOT NULL,
  item_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('done','pending','shipped','cancelled')),
  ship_name TEXT,
  ship_phone TEXT,
  ship_address TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX community_orders_member_idx ON community_orders(member_kind, member_id, created_at);
CREATE INDEX community_orders_status_idx ON community_orders(status, created_at);`,
  // Owned decorations and digital items, and counted cards (补签卡、置顶卡、高亮卡).
  community_owned: `CREATE TABLE community_owned (
  ${member()},
  item TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (member_kind, member_id, item)
);`,
  community_inventory: `CREATE TABLE community_inventory (
  ${member()},
  card TEXT NOT NULL CHECK(card IN ('makeup','pin','highlight')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (member_kind, member_id, card)
);`,
  // 作品帖的提示词解锁、资源帖的“仍可用 / 已失效”。
  community_unlocks: `CREATE TABLE community_unlocks (
  topic_id TEXT NOT NULL,
  ${member()},
  price INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (topic_id, member_kind, member_id)
);`,
  community_votes: `CREATE TABLE community_votes (
  topic_id TEXT NOT NULL,
  ${member()},
  value TEXT NOT NULL CHECK(value IN ('alive','dead')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (topic_id, member_kind, member_id)
);`,
};
// Columns added to the first two tables after they were first created.
const columns: Array<[string, string, string]> = [
  ['community_topics', 'edited_at', 'TEXT'],
  ['community_topics', 'accepted_reply_id', 'TEXT'],
  ['community_topics', 'tags', "TEXT NOT NULL DEFAULT '[]'"],
  // Locked topics take no replies; pending ones wait for review; hidden ones wait for the owner after reports.
  ['community_topics', 'locked', 'INTEGER NOT NULL DEFAULT 0'],
  ['community_topics', 'pending', 'INTEGER NOT NULL DEFAULT 0'],
  ['community_topics', 'pending_reason', 'TEXT'],
  ['community_topics', 'hidden_at', 'TEXT'],
  ['community_topics', 'hidden_reason', 'TEXT'],
  // A paid 24-hour pin and a 3-day glowing title.
  ['community_topics', 'paid_pin_until', 'TEXT'],
  ['community_topics', 'glow_until', 'TEXT'],
  // 问答悬赏：冻结的星尘和它的去向（open / paid / refunded）。
  ['community_topics', 'bounty', 'INTEGER NOT NULL DEFAULT 0'],
  ['community_topics', 'bounty_state', 'TEXT'],
  // Showcase details (tools, model, usage, prompt and who may read it) and resource details (link, kind, price, platform), as JSON.
  ['community_topics', 'meta', 'TEXT'],
  ['community_topics', 'resource', 'TEXT'],
  // When an answer was accepted or the topic featured (the monthly contribution ranking).
  ['community_topics', 'accepted_at', 'TEXT'],
  ['community_topics', 'featured_at', 'TEXT'],
  // The reporter's level at the time: reports from observers and above count towards auto-hiding.
  ['community_reports', 'reporter_level', 'INTEGER NOT NULL DEFAULT 0'],
  // Courier metadata is retained after shipping; recipient PII is cleared on resolution.
  ['community_orders', 'shipping_company', 'TEXT'],
  ['community_orders', 'tracking_number', 'TEXT'],
  ['community_replies', 'edited_at', 'TEXT'],
  ['community_replies', 'quote_id', 'TEXT'],
  ['community_replies', 'hidden_at', 'TEXT'],
  // Reply attachments retain their parent topic for access checks and cleanup.
  ['community_images', 'reply_id', 'TEXT'],
  ['community_images', 'purpose', "TEXT NOT NULL DEFAULT 'content' CHECK (purpose IN ('content', 'shop', 'banner'))"],
  ['community_images', 'banner_scope', 'TEXT'],
  ['community_images', 'frame_ready', 'INTEGER NOT NULL DEFAULT 0'],
  ['community_shop_items', 'image', 'TEXT'],
  ['community_shop_items', 'category', 'TEXT REFERENCES community_shop_categories(id)'],
  ['community_shop_items', 'kind', "TEXT CHECK (kind IN ('frame', 'color'))"],
  ['community_shop_items', 'effect', 'TEXT'],
  ['community_topics', 'deleted_reason', 'TEXT'],
  ['community_replies', 'deleted_reason', 'TEXT'],
  // NULL preserves an existing all-board appointment; new appointments store an explicit board array.
  ['community_members', 'steward_boards', 'TEXT'],
  // Voluntary public moderation contacts are separate from private reader credentials.
  ['community_members', 'contact_qq', 'TEXT'],
  ['community_members', 'contact_email', 'TEXT'],
  ['community_members', 'agreed_version', 'TEXT'],
  ['community_members', 'convention_read_version', 'TEXT'],
  ['community_members', 'convention_read_at', 'INTEGER'],
  ['community_topics', 'badge_visible_since', 'TEXT'],
  ['community_topics', 'badge_featured_since', 'TEXT'],
  ['community_replies', 'badge_visible_since', 'TEXT'],
  ['community_members', 'badge_account_created_at', 'TEXT'],
  ['community_badges', 'revoked_at', 'TEXT'],
  ['community_badges', 'revoked_reason', 'TEXT'],
];
export const communityTables = Object.keys(tables);
export const communitySchema = Object.values(tables).join('\n');

const missingParts = (db: DatabaseSync) => {
  const has = (name: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const tablesMissing = communityTables.filter(name => !has(name));
  const columnsMissing = columns.filter(([table, column]) => has(table)
    && !(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(row => row.name === column));
  const imageSQL = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='community_images'").get() as { sql: string } | undefined)?.sql || '';
  const imagesPurposeUpgrade = /CHECK\s*\(\s*purpose\s+IN\s*\(\s*'content'\s*,\s*'shop'\s*\)\s*\)/i.test(imageSQL);
  const bannerSQL = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='community_banner_entries'").get() as { sql: string } | undefined)?.sql || '';
  const bannerCapacityUpgrade = /\bposition\s*<\s*4\b/i.test(bannerSQL);
  return { tablesMissing, columnsMissing, imagesPurposeUpgrade, bannerCapacityUpgrade };
};
// True when content.db has every community table and column.
export const communitySchemaReady = (db: DatabaseSync) => {
  const { tablesMissing, columnsMissing, imagesPurposeUpgrade, bannerCapacityUpgrade } = missingParts(db);
  return !tablesMissing.length && !columnsMissing.length && !imagesPurposeUpgrade && !bannerCapacityUpgrade;
};

// SQLite cannot widen a column CHECK in place. Recreate only this table from its
// existing definition, retaining all columns, rows, indexes and triggers.
function extendImagePurpose(db: DatabaseSync) {
  const source = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='community_images'").get() as { sql: string };
  const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='community_images' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as Array<{ sql: string }>;
  const sql = source.sql.replace(/CREATE TABLE\s+["`\[]?community_images["`\]]?/i, 'CREATE TABLE community_images_banner_upgrade')
    .replace(/CHECK\s*\(\s*purpose\s+IN\s*\(\s*'content'\s*,\s*'shop'\s*\)\s*\)/i, "CHECK(purpose IN ('content','shop','banner'))");
  if (sql === source.sql || !sql.includes('community_images_banner_upgrade')) throw Error('Image schema cannot be upgraded safely.');
  const names = (db.prepare('PRAGMA table_info(community_images)').all() as Array<{ name: string }>).map(column => `"${column.name.replaceAll('"', '""')}"`).join(',');
  db.exec(sql);
  db.exec(`INSERT INTO community_images_banner_upgrade(${names}) SELECT ${names} FROM community_images; DROP TABLE community_images; ALTER TABLE community_images_banner_upgrade RENAME TO community_images;`);
  for (const object of objects) db.exec(object.sql);
}

// Existing local configurations use positions 0–3. Widen only their constraint;
// preserve the ordered selections, original indexes and audit-related triggers.
function extendBannerCapacity(db: DatabaseSync) {
  const source = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='community_banner_entries'").get() as { sql: string };
  const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='community_banner_entries' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as Array<{ sql: string }>;
  const sql = source.sql.replace(/CREATE TABLE\s+["`\[]?community_banner_entries["`\]]?/i, 'CREATE TABLE community_banner_entries_capacity_upgrade')
    .replace(/\bposition\s*<\s*4\b/i, 'position < 5');
  if (sql === source.sql || !sql.includes('community_banner_entries_capacity_upgrade')) throw Error('Banner schema cannot be upgraded safely.');
  const names = (db.prepare('PRAGMA table_info(community_banner_entries)').all() as Array<{ name: string }>).map(column => `"${column.name.replaceAll('"', '""')}"`).join(',');
  db.exec(sql);
  db.exec(`INSERT INTO community_banner_entries_capacity_upgrade(${names}) SELECT ${names} FROM community_banner_entries; DROP TABLE community_banner_entries; ALTER TABLE community_banner_entries_capacity_upgrade RENAME TO community_banner_entries;`);
  for (const object of objects) db.exec(object.sql);
}

// One migration snapshot preserves the former automatic highlights. Subsequent
// pins/features do not update these selections, including deliberately empty ones.
function snapshotHighlights(db: DatabaseSync) {
  const topics = db.prepare(`SELECT t.id,t.board,t.pinned,t.featured,t.last_activity_at,
    EXISTS(SELECT 1 FROM community_images i WHERE i.topic_id=t.id AND i.reply_id IS NULL AND i.deleted_at IS NULL AND i.purpose='content') AS has_image
    FROM community_topics t WHERE t.deleted_at IS NULL AND t.pending=0 AND t.hidden_at IS NULL
    ORDER BY t.pinned DESC,t.last_activity_at DESC`).all() as Array<{ id: string; board: string; pinned: number; featured: number; has_image: number }>;
  const config = db.prepare('INSERT INTO community_banners(scope,version) VALUES(?,?)');
  const insert = db.prepare("INSERT INTO community_banner_entries(scope,position,topic_id,topic_board,title,cover) VALUES(?,?,?,?,'',NULL)");
  for (const scope of ['home', ...communityBoards.map(board => board.id)]) {
    const scoped = topics.filter(topic => scope === 'home' ? topic.board !== 'vip' : topic.board === scope).slice(0, 20);
    const pinned = scoped.filter(topic => topic.pinned).slice(0, 4);
    const chosen = [...pinned, ...scoped.filter(topic => !topic.pinned && topic.featured && topic.has_image).slice(0, Math.min(2, 4 - pinned.length))];
    config.run(scope, chosen.length ? 1 : 0);
    chosen.forEach((topic, position) => insert.run(scope, position, topic.id, topic.board));
  }
}

// Adds whatever is missing, after a snapshot in schema-backups/. A database
// with the first community tables is upgraded in place; nothing is dropped.
export async function migrateCommunity(directory: string) {
  const database = resolve(directory, 'content.db');
  await stat(database);
  const db = new DatabaseSync(database);
  try {
    const { tablesMissing, columnsMissing, imagesPurposeUpgrade, bannerCapacityUpgrade } = missingParts(db);
    if (!tablesMissing.length && !columnsMissing.length && !imagesPurposeUpgrade && !bannerCapacityUpgrade) return { changed: false };
    const root = resolve(directory, 'schema-backups');
    await mkdir(root, { recursive: true });
    const snapshot = resolve(root, `before-community-${Date.now()}-${randomUUID()}.db`);
    await backup(db, snapshot);
    // A table rebuild must not execute ON DELETE actions on referencing rows.
    // Keep references intact, then check them inside the transaction before committing.
    const foreignKeys = Number((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys);
    const rebuildTables = imagesPurposeUpgrade || bannerCapacityUpgrade;
    if (rebuildTables) db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const name of tablesMissing) db.exec(tables[name]);
      // Tables created just now also need the later columns.
      for (const [table, column, type] of missingParts(db).columnsMissing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      if (imagesPurposeUpgrade) extendImagePurpose(db);
      if (bannerCapacityUpgrade) extendBannerCapacity(db);
      if (tablesMissing.includes('community_banners')) snapshotHighlights(db);
      if (tablesMissing.includes('community_badge_events')) {
        db.exec(`INSERT OR IGNORE INTO community_badge_events(kind,source_id,actor_key,first_at)
          SELECT 'reaction',target_kind || ':' || target_id,member_kind || ':' || member_id,created_at FROM community_reactions;
          INSERT OR IGNORE INTO community_badge_events(kind,source_id,actor_key,first_at)
          SELECT 'acceptance',t.id,r.author_kind || ':' || r.author_id,t.accepted_at FROM community_topics t
          JOIN community_replies r ON r.id=t.accepted_reply_id WHERE t.accepted_at IS NOT NULL;
          INSERT OR IGNORE INTO community_badge_events(kind,source_id,actor_key,first_at)
          SELECT 'early',day,member_kind || ':' || member_id,created_at FROM (
            SELECT member_kind,member_id,day,created_at,ROW_NUMBER() OVER(PARTITION BY day ORDER BY created_at,rowid) AS position
            FROM community_checkins WHERE member_kind='reader' AND reward>0) WHERE position<=10;`);
        // Visibility history before this upgrade cannot be proved. Existing
        // content starts its high-tier observation period at migration time.
        const observedAt = new Date().toISOString();
        db.prepare('UPDATE community_topics SET badge_visible_since=?,badge_featured_since=CASE WHEN featured=1 THEN ? ELSE NULL END').run(observedAt, observedAt);
        db.prepare('UPDATE community_replies SET badge_visible_since=?').run(observedAt);
      }
      if (tablesMissing.includes('community_badge_checkin_ranks')) db.exec(`INSERT INTO community_badge_checkin_ranks(day,count)
        SELECT day,COUNT(*) FROM community_checkins WHERE member_kind='reader' AND reward>0 GROUP BY day;`);
      if (rebuildTables && db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Community table migration has invalid foreign-key references.');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { if (rebuildTables && foreignKeys) db.exec('PRAGMA foreign_keys=ON'); }
    return { changed: true, backup: snapshot };
  } finally { db.close(); }
}
