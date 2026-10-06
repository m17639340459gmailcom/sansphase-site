import type { IncomingMessage } from 'node:http';
import type { CommunityAuthor } from './community-db.ts';
import type { ReaderProfileCommands, ReaderProfileState, ReaderProfileReview, ReaderProfileDecision } from './reader-profile-commands.ts';

export type CommunityProfileModeration = { role: 'owner' | 'steward'; actor: CommunityAuthor };
type Guard = () => void;
export type CommunityProfileAccess = {
  state: (req: IncomingMessage) => Promise<ReaderProfileState>;
  signature: (req: IncomingMessage, value: unknown) => Promise<ReaderProfileState>;
  avatar: (req: IncomingMessage, image: Buffer) => Promise<ReaderProfileState>;
  removeAvatar: (req: IncomingMessage) => Promise<ReaderProfileState>;
  pendingAvatar: (req: IncomingMessage) => Promise<Buffer>;
  reviews: (req: IncomingMessage, moderation: CommunityProfileModeration, check: Guard) => Promise<ReaderProfileReview[]>;
  reviewImage: (req: IncomingMessage, id: string, moderation: CommunityProfileModeration, check: Guard) => Promise<Buffer>;
  review: (req: IncomingMessage, id: string, decision: 'approve' | 'reject', moderation: CommunityProfileModeration, check: Guard) => Promise<ReaderProfileDecision>;
};
type Options = {
  commands: ReaderProfileCommands;
  readerIdentity: (req: IncomingMessage) => Promise<{id:string} | null>;
  ownerReaderIdentity?: (req: IncomingMessage) => Promise<{id:string} | null>;
  ownerIdentity: (req: IncomingMessage) => Promise<unknown>;
  ownerId: string;
};
const denied = () => Object.assign(Error('当前身份没有修改或审核这类资料的权限。'), { status: 403 });
/** Same-host adapter; the independent HK host supplies the equivalent finite bridge adapter. */
export function createLocalCommunityProfileAccess({ commands, readerIdentity, ownerReaderIdentity, ownerIdentity, ownerId }: Options): CommunityProfileAccess {
  const reader = async (req: IncomingMessage) => {
    const identity = await readerIdentity(req);
    if (identity) return identity.id;
    const asReader = /(?:^|;\s*)community_browse=reader(?:;|$)/.test(String(req.headers.cookie || ''));
    const personal = asReader ? await ownerReaderIdentity?.(req) : null;
    if (!personal) throw denied(); return personal.id;
  };
  const guardReader = (req: IncomingMessage, id: string) => async () => { if (await reader(req) !== id) throw denied(); };
  const reviewer = async (req: IncomingMessage, moderation: CommunityProfileModeration, check: Guard) => {
    check();
    if (moderation.role === 'owner') { if (moderation.actor.kind !== 'owner' || moderation.actor.id !== ownerId || !await ownerIdentity(req)) throw denied(); }
    else if (moderation.actor.kind !== 'reader' || await reader(req) !== moderation.actor.id) throw denied();
    check();
  };
  const kinds = (moderation: CommunityProfileModeration) => moderation.role === 'owner' ? ['avatar', 'signature'] as const : ['avatar'] as const;
  return {
    state: async req => commands.state(await reader(req)),
    signature: async (req, value) => { const id = await reader(req); return commands.submitSignature(id, value, guardReader(req, id)); },
    avatar: async (req, image) => { const id = await reader(req); return commands.submitAvatar(id, image, guardReader(req, id)); },
    removeAvatar: async req => { const id = await reader(req); return commands.removeAvatar(id, guardReader(req, id)); },
    pendingAvatar: async req => { const id = await reader(req); return commands.pendingAvatar(id, guardReader(req, id)); },
    reviews: async (req, moderation, check) => { await reviewer(req, moderation, check); const result = await commands.reviews(kinds(moderation)); await reviewer(req, moderation, check); return result; },
    reviewImage: async (req, id, moderation, check) => commands.reviewImage(id, () => reviewer(req, moderation, check)),
    review: async (req, id, decision, moderation, check) => commands.review(id, decision, { ...moderation.actor, source: 'community' }, kinds(moderation), () => reviewer(req, moderation, check)),
  };
}
