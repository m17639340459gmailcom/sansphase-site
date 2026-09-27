import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { basename, resolve } from 'node:path';
import { stat, unlink } from 'node:fs/promises';
import { imageWidths } from '../../src/image-sources.mjs';
import { uuidPattern } from '../content-service.mjs';

const referenceTables = ['articles', '_articles_v', 'library_entries', '_library_entries_v', 'announcements', '_announcements_v', 'site_profile'];
const idPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function createMediaRetention({ payload, directory }) {
  const file = resolve(directory, 'content.db');
  const withDb = operation => {
    const db = new DatabaseSync(file);
    try { db.exec('PRAGMA busy_timeout = 5000'); return operation(db); }
    finally { db.close(); }
  };
  withDb(db => db.exec(`CREATE TABLE IF NOT EXISTS content_media_cleanup (
    id TEXT PRIMARY KEY, media_id TEXT NOT NULL UNIQUE, reason TEXT NOT NULL,
    created_at TEXT NOT NULL, last_error TEXT
  );
  CREATE TABLE IF NOT EXISTS content_version_cleanup (
    id TEXT PRIMARY KEY, collection TEXT NOT NULL, parent_id TEXT NOT NULL,
    created_at TEXT NOT NULL, last_error TEXT, UNIQUE(collection,parent_id)
  );`));
  const list = (limit = 100) => withDb(db => db.prepare('SELECT * FROM content_media_cleanup ORDER BY created_at LIMIT ?').all(Math.min(1000, Math.max(1, limit))));
  const versions = (limit = 100) => withDb(db => db.prepare('SELECT * FROM content_version_cleanup ORDER BY created_at LIMIT ?').all(Math.min(1000, Math.max(1, limit))));
  const remove = id => withDb(db => db.prepare('DELETE FROM content_media_cleanup WHERE id=?').run(id));
  const fail = (id, error) => withDb(db => db.prepare('UPDATE content_media_cleanup SET last_error=? WHERE id=?').run(String(error).slice(0, 300), id));
  const referenced = mediaId => withDb(db => {
    for (const table of referenceTables) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      const columns = db.prepare(`PRAGMA table_info("${table}")`).all().filter(column => !['id', 'created_at', 'updated_at'].includes(column.name));
      const where = columns.map(column => `instr(CAST("${column.name.replaceAll('"', '""')}" AS TEXT), ?) > 0`).join(' OR ');
      if (where && db.prepare(`SELECT 1 FROM "${table}" WHERE ${where} LIMIT 1`).get(...columns.map(() => mediaId))) return true;
    }
    return false;
  });
  const removeVariants = async row => {
    if (!row.filename || basename(row.filename) !== row.filename) throw Error('Unsafe media filename');
    const original = resolve(directory, 'uploads', row.filename);
    const info = await stat(original).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!info) return;
    const paths = [];
    for (const width of imageWidths) for (const mode of ['v2-lossless', 'v3-display-q92']) {
      const key = createHash('sha256').update(`${mode}:${original}:${info.size}:${info.mtimeMs}:${width}`).digest('hex');
      paths.push(resolve(directory, 'image-cache', `${key}.webp`), resolve(directory, 'image-cache', `${key}.original`));
    }
    const audioKey = createHash('sha256').update(`v1-mp3-index:${original}:${info.size}:${info.mtimeMs}`).digest('hex');
    paths.push(resolve(directory, 'audio-cache', `${audioKey}.mp3`));
    return paths;
  };
  return {
    list,
    versions,
    queueVersions(collection, parentId) {
      if (!referenceTables.includes(collection) || collection.startsWith('_') || !uuidPattern.test(parentId)) throw Error('Invalid content version cleanup target');
      withDb(db => db.prepare(`INSERT INTO content_version_cleanup (id,collection,parent_id,created_at) VALUES (?,?,?,?)
        ON CONFLICT(collection,parent_id) DO NOTHING`).run(randomUUID(), collection, parentId, new Date().toISOString()));
    },
    async sweepVersions({ ids = null, limit = 100 } = {}) {
      const selected = ids ? new Set(ids) : null;
      const result = { cleaned: 0, failed: 0 };
      for (const row of versions(limit).filter(item => !selected || selected.has(item.id))) {
        try {
          const parent = await payload.find({ collection: row.collection, limit: 1, depth: 0, where: { id: { equals: row.parent_id } } });
          if (!parent.docs.length) {
            await payload.db.deleteVersions({ collection: row.collection, where: { parent: { equals: row.parent_id } } });
            const remaining = await payload.findVersions({ collection: row.collection, where: { parent: { equals: row.parent_id } }, limit: 1, depth: 0 });
            if (remaining.totalDocs) throw Error('Historical versions still exist');
          }
          withDb(db => db.prepare('DELETE FROM content_version_cleanup WHERE id=?').run(row.id));
          result.cleaned++;
        } catch (error) {
          withDb(db => db.prepare('UPDATE content_version_cleanup SET last_error=? WHERE id=?').run(String(error.message).slice(0, 300), row.id));
          result.failed++;
        }
      }
      return result;
    },
    async queueFromDeleted(row) {
      const ids = [...new Set(JSON.stringify(row || {}).match(idPattern) || [])].filter(id => uuidPattern.test(id));
      for (const id of ids) {
        const media = await payload.find({ collection: 'media', limit: 1, depth: 0, where: { id: { equals: id } } });
        if (!media.docs.length) continue;
        withDb(db => db.prepare(`INSERT INTO content_media_cleanup (id,media_id,reason,created_at) VALUES (?,?,?,?)
          ON CONFLICT(media_id) DO NOTHING`).run(randomUUID(), id, 'deleted-content', new Date().toISOString()));
      }
      return ids.length;
    },
    async sweep({ ids = null, limit = 100 } = {}) {
      const selection = ids ? new Set(ids) : null;
      const result = { cleaned: 0, shared: 0, failed: 0 };
      await this.sweepVersions();
      if (versions(1).length) return { ...result, deferred: true };
      for (const item of list(limit).filter(row => !selection || selection.has(row.id))) {
        try {
          if (referenced(item.media_id)) { remove(item.id); result.shared++; continue; }
          const found = await payload.find({ collection: 'media', limit: 1, depth: 0, where: { id: { equals: item.media_id } } });
          if (found.docs.length) {
            const cachePaths = await removeVariants(found.docs[0]);
            if (cachePaths) for (const path of cachePaths) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
            await payload.delete({ collection: 'media', id: item.media_id });
          }
          remove(item.id); result.cleaned++;
        } catch (error) { fail(item.id, error.message); result.failed++; }
      }
      return result;
    },
  };
}
