import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Community posts are durable reader content, so they live in content.db and
// are covered by the existing content.db backups (reader_uids and
// login_events already live there). Payload uses push:false in production:
// this explicit, backed-up migration adds the community tables.
const member = (prefix = 'member') => `${prefix}_kind TEXT NOT NULL CHECK(${prefix}_kind IN ('reader','owner')), ${prefix}_id TEXT NOT NULL`;
const tables: Record<string, string> = {
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
  // 兑换所：站长上架的数字资源和实物（装扮和道具卡的效果写在代码里，不在这张表）。
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
];
export const communityTables = Object.keys(tables);
export const communitySchema = Object.values(tables).join('\n');

const missingParts = (db: DatabaseSync) => {
  const has = (name: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const tablesMissing = communityTables.filter(name => !has(name));
  const columnsMissing = columns.filter(([table, column]) => has(table)
    && !(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(row => row.name === column));
  return { tablesMissing, columnsMissing };
};
// True when content.db has every community table and column.
export const communitySchemaReady = (db: DatabaseSync) => {
  const { tablesMissing, columnsMissing } = missingParts(db);
  return !tablesMissing.length && !columnsMissing.length;
};

// Adds whatever is missing, after a snapshot in schema-backups/. A database
// with the first community tables is upgraded in place; nothing is dropped.
export async function migrateCommunity(directory: string) {
  const database = resolve(directory, 'content.db');
  await stat(database);
  const db = new DatabaseSync(database);
  try {
    const { tablesMissing, columnsMissing } = missingParts(db);
    if (!tablesMissing.length && !columnsMissing.length) return { changed: false };
    const root = resolve(directory, 'schema-backups');
    await mkdir(root, { recursive: true });
    const snapshot = resolve(root, `before-community-${Date.now()}-${randomUUID()}.db`);
    await backup(db, snapshot);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const name of tablesMissing) db.exec(tables[name]);
      // Tables created just now also need the later columns.
      for (const [table, column, type] of missingParts(db).columnsMissing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { changed: true, backup: snapshot };
  } finally { db.close(); }
}
