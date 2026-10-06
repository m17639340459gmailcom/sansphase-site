import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fail, memberKey, same } from './community-db.ts';
import type { CommunityAuthor } from './community-db.ts';
import type { CommunityAuditEvent, CommunityAuditDetails } from './community-audit.ts';
import type { StoredTopic } from './community-store.ts';
import { cleanText } from './community-context.ts';
import type { Body, Ctx, CommunityViewer, PersonInfo, ServiceOptions } from './community-context.ts';
import { contentRoutes } from './community-routes-content.ts';
import { memberRoutes } from './community-routes-member.ts';
import { manageRoutes } from './community-routes-manage.ts';
import { publicModerationContacts } from './community-moderation-contact.ts';
import { createOwnerReaderPreview } from './community-owner-reader-preview.ts';
import { profileRoutes } from './community-routes-profile.ts';

export { communityContactReason } from './community-context.ts';
export type { CommunityViewer, PersonInfo } from './community-context.ts';

const statusOf = (error: unknown) => (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 500);
const membersBoard = 'vip';
const consentExemptPaths = new Set(['convention/read', 'agree', 'browse-mode']);
// /api/community/* needs a signed-in reader or the owner. Writes also need the site's own
// origin and the X-Reader-Request header, as the reader service does.
export function createCommunityService(options: ServiceOptions) {
  // The accepted posting rules are the default, including the regular local server.
  // Explicit false is retained for legacy API compatibility regression fixtures.
  options = { ...options, simplePosting: options.simplePosting ?? true };
  const { store, siteOrigin, directory, identify, people } = options;
  if (!siteOrigin || !identify || !people) throw Error('Community service requires the site origin, identity and people.');
  const ownerMember: CommunityAuthor = { kind: 'owner', id: options.ownerId || 'owner' };
  const uploads = directory ? resolve(directory, 'uploads') : '';
  const words = (options.words || []).map(word => word.normalize('NFKC').toLowerCase().trim()).filter(Boolean);
  let lastUpkeep = 0;
  const writeAudit = options.audit;
  const auditMirror = writeAudit ? (event: CommunityAuditEvent) => writeAudit(event.action, {
    ...event.details, actor: memberKey(event.actor), auditEventId: event.id, auditCreatedAt: event.createdAt,
  }) : undefined;
  const drainFiles = async () => {
    if (!options.drainFileQueue) return;
    try { await options.drainFileQueue(); }
    catch {
      // SQL has already committed. Keep queued files for retry without turning
      // a completed upload into an error that would remove its new picture.
      process.stderr.write(JSON.stringify({ event: 'community-file-cleanup-retry', at: new Date().toISOString() }) + '\n');
    }
  };

  const sendTo = (res: ServerResponse, body: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify(body));
  };
  const readJson = async (req: IncomingMessage): Promise<Body> => {
    const limit = 64 * 1024; // a 10,000-character post in UTF-8 plus JSON
    if (Number(req.headers['content-length']) > limit) throw fail('内容太长了。', 413);
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail('内容太长了。', 413); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); return value && typeof value === 'object' ? value as Body : {}; }
    catch { throw fail('请求格式无效。'); }
  };
  // Expired bounties and uploads never posted, at most once a minute.
  async function upkeep(now = Date.now()) {
    if (!store || now - lastUpkeep < 60_000) return;
    lastUpkeep = now;
    await store.audit.flush(auditMirror);
    store.expireBounties(now);
    if (uploads) {
      const ids = store.sweepImages(now);
      if (options.drainFileQueue) await drainFiles();
      else for (const id of ids) for (const kind of ['image', 'thumb'])
        await unlink(resolve(uploads, `community-${kind}-${id}.webp`)).catch(() => {});
    }
  }

  function context(req: IncomingMessage, res: ServerResponse, path: string, viewer: CommunityViewer): Ctx {
    const live = store!;
    options.assertActive?.(req);
    const me: CommunityAuthor = { kind: viewer.kind, id: viewer.id };
    const actualOwner = viewer.kind === 'owner' || viewer.ownerAccountId === ownerMember.id;
    live.members.visit(me);
    const actualModerationBoards = live.members.moderationBoards(me);
    const actualMod = actualOwner || live.members.steward(me) && actualModerationBoards.length > 0;
    const browsingAsReader = actualMod && /(?:^|;\s*)community_browse=reader(?:;|$)/.test(String(req.headers.cookie || ''));
    const readOnly = browsingAsReader && !viewer.ownerAccountId;
    const ownerReaderPreview = actualOwner && browsingAsReader ? createOwnerReaderPreview() : null;
    const owner = actualOwner && !browsingAsReader;
    const trustLevel = ownerReaderPreview?.trustLevel ?? (browsingAsReader ? 1 : live.members.trustLevel(me));
    // Appointments grant board moderation, not automatic trust, posting or reward benefits.
    const level = trustLevel;
    // A request body may arrive after an appointment changes; check live authorization at use.
    const moderationBoards = () => browsingAsReader ? [] : live.members.moderationBoards(me);
    const mod = () => owner || moderationBoards().length > 0;
    const canModerateBoard = (board: string) => moderationBoards().includes(board);
    viewer = { ...viewer, vip: ownerReaderPreview !== null || viewer.vip && !browsingAsReader };
    const canSeeBoard = (board: string) => board !== membersBoard || viewer.vip || owner || canModerateBoard(board);
    const person = (author: CommunityAuthor, map: Map<string, PersonInfo>) => {
      const info = map.get(memberKey(author));
      if (!info) return { name: '已注销用户', role: author.kind, uid: null, avatar: null, vip: false, level: 0, growth: null, vipGrowth: null, frame: null, color: null };
      const decorations = live.members.decorations(author);
      const steward = live.members.steward(author);
      const preview = author.kind === 'reader' && info.ownerReader ? createOwnerReaderPreview() : same(author, me) ? ownerReaderPreview : null;
      const nameEffect = live.economy.nameEffect(decorations.color);
      const canSeeUid = author.kind === 'owner' || same(author, me) || mod();
      return {
        name: info.name, role: preview ? 'reader' : author.kind,
        uid: info.uid,
        showUid: canSeeUid,
        growth: preview?.growth ?? live.experience.state(author), vipGrowth: preview?.vipGrowth ?? live.experience.vipState(author, info.vip),
        avatar: info.avatar && info.uid ? `/api/community/avatar/${encodeURIComponent(info.uid)}.webp?v=${encodeURIComponent(info.avatar.slice(0, 8))}` : null,
        vip: preview ? true : info.vip, level: preview?.trustLevel ?? live.members.level(author), steward: preview ? false : steward,
        ...(steward ? { moderationBoards: live.members.moderationBoards(author) } : {}), frame: decorations.frame, color: decorations.color, ...(nameEffect ? { nameEffect } : {}),
      };
    };
    const peopleIn = (topics: StoredTopic[]) => topics.flatMap(topic => topic.lastReply ? [topic.author, topic.lastReply.author] : [topic.author]);
    // Storage details carry private fields (including the complete paid prompt).
    // Select public summary fields explicitly, even when passed a full thread.
    const topicDTO = (topic: StoredTopic, map: Map<string, PersonInfo>) => ({
      id: topic.id, board: topic.board, title: topic.title, author: person(topic.author, map),
      ...(options.simplePosting ? { hasTitle: topic.hasTitle } : {}),
      createdAt: topic.createdAt, lastActivityAt: topic.lastActivityAt, replies: topic.replies,
      likes: topic.likes, views: topic.views, pinned: topic.pinned, paidPin: topic.paidPin,
      featured: topic.featured, tags: topic.tags, thumbs: topic.thumbs, solved: topic.solved,
      edited: topic.edited, locked: topic.locked, glow: topic.glow, bounty: topic.bounty,
      bountyState: topic.bountyState, pending: topic.pending, hidden: topic.hidden,
      excerpt: topic.excerpt, meta: topic.meta, resource: topic.resource,
      lastReply: topic.lastReply && { author: person(topic.lastReply.author, map), at: topic.lastReply.at },
    });
    // The request body can be read once; every route group shares the parsed value.
    let body: Promise<Body> | null = null;
    const requireConsent = () => {
      options.assertActive?.(req);
      if (req.method === 'POST' && !consentExemptPaths.has(path)) live.convention.assertAgreed(me);
    };
    return {
      req, res, url: new URL(req.url || '', siteOrigin), path, method: req.method || 'GET',
      viewer, me, live, options, level, trustLevel, owner, canModerateBoard, ownerMember, actualOwner, actualMod, browsingAsReader, readOnly, ownerReaderPreview,
      get mod() { return mod(); },
      get moderationBoards() { return moderationBoards(); },
      canSeeBoard, hiddenBoard: canSeeBoard(membersBoard) ? '' : membersBoard,
      send: (value, status) => { options.assertActive?.(req); sendTo(res, value, status); },
      json: async () => { const value = await (body ||= readJson(req)); requireConsent(); return value; },
      people: async authors => { const map = await people(authors); requireConsent(); return map; }, person, topicDTO,
      requireConsent,
      topicsDTO: async topics => { const map = await people(peopleIn(topics)); options.assertActive?.(req); return topics.map(topic => topicDTO(topic, map)); },
      throttle(kind) {
        requireConsent();
        live.rateLimits.consume(me, kind, level);
      },
      auditMutation: async <T>(action: string, execute: () => T, details: CommunityAuditDetails<T> = {}) => {
        const result = live.audit.run(me, `community-${action}`, () => { requireConsent(); return execute(); }, details);
        await drainFiles();
        await live.audit.flush(auditMirror);
        return result;
      },
      clean: (value, limits, label, multiline, imageIds) => cleanText(value, limits, label, multiline, words, imageIds),
      // @名字 among members the site can find; the viewer is left out.
      async mentions(body) {
        const names = [...new Set([...body.matchAll(/@([\p{Script=Han}A-Za-z0-9_\-·]{1,30})/gu)].map(match => match[1]))].slice(0, 10);
        if (!names.length || !options.findByNames) return [];
        const found = await options.findByNames(names);
        requireConsent();
        return [...found.values()].filter(member => !same(member, me)).slice(0, 5);
      },
    };
  }

  async function serveImage(ctx: Ctx, id: string, thumb: boolean) {
    const allowed = () => {
      options.assertActive?.(ctx.req);
      const image = ctx.live.image(id);
      if (!image || image.deleted_at) return false;
      if (image.purpose === 'profile') return ctx.live.profileBackgrounds.imageVisible(id, ctx.me, ctx.browsingAsReader);
      if (image.purpose === 'banner') return ctx.live.banners.imageVisible(id, ctx.me, ctx.canSeeBoard);
      if (image.topic_id) {
        const topic = ctx.live.topic(image.topic_id);
        const reply = image.reply_id ? ctx.live.reply(image.reply_id) : null;
        return Boolean(topic && ctx.canSeeBoard(topic.board) && (!topic.pending && !topic.hidden || ctx.canModerateBoard(topic.board) || !ctx.readOnly && same(topic.author, ctx.me))
          && (!image.reply_id || reply && (!reply.hidden || ctx.canModerateBoard(topic.board) || !ctx.readOnly && same(reply.author, ctx.me))));
      }
      return same(ctx.me, { kind: image.uploader_kind, id: image.uploader_id }) || image.purpose === 'shop' && ctx.live.economy.imageVisible(id, ctx.me);
    };
    if (!allowed() || !uploads) throw fail('图片不存在。', 404);
    let data: Buffer;
    try { data = await readFile(resolve(uploads, `community-${thumb ? 'thumb' : 'image'}-${id}.webp`)); } catch { throw fail('图片不存在。', 404); }
    if (!allowed()) throw fail('图片不存在。', 404);
    ctx.res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': data.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    ctx.res.end(data);
  }
  // Approved avatars are shown to other signed-in members; pending ones stay private.
  async function serveAvatar(ctx: Ctx, uid: string) {
    let data: Buffer | null;
    if (options.avatarBytes) data = await options.avatarBytes(uid);
    else {
      const file = await options.avatarFile?.(uid);
      if (!file) throw fail('头像不存在。', 404);
      try { data = await readFile(file); } catch { throw fail('头像不存在。', 404); }
    }
    if (!data) throw fail('头像不存在。', 404);
    options.assertActive?.(ctx.req);
    ctx.res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': data.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    ctx.res.end(data);
  }

  return {
    async handle(req: IncomingMessage, res: ServerResponse) {
      const path = new URL(req.url || '', siteOrigin).pathname.slice('/api/community/'.length);
      try {
        if (!['GET', 'POST'].includes(req.method || '')) throw fail('不支持这个请求。', 405);
        if (!store) throw fail('社区尚未开放。', 503);
        const identified = await identify(req);
        options.assertActive?.(req);
        if (!identified) throw fail('请先登录。', 401);
        // The management principal stays in its host session. Only this verified
        // resolver chooses a personal execution identity; a cookie is not authority.
        let viewer: CommunityViewer = { kind: identified.kind, id: identified.id, name: identified.name, vip: identified.vip };
        if (path !== 'browse-mode' && viewer.kind === 'owner' && /(?:^|;\s*)community_browse=reader(?:;|$)/.test(String(req.headers.cookie || ''))) {
          if (viewer.id !== ownerMember.id) throw fail('作者身份无效。', 401);
          const personal = await options.ownerReaderIdentity?.(req);
          options.assertActive?.(req);
          if (!personal || personal.kind !== 'reader' || !personal.id || personal.id === viewer.id) throw fail('站长的个人读者身份尚未配置或已停用，请返回站长身份。', 503);
          viewer = { kind: 'reader', id: personal.id, name: personal.name, vip: personal.vip, ownerAccountId: viewer.id };
        }
        if (req.method === 'GET' && path === 'moderation-contacts') {
          const url = new URL(req.url || '', siteOrigin);
          sendTo(res, await publicModerationContacts(store, ownerMember, people, url.searchParams.get('board') || ''));
          return;
        }
        await upkeep();
        options.assertActive?.(req);
        const ctx = context(req, res, path, viewer);
        if (req.method === 'GET') {
          const image = /^images\/([0-9a-f-]{36})(\.thumb)?\.webp$/.exec(path);
          if (image) { await serveImage(ctx, image[1], Boolean(image[2])); return; }
          const avatar = /^avatar\/([0-9a-z]{1,15})\.webp$/.exec(path);
          if (avatar) { await serveAvatar(ctx, avatar[1]); return; }
        } else if (req.headers.origin !== siteOrigin || req.headers['x-reader-request'] !== '1') throw fail('请求来源验证失败，请从本站操作。', 403);
        if (req.method === 'POST' && ctx.readOnly && !consentExemptPaths.has(path)) throw fail('当前是读者浏览视角，请先返回管理身份再操作。', 403);
        ctx.requireConsent();
        for (const routes of [profileRoutes, manageRoutes, contentRoutes, memberRoutes]) if (await routes(ctx)) return;
        throw fail('Not found', 404);
      } catch (error) {
        const status = statusOf(error);
        if (status >= 500 && status !== 503) process.stderr.write(JSON.stringify({ event: 'community-error', message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }) + '\n');
        if (!res.headersSent) sendTo(res, { error: status >= 500 && status !== 503 ? '社区暂时不可用，请稍后再试。' : error instanceof Error ? error.message : String(error) }, status);
      }
    },
  };
}
export type CommunityService = ReturnType<typeof createCommunityService>;
