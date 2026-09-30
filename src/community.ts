// 社区：自己的顶栏、首页和尚未开放功能的占位页。
// 社区的数据接口还没有做，首页的帖子列表目前接收空数组；
// 排序和列表渲染已经按接口将来返回的形状写好。

type Translate = (zh: string, en: string) => string;
type Escape = (value?: unknown) => string;

export type CommunityBoard = { id: string; zh: string; en: string; description: string; descriptionEn: string; color: string };

// 版块与设计稿一致：少开版块，细分交给标签。
export const communityBoards: readonly CommunityBoard[] = [
  { id: "qa", zh: "学习问答", en: "Q&A", description: "学 AI 过程中遇到的具体问题，可以采纳答案。", descriptionEn: "Specific questions about learning AI.", color: "#9fb8e0" },
  { id: "showcase", zh: "作品展廊", en: "Showcase", description: "用 AI 做的作品，请写清工具和模型。", descriptionEn: "Work made with AI, with tools and models noted.", color: "#e7a9c6" },
  { id: "tools", zh: "工具资源", en: "Tools", description: "软件、网站和教程推荐。", descriptionEn: "Software, sites and tutorials worth using.", color: "#8fd0c8" },
  { id: "moments", zh: "随想", en: "Moments", description: "300 字以内的随手记录。", descriptionEn: "Short notes, 300 characters or fewer.", color: "#d9c49c" },
  { id: "meta", zh: "站务反馈", en: "Meta", description: "公告和对社区的建议。", descriptionEn: "Announcements and feedback about the community.", color: "#aeb3bd" },
  { id: "vip", zh: "会员茶室", en: "Members", description: "只有 VIP 能看能发。", descriptionEn: "Visible to VIP members only.", color: "#c9b6f2" },
];

export const communityTabs = [
  ["home", "首页", "Home"],
  ["boards", "版块", "Boards"],
  ["checkin", "签到", "Check-in"],
  ["shop", "兑换", "Exchange"],
  ["rank", "排行", "Ranking"],
] as const;

export type CommunityView = "landing" | "home" | "boards" | "checkin" | "shop" | "rank" | "new" | "post" | "unknown";
const subViews = ["home", "boards", "checkin", "shop", "rank", "new"] as const;

// #/community 是主站导航里的落地页（仍用主站顶栏）；点“进入社区”后进入社区区域：
// #/community/home 社区首页，#/community/<子页> 各子页，#/post/<id> 帖子（暂为占位）。
export function communityView(page: string, id = ""): CommunityView {
  if (page === "post") return "post";
  if (page !== "community") return "unknown";
  if (!id) return "landing";
  return (subViews as readonly string[]).includes(id) ? (id as CommunityView) : "unknown";
}
// 社区区域用自己的顶栏；落地页和其他页面用主站顶栏。
export const inCommunityArea = (view: CommunityView) => view !== "unknown" && view !== "landing";
export const communityHomeHref = "#/community/home";
const tabHref = (id: string) => `#/community/${id}`;

export type CommunityTopic = {
  id: string;
  board: string;
  title: string;
  author: string;
  createdAt: string;
  lastActivityAt: string;
  replies: number;
  likes: number;
  pinned?: boolean;
  featured?: boolean;
};
export type CommunitySort = "active" | "newest" | "hot" | "featured";
export const communitySorts: ReadonlyArray<readonly [CommunitySort, string, string]> = [
  ["active", "最新回复", "Latest replies"],
  ["newest", "最新发布", "Newest"],
  ["hot", "热门", "Popular"],
  ["featured", "精华", "Featured"],
];
export const isCommunitySort = (value: unknown): value is CommunitySort => communitySorts.some(([id]) => id === value);

const time = (value: string) => Date.parse(value) || 0;
// 热度：回复比赞更重，越旧的帖子分数越低（每 8 小时减 1 分）。
const heat = (topic: CommunityTopic, now: number) => topic.likes * 2 + topic.replies * 3 - (now - time(topic.createdAt)) / 3.6e6 / 8;

export function sortTopics(topics: readonly CommunityTopic[], sort: CommunitySort, now = Date.now()): CommunityTopic[] {
  const list = sort === "featured" ? topics.filter((topic) => topic.featured) : [...topics];
  if (sort === "hot") list.sort((a, b) => heat(b, now) - heat(a, now));
  else if (sort === "newest") list.sort((a, b) => time(b.createdAt) - time(a.createdAt));
  else list.sort((a, b) => time(b.lastActivityAt) - time(a.lastActivityAt));
  // 置顶只在按时间排序时排在最前；热门和精华按内容本身排。
  if (sort === "active" || sort === "newest") list.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  return list;
}
export const hotTopics = (topics: readonly CommunityTopic[], limit = 5, now = Date.now()) =>
  sortTopics(topics.filter((topic) => !topic.pinned), "hot", now).slice(0, limit);

function relativeTime(value: string, now: number, t: Translate) {
  const minutes = Math.max(0, Math.floor((now - time(value)) / 60000));
  if (minutes < 1) return t("刚刚", "just now");
  if (minutes < 60) return t(`${minutes} 分钟前`, `${minutes} min ago`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(`${hours} 小时前`, `${hours} h ago`);
  const days = Math.floor(hours / 24);
  if (days < 7) return t(`${days} 天前`, `${days} d ago`);
  return new Date(time(value)).toISOString().slice(0, 10);
}

type HeaderOptions = { view: CommunityView; t: Translate; icons: Record<string, string>; actionsHTML: string };

// 社区顶栏：左边社区字标，中间社区导航（沿用 #navigation，手机菜单照常工作），右边发帖和账号菜单。
// 回無相主站的入口放在右上角的账号菜单里。
export function communityHeaderHTML({ view, t, icons, actionsHTML }: HeaderOptions) {
  const nav = communityTabs
    .map(([id, zh, en]) => `<a href="${tabHref(id)}"${view === id ? ' aria-current="page"' : ""}>${t(zh, en)}</a>`)
    .join("");
  return `<div class="community-brand-group"><a href="${communityHomeHref}" class="community-brand" aria-label="${t("社区首页", "Community home")}"><strong>${t("社区", "Community")}</strong><span aria-hidden="true">COMMUNITY</span></a></div>`
    + `<nav class="nav community-nav" id="navigation" aria-label="${t("社区导航", "Community navigation")}">${nav}</nav>`
    + `<div class="header-actions"><a class="community-post" href="#/community/new">${icons.plus || ""}<span>${t("发帖", "New post")}</span></a>${actionsHTML}</div>`;
}

type AccountOptions = { t: Translate; esc: Escape; icons: Record<string, string>; nickname?: string | null; author?: boolean };

// 社区里的账号按钮是一个菜单：账号（或登录、作者台）和“返回無相主站”。
export function communityAccountHTML({ t, esc, icons, nickname, author }: AccountOptions) {
  const label = author ? t("作者台", "Author studio") : nickname ? esc(nickname) : t("登录 / 注册", "Sign in / Register");
  const first = author
    ? `<button type="button" role="menuitem" data-author-login>${t("打开作者台", "Open author studio")}</button>`
    : `<a role="menuitem" href="#/account" data-reader-return>${nickname ? t("我的账号", "My account") : t("登录 / 注册", "Sign in / Register")}</a>`;
  return `<div class="community-account"><button type="button" class="account-button" data-action="community-account" aria-haspopup="menu" aria-expanded="false" aria-controls="community-account-menu"><span>${label}</span>${icons["chevron-down"] || ""}</button>`
    + `<div class="community-account-menu" id="community-account-menu" role="menu" hidden>${first}<a role="menuitem" href="#/home">${icons.left || ""}${t("返回無相主站", "Back to 無相")}</a></div></div>`;
}

type HomeOptions = { topics: readonly CommunityTopic[]; sort: CommunitySort; t: Translate; esc: Escape; now?: number };

export function communityHomeHTML({ topics, sort, t, esc, now = Date.now() }: HomeOptions) {
  const board = (id: string) => communityBoards.find((item) => item.id === id);
  const counts = new Map<string, number>();
  for (const topic of topics) counts.set(topic.board, (counts.get(topic.board) || 0) + 1);
  const hot = hotTopics(topics, 5, now);
  const list = sortTopics(topics, sort, now);
  const hotHTML = hot.length
    ? `<ol class="community-hot">${hot.map((topic, i) => `<li><span class="community-hot-rank">${String(i + 1).padStart(2, "0")}</span><a href="#/post/${encodeURIComponent(topic.id)}">${esc(topic.title)}</a></li>`).join("")}</ol>`
    : `<p class="community-muted">${t("还没有帖子。有了讨论以后，这里会列出本周最热的五个。", "No posts yet. The five most active this week will appear here.")}</p>`;
  const boardsHTML = communityBoards.map((item) =>
    `<a class="community-board-link" href="#/community/boards" style="--board:${item.color}"><i aria-hidden="true"></i><span>${t(item.zh, item.en)}</span><span class="community-board-count">${counts.get(item.id) || 0}</span></a>`).join("");
  const sortHTML = communitySorts.map(([id, zh, en]) =>
    `<button type="button" data-action="community-sort" data-sort="${id}" aria-pressed="${sort === id}">${t(zh, en)}</button>`).join("");
  const listHTML = list.length
    ? `<div class="community-topics">${list.map((topic) => {
      const b = board(topic.board);
      return `<article class="community-topic" style="--board:${b?.color || "#aeb3bd"}"><div class="community-topic-main"><h3>${topic.pinned ? `<span class="community-flag">${t("置顶", "Pinned")}</span>` : ""}${topic.featured ? `<span class="community-flag is-featured">${t("精华", "Featured")}</span>` : ""}<a href="#/post/${encodeURIComponent(topic.id)}">${esc(topic.title)}</a></h3><p class="community-topic-meta"><span class="community-topic-board">${esc(b ? t(b.zh, b.en) : topic.board)}</span><span>${esc(topic.author)}</span><time datetime="${esc(topic.lastActivityAt)}">${relativeTime(topic.lastActivityAt, now, t)}</time></p></div><span class="community-topic-replies" aria-label="${t(`${topic.replies} 条回复`, `${topic.replies} replies`)}">${topic.replies}</span></article>`;
    }).join("")}</div>`
    : `<div class="empty community-empty"><p>${sort === "featured" && topics.length ? t("还没有精华帖。", "No featured posts yet.") : t("社区还没有帖子。发帖功能开放后，这里会显示最新的讨论。", "No posts yet. New discussions will appear here once posting opens.")}</p></div>`;
  return `<section class="page community-page" data-community="home">`
    + `<header class="community-banner"><div class="community-banner-text"><div class="eyebrow">COMMUNITY</div><h1>${t("社区", "Community")}</h1><p>${t("聊 AI 学习、AI 创作，以及好用的软件和资源。", "Talk about learning AI, making things with it, and useful tools.")}</p></div>`
    + `<dl class="community-stats"><div><dt>${t("主题", "Topics")}</dt><dd>${topics.length}</dd></div><div><dt>${t("版块", "Boards")}</dt><dd>${communityBoards.length}</dd></div></dl></header>`
    + `<div class="community-layout"><aside class="community-aside">`
    + `<section class="community-card"><h2>${t("本周热门", "Trending this week")}</h2>${hotHTML}</section>`
    + `<section class="community-card"><h2>${t("版块", "Boards")}</h2><div class="community-boards">${boardsHTML}</div></section>`
    + `</aside><div class="community-main"><div class="community-sort"><div class="community-sort-tabs" role="group" aria-label="${t("排序", "Sort")}">${sortHTML}</div><span class="community-count">${t(`${topics.length} 个主题`, `${topics.length} topics`)}</span></div>${listHTML}</div></div></section>`;
}

const placeholderCopy: Record<string, [string, string, string, string]> = {
  boards: ["版块", "Boards", "版块页正在做，很快就能按版块浏览帖子。", "Browsing by board is on the way."],
  checkin: ["签到", "Check-in", "签到和星尘正在做，开放后每天签到都能领星尘。", "Daily check-in and stardust are on the way."],
  shop: ["兑换所", "Exchange", "兑换所正在做，开放后可以用星尘兑换装扮、道具卡和周边。", "The stardust exchange is on the way."],
  rank: ["排行榜", "Ranking", "排行榜正在做，开放后会有本月贡献、连签榜和今日早鸟。", "Leaderboards are on the way."],
  new: ["发帖", "New post", "发帖功能正在做，开放后可以在各个版块发帖。", "Posting is on the way."],
  post: ["帖子", "Post", "帖子详情还没有开放。", "Post pages are not open yet."],
};

export function communityPlaceholderHTML(view: string, t: Translate) {
  const [zh, en, message, messageEn] = placeholderCopy[view] || placeholderCopy.post;
  return `<section class="page community-page" data-community="${view in placeholderCopy ? view : "post"}"><header class="community-banner"><div class="community-banner-text"><div class="eyebrow">COMMUNITY</div><h1>${t(zh, en)}</h1><p>${t(message, messageEn)}</p></div></header><div class="empty community-empty" data-content-state="not-open"><p>${t("这个功能即将开放。", "Coming soon.")}</p><a class="button" href="${communityHomeHref}">${t("回到社区首页", "Back to the community")}</a></div></section>`;
}

// 主站导航“社区交流”进来的落地页：一句话介绍，一个按钮进入社区区域。
export function communityLandingHTML(t: Translate, icons: Record<string, string>) {
  return `<section class="page community-landing" data-community="landing">`
    + `<div class="community-orbits" aria-hidden="true"><i></i><i></i><i></i></div>`
    + `<div class="eyebrow">COMMUNITY · ${t("社区交流", "Community")}</div>`
    + `<h1>${t("無相社区", "SANSPHASE Community")}</h1>`
    + `<p>${t("聊 AI 学习、AI 创作，以及好用的软件和资源。提问、晒作品、推荐工具，都在这里。", "Talk about learning AI, making things with it, and useful tools: ask, show your work, share what helps.")}</p>`
    + `<div class="community-landing-actions"><a class="community-enter" href="${communityHomeHref}">${icons.message || ""}<span>${t("进入社区", "Enter the community")}</span></a></div>`
    + `</section>`;
}
