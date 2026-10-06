import type { CommunityAuthor } from './community-db.ts';
import { fail } from './community-db.ts';
import type { CommunityStore } from './community-store.ts';
import { IdentityBridgeError, signIdentityRequest } from './community-identity-protocol.ts';

export type CommunityProfileReviewerRole = 'owner' | 'steward';
export type CommunityProfileReviewerCheck = (actor: CommunityAuthor, role: CommunityProfileReviewerRole) => Promise<void>;
export type CommunityProfileReviewerAuthority = (actor: CommunityAuthor, role: CommunityProfileReviewerRole) => void;
type Input = { actor: CommunityAuthor; role: CommunityProfileReviewerRole };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const path = '/api/community-identity/decorations';
const denied = () => fail('审核权限发生变化，请刷新页面。', 403);
const unavailable = () => new IdentityBridgeError('审核权限确认暂不可用，请稍后重试。', 503);
export function validCommunityProfileReviewerInput(value: unknown): value is Input {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['actor', 'role'].includes(key))
    || !('actor' in value) || !value.actor || typeof value.actor !== 'object' || Array.isArray(value.actor)
    || !('role' in value) || value.role !== 'owner' && value.role !== 'steward') return false;
  const actor = value.actor;
  return Object.keys(actor).every(key => ['kind', 'id'].includes(key)) && 'kind' in actor && (actor.kind === 'owner' || actor.kind === 'reader')
    && 'id' in actor && typeof actor.id === 'string' && uuid.test(actor.id);
}

/** Check HK appointments directly. No account bridge, memberships, or display cache. */
export function createCommunityProfileReviewerAuthority({ store, ownerId, readerDeleted = () => false }: {
  store: CommunityStore; ownerId: string; readerDeleted?: (id: string) => boolean;
}): CommunityProfileReviewerAuthority {
  if (!uuid.test(ownerId)) throw Error('Profile reviewer authority requires the fixed owner ID.');
  return (actor, role) => {
    if (!validCommunityProfileReviewerInput({ actor, role })) throw fail('审核身份无效。');
    if (actor.kind === 'owner') { if (role !== 'owner' || actor.id !== ownerId) throw denied(); return; }
    if (role !== 'steward' || readerDeleted(actor.id) || !store.members.storedModerationBoards(actor).length) throw denied();
  };
}

/** Main-server-only, immediate authorization confirmation. Never reuse a positive result. */
export function createCommunityProfileReviewerClient({ origin, secret, fetch: transport = fetch }: {
  origin: string; secret: string; fetch?: typeof fetch;
}): CommunityProfileReviewerCheck {
  if (origin !== 'https://community.sansphase.com') throw Error('Profile reviewer requires the fixed community origin.');
  if (Buffer.byteLength(secret || '') < 32) throw Error('Profile reviewer requires a private bridge secret.');
  return async (actor, role) => {
    if (!validCommunityProfileReviewerInput({ actor, role })) throw new IdentityBridgeError('审核身份无效。', 400);
    const body = JSON.stringify({ operation: 'profile-reviewer', input: { actor, role } });
    try {
      const response = await transport(origin + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(1000),
        headers: { 'Content-Type': 'application/json', ...signIdentityRequest({ secret, method: 'POST', path, body }) }, body });
      const media = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (response.redirected || !response.body || media !== 'application/json' || Number(response.headers.get('content-length') || 0) > 16 * 1024) throw unavailable();
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 16 * 1024) { await reader.cancel(); throw unavailable(); } chunks.push(chunk.value); } }
      finally { reader.releaseLock(); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!response.ok) {
        if (response.status === 403) throw new IdentityBridgeError('审核权限发生变化，请刷新页面。', 403);
        throw unavailable();
      }
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('ok' in value) || value.ok !== true) throw unavailable();
    } catch (error) { if (error instanceof IdentityBridgeError) throw error; throw unavailable(); }
  };
}
