import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  communityBoards, communityTabs, communityView, communityRoute, inCommunityArea, sortTopics, hotTopics,
  communityHeaderHTML, communityAccountHTML, communityHomeHTML, communityBoardsHTML, communityBoardHTML, communityTagHTML,
  communityBookmarksHTML, communityTopicsHTML, communityBodyHTML, communityLandingHTML, plainText,
  memberHref, inboxHref, shopHref, manageHref, stardustHref, communityRules, communityTags, checkinReward, checkinMonth, beijingDay,
} from "../src/community.mjs";
import { communityPostHTML, communityComposeHTML, editingFrom } from "../src/community-post.mjs";
import {
  communityCheckinHTML, communityStardustHTML, communityShopHTML, communityShopMineHTML, communityRankHTML, communityMemberHTML,
  communityInboxHTML, communityRulesHTML, communityManageHTML, noticeTextHTML, noticeHref,
} from "../src/community-pages.mjs";

const t = (zh) => zh;
const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icons = { menu: "", close: "", left: "", plus: "" };
const ui = { star: "<i-star></i-star>", reply: "<i-reply></i-reply>", lock: "<i-lock></i-lock>", pin: "<i-pin></i-pin>", award: "<i-award></i-award>", search: "", plus: "", trash: "<i-trash></i-trash>", copy: "", send: "", help: "<i-help></i-help>", bell: "<i-bell></i-bell>" };
const now = Date.parse("2026-09-30T12:00:00Z");
const common = { t, esc, now, icons: ui };
const textAt = (markup, selector) => {
  const dom = new JSDOM(markup);
  try { return dom.window.document.querySelector(selector)?.textContent; }
  finally { dom.window.close(); }
};
const person = (name, overrides = {}) => ({ name, role: "reader", uid: name === "林间" ? "u1" : "u2", avatar: null, vip: false, level: 1, steward: false, frame: null, color: null, ...overrides });
const owner = { name: "無相", role: "owner", uid: "owner", avatar: null, vip: true, level: 4, steward: false, frame: null, color: null };
const topic = (id, overrides = {}) => ({
  id, board: "qa", title: `主题 ${id}`, author: person("林间"),
  createdAt: "2026-09-29T08:00:00Z", lastActivityAt: "2026-09-29T08:00:00Z", replies: 0, likes: 0, ...overrides,
});
const me = (overrides = {}) => ({
  ...person("林间"), owner: false, mod: false, balance: 30, checkedIn: false, streak: 6, nextReward: { total: 1, bonus: 0 },
  gainedToday: 0, behaviourToday: 0, dailyCap: 6, unread: { all: 0, reply: 0, thanks: 0, system: 0 }, agreed: true,
  inventory: { makeup: 0, pin: 0, highlight: 0 }, muted: null, ...overrides,
});
const ready = (data) => ({ state: "ready", data });
const listing = (items, total = items.length, extra = {}) => ready({ items, total, page: 1, pageSize: 20, ...extra });
const stats = (topics, repliesToday = 0, latest = null) => ({ topics, repliesToday, latest });
const summary = (overrides = {}) => ready({ total: 0, repliesToday: 0, checkinsToday: 0, boards: {}, tags: {}, hot: [], ...overrides });
const count = (html, pattern) => [...html.matchAll(pattern)].length;

test('management is a dedicated workspace with role navigation, product artwork and required deletion reasons', () => {
  for (const owner of [true, false]) {
    const html = communityManageHTML({ manage: ready(manage({ owner, content: [topic('t1')] })), tab: 'content', deleting: { kind: 'topic', id: 't1' }, ...common });
    const doc = new JSDOM(html).window.document;
    assert.ok(doc.querySelector('.community-management-page > .community-management-nav'));
    assert.match(doc.querySelector('h1').textContent, owner ? /作者/ : /版主/);
    assert.ok(doc.querySelector('[data-community-form="delete"] [name="reason"][required]'));
    assert.ok(doc.querySelector('[data-action="community-queue-delete"]'));
    assert.equal(Boolean(doc.querySelector('a[href="#/community/manage/items"]')), owner);
    assert.ok(doc.querySelector('[data-action="community-browse-mode"]'));
  }
  const html = communityManageHTML({ manage: ready(manage()), tab: 'items', itemEditing: { id: null }, ...common });
  assert.match(html, /data-community-item-upload/);
  assert.match(html, /image\/gif/);
  const menu = communityAccountHTML({ ...common, me: me({ management: { role: 'owner', browsingAsReader: true } }) });
  assert.match(menu, /data-action="community-browse-mode" data-reader="false"/);
  assert.doesNotMatch(menu, /href="#\/community\/manage"/);
});

test('recommended topics follow pinned topics in time sorts and cannot be recommended twice', () => {
  const items = [topic('fresh', { createdAt: '2026-09-30T10:00:00Z', lastActivityAt: '2026-09-30T10:00:00Z' }), topic('recommended', { paidPin: true }), topic('pinned', { pinned: true })];
  for (const sort of ['active', 'newest']) assert.deepEqual(sortTopics(items, sort).map(item => item.id), ['pinned', 'recommended', 'fresh']);
  const html = communityPostHTML({ thread: thread({ topic: { pinned: true, paidPin: true, canPaidPin: false, canModerate: true } }), me: me(), menuOpen: true, ...common });
  assert.doesNotMatch(html, /data-action="community-paid-pin"/);
  assert.match(html, /data-action="community-pin"[^>]*aria-pressed="true"[\s\S]*取消置顶/);
});

test('rejected review notices explain appeals and review options translate to English', () => {
  const notice = { type: 'review', data: { state: 'rejected', title: '主题', reason: '广告引流' }, link: '#/community/boards/meta', text: '' };
  assert.match(noticeTextHTML(notice, common), /有异议可以在站务反馈发帖/);
  assert.match(noticeTextHTML(notice, { ...common, t: (_, en) => en }), /If you disagree, post in Meta/);
  const panel = communityManageHTML({ manage: ready(manage()), tab: 'queue', rejecting: 'p1', ...common, t: (_, en) => en });
  assert.match(panel, /value="广告引流"[^>]*><span>advertising or lead generation<\/span>/i);
  assert.doesNotMatch(panel, /<span>广告引流<\/span>/);
});

test('mobile inventory places the small card and its name in separate grid cells', () => {
  const css = readFileSync(new URL('../src/community.css', import.meta.url), 'utf8');
  assert.match(css, /\.community-inv \.community-sart\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;/);
  assert.match(css, /\.community-inv-body\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;/);
  assert.match(css, /\.community-inv \.community-sart \.community-holo\s*\{[^}]*width:\s*\d+px;[^}]*height:\s*\d+px;[^}]*transform:\s*none/);
});

test('recommendation flag has its own neutral style', () => {
  const css = readFileSync(new URL('../src/community.css', import.meta.url), 'utf8');
  assert.match(css, /\.community-flag\.is-recommend\s*\{[^}]*border[^}]*background[^}]*color/);
});

test('owner stardust and own profile offer no check-in reminder', () => {
  const ownerMe = me({ ...owner, owner: true, mod: true });
  const dust = communityStardustHTML({ stardust: ready(stardust({ owner: true })), tab: 'ledger', ...common });
  assert.doesNotMatch(dust, /今天还没签到|去签到|href="#\/community\/checkin"/);
  const profile = communityMemberHTML({ member: ready(memberPage({ person: owner, self: true, quick: { balance: 0, checkedIn: false, unread: 0, orders: 0 } })), me: ownerMe, ...common });
  assert.doesNotMatch(profile, /还没签到|href="#\/community\/checkin"/);
});

test('check-in reminders distinguish real readers from read-only management previews', () => {
  const render = identity => new JSDOM(communityHomeHTML({ ...common, summary: ready({ total: 0, boards: {}, hot: [] }), list: ready({ items: [], total: 0, page: 1, pageSize: 20 }), sort: 'active', members: false, me: ready(identity) }));
  const reader = render(me());
  assert.ok(reader.window.document.querySelector('[data-action="community-checkin"]'), 'ordinary readers retain their check-in action');
  reader.window.close();
  const authorPreview = render(me({ ...owner, owner: false, mod: false, management: { role: 'owner', browsingAsReader: true } }));
  assert.equal(authorPreview.window.document.querySelector('.community-ck-pill'), null, 'an owner perspective switch must not fabricate check-in eligibility');
  authorPreview.window.close();
  const moderatorPreview = render(me({ management: { role: 'steward', browsingAsReader: true } }));
  assert.equal(moderatorPreview.window.document.querySelector('[data-action="community-checkin"]'), null);
  assert.equal(moderatorPreview.window.document.querySelector('.community-ck-pill'), null, 'the moderator preview adds no perspective reminder');
  moderatorPreview.window.close();
});

test("community routes: the landing page, pages, boards, posts, members and the tabs of tabbed pages", () => {
  assert.equal(communityView("community", ""), "landing");
  assert.equal(inCommunityArea("landing"), false, "the landing page keeps the main site header");
  for (const view of ["home", "boards", "checkin", "shop", "rank", "new", "stardust", "inbox", "rules", "manage", "bookmarks"]) {
    assert.equal(communityView("community", view), view);
    assert.equal(inCommunityArea(view), true);
  }
  assert.equal(communityView("community", "u"), "member");
  assert.equal(inCommunityArea("post"), true);
  assert.equal(communityView("post", "abc"), "post");
  assert.equal(communityView("community", "nope"), "unknown");
  assert.equal(communityView("community", "constructor"), "unknown", "only the community's own page names");
  assert.equal(communityView("notes", ""), "unknown");
  assert.deepEqual(communityTabs.map(([id]) => id), ["home", "boards", "checkin", "shop", "rank"]);
  assert.equal(new Set(communityBoards.map((b) => b.id)).size, 6);
  const route = (hash) => communityRoute(hash);
  assert.deepEqual(route("#/community/boards"), { view: "boards", board: "", id: "", tab: "" });
  assert.deepEqual(route("#/community/boards/qa"), { view: "board", board: "qa", id: "", tab: "" });
  assert.deepEqual(route("#/community/new/tools"), { view: "new", board: "tools", id: "", tab: "" });
  assert.deepEqual(route("#/community/new"), { view: "new", board: "", id: "", tab: "" });
  assert.deepEqual(route("#/post/abc"), { view: "post", board: "", id: "abc", tab: "" });
  assert.deepEqual(route("#/community/u/u1"), { view: "member", board: "", id: "u1", tab: "topics" });
  assert.deepEqual(route("#/community/u/u1/badges"), { view: "member", board: "", id: "u1", tab: "badges" });
  assert.deepEqual(route("#/community/stardust"), { view: "stardust", board: "", id: "", tab: "ledger" });
  assert.equal(route("#/community/stardust/levels").tab, "levels");
  assert.equal(route("#/community/inbox").tab, "all");
  assert.equal(route("#/community/inbox/system").tab, "system");
  assert.equal(route("#/community/shop").tab, "all");
  assert.equal(route("#/community/shop/mine").tab, "mine");
  assert.equal(route("#/community/manage").tab, "queue");
  assert.equal(route("#/community/manage/orders").tab, "orders");
  assert.deepEqual(route(`#/community/tag/${encodeURIComponent("Stable Diffusion")}`), { view: "tag", board: "", id: "Stable Diffusion", tab: "" });
  assert.deepEqual(route("#/community/edit/abc"), { view: "edit", board: "", id: "abc", tab: "" });
  assert.equal(route("#/community/rules").view, "rules");
  for (const bad of ["#/community/boards/nope", "#/community/home/qa", "#/community/boards/qa/x", "#/post/", "#/post/a/b", "#/community/%E0",
    "#/community/u", "#/community/u/u1/nope", "#/community/u/u1/topics/x", "#/community/stardust/nope", "#/community/manage/x",
    "#/community/tag/没有的标签", "#/community/tag", "#/community/edit", "#/community/rules/x", "#/community/shop/nope", "#/community/inbox/all/x"])
    assert.equal(route(bad).view, "unknown", bad);
  assert.equal(memberHref("u 1", "replies"), "#/community/u/u%201/replies");
  assert.deepEqual([inboxHref("all"), inboxHref("reply"), shopHref("all"), shopHref("mine"), manageHref("queue"), manageHref("data"), stardustHref(), stardustHref("rules")],
    ["#/community/inbox", "#/community/inbox/reply", "#/community/shop", "#/community/shop/mine", "#/community/manage", "#/community/manage/data", "#/community/stardust", "#/community/stardust/rules"]);
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

test("the community header keeps one navigation, marks the current tab and a check-in still to do", () => {
  const html = communityHeaderHTML({ view: "shop", t, icons, actionsHTML: "<button data-action=\"menu\"></button>" });
  const nav = html.slice(html.indexOf('id="navigation"'), html.indexOf("</nav>"));
  assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
    ["#/community/home", "#/community/boards", "#/community/checkin", "#/community/shop", "#/community/rank", "#/community/rules"]);
  assert.match(html, /<a href="#\/community\/shop" aria-current="page">/);
  assert.doesNotMatch(html, /href="#\/home"|community-back/, "no back link in the corner");
  assert.match(html, /<a href="#\/community\/home" class="community-brand"/);
  assert.doesNotMatch(html, /community-post|#\/community\/new/, "posting starts from the list bar, not the header");
  assert.match(html, /data-action="menu"/);
  assert.match(communityHeaderHTML({ view: "board", t, icons, actionsHTML: "" }), /<a href="#\/community\/boards" aria-current="page">/, "a board page is under 版块");
  assert.doesNotMatch(communityHeaderHTML({ view: "post", t, icons, actionsHTML: "" }), /aria-current/);
  assert.doesNotMatch(communityHeaderHTML({ view: "member", t, icons, actionsHTML: "" }), /aria-current/);
  assert.doesNotMatch(html, /community-nav-dot/);
  assert.match(communityHeaderHTML({ view: "home", t, icons, actionsHTML: "", unchecked: true }),
    /href="#\/community\/checkin">签到<i class="community-nav-dot" aria-hidden="true"><\/i><span class="sr-only">（今天还没签到）<\/span><\/a>/);
});

test("the account menu keeps personal pages and moderation without duplicate site or shop links", () => {
  const menu = (options) => communityAccountHTML({ t, esc, icons: { "chevron-down": "", left: "", bell: "<i-bell></i-bell>" }, ...options });
  const guest = menu({});
  assert.match(guest, /<span>登录 \/ 注册<\/span>/);
  assert.match(guest, /href="#\/account" data-reader-return><span>登录 \/ 注册<\/span>/);
  assert.doesNotMatch(guest, /community-bell|我的收藏/, "a guest has no notifications or bookmarks");
  assert.doesNotMatch(guest, /href="#\/home"|href="#\/community\/shop"/);
  const reader = menu({ nickname: "<林间>" });
  assert.match(reader, /data-action="community-account" aria-haspopup="menu" aria-expanded="false"/);
  assert.match(reader, /&lt;林间&gt;/);
  assert.doesNotMatch(reader, /<林间>/);
  assert.match(reader, /<a role="menuitem" href="#\/account" data-reader-return><span>我的账号<\/span><\/a>/);
  assert.match(reader, /href="#\/community\/bookmarks"><span>我的收藏<\/span>/);
  assert.match(reader, /role="menu"[^>]* hidden/);
  assert.doesNotMatch(reader, /社区管理/, "moderation is for moderators");
  const author = menu({ author: true });
  assert.match(author, /<span>作者台<\/span>/);
  assert.match(author, /<button type="button" role="menuitem" data-author-login><span>打开作者台<\/span><\/button>/);
  assert.doesNotMatch(author, /href="#\/community\/manage"/, 'wait for the verified community account before exposing management');
  // Once the community knows the member: the bell, a head with level and UID, and their pages.
  const signedIn = menu({ nickname: "林间", me: me({ balance: 42, unread: { all: 3, reply: 3, thanks: 0, system: 0 } }) });
  assert.match(signedIn, /^<a class="community-bell" href="#\/community\/inbox" aria-label="通知，3 条未读"><i-bell><\/i-bell><b>3<\/b><\/a>/);
  assert.equal(textAt(signedIn, '.account-button.has-avatar > .community-name > .community-uname'), '林间');
  assert.equal(textAt(signedIn, '.community-menu-head b'), '林间');
  assert.equal(textAt(signedIn, '.community-menu-head div > span'), '巡天 · UID u1');
  assert.deepEqual([...signedIn.matchAll(/role="menuitem" (?:class="[^"]+" )?href="([^"]+)"/g)].map((m) => m[1]),
    ["#/community/u/u1", "#/community/stardust", "#/community/inbox", "#/community/bookmarks", "#/account"]);
  assert.match(signedIn, /<span>我的星尘<\/span><span class="community-menu-num">42<\/span>/);
  assert.match(signedIn, /<span>通知<\/span><span class="community-menu-badge">3<\/span>/);
  assert.match(menu({ nickname: "协管", me: me({ mod: true, steward: true, manageTodo: 4 }) }), /协管 · UID[\s\S]*href="#\/community\/manage"><span>管理台<\/span><span class="community-menu-badge">4<\/span>/);
  assert.match(menu({ nickname: "林间", me: me({ unread: { all: 120, reply: 0, thanks: 0, system: 120 } }) }), /<b>99\+<\/b>/);
  assert.doesNotMatch(menu({ nickname: "林间", me: me() }), /<b>\d/, "no count when all is read");
});

test("community home shows honest empty and loading states", () => {
  const html = communityHomeHTML({ summary: summary(), list: listing([]), sort: "active", members: false, ...common });
  assert.match(html, /data-community="home"/);
  assert.match(html, /<h1>社区<\/h1>/);
  assert.match(html, /class="community-empty"><div class="community-empty-mark" aria-hidden="true"><i-star><\/i-star><\/div><h3>这里还没有帖子<\/h3>/, "the demo's empty state");
  for (const board of communityBoards) assert.match(html, new RegExp(`class="community-board-link" href="#/community/boards/${board.id}"`));
  assert.match(html, /href="#\/community\/boards\/vip"[^>]*>[\s\S]*?community-board-lock/, "non-members see the members board locked");
  assert.doesNotMatch(communityHomeHTML({ summary: summary(), list: listing([]), sort: "active", members: true, ...common }), /community-board-lock/);
  assert.match(html, /data-action="community-sort" data-sort="active" aria-pressed="true"/);
  const todo = communityHomeHTML({ summary: summary(), list: listing([]), sort: "active", members: false, me: ready(me({ checkedIn: false, streak: 6, nextReward: { total: 1, bonus: 0 } })), ...common });
  assert.match(todo, /今天还没签到 · 签到后连签 7 天 <b>\+1<\/b>/);
  const bar = html.slice(html.indexOf('class="community-sort'), html.indexOf('class="community-results"'));
  assert.match(bar, /class="community-sort-actions"><form class="community-search" role="search" data-community-form="search">[\s\S]*name="q"[^>]*maxlength="40" value=""/, "search sits right of the sort tabs");
  assert.match(bar, /<a class="community-post" href="#\/community\/new">/, "and so does 发帖");
  const pending = communityHomeHTML({ summary: { state: "loading" }, list: { state: "loading" }, sort: "active", members: false, t, esc, now });
  assert.match(pending, /正在读取/);
  assert.match(pending, /<dt>主题<\/dt><dd>—<\/dd><\/div><div><dt>24 小时回复<\/dt><dd>—<\/dd>/, "no made-up totals while loading");
});

test("topic rows follow the demo: avatars, level and VIP marks, decorations, flags, latest replier and replies", () => {
  const items = [
    topic("b", { title: "第二个", lastActivityAt: "2026-09-30T10:00:00Z", author: owner, pinned: true, lastReply: { author: person("远山"), at: "2026-09-30T11:30:00Z" } }),
    topic("a", { title: "<img src=x onerror=alert(1)>", author: person("<b>x</b>", { uid: null }), board: "showcase", replies: 3, featured: true }),
  ];
  const html = communityHomeHTML({
    summary: summary({ total: 25, repliesToday: 4, boards: { qa: stats(24), showcase: stats(1) }, hot: [items[1]] }),
    list: listing(items, 25), sort: "active", members: false, ...common,
  });
  assert.doesNotMatch(html, /<img src=x|<b>x<\/b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const rows = html.slice(html.indexOf('class="community-topics"'));
  assert.ok(rows.indexOf("第二个") < rows.indexOf("&lt;img"), "the server's order is kept");
  assert.match(rows, /<article class="community-topic is-pinned"[^>]*><a class="community-av community-av-md is-owner" href="#\/community\/u\/owner" tabindex="-1" aria-hidden="true"><span style="--h:\d+">無<\/span><\/a>/, "an initial avatar; the owner's is gold");
  assert.match(rows, /<span class="community-av community-av-md" aria-hidden="true"><span style="--h:\d+">&lt;<\/span><\/span>/, "a deleted account has no page");
  assert.match(rows, /<span class="community-flag"><i-pin><\/i-pin>置顶<\/span>/);
  assert.match(rows, /<span class="community-flag is-featured"><i-award><\/i-award>精华<\/span>/);
  assert.match(rows, /class="community-topic-board"[^>]*href="#\/community\/boards\/qa">学习问答<\/a>/);
  assert.match(rows, /<span class="community-who"><a class="community-uname" href="#\/community\/u\/owner">無相<\/a><span class="community-role">站长<\/span><\/span>/);
  assert.match(rows, /<span class="community-uname">&lt;b&gt;x&lt;\/b&gt;<\/span><span class="community-level-marks"><span class="community-level-badge is-trust" role="img" aria-label="权限等级：L1 巡天" title="权限等级：L1 巡天">/);
  assert.equal(textAt(rows, 'time[datetime="2026-09-30T11:30:00Z"]'), '远山 30 分钟前回复', 'the latest replier');
  assert.match(rows, /<time datetime="2026-09-29T08:00:00Z">1 天前<\/time>/, "otherwise when it was posted");
  assert.match(rows, /class="community-topic-replies" href="#\/post\/a" tabindex="-1" aria-label="3 条回复，0 个赞"><small>0 赞<\/small><span><i-reply><\/i-reply>3<\/span>/);
  assert.match(html, /<dd>25<\/dd><\/div><div><dt>24 小时回复<\/dt><dd>4<\/dd>/);
  assert.match(html, /--w:100%"><i aria-hidden="true"><\/i><span>学习问答<\/span><span class="community-board-count">24</, "the busiest board has the full bar");
  assert.match(html, /data-action="community-more"[^>]*>加载更多 · 还有 23 个/);
  assert.match(communityTopicsHTML(items, { ...common, ownerAvatar: "/media/me.webp" }), /is-owner" href="#\/community\/u\/owner"[^>]*><img src="\/media\/me\.webp" alt=""/, "the owner's posts use the site avatar");
  // Approved avatars, frames, name colours, levels, VIP; odd decoration names are ignored.
  const fancy = communityTopicsHTML([topic("f", { author: person("星野", { avatar: "/api/community/avatar/u2.webp?v=ab", frame: "gold", color: "aurora", vip: true, level: 3 }), glow: true })], common);
  assert.match(fancy, /<article class="community-topic is-glow"/);
  assert.match(fancy, /<a class="community-av community-av-md is-frame-gold" href="#\/community\/u\/u2" tabindex="-1" aria-hidden="true"><img src="\/api\/community\/avatar\/u2\.webp\?v=ab" alt=""/);
  assert.match(fancy, /<a class="community-uname is-color-aurora" href="#\/community\/u\/u2">星野<\/a><span class="community-level-marks"><span class="community-level-badge is-trust" role="img" aria-label="权限等级：L3 守夜"[^]*data-level-icon="trust-l3"[^]*<span class="community-level-badge is-vip" role="img" aria-label="VIP 会员"[^]*data-level-icon="vip-1"/);
  assert.doesNotMatch(communityTopicsHTML([topic("x", { author: person("甲", { frame: "gold onload=x", color: "Red" }) })], common), /is-frame|is-color/);
  assert.match(communityTopicsHTML([topic("s", { author: person("协", { steward: true }) })], common), /<span class="community-lv is-steward" title="协管"><span class="community-steward-icon" aria-hidden="true">⬟<\/span>协管<\/span>/);
  // A moment has no title: the row shows its text.
  const moment = communityTopicsHTML([topic("m", { board: "moments", title: "今天终于…", excerpt: "今天终于把工作流跑通了，\n开心" })], common);
  assert.match(moment, /<a class="community-topic-moment" href="#\/post\/m">今天终于把工作流跑通了，\n开心<\/a>/);
  assert.doesNotMatch(moment, /<h3>/);
  const flagged = communityTopicsHTML([
    topic("q", { bounty: 50, bountyState: "open", locked: true, pending: true }),
    topic("r", { board: "tools", hidden: true, resource: { url: "https://x.example", kind: "软件", price: "免费", platform: "", alive: 1, dead: 3 } }),
    topic("p", { bounty: 50, bountyState: "paid", solved: true }),
  ], common);
  assert.match(flagged, /<article class="community-topic is-muted"[\s\S]*<span class="community-flag is-warn">审核中<\/span>[\s\S]*<span class="community-flag is-open">待解答<\/span><span class="community-flag is-bounty"><i-star><\/i-star>悬赏 50<\/span><span class="community-flag is-locked"><i-lock><\/i-lock>已锁定<\/span>/);
  assert.match(flagged, /<span class="community-flag is-danger">已隐藏<\/span>[\s\S]*<span class="community-flag is-warn">可能失效<\/span>/);
  assert.doesNotMatch(flagged.slice(flagged.indexOf('href="#/post/p"') - 400), /悬赏 50/, "a paid bounty is not advertised");
  const rows2 = communityTopicsHTML([topic("s", { board: "showcase", tags: ["Midjourney", "提示词", "效率"], thumbs: ["i1", "i2"], likes: 4 })], common);
  assert.match(rows2, /class="community-topic-thumbs"[^>]*><img src="\/api\/community\/images\/i1\.thumb\.webp"[^>]*><img src="\/api\/community\/images\/i2\.thumb\.webp"/);
  assert.equal(count(rows2, /class="community-tag"/g), 2, "two tags at most in a row");
  assert.match(rows2, /<small>4 赞<\/small>/);
});

test('discussion previews use escaped API excerpts and do not duplicate untitled moments', () => {
  const dom = new JSDOM(communityTopicsHTML([
    topic('work', { board: 'showcase', excerpt: '记录光影、构图和 <script> 的尝试。' }),
    topic('moment', { board: 'moments', hasTitle: false, title: '随想', excerpt: '今晚的星空很安静。' }),
    topic('titled-moment', { board: 'moments', hasTitle: true, excerpt: '一次小练习。' }),
    topic('empty'),
  ], common));
  try {
    const rows = dom.window.document.querySelectorAll('.community-topic');
    assert.equal(rows[0].querySelector('.community-topic-excerpt')?.textContent, '记录光影、构图和 <script 的尝试。');
    assert.equal(rows[0].querySelector('script'), null);
    assert.equal(rows[1].querySelector('.community-topic-excerpt'), null, 'the moment already uses its excerpt as the heading');
    assert.equal(rows[2].querySelector('.community-topic-excerpt')?.textContent, '一次小练习。');
    assert.equal(rows[3].querySelector('.community-topic-excerpt'), null, 'do not invent a preview when the API supplies none');
  } finally { dom.window.close(); }
});

test("topic rows expose escaped creation metadata without changing their latest-reply time", () => {
  const latest = { author: person("远山"), at: "2026-09-30T11:00:00Z" };
  const html = communityTopicsHTML([topic("dates", { createdAt: "2026-09-28T08:00:00Z", lastReply: latest })], common);
  assert.match(html, /<article[^>]*data-created-at="2026-09-28T08:00:00Z"/);
  assert.equal(textAt(html, 'time[datetime="2026-09-30T11:00:00Z"]'), '远山 1 小时前回复');
  const escaped = communityTopicsHTML([topic("escaped", { createdAt: 'bad" data-unsafe="value', lastReply: latest })], common);
  assert.match(escaped, /data-created-at="bad&quot; data-unsafe=&quot;value"/);
  assert.doesNotMatch(escaped, / data-unsafe="value"/);
});

test("post text: paragraphs, bold, code, links, quotes, lists and @mentions, always escaped", () => {
  const md = (text, mentions) => communityBodyHTML(text, esc, mentions);
  assert.equal(md("第一段<script>\n同段换行\n\n\n第二段"), "<p>第一段&lt;script&gt;<br>同段换行</p><p>第二段</p>");
  assert.equal(md("  \n\n"), "");
  assert.equal(md("**粗** 和 `code<>`"), "<p><strong>粗</strong> 和 <code>code&lt;&gt;</code></p>");
  const link = (href) => `href="${href}" target="_blank" rel="noopener noreferrer nofollow ugc"`;
  assert.equal(md("看 [文档](https://example.com/a?b=1&c=2) 和 https://example.org/x。"),
    `<p>看 <a ${link("https://example.com/a?b=1&amp;c=2")}>文档</a> 和 <a ${link("https://example.org/x")}>https://example.org/x</a>。</p>`);
  assert.equal(md("（见 https://example.com/a）"), `<p>（见 <a ${link("https://example.com/a")}>https://example.com/a</a>）</p>`);
  assert.equal(md("(see https://example.com/a)."), `<p>(see <a ${link("https://example.com/a")}>https://example.com/a</a>).</p>`, "trailing punctuation stays outside");
  assert.equal(md("[点我](javascript:alert(1)) <a href=x>"), "<p>[点我](javascript:alert(1)) &lt;a href=x&gt;</p>", "only http and https become links");
  assert.equal(md("> 引用一\n> 引用二\n- 甲\n- 乙\n```\nconst a = 1 < 2;\n\n**不加粗**\n```"),
    "<blockquote>引用一<br>引用二</blockquote><ul><li>甲</li><li>乙</li></ul><pre><code>const a = 1 &lt; 2;\n\n**不加粗**</code></pre>");
  assert.equal(md("请教 @远山 和 @路人", { 远山: "u2" }), '<p>请教 <a class="community-mention" href="#/community/u/u2">@远山</a> 和 @路人</p>', "only members found become links");
  assert.equal(plainText("**粗** [链接](https://x) `c`\n> 引用"), "粗 链接 c 引用");
});

test("load failures explain themselves: sign in, not open, missing, forbidden, or retry", () => {
  const page = (status, message = "") => communityHomeHTML({ summary: summary(), list: { state: "error", status, message }, sort: "active", members: false, t, esc, now });
  assert.match(page(401), /data-content-state="auth"[\s\S]*href="#\/account"/);
  assert.match(page(503), /社区尚未开放/);
  assert.match(page(403, "<不行>"), /data-content-state="forbidden"[\s\S]*&lt;不行&gt;/);
  assert.match(page(500, "<坏了>"), /&lt;坏了&gt;[\s\S]*data-action="community-retry"/);
  const missing = communityPostHTML({ thread: { state: "error", status: 404, message: "帖子不存在，或已被删除。" }, t, esc, now });
  assert.match(missing, /data-community="post"[\s\S]*data-content-state="missing"[\s\S]*帖子不存在/);
});

test("board cards and a board page follow the demo", () => {
  const boards = communityBoardsHTML({ summary: summary({ total: 3, boards: { qa: stats(3, 2, { id: "q1", title: "<最新>", lastActivityAt: "2026-09-30T11:00:00Z" }) }, tags: { ComfyUI: 3 } }), members: false, ...common });
  assert.equal(count(boards, /class="community-board-card /g), 6);
  const qa = boards.slice(boards.indexOf('href="#/community/boards/qa"'), boards.indexOf('href="#/community/boards/showcase"'));
  assert.match(qa, /<span class="community-bc-icon"><i-help><\/i-help><\/span><div class="community-bc-name"><h2>学习问答<\/h2><span>Q&amp;A<\/span>/);
  assert.match(qa, /<dt>类型<\/dt><dd>问答帖<\/dd><\/div><div><dt>主题<\/dt><dd>3<\/dd><\/div><div><dt>24 小时回复<\/dt><dd>2<\/dd>/);
  assert.match(qa, /<span>最新<\/span><b>&lt;最新&gt;<\/b><time/);
  assert.match(boards, /is-locked" href="#\/community\/boards\/vip"/);
  assert.match(boards.slice(boards.indexOf('href="#/community/boards/vip"')), /community-bc-lock[\s\S]*<dd>—<\/dd>[\s\S]*开通 VIP 后可见/, "the members board is shown locked, without numbers");
  assert.match(boards, /class="community-tagcloud">[\s\S]*href="#\/community\/tag\/ComfyUI">ComfyUI<span class="community-tag-count">3<\/span>/);
  assert.match(communityBoardsHTML({ summary: { state: "error", status: 401, message: "" }, members: false, t, esc }), /data-content-state="auth"/);
  const board = communityBoardHTML({
    board: "tools", summary: summary({ boards: { tools: stats(1, 5) } }),
    list: listing([topic("x", { board: "tools" })], 1, { posters: [{ author: person("远山"), topics: 1 }] }),
    sort: "newest", members: false, ...common,
  });
  assert.match(board, /data-community="board" data-board="tools"/);
  assert.match(board, /class="community-board-hero community-rv"[\s\S]*<nav class="community-crumb"[^>]*><a href="#\/community\/boards">版块<\/a>/);
  assert.match(board, /<div class="eyebrow">TOOLS · 资源帖<\/div><h1>工具资源<\/h1>/);
  assert.match(board, /<dt>主题<\/dt><dd>1<\/dd><\/div><div><dt>24 小时回复<\/dt><dd>5<\/dd>/);
  assert.match(board, /发帖须知[\s\S]*只推荐你自己用过的/);
  assert.match(board, /本版活跃[\s\S]*<a class="community-uname" href="#\/community\/u\/u2">远山<\/a>[\s\S]*1 帖/);
  assert.match(board, /class="community-post" href="#\/community\/new\/tools"/, "posting from a board goes to that board");
  assert.doesNotMatch(board, /class="community-topic-board"/, "a board page does not repeat its own name on every row");
  const locked = communityBoardHTML({ board: "vip", summary: summary(), list: { state: "loading" }, sort: "active", members: false, t, esc, now });
  assert.match(locked, /data-content-state="members"/);
  assert.doesNotMatch(locked, /community-post|community-sort/);
  const tagPage = communityTagHTML({ tag: "ComfyUI", list: listing([topic("x")]), sort: "active", ...common });
  assert.match(tagPage, /data-community="tag" data-tag="ComfyUI"[\s\S]*<h1>#ComfyUI<\/h1>[\s\S]*community-sort/);
  assert.match(communityBookmarksHTML({ list: listing([]), t, esc, icons: ui }), /<h1>我的收藏<\/h1>[\s\S]*还没有收藏/);
  const pill = (overrides) => communityHomeHTML({ summary: summary({ checkinsToday: 3 }), list: listing([]), sort: "active", members: false, ...common, me: ready(me(overrides)) });
  assert.match(pill({}), /<dt>今日签到<\/dt><dd>3<\/dd>[\s\S]*community-ck-pill is-todo[\s\S]*签到后连签 7 天 <b>\+1<\/b>[\s\S]*data-action="community-checkin"/);
  assert.match(pill({ checkedIn: true, streak: 7, nextReward: { total: 1, bonus: 0 } }), /<a class="community-ck-pill is-done" href="#\/community\/checkin">[\s\S]*已连续签到 <b>7<\/b> 天 · 明天 \+1/);
});

test("the compose form changes with the board and mirrors the server's rules", () => {
  const compose = (options) => communityComposeHTML({ members: false, t, esc, icons: ui, ...options });
  const blank = compose({ board: "" });
  assert.equal(count(blank, /name="board"/g), 5, "non-members cannot pick the members board");
  assert.match(blank, /<input type="radio" id="community-board-qa" name="board" value="qa" required>/);
  assert.match(blank, /name="title"[^>]*minlength="4" maxlength="60"/);
  assert.match(blank, /name="body"[^>]*minlength="10" maxlength="10000"/);
  assert.match(blank, /<a class="community-button" href="#\/community\/home">取消/);
  assert.match(compose({ board: "", members: true }), /value="vip"/);
  const qa = compose({ board: "qa", me: me({ balance: 42 }) });
  assert.match(qa, /value="qa" required checked/);
  assert.equal(count(qa, /name="bounty"/g), 4);
  assert.match(qa, /悬赏 <em class="is-optional">可选<\/em> <span class="community-muted">你有 42 星尘<\/span>/);
  assert.match(qa, /<button type="submit" class="community-button is-gold">发布/);
  assert.doesNotMatch(qa, /name="agree"|name="announce"/);
  const newcomer = compose({ board: "qa", me: me({ level: 0 }) });
  assert.match(newcomer, /<label class="is-disabled"><input type="radio" name="bounty" value="20" disabled aria-disabled="true" title="升到巡天后可用"><span>20 星尘（升到巡天后可用）<\/span>/);
  assert.match(newcomer, /升到巡天后可用/);
  assert.match(newcomer, /最多 1 张/, "one image at first light");
  assert.match(newcomer, /初光每天最多发 2 个主题/);
  const moment = compose({ board: "moments" });
  assert.doesNotMatch(moment, /name="title"/, "a moment has no title");
  assert.match(moment, /name="body"[^>]*minlength="2" maxlength="300"/);
  const show = compose({ board: "showcase" });
  assert.match(show, /图片 <em>至少 1 张<\/em> <span class="community-muted">最多 9 张/);
  assert.match(show, /id="community-tools" name="tools"[^>]*required/);
  assert.match(show, /name="body"[^>]*minlength="0" maxlength="10000" placeholder/, "the text of a work is optional");
  assert.equal(count(show, /name="promptMode"/g), 3);
  assert.match(show, /name="promptMode" value="public" checked/);
  assert.match(show, /data-price-row hidden>[\s\S]*<input type="number" id="community-prompt-price" name="promptPrice" min="5" max="50" step="1" value="10"[^>]*disabled/);
  const tools = compose({ board: "tools" });
  assert.match(tools, /id="community-url" name="url" type="url"[^>]*required/);
  assert.match(tools, /<select id="community-kind" name="kind" class="community-select"><option selected>软件<\/option>/);
  assert.doesNotMatch(tools, /data-community-upload|添加图片/, "resources have no images");
  assert.match(compose({ board: "meta", me: me({ owner: true }) }), /name="announce"/);
  assert.match(compose({ board: "meta", me: me() }), /公告只有站长能发/);
  const unsigned = compose({ board: "qa", me: me({ agreed: false }) });
  assert.match(unsigned, /href="#\/community\/rules"/);
  assert.doesNotMatch(unsigned, /name="agree"/, 'agreement requires the timed convention dialog');
  const uploads = [{ id: "i1", name: "a.png", state: "ready" }, { name: "b.png", state: "uploading" }, { name: "c.png", state: "error", message: "图片无法读取" }];
  const images = compose({ board: "moments", uploads });
  assert.match(images, /最多 4 张/, "随想 allows four");
  assert.match(images, /<img src="\/api\/community\/images\/i1\.thumb\.webp" alt="a\.png"><button type="button" data-action="community-image-remove" data-index="0"/);
  assert.match(images, /is-uploading"><span>上传中…/);
  assert.match(images, /is-error"><span>图片无法读取<\/span><button type="button" data-action="community-image-remove" data-index="2"/);
  assert.match(images, /<input type="file" class="sr-only" accept="image\/jpeg,image\/png,image\/webp" multiple data-community-upload>/);
  assert.doesNotMatch(compose({ board: "moments", uploads: Array(4).fill(uploads[0]) }), /data-community-upload/, "no picker once full");
  assert.match(compose({ board: "" }), /data-compose-preview>[\s\S]*class="community-compose-empty">先选一个版块<\/div>/, "an empty board preview explains the next step");
  const editing = editingFrom(ready({ topic: { ...topic("t1", { board: "showcase", title: "<旧标题>", tags: ["新手"] }), body: "旧正文", canDelete: true,
    meta: { tools: "MJ", model: "v7", usage: "可商用", promptMode: "paid", price: 20, prompt: "a cat", preview: null, unlocked: false, unlocks: 0 } }, replies: [], author: person("林间"), related: [] }));
  const edit = compose({ board: "showcase", editing });
  assert.match(edit, /data-community="edit"[\s\S]*data-community-form="topic" data-edit="t1"/);
  assert.equal(count(edit, /name="board"/g), 1, "the board stays");
  assert.match(edit, /name="title"[^>]*value="&lt;旧标题&gt;"/);
  assert.match(edit, /<textarea id="community-body"[^>]*>旧正文<\/textarea>/);
  assert.match(edit, /value="新手" checked/);
  assert.match(edit, /id="community-tools" name="tools"[^>]*value="MJ"/);
  assert.match(edit, /<option selected>可商用<\/option>/);
  assert.match(edit, /name="promptMode" value="paid" checked/);
  assert.match(edit, /data-price-row><label/, "a paid prompt shows its price");
  assert.match(edit, /name="promptPrice"[^>]*value="20"/);
  assert.match(edit, /<textarea id="community-prompt"[^>]*>a cat<\/textarea>/);
  assert.match(edit, /href="#\/post\/t1">取消[\s\S]*>保存修改</);
  assert.doesNotMatch(edit, /name="bounty"/, "a bounty is set when posting only");
});

const thread = (overrides = {}) => {
  const data = {
    topic: { ...topic("t1", { title: "<问题>", author: person("远山"), replies: 3, likes: 3, views: 12, tags: ["新手"], solved: true, bounty: 50, bountyState: "paid" }), body: "第一段<script>\n同段换行\n\n\n第二段",
      canDelete: false, canEdit: false, liked: true, bookmarked: false, bookmarks: 2, thanked: false, mine: false, images: [], canReply: true },
    replies: [
      { id: "r2", author: person("林间"), body: "回复二", createdAt: "2026-09-30T11:30:00Z", byTopicAuthor: false, accepted: true, canDelete: true, canEdit: true, mine: true, likes: 1 },
      { id: "r1", author: owner, body: "回复一 @远山", createdAt: "2026-09-30T11:00:00Z", byTopicAuthor: false, canDelete: false, canAccept: false, edited: true, likes: 5 },
      { id: "r3", author: person("远山"), body: "楼主补充", createdAt: "2026-09-30T11:45:00Z", byTopicAuthor: true, canDelete: false, likes: 9, quote: { id: "r1", author: "無相", excerpt: "回复一 @远山" } },
    ],
    author: { ...person("远山"), topics: 4, replies: 9, likes: 7, accepted: 2, featured: 0, badges: ["first_topic", "nice"], bio: "<喜欢画画>", following: false },
    related: [topic("t2", { title: "<相关>", replies: 5 })],
    mentions: { 远山: "u2" }, viewer: { level: 1, muted: null },
  };
  return ready({ ...data, ...overrides, topic: { ...data.topic, ...overrides.topic } });
};

test("a post follows the demo: crumb, author line, text, bounty, actions, replies, reply box, author card and related", () => {
  const html = communityPostHTML({ thread: thread(), me: me(), ...common });
  assert.match(html, /<nav class="community-crumb"[^>]*><a href="#\/community\/home">社区<\/a>[\s\S]*?<a href="#\/community\/boards\/qa">学习问答<\/a><\/nav>/);
  assert.match(html, /<h1 id="community-post-title">&lt;问题&gt;<\/h1>/);
  assert.match(html, /class="community-flag is-solved">[\s\S]*已解决/);
  assert.match(html, /class="community-post-by"><a class="community-av community-av-sm" href="#\/community\/u\/u2"[\s\S]*12 次浏览/);
  assert.match(html, /<p>第一段&lt;script&gt;<br>同段换行<\/p><p>第二段<\/p>/);
  assert.equal(textAt(html, '.community-bounty.is-solved > span'), '悬赏 50 星尘，已采纳 林间 的回答，星尘已发放。');
  assert.match(html, /class="community-post-tags"><a class="community-tag" data-tag-tone="guide" href="#\/community\/tag\/%E6%96%B0%E6%89%8B">新手<\/a>/);
  const bar = html.slice(html.indexOf('class="community-actbar"'), html.indexOf('class="community-discussion"'));
  assert.match(bar, /data-action="community-like" data-kind="topic" data-id="t1" aria-pressed="true"[^>]*>[\s\S]*?<span>3<\/span>/, "likes start the bar");
  assert.match(bar, /data-action="community-bookmark" data-id="t1" aria-pressed="false">[\s\S]*?<small>2<\/small>/);
  assert.match(bar, /data-action="community-thank" data-kind="topic" data-id="t1">[\s\S]*?10 星尘/);
  assert.match(bar, /data-action="community-copy-link"/);
  assert.match(bar, /data-action="community-report" data-kind="topic" data-id="t1"/);
  assert.doesNotMatch(bar, /community-delete-topic|community-post-menu/, "nothing more for a reader on someone else's post");
  // The accepted answer first, then posting order; floors always follow posting order.
  assert.deepEqual([...html.matchAll(/id="reply-(r\d)"/g)].map((m) => m[1]), ["r2", "r1", "r3"]);
  assert.match(html, /<li class="community-reply is-accepted" id="reply-r2"[\s\S]*已采纳[\s\S]*#2[\s\S]*id="reply-r1"[\s\S]*community-av-sm is-owner[\s\S]*已编辑[\s\S]*#1[\s\S]*id="reply-r3"[\s\S]*楼主[\s\S]*#3/);
  const byLikes = communityPostHTML({ thread: thread(), me: me(), replySort: "likes", ...common });
  assert.deepEqual([...byLikes.matchAll(/id="reply-(r\d)"/g)].map((m) => m[1]), ["r2", "r3", "r1"], "the accepted answer stays first");
  assert.match(html, /data-action="community-reply-sort" data-sort="floor" aria-pressed="true">按楼层[\s\S]*data-sort="likes" aria-pressed="false">按赞数/);
  const mine = html.slice(html.indexOf('id="reply-r2"'), html.indexOf('id="reply-r1"'));
  assert.doesNotMatch(mine, /community-thank|community-report/, "no thanking or reporting yourself");
  assert.match(mine, /data-action="community-delete-reply" data-id="r2"><i-trash><\/i-trash><span>删除<\/span>/, "your own reply: two clicks, no moderation panel");
  assert.match(mine, /data-action="community-edit-reply" data-id="r2"/);
  const theirs = html.slice(html.indexOf('id="reply-r1"'), html.indexOf('id="reply-r3"'));
  assert.match(theirs, /data-action="community-thank" data-kind="reply" data-id="r1"/);
  assert.match(theirs, /data-action="community-quote" data-id="r1"/);
  assert.match(theirs, /回复一 <a class="community-mention" href="#\/community\/u\/u2">@远山<\/a>/);
  assert.doesNotMatch(theirs, /community-delete-reply/);
  assert.match(html, /<blockquote class="community-quote"><b>無相：<\/b>回复一 @远山<\/blockquote>/);
  assert.match(html, /3 条回复/);
  assert.equal(textAt(html, '.community-rf-head > span:last-child'), '以 林间 的身份回复');
  assert.match(html, /data-community-form="reply" data-topic="t1"[\s\S]*<textarea id="community-reply" name="body" rows="1" minlength="2" maxlength="2000" required/);
  assert.match(html, /data-action="community-md" data-md="bold" data-for="community-reply"[\s\S]*data-action="community-md-preview" data-for="community-reply" aria-pressed="false">预览/);
  assert.match(html, /<p class="community-muted">&lt;喜欢画画&gt;<\/p>/);
  assert.match(html, /<dt>主题<\/dt><dd>4<\/dd><\/div><div><dt>获赞<\/dt><dd>7<\/dd><\/div><div><dt>被采纳<\/dt><dd>2<\/dd>/, "the author card");
  assert.equal(count(html.slice(html.indexOf("community-author-card")), /class="community-badge is-/g), 2);
  assert.match(html, /<a class="community-button is-small" href="#\/community\/u\/u2">主页<\/a><button type="button" class="community-button is-small is-line-gold" data-action="community-follow" data-uid="u2" aria-pressed="false">关注<\/button>/);
  assert.match(html, /同版块[\s\S]*<a href="#\/post\/t2">&lt;相关&gt;<\/a><span>5 回复<\/span>/);
  assert.doesNotMatch(communityPostHTML({ thread: thread(), ...common }), /community-rf-head/, "no identity line before the member is known");
  const open = communityPostHTML({ thread: thread(), me: me(), reporting: { kind: "reply", id: "r1" }, editingReply: "r2", quoting: "r1", ...common });
  assert.match(open.slice(open.indexOf('id="reply-r1"')), /data-community-form="report" data-kind="reply" data-id="r1"[\s\S]*value="垃圾广告 \/ 引流"/, "the report form opens under its reply");
  assert.match(open, /data-community-form="reply-edit" data-id="r2"[\s\S]*<textarea id="community-reply-edit"[^>]*>回复二<\/textarea>/);
  assert.equal(textAt(open, '.community-quoting > span'), '回复 無相：回复一 @远山…');
  assert.match(open, /data-action="community-unquote"/);
});

test("post states: review, hidden content, locked and muted, prompts, resources and bounties", () => {
  const post = (overrides, options = {}) => communityPostHTML({ thread: thread(overrides), me: me(), ...common, ...options });
  assert.match(post({ topic: { pending: true, pendingReason: "初光等级，帖子带外链" } }), /community-notice is-warn[\s\S]*这个帖子正在等站长审核[\s\S]*初光等级，帖子带外链[\s\S]*审核通过后才能回复/);
  assert.match(post({ topic: { hidden: true, hiddenReason: "举报：其他" } }), /community-notice is-danger[\s\S]*这个帖子已被隐藏[\s\S]*举报：其他/);
  assert.match(post({ topic: { locked: true } }), /这个帖子已锁定[\s\S]*不能再回复了/);
  assert.doesNotMatch(post({ topic: { locked: true } }), /data-community-form="reply"|data-action="community-quote"/, "no replying or quoting in a locked post");
  assert.match(post({ viewer: { level: 1, muted: { until: "2026-10-07T04:00:00Z", reason: "<人身攻击>" } } }), /你被禁言到 2026-10-07 12:00[\s\S]*原因：&lt;人身攻击&gt;/);
  const hidden = post({ replies: [{ id: "h1", author: person("远山"), body: "", createdAt: "2026-09-30T11:00:00Z", hidden: true, byTopicAuthor: false, canDelete: false }] });
  assert.match(hidden, /<li class="community-reply is-gone" id="reply-h1"><span class="community-floor">#1<\/span><p>这条回复被举报，暂时隐藏，等站长复核。<\/p><\/li>/);
  const restorable = post({ replies: [{ id: "h1", author: person("远山"), body: "广告", createdAt: "2026-09-30T11:00:00Z", hidden: true, byTopicAuthor: false, canDelete: true, canRestore: true }] });
  assert.match(restorable, /community-reply is-hidden[\s\S]*community-flag is-danger">已隐藏[\s\S]*data-action="community-restore" data-kind="reply" data-id="h1"/);
  assert.match(restorable, /data-action="community-delete-reply" data-id="h1" data-panel="true"/, "a moderator removing someone else's reply gets the panel");
  // Bounties.
  assert.match(post({ topic: { solved: false, bountyState: "open", bounty: 20 }, replies: [] }), /class="community-bounty"><i-star><\/i-star><span>悬赏 <b>20<\/b> 星尘：采纳后悬赏发给回答者；符合条件另得 3 星尘，每天最多 1 次。7 天没人采纳退回一半。/);
  assert.match(post({ topic: { solved: false, bountyState: "refunded", bounty: 20 }, replies: [] }), /悬赏 20 星尘 7 天没人采纳，已退回一半。/);
  assert.match(post({ topic: { solved: false, bounty: 0, bountyState: null }, replies: [] }), /community-bounty is-plain[\s\S]*符合条件得 3 星尘，每天最多 1 次/);
  // Resources: the link, the facts and the votes.
  const tool = post({ topic: { board: "tools", solved: false, resource: { url: "https://example.com/app?x=1&y=2", kind: "网站", price: "免费", platform: "", alive: 1, dead: 3, myVote: "dead" } } });
  assert.match(tool, /<a class="community-res-link" href="https:\/\/example\.com\/app\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer nofollow ugc">[\s\S]*<b>example\.com<\/b>/);
  assert.match(tool, /<dt>类型<\/dt><dd>网站<\/dd><\/div><div><dt>价格<\/dt><dd>免费<\/dd><\/div><div><dt>平台<\/dt><dd>—<\/dd>/);
  assert.match(tool, /class="community-vote is-alive" data-action="community-vote" data-value="alive" data-id="t1" aria-pressed="false">[\s\S]*<b>1<\/b>[\s\S]*class="community-vote is-dead is-on" data-action="community-vote" data-value="dead" data-id="t1" aria-pressed="true">[\s\S]*<b>3<\/b>/);
  assert.match(tool, /反馈“已失效”的人比较多/);
  assert.doesNotMatch(tool, /community-bounty/, "only questions have the bounty line");
  // Prompts: shown, locked with a masked preview, or not shared.
  const meta = { tools: "Midjourney", model: "", usage: "个人使用", promptMode: "paid", price: 20, prompt: null, preview: "x xxx", unlocked: false, unlocks: 3 };
  const locked = post({ topic: { board: "showcase", solved: false, meta } });
  assert.match(locked, /作品信息[\s\S]*<dt>工具<\/dt><dd>Midjourney<\/dd><dt>模型<\/dt><dd>—<\/dd><dt>用途<\/dt><dd>个人使用<\/dd>/);
  assert.match(locked, /community-prompt is-locked[\s\S]*20 星尘[\s\S]*<pre aria-hidden="true">x xxx<\/pre>[\s\S]*作者得 16，其余销毁。已有 3 人解锁。[\s\S]*data-action="community-unlock" data-id="t1"[\s\S]*用 20 星尘解锁/);
  const shown = post({ topic: { board: "showcase", solved: false, mine: true, meta: { ...meta, prompt: "a <cat>", preview: null } } });
  assert.match(shown, /<pre data-prompt>a &lt;cat&gt;<\/pre><p class="community-muted">你设了 20 星尘解锁，已有 3 人解锁。<\/p>/);
  assert.match(shown, /data-action="community-copy-prompt"/);
  assert.match(post({ topic: { board: "showcase", solved: false, meta: { ...meta, promptMode: "hidden", preview: null } } }), /community-prompt is-hidden[\s\S]*作者没有公开提示词。/);
  const images = [{ id: "a", width: 800, height: 600 }, { id: "b", width: 800, height: 600 }];
  assert.match(post({ topic: { board: "showcase", images } }), /community-gallery is-show[\s\S]*class="community-g-main" data-action="community-lightbox" data-src="\/api\/community\/images\/a\.webp"[\s\S]*src="\/api\/community\/images\/a\.webp"[\s\S]*community-g-count[\s\S]*community-g-strip[\s\S]*src="\/api\/community\/images\/b\.thumb\.webp"/);
  const moment = post({ topic: { board: "moments", title: "今天…", solved: false } });
  assert.match(moment, /<h1 id="community-post-title" class="sr-only">今天…<\/h1>/);
  assert.match(moment, /class="community-text is-moment"/);
});

test("the post menu: the author's edit, paid pin and glow; moderation for owners and stewards; the moderation panels", () => {
  const authorView = communityPostHTML({ thread: thread({ topic: { board: "showcase", solved: false, mine: true, canEdit: true, canDelete: true, canPaidPin: true, canHighlight: true } }), me: me({ inventory: { makeup: 0, pin: 1, highlight: 0 } }), ...common });
  assert.match(authorView, /data-action="community-post-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="community-post-menu"/);
  assert.match(authorView, /id="community-post-menu" role="menu" hidden>/);
  assert.match(authorView, /<a role="menuitem" href="#\/community\/edit\/t1"><span>编辑<\/span><\/a>/);
  assert.match(authorView, /data-action="community-paid-pin" data-id="t1"><i-pin><\/i-pin><span>推荐 24 小时 · 用推荐卡（剩 1 张）<\/span>/);
  assert.match(authorView, /data-action="community-highlight" data-id="t1"><span>标题发光 3 天 · 需要高亮卡<\/span>/);
  assert.match(authorView, /data-action="community-delete-topic" data-id="t1"><i-trash>/, "your own post: two clicks");
  assert.doesNotMatch(authorView, /data-action="community-thank" data-kind="topic"|community-pin"|community-lock/);
  assert.match(communityPostHTML({ thread: thread({ topic: { mine: true, canPaidPin: true } }), me: me(), ...common }), /推荐 24 小时 · 200 星尘/);
  const modThread = thread({ topic: { canModerate: true, canFeature: true, canRetag: true, canDelete: true, pinned: true, hidden: true, hiddenReason: "举报" } });
  const mod = communityPostHTML({ thread: modThread, me: me({ mod: true }), menuOpen: true, ...common });
  assert.match(mod, /aria-expanded="true" aria-controls="community-post-menu"[\s\S]*id="community-post-menu" role="menu">/);
  for (const action of ["pin", "feature", "lock", "move", "restore", "retag"]) assert.match(mod, new RegExp(`data-action="community-${action}"`), action);
  assert.match(mod, /data-action="community-pin" data-id="t1" aria-pressed="true"><i-pin><\/i-pin><span>取消置顶<\/span>/);
  assert.match(mod, /data-action="community-feature" data-id="t1" aria-pressed="false"><i-award><\/i-award><span>评为精华<\/span>/);
  assert.match(mod, /data-action="community-lock" data-id="t1" aria-pressed="false"><i-lock><\/i-lock><span>锁定，禁止回复<\/span>/);
  assert.match(mod, /data-action="community-delete-topic" data-id="t1" data-panel="true"/, "removing someone else's post opens the panel");
  assert.doesNotMatch(mod, /community-approve/, "only pending posts are approved");
  const steward = communityPostHTML({ thread: thread({ topic: { canModerate: true, pending: true } }), me: me(), ...common });
  assert.match(steward, /data-action="community-approve" data-id="t1"/);
  assert.doesNotMatch(steward, /community-feature/, "精华 is the owner's");
  const panels = communityPostHTML({ thread: modThread, me: me({ mod: true }), deleting: { kind: "topic", id: "t1" }, moving: true, retagging: true, ...common });
  assert.match(panels, /data-community-form="delete" data-kind="topic" data-id="t1"[\s\S]*name="violation" checked[\s\S]*按违规处理：收回它带来的星尘，再扣 20[\s\S]*name="mute" value="0" checked[\s\S]*value="7"[\s\S]*确认删除/);
  assert.match(panels, /data-community-form="move" data-id="t1"[\s\S]*<select id="community-move-board" name="board" class="community-select">/);
  assert.equal(count(panels.slice(panels.indexOf("community-move-board")), /<option value=/g), 5, "every other board");
  assert.match(panels, /data-community-form="retag" data-id="t1"[\s\S]*value="新手" checked/);
});

test('scoped moderators can move only between their assigned boards and keep their earned trust input limits', () => {
  const moderator = me({ owner: false, mod: true, steward: true, level: 4, trustLevel: 0, moderationBoards: ['qa', 'tools'] });
  const data = thread({ topic: { board: 'qa', canModerate: true } });
  const dom = new JSDOM(communityPostHTML({ ...common, thread: data, me: moderator, moving: true }));
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-community-form="move"] option')].map(option => option.value), ['tools']);
  assert.match(dom.window.document.querySelector('.community-rf-bar').textContent, /初光：每天最多/);
  assert.equal(dom.window.document.querySelector('.community-reply-form [data-inline-editor]').dataset.imageMax, '1');
  assert.equal(dom.window.document.querySelector('.community-actbar [data-action="community-report"]')?.disabled, false);
  dom.window.close();
  const oneBoard = communityPostHTML({ ...common, thread: data, me: { ...moderator, moderationBoards: ['qa'] }, moving: true });
  assert.doesNotMatch(oneBoard, /data-action="community-move"|data-community-form="move"/);
  const compose = communityComposeHTML({ ...common, me: moderator, board: 'qa' });
  assert.match(compose, /每帖最多 1 张图、2 个链接/);
  assert.match(compose, /name="bounty" value="20" disabled/);
});

test("the check-in page: constellation, calendar with make-up days, early birds and badges", () => {
  const data = {
    checkedIn: false, streak: 6, balance: 42, gainedToday: 0, behaviourToday: 0, vip: false, month: "2026-09",
    days: ["2026-09-24", "2026-09-25"], checkinsToday: 2,
    earlyBirds: [{ person: person("林间"), at: "2026-09-29T16:05:00Z" }],
    makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: ["2026-09-28"] }, badges: ["first_checkin"],
  };
  const html = communityCheckinHTML({ checkin: ready(data), ...common });
  assert.doesNotMatch(html, /data-action="community-checkin"/, "the right rail owns the check-in action");
  assert.match(html, /每日签到 \+1 星尘，自然月满勤额外 \+5。补签计入满勤/);
  assert.equal(count(html, /class="community-cs[ "]/g), 30);
  assert.equal(count(html, /class="community-cs is-on/g), 2, 'only actual September records light stars');
  assert.match(html, /class="community-cs is-now is-bonus is-big"/);
  const labelSample = communityCheckinHTML({ checkin: ready({ ...data, streak: 9 }), ...common });
  assert.equal(count(labelSample, /class="community-star-current"/g), 1, "today status stays outside the star positions");
  assert.doesNotMatch(labelSample, /class="community-cs-day"/, "day labels no longer collide inside the chart");
  assert.match(labelSample, /class="community-star-milestones"/);
  assert.match(html, /aria-label="30 天签到星座，已点亮 2 颗"/);
  assert.match(html, /<h2>2026 年 9 月<\/h2>/);
  assert.match(html, /class="community-cal-day is-ok">24</);
  assert.match(html, /<button type="button" class="community-cal-day is-makeup" data-action="community-makeup" data-day="2026-09-28" aria-label="补签 2026-09-28">28<\/button>/);
  assert.match(html, /class="community-cal-day is-miss is-today" aria-current="date">30</);
  assert.match(html, /每次 30 星尘，本月还剩 2 次/);
  assert.match(html, /data-month="2026-10"[^>]*disabled/, "no future months");
  assert.match(html, /今日早鸟[\s\S]*林间[\s\S]*00:05/);
  assert.equal(count(html, /class="community-badge is-/g), 6);
  assert.match(html, /class="community-badge is-bronze is-md" title="第一次签到/);
  assert.match(html, /class="community-badge is-bronze is-md is-off" title="连签 7 天/);
  assert.doesNotMatch(html, /community-table/, "the ledger lives in 我的星尘");
  const noLeft = communityCheckinHTML({ checkin: ready({ ...data, makeup: { ...data.makeup, left: 0 } }), ...common });
  assert.doesNotMatch(noLeft, /is-makeup/);
  assert.match(noLeft, /这个月的补签次数用完了/);
  assert.match(communityCheckinHTML({ checkin: ready({ ...data, makeup: { ...data.makeup, cards: 2 } }), ...common }), /先用补签卡（剩 2 张）/);
  const done = communityCheckinHTML({ checkin: ready({ ...data, checkedIn: true, streak: 7 }), ...common });
  assert.doesNotMatch(done, /data-action="community-checkin"|今日已签到 · 明天/);
  assert.match(done, /每日签到 \+1 星尘，自然月满勤额外 \+5/);
});

const stardust = (overrides = {}) => ({
  balance: 42, gainedToday: 5, behaviourToday: 5, dailyCap: 6, checkedIn: false, month: { gained: 60, spent: 18 }, flow: "all",
  ledger: [
    { id: "l1", amount: 5, kind: "earn", reason: "topic", createdAt: "2026-09-30T02:00:00Z", reverted: false, topic: { id: "t1", title: "<一个主题>" } },
    { id: "l2", amount: -10, kind: "out", reason: "thank-out", createdAt: "2026-09-30T03:00:00Z", reverted: true, topic: null },
    { id: "l3", amount: -30, kind: "spend", reason: "makeup", createdAt: "2026-09-30T04:00:00Z", reverted: false, topic: null, detail: "2026-09-28" },
    { id: "l4", amount: -80, kind: "spend", reason: "shop", createdAt: "2026-09-30T05:00:00Z", reverted: false, topic: null, detail: "<金环头像框>" },
  ],
  level: 1, owner: false, steward: false, stats: {},
  progress: { next: 2, clean: true, rows: [
    { key: "visitDays", label: "累计访问天数", labelEn: "Days visited", need: 15, have: 9 },
    { key: "likesRecv", label: "收到的赞", labelEn: "Likes received", need: 10, have: 12 },
    { key: "distinctReplies", label: "回复过的不同主题", labelEn: "Topics replied to", need: 10, have: 5 },
  ] },
  ...overrides,
});

test("the 星尘 center: the ledger, levels and the rules", () => {
  const ledger = communityStardustHTML({ stardust: ready(stardust()), tab: "ledger", ...common });
  assert.match(ledger, /data-community="stardust" data-tab="ledger"/);
  assert.match(ledger, /<p>今天获得 <b>5<\/b> 星尘，行为星尘 <b>5 \/ 6<\/b>。今天还没签到。<\/p>/);
  assert.match(ledger, /<dt>余额<\/dt><dd>42<\/dd>[\s\S]*href="#\/community\/checkin"/);
  assert.match(ledger, /<a href="#\/community\/stardust" aria-current="page">明细<\/a><a href="#\/community\/stardust\/levels">等级<\/a><a href="#\/community\/stardust\/rules">规则<\/a><a class="community-tab-go" href="#\/community\/shop">/);
  assert.match(ledger, /<dt>本月收入<\/dt><dd class="is-plus">\+60<\/dd><\/div><div><dt>本月支出<\/dt><dd class="is-minus">−18<\/dd>/);
  assert.match(ledger, /data-action="community-flow" data-flow="all" aria-pressed="true"/);
  assert.match(ledger, /发主题 · <a class="community-ledger-title" title="&lt;一个主题&gt;" href="#\/post\/t1">&lt;一个主题&gt;<\/a>[\s\S]*\+5/);
  assert.match(ledger, /<tr class="is-reverted">[\s\S]*感谢他人[\s\S]*（已收回）[\s\S]*−10/);
  assert.match(ledger, /补签 · 2026-09-28[\s\S]*is-right is-mono is-minus">−30/);
  assert.match(ledger, /兑换 · &lt;金环头像框&gt;[\s\S]*−80/);
  const levels = communityStardustHTML({ stardust: ready(stardust()), tab: "levels", ...common });
  assert.match(levels, /data-level-explorer data-mode="growth"/);
  assert.equal(count(levels, /data-action="community-level-step"/g), 2);
  assert.equal(count(levels, /data-level-detail/g), 1);
  assert.doesNotMatch(levels, /community-ladder|community-rung|community-lv-rings/);
  const trust = (entry = stardust(), level = 2) => communityStardustHTML({ stardust: ready(entry), tab: "levels", levelSelection: { mode: "trust", growth: null, trust: level }, ...common });
  assert.doesNotMatch(trust(), /累计访问天数|升级条件|9 \/ 15/);
  assert.match(trust(), /权限与限制/);
  assert.match(trust(), /版主由作者任命[\s\S]*VIP 不改变信任等级或管理权/);
  assert.equal(count(trust(), /role="tab" /g), 0);
  assert.doesNotMatch(trust(stardust(), 3), /收到的赞|精华 ≥|被采纳 ≥|180 天内没有处罚/);
  assert.doesNotMatch(trust(stardust({ progress: { ...stardust().progress, clean: false } })), /30 天内没有违规|未满足/);
  assert.match(trust(stardust({ owner: true, level: 4, progress: null })), /拥有全部管理权限/);
  const rules = communityStardustHTML({ stardust: ready(stardust({ checkedIn: true })), tab: "rules", ...common });
  assert.match(rules, /怎么挣[\s\S]*签到[\s\S]*\+1[\s\S]*自然月满勤额外 \+5，补签计入满勤[\s\S]*每人每天最多 6/);
  assert.match(rules, /怎么花[\s\S]*作者得 8，销毁 2/);
  assert.doesNotMatch(rules, /今天还没签到/);
});

const shopItems = [
  { id: "frame-gold", cat: "look", kind: "frame", ref: "gold", name: "金环头像框", desc: "一圈细金边。", price: 80, builtin: true, active: true, state: { owned: true, left: null, ok: false, code: "owned", why: "已拥有" } },
  { id: "frame-orbit", cat: "look", kind: "frame", ref: "orbit", name: "轨道头像框", desc: "外圈有一颗小星。", price: 150, builtin: true, active: true, state: { owned: false, left: null, ok: false, code: "short", why: "还差 50 星尘" } },
  { id: "card-makeup", cat: "card", kind: "card", ref: "makeup", name: "补签卡", desc: "补签一天。", price: 30, limit: { per: "month", n: 2 }, builtin: true, active: true, state: { owned: false, left: null, ok: true, code: "ok", why: "" } },
  { id: "pack", cat: "digital", kind: "digital", name: "<手册>", desc: "提示词手册", price: 20, builtin: false, stock: null, left: null, active: true, state: { owned: true, left: null, ok: false, code: "owned", why: "已拥有" } },
  { id: "bag", cat: "goods", kind: "goods", name: "帆布袋", desc: "一个帆布袋", price: 20, builtin: false, stock: 10, left: 3, minLevel: 1, minDays: 30, note: "包邮", active: true, state: { owned: false, left: 3, ok: true, code: "ok", why: "" } },
];
const shop = { balance: 100, level: 1, owner: false, inventory: { makeup: 1, pin: 0, highlight: 0 }, decorations: { frame: "gold", color: null, cover: null }, items: shopItems };

test("the exchange: categories, what each item looks like, what you can do with it, and the redeem panel", () => {
  const html = communityShopHTML({ shop: ready(shop), tab: "all", me: me(), ...common });
  assert.match(html, /data-community="shop" data-tab="all"/);
  assert.match(html, /<dt>我的星尘<\/dt><dd>100<\/dd>[\s\S]*href="#\/community\/shop\/mine"/);
  assert.match(html, /<a href="#\/community\/shop" aria-current="page">全部<\/a><a href="#\/community\/shop\/look">装扮<span class="community-seg-n">2<\/span><\/a><a href="#\/community\/shop\/card">道具卡<span class="community-seg-n">1<\/span>/);
  assert.deepEqual([...html.matchAll(/<div class="community-sec-h[^>]*><h2>([^<]+)<\/h2>/g)].map((m) => m[1]), ["装扮", "道具卡", "数字资源", "实物周边"]);
  const card = (id) => html.slice(html.indexOf(`data-id="${id}"`) - 2000, html.indexOf(`data-id="${id}"`) + 200);
  assert.match(html, /<span class="community-av community-av-xl community-shop-avatar is-frame-gold" aria-hidden="true"><span>無<\/span><\/span>/, "a frame preview uses the accepted 無 glyph");
  assert.match(html, /data-action="community-equip" data-kind="frame" data-ref="">[\s\S]*?使用中/, "the frame you wear");
  assert.match(html, /<button type="button" class="community-button is-small" disabled>还差 50 星尘<\/button>/);
  assert.match(card("card-makeup"), /<span>每月限 2 次<\/span>[\s\S]*data-action="community-redeem" data-id="card-makeup"/);
  assert.match(html, /<span class="community-have">背包里有 1 张<\/span>/);
  assert.match(html, /<h3>&lt;手册&gt;<\/h3>[\s\S]*data-action="community-delivery" data-id="pack"/);
  assert.match(html, /<span>巡天以上<\/span><span>注册满 30 天<\/span><span>包邮<\/span>[\s\S]*剩 3 \/ 10[\s\S]*width:30%/);
  assert.match(html, /community-owned-tag/);
  const goods = communityShopHTML({ shop: ready(shop), tab: "goods", ...common });
  assert.equal(count(goods, /class="community-sitem /g), 1);
  assert.match(goods, /<a href="#\/community\/shop\/goods" aria-current="page">/);
  const redeem = communityShopHTML({ shop: ready(shop), tab: "all", redeeming: "bag", ...common });
  assert.match(redeem, /data-community-form="redeem" data-id="bag"[\s\S]*兑换「帆布袋」[\s\S]*花 20 星尘，兑换后剩 80。/);
  assert.match(redeem, /作者取消待发货订单时退还星尘/);
  assert.doesNotMatch(redeem, /兑换后不能退回|cannot be refunded/);
  assert.match(redeem, /id="community-ship-name" name="name"[\s\S]*id="community-ship-phone" name="phone" type="tel"[\s\S]*id="community-ship-address" name="address"[\s\S]*收货信息只给站长看，发货或取消后就会删除/);
  const card2 = communityShopHTML({ shop: ready(shop), tab: "all", redeeming: "card-makeup", ...common });
  assert.match(card2, /data-community-form="redeem" data-id="card-makeup"/);
  assert.doesNotMatch(card2, /兑换后不能退回|cannot be refunded/);
  assert.doesNotMatch(card2, /name="address"/, "only goods need an address");
  const framePanel = communityShopHTML({ shop: ready(shop), tab: "look", redeeming: "frame-orbit", ...common });
  assert.match(framePanel, /data-community-form="redeem"[\s\S]*is-frame-orbit" aria-hidden="true"><span>無<\/span>/, "confirmation uses the same frame preview");
  const delivery = communityShopHTML({ shop: ready(shop), tab: "all", delivery: { id: "pack", name: "<手册>", delivery: "链接：https://x.example 提取码 <ab>" }, ...common });
  assert.match(delivery, /community-delivery[\s\S]*&lt;手册&gt;[\s\S]*<pre class="community-delivery-text" data-delivery>链接：https:\/\/x\.example 提取码 &lt;ab&gt;<\/pre>[\s\S]*data-action="community-copy-delivery"/);
  assert.match(communityShopHTML({ shop: ready({ ...shop, items: [] }), tab: "digital", ...common }), /这里还没有东西/);
  const mine = communityShopMineHTML({ mine: ready({ balance: 100, inventory: { makeup: 1, pin: 0, highlight: 2 }, decorations: shop.decorations, looks: [shopItems[0]],
    digital: [{ id: "pack", name: "<手册>", desc: "提示词手册" }],
    orders: [{ id: "o1", item: "bag", itemName: "帆布袋", price: 20, status: "pending", createdAt: "2026-09-30T04:00:00Z", resolvedAt: null }, { id: "o2", item: "card-makeup", itemName: "补签卡", price: 30, status: "done", createdAt: "2026-09-29T04:00:00Z", resolvedAt: null }] }), me: me(), ...common });
  assert.match(mine, /data-community="shop" data-tab="mine"[\s\S]*<h1>我的兑换<\/h1>/);
  assert.match(mine, /补签卡<\/b><span class="community-inv-n">× 1<\/span><\/div><a class="community-button is-small is-line-gold" href="#\/community\/checkin">去签到日历用/);
  assert.match(mine, /community-inv community-spot is-empty">[\s\S]*推荐卡[\s\S]*× 0[\s\S]*href="#\/community\/shop\/card">去兑换/);
  assert.match(mine, /data-action="community-equip" data-kind="frame" data-ref=""/);
  assert.match(mine, /community-shop-avatar is-frame-gold" aria-hidden="true"><span>無<\/span>/, "owned frames share the accepted preview glyph");
  assert.doesNotMatch(mine, /community-price/, "owned looks do not repeat a price");
  assert.match(mine, /&lt;手册&gt;[\s\S]*data-action="community-delivery" data-id="pack"/);
  assert.match(mine, /帆布袋[\s\S]*−20<\/span><span class="community-o-st is-wait">待发货[\s\S]*补签卡[\s\S]*is-ok">已到账/);
});

test("the ranking: this month's contributions, streaks and early birds", () => {
  const html = communityRankHTML({ rank: ready({
    contributions: [{ person: person("远山"), score: 12, likes: 7, accepted: 1, featured: 0 }, { person: person("林间"), score: 6, likes: 6, accepted: 0, featured: 0 }],
    streaks: [{ person: person("林间"), streak: 7 }], early: [],
  }), me: me(), ...common });
  assert.equal(textAt(html, '.community-banner-lead b'), '远山');
  assert.match(html, /本月贡献[\s\S]*style="--w:100%;--i:0"[\s\S]*远山[\s\S]*<span class="community-rank-count">12<\/span>[\s\S]*<li class="is-me" style="--w:50%;--i:1">/);
  assert.match(html, /连签榜[\s\S]*7 天/);
  assert.match(html, /今日早鸟[\s\S]*还没有人/);
});

const memberPage = (overrides = {}) => ({
  person: person("远山", { level: 2, vip: true, color: "gold", showUid: true }), bio: "<喜欢>", joinedAt: "2026-09-20T12:00:00Z", cover: "aurora", streak: 4,
  stats: { topics: 3, replies: 5, likes: 12, accepted: 1, featured: 0 }, follows: { followers: 2, following: 1 }, following: false, self: false,
  badges: ["first_topic"], muted: null, canMute: true, canAppoint: true, steward: false, tab: "topics",
  topics: [topic("x", { author: person("远山") })], replies: [], bookmarks: [], counts: { topics: 3, replies: 5, bookmarks: 0 }, quick: null, ...overrides,
});

test('the profile background covers identity and biography while statistics stay outside it', () => {
  const html = communityMemberHTML({ member: ready(memberPage()), me: me(), ...common });
  const dom = new JSDOM(html);
  try {
    const intro = dom.window.document.querySelector('.community-m-intro');
    assert.ok(intro, 'the cover and identity have one shared area');
    assert.ok(intro.querySelector('.community-m-cover[aria-hidden="true"]'));
    assert.ok(intro.querySelector('.community-m-id .community-av'));
    assert.equal(intro.querySelector('.community-m-name p').textContent, '<喜欢>');
    assert.ok(intro.nextElementSibling.matches('.community-m-stats'), 'stats remain a separate row below the cover');
  } finally { dom.window.close(); }
});

test("member pages: the hero, follows, moderation, quick links for yourself, and the tabs", () => {
  const html = communityMemberHTML({ member: ready(memberPage()), me: me({ mod: true }), ...common });
  assert.match(html, /data-community="member" data-tab="topics"/);
  assert.match(html, /<div class="community-m-cover is-cover-aurora" aria-hidden="true">/);
  assert.equal(textAt(html, 'h1 .community-uname.is-color-gold'), '远山');
  assert.match(html, /<div class="community-m-name"><span class="community-level-marks is-large"><span class="community-level-badge is-trust" role="img" aria-label="权限等级：L2 观测"[^]*data-level-icon="vip-1"[^]*<\/span><h1>[^]*<\/h1><div class="community-m-tags"><span class="community-muted is-mono">UID u2<\/span>/, 'the profile shows large level icons above the name instead of text tags');
  assert.doesNotMatch(html, /<h1>(?:(?!<\/h1>)[^])*community-level-marks/, 'the name line itself carries no icons on the profile');
  assert.match(html, /<p>&lt;喜欢&gt;<\/p><p class="community-muted">加入 10 天 · 连签 4 天<\/p>/);
  assert.match(html, /data-action="community-follow" data-uid="u2" aria-pressed="false">关注/);
  assert.match(html, /data-action="community-mute" data-uid="u2"/);
  assert.match(html, /href="#\/community\/manage\/stewards">[\s\S]*选择版主负责板块/);
  assert.doesNotMatch(html, /data-action="community-steward"[^>]*data-on="true"/);
  assert.match(html, /<dt>收到的赞<\/dt><dd>12<\/dd>[\s\S]*<dt>关注者<\/dt><dd>2<\/dd>/);
  assert.match(html, /<a href="#\/community\/u\/u2" aria-current="page">主题 3<\/a><a href="#\/community\/u\/u2\/replies">回复 5<\/a><a href="#\/community\/u\/u2\/badges">徽章 1<\/a><\/nav>/, "no bookmarks tab on someone else's page");
  assert.match(html, /class="community-topics"/);
  assert.doesNotMatch(html, /community-me-quick|编辑资料/);
  assert.match(communityMemberHTML({ member: ready(memberPage({ following: true })), me: me(), ...common }), /class="community-button is-small" data-action="community-follow" data-uid="u2" aria-pressed="true">已关注/);
  assert.doesNotMatch(communityMemberHTML({ member: ready(memberPage({ canMute: false, canAppoint: false })), me: me(), ...common }), /community-mute"|community-steward/);
  const muting = communityMemberHTML({ member: ready(memberPage()), me: me({ mod: true }), muting: true, ...common });
  assert.match(muting, /data-community-form="mute" data-uid="u2"[\s\S]*name="days" value="1" checked[\s\S]*value="30"[\s\S]*value="人身攻击"[\s\S]*确认禁言/);
  const muted = communityMemberHTML({ member: ready(memberPage({ muted: { id: "s1", until: "2026-10-01T04:00:00Z", reason: "人身攻击" } })), me: me({ mod: true }), ...common });
  assert.match(muted, /禁言到 2026-10-01 12:00[\s\S]*原因：人身攻击[\s\S]*data-action="community-lift" data-id="s1"/);
  assert.doesNotMatch(muted, /data-action="community-mute"/, "no second mute while muted");
  const self = communityMemberHTML({ member: ready(memberPage({ person: person("林间"), self: true, canMute: false, canAppoint: false, tab: "bookmarks", counts: { topics: 1, replies: 0, bookmarks: 0 }, quick: { balance: 42, checkedIn: false, unread: 3, orders: 1 } })), me: me(), ...common });
  assert.match(self, /href="#\/account" data-reader-return>[\s\S]*编辑资料/);
  assert.match(self, /class="community-me-quick[\s\S]*我的星尘<\/span><b>42<\/b>[\s\S]*还没签到[\s\S]*3 未读[\s\S]*巡天[\s\S]*1 件/);
  assert.match(self, /<a href="#\/community\/u\/u1\/bookmarks" aria-current="page">收藏 0<\/a>/);
  assert.match(self, /还没有收藏/);
  assert.doesNotMatch(self, /community-follow/, "no following yourself");
  const badges = communityMemberHTML({ member: ready(memberPage({ tab: "badges" })), me: me(), ...common });
  assert.equal(count(badges, /class="community-bw-item/g), 12);
  assert.match(badges, /class="community-bw-item"><span class="community-badge is-bronze is-lg"[\s\S]*<b>第一帖<\/b>/);
  const replies = communityMemberHTML({ member: ready(memberPage({ tab: "replies", replies: [{ id: "r1", topicId: "t1", topicTitle: "<主题>", board: "qa", body: "**好**", createdAt: "2026-09-30T11:00:00Z", likes: 2 }] })), me: me(), ...common });
  assert.match(replies, /<a class="community-rep-ref" href="#\/post\/t1">&lt;主题&gt;<\/a><div class="community-text is-small"><p><strong>好<\/strong><\/p><\/div><span class="community-muted">1 小时前 · 2 赞<\/span>/);
  assert.match(communityMemberHTML({ member: { state: "error", status: 404, message: "找不到这个成员。" }, ...common }), /data-content-state="missing"[\s\S]*找不到这个成员/);
});

test("notifications read naturally in both languages and lead to what they are about", () => {
  const notice = (type, data = {}, extra = {}) => ({ id: `n-${type}`, type, actor: person("远山"), topicId: "t1", replyId: null, text: "<原文>", data, link: null, count: 1, createdAt: "2026-09-30T11:00:00Z", read: false, topicTitle: "<主题>", ...extra });
  const text = (item) => noticeTextHTML(item, { t, esc });
  const en = (item) => noticeTextHTML(item, { t: (_zh, english) => english, esc });
  assert.equal(text(notice("reply", { kind: "quote" })), "回复了你");
  assert.equal(text(notice("reply", { kind: "topic" })), "回复了你的主题");
  assert.equal(en(notice("reply", { kind: "topic" })), "replied to your topic");
  assert.equal(text(notice("mention", { where: "reply" })), "在回复里提到了你");
  assert.equal(text(notice("like", { what: "reply" }, { count: 3 })), "等 3 人赞了你的回复");
  assert.equal(en(notice("like", { what: "topic" }, { count: 3 })), "and 2 others liked your topic");
  assert.equal(text(notice("accept", { amount: 65 })), "采纳了你的回答，+65 星尘");
  assert.equal(text(notice("level", { level: 2 })), "你升到了「观测」");
  assert.equal(en(notice("level", { level: 2 })), "You reached OBSERVER");
  assert.equal(text(notice("badge", { badge: "nice" })), "获得徽章「不错」");
  assert.equal(text(notice("review", { state: "rejected", title: "<主题>", reason: "广告引流", note: "<补充>" })), "你的帖子《&lt;主题&gt;》没有通过审核。理由：广告引流；补充：&lt;补充&gt;。有异议可以在站务反馈发帖。");
  assert.equal(text(notice("penalty", { days: 7, reason: "<人身攻击>" })), "你被禁言 7 天：&lt;人身攻击&gt;");
  assert.equal(text(notice("penalty", { what: "reply", penalty: 20 })), "你的一条回复因违规被删除，扣 20 星尘");
  assert.equal(text(notice("system", { moved: "tools" })), "你的帖子被移到了「工具资源」");
  assert.equal(en(notice("system", { moved: "tools" })), "Your post was moved to Tools");
  assert.equal(text(notice("system", { order: "shipped", item: "<帆布袋>" })), "你兑换的「&lt;帆布袋&gt;」已发货");
  assert.equal(text(notice("system", { refund: 10 })), "悬赏退回一半：+10 星尘");
  assert.equal(text(notice("system", { steward: true })), "你被任命为协管");
  assert.equal(text(notice('system', { steward: true, scopeChanged: true, boards: ['qa', 'tools'] })), '你的负责板块已调整：学习问答、工具资源');
  assert.equal(text(notice("system", { report: "new", hidden: true })), "提交了一条举报，内容已自动隐藏");
  assert.equal(text(notice("mystery")), "&lt;原文&gt;", "anything else shows its stored text");
  assert.equal(noticeHref(notice("reply"), null), "#/post/t1");
  assert.equal(noticeHref(notice("system", { order: "new" }, { topicId: null, link: "#/community/manage/orders" }), null), "#/community/manage/orders");
  assert.equal(noticeHref(notice("system", {}, { topicId: null, link: "https://evil.example" }), null), "", "only links inside the community");
  assert.equal(noticeHref(notice("follow", {}, { topicId: null }), null), "#/community/u/u2");
  assert.equal(noticeHref(notice("level", {}, { topicId: null }), null), "#/community/stardust/levels");
  assert.equal(noticeHref(notice("badge", {}, { topicId: null, actor: null }), me()), "#/community/u/u1/badges");
  assert.equal(noticeHref(notice("system", { order: "shipped" }, { topicId: null }), null), "#/community/shop/mine");
  const html = communityInboxHTML({ inbox: ready({ tab: "all", unread: { all: 2, reply: 1, thanks: 0, system: 1 }, items: [notice("reply", { kind: "topic" }), notice("follow", {}, { topicId: null, read: true, topicTitle: null })] }), tab: "all", me: me(), ...common });
  assert.match(html, /data-community="inbox" data-tab="all"[\s\S]*<h1>通知<\/h1>[\s\S]*data-action="community-read-all"/);
  assert.match(html, /<a href="#\/community\/inbox" aria-current="page">全部<b class="community-tab-n">2<\/b><\/a><a href="#\/community\/inbox\/reply">回复和 @<b class="community-tab-n">1<\/b><\/a><a href="#\/community\/inbox\/thanks">采纳和感谢<\/a>/);
  assert.match(html, /<button type="button" class="community-note is-unread" data-action="community-notice" data-id="n-reply" data-href="#\/post\/t1">[\s\S]*<span class="community-note-ref">&lt;主题&gt;<\/span>[\s\S]*community-udot/);
  assert.equal(textAt(html, '[data-id="n-reply"] .community-note-t'), '远山 回复了你的主题');
  assert.match(html, /class="community-note" data-action="community-notice" data-id="n-follow" data-href="#\/community\/u\/u2">/);
  const quiet = communityInboxHTML({ inbox: ready({ tab: "system", unread: { all: 0, reply: 0, thanks: 0, system: 0 }, items: [] }), tab: "system", ...common });
  assert.doesNotMatch(quiet, /community-read-all/);
  assert.match(quiet, /<a href="#\/community\/inbox\/system" aria-current="page">系统<\/a>[\s\S]*这里很安静/);
});

test("the guidelines cover six policy sections without a shortcut around timed agreement", () => {
  const html = communityRulesHTML({ me: me({ agreed: false }), ...common });
  assert.match(html, /data-community="rules"[\s\S]*<h1>社区公约<\/h1>/);
  assert.equal(count(html, /class="community-rule-section"/g), 6);
  assert.match(html, /交流与内容[\s\S]*板块与发布[\s\S]*星尘与成长[\s\S]*兑换与装扮[\s\S]*账号与数据[\s\S]*管理、处理与申诉/);
  assert.match(html, /违规删除[\s\S]*另扣 20[\s\S]*自行删除[\s\S]*联系作者或负责该板块的版主/);
  assert.doesNotMatch(html, /data-action="community-agree"/);
  assert.match(communityRulesHTML({ me: me(), ...common }), /你已同意当前版本公约/);
  assert.match(html, /重新阅读至少 10 秒并同意新版本/);
});

const manage = (overrides = {}) => ({
  tab: "queue", owner: true, counts: { queue: 3, reports: 1, orders: 1, sanctions: 1 }, kpis: { topics24h: 4, replies24h: 9 },
  queue: {
    topics: [
      { ...topic("p1", { title: "<待审>", pending: true, author: person("新人", { level: 0 }) }), body: "**链接** https://a.example", pendingReason: "初光等级，帖子带外链", hiddenReason: null },
      { ...topic("h1", { title: "被隐藏", hidden: true }), body: "内容", pendingReason: null, hiddenReason: "举报：其他" },
    ],
    replies: [{ id: "hr1", topicId: "t1", topicTitle: "某主题", author: person("远山"), body: "广告", createdAt: "2026-09-30T10:00:00Z", hiddenAt: "2026-09-30T11:00:00Z" }],
  },
  reports: [{ id: "p1", reason: "垃圾广告 / 引流", note: "<广告>", createdAt: "2026-09-30T11:00:00Z", reporter: person("林间", { level: 2 }),
    target: { kind: "reply", topicId: "t1", title: "主题", excerpt: "加我领取资料", author: person("远山"), gone: false, hidden: true } }],
  orders: [
    { id: "o1", member: person("林间"), item: "bag", itemName: "帆布袋", price: 20, status: "pending", createdAt: "2026-09-30T04:00:00Z", resolvedAt: null, shipping: { name: "林间", phone: "13800138000", address: "<某路 1 号>" } },
    { id: "o2", member: person("远山"), item: "bag", itemName: "帆布袋", price: 20, status: "shipped", createdAt: "2026-09-29T04:00:00Z", resolvedAt: "2026-09-29T08:00:00Z", shipping: null },
  ],
  items: [{ id: "bag", cat: "goods", kind: "goods", name: "帆布袋", desc: "一个帆布袋", price: 20, builtin: false, stock: 10, left: 3, limit: { per: "year", n: 1 }, minLevel: 1, minDays: 30, note: "包邮", active: true, delivery: "" }],
  sanctions: [{ id: "s1", member: person("远山"), days: 7, reason: "人身攻击", until: "2026-10-07T04:00:00Z", createdAt: "2026-09-30T04:00:00Z", active: true, state: 'active', liftedAt: null }],
  data: null, ...overrides,
});

test("moderation: the queue, reports, orders with shipping details, shop items, sanctions and data", () => {
  const queue = communityManageHTML({ manage: ready(manage()), tab: "queue", ...common });
  const queueDom = new JSDOM(queue);
  try {
    assert.deepEqual([...queueDom.window.document.querySelectorAll('.community-kpis > div')].map(card => [card.querySelector('dt').textContent, card.querySelector('dd').textContent]),
      [['待审', '3'], ['待处理举报', '1'], ['24 小时新主题', '4'], ['24 小时回复', '9']]);
    assert.equal(queueDom.window.document.querySelectorAll('.community-kpis dd.is-warn').length, 2);
    assert.deepEqual([...queueDom.window.document.querySelectorAll('.community-management-nav nav a')].map(link => link.getAttribute('href')),
      ["#/community/manage", "#/community/manage/content", "#/community/manage/banners", "#/community/manage/orders", "#/community/manage/items", "#/community/manage/stewards", "#/community/manage/sanctions", "#/community/manage/data", "#/community/manage/contact", "#/community/manage/convention"]);
  } finally { queueDom.window.close(); }
  assert.match(queue, /待审 · 初光等级，帖子带外链[\s\S]*&lt;待审&gt;[\s\S]*链接 https:\/\/a\.example[\s\S]*data-action="community-approve" data-id="p1"[\s\S]*data-action="community-reject" data-kind="topic" data-id="p1"/);
  assert.match(queue, /已自动隐藏 · 举报：其他[\s\S]*data-action="community-restore" data-kind="topic" data-id="h1"[\s\S]*data-kind="topic" data-id="h1" data-violation="true"/);
  assert.match(queue, /回复已自动隐藏[\s\S]*data-action="community-restore" data-kind="reply" data-id="hr1"[\s\S]*data-kind="reply" data-id="hr1" data-violation="true"/);
  const steward = communityManageHTML({ manage: ready(manage({ owner: false })), tab: "queue", ...common });
  assert.doesNotMatch(steward, /manage\/orders|manage\/items|manage\/stewards|manage\/convention/, "shop, appointments and convention editing are the owner's");
  const reports = communityManageHTML({ manage: ready(manage()), tab: "reports", ...common });
  assert.match(reports, /垃圾广告 \/ 引流 · 已自动隐藏[\s\S]*href="#\/post\/t1">回复：加我领取资料<\/a>/);
  assert.match(textAt(reports, '.community-queue-main .community-muted'), /作者 远山 · 举报人 林间（观测）/);
  assert.match(reports, /“&lt;广告&gt;”[\s\S]*data-action="community-uphold" data-id="p1"[\s\S]*data-action="community-dismiss" data-id="p1"/);
  const orders = communityManageHTML({ manage: ready(manage()), tab: "orders", ...common });
  assert.match(orders, /<b>林间<\/b> <span class="is-mono">13800138000<\/span><br>&lt;某路 1 号&gt;/);
  assert.match(orders, /data-action="community-ship" data-id="o1"[\s\S]*data-action="community-cancel-order" data-id="o1"/);
  assert.match(orders, /已发货[\s\S]*已删除|已删除[\s\S]*已发货/, "a shipped order no longer has an address");
  assert.doesNotMatch(orders, /data-id="o2"/);
  assert.match(communityManageHTML({ manage: ready(manage({ owner: false })), tab: "orders", ...common }), /没有这个分类/);
  const items = communityManageHTML({ manage: ready(manage()), tab: "items", ...common });
  assert.match(items, /data-action="community-item-edit" data-id=""[\s\S]*上架新物品[\s\S]*帆布袋[\s\S]*3 \/ 10[\s\S]*上架中[\s\S]*data-action="community-item-edit" data-id="bag"/);
  const creating = communityManageHTML({ manage: ready(manage()), tab: "items", itemEditing: { id: null }, ...common });
  assert.match(creating, /data-community-form="item" data-id=""[\s\S]*上架新物品[\s\S]*name="kind" value="goods" checked[\s\S]*name="kind" value="digital"/);
  const editing = communityManageHTML({ manage: ready(manage()), tab: "items", itemEditing: { id: "bag" }, ...common });
  assert.match(editing, /data-community-form="item" data-id="bag"[\s\S]*编辑「帆布袋」[\s\S]*<input type="hidden" name="cat" value="goods">/);
  assert.match(editing, /id="community-item-name" name="name" type="text" maxlength="30" required value="帆布袋"/);
  assert.match(editing, /<option value="year" selected>每年<\/option>/);
  assert.match(editing, /<option value="1" selected>L1 巡天<\/option>/);
  assert.match(editing, /name="active" checked/);
  const sanctions = communityManageHTML({ manage: ready(manage()), tab: "sanctions", ...common });
  assert.match(sanctions, /远山[\s\S]*禁言 7 天[\s\S]*人身攻击[\s\S]*2026-10-07 12:00[\s\S]*data-action="community-lift" data-id="s1"/);
  const days = Array.from({ length: 7 }, (_, i) => ({ day: `2026-09-${24 + i}`, issued: i * 10, recovered: 5 }));
  const data = communityManageHTML({ manage: ready(manage({ data: { flow: days, boards: [{ id: "qa", topics: 4 }, { id: "tools", topics: 2 }] } })), tab: "data", ...common });
  assert.equal(count(data, /class="community-bar-col"/g), 7);
  assert.match(data, /class="community-bar is-in" style="height:100%" title="发放 60"/);
  assert.match(data, /<span>学习问答<\/span><span class="community-hbar"><i style="width:100%;background:#9fb8e0"><\/i><\/span><span class="is-mono">4<\/span>/);
  assert.match(communityManageHTML({ manage: { state: "error", status: 403, message: "只有站长和协管能进入社区管理。" }, tab: "queue", ...common }), /data-content-state="forbidden"/);
  assert.match(communityManageHTML({ manage: ready(manage({ queue: { topics: [], replies: [] } })), tab: "queue", ...common }), /没有待处理的内容/);
});

test("the landing page from the main navigation leads into the community", () => {
  const html = communityLandingHTML(t, { message: "" });
  assert.match(html, /data-community="landing"/);
  assert.match(html, /<h1>無相社区<\/h1>/);
  assert.match(html, /<a class="community-enter" href="#\/community\/home">/);
  assert.doesNotMatch(html, /Demo|示例|未读/);
});

test("rules, reward table and Beijing day", () => {
  assert.equal(beijingDay(Date.parse("2026-09-30T15:59:00Z")), "2026-09-30");
  assert.equal(beijingDay(Date.parse("2026-09-30T16:00:00Z")), "2026-10-01", "midnight in Beijing");
  assert.deepEqual(checkinReward(), { base: 1, bonus: 0, total: 1 });
  assert.deepEqual(checkinReward(true), { base: 1, bonus: 5, total: 6 });
  assert.deepEqual(['2027-02', '2028-02', '2026-04', '2026-10'].map(month => checkinMonth(month, []).totalDays), [28, 29, 30, 31]);
  assert.deepEqual(checkinMonth('2026-04', ['2026-04-01', '2026-04-01', '2026-04-31', '2026-05-01']).signed, ['2026-04-01']);
  assert.equal(communityRules.thankCost - communityRules.thankToAuthor, 2, "thanking destroys 2");
  assert.equal(communityTags.length, 13);
});
