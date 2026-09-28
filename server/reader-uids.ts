import { DatabaseSync } from 'node:sqlite';
import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';

export const readerUidsTableSql = `CREATE TABLE reader_uids (
  uid INTEGER PRIMARY KEY AUTOINCREMENT,
  reader_id text NOT NULL UNIQUE
);`;
export const readerUidsTriggerSql = `CREATE TRIGGER reader_uids_on_insert AFTER INSERT ON readers
BEGIN
  INSERT INTO reader_uids (reader_id) VALUES (NEW.id);
END;`;

type UidRow = { uid: number };
type ReaderIdRow = { reader_id: string };

export function createReaderUidStore(directory: string) {
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reader_uids'").get();
  const trigger = db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='reader_uids_on_insert'").get();
  if (!table || !trigger) { db.close(); throw Error('Reader UID migration is required before starting the site.'); }
  const lookup = db.prepare('SELECT uid FROM reader_uids WHERE reader_id=?');
  const reverse = db.prepare('SELECT reader_id FROM reader_uids WHERE uid=?');
  const update = db.prepare('UPDATE reader_uids SET uid=? WHERE reader_id=?');
  const advance = db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq, ?) WHERE name='reader_uids'");
  const format = (value: number) => String(value).padStart(4, '0');
  return {
    get(readerId: string | number) {
      const uid = (lookup.get(String(readerId)) as UidRow | undefined)?.uid;
      if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid < 1) throw Error('Reader account has no UID. Run the reader migration.');
      return format(uid);
    },
    readerId(uid: string | number) {
      if (!/^\d{1,15}$/.test(String(uid))) return null;
      const value = Number(uid);
      return Number.isSafeInteger(value) && value > 0 ? (reverse.get(value) as ReaderIdRow | undefined)?.reader_id || null : null;
    },
    assignRandom(readerId: string | number) {
      const id = String(readerId);
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = (lookup.get(id) as UidRow | undefined)?.uid;
        if (typeof previous !== 'number' || !Number.isSafeInteger(previous)) throw Object.assign(Error('用户不存在。'), { code: 'UID_READER_MISSING' });
        for (let attempt = 0; attempt < 100; attempt++) {
          const value = randomInt(100_000, 1_000_000);
          if (reverse.get(value)) continue;
          update.run(value, id);
          advance.run(value);
          db.exec('COMMIT');
          return format(value).padStart(6, '0');
        }
        throw Object.assign(Error('六位 UID 暂时无法分配，请稍后重试。'), { code: 'UID_POOL_BUSY' });
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    set(readerId: string | number, requested: string) {
      if (typeof requested !== 'string' || !/^\d{4,9}$/.test(requested) || Number(requested) < 1)
        throw Object.assign(Error('UID 需要填写 4 至 9 位数字，且不能全为 0。'), { code: 'UID_INVALID' });
      const id = String(readerId), value = Number(requested);
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = (lookup.get(id) as UidRow | undefined)?.uid;
        if (typeof previous !== 'number' || !Number.isSafeInteger(previous)) throw Object.assign(Error('用户不存在。'), { code: 'UID_READER_MISSING' });
        if (previous !== value) {
          const occupied = (reverse.get(value) as ReaderIdRow | undefined)?.reader_id;
          if (occupied && occupied !== id) throw Object.assign(Error('该 UID 已被其他用户使用。'), { code: 'UID_TAKEN' });
          update.run(value, id);
          advance.run(value);
        }
        db.exec('COMMIT');
        return { previous: format(previous), uid: format(value), changed: previous !== value };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); },
  };
}
