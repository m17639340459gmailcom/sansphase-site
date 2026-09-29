import { isIP } from 'node:net';
const address = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type SmtpSettings = { host: string; user: string; password: string; from: string; name?: string; port?: string | number; connectAddress?: string | null };

// A partial private configuration must never make public registration appear usable.
export function smtpConfigured(smtp: unknown): smtp is SmtpSettings {
  if (!smtp || typeof smtp !== 'object') return false;
  const settings = smtp as Record<string, unknown>;
  const port = Number(settings.port || 587);
  return ['host', 'user', 'password', 'from'].every(key => typeof settings[key] === 'string' && Boolean((settings[key] as string).trim()))
    && address.test(settings.from as string)
    && (!settings.connectAddress || (typeof settings.connectAddress === 'string' && isIP(settings.connectAddress) !== 0))
    && Number.isInteger(port) && port > 0 && port <= 65535;
}

export function smtpTransportOptions(smtp: unknown) {
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
