import { communityFrameBridgePath, communityFrameBytes, validCommunityFrame, vipCommunityFrame } from './community-frame-authority.ts';
import type { CommunityFrameAccess, CommunityFrameState } from './community-frame-authority.ts';
import { IdentityBridgeError, signIdentityRequest, identityResponseBytes } from './community-identity-protocol.ts';

type Options = { origin: string; secret: string; fetch?: typeof fetch };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const framePath = /^\/api\/reader\/frame\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
const unavailable = () => new IdentityBridgeError('头像框暂不可用，请稍后再试。', 503);
const currentProjection = (value: CommunityFrameState): CommunityFrameState => value.vipUntil && Date.parse(value.vipUntil) > Date.now() ? value : {
  ...value, frame: value.frame === vipCommunityFrame ? null : value.frame, items: value.items.filter(item => item.ref !== vipCommunityFrame),
};
const projectionDeadline = (value: CommunityFrameState) => {
  const until = value.vipUntil ? Date.parse(value.vipUntil) : NaN;
  return Number.isFinite(until) && until > Date.now() ? Math.min(Date.now() + 5000, until) : Date.now() + 5000;
};
function validatedState(value: unknown): CommunityFrameState {
  if (!value || typeof value !== 'object' || !('frame' in value) || !validCommunityFrame(value.frame) || !('frameImage' in value)
    || !(value.frameImage === null || typeof value.frameImage === 'string' && framePath.test(value.frameImage)) || !('items' in value) || !Array.isArray(value.items)
    || !('available' in value) || value.available !== true || value.items.length > 1000) throw unavailable();
  const frame = value.frame, frameImage = value.frameImage;
  if (frame?.startsWith('image:') ? frameImage !== `/api/reader/frame/${frame.slice(6)}.webp` : frameImage !== null) throw unavailable();
  const items = value.items.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string' || item.id.length > 128 || !('name' in item)
      || typeof item.name !== 'string' || [...item.name].length > 80 || !('ref' in item) || typeof item.ref !== 'string' || !validCommunityFrame(item.ref)
      || !('image' in item) || !(item.image === null || typeof item.image === 'string' && framePath.test(item.image))) throw unavailable();
    if (item.ref.startsWith('image:') ? item.image !== `/api/reader/frame/${item.ref.slice(6)}.webp` : item.image !== null) throw unavailable();
    return { id: item.id, name: item.name, ref: item.ref, image: item.image };
  });
  if (frame && !items.some(item => item.ref === frame)) throw unavailable();
  const hasExpiry = 'vipUntil' in value;
  if (hasExpiry && !(value.vipUntil === null || typeof value.vipUntil === 'string' && Number.isFinite(Date.parse(value.vipUntil)))) throw unavailable();
  if (items.some(item => item.ref === vipCommunityFrame) && (!hasExpiry || typeof value.vipUntil !== 'string')) throw unavailable();
  return currentProjection({ frame, frameImage, items, available: true,
    ...(hasExpiry ? { vipUntil: value.vipUntil as string | null } : {}) });
}

/** Fixed signed peer only; no caller-supplied URL or general HTTP proxy. */
export function createCommunityFrameClient({ origin, secret, fetch: transport = fetch }: Options): CommunityFrameAccess {
  if (origin !== 'https://community.sansphase.com') throw Error('Frame authority requires the fixed community origin.');
  type Projection = { expiresAt: number; value?: CommunityFrameState; error?: IdentityBridgeError; pending?: Promise<CommunityFrameState> };
  // Display projections are neither inventory nor authorization. Equip/image
  // always ask the authority; account changes cannot borrow another entry.
  const projections = new Map<string, Projection>();
  const remember = (id: string, entry: Projection) => {
    projections.delete(id); projections.set(id, entry);
    while (projections.size > 256) projections.delete(projections.keys().next().value!);
  };
  const request = async (operation: 'frame-state' | 'frame-equip' | 'frame-image', input: Record<string, unknown>) => {
    const body = JSON.stringify({ operation, input });
    try {
      const response = await transport(origin + communityFrameBridgePath, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(operation === 'frame-state' ? 1000 : 8000),
        headers: { 'Content-Type': 'application/json', ...signIdentityRequest({ secret, method: 'POST', path: communityFrameBridgePath, body }) }, body });
      if (response.redirected || !response.body) throw unavailable();
      const media = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const maximum = operation === 'frame-image' && response.ok ? communityFrameBytes : identityResponseBytes;
      if (Number(response.headers.get('content-length') || 0) > maximum) throw unavailable();
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > maximum) { await reader.cancel(); throw unavailable(); } chunks.push(chunk.value); } }
      finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      if (!response.ok) {
        const status = [400, 401, 403, 404, 409, 413, 428, 429].includes(response.status) ? response.status : 503;
        const data: unknown = media === 'application/json' ? JSON.parse(bytes.toString('utf8')) : null;
        const error = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error.length <= 250 ? data.error : '头像框暂不可用，请稍后再试。';
        throw new IdentityBridgeError(error, status);
      }
      if (operation === 'frame-image') {
        if (media !== 'image/webp' || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') throw unavailable();
        return bytes;
      }
      if (media !== 'application/json') throw unavailable();
      return validatedState(JSON.parse(bytes.toString('utf8')));
    } catch (error) { if (error instanceof IdentityBridgeError) throw error; throw unavailable(); }
  };
  const checkedReader = (readerId: string) => { if (!uuid.test(readerId)) throw new IdentityBridgeError('读者身份无效。', 400); };
  return {
    async state(readerId) {
      checkedReader(readerId);
      const saved = projections.get(readerId);
      if (saved?.pending) return saved.pending.then(currentProjection);
      if (saved && saved.expiresAt > Date.now()) {
        if (saved.value) return currentProjection(saved.value);
        if (saved.error) throw saved.error;
      }
      const entry: Projection = { expiresAt: 0 };
      remember(readerId, entry);
      entry.pending = request('frame-state', { readerId }).then(result => {
        const value = result as CommunityFrameState;
        const latest = projections.get(readerId);
        if (latest !== entry) return currentProjection(latest?.value ?? value);
        entry.value = value; entry.expiresAt = projectionDeadline(value);
        return currentProjection(value);
      }, error => {
        const latest = projections.get(readerId);
        if (latest !== entry && latest?.value) return currentProjection(latest.value);
        if (latest === entry) { entry.error = error instanceof IdentityBridgeError ? error : unavailable(); entry.expiresAt = Date.now() + 1000; }
        throw error;
      }).finally(() => { entry.pending = undefined; });
      return entry.pending.then(currentProjection);
    },
    async equip(readerId, ref) {
      checkedReader(readerId); if (!validCommunityFrame(ref)) throw new IdentityBridgeError('请选择已拥有的头像框。', 400);
      const value = await request('frame-equip', { readerId, ref }) as CommunityFrameState;
      remember(readerId, { value, expiresAt: projectionDeadline(value) });
      return currentProjection(value);
    },
    async image(readerId, imageId) { checkedReader(readerId); if (!uuid.test(imageId)) throw new IdentityBridgeError('头像框图片不存在。', 404); return await request('frame-image', { readerId, imageId }) as Buffer; },
  };
}
