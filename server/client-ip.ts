import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

// Only the local nginx hop is allowed to identify the public peer. Never use
// client-supplied X-Forwarded-For or X-Real-IP on a direct connection.
export function clientAddress(req: Pick<IncomingMessage, 'socket' | 'headers'>): {
  ip: string | null;
  peerIp: string | null;
  source: 'local-proxy' | 'socket';
} {
  const peerIp = String(req.socket.remoteAddress || '');
  const header = req.headers['x-real-ip'];
  const forwarded = typeof header === 'string' ? header.trim() : '';
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peerIp);
  if (local && isIP(forwarded)) return { ip: forwarded, peerIp, source: 'local-proxy' };
  return { ip: isIP(peerIp) ? peerIp : null, peerIp: isIP(peerIp) ? peerIp : null, source: 'socket' };
}
