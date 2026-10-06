import { communityBoards } from '../src/community.mjs';
import { communityReviewReasons, communityShopCats, communityNameEffect } from '../src/community-rules.mjs';
import { fail, memberKey } from './community-db.ts';
import type { CommunityAuthor } from './community-db.ts';
import type { Body, Ctx } from './community-context.ts';
import type { CustomItemInput } from './community-economy.ts';
import { saveCommunityImage } from './community-images.ts';
import { reviewTopics } from './community-review.ts';
import { communityBadgeFamilies, communityBadgeTiers } from '../src/community-badge-policy.ts';
import type { BadgeFamilyId, BadgeTier } from '../src/community-badge-policy.ts';
import type { BadgeReview, BadgeSource } from './community-badges.ts';

const tabs = ['queue', 'reports', 'content', 'orders', 'items', 'stewards', 'sanctions', 'data', 'banners', 'contact', 'convention'] as const;
// The owner manages the shop, orders and steward appointments; stewards handle moderation.
const ownerTabs = new Set(['orders', 'items', 'stewards', 'convention']);
const whole = (value: unknown, label: string, min: number, max: number) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw fail(`${label}需要是 ${min} 到 ${max} 之间的整数。`);
  return number;
};
function itemInput(ctx: Ctx, body: Body, id?: string): CustomItemInput {
  let image: string | null | undefined;
  if (body.image !== undefined) {
    image = body.image === null || body.image === '' ? null : String(body.image);
    if (image) {
      const upload = /^[0-9a-f-]{36}$/.test(image) ? ctx.live.image(image) : null;
      if (!upload || upload.deleted_at || upload.purpose !== 'shop' || upload.uploader_kind !== ctx.me.kind || upload.uploader_id !== ctx.me.id || upload.topic_id)
        throw fail('商品图片已失效，请重新上传。');
    }
  }
  const cat = body.cat === 'goods' ? 'goods' : body.cat === 'digital' ? 'digital' : body.cat === 'look' ? 'look' : null;
  if (!cat) throw fail('请选择物品类别。');
  const kind = cat === 'look' && (body.kind === 'frame' || body.kind === 'color') ? body.kind : undefined;
  if (cat === 'look' && !kind) throw fail('请选择头像框或昵称特效。');
  const previous = id ? ctx.live.economy.item(id) : null;
  if (kind === 'frame') {
    const assetId = image === undefined ? previous?.image : image;
    const upload = assetId ? ctx.live.image(assetId) : null;
    if (!upload || upload.deleted_at || upload.purpose !== 'shop' || !upload.frame_ready)
      throw fail('头像框需要上传正方形透明图片，并为中间的头像留出透明区域。');
  }
  const effect = kind === 'color' ? communityNameEffect(body.effect === undefined ? previous?.effect : body.effect) : null;
  if (kind === 'color' && !effect) throw fail('请选择昵称特效，单色需一种颜色，渐变或流光需两种颜色（格式如 #976223）。');
  let category: string | null | undefined;
  if (body.category !== undefined) {
    category = body.category === null || body.category === '' ? null : String(body.category);
    if (category && (!/^[0-9a-f-]{36}$/.test(category) || !ctx.live.economy.category(category))) throw fail('这个上架类别不存在，请重新选择。');
  }
  const limitPer = body.limitPer === 'month' || body.limitPer === 'year' || body.limitPer === 'once' ? body.limitPer : null;
  const stock = body.stock === null || body.stock === '' || body.stock === undefined ? null : whole(body.stock, '库存', 0, 100000);
  if (cat === 'goods' && stock === null) throw fail('实物需要填写库存。');
  const delivery = typeof body.delivery === 'string' ? body.delivery.replace(/\r\n?/g, '\n').trim() : '';
  if (cat === 'digital' && !delivery) throw fail('数字资源需要填写兑换后给出的内容，比如下载链接和提取码。');
  if ([...delivery].length > 2000) throw fail('兑换后给出的内容最多 2000 个字。');
  return {
    cat, name: ctx.clean(body.name, [2, 30], '名称', false), description: ctx.clean(body.description, [4, 200], '说明', true),
    price: whole(body.price, '价格', 1, 100000), stock, limitPer, limitN: limitPer ? whole(body.limitN || 1, '限兑次数', 1, 100) : null,
    minLevel: whole(body.minLevel || 0, '最低等级', 0, 3), minDays: whole(body.minDays || 0, '注册天数', 0, 3650),
    delivery, image, category, kind, effect: kind === 'color' ? effect : null,
    note: typeof body.note === 'string' ? ctx.clean(body.note || ' ', [0, 60], '备注', false) : '', active: body.active !== false,
  };
}

export async function manageRoutes(ctx: Ctx): Promise<boolean> {
  const { live, path, method, url } = ctx;
  if (!path.startsWith('manage')) return false;
  if (!ctx.mod) throw fail('只有站长和协管能进入社区管理。', 403);
  const badgeMember = /^manage\/badges\/([^/]+)$/.exec(path);
  if (method === 'GET' && badgeMember) {
    if (!ctx.owner) throw fail('只有作者能查阅徽章复核证据。', 403);
    const member = await ctx.options.findMember?.(badgeMember[1]);
    if (!member) throw fail('找不到这个成员。', 404);
    const info = (await ctx.people([member])).get(memberKey(member));
    ctx.send({ badgeState: live.members.badgeState(member, { joinedAt: info?.joinedAt }), ...live.members.badgeReviewDetails(member) });
    return true;
  }
  if (method === 'GET' && path === 'manage') {
    const tab = (tabs as readonly string[]).includes(url.searchParams.get('tab') || '') ? url.searchParams.get('tab')! : 'queue';
    if (ownerTabs.has(tab) && !ctx.owner) throw fail(tab === 'stewards' ? '只有作者能管理版主。' : tab === 'convention' ? '只有作者能修改社区公约。' : '只有站长能管理兑换所。', 403);
    const moderationBoards = ctx.moderationBoards;
    const allQueue = live.queue();
    const queue = {
      topics: allQueue.topics.filter(topic => ctx.canModerateBoard(topic.board)),
      replies: allQueue.replies.filter(reply => {
        const parent = live.topic(reply.topicId);
        return Boolean(parent && ctx.canModerateBoard(parent.board));
      }),
    };
    const reportTargets = live.openReports().map(report => {
      const reply = report.target.kind === 'reply' ? live.reply(report.target.id) : null;
      const topic = report.target.kind === 'reply' && !reply ? null : live.topic(reply ? reply.topicId : report.target.id);
      return { report, reply, topic };
    }).filter(({ topic }) => ctx.owner || Boolean(topic && ctx.canModerateBoard(topic.board)));
    const reports = reportTargets.map(({ report }) => report);
    const orders = ctx.owner ? live.economy.goodsOrders() : [];
    const sanctions = live.members.sanctions();
    const stewards = tab === 'stewards' ? live.members.stewards() : [];
    const content = tab === 'content' ? (ctx.owner
      ? live.listTopics({ sort: 'newest', page: 1, pageSize: 100 }).items
      : ctx.moderationBoards.flatMap(board => live.listTopics({ board, sort: 'newest', page: 1, pageSize: 100 }).items)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)) : [];
    const people: CommunityAuthor[] = [
      ...queue.topics.map(topic => topic.author), ...queue.replies.map(reply => reply.author),
      ...reports.map(report => report.reporter), ...orders.map(order => order.member), ...sanctions.map(sanction => sanction.member), ...content.map(topic => topic.author), ...stewards,
    ];
    for (const { reply, topic } of reportTargets) if (reply) people.push(reply.author); else if (topic) people.push(topic.author);
    const map = await ctx.people(people);
    const currentBoards = ctx.moderationBoards;
    if (!ctx.mod || currentBoards.length !== moderationBoards.length || currentBoards.some(board => !moderationBoards.includes(board)))
      throw fail('管理权限发生变化，请重新打开管理页面。', 403);
    const stillModeratesTopic = (id: string) => {
      const topic = live.topic(id);
      return Boolean(topic && ctx.canModerateBoard(topic.board));
    };
    const stillModeratesReply = (id: string) => {
      const reply = live.reply(id);
      return Boolean(reply && stillModeratesTopic(reply.topicId));
    };
    if (!ctx.owner && (queue.topics.some(topic => !stillModeratesTopic(topic.id))
      || queue.replies.some(reply => !stillModeratesReply(reply.id))
      || content.some(topic => !stillModeratesTopic(topic.id))
      || reports.some(report => !(report.target.kind === 'reply' ? stillModeratesReply(report.target.id) : stillModeratesTopic(report.target.id)))))
      throw fail('内容所属板块发生变化，请重新打开管理页面。', 403);
    const activity = live.activity(Date.now(), ctx.owner ? undefined : ctx.moderationBoards);
    ctx.send({
      tab, owner: ctx.owner, moderationBoards: ctx.moderationBoards,
      ...(tab === 'stewards' ? { stewards: stewards.map(member => ctx.person(member, map)) } : {}),
      ...(tab === 'banners' ? { banners: live.banners.managed({ actor: ctx.me, browsingAsReader: ctx.browsingAsReader, canSeeBoard: ctx.canSeeBoard }) } : {}),
      ...(tab === 'convention' ? { convention: live.convention.current() } : {}),
      content: content.map(topic => ctx.topicDTO(topic, map)),
      counts: { queue: queue.topics.length + queue.replies.length, reports: reports.length, orders: orders.filter(order => order.status === 'pending').length, sanctions: sanctions.filter(sanction => sanction.active).length },
      kpis: { topics24h: activity.topics24h, replies24h: activity.replies24h },
      queue: {
        topics: queue.topics.map(topic => ({ ...ctx.topicDTO(topic, map), body: [...topic.body].slice(0, 200).join(''), pendingReason: topic.pendingReason, hiddenReason: topic.hiddenReason })),
        replies: queue.replies.map(reply => ({ ...reply, board: live.topic(reply.topicId)?.board ?? null, author: ctx.person(reply.author, map), body: [...reply.body].slice(0, 200).join('') })),
      },
      reports: reportTargets.map(({ report, reply, topic }) => ({
        id: report.id, reason: report.reason, note: report.note, createdAt: report.createdAt, reporter: ctx.person(report.reporter, map),
        target: {
          kind: report.target.kind, id: report.target.id, topicId: topic?.id || null, board: topic?.board ?? null, title: topic?.title || '（已删除）',
          excerpt: [...(reply ? reply.body : topic?.body || '')].slice(0, 140).join(''),
          author: reply ? ctx.person(reply.author, map) : topic ? ctx.person(topic.author, map) : null,
          gone: (report.target.kind === 'reply' && !reply) || !topic, hidden: reply ? reply.hidden : Boolean(topic?.hidden),
        },
      })),
      orders: orders.map(order => ({ ...order, member: ctx.person(order.member, map) })),
      items: ctx.owner ? live.economy.customItems() : [],
      categories: ctx.owner ? live.economy.categories() : [],
      sanctions: sanctions.map(sanction => ({ ...sanction, member: ctx.person(sanction.member, map) })),
      data: tab === 'data' ? { flow: ctx.owner ? live.ledger.flow(7) : [], boards: communityBoards.filter(board => ctx.canModerateBoard(board.id)).map(board => ({ id: board.id, topics: activity.boards[board.id] || 0 })) } : null,
    });
    return true;
  }
  if (method !== 'POST') return false;
  if (path === 'manage/banner-image') {
    const scope = url.searchParams.get('scope') || '';
    ctx.send(await saveCommunityImage(ctx, false, scope), 201);
    return true;
  }
  if (path === 'manage/item-image') {
    if (!ctx.owner) throw fail('只有作者能上传商品图片。', 403);
    ctx.send(await saveCommunityImage(ctx, true), 201);
    return true;
  }
  const body = await ctx.json();
  if (!ctx.mod) throw fail('只有站长和协管能进入社区管理。', 403);
  const badgeReview = /^manage\/badges\/([^/]+)\/review$/.exec(path);
  if (badgeReview) {
    if (!ctx.owner) throw fail('只有作者能复核徽章荣誉。', 403);
    const member = await ctx.options.findMember?.(badgeReview[1]);
    if (!member) throw fail('找不到这个成员。', 404);
    if (!ctx.owner) throw fail('管理权限发生变化，请重新打开管理页面。', 403);
    if (!communityBadgeFamilies.some(item => item.id === body.family) || !(communityBadgeTiers as readonly unknown[]).includes(body.tier)
      || !['revoke', 'restore'].includes(String(body.action))) throw fail('请选择有效的徽章系列、材质及复核操作。');
    const sources: BadgeSource[] = [];
    if (body.sources !== undefined) {
      if (!Array.isArray(body.sources) || body.sources.length > 200) throw fail('复核来源格式无效。');
      for (const value of body.sources) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('复核来源格式无效。');
        const source = value as Record<string, unknown>;
        if (typeof source.kind !== 'string' || !['topic', 'reply', 'reaction', 'acceptance', 'featured', 'checkin', 'contributor'].includes(source.kind)
          || typeof source.id !== 'string' || (source.actor !== undefined && typeof source.actor !== 'string')) throw fail('复核来源格式无效。');
        sources.push({ kind: source.kind as BadgeSource['kind'], id: source.id, ...(typeof source.actor === 'string' ? { actor: source.actor } : {}) });
      }
    }
    const input: BadgeReview = { family: body.family as BadgeFamilyId, tier: body.tier as BadgeTier, reason: ctx.clean(body.reason, [2, 200], '复核依据', false), sources,
      ...(typeof body.legacyBadge === 'string' ? { legacyBadge: body.legacyBadge } : {}) };
    ctx.throttle('action');
    const action = body.action === 'restore' ? 'badge-restored' : 'badge-revoked';
    const result = await ctx.auditMutation(action, () => body.action === 'restore' ? live.members.restoreBadges(member, input, ctx.me) : live.members.reviewBadges(member, input, ctx.me),
      { member: memberKey(member), ...input });
    ctx.send(result);
    return true;
  }
  const badgeAppeal = /^manage\/badge-violations\/(penalty|sanction)\/([^/]+)\/reverse$/.exec(path);
  if (badgeAppeal) {
    if (!ctx.owner) throw fail('只有作者能撤销已确认违规记录。', 403);
    const reason = ctx.clean(body.reason, [2, 200], '申诉复核依据', false);
    ctx.throttle('action');
    const kind = badgeAppeal[1] as 'penalty' | 'sanction';
    const result = await ctx.auditMutation('badge-violation-reversed', () => live.members.reverseBadgeViolation(kind, badgeAppeal[2], reason, ctx.me),
      { kind, source: badgeAppeal[2], reason });
    ctx.send(result);
    return true;
  }
  if (path === 'manage/convention') {
    if (!ctx.owner) throw fail('只有作者能修改社区公约。', 403);
    if (Object.keys(body).some(key => key !== 'body' && key !== 'version')) throw fail('社区公约请求格式无效。');
    ctx.throttle('action');
    const convention = await ctx.auditMutation('convention', () => live.convention.replace(ctx.me, body.version, body.body), saved => ({ version: saved.version }));
    ctx.send(convention);
    return true;
  }
  if (path === 'manage/banners') {
    const scope = typeof body.scope === 'string' ? body.scope : '';
    ctx.throttle('action');
    const config = await ctx.auditMutation('banners', () => live.banners.replace(scope, body.version, body.items,
      { actor: ctx.me, browsingAsReader: ctx.browsingAsReader, canSeeBoard: ctx.canSeeBoard }),
    saved => ({ scope, version: saved.version, topics: saved.items.map(item => item.topicId) }));
    ctx.send(config);
    return true;
  }
  if (path === 'manage/review') { await reviewTopics(ctx, body); return true; }
  const report = /^manage\/reports\/([^/]+)$/.exec(path);
  if (report) {
    const pending = live.openReports().find(item => item.id === report[1]);
    if (!pending) throw fail('这条举报已经处理过了。', 404);
    const reply = pending.target.kind === 'reply' ? live.reply(pending.target.id) : null;
    const topic = pending.target.kind === 'reply' && !reply ? null : live.topic(reply ? reply.topicId : pending.target.id);
    if (!ctx.owner && (!topic || !ctx.canModerateBoard(topic.board))) throw fail('你没有这条举报所属板块的管理权限。', 403);
    const reason = body.uphold === true ? ctx.clean(body.reason, [2, 200], '删除理由', false) : '';
    const result = await ctx.auditMutation(body.uphold === true ? 'report-upheld' : 'report-dismissed',
      () => live.resolveReport(report[1], body.uphold === true, new Date().toISOString(), reason),
      { report: report[1], ...(reason ? { reason } : {}) });
    ctx.send(result);
    return true;
  }
  const lift = /^manage\/sanctions\/([^/]+)\/lift$/.exec(path);
  if (lift) {
    await ctx.auditMutation('lift', () => {
      const member = live.members.lift(lift[1]);
      if (!member) throw fail('这条禁言已经结束了。', 409);
      return member;
    }, member => ({ sanction: lift[1], member: memberKey(member) }));
    ctx.send({ ok: true });
    return true;
  }
  const reject = /^manage\/topics\/([^/]+)\/reject$/.exec(path);
  if (reject) {
    if (!ctx.mod) throw fail('只有站长和协管能审核帖子。', 403);
    const topic = live.topic(reject[1]);
    if (!topic) throw fail('这个帖子已被处理。', 404);
    if (!ctx.canModerateBoard(topic.board)) throw fail('你没有这个板块的管理权限。', 403);
    const reason = String(body.reason || '');
    if (!(communityReviewReasons as readonly string[]).includes(reason)) throw fail('请选择审核不通过的理由。');
    const note = typeof body.note === 'string' && body.note.trim() ? ctx.clean(body.note, [1, 200], '补充说明', false) : '';
    const result = await ctx.auditMutation('reject-topic', () => live.rejectTopic(reject[1], reason, note), { topic: reject[1], reason, note });
    ctx.send({ ok: true, ...result });
    return true;
  }
  if (!ctx.owner) throw fail('只有站长能管理兑换所。', 403);
  if (path === 'manage/categories') {
    const name = ctx.clean(body.name, [2, 20], '类别名称', false);
    if (communityShopCats.some(category => category.name === name)) throw fail('这个名称是兑换所的内置类别，请换一个名称。');
    const category = await ctx.auditMutation('category-create', () => live.economy.saveCategory(name), saved => ({ category: saved.id, name }));
    ctx.send(category, 201);
    return true;
  }
  const order = /^manage\/orders\/([^/]+)\/(ship|cancel)$/.exec(path);
  if (order) {
    let tracking = null;
    if (order[2] === 'ship') {
      const company = typeof body.company === 'string' ? body.company.trim() : '';
      const number = typeof body.tracking === 'string' ? body.tracking.trim() : '';
      if (company.length > 40 || number.length > 80 || /[\u0000-\u001f<>]/.test(company + number)) throw fail('快递信息格式无效。');
      tracking = company || number ? { company, number } : null;
    }
    await ctx.auditMutation(`order-${order[2]}`, () => {
      const result = order[2] === 'ship' ? live.economy.ship(order[1], Date.now(), tracking) : live.economy.cancel(order[1]);
      live.members.notify(result.member, { type: 'system', text: order[2] === 'ship' ? '你兑换的物品已经发货' : '你兑换的物品已取消，星尘已退回', data: { order: order[2] === 'ship' ? 'shipped' : 'cancelled', item: result.itemName, amount: result.price, ...(result.tracking?.number ? { tracking: result.tracking.number, company: result.tracking.company } : {}) } });
      return result;
    }, result => ({ order: order[1], item: result.item }));
    ctx.send({ ok: true });
    return true;
  }
  const item = /^manage\/items(?:\/([^/]+))?$/.exec(path);
  if (item) {
    const id = await ctx.auditMutation(item[1] ? 'item-update' : 'item-create',
      () => live.economy.saveItem(item[1] || null, itemInput(ctx, body, item[1])), saved => ({ item: saved }));
    ctx.send({ id }, item[1] ? 200 : 201);
    return true;
  }
  return false;
}
