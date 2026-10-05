import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { clientAddress } from './client-ip.ts';

type LoginAddress = ReturnType<typeof clientAddress>;
type RecordLogin = { actorType: string; actorId: string | number; email: string; address: LoginAddress; userAgent?: string };
type LatestLogin = { at: string; ip: string; source: string };
type LoginEvent = { id: string; at: string; ip: string; peerIp: string; source: string; userAgent: string };
type ReaderId = { id: string };

// Canonical comparison only: retain the audited peer spelling and the existing
// clientAddress trust boundary. Historical entries use the same comparison.
export function loginIpKey(ip: string): string | null {
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return null;
  const canonical = new URL(`http://[${ip.split('%')[0]}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function createLoginLedger(directory: string) {
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec('PRAGMA busy_timeout=10000');
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='login_events'").get()) {
    db.close();
    throw Error('Login audit migration is required before starting the site.');
  }
  db.function('login_ip_key', { deterministic: true }, value => typeof value === 'string' ? loginIpKey(value) : null);
  // Existing history can contain more than three accounts. Only the earliest
  // successful login of each of the first three accounts reserves a slot.
  const firstReaders = db.prepare(`SELECT actor_id FROM (
      SELECT actor_id,happened_at,rowid AS position,
        ROW_NUMBER() OVER (PARTITION BY actor_id ORDER BY happened_at,rowid) AS first_login
      FROM login_events WHERE actor_type='reader' AND login_ip_key(ip)=?
    ) WHERE first_login=1 ORDER BY happened_at,position LIMIT 3`);
  const insert = db.prepare('INSERT INTO login_events (id, happened_at, actor_type, actor_id, email, ip, peer_ip, source, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  return {
    record({ actorType, actorId, email, address, userAgent }: RecordLogin) {
      if (!['reader', 'owner'].includes(actorType) || !actorId || !isIP(address?.ip || '')) throw Error('Cannot audit login without a verified network address and account.');
      const event = { id: randomUUID(), at: new Date().toISOString(), actorType, actorId: String(actorId), email: String(email).toLowerCase(), ip: address.ip, peerIp: address.peerIp || '', source: address.source, userAgent: String(userAgent || '').slice(0, 300) };
      db.exec('BEGIN IMMEDIATE');
      try {
        if (actorType === 'reader') {
          const reserved = firstReaders.all(loginIpKey(event.ip!)) as Array<{ actor_id: string }>;
          if (reserved.length >= 3 && !reserved.some(row => row.actor_id === event.actorId))
            throw Object.assign(Error('同一 IP 长期最多允许登录 3 个不同读者账号，当前账号无法在此 IP 登录。'), { status: 403 });
        }
        insert.run(event.id, event.at, event.actorType, event.actorId, event.email, event.ip, event.peerIp, event.source, event.userAgent);
        db.exec('COMMIT');
        return event;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    latest(actorType: string, actorId: string | number): LatestLogin | null {
      const row = db.prepare('SELECT happened_at AS at, ip, source FROM login_events WHERE actor_type=? AND actor_id=? ORDER BY happened_at DESC, rowid DESC LIMIT 1').get(actorType, String(actorId)) as LatestLogin | undefined;
      return row || null;
    },
    list(actorType: string, actorId: string | number, limit = 20): LoginEvent[] {
      return db.prepare('SELECT id, happened_at AS at, ip, peer_ip AS peerIp, source, user_agent AS userAgent FROM login_events WHERE actor_type=? AND actor_id=? ORDER BY happened_at DESC, rowid DESC LIMIT ?')
        .all(actorType, String(actorId), Math.max(1, Math.min(100, Number(limit) || 20))) as LoginEvent[];
    },
    inactiveReaderIds(cutoff: string, now: string, limit = 100, offset = 0): string[] {
      return db.prepare(`SELECT r.id FROM readers r
        WHERE (r.vip_until IS NULL OR r.vip_until <= ?)
          AND COALESCE(
            (SELECT MAX(e.happened_at) FROM login_events e WHERE e.actor_type='reader' AND e.actor_id=r.id),
            r.created_at
          ) <= ?
        ORDER BY r.created_at, r.id LIMIT ? OFFSET ?`)
        .all(now, cutoff, Math.max(1, Math.min(1000, Number(limit) || 100)), Math.max(0, Number(offset) || 0)).map(row => (row as ReaderId).id);
    },
    close() { db.close(); },
  };
}
