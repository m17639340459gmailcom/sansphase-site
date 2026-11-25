import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTransaction, fail } from './community-db.ts';
import { canEnterTeahouse, isTeahouseManager } from '../src/teahouse-types.ts';
import type {
  TeahouseActor, TeahouseAnnouncement, TeahouseAnnouncementInput, TeahouseAttachment,
  TeahouseAuthor, TeahouseHistory, TeahouseHistoryQuery, TeahouseMessage, TeahouseSendInput,
} from '../src/teahouse-types.ts';

export interface TeahouseStoreOptions { directory: string; now?: () => number; requirePrepared?: boolean }
export type TeahouseAttachmentInput = Omit<TeahouseAttachment, 'url'>;

type MessageRow = {
  seq: number; id: string; revision_seq: number; author_key: string; author_json: string;
  created_at: number; withdrawn_at: number | null; text: string | null;
};
type AttachmentRow = {
  id: string; owner_key: string; message_id: string | null; created_at: number;
  mime: TeahouseAttachment['mime']; size: number; width: number; height: number;
};
type AnnouncementRow = {
  id: string; title: string; text: string; author_key: string; author_json: string;
  created_at: number; updated_at: number; revision: number; pinned: number;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxText = 4000;
const withdrawalWindow = 5 * 60_000;
const attachmentLifetime = 60 * 60_000;
const key = (actor: TeahouseActor) => `${actor.kind}:${actor.id}`;
const assertActorShape = (actor: TeahouseActor) => {
  if (!actor || !canEnterTeahouse(actor) || !actor.id || !['reader', 'owner'].includes(actor.kind)) {
    throw fail('仅有效会员或茶室管理成员可以进入。', 403);
  }
};
const assertUuid = (id: string) => {
  if (typeof id !== 'string' || !uuid.test(id)) throw fail('无效的记录标识。');
};
const authorOf = (actor: TeahouseActor): TeahouseAuthor => {
  const { kind, id, name, avatarUrl } = actor;
  return { kind, id, name, ...(avatarUrl ? { avatarUrl } : {}), ...('icon' in actor ? { icon: actor.icon } : {}) };
};
const plainText = (value: string, maximum: number, allowEmpty = false) => {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) throw fail('文字长度或格式不符合要求。');
  const text = value.trim();
  if (!allowEmpty && !text) throw fail('请填写内容。');
  return text;
};
const attachmentOf = (row: AttachmentRow): TeahouseAttachment => ({
  id: row.id, mime: row.mime, size: row.size, width: row.width, height: row.height,
  url: `/api/teahouse/attachments/${row.id}`,
});
const announcementOf = (row: AnnouncementRow): TeahouseAnnouncement => ({
  id: row.id, title: row.title, text: row.text, author: JSON.parse(row.author_json) as TeahouseAuthor,
  createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  revision: row.revision, pinned: Boolean(row.pinned),
});

const requiredColumns: Record<string, readonly string[]> = {
  teahouse_clock: ['id', 'cursor'],
  teahouse_messages: ['seq', 'id', 'revision_seq', 'author_key', 'author_json', 'created_at', 'withdrawn_at', 'text'],
  teahouse_attachments: ['id', 'owner_key', 'message_id', 'created_at', 'mime', 'size', 'width', 'height'],
  teahouse_file_deletions: ['id', 'message_id'],
  teahouse_rate_events: ['author_key', 'created_at'],
  teahouse_announcements: ['id', 'title', 'text', 'author_key', 'author_json', 'created_at', 'updated_at', 'revision', 'pinned'],
  teahouse_deleted_readers: ['reader_id', 'deleted_at'],
};
const requiredIndexes = ['teahouse_messages_replay', 'teahouse_messages_author', 'teahouse_attachment_message', 'teahouse_attachment_owner',
  'teahouse_attachment_expiry', 'teahouse_rate_actor', 'teahouse_rate_expiry', 'teahouse_single_pin', 'teahouse_announcement_author'];
function assertRegularPath(path: string, directory: boolean): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) throw Error('Teahouse storage requires regular files and directories without symlinks.');
}

/** Read-only readiness check, suitable for production startup before enabling chat. */
export function teahouseTablesReady(directory: string): boolean {
  let db: DatabaseSync | undefined;
  try {
    assertRegularPath(resolve(directory), true);
    assertRegularPath(resolve(directory, 'db'), true);
    const path = resolve(directory, 'db', 'chat.sqlite');
    assertRegularPath(path, false);
    db = new DatabaseSync(path, { readOnly: true });
    for (const [table, columns] of Object.entries(requiredColumns)) {
      const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
      if (columns.some((column) => !actual.has(column))) return false;
    }
    const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => row.name));
    if (requiredIndexes.some(name => !indexes.has(name))) return false;
    return Number.isSafeInteger(db.prepare('SELECT cursor FROM teahouse_clock WHERE id=1').get()?.cursor);
  } catch { return false; }
  finally { db?.close(); }
}

/** Explicit maintenance step. Normal production opens pass requirePrepared:true. */
export function prepareTeahouseDirectory(directory: string): void {
  const store = createTeahouseStore({ directory });
  store.close();
  if (!teahouseTablesReady(directory)) throw Error('Teahouse schema is incompatible; explicit migration is required.');
}

/** Isolated chat database. No message content is copied into the forum DB or logs. */
export function createTeahouseStore(options: TeahouseStoreOptions) {
  const directory = resolve(options.directory);
  const dbDirectory = join(directory, 'db');
  if (options.requirePrepared && !teahouseTablesReady(directory)) throw Error('Explicit teahouse preparation is required before startup.');
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertRegularPath(directory, true);
  if (!existsSync(dbDirectory)) mkdirSync(dbDirectory, { mode: 0o700 });
  assertRegularPath(dbDirectory, true);
  const dbPath = join(dbDirectory, 'chat.sqlite');
  if (existsSync(dbPath)) assertRegularPath(dbPath, false);
  const db = new DatabaseSync(dbPath);
  if (process.platform !== 'win32') chmodSync(dbPath, 0o600);
  const now = options.now ?? Date.now;
  // This reduces SQLite page/journal remnants; it does not claim forensic disk erasure.
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (!options.requirePrepared) db.exec(`
    CREATE TABLE IF NOT EXISTS teahouse_clock (id INTEGER PRIMARY KEY CHECK(id=1), cursor INTEGER NOT NULL);
    INSERT OR IGNORE INTO teahouse_clock(id,cursor) VALUES(1,0);
    CREATE TABLE IF NOT EXISTS teahouse_messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      revision_seq INTEGER NOT NULL UNIQUE, author_key TEXT NOT NULL, author_json TEXT NOT NULL,
      created_at INTEGER NOT NULL, withdrawn_at INTEGER, text TEXT
    );
    CREATE INDEX IF NOT EXISTS teahouse_messages_replay ON teahouse_messages(revision_seq);
    CREATE INDEX IF NOT EXISTS teahouse_messages_author ON teahouse_messages(author_key,seq);
    CREATE TABLE IF NOT EXISTS teahouse_attachments (
      id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, message_id TEXT REFERENCES teahouse_messages(id),
      created_at INTEGER NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS teahouse_attachment_message ON teahouse_attachments(message_id);
    CREATE INDEX IF NOT EXISTS teahouse_attachment_owner ON teahouse_attachments(owner_key);
    CREATE INDEX IF NOT EXISTS teahouse_attachment_expiry ON teahouse_attachments(created_at) WHERE message_id IS NULL;
    CREATE TABLE IF NOT EXISTS teahouse_file_deletions (id TEXT PRIMARY KEY, message_id TEXT);
    CREATE TABLE IF NOT EXISTS teahouse_rate_events (author_key TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS teahouse_rate_actor ON teahouse_rate_events(author_key,created_at);
    CREATE INDEX IF NOT EXISTS teahouse_rate_expiry ON teahouse_rate_events(created_at);
    CREATE TABLE IF NOT EXISTS teahouse_deleted_readers (reader_id TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS teahouse_announcements (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, text TEXT NOT NULL, author_key TEXT NOT NULL, author_json TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS teahouse_single_pin ON teahouse_announcements(pinned) WHERE pinned=1;
    CREATE INDEX IF NOT EXISTS teahouse_announcement_author ON teahouse_announcements(author_key);
  `);
  const tx = createTransaction(db);
  const readerDeleted = (readerId: string) => Boolean(db.prepare('SELECT 1 FROM teahouse_deleted_readers WHERE reader_id=?').get(readerId));
  const assertEntry = (actor: TeahouseActor) => {
    assertActorShape(actor);
    if (actor.kind === 'reader' && readerDeleted(actor.id)) throw fail('账号已注销，请重新登录。', 401);
  };
  const cursor = () => Number(db.prepare('SELECT cursor FROM teahouse_clock WHERE id=1').get()?.cursor ?? 0);
  const nextCursor = () => {
    db.prepare('UPDATE teahouse_clock SET cursor=cursor+1 WHERE id=1').run();
    return cursor();
  };
  const findMessage = (id: string) => db.prepare('SELECT * FROM teahouse_messages WHERE id=?').get(id) as MessageRow | undefined;
  const findAttachment = (id: string) => db.prepare('SELECT * FROM teahouse_attachments WHERE id=?').get(id) as AttachmentRow | undefined;
  const findAnnouncement = (id: string) => db.prepare('SELECT * FROM teahouse_announcements WHERE id=?').get(id) as AnnouncementRow | undefined;
  const messageOf = (row: MessageRow): TeahouseMessage => ({
    id: row.id, seq: row.seq, revisionSeq: row.revision_seq, author: JSON.parse(row.author_json) as TeahouseAuthor,
    createdAt: new Date(row.created_at).toISOString(), withdrawn: row.withdrawn_at !== null,
    ...(row.withdrawn_at !== null ? { withdrawnAt: new Date(row.withdrawn_at).toISOString() } : { text: row.text ?? '' }),
    attachments: row.withdrawn_at !== null ? [] : (db.prepare('SELECT * FROM teahouse_attachments WHERE message_id=? ORDER BY rowid').all(row.id) as AttachmentRow[]).map(attachmentOf),
  });
  const assertAnnouncementManager = (actor: TeahouseActor, row?: AnnouncementRow) => {
    assertEntry(actor);
    if (!isTeahouseManager(actor)) throw fail('只有作者、总版主和版主可以发布或管理公告。', 403);
    if (row && actor.role === 'moderator' && row.author_key !== key(actor)) {
      throw fail('版主只能修改自己发布的公告。', 403);
    }
  };
  const pendingForMessage = (id: string) => db.prepare('SELECT id FROM teahouse_file_deletions WHERE message_id=? ORDER BY rowid').all(id).map((r) => String(r.id));

  return {
    readerDeleted,
    attachmentRegistered(id: string): boolean { assertUuid(id); return Boolean(findAttachment(id)); },

    /** Called only by the authenticated account-deletion lifecycle, never a user command. */
    purgeReaderData(readerId: string): { messages: number; attachments: number; announcements: number } {
      if (typeof readerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(readerId)) throw fail('读者标识无效。');
      return tx(() => {
        if (readerDeleted(readerId)) return { messages: 0, attachments: 0, announcements: 0 };
        const authorKey = `reader:${readerId}`;
        const timestamp = now();
        // Keep only the opaque account key as a permanent deny tombstone. It
        // prevents an in-flight authority response from recreating private data.
        db.prepare('INSERT INTO teahouse_deleted_readers(reader_id,deleted_at) VALUES(?,?)').run(readerId, timestamp);
        const anonymous: TeahouseAuthor = { kind: 'reader', id: readerId, name: '已注销用户', icon: null };
        const rows = db.prepare('SELECT id FROM teahouse_messages WHERE author_key=? ORDER BY seq').all(authorKey);
        const update = db.prepare('UPDATE teahouse_messages SET text=NULL,author_json=?,withdrawn_at=COALESCE(withdrawn_at,?),revision_seq=? WHERE id=?');
        const anonymousJson = JSON.stringify(anonymous);
        for (const row of rows) update.run(anonymousJson, timestamp, nextCursor(), String(row.id));
        db.prepare('INSERT OR IGNORE INTO teahouse_file_deletions(id,message_id) SELECT id,message_id FROM teahouse_attachments WHERE owner_key=?').run(authorKey);
        const attachments = Number(db.prepare('DELETE FROM teahouse_attachments WHERE owner_key=?').run(authorKey).changes);
        const announcements = Number(db.prepare('DELETE FROM teahouse_announcements WHERE author_key=?').run(authorKey).changes);
        db.prepare('DELETE FROM teahouse_rate_events WHERE author_key=?').run(authorKey);
        return { messages: rows.length, attachments, announcements };
      });
    },

    getMessage(actor: TeahouseActor, id: string): TeahouseMessage | null {
      assertEntry(actor);
      assertUuid(id);
      const row = findMessage(id);
      return row ? messageOf(row) : null;
    },

    readMessages(actor: TeahouseActor, query: TeahouseHistoryQuery = {}): TeahouseHistory {
      assertEntry(actor);
      const limit = query.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (query.before !== undefined && query.after !== undefined)) {
        throw fail('无效的历史消息分页。');
      }
      for (const value of [query.before, query.after]) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw fail('无效的消息游标。');
      }
      const replay = query.after !== undefined;
      const rows = replay
        ? db.prepare('SELECT * FROM teahouse_messages WHERE revision_seq>? ORDER BY revision_seq LIMIT ?').all(query.after!, limit + 1) as MessageRow[]
        : db.prepare('SELECT * FROM teahouse_messages WHERE seq<? ORDER BY seq DESC LIMIT ?').all(query.before ?? Number.MAX_SAFE_INTEGER, limit + 1) as MessageRow[];
      const hasMore = rows.length > limit;
      rows.length = Math.min(rows.length, limit);
      const next = replay && hasMore ? rows.at(-1)!.revision_seq : cursor();
      if (!replay) rows.reverse();
      return { messages: rows.map(messageOf), hasMore, cursor: next };
    },

    sendMessage(actor: TeahouseActor, input: TeahouseSendInput): TeahouseMessage {
      assertEntry(actor);
      assertUuid(input.id);
      return tx(() => {
        const previous = findMessage(input.id);
        if (previous) {
          if (previous.author_key !== key(actor)) throw fail('消息标识已被使用。', 409);
          return messageOf(previous);
        }
        const text = plainText(input.text, maxText, true);
        const attachmentIds = input.attachmentIds ?? [];
        if (!Array.isArray(attachmentIds) || attachmentIds.length > 6 || new Set(attachmentIds).size !== attachmentIds.length || (!text && !attachmentIds.length)) {
          throw fail('每条消息需要文字或图片，最多包含 6 张不同的图片。');
        }
        const timestamp = now();
        for (const id of attachmentIds) {
          assertUuid(id);
          const attachment = findAttachment(id);
          if (!attachment || attachment.owner_key !== key(actor) || attachment.message_id || attachment.created_at <= timestamp - attachmentLifetime) {
            throw fail('图片已失效或不属于当前账号，请重新上传。');
          }
        }
        db.prepare('DELETE FROM teahouse_rate_events WHERE created_at<=?').run(timestamp - 3600000);
        for (const [window, maximum] of [[60000, 20], [3600000, 200]]) {
          const count = Number(db.prepare('SELECT COUNT(*) AS n FROM teahouse_rate_events WHERE author_key=? AND created_at>?').get(key(actor), timestamp - window)?.n ?? 0);
          if (count >= maximum) throw fail('发送太频繁了，请稍后再试。', 429);
        }
        db.prepare('INSERT INTO teahouse_messages(id,revision_seq,author_key,author_json,created_at,text) VALUES(?,?,?,?,?,?)')
          .run(input.id, nextCursor(), key(actor), JSON.stringify(authorOf(actor)), timestamp, text);
        for (const id of attachmentIds) db.prepare('UPDATE teahouse_attachments SET message_id=? WHERE id=?').run(input.id, id);
        db.prepare('INSERT INTO teahouse_rate_events(author_key,created_at) VALUES(?,?)').run(key(actor), timestamp);
        return messageOf(findMessage(input.id)!);
      });
    },

    withdrawMessage(actor: TeahouseActor, id: string): { message: TeahouseMessage; attachmentIds: string[] } {
      assertEntry(actor);
      assertUuid(id);
      return tx(() => {
        const row = findMessage(id);
        if (!row) throw fail('消息不存在。', 404);
        const timestamp = now();
        if (!isTeahouseManager(actor) && (row.author_key !== key(actor) || (row.withdrawn_at === null && timestamp - row.created_at >= withdrawalWindow))) {
          throw fail('只能在发送后的 5 分钟内撤回自己的消息。', 403);
        }
        if (row.withdrawn_at !== null) return { message: messageOf(row), attachmentIds: pendingForMessage(id) };
        db.prepare('INSERT OR IGNORE INTO teahouse_file_deletions(id,message_id) SELECT id,message_id FROM teahouse_attachments WHERE message_id=?').run(id);
        db.prepare('DELETE FROM teahouse_attachments WHERE message_id=?').run(id);
        db.prepare('UPDATE teahouse_messages SET text=NULL,withdrawn_at=?,revision_seq=? WHERE id=?').run(timestamp, nextCursor(), id);
        return { message: messageOf(findMessage(id)!), attachmentIds: pendingForMessage(id) };
      });
    },

    registerAttachment(actor: TeahouseActor, input: TeahouseAttachmentInput): TeahouseAttachment {
      assertEntry(actor);
      assertUuid(input.id);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.mime) || !Number.isInteger(input.size) || input.size < 1 || input.size > 2 * 1024 * 1024 ||
          !Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1 || input.width > 8192 || input.height > 8192 || input.width * input.height > 40_000_000) {
        throw fail('图片格式、尺寸或大小不符合要求。');
      }
      return tx(() => {
        if (findAttachment(input.id) || db.prepare('SELECT id FROM teahouse_file_deletions WHERE id=?').get(input.id)) throw fail('图片标识已被使用。', 409);
        db.prepare('INSERT INTO teahouse_attachments(id,owner_key,created_at,mime,size,width,height) VALUES(?,?,?,?,?,?,?)')
          .run(input.id, key(actor), now(), input.mime, input.size, input.width, input.height);
        return attachmentOf(findAttachment(input.id)!);
      });
    },

    getAttachment(actor: TeahouseActor, id: string): TeahouseAttachment {
      assertEntry(actor);
      assertUuid(id);
      const row = findAttachment(id);
      if (!row || (!row.message_id && (row.owner_key !== key(actor) || row.created_at <= now() - attachmentLifetime))) {
        throw fail('图片不存在。', 404);
      }
      return attachmentOf(row);
    },

    pruneUnboundAttachments(): string[] {
      return tx(() => {
        const expiry = now() - attachmentLifetime;
        const ids = db.prepare('SELECT id FROM teahouse_attachments WHERE message_id IS NULL AND created_at<=?').all(expiry).map((row) => String(row.id));
        db.prepare('INSERT OR IGNORE INTO teahouse_file_deletions(id) SELECT id FROM teahouse_attachments WHERE message_id IS NULL AND created_at<=?').run(expiry);
        db.prepare('DELETE FROM teahouse_attachments WHERE message_id IS NULL AND created_at<=?').run(expiry);
        return ids;
      });
    },

    pendingFileDeletions(): string[] {
      return db.prepare('SELECT id FROM teahouse_file_deletions ORDER BY rowid').all().map((row) => String(row.id));
    },
    confirmFileDeletion(id: string): void {
      assertUuid(id);
      db.prepare('DELETE FROM teahouse_file_deletions WHERE id=?').run(id);
    },

    listAnnouncements(actor: TeahouseActor): TeahouseAnnouncement[] {
      assertEntry(actor);
      return (db.prepare('SELECT * FROM teahouse_announcements ORDER BY pinned DESC,created_at DESC,id DESC LIMIT 100').all() as AnnouncementRow[]).map(announcementOf);
    },

    saveAnnouncement(actor: TeahouseActor, input: TeahouseAnnouncementInput): TeahouseAnnouncement {
      assertAnnouncementManager(actor);
      const title = plainText(input.title, 100);
      const text = plainText(input.text, 8000);
      if (input.pinned !== undefined && typeof input.pinned !== 'boolean') throw fail('无效的置顶状态。');
      if (input.id !== undefined) assertUuid(input.id);
      return tx(() => {
        const previous = input.id ? findAnnouncement(input.id) : undefined;
        if (input.id && !previous) throw fail('公告不存在。', 404);
        if (previous) {
          assertAnnouncementManager(actor, previous);
          if (input.revision !== previous.revision) throw fail('公告已被更新，请刷新后重试。', 409);
        }
        const timestamp = now();
        const pinned = input.pinned ?? Boolean(previous?.pinned);
        if (pinned) {
          const existing = db.prepare('SELECT * FROM teahouse_announcements WHERE pinned=1').get() as AnnouncementRow | undefined;
          if (existing && existing.id !== previous?.id) {
            assertAnnouncementManager(actor, existing);
            db.prepare('UPDATE teahouse_announcements SET pinned=0,revision=revision+1,updated_at=? WHERE id=?').run(timestamp, existing.id);
          }
        }
        const id = previous?.id ?? randomUUID();
        if (previous) {
          db.prepare('UPDATE teahouse_announcements SET title=?,text=?,updated_at=?,revision=revision+1,pinned=? WHERE id=?')
            .run(title, text, timestamp, Number(pinned), id);
        } else {
          db.prepare('INSERT INTO teahouse_announcements(id,title,text,author_key,author_json,created_at,updated_at,revision,pinned) VALUES(?,?,?,?,?,?,?,1,?)')
            .run(id, title, text, key(actor), JSON.stringify(authorOf(actor)), timestamp, timestamp, Number(pinned));
        }
        return announcementOf(findAnnouncement(id)!);
      });
    },

    deleteAnnouncement(actor: TeahouseActor, id: string, revision: number): void {
      assertAnnouncementManager(actor);
      assertUuid(id);
      tx(() => {
        const previous = findAnnouncement(id);
        if (!previous) throw fail('公告不存在。', 404);
        assertAnnouncementManager(actor, previous);
        if (revision !== previous.revision) throw fail('公告已被更新，请刷新后重试。', 409);
        db.prepare('DELETE FROM teahouse_announcements WHERE id=?').run(id);
      });
    },

    close(): void { if (db.isOpen) db.close(); },
  };
}

export type TeahouseStore = ReturnType<typeof createTeahouseStore>;
