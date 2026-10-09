import type { IncomingMessage, ServerResponse } from 'node:http';
import { communityApprovedAvatarURL, isApprovedAvatarVersion } from './community-avatar-url.ts';
import { LRUCache } from 'lru-cache';
import { removeImageVariants } from './image-variants.ts';
import { appendFile, lstat, readFile, realpath, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCommunityStore, communityTablesReady } from './community-store.ts';
import type { CommunityAuthor } from './community-store.ts';
import { createCommunityService } from './community-service.ts';
import type { PersonInfo } from './community-service.ts';
import { createIdentityClient, IdentityBridgeError } from './community-identity-protocol.ts';
import type { IdentityOperation } from './community-identity-protocol.ts';
import type { ReaderProfileState, ReaderProfileReview, ReaderProfileDecision } from './reader-profile-commands.ts';
import { readerProfileAvatarBytes } from './reader-profile-commands.ts';
import type { CommunityProfileAccess } from './community-profile-access.ts';
import { createCommunityHostStore } from './community-host-store.ts';
import { createCommunityHostAccess } from './community-host-access.ts';
import { createCommunityFrameAuthority, createCommunityFrameBridge } from './community-frame-authority.ts';
import { createCommunityProfileReviewerAuthority } from './community-profile-reviewer.ts';

type BrandProfile = { name: string; signature?: string; bio?: string; avatar?: string; background?: string; socialLinks?: Array<{ label: string; url: string }>; appearance?: Record<string, unknown> };
export type CommunityHostConfig = { directory: string; siteOrigin: string; mainSiteOrigin: string; bridgeSecret: string; authorId: string; profile?: BrandProfile };
type BridgeClient = { request<T = unknown>(operation: IdentityOperation, input: unknown): Promise<T> };
type ServiceError = Error & { status: number };
const failure = (message: string, status = 503): ServiceError => Object.assign(Error(message), { status });
const words = (directory: string) => {
  try { return readFileSync(resolve(directory, 'community-words.txt'), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')); }
  catch { return []; }
};

export function communityHostProductionOptions(env: Record<string, string | undefined>, nodeVersion = process.versions.node) {
  if (env.NODE_ENV !== 'production') throw Error('NODE_ENV must be production.');
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion);
  if (!version || Number(version[1]) !== 24 || Number(version[2]) < 21) throw Error('Production requires Node.js >=24.21.0 <25.');
  if (env.SITE_ORIGIN !== 'https://community.sansphase.com') throw Error('SITE_ORIGIN must be the fixed HTTPS community origin.');
  const configPath = env.COMMUNITY_CONFIG_FILE;
  if (!configPath || !isAbsolute(configPath)) throw Error('COMMUNITY_CONFIG_FILE must be an absolute private path.');
  const host = env.HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw Error('Community app must listen on loopback behind HTTPS.');
  const port = Number(env.PORT || 4176);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('PORT must be between 1024 and 65535.');
  return { configPath, host, port, origin: env.SITE_ORIGIN };
}

export async function readCommunityHostConfig(configPath: string, publicRoot: string): Promise<CommunityHostConfig> {
  if (!isAbsolute(configPath)) throw Error('Community config path must be absolute.');
  const configStat = await lstat(configPath);
  if (!configStat.isFile() || configStat.isSymbolicLink() || process.platform !== 'win32' && (configStat.mode & 0o077) !== 0) throw Error('Community config must be a private regular file.');
  const root = await realpath(publicRoot);
  const configReal = await realpath(configPath);
  if (configReal === root || configReal.startsWith(root + sep)) throw Error('Community config must not be publicly served.');
  const settings: unknown = JSON.parse(await readFile(configPath, 'utf8'));
  if (!settings || typeof settings !== 'object' || !('directory' in settings) || typeof settings.directory !== 'string' || !isAbsolute(settings.directory)
    || !('siteOrigin' in settings) || settings.siteOrigin !== 'https://community.sansphase.com'
    || !('mainSiteOrigin' in settings) || settings.mainSiteOrigin !== 'https://www.sansphase.com'
    || !('bridgeSecret' in settings) || typeof settings.bridgeSecret !== 'string' || Buffer.byteLength(settings.bridgeSecret) < 32
    || !('authorId' in settings) || typeof settings.authorId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(settings.authorId)) throw Error('Independent community configuration is incomplete.');
  if ('secret' in settings || 'push' in settings || 'payload' in settings) throw Error('Main-site Payload settings must not be copied to community.');
  const dataStat = await lstat(settings.directory);
  if (!dataStat.isDirectory() || dataStat.isSymbolicLink()) throw Error('Community directory must be a real private directory.');
  const directory = await realpath(settings.directory);
  if (directory === root || directory.startsWith(root + sep)) throw Error('Community data must not be publicly served.');
  for (const filename of ['content.db', 'community-host.db', 'uploads']) {
    const stat = await lstat(resolve(directory, filename));
    if (stat.isSymbolicLink() || filename === 'uploads' && !stat.isDirectory() || filename !== 'uploads' && !stat.isFile()) throw Error('Community data must not contain symlinks or unexpected files.');
  }
  let profile: BrandProfile | undefined;
  if ('profile' in settings && settings.profile !== undefined) {
    const value = settings.profile;
    if (!value || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string' || [...value.name].length > 80) throw Error('Community brand profile is invalid.');
    // Config holds only an approved public profile. Unknown fields are never
    // copied to the browser or loaded as main-site account configuration.
    profile = { name: value.name };
    for (const field of ['signature', 'bio', 'avatar', 'background'] as const) {
      if (field in value) { const text = (value as Record<string, unknown>)[field]; if (typeof text === 'string') profile[field] = text; }
    }
    if ('socialLinks' in value && Array.isArray(value.socialLinks)) profile.socialLinks = value.socialLinks.filter((link): link is { label: string; url: string } => link && typeof link === 'object' && typeof link.label === 'string' && typeof link.url === 'string');
    if ('appearance' in value && value.appearance && typeof value.appearance === 'object' && !Array.isArray(value.appearance)) profile.appearance = value.appearance as Record<string, unknown>;
  }
  return { directory, siteOrigin: settings.siteOrigin, mainSiteOrigin: settings.mainSiteOrigin, bridgeSecret: settings.bridgeSecret, authorId: settings.authorId, ...(profile ? { profile } : {}) };
}

// No Payload, reader collection, password service or main-site account cleanup
// is constructed here. Community business uses its existing local modules.
export function createCommunityHostRuntime(config: CommunityHostConfig, client: BridgeClient = createIdentityClient({ origin: config.mainSiteOrigin, secret: config.bridgeSecret })) {
  const { directory, siteOrigin, mainSiteOrigin, authorId } = config;
  if (!isAbsolute(directory) || siteOrigin !== 'https://community.sansphase.com' || mainSiteOrigin !== 'https://www.sansphase.com' || !authorId) throw Error('Invalid independent community runtime configuration.');
  if (!existsSync(resolve(directory, 'content.db')) || !communityTablesReady(directory)) throw Error('Explicit community migration is required before startup.');
  const contentDb = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try {
    if (contentDb.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('readers','authors')").get()) throw Error('Independent community database must not contain main-site accounts.');
  } catch (error) { contentDb.close(); throw error; }
  const hostStore = createCommunityHostStore(directory);
  const store = createCommunityStore(directory, { queueFile: (filename, reason) => hostStore.queueFile(filename, reason) });
  let queueRun: Promise<{ removed: number; retained: number }> | null = null;
  const drainFileQueue = () => queueRun ??= (async () => {
    let removed = 0, retained = 0;
    for (const entry of hostStore.fileQueue()) {
      const id = hostStore.imageId(entry.filename);
      if (!id || contentDb.prepare('SELECT 1 FROM community_images WHERE id=?').get(id)) { retained++; continue; }
      const path = resolve(directory, 'uploads', entry.filename);
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink()) { retained++; hostStore.retryFile(entry.filename); continue; }
        // The registry is checked again immediately before unlink. A queued
        // rolled-back purge can therefore never remove a still-used picture.
        if (contentDb.prepare('SELECT 1 FROM community_images WHERE id=?').get(id)) { retained++; continue; }
        if(entry.filename.startsWith('community-image-')) await removeImageVariants(directory,path,async()=>{
          if(contentDb.prepare('SELECT 1 FROM community_images WHERE id=?').get(id)) throw Error('Community image remains registered.');
          await unlink(path);
        });
        else await unlink(path);
        hostStore.completeFile(entry.filename); removed++;
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') { hostStore.completeFile(entry.filename); removed++; }
        else { hostStore.retryFile(entry.filename); retained++; }
      }
    }
    return { removed, retained };
  })().finally(() => { queueRun = null; });
  let avatarVisibilityRevision = 0;
  const purge = async (readerId: string) => {
    // This is called only by the HMAC-authenticated notification surface.
    // Commit a durable tombstone before SQL/file cleanup: already-running
    // identity/profile responses cannot recreate this reader during retries.
    hostStore.markReaderDeleted(readerId);
    // A response may already be in transit while another member is purged.
    // Retire byte retention and in-flight confirmations without adding a
    // cross-region UID lookup or treating an older approval as current.
    avatarVisibilityRevision++; avatarCache.clear();
    const result = store.purgeReaderData(readerId, (filename, reason) => hostStore.queueFile(filename, reason));
    const files = await drainFileQueue();
    if (files.retained) throw failure('Community image cleanup is queued for retry.');
    return { ...result, filesRemoved: files.removed };
  };
  const frameAuthority = createCommunityFrameAuthority({ store, directory, readerDeleted: id => hostStore.readerDeleted(id),
    frameEligibility: id => client.request('frame-eligibility', { readerId: id }) });
  const profileReviewer = createCommunityProfileReviewerAuthority({ store, ownerId: authorId, readerDeleted: id => hostStore.readerDeleted(id) });
  const frameBridge = createCommunityFrameBridge({ authority: frameAuthority, secret: config.bridgeSecret, consumeNonce: (nonce, expiresAt) => hostStore.consumeNonce(nonce, expiresAt), profileReviewer });
  const access = createCommunityHostAccess({ store: hostStore, client, siteOrigin, mainSiteOrigin, secret: config.bridgeSecret, purge, decorations: frameBridge.handle });
  const current = (req?: IncomingMessage) => {
    const value = access.current(req);
    if (!value) throw new IdentityBridgeError('请从主站重新进入社区。', 401);
    return value;
  };
  const readerMode = (req: IncomingMessage) => /(?:^|;\s*)community_browse=reader(?:;|$)/.test(String(req.headers.cookie || ''));
  const ownerReader = (req: IncomingMessage) => {
    const { identity } = current(req), personal = identity.ownerReader;
    if (identity.viewer.kind !== 'owner' || identity.viewer.id !== authorId || !personal) return null;
    if (personal.role !== 'reader' || personal.id === authorId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(personal.id)
      || !personal.uid || !/^[0-9a-z]{1,15}$/.test(personal.uid) || typeof personal.nickname !== 'string') throw failure('Owner personal identity projection is invalid.');
    if (hostStore.readerDeleted(personal.id)) return null;
    return personal;
  };
  const memberAlive = (member: CommunityAuthor) => member.kind !== 'reader' || !hostStore.readerDeleted(member.id);
  // Byte retention is bounded separately from authorization. Every hit still
  // makes a fresh avatar authority request; no TTL or stale-error fallback can
  // keep a revoked approval visible. UID also separates brand/personal assets.
  const avatarCache = new LRUCache<string, { uid: string; version: string; bytes: Buffer }>({
    max: 64, maxSize: 8 * 1024 * 1024, sizeCalculation: image => image.bytes.length,
  });
  const request = async <T>(operation: IdentityOperation, input: Record<string, unknown>): Promise<T> => {
    const sessionRef = current().session.sessionRef;
    const selfProfile = ['profile', 'profile-signature', 'profile-nickname', 'profile-avatar', 'profile-avatar-remove', 'profile-avatar-pending'].includes(operation);
    const result = await client.request<T>(operation, { ...input, sessionRef,
      ...(selfProfile && current().identity.viewer.kind === 'owner' && readerMode(current().req) ? { asReader: true } : {}) });
    current();
    return result;
  };
  const readerIdentity = async (req: IncomingMessage) => {
    const reader = current(req).identity.reader || (readerMode(req) ? ownerReader(req) : null);
    return reader && { ...reader, avatar: communityApprovedAvatarURL(reader.uid, reader.avatar) };
  };
  const authorIdentity = async (req: IncomingMessage) => readerMode(req) && ownerReader(req) ? null : current(req).identity.author;
  const profileState = (value: ReaderProfileState, req: IncomingMessage) => {
    const original = current(req).identity.viewer;
    const actor = original.kind === 'owner' && readerMode(req) ? ownerReader(req) : original;
    if (!actor || ('kind' in actor ? actor.kind !== 'reader' : actor.role !== 'reader') || !value || value.id !== actor.id || typeof value.signature !== 'string'
      || typeof value.nickname !== 'string' || typeof value.pendingAvatar !== 'boolean' || value.pendingSignature !== null && typeof value.pendingSignature !== 'string'
      || value.pendingNickname !== null && typeof value.pendingNickname !== 'string')
      throw failure('Profile authority returned an invalid projection.');
    return value;
  };
  const profileImage = (value: {base64:string}, req: IncomingMessage) => {
    current(req);
    if (!value || typeof value.base64 !== 'string' || value.base64.length > Math.ceil(readerProfileAvatarBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64)) throw failure('Pending avatar data is invalid.');
    const bytes = Buffer.from(value.base64, 'base64');
    if (bytes.length > readerProfileAvatarBytes || bytes.toString('base64') !== value.base64) throw failure('Pending avatar data is invalid.');
    return bytes;
  };
  const profile: CommunityProfileAccess = {
    state: async req => profileState(await request<ReaderProfileState>('profile', {}), req),
    signature: async (req, signature) => profileState(await request<ReaderProfileState>('profile-signature', { signature }), req),
    nickname: async (req, nickname) => profileState(await request<ReaderProfileState>('profile-nickname', { nickname }), req),
    avatar: async (req, image) => profileState(await request<ReaderProfileState>('profile-avatar', { base64: image.toString('base64') }), req),
    removeAvatar: async req => profileState(await request<ReaderProfileState>('profile-avatar-remove', {}), req),
    pendingAvatar: async req => profileImage(await request<{base64:string}>('profile-avatar-pending', {}), req),
    reviews: async (req, moderation, check) => { current(req); await check({action:'inspect'}); const result = await request<ReaderProfileReview[]>('profile-reviews', { moderation }); const allowed = await check({action:'inspect'}); return result.filter(row => allowed.includes(row.kind)); },
    reviewImage: async (req, id, moderation, check) => { current(req); await check({action:'inspect',kind:'avatar'}); const result = await request<{base64:string}>('profile-review-image', { id, moderation }); await check({action:'inspect',kind:'avatar'}); return profileImage(result, req); },
    // Main checks the live HK appointment at its commit boundary. Once that
    // decision succeeds, a later role change cannot turn its receipt into 403.
    review: async (req, id, decision, moderation, check, reason) => { current(req); await check({action:'inspect'}); return request<ReaderProfileDecision>('profile-review', { id, decision, reason, moderation }); },
    advise: async (req, id, decision, reason, moderation, check) => { current(req); await check({action:'inspect'}); return request('profile-advise', {id,decision,reason,moderation}); },
  };
  const sessionHandler = (kind: 'reader' | 'author') => async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && new URL(req.url || '', siteOrigin).pathname === `/api/${kind}/session`) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
      res.end(JSON.stringify(await (kind === 'reader' ? readerIdentity(req) : authorIdentity(req)))); return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify({ error: '账号管理请前往主站。' }));
  };
  const identifiedRequests = new WeakSet<IncomingMessage>();
  const communityService = createCommunityService({
    store, directory, siteOrigin, ownerId: authorId, profile, drainFileQueue,
    identify: async req => {
      // Initial reads reuse the middleware confirmation. Existing final
      // authority checks after an async operation must read the source again.
      if (identifiedRequests.has(req)) return (await access.revalidate(req)).identity.viewer;
      identifiedRequests.add(req);
      return current(req).identity.viewer;
    },
    ownerReaderIdentity: async req => { const personal = ownerReader(req); return personal ? { kind: 'reader', id: personal.id, name: personal.nickname, vip: personal.vip } : null; },
    assertActive: req => { current(req); },
    people: async (authors: CommunityAuthor[]) => {
      const unique = [...new Map(authors.filter(memberAlive).map(author => [`${author.kind}:${author.id}`, author])).values()];
      const map = new Map<string, PersonInfo>();
      for (let start = 0; start < unique.length; start += 100) for (const [key, info] of await request<Array<[string, PersonInfo]>>('people', { authors: unique.slice(start, start + 100) })) {
        // A different member may be deleted while this caller remains active.
        // Discard an older remote projection before member DTO helpers can
        // ensure that deleted member's local row again.
        if (!key.startsWith('reader:') || !hostStore.readerDeleted(key.slice('reader:'.length))) map.set(key, info);
      }
      // Earlier batches may have completed before a later batch awaited purge.
      return new Map([...map].filter(([key]) => !key.startsWith('reader:') || !hostStore.readerDeleted(key.slice('reader:'.length))));
    },
    findMember: async uid => {
      const member = await request<CommunityAuthor | null>('member', { uid });
      return member && memberAlive(member) ? member : null;
    },
    findByNames: async names => new Map((await request<Array<[string, CommunityAuthor]>>('names', { names })).filter(([, member]) => memberAlive(member))),
    avatarBytes: async (uid: string) => {
      const visibilityRevision = avatarVisibilityRevision;
      const cached = avatarCache.find(image => image.uid === uid);
      const cachedKey = cached ? `${uid}:${cached.version}` : null;
      try {
        const image = await request<unknown>('avatar', { uid, knownVersion: cached?.version ?? null });
        if (visibilityRevision !== avatarVisibilityRevision) return null;
        if (image === null) { if (cachedKey) avatarCache.delete(cachedKey); return null; }
        if (!image || typeof image !== 'object' || Array.isArray(image)) throw failure('Approved avatar data is invalid.');
        const keys = Object.keys(image);
        const version = 'version' in image ? image.version : null;
        if (version !== null && !isApprovedAvatarVersion(version) || keys.some(key => !['version', 'base64', 'unchanged'].includes(key))) throw failure('Approved avatar data is invalid.');
        if ('unchanged' in image) {
          if (image.unchanged !== true || keys.length !== 2 || !cached || version !== cached.version) throw failure('Approved avatar confirmation is invalid.');
          return cached.bytes;
        }
        if (!('base64' in image) || typeof image.base64 !== 'string' || !image.base64 || image.base64.length > 2 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)) throw failure('Approved avatar data is invalid.');
        const bytes = Buffer.from(image.base64, 'base64');
        if (bytes.length > 1_500_000 || bytes.toString('base64') !== image.base64 || keys.length !== (version === null ? 1 : 2)) throw failure('Approved avatar data is invalid.');
        if (cachedKey) avatarCache.delete(cachedKey);
        // Legacy unversioned replies are still freshly authorized full reads,
        // but cannot establish a UUID binding and are deliberately not retained.
        if (version !== null) avatarCache.set(`${uid}:${version}`, { uid, version, bytes });
        return bytes;
      } catch (error) { if (cachedKey) avatarCache.delete(cachedKey); throw error; }
    },
    words: words(directory),
    audit: async (action, details) => { await appendFile(resolve(directory, 'community-admin-audit.jsonl'), JSON.stringify({ action, ...details, at: new Date().toISOString() }) + '\n', { mode: 0o600 }); },
  });
  const snapshot = { source: 'community-host', profile: config.profile || { name: '無相', signature: '交流学习，分享创作。', bio: '' }, announcements: [], notes: [], works: [], resources: [], software: [], 'resource-center': [] };
  const retryTimer = setInterval(() => { void drainFileQueue().catch(() => { process.stderr.write(JSON.stringify({ event: 'community-file-cleanup-retry', at: new Date().toISOString() }) + '\n'); }); }, 60_000);
  retryTimer.unref();
  let closed = false;
  return {
    communityService, communityEnabled: true, communityOnly: true, mainSiteOrigin,
    contentService: { snapshot: async () => ({ data: snapshot }), preview: async () => { throw failure('Not found', 404); }, media: async () => { throw failure('Not found', 404); } },
    readerService: { identity: readerIdentity, handle: sessionHandler('reader'), registrationEnabled: false },
    authorService: { identity: authorIdentity, handle: sessionHandler('author') },
    requestMiddleware: access.requestMiddleware,
    drainFileQueue,
    healthCheck: async () => {
      hostStore.healthCheck();
      if (contentDb.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw Error('Community database check failed.');
      if (!communityTablesReady(directory)) throw Error('Community schema is incomplete.');
    },
    async close() {
      if (closed) return;
      closed = true; clearInterval(retryTimer); avatarCache.clear();
      if (queueRun) await queueRun;
      store.close(); hostStore.close(); contentDb.close();
    },
  };
}
