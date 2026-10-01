import { communityRules, communityShopCats, checkinReward, beijingDay, communityReportReasons } from '../src/community-rules.mjs';
import { fail, same, memberKey } from './community-db.ts';
import type { CommunityAuthor } from './community-db.ts';
import type { Ctx } from './community-context.ts';

const r = communityRules;
const flag = (value: unknown) => value !== false;
const shippingText = (value: unknown, label: string, [min, max]: [number, number]) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if ([...text].length < min || [...text].length > max || /[\u0000-\u001f<>]/.test(text)) throw fail(`请填写${label}（${min}–${max} 个字）。`);
  return text;
};
// A member reachable by public UID, or 404.
async function memberByUid(ctx: Ctx, uid: string) {
  const member = await ctx.options.findMember?.(uid);
  if (!member) throw fail('找不到这个成员。', 404);
  return member;
}
async function joinedAt(ctx: Ctx, member: CommunityAuthor) {
  if (member.kind === 'owner') return null;
  return (await ctx.people([member])).get(memberKey(member))?.joinedAt || ctx.live.members.joinedAt(member);
}

export async function memberRoutes(ctx: Ctx): Promise<boolean> {
  const { live, me, path, method, url, viewer } = ctx;
  const { members, economy, ledger } = live;
  if (method === 'GET') {
    if (path === 'me') {
      const map = await ctx.people([me]);
      const streak = economy.currentStreak(me), checked = economy.checked(me);
      const muted = members.muted(me);
      const queue = ctx.mod ? live.queue() : { topics: [], replies: [] };
      const reports = ctx.mod ? live.openReports().length : 0;
      const orders = ctx.owner ? economy.goodsOrders().filter(order => order.status === 'pending').length : 0;
      ctx.send({
        ...ctx.person(me, map), owner: ctx.owner, mod: ctx.mod, balance: ledger.balance(me),
        checkedIn: checked, streak, nextReward: checkinReward(streak + 1, viewer.vip),
        gainedToday: ledger.gainedToday(me), behaviourToday: ledger.behaviourToday(me), dailyCap: r.dailyCap,
        unread: members.unread(me), agreed: members.agreed(me), inventory: economy.inventory(me),
        muted: muted ? { until: muted.until, reason: muted.reason } : null,
        manageTodo: ctx.mod ? queue.topics.length + queue.replies.length + reports + orders : 0,
      });
      return true;
    }
    if (path === 'checkin') {
      const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month')! : beijingDay(Date.now()).slice(0, 7);
      const early = economy.earlyBirds();
      const map = await ctx.people([me, ...early.map(bird => bird.member)]);
      const streak = economy.currentStreak(me);
      const checkedIn = economy.checked(me);
      ctx.send({
        checkedIn, streak, balance: ledger.balance(me), gainedToday: ledger.gainedToday(me), behaviourToday: ledger.behaviourToday(me), vip: viewer.vip, owner: ctx.owner, uid: ctx.person(me, map).uid,
        month, days: economy.checkinDays(me, `${month}-01`, `${month}-31`), checkinsToday: economy.checkinsToday(),
        earlyBirds: early.map(bird => ({ person: ctx.person(bird.member, map), at: bird.at })),
        makeup: economy.makeupState(me, { vip: viewer.vip }), badges: members.badges(me),
      });
      return true;
    }
    if (path === 'stardust') {
      const flow = ['in', 'out'].includes(url.searchParams.get('flow') || '') ? url.searchParams.get('flow') as 'in' | 'out' : 'all';
      const rows = ledger.history(me, { flow, limit: 80 });
      const titles = new Map<string, { id: string; title: string }>();
      for (const row of rows) {
        if (!row.ref || (row.ref.kind !== 'topic' && row.ref.kind !== 'reply')) continue;
        const topicId = row.ref.kind === 'reply' ? live.reply(row.ref.id)?.topicId : row.ref.id;
        const topic = topicId ? live.topic(topicId) : null;
        if (topic && ctx.canSeeBoard(topic.board) && !topic.pending && !topic.hidden) titles.set(row.id, { id: topic.id, title: topic.title });
      }
      // What else a row is about: the item redeemed or refunded, or the day made up.
      const detail = (ref: { kind: string; id: string } | null) => ref?.kind === 'item' ? economy.item(ref.id)?.name ?? null : ref?.kind === 'day' ? ref.id : null;
      const level = ctx.level;
      ctx.send({
        balance: ledger.balance(me), gainedToday: ledger.gainedToday(me), behaviourToday: ledger.behaviourToday(me), dailyCap: r.dailyCap,
        checkedIn: economy.checked(me), month: ledger.month(me), flow,
        ledger: rows.map(({ ref, ...row }) => ({ ...row, topic: titles.get(row.id) || null, detail: detail(ref) })),
        level, owner: ctx.owner, steward: members.steward(me), stats: members.stats(me),
        progress: ctx.owner || level >= 3 ? null : members.levelProgress(me, level),
      });
      return true;
    }
    if (path === 'shop') {
      const joined = await joinedAt(ctx, me);
      const items = economy.items().filter(item => item.active).map(item => ({
        ...item, delivery: undefined, state: economy.redeemState(me, item, { level: ctx.level, owner: ctx.owner, joinedAt: joined }),
      }));
      ctx.send({ balance: ledger.balance(me), level: ctx.level, owner: ctx.owner, cats: communityShopCats, items, inventory: economy.inventory(me), decorations: members.decorations(me) });
      return true;
    }
    if (path === 'shop/mine') {
      const owned = economy.owned(me);
      const items = economy.items();
      ctx.send({
        balance: ledger.balance(me), inventory: economy.inventory(me), decorations: members.decorations(me),
        looks: items.filter(item => item.builtin && item.cat === 'look' && owned.has(item.id)).map(item => ({ ...item, delivery: undefined })),
        digital: items.filter(item => item.kind === 'digital' && owned.has(item.id)).map(item => ({ id: item.id, name: item.name, desc: item.desc })),
        orders: economy.orders(me).map(({ member: _member, ...order }) => order),
      });
      return true;
    }
    const delivery = /^shop\/items\/([^/]+)\/delivery$/.exec(path);
    if (delivery) { ctx.send(economy.delivery(me, delivery[1])); return true; }
    if (path === 'rank') {
      const contributions = members.contributions().slice(0, 10);
      const streaks = economy.streakRanking();
      const early = economy.earlyBirds();
      const map = await ctx.people([...contributions.map(item => item.member), ...streaks.map(item => item.member), ...early.map(item => item.member)]);
      ctx.send({
        contributions: contributions.map(item => ({ person: ctx.person(item.member, map), score: item.score, likes: item.likes, accepted: item.accepted, featured: item.featured })),
        streaks: streaks.map(item => ({ person: ctx.person(item.member, map), streak: item.streak })),
        early: early.map(item => ({ person: ctx.person(item.member, map), at: item.at })),
      });
      return true;
    }
    const memberMatch = /^members\/([^/]+)$/.exec(path);
    if (memberMatch) {
      const member = await memberByUid(ctx, memberMatch[1]);
      const self = same(member, me);
      const tab = url.searchParams.get('tab') || 'topics';
      const map = await ctx.people([member]);
      const info = map.get(memberKey(member));
      if (!info) throw fail('找不到这个成员。', 404);
      const topics = live.listTopics({ author: member, sort: 'newest', page: 1, pageSize: 100 }).items.filter(topic => ctx.canSeeBoard(topic.board));
      const replies = live.memberReplies(member).filter(reply => ctx.canSeeBoard(reply.board));
      const bookmarks = self ? live.topics(live.bookmarks(me)).filter(topic => ctx.canSeeBoard(topic.board)) : [];
      const stats = live.authorStats(member);
      const muted = members.muted(member);
      ctx.send({
        person: ctx.person(member, map), bio: info.bio, joinedAt: member.kind === 'owner' ? null : info.joinedAt || members.joinedAt(member),
        cover: members.decorations(member).cover, streak: economy.currentStreak(member), stats: { ...stats, topics: topics.length, replies: replies.length },
        follows: members.followCounts(member), following: !self && members.following(me, member), self, badges: members.badges(member),
        muted: (self || ctx.mod) && muted ? { id: muted.id, until: muted.until, reason: muted.reason } : null,
        canMute: ctx.mod && !self && member.kind === 'reader', canAppoint: ctx.owner && member.kind === 'reader', steward: members.steward(member),
        reasons: ctx.mod ? communityReportReasons : undefined,
        tab, topics: tab === 'topics' ? await ctx.topicsDTO(topics) : [], replies: tab === 'replies' ? replies : [],
        bookmarks: tab === 'bookmarks' && self ? await ctx.topicsDTO(bookmarks) : [], counts: { topics: topics.length, replies: replies.length, bookmarks: bookmarks.length },
        quick: self ? { balance: ledger.balance(me), checkedIn: economy.checked(me), unread: members.unread(me).all, orders: economy.orders(me).length } : null,
      });
      return true;
    }
    if (path === 'inbox') {
      const tab = url.searchParams.get('tab') || 'all';
      const items = members.inbox(me, tab);
      const map = await ctx.people(items.flatMap(item => item.actor ? [item.actor] : []));
      const topics = new Map<string, string>();
      for (const item of items) if (item.topicId && !topics.has(item.topicId)) {
        const topic = live.topic(item.topicId);
        if (topic && ctx.canSeeBoard(topic.board)) topics.set(item.topicId, topic.title);
      }
      ctx.send({
        tab, unread: members.unread(me),
        items: items.map(item => ({ ...item, actor: item.actor ? ctx.person(item.actor, map) : null, topicTitle: item.topicId ? topics.get(item.topicId) || null : null })),
      });
      return true;
    }
    return false;
  }

  const body = await ctx.json();
  switch (path) {
    case 'checkin': ctx.send(economy.checkin(me, { vip: viewer.vip })); return true;
    case 'checkin/makeup': ctx.send(economy.makeup(me, String(body.day || ''), { vip: viewer.vip })); return true;
    case 'agree': members.agree(me); ctx.send({ agreed: true }); return true;
    case 'inbox/read-all': ctx.send({ read: members.readAll(me) }); return true;
    case 'inbox/read': {
      const notice = members.notice(me, String(body.id || ''));
      if (!notice) throw fail('通知不存在。', 404);
      members.read(me, notice.id);
      ctx.send({ ok: true });
      return true;
    }
    case 'shop/redeem': {
      const item = economy.item(String(body.item || ''));
      if (!item) throw fail('没有这个物品。', 404);
      let shipping = null;
      if (item.kind === 'goods') {
        const input = (body.shipping || {}) as Record<string, unknown>;
        const phone = typeof input.phone === 'string' ? input.phone.replace(/[\s-]/g, '') : '';
        if (!/^1[3-9]\d{9}$/.test(phone)) throw fail('请填写正确的手机号，用于快递联系。');
        shipping = { name: shippingText(input.name, '收件人', [1, 30]), phone, address: shippingText(input.address, '收货地址', [5, 200]) };
      }
      const result = economy.redeem(me, item.id, { level: ctx.level, owner: ctx.owner, joinedAt: await joinedAt(ctx, me), shipping });
      if (item.kind === 'goods') members.notify(ctx.ownerMember, { type: 'system', actor: me, text: '兑换了实物，等待发货', data: { order: 'new', item: item.name }, link: '#/community/manage/orders' });
      ctx.send(result, 201);
      return true;
    }
    case 'shop/equip': {
      const kind = String(body.kind || '');
      if (!['frame', 'color', 'cover'].includes(kind)) throw fail('装扮类型无效。');
      ctx.send(economy.equip(me, kind as 'frame' | 'color' | 'cover', typeof body.ref === 'string' && body.ref ? body.ref : null));
      return true;
    }
  }
  const memberAction = /^members\/([^/]+)\/(follow|mute|steward)$/.exec(path);
  if (memberAction) {
    const member = await memberByUid(ctx, memberAction[1]);
    if (same(member, me)) throw fail('不能对自己这样做。');
    if (memberAction[2] === 'follow') { ctx.throttle('action'); ctx.send(members.follow(me, member, flag(body.on))); return true; }
    if (member.kind !== 'reader') throw fail('不能对站长这样做。', 403);
    if (memberAction[2] === 'mute') {
      if (!ctx.mod) throw fail('只有站长和协管能禁言。', 403);
      const days = Number(body.days);
      if (![1, 7, 30].includes(days)) throw fail('请选择禁言天数。');
      const reason = String(body.reason || '');
      if (!(communityReportReasons as readonly string[]).includes(reason)) throw fail('请选择禁言原因。');
      const result = members.mute(member, days, reason, me);
      await ctx.audit('mute', { member: memberKey(member), days, reason });
      ctx.send(result);
      return true;
    }
    if (!ctx.owner) throw fail('只有站长能任命协管。', 403);
    members.setSteward(member, flag(body.on));
    await ctx.audit('steward', { member: memberKey(member), on: flag(body.on) });
    ctx.send({ steward: flag(body.on) });
    return true;
  }
  return false;
}
