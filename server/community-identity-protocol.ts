import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { CommunityViewer } from './community-context.ts';

export const identityBridgePath = '/api/community-identity/bridge';
export const identityHandoffCookie = 'sansphase_community_handoff';
export const identityRequestBytes = 64 * 1024;
// Only a normalized 320px avatar may use this finite envelope. Other bridge
// operations retain their original request cap.
export const identityAvatarRequestBytes = 704 * 1024;
export const identityResponseBytes = 2 * 1024 * 1024;
export type IdentityOperation = 'exchange' | 'session' | 'people' | 'member' | 'names' | 'avatar' | 'frame-eligibility'
  | 'profile' | 'profile-signature' | 'profile-nickname' | 'profile-avatar' | 'profile-avatar-remove' | 'profile-avatar-pending'
  | 'profile-reviews' | 'profile-review-image' | 'profile-review' | 'profile-advise';
export type IdentityReader = { id: string; uid: string | null; nickname: string; signature: string; avatar: string | null; role: 'reader'; vip: boolean; vipStartedAt: string | null; vipUntil: string | null };
export type IdentityDTO = { viewer: CommunityViewer; reader: IdentityReader | null; author: { name: string } | null; ownerReader?: IdentityReader };
// Internal account projection only. Neither a browser assertion nor permanent inventory.
export type IdentityFrameEligibility = { active: boolean; vip: boolean; vipUntil: string | null };
// The source binds immutable approved bytes to their full upload UUID. An
// unchanged result is only a current approval confirmation, never authority
// to skip the caller's session checks or to read a caller-selected file.
export type ApprovedAvatarRead = { version: string; bytes: Buffer } | { version: string; unchanged: true };
export class IdentityBridgeError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.name = 'IdentityBridgeError'; this.status = status; }
}
export const identityHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const opaqueIdentityValue = () => randomBytes(32).toString('base64url');
export const validIdentityValue = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const requireSecret = (secret: string) => { if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw Error('A separate identity bridge secret of at least 32 bytes is required.'); };
export function identityPeerOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Identity peer must be a fixed HTTPS origin.');
  return url.origin;
}
const safePath = (path: string) => /^\/api\/community-identity\/(?:bridge|purge|decorations)$/.test(path);
const signingValue = (method: string, path: string, body: string | Buffer, timestamp: string, nonce: string) => `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${identityHash(body)}`;
type SigningOptions = { secret: string; method: string; path: string; body: string | Buffer; timestamp?: string; nonce?: string };
export function signIdentityRequest({ secret, method, path, body, timestamp = String(Date.now()), nonce = opaqueIdentityValue() }: SigningOptions): Record<string, string> {
  requireSecret(secret);
  if (!safePath(path) || !/^\d{13}$/.test(timestamp) || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) throw Error('Invalid identity signature parameters.');
  return { 'x-community-timestamp': timestamp, 'x-community-nonce': nonce, 'x-community-signature': createHmac('sha256', secret).update(signingValue(method, path, body, timestamp, nonce)).digest('hex') };
}
export function verifyIdentityRequest({ secret, method, path, body, headers, now = Date.now(), consumeNonce }: SigningOptions & { headers: IncomingHttpHeaders; now?: number; consumeNonce: (nonce: string, expiresAt: number) => boolean }): void {
  requireSecret(secret);
  const timestamp = headers['x-community-timestamp'], nonce = headers['x-community-nonce'], signature = headers['x-community-signature'];
  const invalid = () => new IdentityBridgeError('身份桥接验证失败。', 401);
  if (!safePath(path) || typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60_000 || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce) || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw invalid();
  const expected = createHmac('sha256', secret).update(signingValue(method, path, body, timestamp, nonce)).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw invalid();
  if (!consumeNonce(nonce, now + 120_000)) throw invalid();
}

type ClientOptions = { origin: string; secret: string; path?: string; timeoutMs?: number; fetch?: typeof fetch };
export function createIdentityClient({ origin, secret, path = identityBridgePath, timeoutMs = 8_000, fetch: transport = fetch }: ClientOptions) {
  const peer = identityPeerOrigin(origin); requireSecret(secret);
  if (!safePath(path) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw Error('Invalid identity client configuration.');
  return { async request<T = unknown>(operation: string, input: unknown): Promise<T> {
    const body = JSON.stringify({ operation, input });
    if (Buffer.byteLength(body) > (operation === 'profile-avatar' ? identityAvatarRequestBytes : identityRequestBytes)) throw new IdentityBridgeError('身份请求内容过大。', 413);
    try {
      const response = await transport(peer + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { 'Content-Type': 'application/json', ...(operation === 'profile-avatar' ? { 'x-community-operation': operation } : {}), ...signIdentityRequest({ secret, method: 'POST', path, body }) }, body });
      if (response.redirected || !response.body) throw new IdentityBridgeError('账号服务暂不可用。');
      const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > identityResponseBytes) { await reader.cancel(); throw new IdentityBridgeError('账号服务暂不可用。'); } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!response.ok) {
        const status = [400, 401, 403, 404, 409, 413, 415, 429].includes(response.status) ? response.status : 503;
        const safeMessage = status < 500 && status !== 401 && value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' && value.error.length <= 240 ? value.error : null;
        throw new IdentityBridgeError(status === 401 ? '请从主站重新进入社区。' : status === 429 ? '操作过于频繁，请稍后再试。' : safeMessage || '账号服务暂不可用。', status);
      }
      return value as T;
    } catch (error) { if (error instanceof IdentityBridgeError) throw error; throw new IdentityBridgeError('账号服务暂不可用。'); }
  } };
}
