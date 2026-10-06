import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CommunityAuthor } from './community-db.ts';
import type { PersonInfo } from './community-context.ts';
import { clientAddress } from './client-ip.ts';
import { createIdentityStore } from './community-identity-store.ts';
import type { IdentitySourceSession } from './community-identity-store.ts';
import { IdentityBridgeError, identityBridgePath, identityHandoffCookie, identityPeerOrigin, identityRequestBytes, identityAvatarRequestBytes, verifyIdentityRequest } from './community-identity-protocol.ts';
import type { IdentityDTO } from './community-identity-protocol.ts';
import { normalizeReaderAvatar, readerProfileAvatarBytes } from './reader-profile-commands.ts';
import type { ReaderProfileCommands } from './reader-profile-commands.ts';
import type { ProfileKind } from './reader-workflow.ts';
import type { CommunityProfileReviewerCheck } from './community-profile-reviewer.ts';

type ReaderSource = { id: string; uid?: string | null; nickname: string; signature?: string | null; avatar?: string | null; vip?: boolean; vipStartedAt?: string | null; vipUntil?: string | null };
export type IdentityAuthorityOptions = {
  directory: string; siteOrigin: string; communityOrigin: string; ownerId: string; secret: string; stateEncryptionKey: string;
  readerIdentity: (req: IncomingMessage) => Promise<ReaderSource | null>;
  ownerIdentity: (req: IncomingMessage) => Promise<{ name: string } | null>;
  people: (authors: CommunityAuthor[]) => Promise<Map<string, PersonInfo>>;
  findMember: (uid: string) => Promise<CommunityAuthor | null>;
  findByNames: (names: string[]) => Promise<Map<string, CommunityAuthor>>;
  avatar: (uid: string) => Promise<Buffer | null>;
  purgeRemote?: (readerId: string) => Promise<unknown>;
  profiles?: ReaderProfileCommands;
  profileReviewer?: CommunityProfileReviewerCheck;
  now?: () => number;
};
const invalidSession = () => new IdentityBridgeError('请从主站重新进入社区。', 401);
const invalidInput = () => new IdentityBridgeError('身份请求内容无效。', 400);
const objectValue = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput(); return value as Record<string, unknown>; };
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => { if (Object.keys(value).some(key => !keys.includes(key))) throw invalidInput(); };
const memberValue = (value: unknown): CommunityAuthor => {
  const member = objectValue(value);
  if (!['reader', 'owner'].includes(String(member.kind)) || typeof member.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(member.id)) throw invalidInput();
  return { kind: member.kind as CommunityAuthor['kind'], id: member.id };
};
function selectedCookie(req: IncomingMessage, kind: 'reader' | 'owner') {
  const name = kind === 'reader' ? 'sansphase_reader_session' : 'sansphase_author_session';
  const values = String(req.headers.cookie || '').split(';').map(item => item.trim()).filter(item => item.startsWith(name + '='));
  if (values.length !== 1 || !new RegExp(`^${name}=[A-Za-z0-9._-]{1,8192}$`).test(values[0])) throw invalidSession();
  return values[0];
}
async function bodyOf(req: IncomingMessage, limit = identityRequestBytes) {
  if (Number(req.headers['content-length']) > limit) throw new IdentityBridgeError('身份请求内容过大。', 413);
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new IdentityBridgeError('身份请求内容过大。', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const statusOf = (error: unknown) => error instanceof IdentityBridgeError ? error.status : 503;
export function createIdentityAuthority(options: IdentityAuthorityOptions) {
  const siteOrigin = identityPeerOrigin(options.siteOrigin), communityOrigin = identityPeerOrigin(options.communityOrigin);
  if (siteOrigin !== 'https://www.sansphase.com' || communityOrigin !== 'https://community.sansphase.com' || !options.ownerId || Buffer.byteLength(options.secret || '') < 32 || options.secret === options.stateEncryptionKey) throw Error('Identity authority requires the approved origins, fixed owner and separate private keys.');
  const store = createIdentityStore(options), now = options.now || Date.now;
  const send = (res: ServerResponse, value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
  const errorTo = (res: ServerResponse, error: unknown) => { if (!res.headersSent) send(res, { error: statusOf(error) >= 500 ? '账号服务暂不可用，请稍后再试。' : error instanceof Error ? error.message : '身份请求无效。' }, statusOf(error)); };
  async function identity(req: IncomingMessage, source?: IdentitySourceSession): Promise<IdentityDTO> {
    const request = source ? Object.assign(Object.create(req) as IncomingMessage, { headers: { cookie: source.cookie } }) : req;
    const reader = await options.readerIdentity(request);
    if (reader) {
      if (source && (source.kind !== 'reader' || source.id !== String(reader.id))) throw invalidSession();
      return { viewer: { kind: 'reader', id: String(reader.id), name: reader.nickname, vip: reader.vip === true }, reader: { id: String(reader.id), uid: reader.uid || null, nickname: reader.nickname, signature: reader.signature || '', avatar: reader.avatar || null, role: 'reader', vip: reader.vip === true, vipStartedAt: reader.vipStartedAt || null, vipUntil: reader.vipUntil || null }, author: null };
    }
    const owner = await options.ownerIdentity(request);
    if (owner) {
      if (source && (source.kind !== 'owner' || source.id !== options.ownerId)) throw invalidSession();
      return { viewer: { kind: 'owner', id: options.ownerId, name: owner.name, vip: true }, reader: null, author: { name: owner.name } };
    }
    throw invalidSession();
  }
  async function validateSession(req: IncomingMessage, input: Record<string, unknown>) {
    if (typeof input.sessionRef !== 'string') throw invalidSession();
    const source = store.session(input.sessionRef, now());
    if (!source) throw invalidSession();
    return identity(req, source);
  }
  return {
    async handleEntry(req: IncomingMessage, res: ServerResponse) {
      try {
        if (req.method !== 'POST' || req.url !== '/api/community-entry') throw new IdentityBridgeError('不存在的操作。', 404);
        if (req.headers.origin !== siteOrigin || req.headers['x-reader-request'] !== '1') throw new IdentityBridgeError('请从主站操作。', 403);
        await bodyOf(req, 1024); store.prune(now());
        if (!store.limit(`entry-ip:${clientAddress(req).ip || 'unknown'}`, 30, 60_000, now())) throw new IdentityBridgeError('进入社区过于频繁，请稍后再试。', 429);
        const dto = await identity(req);
        if (!store.limit(`entry-member:${dto.viewer.kind}:${dto.viewer.id}`, 8, 60_000, now())) throw new IdentityBridgeError('进入社区过于频繁，请稍后再试。', 429);
        const issued = store.issue({ kind: dto.viewer.kind, id: dto.viewer.id, cookie: selectedCookie(req, dto.viewer.kind) }, now());
        res.setHeader('Set-Cookie', `${identityHandoffCookie}=${issued.binding}; Domain=sansphase.com; Path=/api/community-entry; HttpOnly; Secure; SameSite=Strict; Max-Age=60`);
        send(res, { url: `${communityOrigin}/community-enter#community-entry=${issued.ticket}`, expiresAt: new Date(issued.expiresAt).toISOString() });
      } catch (error) { errorTo(res, error); }
    },
    async handleBridge(req: IncomingMessage, res: ServerResponse) {
      try {
        if (req.method !== 'POST' || req.url !== identityBridgePath) throw new IdentityBridgeError('不存在的操作。', 404);
        const avatarEnvelope = req.headers['x-community-operation'] === 'profile-avatar';
        const body = await bodyOf(req, avatarEnvelope ? identityAvatarRequestBytes : identityRequestBytes);
        verifyIdentityRequest({ secret: options.secret, method: req.method, path: identityBridgePath, body, headers: req.headers, now: now(), consumeNonce: store.consumeNonce });
        store.prune(now());
        let value: Record<string, unknown>;
        try { value = objectValue(JSON.parse(body.toString('utf8'))); } catch { throw invalidInput(); }
        const input = objectValue(value.input);
        if (avatarEnvelope && value.operation !== 'profile-avatar' || !avatarEnvelope && body.length > identityRequestBytes) throw invalidInput();
        if (value.operation === 'exchange') {
          if (typeof input.ticket !== 'string' || typeof input.binding !== 'string') throw invalidSession();
          const source = store.ticket(input.ticket, input.binding, now()); if (!source) throw invalidSession();
          const dto = await identity(req, source), sessionRef = store.exchange(input.ticket, input.binding, now());
          if (!sessionRef) throw invalidSession();
          send(res, { sessionRef, identity: dto }); return;
        }
        const profileOperation = typeof value.operation === 'string' && ['profile', 'profile-signature', 'profile-avatar', 'profile-avatar-remove', 'profile-avatar-pending', 'profile-reviews', 'profile-review-image', 'profile-review'].includes(value.operation);
        if (!profileOperation && !['session', 'people', 'member', 'names', 'avatar'].includes(String(value.operation))) throw invalidInput();
        const dto = await validateSession(req, input);
        if (profileOperation) {
          const profiles = options.profiles;
          if (!profiles) throw new IdentityBridgeError('资料服务尚未配置。', 404);
          const check = async () => { const current = await validateSession(req, input); if (current.viewer.kind !== dto.viewer.kind || current.viewer.id !== dto.viewer.id) throw invalidSession(); };
          const reviewOperation = ['profile-reviews', 'profile-review-image', 'profile-review'].includes(String(value.operation));
          if (reviewOperation) {
            exactKeys(input, ['sessionRef', 'moderation', ...(value.operation === 'profile-reviews' ? [] : ['id']), ...(value.operation === 'profile-review' ? ['decision'] : [])]);
            const assertion = objectValue(input.moderation); exactKeys(assertion, ['role', 'actor']);
            const actor = memberValue(assertion.actor); exactKeys(objectValue(assertion.actor), ['kind', 'id']);
            if (actor.kind !== dto.viewer.kind || actor.id !== dto.viewer.id
              || dto.viewer.kind === 'owner' && assertion.role !== 'owner'
              || dto.viewer.kind === 'reader' && assertion.role !== 'steward') throw new IdentityBridgeError('没有审核资料的权限。', 403);
            // HK alone owns moderator appointments. The signed assertion binds
            // the actor; a finite callback rechecks the current appointment
            // inside the account command's queue, immediately before approval.
            const reviewCheck = async () => {
              await check();
              if (!options.profileReviewer) throw new IdentityBridgeError('资料审核服务尚未配置。', 503);
              await options.profileReviewer(actor, assertion.role as 'owner'|'steward');
            };
            const kinds: readonly ProfileKind[] = dto.viewer.kind === 'owner' ? ['avatar', 'signature'] : ['avatar'];
            if (value.operation === 'profile-reviews') { await reviewCheck(); const rows = await profiles.reviews(kinds); await reviewCheck(); send(res, rows); return; }
            if (typeof input.id !== 'string') throw invalidInput();
            if (value.operation === 'profile-review-image') { const image = await profiles.reviewImage(input.id, reviewCheck); send(res, { base64: image.toString('base64') }); return; }
            if (input.decision !== 'approve' && input.decision !== 'reject') throw invalidInput();
            if (!store.limit(`profile-review:${dto.viewer.kind}:${dto.viewer.id}`, 60, 60_000, now())) throw new IdentityBridgeError('操作过于频繁，请稍后再试。', 429);
            send(res, await profiles.review(input.id, input.decision, { ...actor, source: 'community' }, kinds, reviewCheck)); return;
          }
          if (dto.viewer.kind !== 'reader') throw new IdentityBridgeError('当前身份不能修改读者资料。', 403);
          exactKeys(input, ['sessionRef', ...(value.operation === 'profile-signature' ? ['signature'] : value.operation === 'profile-avatar' ? ['base64'] : [])]);
          if (value.operation === 'profile') { send(res, await profiles.state(dto.viewer.id)); return; }
          if (value.operation === 'profile-avatar-pending') { const image = await profiles.pendingAvatar(dto.viewer.id, check); send(res, { base64: image.toString('base64') }); return; }
          if (!store.limit(`profile-write:${dto.viewer.id}`, 30, 60_000, now())) throw new IdentityBridgeError('操作过于频繁，请稍后再试。', 429);
          if (value.operation === 'profile-signature') { send(res, await profiles.submitSignature(dto.viewer.id, input.signature, check)); return; }
          if (value.operation === 'profile-avatar-remove') { send(res, await profiles.removeAvatar(dto.viewer.id, check)); return; }
          if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(readerProfileAvatarBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)) throw invalidInput();
          const bytes = Buffer.from(input.base64, 'base64');
          if (bytes.toString('base64') !== input.base64 || bytes.length > readerProfileAvatarBytes) throw invalidInput();
          const image = await normalizeReaderAvatar(bytes, 'image/webp');
          send(res, await profiles.submitAvatar(dto.viewer.id, image, check)); return;
        }
        if (value.operation === 'session') { send(res, dto); return; }
        if (value.operation === 'people') {
          if (!Array.isArray(input.authors) || input.authors.length > 100) throw invalidInput();
          const authors = input.authors.map(memberValue), map = await options.people(authors);
          const requested = new Set(authors.map(author => `${author.kind}:${author.id}`));
          send(res, [...map].filter(([key]) => requested.has(key)).map(([key, info]) => [key, { name: info.name, uid: info.uid, avatar: info.avatar, vip: info.vip === true, joinedAt: info.joinedAt, bio: info.bio }])); return;
        }
        if (value.operation === 'member' || value.operation === 'avatar') {
          if (typeof input.uid !== 'string' || !/^[0-9a-z]{1,15}$/.test(input.uid)) throw invalidInput();
          if (value.operation === 'member') { const member = await options.findMember(input.uid); send(res, member ? memberValue(member) : null); return; }
          const avatar = await options.avatar(input.uid);
          if (avatar && avatar.length > 1_500_000) throw new IdentityBridgeError('头像服务暂不可用。');
          send(res, avatar ? { base64: avatar.toString('base64') } : null); return;
        }
        if (!Array.isArray(input.names) || input.names.length > 50 || input.names.some(name => typeof name !== 'string' || !name.trim() || [...name].length > 8)) throw invalidInput();
        const names = input.names as string[], result = await options.findByNames(names), requested = new Set(names);
        send(res, [...result].filter(([name]) => requested.has(name)).map(([name, member]) => [name, memberValue(member)]));
      } catch (error) {
        const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 503;
        errorTo(res, error instanceof IdentityBridgeError ? error : [400,401,403,404,409,413,415,429].includes(status) && error instanceof Error ? new IdentityBridgeError(error.message,status) : error);
      }
    },
    async purgeReaderData(readerId: string) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(readerId) || !options.purgeRemote) throw new IdentityBridgeError('社区清理服务尚未配置。');
      await options.purgeRemote(readerId);
    },
    close() { store.close(); },
  };
}
