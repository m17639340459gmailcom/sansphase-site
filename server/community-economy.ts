import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { communityRules, communityBuiltinItems, communityNameEffect, checkinReward, checkinMonth, beijingDay } from '../src/community-rules.mjs';
import type { NameEffect, ShopCategory, ShopItem } from '../src/community-rules.ts';
import { fail, countOf, day, iso, parseJson } from './community-db.ts';
import type { CommunityAuthor, Transaction } from './community-db.ts';
import type { Ledger } from './community-ledger.ts';
import type { Members } from './community-members.ts';

type Card = 'makeup' | 'pin' | 'highlight';
type CustomItemRow = {
  image: string | null;
  category: string | null; kind: 'frame' | 'color' | null; effect: string | null;
  id: string; cat: 'digital' | 'goods'; name: string; description: string; price: number; stock: number | null; stock_left: number | null;
  limit_per: 'month' | 'year' | 'once' | null; limit_n: number | null; min_level: number; min_days: number; delivery: string; note: string; active: number;
};
type OrderRow = {
  id: string; member_kind: CommunityAuthor['kind']; member_id: string; item: string; item_name: string; price: number; status: string;
  ship_name: string | null; ship_phone: string | null; ship_address: string | null; shipping_company: string | null; tracking_number: string | null;
  created_at: string; resolved_at: string | null;
};
export type Shipping = { name: string; phone: string; address: string };
export type Tracking = { company: string; number: string };
export type CustomItemInput = {
  image?: string | null;
  category?: string | null; kind?: 'frame' | 'color'; effect?: NameEffect | null;
  cat: 'look' | 'digital' | 'goods'; name: string; description: string; price: number; stock: number | null; limitPer: 'month' | 'year' | 'once' | null;
  limitN: number | null; minLevel: number; minDays: number; delivery: string; note: string; active: boolean;
};
const previousDay = (key: string) => new Date(Date.parse(`${key}T00:00:00Z`) - day).toISOString().slice(0, 10);

// 签到、补签、兑换所、道具卡、提示词解锁、悬赏、付费置顶和标题高亮。
export function createEconomy(db: DatabaseSync, tx: Transaction, ledger: Ledger, members: Members, { previewCatalog = false }: { previewCatalog?: boolean } = {}) {
  const rules = communityRules;
  // Check-ins.
  const insertCheckin = db.prepare(`INSERT INTO community_checkins (member_kind, member_id, day, streak, reward, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const recordEarly = db.prepare("INSERT OR IGNORE INTO community_badge_events(kind,source_id,actor_key,first_at) VALUES('early',?,?,?)");
  const nextCheckinPosition = db.prepare('INSERT INTO community_badge_checkin_ranks(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1 RETURNING count');
  const checkedOn = db.prepare('SELECT COUNT(*) AS count FROM community_checkins WHERE member_kind = ? AND member_id = ? AND day = ?');
  const daysUpTo = db.prepare('SELECT day FROM community_checkins WHERE member_kind = ? AND member_id = ? AND day <= ? ORDER BY day DESC LIMIT 800');
  const daysBetween = db.prepare('SELECT day FROM community_checkins WHERE member_kind = ? AND member_id = ? AND day >= ? AND day <= ? ORDER BY day');
  const checkinsOn = db.prepare("SELECT COUNT(*) AS count FROM community_checkins WHERE day = ? AND member_kind = 'reader'");
  const earliest = db.prepare(`SELECT c.member_kind,c.member_id,c.created_at FROM community_badge_events e
    JOIN community_checkins c ON c.day=e.source_id AND e.actor_key=c.member_kind || ':' || c.member_id
    WHERE e.kind='early' AND c.day=? AND c.reward>0 AND c.member_kind='reader' ORDER BY c.created_at,c.rowid LIMIT ?`);
  const recentCheckers = db.prepare(`SELECT DISTINCT member_kind, member_id FROM community_checkins WHERE day >= ? AND member_kind = 'reader'`);
  const insertMakeup = db.prepare('INSERT INTO community_makeups (member_kind, member_id, day, month, cost, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const makeupsIn = db.prepare('SELECT COUNT(*) AS count FROM community_makeups WHERE member_kind = ? AND member_id = ? AND month = ?');
  // Shop.
  const categories = db.prepare('SELECT id, name FROM community_shop_categories ORDER BY created_at, rowid');
  const category = db.prepare('SELECT id, name FROM community_shop_categories WHERE id = ?');
  const duplicateCategory = db.prepare('SELECT id FROM community_shop_categories WHERE name = ?');
  const insertCategory = db.prepare('INSERT INTO community_shop_categories (id, name, created_at) VALUES (?, ?, ?)');
  const customItems = db.prepare('SELECT * FROM community_shop_items ORDER BY active DESC, cat, price');
  const customItem = db.prepare('SELECT * FROM community_shop_items WHERE id = ?');
  const insertItem = db.prepare(`INSERT INTO community_shop_items (id, cat, name, description, price, stock, stock_left, limit_per, limit_n, min_level, min_days, delivery, note, active, created_at, updated_at, image, category, kind, effect)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateItem = db.prepare(`UPDATE community_shop_items SET name = ?, description = ?, price = ?, stock = ?, stock_left = ?, limit_per = ?, limit_n = ?, min_level = ?, min_days = ?,
    delivery = ?, note = ?, active = ?, updated_at = ?, image = ?, category = ?, effect = ? WHERE id = ?`);
  const visibleImage = db.prepare('SELECT 1 FROM community_shop_items WHERE image = ? AND active = 1 LIMIT 1');
  const redeemedImage = db.prepare(`SELECT 1 FROM community_orders o JOIN community_shop_items i ON i.id = o.item
    WHERE i.image = ? AND o.member_kind = ? AND o.member_id = ? AND o.status != 'cancelled' LIMIT 1`);
  const equippedImage = db.prepare('SELECT 1 FROM community_members WHERE frame = ? LIMIT 1');
  const itemOwned = db.prepare('SELECT 1 FROM community_owned WHERE item = ? LIMIT 1');
  const takeStock = db.prepare('UPDATE community_shop_items SET stock_left = stock_left - 1 WHERE id = ? AND stock_left > 0');
  const returnStock = db.prepare('UPDATE community_shop_items SET stock_left = stock_left + 1 WHERE id = ? AND stock IS NOT NULL');
  const ownedRows = db.prepare('SELECT item FROM community_owned WHERE member_kind = ? AND member_id = ?');
  const addOwned = db.prepare('INSERT OR IGNORE INTO community_owned (member_kind, member_id, item, created_at) VALUES (?, ?, ?, ?)');
  const cardRows = db.prepare('SELECT card, count FROM community_inventory WHERE member_kind = ? AND member_id = ?');
  const addCard = db.prepare(`INSERT INTO community_inventory (member_kind, member_id, card, count) VALUES (?, ?, ?, 1)
    ON CONFLICT (member_kind, member_id, card) DO UPDATE SET count = count + 1`);
  const useCardRow = db.prepare('UPDATE community_inventory SET count = count - 1 WHERE member_kind = ? AND member_id = ? AND card = ? AND count > 0');
  const insertOrder = db.prepare(`INSERT INTO community_orders (id, member_kind, member_id, item, item_name, price, status, ship_name, ship_phone, ship_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const ordersSince = db.prepare(`SELECT COUNT(*) AS count FROM community_orders WHERE member_kind = ? AND member_id = ? AND item = ? AND status != 'cancelled' AND created_at >= ?`);
  const memberOrders = db.prepare('SELECT * FROM community_orders WHERE member_kind = ? AND member_id = ? ORDER BY created_at DESC LIMIT 100');
  const goodsOrders = db.prepare(`SELECT o.* FROM community_orders o JOIN community_shop_items i ON i.id = o.item WHERE i.cat = 'goods' ORDER BY o.status = 'pending' DESC, o.created_at DESC LIMIT 100`);
  const oneOrder = db.prepare('SELECT * FROM community_orders WHERE id = ?');
  const closeOrder = db.prepare(`UPDATE community_orders SET status = ?, resolved_at = ?, ship_name = NULL, ship_phone = NULL, ship_address = NULL WHERE id = ? AND status = 'pending'`);
  const setTracking = db.prepare(`UPDATE community_orders SET shipping_company = ?, tracking_number = ? WHERE id = ? AND status = 'pending'`);
  // Topics: unlocks, bounties, paid pins and glowing titles.
  const unlockedRow = db.prepare('SELECT COUNT(*) AS count FROM community_unlocks WHERE topic_id = ? AND member_kind = ? AND member_id = ?');
  const insertUnlock = db.prepare('INSERT INTO community_unlocks (topic_id, member_kind, member_id, price, created_at) VALUES (?, ?, ?, ?, ?)');
  const unlockCount = db.prepare('SELECT COUNT(*) AS count FROM community_unlocks WHERE topic_id = ?');
  const topicRow = db.prepare(`SELECT id, board, author_kind, author_id, title, body, bounty, bounty_state, paid_pin_until, glow_until, pinned, created_at, deleted_at
    FROM community_topics WHERE id = ?`);
  const setBounty = db.prepare('UPDATE community_topics SET bounty = ?, bounty_state = ? WHERE id = ?');
  const bountyState = db.prepare('UPDATE community_topics SET bounty_state = ? WHERE id = ? AND bounty_state = ?');
  const expiredBounties = db.prepare(`SELECT id FROM community_topics WHERE bounty_state = 'open' AND created_at < ? AND deleted_at IS NULL`);
  const boardPaidPins = db.prepare('SELECT COUNT(*) AS count FROM community_topics WHERE board = ? AND paid_pin_until > ? AND deleted_at IS NULL AND id != ?');
  const setPaidPin = db.prepare('UPDATE community_topics SET paid_pin_until = ? WHERE id = ?');
  const setGlow = db.prepare('UPDATE community_topics SET glow_until = ? WHERE id = ?');

  type TopicRow = { id: string; board: string; author_kind: CommunityAuthor['kind']; author_id: string; title: string; body: string; bounty: number; bounty_state: string | null; paid_pin_until: string | null; glow_until: string | null; pinned: number; created_at: string; deleted_at: string | null };
  const topic = (id: string) => topicRow.get(id) as TopicRow | undefined;

  /* ---------- 签到 ---------- */
  function streakEnding(member: CommunityAuthor, key: string) {
    let streak = 0, expected = key;
    for (const row of daysUpTo.all(member.kind, member.id, key) as Array<{ day: string }>) {
      if (row.day !== expected) break;
      streak++;
      expected = previousDay(expected);
    }
    return streak;
  }
  const checked = (member: CommunityAuthor, key: string) => countOf(checkedOn, member.kind, member.id, key) > 0;
  function currentStreak(member: CommunityAuthor, now = Date.now()) {
    const today = beijingDay(now);
    return checked(member, today) ? streakEnding(member, today) : streakEnding(member, previousDay(today));
  }
  function monthAttendance(member: CommunityAuthor, month: string, extraDay?: string) {
    const days = (daysBetween.all(member.kind, member.id, `${month}-01`, `${month}-31`) as Array<{ day: string }>).map(row => row.day);
    return checkinMonth(month, extraDay ? [...days, extraDay] : days);
  }
  const monthBonus = (member: CommunityAuthor, month: string) => ledger.rewardedFor(member, 'checkin-month', { kind: 'month', id: month }) ? rules.monthBonus : 0;
  // Called inside the same transaction as the check-in/makeup. The existing
  // per-member ledger reference makes the full-month award idempotent.
  function awardMonth(member: CommunityAuthor, month: string, at: string) {
    if (monthBonus(member, month) || !monthAttendance(member, month).complete) return 0;
    return ledger.credit(member, rules.monthBonus, 'checkin-month', { kind: 'month', id: month }, at);
  }
  function nextCheckinReward(member: CommunityAuthor, now = Date.now()) {
    const today = beijingDay(now), nextDay = checked(member, today) ? beijingDay(now + day) : today;
    const month = nextDay.slice(0, 7);
    return checkinReward(!monthBonus(member, month) && monthAttendance(member, month, nextDay).complete);
  }
  function makeupState(member: CommunityAuthor, { vip = false, now = Date.now() }: { vip?: boolean; now?: number } = {}) {
    const month = beijingDay(now).slice(0, 7);
    const used = countOf(makeupsIn, member.kind, member.id, month);
    const allowed = rules.makeupPerMonth + (vip ? 1 : 0);
    const cards = inventory(member).makeup;
    const free = vip && used === 0;
    const days: string[] = [];
    let key = beijingDay(now);
    for (let i = 1; i <= rules.makeupWindow; i++) { key = previousDay(key); if (!checked(member, key)) days.push(key); }
    return { used, allowed, left: Math.max(0, allowed - used), free, cards, cost: cards ? 0 : free ? 0 : rules.makeupCost, days };
  }

  /* ---------- 道具卡与拥有的物品 ---------- */
  function inventory(member: CommunityAuthor) {
    const counts: Record<Card, number> = { makeup: 0, pin: 0, highlight: 0 };
    for (const row of cardRows.all(member.kind, member.id) as Array<{ card: Card; count: number }>) counts[row.card] = Number(row.count);
    return counts;
  }
  const useCard = (member: CommunityAuthor, card: Card) => Number(useCardRow.run(member.kind, member.id, card).changes) > 0;
  const owned = (member: CommunityAuthor) => new Set((ownedRows.all(member.kind, member.id) as Array<{ item: string }>).map(row => row.item));

  /* ---------- 兑换所 ---------- */
  const customToItem = (row: CustomItemRow): ShopItem & { active: boolean; delivery: string } => ({
    image: row.image, category: row.category, effect: row.kind === 'color' ? communityNameEffect(parseJson<unknown>(row.effect, null)) : null,
    ...(row.kind ? { ref: row.kind === 'frame' ? `image:${row.image}` : `effect:${row.id}` } : {}),
    id: row.id, cat: row.kind ? 'look' : row.cat, kind: row.kind || row.cat, name: row.name, desc: row.description, price: row.price,
    limit: row.limit_per ? { per: row.limit_per, n: row.limit_n || 1 } : null, minLevel: row.min_level, minDays: row.min_days,
    stock: row.stock, left: row.stock_left, note: row.note, builtin: false, active: Boolean(row.active), delivery: row.delivery,
  });
  const allCustom = () => (customItems.all() as CustomItemRow[]).map(customToItem);
  // Sample definitions remain available for historical orders and owned
  // decorations. Only an explicitly constructed local preview sells them;
  // formal publication comes from the author's persisted active products.
  const builtinItem = (item: ShopItem) => ({ ...item, active: previewCatalog, delivery: '' });
  function findItem(id: string) {
    const builtin = communityBuiltinItems.find(item => item.id === id);
    if (builtin) return builtinItem(builtin);
    const row = customItem.get(id) as CustomItemRow | undefined;
    return row ? customToItem(row) : null;
  }
  // Orders of an item that count towards its per-member limit (this Beijing month or year, or ever).
  function redeemedCount(member: CommunityAuthor, item: ShopItem, now: number) {
    const today = beijingDay(now);
    const since = !item.limit || item.limit.per === 'once' ? '0000' : iso(Date.parse(`${item.limit.per === 'year' ? `${today.slice(0, 4)}-01` : today.slice(0, 7)}-01T00:00:00+08:00`));
    return countOf(ordersSince, member.kind, member.id, item.id, since);
  }
  type RedeemContext = { level: number; owner: boolean; joinedAt: string | null; now?: number };
  // Whether the member may redeem the item now, and why not.
  function redeemState(member: CommunityAuthor, item: ShopItem & { active?: boolean }, { level, owner, joinedAt, now = Date.now() }: RedeemContext) {
    const isOwned = (item.kind === 'frame' || item.kind === 'color' || item.kind === 'cover' || item.kind === 'digital') && owned(member).has(item.id);
    const base = { owned: isOwned, left: item.stock == null ? null : item.left ?? 0 };
    if (item.active === false) return { ...base, ok: false, code: 'closed', why: '已下架' };
    if (isOwned) return { ...base, ok: false, code: 'owned', why: '已拥有' };
    if (item.stock != null && (item.left ?? 0) <= 0) return { ...base, ok: false, code: 'soldout', why: '已兑完' };
    if (item.minLevel && !owner && level < item.minLevel) return { ...base, ok: false, code: 'level', why: `需要等级 L${item.minLevel} 以上` };
    const days = joinedAt ? Math.floor((now - Date.parse(joinedAt)) / day) : 0;
    if (item.minDays && !owner && days < item.minDays) return { ...base, ok: false, code: 'days', why: `注册满 ${item.minDays} 天后可兑` };
    if (item.limit && redeemedCount(member, item, now) >= item.limit.n)
      return { ...base, ok: false, code: 'limit', why: item.limit.per === 'once' ? '已经兑换过' : `${item.limit.per === 'year' ? '今年' : '这个月'}的次数用完了` };
    const balance = ledger.balance(member);
    if (balance < item.price) return { ...base, ok: false, code: 'short', why: `还差 ${item.price - balance} 星尘` };
    return { ...base, ok: true, code: 'ok', why: '' };
  }
  const orderDTO = (row: OrderRow, withShipping = false) => ({
    id: row.id, member: { kind: row.member_kind, id: row.member_id }, item: row.item, itemName: row.item_name, price: row.price, status: row.status,
    createdAt: row.created_at, resolvedAt: row.resolved_at,
    tracking: row.tracking_number ? { company: row.shipping_company || '', number: row.tracking_number } : null,
    ...(withShipping ? { shipping: row.ship_name ? { name: row.ship_name, phone: row.ship_phone || '', address: row.ship_address || '' } : null } : {}),
  });

  return {
    /* ---------- 签到 ---------- */
    currentStreak,
    monthBonus,
    nextCheckinReward,
    checked: (member: CommunityAuthor, now = Date.now()) => checked(member, beijingDay(now)),
    checkin(member: CommunityAuthor, { now = Date.now() }: { vip?: boolean; now?: number } = {}) {
      return tx(() => {
        if (member.kind === 'owner') throw fail('站长不参与签到。', 403);
        const today = beijingDay(now), at = iso(now);
        if (checked(member, today)) throw fail('今天已经签到过了。', 409);
        const streak = streakEnding(member, previousDay(today)) + 1;
        const reward = checkinReward();
        // Makeups are attendance only and never consume a real check-in ranking position.
        const position = Number(nextCheckinPosition.get(today)?.count);
        insertCheckin.run(member.kind, member.id, today, streak, reward.total, at);
        if (position <= 10) recordEarly.run(today, `${member.kind}:${member.id}`, at);
        ledger.credit(member, reward.total, 'checkin', null, at);
        const bonus = awardMonth(member, today.slice(0, 7), at);
        members.visit(member, now);
        members.checkBadges(member, at);
        return { streak, reward: reward.total + bonus, bonus, balance: ledger.balance(member), position };
      });
    },
    makeupState,
    // 补签：接上连签，不补发那天的签到星尘。先用补签卡，VIP 每月第一次免费，否则 30 星尘。
    makeup(member: CommunityAuthor, key: string, { vip = false, now = Date.now() }: { vip?: boolean; now?: number } = {}) {
      return tx(() => {
        if (member.kind === 'owner') throw fail('站长不参与签到。', 403);
        const state = makeupState(member, { vip, now });
        if (!state.days.includes(key)) throw fail(`只能补签最近 ${rules.makeupWindow} 天里漏掉的日子。`);
        if (!state.left) throw fail('这个月的补签次数用完了。', 409);
        const at = iso(now);
        let cost: 'card' | 'free' | 'stardust' = 'stardust';
        if (state.cards && useCard(member, 'makeup')) cost = 'card';
        else if (state.free) cost = 'free';
        else ledger.debit(member, rules.makeupCost, 'makeup', { kind: 'day', id: key }, at);
        insertCheckin.run(member.kind, member.id, key, streakEnding(member, previousDay(key)) + 1, 0, at);
        insertMakeup.run(member.kind, member.id, key, beijingDay(now).slice(0, 7), cost, at);
        const streak = currentStreak(member, now);
        members.checkBadges(member, at);
        const bonus = awardMonth(member, key.slice(0, 7), at);
        return { streak, cost, bonus, balance: ledger.balance(member) };
      });
    },
    checkinDays: (member: CommunityAuthor, from: string, to: string) => (daysBetween.all(member.kind, member.id, from, to) as Array<{ day: string }>).map(row => row.day),
    checkinsToday: (now = Date.now()) => countOf(checkinsOn, beijingDay(now)),
    earlyBirds(now = Date.now(), limit = 10) {
      return (earliest.all(beijingDay(now), limit) as Array<{ member_kind: CommunityAuthor['kind']; member_id: string; created_at: string }>)
        .map(row => ({ member: { kind: row.member_kind, id: row.member_id } as CommunityAuthor, at: row.created_at }));
    },
    // Current streaks of readers who checked in today or yesterday, longest first.
    streakRanking(now = Date.now(), limit = 10) {
      return (recentCheckers.all(previousDay(beijingDay(now))) as Array<{ member_kind: CommunityAuthor['kind']; member_id: string }>)
        .map(row => { const member = { kind: row.member_kind, id: row.member_id }; return { member, streak: currentStreak(member, now) }; })
        .filter(entry => entry.streak > 0).sort((a, b) => b.streak - a.streak).slice(0, limit);
    },

    /* ---------- 兑换所 ---------- */
    inventory,
    owned,
    items: () => [...communityBuiltinItems.map(builtinItem), ...allCustom()],
    item: findItem,
    redeemState,
    redeem(member: CommunityAuthor, id: string, context: RedeemContext & { shipping?: Shipping | null }) {
      return tx(() => {
        const item = findItem(id);
        if (!item) throw fail('没有这个物品。', 404);
        const state = redeemState(member, item, context);
        if (!state.ok) throw fail(state.why, state.code === 'short' ? 402 : 409);
        if (item.kind === 'goods' && !context.shipping) throw fail('请填写收货信息。');
        const now = context.now ?? Date.now(), at = iso(now);
        ledger.debit(member, item.price, 'shop', { kind: 'item', id: item.id }, at);
        if (item.stock != null && !Number(takeStock.run(item.id).changes)) throw fail('已兑完。', 409);
        const orderId = randomUUID(), shipping = item.kind === 'goods' ? context.shipping! : null;
        insertOrder.run(orderId, member.kind, member.id, item.id, item.name, item.price, item.kind === 'goods' ? 'pending' : 'done',
          shipping?.name ?? null, shipping?.phone ?? null, shipping?.address ?? null, at);
        if (item.kind === 'card') addCard.run(member.kind, member.id, item.ref ?? '');
        else if (item.kind === 'frame' || item.kind === 'color' || item.kind === 'cover') { addOwned.run(member.kind, member.id, item.id, at); members.equip(member, item.kind, item.ref || null); }
        else if (item.kind === 'digital') addOwned.run(member.kind, member.id, item.id, at);
        return { order: orderId, item: { id: item.id, name: item.name, kind: item.kind }, balance: ledger.balance(member) };
      });
    },
    // Equip or take off a decoration the member owns.
    equip(member: CommunityAuthor, kind: 'frame' | 'color' | 'cover', ref: string | null) {
      if (ref) {
        const ownedItems = owned(member);
        const item = [...communityBuiltinItems, ...allCustom()].find(entry => entry.kind === kind && entry.ref === ref && ownedItems.has(entry.id));
        if (!item) throw fail('还没有这个装扮。', 403);
      }
      members.equip(member, kind, ref);
      return members.decorations(member);
    },
    delivery(member: CommunityAuthor, id: string) {
      const item = findItem(id);
      if (!item || item.kind !== 'digital' || !owned(member).has(id)) throw fail('兑换后才能查看。', 403);
      return { name: item.name, delivery: item.delivery };
    },
    orders: (member: CommunityAuthor) => (memberOrders.all(member.kind, member.id) as OrderRow[]).map(row => orderDTO(row)),
    goodsOrders: () => (goodsOrders.all() as OrderRow[]).map(row => orderDTO(row, true)),
    // Shipping details are removed as soon as an order is shipped or cancelled.
    ship(id: string, now = Date.now(), tracking: Tracking | null = null) {
      return tx(() => {
        const row = oneOrder.get(id) as OrderRow | undefined;
        if (!row || row.status !== 'pending') throw fail('这个订单已经处理过了。', 409);
        if (tracking) setTracking.run(tracking.company, tracking.number, id);
        if (!Number(closeOrder.run('shipped', iso(now), id).changes)) throw fail('这个订单已经处理过了。', 409);
        return orderDTO(oneOrder.get(id) as OrderRow);
      });
    },
    cancel(id: string, now = Date.now()) {
      return tx(() => {
        const row = oneOrder.get(id) as OrderRow | undefined;
        if (!row || row.status !== 'pending') throw fail('这个订单已经处理过了。', 409);
        closeOrder.run('cancelled', iso(now), id);
        returnStock.run(row.item);
        ledger.credit({ kind: row.member_kind, id: row.member_id }, row.price, 'refund', { kind: 'item', id: row.item }, iso(now), 'in');
        return orderDTO(row);
      });
    },
    customItems: allCustom,
    categories: () => categories.all() as ShopCategory[],
    category: (id: string) => category.get(id) as ShopCategory | undefined,
    saveCategory(name: string, now = Date.now()) {
      return tx(() => {
        if (duplicateCategory.get(name)) throw fail('已经有这个类别了。', 409);
        const id = randomUUID();
        insertCategory.run(id, name, iso(now));
        return { id, name };
      });
    },
    nameEffect(ref: string | null): NameEffect | null {
      if (!ref || !/^effect:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ref)) return null;
      const item = findItem(ref.slice(7));
      return item?.kind === 'color' ? item.effect || null : null;
    },
    imageVisible: (id: string, member: CommunityAuthor) => Boolean(visibleImage.get(id) || redeemedImage.get(id, member.kind, member.id) || equippedImage.get(`image:${id}`)),
    saveItem(id: string | null, input: CustomItemInput, now = Date.now()) {
      return tx(() => {
        const at = iso(now), kind = input.cat === 'look' ? input.kind : null;
        if (input.cat === 'look' && kind !== 'frame' && kind !== 'color') throw fail('请选择头像框或昵称特效。');
        const effect = kind === 'color' && input.effect ? JSON.stringify(input.effect) : null;
        if (!id) {
          const newId = randomUUID();
          insertItem.run(newId, input.cat === 'look' ? 'digital' : input.cat, input.name, input.description, input.price, input.stock, input.stock, input.limitPer, input.limitN,
            input.minLevel, input.minDays, input.delivery, input.note, input.active ? 1 : 0, at, at, input.image || null, input.category || null, kind || null, effect);
          return newId;
        }
        const row = customItem.get(id) as CustomItemRow | undefined;
        if (!row) throw fail('没有这个物品。', 404);
        if (input.cat !== (row.kind ? 'look' : row.cat) || (kind || null) !== row.kind) throw fail('已上架物品的用途不能修改，请另建新物品。');
        if (row.kind === 'frame' && input.image !== undefined && input.image !== row.image && itemOwned.get(id))
          throw fail('头像框已经有人兑换，不能更换佩戴图片；请新建头像框。');
        // Changing the stock keeps what has already been redeemed.
        const sold = row.stock != null && row.stock_left != null ? row.stock - row.stock_left : 0;
        const left = input.stock == null ? null : Math.max(0, input.stock - sold);
        updateItem.run(input.name, input.description, input.price, input.stock, left, input.limitPer, input.limitN, input.minLevel, input.minDays,
          input.delivery, input.note, input.active ? 1 : 0, at, input.image === undefined ? row.image : input.image,
          input.category === undefined ? row.category : input.category, input.effect === undefined ? row.effect : effect, id);
        return id;
      });
    },

    /* ---------- 提示词解锁 ---------- */
    unlocked: (topicId: string, member: CommunityAuthor) => countOf(unlockedRow, topicId, member.kind, member.id) > 0,
    unlockCount: (topicId: string) => countOf(unlockCount, topicId),
    // The reader pays the price; the author gets 80 % and the rest is burned.
    unlock(topicId: string, member: CommunityAuthor, price: number, author: CommunityAuthor, now = Date.now()) {
      return tx(() => {
        if (countOf(unlockedRow, topicId, member.kind, member.id)) throw fail('你已经解锁过了。', 409);
        const at = iso(now), ref = { kind: 'topic', id: topicId };
        ledger.debit(member, price, 'unlock', ref, at, 'out');
        const share = Math.floor(price * rules.unlockShare);
        ledger.credit(author, share, 'unlock-in', ref, at, 'in');
        insertUnlock.run(topicId, member.kind, member.id, price, at);
        return { share, balance: ledger.balance(member) };
      });
    },

    /* ---------- 悬赏 ---------- */
    freezeBounty(topicId: string, member: CommunityAuthor, amount: number, at: string) {
      ledger.debit(member, amount, 'bounty-freeze', { kind: 'topic', id: topicId }, at);
      setBounty.run(amount, 'open', topicId);
    },
    payBounty(topicId: string, answerer: CommunityAuthor, at: string) {
      const row = topic(topicId);
      if (!row?.bounty || row.bounty_state !== 'open') return 0;
      bountyState.run('paid', topicId, 'open');
      return ledger.credit(answerer, row.bounty, 'bounty', { kind: 'topic', id: topicId }, at, 'in');
    },
    // Half of an unclaimed bounty goes back to the asker; the other half is burned.
    refundBounty(topicId: string, at: string) {
      const row = topic(topicId);
      if (!row?.bounty || row.bounty_state !== 'open') return null;
      bountyState.run('refunded', topicId, 'open');
      const author = { kind: row.author_kind, id: row.author_id };
      return { author, amount: ledger.credit(author, Math.floor(row.bounty / 2), 'bounty-refund', { kind: 'topic', id: topicId }, at, 'in'), title: row.title };
    },
    expiredBounties: (now = Date.now()) => (expiredBounties.all(iso(now - rules.bountyDays * day)) as Array<{ id: string }>).map(row => row.id),

    /* ---------- 付费置顶与标题高亮 ---------- */
    // Pins the member's own showcase or tools topic for 24 hours: a pin card, or 200 星尘. One paid pin per board at a time.
    paidPin(topicId: string, member: CommunityAuthor, now = Date.now()) {
      return tx(() => {
        const row = topic(topicId);
        if (!row || row.deleted_at) throw fail('帖子不存在，或已被删除。', 404);
        if (row.author_kind !== member.kind || row.author_id !== member.id) throw fail('只能推荐自己的帖子。', 403);
        if (row.board !== 'showcase' && row.board !== 'tools') throw fail('只有作品帖和资源帖可以推荐。');
        if (row.paid_pin_until && Date.parse(row.paid_pin_until) > now) throw fail('这个帖子已经有推荐了。', 409);
        if (countOf(boardPaidPins, row.board, iso(now), topicId)) throw fail('这个版块已经有一个推荐位了，晚点再试。', 409);
        const at = iso(now);
        const card = useCard(member, 'pin');
        if (!card) ledger.debit(member, rules.pinCost, 'pin', { kind: 'topic', id: topicId }, at);
        const until = iso(now + rules.pinHours * 3600 * 1000);
        setPaidPin.run(until, topicId);
        return { until, card, balance: ledger.balance(member) };
      });
    },
    highlight(topicId: string, member: CommunityAuthor, now = Date.now()) {
      return tx(() => {
        const row = topic(topicId);
        if (!row || row.deleted_at) throw fail('帖子不存在，或已被删除。', 404);
        if (row.author_kind !== member.kind || row.author_id !== member.id) throw fail('只能高亮自己的帖子。', 403);
        if (!useCard(member, 'highlight')) throw fail('需要一张高亮卡，可以在兑换所换。', 402);
        const until = iso(now + rules.glowDays * day);
        setGlow.run(until, topicId);
        return { until };
      });
    },
  };
}
export type Economy = ReturnType<typeof createEconomy>;
