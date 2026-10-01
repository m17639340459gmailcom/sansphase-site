import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { migrateCommunity } from "../server/payload/community-migration.ts";
import { createCommunityStore } from "../server/community-store.ts";
import { createCommunityService, communityContactReason } from "../server/community-service.ts";
import { createPreviewServer } from "../server.mjs";
import { beijingDay } from "../src/community-rules.mjs";

// Signed-in members, by cookie `reader=<id>` or `owner=yes`. uid is the public id
// used by member pages; r1 has an approved avatar.
const avatarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const members = {
  r1: { name: "林间", uid: "u1", vip: false, avatar: avatarId, bio: "喜欢画画" },
  r2: { name: "远山", uid: "u2", vip: false },
  r3: { name: "新人", uid: "u3", vip: false },
  v1: { name: "墨白", uid: "u4", vip: true },
  s1: { name: "守望", uid: "u5", vip: false },
};
const authorOf = (uid) => uid === "owner" ? { kind: "owner", id: "owner" } : Object.entries(members).filter(([, m]) => m.uid === uid).map(([id]) => ({ kind: "reader", id }))[0] || null;
const cleanup = (directory) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

// One migrated database, copied for each test (see community-store.test.mjs).
let template;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), "sansphase-community-api-template-"));
  new DatabaseSync(resolve(template, "content.db")).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));

// r1, r2, v1 and s1 have agreed to the guidelines and reached 巡天 (L1); r3 is brand new.
async function setup(t, { store: withStore = true } = {}) {
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  const siteOrigin = `http://127.0.0.1:${port}`;
  const directory = await mkdtemp(resolve(tmpdir(), "sansphase-community-api-"));
  await copyFile(resolve(template, "content.db"), resolve(directory, "content.db"));
  await mkdir(resolve(directory, "uploads"));
  await writeFile(resolve(directory, "uploads", `reader-avatar-${avatarId}.webp`), "avatar-bytes");
  const sql = (statement, ...args) => {
    const db = new DatabaseSync(resolve(directory, "content.db"));
    try { db.exec("PRAGMA busy_timeout = 5000"); return db.prepare(statement).run(...args); } finally { db.close(); }
  };
  const setLevel = (id, level) => {
    sql("INSERT OR IGNORE INTO community_members (member_kind, member_id, created_at) VALUES ('reader', ?, ?)", id, new Date().toISOString());
    sql("UPDATE community_members SET level = ?, level_day = ?, agreed_at = COALESCE(agreed_at, ?) WHERE member_kind = 'reader' AND member_id = ?", level, beijingDay(Date.now()), new Date().toISOString(), id);
  };
  for (const id of ["r1", "r2", "v1", "s1"]) setLevel(id, 1);
  const store = withStore ? createCommunityStore(directory) : null;
  const audits = [];
  const communityService = createCommunityService({
    store, siteOrigin, directory, ownerId: "owner",
    identify: async (req) => {
      const [kind, id] = String(req.headers.cookie || "").split("=");
      if (kind === "owner" && id === "yes") return { kind: "owner", id: "owner", name: "無相", vip: true };
      return kind === "reader" && members[id] ? { kind: "reader", id, name: members[id].name, vip: members[id].vip } : null;
    },
    people: async (authors) => new Map(authors.flatMap((author) => {
      const info = author.kind === "owner" ? { name: "無相", uid: "owner", vip: true } : members[author.id];
      return info ? [[`${author.kind}:${author.id}`, { name: info.name, uid: info.uid, avatar: info.avatar || null, vip: info.vip, joinedAt: author.kind === "owner" ? null : "2026-01-01T00:00:00.000Z", bio: info.bio || "" }]] : [];
    })),
    findMember: async (uid) => authorOf(uid),
    findByNames: async (names) => new Map([...Object.entries(members).map(([id, m]) => [m.name, { kind: "reader", id }]), ["無相", { kind: "owner", id: "owner" }]].filter(([name]) => names.includes(name))),
    avatarFile: async (uid) => uid === "u1" ? resolve(directory, "uploads", `reader-avatar-${avatarId}.webp`) : null,
    audit: async (action, details) => { audits.push({ action, ...details }); },
  });
  const server = createPreviewServer({ contentService: { snapshot: async () => ({ data: { notes: [] } }) }, communityService });
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
  t.after(async () => {
    await new Promise((done) => server.close(done));
    store?.close();
    await cleanup(directory);
  });
  const get = (path, cookie = "reader=r1") => fetch(`${siteOrigin}/api/community/${path}`, { headers: { cookie } });
  const post = (path, body, cookie = "reader=r1", headers = {}) => fetch(`${siteOrigin}/api/community/${path}`, {
    method: "POST",
    headers: { Origin: siteOrigin, "X-Reader-Request": "1", "Content-Type": "application/json", cookie, ...headers },
    body: JSON.stringify(body),
  });
  const upload = (bytes, type = "image/png", cookie = "reader=r1") => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), "picture.png");
    return fetch(`${siteOrigin}/api/community/images`, { method: "POST", headers: { Origin: siteOrigin, "X-Reader-Request": "1", cookie }, body: form });
  };
  const credit = (id, amount) => store.ledger.credit(id === "owner" ? { kind: "owner", id } : { kind: "reader", id }, amount, "test", null, new Date().toISOString());
  return { get, post, upload, siteOrigin, store, audits, setLevel, credit };
}
const json = async (response) => (await response).json();
const png = async () => (await import("sharp")).default({ create: { width: 1200, height: 800, channels: 3, background: "#d9c49c" } }).png().toBuffer();
const topicBody = { board: "qa", title: "ComfyUI 人脸崩了", body: "IPAdapter 和 ControlNet 一起用就崩。" };

test("the community requires sign-in and a same-site request for every write", async (t) => {
  const { get, post, siteOrigin } = await setup(t);
  assert.equal((await get("summary", "")).status, 401);
  assert.equal((await post("topics", topicBody, "")).status, 401);
  const forged = await fetch(`${siteOrigin}/api/community/topics`, { method: "POST", headers: { Origin: "https://evil.example", "X-Reader-Request": "1", cookie: "reader=r1", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(forged.status, 403);
  assert.equal((await post("topics", topicBody, "reader=r1", { "X-Reader-Request": "" })).status, 403);
  assert.equal((await fetch(`${siteOrigin}/api/community/summary`, { method: "DELETE", headers: { cookie: "reader=r1" } })).status, 405);
});

test("readers post, list, read and reply; the owner can remove anything, readers only their own", async (t) => {
  const { get, post, audits } = await setup(t);
  const created = await post("topics", { board: "qa", title: "  ComfyUI 人脸崩了  ", body: "第一段：单独用没问题\r\n第二段：一起用就崩" });
  assert.equal(created.status, 201);
  const { id, earned, pending } = await created.json();
  assert.deepEqual([earned, pending], [5, false]);
  assert.equal((await post("topics", { board: "tools", title: "推荐一个工具", body: "这是一个很好用的工具。", url: "https://example.com/tool" }, "reader=r2")).status, 201);
  assert.equal((await post(`topics/${id}/replies`, { body: "试试降低强度" }, "reader=r2")).status, 201);

  const list = await json(get("topics?sort=active"));
  assert.equal(list.total, 2);
  assert.equal(list.items[0].id, id, "the replied topic is most recently active");
  assert.equal(list.items[0].title, "ComfyUI 人脸崩了", "titles are trimmed");
  assert.deepEqual(list.items[0].author, { name: "林间", role: "reader", uid: "u1", showUid: true, avatar: `/api/community/avatar/u1.webp?v=${avatarId.slice(0, 8)}`, vip: false, level: 1, steward: false, frame: null, color: null });
  assert.equal(list.items[0].replies, 1);
  assert.equal(list.items[0].lastReply.author.name, "远山", "a listed topic names its latest replier");
  assert.equal(list.items[1].lastReply, null);
  assert.equal(list.items[1].resource.url, "https://example.com/tool");
  assert.equal((await json(get("topics?board=tools"))).total, 1);
  assert.deepEqual((await json(get(`topics?q=${encodeURIComponent("人脸")}`))).items.map((x) => x.id), [id], "search");
  assert.equal((await get(`topics?q=${"字".repeat(41)}`)).status, 400, "search terms are bounded");
  assert.deepEqual((await json(get("topics?author=u2"))).items.map((x) => x.board), ["tools"], "a member's own topics");
  assert.equal((await get("topics?author=nobody")).status, 404);

  const summary = await json(get("summary"));
  assert.equal(summary.total, 2);
  assert.equal(summary.repliesToday, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(summary.boards).map(([board, stats]) => [board, [stats.topics, stats.repliesToday, stats.latest.title]])),
    { qa: [1, 1, "ComfyUI 人脸崩了"], tools: [1, 0, "推荐一个工具"] });
  const board = await json(get("topics?board=qa"));
  assert.deepEqual(board.posters.map((poster) => [poster.author.name, poster.topics]), [["林间", 1]], "a board lists its most active people");
  assert.equal((await json(get("topics"))).posters, undefined, "only a board page has them");

  const detail = await json(get(`topics/${id}`));
  assert.equal(detail.topic.body, "第一段：单独用没问题\n第二段：一起用就崩", "line endings are normalised");
  assert.deepEqual([detail.topic.canDelete, detail.topic.canEdit, detail.topic.canReply, detail.topic.replies], [true, true, true, 1]);
  assert.equal(detail.replies[0].author.name, "远山");
  assert.equal(detail.replies[0].canDelete, false, "a reader cannot delete someone else's reply");
  assert.equal(detail.replies[0].byTopicAuthor, false);
  assert.deepEqual([detail.author.name, detail.author.topics, detail.author.bio, detail.author.badges, detail.author.following], ["林间", 1, "喜欢画画", ["first_topic"], false]);
  assert.deepEqual(detail.related, [], "no other topics in this board yet");
  assert.deepEqual(detail.viewer, { level: 1, muted: null });
  const replyId = detail.replies[0].id;
  assert.equal((await post(`replies/${replyId}/delete`, {})).status, 403);
  assert.equal((await post(`topics/${id}/delete`, {}, "reader=r2")).status, 403);
  assert.equal((await post(`replies/${replyId}/delete`, {}, "reader=r2")).status, 200);
  assert.equal((await json(get(`topics/${id}`))).replies.length, 0);
  assert.equal((await post(`topics/${id}/delete`, {}, "owner=yes")).status, 200);
  assert.equal((await get(`topics/${id}`)).status, 404);
  assert.equal((await get("topics/not-a-topic")).status, 404);
  assert.deepEqual(audits.map((entry) => [entry.action, entry.moderated]), [["community-delete-topic", true]], "only moderation is audited");
  assert.equal((await json(get("inbox?tab=system"))).items[0].type, "penalty", "the author is told");
});

test("input is validated: boards, lengths, contact details, board fields and the members-only board", async (t) => {
  const { get, post } = await setup(t);
  const status = async (body, cookie) => (await post("topics", body, cookie)).status;
  assert.equal(await status({ board: "nope", title: "有效的标题", body: "足够长的正文内容" }), 400);
  assert.equal(await status({ board: "qa", title: "短", body: "足够长的正文内容" }), 400);
  assert.equal(await status({ board: "qa", title: "x".repeat(61), body: "足够长的正文内容" }), 400);
  assert.equal(await status({ board: "qa", title: "有效的标题", body: "太短" }), 400);
  assert.equal(await status({ board: "qa", title: "有效的标题", body: "x".repeat(10001) }), 400);
  assert.equal(await status({ board: "qa", title: "有效的\u0007标题", body: "足够长的正文内容" }), 400);
  const phone = await post("topics", { board: "qa", title: "有效的标题", body: "有问题打 138 0013 8000 找我" });
  assert.equal(phone.status, 400);
  assert.match((await phone.json()).error, /手机号/);
  assert.equal(await status({ board: "qa", title: "有效的标题", body: "教程合集加微信 lucky888xx 领取" }), 400);
  assert.equal(await status({ board: "qa", title: "有效的标题", body: "足够长的正文内容", bounty: 30 }), 400, "bounties come in fixed amounts");
  assert.equal(await status({ board: "showcase", title: "我的作品", body: "", tools: "Midjourney" }), 400, "a work needs an image");
  assert.equal(await status({ board: "tools", title: "推荐一个工具", body: "" }), 400, "a resource needs its link");
  assert.equal(await status({ board: "tools", title: "推荐一个工具", body: "", url: "ftp://example.com/tool" }), 400);
  assert.equal(await status({ board: "tools", title: "推荐一个工具", body: "", url: "https://example.com", kind: "破解" }), 400);
  assert.equal(await status({ board: "moments", body: "嗯" }, "reader=r2"), 400, "a moment needs two characters");
  assert.equal(await status({ board: "moments", body: "字".repeat(301) }, "reader=r2"), 400, "and at most 300");
  const moment = await json(post("topics", { board: "moments", title: "随想不需要标题", body: "今天试了一个新工具，挺好用。" }, "reader=r2"));
  assert.equal((await json(get(`topics/${moment.id}`))).topic.title, "今天试了一个新工具，挺好用。", "a moment is titled by its text");
  assert.equal(await status({ board: "qa", title: "微信小程序怎么接入 AI", body: "想在微信小程序里调用模型接口。" }), 201, "mentioning WeChat is fine");
  assert.equal(await status({ board: "vip", title: "会员的话题", body: "只有会员能看到的内容" }), 403);
  assert.equal(await status({ board: "vip", title: "会员的话题", body: "只有会员能看到的内容" }, "reader=v1"), 201);
  assert.equal((await json(get("topics"))).items.some((x) => x.board === "vip"), false, "non-members never see members-only topics");
  assert.deepEqual(Object.keys((await json(get("summary"))).boards).sort(), ["moments", "qa"], "non-members get no members-board stats");
  assert.equal((await json(get("topics", "reader=v1"))).items.some((x) => x.board === "vip"), true);
  assert.equal((await post("topics/x/replies", { body: "有效的回复" })).status, 404, "no such topic");
  assert.equal(communityContactReason("微信公众号的文章怎么总结"), null);
  assert.match(communityContactReason("vx：abcdef123"), /微信/);
});

test("posting is rate limited per account", async (t) => {
  const { post } = await setup(t);
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await post("topics", { board: "moments", body: `第 ${i} 条：今天试了一个新工具，挺好用。` })).status);
  assert.deepEqual(results, [201, 201, 201, 429]);
  assert.equal((await post("topics", { board: "moments", body: "别人的随想：今天试了一个新工具。" }, "reader=r2")).status, 201, "limits are per account");
});

test("without the community tables the service says it is not open, and the rest of the site is unaffected", async (t) => {
  const { get } = await setup(t, { store: false });
  const response = await get("summary");
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /尚未开放/);
});

test("the runtime maps site identities to community members and looks up their profiles", async (t) => {
  const { createCommunityRuntime } = await import("../server/community-runtime.ts");
  const directory = await mkdtemp(resolve(tmpdir(), "sansphase-community-runtime-"));
  t.after(() => cleanup(directory));
  await copyFile(resolve(template, "content.db"), resolve(directory, "content.db"));
  const finds = [];
  const options = {
    directory, siteOrigin: "http://127.0.0.1:1", authorId: "author-1",
    payload: { find: async (query) => { finds.push(query); return { docs: [{ id: "r1", nickname: "林间", signature: "你好", createdAt: "2026-01-01T00:00:00.000Z" }] }; } },
    readerIdentity: async (req) => req.reader ? { id: "r1", nickname: "林间", vip: true } : null,
    ownerIdentity: async (req) => req.owner ? { name: "作者" } : null,
    ownerName: async () => "無相",
    uidStore: { get: (id) => `u${id}`, readerId: (uid) => uid.startsWith("u") ? uid.slice(1) : null },
  };
  const runtime = createCommunityRuntime(options);
  try {
    assert.ok(runtime.store);
    runtime.store.createTopic({ board: "qa", author: { kind: "reader", id: "r1" }, title: "读者的帖子", body: "足够长的正文内容" });
    runtime.store.createTopic({ board: "qa", author: { kind: "owner", id: "author-1" }, title: "站长的帖子", body: "足够长的正文内容" });
    runtime.store.createTopic({ board: "qa", author: { kind: "reader", id: "gone" }, title: "注销者的帖子", body: "足够长的正文内容" });
    // Drive the service through a fake request/response pair.
    const call = async (req, url = "/api/community/topics") => {
      const res = { status: 0, body: "", headersSent: false, writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
      await runtime.service.handle({ method: "GET", url, headers: {}, ...req }, res);
      return { status: res.status, value: JSON.parse(res.body) };
    };
    assert.equal((await call({})).status, 401);
    const asReader = await call({ reader: true });
    assert.equal(asReader.status, 200);
    assert.deepEqual(asReader.value.items.map((x) => [x.author.name, x.author.uid]).sort(), [["已注销用户", null], ["林间", "ur1"], ["無相", "owner"]].sort());
    assert.deepEqual([...finds.at(-1).where.id.in].sort(), ["gone", "r1"], "one lookup for all reader profiles");
    assert.equal((await call({ owner: true })).status, 200, "the owner can read too");
    const page = await call({ reader: true }, "/api/community/members/ur1");
    assert.deepEqual([page.status, page.value.person.name, page.value.bio, page.value.self], [200, "林间", "你好", true]);
    assert.equal((await call({ reader: true }, "/api/community/members/owner")).value.person.name, "無相");
  } finally { runtime.close(); }
  const empty = await mkdtemp(resolve(tmpdir(), "sansphase-community-runtime-"));
  t.after(() => cleanup(empty));
  new DatabaseSync(resolve(empty, "content.db")).close();
  const closed = createCommunityRuntime({ ...options, directory: empty });
  assert.equal(closed.store, null, "without the migration there is no store");
  closed.close();
});

test("likes, bookmarks, views, thanks, check-ins and the viewer's own state", async (t) => {
  const { get, post, setLevel } = await setup(t);
  const { id, earned } = await json(post("topics", { ...topicBody, tags: ["ComfyUI", "新手"] }));
  assert.equal(earned, 5, "posting earns 星尘");
  assert.deepEqual(await json(post(`topics/${id}/like`, { on: true }, "reader=r2")), { likes: 1, liked: true, earned: 1 }, "a 巡天 like pays the author");
  assert.deepEqual(await json(post(`topics/${id}/bookmark`, { on: true }, "reader=r2")), { bookmarks: 1, bookmarked: true });
  const seen = await json(get(`topics/${id}`, "reader=r2"));
  assert.deepEqual([seen.topic.likes, seen.topic.liked, seen.topic.bookmarked, seen.topic.mine, seen.topic.canEdit], [1, true, true, false, false]);
  assert.deepEqual(seen.topic.tags, ["ComfyUI", "新手"]);
  assert.equal((await json(get(`topics/${id}`))).topic.liked, false, "likes are per viewer");
  assert.equal((await json(get(`topics?tag=${encodeURIComponent("新手")}`))).items[0].views, 2, "each viewer counts once a day");
  assert.equal((await get("topics?tag=nope")).status, 404);
  assert.equal((await json(get("bookmarks", "reader=r2"))).items[0].id, id);
  const poor = await post(`topics/${id}/thank`, {}, "reader=r2");
  assert.equal(poor.status, 402);
  assert.match((await poor.json()).error, /星尘不足/);
  assert.equal((await post("checkin", {}, "reader=r2")).status, 200);
  assert.equal((await post("checkin", {}, "reader=r2")).status, 409, "once a day");
  const me = await json(get("me", "reader=r2"));
  assert.deepEqual([me.name, me.checkedIn, me.streak, me.balance, me.nextReward.total, me.agreed], ["远山", true, 1, 5, 5, true]);
  const summary = await json(get("summary"));
  assert.deepEqual([summary.checkinsToday, summary.tags.ComfyUI], [1, 1]);
  assert.equal((await post(`topics/${id}/thank`, {})).status, 400, "not your own post");
  const board = await json(get("checkin", "reader=r2"));
  assert.equal(board.days.length, 1);
  assert.deepEqual(board.earlyBirds.map((bird) => bird.person.name), ["远山"]);
  assert.deepEqual(board.badges.sort(), ["early", "first_checkin"]);
  assert.equal((await json(get("stardust", "reader=r2"))).ledger[0].reason, "checkin");
  setLevel("r2", 1);
  await post("checkin", {}, "reader=v1");
  await post("checkin", {}, "reader=v1");
  assert.equal((await json(get("me", "reader=v1"))).balance, 7, "VIPs get 2 more a day");
  assert.equal((await post("topics", { ...topicBody, tags: ["不存在的标签"] })).status, 400);
  assert.equal((await post("topics", { ...topicBody, tags: ["新手", "提示词", "工作流", "Claude"] })).status, 400, "at most three tags");
});

test("editing, accepting answers and moderation tools are limited to the right people", async (t) => {
  const { get, post, audits } = await setup(t);
  const { id } = await json(post("topics", topicBody));
  const edit = (cookie, title = "ComfyUI 人脸崩了（已补充）") => post(`topics/${id}/edit`, { title, body: "补充：权重都是 0.8。", tags: ["ComfyUI"] }, cookie);
  assert.equal((await edit("reader=r2")).status, 403);
  assert.equal((await edit("reader=r1")).status, 200);
  assert.equal((await edit("owner=yes", "站长改过的标题")).status, 200, "the owner may edit anything");
  const detail = await json(get(`topics/${id}`));
  assert.deepEqual([detail.topic.title, detail.topic.edited], ["站长改过的标题", true]);

  const mine = await json(post(`topics/${id}/replies`, { body: "我自己补充一句" }));
  const answer = await json(post(`topics/${id}/replies`, { body: "把权重降到 0.5 试试看" }, "reader=r2"));
  assert.equal((await post(`replies/${answer.id}/edit`, { body: "别人的回复" })).status, 403);
  assert.equal((await post(`replies/${answer.id}/edit`, { body: "把权重降到 0.5 左右试试" }, "reader=r2")).status, 200);
  assert.equal((await post(`replies/${answer.id}/accept`, {}, "reader=r2")).status, 403, "only the asker accepts");
  assert.equal((await post(`replies/${mine.id}/accept`, {})).status, 400, "not your own reply");
  assert.deepEqual(await json(post(`replies/${answer.id}/accept`, {})), { earned: 15 });
  assert.equal((await post(`replies/${answer.id}/accept`, {})).status, 409);
  const solved = await json(get(`topics/${id}`));
  assert.deepEqual(solved.replies.map((reply) => [reply.id, reply.accepted]), [[answer.id, true], [mine.id, false]], "the accepted answer comes first");
  assert.equal(solved.replies[0].canAccept, false);
  const quoting = await json(post(`topics/${id}/replies`, { body: "同意楼上的办法", quote: answer.id }, "reader=v1"));
  assert.deepEqual((await json(get(`topics/${id}`))).replies.find((reply) => reply.id === quoting.id).quote, { id: answer.id, author: "远山", excerpt: "把权重降到 0.5 左右试试" });

  assert.equal((await post(`topics/${id}/pin`, { on: true })).status, 403);
  assert.equal((await post(`topics/${id}/feature`, { on: true })).status, 403);
  assert.equal((await post(`topics/${id}/pin`, { on: true }, "owner=yes")).status, 200);
  assert.equal((await post(`topics/${id}/feature`, { on: true }, "owner=yes")).status, 200);
  const flagged = (await json(get("topics"))).items[0];
  assert.deepEqual([flagged.pinned, flagged.featured, flagged.solved], [true, true, true]);
  assert.equal((await json(get("me"))).balance, 5 + 50, "精华 pays the author 50");
  assert.equal((await json(get(`topics/${id}`, "owner=yes"))).topic.canModerate, true);
  assert.equal((await json(get(`topics/${id}`))).topic.canModerate, false);

  assert.equal((await post(`topics/${id}/lock`, { on: true }, "owner=yes")).status, 200);
  assert.equal((await post(`topics/${id}/replies`, { body: "锁了还能回复吗" }, "reader=r2")).status, 409);
  assert.equal((await json(get(`topics/${id}`, "reader=r2"))).topic.canReply, false);
  assert.equal((await post(`topics/${id}/move`, { board: "nowhere" }, "owner=yes")).status, 400);
  assert.equal((await post(`topics/${id}/move`, { board: "meta" }, "owner=yes")).status, 200);
  assert.equal((await json(get(`topics/${id}`))).topic.board, "meta");
  assert.equal((await json(get("inbox?tab=system"))).items.some((notice) => notice.data.moved === "meta"), true, "the author hears where it went");
  assert.deepEqual(audits.map((entry) => entry.action), ["community-pin", "community-feature", "community-lock", "community-move"]);
});

test("reports go to the owner; strong reports hide content at once", async (t) => {
  const { get, post, setLevel } = await setup(t);
  const { id } = await json(post("topics", topicBody));
  const reply = await json(post(`topics/${id}/replies`, { body: "广告广告广告广告" }, "reader=r2"));
  const report = (body, cookie = "reader=r1") => post("reports", body, cookie);
  assert.equal((await report({ kind: "topic", id, reason: "其他" })).status, 400, "not your own post");
  assert.equal((await report({ kind: "reply", id: reply.id, reason: "乱写的原因" })).status, 400);
  assert.deepEqual(await json(report({ kind: "reply", id: reply.id, reason: "垃圾广告 / 引流", note: "明显是广告" })), { hidden: false });
  assert.equal((await report({ kind: "reply", id: reply.id, reason: "其他" })).status, 409);
  assert.equal((await report({ kind: "reply", id: reply.id, reason: "其他" }, "reader=r3")).status, 403, "初光 cannot report");
  assert.equal((await get("manage")).status, 403);
  const queue = await json(get("manage?tab=reports", "owner=yes"));
  assert.equal(queue.counts.reports, 1);
  const [open] = queue.reports;
  assert.deepEqual([open.reporter.name, open.target.kind, open.target.author.name, open.target.topicId, open.target.excerpt], ["林间", "reply", "远山", id, "广告广告广告广告"]);
  assert.equal((await post(`manage/reports/${open.id}`, { uphold: true })).status, 403);
  assert.deepEqual(await json(post(`manage/reports/${open.id}`, { uphold: true }, "owner=yes")), { removed: true });
  assert.equal((await json(get(`topics/${id}`))).replies.length, 0);
  assert.equal((await json(get("manage?tab=reports", "owner=yes"))).reports.length, 0);
  assert.equal((await json(get("me"))).balance, 5 + 5, "the reporter is rewarded");

  // A 守夜 (L3) report hides a 巡天 member's post at once; the author still sees it.
  setLevel("r2", 3);
  const second = await json(post("topics", { ...topicBody, title: "另一个问题的标题" }));
  assert.deepEqual(await json(report({ kind: "topic", id: second.id, reason: "与版块无关" }, "reader=r2")), { hidden: true });
  assert.equal((await get(`topics/${second.id}`, "reader=v1")).status, 404);
  assert.match((await json(get(`topics/${second.id}`))).topic.hiddenReason, /与版块无关/);
  assert.equal((await json(get("manage", "owner=yes"))).queue.topics[0].id, second.id);
  assert.equal((await post(`topics/${second.id}/restore`, {}, "owner=yes")).status, 200);
  assert.equal((await get(`topics/${second.id}`, "reader=v1")).status, 200);

  // Two 观测 (L2) reports hide it too.
  setLevel("v1", 2);
  setLevel("s1", 2);
  const third = await json(post("topics", { ...topicBody, title: "第三个问题的标题" }));
  assert.deepEqual(await json(report({ kind: "topic", id: third.id, reason: "其他" }, "reader=v1")), { hidden: false });
  assert.deepEqual(await json(report({ kind: "topic", id: third.id, reason: "其他" }, "reader=s1")), { hidden: true });
  assert.ok((await json(get("inbox", "owner=yes"))).items.some((notice) => notice.data.report === "new" && notice.data.hidden));
});

test("images: upload, re-encode, attach to a post and serve only to those who may see it", async (t) => {
  const { get, post, upload } = await setup(t);
  const bytes = await png();
  const image = await json(upload(bytes));
  assert.match(image.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual([image.width, image.height], [1200, 800]);
  assert.equal((await upload(Buffer.from("not an image"), "image/png")).status, 400);
  assert.equal((await upload(Buffer.from("GIF89a"), "image/gif")).status, 415);
  assert.equal((await get(`images/${image.id}.webp`, "reader=r2")).status, 404, "an unattached upload is private");
  assert.equal((await get(`images/${image.id}.thumb.webp`)).headers.get("content-type"), "image/webp");
  const { id } = await json(post("topics", { board: "showcase", title: "节气海报", body: "一组节气海报作品，欢迎提意见。", images: [image.id], tools: "Midjourney" }));
  assert.equal((await get(`images/${image.id}.webp`, "reader=r2")).status, 200, "attached images follow the post");
  const detail = await json(get(`topics/${id}`, "reader=r2"));
  assert.deepEqual(detail.topic.images, [{ id: image.id, width: 1200, height: 800 }]);
  assert.deepEqual((await json(get("topics"))).items[0].thumbs, [image.id]);
  assert.equal((await post("topics", { board: "moments", body: "随手记一笔内容", images: Array.from({ length: 5 }, (_, i) => `${image.id.slice(0, -1)}${i}`) })).status, 400, "随想 allows four images");
  assert.equal((await post("topics", { board: "tools", title: "推荐一个工具", body: "", url: "https://example.com", images: [image.id] })).status, 400, "resources have no images");
  const secret = await json(upload(bytes, "image/png", "reader=v1"));
  await post("topics", { board: "vip", title: "会员的图", body: "只有会员能看到的图片", images: [secret.id] }, "reader=v1");
  assert.equal((await get(`images/${secret.id}.webp`, "reader=r2")).status, 404, "members-board images stay with the board");
  assert.equal((await get(`images/${secret.id}.webp`, "owner=yes")).status, 200);
  const newcomer = [await json(upload(bytes, "image/png", "reader=r3")), await json(upload(bytes, "image/png", "reader=r3"))];
  const tooMany = await post("topics", { ...topicBody, agree: true, images: newcomer.map((x) => x.id) }, "reader=r3");
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).error, /初光等级每帖最多 1 张图/);
});

test("the guidelines come first, and 初光 members have limits and a review queue", async (t) => {
  const { get, post } = await setup(t);
  const first = await post("topics", topicBody, "reader=r3");
  assert.equal(first.status, 428, "the first post asks for the guidelines");
  assert.equal((await json(get("me", "reader=r3"))).agreed, false);
  const plain = await json(post("topics", { ...topicBody, agree: true }, "reader=r3"));
  assert.deepEqual([plain.pending, plain.earned], [false, 5]);
  assert.equal((await json(get("me", "reader=r3"))).agreed, true);
  assert.equal((await post("topics", { ...topicBody, bounty: 20 }, "reader=r3")).status, 403, "初光 cannot offer bounties");
  const links = "看这几个链接 https://a.example https://b.example https://c.example";
  assert.equal((await post("topics", { ...topicBody, body: links }, "reader=r3")).status, 400, "at most two links");
  const linked = await json(post("topics", { ...topicBody, title: "带链接的问题标题", body: "参考了这个教程 https://a.example/guide" }, "reader=r3"));
  assert.deepEqual([linked.pending, linked.earned], [true, 0], "the first posts with links wait for review");
  assert.equal((await post("topics", { ...topicBody, title: "第三个问题标题" }, "reader=r3")).status, 429, "two topics a day");
  assert.equal((await get(`topics/${linked.id}`, "reader=r2")).status, 404, "others cannot see it yet");
  const own = await json(get(`topics/${linked.id}`, "reader=r3"));
  assert.deepEqual([own.topic.pending, own.topic.pendingReason, own.topic.canReply], [true, "初光等级，帖子带外链", false]);
  assert.equal((await json(get("topics"))).items.some((x) => x.id === linked.id), false);
  assert.ok((await json(get("inbox", "owner=yes"))).items.some((notice) => notice.type === "review" && notice.topicId === linked.id), "the owner is told");
  assert.equal((await json(get("manage", "owner=yes"))).queue.topics[0].id, linked.id);
  assert.equal((await post(`topics/${linked.id}/approve`, {}, "owner=yes")).status, 200);
  assert.equal((await get(`topics/${linked.id}`, "reader=r2")).status, 200);
  assert.equal((await json(get("inbox", "reader=r3"))).items[0].data.state, "approved");

  const other = await json(post("topics", { ...topicBody, title: "巡天的问题标题" }, "reader=r2"));
  assert.equal((await post(`topics/${other.id}/thank`, {}, "reader=r3")).status, 403, "初光 cannot thank");
  assert.equal((await json(post(`topics/${other.id}/like`, {}, "reader=r3"))).earned, 0, "an 初光 like gives no 星尘");
  assert.equal((await post(`topics/${other.id}/replies`, { body: links }, "reader=r3")).status, 400);
  assert.equal((await post(`topics/${other.id}/replies`, { body: "有道理，学到了" }, "reader=r3")).status, 201);
});

test("@mentions, notifications and follows", async (t) => {
  const { get, post } = await setup(t);
  const { id } = await json(post("topics", { ...topicBody, body: "请教 @远山 和 @無相 这个问题怎么解决" }));
  const mention = (await json(get("inbox?tab=reply", "reader=r2"))).items[0];
  assert.deepEqual([mention.type, mention.actor.name, mention.topicTitle], ["mention", "林间", "ComfyUI 人脸崩了"]);
  assert.ok((await json(get("inbox", "owner=yes"))).items.some((notice) => notice.type === "mention"));
  assert.deepEqual((await json(get(`topics/${id}`, "reader=r2"))).mentions, { 远山: "u2", 無相: "owner" });
  await post(`topics/${id}/replies`, { body: "@林间 我试试这个办法" }, "reader=r2");
  assert.deepEqual((await json(get("inbox?tab=reply"))).items.map((notice) => notice.type), ["reply"], "the topic's author is told once");
  assert.deepEqual((await json(get("me", "reader=r2"))).unread, { all: 1, reply: 1, thanks: 0, system: 0 });
  assert.deepEqual(await json(post("inbox/read-all", {}, "reader=r2")), { read: 1 });
  assert.equal((await json(get("me", "reader=r2"))).unread.all, 0);
  assert.equal((await post("inbox/read", { id: "missing" })).status, 404);
  const notice = (await json(get("inbox"))).items[0];
  assert.deepEqual(await json(post("inbox/read", { id: notice.id })), { ok: true });

  assert.deepEqual(await json(post("members/u1/follow", { on: true }, "reader=r2")), { following: true, followers: 1 });
  assert.equal((await post("members/u2/follow", { on: true }, "reader=r2")).status, 400, "not yourself");
  assert.equal((await post("members/nobody/follow", { on: true }, "reader=r2")).status, 404);
  assert.equal((await json(get("inbox?tab=system"))).items[0].type, "follow");
  const page = await json(get("members/u1", "reader=r2"));
  assert.deepEqual([page.person.name, page.bio, page.following, page.follows, page.self, page.quick, page.canMute], ["林间", "喜欢画画", true, { followers: 1, following: 0 }, false, null, false]);
  assert.deepEqual([page.counts.topics, page.topics.map((x) => x.id)], [1, [id]]);
  const replies = await json(get("members/u2?tab=replies"));
  assert.deepEqual(replies.replies.map((reply) => reply.topicTitle), ["ComfyUI 人脸崩了"]);
  const self = await json(get("members/u1?tab=bookmarks"));
  assert.deepEqual([self.self, self.quick.balance, self.bookmarks], [true, 5, []]);
  assert.deepEqual([(await json(get("members/owner"))).person.name, (await json(get("members/owner"))).joinedAt], ["無相", null]);
});

test("following sort filters to followed authors and does not create post notifications", async (t) => {
  const { get, post } = await setup(t);
  const own = await json(post("topics", { ...topicBody, title: "自己的主题" }, "reader=r1"));
  await post("members/u1/follow", { on: true }, "reader=r2");
  const followed = await json(post("topics", { ...topicBody, title: "关注者的主题" }, "reader=r1"));
  await post("topics", { ...topicBody, title: "别人的主题" }, "reader=r3");
  const listing = await json(get("topics?sort=following", "reader=r2"));
  assert.deepEqual(listing.items.map((item) => item.title), ["关注者的主题", "自己的主题"]);
  assert.equal((await json(get("topics?sort=following", "reader=r3"))).total, 0);
  assert.equal((await json(get("inbox?tab=system", "reader=r2"))).items.some((notice) => notice.topicId === followed.id), false);
  assert.notEqual(own.id, followed.id);
});

test("owner cannot check in or make up, and owner content is absent from every ranking", async (t) => {
  const { get, post } = await setup(t);
  assert.equal((await post("checkin", {}, "owner=yes")).status, 403);
  assert.match((await (await post("checkin", {}, "owner=yes")).json()).error, /站长不参与签到/);
  assert.equal((await post("checkin/makeup", { day: "2026-09-29" }, "owner=yes")).status, 403);
  await post("checkin", {}, "reader=r1");
  const rank = await json(get("rank", "owner=yes"));
  assert.equal(rank.streaks.some((entry) => entry.person.role === "owner"), false);
  assert.equal(rank.early.some((entry) => entry.person.role === "owner"), false);
  assert.equal(rank.contributions.some((entry) => entry.person.role === "owner"), false);
});

test("review rejection requires a fixed reason and records the appeal notice and audit", async (t) => {
  const { get, post, audits } = await setup(t);
  const pending = await json(post("topics", { board: "qa", title: "带外链的待审主题", body: "请看 https://example.com/guide", agree: true }, "reader=r3"));
  assert.equal(pending.pending, true);
  assert.equal((await json(get("me", "owner=yes"))).manageTodo, 1, "the owner menu count includes pending review work");
  assert.equal((await post(`manage/topics/${pending.id}/reject`, { reason: "随便写" }, "owner=yes")).status, 400);
  assert.equal((await post(`manage/topics/${pending.id}/reject`, { reason: "广告引流", note: "补充说明" }, "owner=yes")).status, 200);
  const notices = await json(get("inbox?tab=system", "reader=r3"));
  assert.match(notices.items[0].text, /广告引流/);
  assert.match(notices.items[0].link, /community\/boards\/meta/);
  assert.deepEqual([audits.at(-1).action, audits.at(-1).reason, audits.at(-1).note], ["community-reject-topic", "广告引流", "补充说明"]);
});

test("a steward can reject a pending topic and the audit names the steward", async (t) => {
  const { get, post, audits } = await setup(t);
  const pending = await json(post("topics", { board: "qa", title: "协管待审主题", body: "请看 https://example.com/steward", agree: true }, "reader=r3"));
  await post("members/u5/steward", { on: true }, "owner=yes");
  const rejected = await post(`manage/topics/${pending.id}/reject`, { reason: "与版块无关", note: "请换到工具资源版块" }, "reader=s1");
  assert.equal(rejected.status, 200);
  const notice = (await json(get("inbox?tab=system", "reader=r3"))).items[0];
  assert.deepEqual([notice.data.title, notice.data.reason, notice.data.note, notice.link], ["协管待审主题", "与版块无关", "请换到工具资源版块", "#/community/boards/meta"]);
  assert.deepEqual([audits.at(-1).action, audits.at(-1).actor, audits.at(-1).reason], ["community-reject-topic", "reader:s1", "与版块无关"]);
});

test("withdrawing a pending post is silent for its author but audited and notified when moderated", async (t) => {
  const { get, post, audits } = await setup(t);
  const own = await json(post("topics", { board: "qa", title: "作者撤回的待审主题", body: "https://example.com/own", agree: true }, "reader=r3"));
  assert.equal((await post(`topics/${own.id}/delete`, {}, "reader=r3")).status, 200);
  const ownNotices = (await json(get("inbox?tab=system", "reader=r3"))).items;
  assert.equal(ownNotices.some((item) => /没有通过审核/.test(item.text)), false, "author withdrawal does not send rejection notice");
  const managed = await json(post("topics", { board: "qa", title: "管理员删除的待审主题", body: "https://example.com/managed", agree: true }, "reader=r3"));
  assert.equal((await post(`topics/${managed.id}/delete`, { reason: "广告引流", note: "审核示例" }, "owner=yes")).status, 200);
  const notice = (await json(get("inbox?tab=system", "reader=r3"))).items.find((item) => /没有通过审核/.test(item.text));
  assert.ok(notice);
  assert.match(notice.text, /没有通过审核/);
  assert.equal(notice.data.reason, "广告引流");
  assert.deepEqual([audits.at(-1).action, audits.at(-1).reason, audits.at(-1).note], ["community-delete-topic", "广告引流", "审核示例"]);
});

test("shipping company and tracking number survive resolution while recipient PII is removed", async (t) => {
  const { get, post, credit } = await setup(t);
  const item = await json(post("manage/items", { cat: "goods", name: "快递演示袋", description: "一个用于演示的帆布袋", price: 1, stock: 1 }, "owner=yes"));
  // The fixture account has enough balance for this small order.
  credit("r1", 5);
  const order = await json(post("shop/redeem", { item: item.id, shipping: { name: "林间", phone: "13800138000", address: "浙江省杭州市西湖区某路 1 号" } }));
  assert.equal((await post(`manage/orders/${order.order}/ship`, { company: "顺丰", tracking: "SF123456" }, "owner=yes")).status, 200);
  const mine = await json(get("shop/mine"));
  assert.deepEqual(mine.orders.find((row) => row.id === order.order).tracking, { company: "顺丰", number: "SF123456" });
  const notice = (await json(get("inbox?tab=system"))).items.find((row) => row.data.order === "shipped");
  assert.equal(notice.data.tracking, "SF123456");
  const managed = await json(get("manage?tab=orders", "owner=yes"));
  assert.equal(managed.orders.find((row) => row.id === order.order).shipping, null);
  assert.deepEqual(managed.orders.find((row) => row.id === order.order).tracking, { company: "顺丰", number: "SF123456" });
});

test("public post people keep a linkable UID while display follows viewer permissions", async (t) => {
  const { get, post } = await setup(t);
  const { id } = await json(post("topics", topicBody, "reader=r1"));
  await post("members/u5/steward", { on: true }, "owner=yes");
  assert.deepEqual((await json(get(`topics/${id}`, "reader=r2"))).topic.author, { name: "林间", role: "reader", uid: "u1", showUid: false, avatar: "/api/community/avatar/u1.webp?v=aaaaaaaa", vip: false, level: 1, steward: false, frame: null, color: null });
  assert.equal((await json(get(`topics/${id}`, "reader=r1"))).topic.author.showUid, true);
  assert.equal((await json(get(`topics/${id}`, "reader=s1"))).topic.author.showUid, true);
  assert.equal((await json(get("me", "reader=r1"))).uid, "u1");
});

test("the shop: prices and states, decorations, goods with shipping details for the owner only, and digital items", async (t) => {
  const { get, post, credit } = await setup(t);
  const shop = await json(get("shop"));
  assert.equal(shop.items.find((item) => item.id === "frame-gold").state.code, "short");
  assert.equal((await json(get("shop", "reader=r3"))).items.find((item) => item.id === "card-pin").state.code, "level");
  credit("r1", 500);
  assert.equal((await json(post("shop/redeem", { item: "frame-gold" }))).balance, 420);
  assert.equal((await json(get("stardust"))).ledger[0].detail, "金环头像框", "the ledger names what was redeemed");
  assert.equal((await json(get("me"))).frame, "gold", "a new frame is worn at once");
  assert.equal((await json(post("shop/equip", { kind: "frame", ref: null }))).frame, null);
  assert.equal((await post("shop/equip", { kind: "frame", ref: "nebula" })).status, 403);
  assert.equal((await post("shop/redeem", { item: "nothing" })).status, 404);

  assert.equal((await post("manage/items", { cat: "goods", name: "帆布袋", description: "一个帆布袋子", price: 100, stock: 2 })).status, 403);
  assert.equal((await post("manage/items", { cat: "goods", name: "帆布袋", description: "一个帆布袋子", price: 100 }, "owner=yes")).status, 400, "goods need stock");
  const bag = await json(post("manage/items", { cat: "goods", name: "帆布袋", description: "一个帆布袋子", price: 100, stock: 2 }, "owner=yes"));
  assert.match((await (await post("shop/redeem", { item: bag.id })).json()).error, /手机号/);
  assert.equal((await post("shop/redeem", { item: bag.id, shipping: { name: "林间", phone: "138 0013 8000", address: "短" } })).status, 400);
  const shipping = { name: "林间", phone: "138 0013 8000", address: "浙江省杭州市西湖区某路 1 号" };
  const order = await json(post("shop/redeem", { item: bag.id, shipping }));
  assert.ok((await json(get("inbox", "owner=yes"))).items.some((notice) => notice.data.order === "new"));
  const orders = await json(get("manage?tab=orders", "owner=yes"));
  assert.deepEqual([orders.counts.orders, orders.orders[0].member.name, orders.orders[0].shipping], [1, "林间", { ...shipping, phone: "13800138000" }]);
  assert.equal((await json(get("shop/mine"))).orders.find((row) => row.id === order.order).shipping, undefined, "the member's own list has no address");
  assert.equal((await post(`manage/orders/${order.order}/ship`, {}, "owner=yes")).status, 200);
  assert.equal((await json(get("manage?tab=orders", "owner=yes"))).orders[0].shipping, null, "shipping details are deleted once shipped");
  assert.equal((await post(`manage/orders/${order.order}/ship`, {}, "owner=yes")).status, 409);
  assert.ok((await json(get("inbox?tab=system"))).items.some((notice) => notice.data.order === "shipped"));

  assert.equal((await post("manage/items", { cat: "digital", name: "提示词手册", description: "一份提示词手册", price: 20 }, "owner=yes")).status, 400, "digital items need their content");
  const pack = await json(post("manage/items", { cat: "digital", name: "提示词手册", description: "一份提示词手册", price: 20, delivery: "链接 https://example.com 提取码 abcd" }, "owner=yes"));
  assert.equal((await get(`shop/items/${pack.id}/delivery`)).status, 403);
  assert.equal((await json(get("shop"))).items.find((item) => item.id === pack.id).delivery, undefined, "the shop never lists the content");
  await post("shop/redeem", { item: pack.id });
  assert.match((await json(get(`shop/items/${pack.id}/delivery`))).delivery, /提取码 abcd/);
  const mine = await json(get("shop/mine"));
  assert.deepEqual([mine.looks.map((item) => item.id), mine.digital.map((item) => item.id), mine.orders.length], [["frame-gold"], [pack.id], 3]);
  assert.equal((await json(get("manage?tab=items", "owner=yes"))).items.length, 2);
});

test("stewards, mutes, moderated deletions, tag edits and the audit log", async (t) => {
  const { get, post, audits } = await setup(t);
  assert.equal((await post("members/u5/steward", { on: true })).status, 403, "only the owner appoints");
  assert.deepEqual(await json(post("members/u5/steward", { on: true }, "owner=yes")), { steward: true });
  assert.deepEqual([(await json(get("me", "reader=s1"))).mod, (await json(get("me", "reader=s1"))).level], [true, 4]);
  assert.equal((await get("manage", "reader=s1")).status, 200);
  assert.equal((await get("manage?tab=items", "reader=s1")).status, 403, "the shop is the owner's");
  assert.equal((await get("manage?tab=orders", "reader=s1")).status, 403);

  const { id } = await json(post("topics", topicBody));
  const reply = await json(post(`topics/${id}/replies`, { body: "这是一条违规的回复内容" }, "reader=r2"));
  assert.equal((await post(`topics/${id}/pin`, { on: true }, "reader=s1")).status, 200);
  assert.equal((await post(`topics/${id}/feature`, { on: true }, "reader=s1")).status, 403, "精华 is the owner's");
  assert.equal((await post(`topics/${id}/retag`, { tags: ["效率"] })).status, 403, "巡天 cannot retag");
  assert.equal((await post(`topics/${id}/retag`, { tags: ["效率"] }, "reader=s1")).status, 200);
  assert.deepEqual((await json(get(`topics/${id}`))).topic.tags, ["效率"]);
  assert.equal((await post(`replies/${reply.id}/delete`, {}, "reader=s1")).status, 200);
  assert.equal((await json(get("inbox?tab=system", "reader=r2"))).items[0].type, "penalty");
  assert.equal((await post(`topics/${id}/delete`, { mute: 7 }, "reader=s1")).status, 200);
  const muted = await post("topics", topicBody);
  assert.equal(muted.status, 403);
  assert.match((await muted.json()).error, /禁言/);
  assert.equal((await json(get("me"))).muted.reason, "发布违规内容");
  const sanctions = await json(get("manage?tab=sanctions", "reader=s1"));
  assert.equal(sanctions.sanctions[0].member.name, "林间");
  assert.equal((await post(`manage/sanctions/${sanctions.sanctions[0].id}/lift`, {}, "reader=s1")).status, 200);
  assert.equal((await post(`manage/sanctions/${sanctions.sanctions[0].id}/lift`, {}, "reader=s1")).status, 409);
  assert.equal((await post("topics", topicBody)).status, 201, "lifted");

  assert.equal((await post("members/u2/mute", { days: 2, reason: "人身攻击" }, "reader=s1")).status, 400);
  assert.equal((await post("members/u2/mute", { days: 1, reason: "人身攻击" })).status, 403);
  assert.equal((await post("members/owner/mute", { days: 1, reason: "人身攻击" }, "reader=s1")).status, 403);
  assert.equal((await post("members/u2/mute", { days: 1, reason: "人身攻击" }, "reader=s1")).status, 200);
  assert.equal((await post("topics", { board: "moments", body: "我被禁言了吗？试试看" }, "reader=r2")).status, 403);
  assert.equal((await json(get("members/u2", "reader=s1"))).muted.reason, "人身攻击");
  assert.deepEqual(audits.map((entry) => entry.action), [
    "community-steward", "community-pin", "community-retag", "community-delete-reply", "community-delete-topic", "community-lift", "community-mute",
  ]);
  assert.equal(audits[4].mute, 7);
  const other = await json(post("topics", topicBody, "reader=v1"));
  const noisy = await json(post(`topics/${other.id}/replies`, { body: "刷屏刷屏刷屏" }, "reader=r3"));
  assert.equal((await post(`replies/${noisy.id}/delete`, { mute: 30 }, "reader=s1")).status, 200);
  assert.equal((await json(get("me", "reader=r3"))).muted.reason, "发布违规内容", "deleting a reply can mute its author too");
  assert.deepEqual([audits.at(-1).action, audits.at(-1).mute], ["community-delete-reply", 30]);
});

test("prompts, unlocks, resource votes, bounties, paid pins and highlights through the API", async (t) => {
  const { get, post, upload, credit } = await setup(t);
  const bytes = await png();
  const image = await json(upload(bytes));
  const work = { board: "showcase", title: "水彩猫咪", body: "", images: [image.id], tools: "Midjourney", model: "v7", usage: "可商用" };
  assert.equal((await post("topics", { ...work, prompt: "a cat, watercolor", promptMode: "paid", promptPrice: 60 })).status, 400, "unlock prices are 5 to 50");
  const { id } = await json(post("topics", { ...work, prompt: "a cat, watercolor", promptMode: "paid", promptPrice: 10 }));
  const locked = await json(get(`topics/${id}`, "reader=r2"));
  assert.deepEqual(locked.topic.meta, { tools: "Midjourney", model: "v7", usage: "可商用", promptMode: "paid", price: 10, prompt: null, preview: "x xxx, xxxxxxxxxx", unlocked: false, unlocks: 0 });
  assert.equal((await json(get(`topics/${id}`))).topic.meta.prompt, "a cat, watercolor", "the author always sees it");
  assert.equal((await post(`topics/${id}/unlock`, {}, "reader=r2")).status, 402);
  credit("r2", 50);
  assert.deepEqual(await json(post(`topics/${id}/unlock`, {}, "reader=r2")), { share: 8, balance: 40 });
  assert.equal((await json(get(`topics/${id}`, "reader=r2"))).topic.meta.prompt, "a cat, watercolor");
  assert.equal((await post(`topics/${id}/unlock`, {})).status, 400, "not your own");
  assert.ok((await json(get("inbox?tab=thanks"))).items.some((notice) => notice.type === "unlock"));
  const other = await json(upload(bytes, "image/png", "reader=v1"));
  const hidden = await json(post("topics", { ...work, images: [other.id], promptMode: "public" }, "reader=v1"));
  assert.equal((await json(get(`topics/${hidden.id}`))).topic.meta.promptMode, "hidden", "no prompt means not shared");

  const tool = await json(post("topics", { board: "tools", title: "一个好用的抠图网站", body: "", url: "https://example.com/app", kind: "网站", price: "部分免费", platform: "Web" }, "reader=r2"));
  assert.deepEqual(await json(post(`topics/${tool.id}/vote`, { value: "dead" })), { vote: "dead", alive: 0, dead: 1 });
  assert.deepEqual((await json(get(`topics/${tool.id}`))).topic.resource, { url: "https://example.com/app", kind: "网站", price: "部分免费", platform: "Web", alive: 0, dead: 1, myVote: "dead" });
  assert.equal((await post(`topics/${id}/vote`, { value: "dead" })).status, 404, "only resources take votes");

  assert.equal((await post("topics", { ...topicBody, bounty: 20 })).status, 402, "a bounty is paid up front");
  credit("r1", 100);
  const question = await json(post("topics", { ...topicBody, bounty: 20 }));
  assert.deepEqual((await json(get("topics?board=qa"))).items.map((x) => [x.id, x.bounty, x.bountyState]), [[question.id, 20, "open"]]);

  assert.equal((await post(`topics/${tool.id}/paid-pin`, {})).status, 403, "only your own topic");
  assert.equal((await post(`topics/${tool.id}/paid-pin`, {}, "reader=r2")).status, 402);
  credit("r2", 200);
  assert.equal((await json(post(`topics/${tool.id}/paid-pin`, {}, "reader=r2"))).card, false);
  const pinned = (await json(get("topics?board=tools"))).items[0];
  assert.deepEqual([pinned.id, pinned.paidPin, pinned.pinned], [tool.id, true, false]);
  assert.equal((await post(`topics/${tool.id}/highlight`, {}, "reader=r2")).status, 402, "a highlight needs a card");
  credit("r2", 100);
  assert.equal((await post("shop/redeem", { item: "card-highlight" }, "reader=r2")).status, 201);
  assert.equal((await post(`topics/${tool.id}/highlight`, {}, "reader=r2")).status, 200);
  assert.equal((await json(get("topics?board=tools"))).items[0].glow, true);
});

test("make-up check-ins, the 星尘 center, rankings and avatars", async (t) => {
  const { get, post, credit, siteOrigin } = await setup(t);
  assert.equal((await json(post("checkin", {}))).streak, 1);
  const board = await json(get("checkin"));
  assert.deepEqual([board.makeup.days.length, board.makeup.left, board.makeup.cost], [7, 2, 30]);
  assert.equal((await post("checkin/makeup", { day: board.makeup.days[0] })).status, 402);
  credit("r1", 100);
  assert.deepEqual(await json(post("checkin/makeup", { day: board.makeup.days[0] })), { streak: 2, cost: "stardust", balance: 75 });
  assert.equal((await post("checkin/makeup", { day: "2020-01-01" })).status, 400);

  const stardust = await json(get("stardust"));
  assert.deepEqual([stardust.balance, stardust.level, stardust.progress.next], [75, 1, 2]);
  assert.deepEqual(stardust.ledger.map((row) => row.reason), ["makeup", "test", "checkin"]);
  assert.equal(stardust.ledger[0].detail, board.makeup.days[0], "a make-up names its day");
  assert.deepEqual((await json(get("stardust?flow=out"))).ledger.map((row) => row.amount), [-30]);

  const rank = await json(get("rank"));
  assert.deepEqual(rank.streaks.map((entry) => [entry.person.name, entry.streak]), [["林间", 2]]);
  assert.deepEqual(rank.early.map((entry) => entry.person.name), ["林间"]);
  assert.deepEqual(rank.contributions, []);

  const avatar = await get("avatar/u1.webp", "reader=r2");
  assert.deepEqual([avatar.status, avatar.headers.get("content-type"), await avatar.text()], [200, "image/webp", "avatar-bytes"]);
  assert.equal((await get("avatar/u2.webp", "reader=r2")).status, 404, "no approved avatar");
  assert.equal((await fetch(`${siteOrigin}/api/community/avatar/u1.webp`)).status, 401, "members only");
});
