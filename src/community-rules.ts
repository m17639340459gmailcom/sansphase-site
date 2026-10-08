// 社区规则（设计稿 docs/COMMUNITY-DESIGN.md 第 3–9 节）：数值、等级、徽章和兑换所目录。
// 服务端结算和页面说明共用这一份；改数值只改这里。
import { uploadLimits, readerImageBytes } from './upload-policy.mjs';

export const communityRules = {
  // 签到与补签（第 5 节）
  checkinBase: 1, checkinVipBonus: 1, monthBonus: 5,
  makeupCost: 30, makeupPerMonth: 2, makeupWindow: 7,
  // 已确认的获取规则：docs/COMMUNITY-STARDUST-RULES.md；三项贡献奖励合计每日最多 6。
  dailyCap: 6,
  topicReward: 2, topicDaily: 1, replyReward: 1, replyDaily: 1, replyMinLength: 10, likeReward: 0, likeDaily: 0,
  acceptReward: 3, acceptDaily: 1, featureReward: 15, featureMonthly: 2, reportReward: 0, reportDaily: 0, penalty: 20,
  // 消耗
  thankCost: 10, thankToAuthor: 8, unlockShare: 0.8, unlockMin: 5, unlockMax: 50, pinCost: 200, pinHours: 24, glowDays: 3,
  bountyOptions: [20, 50, 100], bountyDays: 7,
  // 初光（L0）的限制（第 7 节）
  l0TopicsDaily: 2, l0RepliesDaily: 10, l0Links: 2, l0Images: 1, l0ReviewCount: 2,
  // 编辑期限：初光、巡天 24 小时，观测起 30 天
  editWindowHours: 24, editWindowDaysL2: 30,
  // 内容
  showcaseImageMax: 9, imageMax: 4, imageBytes: readerImageBytes, tagMax: 3, momentMax: 300,
} as const;

// The owner keeps the main site's existing technical image ceiling.
export const communityImageBytes = (owner = false) => owner ? uploadLimits.maxImageBytes : communityRules.imageBytes;

// 标签由站长维护，发帖时只能选。
export const communityTags = ["新手", "提示词", "工作流", "ComfyUI", "Midjourney", "Stable Diffusion", "Claude", "Cursor", "视频生成", "音乐生成", "本地模型", "可商用", "效率"] as const;
export const communityReportReasons = ["垃圾广告 / 引流", "人身攻击", "盗版 / 破解资源", "违法违规", "与版块无关", "链接失效 / 内容过时", "其他"] as const;
export const communityReviewReasons = ["广告引流", "留联系方式", "与版块无关", "重复内容", "其他"] as const;
export const communityUsages = ["个人创作，不可商用", "个人使用", "可商用", "仅供学习"] as const;
export const communityResourceKinds = ["软件", "网站", "教程", "素材"] as const;
export const communityResourcePrices = ["免费", "部分免费", "付费"] as const;
export type PromptMode = "public" | "hidden" | "paid";

// 北京时间的日期（YYYY-MM-DD），签到、每日上限和等级重算都按它换日。
export const beijingDay = (ms: number) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
// 普通读者每天 1 星尘，有效 VIP 额外 1；满勤另得 5，由服务端核验资格及防重。
export function checkinReward(completesMonth = false, vip = false) {
  const base = communityRules.checkinBase + (vip ? communityRules.checkinVipBonus : 0), bonus = completesMonth ? communityRules.monthBonus : 0;
  return { base, bonus, total: base + bonus };
}
export function checkinMonth(month: string, days: readonly string[]) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError('Invalid check-in month');
  const [year, number] = month.split('-').map(Number);
  const totalDays = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const dates = Array.from({ length: totalDays }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const valid = new Set(dates), signed = [...new Set(days)].filter(key => valid.has(key));
  return { month, totalDays, dates, signed, complete: signed.length === totalDays };
}
// 每帖图片上限：作品展廊 9 张，工具资源不配图，其他 4 张；初光每帖 1 张。
export function imageLimit(board: string, level = 1) {
  const max = board === "showcase" ? communityRules.showcaseImageMax : board === "tools" ? 0 : communityRules.imageMax;
  return level < 1 ? Math.min(max, communityRules.l0Images) : max;
}
export const countLinks = (text: string) => (String(text || "").match(/https?:\/\//g) || []).length;

/* ---------- 等级（信任等级，第 7 节） ---------- */
export const communityLevels = [
  { lv: 0, name: "初光", en: "FIRST LIGHT" },
  { lv: 1, name: "巡天", en: "SURVEY" },
  { lv: 2, name: "观测", en: "OBSERVER" },
  { lv: 3, name: "守夜", en: "NIGHT WATCH" },
  { lv: 4, name: "协管", en: "STEWARD" },
] as const;
export type LevelStat = "visitDays" | "visits100" | "topicsViewed" | "approved" | "likesRecv" | "distinctReplies" | "honor";
export const communityLevelRules: Record<1 | 2 | 3, Array<{ key: LevelStat; label: string; labelEn: string; need: number }>> = {
  1: [
    { key: "visitDays", label: "访问天数", labelEn: "Days visited", need: 3 },
    { key: "approved", label: "发出的主题", labelEn: "Topics published", need: 1 },
  ],
  2: [
    { key: "visitDays", label: "累计访问天数", labelEn: "Days visited", need: 15 },
    { key: "likesRecv", label: "收到的赞", labelEn: "Likes received", need: 10 },
    { key: "distinctReplies", label: "回复过的不同主题", labelEn: "Topics replied to", need: 10 },
  ],
  3: [
    { key: "visits100", label: "近 100 天访问天数", labelEn: "Days visited (last 100)", need: 40 },
    { key: "likesRecv", label: "收到的赞", labelEn: "Likes received", need: 50 },
    { key: "honor", label: "精华 ≥ 1 次，或被采纳 ≥ 3 次", labelEn: "1+ featured, or 3+ accepted", need: 1 },
  ],
};
// Level 2 also needs no violation in 30 days; level 3 none in 180 days.
export const communityCleanDays = { 2: 30, 3: 180 } as const;
export const communityLevelPerks: Record<number, Array<[string, string]>> = {
  0: [["每天最多 2 个主题、10 条回复", "Up to 2 topics and 10 replies a day"], ["每帖最多 1 张图、2 个外链", "1 image and 2 links per post"], ["前 2 个带链接或图片的帖子先审后发", "The first 2 posts with links or images are reviewed first"], ["不能悬赏、不能感谢、不能举报；点赞不给对方星尘", "No bounties, thanks or reports; likes give no stardust"]],
  1: [["解除初光限制：普通帖子最多 4 张图，作品展廊最多 9 张", "Lift first-light limits: up to 4 images per post, or 9 in Showcase"], ["点赞表达认可，不发星尘", "Likes show appreciation without stardust"], ["可以举报、悬赏、感谢", "Can report, offer bounties and thank"]],
  2: [["编辑期限延长到 30 天", "Edit for 30 days"], ["每日发帖、回复上限 ×1.5", "1.5× daily posting limits"], ["举报开始计入自动隐藏", "Reports count towards auto-hiding"]],
  3: [["举报即隐藏初光、巡天用户的内容", "A report hides content by first-light and survey members"], ["可以给帖子改标签", "Can change tags on posts"], ["条件不满足会掉回观测", "Falls back to observer when the conditions lapse"]],
  4: [["置顶、移动、锁帖、审核", "Pin, move, lock and review"], ["操作全部进审计日志", "Every action is audited"]],
};
export const levelName = (level: number, owner = false) => owner ? "站长" : communityLevels[Math.max(0, Math.min(4, level))].name;

/* ---------- 徽章 ---------- */
export const communityBadges: Record<string, { name: string; en: string; tier: "bronze" | "silver" | "gold"; desc: string; descEn: string; icon: string }> = {
  first_checkin: { name: "第一次签到", en: "First check-in", tier: "bronze", desc: "完成第一次签到", descEn: "Checked in for the first time", icon: "calendar" },
  streak7: { name: "连签 7 天", en: "7-day streak", tier: "bronze", desc: "连续签到 7 天", descEn: "Checked in 7 days in a row", icon: "calendar" },
  streak30: { name: "连签 30 天", en: "30-day streak", tier: "silver", desc: "连续签到 30 天", descEn: "Checked in 30 days in a row", icon: "calendar" },
  streak100: { name: "连签 100 天", en: "100-day streak", tier: "gold", desc: "连续签到 100 天", descEn: "Checked in 100 days in a row", icon: "calendar" },
  streak365: { name: "一整年", en: "A whole year", tier: "gold", desc: "连续签到 365 天", descEn: "Checked in 365 days in a row", icon: "calendar" },
  early: { name: "早鸟", en: "Early bird", tier: "silver", desc: "当天前 10 个签到", descEn: "Among the first ten check-ins of a day", icon: "sunrise" },
  first_topic: { name: "第一帖", en: "First topic", tier: "bronze", desc: "发出第一个主题", descEn: "Published a first topic", icon: "pen" },
  nice: { name: "不错", en: "Nice", tier: "bronze", desc: "累计收到 10 个赞", descEn: "Received 10 likes", icon: "like" },
  good: { name: "很好", en: "Good", tier: "silver", desc: "累计收到 50 个赞", descEn: "Received 50 likes", icon: "like" },
  accepted1: { name: "第一次被采纳", en: "First accepted answer", tier: "bronze", desc: "回答第一次被采纳", descEn: "An answer was accepted", icon: "check" },
  accepted10: { name: "答疑者", en: "Helper", tier: "silver", desc: "回答被采纳 10 次", descEn: "10 accepted answers", icon: "check" },
  featured: { name: "精华作者", en: "Featured author", tier: "gold", desc: "有主题被评为精华", descEn: "Had a topic featured", icon: "award" },
};
export const communityCheckinBadges = ["first_checkin", "streak7", "streak30", "streak100", "streak365", "early"] as const;

/* ---------- 兑换所（道具卡保留内置规则；作者可上架资源、实物和安全的装扮） ---------- */
export type ShopLimit = { per: "month" | "year" | "once"; n: number } | null;
export type ShopCategory = { id: string; name: string };
export type NameEffect = { style: "solid" | "gradient" | "shimmer"; colors: string[] };
// The same allowlist protects persisted effects and their eventual CSS variables.
export function communityNameEffect(value: unknown): NameEffect | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>, style = input.style;
  if (style !== "solid" && style !== "gradient" && style !== "shimmer") return null;
  if (!Array.isArray(input.colors) || input.colors.length !== (style === "solid" ? 1 : 2)
    || !input.colors.every(color => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))) return null;
  return { style, colors: input.colors.map(color => String(color).toUpperCase()) };
}
export type ShopItem = {
  image?: string | null;
  category?: string | null;
  effect?: NameEffect | null;
  id: string; cat: "look" | "card" | "digital" | "goods"; kind: "frame" | "color" | "cover" | "card" | "digital" | "goods";
  ref?: string; name: string; desc: string; price: number; limit?: ShopLimit; minLevel?: number; minDays?: number;
  stock?: number | null; left?: number | null; note?: string; builtin: boolean;
};
export const communityShopCats = [
  { id: "look", name: "装扮", en: "Looks", desc: "头像框、昵称颜色、主页封面", descEn: "Frames, name colours and profile covers" },
  { id: "card", name: "道具卡", en: "Cards", desc: "补签、置顶、高亮", descEn: "Make-up, pin and highlight" },
  { id: "digital", name: "数字资源", en: "Digital", desc: "站长整理的提示词、工作流和素材", descEn: "Prompts, workflows and assets from the owner" },
  { id: "goods", name: "实物周边", en: "Goods", desc: "限量，包邮到中国大陆", descEn: "Limited, shipped within mainland China" },
] as const;
// Local preview samples and identifiers for previously-owned decorations.
// Formal shop publication is controlled by stored author-created products.
export const communityBuiltinItems: readonly ShopItem[] = [
  { id: "frame-gold", cat: "look", kind: "frame", ref: "gold", name: "金环头像框", desc: "一圈细金边，低调。", price: 80, builtin: true },
  { id: "frame-orbit", cat: "look", kind: "frame", ref: "orbit", name: "轨道头像框", desc: "外圈有一颗小星一直在绕。", price: 150, builtin: true },
  { id: "frame-nebula", cat: "look", kind: "frame", ref: "nebula", name: "星云头像框", desc: "紫粉色的星云光晕。", price: 300, builtin: true },
  { id: "color-gold", cat: "look", kind: "color", ref: "gold", name: "星光金昵称", desc: "昵称变成暖金色，帖子、回复、排行榜里都看得到。", price: 120, builtin: true },
  { id: "color-aurora", cat: "look", kind: "color", ref: "aurora", name: "极光昵称", desc: "青绿到淡紫的流动渐变。", price: 260, minLevel: 1, builtin: true },
  { id: "cover-aurora", cat: "look", kind: "cover", ref: "aurora", name: "极光主页封面", desc: "个人主页顶部换成缓慢流动的极光。", price: 180, builtin: true },
  { id: "cover-abyss", cat: "look", kind: "cover", ref: "abyss", name: "深海主页封面", desc: "光从海面照进来的深蓝色。", price: 180, builtin: true },
  { id: "card-makeup", cat: "card", kind: "card", ref: "makeup", name: "补签卡", desc: "补签最近 7 天里漏掉的一天，把连签接上。", price: 30, limit: { per: "month", n: 2 }, builtin: true },
  { id: "card-pin", cat: "card", kind: "card", ref: "pin", name: "推荐卡", desc: "把自己的作品帖或资源帖在版块里推荐 24 小时。", price: 200, limit: { per: "month", n: 2 }, minLevel: 1, builtin: true },
  { id: "card-highlight", cat: "card", kind: "card", ref: "highlight", name: "高亮卡", desc: "让你的一个帖子标题在列表里发光 3 天。", price: 60, builtin: true },
];
export const decorationKinds = ["frame", "color", "cover"] as const;
export type DecorationKind = typeof decorationKinds[number];

/* ---------- 通知 ---------- */
export const communityNoticeGroups: Record<string, readonly string[] | null> = {
  all: null,
  reply: ["reply", "mention"],
  thanks: ["accept", "thank", "unlock", "like", "feature"],
  system: ["system", "level", "badge", "review", "penalty", "follow"],
};
