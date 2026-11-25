import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

type Options = {
  q: string; uidMatch: string | null; status: 'all' | 'active' | 'disabled'; membership: 'all' | 'vip' | 'expired';
  page: number; now: string;
};

/** Owner-only list lookup. SQLite instr treats % and _ literally; Payload contains does not. */
export function searchAdminReaders(directory: string, { q, uidMatch, status, membership, page, now }: Options) {
  const conditions = ['_verified=1', `(instr(lower(coalesce(email,'')),lower(?))>0 OR instr(lower(coalesce(nickname,'')),lower(?))>0
    OR instr(lower(coalesce(phone,'')),lower(?))>0 OR instr(lower(coalesce(admin_remark,'')),lower(?))>0 OR id=?)`];
  const values: Array<string | number> = [q, q, q, q, uidMatch || ''];
  if (status !== 'all') { conditions.push('disabled=?'); values.push(status === 'disabled' ? 1 : 0); }
  if (membership !== 'all') { conditions.push(membership === 'vip' ? 'vip_until>?' : 'vip_until IS NOT NULL AND vip_until<=?'); values.push(now); }
  const where = conditions.join(' AND ');
  const order = membership === 'vip' ? 'vip_until ASC,id ASC' : membership === 'expired' ? 'vip_until DESC,id ASC' : 'created_at DESC,id ASC';
  const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN');
    const total = Number(db.prepare(`SELECT count(*) AS total FROM readers WHERE ${where}`).get(...values)?.total || 0);
    const ids = db.prepare(`SELECT id FROM readers WHERE ${where} ORDER BY ${order} LIMIT 20 OFFSET ?`).all(...values, (page - 1) * 20).map(row => String(row.id));
    db.exec('COMMIT');
    return { ids, total, page, totalPages: Math.max(1, Math.ceil(total / 20)) };
  } finally { db.close(); }
}
