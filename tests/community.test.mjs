import test from "node:test";
import assert from "node:assert/strict";
import {
  communityBoards,
  communityTabs,
  communityView,
  sortTopics,
  hotTopics,
  communityHeaderHTML,
  communityHomeHTML,
  communityPlaceholderHTML,
  communityLandingHTML,
  communityAccountHTML,
  inCommunityArea,
} from "../src/community.mjs";

const t = (zh) => zh;
const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icons = { menu: "", close: "", left: "", plus: "" };
const now = Date.parse("2026-09-30T12:00:00Z");
const topic = (id, overrides = {}) => ({
  id, board: "qa", title: `主题 ${id}`, author: "林间",
  createdAt: "2026-09-29T08:00:00Z", lastActivityAt: "2026-09-29T08:00:00Z",
  replies: 0, likes: 0, ...overrides,
});

test("community routes map to the landing page, the home, tabs, placeholders and unknown pages", () => {
  assert.equal(communityView("community", ""), "landing");
  assert.equal(inCommunityArea("landing"), false, "the landing page keeps the main site header");
  for (const view of ["home", "boards", "checkin", "shop", "rank", "new"]) {
    assert.equal(communityView("community", view), view);
    assert.equal(inCommunityArea(view), true);
  }
  assert.equal(inCommunityArea("post"), true);
  assert.equal(communityView("post", "abc"), "post");
  assert.equal(communityView("community", "nope"), "unknown");
  assert.equal(communityView("notes", ""), "unknown");
  assert.deepEqual(communityTabs.map(([id]) => id), ["home", "boards", "checkin", "shop", "rank"]);
  assert.equal(communityBoards.length, 6);
  assert.equal(new Set(communityBoards.map((b) => b.id)).size, 6);
});

test("topics sort by latest activity, creation, heat or featured; pinned stay first", () => {
  const topics = [
    topic("old-pinned", { pinned: true, lastActivityAt: "2026-09-01T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" }),
    topic("busy", { replies: 20, likes: 30, lastActivityAt: "2026-09-29T09:00:00Z", createdAt: "2026-09-20T00:00:00Z" }),
    topic("fresh", { lastActivityAt: "2026-09-30T11:00:00Z", createdAt: "2026-09-30T11:00:00Z", featured: true }),
  ];
  assert.deepEqual(sortTopics(topics, "active", now).map((x) => x.id), ["old-pinned", "fresh", "busy"]);
  assert.deepEqual(sortTopics(topics, "newest", now).map((x) => x.id), ["old-pinned", "fresh", "busy"]);
  assert.deepEqual(sortTopics(topics, "hot", now).map((x) => x.id)[0], "busy");
  assert.deepEqual(sortTopics(topics, "featured", now).map((x) => x.id), ["fresh"]);
  assert.deepEqual(topics.map((x) => x.id), ["old-pinned", "busy", "fresh"], "input is not mutated");
  assert.deepEqual(hotTopics(topics, 5, now).map((x) => x.id), ["busy", "fresh"], "pinned notices are not trending");
});

test("community header keeps one navigation and marks the current tab; the way back lives in the account menu", () => {
  const html = communityHeaderHTML({ view: "shop", t, icons, actionsHTML: "<button data-action=\"menu\"></button>" });
  assert.match(html, /id="navigation"/);
  const nav = html.slice(html.indexOf('id="navigation"'), html.indexOf("</nav>"));
  assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
    ["#/community/home", "#/community/boards", "#/community/checkin", "#/community/shop", "#/community/rank"]);
  assert.match(html, /<a href="#\/community\/shop" aria-current="page">/);
  assert.doesNotMatch(html, /href="#\/home"|community-back/, "no back link in the corner");
  assert.match(html, /<a href="#\/community\/home" class="community-brand"/);
  assert.match(html, /href="#\/community\/new"/);
  assert.match(html, /data-action="menu"/);
  const home = communityHeaderHTML({ view: "home", t, icons, actionsHTML: "" });
  assert.match(home, /<a href="#\/community\/home" aria-current="page">/);
  const post = communityHeaderHTML({ view: "post", t, icons, actionsHTML: "" });
  assert.doesNotMatch(post, /aria-current/);
});

test("community home shows honest empty states and never offers unbuilt actions", () => {
  const html = communityHomeHTML({ topics: [], sort: "active", t, esc, now });
  assert.match(html, /data-community="home"/);
  assert.match(html, /<h1>社区<\/h1>/);
  assert.match(html, /还没有帖子/);
  for (const board of communityBoards) assert.match(html, new RegExp(board.zh));
  assert.match(html, /data-action="community-sort" data-sort="active" aria-pressed="true"/);
  assert.doesNotMatch(html, /compose-form|reply-form|data-action="checkin"/);
});

test("community home lists topics with escaped text and the chosen order", () => {
  const html = communityHomeHTML({
    topics: [
      topic("a", { title: "<img src=x onerror=alert(1)>", author: "<b>x</b>", board: "showcase", replies: 3 }),
      topic("b", { title: "第二个", lastActivityAt: "2026-09-30T10:00:00Z" }),
    ],
    sort: "active", t, esc, now,
  });
  assert.doesNotMatch(html, /<img src=x|<b>x<\/b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const main = html.slice(html.indexOf('class="community-topics"'));
  assert.ok(main.indexOf("第二个") < main.indexOf("&lt;img"), "newer activity comes first");
  assert.match(html, /href="#\/post\/a"/);
  assert.match(html, /2 个主题/);
});

test("placeholders say the feature is not open yet and link back to the community home", () => {
  for (const view of ["boards", "checkin", "shop", "rank", "new", "post"]) {
    const html = communityPlaceholderHTML(view, t);
    assert.match(html, /data-content-state="not-open"/);
    assert.match(html, /<h1>/);
    assert.match(html, /href="#\/community\/home"/);
  }
});

test("the landing page from the main navigation leads into the community", () => {
  const html = communityLandingHTML(t, { message: "" });
  assert.match(html, /data-community="landing"/);
  assert.match(html, /<h1>無相社区<\/h1>/);
  assert.match(html, /<a class="community-enter" href="#\/community\/home">/);
  assert.doesNotMatch(html, /Demo|示例|未读/);
});

test("the community account menu carries the way back to the main site", () => {
  const menu = (options) => communityAccountHTML({ t, esc, icons: { "chevron-down": "", left: "" }, ...options });
  const reader = menu({ nickname: "<林间>" });
  assert.match(reader, /data-action="community-account" aria-haspopup="menu" aria-expanded="false"/);
  assert.match(reader, /&lt;林间&gt;/);
  assert.doesNotMatch(reader, /<林间>/);
  assert.match(reader, /<a role="menuitem" href="#\/account" data-reader-return>我的账号<\/a>/);
  assert.match(reader, /<a role="menuitem" href="#\/home">[^<]*返回無相主站<\/a>/);
  assert.match(reader, /role="menu"[^>]* hidden/);
  const guest = menu({});
  assert.match(guest, />登录 \/ 注册</);
  assert.match(guest, /href="#\/account" data-reader-return>登录 \/ 注册</);
  const owner = menu({ author: true });
  assert.match(owner, />作者台</);
  assert.match(owner, /<button type="button" role="menuitem" data-author-login>打开作者台<\/button>/);
  assert.match(owner, /href="#\/home"/);
});
