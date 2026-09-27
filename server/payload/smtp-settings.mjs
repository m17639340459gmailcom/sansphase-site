import { isIP } from 'node:net';
const address = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A partial private configuration must never make public registration appear usable.
export function smtpConfigured(smtp) {
  if (!smtp || typeof smtp !== 'object') return false;
  const port = Number(smtp.port || 587);
  return ['host', 'user', 'password', 'from'].every(key => typeof smtp[key] === 'string' && smtp[key].trim())
    && address.test(smtp.from)
    && (!smtp.connectAddress || (typeof smtp.connectAddress === 'string' && isIP(smtp.connectAddress) !== 0))
    && Number.isInteger(port) && port > 0 && port <= 65535;
}

export function smtpTransportOptions(smtp) {
  if (!smtpConfigured(smtp)) throw new Error('SMTP settings are incomplete.');
  const port = Number(smtp.port || 587);
  return {
    host: smtp.connectAddress || smtp.host.trim(), port,
    ...(smtp.connectAddress ? { tls: { servername: smtp.host.trim() } } : {}),
    secure: port === 465,
    requireTLS: port !== 465,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: { user: smtp.user.trim(), pass: smtp.password },
  };
}
