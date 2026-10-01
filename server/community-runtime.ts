import type { IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Payload, Where } from 'payload';
import { communityTablesReady, createCommunityStore } from './community-store.ts';
import type { CommunityAuthor } from './community-store.ts';
import { createCommunityService } from './community-service.ts';
import type { CommunityViewer, PersonInfo } from './community-service.ts';
import { membershipState } from './reader-membership.ts';

type ReaderIdentity = { id: string; nickname: string; vip?: boolean } | null;
type ReaderRow = { id: string | number; nickname?: string; avatar?: string | null; signature?: string | null; createdAt?: string; vip_until?: string | null; disabled?: boolean };
type Options = {
  payload: Payload;
  directory: string;
  siteOrigin: string;
  readerIdentity: (req: IncomingMessage) => Promise<ReaderIdentity>;
  ownerIdentity: (req: IncomingMessage) => Promise<{ name: string } | null>;
  ownerName: () => Promise<string>;
  authorId: string;
  uidStore: { get: (id: string) => string; readerId: (uid: string) => string | null };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Optional private word list: <data directory>/community-words.txt, one word or phrase per line.
function readWords(directory: string) {
  try { return readFileSync(resolve(directory, 'community-words.txt'), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')); }
  catch { return []; }
}

// The community store opens only after `node scripts/migrate-community.mjs`.
// Until then the community API answers "not open yet" and the rest of the
// site starts and runs as before.
export function createCommunityRuntime({ payload, directory, siteOrigin, readerIdentity, ownerIdentity, ownerName, authorId, uidStore }: Options) {
  const store = communityTablesReady(directory) ? createCommunityStore(directory) : null;
  if (!store) process.stdout.write(JSON.stringify({ event: 'community-not-migrated', at: new Date().toISOString() }) + '\n');
  const owner: CommunityAuthor = { kind: 'owner', id: authorId };
  const identify = async (req: IncomingMessage): Promise<CommunityViewer | null> => {
    const reader = await readerIdentity(req);
    if (reader) return { kind: 'reader', id: String(reader.id), name: reader.nickname, vip: Boolean(reader.vip) };
    const signedIn = await ownerIdentity(req);
    return signedIn ? { kind: 'owner', id: authorId, name: signedIn.name, vip: true } : null;
  };
  const readers = async (where: Where, limit: number) =>
    (await payload.find({ collection: 'readers', where, limit, depth: 0, pagination: false, overrideAccess: true })).docs as unknown as ReaderRow[];
  const uidOf = (id: string) => { try { return uidStore.get(id); } catch { return null; } };
  // Only approved values leave the reader account: the approved avatar and signature.
  const people = async (authors: CommunityAuthor[]) => {
    const map = new Map<string, PersonInfo>();
    const readerIds = [...new Set(authors.filter(author => author.kind === 'reader').map(author => author.id))];
    if (readerIds.length) for (const row of await readers({ id: { in: readerIds } }, readerIds.length)) {
      if (!row.nickname) continue;
      map.set(`reader:${row.id}`, {
        name: row.nickname, uid: uidOf(String(row.id)), avatar: uuid.test(row.avatar || '') ? row.avatar! : null,
        vip: membershipState(row).vip, joinedAt: row.createdAt || null, bio: row.signature || '',
      });
    }
    if (authors.some(author => author.kind === 'owner')) {
      const name = await ownerName();
      for (const author of authors) if (author.kind === 'owner') map.set(`owner:${author.id}`, { name, uid: 'owner', avatar: null, vip: true, joinedAt: null, bio: '' });
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
  const avatarFile = async (uid: string) => {
    const id = uidStore.readerId(uid);
    if (!id) return null;
    const [row] = await readers({ id: { equals: id } }, 1);
    return row && uuid.test(row.avatar || '') && !row.disabled ? resolve(directory, 'uploads', `reader-avatar-${row.avatar}.webp`) : null;
  };
  // Moderation goes to the same private audit log as reader administration.
  const audit = async (action: string, details: Record<string, unknown>) => {
    await appendFile(resolve(directory, 'reader-admin-audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), actorId: details.actor, action, ...details }) + '\n', { mode: 0o600 });
  };
  return {
    store,
    service: createCommunityService({ store, siteOrigin, directory, ownerId: authorId, identify, people, findMember, findByNames, avatarFile, audit, words: readWords(directory) }),
    close() { store?.close(); },
  };
}
