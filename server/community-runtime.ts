import type { IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { appendFile, lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Payload, Where } from 'payload';
import { communityTablesReady, createCommunityStore } from './community-store.ts';
import type { CommunityAuthor } from './community-store.ts';
import { createCommunityService } from './community-service.ts';
import type { CommunityViewer, PersonInfo } from './community-service.ts';
import type { CommunityProfileAccess } from './community-profile-access.ts';
import { membershipState } from './reader-membership.ts';
import type { ApprovedAvatarRead } from './community-identity-protocol.ts';

type ReaderIdentity = { id: string; nickname: string; vip?: boolean } | null;
type ReaderRow = { id: string | number; nickname?: string; avatar?: string | null; signature?: string | null; createdAt?: string; vip_until?: string | null; disabled?: boolean; _verified?: boolean };
type Options = {
  payload: Payload;
  directory: string;
  siteOrigin: string;
  readerIdentity: (req: IncomingMessage) => Promise<ReaderIdentity>;
  ownerIdentity: (req: IncomingMessage) => Promise<{ name: string } | null>;
  ownerReaderIdentity?: (req: IncomingMessage) => Promise<ReaderIdentity>;
  ownerReaderId?: string;
  ownerName: () => Promise<string>;
  // Read only the public author-brand avatar. Personal reader avatars remain
  // in the reader account authority and never write to the blog profile.
  ownerAvatar?: { current: () => Promise<string | null>; read: (id: string) => Promise<Buffer | null> };
  authorId: string;
  uidStore: { get: (id: string) => string; readerId: (uid: string) => string | null };
  profile?: CommunityProfileAccess;
  queueFile?: (filename: string, reason: string) => void;
  drainFileQueue?: () => Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Optional private word list: <data directory>/community-words.txt, one word or phrase per line.
function readWords(directory: string) {
  try { return readFileSync(resolve(directory, 'community-words.txt'), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')); }
  catch { return []; }
}

// Both the local service and the narrow identity bridge use this approved
// profile directory. It does not open or mutate a community business database.
export function createCommunityDirectory({ payload, directory, ownerName, ownerAvatar, authorId, uidStore, ownerReaderId }: Pick<Options, 'payload' | 'directory' | 'ownerName' | 'ownerAvatar' | 'authorId' | 'uidStore' | 'ownerReaderId'>) {
  const owner: CommunityAuthor = { kind: 'owner', id: authorId };
  const readers = async (where: Where, limit: number) =>
    (await payload.find({ collection: 'readers', where, limit, depth: 0, pagination: false, overrideAccess: true })).docs as unknown as ReaderRow[];
  const uidOf = (id: string) => uidStore.get(id);
  // Only approved values leave the reader account: the approved avatar and signature.
  const people = async (authors: CommunityAuthor[]) => {
    const map = new Map<string, PersonInfo>();
    const readerIds = [...new Set(authors.filter(author => author.kind === 'reader').map(author => author.id))];
    if (readerIds.length) for (const row of await readers({ id: { in: readerIds } }, readerIds.length)) {
      if (!row.nickname) continue;
      map.set(`reader:${row.id}`, {
        name: row.nickname, uid: uidOf(String(row.id)), avatar: uuid.test(row.avatar || '') ? row.avatar! : null,
        vip: membershipState(row).vip, joinedAt: row.createdAt || null, bio: row.signature || '', active: row._verified === true && !row.disabled,
        ...(String(row.id) === ownerReaderId && !row.disabled ? { ownerReader: true as const } : {}),
      });
    }
    if (authors.some(author => author.kind === 'owner' && author.id === authorId)) {
      const [name, avatar] = await Promise.all([ownerName(), ownerAvatar?.current() ?? null]);
      map.set(`owner:${authorId}`, { name, uid: 'owner', avatar: uuid.test(avatar || '') ? avatar : null, vip: true, joinedAt: null, bio: '', active: true });
    }
    return map;
  };
  const findMember = async (uid: string): Promise<CommunityAuthor | null> => {
    if (uid === 'owner') return owner;
    const id = uidStore.readerId(uid);
    if (!id) return null;
    const [row] = await readers({ id: { equals: id } }, 1);
    return row ? { kind: 'reader', id: String(row.id) } : null;
  };
  const findByNames = async (names: string[]) => {
    const map = new Map<string, CommunityAuthor>();
    if (!names.length) return map;
    for (const row of await readers({ nickname: { in: names } }, 50)) if (row.nickname && !map.has(row.nickname)) map.set(row.nickname, { kind: 'reader', id: String(row.id) });
    const name = await ownerName();
    if (names.includes(name)) map.set(name, owner);
    return map;
  };
  const readerAvatar = async (uid: string) => {
    const id = uidStore.readerId(uid);
    if (!id) return null;
    const [row] = await readers({ id: { equals: id } }, 1);
    return row && uuid.test(row.avatar || '') && !row.disabled
      ? { version: row.avatar!, file: resolve(directory, 'uploads', `reader-avatar-${row.avatar}.webp`) } : null;
  };
  const avatarFile = async (uid: string) => (await readerAvatar(uid))?.file ?? null;
  const approvedAvatar = async (uid: string, knownVersion: string | null): Promise<ApprovedAvatarRead | null> => {
    if (uid === 'owner') {
      const id = await ownerAvatar?.current();
      if (!id || !uuid.test(id) || !ownerAvatar) return null;
      if (knownVersion === id) return await ownerAvatar.current() === id ? { version: id, unchanged: true } : null;
      const bytes = await ownerAvatar.read(id);
      return await ownerAvatar.current() === id && bytes ? { version: id, bytes } : null;
    }
    const approved = await readerAvatar(uid);
    if (!approved) return null;
    try {
      if (knownVersion === approved.version) {
        // Keep the original missing-file boundary without transferring or
        // reading its full bytes. Approved upload files are immutable by UUID.
        const stat = await lstat(approved.file);
        return stat.isFile() && !stat.isSymbolicLink() && (await readerAvatar(uid))?.file === approved.file
          ? { version: approved.version, unchanged: true } : null;
      }
      const bytes = await readFile(approved.file);
      return (await readerAvatar(uid))?.file === approved.file ? { version: approved.version, bytes } : null;
    }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null; throw error; }
  };
  // Local callers keep their Buffer/null API. Only the bridge opts into
  // conditional reads, and both forms retain the final target-source check.
  const avatar = async (uid: string) => { const result = await approvedAvatar(uid, null); return result && 'bytes' in result ? result.bytes : null; };
  return { people, findMember, findByNames, avatarFile, avatar, approvedAvatar };
}

// The community store opens only after `node scripts/migrate-community.mjs`.
// Until then the community API answers "not open yet" and the rest of the
// site starts and runs as before.
export function createCommunityRuntime(options: Options) {
  const { directory, siteOrigin, readerIdentity, ownerIdentity, authorId } = options;
  const store = communityTablesReady(directory) ? createCommunityStore(directory, { queueFile: options.queueFile }) : null;
  if (!store) process.stdout.write(JSON.stringify({ event: 'community-not-migrated', at: new Date().toISOString() }) + '\n');
  const profiles = createCommunityDirectory(options);
  const identify = async (req: IncomingMessage): Promise<CommunityViewer | null> => {
    const reader = await readerIdentity(req);
    if (reader) return { kind: 'reader', id: String(reader.id), name: reader.nickname, vip: Boolean(reader.vip) };
    const signedIn = await ownerIdentity(req);
    return signedIn ? { kind: 'owner', id: authorId, name: signedIn.name, vip: true } : null;
  };
  // Moderation goes to the same private audit log as reader administration.
  const audit = async (action: string, details: Record<string, unknown>) => {
    const at = typeof details.auditCreatedAt === 'string' ? details.auditCreatedAt : new Date().toISOString();
    await appendFile(resolve(directory, 'reader-admin-audit.jsonl'), JSON.stringify({ at, actorId: details.actor, action, ...details }) + '\n', { mode: 0o600 });
  };
  return {
    store,
    directory: profiles,
    purgeReaderData(readerId: string, queueFile: (filename: string, reason: string) => void) {
      if (store) return store.purgeReaderData(readerId, queueFile);
      const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
      try {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name GLOB 'community_*' LIMIT 1").get())
          throw Error('Community migration is required before account data cleanup.');
        return { topics: 0, replies: 0, images: 0 };
      } finally { db.close(); }
    },
    service: createCommunityService({ store, siteOrigin, directory, ownerId: authorId, identify,
      ownerReaderIdentity: async req => { const personal = await options.ownerReaderIdentity?.(req); return personal ? { kind: 'reader', id: personal.id, name: personal.nickname, vip: personal.vip === true } : null; },
      ...profiles, avatarBytes: profiles.avatar, audit, words: readWords(directory), profile: options.profile, drainFileQueue: options.drainFileQueue }),
    close() { store?.close(); },
  };
}
