import type { IncomingMessage } from 'node:http';
import type { CommunityAuthor } from './community-db.ts';
import type { ReaderProfileCommands, ReaderProfileState, ReaderProfileReview, ReaderProfileDecision } from './reader-profile-commands.ts';
import type { CommunityProfileReviewerRole, CommunityProfileReviewOperation } from './community-profile-reviewer.ts';
import type { CommunityProfileKind } from '../src/community-staff.ts';
import type { ProfileKind } from './reader-workflow.ts';

export type CommunityProfileModeration = { role: CommunityProfileReviewerRole; actor: CommunityAuthor };
export type CommunityProfileGuard = (operation: CommunityProfileReviewOperation) => Promise<readonly CommunityProfileKind[]>;
type Guard = CommunityProfileGuard;
export type CommunityProfileAccess = {
  state: (req: IncomingMessage) => Promise<ReaderProfileState>;
  signature: (req: IncomingMessage, value: unknown) => Promise<ReaderProfileState>;
  nickname: (req: IncomingMessage, value: unknown) => Promise<ReaderProfileState>;
  avatar: (req: IncomingMessage, image: Buffer) => Promise<ReaderProfileState>;
  removeAvatar: (req: IncomingMessage) => Promise<ReaderProfileState>;
  pendingAvatar: (req: IncomingMessage) => Promise<Buffer>;
  reviews: (req: IncomingMessage, moderation: CommunityProfileModeration, check: Guard) => Promise<ReaderProfileReview[]>;
  reviewImage: (req: IncomingMessage, id: string, moderation: CommunityProfileModeration, check: Guard) => Promise<Buffer>;
  review: (req: IncomingMessage, id: string, decision: 'approve' | 'reject', moderation: CommunityProfileModeration, check: Guard, reason?: string) => Promise<ReaderProfileDecision>;
  advise: (req: IncomingMessage, id: string, decision: 'approve'|'reject', reason: string, moderation: CommunityProfileModeration, check: Guard) => ReturnType<ReaderProfileCommands['advise']>;
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
  const reviewer = async (req: IncomingMessage, moderation: CommunityProfileModeration, check: Guard, operation: CommunityProfileReviewOperation) => {
    await check(operation);
    if (moderation.role === 'owner') { if (moderation.actor.kind !== 'owner' || moderation.actor.id !== ownerId || !await ownerIdentity(req)) throw denied(); }
    else if (moderation.actor.kind !== 'reader' || await reader(req) !== moderation.actor.id) throw denied();
    return check(operation);
  };
  const profileKinds = (kinds: readonly CommunityProfileKind[]) => kinds.filter((kind): kind is ProfileKind => kind !== 'background');
  return {
    state: async req => commands.state(await reader(req)),
    signature: async (req, value) => { const id = await reader(req); return commands.submitSignature(id, value, guardReader(req, id)); },
    nickname: async (req, value) => { const id = await reader(req); return commands.submitNickname(id, value, guardReader(req, id)); },
    avatar: async (req, image) => { const id = await reader(req); return commands.submitAvatar(id, image, guardReader(req, id)); },
    removeAvatar: async req => { const id = await reader(req); return commands.removeAvatar(id, guardReader(req, id)); },
    pendingAvatar: async req => { const id = await reader(req); return commands.pendingAvatar(id, guardReader(req, id)); },
    reviews: async (req, moderation, check) => { const allowed = await reviewer(req, moderation, check, {action:'inspect'}); const result = await commands.reviews(profileKinds(allowed)); const current = await reviewer(req, moderation, check, {action:'inspect'}); return result.filter(row => current.includes(row.kind)); },
    reviewImage: async (req, id, moderation, check) => commands.reviewImage(id, async () => { await reviewer(req, moderation, check, {action:'inspect',kind:'avatar'}); }),
    review: async (req, id, decision, moderation, check, reason) => commands.review(id, decision, { ...moderation.actor, source: 'community' }, ['avatar','signature','nickname'], async kind => {
      if (!kind) throw denied(); await reviewer(req, moderation, check, {action:'decide',kind});
    }, reason),
    advise: async (req, id, decision, reason, moderation, check) => commands.advise(id, decision, reason, { ...moderation.actor, source:'community' }, ['avatar','signature','nickname'], async kind => {
      if (!kind) throw denied(); await reviewer(req, moderation, check, {action:'advise',kind});
    }),
  };
}
