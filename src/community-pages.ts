// 社区：签到、星尘（明细、等级、规则）、兑换所、我的兑换、排行、成员主页、通知、公约和社区管理。
// 这里只拼 HTML；读写接口和表单在 community-ui.ts。

import {
  communityBoards, boardName, boardHref, postHref, memberHref, stardustHref, inboxHref, shopHref, manageHref, communityHomeHref, rulesHref,
  avatarHTML, whoHTML, nameHTML, nameLabelHTML, growthChipHTML, levelMarksHTML, roleChipHTML, badgeHTML, cardHead, moreLink, bannerHTML, statsHTML, emptyHTML, communityManagementRole,
  communityStatusHTML, communityTopicsHTML, communityBodyHTML, relativeTime, beijingTime, readyData, communityLevelName, plainText,
} from './community.mjs';
import type { Common, CommunityLoad, CommunityMe, CommunityPerson, CommunityTopic, CommunityUnread, CommunityInventory, CommunityModerationContacts, Translate } from './community.ts';
import {
  communityRules, communityLevels, communityBadges, communityCheckinBadges,
  communityShopCats, communityReportReasons, communityReviewReasons, checkinMonth, beijingDay,
} from './community-rules.mjs';
import type { ShopItem, ShopCategory } from './community-rules.ts';
import { communityManagementShellHTML } from './community-management.mjs';
import { communityProfileReviewsHTML, profileImageURL } from './community-profile.mjs';
import type { CommunityProfileImage, CommunityProfileReview, CommunityBackgroundReview } from './community-profile.ts';
import { communityStewardsHTML } from './community-stewards.mjs';
import { communityShopEditorHTML, communityCategoryEditorHTML } from './community-shop-editor.mjs';
import { communityDeletePanelHTML } from './community-post.mjs';
import type { CommunityTarget } from './community-post.ts';
import { checkinStarsHTML } from './community-checkin-stars.mjs';
import { communityBannerEditorHTML } from './community-banner-editor.mjs';
import type { CommunityBannerEditorState } from './community-banner-editor.ts';
import type { CommunityBannerConfig } from './community-banners.ts';
import { communityLevelExplorerHTML } from './community-level-explorer.mjs';
import type { CommunityLevelSelection } from './community-level-explorer.ts';
import type { CommunityGrowthState, CommunityVIPGrowthState, CommunityExperienceCatalogueItem, CommunityVIPCatalogueItem } from './community-growth.ts';
import { vipContactURL as authorContactURL } from './vip-book-prompt.mjs';
import { communityConventionText } from './community-convention.mjs';
import type { CommunityConvention } from './community-convention.ts';
import { communityBadgeExplorerHTML, communityBadgeFamilyState, communityBadgeLegacyHTML, communityBadgeTierName } from './community-badge-explorer.mjs';
import type { CommunityBadgeSelection } from './community-badge-explorer.ts';
import type { BadgeFamilyId, CommunityBadgeState } from './community-badge-policy.ts';
import { communityBadgeFamilies, communityBadgeTiers, communityBadgeCommonRules, communityBadgeCommonRulesEn } from './community-badge-policy.mjs';

/* ---------- 接口返回的数据 ---------- */
export type CommunityEarlyBird = { person: CommunityPerson; at: string };
export type CommunityMakeup = { used: number; allowed: number; left: number; free: boolean; cards: number; cost: number; days: string[] };
export type CommunityCheckin = {
  badgeState?: CommunityBadgeState;
  checkedIn: boolean; streak: number; balance: number; gainedToday: number; behaviourToday: number; vip: boolean; owner?: boolean; browsingAsReader?: boolean; uid?: string | null;
  month: string; days: string[]; monthBonus?: number; checkinsToday: number; earlyBirds: CommunityEarlyBird[]; makeup: CommunityMakeup; badges: string[];
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
  level: number; owner: boolean; steward: boolean; vip?: boolean; browsingAsReader?: boolean; growth?: CommunityGrowthState | null; stats: Record<string, number>; progress: CommunityLevelProgress | null;
  experienceCatalogue?: CommunityExperienceCatalogueItem[]; vipCatalogue?: CommunityVIPCatalogueItem[]; vipGrowth?: CommunityVIPGrowthState | null;
};
export type CommunityRedeemState = { owned: boolean; left: number | null; ok: boolean; code: string; why: string };
export type CommunityShopItem = ShopItem & { active: boolean; state: CommunityRedeemState };
export type CommunityDecorations = { frame: string | null; color: string | null; cover: string | null };
export type CommunityShop = { balance: number; level: number; owner: boolean; categories?: ShopCategory[]; items: CommunityShopItem[]; inventory: CommunityInventory; decorations: CommunityDecorations };
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
export type CommunityMemberReply = { id: string; topicId: string; topicTitle: string; board: string; body: string; createdAt: string; likes: number; images?: { id: string; width: number; height: number }[] };
export type CommunityMember = {
  background?: CommunityProfileImage | null;
  badgeState?: CommunityBadgeState;
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
  target: { kind: "topic" | "reply"; id?: string; topicId: string | null; board?: string | null; title: string; excerpt: string; author: CommunityPerson | null; gone: boolean; hidden: boolean };
};
export type CommunityQueueTopic = CommunityTopic & { body: string; pendingReason: string | null; hiddenReason: string | null };
export type CommunityQueueReply = { id: string; topicId: string; topicTitle: string; board?: string | null; author: CommunityPerson; body: string; createdAt: string; hiddenAt: string };
export type CommunityGoodsOrder = CommunityOrder & { member: CommunityPerson; shipping?: { name: string; phone: string; address: string } | null };
export type CommunityManagedItem = ShopItem & { active: boolean; delivery: string };
export type CommunitySanction = { id: string; member: CommunityPerson; days: number; reason: string; until: string; createdAt: string; state?: 'active' | 'expired' | 'lifted'; active?: boolean; liftedAt?: string | null };
export type CommunityManage = {
  profiles?: CommunityProfileReview[];
  backgrounds?: CommunityBackgroundReview[];
  banners?: CommunityBannerConfig[];
  moderationBoards?: string[];
  categories?: ShopCategory[];
  content?: CommunityTopic[];
  stewards?: CommunityPerson[];
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
  `<header class="community-page-head community-rv" style="--i:0"><div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}<h1>${title}</h1>${text ? `<p class="community-muted">${text}</p>` : ""}</div>${side}</header>`;

/* ---------- 签到 ---------- */
// 月历：签过的日子点亮；最近 7 天里漏掉的日子可以补签（橙色虚线）。
function calendarHTML(data: CommunityCheckin, today: string, { t, icons = {} }: Common, owner = false, me: CommunityMe | null = null) {
  const preview = Boolean(data.browsingAsReader);
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
    else if (makeup.has(key) && !owner && !preview) cells.push(`<button type="button" class="community-cal-day is-makeup" data-action="community-makeup" data-day="${key}" aria-label="${t(`补签 ${key}`, `Make up ${key}`)}">${d}</button>`);
    else cells.push(`<span class="community-cal-day ${key > today ? "is-future" : "is-miss"}${today_}">${d}</span>`);
  }
  const shift = (delta: number) => new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
  const current = today.slice(0, 7);
  const cost = data.makeup.cards ? t(`先用补签卡（剩 ${data.makeup.cards} 张）`, `a make-up card first (${data.makeup.cards} left)`) : data.makeup.free ? t("本月第一次免费（VIP）", "free the first time this month (VIP)") : t(`每次 ${communityRules.makeupCost} 星尘`, `${communityRules.makeupCost} stardust each`);
  const managementRole = communityManagementRole(me);
  const previewNote = managementRole === 'owner' ? t('当前仅查看日历；作者不参与签到和补签。', 'This calendar is read-only. The owner does not check in or make up days.')
    : managementRole === 'steward' ? t('当前仅查看日历；返回版主身份后可以签到和补签。', 'This calendar is read-only. Restore your moderator perspective to check in or make up a day.')
    : t('当前仅查看日历；请先返回管理身份。', 'This calendar is read-only. Restore management first.');
  const note = owner ? t("站长仅查看签到日历。", "The owner can view this calendar only.") : preview ? previewNote : !data.makeup.left ? t("这个月的补签次数用完了。", "No make-ups left this month.")
    : data.makeup.days.length
      ? t(`橙色虚线的日期可以补签：${cost}，本月还剩 ${data.makeup.left} 次。补签接上连签、计入满勤，不补发那天的签到星尘。`, `Dashed days can be made up: ${cost}; ${data.makeup.left} left this month. Make-ups restore the streak and count toward full-month attendance, without daily income.`)
      : t(`最近 ${communityRules.makeupWindow} 天没有漏签。本月还能补签 ${data.makeup.left} 次。`, `No missed days in the last ${communityRules.makeupWindow}. ${data.makeup.left} make-ups left this month.`);
  const chevron = icons['chevron-right'] || '<svg class="ui-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  return `<section class="community-ck-section community-ck-calendar community-rv" style="--i:2">${cardHead(t(`${year} 年 ${month} 月`, `${year}-${String(month).padStart(2, "0")}`), "", `<span class="community-cal-nav"><button type="button" class="community-act is-small is-prev" data-action="community-month" data-month="${shift(-1)}" aria-label="${t("上个月", "Previous month")}">${chevron}</button><button type="button" class="community-act is-small" data-action="community-month" data-month="${shift(1)}" aria-label="${t("下个月", "Next month")}"${data.month >= current ? " disabled" : ""}>${chevron}</button></span>`)}`
    + `<div class="community-ck-calendar-body"><div class="community-cal-week" aria-hidden="true">${t("日一二三四五六", "SMTWTFS").split("").map((day) => `<span>${day}</span>`).join("")}</div>`
    + `<div class="community-cal">${cells.join("")}</div></div>`
    + `<p class="community-muted community-calendar-note"><span>${t(`这个月签了 <b>${data.days.length}</b> 天。`, `<b>${data.days.length}</b> days this month. `)}</span>${note}</p></section>`;
}

export function communityCheckinHTML({ checkin, me = null, ...common }: Common & { checkin: CommunityLoad<CommunityCheckin>; me?: CommunityMe | null }) {
  const { t, esc, now = Date.now(), icons = {} } = common;
  const r = communityRules;
  const data = readyData(checkin);
  if (!data) return pageOf("checkin", common, checkin);
  const today = beijingDay(now);
  const month = checkinMonth(data.month, data.days);
  const managementRole = communityManagementRole(me);
  const previewText = managementRole === 'owner' ? t('当前是只读的读者浏览视角；作者不参与签到。', 'This reader preview is read-only. The owner does not check in.')
    : managementRole === 'steward' ? t('当前是只读的读者浏览视角；返回版主身份后可以签到。', 'This reader preview is read-only. Restore your moderator perspective to check in.')
    : t('当前是只读的读者浏览视角；请先返回管理身份。', 'This reader preview is read-only. Restore management first.');
  const text = data.owner ? t("站长不参与签到；这里保留签到星图和日历供查看。", "The owner does not check in; the star map and calendar remain viewable.")
    : data.browsingAsReader ? previewText
    : t(`每日签到 +${r.checkinBase} 星尘，自然月满勤额外 +${r.monthBonus}。补签计入满勤，北京时间 0 点换日。`, `Daily check-in +${r.checkinBase} stardust; full calendar month +${r.monthBonus} extra. Make-ups count. Days change at midnight Beijing time.`);
  const early = data.earlyBirds.length
    ? `<ol class="community-rank">${data.earlyBirds.map((bird, i) => `<li><span class="community-hot-rank${i < 3 ? " is-top" : ""}">${i + 1}</span>${avatarHTML(bird.person, common, "sm")}${whoHTML(bird.person, common)}<span class="community-rank-count">${esc(beijingTime(bird.at).slice(6))}</span></li>`).join("")}</ol>`
    : `<p class="community-muted">${t("今天还没有人签到。", "No check-ins yet today.")}</p>`;
  const checkinFamilies: readonly BadgeFamilyId[] = ['attendance', 'early'];
  const achievements = checkinFamilies.map(id => {
    const award = communityBadgeFamilyState(data.badgeState, id), has = Boolean(award?.tier);
    const status = !data.badgeState ? t('状态暂未提供', 'Status unavailable') : has ? `${communityBadgeTierName(award!.tier!, common)} · ${t('已获得', 'Earned')}` : t('未获得', 'Not earned');
    return `<div class="community-ck-achievement" data-badge-family="${id}" data-earned="${has}">${badgeHTML(id, has, common, 'md', true, award?.tier || 'gold')}<span class="community-ck-achievement-state">${esc(status)}</span></div>`;
  }).join('');
  const historyState = data.badgeState ? { ...data.badgeState, legacy: data.badgeState.legacy.filter(item => communityCheckinBadges.includes(item.id as (typeof communityCheckinBadges)[number])) } : null;
  const history = communityBadgeLegacyHTML(data.badges.filter(id => communityCheckinBadges.includes(id as (typeof communityCheckinBadges)[number])), common, historyState);
  return `<section class="page community-page" data-community="checkin">`
    + pageHead('', t("签到", "Check-in"), esc(text), data.owner ? "" : statsHTML([[t("星尘", "Stardust"), data.balance], [t("本月已签", "Days this month"), month.signed.length]]))
    + `<section class="community-ck-section community-ck-cycle community-rv" style="--i:1">${cardHead(t("每月星图", "Monthly star map"), "", `<span class="community-muted">${t(`连线上的一颗星代表一天 · ${data.month} 共 ${month.totalDays} 天`, `One connected star per day · ${month.totalDays} days in ${data.month}`)}</span>`)}`
    + checkinStarsHTML({ month: data.month, days: data.days, today, owner: data.owner, monthBonus: data.monthBonus }, t) + `</section>`
    + `<div class="community-pt-grid community-ck-panels">${calendarHTML(data, today, common, data.owner, me)}`
    + `<section class="community-ck-section community-ck-early community-rv" style="--i:3">${cardHead(t("今日早鸟", "Early birds"), icons.sunrise)}<div class="community-ck-early-body"><p class="community-muted">${t("每天前 10 名，计入“晨光先至”成就", "The first ten each day count toward the First light achievement")}</p>${early}</div></section>`
    + (data.owner ? "" : `<section class="community-ck-section community-ck-badges community-span-2 community-rv" style="--i:4">${cardHead(t("签到徽章", "Check-in badges"), icons.award, data.uid ? moreLink(memberHref(data.uid, "badges"), t("我的徽章", "My badges"), icons) : moreLink(stardustHref(), t("我的星尘", "My stardust"), icons))}<div class="community-badge-row is-large">${achievements}</div>${history}</section>`) + `</div>`
    + `</section>`;
}

/* ---------- 星尘 ---------- */
const reasonLabels: Record<string, [string, string]> = {
  initial: ["初始星尘", "Initial stardust"], checkin: ["签到", "Check-in"], "checkin-month": ["自然月满勤奖励", "Full-month attendance"], topic: ["发主题", "New topic"], reply: ["有效回复", "Reply"], like: ["收到赞", "Like received"],
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

function stardustRulesHTML({ t, icons = {} }: Common) {
  const r = communityRules;
  const earn: Array<[string, string, string]> = [
    [t("签到", "Check-in"), `+${r.checkinBase}`, t(`读者每天 1 次；自然月满勤额外 +${r.monthBonus}，补签计入满勤；作者不签到`, `Readers once daily; full calendar month +${r.monthBonus} extra. Make-ups count; the owner does not check in.`)],
    [t("发主题", "New topic"), `+${r.topicReward}`, t(`每天前 ${r.topicDaily} 个；审核通过才入账`, `First ${r.topicDaily} a day; after review if needed`)],
    [t("有效回复", "Reply"), `+${r.replyReward}`, t(`每天 ${r.replyDaily} 次；${r.replyMinLength} 字以上，不在自己帖里`, `${r.replyDaily} a day; ${r.replyMinLength}+ characters, not on your own topic`)],
    [t("收到赞", "Like received"), String(r.likeReward), t("表达认可，不发星尘", "Appreciation without stardust")],
    [t("回答被采纳", "Accepted answer"), `+${r.acceptReward}`, t(`每天最多 ${r.acceptDaily} 次；不能自采纳，悬赏另计`, `Up to ${r.acceptDaily} a day; no self-acceptance, bounty paid separately`)],
    [t("被评为精华", "Featured"), `+${r.featureReward}`, t(`作者评定；每月最多奖励 ${r.featureMonthly} 篇，每篇仅首次`, `By the owner; first feature only, up to ${r.featureMonthly} awarded topics a month`)],
    [t("举报成立", "Report upheld"), String(r.reportReward), t("正常处理，不发星尘", "Handled without stardust")],
  ];
  const spend: Array<[string, string, string]> = [
    [t("感谢", "Thanks"), String(r.thankCost), t(`作者得 ${r.thankToAuthor}，销毁 ${r.thankCost - r.thankToAuthor}`, `${r.thankToAuthor} to the author, ${r.thankCost - r.thankToAuthor} burned`)],
    [t("悬赏提问", "Bounty"), r.bountyOptions.join(" / "), t(`给被采纳者；${r.bountyDays} 天没人采纳退回一半`, `To the accepted answer; half back after ${r.bountyDays} days`)],
    [t("解锁提示词", "Unlock a prompt"), `${r.unlockMin}–${r.unlockMax}`, t("作者定价，作者得 80%", "Set by the author, who gets 80%")],
    [t("补签", "Make-up"), String(r.makeupCost), t("销毁；每月 2 次", "Burned; twice a month")],
    [t("推荐 24 小时", "Recommend, 24 h"), String(r.pinCost), t("销毁；作品帖和资源帖", "Burned; works and resources")],
    [t("兑换所", "Exchange"), t("按商品标价", "Listed item price"), t("销毁", "Burned")],
  ];
  const table = (head: string[], rows: Array<[string, string, string]>, flow: "in" | "out" = "in") => `<div class="community-table-wrap"><table class="community-table"><thead><tr>${head.map((cell, i) => `<th${i === 1 ? ' class="is-right"' : ""}>${cell}</th>`).join("")}</tr></thead><tbody>${rows.map(([a, b, c]) => `<tr><td>${a}</td><td class="is-right is-mono ${flow === "in" ? "is-plus" : "is-minus"}">${b}</td><td>${c}</td></tr>`).join("")}</tbody></table></div>`;
  return `<div class="community-pt-grid">`
    + `<section class="community-card">${cardHead(t("怎么挣", "Earning"))}${table([t("行为", "What"), t("星尘", "Stardust"), t("限制", "Limits")], earn)}<p class="community-muted">${t(`主题、有效回复、采纳合计每人每天最多 ${r.dailyCap}；签到、满勤和精华另计。未满足条件不发放，补签不补发每日星尘。感谢、悬赏和解锁收入来自其他用户，不占系统奖励额度。`, `Topics, eligible replies and accepted answers share a ${r.dailyCap}-a-day cap. Attendance and first-feature awards are separate. Only eligible actions earn; make-ups do not earn daily stardust. Thanks, bounties and unlock income come from other members.`)}</p></section>`
    + `<section class="community-card">${cardHead(t("怎么花", "Spending"))}${table([t("用途", "What"), t("星尘", "Stardust"), t("去向", "Where it goes")], spend, "out")}</section>`
    + `<section class="community-card community-span-2">${cardHead(t("防刷规则", "Fair play"))}<ul class="community-ticks">`
    + [t(`所有星尘变动都记在流水里，内容被删会按流水收回，违规再扣 ${r.penalty}，余额最低到 0。`, `Every change is in the ledger; removed content gives its stardust back, a violation costs ${r.penalty} more, and balances stop at 0.`),
      t("点赞和举报不发星尘；初光等级暂不能感谢。删除或取消奖励不会恢复领奖名额。", "Likes and reports give no stardust; First light members cannot thank yet. Deletion or reversal does not reopen reward slots."),
      t("星尘买不到信任等级；VIP 也不影响信任等级。成长升级规则将在上线前确定。", "Stardust cannot buy trust levels; neither can VIP. Growth upgrade rules will be confirmed before launch."),
      t("数值是上线初始值，站长会按实际情况调整，调整前会在站务反馈里公告。", "The numbers may be adjusted; changes are announced in the Meta board first.")].map((line) => `<li>${icons.check || ""}${line}</li>`).join("")
    + `</ul><p class="community-rule-related"><a class="community-link-sm" href="${rulesHref}">${t('社区公约与账号规则', 'Community convention and account rules')}</a></p></section></div>`;
}

export function communityStardustHTML({ stardust, tab, levelSelection, ...common }: Common & { stardust: CommunityLoad<CommunityStardust>; tab: string; levelSelection?: CommunityLevelSelection }) {
  const { t, esc, icons = {} } = common;
  const data = readyData(stardust);
  if (!data) return pageOf("stardust", common, stardust);
  const tabs: Array<[string, string]> = [[stardustHref(), t("明细", "Ledger")], [stardustHref("levels"), t("等级", "Levels")], [stardustHref("rules"), t("规则", "Rules")]];
  const index = String(["ledger", "levels", "rules"].indexOf(tab));
  const body = tab === "levels" ? communityLevelExplorerHTML(data, common, levelSelection) : tab === "rules" ? stardustRulesHTML(common) : ledgerHTML(data, common);
  const showCheckin = !data.owner && !data.browsingAsReader && !data.checkedIn;
  const text = t(`今天获得 <b>${data.gainedToday}</b> 星尘，行为星尘 <b>${data.behaviourToday} / ${data.dailyCap}</b>。${showCheckin ? "今天还没签到。" : ""}`, `+<b>${data.gainedToday}</b> today; <b>${data.behaviourToday} / ${data.dailyCap}</b> from activity.${showCheckin ? " Not checked in yet." : ""}`);
  return `<section class="page community-page" data-community="stardust" data-tab="${esc(tab)}">`
    + bannerHTML({ eyebrow: "STARDUST", title: t("我的星尘", "My stardust"), text, esc, html: true, side: statsHTML([[t("余额", "Balance"), data.balance]]) + (showCheckin ? `<a class="community-button is-gold is-small" href="#/community/checkin">${icons.calendar || ""}${t("去签到", "Check in")}</a>` : "") })
    + tabsHTML(tabs, index, t("星尘", "Stardust"), `<a class="community-tab-go" href="${shopHref()}">${icons.box || ""}${t("兑换所", "Exchange")}</a>`)
    + `<div class="community-rv" style="--i:2">${body}</div></section>`;
}

/* ---------- 兑换所 ---------- */
const limitText = (item: ShopItem, t: Translate) => !item.limit ? "" : item.limit.per === "once" ? t("限兑 1 次", "Once only")
  : item.limit.per === "year" ? t(`每年限 ${item.limit.n} 次`, `${item.limit.n} a year`) : t(`每月限 ${item.limit.n} 次`, `${item.limit.n} a month`);
const cardIcons: Record<string, string> = { makeup: "calendar", pin: "pin", highlight: "sparkles" };
// 共用物品预览：头像框以「無」展示，昵称用示例名字，道具卡、资源和实物各自使用原有绘制。
function itemArtHTML(item: ShopItem, inventory: CommunityInventory | null, common: Common) {
  const { t, esc, icons = {} } = common;
  if (item.kind === 'frame' && item.image) return `<span class="community-sart">${avatarHTML({ name: '無', role: 'reader', uid: null, frame: item.ref || `image:${item.image}` }, common, 'xl', false)}</span>`;
  if (item.image && /^[0-9a-f-]{36}$/.test(item.image)) return `<img class="community-product-image" src="/api/community/images/${esc(item.image)}.webp" alt="${esc(item.name)}" loading="lazy" decoding="async">`;
  const sample: CommunityPerson = { name: t("林间", "Lin"), role: "reader", uid: null, avatar: null };
  const ref = item.ref && /^[a-z]+$/.test(item.ref) ? item.ref : "";
  if (item.kind === "frame") return `<span class="community-sart"><span class="community-av community-av-xl community-shop-avatar is-frame-${ref}" aria-hidden="true"><span>無</span></span></span>`;
  if (item.kind === "color") return `<span class="community-sart"><span class="community-nc-sample">${nameHTML({ ...sample, color: item.ref || null, nameEffect: item.effect }, common)}</span><small>${t("在帖子、回复、排行榜里显示", "Shown in posts, replies and rankings")}</small></span>`;
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

function shopCardHTML(item: CommunityShopItem, shop: CommunityShop, common: Common, i: number, showPrice = true) {
  const { t, esc, icons = {} } = common;
  const tags = [limitText(item, t), item.minLevel ? t(`${communityLevels[item.minLevel].name}以上`, `${communityLevels[item.minLevel].en} and up`) : "", item.minDays ? t(`注册满 ${item.minDays} 天`, `${item.minDays}+ days`) : "", item.note || ""].filter(Boolean);
  const left = item.state.left ?? 0;
  const stock = item.stock ? `<div class="community-stock"><div class="community-stock-row"><span>${t("库存", "Stock")}</span><span class="is-mono">${t(`剩 ${left} / ${item.stock}`, `${left} / ${item.stock} left`)}</span></div><div class="community-meter"><i style="width:${Math.round(left / item.stock * 100)}%"></i></div></div>` : "";
  const off = item.state.code === "soldout" || item.state.code === "closed";
  return `<article class="community-sitem community-spot community-rv${off ? " is-off" : ""}${item.state.owned ? " is-owned" : ""}" style="--i:${i + 2}">`
    + `<div class="community-sitem-art">${itemArtHTML(item, shop.inventory, common)}${item.state.owned ? `<span class="community-owned-tag">${icons.check || ""}${t("已拥有", "Owned")}</span>` : ""}</div>`
    + `<div class="community-sitem-body"><details class="community-sitem-details" data-shop-description="${esc(item.id)}"><summary><h3>${esc(item.name)}${icons['chevron-down'] || ''}</h3></summary><p>${esc(item.desc)}</p></details>`
    + `<div class="community-sitem-meta">`
    + (tags.length ? `<div class="community-stags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>` : "")
    + stock + `</div>`
    + `<div class="community-sitem-foot">${showPrice ? `<span class="community-price">${icons.star || ""}<b>${item.price}</b></span>` : ""}${redeemButtonHTML(item, shop.decorations, common)}</div></div></article>`;
}

// 兑换确认：写清花多少、剩多少；实物要填收货信息（只给站长看，发货或取消后删除）。
function redeemPanelHTML(item: CommunityShopItem, balance: number, inventory: CommunityInventory | null, common: Common) {
  const { t, esc } = common;
  const goods = item.kind === "goods";
  const conditions = goods ? t('作者取消待发货订单时退还星尘。', 'Owner cancellation of an unshipped order refunds stardust.') : t('请确认所选物品，读者没有自助退款入口。', 'Confirm your chosen item; there is no reader self-service refund action.');
  const fields = goods
    ? `<div class="community-field-grid">`
      + `<div class="community-field"><label class="community-field-l" for="community-ship-name">${t("收件人", "Recipient")}</label><input id="community-ship-name" name="name" type="text" autocomplete="shipping name" maxlength="30" required></div>`
      + `<div class="community-field"><label class="community-field-l" for="community-ship-phone">${t("手机号", "Mobile")}</label><input id="community-ship-phone" name="phone" type="tel" inputmode="tel" autocomplete="shipping tel" maxlength="20" required></div>`
      + `<div class="community-field community-span-2"><label class="community-field-l" for="community-ship-address">${t("收货地址", "Address")}</label><textarea id="community-ship-address" name="address" rows="2" autocomplete="shipping street-address" maxlength="200" required></textarea></div></div>`
      + `<p class="community-muted">${t("收货信息只给站长看，发货或取消后就会删除。只包邮到中国大陆。", "Only the owner sees this, and it is deleted once shipped or cancelled. Mainland China only.")}</p>`
    : "";
  return `<form class="community-panel community-redeem community-rv" data-community-form="redeem" data-id="${esc(item.id)}" novalidate>`
    + `<div class="community-redeem-row"><div class="community-redeem-art">${itemArtHTML(item, inventory, common)}</div><div class="community-redeem-text"><p class="community-panel-title">${t(`兑换「${esc(item.name)}」`, `Redeem “${esc(item.name)}”`)}</p>${item.desc ? `<p class="community-muted">${esc(item.desc)}</p>` : ''}<p class="community-muted">${t(`花 ${item.price} 星尘，兑换后剩 ${balance - item.price}。`, `${item.price} stardust; ${balance - item.price} left afterwards.`)}${conditions}</p></div></div>`
    + fields + `<p class="community-form-status" role="status" aria-live="polite"></p>`
    + `<div class="community-form-actions"><button type="button" class="community-button" data-action="community-redeem-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-gold">${t("确认兑换", "Redeem")}</button></div></form>`;
}

function deliveryPanelHTML(delivery: CommunityDelivery, { t, esc, icons = {} }: Common) {
  return `<section class="community-panel community-delivery" aria-labelledby="community-delivery-title"><p class="community-panel-title" id="community-delivery-title">${esc(delivery.name)}</p>`
    + `<pre class="community-delivery-text" data-delivery>${esc(delivery.delivery)}</pre>`
    + `<div class="community-form-actions"><button type="button" class="community-button" data-action="community-delivery-close">${t("关闭", "Close")}</button><button type="button" class="community-button is-gold" data-action="community-copy-delivery">${icons.copy || ""}${t("复制", "Copy")}</button></div></section>`;
}

type ShopOptions = Common & { shop: CommunityLoad<CommunityShop>; tab: string; me?: CommunityMe | null; redeeming?: string | null; delivery?: CommunityDelivery | null };
export function communityShopHTML({ shop, tab, redeeming = null, delivery = null, ...common }: ShopOptions) {
  const { t, esc, icons = {} } = common;
  const data = readyData(shop);
  if (!data) return pageOf("shop", common, shop);
  const cats = communityShopCats;
  const custom = data.categories || [];
  const current = [...cats, ...custom].some((cat) => cat.id === tab) ? tab : "all";
  const items = data.items.filter((item) => current === "all" || item.cat === current || item.category === current);
  const seg = `<nav class="community-seg community-shop-cats community-rv" style="--i:1" aria-label="${t("分类", "Categories")}">`
    + `<a href="${shopHref()}"${current === "all" ? ' aria-current="page"' : ""}>${t("全部", "All")}</a>`
    + cats.map((cat) => `<a href="${shopHref(cat.id)}"${current === cat.id ? ' aria-current="page"' : ""}>${t(cat.name, cat.en)}<span class="community-seg-n">${data.items.filter((item) => item.cat === cat.id).length}</span></a>`).join("")
    + custom.map(cat => `<a href="${shopHref(cat.id)}"${current === cat.id ? ' aria-current="page"' : ''}>${esc(cat.name)}<span class="community-seg-n">${data.items.filter(item => item.category === cat.id).length}</span></a>`).join('') + `</nav>`;
  let i = 0;
  const grid = current === "all"
    ? cats.map((cat) => {
      const list = items.filter((item) => item.cat === cat.id);
      if (!list.length) return "";
      return `<section class="community-shop-sec"><div class="community-sec-h community-rv" style="--i:${i + 2}"><h2>${t(cat.name, cat.en)}</h2><p class="community-muted">${esc(t(cat.desc, cat.descEn))}</p></div><div class="community-shop-grid">${list.map((item) => shopCardHTML(item, data, common, i++)).join("")}</div></section>`;
    }).join("")
    : items.length ? `<div class="community-shop-grid">${items.map((item, n) => shopCardHTML(item, data, common, n)).join("")}</div>` : emptyHTML(common, t("这里还没有东西", "Nothing here yet"), t("站长上架以后就会出现在这里。", "Items appear here once the owner adds them."));
  const panelItem = redeeming ? data.items.find((item) => item.id === redeeming) : null;
  return `<section class="page community-page community-shop-page" data-community="shop" data-tab="${esc(current)}">`
    + bannerHTML({ eyebrow: "EXCHANGE", title: t("兑换所", "Exchange"), text: t("用星尘换装扮、道具卡、站长整理的资源和限量周边。兑换条件以商品为准；作者取消待发货订单时退还星尘。", "Trade stardust for looks, cards, resources and limited goods. Conditions vary by item; owner cancellation of unshipped orders refunds stardust."), esc,
      side: statsHTML([[t("我的星尘", "My stardust"), data.balance]]) + `<a class="community-button is-small" href="${shopHref("mine")}">${icons.box || ""}${t("我的兑换", "My items")}</a>` })
    + seg
    + (panelItem ? redeemPanelHTML(panelItem, data.balance, data.inventory, common) : "")
    + (delivery ? deliveryPanelHTML(delivery, common) : "")
    + grid + `<p class="community-muted community-shop-policy"><a class="community-link-sm" href="${rulesHref}">${t('社区公约 · 兑换与装扮规则', 'Convention · Exchange and equipment rules')}</a></p></section>`;
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
    return `<div class="community-inv community-spot${count ? "" : " is-empty"}">${itemArtHTML(item, null, common)}<div class="community-inv-body"><b>${name}</b><span class="community-inv-n">× ${count}</span></div>`
      + (count ? `<a class="community-button is-small is-line-gold" href="${use[0]}">${use[1]}</a>` : `<a class="community-button is-small" href="${shopHref("card")}">${t("去兑换", "Get one")}</a>`) + `</div>`;
  }).join("");
  const looks = data.looks.length
    ? `<div class="community-shop-grid">${data.looks.map((item, i) => shopCardHTML({ ...item, active: true, state: { owned: true, left: null, ok: false, code: "owned", why: "" } }, { balance: data.balance, level: 0, owner: false, items: [], inventory: data.inventory, decorations: data.decorations }, common, i, false)).join("")}</div>`
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
      side: lead ? `<div class="community-banner-lead">${avatarHTML(lead.person, common, "md")}<div><span class="community-muted">${t("本月第一", "Top this month")}</span><b>${nameLabelHTML(lead.person, common)}</b></div></div>` : "" })
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

type MemberOptions = Common & { member: CommunityLoad<CommunityMember>; me?: CommunityMe | null; muting?: boolean; badgeSelection?: CommunityBadgeSelection };
export function communityMemberHTML({ member, me = null, muting = false, badgeSelection, ...common }: MemberOptions) {
  const { t, esc, now = Date.now(), icons = {} } = common;
  const data = readyData(member);
  if (!data) return pageOf("member", common, member);
  const { person, stats } = data;
  const uid = person.uid || "";
  const days = data.joinedAt ? Math.max(1, Math.round((now - Date.parse(data.joinedAt)) / 86400e3)) : 0;
  const tabs: Array<[string, string, number?]> = [
    [memberHref(uid), t(`主题 ${data.counts.topics}`, `Topics ${data.counts.topics}`)],
    [memberHref(uid, "replies"), t(`回复 ${data.counts.replies}`, `Replies ${data.counts.replies}`)],
    [memberHref(uid, "badges"), t(`徽章 ${data.badgeState ? data.badgeState.families.filter(family => family.tier).length : data.badges.length}`, `Badges ${data.badgeState ? data.badgeState.families.filter(family => family.tier).length : data.badges.length}`)],
    ...(data.self ? [[memberHref(uid, "bookmarks"), t(`收藏 ${data.counts.bookmarks}`, `Bookmarks ${data.counts.bookmarks}`)] as [string, string]] : []),
  ];
  const index = String(["topics", "replies", "badges", "bookmarks"].indexOf(data.tab));
  let body: string;
  if (data.tab === "replies") body = data.replies.length
    ? `<ul class="community-rep-list">${data.replies.map((reply) => `<li><a class="community-rep-ref" href="${postHref(reply.topicId)}">${esc(reply.topicTitle)}</a><div class="community-text is-small">${communityBodyHTML(reply.body, esc, {}, reply.images?.map(image => image.id) || [])}</div><span class="community-muted">${relativeTime(reply.createdAt, now, t)} · ${t(`${reply.likes} 赞`, `${reply.likes} likes`)}</span></li>`).join("")}</ul>`
    : emptyHTML(common, t("还没有回复过", "No replies yet"));
  else if (data.tab === "badges") body = communityBadgeExplorerHTML(data.badgeState, data.badges, common, badgeSelection);
  else if (data.tab === "bookmarks") body = data.bookmarks.length ? communityTopicsHTML(data.bookmarks, common, { showAuthor: false }) : emptyHTML(common, t("还没有收藏", "No bookmarks yet"), t("在帖子下面点“收藏”，就会出现在这里。", "Use “Bookmark” under a post to keep it here."));
  else body = data.topics.length ? communityTopicsHTML(data.topics, common, { showAuthor: false }) : emptyHTML(common, t("还没有发过主题", "No topics yet"));
  const actions = [
    data.self ? `<a class="community-button is-small" href="#/community/profile">${icons.pen || ""}${t("编辑资料", "Edit profile")}</a>` : "",
    !data.self && me && person.role === "reader" ? `<button type="button" class="community-button is-small${data.following ? "" : " is-gold"}" data-action="community-follow" data-uid="${esc(uid)}" aria-pressed="${data.following}">${data.following ? t("已关注", "Following") : t("关注", "Follow")}</button>` : "",
    data.canMute && !data.muted ? `<button type="button" class="community-button is-small" data-action="community-mute" data-uid="${esc(uid)}">${icons.ban || ""}${t("禁言", "Mute")}</button>` : "",
    data.canAppoint ? `<a class="community-button is-small is-line-gold" href="${manageHref('stewards')}">${icons.shield || ""}<span>${data.steward ? t('调整版主负责板块', 'Edit moderator boards') : t('选择版主负责板块', 'Assign moderator boards')}</span></a>${data.steward ? `<button type="button" class="community-button is-small" data-action="community-steward" data-uid="${esc(uid)}" data-on="false"><span>${t('撤销版主', 'Remove moderator')}</span></button>` : ''}` : "",
  ].join("");
  const quick = data.quick ? `<div class="community-me-quick community-rv" style="--i:1">`
    + `<a href="${stardustHref()}"><span>${icons.star || ""}${t("我的星尘", "Stardust")}</span><b>${data.quick.balance}</b></a>`
    + (person.role === "owner" ? "" : `<a href="#/community/checkin"><span>${icons.calendar || ""}${t("签到", "Check-in")}</span><b>${data.quick.checkedIn ? t("今日已签", "Done today") : t("还没签到", "Not yet")}</b></a>`)
    + `<a href="${inboxHref()}"><span>${icons.bell || ""}${t("通知", "Notifications")}</span><b>${t(`${data.quick.unread} 未读`, `${data.quick.unread} unread`)}</b></a>`
    + `<a href="${stardustHref("levels")}"><span>${icons.trending || ""}${t("等级", "Levels")}</span><b>${person.role === "owner" ? t("站长", "Owner") : growthChipHTML(person, common) || communityLevelName(person.steward ? 4 : person.level ?? 0, t)}</b></a>`
    + `<a href="${shopHref("mine")}"><span>${icons.box || ""}${t("我的兑换", "My items")}</span><b>${t(`${data.quick.orders} 件`, `${data.quick.orders}`)}</b></a>`
    + (me?.mod ? `<a href="${manageHref()}"><span>${icons.shield || ""}${t("社区管理", "Moderation")}</span><b>${t("进入", "Open")}</b></a>` : "")
    + `</div>` : "";
  const cover = data.cover && /^[a-z]+$/.test(data.cover) ? ` is-cover-${data.cover}` : "";
  const background = profileImageURL(data.background?.url);
  const hue = [...person.name].reduce((sum, char) => sum + (char.codePointAt(0) || 0), 0) % 360;
  return `<section class="page community-page community-member" data-community="member" data-tab="${esc(data.tab)}">`
    + `<header class="community-m-hero community-rv" style="--i:0;--h:${hue}"><div class="community-m-intro"><div class="community-m-cover${background ? '' : cover}" aria-hidden="true">${background ? `<img src="${esc(background)}" alt="" decoding="async">` : '<i></i><i></i>'}</div>`
    + `<div class="community-m-id">${avatarHTML(person, common, "xl", false)}<div class="community-m-name">${levelMarksHTML(person, common, true)}<h1>${nameLabelHTML(person, common, false)}</h1><div class="community-m-tags">${roleChipHTML(person, common)}${person.uid && person.showUid ? `<span class="community-muted is-mono">UID ${esc(person.uid)}</span>` : ""}</div>`
    + (data.bio ? `<p>${esc(data.bio)}</p>` : "") + `<p class="community-muted">${days ? t(`加入 ${days} 天`, `Joined ${days} days`) : ""}${days && data.streak ? " · " : ""}${data.streak ? t(`连签 ${data.streak} 天`, `${data.streak}-day streak`) : ""}</p></div>`
    + `<div class="community-m-acts">${actions}</div></div></div>`
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
      if (data.scopeChanged) {
        const scope = data.boards;
        const labels = Array.isArray(scope) ? communityBoards.filter(board => scope.includes(board.id)).map(board => t(board.zh, board.en)).join(t('、', ', ')) : '';
        return t(`你的负责板块已调整${labels ? `：${esc(labels)}` : ''}`, `Your assigned boards have changed${labels ? `: ${esc(labels)}` : ''}`);
      }
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
        + `<span class="community-note-main"><span class="community-note-t">${item.actor ? `<b>${nameLabelHTML(item.actor, common)}</b> ` : ""}${noticeTextHTML(item, common)}</span>${item.topicTitle ? `<span class="community-note-ref">${esc(item.topicTitle)}</span>` : ""}</span>`
        + `<time class="community-note-time" datetime="${esc(item.createdAt)}">${relativeTime(item.createdAt, now, t)}</time>${item.read ? "" : `<i class="community-udot" aria-label="${t("未读", "Unread")}"></i>`}</button></li>`;
    }).join("")}</ul>`
    : emptyHTML(common, t("没有通知", "No notifications"), t("这里很安静。", "All quiet."));
  return `<section class="page community-page community-narrow" data-community="inbox" data-tab="${esc(tab)}">${head}${tabsHTML(tabs, index, t("通知分类", "Notification types"))}${body}</section>`;
}

/* ---------- 公约 ---------- */
function moderationContactsHTML(contacts: CommunityLoad<CommunityModerationContacts> | null, { t, esc }: Common) {
  const items = readyData(contacts)?.items;
  const content = !contacts || contacts.state === 'loading' ? `<p>${t('正在读取版主联系方式…', 'Loading moderator contacts…')}</p>`
    : contacts.state === 'error' ? `<p>${t('暂时无法读取版主联系方式，可先联系作者。', 'Moderator contacts are temporarily unavailable; contact the owner instead.')} <button type="button" class="community-link-sm" data-action="community-retry">${t('重试', 'Retry')}</button></p>`
    : !items?.length ? `<p>${t('版主暂未填写公开联系方式，可先联系作者。', 'No public moderator contacts yet; contact the owner instead.')}</p>`
    : `<ul class="community-moderation-contacts">${items.map(person => {
      const boards = person.owner ? t('所有板块', 'All boards') : person.boards.filter(id => communityBoards.some(board => board.id === id)).map(id => boardName(id, t)).join('、');
      const qq = /^\d{5,12}$/.test(person.qq) ? `<span>QQ：${esc(person.qq)}</span>` : '';
      const email = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(person.email) && person.email.length <= 254 ? `<a class="community-link-sm" href="mailto:${esc(encodeURIComponent(person.email))}">${esc(person.email)}</a>` : '';
      return `<li><a class="community-link-sm" href="${memberHref(person.uid)}">${esc(person.name)}</a><span class="community-moderation-contact-boards">${esc(boards)}</span><div>${qq}${email}</div></li>`;
    }).join('')}</ul>`;
  return `<div class="community-rule-contacts" data-moderation-contacts><h3>${t('版主联系方式', 'Moderator contacts')}</h3>${content}</div>`;
}

export function communityConventionBodyHTML(body: string, { t, esc }: Common, idPrefix = 'community-rule') {
  const sections: Array<{ title: string; lines: string[] }> = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) sections.push({ title: heading[1], lines: [] });
    else {
      if (!sections.length) sections.push({ title: t('社区规则', 'Community rules'), lines: [] });
      sections[sections.length - 1].lines.push(line);
    }
  }
  return `<ol class="community-rule-list">${sections.filter(section => section.title || section.lines.some(line => line.trim())).map((section, index) => `<li class="community-rule-section" id="${esc(idPrefix)}-${index + 1}"><h2>${esc(section.title)}</h2><div class="community-rule-content">${communityBodyHTML(section.lines.join('\n').trim(), esc)}</div></li>`).join('')}</ol>`;
}

function badgeRulesHTML(common: Common) {
  const { esc, t } = common;
  const headings = [t('成就系列', 'Achievement family'), ...communityBadgeTiers.map(tier => communityBadgeTierName(tier, common))];
  return `<section class="community-badge-rules" data-badge-rules aria-labelledby="community-badge-rules-title"><h2 id="community-badge-rules-title">${esc(t('徽章点亮规则', 'Badge achievement rules'))}</h2><div class="community-table-wrap" role="region" aria-label="${esc(t('各系列的点亮条件', 'Requirements for each achievement family'))}" tabindex="0"><table class="community-table"><thead><tr>${headings.map(heading => `<th scope="col">${esc(heading)}</th>`).join('')}</tr></thead><tbody>${communityBadgeFamilies.map(family => `<tr><th scope="row">${esc(t(family.name, family.en))}</th>${communityBadgeTiers.map(tier => `<td>${esc(t(family.criteria[tier], family.criteriaEn[tier]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="community-rule-content"><ul>${communityBadgeCommonRules.map((rule, i) => `<li>${esc(t(rule, communityBadgeCommonRulesEn[i]))}</li>`).join('')}</ul></div></section>`;
}

export function communityRulesHTML({ me = null, contacts = null, convention = null, ...common }: Common & { me?: CommunityMe | null; contacts?: CommunityLoad<CommunityModerationContacts> | null; convention?: CommunityLoad<CommunityConvention> | null }) {
  const { t, esc } = common;
  const body = convention ? readyData(convention)?.body : communityConventionText;
  const content = body === undefined ? communityStatusHTML(convention!, common) : communityConventionBodyHTML(body, common);
  const related = `<div class="community-rule-related"><p>${communityBoards.map(board => `<a class="community-link-sm" href="${boardHref(board.id)}">${esc(t(board.zh, board.en))}</a>`).join(' · ')}</p><p><a class="community-link-sm" href="${stardustHref('rules')}">${t('星尘规则', 'Stardust rules')}</a> · <a class="community-link-sm" href="${shopHref()}">${t('兑换所', 'Exchange')}</a> · <a class="community-link-sm" href="${authorContactURL}" target="_blank" rel="noopener noreferrer">${t('QQ 联系作者', 'Contact the owner on QQ')}</a></p>${moderationContactsHTML(contacts, common)}</div>`;
  return `<section class="page community-page community-narrow community-rules-page" data-community="rules">`
    + pageHead('GUIDELINES', t('社区公约', 'Community convention'), t('适用于無相社区所有板块与成员', 'Applies to every board and member'))
    + content + (body === undefined ? '' : badgeRulesHTML(common) + related)
    + (me?.agreed ? `<p class="community-muted">${t('你已同意当前版本公约。', 'You have agreed to the current convention.')}</p>` : '') + '</section>';
}

function conventionFormHTML(convention: CommunityLoad<CommunityConvention> | null, common: Common) {
  const { t, esc } = common;
  const current = readyData(convention);
  if (!current) return communityStatusHTML(convention || { state: 'loading' }, common);
  return `<form class="community-convention-edit-form" data-community-form="convention" novalidate><h2 class="community-subtitle">${t('修改社区公约', 'Edit the community convention')}</h2><p class="community-muted">${t('保存新条款后，所有成员都需要重新阅读至少 10 秒并同意。正文支持段落、列表和链接，用“## 标题”分章。', 'New terms require all members to read for at least 10 seconds and agree again. Use paragraphs, lists, links and “## Heading” for sections.')}</p><input type="hidden" name="version" value="${esc(current.version)}"><div class="community-field"><label class="community-field-l" for="community-convention-body">${t('公约条例', 'Convention terms')}</label><textarea id="community-convention-body" name="body" rows="16" maxlength="20000">${esc(current.body)}</textarea></div><p class="community-form-status" role="status" aria-live="polite"></p><div class="community-form-actions is-start"><button type="submit" class="community-button is-gold">${t('保存并发布公约', 'Save and publish convention')}</button></div></form>`;
}
/* ---------- 社区管理 ---------- */
export type CommunityItemEditing = { id: string | null };
const itemFormHTML = communityShopEditorHTML;

function moderationContactFormHTML(me: CommunityMe, { t, esc }: Common) {
  const contact = me.moderationContact || { qq: '', email: '' };
  return `<form class="community-moderation-contact-form" data-community-form="moderation-contact" novalidate>`
    + `<h2 class="community-subtitle">${t('我的公开联系方式', 'My public contact')}</h2><p class="community-muted">${t('用于读者咨询和申诉，公开显示在社区公约中。两项均可选，留空并保存即可取消公开；不会公开你的注册邮箱。', 'For reader questions and appeals, publicly shown in the convention. Both fields are optional; clear and save to withdraw them. Your registration email is not published.')}</p>`
    + `<div class="community-field-grid"><div class="community-field"><label class="community-field-l" for="community-contact-qq">QQ</label><input id="community-contact-qq" name="qq" type="text" inputmode="numeric" maxlength="12" autocomplete="off" value="${esc(contact.qq)}" placeholder="${t('选填 QQ 号码', 'Optional QQ number')}"></div>`
    + `<div class="community-field"><label class="community-field-l" for="community-contact-email">${t('联系邮箱', 'Contact email')}</label><input id="community-contact-email" name="email" type="email" maxlength="254" autocomplete="off" value="${esc(contact.email)}" placeholder="${t('选填公开联系邮箱', 'Optional public email')}"></div></div>`
    + `<p class="community-form-status" role="status" aria-live="polite"></p><div class="community-form-actions is-start"><button type="submit" class="community-button is-gold">${t('保存联系方式', 'Save contact')}</button></div></form>`;
}

type ManageOptions = Common & { manage: CommunityLoad<CommunityManage>; tab: string; itemEditing?: CommunityItemEditing | null; shippingOrder?: string | null; deleting?: CommunityTarget | null; me?: CommunityMe | null; selectedReviews?: string[]; managementBoard?: string; stewardCandidate?: CommunityLoad<CommunityMember> | null; stewardEditingUid?: string | null; bannerEditor?: CommunityBannerEditorState; convention?: CommunityLoad<CommunityConvention> | null };
function shippingFormHTML(id: string, common: Common) {
  const { t, esc } = common;
  return `<form class="community-panel community-ship-panel" data-community-form="ship" data-id="${esc(id)}" novalidate><p class="community-panel-title">${t("填写快递信息（可选）", "Shipping details (optional)")}</p><div class="community-field-grid"><div class="community-field"><label class="community-field-l" for="community-ship-company">${t("快递公司", "Courier")}</label><input id="community-ship-company" name="company" type="text" maxlength="40" autocomplete="organization"></div><div class="community-field"><label class="community-field-l" for="community-ship-tracking">${t("快递单号", "Tracking number")}</label><input id="community-ship-tracking" name="tracking" type="text" maxlength="80" autocomplete="off"></div></div><p class="community-muted">${t("收件人、手机号和地址会在发货后删除，单号会保留。", "Recipient, phone and address are deleted after shipping; the tracking number is retained.")}</p><p class="community-form-status" role="status" aria-live="polite"></p><div class="community-form-actions"><button type="button" class="community-button" data-action="community-ship-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-good">${t("确认已发货", "Mark shipped")}</button></div></form>`;
}
function rejectPanelHTML(id: string, common: Common, selected = 0) {
  const { t, esc } = common;
  return `<form class="community-panel is-danger community-reject-panel" data-community-form="reject" data-id="${esc(id)}"${selected ? ' data-batch="true"' : ''} novalidate><p class="community-panel-title">${selected ? t(`批量不通过 · ${selected} 个帖子`, `Reject ${selected} posts`) : t("审核不通过", "Reject post")}</p><fieldset><legend>${t("请选择理由", "Reason")}</legend><div class="community-radio-list">${communityReviewReasons.map(reason => { const labels = reviewReasonLabels[reason] || [reason, reason]; return `<label><input type="radio" name="reason" value="${esc(reason)}" required><span>${esc(t(labels[0], labels[1]))}</span></label>`; }).join("")}</div></fieldset><div class="community-field"><label class="community-field-l" for="community-reject-note">${t("补充说明（可选）", "Details (optional)")}</label><input id="community-reject-note" name="note" type="text" maxlength="200"></div><p class="community-form-status" role="status" aria-live="polite"></p><div class="community-form-actions"><button type="button" class="community-button" data-action="community-reject-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-danger">${t("确认不通过", "Reject")}</button></div></form>`;
}
export function communityManageHTML({ manage, tab, itemEditing = null, shippingOrder = null, rejecting = null, deleting = null, me = null, selectedReviews = [], managementBoard = '', stewardCandidate = null, stewardEditingUid = null, bannerEditor, convention = null, ...common }: ManageOptions & { rejecting?: string | null }) {
  const { t, esc, now = Date.now(), icons = {} } = common;
  const data = readyData(manage);
  const dialog = (content: string, title: string) => `<div class="community-management-dialog"><div role="dialog" aria-modal="true" aria-label="${esc(title)}">${content}</div></div>`;
  const mayManage = Boolean(data || me?.owner || me?.mod);
  const owner = data?.owner ?? (mayManage ? Boolean(me?.owner) : null);
  const head = pageHead('', owner === true ? t('作者社区管理', 'Owner community management') : owner === false ? t('版主社区管理', 'Moderator community management') : t('社区管理', 'Community management'), t('处理社区内容与事务，管理操作会留下记录。', 'Manage community content and operations. Actions are recorded.'));
  const taskKpi = (id: 'queue' | 'reports', label: string, count: number | undefined) => `<div${mayManage ? ` class="community-management-kpi${tab === id ? ' is-selected' : ''}"` : ''}><dt>${mayManage ? `<a href="${manageHref(id)}" data-community-management-switch="${id}"${tab === id ? ' aria-current="page"' : ''}>${label}${icons['chevron-right'] || ''}</a>` : label}</dt><dd${count ? ' class="is-warn"' : ''}>${count ?? '—'}</dd></div>`;
  const kpis = `<dl class="community-kpis community-rv" style="--i:1">${taskKpi('queue', t('待审', 'Queue'), data?.counts.queue)}${taskKpi('reports', t('待处理举报', 'Open reports'), data?.counts.reports)}<div><dt>${t("24 小时新主题", "Topics · 24 h")}</dt><dd>${data?.kpis.topics24h ?? '—'}</dd></div><div><dt>${t("24 小时回复", "Replies · 24 h")}</dt><dd>${data?.kpis.replies24h ?? '—'}</dd></div></dl>`;
  const all: Array<[string, string, string, number?]> = !mayManage ? [] : [
    ["review", manageHref(), t("内容审核", "Content review"), data ? data.counts.queue + data.counts.reports : undefined],
    ["profiles", manageHref("profiles"), t("资料审核", "Profile review")],
    ["content", manageHref("content"), t("帖子管理", "Posts")],
    ["banners", manageHref("banners"), t("横幅设置", "Banners")],
    ...(owner ? [["orders", manageHref("orders"), t("兑换发货", "Orders"), data?.counts.orders], ["items", manageHref("items"), t("兑换所上架", "Shop items")], ["stewards", manageHref("stewards"), t("版主管理", "Moderators")]] as Array<[string, string, string, number?]> : []),
    ["sanctions", manageHref("sanctions"), t("处罚记录", "Sanctions")], ["data", manageHref("data"), t("数据", "Data")],
    ["contact", manageHref("contact"), t("联系设置", "Contact settings")],
    ...(owner ? [["convention", manageHref("convention"), t("社区公约", "Community convention")]] as Array<[string, string, string, number?]> : []),
  ];
  if (!data) {
    const status = communityStatusHTML(manage, common);
    return communityManagementShellHTML(owner, tab, all, `${head}${kpis}<div class="community-management-body" aria-busy="${manage.state === 'loading'}">${status}</div>`, common, mayManage);
  }
  const who = (person: CommunityPerson | null) => person ? nameLabelHTML(person, common) : t("（已注销）", "(deleted)");
  const allowedBoards = data.owner ? communityBoards : communityBoards.filter(item => (data.moderationBoards ?? me?.moderationBoards ?? communityBoards.map(board => board.id)).includes(item.id));
  const board = allowedBoards.some(item => item.id === managementBoard) ? managementBoard : '';
  const matchesBoard = (value: string | null | undefined) => !board || value === board;
  const boardFilter = tab === 'queue' || tab === 'reports' ? `<h2 class="community-subtitle">${tab === 'queue' ? t('待审内容', 'Review queue') : t('举报处理', 'Reports')}</h2><div class="community-management-filter" role="group" aria-label="${t('按板块筛选', 'Filter by board')}"><span>${t('板块', 'Board')}</span>${[['', data.owner ? t('全部板块', 'All boards') : t('我负责的板块', 'My boards')], ...allowedBoards.map(item => [item.id, t(item.zh, item.en)])].map(([id, label]) => `<button type="button" class="community-button is-small" data-action="community-management-board" data-board="${id}" aria-pressed="${board === id}">${label}</button>`).join('')}</div>` : '';
  let body = "";
  if (tab === 'profiles') {
    body = communityProfileReviewsHTML(data.profiles || [], data.backgrounds || [], data.owner, common);
  } else if (tab === 'contact') {
    body = me && (me.owner || me.mod) && !me.management?.browsingAsReader ? moderationContactFormHTML(me, common) : communityStatusHTML({ state: 'loading' }, common);
  } else if (tab === 'convention') {
    body = data.owner ? conventionFormHTML(convention, common) : emptyHTML(common, t('只有作者可以修改公约。', 'Only the owner can edit the convention.'));
  } else if (tab === 'banners') {
    const configs = data.banners || [];
    body = communityBannerEditorHTML({ configs, scope: configs[0]?.scope || '', draft: configs[0] || null, candidates: { state: 'loading' }, query: '', busy: false, ...bannerEditor, owner: data.owner, ...common });
  } else if (tab === "queue") {
    const queueTopics = data.queue.topics.filter(topic => matchesBoard(topic.board));
    const pending = queueTopics.filter(topic => topic.pending);
    const selected = new Set(selectedReviews.filter(id => pending.some(topic => topic.id === id)));
    const tools = pending.length ? `<div class="community-review-tools"><label class="community-check"><input type="checkbox" data-community-review-all${pending.slice(0, 50).every(topic => selected.has(topic.id)) ? ' checked' : ''}><span>${t('全选待审', 'Select pending')}</span></label><span class="community-muted" data-review-count>${t(`已选 ${selected.size} 个 · 每批最多 50 个`, `${selected.size} selected · up to 50`)}</span><div class="community-action-group"><button type="button" class="community-button is-small is-good" data-action="community-batch-approve"${selected.size ? '' : ' disabled'}>${icons.check || ''}<span>${t('批量通过', 'Approve selected')}</span></button><button type="button" class="community-button is-small" data-action="community-batch-reject"${selected.size ? '' : ' disabled'}>${t('批量不通过', 'Reject selected')}</button></div></div>` : '';
    const topics = queueTopics.map((topic) => `<li class="community-queue-item" data-review-row="${esc(topic.id)}">${topic.pending ? `<label class="community-review-choice"><input type="checkbox" data-community-review-select value="${esc(topic.id)}"${selected.has(topic.id) ? ' checked' : ''} aria-label="${esc(t(`选择「${topic.title}」`, `Select ${topic.title}`))}"></label>` : ''}<div class="community-queue-main">`
      + `<span class="community-queue-why">${topic.pending ? t(`待审 · ${esc(topic.pendingReason || "")}`, `Review · ${esc(topic.pendingReason || "")}`) : t(`已自动隐藏 · ${esc(topic.hiddenReason || "")}`, `Hidden · ${esc(topic.hiddenReason || "")}`)}</span>`
      + `<a class="community-queue-title" href="${postHref(topic.id)}">${esc(topic.title)}</a><span class="community-muted">${who(topic.author)} · ${esc(boardName(topic.board, t))} · ${relativeTime(topic.createdAt, now, t)}</span><p class="community-queue-body">${esc(plainText(topic.body))}</p></div>`
      + `<div class="community-queue-acts">${topic.pending
        ? `<button type="button" class="community-button is-small is-good" data-action="community-approve" data-id="${esc(topic.id)}">${icons.check || ""}<span>${t("通过", "Approve")}</span></button><button type="button" class="community-button is-small" data-action="community-reject" data-kind="topic" data-id="${esc(topic.id)}">${icons.trash || ""}<span>${t("不通过", "Reject")}</span></button>`
        : `<button type="button" class="community-button is-small" data-action="community-restore" data-kind="topic" data-id="${esc(topic.id)}">${icons.eye || ""}<span>${t("恢复", "Restore")}</span></button><button type="button" class="community-button is-small is-danger" data-action="community-queue-delete" data-kind="topic" data-id="${esc(topic.id)}" data-violation="true">${icons.trash || ""}<span>${t("按违规删除", "Remove")}</span></button>`}</div></li>`).join("");
    const replies = data.queue.replies.filter(reply => matchesBoard(reply.board)).map((reply) => `<li class="community-queue-item"><div class="community-queue-main"><span class="community-queue-why">${t("回复已自动隐藏", "Hidden reply")}</span>`
      + `<a class="community-queue-title" href="${postHref(reply.topicId)}">${esc(reply.topicTitle)}</a><span class="community-muted">${who(reply.author)}${reply.board ? ` · ${esc(boardName(reply.board, t))}` : ''} · ${relativeTime(reply.createdAt, now, t)}</span><p class="community-queue-body">${esc(plainText(reply.body))}</p></div>`
      + `<div class="community-queue-acts"><button type="button" class="community-button is-small" data-action="community-restore" data-kind="reply" data-id="${esc(reply.id)}">${icons.eye || ""}<span>${t("恢复", "Restore")}</span></button><button type="button" class="community-button is-small is-danger" data-action="community-queue-delete" data-kind="reply" data-id="${esc(reply.id)}" data-violation="true">${icons.trash || ""}<span>${t("按违规删除", "Remove")}</span></button></div></li>`).join("");
    body = `${tools}${rejecting ? dialog(rejectPanelHTML(rejecting, common, rejecting === 'batch' ? selected.size : 0), t('审核不通过', 'Reject posts')) : ""}${topics || replies ? `<ul class="community-queue">${topics}${replies}</ul>` : emptyHTML(common, board ? t('当前板块没有待处理内容', 'Nothing to review in this board') : t("没有待处理的内容", "Nothing to review"), board ? t('可以切换其他板块查看。', 'Select another board to view its tasks.') : t("都处理完了。", "All clear."))}`;
  } else if (tab === "content") {
    body = data.content?.length ? `<ul class="community-queue">${data.content.map(topic => `<li class="community-queue-item"><div class="community-queue-main"><a class="community-queue-title" href="${postHref(topic.id)}">${esc(topic.title)}</a><span class="community-muted">${who(topic.author)} · ${esc(boardName(topic.board, t))} · ${relativeTime(topic.createdAt, now, t)}</span></div><div class="community-queue-acts"><a class="community-button is-small" href="${postHref(topic.id)}">${icons.eye || ''}<span>${t('查看', 'View')}</span></a><button type="button" class="community-button is-small is-danger" data-action="community-queue-delete" data-kind="topic" data-id="${esc(topic.id)}">${icons.trash || ''}<span>${t('删除', 'Delete')}</span></button></div></li>`).join('')}</ul>` : emptyHTML(common, t('暂无帖子', 'No posts yet'));
  } else if (tab === "reports") {
    const reports = data.reports.filter(report => matchesBoard(report.target.board));
    body = reports.length
      ? `<ul class="community-queue">${reports.map((report) => `<li class="community-queue-item"><div class="community-queue-main">`
        + `<span class="community-queue-why">${esc(report.reason)}${report.target.hidden ? t(" · 已自动隐藏", " · hidden") : ""}${report.target.gone ? t(" · 内容已不存在", " · content is gone") : ""}</span>`
        + (report.target.topicId ? `<a class="community-queue-title" href="${postHref(report.target.topicId)}">${report.target.kind === "reply" ? t("回复：", "Reply: ") : ""}${esc(report.target.kind === "reply" ? [...report.target.excerpt].slice(0, 40).join("") : report.target.title)}</a>` : `<span class="community-queue-title">${esc(report.target.title)}</span>`)
        + `<span class="community-muted">${report.target.board ? esc(boardName(report.target.board, t)) : t('已删除或未知板块', 'Deleted or unknown board')} · ${t(`作者 ${who(report.target.author)} · 举报人 ${who(report.reporter)}（${report.reporter.role === "owner" ? "站长" : communityLevelName(report.reporter.steward ? 4 : report.reporter.level ?? 0, t)}） · ${relativeTime(report.createdAt, now, t)}`, `By ${who(report.target.author)} · reported by ${who(report.reporter)} · ${relativeTime(report.createdAt, now, t)}`)}</span>`
        + (report.target.excerpt ? `<p class="community-queue-body">${esc(report.target.excerpt)}</p>` : "")
        + (report.note ? `<p class="community-queue-body">“${esc(report.note)}”</p>` : "")
        + `</div><div class="community-queue-acts"><button type="button" class="community-button is-small is-good" data-action="community-uphold" data-id="${esc(report.id)}">${icons.check || ""}<span>${t("举报成立", "Uphold")}</span></button><button type="button" class="community-button is-small" data-action="community-dismiss" data-id="${esc(report.id)}"><span>${t("驳回", "Dismiss")}</span></button></div></li>`).join("")}</ul>`
      : emptyHTML(common, board ? t('当前板块没有待处理举报', 'No open reports in this board') : t("没有待处理的举报", "No open reports"), board ? t('可以切换其他板块查看。', 'Select another board to view its tasks.') : t("都处理完了。", "All clear."));
  } else if (tab === "orders" && data.owner) {
    const status: Record<string, [string, string]> = { pending: [t("待发货", "To ship"), "is-penalty"], shipped: [t("已发货", "Shipped"), "is-in"], cancelled: [t("已取消", "Cancelled"), ""] };
    body = data.orders.length
      ? `${shippingOrder ? dialog(shippingFormHTML(shippingOrder, common), t('填写快递信息', 'Shipping details')) : ""}<div class="community-table-wrap"><table class="community-table"><thead><tr><th>${t("时间", "Time")}</th><th>${t("成员", "Member")}</th><th>${t("兑换", "Item")}</th><th>${t("收货信息", "Shipping")}</th><th>${t("状态", "Status")}</th><th>${t('操作', 'Actions')}</th></tr></thead><tbody>${data.orders.map((order) => {
        const [label, cls] = status[order.status] || [order.status, ""];
        return `<tr><td class="is-mono" data-label="${t("时间", "Time")}">${esc(beijingTime(order.createdAt))}</td><td data-label="${t("成员", "Member")}">${nameHTML(order.member, common)}</td><td data-label="${t("兑换", "Item")}">${esc(order.itemName)} <span class="community-muted">· ${order.price}</span></td>`
          + `<td data-label="${t("收货信息", "Shipping")}">${order.shipping ? `<div class="community-ship"><b>${esc(order.shipping.name)}</b> <span class="is-mono">${esc(order.shipping.phone)}</span><br>${esc(order.shipping.address)}</div>` : `<span class="community-muted">${order.status === "pending" ? "—" : t("已删除", "Deleted")}</span>`}${order.tracking?.number ? `<span class="community-order-tracking">${esc(order.tracking.company)} · ${esc(order.tracking.number)}</span>` : ""}</td>`
          + `<td data-label="${t("状态", "Status")}"><span class="community-kind ${cls}">${label}</span></td><td class="is-right" data-label="${t("操作", "Actions")}">${order.status === "pending" ? `<div class="community-action-group community-order-actions"><button type="button" class="community-button is-small is-good" data-action="community-ship" data-id="${esc(order.id)}">${icons.truck || ""}<span>${t("标记已发货", "Shipped")}</span></button> <button type="button" class="community-button is-small" data-action="community-cancel-order" data-id="${esc(order.id)}"><span>${t("取消并退回", "Cancel & refund")}</span></button></div>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div><p class="community-muted">${t("收货信息只给站长看，发货或取消后自动删除。", "Shipping details are only for the owner and are deleted once shipped or cancelled.")}</p>`
      : emptyHTML(common, t("没有实物兑换", "No goods orders"));
  } else if (tab === "items" && data.owner) {
    const editing = itemEditing ? (itemEditing.id ? data.items.find((item) => item.id === itemEditing.id) || null : null) : undefined;
    const list = data.items.length
      ? `<div class="community-table-wrap"><table class="community-table"><thead><tr><th>${t("名称", "Name")}</th><th>${t("类别", "Kind")}</th><th class="is-right">${t("价格", "Price")}</th><th>${t("库存", "Stock")}</th><th>${t("状态", "Status")}</th><th></th></tr></thead><tbody>${data.items.map((item) => `<tr><td data-label="${t("名称", "Name")}">${item.image ? `<img class="community-managed-art" src="/api/community/images/${esc(item.image)}.webp" alt="">` : ""}${esc(item.name)}</td><td data-label="${t("类别", "Kind")}">${item.kind === "frame" ? t("头像框", "Frame") : item.kind === "color" ? t("昵称特效", "Name effect") : item.cat === "digital" ? t("数字资源", "Digital") : t("实物周边", "Goods")}</td><td class="is-right is-mono" data-label="${t("价格", "Price")}">${item.price}</td><td class="is-mono" data-label="${t("库存", "Stock")}">${item.stock === null || item.stock === undefined ? t("不限", "—") : `${item.left ?? 0} / ${item.stock}`}</td><td data-label="${t("状态", "Status")}">${item.active ? `<span class="community-kind is-in">${t("上架中", "On sale")}</span>` : `<span class="community-kind">${t("已下架", "Off")}</span>`}</td><td class="is-right" data-label="${t("操作", "Actions")}"><button type="button" class="community-button is-small" data-action="community-item-edit" data-id="${esc(item.id)}">${icons.pen || ""}<span>${t("编辑", "Edit")}</span></button></td></tr>`).join("")}</tbody></table></div>`
      : emptyHTML(common, t("还没有上架物品", "No items yet"), t("这里可以上架头像框、昵称特效、数字资源和实物周边。", "Create frames, nickname effects, digital resources and physical goods here."));
    body = communityCategoryEditorHTML(data.categories || [], common) + (editing !== undefined ? itemFormHTML(editing, data.categories || [], common) : `<div class="community-form-actions is-start"><button type="button" class="community-button is-gold" data-action="community-item-edit" data-id="">${icons.plus || ""}<span>${t("上架新物品", "New item")}</span></button></div>`) + (editing !== undefined ? "" : list);
  } else if (tab === "stewards" && data.owner) {
    body = communityStewardsHTML(data.stewards || [], stewardCandidate, common, stewardEditingUid);
  } else if (tab === "sanctions") {
    body = data.sanctions.length
      ? `<p class="community-muted">${t('处罚历史持续保留，当前展示最近 100 条；只有生效中的处罚可以解除。', 'History is retained. Showing the latest 100 records; only active sanctions can be lifted.')}</p><div class="community-table-wrap"><table class="community-table"><thead><tr><th>${t("成员", "Member")}</th><th>${t("处罚", "Sanction")}</th><th>${t("原因", "Reason")}</th><th>${t("到期", "Until")}</th><th>${t('状态', 'State')}</th><th>${t('操作', 'Actions')}</th></tr></thead><tbody>${data.sanctions.map((sanction) => `<tr><td data-label="${t("成员", "Member")}">${nameHTML(sanction.member, common)}</td><td data-label="${t("处罚", "Sanction")}">${t(`禁言 ${sanction.days} 天`, `Muted ${sanction.days} d`)}</td><td data-label="${t("原因", "Reason")}">${esc(sanction.reason)}</td><td class="is-mono" data-label="${t("到期", "Until")}">${esc(beijingTime(sanction.until, true))}</td><td data-label="${t('状态', 'State')}">${sanction.state === 'lifted' ? t('已解除', 'Lifted') : sanction.state === 'expired' ? t('已到期', 'Expired') : t('生效中', 'Active')}</td><td class="is-right" data-label="${t("操作", "Actions")}">${sanction.active === false ? '—' : `<button type="button" class="community-button is-small" data-action="community-lift" data-id="${esc(sanction.id)}"><span>${t("解除", "Lift")}</span></button>`}</td></tr>`).join("")}</tbody></table></div>`
      : emptyHTML(common, t("暂无处罚记录", "No sanctions yet"), t("处罚记录会持续保留，不会一周后清理。", "Sanction history is retained."));
  } else if (tab === "data" && data.data) {
    const flow = data.data.flow;
    const max = Math.max(10, ...flow.map((row) => Math.max(row.issued, row.recovered)));
    const boards = data.data.boards;
    const boardMax = Math.max(1, ...boards.map((row) => row.topics));
    const flowCard = data.owner ? `<section class="community-card community-span-2">${cardHead(t("近 7 天星尘发放与回收", "Stardust issued and recovered, 7 days"), "", `<span class="community-legend"><span><i class="community-sw is-in"></i>${t("系统发放", "Issued")}</span><span><i class="community-sw is-out"></i>${t("消耗与扣罚", "Spent and penalties")}</span></span>`)}`
      + `<div class="community-bars" role="img" aria-label="${t("近 7 天星尘发放与回收", "Stardust issued and recovered over 7 days")}">${flow.map((row) => `<div class="community-bar-col"><div class="community-bar-pair"><i class="community-bar is-in" style="height:${row.issued / max * 100}%" title="${t(`发放 ${row.issued}`, `Issued ${row.issued}`)}"></i><i class="community-bar is-out" style="height:${row.recovered / max * 100}%" title="${t(`回收 ${row.recovered}`, `Recovered ${row.recovered}`)}"></i></div><span class="is-mono">${esc(row.day.slice(5))}</span></div>`).join("")}</div>`
      + `<p class="community-muted">${t("用户之间的转账（感谢、悬赏、解锁）不算发放。发放长期远大于回收时，要考虑下调奖励或增加消耗。", "Transfers between members (thanks, bounties, unlocks) are not issuance. If issuance stays far above recovery, lower rewards or add ways to spend.")}</p></section>` : `<p class="community-muted community-span-2">${t('仅显示你负责板块的数据；全社区星尘数据由作者查看。', 'Only your assigned boards are shown. Global stardust data is available to the owner.')}</p>`;
    body = `<div class="community-pt-grid">${flowCard}<section class="community-card community-span-2">${cardHead(t("各版块主题数", "Topics per board"))}<ul class="community-hbars">${boards.map((row) => `<li><span>${esc(boardName(row.id, t))}</span><span class="community-hbar"><i style="width:${row.topics / boardMax * 100}%;background:${communityBoards.find((board) => board.id === row.id)?.color || "#aeb3bd"}"></i></span><span class="is-mono">${row.topics}</span></li>`).join("")}</ul></section></div>`;
  } else body = emptyHTML(common, t("没有这个分类", "No such section"));
  return communityManagementShellHTML(data.owner, tab, all, `${head}${kpis}${deleting ? dialog(communityDeletePanelHTML(deleting, common), t('删除内容', 'Delete content')) : ""}<div class="community-management-body">${boardFilter}${body}</div>`, common);
}
