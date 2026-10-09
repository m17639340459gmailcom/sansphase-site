// One route policy shared by the lightweight app and the deferred forum.
import { communityTags } from './community-rules.mjs';

export const validCommunityBoardId = (id: string) => /^[a-z][a-z0-9-]{1,47}$/.test(id);

export const communityTabs = [
  ["home", "首页", "Home"],
  ["boards", "版块", "Boards"],
  ["checkin", "签到", "Check-in"],
  ["shop", "兑换", "Exchange"],
  ["rank", "排行", "Ranking"],
] as const;

export type CommunityView =
  | "landing" | "home" | "boards" | "board" | "checkin" | "shop" | "rank" | "new" | "edit" | "tag" | "bookmarks"
  | "manage" | "member" | "profile" | "stardust" | "inbox" | "rules" | "post" | "unknown";
// The second part of #/community/<…>; `u` is a member page.
const subViews: Record<string, CommunityView> = {
  home: "home", boards: "boards", checkin: "checkin", shop: "shop", rank: "rank", new: "new", edit: "edit", tag: "tag",
  bookmarks: "bookmarks", manage: "manage", u: "member", profile: "profile", stardust: "stardust", inbox: "inbox", rules: "rules",
};
// Pages with their own tabs: the tab is the last part of the address; the first is the default.
export const communityPageTabs = {
  member: ["topics", "replies", "badges", "icons", "frames", "bookmarks"],
  stardust: ["ledger", "levels", "rules"],
  inbox: ["all", "reply", "thanks", "system"],
  shop: ["all", "look", "card", "digital", "goods", "mine"],
  manage: ["queue", "reports", "profiles", "content", "features", "banners", "boards", "orders", "items", "stewards", "sanctions", "data", "contact", "convention"],
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
export const tabHref = (id: string) => `#/community/${id}`;
export const boardHref = (id: string) => `#/community/boards/${encodeURIComponent(id)}`;
export const composeHref = (board = "") => board ? `#/community/new/${encodeURIComponent(board)}` : "#/community/new";
export const postHref = (id: string, replyId = "") => `#/post/${encodeURIComponent(id)}${replyId ? `/reply/${encodeURIComponent(replyId)}` : ""}`;
export const tagHref = (tag: string) => `#/community/tag/${encodeURIComponent(tag)}`;
export const memberHref = (uid: string, tab = "") => `#/community/u/${encodeURIComponent(uid)}${tab ? `/${tab}` : ""}`;
export const stardustHref = (tab = "") => `#/community/stardust${tab ? `/${tab}` : ""}`;
export const inboxHref = (tab = "") => `#/community/inbox${tab && tab !== "all" ? `/${tab}` : ""}`;
export const shopHref = (tab = "") => `#/community/shop${tab && tab !== "all" ? `/${tab}` : ""}`;
export const manageHref = (tab = "") => `#/community/manage${tab && tab !== "queue" ? `/${tab}` : ""}`;
export const rulesHref = "#/community/rules";

export type CommunityRoute = { view: CommunityView; board: string; id: string; tab: string; replyId?: string };
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
  if (view === "post") {
    if (!id || rest.length || extra && (extra !== "reply" || !fourth)) return unknownRoute;
    return { ...unknownRoute, view, id, ...(extra === "reply" ? { replyId: fourth } : {}) };
  }
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
  // Routing must work on a cold direct link, before the public catalog arrives.
  // Existence is confirmed by the catalog/API, never inferred from the slug.
  if (!validCommunityBoardId(extra)) return unknownRoute;
  return route({ view: view === "boards" ? "board" : view, board: extra });
}
