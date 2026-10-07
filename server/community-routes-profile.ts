import { withStreamUpload } from './stream-upload.ts';
import { readerImageBytes } from '../src/upload-policy.mjs';
import type { CommunityProfile, CommunityBackgroundReview, CommunityProfileReview } from '../src/community-profile.ts';
import type { ReaderProfileState } from './reader-profile-commands.ts';
import { normalizeReaderAvatar, readerProfileReason, readerNickname, readerSignature } from './reader-profile-commands.ts';
import type { CommunityProfileModeration, CommunityProfileGuard } from './community-profile-access.ts';
import { communityProfileKinds } from '../src/community-staff.ts';
import type { CommunityProfileKind, CommunityStaffPermission } from '../src/community-staff.ts';
import { saveCommunityProfileBackground } from './community-images.ts';
import { communityFrameItems } from './community-frame-authority.ts';
import { fail, memberKey } from './community-db.ts';
import type { Ctx } from './community-context.ts';
import { communityApprovedAvatarURL } from './community-avatar-url.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => { if (Object.keys(value).some(key => !keys.includes(key))) throw fail('资料提交包含不支持的字段。'); };
const own = (ctx: Ctx) => { if (ctx.me.kind !== 'reader' || !ctx.options.profile) throw fail('当前身份不能修改读者资料。', 403); return ctx.options.profile; };
export async function communityProfileDTO(ctx: Ctx, changed?: ReaderProfileState): Promise<CommunityProfile> {
  const state = changed || (ctx.me.kind === 'reader' && ctx.options.profile ? await ctx.options.profile.state(ctx.req) : null);
  const map = await ctx.people([ctx.me]);
  const info = map.get(memberKey(ctx.me));
  const person = ctx.person(ctx.me, map);
  if (state) {
    person.name = state.nickname;
    person.avatar = communityApprovedAvatarURL(state.uid, state.avatar);
  }
  return { person, signature: state?.signature ?? info?.bio ?? '', pendingSignature: state?.pendingSignature ?? null, pendingNickname: state?.pendingNickname ?? null,
    pendingAvatar: state?.pendingAvatar ?? false, canEditProfile: ctx.me.kind === 'reader' && Boolean(ctx.options.profile),
    frames: communityFrameItems(ctx.live, ctx.me), background: ctx.live.profileBackgrounds.state(ctx.me), ...ctx.live.economy.coverDecoration(ctx.me) };
}
const image = (ctx: Ctx, bytes: Buffer) => {
  ctx.requireConsent();
  ctx.res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  ctx.res.end(bytes);
};
const moderator = (ctx: Ctx): CommunityProfileModeration => {
  const staff = ctx.staff;
  if (!staff || !communityProfileKinds.some(kind => ctx.canStaff(`profile.${kind}.advise` as CommunityStaffPermission) || ctx.canStaff(`profile.${kind}.decide` as CommunityStaffPermission))) throw fail('当前身份没有资料审核权限。', 403);
  return { role: staff.role, actor: ctx.me };
};
const guardModerator = (ctx: Ctx, moderation: CommunityProfileModeration): CommunityProfileGuard => async operation => {
  await ctx.refreshStaff();
  ctx.requireConsent();
  if (!ctx.staff || ctx.staff.role !== moderation.role) throw fail('审核权限发生变化，请刷新页面。', 403);
  const kinds = communityProfileKinds.filter(kind => !operation.kind || operation.kind === kind).filter(kind => operation.action === 'inspect'
    ? ctx.canStaff(`profile.${kind}.advise` as CommunityStaffPermission) || ctx.canStaff(`profile.${kind}.decide` as CommunityStaffPermission)
    : ctx.canStaff(`profile.${kind}.${operation.action}` as CommunityStaffPermission));
  if (!kinds.length) throw fail('没有审核这类资料的权限。', 403);
  return kinds;
};
const abilities = (ctx: Ctx, kind: CommunityProfileKind) => ({ canAdvise: ctx.canStaff(`profile.${kind}.advise` as CommunityStaffPermission), canDecide: ctx.canStaff(`profile.${kind}.decide` as CommunityStaffPermission) });
export async function communityProfileReviews(ctx: Ctx): Promise<{profiles: CommunityProfileReview[]; backgrounds: CommunityBackgroundReview[]}> {
  const moderation = moderator(ctx), check = guardModerator(ctx, moderation);
  const profiles = ctx.options.profile ? await ctx.options.profile.reviews(ctx.req, moderation, check) : [];
  const allowed = await check({action:'inspect'});
  const pending = allowed.includes('background') ? ctx.live.profileBackgrounds.pending() : [];
  const people = await ctx.people(pending.map(row => row.member)); const current = await check({action:'inspect'});
  const backgrounds = pending.flatMap(row => { const person = people.get(memberKey(row.member)); return current.includes('background') && person?.uid ? [{
    memberUid: person.uid, nickname: person.name, imageId: row.imageId, imageUrl: row.imageUrl,
    createdAt: row.createdAt, width: row.width, height: row.height, ...abilities(ctx,'background'), advice: ctx.live.profileBackgrounds.advice(row.imageId),
  }] : []; });
  return { profiles: profiles.filter(row => current.includes(row.kind)).map(row => ({ ...row, ...abilities(ctx,row.kind) })), backgrounds };
}
export async function profileRoutes(ctx: Ctx): Promise<boolean> {
  const { path, method } = ctx;
  if (method === 'GET' && path === 'profile') { ctx.send(await communityProfileDTO(ctx)); return true; }
  if (method === 'GET' && path === 'profile/avatar/pending.webp') { const bytes = await own(ctx).pendingAvatar(ctx.req); image(ctx, bytes); return true; }
  if (method === 'POST' && path === 'profile/avatar') {
    const access = own(ctx); ctx.throttle('image');
    if (!ctx.options.directory) throw fail('头像上传尚未配置。', 503);
    if (!String(ctx.req.headers['content-type'] || '').startsWith('multipart/form-data;')) throw fail('请选择图片文件。', 415);
    const state = await withStreamUpload(ctx.req, ctx.options.directory, async file => {
      const bytes = await normalizeReaderAvatar(file.tempFilePath, file.mimetype); ctx.requireConsent();
      return access.avatar(ctx.req, bytes);
    }, { maxFileBytes: readerImageBytes, maxImageBytes: readerImageBytes, maxAudioBytes: 0 });
    ctx.send(await communityProfileDTO(ctx, state)); return true;
  }
  if (method === 'POST' && path === 'profile/background') {
    own(ctx); await saveCommunityProfileBackground(ctx); ctx.send(await communityProfileDTO(ctx)); return true;
  }
  if (method === 'POST' && ['profile', 'profile/avatar/remove', 'profile/background/remove'].includes(path)) {
    const access = own(ctx); const body = await ctx.json(); ctx.throttle('action');
    exactKeys(body, path === 'profile' ? ['signature','nickname'] : []);
    if (path === 'profile') {
      if (!Object.hasOwn(body,'signature') && !Object.hasOwn(body,'nickname')) throw fail('请提交昵称或个性签名。');
      if (Object.hasOwn(body,'nickname')) readerNickname(body.nickname);
      if (Object.hasOwn(body,'signature')) readerSignature(body.signature);
      let state: ReaderProfileState | undefined;
      if (Object.hasOwn(body,'nickname')) state = await access.nickname(ctx.req,body.nickname);
      if (Object.hasOwn(body,'signature')) { ctx.requireConsent(); state = await access.signature(ctx.req, body.signature); }
      ctx.send(await communityProfileDTO(ctx,state));
    }
    else if (path === 'profile/avatar/remove') { const state = await access.removeAvatar(ctx.req); ctx.send(await communityProfileDTO(ctx, state)); }
    else { await ctx.auditMutation('profile-background-remove', () => ctx.live.transaction(() => {
      const result = ctx.live.profileBackgrounds.remove(ctx.me); ctx.live.members.equip(ctx.me, 'cover', null); return result;
    })); ctx.send(await communityProfileDTO(ctx)); }
    return true;
  }
  const preview = /^manage\/profiles\/([^/]+)\/avatar\.webp$/.exec(path);
  if (method === 'GET' && preview) {
    const moderation = moderator(ctx), check = guardModerator(ctx, moderation);
    if (!uuid.test(preview[1]) || !ctx.options.profile) throw fail('待审核头像不存在。', 404);
    const bytes = await ctx.options.profile.reviewImage(ctx.req, preview[1], moderation, check); await check({action:'inspect',kind:'avatar'}); image(ctx, bytes); return true;
  }
  const review = /^manage\/profiles\/([^/]+)\/(approve|reject|advise)$/.exec(path);
  if (method === 'POST' && review) {
    const body = await ctx.json(); exactKeys(body, review[2] === 'advise' ? ['decision','reason'] : ['reason']); ctx.throttle('action');
    const moderation = moderator(ctx), check = guardModerator(ctx, moderation);
    if (!uuid.test(review[1]) || !ctx.options.profile) throw fail('待审核资料不存在。', 404);
    // Remote account updates cannot be part of a synchronous community SQL transaction.
    // The main authority writes the actual decision audit; this durable event records its receipt.
    const decision = review[2] === 'advise' ? body.decision : review[2];
    if (decision !== 'approve' && decision !== 'reject') throw fail('审核结果无效。');
    const reason = readerProfileReason(body.reason,decision);
    const result = review[2] === 'advise'
      ? await ctx.options.profile.advise(ctx.req,review[1],decision,reason,moderation,check)
      : await ctx.options.profile.review(ctx.req, review[1], decision, moderation, check, reason);
    // A role revoked after main's final authority check does not undo its
    // committed decision or change a successful receipt into a permission error.
    await ctx.auditMutation(review[2] === 'advise' ? 'profile-advice' : 'profile-review', () => result, { reviewId: result.id, kind: result.kind, decision, reason });
    ctx.send(result); return true;
  }
  if (method === 'POST' && path === 'manage/profile-background') {
    const body = await ctx.json(); exactKeys(body, ['memberUid', 'imageId', 'approve', 'reason','action']); ctx.throttle('action');
    const action = body.action === undefined ? 'decide' : body.action;
    if (action !== 'advise' && action !== 'decide') throw fail('审核操作无效。');
    const moderation = moderator(ctx), check = guardModerator(ctx,moderation);
    await check({action,kind:'background'});
    if (typeof body.memberUid !== 'string' || typeof body.imageId !== 'string' || !uuid.test(body.imageId) || typeof body.approve !== 'boolean') throw fail('背景审核参数无效。');
    const member = await ctx.options.findMember?.(body.memberUid);
    if (!member) throw fail('找不到这个成员。', 404);
    await check({action,kind:'background'});
    const reason = readerProfileReason(body.reason,body.approve ? 'approve' : 'reject');
    ctx.send(await ctx.auditMutation(action === 'advise' ? 'profile-background-advice' : 'profile-background-review', () => ctx.live.transaction(() => {
      const guard = () => {
        ctx.requireConsent(); if (ctx.staff?.role !== moderation.role) throw fail('审核权限发生变化，请刷新页面。',403);
        ctx.requireStaff(`profile.background.${action}` as CommunityStaffPermission);
      };
      const result = action === 'advise'
        ? ctx.live.profileBackgrounds.advise(member,body.imageId as string,body.approve as boolean,ctx.me,reason,guard)
        : ctx.live.profileBackgrounds.review(member, body.imageId as string, body.approve as boolean, ctx.me, reason, undefined, guard);
      if (action === 'decide' && body.approve === true) ctx.live.members.equip(member, 'cover', null);
      return result;
    }),
      { targetKind: member.kind, targetId: member.id, imageId: body.imageId, approved: body.approve }));
    return true;
  }
  return false;
}
