import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { communityBoards, isCommunitySort } from '../src/community.mjs';
import { communityRules, communityTags, communityReportReasons, communityReviewReasons, countLinks } from '../src/community-rules.mjs';
import { withStreamUpload } from './stream-upload.ts';
import { fail, same, memberKey } from './community-db.ts';
import type { CommunityAuthor, Target } from './community-db.ts';
import { tagList, imageList, showcaseMeta, resourceMeta } from './community-context.ts';
import type { Body, Ctx } from './community-context.ts';
import type { StoredTopic } from './community-store.ts';

const pageSize = 20;
const searchLimit = 40;
const titleLimits = [4, 60] as const, topicLimits = [10, 10000] as const, replyLimits = [2, 2000] as const;
const boardIds = new Set(communityBoards.map(board => board.id));
const imageFormats: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
const r = communityRules;
const flag = (body: Body) => body.on !== false;
// 发帖后可以编辑多久：站长不限，观测以上 30 天，其他 24 小时。
const editWindow = (ctx: Ctx) => ctx.owner ? Infinity : ctx.level >= 2 ? r.editWindowDaysL2 * 24 * 3600 * 1000 : r.editWindowHours * 3600 * 1000;
const canEdit = (ctx: Ctx, author: CommunityAuthor, createdAt: string) =>
  ctx.owner || (same(ctx.me, author) && Date.now() - Date.parse(createdAt) < editWindow(ctx));
function assertNotMuted(ctx: Ctx) {
  const muted = ctx.live.members.muted(ctx.me);
  if (muted) throw fail(`你被禁言到 ${new Date(Date.parse(muted.until) + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}，原因：${muted.reason}。`, 403);
}
// A topic the viewer may see: pending and hidden ones only for their author and moderators.
function visibleTopic(ctx: Ctx, id: string) {
  const topic = ctx.live.topic(id);
  if (!topic || !ctx.canSeeBoard(topic.board) || ((topic.pending || topic.hidden) && !ctx.mod && !same(topic.author, ctx.me)))
    throw fail('帖子不存在，或已被删除。', 404);
  return topic;
}
function visibleReply(ctx: Ctx, id: string) {
  const reply = ctx.live.reply(id);
  if (!reply) throw fail('回复不存在，或已被删除。', 404);
  return { reply, topic: visibleTopic(ctx, reply.topicId) };
}
// A masked prompt shows its shape without its words.
const maskPrompt = (prompt: string) => [...prompt].slice(0, 400).map(char => /[\s,，.。:：()\-]/.test(char) ? char : /[A-Za-z0-9]/.test(char) ? 'x' : '•').join('');

async function saveImage(ctx: Ctx) {
  const directory = ctx.options.directory;
  if (!directory) throw fail('图片上传暂未开放。', 503);
  if (!String(ctx.req.headers['content-type'] || '').startsWith('multipart/form-data;')) throw fail('请选择图片文件。', 415);
  ctx.throttle('image');
  const uploads = resolve(directory, 'uploads');
  const limits = { maxFileBytes: r.imageBytes, maxImageBytes: r.imageBytes, maxAudioBytes: 0 };
  return withStreamUpload(ctx.req, directory, async (file: { mimetype: string; tempFilePath: string }) => {
    if (!imageFormats[file.mimetype]) throw fail('图片只支持 JPG、PNG 或 WebP。', 415);
    let full: Buffer, thumb: Buffer, width: number, height: number;
    try {
      const source = sharp(file.tempFilePath, { limitInputPixels: 40_000_000, animated: false });
      const metadata = await source.metadata();
      if (metadata.format !== imageFormats[file.mimetype] || !metadata.width || !metadata.height) throw fail('图片无法读取，请换一张。');
      const output = await source.clone().rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer({ resolveWithObject: true });
      full = output.data; width = output.info.width; height = output.info.height;
      thumb = await source.clone().rotate().resize(480, 480, { fit: 'cover', position: 'attention' }).webp({ quality: 76, effort: 4 }).toBuffer();
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw fail('图片无法读取，请换一张 JPG、PNG 或 WebP 图片。');
    }
    const id = randomUUID();
    await mkdir(uploads, { recursive: true });
    await writeFile(resolve(uploads, `community-image-${id}.webp`), full, { flag: 'wx', mode: 0o600 });
    await writeFile(resolve(uploads, `community-thumb-${id}.webp`), thumb, { flag: 'wx', mode: 0o600 });
    ctx.live.addImage({ id, uploader: ctx.me, width, height });
    return { id, width, height };
  }, limits);
}

// The full post for one viewer: what they may do, the prompt if they may read it, and who is mentioned.
async function threadDTO(ctx: Ctx, id: string) {
  const { live, me } = ctx;
  const topic = visibleTopic(ctx, id);
  live.view(topic.id, me);
  const related = topic.pending || topic.hidden ? [] : live.related(topic);
  const quoted = new Map(topic.replies.map(reply => [reply.id, reply]));
  const authors = [topic.author, ...topic.replies.map(reply => reply.author), ...related.flatMap(item => [item.author, ...(item.lastReply ? [item.lastReply.author] : [])])];
  const map = await ctx.people(authors);
  const isAuthor = same(me, topic.author);
  const target = { kind: 'topic' as const, id: topic.id };
  const names = [...new Set([topic.body, ...topic.replies.map(reply => reply.body)].flatMap(text => [...text.matchAll(/@([\p{Script=Han}A-Za-z0-9_\-·]{1,30})/gu)].map(match => match[1])))];
  const mentioned = names.length && ctx.options.findByNames ? await ctx.options.findByNames(names.slice(0, 30)) : new Map<string, CommunityAuthor>();
  const mentionMap = await ctx.people([...mentioned.values()]);
  const mentions = Object.fromEntries([...mentioned].map(([name, member]) => [name, mentionMap.get(memberKey(member))?.uid || null]).filter(([, uid]) => uid));
  const replies = topic.replies.map(reply => {
    const replyTarget = { kind: 'reply' as const, id: reply.id };
    const mine = same(me, reply.author), byTopicAuthor = same(reply.author, topic.author);
    const hiddenFromViewer = reply.hidden && !mine && !ctx.mod;
    const quote = reply.quoteId ? quoted.get(reply.quoteId) : null;
    return {
      id: reply.id, author: ctx.person(reply.author, map), body: hiddenFromViewer ? '' : reply.body, createdAt: reply.createdAt,
      edited: reply.edited, likes: reply.likes, liked: live.liked(replyTarget, me), thanked: live.thanked(replyTarget, me), thanks: live.thanks(replyTarget),
      byTopicAuthor, accepted: topic.acceptedReplyId === reply.id, mine, hidden: reply.hidden,
      quote: quote && !(quote.hidden && !ctx.mod) ? { id: quote.id, author: ctx.person(quote.author, map).name, excerpt: [...quote.body].slice(0, 80).join('') } : null,
      canDelete: ctx.mod || mine, canEdit: canEdit(ctx, reply.author, reply.createdAt), canRestore: ctx.mod && reply.hidden,
      canAccept: topic.board === 'qa' && isAuthor && !topic.acceptedReplyId && !byTopicAuthor && !reply.hidden,
    };
  });
  const meta = topic.fullMeta;
  const unlocked = meta?.promptMode === 'paid' ? live.economy.unlocked(topic.id, me) : false;
  const promptVisible = Boolean(meta && meta.prompt && (meta.promptMode === 'public' || isAuthor || ctx.owner || unlocked));
  const stats = live.authorStats(topic.author);
  const muted = live.members.muted(me);
  return {
    topic: {
      ...ctx.topicDTO({ ...topic, replies: topic.replyCount }, map), body: topic.body, images: topic.images,
      liked: live.liked(target, me), bookmarked: live.bookmarked(topic.id, me), bookmarks: topic.bookmarks,
      thanked: live.thanked(target, me), thanks: topic.thanks, mine: isAuthor,
      canDelete: ctx.mod || isAuthor, canEdit: canEdit(ctx, topic.author, topic.createdAt), canModerate: ctx.mod, canFeature: ctx.owner,
      canRetag: ctx.level >= 3 || ctx.mod, canPaidPin: isAuthor && (topic.board === 'showcase' || topic.board === 'tools') && !topic.paidPin,
      canHighlight: isAuthor && !topic.glow, canReply: !topic.locked && !muted && !topic.pending,
      meta: meta && {
        tools: meta.tools, model: meta.model, usage: meta.usage, promptMode: meta.promptMode, price: meta.price,
        prompt: promptVisible ? meta.prompt : null, preview: !promptVisible && meta.prompt && meta.promptMode === 'paid' ? maskPrompt(meta.prompt) : null,
        unlocked, unlocks: topic.unlocks,
      },
      resource: topic.resource && { ...topic.resource, alive: topic.votes.alive, dead: topic.votes.dead, myVote: live.myVote(topic.id, me) },
      pendingReason: topic.pending ? topic.pendingReason : null, hiddenReason: topic.hidden ? topic.hiddenReason : null,
    },
    // The accepted answer comes first, as in the demo.
    replies: [...replies.filter(reply => reply.accepted), ...replies.filter(reply => !reply.accepted)],
    author: {
      ...ctx.person(topic.author, map), ...stats, badges: live.members.badges(topic.author).slice(0, 6),
      bio: map.get(memberKey(topic.author))?.bio || '', following: !isAuthor && live.members.following(me, topic.author),
    },
    related: related.map(item => ctx.topicDTO(item, map)),
    mentions,
    viewer: { level: ctx.level, muted: muted ? { until: muted.until, reason: muted.reason } : null },
  };
}

async function createTopic(ctx: Ctx, body: Body) {
  const { live, me, level } = ctx;
  assertNotMuted(ctx);
  if (!live.members.agreed(me)) {
    if (body.agree !== true) throw fail('第一次发帖前请先阅读并同意社区公约。', 428);
    live.members.agree(me);
  }
  const board = String(body.board || '');
  if (!boardIds.has(board)) throw fail('请选择一个版块。');
  if (!ctx.canSeeBoard(board)) throw fail('会员茶室只有 VIP 能发帖。', 403);
  const moment = board === 'moments';
  const title = moment ? '' : ctx.clean(body.title, titleLimits, '标题', false);
  const content = moment ? ctx.clean(body.body, [2, r.momentMax], '内容', true)
    : board === 'showcase' || board === 'tools' ? (typeof body.body === 'string' && body.body.trim() ? ctx.clean(body.body, [0, topicLimits[1]], '正文', true) : '')
    : ctx.clean(body.body, topicLimits, '正文', true);
  const tags = tagList(body.tags);
  const images = imageList(body.images, board, level);
  if (board === 'showcase' && !images.length) throw fail('作品帖至少要有 1 张图。');
  const meta = board === 'showcase' ? showcaseMeta(body) : null;
  const resource = board === 'tools' ? resourceMeta(body) : null;
  const links = countLinks(content) + (resource ? 1 : 0);
  const newcomer = level < 1;
  if (newcomer && links > r.l0Links) throw fail(`初光等级每帖最多 ${r.l0Links} 个链接。`);
  if (newcomer && live.postedToday(me).topics >= r.l0TopicsDaily) throw fail(`初光等级每天最多发 ${r.l0TopicsDaily} 个主题，明天再来吧。`, 429);
  const bounty = board === 'qa' ? Number(body.bounty || 0) : 0;
  if (bounty && !(r.bountyOptions as readonly number[]).includes(bounty)) throw fail('请选择悬赏数额。');
  if (bounty && newcomer) throw fail('初光等级还不能悬赏，升到巡天就可以了。', 403);
  const pin = board === 'meta' && ctx.owner && body.announce === true;
  // 初光的前 2 个带链接或图片的帖子先审后发。
  const review = newcomer && (links > 0 || images.length > 0) && live.members.stats(me).approved < r.l0ReviewCount;
  ctx.throttle('topic');
  const result = live.createTopic({ board, author: me, title, body: content, tags, images, bounty, meta, resource, pin,
    pending: review ? (links ? '初光等级，帖子带外链' : '初光等级，帖子带图片') : null });
  if (review) live.members.notify(ctx.ownerMember, { type: 'review', actor: me, topicId: result.id, text: '有新帖子等待审核', data: { state: 'queue' }, link: '#/community/manage' });
  else for (const member of await ctx.mentions(content))
    live.members.notify(member, { type: 'mention', actor: me, topicId: result.id, text: '在帖子里提到了你', data: { where: 'topic' } });
  return result;
}

async function editTopic(ctx: Ctx, topic: NonNullable<ReturnType<Ctx['live']['topic']>>, body: Body) {
  if (!canEdit(ctx, topic.author, topic.createdAt)) throw fail(ctx.level >= 2 ? '只能在发帖后 30 天内编辑自己的帖子。' : `只能在发帖后 ${r.editWindowHours} 小时内编辑自己的帖子。`, 403);
  const moment = topic.board === 'moments';
  const authorLevel = ctx.live.members.level(topic.author);
  const title = moment ? '' : ctx.clean(body.title, titleLimits, '标题', false);
  const content = moment ? ctx.clean(body.body, [2, r.momentMax], '内容', true)
    : topic.board === 'showcase' || topic.board === 'tools' ? (typeof body.body === 'string' && body.body.trim() ? ctx.clean(body.body, [0, topicLimits[1]], '正文', true) : '')
    : ctx.clean(body.body, topicLimits, '正文', true);
  const images = imageList(body.images, topic.board, authorLevel);
  if (topic.board === 'showcase' && !images.length) throw fail('作品帖至少要有 1 张图。');
  if (authorLevel < 1 && countLinks(content) + (topic.board === 'tools' ? 1 : 0) > r.l0Links) throw fail(`初光等级每帖最多 ${r.l0Links} 个链接。`);
  ctx.live.editTopic(topic.id, {
    title, body: content, tags: tagList(body.tags), images, editor: ctx.me,
    meta: topic.board === 'showcase' ? showcaseMeta(body) : null, resource: topic.board === 'tools' ? resourceMeta(body) : null,
  });
}

// Reporting: a night watch (L3) or moderator report hides content by first-light and survey
// members at once; two reports from observers (L2) and above also hide it. The owner decides.
async function report(ctx: Ctx, body: Body) {
  const { live, me } = ctx;
  if (ctx.level < 1) throw fail('初光等级还不能举报，升到巡天就可以了。', 403);
  const kind = body.kind === 'reply' ? 'reply' : body.kind === 'topic' ? 'topic' : '';
  const id = String(body.id || '');
  if (!kind) throw fail('举报对象无效。');
  const author = kind === 'topic' ? visibleTopic(ctx, id).author : visibleReply(ctx, id).reply.author;
  if (same(me, author)) throw fail('不能举报自己的内容。');
  const reason = String(body.reason || '');
  if (!(communityReportReasons as readonly string[]).includes(reason)) throw fail('请选择举报原因。');
  const note = typeof body.note === 'string' && body.note.trim() ? ctx.clean(body.note, [1, 200], '补充说明', false) : '';
  ctx.throttle('report');
  const target: Target = { kind, id };
  live.report({ target, reporter: me, reporterLevel: ctx.level, reason, note });
  const authorLevel = live.members.level(author);
  const strong = ctx.level >= 3 && author.kind !== 'owner' && authorLevel <= 1;
  const hidden = author.kind !== 'owner' && (strong || live.reportsFrom(target, 2) >= 2) ? live.hide(target, `举报：${reason}`) : false;
  live.members.notify(ctx.ownerMember, { type: 'system', actor: me, topicId: kind === 'topic' ? id : live.reply(id)?.topicId, text: '收到一条举报', data: { report: 'new', reason, hidden }, link: '#/community/manage/reports' });
  return { hidden };
}

export async function contentRoutes(ctx: Ctx): Promise<boolean> {
  const { live, me, path, method, url } = ctx;
  if (method === 'GET') {
    if (path === 'summary') {
      const summary = live.summary({ limit: 20, hiddenBoard: ctx.hiddenBoard });
      const hot = summary.hot.filter(topic => ctx.canSeeBoard(topic.board)).slice(0, 5);
      const stats = Object.values(summary.boards);
      ctx.send({
        total: stats.reduce((sum, board) => sum + board.topics, 0),
        repliesToday: stats.reduce((sum, board) => sum + board.repliesToday, 0),
        checkinsToday: summary.checkinsToday, boards: summary.boards, tags: summary.tags, hot: await ctx.topicsDTO(hot),
      });
      return true;
    }
    if (path === 'topics') {
      const board = url.searchParams.get('board') || '';
      if (board && (!boardIds.has(board) || !ctx.canSeeBoard(board))) throw fail('没有这个版块。', 404);
      const tag = url.searchParams.get('tag') || '';
      if (tag && !(communityTags as readonly string[]).includes(tag)) throw fail('没有这个标签。', 404);
      const sort = url.searchParams.get('sort') || 'active';
      const page = Math.max(1, Math.min(1000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
      if (!isCommunitySort(sort)) throw fail('排序方式无效。');
      const query = (url.searchParams.get('q') || '').trim();
      if ([...query].length > searchLimit) throw fail(`搜索词最多 ${searchLimit} 个字。`);
      const uid = url.searchParams.get('author') || '';
      const author = uid ? await ctx.options.findMember?.(uid) : undefined;
      if (uid && !author) throw fail('找不到这个成员。', 404);
      // Members-only topics are dropped before paging, so counts stay honest.
      const following = sort === 'following' ? live.members.followingOf(me) : undefined;
      const all = live.listTopics({ board: board || undefined, tag: tag || undefined, query: query || undefined, author: author || undefined, following, sort, page: 1, pageSize: Number.MAX_SAFE_INTEGER });
      const visible = all.items.filter(topic => ctx.canSeeBoard(topic.board));
      const items = visible.slice((page - 1) * pageSize, page * pageSize);
      const withPosters = board && !query && !tag && !author && page === 1;
      const counts = new Map<string, { author: CommunityAuthor; topics: number }>();
      const boardTopics = withPosters && following ? live.listTopics({ board, sort: 'active', page: 1, pageSize: Number.MAX_SAFE_INTEGER }).items.filter(topic => ctx.canSeeBoard(topic.board)) : visible;
      if (withPosters) for (const topic of boardTopics) {
        const entry = counts.get(memberKey(topic.author)) || { author: topic.author, topics: 0 };
        entry.topics++;
        counts.set(memberKey(topic.author), entry);
      }
      const posters = [...counts.values()].sort((a, b) => b.topics - a.topics).slice(0, 5);
      const map = await ctx.people([...items.flatMap((topic: StoredTopic) => topic.lastReply ? [topic.author, topic.lastReply.author] : [topic.author]), ...posters.map(poster => poster.author)]);
      ctx.send({
        items: items.map(topic => ctx.topicDTO(topic, map)), total: visible.length, page, pageSize,
        ...(following ? { followingCount: following.length } : {}),
        ...(withPosters ? { posters: posters.map(poster => ({ author: ctx.person(poster.author, map), topics: poster.topics })) } : {}),
      });
      return true;
    }
    const topicMatch = /^topics\/([^/]+)$/.exec(path);
    if (topicMatch) { ctx.send(await threadDTO(ctx, topicMatch[1])); return true; }
    if (path === 'bookmarks') {
      const topics = live.topics(live.bookmarks(me)).filter(topic => ctx.canSeeBoard(topic.board));
      ctx.send({ items: await ctx.topicsDTO(topics), total: topics.length, page: 1, pageSize: topics.length || pageSize });
      return true;
    }
    return false;
  }

  if (path === 'images') { ctx.send(await saveImage(ctx), 201); return true; }
  const body = await ctx.json();
  if (path === 'topics') { ctx.send(await createTopic(ctx, body), 201); return true; }
  if (path === 'reports') { ctx.send(await report(ctx, body), 201); return true; }

  const topicAction = /^topics\/([^/]+)\/([a-z-]+)$/.exec(path);
  if (topicAction) {
    const topic = visibleTopic(ctx, topicAction[1]);
    const target: Target = { kind: 'topic', id: topic.id };
    const isAuthor = same(me, topic.author);
    switch (topicAction[2]) {
      case 'replies': {
        assertNotMuted(ctx);
        if (topic.pending) throw fail('这个帖子还在审核，暂时不能回复。', 409);
        const content = ctx.clean(body.body, replyLimits, '回复', true);
        if (ctx.level < 1) {
          if (live.postedToday(me).replies >= r.l0RepliesDaily) throw fail(`初光等级每天最多 ${r.l0RepliesDaily} 条回复。`, 429);
          if (countLinks(content) > r.l0Links) throw fail(`初光等级每条回复最多 ${r.l0Links} 个链接。`);
        }
        ctx.throttle('reply');
        const result = live.addReply({ topicId: topic.id, author: me, body: content, quoteId: typeof body.quote === 'string' && body.quote ? body.quote : null });
        for (const member of await ctx.mentions(content))
          if (!result.told.some(item => same(item, member))) live.members.notify(member, { type: 'mention', actor: me, topicId: topic.id, replyId: result.id, text: '在回复里提到了你', data: { where: 'reply' } });
        ctx.send({ id: result.id, earned: result.earned }, 201);
        return true;
      }
      case 'edit': await editTopic(ctx, topic, body); ctx.send({ ok: true }); return true;
      case 'retag':
        if (!(ctx.level >= 3 || ctx.mod)) throw fail('守夜以上等级才能修改别人的标签。', 403);
        live.retag(topic.id, tagList(body.tags), me);
        await ctx.audit('retag', { topic: topic.id });
        ctx.send({ ok: true });
        return true;
      case 'delete': {
        if (!(ctx.mod || isAuthor)) throw fail('只能删除自己的帖子。', 403);
        const moderated = !isAuthor && (body.violation !== false || Boolean(topic.pending));
        const requestedReason = typeof body.reason === 'string' ? body.reason.trim() : '';
        const reason = topic.pending ? ((communityReviewReasons as readonly string[]).includes(requestedReason) ? requestedReason : '其他') : '';
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
        live.deleteTopic(topic.id, { moderated, reason, note });
        const days = Number(body.mute || 0);
        if (!isAuthor && [1, 7, 30].includes(days) && topic.author.kind === 'reader') live.members.mute(topic.author, days, '发布违规内容', me);
        if (!isAuthor) await ctx.audit('delete-topic', { topic: topic.id, author: memberKey(topic.author), moderated, reason: topic.pending ? reason : undefined, note: topic.pending ? note : undefined, mute: days || 0 });
        ctx.send({ ok: true });
        return true;
      }
      case 'like': ctx.throttle('action'); ctx.send(live.like(target, me, flag(body), { rewarding: ctx.level >= 1 })); return true;
      case 'bookmark': ctx.throttle('action'); ctx.send({ bookmarks: live.bookmark(topic.id, me, flag(body)), bookmarked: flag(body) }); return true;
      case 'thank':
        if (ctx.level < 1) throw fail('初光等级还不能感谢，升到巡天就可以了。', 403);
        ctx.send(live.thank(target, me, topic.author));
        return true;
      case 'unlock': {
        const meta = topic.fullMeta;
        if (!meta || meta.promptMode !== 'paid' || !meta.prompt) throw fail('这个帖子的提示词不需要解锁。');
        if (isAuthor) throw fail('这是你自己的提示词。');
        const result = live.economy.unlock(topic.id, me, meta.price, topic.author);
        live.members.notify(topic.author, { type: 'unlock', actor: me, topicId: topic.id, text: '解锁了你的提示词', data: { amount: result.share } });
        ctx.send(result);
        return true;
      }
      case 'vote': {
        const value = body.value === 'alive' || body.value === 'dead' ? body.value : null;
        ctx.throttle('action');
        ctx.send(live.vote(topic.id, me, value));
        return true;
      }
      case 'paid-pin': ctx.send(live.economy.paidPin(topic.id, me)); return true;
      case 'highlight': ctx.send(live.economy.highlight(topic.id, me)); return true;
      // 置顶、锁帖、移动、审核、恢复显示：站长和协管；精华只有站长。
      case 'pin': case 'lock': case 'move': case 'approve': case 'restore': case 'feature': {
        if (topicAction[2] === 'feature' ? !ctx.owner : !ctx.mod) throw fail(topicAction[2] === 'feature' ? '只有站长能评精华。' : '只有站长和协管能这样做。', 403);
        if (topicAction[2] === 'pin') live.setPinned(topic.id, flag(body));
        else if (topicAction[2] === 'lock') live.setLocked(topic.id, flag(body));
        else if (topicAction[2] === 'feature') live.setFeatured(topic.id, flag(body), { actor: me });
        else if (topicAction[2] === 'approve') live.approveTopic(topic.id);
        else if (topicAction[2] === 'restore') live.restore(target);
        else {
          const board = String(body.board || '');
          if (!boardIds.has(board)) throw fail('请选择要移到的版块。');
          live.move(topic.id, board);
        }
        await ctx.audit(topicAction[2], { topic: topic.id, on: flag(body), board: body.board ?? undefined });
        ctx.send({ ok: true });
        return true;
      }
    }
    return false;
  }
  const replyAction = /^replies\/([^/]+)\/([a-z-]+)$/.exec(path);
  if (replyAction) {
    const { reply, topic } = visibleReply(ctx, replyAction[1]);
    const target: Target = { kind: 'reply', id: reply.id };
    const mine = same(me, reply.author);
    switch (replyAction[2]) {
      case 'edit':
        if (!canEdit(ctx, reply.author, reply.createdAt)) throw fail(ctx.level >= 2 ? '只能在回复后 30 天内编辑自己的回复。' : `只能在回复后 ${r.editWindowHours} 小时内编辑自己的回复。`, 403);
        live.editReply(reply.id, { body: ctx.clean(body.body, replyLimits, '回复', true), editor: me });
        ctx.send({ ok: true });
        return true;
      case 'delete': {
        if (!(ctx.mod || mine)) throw fail('只能删除自己的回复。', 403);
        const moderated = !mine && body.violation !== false;
        live.deleteReply(reply.id, { moderated });
        const days = Number(body.mute || 0);
        if (!mine && [1, 7, 30].includes(days) && reply.author.kind === 'reader') live.members.mute(reply.author, days, '发布违规内容', me);
        if (!mine) await ctx.audit('delete-reply', { reply: reply.id, author: memberKey(reply.author), moderated, mute: days || 0 });
        ctx.send({ ok: true });
        return true;
      }
      case 'like': ctx.throttle('action'); ctx.send(live.like(target, me, flag(body), { rewarding: ctx.level >= 1 })); return true;
      case 'thank':
        if (ctx.level < 1) throw fail('初光等级还不能感谢，升到巡天就可以了。', 403);
        ctx.send(live.thank(target, me, reply.author));
        return true;
      case 'accept':
        if (topic.board !== 'qa') throw fail('只有学习问答可以采纳回答。');
        if (!same(me, topic.author)) throw fail('只有提问者能采纳回答。', 403);
        if (same(reply.author, topic.author)) throw fail('不能采纳自己的回复。');
        ctx.send({ earned: live.accept(reply.id) });
        return true;
      case 'restore':
        if (!ctx.mod) throw fail('只有站长和协管能这样做。', 403);
        live.restore(target);
        await ctx.audit('restore', { reply: reply.id });
        ctx.send({ ok: true });
        return true;
    }
  }
  return false;
}
