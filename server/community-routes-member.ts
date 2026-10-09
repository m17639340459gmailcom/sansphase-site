import { communityRules, communityShopCats, beijingDay, communityReportReasons, checkinReward } from '../src/community-rules.mjs';
import { experienceCatalogue, vipCatalogue } from './community-experience.ts';
import { fail, same, memberKey } from './community-db.ts';
import type { CommunityAuthor } from './community-db.ts';
import type { Ctx } from './community-context.ts';
import { communityStaffDefaultPermissions } from '../src/community-staff.ts';
import type { CommunityStaffRole, CommunityStaffPermission } from '../src/community-staff.ts';
import { communityIconDefinition } from '../src/community-icon-policy.ts';

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
    if (path === 'convention') { ctx.send(live.convention.current()); return true; }
    if (path === 'me') {
      const map = await ctx.people([me]);
      const streak = economy.currentStreak(me), checked = economy.checked(me);
      const muted = members.muted(me);
      const allQueue = ctx.mod ? live.queue() : { topics: [], replies: [] };
      const queue = { topics: allQueue.topics.filter(topic => ctx.canModerateBoard(topic.board)), replies: allQueue.replies.filter(reply => {
        const board = live.topic(reply.topicId)?.board;
        return Boolean(board && ctx.canModerateBoard(board));
      }) };
      const reports = ctx.mod ? live.openReports().filter(report => {
        if (ctx.owner) return true;
        const reply = report.target.kind === 'reply' ? live.reply(report.target.id) : null;
        const topic = live.topic(reply ? reply.topicId : report.target.id);
        return Boolean(topic && ctx.canStaff('report.review',topic.board));
      }).length : 0;
      const orders = ctx.owner ? economy.goodsOrders().filter(order => order.status === 'pending').length : 0;
      ctx.send({
        ...ctx.person(me, map), vip: me.kind === 'reader' && !ctx.browsingAsReader ? map.get(memberKey(me))?.vip === true : viewer.vip,
        owner: ctx.owner, mod: ctx.mod, trustLevel: ctx.trustLevel, moderationBoards: ctx.moderationBoards, balance: ledger.balance(me),
        staff: ctx.staff,
        management: ctx.actualMod ? { role: ctx.actualOwner ? 'owner' : live.staff.state(me)?.role ?? null, staff: live.staff.state(ctx.actualOwner ? ctx.ownerMember : me), browsingAsReader: ctx.browsingAsReader,
          ...(ctx.actualOwner && ctx.browsingAsReader && !ctx.readOnly ? { interactive: true } : {}) } : null,
        moderationContact: members.moderationContact(me),
        convention: live.convention.state(me),
        checkedIn: checked, streak, nextReward: economy.nextCheckinReward(me, Date.now(), map.get(memberKey(me))?.vip === true),
        gainedToday: ledger.gainedToday(me), behaviourToday: ledger.behaviourToday(me), dailyCap: r.dailyCap,
        unread: members.unread(me), agreed: members.agreed(me), inventory: economy.inventory(me),
        muted: muted ? { until: muted.until, reason: muted.reason } : null,
        manageTodo: ctx.mod ? queue.topics.length + queue.replies.length + reports + orders : 0,
        badgeState: ctx.appearancePreview(me, map)?.badgeState ?? members.badgeState(me, { joinedAt: map.get(memberKey(me))?.joinedAt }),
        iconState: ctx.iconState(me, map),
      });
      return true;
    }
    if (path === 'checkin') {
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month')! : beijingDay(Date.now()).slice(0, 7);
      const early = economy.earlyBirds();
      const map = await ctx.people([me, ...early.map(bird => bird.member)]);
      const streak = economy.currentStreak(me);
      const checkedIn = economy.checked(me);
      ctx.send({
        checkedIn, streak, dailyReward: checkinReward(false, map.get(memberKey(me))?.vip === true).base, balance: ledger.balance(me), gainedToday: ledger.gainedToday(me), behaviourToday: ledger.behaviourToday(me), vip: viewer.vip, owner: ctx.owner, browsingAsReader: ctx.browsingAsReader, readOnly: ctx.readOnly, uid: ctx.person(me, map).uid,
        month, days: economy.checkinDays(me, `${month}-01`, `${month}-31`), monthBonus: economy.monthBonus(me, month), checkinsToday: economy.checkinsToday(),
        earlyBirds: early.map(bird => ({ person: ctx.person(bird.member, map), at: bird.at })),
        makeup: economy.makeupState(me, { vip: map.get(memberKey(me))?.vip === true }), badges: members.badges(me), badgeState: ctx.appearancePreview(me, map)?.badgeState ?? members.badgeState(me, { joinedAt: map.get(memberKey(me))?.joinedAt }),
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
      const detail = (ref: { kind: string; id: string } | null) => ref?.kind === 'item' ? economy.item(ref.id)?.name ?? null : ref?.kind === 'day' || ref?.kind === 'month' ? ref.id : null;
      const map = await ctx.people([me]), profile = map.get(memberKey(me)), appearance = ctx.appearancePreview(me, map);
      const level = appearance?.trustLevel ?? ctx.level;
      ctx.send({
        balance: ledger.balance(me), gainedToday: ledger.gainedToday(me), behaviourToday: ledger.behaviourToday(me), dailyCap: r.dailyCap,
        checkedIn: economy.checked(me), month: ledger.month(me), flow,
        ledger: rows.map(({ ref, ...row }) => ({ ...row, topic: titles.get(row.id) || null, detail: detail(ref) })),
        level, owner: ctx.owner, vip: ctx.ownerReaderPreview !== null || me.kind === 'reader' && profile?.vip === true, browsingAsReader: ctx.browsingAsReader, readOnly: ctx.readOnly, steward: members.steward(me), staffRole: ctx.staff?.role ?? null, stats: members.stats(me),
        growth: appearance?.growth ?? live.experience.state(me), vipGrowth: appearance?.vipGrowth ?? live.experience.vipState(me, profile?.vip === true), experienceCatalogue, vipCatalogue,
        progress: ctx.owner || level >= 3 ? null : members.levelProgress(me, level),
      });
      return true;
    }
    if (path === 'shop') {
      const joined = await joinedAt(ctx, me);
      const items = economy.items().filter(item => item.active).map(item => ({
        ...item, delivery: undefined, state: economy.redeemState(me, item, { level: ctx.level, owner: ctx.owner, joinedAt: joined }),
      }));
      ctx.send({ balance: ledger.balance(me), level: ctx.level, owner: ctx.owner, cats: communityShopCats, categories: economy.categories(), items, inventory: economy.inventory(me), decorations: members.decorations(me) });
      return true;
    }
    if (path === 'shop/mine') {
      const owned = economy.owned(me);
      const items = economy.items();
      ctx.send({
        balance: ledger.balance(me), inventory: economy.inventory(me), decorations: members.decorations(me),
        looks: items.filter(item => item.cat === 'look' && owned.has(item.id)).map(item => ({ ...item, delivery: undefined })),
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
      const contentTab = tab === 'topics' || tab === 'replies' || tab === 'bookmarks';
      const topics = contentTab ? live.listTopics({ author: member, sort: 'newest', page: 1, pageSize: 100 }).items.filter(topic => ctx.canSeeBoard(topic.board)) : [];
      const replies = contentTab ? live.memberReplies(member).filter(reply => ctx.canSeeBoard(reply.board)) : [];
      const bookmarks = contentTab && self ? live.topics(live.bookmarks(me)).filter(topic => ctx.canSeeBoard(topic.board)) : [];
      const topicDTOs = tab === 'topics' ? await ctx.topicsDTO(topics) : [];
      const bookmarkDTOs = tab === 'bookmarks' && self ? await ctx.topicsDTO(bookmarks) : [];
      // Resolve the final profile after list rendering yields; its icon must not retain an old appointment.
      const map = await ctx.people([member]);
      const info = map.get(memberKey(member));
      if (!info) throw fail('找不到这个成员。', 404);
      const person = ctx.person(member, map);
      const stats = live.authorStats(member);
      const muted = members.muted(member);
      const counts = contentTab ? { topics: topics.length, replies: replies.length, bookmarks: bookmarks.length }
        : live.memberContentCounts(member, { bookmarks: self, visibleBoards: live.boards.ids().filter(board => ctx.canSeeBoard(board)) });
      ctx.send({
        person, bio: info.bio, joinedAt: member.kind === 'owner' ? null : info.joinedAt || members.joinedAt(member),
        ...economy.coverDecoration(member), background: live.profileBackgrounds.state(member).approved,
        streak: economy.currentStreak(member), stats: { ...stats, topics: counts.topics, replies: counts.replies },
        follows: members.followCounts(member), following: !self && members.following(me, member), self, badges: members.badges(member),
        badgeState: ctx.appearancePreview(member, map)?.badgeState ?? members.badgeState(member, { joinedAt: info.joinedAt }),
        ...(self ? { iconState: ctx.iconState(member, map) } : {}),
        muted: (self || ctx.mod) && muted ? { id: muted.id, until: muted.until, reason: muted.reason } : null,
        canMute: ctx.canStaff('member.mute') && !self && member.kind === 'reader' && (()=>{try{live.staff.protect(me,member);return true;}catch{return false;}})(), canAppoint: ctx.canStaff('staff.appoint') && live.staff.canAppoint(me, member), steward: members.steward(member),
        staff: self ? ctx.staff : ctx.canStaff('staff.appoint') && live.staff.canAppoint(me, member) ? live.staff.state(member) : null,
        reasons: ctx.mod ? communityReportReasons : undefined,
        tab, topics: topicDTOs.map(topic => ({ ...topic, author: person })), replies: tab === 'replies' ? replies : [],
        bookmarks: bookmarkDTOs, counts,
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
  if (path === 'browse-mode') {
    if (!ctx.actualMod) throw fail('只有作者和版主可以切换浏览视角。', 403);
    if (typeof body.reader !== 'boolean') throw fail('请选择浏览视角。');
    if (ctx.actualOwner && body.reader && !await ctx.options.ownerReaderIdentity?.(ctx.req)) throw fail('站长的个人读者身份尚未配置或已停用。', 503);
    const secure = ctx.options.siteOrigin.startsWith('https:') ? '; Secure' : '';
    ctx.res.setHeader('Set-Cookie', `community_browse=${body.reader ? 'reader' : ''}; Path=/; HttpOnly; SameSite=Strict${secure}${body.reader ? '' : '; Max-Age=0'}`);
    ctx.send({ ok: true, browsingAsReader: body.reader });
    return true;
  }
  switch (path) {
    case 'active/visit': {
      if (Object.keys(body).length) throw fail('请从本站主动进入社区，经验由服务器结算。');
      const map = await ctx.people([me]);
      // Reading an asynchronous request body may outlive the original session
      // or membership. Reuse the actual account service immediately before write.
      let current = await ctx.options.identify(ctx.req);
      if (viewer.ownerAccountId) {
        if (!current || current.kind !== 'owner' || current.id !== viewer.ownerAccountId) throw fail('请重新登录后进入社区。', 401);
        current = await ctx.options.ownerReaderIdentity?.(ctx.req) ?? null;
      }
      if (!current || current.kind !== me.kind || current.id !== me.id) throw fail('请重新登录后进入社区。', 401);
      ctx.throttle('action');
      const visit = live.experience.visit(me, { vip: current.vip }), appearance = ctx.appearancePreview(me, map);
      ctx.send({ uid: map.get(memberKey(me))?.uid ?? null, ...visit,
        growth: appearance?.growth ?? visit.growth, vipGrowth: appearance?.vipGrowth ?? visit.vipGrowth });
      return true;
    }
    case 'convention/read':
    case 'agree': {
      if (Object.keys(body).some(key => key !== 'version')) throw fail('请使用当前账号阅读并确认社区公约。');
      ctx.throttle('action');
      ctx.send(path === 'agree' ? live.convention.agree(me, body.version) : live.convention.read(me, body.version));
      return true;
    }
    case 'me/contact': {
      if (!ctx.staff) throw fail('只有当前管理身份能设置管理联系方式。', 403);
      ctx.throttle('action');
      const contact = await ctx.auditMutation('contact', () => {if(!ctx.staff)throw fail('管理权限发生变化，请刷新页面。',403);return members.setModerationContact(me, body);},
        result => ({ qqPublished: Boolean(result.qq), emailPublished: Boolean(result.email) }));
      ctx.send(contact);
      return true;
    }
    case 'checkin': {
      // Full-level owner reader visuals are not account membership. Query the
      // real profile, then recheck the authenticated execution identity at use.
      const profile = (await ctx.people([me])).get(memberKey(me));
      if (!profile || profile.active === false) throw fail('请重新登录后签到。', 401);
      let current = await ctx.options.identify(ctx.req);
      if (viewer.ownerAccountId) {
        if (!current || current.kind !== 'owner' || current.id !== viewer.ownerAccountId) throw fail('请重新登录后签到。', 401);
        current = await ctx.options.ownerReaderIdentity?.(ctx.req) ?? null;
      }
      if (!current || current.kind !== me.kind || current.id !== me.id) throw fail('请重新登录后签到。', 401);
      ctx.throttle('action');
      ctx.send(economy.checkin(me, { vip: current.vip === true }));
      return true;
    }
    case 'checkin/makeup': {
      const profile = (await ctx.people([me])).get(memberKey(me));
      if (!profile || profile.active === false) throw fail('请重新登录后补签。', 401);
      let current = await ctx.options.identify(ctx.req);
      if (viewer.ownerAccountId) {
        if (!current || current.kind !== 'owner' || current.id !== viewer.ownerAccountId) throw fail('请重新登录后补签。', 401);
        current = await ctx.options.ownerReaderIdentity?.(ctx.req) ?? null;
      }
      if (!current || current.kind !== me.kind || current.id !== me.id) throw fail('请重新登录后补签。', 401);
      ctx.throttle('action');
      ctx.send(economy.makeup(me, String(body.day || ''), { vip: current.vip === true }));
      return true;
    }
    case 'inbox/read-all': ctx.send({ read: members.readAll(me) }); return true;
    case 'inbox/read': {
      const notice = members.notice(me, String(body.id || ''));
      if (!notice) throw fail('通知不存在。', 404);
      members.read(me, notice.id);
      ctx.send({ ok: true });
      return true;
    }
    case 'shop/redeem': {
      const joined = await joinedAt(ctx, me);
      const result = live.requests.run(me, path, ctx.req.headers['x-idempotency-key'], body, () => {
        const item = economy.item(String(body.item || ''));
        if (!item) throw fail('没有这个物品。', 404);
        let shipping = null;
        if (item.kind === 'goods') {
          const input = (body.shipping || {}) as Record<string, unknown>;
          const phone = typeof input.phone === 'string' ? input.phone.replace(/[\s-]/g, '') : '';
          if (!/^1[3-9]\d{9}$/.test(phone)) throw fail('请填写正确的手机号，用于快递联系。');
          shipping = { name: shippingText(input.name, '收件人', [1, 30]), phone, address: shippingText(input.address, '收货地址', [5, 200]) };
        }
        const redeemed = live.transaction(() => {
          const result = economy.redeem(me, item.id, { level: ctx.level, owner: ctx.owner, joinedAt: joined, shipping });
          if (item.kind === 'cover' && me.kind === 'reader') live.profileBackgrounds.remove(me);
          return result;
        });
        if (item.kind === 'goods') members.notify(ctx.ownerMember, { type: 'system', actor: me, text: '兑换了实物，等待发货', data: { order: 'new', item: item.name }, link: '#/community/manage/orders' });
        return redeemed;
      }, () => ctx.throttle('action'));
      ctx.send(result, 201);
      return true;
    }
    case 'shop/equip': {
      const kind = String(body.kind || '');
      if (kind === 'icon') {
        if (body.ref !== null && typeof body.ref !== 'string' || Object.keys(body).some(key => !['kind', 'ref'].includes(key))) throw fail('请选择一枚已获得的图标，或恢复默认。');
        const ref = body.ref as string | null;
        if (ref !== null && ref !== '' && !communityIconDefinition(ref)) throw fail('图标不存在。');
        const map = await ctx.people([me]);
        const info = map.get(memberKey(me));
        if (!info || info.active === false) throw fail('请重新登录后选择图标。', 401);
        // Verify the execution identity after asynchronous account/profile resolution.
        let current = await ctx.options.identify(ctx.req);
        if (viewer.ownerAccountId) {
          if (!current || current.kind !== 'owner' || current.id !== viewer.ownerAccountId) throw fail('请重新登录后选择图标。', 401);
          current = await ctx.options.ownerReaderIdentity?.(ctx.req) ?? null;
        }
        if (!current || !same(current, me)) throw fail('请重新登录后选择图标。', 401);
        // The latest authentication supplies current membership, not the earlier profile batch.
        map.set(memberKey(me), { ...info, vip: current.vip });
        // The final identity lookup also yields; verify active appointment ancestors afterward.
        await ctx.refreshStaff();
        ctx.throttle('action');
        ctx.send(live.transaction(() => {
          // Read live growth, role and honors immediately before persisting the choice.
          const state = ctx.iconState(me, map);
          if (ref && !state.available.includes(ref as typeof state.available[number])) throw fail('这个图标当前不能佩戴。', 403);
          members.setIcon(me, ref);
          const iconState = ctx.iconState(me, map);
          return { icon: iconState.equipped, iconState };
        }));
        return true;
      }
      if (!['frame', 'color', 'cover'].includes(kind)) throw fail('装扮类型无效。');
      if (kind === 'cover' && body.ref !== null && typeof body.ref !== 'string') throw fail('请选择已拥有的主页背景，或恢复默认背景。');
      const ref = typeof body.ref === 'string' && body.ref ? body.ref : null;
      ctx.send(live.transaction(() => {
        const result = economy.equip(me, kind as 'frame' | 'color' | 'cover', ref);
        if (kind === 'cover' && me.kind === 'reader') live.profileBackgrounds.remove(me);
        return result;
      }));
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
      ctx.requireStaff('member.mute'); live.staff.protect(me,member);
      const days = Number(body.days);
      if (![1, 7, 30].includes(days)) throw fail('请选择禁言天数。');
      const reason = String(body.reason || '');
      if (!(communityReportReasons as readonly string[]).includes(reason)) throw fail('请选择禁言原因。');
      const result = await ctx.auditMutation('mute', () => {ctx.requireStaff('member.mute');live.staff.protect(me,member);return members.mute(member, days, reason, me);}, { member: memberKey(member), days, reason });
      ctx.send(result);
      return true;
    }
    ctx.requireStaff('staff.appoint');
    if (typeof body.on !== 'boolean') throw fail('请选择任命或撤销版主。');
    const on = body.on;
    const boards = body.boards;
    const knownBoards = live.boards.ids();
    if (on && (!Array.isArray(boards) || boards.length === 0 || boards.some(board => typeof board !== 'string' || !knownBoards.includes(board)) || new Set(boards).size !== boards.length))
      throw fail('请至少选择一个有效的管理板块。');
    const current=live.staff.state(member);
    const legacyCompatibility=on && body.role===undefined && ctx.owner && live.staff.stored(member)?.legacy_origin===1 && current?.role==='moderator';
    if(on && !legacyCompatibility && (body.role===undefined || body.permissions===undefined || body.delegable===undefined))throw fail('任命需要明确职务、权限及可向下授予的权限，请刷新管理页面。');
    const role=(body.role ?? current?.role) as Exclude<CommunityStaffRole,'owner'>;
    if(on&&!['general','moderator','assistant'].includes(role))throw fail('请选择下一级职务。');
    const permissions=(body.permissions ?? current?.permissions ?? communityStaffDefaultPermissions[role]) as CommunityStaffPermission[];
    const delegable=(body.delegable ?? current?.delegable ?? []) as CommunityStaffPermission[];
    if(on)await ctx.refreshStaff([member]);
    const result=await ctx.auditMutation('staff-appointment', () => {
      ctx.requireStaff('staff.appoint');
      const result=on?{staff:(()=>{members.ensure(member);return live.staff.appoint(me,member,{role,boards:boards as string[],permissions,delegable});})(),revoked:[]}: {staff:null,revoked:live.staff.revoke(me,member)};
      members.notify(member,{type:'system',actor:me,text:on?'你的管理职务及权限已更新':'你的管理职务已撤销',data:{role:on?role:null,steward:on,boards:result.staff?.boards??[]}});
      return result;
    }, result => ({ member: memberKey(member), on, role, boards: result.staff?.boards??[], permissions:on?permissions:[],delegable:on?delegable:[],revoked:result.revoked.map(memberKey) }));
    ctx.send({ steward: on, staff:result.staff });
    return true;
  }
  return false;
}
