import type { CommunityAuthor } from './community-db.ts';
import { fail } from './community-db.ts';
import type { CommunityStore } from './community-store.ts';
import { IdentityBridgeError, signIdentityRequest } from './community-identity-protocol.ts';
import { communityProfileKinds, communityStaffRoles } from '../src/community-staff.ts';
import type { CommunityProfileKind, CommunityStaffRole, CommunityStaffPermission } from '../src/community-staff.ts';

export type CommunityProfileReviewerRole = CommunityStaffRole;
export type CommunityProfileReviewOperation = { action: 'inspect'; kind?: CommunityProfileKind } | { action: 'advise' | 'decide'; kind: CommunityProfileKind };
export type CommunityProfileReviewerCheck = (actor: CommunityAuthor, role: CommunityProfileReviewerRole, operation: CommunityProfileReviewOperation) => Promise<readonly CommunityProfileKind[]>;
export type CommunityProfileReviewerAuthority = (actor: CommunityAuthor, role: CommunityProfileReviewerRole, operation: CommunityProfileReviewOperation) => { kinds: readonly CommunityProfileKind[]; ancestors: readonly CommunityAuthor[] };
type Input = { actor: CommunityAuthor; role: CommunityProfileReviewerRole; operation: CommunityProfileReviewOperation };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const path = '/api/community-identity/decorations';
const denied = () => fail('审核权限发生变化，请刷新页面。', 403);
const unavailable = () => new IdentityBridgeError('审核权限确认暂不可用，请稍后重试。', 503);
export function validCommunityProfileReviewerInput(value: unknown): value is Input {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['actor', 'role', 'operation'].includes(key))
    || !('actor' in value) || !value.actor || typeof value.actor !== 'object' || Array.isArray(value.actor)
    || !('role' in value) || !communityStaffRoles.some(role => role.id === value.role)
    || !('operation' in value) || !value.operation || typeof value.operation !== 'object' || Array.isArray(value.operation)) return false;
  const operation = value.operation;
  if (Object.keys(operation).some(key => !['kind', 'action'].includes(key)) || !('action' in operation) || !['inspect', 'advise', 'decide'].includes(String(operation.action))
    || ('kind' in operation ? !communityProfileKinds.includes(operation.kind as CommunityProfileKind) : operation.action !== 'inspect')) return false;
  const actor = value.actor;
  return Object.keys(actor).every(key => ['kind', 'id'].includes(key)) && 'kind' in actor && (actor.kind === 'owner' || actor.kind === 'reader')
    && 'id' in actor && typeof actor.id === 'string' && uuid.test(actor.id);
}

/** Check HK appointments directly. No account bridge, memberships, or display cache. */
export function createCommunityProfileReviewerAuthority({ store, ownerId, readerDeleted = () => false }: {
  store: CommunityStore; ownerId: string; readerDeleted?: (id: string) => boolean;
}): CommunityProfileReviewerAuthority {
  if (!uuid.test(ownerId)) throw Error('Profile reviewer authority requires the fixed owner ID.');
  store.staff.bindOwner(ownerId);
  return (actor, role, operation) => {
    if (!validCommunityProfileReviewerInput({ actor, role, operation })) throw fail('审核身份无效。');
    const current = store.staff.state(actor);
    if (!current || current.role !== role || actor.kind === 'reader' && readerDeleted(actor.id)) throw denied();
    const kinds = communityProfileKinds.filter(kind => !operation.kind || operation.kind === kind).filter(kind => operation.action === 'inspect'
      ? store.staff.can(actor, `profile.${kind}.advise` as CommunityStaffPermission) || store.staff.can(actor, `profile.${kind}.decide` as CommunityStaffPermission)
      : store.staff.can(actor, `profile.${kind}.${operation.action}` as CommunityStaffPermission));
    if (!kinds.length) throw denied();
    return { kinds, ancestors: store.staff.ancestors(actor).filter(member => member.kind === 'reader') };
  };
}

/** Main-server-only, immediate authorization confirmation. Never reuse a positive result. */
export function createCommunityProfileReviewerClient({ origin, secret, fetch: transport = fetch, accountsActive }: {
  origin: string; secret: string; fetch?: typeof fetch; accountsActive?: (members: readonly CommunityAuthor[]) => Promise<boolean>;
}): CommunityProfileReviewerCheck {
  if (origin !== 'https://community.sansphase.com') throw Error('Profile reviewer requires the fixed community origin.');
  if (Buffer.byteLength(secret || '') < 32) throw Error('Profile reviewer requires a private bridge secret.');
  return async (actor, role, operation) => {
    if (!validCommunityProfileReviewerInput({ actor, role, operation })) throw new IdentityBridgeError('审核身份无效。', 400);
    const body = JSON.stringify({ operation: 'profile-reviewer', input: { actor, role, operation } });
    try {
      const readProof = async () => {
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
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['ok','kinds','ancestors'].includes(key)) || !('ok' in value) || value.ok !== true
        || !('kinds' in value) || !Array.isArray(value.kinds) || !value.kinds.length || value.kinds.some(kind => !communityProfileKinds.includes(kind)) || new Set(value.kinds).size !== value.kinds.length
        || operation.kind && value.kinds.some(kind => kind !== operation.kind)
        || !('ancestors' in value) || !Array.isArray(value.ancestors) || value.ancestors.length > 15 || value.ancestors.some(member => !member || typeof member !== 'object' || Array.isArray(member) || Object.keys(member).length !== 2 || member.kind !== 'reader' || typeof member.id !== 'string' || !uuid.test(member.id))
        || new Set(value.ancestors.map(member => member.id)).size !== value.ancestors.length) throw unavailable();
      return {kinds:value.kinds as CommunityProfileKind[],ancestors:value.ancestors as CommunityAuthor[]};
      };
      const value = await readProof();
      const accounts = [...(actor.kind === 'reader' ? [actor] : []), ...value.ancestors as CommunityAuthor[]];
      if (accounts.length && (!accountsActive || !await accountsActive(accounts))) throw new IdentityBridgeError('上级或当前管理账号已失效，请刷新页面。', 403);
      if(accounts.length){
        // The main-account lookup is asynchronous. Reconfirm the same HK chain
        // and permissions afterwards rather than returning its earlier proof.
        const current=await readProof();
        if(JSON.stringify(current)!==JSON.stringify(value))throw new IdentityBridgeError('审核权限发生变化，请刷新页面。',403);
        // Main accounts can be disabled while that final HTTPS read waits.
        // Close that window with a fresh local account check before returning.
        if(!accountsActive||!await accountsActive(accounts))throw new IdentityBridgeError('上级或当前管理账号已失效，请刷新页面。',403);
      }
      return value.kinds;
    } catch (error) { if (error instanceof IdentityBridgeError) throw error; throw unavailable(); }
  };
}
