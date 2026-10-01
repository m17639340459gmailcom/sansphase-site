// 社区：签到、星尘（明细、等级、规则）、兑换所、我的兑换、排行、成员主页、通知、公约和社区管理。
// 这里只拼 HTML；读写接口和表单在 community-ui.ts。

import {
  communityBoards, boardName, postHref, memberHref, stardustHref, inboxHref, shopHref, manageHref, communityHomeHref,
  avatarHTML, whoHTML, nameHTML, levelChipHTML, vipChipHTML, badgeHTML, cardHead, moreLink, bannerHTML, statsHTML, emptyHTML,
  communityStatusHTML, communityTopicsHTML, communityBodyHTML, relativeTime, beijingTime, readyData, communityLevelName, plainText,
} from './community.mjs';
import type { Common, CommunityLoad, CommunityMe, CommunityPerson, CommunityTopic, CommunityUnread, CommunityInventory, Translate } from './community.ts';
import {
  communityRules, communityLevels, communityLevelRules, communityLevelPerks, communityBadges, communityCheckinBadges,
  communityShopCats, communityReportReasons, communityReviewReasons, checkinReward, beijingDay,
} from './community-rules.mjs';
import type { ShopItem } from './community-rules.ts';

/* ---------- 接口返回的数据 ---------- */
export type CommunityEarlyBird = { person: CommunityPerson; at: string };
export type CommunityMakeup = { used: number; allowed: number; left: number; free: boolean; cards: number; cost: number; days: string[] };
export type CommunityCheckin = {
  checkedIn: boolean; streak: number; balance: number; gainedToday: number; behaviourToday: number; vip: boolean; owner?: boolean; uid?: string | null;
  month: string; days: string[]; checkinsToday: number; earlyBirds: CommunityEarlyBird[]; makeup: CommunityMakeup; badges: string[];
};
export type CommunityLedgerRow = {
  id: string; amount: number; kind: string; reason: string; createdAt: string; reverted: boolean;
  topic: { id: string; title: string } | null;
  // The item redeemed or refunded, or the day made up.
  detail?: string | null;
};
export type CommunityLevelProgress = { next: number; rows: Array<{ key: string; label: string; labelEn: string; need: number; have: number }>; clean: boolean };
export type CommunityFlow = "all" | "in" | "out";
export type CommunityStardust = {
  balance: number; gainedToday: number; behaviourToday: number; dailyCap: number; checkedIn: boolean;
  month: { gained: number; spent: number }; flow: CommunityFlow; ledger: CommunityLedgerRow[];
  level: number; owner: boolean; steward: boolean; stats: Record<string, number>; progress: CommunityLevelProgress | null;
};
export type CommunityRedeemState = { owned: boolean; left: number | null; ok: boolean; code: string; why: string };
export type CommunityShopItem = ShopItem & { active: boolean; state: CommunityRedeemState };
export type CommunityDecorations = { frame: string | null; color: string | null; cover: string | null };
export type CommunityShop = { balance: number; level: number; owner: boolean; items: CommunityShopItem[]; inventory: CommunityInventory; decorations: CommunityDecorations };
export type CommunityOrder = { id: string; item: string; itemName: string; price: number; status: string; createdAt: string; resolvedAt: string | null; tracking?: { company: string; number: string } | null };
export type CommunityShopMine = {
  balance: number; inventory: CommunityInventory; decorations: CommunityDecorations; looks: ShopItem[];
  digital: Array<{ id: string; name: string; desc: string }>; orders: CommunityOrder[];
};
export type CommunityDelivery = { id: string; name: string; delivery: string };
export type CommunityRank = {
  contributions: Array<{ person: CommunityPerson; score: number; likes: number; accepted: number; featured: number }>;
  streaks: Array<{ person: CommunityPerson; streak: number }>; early: CommunityEarlyBird[];
};
export type CommunityMemberReply = { id: string; topicId: string; topicTitle: string; board: string; body: string; createdAt: string; likes: number };
export type CommunityMember = {
  person: CommunityPerson; bio: string; joinedAt: string | null; cover: string | null; streak: number;
  stats: { topics: number; replies: number; likes: number; accepted: number; featured: number };
  follows: { followers: number; following: number }; following: boolean; self: boolean; badges: string[];
  muted: { id: string; until: string; reason: string } | null; canMute: boolean; canAppoint: boolean; steward: boolean;
  tab: string; topics: CommunityTopic[]; replies: CommunityMemberReply[]; bookmarks: CommunityTopic[];
  counts: { topics: number; replies: number; bookmarks: number };
  quick: { balance: number; checkedIn: boolean; unread: number; orders: number } | null;
};
export type CommunityNotice = {
  id: string; type: string; actor: CommunityPerson | null; topicId: string | null; replyId: string | null; text: string;
  data: Record<string, unknown>; link: string | null; count: number; createdAt: string; read: boolean; topicTitle: string | null;
};
export type CommunityInbox = { tab: string; unread: CommunityUnread; items: CommunityNotice[] };
export type CommunityReport = {
  id: string; reason: string; note: string; createdAt: string; reporter: CommunityPerson;
  target: { kind: "topic" | "reply"; topicId: string | null; title: string; excerpt: string; author: CommunityPerson | null; gone: boolean; hidden: boolean };
};
export type CommunityQueueTopic = CommunityTopic & { body: string; pendingReason: string | null; hiddenReason: string | null };
export type CommunityQueueReply = { id: string; topicId: string; topicTitle: string; author: CommunityPerson; body: string; createdAt: string; hiddenAt: string };
export type CommunityGoodsOrder = CommunityOrder & { member: CommunityPerson; shipping?: { name: string; phone: string; address: string } | null };
export type CommunityManagedItem = ShopItem & { active: boolean; delivery: string };
export type CommunitySanction = { id: string; member: CommunityPerson; days: number; reason: string; until: string; createdAt: string };
export type CommunityManage = {
  tab: string; owner: boolean;
  counts: { queue: number; reports: number; orders: number; sanctions: number }; kpis: { topics24h: number; replies24h: number };
  queue: { topics: CommunityQueueTopic[]; replies: CommunityQueueReply[] }; reports: CommunityReport[];
  orders: CommunityGoodsOrder[]; items: CommunityManagedItem[]; sanctions: CommunitySanction[];
  data: { flow: Array<{ day: string; issued: number; recovered: number }>; boards: Array<{ id: string; topics: number }> } | null;
};

const pageOf = (view: string, common: Common, load: CommunityLoad<unknown>, head = "") =>
  `<section class="page community-page" data-community="${view}">${head}${communityStatusHTML(load, common)}</section>`;
const tabsHTML = (tabs: Array<[string, string, number?]>, current: string, label: string, extra = "") =>
  `<nav class="community-tabs community-rv" style="--i:1" aria-label="${label}">${tabs.map(([href, text, count], i) => `<a href="${href}"${current === String(i) ? ' aria-current="page"' : ""}>${text}${count ? `<b class="community-tab-n">${count}</b>` : ""}</a>`).join("")}${extra}</nav>`;
const pageHead = (eyebrow: string, title: string, text: string, side = "") =>
  `<header class="community-page-head community-rv" style="--i:0"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${text ? `<p class="community-muted">${text}</p>` : ""}</div>${side}</header>`;

/* ---------- 签到 ---------- */
// 30 天一轮的签到星座（照 demo 画）：点亮的星、今天、每满 7 天和第 30 天的奖励星。
function constellationHTML(position: number, done: boolean, t: Translate) {
  const r = communityRules;
  const cycleDay = checkinReward(position).cycleDay;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < r.cycle; i++) {
    const k = i / (r.cycle - 1);
    points.push([36 + k * 628, 170 + Math.sin(k * Math.PI * 2.1 + 0.3) * 112 * (0.72 + 0.28 * Math.sin(k * Math.PI)) + (((i * 53) % 11) - 5) * 4]);
  }
  const lit = (c: number) => c < cycleDay || (c === cycleDay && done);
  const lines: string[] = [], stars: string[] = [];
  for (let c = 1; c <= r.cycle; c++) {
    const [x, y] = points[c - 1];
    const bonus = c === r.cycle ? r.cycleBonus : c % 7 === 0 ? r.weekBonus : 0;
    if (c > 1) {
      const [x0, y0] = points[c - 2];
      lines.push(`<line class="community-cl${lit(c) ? " is-on" : ""}" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" pathLength="1" style="--i:${c}"/>`);
    }
    const state = lit(c) ? " is-on" : c === cycleDay ? " is-now" : "";
    const radius = c === r.cycle ? 9 : bonus ? 6.5 : 4.2;
    const spark = bonus ? `<path class="community-cs-spark" d="M0 ${-radius * 2.6} L${radius * 0.42} 0 L0 ${radius * 2.6} L${-radius * 0.42} 0Z M${-radius * 2.6} 0 L0 ${radius * 0.42} L${radius * 2.6} 0 L0 ${-radius * 0.42}Z"/>` : "";
    const label = c === cycleDay ? `<text class="community-cs-day" y="${radius + 17}">${t("今天", "Today")}</text>` : [1, 7, 14, 21, 30].includes(c) ? `<text class="community-cs-day" y="${radius + 17}">${t(`第 ${c} 天`, `Day ${c}`)}</text>` : "";
    stars.push(`<g class="community-cs${state}${bonus ? " is-bonus" : ""}${c === r.cycle ? " is-big" : ""}" style="--i:${c}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><g class="community-cs-in">`
      + (c === cycleDay && !done ? `<circle class="community-cs-pulse" r="11"/><circle class="community-cs-pulse is-late" r="11"/>` : "")
      + `<circle class="community-cs-glow" r="${radius * 4.2}"/>${spark}<circle class="community-cs-core" r="${radius}"/>`
      + (bonus ? `<text class="community-cs-bonus" y="${-radius * 3.3}">+${bonus}</text>` : "") + label + `</g></g>`);
  }
  const litCount = lit(cycleDay) ? cycleDay : cycleDay - 1;
  return `<svg class="community-constellation" viewBox="0 0 700 340" role="img" aria-label="${t(`30 天签到星座，已点亮 ${litCount} 颗`, `30-day check-in constellation, ${litCount} lit`)}">${lines.join("")}${stars.join("")}</svg>`;
}

// 月历：签过的日子点亮；最近 7 天里漏掉的日子可以补签（橙色虚线）。
function calendarHTML(data: CommunityCheckin, today: string, { t }: Common, owner = false) {
  const [year, month] = data.month.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const done = new Set(data.days);
  const makeup = new Set(data.makeup.left ? data.makeup.days : []);
  const cells: string[] = [];
  for (let i = 0; i < first; i++) cells.push(`<span class="community-cal-empty"></span>`);
  for (let d = 1; d <= days; d++) {
    const key = `${data.month}-${String(d).padStart(2, "0")}`;
    const today_ = key === today ? ` is-today" aria-current="date` : "";
    if (done.has(key)) cells.push(`<span class="community-cal-day is-ok${today_}">${d}</span>`);
    else if (makeup.has(key) && !owner) cells.push(`<button type="button" class="community-cal-day is-makeup" data-action="community-makeup" data-day="${key}" aria-label="${t(`补签 ${key}`, `Make up ${key}`)}">${d}</button>`);
    else cells.push(`<span class="community-cal-day ${key > today ? "is-future" : "is-miss"}${today_}">${d}</span>`);
  }
  const shift = (delta: number) => new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
  const current = today.slice(0, 7);
  const cost = data.makeup.cards ? t(`先用补签卡（剩 ${data.makeup.cards} 张）`, `a make-up card first (${data.makeup.cards} left)`) : data.makeup.free ? t("本月第一次免费（VIP）", "free the first time this month (VIP)") : t(`每次 ${communityRules.makeupCost} 星尘`, `${communityRules.makeupCost} stardust each`);
  const note = owner ? t("站长仅查看签到日历。", "The owner can view this calendar only.") : !data.makeup.left ? t("这个月的补签次数用完了。", "No make-ups left this month.")
    : data.makeup.days.length
      ? t(`橙色虚线的日期可以补签：${cost}，本月还剩 ${data.makeup.left} 次。补签接上连签，不补发那天的星尘。`, `Dashed days can be made up: ${cost}; ${data.makeup.left} left this month. It reconnects the streak but pays nothing for that day.`)
      : t(`最近 ${communityRules.makeupWindow} 天没有漏签。本月还能补签 ${data.makeup.left} 次。`, `No missed days in the last ${communityRules.makeupWindow}. ${data.makeup.left} make-ups left this month.`);
  return `<section class="community-card community-rv" style="--i:2">${cardHead(t(`${year} 年 ${month} 月`, `${year}-${String(month).padStart(2, "0")}`), "", `<span class="community-cal-nav"><button type="button" class="community-act is-small" data-action="community-month" data-month="${shift(-1)}" aria-label="${t("上个月", "Previous month")}">‹</button><button type="button" class="community-act is-small" data-action="community-month" data-month="${shift(1)}" aria-label="${t("下个月", "Next month")}"${data.month >= current ? " disabled" : ""}>›</button></span>`)}`
    + `<div class="community-cal-week" aria-hidden="true">${t("日一二三四五六", "SMTWTFS").split("").map((day) => `<span>${day}</span>`).join("")}</div>`
    + `<div class="community-cal">${cells.join("")}</div>`
    + `<p class="community-muted">${t(`这个月签了 <b>${data.days.length}</b> 天。`, `<b>${data.days.length}</b> days this month. `)}${note}</p></section>`;
}

export function communityCheckinHTML({ checkin, ...common }: Common & { checkin: CommunityLoad<CommunityCheckin> }) {
  const { t, esc, now = Date.now(), icons = {} } = common;
  const r = communityRules;
  const data = readyData(checkin);
  if (!data) return pageOf("checkin", common, checkin);
  const today = beijingDay(now);
  const position = data.checkedIn ? data.streak : data.streak + 1;
  const reward = checkinReward(position, data.vip), next = checkinReward(position + 1, data.vip);
  const round = Math.floor((position - 1) / r.cycle) + 1;
  let until = 0, bonusDay = 0, bonus = 0;
  for (let i = 0; i <= r.cycle; i++) { const step = checkinReward(position + (data.checkedIn ? 1 : 0) + i, data.vip); if (step.bonus) { until = i; bonusDay = step.cycleDay; bonus = step.bonus; break; } }
  const hint = data.owner ? "" : data.checkedIn
    ? t(`${until === 0 ? "明天" : `再签 ${until + 1} 天，`}第 ${bonusDay} 颗星额外 +${bonus}。`, `Day ${bonusDay} of the cycle adds +${bonus}.`)
    : t(`点亮今天这颗星，+${reward.total} 星尘${reward.bonus ? `（含连签奖励 ${reward.bonus}）` : ""}。`, `Light today's star: +${reward.total} stardust.`);
  const action = data.owner ? `<span class="community-muted">${t("站长不参与签到", "The owner does not take part in check-ins")}</span>` : data.checkedIn
    ? `<span class="community-button is-done">${icons.check || ""}${t(`今日已签到 · 明天 +${next.total}`, `Checked in · +${next.total} tomorrow`)}</span>`
    : `<button type="button" class="community-button is-gold community-ck-go" data-action="community-checkin">${icons.star || ""}${t(`签到 · +${reward.total} 星尘`, `Check in · +${reward.total}`)}</button>`;
  const text = data.owner ? t("站长不参与签到；这里保留签到周期和日历供查看。", "The owner does not check in; the cycle and calendar remain viewable.") : t(`${data.checkedIn ? "已连续签到" : "已连签"} ${data.streak} 天。`, `${data.streak}-day streak. `) + hint + t(`北京时间 0 点换日${data.vip ? "，VIP 每天多 2 星尘" : ""}。`, " Days change at midnight Beijing time.");
  const early = data.earlyBirds.length
    ? `<ol class="community-rank">${data.earlyBirds.map((bird, i) => `<li><span class="community-hot-rank${i < 3 ? " is-top" : ""}">${i + 1}</span>${avatarHTML(bird.person, common, "sm")}${whoHTML(bird.person, common)}<span class="community-rank-count">${esc(beijingTime(bird.at).slice(6))}</span></li>`).join("")}</ol>`
    : `<p class="community-muted">${t("今天还没有人签到。", "No check-ins yet today.")}</p>`;
  const owned = new Set(data.badges);
  return `<section class="page community-page" data-community="checkin">`
    + bannerHTML({ eyebrow: `CHECK-IN · ${t(`第 ${round} 轮`, `CYCLE ${round}`)}`, title: t("签到", "Check-in"), text, esc, side: (data.owner ? "" : statsHTML([[t("星尘", "Stardust"), data.balance], [t("今日签到", "Today"), data.checkinsToday]])) + action })
    + `<section class="community-card community-ck-cycle community-rv" style="--i:1">${cardHead(t("签到周期", "Cycle"), "", `<span class="community-muted">${t("30 天一轮，断签后从第 1 颗星重新点亮，已拿到的星尘不收回", "30 days a cycle; a missed day starts again, earned stardust stays")}</span>`)}`
    + constellationHTML(position, data.checkedIn, t)
    + `<div class="community-ck-legend"><span><i class="community-lg is-on"></i>${t("已点亮", "Lit")}</span><span><i class="community-lg is-now"></i>${t("今天", "Today")}</span><span><i class="community-lg is-bonus"></i>${t(`每满 7 天 +${r.weekBonus}`, `+${r.weekBonus} every 7 days`)}</span><span><i class="community-lg is-big"></i>${t(`第 30 天 +${r.cycleBonus}`, `+${r.cycleBonus} on day 30`)}</span></div></section>`
    + `<div class="community-pt-grid">${calendarHTML(data, today, common, data.owner)}`
    + `<section class="community-card community-rv community-spot" style="--i:3">${cardHead(t("今日早鸟", "Early birds"), icons.sunrise, `<span class="community-muted">${t("前 10 名得“早鸟”徽章", "The first ten get the Early bird badge")}</span>`)}${early}</section>`
    + (data.owner ? "" : `<section class="community-card community-span-2 community-rv community-spot" style="--i:4">${cardHead(t("签到徽章", "Check-in badges"), icons.award, data.uid ? moreLink(memberHref(data.uid, "badges"), t("我的徽章", "My badges"), icons) : moreLink(stardustHref(), t("我的星尘", "My stardust"), icons))}<div class="community-badge-row is-large">${communityCheckinBadges.map((id) => badgeHTML(id, owned.has(id), common, "md", true)).join("")}</div></section>`) + `</div>`
    + `</section>`;
}

/* ---------- 星尘 ---------- */
const reasonLabels: Record<string, [string, string]> = {
  initial: ["初始星尘", "Initial stardust"], checkin: ["签到", "Check-in"], topic: ["发主题", "New topic"], reply: ["有效回复", "Reply"], like: ["收到赞", "Like received"],
  accepted: ["回答被采纳", "Accepted answer"], featured: ["被评为精华", "Featured"], report: ["举报成立", "Report upheld"],
  "thank-in": ["收到感谢", "Thanks received"], "thank-out": ["感谢他人", "Thanks given"], revert: ["内容删除，收回", "Taken back"],
  penalty: ["违规扣除", "Penalty"], makeup: ["补签", "Make-up"], shop: ["兑换", "Exchange"], refund: ["兑换取消，退回", "Refund"],
  unlock: ["解锁提示词", "Prompt unlocked"], "unlock-in": ["提示词被解锁", "Prompt sold"], "bounty-freeze": ["悬赏冻结", "Bounty set aside"],
  bounty: ["获得悬赏", "Bounty won"], "bounty-refund": ["悬赏退回一半", "Bounty half back"], pin: ["付费推荐", "Paid recommendation"],
};
const reviewReasonLabels: Record<string, [string, string]> = {
  "广告引流": ["广告引流", "advertising or lead generation"],
  "留联系方式": ["留联系方式", "contact details"],
  "与版块无关": ["与版块无关", "off-topic content"],
  "重复内容": ["重复内容", "duplicate content"],
  "其他": ["其他", "other"],
};
function ledgerHTML(data: CommunityStardust, { t, esc }: Common) {
  const rows = data.ledger.length
    ? data.ledger.map((row) => {
      const [zh, en] = reasonLabels[row.reason] || [row.reason, row.reason];
      const title = row.topic ? ` · <a class="community-ledger-title" title="${esc(row.topic.title)}" href="${postHref(row.topic.id)}">${esc(row.topic.title)}</a>` : row.detail ? ` · ${esc(row.detail)}` : "";
      return `<tr${row.reverted ? ` class="is-reverted"` : ""}><td class="is-mono">${esc(beijingTime(row.createdAt))}</td><td>${t(zh, en)}${title}${row.reverted ? `<span class="community-muted">${t("（已收回）", " (taken back)")}</span>` : ""}</td><td class="is-right is-mono ${row.amount > 0 ? "is-plus" : "is-minus"}">${row.amount > 0 ? "+" : "−"}${Math.abs(row.amount)}</td></tr>`;
    }).join("")
    : `<tr><td colspan="3" class="community-muted">${t("没有记录", "Nothing yet")}</td></tr>`;
  const flows: Array<[CommunityFlow, string]> = [["all", t("全部", "All")], ["in", t("收入", "In")], ["out", t("支出", "Out")]];
  return `<section class="community-card"><div class="community-card-h"><dl class="community-sum-row"><div><dt>${t("本月收入", "In this month")}</dt><dd class="is-plus">+${data.month.gained}</dd></div><div><dt>${t("本月支出", "Out this month")}</dt><dd class="is-minus">−${data.month.spent}</dd></div></dl>`
    + `<div class="community-seg is-small" role="group" aria-label="${t("筛选", "Filter")}">${flows.map(([id, label]) => `<button type="button" data-action="community-flow" data-flow="${id}" aria-pressed="${data.flow === id}">${label}</button>`).join("")}</div></div>`
    + `<div class="community-table-wrap community-ledger-wrap"><table class="community-table community-ledger"><thead><tr><th>${t("时间", "Time")}</th><th>${t("事由", "Reason")}</th><th class="is-right">${t("星尘", "Stardust")}</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// 等级环：L0–L3 四个同心圆；下一级的进度画在它的圆上。
function levelRingsHTML(level: number, owner: boolean, progress: CommunityLevelProgress | null, t: Translate) {
  const current = owner ? 4 : level;
  const fraction = progress ? progress.rows.reduce((sum, row) => sum + Math.min(1, row.have / row.need), 0) / progress.rows.length : 1;
  const base = 36, step = 27;
  const rings = communityLevels.slice(0, 4).map((item) => `<circle class="community-lr is-lv${item.lv}${item.lv <= current ? " is-on" : ""}${item.lv === current ? " is-current" : ""}" r="${base + item.lv * step}"/>`).join("");
  const labels = communityLevels.slice(0, 4).map((item) => `<text class="community-lr-t is-lv${item.lv}${item.lv <= current ? " is-on" : ""}" y="${-(base + item.lv * step) + 3.5}">${t(item.name, item.en)}</text>`).join("");
  const arc = progress ? `<circle class="community-lr-prog is-lv${progress.next}" r="${base + progress.next * step}" pathLength="100" style="--p:${Math.round(fraction * 100)}" transform="rotate(-90)"/>` : "";
  const name = owner ? t("站长", "Owner") : communityLevelName(current, t);
  return `<svg class="community-lv-rings" viewBox="-170 -170 340 340" role="img" aria-label="${t(`等级：${name}${progress ? `，升到下一级完成 ${Math.round(fraction * 100)}%` : ""}`, `Level: ${name}${progress ? `, ${Math.round(fraction * 100)}% to the next` : ""}`)}">`
    + `<circle class="community-lr-core" r="22"/>${rings}${arc}${labels}<text class="community-lr-center" y="6">${name}</text></svg>`;
}

function levelsHTML(data: CommunityStardust, common: Common) {
  const { t, esc } = common;
  const current = data.owner ? 4 : data.level;
  const progress = data.progress;
  const next = progress ? communityLevels[progress.next] : null;
  const rows = progress && next
    ? `<p class="community-muted">${t(`升到「${next.name}」还需要：`, `To reach ${next.en}:`)}</p>` + progress.rows.map((row) => `<div class="community-prog-row"><div class="community-meter-row"><span>${t(row.label, row.labelEn)}</span><span class="is-mono">${row.have} / ${row.need}</span></div><div class="community-meter is-lv${progress.next}"><i style="width:${Math.min(100, Math.round(row.have / row.need * 100))}%"></i></div></div>`).join("")
      + (progress.clean ? "" : `<p class="community-muted is-warn">${t(`还需要最近 ${progress.next === 2 ? 30 : 180} 天没有违规。`, `Also needs no violation in the last ${progress.next === 2 ? 30 : 180} days.`)}</p>`)
      + `<p class="community-muted">${t("等级每天第一次访问时按条件重算。签到只算“来过一天”，不影响其他条件。", "Levels are recalculated on your first visit each day. A check-in counts as a visit, nothing more.")}</p>`
    : `<p class="community-muted">${data.owner ? t("站长拥有全部管理权限。", "The owner can do everything.") : current >= 4 ? t("协管由站长任命。", "Stewards are appointed by the owner.") : t("你已经到了最高的自动等级。条件不满足时会掉回观测。", "This is the highest automatic level. It falls back to Observer when the conditions lapse.")}</p>`;
  const ladder = communityLevels.slice(0, 4).map((item) => {
    const rules = item.lv === 0 ? [t("注册即是", "Every new account")] : item.lv === 4 ? []
      : communityLevelRules[item.lv as 1 | 2 | 3].map((rule) => rule.key === "honor" ? t(rule.label, rule.labelEn) : `${t(rule.label, rule.labelEn)} ≥ ${rule.need}`).concat(item.lv === 2 ? [t("30 天内没有违规", "No violation in 30 days")] : item.lv === 3 ? [t("180 天内没有处罚", "No penalty in 180 days")] : []);
    const perks = (communityLevelPerks[item.lv] || []).map(([zh, en]) => t(zh, en));
    const here = item.lv === current && !data.owner;
    return `<div class="community-rung community-spot is-lv${item.lv}${here ? " is-current" : ""}"><div class="community-rung-name"><b>${t(item.name, item.en)}</b><span>L${item.lv} · ${item.en}</span>${here ? `<span class="community-you">${t("你在这里", "You are here")}</span>` : ""}</div>`
      + `<div><h3>${t("怎么到", "How")}</h3><ul>${rules.map((rule) => `<li>${esc(rule)}</li>`).join("")}</ul></div><div><h3>${t("能做 / 限制", "Can do / limits")}</h3><ul>${perks.map((perk) => `<li>${esc(perk)}</li>`).join("")}</ul></div></div>`;
  }).join("");
  return `<div class="community-pt-grid"><section class="community-card community-span-2 community-lv-hero community-spot">${levelRingsHTML(data.level, data.owner, progress, t)}`
    + `<div class="community-lv-prog"><div class="eyebrow">TRUST LEVEL</div><h2 class="community-lv-big is-lv${current}">${data.owner ? t("站长", "Owner") : communityLevelName(current, t)}</h2><p class="community-muted">${data.owner ? "" : `L${current} · ${communityLevels[current].en}`}</p>${rows}</div></section>`
    + `<section class="community-span-2 community-ladder">${ladder}<section class="community-card community-role-card"><h2>${t("角色：协管", "Role: Steward")}</h2><ul><li>${t("由站长任命", "Appointed by the owner")}</li><li>${t("可审核、置顶、移动和锁帖", "Can review, recommend, move and lock topics")}</li><li>${t("所有操作写入审计日志", "Every action is recorded in the audit log")}</li></ul></section></section>`
    + `<p class="community-aside-note community-span-2">${t("<b>VIP 是另一条线</b>：昵称旁有 VIP 标识，签到每天多 2 星尘，每月多一次补签，第一次免费，可以进会员茶室；但 VIP 不影响等级，也不影响审核权。", "<b>VIP is separate</b>: a VIP mark, 2 more stardust a day, one more make-up a month (the first free) and the Members board. It does not change levels or moderation rights.")}</p></div>`;
}

function stardustRulesHTML({ t, icons = {} }: Common) {
  const r = communityRules;
  const earn: Array<[string, string, string]> = [
    [t("签到", "Check-in"), `+${r.checkinBase}（VIP +${r.checkinBase + r.vipBonus}）`, t(`每天 1 次；每满 7 天额外 +${r.weekBonus}，第 30 天额外 +${r.cycleBonus}`, `Daily; +${r.weekBonus} every 7 days, +${r.cycleBonus} on day 30`)],
    [t("发主题", "New topic"), `+${r.topicReward}`, t(`每天前 ${r.topicDaily} 个；审核通过才入账`, `First ${r.topicDaily} a day; after review if needed`)],
    [t("有效回复", "Reply"), `+${r.replyReward}`, t(`每天 ${r.replyDaily} 次；${r.replyMinLength} 字以上，不在自己帖里`, `${r.replyDaily} a day; ${r.replyMinLength}+ characters, not on your own topic`)],
    [t("收到赞", "Like received"), `+${r.likeReward}`, t(`每天 ${r.likeDaily} 次；同一人每天只算一次；点赞的人要巡天以上`, `${r.likeDaily} a day; once a day per person; from Survey level up`)],
    [t("回答被采纳", "Accepted answer"), `+${r.acceptReward}`, t("另得悬赏额", "Plus any bounty")],
    [t("被评为精华", "Featured"), `+${r.featureReward}`, t("站长操作", "By the owner")],
    [t("举报成立", "Report upheld"), `+${r.reportReward}`, t(`每天 ${r.reportDaily} 次`, `${r.reportDaily} a day`)],
  ];
  const spend: Array<[string, string, string]> = [
    [t("感谢", "Thanks"), String(r.thankCost), t(`作者得 ${r.thankToAuthor}，销毁 ${r.thankCost - r.thankToAuthor}`, `${r.thankToAuthor} to the author, ${r.thankCost - r.thankToAuthor} burned`)],
    [t("悬赏提问", "Bounty"), r.bountyOptions.join(" / "), t(`给被采纳者；${r.bountyDays} 天没人采纳退回一半`, `To the accepted answer; half back after ${r.bountyDays} days`)],
    [t("解锁提示词", "Unlock a prompt"), `${r.unlockMin}–${r.unlockMax}`, t("作者定价，作者得 80%", "Set by the author, who gets 80%")],
    [t("补签", "Make-up"), String(r.makeupCost), t("销毁；每月 2 次", "Burned; twice a month")],
    [t("推荐 24 小时", "Recommend, 24 h"), String(r.pinCost), t("销毁；作品帖和资源帖", "Burned; works and resources")],
    [t("兑换所", "Exchange"), "30–300", t("销毁", "Burned")],
  ];
  const table = (head: string[], rows: Array<[string, string, string]>, flow: "in" | "out" = "in") => `<div class="community-table-wrap"><table class="community-table"><thead><tr>${head.map((cell, i) => `<th${i === 1 ? ' class="is-right"' : ""}>${cell}</th>`).join("")}</tr></thead><tbody>${rows.map(([a, b, c]) => `<tr><td>${a}</td><td class="is-right is-mono ${flow === "in" ? "is-plus" : "is-minus"}">${b}</td><td>${c}</td></tr>`).join("")}</tbody></table></div>`;
  return `<div class="community-pt-grid">`
    + `<section class="community-card">${cardHead(t("怎么挣", "Earning"))}${table([t("行为", "What"), t("星尘", "Stardust"), t("限制", "Limits")], earn)}<p class="community-muted">${t(`行为类（发帖、回复、收赞、采纳、举报）每人每天最多 ${r.dailyCap}。`, `Activity rewards stop at ${r.dailyCap} a day.`)}</p></section>`
    + `<section class="community-card">${cardHead(t("怎么花", "Spending"))}${table([t("用途", "What"), t("星尘", "Stardust"), t("去向", "Where it goes")], spend, "out")}</section>`
    + `<section class="community-card community-span-2">${cardHead(t("防刷规则", "Fair play"))}<ul class="community-ticks">`
    + [t(`所有星尘变动都记在流水里，内容被删会按流水收回，违规再扣 ${r.penalty}，余额最低到 0。`, `Every change is in the ledger; removed content gives its stardust back, a violation costs ${r.penalty} more, and balances stop at 0.`),
      t("初光等级用户的点赞和感谢不会给别人带来星尘。", "Likes and thanks from First light members give no stardust."),
      t("星尘买不到等级；VIP 也不影响等级。", "Stardust cannot buy levels; neither can VIP."),
      t("数值是上线初始值，站长会按实际情况调整，调整前会在站务反馈里公告。", "The numbers may be adjusted; changes are announced in the Meta board first.")].map((line) => `<li>${icons.check || ""}${line}</li>`).join("")
    + `</ul></section></div>`;
}

export function communityStardustHTML({ stardust, tab, ...common }: Common & { stardust: CommunityLoad<CommunityStardust>; tab: string }) {
  const { t, esc, icons = {} } = common;
  const data = readyData(stardust);
  if (!data) return pageOf("stardust", common, stardust);
  const tabs: Array<[string, string]> = [[stardustHref(), t("明细", "Ledger")], [stardustHref("levels"), t("等级", "Levels")], [stardustHref("rules"), t("规则", "Rules")]];
  const index = String(["ledger", "levels", "rules"].indexOf(tab));
  const body = tab === "levels" ? levelsHTML(data, common) : tab === "rules" ? stardustRulesHTML(common) : ledgerHTML(data, common);
  const text = t(`今天获得 <b>${data.gainedToday}</b> 星尘，行为星尘 <b>${data.behaviourToday} / ${data.dailyCap}</b>。${data.owner || data.checkedIn ? "" : "今天还没签到。"}`, `+<b>${data.gainedToday}</b> today; <b>${data.behaviourToday} / ${data.dailyCap}</b> from activity.${data.owner || data.checkedIn ? "" : " Not checked in yet."}`);
  return `<section class="page community-page" data-community="stardust" data-tab="${esc(tab)}">`
    + bannerHTML({ eyebrow: "STARDUST", title: t("我的星尘", "My stardust"), text, esc, html: true, side: statsHTML([[t("余额", "Balance"), data.balance]]) + (data.checkedIn || data.owner ? "" : `<a class="community-button is-gold is-small" href="#/community/checkin">${icons.calendar || ""}${t("去签到", "Check in")}</a>`) })
    + tabsHTML(tabs, index, t("星尘", "Stardust"), `<a class="community-tab-go" href="${shopHref()}">${icons.box || ""}${t("兑换所", "Exchange")}</a>`)
    + `<div class="community-rv" style="--i:2">${body}</div></section>`;
}

/* ---------- 兑换所 ---------- */
const limitText = (item: ShopItem, t: Translate) => !item.limit ? "" : item.limit.per === "once" ? t("限兑 1 次", "Once only")
  : item.limit.per === "year" ? t(`每年限 ${item.limit.n} 次`, `${item.limit.n} a year`) : t(`每月限 ${item.limit.n} 次`, `${item.limit.n} a month`);
const cardIcons: Record<string, string> = { makeup: "calendar", pin: "pin", highlight: "sparkles" };
// 物品的样子：头像框套在你的头像上，昵称颜色写你的名字，道具卡是一张闪卡，资源是一份文件，实物是一个包裹。
function itemArtHTML(item: ShopItem, me: CommunityPerson | null, inventory: CommunityInventory | null, common: Common) {
  const { t, esc, icons = {} } = common;
  const sample: CommunityPerson = { name: t("林间", "Lin"), role: "reader", uid: null, avatar: null };
  const ref = item.ref && /^[a-z]+$/.test(item.ref) ? item.ref : "";
  if (item.kind === "frame") return `<span class="community-sart"><span class="community-av community-av-xl community-shop-avatar is-frame-${ref}" aria-hidden="true"><span>人</span></span></span>`;
  if (item.kind === "color") return `<span class="community-sart"><span class="community-nc-sample is-color-${ref}">${esc(sample.name)}</span><small>${t("在帖子、回复、排行榜里显示", "Shown in posts, replies and rankings")}</small></span>`;
  if (item.kind === "cover") return `<span class="community-sart"><span class="community-cover-sample is-cover-${ref}"><i></i><i></i></span></span>`;
  if (item.kind === "card") {
    const have = inventory && ref in inventory ? inventory[ref as keyof CommunityInventory] : 0;
    return `<span class="community-sart"><span class="community-holo"><span class="community-holo-ic">${icons[cardIcons[ref] || "star"] || ""}</span><b>${esc(item.name)}</b><small>CARD</small></span>${have ? `<span class="community-have">${t(`背包里有 ${have} 张`, `${have} in your bag`)}</span>` : ""}</span>`;
  }
  if (item.kind === "digital") return `<span class="community-sart"><span class="community-file"><i class="community-file-fold"></i><span class="community-file-lines"><i></i><i></i><i></i></span><b>${esc(item.name)}</b></span></span>`;
  return `<span class="community-sart"><span class="community-goods">${icons.package || ""}</span></span>`;
}

function redeemButtonHTML(item: CommunityShopItem, decorations: CommunityDecorations, { t, esc, icons = {} }: Common) {
  if (item.state.owned) {
    if (item.kind === "digital") return `<button type="button" class="community-button is-small" data-action="community-delivery" data-id="${esc(item.id)}">${icons.eye || ""}${t("查看", "View")}</button>`;
    if (item.kind === "frame" || item.kind === "color" || item.kind === "cover") {
      return decorations[item.kind] === item.ref
        ? `<button type="button" class="community-button is-small is-done" data-action="community-equip" data-kind="${item.kind}" data-ref="">${icons.check || ""}${t("使用中", "In use")}</button>`
        : `<button type="button" class="community-button is-small is-line-gold" data-action="community-equip" data-kind="${item.kind}" data-ref="${esc(item.ref || "")}">${t("换上", "Use")}</button>`;
    }
  }
  if (item.state.ok) return `<button type="button" class="community-button is-gold is-small" data-action="community-redeem" data-id="${esc(item.id)}">${icons.star || ""}${t("兑换", "Redeem")}</button>`;
  return `<button type="button" class="community-button is-small" disabled>${esc(item.state.why)}</button>`;
}

function shopCardHTML(item: CommunityShopItem, shop: CommunityShop, me: CommunityPerson | null, common: Common, i: number, showPrice = true) {
  const { t, esc, icons = {} } = common;
  const tags = [limitText(item, t), item.minLevel ? t(`${communityLevels[item.minLevel].name}以上`, `${communityLevels[item.minLevel].en} and up`) : "", item.minDays ? t(`注册满 ${item.minDays} 天`, `${item.minDays}+ days`) : "", item.note || ""].filter(Boolean);
  const left = item.state.left ?? 0;
  const stock = item.stock ? `<div class="community-stock"><div class="community-stock-row"><span>${t("库存", "Stock")}</span><span class="is-mono">${t(`剩 ${left} / ${item.stock}`, `${left} / ${item.stock} left`)}</span></div><div class="community-meter"><i style="width:${Math.round(left / item.stock * 100)}%"></i></div></div>` : "";
  const off = item.state.code === "soldout" || item.state.code === "closed";
  return `<article class="community-sitem community-spot community-rv${off ? " is-off" : ""}${item.state.owned ? " is-owned" : ""}" style="--i:${i + 2}">`
    + `<div class="community-sitem-art">${itemArtHTML(item, me, shop.inventory, common)}${item.state.owned ? `<span class="community-owned-tag">${icons.check || ""}${t("已拥有", "Owned")}</span>` : ""}</div>`
    + `<div class="community-sitem-body"><h3>${esc(item.name)}</h3><p>${esc(item.desc)}</p>`
    + (tags.length ? `<div class="community-stags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>` : "")
    + stock
    + `<div class="community-sitem-foot">${showPrice ? `<span class="community-price">${icons.star || ""}<b>${item.price}</b></span>` : ""}${redeemButtonHTML(item, shop.decorations, common)}</div></div></article>`;
}

// 兑换确认：写清花多少、剩多少；实物要填收货信息（只给站长看，发货或取消后删除）。
function redeemPanelHTML(item: CommunityShopItem, balance: number, me: CommunityPerson | null, inventory: CommunityInventory | null, common: Common) {
  const { t, esc } = common;
  const goods = item.kind === "goods";
  const fields = goods
    ? `<div class="community-field-grid">`
      + `<div class="community-field"><label class="community-field-l" for="community-ship-name">${t("收件人", "Recipient")}</label><input id="community-ship-name" name="name" type="text" autocomplete="shipping name" maxlength="30" required></div>`
      + `<div class="community-field"><label class="community-field-l" for="community-ship-phone">${t("手机号", "Mobile")}</label><input id="community-ship-phone" name="phone" type="tel" inputmode="tel" autocomplete="shipping tel" maxlength="20" required></div>`
      + `<div class="community-field community-span-2"><label class="community-field-l" for="community-ship-address">${t("收货地址", "Address")}</label><textarea id="community-ship-address" name="address" rows="2" autocomplete="shipping street-address" maxlength="200" required></textarea></div></div>`
      + `<p class="community-muted">${t("收货信息只给站长看，发货或取消后就会删除。只包邮到中国大陆。", "Only the owner sees this, and it is deleted once shipped or cancelled. Mainland China only.")}</p>`
    : "";
  return `<form class="community-panel community-redeem community-rv" data-community-form="redeem" data-id="${esc(item.id)}" novalidate>`
    + `<div class="community-redeem-row"><div class="community-redeem-art">${itemArtHTML(item, me, inventory, common)}</div><div class="community-redeem-text"><p class="community-panel-title">${t(`兑换「${esc(item.name)}」`, `Redeem “${esc(item.name)}”`)}</p><p class="community-muted">${t(`花 ${item.price} 星尘，兑换后剩 ${balance - item.price}。花掉的星尘会销毁，兑换后不能退回。`, `${item.price} stardust; ${balance - item.price} left afterwards. Spent stardust is burned and cannot be refunded.`)}</p></div></div>`
    + fields + `<p class="community-form-status" role="status" aria-live="polite"></p>`
    + `<div class="community-form-actions"><button type="button" class="community-button" data-action="community-redeem-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-gold">${t("确认兑换", "Redeem")}</button></div></form>`;
}

function deliveryPanelHTML(delivery: CommunityDelivery, { t, esc, icons = {} }: Common) {
  return `<section class="community-panel community-delivery" aria-labelledby="community-delivery-title"><p class="community-panel-title" id="community-delivery-title">${esc(delivery.name)}</p>`
    + `<pre class="community-delivery-text" data-delivery>${esc(delivery.delivery)}</pre>`
    + `<div class="community-form-actions"><button type="button" class="community-button" data-action="community-delivery-close">${t("关闭", "Close")}</button><button type="button" class="community-button is-gold" data-action="community-copy-delivery">${icons.copy || ""}${t("复制", "Copy")}</button></div></section>`;
}

type ShopOptions = Common & { shop: CommunityLoad<CommunityShop>; tab: string; me?: CommunityMe | null; redeeming?: string | null; delivery?: CommunityDelivery | null };
export function communityShopHTML({ shop, tab, me = null, redeeming = null, delivery = null, ...common }: ShopOptions) {
  const { t, esc, icons = {} } = common;
  const data = readyData(shop);
  if (!data) return pageOf("shop", common, shop);
  const cats = communityShopCats;
  const current = cats.some((cat) => cat.id === tab) ? tab : "all";
  const items = data.items.filter((item) => current === "all" || item.cat === current);
  const seg = `<nav class="community-seg community-shop-cats community-rv" style="--i:1" aria-label="${t("分类", "Categories")}">`
    + `<a href="${shopHref()}"${current === "all" ? ' aria-current="page"' : ""}>${t("全部", "All")}</a>`
    + cats.map((cat) => `<a href="${shopHref(cat.id)}"${current === cat.id ? ' aria-current="page"' : ""}>${t(cat.name, cat.en)}<span class="community-seg-n">${data.items.filter((item) => item.cat === cat.id).length}</span></a>`).join("") + `</nav>`;
  let i = 0;
  const grid = current === "all"
    ? cats.map((cat) => {
      const list = items.filter((item) => item.cat === cat.id);
      if (!list.length) return "";
      return `<section class="community-shop-sec"><div class="community-sec-h community-rv" style="--i:${i + 2}"><h2>${t(cat.name, cat.en)}</h2><p class="community-muted">${esc(t(cat.desc, cat.descEn))}</p></div><div class="community-shop-grid">${list.map((item) => shopCardHTML(item, data, me, common, i++)).join("")}</div></section>`;
    }).join("")
    : items.length ? `<div class="community-shop-grid">${items.map((item, n) => shopCardHTML(item, data, me, common, n)).join("")}</div>` : emptyHTML(common, t("这里还没有东西", "Nothing here yet"), t("站长上架以后就会出现在这里。", "Items appear here once the owner adds them."));
  const panelItem = redeeming ? data.items.find((item) => item.id === redeeming) : null;
  return `<section class="page community-page community-shop-page" data-community="shop" data-tab="${esc(current)}">`
    + bannerHTML({ eyebrow: "EXCHANGE", title: t("兑换所", "Exchange"), text: t("用星尘换装扮、道具卡、站长整理的资源和限量周边。花掉的星尘会销毁，兑换后不能退回。", "Trade stardust for looks, cards, resources from the owner and limited goods. Spent stardust is burned and cannot be refunded."), esc,
      side: statsHTML([[t("我的星尘", "My stardust"), data.balance]]) + `<a class="community-button is-small" href="${shopHref("mine")}">${icons.box || ""}${t("我的兑换", "My items")}</a>` })
    + seg
    + (panelItem ? redeemPanelHTML(panelItem, data.balance, me, data.inventory, common) : "")
    + (delivery ? deliveryPanelHTML(delivery, common) : "")
    + grid + `</section>`;
}

type MineOptions = Common & { mine: CommunityLoad<CommunityShopMine>; me?: CommunityMe | null; delivery?: CommunityDelivery | null };
export function communityShopMineHTML({ mine, me = null, delivery = null, ...common }: MineOptions) {
  const { t, esc, icons = {} } = common;
  const data = readyData(mine);
  const head = `<header class="community-page-head community-rv" style="--i:0"><div><nav class="community-crumb" aria-label="${t("位置", "Location")}"><a href="${shopHref()}">${t("兑换所", "Exchange")}</a>${icons["chevron-right"] || "›"}<span>${t("我的兑换", "My items")}</span></nav><h1>${t("我的兑换", "My items")}</h1></div>${data ? statsHTML([[t("剩余星尘", "Stardust left"), data.balance]]) : ""}</header>`;
  if (!data) return pageOf("shop", common, mine, head).replace('data-community="shop"', 'data-community="shop" data-tab="mine"');
  const cards = (["makeup", "pin", "highlight"] as const).map((ref) => {
    const count = data.inventory[ref];
    const name = { makeup: t("补签卡", "Make-up card"), pin: t("推荐卡", "Recommend card"), highlight: t("高亮卡", "Highlight card") }[ref];
    const use = { makeup: [ "#/community/checkin", t("去签到日历用", "Use in the calendar")], pin: [me?.uid ? memberHref(me.uid) : communityHomeHref, t("在自己的帖子里用", "Use on your post")], highlight: [me?.uid ? memberHref(me.uid) : communityHomeHref, t("在自己的帖子里用", "Use on your post")] }[ref];
    const item: ShopItem = { id: `card-${ref}`, cat: "card", kind: "card", ref, name, desc: "", price: 0, builtin: true };
    return `<div class="community-inv community-spot${count ? "" : " is-empty"}">${itemArtHTML(item, null, null, common)}<div class="community-inv-body"><b>${name}</b><span class="community-inv-n">× ${count}</span></div>`
      + (count ? `<a class="community-button is-small is-line-gold" href="${use[0]}">${use[1]}</a>` : `<a class="community-button is-small" href="${shopHref("card")}">${t("去兑换", "Get one")}</a>`) + `</div>`;
  }).join("");
  const looks = data.looks.length
    ? `<div class="community-shop-grid">${data.looks.map((item, i) => shopCardHTML({ ...item, active: true, state: { owned: true, left: null, ok: false, code: "owned", why: "" } }, { balance: data.balance, level: 0, owner: false, items: [], inventory: data.inventory, decorations: data.decorations }, me, common, i, false)).join("")}</div>`
    : emptyHTML(common, t("还没有装扮", "No looks yet"), t("去兑换所看看头像框和昵称颜色吧。", "See the frames and name colours in the exchange."), `<a class="community-button is-gold" href="${shopHref("look")}">${t("去看看", "Take a look")}</a>`);
  const files = data.digital.length
    ? `<ul class="community-orders">${data.digital.map((item) => `<li><span class="community-o-dot is-ok"></span><div class="community-o-main"><b>${esc(item.name)}</b><span class="community-muted">${esc(item.desc)}</span></div><button type="button" class="community-button is-small" data-action="community-delivery" data-id="${esc(item.id)}">${icons.eye || ""}${t("查看", "View")}</button></li>`).join("")}</ul>` : "";
  const status: Record<string, [string, string, string]> = { done: [t("已到账", "Done"), "ok", ""], pending: [t("待发货", "To ship"), "wait", ""], shipped: [t("已发货", "Shipped"), "ship", ""], cancelled: [t("已取消，已退回", "Cancelled, refunded"), "off", ""] };
  const orders = data.orders.length
    ? `<ol class="community-orders">${data.orders.map((order) => { const [label, cls] = status[order.status] || [order.status, "off"]; return `<li><span class="community-o-dot is-${cls}"></span><div class="community-o-main"><b>${esc(order.itemName)}</b><span class="community-muted">${esc(beijingTime(order.createdAt, true))}</span>${order.tracking?.number ? `<span class="community-order-tracking">${esc(order.tracking.company)} · ${esc(order.tracking.number)}</span>` : ""}</div><span class="community-o-price is-mono">−${order.price}</span><span class="community-o-st is-${cls}">${label}</span></li>`; }).join("")}</ol>`
    : emptyHTML(common, t("还没有兑换过", "Nothing redeemed yet"), "", `<a class="community-button is-gold" href="${shopHref()}">${t("去兑换所", "Go to the exchange")}</a>`);
  return `<section class="page community-page community-shop-page" data-community="shop" data-tab="mine">${head}`
    + (delivery ? deliveryPanelHTML(delivery, common) : "")
    + `<section class="community-rv" style="--i:1"><div class="community-sec-h"><h2>${t("道具卡", "Cards")}</h2><p class="community-muted">${t("用的时候自动扣一张。", "One is used each time.")}</p></div><div class="community-inv-grid">${cards}</div></section>`
    + `<section class="community-rv" style="--i:2"><div class="community-sec-h"><h2>${t("装扮", "Looks")}</h2><p class="community-muted">${t("点“换上”马上生效，大家看到的你就变了。", "“Use” applies at once for everyone.")}</p></div>${looks}</section>`
    + (files ? `<section class="community-rv" style="--i:3"><div class="community-sec-h"><h2>${t("数字资源", "Digital")}</h2></div>${files}</section>` : "")
    + `<section class="community-rv" style="--i:4"><div class="community-sec-h"><h2>${t("兑换记录", "History")}</h2></div>${orders}</section></section>`;
}

/* ---------- 排行 ---------- */
export function communityRankHTML({ rank, me = null, ...common }: Common & { rank: CommunityLoad<CommunityRank>; me?: CommunityMe | null }) {
  const { t, esc, icons = {} } = common;
  const data = readyData(rank);
  if (!data) return pageOf("rank", common, rank);
  const mine = (person: CommunityPerson) => Boolean(me?.uid && person.uid === me.uid);
  const minutes = (at: string) => { const [h, m] = beijingTime(at).slice(6).split(":").map(Number); return h * 60 + m; };
  const bars = <T extends { person: CommunityPerson }>(rows: T[], text: (row: T) => string, value: (row: T) => number) => {
    const max = Math.max(1, ...rows.map(value));
    return rows.length
      ? `<ol class="community-rank community-rank-bars">${rows.map((row, i) => `<li class="${mine(row.person) ? "is-me" : ""}" style="--w:${Math.round(value(row) / max * 100)}%;--i:${i}"><span class="community-hot-rank${i < 3 ? " is-top" : ""}">${i + 1}</span>${avatarHTML(row.person, common, "sm")}${whoHTML(row.person, common)}<span class="community-rank-count">${text(row)}</span></li>`).join("")}</ol>`
      : `<p class="community-muted">${t("还没有人", "Nobody yet")}</p>`;
  };
  const lead = data.contributions[0];
  return `<section class="page community-page" data-community="rank">`
    + bannerHTML({ eyebrow: "LEADERBOARD", title: t("排行榜", "Ranking"), text: t("按收到的赞、被采纳和精华算本月贡献，另有连签榜和今日早鸟。签到不算贡献，星尘余额不排榜。", "This month's contribution counts likes, accepted answers and featured posts; there are also streaks and today's early birds. Check-ins and balances are not ranked."), esc,
      side: lead ? `<div class="community-banner-lead">${avatarHTML(lead.person, common, "md")}<div><span class="community-muted">${t("本月第一", "Top this month")}</span><b>${esc(lead.person.name)}</b></div></div>` : "" })
    + `<div class="community-rank-grid">`
    + `<section class="community-card community-spot community-rv" style="--i:2">${cardHead(t("本月贡献", "This month"), icons.trophy)}<p class="community-muted">${t("收到的赞 + 被采纳 ×5 + 精华 ×10", "Likes + accepted ×5 + featured ×10")}</p>${bars(data.contributions, (row) => String(row.score), (row) => row.score)}</section>`
    + `<section class="community-card community-spot community-rv" style="--i:3">${cardHead(t("连签榜", "Streaks"), icons.calendar)}<p class="community-muted">${t("当前连续签到天数", "Current check-in streaks")}</p>${bars(data.streaks, (row) => t(`${row.streak} 天`, `${row.streak} d`), (row) => row.streak)}</section>`
    + `<section class="community-card community-spot community-rv" style="--i:4">${cardHead(t("今日早鸟", "Early birds"), icons.sunrise)}<p class="community-muted">${t("今天最早签到的 10 个人", "The first ten today")}</p>${bars(data.early, (row) => esc(beijingTime(row.at).slice(6)), (row) => Math.max(1, 1440 - minutes(row.at)))}</section>`
    + `</div></section>`;
}

/* ---------- 成员主页 ---------- */
// 禁言：天数和原因都从固定选项里选。
function mutePanelHTML(uid: string, { t, esc }: Common) {
  return `<form class="community-panel is-danger community-rv" data-community-form="mute" data-uid="${esc(uid)}" novalidate>`
    + `<p class="community-panel-title">${t("禁言这个成员", "Mute this member")}</p>`
    + `<fieldset class="community-inline-choices"><legend class="community-field-l">${t("天数", "Days")}</legend>${[1, 7, 30].map((days, i) => `<label><input type="radio" name="days" value="${days}"${i === 0 ? " checked" : ""}><span>${t(`${days} 天`, `${days} d`)}</span></label>`).join("")}</fieldset>`
    + `<fieldset class="community-choices"><legend class="community-field-l">${t("原因", "Reason")}</legend><div class="community-radio-list">${communityReportReasons.map((reason) => `<label><input type="radio" name="reason" value="${esc(reason)}" required><span>${esc(reason)}</span></label>`).join("")}</div></fieldset>`
    + `<p class="community-form-status" role="status" aria-live="polite"></p>`
    + `<div class="community-form-actions"><button type="button" class="community-button" data-action="community-mute-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-danger">${t("确认禁言", "Mute")}</button></div></form>`;
}

type MemberOptions = Common & { member: CommunityLoad<CommunityMember>; me?: CommunityMe | null; muting?: boolean };
export function communityMemberHTML({ member, me = null, muting = false, ...common }: MemberOptions) {
  const { t, esc, now = Date.now(), icons = {} } = common;
  const data = readyData(member);
  if (!data) return pageOf("member", common, member);
  const { person, stats } = data;
  const uid = person.uid || "";
  const days = data.joinedAt ? Math.max(1, Math.round((now - Date.parse(data.joinedAt)) / 86400e3)) : 0;
  const tabs: Array<[string, string, number?]> = [
    [memberHref(uid), t(`主题 ${data.counts.topics}`, `Topics ${data.counts.topics}`)],
    [memberHref(uid, "replies"), t(`回复 ${data.counts.replies}`, `Replies ${data.counts.replies}`)],
    [memberHref(uid, "badges"), t(`徽章 ${data.badges.length}`, `Badges ${data.badges.length}`)],
    ...(data.self ? [[memberHref(uid, "bookmarks"), t(`收藏 ${data.counts.bookmarks}`, `Bookmarks ${data.counts.bookmarks}`)] as [string, string]] : []),
  ];
  const index = String(["topics", "replies", "badges", "bookmarks"].indexOf(data.tab));
  let body: string;
  if (data.tab === "replies") body = data.replies.length
    ? `<ul class="community-rep-list">${data.replies.map((reply) => `<li><a class="community-rep-ref" href="${postHref(reply.topicId)}">${esc(reply.topicTitle)}</a><div class="community-text is-small">${communityBodyHTML(reply.body, esc)}</div><span class="community-muted">${relativeTime(reply.createdAt, now, t)} · ${t(`${reply.likes} 赞`, `${reply.likes} likes`)}</span></li>`).join("")}</ul>`
    : emptyHTML(common, t("还没有回复过", "No replies yet"));
  else if (data.tab === "badges") body = `<div class="community-badge-wall">${Object.keys(communityBadges).map((id) => { const has = data.badges.includes(id); const badge = communityBadges[id]; return `<div class="community-bw-item${has ? "" : " is-off"}">${badgeHTML(id, has, common, "lg")}<b>${esc(t(badge.name, badge.en))}</b><span class="community-muted">${esc(t(badge.desc, badge.descEn))}</span></div>`; }).join("")}</div>`;
  else if (data.tab === "bookmarks") body = data.bookmarks.length ? communityTopicsHTML(data.bookmarks, common, { showAuthor: false }) : emptyHTML(common, t("还没有收藏", "No bookmarks yet"), t("在帖子下面点“收藏”，就会出现在这里。", "Use “Bookmark” under a post to keep it here."));
  else body = data.topics.length ? communityTopicsHTML(data.topics, common, { showAuthor: false }) : emptyHTML(common, t("还没有发过主题", "No topics yet"));
  const actions = [
    data.self ? `<a class="community-button is-small" href="#/account" data-reader-return>${icons.pen || ""}${t("编辑资料", "Edit profile")}</a>` : "",
    !data.self && me && person.role === "reader" ? `<button type="button" class="community-button is-small${data.following ? "" : " is-gold"}" data-action="community-follow" data-uid="${esc(uid)}" aria-pressed="${data.following}">${data.following ? t("已关注", "Following") : t("关注", "Follow")}</button>` : "",
    data.canMute && !data.muted ? `<button type="button" class="community-button is-small" data-action="community-mute" data-uid="${esc(uid)}">${icons.ban || ""}${t("禁言", "Mute")}</button>` : "",
    data.canAppoint ? `<button type="button" class="community-button is-small${data.steward ? "" : " is-line-gold"}" data-action="community-steward" data-uid="${esc(uid)}" data-on="${!data.steward}">${icons.shield || ""}${data.steward ? t("撤销协管", "Remove steward") : t("任命为协管", "Make steward")}</button>` : "",
  ].join("");
  const quick = data.quick ? `<div class="community-me-quick community-rv" style="--i:1">`
    + `<a href="${stardustHref()}"><span>${icons.star || ""}${t("我的星尘", "Stardust")}</span><b>${data.quick.balance}</b></a>`
    + (person.role === "owner" ? "" : `<a href="#/community/checkin"><span>${icons.calendar || ""}${t("签到", "Check-in")}</span><b>${data.quick.checkedIn ? t("今日已签", "Done today") : t("还没签到", "Not yet")}</b></a>`)
    + `<a href="${inboxHref()}"><span>${icons.bell || ""}${t("通知", "Notifications")}</span><b>${t(`${data.quick.unread} 未读`, `${data.quick.unread} unread`)}</b></a>`
    + `<a href="${stardustHref("levels")}"><span>${icons.trending || ""}${t("等级", "Level")}</span><b>${person.role === "owner" ? t("站长", "Owner") : communityLevelName(person.steward ? 4 : person.level ?? 0, t)}</b></a>`
    + `<a href="${shopHref("mine")}"><span>${icons.box || ""}${t("我的兑换", "My items")}</span><b>${t(`${data.quick.orders} 件`, `${data.quick.orders}`)}</b></a>`
    + (me?.mod ? `<a href="${manageHref()}"><span>${icons.shield || ""}${t("社区管理", "Moderation")}</span><b>${t("进入", "Open")}</b></a>` : "")
    + `</div>` : "";
  const cover = data.cover && /^[a-z]+$/.test(data.cover) ? ` is-cover-${data.cover}` : "";
  const hue = [...person.name].reduce((sum, char) => sum + (char.codePointAt(0) || 0), 0) % 360;
  return `<section class="page community-page community-member" data-community="member" data-tab="${esc(data.tab)}">`
    + `<header class="community-m-hero community-rv" style="--i:0;--h:${hue}"><div class="community-m-cover${cover}" aria-hidden="true"><i></i><i></i></div>`
    + `<div class="community-m-id">${avatarHTML(person, common, "xl", false)}<div class="community-m-name"><h1 class="${person.color && /^[a-z]+$/.test(person.color) ? `is-color-${person.color}` : ""}">${esc(person.name)}</h1><div class="community-m-tags">${levelChipHTML(person, common)}${vipChipHTML(person)}${person.uid && person.showUid ? `<span class="community-muted is-mono">UID ${esc(person.uid)}</span>` : ""}</div>`
    + (data.bio ? `<p>${esc(data.bio)}</p>` : "") + `<p class="community-muted">${days ? t(`加入 ${days} 天`, `Joined ${days} days`) : ""}${days && data.streak ? " · " : ""}${data.streak ? t(`连签 ${data.streak} 天`, `${data.streak}-day streak`) : ""}</p></div>`
    + `<div class="community-m-acts">${actions}</div></div>`
    + `<dl class="community-m-stats"><div><dt>${t("主题", "Topics")}</dt><dd>${stats.topics}</dd></div><div><dt>${t("回复", "Replies")}</dt><dd>${stats.replies}</dd></div><div><dt>${t("收到的赞", "Likes")}</dt><dd>${stats.likes}</dd></div><div><dt>${t("被采纳", "Accepted")}</dt><dd>${stats.accepted}</dd></div><div><dt>${t("精华", "Featured")}</dt><dd>${stats.featured}</dd></div><div><dt>${t("关注者", "Followers")}</dt><dd>${data.follows.followers}</dd></div></dl></header>`
    + (data.muted ? `<div class="community-notice is-danger">${icons.ban || ""}<div><b>${t(`禁言到 ${beijingTime(data.muted.until, true)}`, `Muted until ${beijingTime(data.muted.until, true)}`)}</b><span>${t(`原因：${esc(data.muted.reason)}`, `Reason: ${esc(data.muted.reason)}`)}</span></div>${me?.mod && !data.self ? `<button type="button" class="community-button is-small" data-action="community-lift" data-id="${esc(data.muted.id)}">${t("解除禁言", "Lift")}</button>` : ""}</div>` : "")
    + (muting && data.canMute ? mutePanelHTML(uid, common) : "")
    + quick
    + tabsHTML(tabs, index, t("成员内容", "Member content"))
    + `<div class="community-rv" style="--i:3">${body}</div></section>`;
}

/* ---------- 通知 ---------- */
const noticeIcons: Record<string, string> = {
  reply: "reply", mention: "at", accept: "check", thank: "gift", unlock: "unlock", like: "like", feature: "award",
  system: "megaphone", level: "trending", badge: "award", review: "clock", penalty: "ban", follow: "users",
};
// 通知文字按类型和数据生成，中英文都有；站长名、物品名等来自数据，都先转义。
export function noticeTextHTML(item: CommunityNotice, { t, esc }: Common) {
  const data = item.data || {};
  const num = (key: string) => Number(data[key]) || 0;
  const str = (key: string) => typeof data[key] === "string" ? esc(data[key]) : "";
  switch (item.type) {
    case "reply": return data.kind === "quote" ? t("回复了你", "replied to you") : t("回复了你的主题", "replied to your topic");
    case "mention": return data.where === "reply" ? t("在回复里提到了你", "mentioned you in a reply") : t("在帖子里提到了你", "mentioned you in a post");
    case "like": {
      const what = data.what === "reply" ? t("回复", "reply") : t("主题", "topic");
      return item.count > 1 ? t(`等 ${item.count} 人赞了你的${what}`, `and ${item.count - 1} others liked your ${what}`) : t(`赞了你的${what}`, `liked your ${what}`);
    }
    case "accept": return t(`采纳了你的回答，+${num("amount")} 星尘`, `accepted your answer: +${num("amount")} stardust`);
    case "thank": return t(`感谢了你，+${num("amount")} 星尘`, `thanked you: +${num("amount")} stardust`);
    case "unlock": return t(`解锁了你的提示词，+${num("amount")} 星尘`, `unlocked your prompt: +${num("amount")} stardust`);
    case "feature": return t(`把你的主题评为精华，+${num("amount")} 星尘`, `featured your topic: +${num("amount")} stardust`);
    case "follow": return t("关注了你", "followed you");
    case "level": { const level = communityLevels[Math.max(0, Math.min(4, num("level")))]; return t(`你升到了「${level.name}」`, `You reached ${level.en}`); }
    case "badge": { const badge = communityBadges[String(data.badge || "")]; return badge ? t(`获得徽章「${badge.name}」`, `You earned the “${badge.en}” badge`) : esc(item.text); }
    case "review": {
      if (data.state === "rejected") {
        const [reasonZh, reasonEn] = reviewReasonLabels[String(data.reason || "其他")] || reviewReasonLabels["其他"];
        const title = typeof data.title === "string" ? esc(data.title) : "";
        const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : "";
        return t(`你的帖子《${title}》没有通过审核。理由：${reasonZh}${note ? `；补充：${esc(note)}` : ""}。有异议可以在站务反馈发帖。`, `Your post “${title}” was not approved. Reason: ${reasonEn}${note ? `; note: ${esc(note)}` : ""}. If you disagree, post in Meta.`);
      }
      return data.state === "approved" ? t("你的帖子通过了审核", "Your post was approved")
        : data.state === "queue" ? t("有新帖子等待审核", "A new post is waiting for review") : t("你的帖子正在等站长审核", "Your post is waiting for review");
    }
    case "penalty":
      if (num("days")) return t(`你被禁言 ${num("days")} 天：${str("reason")}`, `You were muted for ${num("days")} days: ${str("reason")}`);
      return data.what === "reply" ? t(`你的一条回复因违规被删除，扣 ${num("penalty")} 星尘`, `A reply of yours was removed for a violation (−${num("penalty")})`) : t(`你的帖子因违规被删除，扣 ${num("penalty")} 星尘`, `Your post was removed for a violation (−${num("penalty")})`);
    case "system":
      if (data.dead) return t("反馈你推荐的资源已失效，请检查链接", "says a resource you shared no longer works; please check the link");
      if (data.refund !== undefined) return t(`悬赏退回一半：+${num("refund")} 星尘`, `Half the bounty came back: +${num("refund")} stardust`);
      if (data.moved) return t(`你的帖子被移到了「${esc(boardName(String(data.moved), (zh) => zh))}」`, `Your post was moved to ${esc(boardName(String(data.moved), (_zh, en) => en))}`);
      if (data.report === "upheld") return t(`你的举报成立，+${num("amount")} 星尘`, `Your report was upheld: +${num("amount")} stardust`);
      if (data.report === "new") return t(`提交了一条举报${data.hidden ? "，内容已自动隐藏" : ""}`, `filed a report${data.hidden ? "; the content was hidden" : ""}`);
      if (data.order === "new") return t(`兑换了「${str("item")}」，等待发货`, `redeemed “${str("item")}”; it needs shipping`);
      if (data.order === "shipped") return t(`你兑换的「${str("item")}」已发货${str("tracking") ? `：${str("company")} ${str("tracking")}` : ""}`, `“${str("item")}” has shipped${str("tracking") ? `: ${str("company")} ${str("tracking")}` : ""}`);
      if (data.order === "cancelled") return t(`你兑换的「${str("item")}」已取消，${num("amount")} 星尘已退回`, `“${str("item")}” was cancelled; ${num("amount")} stardust refunded`);
      if (data.steward !== undefined) return data.steward ? t("你被任命为协管", "You are now a steward") : t("你的协管职务已撤销", "You are no longer a steward");
      if (data.lifted) return t("你的禁言已被提前解除", "Your mute was lifted early");
      return esc(item.text);
    default: return esc(item.text);
  }
}
export function noticeHref(item: CommunityNotice, me: CommunityMe | null) {
  if (item.link && /^#\/(community|post)\//.test(item.link)) return item.link;
  if (item.topicId) return postHref(item.topicId);
  if (item.type === "follow" && item.actor?.uid) return memberHref(item.actor.uid);
  if (item.type === "level") return stardustHref("levels");
  if (item.type === "badge" && me?.uid) return memberHref(me.uid, "badges");
  if (item.type === "system" && typeof item.data?.order === "string") return shopHref("mine");
  return "";
}

export function communityInboxHTML({ inbox, tab, me = null, ...common }: Common & { inbox: CommunityLoad<CommunityInbox>; tab: string; me?: CommunityMe | null }) {
  const { t, esc, now = Date.now(), icons = {} } = common;
  const data = readyData(inbox);
  const unread = data?.unread;
  const head = pageHead("INBOX", t("通知", "Notifications"), "", unread?.all ? `<button type="button" class="community-button is-small" data-action="community-read-all">${icons.check || ""}${t("全部标为已读", "Mark all read")}</button>` : "");
  const tabs: Array<[string, string, number?]> = [
    [inboxHref(), t("全部", "All"), unread?.all], [inboxHref("reply"), t("回复和 @", "Replies & mentions"), unread?.reply],
    [inboxHref("thanks"), t("采纳和感谢", "Thanks & likes"), unread?.thanks], [inboxHref("system"), t("系统", "System"), unread?.system],
  ];
  const index = String(["all", "reply", "thanks", "system"].indexOf(tab));
  const body = !data ? communityStatusHTML(inbox, common) : data.items.length
    ? `<ul class="community-notes community-rv" style="--i:2">${data.items.map((item) => {
      const href = noticeHref(item, me);
      return `<li><button type="button" class="community-note${item.read ? "" : " is-unread"}" data-action="community-notice" data-id="${esc(item.id)}" data-href="${esc(href)}">`
        + `<span class="community-note-ic is-${esc(item.type)}">${icons[noticeIcons[item.type] || "bell"] || ""}</span>`
        + (item.actor ? avatarHTML(item.actor, common, "sm", false) : "")
        + `<span class="community-note-main"><span class="community-note-t">${item.actor ? `<b>${esc(item.actor.name)}</b> ` : ""}${noticeTextHTML(item, common)}</span>${item.topicTitle ? `<span class="community-note-ref">${esc(item.topicTitle)}</span>` : ""}</span>`
        + `<time class="community-note-time" datetime="${esc(item.createdAt)}">${relativeTime(item.createdAt, now, t)}</time>${item.read ? "" : `<i class="community-udot" aria-label="${t("未读", "Unread")}"></i>`}</button></li>`;
    }).join("")}</ul>`
    : emptyHTML(common, t("没有通知", "No notifications"), t("这里很安静。", "All quiet."));
  return `<section class="page community-page community-narrow" data-community="inbox" data-tab="${esc(tab)}">${head}${tabsHTML(tabs, index, t("通知分类", "Notification types"))}${body}</section>`;
}

/* ---------- 公约 ---------- */
export function communityRulesHTML({ me = null, ...common }: Common & { me?: CommunityMe | null }) {
  const { t, icons = {} } = common;
  const rules: Array<[string, string, string, string]> = [
    ["作品标注工具和模型", "作品展廊的帖子必须写清楚用了哪些工具、哪个模型。提示词可以不公开，但不能假装是手绘。", "Name tools and models", "Showcase posts say which tools and models were used. Prompts may stay private, but AI work is never passed off as hand-made."],
    ["不用 AI 灌水", "可以用 AI 帮你整理想法，但不要批量生成回复刷存在感。一经发现，删除并扣回星尘。", "No AI filler", "AI can help you think, but do not flood threads with generated replies. They are removed and their stardust taken back."],
    ["不发盗版和引流", "不发破解软件、盗版资源；不留微信、QQ 等引流联系方式。推荐资源请附上官方链接。", "No piracy or lead-generation", "No cracked software or pirated material, and no WeChat, QQ or other contact details. Link official sources."],
    ["对事不对人", "可以不同意别人的观点，但不做人身攻击，不嘲讽新手。", "Discuss ideas, not people", "Disagree with ideas, not people. No personal attacks, no mocking newcomers."],
  ];
  const agree = me && !me.agreed
    ? `<div class="community-agree-bar"><span>${t("第一次发帖前需要同意社区公约。", "You agree to these before your first post.")}</span><button type="button" class="community-button is-gold" data-action="community-agree">${icons.check || ""}${t("我已阅读并同意", "I agree")}</button></div>`
    : me?.agreed ? `<p class="community-muted">${icons.check || ""}${t("你已经同意了社区公约。", "You have agreed to the guidelines.")}</p>` : "";
  return `<section class="page community-page community-narrow community-rules-page" data-community="rules">`
    + pageHead("GUIDELINES", t("社区公约", "Community guidelines"), t("v1 · 适用于無相社区的所有版块", "v1 · For every board of the community"))
    + `<ol class="community-rule-list community-rv" style="--i:1">${rules.map(([zh, text, en, textEn]) => `<li><h2>${t(zh, en)}</h2><p>${t(text, textEn)}</p></li>`).join("")}</ol>`
    + `<section class="community-card community-rv" style="--i:2">${cardHead(t("违规了会怎样", "If something goes wrong"))}<ul class="community-ticks">`
    + `<li>${icons.alert || ""}${t(`内容被删除：收回这条内容带来的星尘，再扣 ${communityRules.penalty}。`, `Removed content gives back its stardust and costs ${communityRules.penalty} more.`)}</li>`
    + `<li>${icons.alert || ""}${t("多次违规：禁言 1 天、7 天、30 天，情节严重的停用账号。", "Repeated violations: muted for 1, 7 or 30 days; serious cases lose the account.")}</li>`
    + `<li>${icons.check || ""}${t("觉得处理错了，可以在站务反馈里申诉。", "You can appeal in the Meta board.")}</li></ul></section>`
    + agree
    + `<p class="community-muted">${t(`星尘和等级的规则见 <a class="community-link-sm" href="${stardustHref("rules")}">星尘 · 规则</a>。`, `Stardust and levels: <a class="community-link-sm" href="${stardustHref("rules")}">Stardust · Rules</a>.`)}</p></section>`;
}

/* ---------- 社区管理 ---------- */
export type CommunityItemEditing = { id: string | null };
function itemFormHTML(item: CommunityManagedItem | null, { t, esc }: Common) {
  const cat = item?.cat === "digital" ? "digital" : item?.cat === "goods" ? "goods" : "goods";
  const field = (id: string, name: string, label: string, input: string) => `<div class="community-field"><label class="community-field-l" for="community-item-${id}">${label}</label>${input.replace("<INPUT", `<input id="community-item-${id}" name="${name}"`).replace("<TEXTAREA", `<textarea id="community-item-${id}" name="${name}"`).replace("<SELECT", `<select id="community-item-${id}" name="${name}" class="community-select"`)}</div>`;
  const per = item?.limit?.per || "";
  return `<form class="community-panel community-item-form community-rv" data-community-form="item" data-id="${esc(item?.id || "")}" novalidate>`
    + `<p class="community-panel-title">${item ? t(`编辑「${esc(item.name)}」`, `Edit “${esc(item.name)}”`) : t("上架新物品", "New item")}</p>`
    + (item ? `<input type="hidden" name="cat" value="${cat}">` : `<fieldset class="community-inline-choices"><legend class="community-field-l">${t("类别", "Kind")}</legend><label><input type="radio" name="cat" value="goods" checked><span>${t("实物周边", "Goods")}</span></label><label><input type="radio" name="cat" value="digital"><span>${t("数字资源", "Digital")}</span></label></fieldset>`)
    + `<div class="community-field-grid">`
    + field("name", "name", t("名称", "Name"), `<INPUT type="text" maxlength="30" required value="${esc(item?.name || "")}">`)
    + field("price", "price", t("价格（星尘）", "Price (stardust)"), `<INPUT type="number" min="1" max="100000" step="1" required value="${item?.price ?? ""}">`)
    + `<div class="community-span-2">${field("description", "description", t("说明", "Description"), `<TEXTAREA rows="2" maxlength="200" required>${esc(item?.desc || "")}</textarea>`)}</div>`
    + field("stock", "stock", t("库存（实物必填，数字资源留空表示不限）", "Stock (required for goods)"), `<INPUT type="number" min="0" max="100000" step="1" value="${item?.stock ?? ""}">`)
    + field("limit", "limitPer", t("每人限兑", "Per member"), `<SELECT>${[["", t("不限", "No limit")], ["month", t("每月", "Monthly")], ["year", t("每年", "Yearly")], ["once", t("只能一次", "Once")]].map(([value, label]) => `<option value="${value}"${per === value ? " selected" : ""}>${label}</option>`).join("")}</select>`)
    + field("limitn", "limitN", t("每期次数", "Times per period"), `<INPUT type="number" min="1" max="100" step="1" value="${item?.limit?.n ?? 1}">`)
    + field("level", "minLevel", t("最低等级", "Minimum level"), `<SELECT>${communityLevels.slice(0, 4).map((level) => `<option value="${level.lv}"${(item?.minLevel || 0) === level.lv ? " selected" : ""}>L${level.lv} ${t(level.name, level.en)}</option>`).join("")}</select>`)
    + field("days", "minDays", t("注册满多少天", "Account age (days)"), `<INPUT type="number" min="0" max="3650" step="1" value="${item?.minDays ?? 0}">`)
    + field("note", "note", t("备注（比如“包邮”）", "Note (e.g. free shipping)"), `<INPUT type="text" maxlength="60" value="${esc(item?.note || "")}">`)
    + `<div class="community-span-2">${field("delivery", "delivery", t("兑换后给出的内容（数字资源必填：下载链接和提取码等）", "What the member gets (required for digital: link and code)"), `<TEXTAREA rows="3" maxlength="2000">${esc(item?.delivery || "")}</textarea>`)}</div>`
    + `</div><label class="community-check"><input type="checkbox" name="active"${item?.active === false ? "" : " checked"}><span>${t("上架中", "Available")}</span></label>`
    + `<p class="community-form-status" role="status" aria-live="polite"></p>`
    + `<div class="community-form-actions"><button type="button" class="community-button" data-action="community-item-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-gold">${t("保存", "Save")}</button></div></form>`;
}

type ManageOptions = Common & { manage: CommunityLoad<CommunityManage>; tab: string; itemEditing?: CommunityItemEditing | null; shippingOrder?: string | null };
function shippingFormHTML(id: string, common: Common) {
  const { t, esc } = common;
  return `<form class="community-panel community-ship-panel" data-community-form="ship" data-id="${esc(id)}" novalidate><p class="community-panel-title">${t("填写快递信息（可选）", "Shipping details (optional)")}</p><div class="community-field-grid"><div class="community-field"><label class="community-field-l" for="community-ship-company">${t("快递公司", "Courier")}</label><input id="community-ship-company" name="company" type="text" maxlength="40" autocomplete="organization"></div><div class="community-field"><label class="community-field-l" for="community-ship-tracking">${t("快递单号", "Tracking number")}</label><input id="community-ship-tracking" name="tracking" type="text" maxlength="80" autocomplete="off"></div></div><p class="community-muted">${t("收件人、手机号和地址会在发货后删除，单号会保留。", "Recipient, phone and address are deleted after shipping; the tracking number is retained.")}</p><p class="community-form-status" role="status" aria-live="polite"></p><div class="community-form-actions"><button type="button" class="community-button" data-action="community-ship-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-good">${t("确认已发货", "Mark shipped")}</button></div></form>`;
}
function rejectPanelHTML(id: string, common: Common) {
  const { t, esc } = common;
  return `<form class="community-panel is-danger community-reject-panel" data-community-form="reject" data-id="${esc(id)}" novalidate><p class="community-panel-title">${t("审核不通过", "Reject post")}</p><fieldset><legend>${t("请选择理由", "Reason")}</legend><div class="community-radio-list">${communityReviewReasons.map(reason => { const labels = reviewReasonLabels[reason] || [reason, reason]; return `<label><input type="radio" name="reason" value="${esc(reason)}" required><span>${esc(t(labels[0], labels[1]))}</span></label>`; }).join("")}</div></fieldset><div class="community-field"><label class="community-field-l" for="community-reject-note">${t("补充说明（可选）", "Details (optional)")}</label><input id="community-reject-note" name="note" type="text" maxlength="200"></div><p class="community-form-status" role="status" aria-live="polite"></p><div class="community-form-actions"><button type="button" class="community-button" data-action="community-reject-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-danger">${t("确认不通过", "Reject")}</button></div></form>`;
}
export function communityManageHTML({ manage, tab, itemEditing = null, shippingOrder = null, rejecting = null, ...common }: ManageOptions & { rejecting?: string | null }) {
  const { t, esc, now = Date.now(), icons = {} } = common;
  const head = pageHead("MODERATION", t("社区管理", "Moderation"), t("只有站长和协管能看到这一页。所有操作会写进审计日志。", "Only the owner and stewards see this page. Every action is audited."));
  const data = readyData(manage);
  if (!data) return pageOf("manage", common, manage, head);
  const kpis = `<dl class="community-kpis community-rv" style="--i:1"><div><dt>${t("待审", "Queue")}</dt><dd${data.counts.queue ? ' class="is-warn"' : ""}>${data.counts.queue}</dd></div><div><dt>${t("待处理举报", "Open reports")}</dt><dd${data.counts.reports ? ' class="is-warn"' : ""}>${data.counts.reports}</dd></div><div><dt>${t("24 小时新主题", "Topics · 24 h")}</dt><dd>${data.kpis.topics24h}</dd></div><div><dt>${t("24 小时回复", "Replies · 24 h")}</dt><dd>${data.kpis.replies24h}</dd></div></dl>`;
  const all: Array<[string, string, string, number?]> = [
    ["queue", manageHref(), t("待审", "Queue"), data.counts.queue], ["reports", manageHref("reports"), t("举报", "Reports"), data.counts.reports],
    ...(data.owner ? [["orders", manageHref("orders"), t("兑换发货", "Orders"), data.counts.orders], ["items", manageHref("items"), t("兑换所上架", "Shop items")]] as Array<[string, string, string, number?]> : []),
    ["sanctions", manageHref("sanctions"), t("处罚记录", "Sanctions")], ["data", manageHref("data"), t("数据", "Data")],
  ];
  const tabs = tabsHTML(all.map(([, href, label, count]) => [href, label, count]), String(all.findIndex(([id]) => id === tab)), t("管理分类", "Moderation sections"));
  const who = (person: CommunityPerson | null) => person ? esc(person.name) : t("（已注销）", "(deleted)");
  let body = "";
  if (tab === "queue") {
    const topics = data.queue.topics.map((topic) => `<li class="community-queue-item"><div class="community-queue-main">`
      + `<span class="community-queue-why">${topic.pending ? t(`待审 · ${esc(topic.pendingReason || "")}`, `Review · ${esc(topic.pendingReason || "")}`) : t(`已自动隐藏 · ${esc(topic.hiddenReason || "")}`, `Hidden · ${esc(topic.hiddenReason || "")}`)}</span>`
      + `<a class="community-queue-title" href="${postHref(topic.id)}">${esc(topic.title)}</a><span class="community-muted">${who(topic.author)} · ${esc(boardName(topic.board, t))} · ${relativeTime(topic.createdAt, now, t)}</span><p class="community-queue-body">${esc(plainText(topic.body))}</p></div>`
      + `<div class="community-queue-acts">${topic.pending
        ? `<button type="button" class="community-button is-small is-good" data-action="community-approve" data-id="${esc(topic.id)}">${icons.check || ""}<span>${t("通过", "Approve")}</span></button><button type="button" class="community-button is-small" data-action="community-reject" data-kind="topic" data-id="${esc(topic.id)}">${icons.trash || ""}<span>${t("不通过", "Reject")}</span></button>`
        : `<button type="button" class="community-button is-small" data-action="community-restore" data-kind="topic" data-id="${esc(topic.id)}">${icons.eye || ""}<span>${t("恢复", "Restore")}</span></button><button type="button" class="community-button is-small is-danger" data-action="community-queue-delete" data-kind="topic" data-id="${esc(topic.id)}" data-violation="true">${icons.trash || ""}<span>${t("按违规删除", "Remove")}</span></button>`}</div></li>`).join("");
    const replies = data.queue.replies.map((reply) => `<li class="community-queue-item"><div class="community-queue-main"><span class="community-queue-why">${t("回复已自动隐藏", "Hidden reply")}</span>`
      + `<a class="community-queue-title" href="${postHref(reply.topicId)}">${esc(reply.topicTitle)}</a><span class="community-muted">${who(reply.author)} · ${relativeTime(reply.createdAt, now, t)}</span><p class="community-queue-body">${esc(plainText(reply.body))}</p></div>`
      + `<div class="community-queue-acts"><button type="button" class="community-button is-small" data-action="community-restore" data-kind="reply" data-id="${esc(reply.id)}">${icons.eye || ""}<span>${t("恢复", "Restore")}</span></button><button type="button" class="community-button is-small is-danger" data-action="community-queue-delete" data-kind="reply" data-id="${esc(reply.id)}" data-violation="true">${icons.trash || ""}<span>${t("按违规删除", "Remove")}</span></button></div></li>`).join("");
    body = `${rejecting ? rejectPanelHTML(rejecting, common) : ""}${topics || replies ? `<ul class="community-queue">${topics}${replies}</ul>` : emptyHTML(common, t("没有待处理的内容", "Nothing to review"), t("都处理完了。", "All clear."))}`;
  } else if (tab === "reports") {
    body = data.reports.length
      ? `<ul class="community-queue">${data.reports.map((report) => `<li class="community-queue-item"><div class="community-queue-main">`
        + `<span class="community-queue-why">${esc(report.reason)}${report.target.hidden ? t(" · 已自动隐藏", " · hidden") : ""}${report.target.gone ? t(" · 内容已不存在", " · content is gone") : ""}</span>`
        + (report.target.topicId ? `<a class="community-queue-title" href="${postHref(report.target.topicId)}">${report.target.kind === "reply" ? t("回复：", "Reply: ") : ""}${esc(report.target.kind === "reply" ? [...report.target.excerpt].slice(0, 40).join("") : report.target.title)}</a>` : `<span class="community-queue-title">${esc(report.target.title)}</span>`)
        + `<span class="community-muted">${t(`作者 ${who(report.target.author)} · 举报人 ${who(report.reporter)}（${report.reporter.role === "owner" ? "站长" : communityLevelName(report.reporter.steward ? 4 : report.reporter.level ?? 0, t)}） · ${relativeTime(report.createdAt, now, t)}`, `By ${who(report.target.author)} · reported by ${who(report.reporter)} · ${relativeTime(report.createdAt, now, t)}`)}</span>`
        + (report.target.excerpt ? `<p class="community-queue-body">${esc(report.target.excerpt)}</p>` : "")
        + (report.note ? `<p class="community-queue-body">“${esc(report.note)}”</p>` : "")
        + `</div><div class="community-queue-acts"><button type="button" class="community-button is-small is-good" data-action="community-uphold" data-id="${esc(report.id)}">${icons.check || ""}<span>${t("举报成立", "Uphold")}</span></button><button type="button" class="community-button is-small" data-action="community-dismiss" data-id="${esc(report.id)}"><span>${t("驳回", "Dismiss")}</span></button></div></li>`).join("")}</ul>`
      : emptyHTML(common, t("没有待处理的举报", "No open reports"), t("都处理完了。", "All clear."));
  } else if (tab === "orders" && data.owner) {
    const status: Record<string, [string, string]> = { pending: [t("待发货", "To ship"), "is-penalty"], shipped: [t("已发货", "Shipped"), "is-in"], cancelled: [t("已取消", "Cancelled"), ""] };
    body = data.orders.length
      ? `${shippingOrder ? shippingFormHTML(shippingOrder, common) : ""}<div class="community-table-wrap"><table class="community-table"><thead><tr><th>${t("时间", "Time")}</th><th>${t("成员", "Member")}</th><th>${t("兑换", "Item")}</th><th>${t("收货信息", "Shipping")}</th><th>${t("状态", "Status")}</th><th></th></tr></thead><tbody>${data.orders.map((order) => {
        const [label, cls] = status[order.status] || [order.status, ""];
        return `<tr><td class="is-mono" data-label="${t("时间", "Time")}">${esc(beijingTime(order.createdAt))}</td><td data-label="${t("成员", "Member")}">${nameHTML(order.member, common)}</td><td data-label="${t("兑换", "Item")}">${esc(order.itemName)} <span class="community-muted">· ${order.price}</span></td>`
          + `<td data-label="${t("收货信息", "Shipping")}">${order.shipping ? `<div class="community-ship"><b>${esc(order.shipping.name)}</b> <span class="is-mono">${esc(order.shipping.phone)}</span><br>${esc(order.shipping.address)}</div>` : `<span class="community-muted">${order.status === "pending" ? "—" : t("已删除", "Deleted")}</span>`}${order.tracking?.number ? `<span class="community-order-tracking">${esc(order.tracking.company)} · ${esc(order.tracking.number)}</span>` : ""}</td>`
          + `<td data-label="${t("状态", "Status")}"><span class="community-kind ${cls}">${label}</span></td><td class="is-right" data-label="${t("操作", "Actions")}">${order.status === "pending" ? `<button type="button" class="community-button is-small is-good" data-action="community-ship" data-id="${esc(order.id)}">${icons.truck || ""}<span>${t("标记已发货", "Shipped")}</span></button> <button type="button" class="community-button is-small" data-action="community-cancel-order" data-id="${esc(order.id)}"><span>${t("取消并退回", "Cancel & refund")}</span></button>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div><p class="community-muted">${t("收货信息只给站长看，发货或取消后自动删除。", "Shipping details are only for the owner and are deleted once shipped or cancelled.")}</p>`
      : emptyHTML(common, t("没有实物兑换", "No goods orders"));
  } else if (tab === "items" && data.owner) {
    const editing = itemEditing ? (itemEditing.id ? data.items.find((item) => item.id === itemEditing.id) || null : null) : undefined;
    const list = data.items.length
      ? `<div class="community-table-wrap"><table class="community-table"><thead><tr><th>${t("名称", "Name")}</th><th>${t("类别", "Kind")}</th><th class="is-right">${t("价格", "Price")}</th><th>${t("库存", "Stock")}</th><th>${t("状态", "Status")}</th><th></th></tr></thead><tbody>${data.items.map((item) => `<tr><td data-label="${t("名称", "Name")}">${esc(item.name)}</td><td data-label="${t("类别", "Kind")}">${item.cat === "digital" ? t("数字资源", "Digital") : t("实物周边", "Goods")}</td><td class="is-right is-mono" data-label="${t("价格", "Price")}">${item.price}</td><td class="is-mono" data-label="${t("库存", "Stock")}">${item.stock === null || item.stock === undefined ? t("不限", "—") : `${item.left ?? 0} / ${item.stock}`}</td><td data-label="${t("状态", "Status")}">${item.active ? `<span class="community-kind is-in">${t("上架中", "On sale")}</span>` : `<span class="community-kind">${t("已下架", "Off")}</span>`}</td><td class="is-right" data-label="${t("操作", "Actions")}"><button type="button" class="community-button is-small" data-action="community-item-edit" data-id="${esc(item.id)}">${icons.pen || ""}<span>${t("编辑", "Edit")}</span></button></td></tr>`).join("")}</tbody></table></div>`
      : emptyHTML(common, t("还没有上架物品", "No items yet"), t("装扮和道具卡是内置的；数字资源和实物周边在这里上架。", "Looks and cards are built in; add digital items and goods here."));
    body = (editing !== undefined ? itemFormHTML(editing, common) : `<div class="community-form-actions is-start"><button type="button" class="community-button is-gold" data-action="community-item-edit" data-id="">${icons.plus || ""}<span>${t("上架新物品", "New item")}</span></button></div>`) + list;
  } else if (tab === "sanctions") {
    body = data.sanctions.length
      ? `<div class="community-table-wrap"><table class="community-table"><thead><tr><th>${t("成员", "Member")}</th><th>${t("处罚", "Sanction")}</th><th>${t("原因", "Reason")}</th><th>${t("到期", "Until")}</th><th></th></tr></thead><tbody>${data.sanctions.map((sanction) => `<tr><td data-label="${t("成员", "Member")}">${nameHTML(sanction.member, common)}</td><td data-label="${t("处罚", "Sanction")}">${t(`禁言 ${sanction.days} 天`, `Muted ${sanction.days} d`)}</td><td data-label="${t("原因", "Reason")}">${esc(sanction.reason)}</td><td class="is-mono" data-label="${t("到期", "Until")}">${esc(beijingTime(sanction.until, true))}</td><td class="is-right" data-label="${t("操作", "Actions")}"><button type="button" class="community-button is-small" data-action="community-lift" data-id="${esc(sanction.id)}"><span>${t("解除", "Lift")}</span></button></td></tr>`).join("")}</tbody></table></div>`
      : emptyHTML(common, t("没有生效中的处罚", "No active sanctions"), t("在成员主页或删帖时可以禁言。", "Mute from a member page or when deleting a post."));
  } else if (tab === "data" && data.data) {
    const flow = data.data.flow;
    const max = Math.max(10, ...flow.map((row) => Math.max(row.issued, row.recovered)));
    const boards = data.data.boards;
    const boardMax = Math.max(1, ...boards.map((row) => row.topics));
    body = `<div class="community-pt-grid"><section class="community-card community-span-2">${cardHead(t("近 7 天星尘发放与回收", "Stardust issued and recovered, 7 days"), "", `<span class="community-legend"><span><i class="community-sw is-in"></i>${t("系统发放", "Issued")}</span><span><i class="community-sw is-out"></i>${t("消耗与扣罚", "Spent and penalties")}</span></span>`)}`
      + `<div class="community-bars" role="img" aria-label="${t("近 7 天星尘发放与回收", "Stardust issued and recovered over 7 days")}">${flow.map((row) => `<div class="community-bar-col"><div class="community-bar-pair"><i class="community-bar is-in" style="height:${row.issued / max * 100}%" title="${t(`发放 ${row.issued}`, `Issued ${row.issued}`)}"></i><i class="community-bar is-out" style="height:${row.recovered / max * 100}%" title="${t(`回收 ${row.recovered}`, `Recovered ${row.recovered}`)}"></i></div><span class="is-mono">${esc(row.day.slice(5))}</span></div>`).join("")}</div>`
      + `<p class="community-muted">${t("用户之间的转账（感谢、悬赏、解锁）不算发放。发放长期远大于回收时，要考虑下调奖励或增加消耗。", "Transfers between members (thanks, bounties, unlocks) are not issuance. If issuance stays far above recovery, lower rewards or add ways to spend.")}</p></section>`
      + `<section class="community-card community-span-2">${cardHead(t("各版块主题数", "Topics per board"))}<ul class="community-hbars">${boards.map((row) => `<li><span>${esc(boardName(row.id, t))}</span><span class="community-hbar"><i style="width:${row.topics / boardMax * 100}%;background:${communityBoards.find((board) => board.id === row.id)?.color || "#aeb3bd"}"></i></span><span class="is-mono">${row.topics}</span></li>`).join("")}</ul></section></div>`;
  } else body = emptyHTML(common, t("没有这个分类", "No such section"));
  return `<section class="page community-page" data-community="manage" data-tab="${esc(tab)}">${head}${kpis}${tabs}<div class="community-rv" style="--i:3">${body}</div></section>`;
}

