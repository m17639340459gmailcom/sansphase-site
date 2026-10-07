import type { IncomingMessage, ServerResponse } from 'node:http';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { uploadLimits } from '../src/upload-policy.mjs';
import type { CommunityProfileFrame } from '../src/community-profile.ts';
import { fail } from './community-db.ts';
import type { CommunityAuthor } from './community-db.ts';
import type { CommunityStore } from './community-store.ts';
import { verifyIdentityRequest } from './community-identity-protocol.ts';
import { validCommunityProfileReviewerInput } from './community-profile-reviewer.ts';
import type { CommunityProfileReviewerAuthority } from './community-profile-reviewer.ts';

export const communityFrameBridgePath = '/api/community-identity/decorations';
export const communityFrameBytes = uploadLimits.maxImageBytes;
export type CommunityFrameState = { frame: string | null; frameImage: string | null; items: CommunityProfileFrame[]; available: boolean };
export type CommunityFrameAccess = {
  state: (readerId: string) => CommunityFrameState | Promise<CommunityFrameState>;
  equip: (readerId: string, ref: string | null) => CommunityFrameState | Promise<CommunityFrameState>;
  image: (readerId: string, imageId: string) => Promise<Buffer>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const validCommunityFrame = (ref: unknown): ref is string | null => ref === null || typeof ref === 'string' &&
  (['gold', 'orbit', 'nebula'].includes(ref) || ref.startsWith('image:') && uuid.test(ref.slice(6)));
const frameImageId = (ref: string | null) => ref?.startsWith('image:') && uuid.test(ref.slice(6)) ? ref.slice(6) : null;

/** Frame ownership and equipped state have one authority: the community economy. */
export function communityFrameItems(store: CommunityStore, member: CommunityAuthor, imagePrefix = '/api/community/images/'): CommunityProfileFrame[] {
  const owned = store.economy.owned(member);
  return store.economy.items().flatMap(item => {
    if (item.kind !== 'frame' || !owned.has(item.id) || !item.ref || !validCommunityFrame(item.ref)) return [];
    const id = frameImageId(item.ref), image = id ? store.image(id) : null;
    if (id && (!image || image.deleted_at || image.purpose !== 'shop' || !image.frame_ready)) return [];
    return [{ id: item.id, name: item.name, ref: item.ref, image: id ? `${imagePrefix}${id}.webp` : null }];
  });
}

type AuthorityOptions = { store: CommunityStore; directory: string; readerDeleted?: (id: string) => boolean };
export function createCommunityFrameAuthority({ store, directory, readerDeleted = () => false }: AuthorityOptions) {
  const member = (readerId: string): CommunityAuthor => {
    if (!uuid.test(readerId)) throw fail('读者身份无效。');
    if (readerDeleted(readerId)) throw fail('读者账号已不存在。', 404);
    return { kind: 'reader', id: readerId };
  };
  const state = (readerId: string): CommunityFrameState => {
    const reader = member(readerId), items = communityFrameItems(store, reader, '/api/reader/frame/');
    const equipped = store.members.storedDecorations(reader)?.frame ?? null;
    const frame = items.some(item => item.ref === equipped) ? equipped : null;
    const imageId = frameImageId(frame);
    return { frame, frameImage: imageId ? `/api/reader/frame/${imageId}.webp` : null, items, available: true };
  };
  return {
    state,
    equip(readerId: string, ref: string | null) {
      const reader = member(readerId);
      if (!validCommunityFrame(ref)) throw fail('请选择已拥有的头像框。');
      store.convention.assertAgreed(reader);
      store.rateLimits.consume(reader, 'action', Number(store.members.storedLevel(reader) ?? 0));
      return store.audit.run(reader, 'community-frame-equip', () => {
        member(readerId); store.convention.assertAgreed(reader);
        if (ref && !communityFrameItems(store, reader).some(item => item.ref === ref)) throw fail('还没有这个装扮。', 403);
        store.economy.equip(reader, 'frame', ref);
        return state(readerId);
      }, { ref, source: 'main-site' });
    },
    async image(readerId: string, imageId: string): Promise<Buffer> {
      const allowed = () => {
        const reader = member(readerId);
        if (!uuid.test(imageId) || !communityFrameItems(store, reader).some(item => item.ref === `image:${imageId}`)) throw fail('头像框图片不存在。', 404);
      };
      allowed();
      const path = resolve(directory, 'uploads', `community-image-${imageId}.webp`);
      let bytes: Buffer;
      try {
        const file = await lstat(path);
        if (!file.isFile() || file.isSymbolicLink() || file.size > communityFrameBytes) throw fail('头像框图片暂不可用。', 503);
        bytes = await readFile(path);
      } catch (error) { if (error && typeof error === 'object' && 'status' in error) throw error; throw fail('头像框图片不存在。', 404); }
      allowed();
      if (bytes.length > communityFrameBytes || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') throw fail('头像框图片暂不可用。', 503);
      return bytes;
    },
  };
}

type BridgeOptions = { authority: ReturnType<typeof createCommunityFrameAuthority>; secret: string; consumeNonce: (nonce: string, expiresAt: number) => boolean; profileReviewer?: CommunityProfileReviewerAuthority };
/** Main-server-only projections and equip. This is not a browser/community bypass. */
export function createCommunityFrameBridge({ authority, secret, consumeNonce, profileReviewer }: BridgeOptions) {
  const send = (res: ServerResponse, value: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  return {
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      if (new URL(req.url || '/', 'https://community.sansphase.com').pathname !== communityFrameBridgePath) return false;
      if (req.method !== 'POST') { send(res, { error: 'Not found' }, 404); return true; }
      try {
        if (Number(req.headers['content-length']) > 8192) throw fail('请求内容过大。', 413);
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 8192) throw fail('请求内容过大。', 413); chunks.push(Buffer.from(chunk)); }
        const raw = Buffer.concat(chunks);
        try { verifyIdentityRequest({ secret, method: 'POST', path: communityFrameBridgePath, body: raw, headers: req.headers, consumeNonce }); }
        catch { throw fail('头像框桥接验证失败。', 403); }
        let body: unknown;
        try { body = JSON.parse(raw.toString('utf8')); } catch { throw fail('请求内容无效。'); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || !('operation' in body) || !('input' in body)) throw fail('请求内容无效。');
        const operation = body.operation, input = body.input;
        if (operation === 'profile-reviewer') {
          if (!validCommunityProfileReviewerInput(input)) throw fail('审核确认参数无效。');
          if (!profileReviewer) throw fail('审核权限确认尚未配置。', 503);
          const proof = profileReviewer(input.actor, input.role, input.operation); send(res, { ok: true, ...proof }); return true;
        }
        if (!input || typeof input !== 'object' || Array.isArray(input) || !('readerId' in input) || typeof input.readerId !== 'string') throw fail('请求内容无效。');
        const keys = Object.keys(input);
        if (operation === 'frame-state' && keys.every(key => key === 'readerId')) send(res, authority.state(input.readerId));
        else if (operation === 'frame-equip' && keys.every(key => ['readerId', 'ref'].includes(key)) && 'ref' in input && validCommunityFrame(input.ref)) send(res, authority.equip(input.readerId, input.ref));
        else if (operation === 'frame-image' && keys.every(key => ['readerId', 'imageId'].includes(key)) && 'imageId' in input && typeof input.imageId === 'string') {
          const data = await authority.image(input.readerId, input.imageId);
          res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': data.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(data);
        } else throw fail('请求内容无效。');
      } catch (error) {
        const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 503;
        if (!res.headersSent) send(res, { error: status >= 500 ? '头像框暂不可用，请稍后再试。' : error instanceof Error ? error.message : '请求内容无效。' }, status);
      }
      return true;
    },
  };
}
