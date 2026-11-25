import { createDiagnosticsService } from './diagnostics-service.ts';

type Options = { origin: string; release: string; now?: () => number };
const loopbacks = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Explicit, ephemeral loopback diagnostics. Never mounted by the production runtime. */
export function createLocalDiagnostics({ origin, release, now = Date.now }: Options) {
  const matched = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(origin);
  if (process.env.NODE_ENV === 'production' || !matched || Number(matched[1]) > 65535 ||
    !/^[A-Za-z0-9._-]{1,96}$/.test(release)) throw Error('Local diagnostics configuration rejected.');
  const host = origin.slice('http://'.length);
  return createDiagnosticsService({
    release, now, sampleRate: 1,
    allowRequest: req => loopbacks.has(req.socket.remoteAddress || '') && req.headers.host === host &&
      (req.headers.origin === undefined ? req.method !== 'POST' : req.headers.origin === origin) &&
      (req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin' || req.headers['sec-fetch-site'] === 'none') &&
      req.rawHeaders.filter((_, index, headers) => index % 2 === 0 && headers[index].toLowerCase() === 'host').length === 1,
  });
}
