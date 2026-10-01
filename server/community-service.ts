import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fail, memberKey, same } from './community-db.ts';
import type { CommunityAuthor } from './community-db.ts';
import type { StoredTopic } from './community-store.ts';
import { cleanText } from './community-context.ts';
import type { Body, Ctx, CommunityViewer, PersonInfo, ServiceOptions } from './community-context.ts';
import { contentRoutes } from './community-routes-content.ts';
import { memberRoutes } from './community-routes-member.ts';
import { manageRoutes } from './community-routes-manage.ts';

export { communityContactReason } from './community-context.ts';
export type { CommunityViewer, PersonInfo } from './community-context.ts';

const statusOf = (error: unknown) => (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 500);
const membersBoard = 'vip';
// Posting limits per account: [count, window]. Observers and above get 1.5× the daily limits.
const limits = {
  topic: [[3, 10 * 60 * 1000], [20, 24 * 3600 * 1000]],
  reply: [[20, 10 * 60 * 1000], [200, 24 * 3600 * 1000]],
  image: [[30, 10 * 60 * 1000], [100, 24 * 3600 * 1000]],
  report: [[10, 10 * 60 * 1000], [30, 24 * 3600 * 1000]],
  action: [[120, 60 * 1000], [3000, 24 * 3600 * 1000]],
} as const;

// /api/community/*: every read and write needs a signed-in reader or the
// owner (the community is not public). Writes also need the site's own
// origin and the X-Reader-Request header, as the reader service does.
export function createCommunityService(options: ServiceOptions) {
  const { store, siteOrigin, directory, identify, people } = options;
  if (!siteOrigin || !identify || !people) throw Error('Community service requires the site origin, identity and people.');
  const ownerMember: CommunityAuthor = { kind: 'owner', id: options.ownerId || 'owner' };
  const uploads = directory ? resolve(directory, 'uploads') : '';
  const words = (options.words || []).map(word => word.normalize('NFKC').toLowerCase().trim()).filter(Boolean);
  const attempts = new Map<string, number[]>();
  let lastUpkeep = 0;

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
    store.expireBounties(now);
    if (uploads) for (const id of store.sweepImages(now)) for (const kind of ['image', 'thumb'])
      await unlink(resolve(uploads, `community-${kind}-${id}.webp`)).catch(() => {});
  }

  function context(req: IncomingMessage, res: ServerResponse, path: string, viewer: CommunityViewer): Ctx {
    const live = store!;
    const me: CommunityAuthor = { kind: viewer.kind, id: viewer.id };
    const owner = viewer.kind === 'owner';
    live.members.visit(me);
    const level = live.members.level(me);
    const mod = owner || level >= 4;
    const canSeeBoard = (board: string) => board !== membersBoard || viewer.vip || owner;
    const person = (author: CommunityAuthor, map: Map<string, PersonInfo>) => {
      const info = map.get(memberKey(author));
      if (!info) return { name: '已注销用户', role: author.kind, uid: null, avatar: null, vip: false, level: 0, frame: null, color: null };
      const decorations = live.members.decorations(author);
      const canSeeUid = author.kind === 'owner' || same(author, me) || mod;
      return {
        name: info.name, role: author.kind,
        uid: info.uid,
        showUid: canSeeUid,
        avatar: info.avatar && info.uid ? `/api/community/avatar/${encodeURIComponent(info.uid)}.webp?v=${encodeURIComponent(info.avatar.slice(0, 8))}` : null,
        vip: info.vip, level: live.members.level(author), steward: live.members.steward(author), frame: decorations.frame, color: decorations.color,
      };
    };
    const peopleIn = (topics: StoredTopic[]) => topics.flatMap(topic => topic.lastReply ? [topic.author, topic.lastReply.author] : [topic.author]);
    const topicDTO = (topic: StoredTopic, map: Map<string, PersonInfo>) => ({
      ...topic, author: person(topic.author, map),
      lastReply: topic.lastReply && { author: person(topic.lastReply.author, map), at: topic.lastReply.at },
    });
    // The request body can be read once; every route group shares the parsed value.
    let body: Promise<Body> | null = null;
    return {
      req, res, url: new URL(req.url || '', siteOrigin), path, method: req.method || 'GET',
      viewer, me, live, options, level, owner, mod, ownerMember,
      canSeeBoard, hiddenBoard: canSeeBoard(membersBoard) ? '' : membersBoard,
      send: (value, status) => sendTo(res, value, status),
      json: () => (body ||= readJson(req)),
      people, person, topicDTO,
      topicsDTO: async topics => { const map = await people(peopleIn(topics)); return topics.map(topic => topicDTO(topic, map)); },
      throttle(kind) {
        const now = Date.now(), key = `${kind}:${memberKey(me)}`;
        const scale = level >= 2 ? 1.5 : 1;
        const longest = Math.max(...limits[kind].map(([, window]) => window));
        const times = (attempts.get(key) || []).filter(at => now - at < longest);
        for (const [count, window] of limits[kind]) {
          const allowed = window >= 24 * 3600 * 1000 ? Math.floor(count * scale) : count;
          if (times.filter(at => now - at < window).length >= allowed) throw fail('操作太频繁了，请稍后再试。', 429);
        }
        times.push(now);
        attempts.set(key, times);
        if (attempts.size > 10000) for (const [name, list] of attempts) if (!list.some(at => now - at < longest)) attempts.delete(name);
      },
      audit: async (action, details = {}) => { await options.audit?.(`community-${action}`, { actor: memberKey(me), ...details }); },
      clean: (value, limits, label, multiline) => cleanText(value, limits, label, multiline, words),
      // @名字 among members the site can find; the viewer is left out.
      async mentions(body) {
        const names = [...new Set([...body.matchAll(/@([\p{Script=Han}A-Za-z0-9_\-·]{1,30})/gu)].map(match => match[1]))].slice(0, 10);
        if (!names.length || !options.findByNames) return [];
        const found = await options.findByNames(names);
        return [...found.values()].filter(member => !same(member, me)).slice(0, 5);
      },
    };
  }

  async function serveImage(ctx: Ctx, id: string, thumb: boolean) {
    const image = ctx.live.image(id);
    const allowed = image && !image.deleted_at && (image.topic_id
      ? (() => {
        const topic = ctx.live.topic(image.topic_id!);
        return Boolean(topic && ctx.canSeeBoard(topic.board) && (!topic.pending && !topic.hidden || ctx.mod || same(topic.author, ctx.me)));
      })()
      : same(ctx.me, { kind: image.uploader_kind, id: image.uploader_id }));
    if (!allowed || !uploads) throw fail('图片不存在。', 404);
    let data: Buffer;
    try { data = await readFile(resolve(uploads, `community-${thumb ? 'thumb' : 'image'}-${id}.webp`)); } catch { throw fail('图片不存在。', 404); }
    ctx.res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': data.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    ctx.res.end(data);
  }
  // Approved avatars are shown to other signed-in members; pending ones stay private.
  async function serveAvatar(ctx: Ctx, uid: string) {
    const file = await options.avatarFile?.(uid);
    if (!file) throw fail('头像不存在。', 404);
    let data: Buffer;
    try { data = await readFile(file); } catch { throw fail('头像不存在。', 404); }
    ctx.res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': data.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    ctx.res.end(data);
  }

  return {
    async handle(req: IncomingMessage, res: ServerResponse) {
      const path = new URL(req.url || '', siteOrigin).pathname.slice('/api/community/'.length);
      try {
        if (!['GET', 'POST'].includes(req.method || '')) throw fail('不支持这个请求。', 405);
        if (!store) throw fail('社区尚未开放。', 503);
        const viewer = await identify(req);
        if (!viewer) throw fail('请先登录。', 401);
        await upkeep();
        const ctx = context(req, res, path, viewer);
        if (req.method === 'GET') {
          const image = /^images\/([0-9a-f-]{36})(\.thumb)?\.webp$/.exec(path);
          if (image) { await serveImage(ctx, image[1], Boolean(image[2])); return; }
          const avatar = /^avatar\/([0-9a-z]{1,15})\.webp$/.exec(path);
          if (avatar) { await serveAvatar(ctx, avatar[1]); return; }
        } else if (req.headers.origin !== siteOrigin || req.headers['x-reader-request'] !== '1') throw fail('请求来源验证失败，请从本站操作。', 403);
        for (const routes of [contentRoutes, memberRoutes, manageRoutes]) if (await routes(ctx)) return;
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
