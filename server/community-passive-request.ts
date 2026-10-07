import type { IncomingMessage } from 'node:http';

// Background reads still require the full identity and visibility checks.
// Passive status only suppresses human visit/read records and host idle renewal.
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// These are existing image routes. Native img requests cannot carry the marker,
// and fetching their bytes is not evidence of a human navigation or active visit.
const mediaPath = new RegExp(`^/api/community/(?:images/${uuid}(?:\\.thumb)?|avatar/[0-9a-z]{1,15}|profile/avatar/pending|manage/profiles/${uuid}/avatar)\\.webp$`);
export function isCommunityPassiveRead(req: Pick<IncomingMessage, 'method' | 'url' | 'headers'>): boolean {
  if (req.method !== 'GET') return false;
  const path = new URL(req.url || '/', 'http://community.local').pathname;
  return path.startsWith('/api/community/') && (req.headers['x-community-passive'] === '1' || mediaPath.test(path));
}
