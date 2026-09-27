import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export function createLoginLedger(directory) {
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec('PRAGMA busy_timeout=10000');
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='login_events'").get()) {
    db.close();
    throw Error('Login audit migration is required before starting the site.');
  }
  return {
    record({ actorType, actorId, email, address, userAgent }) {
      if (!['reader', 'owner'].includes(actorType) || !actorId || !isIP(address?.ip || '')) throw Error('Cannot audit login without a verified network address and account.');
      const event = { id: randomUUID(), at: new Date().toISOString(), actorType, actorId: String(actorId), email: String(email).toLowerCase(), ip: address.ip, peerIp: address.peerIp || '', source: address.source, userAgent: String(userAgent || '').slice(0, 300) };
      db.prepare('INSERT INTO login_events (id, happened_at, actor_type, actor_id, email, ip, peer_ip, source, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(event.id, event.at, event.actorType, event.actorId, event.email, event.ip, event.peerIp, event.source, event.userAgent);
      return event;
    },
    latest(actorType, actorId) {
      const row = db.prepare('SELECT happened_at AS at, ip, source FROM login_events WHERE actor_type=? AND actor_id=? ORDER BY happened_at DESC, rowid DESC LIMIT 1').get(actorType, String(actorId));
      return row || null;
    },
    list(actorType, actorId, limit = 20) {
      return db.prepare('SELECT id, happened_at AS at, ip, peer_ip AS peerIp, source, user_agent AS userAgent FROM login_events WHERE actor_type=? AND actor_id=? ORDER BY happened_at DESC, rowid DESC LIMIT ?')
        .all(actorType, String(actorId), Math.max(1, Math.min(100, Number(limit) || 20)));
    },
    inactiveReaderIds(cutoff, now, limit = 100, offset = 0) {
      return db.prepare(`SELECT r.id FROM readers r
        WHERE (r.vip_until IS NULL OR r.vip_until <= ?)
          AND COALESCE(
            (SELECT MAX(e.happened_at) FROM login_events e WHERE e.actor_type='reader' AND e.actor_id=r.id),
            r.created_at
          ) <= ?
        ORDER BY r.created_at, r.id LIMIT ? OFFSET ?`)
        .all(now, cutoff, Math.max(1, Math.min(1000, Number(limit) || 100)), Math.max(0, Number(offset) || 0)).map(row => row.id);
    },
    close() { db.close(); },
  };
}
