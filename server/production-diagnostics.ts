import { createDiagnosticsService } from './diagnostics-service.ts';

type Options = { origin: string; port: number; release: string; now?: () => number; random?: () => number };
const origins = new Set(['https://www.sansphase.com', 'https://community.sansphase.com']);
const loopbacks = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Anonymous sampled events only; reports remain local operator requests protected by SSH access. */
export function createProductionDiagnostics({ origin, port, release, now, random }: Options) {
  if (!origins.has(origin) || !Number.isInteger(port) || port < 1 || port > 65535 ||
    !/^[A-Za-z0-9._-]{1,96}$/.test(release)) throw Error('Production diagnostics configuration rejected.');
  const publicHost = new URL(origin).host;
  const privateHost = `127.0.0.1:${port}`;
  return createDiagnosticsService({
    release, sampleRate: 0.1, now, random,
    allowRequest(req, endpoint) {
      if (!loopbacks.has(req.socket.remoteAddress || '') ||
        req.rawHeaders.filter((_, index, headers) => index % 2 === 0 && headers[index].toLowerCase() === 'host').length !== 1) return false;
      if (endpoint === 'events') {
        return req.headers.host === publicHost && req.headers.origin === origin &&
          (req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin');
      }
      // Nginx preserves public Host and adds forwarding headers. Reject both,
      // including requests attempting to disguise a public proxy as localhost.
      return req.headers.host === privateHost && req.headers.origin === undefined &&
        !Object.keys(req.headers).some(name => name === 'forwarded' || name === 'x-real-ip' ||
          name.startsWith('x-forwarded-') || name.startsWith('sec-fetch-'));
    },
  });
}
