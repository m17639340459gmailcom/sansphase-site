// 社区：路由、顶栏和账号菜单、共用小部件（头像、等级、徽章、正文），以及首页、版块、标签和收藏这些列表页。
// 帖子详情和发帖在 community-post.ts；签到、星尘、兑换所、排行、成员主页、通知、公约和管理在 community-pages.ts。
// 这里只拼 HTML、不发请求；读写接口和表单在 community-ui.ts。

import { communityTags, communityLevels, communityBadges, communityNameEffect } from './community-rules.mjs';
import type { PromptMode, NameEffect } from './community-rules.ts';
import { bodyImageContent, imageIdFromLine } from './community-body-images.mjs';
import { checkinBadgeIconHTML } from './community-badge-icons.mjs';
import { nameEffectVariables } from './community-name-effects.mjs';
import { communityGrowthLevel } from './community-growth.mjs';
import { communityGrowthArtHTML, communityTrustArtHTML, communityVipArtHTML } from './community-growth-art.mjs';
import type { CommunityGrowthState } from './community-growth.ts';
export * from './community-rules.mjs';

export type Translate = (zh: string, en: string) => string;
export type Escape = (value?: unknown) => string;
export type Icons = Record<string, string>;
// What every template needs: translation, escaping, the clock, icons and the owner's site avatar.
export type Common = { t: Translate; esc: Escape; now?: number; icons?: Icons; ownerAvatar?: string | null; meForSort?: CommunityMe | null; showTopicCovers?: boolean };

export type CommunityBoard = {
  id: string; zh: string; en: string; description: string; descriptionEn: string; color: string; lightColor: string;
  icon: string; kind: string; kindEn: string; tips: readonly string[]; tipsEn: readonly string[];
};

// 版块与设计稿一致：少开版块，细分交给标签。
export const communityBoards: readonly CommunityBoard[] = [
  { id: "qa", zh: "学习问答", en: "Q&A", description: "学 AI 过程中遇到的具体问题。", descriptionEn: "Specific questions about learning AI.", color: "#9fb8e0", lightColor: "#41658f", icon: "help", kind: "问答帖", kindEn: "Questions",
    tips: ["标题一句话说清问题", "写清环境、报错和已经试过的办法", "问题解决了，回帖说一声"], tipsEn: ["Say the question in the title", "Include your setup, errors and what you tried", "Say so when it is solved"] },
  { id: "showcase", zh: "作品展廊", en: "Showcase", description: "用 AI 做的作品，请写清工具和模型。", descriptionEn: "Work made with AI, with tools and models noted.", color: "#e7a9c6", lightColor: "#875073", icon: "image", kind: "作品帖", kindEn: "Work",
    tips: ["写清用了哪些工具和模型", "说说做法和踩过的坑", "只发自己的作品"], tipsEn: ["Name the tools and models", "Share how you made it", "Post only your own work"] },
  { id: "tools", zh: "工具资源", en: "Tools", description: "软件、网站和教程推荐。", descriptionEn: "Software, sites and tutorials worth using.", color: "#8fd0c8", lightColor: "#2c6d65", icon: "box", kind: "资源帖", kindEn: "Resources",
    tips: ["只推荐你自己用过的", "附上官方链接，不发破解版", "写清适合谁、怎么用"], tipsEn: ["Recommend what you have used", "Link the official source, no cracks", "Say who it suits and how to use it"] },
  { id: "moments", zh: "随想", en: "Moments", description: "随手记录，写短一点就好。", descriptionEn: "Short notes as they come.", color: "#d9c49c", lightColor: "#775e31", icon: "feather", kind: "短动态", kindEn: "Notes",
    tips: ["写短一点就好", "随手记，不用太正式", "对事不对人"], tipsEn: ["Keep it short", "No need to be formal", "Discuss ideas, not people"] },
  { id: "meta", zh: "站务反馈", en: "Meta", description: "公告和对社区的建议。", descriptionEn: "Announcements and feedback about the community.", color: "#788392", lightColor: "#52637b", icon: "megaphone", kind: "讨论帖", kindEn: "Discussion",
    tips: ["公告由站长发布", "未禁言的成员可以发建议和反馈", "申诉方式请查看社区公约"], tipsEn: ["Announcements come from the owner", "Members who are not muted can send feedback", "See the convention for appeal contacts"] },
  { id: "vip", zh: "会员茶室", en: "Members", description: "只有 VIP 能看能发。", descriptionEn: "Visible to VIP members only.", color: "#c9b6f2", lightColor: "#6f5191", icon: "coffee", kind: "讨论帖", kindEn: "Discussion",
    tips: ["VIP、作者和本板块版主按权限进入", "可以聊得更随意一点", "同样不要留联系方式"], tipsEn: ["VIP members, the owner and assigned moderators enter according to their permissions", "Talk more freely", "Still no contact details"] },
];

export const communityTabs = [
  ["home", "首页", "Home"],
  ["boards", "版块", "Boards"],
  ["checkin", "签到", "Check-in"],
  ["shop", "兑换", "Exchange"],
  ["rank", "排行", "Ranking"],
] as const;

export type CommunityView =
  | "landing" | "home" | "boards" | "board" | "checkin" | "shop" | "rank" | "new" | "edit" | "tag" | "bookmarks"
  | "manage" | "member" | "stardust" | "inbox" | "rules" | "post" | "unknown";
// The second part of #/community/<…>; `u` is a member page.
const subViews: Record<string, CommunityView> = {
  home: "home", boards: "boards", checkin: "checkin", shop: "shop", rank: "rank", new: "new", edit: "edit", tag: "tag",
  bookmarks: "bookmarks", manage: "manage", u: "member", stardust: "stardust", inbox: "inbox", rules: "rules",
};
// Pages with their own tabs: the tab is the last part of the address; the first is the default.
export const communityPageTabs = {
  member: ["topics", "replies", "badges", "bookmarks"],
  stardust: ["ledger", "levels", "rules"],
  inbox: ["all", "reply", "thanks", "system"],
  shop: ["all", "look", "card", "digital", "goods", "mine"],
  manage: ["queue", "reports", "content", "banners", "orders", "items", "stewards", "sanctions", "data", "contact", "convention"],
} as const;
type TabbedView = keyof typeof communityPageTabs;
const tabbed = (view: CommunityView): view is TabbedView => view in communityPageTabs;

// #/community 是主站导航里的落地页（仍用主站顶栏）；点“进入社区”后进入社区区域：
// #/community/home 社区首页，#/community/<子页> 各子页，#/post/<id> 帖子。
export function communityView(page: string, id = ""): CommunityView {
  if (page === "post") return "post";
  if (page !== "community") return "unknown";
  if (!id) return "landing";
  return Object.hasOwn(subViews, id) ? subViews[id] : "unknown";
}
// 社区区域用自己的顶栏；落地页和其他页面用主站顶栏。
export const inCommunityArea = (view: CommunityView) => view !== "unknown" && view !== "landing";
export const communityHomeHref = "#/community/home";
const tabHref = (id: string) => `#/community/${id}`;
export const boardHref = (id: string) => `#/community/boards/${encodeURIComponent(id)}`;
export const composeHref = (board = "") => board ? `#/community/new/${encodeURIComponent(board)}` : "#/community/new";
export const postHref = (id: string) => `#/post/${encodeURIComponent(id)}`;
export const tagHref = (tag: string) => `#/community/tag/${encodeURIComponent(tag)}`;
export const memberHref = (uid: string, tab = "") => `#/community/u/${encodeURIComponent(uid)}${tab ? `/${tab}` : ""}`;
export const stardustHref = (tab = "") => `#/community/stardust${tab ? `/${tab}` : ""}`;
export const inboxHref = (tab = "") => `#/community/inbox${tab && tab !== "all" ? `/${tab}` : ""}`;
export const shopHref = (tab = "") => `#/community/shop${tab && tab !== "all" ? `/${tab}` : ""}`;
export const manageHref = (tab = "") => `#/community/manage${tab && tab !== "queue" ? `/${tab}` : ""}`;
export const rulesHref = "#/community/rules";

export type CommunityRoute = { view: CommunityView; board: string; id: string; tab: string };
export const communityBoard = (id: string) => communityBoards.find((board) => board.id === id);
const unknownRoute: CommunityRoute = { view: "unknown", board: "", id: "", tab: "" };
// #/community/boards/<版块> 版块页，#/community/new/<版块> 在该版块发帖，#/community/tag/<标签> 标签页，
// #/community/edit/<帖子> 编辑帖子，#/community/u/<UID>[/<分页>] 成员主页；
// 星尘、通知、兑换所和管理的分页写在最后一段，比如 #/community/stardust/levels。
export function communityRoute(hash: string): CommunityRoute {
  let parts: string[];
  try { parts = decodeURIComponent(hash.replace(/^#\/?/, "")).split("/"); }
  catch { return unknownRoute; }
  const [page = "", id = "", extra = "", fourth = "", ...rest] = parts;
  const view = communityView(page, id);
  const route = (fields: Partial<CommunityRoute>): CommunityRoute => ({ view, board: "", id: "", tab: "", ...fields });
  if (view === "post") return id && !extra ? { ...unknownRoute, view, id } : unknownRoute;
  if (rest.length) return unknownRoute;
  if (view === "member") {
    const tabs: readonly string[] = communityPageTabs.member;
    if (!extra || (fourth && !tabs.includes(fourth))) return unknownRoute;
    return route({ id: extra, tab: fourth || tabs[0] });
  }
  if (fourth) return unknownRoute;
  if (view === "tag") return extra && (communityTags as readonly string[]).includes(extra) ? route({ id: extra }) : unknownRoute;
  if (view === "edit") return extra ? route({ id: extra }) : unknownRoute;
  if (tabbed(view)) {
    const tabs: readonly string[] = communityPageTabs[view];
    if (extra && !tabs.includes(extra) && !(view === 'shop' && /^[0-9a-f-]{36}$/.test(extra))) return unknownRoute;
    return route({ tab: extra || tabs[0] });
  }
  if (!extra) return route({});
  if (view !== "boards" && view !== "new") return unknownRoute;
  if (!communityBoard(extra)) return unknownRoute;
  return route({ view: view === "boards" ? "board" : view, board: extra });
}
export type CommunityRole = "reader" | "owner";
// A member as the API shows them: display name, role, public UID and avatar, level, VIP and decorations.
export type CommunityPerson = {
  nameEffect?: NameEffect | null;
  growth?: CommunityGrowthState | null;
  name: string; role: CommunityRole; uid: string | null; avatar?: string | null; vip?: boolean; level?: number;
  steward?: boolean; moderationBoards?: string[]; frame?: string | null; color?: string | null; showUid?: boolean;
};
export type CommunityShowcaseMeta = { tools: string; model: string; usage: string; promptMode: PromptMode; price: number };
export type CommunityResource = { url: string; kind: string; price: string; platform: string; alive: number; dead: number };
export type CommunityTopic = {
  id: string;
  board: string;
  title: string;
  author: CommunityPerson;
  createdAt: string;
  lastActivityAt: string;
  replies: number;
  likes: number;
  pinned?: boolean;
  paidPin?: boolean;
  featured?: boolean;
  lastReply?: { author: CommunityPerson; at: string } | null;
  views?: number;
  tags?: string[];
  thumbs?: string[];
  solved?: boolean;
  edited?: boolean;
  locked?: boolean;
  glow?: boolean;
  bounty?: number;
  bountyState?: string | null;
  pending?: boolean;
  hidden?: boolean;
  // Distinguish real titles from legacy moment excerpts.
  hasTitle?: boolean;
  excerpt?: string;
  meta?: CommunityShowcaseMeta | null;
  resource?: CommunityResource | null;
};

export type CommunitySort = "active" | "newest" | "hot" | "featured" | "following";
export const communitySorts: ReadonlyArray<readonly [CommunitySort, string, string]> = [
  ["active", "最新回复", "Latest replies"],
  ["newest", "最新发布", "Newest"],
  ["hot", "热门", "Popular"],
  ["featured", "精华", "Featured"],
  ["following", "关注", "Following"],
];
export const isCommunitySort = (value: unknown): value is CommunitySort => communitySorts.some(([id]) => id === value);

const time = (value: string) => Date.parse(value) || 0;
// 热度：回复比赞更重，越旧的帖子分数越低（每 8 小时减 1 分）。
// Only the fields sorting reads, so the server can sort its stored rows too.
type Sortable = Pick<CommunityTopic, "createdAt" | "lastActivityAt" | "likes" | "replies" | "pinned" | "paidPin" | "featured">;
const heat = (topic: Sortable, now: number) => topic.likes * 2 + topic.replies * 3 - (now - time(topic.createdAt)) / 3.6e6 / 8;

export function sortTopics<T extends Sortable>(topics: readonly T[], sort: CommunitySort, now = Date.now()): T[] {
  const list = sort === "featured" ? topics.filter((topic) => topic.featured) : [...topics];
  if (sort === "hot") list.sort((a, b) => heat(b, now) - heat(a, now));
  else if (sort === "newest") list.sort((a, b) => time(b.createdAt) - time(a.createdAt));
  else list.sort((a, b) => time(b.lastActivityAt) - time(a.lastActivityAt));
  // 按时间排序时：站长置顶 > 付费推荐 > 普通帖子；热门和精华按内容本身排。
  if (sort === "active" || sort === "newest") {
    const rank = (topic: Sortable) => topic.pinned ? 2 : topic.paidPin ? 1 : 0;
    list.sort((a, b) => rank(b) - rank(a));
  }
  return list;
}
export const hotTopics = <T extends Sortable>(topics: readonly T[], limit = 5, now = Date.now()) =>
  sortTopics(topics.filter((topic) => !topic.pinned), "hot", now).slice(0, limit);

export function relativeTime(value: string, now: number, t: Translate) {
  const minutes = Math.max(0, Math.floor((now - time(value)) / 60000));
  if (minutes < 1) return t("刚刚", "just now");
  if (minutes < 60) return t(`${minutes} 分钟前`, `${minutes} min ago`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(`${hours} 小时前`, `${hours} h ago`);
  const days = Math.floor(hours / 24);
  if (days < 7) return t(`${days} 天前`, `${days} d ago`);
  return new Date(time(value)).toISOString().slice(0, 10);
}
// 北京时间：“09-30 10:05”，或带年份的“2026-09-30 10:05”。
export const beijingTime = (value: string, withYear = false) =>
  new Date(time(value) + 8 * 3600e3).toISOString().slice(withYear ? 0 : 5, 16).replace("T", " ");

/* ---------- 接口返回的数据和读取状态 ---------- */
export type CommunityInventory = { makeup: number; pin: number; highlight: number };
export type CommunityUnread = { all: number; reply: number; thanks: number; system: number };
export type CommunityModerationContact = { qq: string; email: string };
export type CommunityModerationContactPerson = CommunityModerationContact & { uid: string; name: string; owner: boolean; boards: string[] };
export type CommunityModerationContacts = { items: CommunityModerationContactPerson[] };
export type CommunityMe = CommunityPerson & {
  convention?: { version: string; agreed: boolean };
  management?: { role: 'owner' | 'steward'; browsingAsReader: boolean } | null;
  moderationContact?: CommunityModerationContact | null;
  owner: boolean; mod: boolean; trustLevel?: number; balance: number; checkedIn: boolean; streak: number;
  nextReward: { total: number; bonus: number }; gainedToday: number; behaviourToday: number; dailyCap: number;
  unread: CommunityUnread; agreed: boolean; inventory: CommunityInventory; muted: { until: string; reason: string } | null; manageTodo?: number;
};
export type CommunityBoardStats = { topics: number; repliesToday: number; latest: { id: string; title: string; lastActivityAt: string } | null };
export type CommunitySummary = { total: number; repliesToday: number; checkinsToday: number; boards: Record<string, CommunityBoardStats>; tags: Record<string, number>; hot: CommunityTopic[] };
export type CommunityPoster = { author: CommunityPerson; topics: number };
export type CommunityListing = { items: CommunityTopic[]; total: number; page: number; pageSize: number; posters?: CommunityPoster[]; followingCount?: number };
// status 是接口的 HTTP 状态码：401 未登录，404 不存在，503 社区还没开放。
export type CommunityLoad<T> =
  | { state: "loading" }
  | { state: "ready"; data: T; more?: boolean }
  | { state: "error"; status: number; message: string };
export const readyData = <T>(load: CommunityLoad<T> | null | undefined) => load?.state === "ready" ? load.data : null;

/* ---------- 小部件（与 demo 相同） ---------- */
// 头像：审核过的头像图片；没有时用名字首字，底色由名字决定。站长用主站头像，没有就是金色。
const hue = (name: string) => {
  let h = 2166136261;
  for (const char of name) { h ^= char.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return (h >>> 0) % 360;
};
const initial = (name: string) => { const first = [...name][0] || "?"; return /[a-z]/i.test(first) ? first.toUpperCase() : first; };
// Decoration names come from the shop catalogue; anything else is ignored.
const decoration = (value: string | null | undefined) => value && /^[a-z]{2,20}$/.test(value) ? value : "";
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
function currentAppearance(person: CommunityPerson, common: Common): CommunityPerson {
  const viewer = common.meForSort;
  return viewer?.uid && person.uid === viewer.uid
    ? { ...person, avatar: viewer.avatar, frame: viewer.frame, color: viewer.color, nameEffect: viewer.nameEffect, growth: viewer.growth === undefined ? person.growth : viewer.growth }
    : person;
}
export function avatarHTML(person: CommunityPerson | null | undefined, common: Common, size: AvatarSize = "md", link = true) {
  const { esc } = common;
  if (!person) return `<span class="community-av community-av-${size} is-guest" aria-hidden="true"></span>`;
  person = currentAppearance(person, common);
  const src = person.avatar || (person.role === "owner" ? common.ownerAvatar : null);
  const customFrame = /^image:([0-9a-f-]{36})$/.exec(person.frame || '')?.[1] || '';
  const frame = decoration(person.frame);
  const cls = `community-av community-av-${size}${person.role === "owner" ? " is-owner" : ""}${customFrame ? ' is-frame-image' : frame ? ` is-frame-${frame}` : ""}`;
  const inner = (src
    ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">`
    : `<span style="--h:${hue(person.name)}">${esc(initial(person.name))}</span>`)
    + (customFrame ? `<img class="community-frame-image" src="${imageSrc(customFrame)}" alt="" decoding="async">` : '');
  // The name next to it is the link people use; the avatar link is a larger target for pointers only.
  const uid = person.uid;
  return link && uid
    ? `<a class="${cls}" href="${memberHref(uid)}" tabindex="-1" aria-hidden="true">${inner}</a>`
    : `<span class="${cls}" aria-hidden="true">${inner}</span>`;
}
const levelTitle = (level: number, t: Translate) => {
  const item = communityLevels[Math.max(0, Math.min(4, level))];
  return t(item.name, item.en.charAt(0) + item.en.slice(1).toLowerCase());
};
export const communityLevelName = levelTitle;
// 等级标识：站长是独立角色，协管也不是自动等级；VIP 另起一个标识。
export function levelChipHTML(person: CommunityPerson, { t }: Common) {
  if (person.role === "owner") return `<span class="community-role">${t("站长", "Owner")}</span>`;
  if (person.steward) return `<span class="community-lv is-steward" title="${t("协管", "Steward")}"><span class="community-steward-icon" aria-hidden="true">⬟</span>${t("协管", "Steward")}</span>`;
  const level = Math.max(0, Math.min(3, person.level ?? 0));
  return `<span class="community-lv is-lv${level}" title="L${level}">${levelTitle(level, t)}</span>`;
}
// 带文字的成长标识，只用于“我的”入口里的等级一栏；昵称旁用 levelMarksHTML。
export function growthChipHTML(person: CommunityPerson, common: Common) {
  person = currentAppearance(person, common);
  if (person.role === 'owner' || !person.growth) return '';
  const { t, esc } = common, item = communityGrowthLevel(person.growth.level);
  const label = `G${item.level} ${t(item.name, item.en)}`;
  return `<span class="community-growth-chip" title="${esc(t(`成长等级：${label}`, `Growth level: ${label}`))}">${communityGrowthArtHTML(item.level)}<span>${esc(label)}</span></span>`;
}
// 昵称旁的等级图标：成长、权限、VIP 依次排列，只显示图标，名称放在 title 与无障碍标签里。
// 站长没有等级；协管是任命，不显示权限图标；旧响应缺少成长字段时不推算成长等级。
// 账号目前只有“是否会员”，还没有档位：会员一律显示会员起始的 VIP1，非会员不显示。
// `large` 用于个人主页：图标单独成行放在昵称上方，尺寸加大。
export function levelMarksHTML(person: CommunityPerson, common: Common, large = false) {
  person = currentAppearance(person, common);
  if (person.role === 'owner') return '';
  const { t, esc } = common;
  const mark = (kind: string, label: string, art: string) => `<span class="community-level-badge is-${kind}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${art}</span>`;
  let marks = '';
  if (person.growth) {
    const item = communityGrowthLevel(person.growth.level);
    marks += mark('growth', t(`成长等级：G${item.level} ${item.name}`, `Growth level: G${item.level} ${item.en}`), communityGrowthArtHTML(item.level));
  }
  if (!person.steward) {
    const level = Math.max(0, Math.min(3, person.level ?? 0));
    marks += mark('trust', t(`权限等级：L${level} ${levelTitle(level, t)}`, `Permission level: L${level} ${levelTitle(level, t)}`), communityTrustArtHTML(level));
  }
  if (person.vip) marks += mark('vip', t('VIP 会员', 'VIP member'), communityVipArtHTML(1));
  return marks ? `<span class="community-level-marks${large ? ' is-large' : ''}">${marks}</span>` : '';
}
// 站长与协管没有对应的图标，仍用文字标识。
export const roleChipHTML = (person: CommunityPerson, common: Common) => person.role === "owner" || person.steward ? levelChipHTML(person, common) : "";
function nameWithMarksHTML(label: string, person: CommunityPerson, common: Common, marked = true) {
  const marks = marked ? levelMarksHTML(person, common) : '';
  return marks ? `<span class="community-name">${label}${marks}</span>` : label;
}
function nameAttributes(person: CommunityPerson) {
  const color = decoration(person.color);
  const effect = communityNameEffect(person.nameEffect);
  return `class="community-uname${color ? ` is-color-${color}` : ""}"${effect ? ` data-name-effect="${effect.style}" style="${nameEffectVariables(effect)}"` : ''}`;
}
// `marked` 为 false 时只输出昵称，供把等级图标另行摆放的页面使用。
export function nameLabelHTML(person: CommunityPerson, common: Common, marked = true) {
  const { esc } = common;
  person = currentAppearance(person, common);
  return nameWithMarksHTML(`<span ${nameAttributes(person)}>${esc(person.name)}</span>`, person, common, marked);
}
export function nameHTML(person: CommunityPerson, common: Common) {
  const { esc } = common;
  person = currentAppearance(person, common);
  const uid = person.uid;
  const label = uid ? `<a ${nameAttributes(person)} href="${memberHref(uid)}">${esc(person.name)}</a>` : `<span ${nameAttributes(person)}>${esc(person.name)}</span>`;
  return nameWithMarksHTML(label, person, common);
}
export const whoHTML = (person: CommunityPerson, common: Common) =>
  `<span class="community-who">${nameHTML(person, common)}${roleChipHTML(person, common)}</span>`;
export const dot = `<span class="community-dot" aria-hidden="true"></span>`;
export const boardName = (id: string, t: Translate) => {
  const board = communityBoard(id);
  return board ? t(board.zh, board.en) : id;
};
export const imageSrc = (id: string, thumb = false) => `/api/community/images/${encodeURIComponent(id)}${thumb ? ".thumb" : ""}.webp`;
export const communityBoardStyle = (id: string) => {
  const board = communityBoard(id);
  return `--board:${board?.color || "#aeb3bd"};--board-light:${board?.lightColor || "#52637b"}`;
};
export const boardChip = (id: string, t: Translate, esc: Escape) =>
  `<a class="community-topic-board" style="${communityBoardStyle(id)}" href="${boardHref(id)}">${esc(boardName(id, t))}</a>`;
// Presentation only: the permitted tags and their meaning remain in the rules.
const tagTones: Readonly<Record<string, string>> = {
  ComfyUI: 'tool', Midjourney: 'tool', 'Stable Diffusion': 'tool', Claude: 'tool', Cursor: 'tool', '本地模型': 'tool',
  '提示词': 'method', '工作流': 'method', '视频生成': 'creative', '音乐生成': 'creative',
  '新手': 'guide', '可商用': 'guide', '效率': 'guide',
};
export const tagLink = (tag: string, esc: Escape, count = 0) => `<a class="community-tag" data-tag-tone="${tagTones[tag] || 'guide'}" href="${tagHref(tag)}">${esc(tag)}${count > 0 ? `<span class="community-tag-count">${count}</span>` : ''}</a>`;
export function flagsHTML(topic: Pick<CommunityTopic, "pinned" | "paidPin" | "featured" | "board" | "solved" | "bounty" | "bountyState" | "locked" | "pending" | "hidden" | "resource">, { t, icons = {} }: Common) {
  const flags: string[] = [];
  if (topic.pending) flags.push(`<span class="community-flag is-warn">${icons.clock || ""}${t("审核中", "In review")}</span>`);
  if (topic.hidden) flags.push(`<span class="community-flag is-danger">${icons.eye || ""}${t("已隐藏", "Hidden")}</span>`);
  if (topic.paidPin) flags.push(`<span class="community-flag is-recommend">${icons.sparkles || icons.pin || ""}${t("推荐", "Recommended")}</span>`);
  else if (topic.pinned) flags.push(`<span class="community-flag">${icons.pin || ""}${t("置顶", "Pinned")}</span>`);
  if (topic.featured) flags.push(`<span class="community-flag is-featured">${icons.award || ""}${t("精华", "Featured")}</span>`);
  if (topic.board === "qa") flags.push(topic.solved ? `<span class="community-flag is-solved">${icons.check || ""}${t("已解决", "Solved")}</span>` : `<span class="community-flag is-open">${t("待解答", "Open")}</span>`);
  if (topic.bounty && topic.bountyState === "open") flags.push(`<span class="community-flag is-bounty">${icons.star || ""}${t(`悬赏 ${topic.bounty}`, `Bounty ${topic.bounty}`)}</span>`);
  if (topic.locked) flags.push(`<span class="community-flag is-locked">${icons.lock || ""}${t("已锁定", "Locked")}</span>`);
  if (topic.resource && topic.resource.dead > topic.resource.alive) flags.push(`<span class="community-flag is-warn">${icons.alert || ""}${t("可能失效", "May be dead")}</span>`);
  return flags.join("");
}
// 徽章：铜、银、金三档；没拿到的是暗的。
export function badgeHTML(id: string, has: boolean, { t, esc, icons = {} }: Common, size: "sm" | "md" | "lg" = "md", withName = false) {
  const badge = communityBadges[id];
  if (!badge) return "";
  const name = t(badge.name, badge.en), desc = t(badge.desc, badge.descEn);
  return `<span class="community-badge is-${badge.tier} is-${size}${has ? "" : " is-off"}" title="${esc(`${name}：${desc}${has ? "" : t("（未获得）", " (not yet)")}`)}">`
    + `<span class="community-badge-ic">${checkinBadgeIconHTML(id) || icons[badge.icon] || ""}</span>${withName ? `<span class="community-badge-n">${esc(name)}</span>` : `<span class="sr-only">${esc(name)}</span>`}</span>`;
}
export const cardHead = (title: string, icon = "", link = "") => `<div class="community-card-h"><h2>${icon}${title}</h2>${link}</div>`;
export const moreLink = (href: string, label: string, icons: Icons) => `<a class="community-link-sm" href="${href}">${label}${icons["chevron-right"] || ""}</a>`;
const visibleCount = (value: number | undefined, locked: boolean) => locked ? "—" : String(value || 0);

export function bannerHTML({ eyebrow, title, text, esc, side = "", before = "", html = false }: { eyebrow: string; title: string; text: string; esc: Escape; side?: string; before?: string; html?: boolean }) {
  return `<header class="community-banner community-rv" style="--i:0"><div class="community-banner-text">${before}<div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${html ? text : esc(text)}</p></div>${side ? `<div class="community-banner-side">${side}</div>` : ""}</header>`;
}
export const statsHTML = (rows: Array<[string, string | number]>) =>
  `<dl class="community-stats">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;

// 空状态：一颗星、一句标题、一句说明，可带一个按钮。
export function emptyHTML({ icons = {} }: Common, title: string, text = "", action = "", state = "") {
  return `<div class="community-empty"${state ? ` data-content-state="${state}"` : ""}><div class="community-empty-mark" aria-hidden="true">${icons.star || ""}</div><h3>${title}</h3>${text ? `<p>${text}</p>` : ""}${action}</div>`;
}

// 读取失败时的说明：没登录、没开放、找不到和其他错误各说各的。
export function communityStatusHTML(load: CommunityLoad<unknown>, common: Common) {
  const { t, esc } = common;
  if (load.state === "loading") return `<div class="community-status" role="status" aria-busy="true"><p>${t("正在读取…", "Loading…")}</p></div>`;
  if (load.state !== "error") return "";
  if (load.status === 401) return emptyHTML(common, t("登录后参与社区", "Sign in to join"), t("登录后就能看帖和发帖。", "Sign in to read and post."), `<a class="community-button is-gold" href="#/account">${t("登录 / 注册", "Sign in / Register")}</a>`, "auth");
  if (load.status === 503) return emptyHTML(common, t("社区尚未开放", "Not open yet"), t("请稍后再来。", "Please come back later."), "", "not-open");
  if (load.status === 403) return emptyHTML(common, esc(load.message || t("没有权限。", "Not allowed.")), "", `<a class="community-button" href="${communityHomeHref}">${t("回到社区首页", "Back to the community")}</a>`, "forbidden");
  if (load.status === 404) return emptyHTML(common, esc(load.message || t("没有找到这个内容。", "Not found.")), "", `<a class="community-button" href="${communityHomeHref}">${t("回到社区首页", "Back to the community")}</a>`, "missing");
  return emptyHTML(common, t("暂时读不到", "Could not load"), esc(load.message || t("社区暂时无法读取。", "The community could not be loaded.")), `<button type="button" class="community-button" data-action="community-retry">${t("重试", "Retry")}</button>`, "error");
}

/* ---------- 正文：少量 Markdown ---------- */
// 支持空行分段、**加粗**、`代码`、```代码块```、[文字](链接)、裸链接、> 引用、- 列表和 @名字。
// 全部先转义再拼接，链接只认 http 和 https。@名字 只有找得到这个人时才变成链接。
const inlinePattern = /(`[^`\n]{1,300}`)|(\*\*[^*\n]{1,300}\*\*)|(\[([^\]\n]{1,200})\]\((https?:\/\/[^\s()<>"']{1,500})\))|(https?:\/\/[^\s<>"'，。；！？、）】]{2,500})|(@[\p{Script=Han}A-Za-z0-9_\-·]{1,30})/gu;
const trailing = /[.,;:!?)\]}'"]+$/;
function inlineHTML(text: string, esc: Escape, mentions: Readonly<Record<string, string>>) {
  let html = "", last = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const [token, code, bold, link, label, href, bare, mention] = match;
    const start = match.index ?? 0;
    html += esc(text.slice(last, start));
    last = start + token.length;
    if (code) html += `<code>${esc(code.slice(1, -1))}</code>`;
    else if (bold) html += `<strong>${esc(bold.slice(2, -2))}</strong>`;
    else if (link) html += `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow ugc">${esc(label)}</a>`;
    else if (bare) {
      const url = bare.replace(trailing, "");
      html += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow ugc">${esc(url)}</a>${esc(bare.slice(url.length))}`;
    } else if (mention) {
      const uid = mentions[mention.slice(1)];
      html += uid ? `<a class="community-mention" href="${memberHref(uid)}">${esc(mention)}</a>` : esc(mention);
    }
  }
  return html + esc(text.slice(last));
}
export function communityBodyHTML(body: string, esc: Escape, mentions: Readonly<Record<string, string>> = {}, images: readonly string[] = []) {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  const isQuote = (line: string) => /^\s*>\s?/.test(line);
  const isItem = (line: string) => /^\s*[-*]\s+\S/.test(line);
  const isFence = (line: string) => /^\s*```/.test(line);
  const image = (line: string) => { const id = imageIdFromLine(line); return images.includes(id) ? id : ''; };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (image(line)) {
      const src = imageSrc(image(line));
      blocks.push(`<figure class="community-body-image"><button type="button" data-action="community-lightbox" data-src="${src}" aria-label="查看图片 / View image"><img src="${src}" alt="" loading="lazy" decoding="async"></button></figure>`);
      i++;
    } else if (isFence(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
    } else if (isQuote(line)) {
      const quote: string[] = [];
      while (i < lines.length && isQuote(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(`<blockquote>${quote.map((part) => inlineHTML(part, esc, mentions)).join("<br>")}</blockquote>`);
    } else if (isItem(line)) {
      const items: string[] = [];
      while (i < lines.length && isItem(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      blocks.push(`<ul>${items.map((item) => `<li>${inlineHTML(item, esc, mentions)}</li>`).join("")}</ul>`);
    } else {
      const paragraph: string[] = [];
      while (i < lines.length && lines[i].trim() && !isFence(lines[i]) && !isQuote(lines[i]) && !isItem(lines[i]) && !image(lines[i])) paragraph.push(lines[i++].trim());
      blocks.push(`<p>${paragraph.map((part) => inlineHTML(part, esc, mentions)).join("<br>")}</p>`);
    }
  }
  return blocks.join("");
}
// Plain text for excerpts: Markdown marks removed.
export const plainText = (body: string) => bodyImageContent(body).text.replace(/```[\s\S]*?```/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*`>#-]+/g, " ").replace(/\s+/g, " ").trim();

/* ---------- 顶栏与账号菜单 ---------- */
type HeaderOptions = { view: CommunityView; t: Translate; icons: Icons; actionsHTML: string; unchecked?: boolean };

// 社区顶栏：左边社区字标，中间社区导航（沿用 #navigation，手机菜单照常工作），右边通知和账号菜单。
// 回無相主站的入口放在右上角的账号菜单里；发帖在帖子列表上方那一栏。
export function communityHeaderHTML({ view, t, actionsHTML, unchecked = false }: HeaderOptions) {
  if (view === 'manage') return `<div class="community-brand-group"><a href="${communityHomeHref}" class="community-brand"><strong>${t('社区', 'Community')}</strong><span>${t('管理工作台', 'MANAGEMENT')}</span></a></div><div class="header-actions">${actionsHTML}</div>`;
  const current = view === "board" ? "boards" : view;
  const nav = communityTabs
    .map(([id, zh, en]) => `<a href="${tabHref(id)}"${current === id ? ' aria-current="page"' : ""}>${t(zh, en)}${id === "checkin" && unchecked ? `<i class="community-nav-dot" aria-hidden="true"></i><span class="sr-only">${t("（今天还没签到）", " (not checked in today)")}</span>` : ""}</a>`)
    .join("");
  return `<div class="community-brand-group"><a href="${communityHomeHref}" class="community-brand" aria-label="${t("社区首页", "Community home")}"><strong>${t("社区", "Community")}</strong><span aria-hidden="true">COMMUNITY</span></a></div>`
    + `<nav class="nav community-nav" id="navigation" aria-label="${t("社区导航", "Community navigation")}">${nav}<a class="community-nav-guidelines" href="${rulesHref}"${view === 'rules' ? ' aria-current="page"' : ''}>${t('社区公约', 'Guidelines')}</a></nav>`
    + `<div class="header-actions">${actionsHTML}</div>`;
}

type AccountOptions = { t: Translate; esc: Escape; icons: Icons; nickname?: string | null; author?: boolean; me?: CommunityMe | null; ownerAvatar?: string | null };

// Only the verified account response supplies management authority. Older
// responses may omit management; their active mod flag remains compatible.
export function communityManagementRole(me: CommunityMe | null | undefined) {
  if (me?.management) return ['owner', 'steward'].includes(me.management.role) ? me.management.role : null;
  return me?.management === undefined && me?.mod ? me.owner ? 'owner' : 'steward' : null;
}

// 右上角：通知铃铛和个人入口。兑换和返回主站沿用左侧导航入口。
export function communityAccountHTML({ t, esc, icons, nickname, author, me = null, ownerAvatar = null }: AccountOptions) {
  const common: Common = { t, esc, icons, ownerAvatar };
  const signedIn = Boolean(author || nickname || me);
  const label = author ? t("作者台", "Author studio") : nickname ? esc(nickname) : t("登录 / 注册", "Sign in / Register");
  const unread = me?.unread.all || 0;
  const bell = me ? `<a class="community-bell" href="${inboxHref()}" aria-label="${unread ? t(`通知，${unread} 条未读`, `Notifications, ${unread} unread`) : t("通知", "Notifications")}">${icons.bell || ""}${unread ? `<b>${unread > 99 ? "99+" : unread}</b>` : ""}</a>` : "";
  const item = (href: string, icon: string, text: string, extra = "") => `<a role="menuitem" href="${href}">${icons[icon] || ""}<span>${text}</span>${extra}</a>`;
  const managementRole = communityManagementRole(me);
  const browsingAsReader = Boolean(me?.management?.browsingAsReader);
  const head = me ? `<div class="community-menu-head">${avatarHTML(me, common, "sm", false)}<div><b>${nameLabelHTML(me, common)}</b><span>${me.owner || me.management?.role === 'owner' ? t("站长", "Owner") : levelTitle(me.steward ? 4 : me.level ?? 0, t)}${me.uid ? ` · UID ${esc(me.uid)}` : ""}</span></div></div>` : "";
  const personal = me
    ? (me.uid ? item(memberHref(me.uid), "user", t("我的主页", "My page")) : "")
      + item(stardustHref(), "star", t("我的星尘", "My stardust"), `<span class="community-menu-num">${me.balance}</span>`)
      + item(inboxHref(), "bell", t("通知", "Notifications"), unread ? `<span class="community-menu-badge">${unread > 99 ? "99+" : unread}</span>` : "")
      + item("#/community/bookmarks", "bookmark", t("我的收藏", "Bookmarks"))
      + (managementRole && !browsingAsReader ? item(manageHref(), "shield", t("管理台", "Management"), me.manageTodo ? `<span class="community-menu-badge">${me.manageTodo > 99 ? "99+" : me.manageTodo}</span>` : "") : "")
      + (managementRole ? `<button type="button" role="menuitem" data-action="community-browse-mode" data-reader="${!browsingAsReader}">${icons.eye || ''}<span>${browsingAsReader ? managementRole === 'owner' ? t('返回作者身份', 'Restore owner perspective') : t('返回版主身份', 'Restore moderator perspective') : t('以读者身份浏览', 'Browse as a reader')}</span></button>` : '')
    : signedIn ? item("#/community/bookmarks", "bookmark", t("我的收藏", "Bookmarks")) : "";
  const account = author
    ? `<button type="button" role="menuitem" data-author-login>${icons.user || ""}<span>${t("打开作者台", "Open author studio")}</span></button>`
    : `<a role="menuitem" href="#/account" data-reader-return>${icons.user || ""}<span>${signedIn ? t("我的账号", "My account") : t("登录 / 注册", "Sign in / Register")}</span></a>`;
  const button = me
    ? `${avatarHTML(me, common, "xs", false)}${nameLabelHTML(me, common)}`
    : `<span>${label}</span>`;
  return `${bell}<div class="community-account"><button type="button" class="account-button${me ? " has-avatar" : ""}" data-action="community-account" aria-haspopup="menu" aria-expanded="false" aria-controls="community-account-menu">${button}${icons["chevron-down"] || ""}</button>`
    + `<div class="community-account-menu" id="community-account-menu" role="menu" hidden>${head}${personal}${account}</div></div>`;
}

/* ---------- 帖子列表 ---------- */
export function communityTopicsHTML(items: readonly CommunityTopic[], common: Common, { showBoard = true, showAuthor = true } = {}) {
  const { t, esc, now = Date.now(), icons = {} } = common;
  return `<div class="community-topics">${items.map((topic, i) => {
    const when = topic.lastReply
      ? `<time datetime="${esc(topic.lastReply.at)}">${t(`${nameLabelHTML(topic.lastReply.author, common)} ${relativeTime(topic.lastReply.at, now, t)}回复`, `${nameLabelHTML(topic.lastReply.author, common)} replied ${relativeTime(topic.lastReply.at, now, t)}`)}</time>`
      : `<time datetime="${esc(topic.createdAt)}">${relativeTime(topic.createdAt, now, t)}</time>`;
    const thumbs = topic.thumbs?.length && (common.showTopicCovers || topic.board === "showcase" || topic.board === "moments")
      ? `<a class="community-topic-thumbs" href="${postHref(topic.id)}" tabindex="-1" aria-hidden="true">${topic.thumbs.slice(0, common.showTopicCovers ? 1 : 4).map((id) => `<img src="${imageSrc(id, true)}" alt="" loading="lazy" decoding="async" width="84" height="60">`).join("")}</a>`
      : "";
    const tags = (topic.tags || []).slice(0, 2).map((tag) => tagLink(tag, esc)).join("");
    const flags = flagsHTML(topic, common);
    const moment = topic.board === "moments";
    const heading = moment && !topic.hasTitle
      ? `${flags ? `<div class="community-topic-flags">${flags}</div>` : ""}<a class="community-topic-moment" href="${postHref(topic.id)}">${esc(topic.excerpt || topic.title)}</a>`
      : `<h3>${flags}<a href="${postHref(topic.id)}">${esc(topic.title)}</a></h3>`;
    const preview = plainText(topic.excerpt || '');
    const excerpt = preview && (!moment || topic.hasTitle)
      ? `<p class="community-topic-excerpt">${esc(preview)}</p>` : "";
    const classes = `community-topic${topic.pinned ? " is-pinned" : ""}${topic.glow ? " is-glow" : ""}${topic.pending || topic.hidden ? " is-muted" : ""}`;
    return `<article class="${classes}" data-created-at="${esc(topic.createdAt)}" style="${communityBoardStyle(topic.board)};--i:${i}">`
      + avatarHTML(topic.author, common)
      + `<div class="community-topic-main">${heading}${excerpt}${thumbs}`
      + `<p class="community-topic-meta">${showBoard ? boardChip(topic.board, t, esc) : ""}${tags}${showBoard || tags ? dot : ""}${showAuthor ? `${whoHTML(topic.author, common)}${dot}` : ""}${when}</p></div>`
      + `<a class="community-topic-replies" href="${postHref(topic.id)}" tabindex="-1" aria-label="${t(`${topic.replies} 条回复，${topic.likes || 0} 个赞`, `${topic.replies} replies, ${topic.likes || 0} likes`)}"><small>${icons.like || ""}${t(`${topic.likes || 0} 赞`, `${topic.likes || 0} likes`)}</small><span>${icons.reply || ""}${topic.replies}</span></a></article>`;
  }).join("")}</div>`;
}

export const communitySearchLimit = 40;

type ListingOptions = Common & { list: CommunityLoad<CommunityListing>; sort: CommunitySort; query: string; board: string; empty: string; meForSort?: CommunityMe | null; showCompose?: boolean };

// 帖子列表上方的一栏（首页、版块页和标签页共用）：左边排序，右边搜索和发帖。
// 版块页里的“发帖”默认发到这个版块。“加载更多”在还有下一页时出现。
function listingHTML({ list, sort, query, board, empty, showCompose = true, ...common }: ListingOptions) {
  const { t, esc, icons = {} } = common;
  const sortHTML = communitySorts.filter(([id]) => id !== "following" || Boolean(common.meForSort)).map(([id, zh, en]) =>
    `<button type="button" data-action="community-sort" data-sort="${id}" aria-pressed="${sort === id}">${t(zh, en)}</button>`).join("");
  const search = `<form class="community-search" role="search" data-community-form="search"><label class="sr-only" for="community-search">${t("搜索帖子", "Search posts")}</label>${icons.search || ""}<input id="community-search" name="q" type="search" autocomplete="off" maxlength="${communitySearchLimit}" value="${esc(query)}" placeholder="${t("搜索帖子", "Search posts")}"></form>`;
  const compose = showCompose ? `<a class="community-post" href="${composeHref(board)}">${icons.plus || ""}<span>${t("发帖", "New post")}</span></a>` : "";
  let body = communityStatusHTML(list, common);
  if (list.state === "ready") {
    const { items, total: count } = list.data;
    const summary = query
      ? `<p class="community-search-summary">${t(`搜索“${esc(query)}”，找到 ${count} 个主题`, `${count} results for “${esc(query)}”`)}<button type="button" data-action="community-search-clear">${t("清除搜索", "Clear search")}</button></p>`
      : "";
    const none = query ? emptyHTML(common, t("没有找到相关的帖子", "Nothing found"), t("换个关键词试试。", "Try other words."))
      : sort === "following" ? emptyHTML(common, list.data.followingCount ? t("关注的人还没有发帖", "People you follow have not posted yet") : t("还没有关注的人，去成员主页点关注", "You are not following anyone yet. Follow people from their member pages."))
      : sort === "featured" ? emptyHTML(common, t("还没有精华帖", "No featured posts yet"))
      : emptyHTML(common, t("这里还没有帖子", "No posts yet"), empty);
    body = summary + (items.length
      ? communityTopicsHTML(items, common, { showBoard: !board }) + (items.length < count
        ? `<button type="button" class="community-button community-more" data-action="community-more"${list.more ? " disabled" : ""}>${list.more ? t("正在加载…", "Loading…") : t(`加载更多 · 还有 ${count - items.length} 个`, `Load more · ${count - items.length} left`)}</button>`
        : `<p class="community-end">${t("已经到底了", "That's everything")}</p>`)
      : none);
  }
  return `<div class="community-sort community-rv" style="--i:1"><div class="community-sort-tabs" role="group" aria-label="${t("排序", "Sort")}">${sortHTML}</div><div class="community-sort-actions">${search}${compose}</div></div><div class="community-results">${body}</div>`;
}

/* ---------- 首页 ---------- */
type HomeOptions = Common & { summary: CommunityLoad<CommunitySummary>; list: CommunityLoad<CommunityListing>; sort: CommunitySort; query?: string; members: boolean; me?: CommunityLoad<CommunityMe> | null; showCompose?: boolean; activityBoard?: string };

// 横幅里的签到胶囊：没签到时直接签，签过了去签到页。
function checkinPill(me: CommunityMe | null, { t, icons = {} }: Common) {
  if (!me || me.owner || me.role === 'owner') return "";
  if (me.management?.browsingAsReader) return '';
  if (!me.checkedIn) return `<div class="community-ck-pill is-todo"><span class="community-ck-dot" aria-hidden="true"></span><span>${t(`今天还没签到 · 签到后连签 ${me.streak + 1} 天 <b>+${me.nextReward.total}</b>`, `Not checked in today · check in for a ${me.streak + 1}-day streak <b>+${me.nextReward.total}</b>`)}</span><button type="button" class="community-button is-gold is-small" data-action="community-checkin">${icons.star || ""}${t("签到", "Check in")}</button></div>`;
  return `<a class="community-ck-pill is-done" href="#/community/checkin">${icons.check || ""}<span>${t(`已连续签到 <b>${me.streak}</b> 天 · 明天 +${me.nextReward.total}`, `<b>${me.streak}</b>-day streak · +${me.nextReward.total} tomorrow`)}</span>${icons["chevron-right"] || ""}</a>`;
}

// 左边热门讨论和版块（带按帖子数的细条），右边排序栏和列表。
function boardsMiniHTML(summary: CommunitySummary | null, members: boolean, common: Common) {
  const { t, icons = {} } = common;
  const max = Math.max(1, ...communityBoards.map((item) => summary?.boards[item.id]?.topics || 0));
  return communityBoards.map((item) => {
    const locked = item.id === "vip" && !members;
    const count = summary?.boards[item.id]?.topics || 0;
    return `<a class="community-board-link" href="${boardHref(item.id)}" style="${communityBoardStyle(item.id)};--w:${locked ? 0 : Math.round(count / max * 100)}%"><i aria-hidden="true"></i><span>${t(item.zh, item.en)}</span>`
      + (locked ? `<span class="community-board-lock" aria-label="${t("仅 VIP", "VIP only")}">${icons.lock || ""}</span>` : `<span class="community-board-count">${summary ? count : ""}</span>`) + `</a>`;
  }).join("");
}

export function communityHomeHTML({ summary, list, sort, query = "", members, me = null, showCompose = true, activityBoard = '', ...common }: HomeOptions) {
  const { t, esc, icons = {} } = common;
  const ready = readyData(summary);
  const locked = activityBoard === 'vip' && !members;
  const hot = locked ? [] : (ready?.hot || []).filter(topic => !activityBoard || topic.board === activityBoard);
  const hotHTML = locked ? `<p class="community-muted">${t('会员茶室仅 VIP 可见。', 'This board is for VIP members.')}</p>` : hot.length || activityBoard
    ? `<ol class="community-hot"${activityBoard ? ` data-board="${esc(activityBoard)}"` : ''}>${hot.map((topic, i) => `<li><span class="community-hot-rank${i < 3 ? " is-top" : ""}">${String(i + 1).padStart(2, "0")}</span><a href="${postHref(topic.id)}">${esc(topic.title)}</a></li>`).join("")}</ol>`
    : `<p class="community-muted">${summary.state === "loading" ? t("正在读取…", "Loading…") : t("还没有帖子。有了讨论以后，这里会列出最热的五个。", "No posts yet. The five most active will appear here.")}</p>`;
  const boardStats = ready?.boards[activityBoard];
  const stats = activityBoard
    ? statsHTML([[t('本板主题', 'Board topics'), ready && !locked ? boardStats?.topics || 0 : '—'], [t('24 小时回复', 'Replies · 24 h'), ready && !locked ? boardStats?.repliesToday || 0 : '—']])
    : statsHTML([[t("主题", "Topics"), ready ? ready.total : "—"], [t("24 小时回复", "Replies · 24 h"), ready ? ready.repliesToday : "—"], [t("今日签到", "Check-ins today"), ready ? ready.checkinsToday : "—"]]);
  return `<section class="page community-page" data-community="home">`
    + bannerHTML({ eyebrow: "COMMUNITY", title: t("社区", "Community"), text: t("聊 AI 学习、AI 创作，以及好用的软件和资源。", "Talk about learning AI, making things with it, and useful tools."), esc, side: stats + checkinPill(readyData(me), common) })
    + `<div class="community-layout"><aside class="community-aside">`
    + `<section class="community-card community-rv community-spot" style="--i:2">${cardHead(t("热门讨论", "Trending"), icons.trending)}${hotHTML}</section>`
    + `<section class="community-card community-rv community-spot" style="--i:3">${cardHead(t("版块", "Boards"), icons.grid, moreLink("#/community/boards", t("全部版块", "All boards"), icons))}<div class="community-boards">${boardsMiniHTML(ready, members, common)}</div></section>`
    + `</aside><div class="community-main">${listingHTML({ list, sort, query, board: "", showCompose, empty: showCompose ? t("点上方的“发帖”，来发第一帖吧。", "Use “New post” to start the first discussion.") : t("选择一个板块，开始第一场讨论。", "Choose a board to start the first discussion."), meForSort: readyData(me), ...common })}</div></div></section>`;
}

/* ---------- 版块目录 ---------- */
export function communityBoardsHTML({ summary, members, ...common }: Common & { summary: CommunityLoad<CommunitySummary>; members: boolean }) {
  const { t, esc, now = Date.now(), icons = {} } = common;
  const ready = readyData(summary);
  const blocked = summary.state === "error" && [401, 503].includes(summary.status);
  const cards = communityBoards.map((item, i) => {
    const locked = item.id === "vip" && !members;
    const stats = ready?.boards[item.id];
    const latest = !locked && stats?.latest;
    return `<a class="community-board-card community-rv community-spot${locked ? " is-locked" : ""}" href="${boardHref(item.id)}" style="${communityBoardStyle(item.id)};--i:${i + 2}">`
      + `<div class="community-bc-top"><span class="community-bc-icon">${icons[item.icon] || ""}</span><div class="community-bc-name"><h2>${t(item.zh, item.en)}</h2><span>${esc(item.en.toUpperCase())}</span></div>${locked ? `<span class="community-bc-lock">${icons.lock || ""}VIP</span>` : ""}</div>`
      + `<p>${esc(t(item.description, item.descriptionEn))}</p>`
      + `<dl class="community-bc-stats"><div><dt>${t("类型", "Type")}</dt><dd>${t(item.kind, item.kindEn)}</dd></div><div><dt>${t("主题", "Topics")}</dt><dd>${ready ? visibleCount(stats?.topics, locked) : "—"}</dd></div><div><dt>${t("24 小时回复", "Replies · 24 h")}</dt><dd>${ready ? visibleCount(stats?.repliesToday, locked) : "—"}</dd></div></dl>`
      + `<div class="community-bc-latest">${latest ? `<span>${t("最新", "Latest")}</span><b>${esc(latest.title)}</b><time datetime="${esc(latest.lastActivityAt)}">${relativeTime(latest.lastActivityAt, now, t)}</time>` : `<span>${locked ? t("开通 VIP 后可见", "Visible to VIP members") : ready ? t("还没有帖子", "No posts yet") : ""}</span>`}</div>`
      + `</a>`;
  }).join("");
  const tags = communityTags.map((tag) => tagLink(tag, esc, ready?.tags?.[tag] || 0)).join("");
  const stats = statsHTML([[t("版块", "Boards"), communityBoards.length], [t("主题", "Topics"), ready ? ready.total : "—"], [t("标签", "Tags"), communityTags.length]]);
  return `<section class="page community-page" data-community="boards">`
    + bannerHTML({ eyebrow: "BOARDS", title: t("版块", "Boards"), text: t("版块少一点，内容才不会散。更细的分类用标签。", "A few boards, so conversations stay together; tags do the rest."), esc, side: stats })
    + (blocked ? communityStatusHTML(summary, common) : `<div class="community-board-grid">${cards}</div>`
      + `<section class="community-card community-rv" style="--i:8">${cardHead(t("标签", "Tags"), "", `<span class="community-muted">${t("点标签看所有版块里的相关帖子", "Posts with a tag, across boards")}</span>`)}<div class="community-tagcloud">${tags}</div></section>`)
    + `</section>`;
}

/* ---------- 单个版块 ---------- */
type BoardOptions = Common & { board: string; summary: CommunityLoad<CommunitySummary>; list: CommunityLoad<CommunityListing>; sort: CommunitySort; query?: string; members: boolean; me?: CommunityMe | null; showPostingTips?: boolean; showActiveMembers?: boolean };

export function communityBoardHTML({ board, summary, list, sort, query = "", members, me = null, showPostingTips = true, showActiveMembers = true, ...common }: BoardOptions) {
  const { t, esc, icons = {} } = common;
  const item = communityBoard(board)!;
  const locked = board === "vip" && !members;
  const stats = readyData(summary)?.boards[board];
  const known = summary.state === "ready";
  const hero = `<header class="community-board-hero community-rv" style="--i:0"><div class="community-bh-glow" aria-hidden="true"></div>`
    + `<nav class="community-crumb" aria-label="${t("位置", "Location")}"><a href="#/community/boards">${t("版块", "Boards")}</a>${icons["chevron-right"] || "›"}<span>${t(item.zh, item.en)}</span></nav>`
    + `<div class="community-bh-row"><span class="community-bc-icon is-large">${icons[item.icon] || ""}</span>`
    + `<div class="community-bh-text"><div class="eyebrow">${esc(item.en.toUpperCase())} · ${t(item.kind, item.kindEn)}</div><h1>${t(item.zh, item.en)}</h1><p>${esc(t(item.description, item.descriptionEn))}</p><a class="community-link-sm community-board-rules" href="${rulesHref}">${t('板块规则与版主联系', 'Board rules and moderator contacts')}</a></div>`
    + `<dl class="community-stats"><div><dt>${t("主题", "Topics")}</dt><dd>${known ? visibleCount(stats?.topics, locked) : "—"}</dd></div><div><dt>${t("24 小时回复", "Replies · 24 h")}</dt><dd>${known ? visibleCount(stats?.repliesToday, locked) : "—"}</dd></div></dl></div></header>`;
  if (locked) {
    return `<section class="page community-page" data-community="board" data-board="${esc(board)}" style="${communityBoardStyle(item.id)}">${hero}`
      + emptyHTML(common, t("会员茶室只对 VIP 开放", "This board is for VIP members"), t("VIP 可以在这里聊得更随意一点。", "VIP members can talk more freely here."), `<a class="community-button" href="#/community/boards">${t("看看其他版块", "Other boards")}</a>`, "members")
      + `</section>`;
  }
  const posters = showActiveMembers ? readyData(list)?.posters || [] : [];
  const tips = t(item.tips.join("\n"), item.tipsEn.join("\n")).split("\n");
  const aside = (showPostingTips ? `<section class="community-card community-rv community-spot" style="--i:2">${cardHead(t("发帖须知", "Before posting"), icons.book)}<ul class="community-ticks">${tips.map((tip) => `<li>${icons.check || ""}${esc(tip)}</li>`).join("")}</ul></section>` : "")
    + (posters.length ? `<section class="community-card community-rv community-spot" style="--i:3">${cardHead(t("本版活跃", "Most active"), icons.users)}<ol class="community-rank">${posters.map((poster, i) => `<li><span class="community-hot-rank${i < 3 ? " is-top" : ""}">${i + 1}</span>${avatarHTML(poster.author, common, "sm")}${whoHTML(poster.author, common)}<span class="community-rank-count">${t(`${poster.topics} 帖`, `${poster.topics} posts`)}</span></li>`).join("")}</ol></section>` : "");
  return `<section class="page community-page" data-community="board" data-board="${esc(board)}" style="${communityBoardStyle(item.id)}">${hero}`
    + `<div class="community-layout">${aside ? `<aside class="community-aside">${aside}</aside>` : ""}<div class="community-main">`
    + listingHTML({ list, sort, query, board, showCompose: board !== 'vip' || !me || Boolean(me.vip || me.owner), empty: t("这个版块还没有帖子，来发第一个吧。", "Be the first to post in this board."), meForSort: me, ...common })
    + `</div></div></section>`;
}

/* ---------- 标签页、我的收藏 ---------- */
export function communityTagHTML({ tag, list, sort, query = "", me = null, ...common }: Common & { tag: string; list: CommunityLoad<CommunityListing>; sort: CommunitySort; query?: string; me?: CommunityMe | null }) {
  const { t, esc } = common;
  return `<section class="page community-page" data-community="tag" data-tag="${esc(tag)}">`
    + bannerHTML({ eyebrow: "TAG", title: `#${tag}`, text: t("所有版块里带这个标签的帖子。", "Posts with this tag, across all boards."), esc, before: `<a class="community-crumb" href="#/community/boards">‹ ${t("全部标签", "All tags")}</a>` })
    + `<div class="community-main">${listingHTML({ list, sort, query, board: "", empty: t("还没有带这个标签的帖子。", "No posts with this tag yet."), meForSort: me, ...common })}</div></section>`;
}

export function communityBookmarksHTML({ list, ...common }: Common & { list: CommunityLoad<CommunityListing> }) {
  const { t, esc } = common;
  const ready = readyData(list);
  const body = ready
    ? ready.items.length ? communityTopicsHTML(ready.items, common) : emptyHTML(common, t("还没有收藏", "No bookmarks yet"), t("在帖子下面点“收藏”，就会出现在这里。", "Use “Bookmark” under a post to keep it here."))
    : communityStatusHTML(list, common);
  return `<section class="page community-page" data-community="bookmarks">`
    + bannerHTML({ eyebrow: "BOOKMARKS", title: t("我的收藏", "Bookmarks"), text: t("收藏的帖子只有你自己看得到。", "Only you can see your bookmarks."), esc, side: ready ? statsHTML([[t("收藏", "Saved"), ready.total]]) : "" })
    + `<div class="community-results community-rv" style="--i:1">${body}</div></section>`;
}

// 主站导航“社区交流”进来的落地页：一句话介绍，一个按钮进入社区区域。
export function communityLandingHTML(t: Translate, icons: Icons) {
  return `<section class="page community-landing" data-community="landing">`
    + `<div class="community-orbits" aria-hidden="true"><i></i><i></i><i></i></div>`
    + `<div class="eyebrow">COMMUNITY · ${t("社区交流", "Community")}</div>`
    + `<h1>${t("無相社区", "SANSPHASE Community")}</h1>`
    + `<p>${t("聊 AI 学习、AI 创作，以及好用的软件和资源。提问、晒作品、推荐工具，都在这里。", "Talk about learning AI, making things with it, and useful tools: ask, show your work, share what helps.")}</p>`
    + `<div class="community-landing-actions"><a class="community-enter" href="${communityHomeHref}">${icons.message || ""}<span>${t("进入社区", "Enter the community")}</span></a></div>`
    + `</section>`;
}
