import { saveCommunityImage } from './community-images.ts';
import { isCommunitySort } from '../src/community.mjs';
import { communityRules, communityTags, communityReportReasons, countLinks, imageLimit } from '../src/community-rules.mjs';
import { fail, same, memberKey } from './community-db.ts';
import type { CommunityAuthor, Target } from './community-db.ts';
import { tagList, imageList, showcaseMeta, resourceMeta } from './community-context.ts';
import type { Body, Ctx } from './community-context.ts';
import type { StoredTopic } from './community-store.ts';
import { bodyImageContent } from '../src/community-body-images.ts';
import { isCommunityPassiveRead } from './community-passive-request.ts';

const pageSize = 20;
const searchLimit = 40;
const titleLimits = [4, 60] as const, topicLimits = [10, 10000] as const, replyLimits = [2, 2000] as const;
const r = communityRules;
const flag = (body: Body) => body.on !== false;
// 发帖后可以编辑多久：站长不限，观测以上 30 天，其他 24 小时。
const editWindow = (ctx: Ctx) => ctx.owner ? Infinity : ctx.level >= 2 ? r.editWindowDaysL2 * 24 * 3600 * 1000 : r.editWindowHours * 3600 * 1000;
const canEdit = (ctx: Ctx, author: CommunityAuthor, createdAt: string) =>
  !ctx.readOnly && (ctx.owner || (same(ctx.me, author) && Date.now() - Date.parse(createdAt) < editWindow(ctx)));
function assertNotMuted(ctx: Ctx) {
  const muted = ctx.live.members.muted(ctx.me);
  if (muted) throw fail(`你被禁言到 ${new Date(Date.parse(muted.until) + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}，原因：${muted.reason}。`, 403);
}
const canParticipateBoard = (ctx: Ctx, board: string) => board !== 'vip' || ctx.viewer.vip || ctx.owner;
// A topic the viewer may see: pending and hidden ones only for their author and moderators.
function visibleTopic(ctx: Ctx, id: string) {
  const topic = ctx.live.topic(id);
  if (!topic || !ctx.canSeeBoard(topic.board) || ((topic.pending || topic.hidden) && !ctx.canModerateBoard(topic.board) && (ctx.readOnly || !same(topic.author, ctx.me))))
    throw fail('帖子不存在，或已被删除。', 404);
  return topic;
}
function visibleReply(ctx: Ctx, id: string) {
  const reply = ctx.live.reply(id);
  if (!reply) throw fail('回复不存在，或已被删除。', 404);
  const topic = visibleTopic(ctx, reply.topicId);
  if (reply.hidden && !ctx.canModerateBoard(topic.board) && (ctx.readOnly || !same(reply.author, ctx.me)))
    throw fail('回复不存在，或已被删除。', 404);
  return { reply, topic };
}
// A masked prompt shows its shape without its words.
const maskPrompt = (prompt: string) => [...prompt].slice(0, 400).map(char => /[\s,，.。:：()\-]/.test(char) ? char : /[A-Za-z0-9]/.test(char) ? 'x' : '•').join('');

// The full post for one viewer: what they may do, the prompt if they may read it, and who is mentioned.
async function threadDTO(ctx: Ctx, id: string) {
  const { live, me } = ctx;
  const topic = visibleTopic(ctx, id);
  const canModerate = ctx.canModerateBoard(topic.board);
  if (!isCommunityPassiveRead(ctx.req)) live.view(topic.id, me);
  const related = topic.pending || topic.hidden ? [] : live.related(topic);
  const quoted = new Map(topic.replies.map(reply => [reply.id, reply]));
  const authors = [topic.author, ...topic.replies.map(reply => reply.author), ...related.flatMap(item => [item.author, ...(item.lastReply ? [item.lastReply.author] : [])])];
  const map = await ctx.people(authors);
  const isAuthor = !ctx.readOnly && same(me, topic.author);
  const target = { kind: 'topic' as const, id: topic.id };
  const visibleReplyText = topic.replies.filter(reply => !reply.hidden || canModerate || !ctx.readOnly && same(reply.author, me)).map(reply => reply.body);
  const names = [...new Set([topic.body, ...visibleReplyText].flatMap(text => [...text.matchAll(/@([\p{Script=Han}A-Za-z0-9_\-·]{1,30})/gu)].map(match => match[1])))];
  const mentioned = names.length && ctx.options.findByNames ? await ctx.options.findByNames(names.slice(0, 30)) : new Map<string, CommunityAuthor>();
  const mentionMap = await ctx.people([...mentioned.values()]);
  const currentTopic = visibleTopic(ctx, id);
  if (canModerate !== ctx.canModerateBoard(currentTopic.board)) throw fail('管理权限发生变化，请重新打开帖子。', 403);
  const mentions = Object.fromEntries([...mentioned].map(([name, member]) => [name, mentionMap.get(memberKey(member))?.uid || null]).filter(([, uid]) => uid));
  const lowerTarget=(author:CommunityAuthor)=>{try{live.staff.protect(me,author);return true;}catch{return false;}};
  const replies = topic.replies.map(reply => {
    const replyTarget = { kind: 'reply' as const, id: reply.id };
    const mine = !ctx.readOnly && same(me, reply.author), byTopicAuthor = same(reply.author, topic.author);
    const hiddenFromViewer = reply.hidden && !mine && !canModerate;
    const quote = reply.quoteId ? quoted.get(reply.quoteId) : null;
    return {
      id: reply.id, author: ctx.person(reply.author, map), body: hiddenFromViewer ? '' : reply.body, createdAt: reply.createdAt,
      images: hiddenFromViewer ? [] : reply.images,
      edited: reply.edited, likes: reply.likes, liked: live.liked(replyTarget, me), thanked: live.thanked(replyTarget, me), thanks: live.thanks(replyTarget),
      byTopicAuthor, accepted: topic.acceptedReplyId === reply.id, mine, hidden: reply.hidden,
      quote: quote && !(quote.hidden && !canModerate) ? { id: quote.id, author: ctx.person(quote.author, map).name, excerpt: [...quote.body].slice(0, 80).join('') } : null,
      canDelete: !ctx.readOnly && (mine || ctx.canStaff('reply.delete',currentTopic.board)&&lowerTarget(reply.author)), deleteReasonRequired: ctx.canStaff('reply.delete',currentTopic.board), canEdit: canEdit(ctx, reply.author, reply.createdAt), canRestore: ctx.canStaff('reply.restore',currentTopic.board) && reply.hidden,
      canPenalty: ctx.canStaff('reply.penalty',currentTopic.board)&&lowerTarget(reply.author),canMute:ctx.canStaff('member.mute')&&lowerTarget(reply.author),
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
      ...(ctx.options.simplePosting ? { rawTitle: topic.rawTitle } : {}),
      liked: live.liked(target, me), bookmarked: live.bookmarked(topic.id, me), bookmarks: topic.bookmarks,
      thanked: live.thanked(target, me), thanks: topic.thanks, mine: isAuthor,
      canDelete: !ctx.readOnly && (isAuthor || ctx.canStaff(topic.pending?'topic.reject':'topic.delete',currentTopic.board)&&lowerTarget(topic.author)), deleteReasonRequired: ctx.canStaff(topic.pending?'topic.reject':'topic.delete',currentTopic.board), canEdit: canEdit(ctx, topic.author, topic.createdAt), canModerate, canFeature: ctx.staff?.role!=='assistant'&&ctx.canStaff('feature.decide',currentTopic.board),
      canRecommend:!currentTopic.pending&&!currentTopic.hidden&&ctx.canStaff('feature.recommend',currentTopic.board)&&me.kind==='reader',canPenalty:ctx.canStaff('topic.penalty',currentTopic.board)&&lowerTarget(topic.author),canMute:ctx.canStaff('member.mute')&&lowerTarget(topic.author),
      canPin:ctx.canStaff('topic.pin',currentTopic.board),canLock:ctx.canStaff('topic.lock',currentTopic.board),canMove:ctx.canStaff('topic.move',currentTopic.board),canApprove:ctx.canStaff('topic.approve',currentTopic.board),canRestore:ctx.canStaff('topic.restore',currentTopic.board),
      canRetag: !ctx.readOnly && (ctx.trustLevel >= 3 || ctx.canStaff('topic.retag',currentTopic.board)), canPaidPin: isAuthor && (topic.board === 'showcase' || topic.board === 'tools') && !topic.paidPin,
      canHighlight: isAuthor && !topic.glow, canReply: !ctx.readOnly && canParticipateBoard(ctx, topic.board) && !topic.locked && !muted && !topic.pending,
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
      badgeState: live.members.badgeState(topic.author, { joinedAt: map.get(memberKey(topic.author))?.joinedAt }),
      bio: map.get(memberKey(topic.author))?.bio || '', following: !isAuthor && live.members.following(me, topic.author),
    },
    related: related.map(item => ctx.topicDTO(item, map)),
    mentions,
    viewer: { level: ctx.level, muted: muted ? { until: muted.until, reason: muted.reason } : null },
  };
}

// Create and edit use one set of rules; hiding a field must not leave it required.
function topicInput(ctx: Ctx, board: string, body: Body, level: number, previous?: NonNullable<ReturnType<Ctx['live']['topic']>>) {
  const simple = Boolean(ctx.options.simplePosting);
  const moment = board === 'moments';
  const title = moment && !simple ? '' : ctx.clean(body.title, simple ? [1, titleLimits[1]] : titleLimits, '标题', false);
  let images = imageList(body.images, board, level, simple);
  const inline = bodyImageContent(typeof body.body === 'string' ? body.body : '');
  if (simple) {
    ctx.clean(inline.text, [1, moment ? r.momentMax : topicLimits[1]], '正文', true);
    if (inline.images.some(id => !images.includes(id))) throw fail('正文图片无效，请重新上传。');
    if (!inline.images.length) throw fail('请在正文添加至少 1 张图片，第一张自动作为封面。');
    // Upload completion order must not decide the cover; follow document order.
    images = [...inline.images, ...images.filter(id => !inline.images.includes(id))];
  }
  const content = simple ? ctx.clean(body.body, [1, (moment ? r.momentMax : topicLimits[1]) + images.length * 100], '正文', true, images)
    : moment ? ctx.clean(body.body, [2, r.momentMax], '内容', true)
    : board === 'showcase' || board === 'tools' ? (typeof body.body === 'string' && body.body.trim() ? ctx.clean(body.body, [0, topicLimits[1]], '正文', true) : '')
    : ctx.clean(body.body, topicLimits, '正文', true);
  if (!simple && board === 'showcase' && !images.length) throw fail('作品帖至少要有 1 张图。');
  if (simple && (Number(body.bounty || 0) || body.price || (board !== 'showcase' && (body.promptMode === 'paid' || Number(body.promptPrice || 0))))) throw fail('当前发帖仅作品提示词可以设置解锁数量，不设置资源价格或悬赏。');
  // Older editors omit prompt settings; their saves must retain the paid prompt.
  const metadata = simple && previous?.fullMeta?.promptMode === 'paid' && body.promptMode === undefined
    ? { ...body, prompt: previous.fullMeta.prompt, promptMode: 'paid', promptPrice: previous.fullMeta.price }
    : body;
  const meta = board === 'showcase' ? showcaseMeta(metadata, simple) : null;
  const resource = board === 'tools' ? resourceMeta(simple && previous?.resource ? { ...body, price: previous.resource.price } : body, simple) : null;
  return { title, content, images, meta, resource };
}

async function createTopic(ctx: Ctx, body: Body) {
  const { live, me, level } = ctx;
  assertNotMuted(ctx);
  const board = String(body.board || '');
  if (!live.boards.has(board)) throw fail('请选择一个版块。');
  if (!ctx.canSeeBoard(board) || !canParticipateBoard(ctx, board)) throw fail('会员茶室只有 VIP 能发帖。', 403);
  // Resolve mentions before the transaction; the creation, reward, notices and
  // saved retry result then form one synchronous commit.
  const mentions = await ctx.mentions(typeof body.body === 'string' ? body.body : '');
  ctx.requireConsent();
  assertNotMuted(ctx);
  if (!ctx.canSeeBoard(board) || !canParticipateBoard(ctx, board)) throw fail('会员茶室只有 VIP 能发帖。', 403);
  let input: Parameters<typeof live.createTopic>[0] | undefined;
  return live.requests.run(me, ctx.path, ctx.req.headers['x-idempotency-key'], body, () => {
    if (!input) throw Error('Community topic input was not prepared.');
    const result = live.createTopic(input);
    if (input.pending) live.members.notify(ctx.ownerMember, { type: 'review', actor: me, topicId: result.id, text: '有新帖子等待审核', data: { state: 'queue' }, link: '#/community/manage' });
    else for (const member of mentions)
      live.members.notify(member, { type: 'mention', actor: me, topicId: result.id, text: '在帖子里提到了你', data: { where: 'topic' } });
    return result;
  }, () => {
    if (!live.members.agreed(me)) throw fail('请先阅读并同意当前社区公约。', 428);
    const { title, content, images, meta, resource } = topicInput(ctx, board, body, level);
    const tags = tagList(body.tags);
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
    input = { board, author: me, title, body: content, tags, images, bounty, meta, resource, pin,
      pending: review ? (links ? '初光等级，帖子带外链' : '初光等级，帖子带图片') : null };
    ctx.throttle('topic');
  });
}

function replyInput(ctx: Ctx, value: unknown) {
  const inline = bodyImageContent(typeof value === 'string' ? value : '');
  const max = imageLimit('qa', ctx.level);
  if (inline.images.length > max) throw fail(`每条回复最多 ${max} 张图片。`);
  ctx.clean(inline.text, replyLimits, '回复', true);
  const content = ctx.clean(value, [replyLimits[0], replyLimits[1] + inline.images.length * 100], '回复', true, inline.images);
  return { content, images: inline.images, text: inline.text };
}

async function editTopic(ctx: Ctx, topic: NonNullable<ReturnType<Ctx['live']['topic']>>, body: Body) {
  if (!canEdit(ctx, topic.author, topic.createdAt)) throw fail(ctx.level >= 2 ? '只能在发帖后 30 天内编辑自己的帖子。' : `只能在发帖后 ${r.editWindowHours} 小时内编辑自己的帖子。`, 403);
  const authorLevel = ctx.live.members.trustLevel(topic.author);
  const { title, content, images, meta, resource } = topicInput(ctx, topic.board, body, authorLevel, topic);
  if (authorLevel < 1 && countLinks(content) + (resource ? 1 : 0) > r.l0Links) throw fail(`初光等级每帖最多 ${r.l0Links} 个链接。`);
  ctx.live.editTopic(topic.id, {
    title, body: content, tags: tagList(body.tags), images, editor: ctx.me,
    meta, resource, clearResource: Boolean(ctx.options.simplePosting && topic.board === 'tools' && !resource),
  });
}

// Reporting: a night watch (L3) or moderator report hides content by first-light and survey
// members at once; two reports from observers (L2) and above also hide it. The owner decides.
async function report(ctx: Ctx, body: Body) {
  const { live, me } = ctx;
  const kind = body.kind === 'reply' ? 'reply' : body.kind === 'topic' ? 'topic' : '';
  const id = String(body.id || '');
  if (!kind) throw fail('举报对象无效。');
  const subject = kind === 'topic' ? { topic: visibleTopic(ctx, id), reply: null } : visibleReply(ctx, id);
  const author = subject.reply?.author ?? subject.topic.author;
  let reportLevel = ctx.trustLevel;
  if (ctx.canStaff('report.review', subject.topic.board)) {
    // A staff capability must not turn a report about a peer or superior into
    // an immediate moderation action. Earned ordinary trust still applies.
    try { live.staff.protect(me, author); reportLevel = 4; } catch { /* Use earned trust. */ }
  }
  if (reportLevel < 1) throw fail('初光等级还不能举报，升到巡天就可以了。', 403);
  if (same(me, author)) throw fail('不能举报自己的内容。');
  const reason = String(body.reason || '');
  if (!(communityReportReasons as readonly string[]).includes(reason)) throw fail('请选择举报原因。');
  const note = typeof body.note === 'string' && body.note.trim() ? ctx.clean(body.note, [1, 200], '补充说明', false) : '';
  ctx.throttle('report');
  const target: Target = { kind, id };
  return live.transaction(() => {
    live.report({ target, reporter: me, reporterLevel: reportLevel, reason, note });
    const authorLevel = live.members.trustLevel(author);
    const strong = reportLevel >= 3 && author.kind !== 'owner' && authorLevel <= 1;
    const hidden = author.kind !== 'owner' && (strong || live.reportsFrom(target, 2) >= 2) ? live.hide(target, `举报：${reason}`) : false;
    live.members.notify(ctx.ownerMember, { type: 'system', actor: me, topicId: kind === 'topic' ? id : live.reply(id)?.topicId, text: '收到一条举报', data: { report: 'new', reason, hidden }, link: '#/community/manage/reports' });
    return { hidden };
  });
}

export async function contentRoutes(ctx: Ctx): Promise<boolean> {
  const { live, me, path, method, url } = ctx;
  if (method === 'GET') {
    if (path === 'banners') {
      ctx.send(live.banners.get(url.searchParams.get('scope') || 'home', ctx.canSeeBoard));
      return true;
    }
    if (path === 'summary') {
      const hiddenBoard = ctx.hiddenBoard;
      let summary = live.summary({ limit: 20, hiddenBoard });
      const hot = await ctx.topicsDTO(summary.hot.filter(topic => ctx.canSeeBoard(topic.board)).slice(0, 5));
      // Person lookup also refreshes live staff/account authorization. Counts,
      // tags and latest titles must use the same final private-board boundary.
      if (ctx.hiddenBoard !== hiddenBoard) summary = live.summary({ limit: 20, hiddenBoard: ctx.hiddenBoard });
      const stats = Object.values(summary.boards);
      ctx.send({
        total: stats.reduce((sum, board) => sum + board.topics, 0),
        repliesToday: stats.reduce((sum, board) => sum + board.repliesToday, 0),
        checkinsToday: summary.checkinsToday, boards: summary.boards, tags: summary.tags, hot,
        boardCatalog: live.boards.catalog(),
      });
      return true;
    }
    if (path === 'topics') {
      const board = url.searchParams.get('board') || '';
      if (board && (!live.boards.has(board) || !ctx.canSeeBoard(board))) throw fail('没有这个版块。', 404);
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
      if (board && !ctx.canSeeBoard(board)) throw fail('没有这个版块。', 404);
      const currentVisible = visible.filter(topic => { const current = live.topic(topic.id); return current && current.board === topic.board && ctx.canSeeBoard(current.board) && !current.pending && !current.hidden; });
      const currentItems = currentVisible.slice((page - 1) * pageSize, page * pageSize);
      ctx.send({
        items: currentItems.map(topic => ctx.topicDTO(topic, map)), total: currentVisible.length, page, pageSize,
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

  if (path === 'images') { ctx.send(await saveCommunityImage(ctx), 201); return true; }
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
        if (!canParticipateBoard(ctx, topic.board)) throw fail('会员茶室只有 VIP 能回复。', 403);
        const mentions = await ctx.mentions(typeof body.body === 'string' ? body.body : '');
        ctx.requireConsent();
        assertNotMuted(ctx);
        const current = visibleTopic(ctx, topic.id);
        if (!canParticipateBoard(ctx, current.board)) throw fail('会员茶室只有 VIP 能回复。', 403);
        let input: Parameters<typeof live.addReply>[0] | undefined;
        const result = live.requests.run(me, path, ctx.req.headers['x-idempotency-key'], body, () => {
          if (!input) throw Error('Community reply input was not prepared.');
          const added = live.addReply(input);
          for (const member of mentions)
            if (!added.told.some(item => same(item, member))) live.members.notify(member, { type: 'mention', actor: me, topicId: topic.id, replyId: added.id, text: '在回复里提到了你', data: { where: 'reply' } });
          return { id: added.id, earned: added.earned };
        }, () => {
          if (current.pending) throw fail('这个帖子还在审核，暂时不能回复。', 409);
          const quoteId = typeof body.quote === 'string' && body.quote ? body.quote : null;
          if (quoteId && visibleReply(ctx, quoteId).topic.id !== topic.id) throw fail('引用的回复已不存在。');
          const { content, images, text } = replyInput(ctx, body.body);
          if (ctx.level < 1) {
            if (live.postedToday(me).replies >= r.l0RepliesDaily) throw fail(`初光等级每天最多 ${r.l0RepliesDaily} 条回复。`, 429);
            if (countLinks(text) > r.l0Links) throw fail(`初光等级每条回复最多 ${r.l0Links} 个链接。`);
          }
          input = { topicId: topic.id, author: me, body: content, images, quoteId };
          ctx.throttle('reply');
        });
        ctx.send(result, 201);
        return true;
      }
      case 'edit': await editTopic(ctx, topic, body); ctx.send({ ok: true }); return true;
      case 'retag':
        if (!(ctx.trustLevel >= 3 || ctx.canStaff('topic.retag',topic.board))) throw fail('守夜以上等级才能修改别人的标签。', 403);
        await ctx.auditMutation('retag', () => {if(ctx.trustLevel<3)ctx.requireStaff('topic.retag',live.topic(topic.id)?.board);return live.retag(topic.id, tagList(body.tags), me);}, { topic: topic.id });
        ctx.send({ ok: true });
        return true;
      case 'delete': {
        const canDelete=ctx.canStaff(topic.pending?'topic.reject':'topic.delete',topic.board);
        if (!(canDelete || isAuthor)) throw fail('只能删除自己的帖子，或需要对应删除权限。', 403);
        const moderated = !isAuthor;
        const penalty = moderated && !topic.pending && (body.violation===true || body.violation===undefined&&ctx.canStaff('topic.penalty',topic.board));
        const reason = canDelete ? ctx.clean(body.reason, [2, 200], '删除理由', false) : '';
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
        const days = Number(body.mute || 0);
        const remove = () => {
          const current=visibleTopic(ctx,topic.id);
          if(!isAuthor){ctx.requireStaff(current.pending?'topic.reject':'topic.delete',current.board);live.staff.protect(me,current.author);if(penalty)ctx.requireStaff('topic.penalty',current.board);}
          if(days){if(![1,7,30].includes(days)||isAuthor)throw fail('禁言参数无效。');ctx.requireStaff('member.mute');live.staff.protect(me,current.author);}
          live.deleteTopic(topic.id, { moderated, penalty, reason, note });
          if (days && current.author.kind === 'reader') live.members.mute(current.author, days, '发布违规内容', me);
        };
        if (canDelete) await ctx.auditMutation('delete-topic', remove, { topic: topic.id, author: memberKey(topic.author), moderated, penalty, reason, note, mute: days || 0 });
        else remove();
        ctx.send({ ok: true });
        return true;
      }
      case 'like': ctx.throttle('action'); ctx.send(live.like(target, me, flag(body))); return true;
      case 'bookmark': ctx.throttle('action'); ctx.send({ bookmarks: live.bookmark(topic.id, me, flag(body)), bookmarked: flag(body) }); return true;
      case 'thank':
        if (ctx.level < 1) throw fail('初光等级还不能感谢，升到巡天就可以了。', 403);
        ctx.send(live.requests.run(me, path, ctx.req.headers['x-idempotency-key'], body, () => live.thank(target, me, topic.author), () => ctx.throttle('action')));
        return true;
      case 'unlock': {
        const meta = topic.fullMeta;
        if (!meta || meta.promptMode !== 'paid' || !meta.prompt) throw fail('这个帖子的提示词不需要解锁。');
        if (isAuthor) throw fail('这是你自己的提示词。');
        ctx.throttle('action');
        const result = live.transaction(() => {
          const unlocked = live.economy.unlock(topic.id, me, meta.price, topic.author);
          live.members.notify(topic.author, { type: 'unlock', actor: me, topicId: topic.id, text: '解锁了你的提示词', data: { amount: unlocked.share } });
          return unlocked;
        });
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
      case 'feature-recommend': {
        ctx.requireStaff('feature.recommend',topic.board);
        const reason=body.reason===undefined?'':ctx.clean(body.reason,[0,200],'推荐理由',false);
        const id=await ctx.auditMutation('feature-recommend',()=>{ctx.requireStaff('feature.recommend',live.topic(topic.id)?.board);return live.featureRecommendations.recommend(me,topic.id,reason);},{topic:topic.id,reason});
        ctx.send({ok:true,id});return true;
      }
      // 置顶、锁帖、移动、审核、恢复显示：站长和协管；精华只有站长。
      case 'pin': case 'lock': case 'move': case 'approve': case 'restore': case 'feature': {
        const permission=topicAction[2]==='feature'?'feature.decide':`topic.${topicAction[2]}` as 'topic.pin'|'topic.lock'|'topic.move'|'topic.approve'|'topic.restore';
        ctx.requireStaff(permission,topic.board);
        if(topicAction[2]==='feature'&&ctx.staff?.role==='assistant')throw fail('协管需推荐给所属版主审批。',403);
        await ctx.auditMutation(topicAction[2], () => {
          ctx.requireStaff(permission,live.topic(topic.id)?.board);
          if (topicAction[2] === 'pin') live.setPinned(topic.id, flag(body));
          else if (topicAction[2] === 'lock') live.setLocked(topic.id, flag(body));
          else if (topicAction[2] === 'feature') live.setFeatured(topic.id, flag(body), { actor: me });
          else if (topicAction[2] === 'approve') live.approveTopic(topic.id);
          else if (topicAction[2] === 'restore') live.restore(target);
          else {
            const board = String(body.board || '');
            if (!live.boards.has(board)) throw fail('请选择要移到的版块。');
            ctx.requireStaff('topic.move',board);
            live.move(topic.id, board);
          }
        }, { topic: topic.id, on: flag(body), board: body.board ?? undefined });
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
      case 'edit': {
        if (!canEdit(ctx, reply.author, reply.createdAt)) throw fail(ctx.level >= 2 ? '只能在回复后 30 天内编辑自己的回复。' : `只能在回复后 ${r.editWindowHours} 小时内编辑自己的回复。`, 403);
        const { content, images } = replyInput(ctx, body.body);
        live.editReply(reply.id, { body: content, images, editor: me });
        ctx.send({ ok: true });
        return true;
      }
      case 'delete': {
        const canDelete=ctx.canStaff('reply.delete',topic.board);
        if (!(canDelete || mine)) throw fail('只能删除自己的回复，或需要对应删除权限。', 403);
        const moderated = !mine,penalty=moderated&&(body.violation===true||body.violation===undefined&&ctx.canStaff('reply.penalty',topic.board));
        const reason = canDelete ? ctx.clean(body.reason, [2, 200], '删除理由', false) : '';
        const days = Number(body.mute || 0);
        const remove = () => {
          const current=visibleReply(ctx,reply.id);
          if(!mine){ctx.requireStaff('reply.delete',current.topic.board);live.staff.protect(me,current.reply.author);if(penalty)ctx.requireStaff('reply.penalty',current.topic.board);}
          if(days){if(![1,7,30].includes(days)||mine)throw fail('禁言参数无效。');ctx.requireStaff('member.mute');live.staff.protect(me,current.reply.author);}
          live.deleteReply(reply.id, { moderated, penalty, reason });
          if (days && current.reply.author.kind === 'reader') live.members.mute(current.reply.author, days, '发布违规内容', me);
        };
        if (canDelete) await ctx.auditMutation('delete-reply', remove, { reply: reply.id, author: memberKey(reply.author), moderated, penalty, reason, mute: days || 0 });
        else remove();
        ctx.send({ ok: true });
        return true;
      }
      case 'like': ctx.throttle('action'); ctx.send(live.like(target, me, flag(body))); return true;
      case 'thank':
        if (ctx.level < 1) throw fail('初光等级还不能感谢，升到巡天就可以了。', 403);
        ctx.send(live.requests.run(me, path, ctx.req.headers['x-idempotency-key'], body, () => live.thank(target, me, reply.author), () => ctx.throttle('action')));
        return true;
      case 'accept':
        if (topic.board !== 'qa') throw fail('只有学习问答可以采纳回答。');
        if (!same(me, topic.author)) throw fail('只有提问者能采纳回答。', 403);
        if (same(reply.author, topic.author)) throw fail('不能采纳自己的回复。');
        ctx.send({ earned: live.accept(reply.id) });
        return true;
      case 'restore':
        ctx.requireStaff('reply.restore',topic.board);
        await ctx.auditMutation('restore', () => {ctx.requireStaff('reply.restore',visibleReply(ctx,reply.id).topic.board);return live.restore(target);}, { reply: reply.id });
        ctx.send({ ok: true });
        return true;
    }
  }
  return false;
}
