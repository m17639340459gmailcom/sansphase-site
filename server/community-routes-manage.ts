import { communityReviewReasons, communityShopCats, communityNameEffect } from '../src/community-rules.mjs';
import { fail, memberKey } from './community-db.ts';
import type { CommunityAuthor } from './community-db.ts';
import type { Body, Ctx } from './community-context.ts';
import type { CustomItemInput } from './community-economy.ts';
import type { StoredTopic } from './community-store.ts';
import { saveCommunityImage } from './community-images.ts';
import { reviewTopics } from './community-review.ts';
import { communityBadgeFamilies, communityBadgeTiers } from '../src/community-badge-policy.ts';
import type { BadgeFamilyId, BadgeTier } from '../src/community-badge-policy.ts';
import type { BadgeReview, BadgeSource } from './community-badges.ts';
import { communityProfileReviews } from './community-routes-profile.ts';

const tabs = ['queue', 'reports', 'content', 'orders', 'items', 'stewards', 'sanctions', 'data', 'banners', 'contact', 'convention', 'profiles', 'features', 'boards'] as const;
// Commerce and the convention stay owner-only; staff tools use individual grants.
const ownerTabs = new Set(['orders', 'items', 'convention', 'boards']);
const canTab=(ctx:Ctx,tab:string)=>ctx.owner || !ownerTabs.has(tab) && (tab==='contact' || (tab==='stewards'?ctx.canStaff('staff.appoint'):tab==='sanctions'?ctx.canStaff('member.mute')||ctx.canStaff('member.unmute'):tab==='profiles'?ctx.staff?.permissions.some(cap=>cap.startsWith('profile.')):ctx.moderationBoards.some(board=>ctx.canStaff(tab==='reports'?'report.review':tab==='banners'?'banner.manage':tab==='features'?'feature.decide':'content.inspect',board)) && (tab!=='features'||ctx.staff?.role!=='assistant')));
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
  const kind = cat === 'look' && (body.kind === 'frame' || body.kind === 'color' || body.kind === 'cover') ? body.kind : undefined;
  if (cat === 'look' && !kind) throw fail('请选择头像框、昵称特效或主页背景。');
  const previous = id ? ctx.live.economy.item(id) : null;
  if (kind === 'frame') {
    const assetId = image === undefined ? previous?.image : image;
    const upload = assetId ? ctx.live.image(assetId) : null;
    if (!upload || upload.deleted_at || upload.purpose !== 'shop' || !upload.frame_ready)
      throw fail('头像框需要上传正方形透明图片，并为中间的头像留出透明区域。');
  }
  if (kind === 'cover') {
    const assetId = image === undefined ? previous?.image : image;
    const upload = assetId ? ctx.live.image(assetId) : null;
    if (!upload || upload.deleted_at || upload.purpose !== 'shop' || upload.uploader_kind !== ctx.me.kind || upload.uploader_id !== ctx.me.id || upload.topic_id)
      throw fail('主页背景需要使用作者上传的商品图片，请重新上传。');
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
  if (!ctx.mod) throw fail('当前身份没有社区管理权限。', 403);
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
    if (ownerTabs.has(tab) && !ctx.owner) throw fail(tab === 'boards' ? '只有作者能管理社区板块。' : tab === 'convention' ? '只有作者能修改社区公约。' : '只有站长能管理兑换所。', 403);
    if(!canTab(ctx,tab))throw fail('没有这个管理通道的权限。',403);
    if (tab === 'boards') {
      // Catalog editing has no dependency on people, review queues or commerce data.
      ctx.send({ tab, owner: ctx.owner, moderationBoards: ctx.moderationBoards, actorStaff: ctx.staff,
        allowedTabs: tabs.filter(item => canTab(ctx, item)), boardCatalog: live.boards.catalog() });
      return true;
    }
    const moderationBoards = ctx.moderationBoards;
    const staffSnapshot=JSON.stringify(ctx.staff);
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
    }).filter(({ topic }) => ctx.owner || Boolean(topic && ctx.canStaff('report.review',topic.board)));
    const reports = reportTargets.map(({ report }) => report);
    const orders = ctx.owner ? live.economy.goodsOrders() : [];
    const sanctions = ctx.canStaff('member.mute')||ctx.canStaff('member.unmute') ? live.members.sanctions() : [];
    const stewards = tab === 'stewards' ? live.members.stewards().filter(member=>ctx.owner||live.staff.ancestor(ctx.me,member)) : [];
    const features=tab==='features'?live.featureRecommendations.pending(ctx.me):[];
    const content = tab === 'content' ? (ctx.owner
      ? live.listTopics({ sort: 'newest', page: 1, pageSize: 100 }).items
      : ctx.moderationBoards.flatMap(board => live.listTopics({ board, sort: 'newest', page: 1, pageSize: 100 }).items)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)) : [];
    const people: CommunityAuthor[] = [
      ...queue.topics.map(topic => topic.author), ...queue.replies.map(reply => reply.author),
      ...reports.map(report => report.reporter), ...orders.map(order => order.member), ...sanctions.map(sanction => sanction.member), ...content.map(topic => topic.author), ...stewards,
      ...features.flatMap(row=>[row.by,...live.staff.ancestors(row.by)]),...features.flatMap(row=>{const topic=live.topic(row.topicId);return topic?[topic.author]:[];}),
    ];
    for (const { reply, topic } of reportTargets) if (reply) people.push(reply.author); else if (topic) people.push(topic.author);
    const map = await ctx.people(people);
    const stillModeratesTopic = (id: string) => {
      const topic = live.topic(id);
      return Boolean(topic && ctx.canModerateBoard(topic.board));
    };
    const stillModeratesReply = (id: string) => {
      const reply = live.reply(id);
      return Boolean(reply && stillModeratesTopic(reply.topicId));
    };
    const assertReadable = () => {
      const currentBoards = ctx.moderationBoards;
      if (!ctx.mod || !canTab(ctx,tab) || JSON.stringify(ctx.staff)!==staffSnapshot || currentBoards.length !== moderationBoards.length || currentBoards.some(board => !moderationBoards.includes(board)))
        throw fail('管理权限发生变化，请重新打开管理页面。', 403);
      if (!ctx.owner && (queue.topics.some(topic => !stillModeratesTopic(topic.id))
        || queue.replies.some(reply => !stillModeratesReply(reply.id))
        || content.some(topic => !stillModeratesTopic(topic.id))
        || reports.some(report => {const reply=report.target.kind==='reply'?live.reply(report.target.id):null;const topic=live.topic(reply?reply.topicId:report.target.id);return !topic||!ctx.canStaff('report.review',topic.board);})))
        throw fail('内容所属板块发生变化，请重新打开管理页面。', 403);
    };
    assertReadable();
    const activity = live.activity(Date.now(), ctx.owner ? undefined : ctx.moderationBoards);
    const profileReviews = tab === 'profiles' ? await communityProfileReviews(ctx) : undefined;
    assertReadable();
    const protectedTarget = (author:CommunityAuthor) => { try { live.staff.protect(ctx.me,author);return true; } catch { return false; } };
    const topicProof = (topic:StoredTopic) => ({
      canApprove:topic.pending && ctx.canStaff('topic.approve',topic.board),
      canDelete:ctx.canStaff(topic.pending?'topic.reject':'topic.delete',topic.board) && protectedTarget(topic.author),
      canRestore:ctx.canStaff('topic.restore',topic.board),
      canPenalty:ctx.canStaff('topic.penalty',topic.board) && protectedTarget(topic.author),
      canMute:ctx.canStaff('member.mute') && protectedTarget(topic.author),
    });
    ctx.send({
      tab, owner: ctx.owner, moderationBoards: ctx.moderationBoards, actorStaff:ctx.staff, allowedTabs:tabs.filter(tab=>canTab(ctx,tab)&&(!ownerTabs.has(tab)||ctx.owner)),
      boardCatalog: live.boards.catalog(),
      ...(profileReviews || {}),
      ...(tab === 'stewards' ? { stewards: stewards.map(member => ({...ctx.person(member, map),staff:live.staff.state(member),canAppoint:live.staff.canAppoint(ctx.me,member)})) } : {}),
      ...(tab === 'features'?{features:features.filter(row=>[row.by,...live.staff.ancestors(row.by)].filter(member=>member.kind==='reader').every(member=>map.get(memberKey(member))?.active===true)&&live.featureRecommendations.pending(ctx.me).some(current=>current.id===row.id)).flatMap(row=>{const topic=live.topic(row.topicId);return topic?[{id:row.id,topic:ctx.topicDTO({...topic,replies:topic.replyCount},map),by:ctx.person(row.by,map),reason:row.reason,createdAt:row.createdAt}]:[];})}:{}),
      ...(tab === 'banners' ? { banners: live.banners.managed({ actor: ctx.me, browsingAsReader: ctx.browsingAsReader, canSeeBoard: ctx.canSeeBoard }) } : {}),
      ...(tab === 'convention' ? { convention: live.convention.current() } : {}),
      content: content.map(topic => ({...ctx.topicDTO(topic, map),...topicProof(topic)})),
      counts: { queue: queue.topics.length + queue.replies.length, reports: reports.length, orders: orders.filter(order => order.status === 'pending').length, sanctions: sanctions.filter(sanction => sanction.active).length },
      kpis: { topics24h: activity.topics24h, replies24h: activity.replies24h },
      queue: {
        topics: queue.topics.map(topic => ({ ...ctx.topicDTO(topic, map),...topicProof(topic), body: [...topic.body].slice(0, 200).join(''), pendingReason: topic.pendingReason, hiddenReason: topic.hiddenReason })),
        replies: queue.replies.map(reply => {const board=live.topic(reply.topicId)?.board;return { ...reply, board:board ?? null,
          canDelete:ctx.canStaff('reply.delete',board)&&protectedTarget(reply.author),canRestore:ctx.canStaff('reply.restore',board),
          canPenalty:ctx.canStaff('reply.penalty',board)&&protectedTarget(reply.author),canMute:ctx.canStaff('member.mute')&&protectedTarget(reply.author),
          author: ctx.person(reply.author, map), body: [...reply.body].slice(0, 200).join('') };}),
      },
      reports: reportTargets.map(({ report, reply, topic }) => ({
        id: report.id, reason: report.reason, note: report.note, createdAt: report.createdAt, reporter: ctx.person(report.reporter, map),
        canUphold:Boolean(topic&&ctx.canStaff('report.review',topic.board)&&ctx.canStaff(report.target.kind==='topic'?'topic.delete':'reply.delete',topic.board)&&protectedTarget(reply?reply.author:topic.author)),
        canDismiss:ctx.owner||Boolean(topic&&ctx.canStaff('report.review',topic.board)&&(!(reply?reply.hidden:topic.hidden)||ctx.canStaff(report.target.kind==='topic'?'topic.restore':'reply.restore',topic.board))),
        canPenalty:Boolean(topic&&ctx.canStaff(report.target.kind==='topic'?'topic.penalty':'reply.penalty',topic.board)&&protectedTarget(reply?reply.author:topic.author)),
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
      data: tab === 'data' ? { flow: ctx.owner ? live.ledger.flow(7) : [], boards: live.boards.list().filter(board => ctx.canModerateBoard(board.id)).map(board => ({ id: board.id, topics: activity.boards[board.id] || 0 })) } : null,
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
  if (!ctx.mod) throw fail('当前身份没有社区管理权限。', 403);
  if (path === 'manage/boards' || path === 'manage/boards/order') {
    if (!ctx.owner) throw fail('只有作者能创建和排列社区板块。', 403);
    const ordering = path.endsWith('/order');
    const keys = ordering ? ['ids', 'version'] : ['name', 'description', 'icon', 'id'];
    if (Object.keys(body).some(key => !keys.includes(key))) throw fail('板块请求格式无效。');
    ctx.throttle('action');
    const saved = await ctx.auditMutation(ordering ? 'board-order' : 'board-create', () => {
      if (!ctx.owner || ctx.browsingAsReader) throw fail('请先返回作者管理身份。', 403);
      return ordering ? live.boards.reorder(body.ids, ctx.me, body.version) : live.boards.create(body, ctx.me);
    }, result => ({ version: result.version, ids: result.items.map(board => board.id) }));
    ctx.send(saved, ordering ? 200 : 201);
    return true;
  }
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
    live.banners.authorize(scope,{actor:ctx.me,browsingAsReader:ctx.browsingAsReader,canSeeBoard:ctx.canSeeBoard});
    ctx.throttle('action');
    const config = await ctx.auditMutation('banners', () => {
      if(scope !== 'home')ctx.requireStaff('banner.manage',scope);
      else if(!ctx.owner)throw fail('只有站长能管理首页横幅。',403);
      return live.banners.replace(scope, body.version, body.items,
      { actor: ctx.me, browsingAsReader: ctx.browsingAsReader, canSeeBoard: ctx.canSeeBoard });},
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
    if (!ctx.owner && (!topic || !ctx.canStaff('report.review',topic.board))) throw fail('你没有这条举报所属板块的管理权限。', 403);
    const reason = body.uphold === true ? ctx.clean(body.reason, [2, 200], '删除理由', false) : '';
    const penalty=body.uphold===true&&(body.penalty===true||body.penalty===undefined&&Boolean(topic&&ctx.canStaff(pending.target.kind==='topic'?'topic.penalty':'reply.penalty',topic.board)));
    const result = await ctx.auditMutation(body.uphold === true ? 'report-upheld' : 'report-dismissed',
      () => {const current=live.openReports().find(row=>row.id===report[1]);if(!current)throw fail('这条举报已经处理。',404);const r=current.target.kind==='reply'?live.reply(current.target.id):null;const t=live.topic(r?r.topicId:current.target.id);if(!t){if(!ctx.owner)throw fail('原内容已不存在。',403);}else{ctx.requireStaff('report.review',t.board);if(body.uphold===true){ctx.requireStaff(current.target.kind==='topic'?'topic.delete':'reply.delete',t.board);live.staff.protect(ctx.me,r?r.author:t.author);if(penalty)ctx.requireStaff(current.target.kind==='topic'?'topic.penalty':'reply.penalty',t.board);}else if(r?r.hidden:t.hidden)ctx.requireStaff(current.target.kind==='topic'?'topic.restore':'reply.restore',t.board);}return live.resolveReport(report[1], body.uphold === true, new Date().toISOString(), reason,penalty);},
      { report: report[1], penalty, ...(reason ? { reason } : {}) });
    ctx.send(result);
    return true;
  }
  const lift = /^manage\/sanctions\/([^/]+)\/lift$/.exec(path);
  if (lift) {
    await ctx.auditMutation('lift', () => {
      ctx.requireStaff('member.unmute');const member=live.members.sanctionMember(lift[1]);if(!member)throw fail('禁言记录不存在。',404);live.staff.protect(ctx.me,member);
      const lifted = live.members.lift(lift[1]);
      if (!lifted) throw fail('这条禁言已经结束了。', 409);
      return lifted;
    }, member => ({ sanction: lift[1], member: memberKey(member) }));
    ctx.send({ ok: true });
    return true;
  }
  const reject = /^manage\/topics\/([^/]+)\/reject$/.exec(path);
  if (reject) {
    if (!ctx.mod) throw fail('当前身份没有帖子审核权限。', 403);
    const topic = live.topic(reject[1]);
    if (!topic) throw fail('这个帖子已被处理。', 404);
    ctx.requireStaff('topic.reject',topic.board);
    const reason = String(body.reason || '');
    if (!(communityReviewReasons as readonly string[]).includes(reason)) throw fail('请选择审核不通过的理由。');
    const note = typeof body.note === 'string' && body.note.trim() ? ctx.clean(body.note, [1, 200], '补充说明', false) : '';
    const result = await ctx.auditMutation('reject-topic', () => {const current=live.topic(reject[1]);ctx.requireStaff('topic.reject',current?.board);if(current)live.staff.protect(ctx.me,current.author);return live.rejectTopic(reject[1], reason, note);}, { topic: reject[1], reason, note });
    ctx.send({ ok: true, ...result });
    return true;
  }
  const recommendation=/^manage\/feature-recommendations\/([^/]+)\/(approve|reject)$/.exec(path);
  if(recommendation){
    const approve=recommendation[2]==='approve',reason=approve&&body.reason===undefined?'':ctx.clean(body.reason,[approve?0:2,200],'精选审批理由',false);
    const proposed=live.featureRecommendations.get(recommendation[1]);if(!proposed)throw fail('精选推荐不存在。',404);
    const ancestors=live.staff.ancestors(proposed.by),chain=JSON.stringify(ancestors);
    // Keep these persisted actors in every subsequent authorization refresh for
    // this one request, including the final audit transaction's check.
    await ctx.refreshStaff([proposed.by,...ancestors]);
    await ctx.auditMutation('feature-recommendation-'+recommendation[2],()=>{
      const current=live.featureRecommendations.get(recommendation[1]);if(!current)throw fail('精选推荐不存在。',404);
      ctx.requireStaff('feature.decide',current.board);
      if(JSON.stringify(live.staff.ancestors(current.by))!==chain)throw fail('推荐人的管理权限发生变化，请刷新。',403);
      return live.featureRecommendations.decide(ctx.me,recommendation[1],approve,reason,id=>live.setFeatured(id,true,{actor:ctx.me}));
    },{recommendation:recommendation[1],reason});ctx.send({ok:true});return true;
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
