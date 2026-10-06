import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateCommunity } from "../server/payload/community-migration.ts";
import { createCommunityStore } from "../server/community-store.ts";
import { createCommunityPreviewStore } from './fixtures/community-preview-store.ts';
import { beijingDay } from "../src/community-rules.mjs";

const cleanup = (directory) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
async function workspace(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "sansphase-community-"));
  // content.db already exists before the community migration runs.
  const db = new DatabaseSync(resolve(directory, "content.db"));
  db.exec("CREATE TABLE readers (id TEXT PRIMARY KEY)");
  db.close();
  t.after(() => cleanup(directory));
  return directory;
}
// One migrated database per process, copied for each test: under the test
// runner a later node:sqlite backup() in the same process can stall for ~30 s.
let template;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), "sansphase-community-template-"));
  new DatabaseSync(resolve(template, "content.db")).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));
async function open(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "sansphase-community-"));
  await copyFile(resolve(template, "content.db"), resolve(directory, "content.db"));
  const store = createCommunityPreviewStore(directory);
  t.after(async () => { store.close(); await cleanup(directory); });
  return store;
}
const reader = (id) => ({ kind: "reader", id });
const owner = { kind: "owner", id: "owner" };
const minutes = (base, n) => new Date(Date.parse(base) + n * 60000).toISOString();
const at = (n) => minutes("2026-09-30T02:00:00Z", n); // 10:00 Beijing time
const post = (store, author, overrides = {}) => store.createTopic({ board: "qa", author, title: "一个问题标题", body: "正文正文正文正文", now: at(0), ...overrides });
const page = { sort: "active", page: 1, pageSize: 20 };

test("a store refuses to open before the migration", async (t) => {
  const directory = await workspace(t);
  assert.throws(() => createCommunityStore(directory), /Community migration is required/);
});

test("topics and replies: create, list, read, count and soft delete", async (t) => {
  const store = await open(t);
  const a = post(store, reader("r1"), { title: "第一个问题", body: "正文\n第二行" });
  const b = post(store, reader("r2"), { board: "tools", title: "工具推荐", body: "一个好用的工具", now: at(10) });
  const c = post(store, owner, { title: "站长的问题", body: "内容内容内容", now: at(20) });
  store.addReply({ topicId: a.id, author: reader("r2"), body: "回复一", now: at(30) });
  const second = store.addReply({ topicId: a.id, author: reader("r3"), body: "回复二", now: at(40) });

  const active = store.listTopics(page);
  assert.equal(active.total, 3);
  assert.deepEqual(active.items.map((x) => x.id), [a.id, c.id, b.id], "the topic with the newest reply comes first");
  assert.equal(active.items[0].replies, 2);
  assert.deepEqual(active.items[0].lastReply, { author: reader("r3"), at: at(40) }, "each topic carries its latest reply");
  assert.equal(active.items[2].lastReply, null);
  assert.deepEqual(store.listTopics({ ...page, board: "qa", sort: "newest" }).items.map((x) => x.id), [c.id, a.id]);
  assert.deepEqual(store.listTopics({ ...page, author: reader("r1") }).items.map((x) => x.id), [a.id]);
  const paged = store.listTopics({ sort: "newest", page: 2, pageSize: 2 });
  assert.deepEqual([paged.items.map((x) => x.id), paged.total], [[a.id], 3]);

  const detail = store.topic(a.id);
  assert.equal(detail.body, "正文\n第二行");
  assert.deepEqual(detail.replies.map((x) => x.body), ["回复一", "回复二"]);
  const summary = store.summary({ limit: 5, now: Date.parse(at(60)) });
  assert.deepEqual(summary.boards, {
    qa: { topics: 2, repliesToday: 2, latest: { id: a.id, title: "第一个问题", lastActivityAt: at(40) } },
    tools: { topics: 1, repliesToday: 0, latest: { id: b.id, title: "工具推荐", lastActivityAt: at(10) } },
  });
  assert.equal(store.summary({ hiddenBoard: "tools", now: Date.parse(at(60)) }).boards.tools, undefined, "a hidden board is left out");
  assert.equal(summary.hot[0].id, a.id, "the topic with replies is the hottest");
  assert.deepEqual(store.authorStats(reader("r2")), { topics: 1, replies: 1, likes: 0, accepted: 0, featured: 0 });
  assert.deepEqual(store.related({ id: a.id, board: "qa" }).map((x) => x.id), [c.id]);
  assert.deepEqual(store.postedToday(reader("r2"), Date.parse(at(60))), { topics: 1, replies: 1 });

  assert.equal(store.deleteReply(second.id, { now: at(50) }), true);
  assert.equal(store.topic(a.id).replyCount, 1);
  assert.equal(store.deleteTopic(b.id, { now: at(60) }), true);
  assert.equal(store.topic(b.id), null);
  assert.throws(() => store.addReply({ topicId: b.id, author: reader("r1"), body: "晚了", now: at(70) }), /不存在/);
  assert.equal(store.deleteTopic("missing"), false);
});

test('titled posts expose a bounded body preview without returning their complete body', async (t) => {
  const store = await open(t);
  const body = '记录光影与构图。'.repeat(80);
  const created = post(store, reader('r1'), { board: 'showcase', title: '一组星空练习', body });
  const listed = store.listTopics(page).items.find(item => item.id === created.id);
  assert.equal(listed.excerpt, body.slice(0, 320));
  assert.equal(listed.body, undefined);
  assert.equal(store.topic(created.id).body, body, 'the complete body remains available in the authorized detail view');
});

test("moments have no title: lists show the start of the text instead", async (t) => {
  const store = await open(t);
  const long = "今天终于把工作流跑通了，".repeat(5);
  const moment = post(store, reader("r1"), { board: "moments", title: "", body: long });
  const listed = store.listTopics(page).items[0];
  assert.equal(listed.id, moment.id);
  assert.equal(listed.title, [...long].slice(0, 36).join("") + "…");
  assert.equal(listed.excerpt, long);
  assert.equal(store.topic(moment.id).rawTitle, "");
});

test("search matches titles and bodies, treats % and _ literally, and respects the board", async (t) => {
  const store = await open(t);
  const a = post(store, reader("r1"), { title: "ComfyUI 人脸崩了", body: "显存 100% 占满" });
  const b = post(store, reader("r1"), { board: "tools", title: "推荐工具", body: "comfyui 插件合集" });
  post(store, reader("r1"), { title: "别的问题", body: "显存 1000 够不够" });
  const ids = (options) => store.listTopics({ ...page, sort: "newest", ...options }).items.map((x) => x.id).sort();
  assert.deepEqual(ids({ query: "comfyui" }), [a.id, b.id].sort(), "title or body, ignoring ASCII case");
  assert.deepEqual(ids({ query: "comfyui", board: "tools" }), [b.id]);
  assert.deepEqual(ids({ query: "100%" }), [a.id], "% is a literal character");
  assert.deepEqual(ids({ query: "_" }), [], "_ is a literal character");
  assert.equal(ids({}).length, 3);
});

test("星尘: posting and replying earn within their daily counts and the shared cap; deletions take it back", async (t) => {
  const store = await open(t);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(post(store, reader("r1"), { title: `主题 ${i} 标题`, now: at(i) }));
  assert.deepEqual(ids.map((x) => x.earned), [2, 0, 0, 0], "only the first topic a day earns");
  assert.equal(store.addReply({ topicId: ids[0].id, author: reader("r1"), body: "自己帖子里的长回复内容", now: at(5) }).earned, 0, "not on your own topic");
  assert.equal(store.addReply({ topicId: ids[0].id, author: reader("r2"), body: "短", now: at(6) }).earned, 0, "too short to count");
  const good = store.addReply({ topicId: ids[0].id, author: reader("r2"), body: "这是一条足够长的有效回复", now: at(7) });
  assert.equal(good.earned, 1);
  store.deleteReply(good.id, { now: at(8) });
  assert.equal(store.ledger.balance(reader("r2")), 0, "a deleted reply loses its 星尘");
  store.deleteTopic(ids[1].id, { moderated: true, now: at(9) });
  assert.equal(store.ledger.balance(reader("r1")), 0, "the moderation penalty stops at zero");
  assert.equal(store.members.inbox(reader("r1")).find((notice) => notice.type === "penalty").data.penalty, 20);

  for (let i = 0; i < 12; i++) {
    const q = post(store, reader(`q${i}`), { now: at(10) });
    store.accept(store.addReply({ topicId: q.id, author: reader("helper"), body: "一个足够长的有用回答内容", now: at(11) }).id, at(12));
  }
  assert.equal(store.ledger.balance(reader("helper")), 4, "reply and acceptance each award only once a day");
  assert.equal(store.ledger.behaviourToday(reader("helper"), Date.parse(at(13))), 4);
  assert.equal(store.ledger.gainedToday(reader("helper"), Date.parse(at(13))), 4);
});

test("感谢, 采纳 and 精华 move 星尘 as the design says", async (t) => {
  const store = await open(t);
  const q = post(store, reader("asker"));
  assert.throws(() => store.thank({ kind: "topic", id: q.id }, reader("fan"), reader("asker"), at(1)), /星尘不足/);
  store.ledger.credit(reader("fan"), 10, 'test', null, at(1));
  assert.equal(store.ledger.balance(reader("fan")), 10);
  assert.deepEqual(store.thank({ kind: "topic", id: q.id }, reader("fan"), reader("asker"), at(2)), { balance: 0, thanks: 1 });
  assert.equal(store.ledger.balance(reader("asker")), 2 + 8, "the author gets 8 of the 10");
  assert.equal(store.thanked({ kind: "topic", id: q.id }, reader("fan")), true);
  assert.throws(() => store.thank({ kind: "topic", id: q.id }, reader("fan"), reader("asker"), at(3)), /已经感谢过/);
  assert.throws(() => store.thank({ kind: "topic", id: q.id }, reader("asker"), reader("asker"), at(3)), /不能感谢自己/);

  const answer = store.addReply({ topicId: q.id, author: reader("helper"), body: "试试降低 IPAdapter 的权重", now: at(4) });
  assert.equal(store.accept(answer.id, at(5)), 3);
  assert.equal(store.topic(q.id).acceptedReplyId, answer.id);
  assert.equal(store.listTopics(page).items[0].solved, true);
  assert.throws(() => store.accept(answer.id, at(6)), /已经采纳/);
  assert.equal(store.ledger.balance(reader("helper")), 1 + 3);

  assert.equal(store.setFeatured(q.id, true, { actor: owner, now: at(7) }), true);
  assert.equal(store.ledger.balance(reader("asker")), 10 + 15);
  assert.equal(store.setFeatured(q.id, true, { now: at(7) }), false, "already featured");
  assert.equal(store.setFeatured(q.id, false, { now: at(8) }), true);
  assert.equal(store.ledger.balance(reader("asker")), 10, "removing 精华 takes the 15 back");
  assert.equal(store.setPinned(q.id, true), true);
  assert.equal(store.topic(q.id).pinned, true);
  const history = store.ledger.history(reader("asker"));
  assert.deepEqual(history.map((row) => row.reason), ["revert", "featured", "thank-in", "topic"]);
  assert.equal(history[1].reverted, true);
  assert.deepEqual(store.ledger.history(reader("asker"), { flow: "out" }).map((row) => row.reason), ["revert"]);
  assert.deepEqual(store.ledger.month(reader("asker"), Date.parse(at(9))), { gained: 25, spent: 15 });
});

test("likes never issue 星尘 and merge into one notice", async (t) => {
  const store = await open(t);
  const a = post(store, reader("author"));
  const b = post(store, reader("author"), { title: "另一个问题标题", now: at(1) });
  assert.throws(() => store.like({ kind: "topic", id: a.id }, reader("author"), true), /不能给自己点赞/);
  assert.equal(store.like({ kind: "topic", id: a.id }, reader("newbie"), true, { rewarding: false, now: at(2) }).earned, 0, "a first-light like gives nothing");
  assert.deepEqual(store.like({ kind: "topic", id: a.id }, reader("fan"), true, { rewarding: true, now: at(3) }), { likes: 2, liked: true, earned: 0 });
  assert.equal(store.like({ kind: "topic", id: b.id }, reader("fan"), true, { rewarding: true, now: at(4) }).earned, 0, "the same pair pays once a day");
  assert.deepEqual(store.like({ kind: "topic", id: a.id }, reader("fan"), false, { now: at(5) }), { likes: 1, liked: false, earned: 0 });
  assert.equal(store.like({ kind: "topic", id: a.id }, reader("fan"), true, { rewarding: true, now: at(6) }).earned, 0, "liking again pays nothing more");
  assert.equal(store.ledger.balance(reader("author")), 2);
  const likes = store.members.inbox(reader("author")).filter((notice) => notice.type === "like");
  assert.deepEqual(likes.map((notice) => [notice.topicId, notice.count]).sort(), [[a.id, 3], [b.id, 1]].sort(), "likes on one topic in a day are one notice");
});

test('likes never mint currency across accounts, targets or Beijing days', async t => {
  const store = await open(t);
  const author = reader('author'), fan = reader('fan');
  const a = post(store, author), b = post(store, author, { title: '同作者另一个主题' });
  const question = post(store, reader('asker'));
  const reply = store.addReply({ topicId: question.id, author, body: '这是作者在另一个问题中的有效回复', now: at(1) });
  const like = (target, member = fan, now = at(2)) => store.like(target, member, true, { rewarding: true, now });
  const unlike = target => store.like(target, fan, false, { now: at(3) });
  const aTarget = { kind: 'topic', id: a.id }, bTarget = { kind: 'topic', id: b.id }, replyTarget = { kind: 'reply', id: reply.id };
  assert.equal(like(aTarget).earned, 0);
  unlike(aTarget);
  assert.equal(like(bTarget).earned, 0, 'cancel then like another topic must not issue another reward');
  unlike(bTarget);
  assert.equal(like(replyTarget).earned, 0, 'topic and reply rewards share the same account pair');
  assert.equal(like(bTarget, reader('different-fan')).earned, 0, 'another liker also gives no stars');
  const otherAuthor = post(store, reader('different-author'));
  assert.equal(like({ kind: 'topic', id: otherAuthor.id }).earned, 0, 'another author also gets no like stars');
  unlike(replyTarget);
  const tomorrow = '2026-09-30T16:00:00.000Z';
  assert.equal(like(replyTarget, fan, tomorrow).earned, 0, 'a new day does not enable like awards');
  store.like(replyTarget, fan, false, { now: tomorrow });
  assert.equal(like(aTarget, fan, '2026-10-01T16:00:00.000Z').earned, 0, 'a previously rewarded content like can never reward again');
});

test("likes, bookmarks, views, tags, edits and reports", async (t) => {
  const store = await open(t);
  const a = post(store, reader("r1"), { board: "tools", title: "工具推荐", body: "一个好用的工具推荐", tags: ["效率", "Cursor"] });
  const b = post(store, reader("r2"), { board: "tools", title: "另一个", body: "另一个好用的工具", tags: ["Claude"], now: at(1) });
  assert.equal(store.like({ kind: "topic", id: a.id }, reader("r2"), true, { now: at(2) }).likes, 1);
  assert.equal(store.like({ kind: "topic", id: a.id }, reader("r2"), true, { now: at(2) }).likes, 1, "liking twice counts once");
  assert.equal(store.liked({ kind: "topic", id: a.id }, reader("r2")), true);
  assert.equal(store.like({ kind: "topic", id: a.id }, reader("r2"), false).likes, 0);
  store.like({ kind: "topic", id: a.id }, reader("r3"), true, { now: at(3) });
  assert.equal(store.bookmark(a.id, reader("r3"), true, at(3)), 1);
  store.bookmark(b.id, reader("r3"), true, at(4));
  assert.deepEqual(store.bookmarks(reader("r3")), [b.id, a.id], "newest bookmark first");
  store.view(a.id, reader("r3"), Date.parse(at(5)));
  store.view(a.id, reader("r3"), Date.parse(at(6)));
  store.view(a.id, reader("r4"), Date.parse(at(6)));
  const listedA = store.listTopics(page).items.find((x) => x.id === a.id);
  assert.deepEqual([listedA.likes, listedA.views, listedA.tags], [1, 2, ["效率", "Cursor"]], "views count people per day");
  assert.deepEqual(store.listTopics({ ...page, tag: "Claude" }).items.map((x) => x.id), [b.id]);
  assert.equal(store.authorStats(reader("r1")).likes, 1);

  store.editTopic(a.id, { title: "工具推荐（更新）", body: "更新后的推荐内容", tags: ["效率"], editor: reader("r1"), now: at(7) });
  const edited = store.topic(a.id);
  assert.deepEqual([edited.title, edited.body, edited.tags, edited.edited], ["工具推荐（更新）", "更新后的推荐内容", ["效率"], true]);
  store.retag(a.id, ["效率", "Claude"], reader("keeper"), at(8));
  assert.deepEqual(store.topic(a.id).tags, ["效率", "Claude"]);
  const reply = store.addReply({ topicId: a.id, author: reader("r2"), body: "原来的回复", now: at(8) });
  store.editReply(reply.id, { body: "改过的回复", editor: reader("r2"), now: at(9) });
  assert.deepEqual([store.topic(a.id).replies[0].body, store.topic(a.id).replies[0].edited], ["改过的回复", true]);

  store.report({ target: { kind: "topic", id: b.id }, reporter: reader("r1"), reason: "垃圾广告 / 引流", now: at(10) });
  assert.throws(() => store.report({ target: { kind: "topic", id: b.id }, reporter: reader("r1"), reason: "其他", now: at(10) }), /已经举报/);
  const second = store.report({ target: { kind: "topic", id: b.id }, reporter: reader("r3"), reason: "其他", now: at(11) });
  const onReply = store.report({ target: { kind: "reply", id: reply.id }, reporter: reader("r1"), reason: "人身攻击", now: at(12) });
  assert.equal(store.openReports().length, 3);
  assert.deepEqual(store.resolveReport(onReply.id, false, at(13)), { removed: false });
  assert.deepEqual(store.resolveReport(second.id, true, at(14)), { removed: true });
  assert.equal(store.topic(b.id), null, "an upheld report removes the content");
  assert.equal(store.openReports().length, 0, "every open report on it closes");
  assert.equal(store.ledger.balance(reader("r3")), 0, "upheld reports do not mint stars");
  assert.ok(store.members.inbox(reader("r3")).some((notice) => notice.data.report === "upheld"));
  assert.throws(() => store.resolveReport(second.id, true, at(15)), /已经处理/);
});

test("trust levels: earned from visits, reading, posting, likes and replies; recomputed once a day; 守夜 falls back", async (t) => {
  const store = await open(t);
  const me = reader("climber");
  const day0 = Date.parse("2026-09-01T02:00:00Z");
  const on = (d) => day0 + d * 86400e3;
  const iso = (d) => new Date(on(d)).toISOString();
  assert.equal(store.members.level(me, on(0)), 0);
  for (let d = 0; d < 3; d++) store.members.visit(me, on(d));
  const topics = [];
  for (let i = 0; i < 20; i++) topics.push(post(store, reader(`writer${i}`), { title: `别人的主题 ${i}`, now: iso(0) }));
  for (const topic of topics) store.view(topic.id, me, on(2));
  assert.equal(store.members.level(me, on(2)), 0, "no published topic yet");
  post(store, me, { now: iso(2) });
  assert.equal(store.members.level(me, on(2)), 0, "recomputed only once a day");
  assert.equal(store.members.level(me, on(3)), 1, "巡天 the next day");
  assert.equal(store.members.inbox(me).find((notice) => notice.type === "level").data.level, 1);
  const progress = store.members.levelProgress(me, 1, on(3));
  assert.deepEqual(progress.rows.map((row) => [row.key, row.need]), [["visitDays", 15], ["likesRecv", 10], ["distinctReplies", 10]]);
  assert.equal(progress.rows[0].have, 3);

  // 观测: 15 visit days, 10 likes, replies in 10 topics, no violation in 30 days.
  for (let d = 3; d < 15; d++) store.members.visit(me, on(d));
  const mine = post(store, me, { title: "我的第二个主题", now: iso(14) });
  for (let i = 0; i < 10; i++) {
    store.like({ kind: "topic", id: mine.id }, reader(`liker${i}`), true, { now: iso(14) });
    store.addReply({ topicId: topics[i].id, author: me, body: "认真的回复内容写在这里", now: iso(14) });
  }
  assert.equal(store.members.level(me, on(15)), 2);
  // 守夜: 40 visits in 100 days, 50 likes, and a 精华 or three accepted answers.
  for (let d = 15; d < 45; d++) store.members.visit(me, on(d));
  for (let i = 10; i < 50; i++) store.like({ kind: "topic", id: mine.id }, reader(`liker${i}`), true, { now: iso(44) });
  store.setFeatured(mine.id, true, { now: iso(44) });
  assert.equal(store.members.level(me, on(45)), 3);
  store.setFeatured(mine.id, false, { now: iso(45) });
  assert.equal(store.members.level(me, on(46)), 2, "falls back to 观测 when 守夜 lapses");
  store.members.mute(me, 1, "人身攻击", owner, on(46));
  assert.equal(store.members.level(me, on(47)), 2, "观测 stays once earned");
  store.members.setSteward(me, true);
  assert.equal(store.members.level(me, on(47)), 4, "协管 is appointed");
  assert.deepEqual(store.members.stewards(), [me]);
  store.members.setSteward(me, false);
  assert.equal(store.members.level(me, on(47)), 2);
  assert.equal(store.members.level(owner), 4);
});

test('natural-month attendance pays one daily and five once for 28, 29, 30 and 31 days', async (t) => {
  const store = await open(t);
  for (const [month, length] of [['2027-02', 28], ['2028-02', 29], ['2026-04', 30], ['2026-12', 31]]) {
    const me = reader(month);
    for (let d = 1; d <= length; d++) {
      const now = Date.parse(`${month}-${String(d).padStart(2, '0')}T04:00:00Z`);
      assert.equal(store.economy.nextCheckinReward(me, now).total, d === length ? 6 : 1);
      const result = store.economy.checkin(me, { now, vip: true });
      assert.equal(result.reward, d === length ? 6 : 1);
      assert.equal(result.bonus, d === length ? 5 : 0);
      assert.throws(() => store.economy.checkin(me, { now }), /已经签到/);
    }
    assert.equal(store.ledger.balance(me), length + 5);
    const bonus = store.ledger.history(me).filter(row => row.reason === 'checkin-month');
    assert.equal(bonus.length, 1);
    assert.deepEqual(bonus[0].ref, { kind: 'month', id: month });
    assert.equal(bonus[0].amount, 5);
    const nextDay = Date.parse(`${month}-${length}T04:00:00Z`) + 86400e3;
    assert.equal(store.economy.nextCheckinReward(me, nextDay).total, 1, 'new month resets bonus eligibility');
    assert.equal(store.economy.checkin(me, { now: nextDay }).reward, 1);
  }
});

test('a makeup can complete the previous calendar month and grants its bonus only once', async (t) => {
  const store = await open(t), me = reader('monthly-makeup');
  for (let d = 1; d <= 30; d++) {
    if (d === 28) continue;
    store.economy.checkin(me, { now: Date.parse(`2026-04-${String(d).padStart(2, '0')}T04:00:00Z`) });
  }
  assert.equal(store.ledger.balance(me), 29, 'missing a day means no monthly bonus');
  const now = Date.parse('2026-05-01T04:00:00Z');
  assert.equal(store.economy.checkin(me, { now }).reward, 1);
  const result = store.economy.makeup(me, '2026-04-28', { vip: true, now });
  assert.equal(result.bonus, 5);
  assert.equal(result.balance, 35, 'makeup grants the full-month bonus, not missed daily income');
  assert.throws(() => store.economy.makeup(me, '2026-04-28', { vip: true, now }), /漏掉的日子/);
  assert.equal(store.ledger.history(me).filter(row => row.reason === 'checkin-month').length, 1);
  assert.equal(store.economy.monthBonus(me, '2026-04'), 5);
  assert.equal(store.economy.monthBonus(me, '2026-05'), 0);
});

test("签到 and 补签: streaks from the actual days, bonuses, early birds, badges and the monthly allowance", async (t) => {
  const store = await open(t);
  const me = reader("r1");
  const start = Date.parse("2026-09-01T16:30:00Z"); // 2026-09-02 00:30 Beijing time
  const first = store.economy.checkin(me, { now: start });
  assert.deepEqual([first.streak, first.reward, first.bonus, first.position], [1, 1, 0, 1]);
  assert.throws(() => store.economy.checkin(me, { now: start + 3600e3 }), /已经签到/);
  const rewards = [first.reward];
  for (let d = 1; d < 30; d++) rewards.push(store.economy.checkin(me, { now: start + d * 86400e3 }).reward);
  assert.deepEqual([rewards[6], rewards[13], rewards[27], rewards[29]], [1, 1, 1, 1]);
  assert.equal(store.ledger.balance(me), 30, "a streak spanning incomplete calendar months earns no monthly bonus");
  assert.deepEqual(store.members.badges(me), [], "new grants do not fabricate legacy history");
  const checkinHonors = store.members.badgeState(me, { now: start + 29 * 86400e3 });
  assert.deepEqual(checkinHonors.families.slice(0, 2).map(item => item.tier), ["gold", "gold"]);
  assert.equal(store.economy.checkin(reader("v"), { vip: true, now: start }).reward, 1);
  assert.equal(store.economy.checkinsToday(start), 2);
  assert.deepEqual(store.economy.earlyBirds(start).map((bird) => bird.member.id), ["r1", "v"]);
  assert.deepEqual(store.economy.checkinDays(me, "2026-09-01", "2026-09-04"), ["2026-09-02", "2026-09-03", "2026-09-04"]);

  // Two days missed, then made up: the streak reconnects and no check-in reward is paid.
  const later = start + 32 * 86400e3;
  store.ledger.credit(me, 100, 'test', null, new Date(later).toISOString());
  store.economy.checkin(me, { now: later });
  assert.equal(store.economy.currentStreak(me, later), 1);
  const state = store.economy.makeupState(me, { now: later });
  assert.deepEqual([state.days, state.left, state.cost], [[beijingDay(later - 86400e3), beijingDay(later - 2 * 86400e3)], 2, 30]);
  const balance = store.ledger.balance(me);
  const made = store.economy.makeup(me, state.days[1], { now: later });
  assert.deepEqual([made.cost, store.ledger.balance(me)], ["stardust", balance - 30]);
  store.economy.makeup(me, state.days[0], { now: later });
  assert.equal(store.economy.currentStreak(me, later), 33, "the streak is whole again");
  assert.deepEqual(store.economy.streakRanking(later).map((entry) => [entry.member.id, entry.streak]), [["r1", 33]]);
  assert.throws(() => store.economy.makeup(me, state.days[0], { now: later }), /漏掉的日子/);
  assert.throws(() => store.economy.makeup(me, "2026-01-01", { now: later }), /漏掉的日子/);

  const vip = reader("vip");
  store.economy.checkin(vip, { vip: true, now: later - 3 * 86400e3 });
  store.economy.checkin(vip, { vip: true, now: later });
  assert.equal(store.economy.makeupState(vip, { vip: true, now: later }).allowed, 3, "VIPs get one more a month");
  assert.equal(store.economy.makeup(vip, beijingDay(later - 86400e3), { vip: true, now: later }).cost, "free", "and the first is free");
  const empty = reader("empty");
  store.economy.checkin(empty, { now: later });
  assert.throws(() => store.economy.makeup(empty, beijingDay(later - 86400e3), { now: later }), /星尘不足/);

  // A make-up card is used before 星尘.
  const carded = reader("carded");
  store.ledger.credit(carded, 100, "test", null, new Date(later).toISOString());
  store.economy.redeem(carded, "card-makeup", { level: 0, owner: false, joinedAt: null, now: later });
  store.economy.checkin(carded, { now: later });
  const before = store.ledger.balance(carded);
  assert.equal(store.economy.makeup(carded, beijingDay(later - 86400e3), { now: later }).cost, "card");
  assert.deepEqual([store.ledger.balance(carded), store.economy.inventory(carded).makeup], [before, 0]);
});

test("the shop: cards, decorations, limits, levels, stock, shipping, delivery and refunds", async (t) => {
  const store = await open(t);
  const me = reader("shopper");
  store.ledger.credit(me, 1000, "test", null, at(0));
  const ctx = { level: 0, owner: false, joinedAt: at(-100 * 24 * 60), now: Date.parse(at(1)) };
  const shipping = { name: "林间", phone: "13800138000", address: "某省某市某路 1 号" };
  store.economy.redeem(me, "card-makeup", ctx);
  store.economy.redeem(me, "card-makeup", ctx);
  assert.throws(() => store.economy.redeem(me, "card-makeup", ctx), /次数用完/);
  assert.equal(store.economy.inventory(me).makeup, 2);
  assert.throws(() => store.economy.redeem(me, "card-pin", ctx), /需要等级 L1/);
  assert.equal(store.economy.redeemState(me, store.economy.item("card-pin"), { ...ctx, owner: true }).ok, true, "the owner is above levels");
  store.economy.redeem(me, "frame-gold", { ...ctx, level: 1 });
  assert.equal(store.members.decorations(me).frame, "gold", "a new decoration is worn at once");
  assert.throws(() => store.economy.redeem(me, "frame-gold", ctx), /已拥有/);
  assert.throws(() => store.economy.equip(me, "frame", "nebula"), /还没有/);
  assert.equal(store.economy.equip(me, "frame", null).frame, null);
  assert.equal(store.economy.equip(me, "frame", "gold").frame, "gold");
  assert.throws(() => store.economy.redeem(reader("poor"), "frame-nebula", ctx), /还差 300 星尘/);

  const goods = { cat: "goods", description: "一件实物周边", stock: 1, limitPer: "year", limitN: 1, minLevel: 0, minDays: 30, delivery: "", note: "包邮", active: true };
  const bag = store.economy.saveItem(null, { ...goods, name: "帆布袋", price: 100 });
  assert.throws(() => store.economy.redeem(me, bag, { ...ctx, joinedAt: at(-10) }), /注册满 30 天/);
  assert.throws(() => store.economy.redeem(me, bag, ctx), /收货信息/);
  const order = store.economy.redeem(me, bag, { ...ctx, shipping });
  assert.deepEqual(store.economy.goodsOrders()[0].shipping, shipping, "the owner sees where to ship");
  assert.equal(store.economy.orders(me)[0].shipping, undefined, "the member's own list carries no shipping details");
  assert.throws(() => store.economy.redeem(reader("other"), bag, ctx), /已兑完/);
  store.economy.ship(order.order);
  assert.equal(store.economy.goodsOrders()[0].shipping, null, "shipping details are removed once shipped");
  assert.throws(() => store.economy.ship(order.order), /处理过/);

  const pens = store.economy.saveItem(null, { ...goods, name: "笔记本", price: 50, stock: 5, limitPer: null, limitN: null, minDays: 0 });
  const balance = store.ledger.balance(me);
  store.economy.cancel(store.economy.redeem(me, pens, { ...ctx, shipping }).order);
  assert.equal(store.ledger.balance(me), balance, "a cancelled order is refunded");
  assert.equal(store.economy.item(pens).left, 5, "and its stock returns");
  assert.equal(store.economy.goodsOrders().find((row) => row.item === pens).shipping, null);
  store.economy.saveItem(pens, { ...goods, name: "笔记本", price: 50, stock: 3, limitPer: null, limitN: null, minDays: 0 });
  assert.equal(store.economy.item(pens).left, 3, "changing the stock keeps what was redeemed");

  const digital = { cat: "digital", name: "提示词手册", description: "一份提示词手册", price: 20, stock: null, limitPer: null, limitN: null, minLevel: 0, minDays: 0, note: "" };
  const pack = store.economy.saveItem(null, { ...digital, delivery: "链接：https://example.com 提取码 abcd", active: true });
  assert.throws(() => store.economy.delivery(me, pack), /兑换后才能查看/);
  store.economy.redeem(me, pack, ctx);
  assert.match(store.economy.delivery(me, pack).delivery, /提取码 abcd/);
  assert.throws(() => store.economy.redeem(me, pack, ctx), /已拥有/);
  store.economy.saveItem(pack, { ...digital, delivery: "新链接", active: false });
  assert.throws(() => store.economy.redeem(reader("late"), pack, ctx), /下架/);
  assert.equal(store.economy.delivery(me, pack).delivery, "新链接", "owners of an item still see it after it is taken down");
  assert.deepEqual(store.economy.orders(me).map((row) => row.status).sort(), ["cancelled", "done", "done", "done", "done", "shipped"]);
});

test("shipping metadata rolls back with the order when resolution fails", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "sansphase-community-ship-"));
  await copyFile(resolve(template, "content.db"), resolve(directory, "content.db"));
  const store = createCommunityStore(directory);
  t.after(async () => { store.close(); await cleanup(directory); });
  const member = reader("atomic-shipper");
  store.ledger.credit(member, 100, "test", null, at(0));
  const item = store.economy.saveItem(null, { cat: "goods", name: "原子发货测试", description: "测试", price: 1, stock: 2, limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: "", note: "", active: true });
  const order = store.economy.redeem(member, item, { level: 0, owner: false, joinedAt: at(-100 * 24 * 60), now: Date.parse(at(1)), shipping: { name: "测试", phone: "13800138000", address: "某省某市某路 1 号" } });
  const db = new DatabaseSync(resolve(directory, "content.db"));
  db.exec("CREATE TRIGGER block_ship BEFORE UPDATE OF status ON community_orders WHEN NEW.status = 'shipped' BEGIN SELECT RAISE(ABORT, 'blocked ship'); END");
  db.close();
  assert.throws(() => store.economy.ship(order.order, Date.parse(at(2)), { company: "顺丰", number: "ROLLBACK-1" }), /blocked ship/);
  const row = store.economy.goodsOrders().find((entry) => entry.id === order.order);
  assert.deepEqual([row.status, row.tracking], ["pending", null]);
  assert.equal(row.shipping.phone, "13800138000");
});

test("prompt unlocks, bounties, paid pins and glowing titles", async (t) => {
  const store = await open(t);
  const artist = reader("artist"), fan = reader("fan"), asker = reader("asker"), helper = reader("helper");
  store.ledger.credit(fan, 100, "test", null, at(0));
  const work = post(store, artist, { board: "showcase", title: "一套海报作品", body: "", meta: { tools: "Midjourney", model: "v7", usage: "个人使用", prompt: "a poster", promptMode: "paid", price: 20 } });
  assert.deepEqual(store.listTopics(page).items[0].meta, { tools: "Midjourney", model: "v7", usage: "个人使用", promptMode: "paid", price: 20 }, "lists never carry the prompt");
  assert.equal(store.topic(work.id).fullMeta.prompt, "a poster");
  const unlocked = store.economy.unlock(work.id, fan, 20, artist, Date.parse(at(1)));
  assert.deepEqual([unlocked.share, unlocked.balance], [16, 80], "the author gets 80 %, the rest is burned");
  assert.throws(() => store.economy.unlock(work.id, fan, 20, artist), /已经解锁/);
  assert.deepEqual([store.economy.unlocked(work.id, fan), store.topic(work.id).unlocks], [true, 1]);

  assert.throws(() => post(store, asker, { bounty: 50 }), /星尘不足/);
  assert.equal(store.listTopics({ ...page, author: asker }).total, 0, "a refused bounty posts nothing");
  store.ledger.credit(asker, 100, "test", null, at(0));
  const question = post(store, asker, { bounty: 50, now: at(2) });
  assert.equal(store.ledger.balance(asker), 100 - 50 + 2, "the bounty is frozen");
  assert.deepEqual([store.topic(question.id).bounty, store.topic(question.id).bountyState], [50, "open"]);
  const answer = store.addReply({ topicId: question.id, author: helper, body: "一个认真的回答写在这里", now: at(3) });
  assert.equal(store.accept(answer.id, at(4)), 50 + 3, "the bounty and 3 go to the answer");
  assert.equal(store.topic(question.id).bountyState, "paid");
  const open2 = post(store, asker, { bounty: 20, title: "另一个悬赏问题", now: at(5) });
  assert.equal(store.expireBounties(Date.parse(at(5)) + 6 * 86400e3), 0);
  assert.equal(store.expireBounties(Date.parse(at(5)) + 8 * 86400e3), 1, "unclaimed after 7 days");
  assert.equal(store.topic(open2.id).bountyState, "refunded");
  assert.equal(store.members.inbox(asker).find((notice) => notice.data.refund).data.refund, 10);
  const third = post(store, asker, { bounty: 20, title: "第三个悬赏问题", now: at(6) });
  const before = store.ledger.balance(asker);
  store.deleteTopic(third.id, { now: at(7) });
  assert.equal(store.ledger.balance(asker), before + 10, "the third topic earned nothing; half its bounty is refunded");

  // Paid pins are timed against the real clock, as lists are.
  const now = Date.now();
  const resource = { url: "https://example.com", kind: "软件", price: "免费", platform: "" };
  const tool = post(store, artist, { board: "tools", title: "一个工具推荐", body: "", resource });
  assert.throws(() => store.economy.paidPin(tool.id, artist, now), /星尘不足/);
  store.ledger.credit(artist, 400, "test", null, at(0));
  assert.equal(store.economy.paidPin(tool.id, artist, now).card, false);
  const pinned = store.listTopics({ ...page, board: "tools" }).items.find((x) => x.id === tool.id);
  assert.deepEqual([pinned.paidPin, pinned.pinned], [true, false]);
  assert.throws(() => store.economy.paidPin(tool.id, artist, now + 60e3), /已经有推荐/);
  const other = post(store, fan, { board: "tools", title: "另一个工具推荐", body: "", resource: { ...resource, url: "https://example.org" } });
  store.ledger.credit(fan, 400, "test", null, at(0));
  assert.throws(() => store.economy.paidPin(other.id, fan, now + 60e3), /已经有一个推荐位/);
  assert.throws(() => store.economy.paidPin(question.id, asker, now), /只有作品帖和资源帖/);
  assert.throws(() => store.economy.paidPin(other.id, artist, now), /只能推荐自己/);
  assert.equal(store.economy.paidPin(other.id, fan, now + 25 * 3600e3).card, false, "once the first pin ends");

  assert.throws(() => store.economy.highlight(tool.id, artist, now), /高亮卡/);
  store.economy.redeem(artist, "card-highlight", { level: 1, owner: false, joinedAt: null, now });
  store.economy.highlight(tool.id, artist, now);
  assert.equal(store.listTopics(page).items.find((x) => x.id === tool.id).glow, true);
  assert.equal(store.economy.inventory(artist).highlight, 0);
});

test("resource votes, follows, sanctions, the review queue, hiding, locking and moving", async (t) => {
  const store = await open(t);
  const tool = post(store, reader("r1"), { board: "tools", title: "一个工具推荐", body: "", resource: { url: "https://example.com", kind: "软件", price: "免费", platform: "Windows" } });
  assert.deepEqual(store.vote(tool.id, reader("r2"), "dead"), { vote: "dead", alive: 0, dead: 1 });
  assert.deepEqual(store.vote(tool.id, reader("r3"), "alive"), { vote: "alive", alive: 1, dead: 1 });
  assert.equal(store.myVote(tool.id, reader("r3")), "alive");
  assert.deepEqual(store.vote(tool.id, reader("r2"), null), { vote: null, alive: 1, dead: 0 });
  assert.deepEqual(store.listTopics(page).items[0].resource, { url: "https://example.com", kind: "软件", price: "免费", platform: "Windows", alive: 1, dead: 0 });
  assert.ok(store.members.inbox(reader("r1")).some((notice) => notice.data.dead), "the author hears the link may be dead");
  assert.throws(() => store.vote(post(store, reader("r1")).id, reader("r2"), "dead"), /资源帖/);

  assert.deepEqual(store.members.follow(reader("r2"), reader("r1"), true), { following: true, followers: 1 });
  assert.equal(store.members.following(reader("r2"), reader("r1")), true);
  assert.ok(store.members.inbox(reader("r1")).some((notice) => notice.type === "follow"));
  assert.deepEqual(store.members.followCounts(reader("r2")), { followers: 0, following: 1 });
  assert.deepEqual(store.members.followingOf(reader("r2")), [reader("r1")]);
  assert.deepEqual(store.members.follow(reader("r2"), reader("r1"), false), { following: false, followers: 0 });

  const sanction = store.members.mute(reader("r2"), 7, "人身攻击", owner);
  assert.equal(store.members.muted(reader("r2")).reason, "人身攻击");
  assert.equal(store.members.muted(reader("r2"), Date.now() + 8 * 86400e3), null, "a mute ends by itself");
  assert.equal(store.members.sanctions().length, 1);
  assert.deepEqual(store.members.lift(sanction.id), reader("r2"));
  assert.equal(store.members.muted(reader("r2")), null);
  assert.equal(store.members.lift(sanction.id), null);

  const pending = post(store, reader("new"), { title: "新人带图的帖子", pending: "初光等级，帖子带图片" });
  assert.deepEqual([pending.earned, pending.pending], [0, true]);
  assert.equal(store.listTopics(page).items.some((x) => x.id === pending.id), false, "pending topics are not listed");
  assert.equal(store.members.inbox(reader("new"))[0].data.state, "pending");
  assert.equal(store.queue().topics[0].id, pending.id);
  assert.equal(store.approveTopic(pending.id).earned, 2);
  assert.throws(() => store.approveTopic(pending.id), /不在待审/);
  assert.equal(store.queue().topics.length, 0);
  assert.deepEqual(store.members.badges(reader("new")), []);
  assert.equal(store.members.badgeState(reader("new")).families.find(item => item.id === "writing").tier, "gold");
  const rejected = post(store, reader("new"), { title: "另一个待审帖子", pending: "初光等级，帖子带链接" });
  store.deleteTopic(rejected.id, { moderated: true });
  assert.equal(store.members.inbox(reader("new"))[0].data.state, "rejected");

  const reply = store.addReply({ topicId: tool.id, author: reader("r3"), body: "广告广告广告广告", now: at(1) });
  store.report({ target: { kind: "reply", id: reply.id }, reporter: reader("r1"), reporterLevel: 2, reason: "垃圾广告 / 引流" });
  assert.equal(store.reportsFrom({ kind: "reply", id: reply.id }, 2), 1);
  assert.equal(store.reportsFrom({ kind: "reply", id: reply.id }, 3), 0);
  assert.equal(store.hide({ kind: "reply", id: reply.id }, "举报"), true);
  assert.equal(store.queue().replies[0].id, reply.id);
  assert.equal(store.topic(tool.id).replies[0].hidden, true);
  assert.equal(store.listTopics(page).items.find((x) => x.id === tool.id).lastReply, null, "a hidden reply is not the latest reply");
  const [report] = store.openReports();
  assert.deepEqual(store.resolveReport(report.id, false), { removed: false });
  assert.equal(store.queue().replies.length, 0, "dismissing the last report shows it again");
  store.hide({ kind: "topic", id: tool.id }, "举报");
  assert.equal(store.listTopics(page).items.some((x) => x.id === tool.id), false);
  store.restore({ kind: "topic", id: tool.id });
  assert.equal(store.listTopics(page).items.some((x) => x.id === tool.id), true);

  store.setLocked(tool.id, true);
  assert.throws(() => store.addReply({ topicId: tool.id, author: reader("r2"), body: "锁了还能回复吗" }), /已锁定/);
  assert.equal(store.move(tool.id, "meta"), true);
  assert.equal(store.move(tool.id, "meta"), false);
  assert.equal(store.topic(tool.id).board, "meta");
});

test("notifications: replies, quotes, accepted answers, thanks and badges; unread counts by group", async (t) => {
  const store = await open(t);
  const asker = reader("asker"), helper = reader("helper"), third = reader("third");
  const q = post(store, asker);
  const a = store.addReply({ topicId: q.id, author: helper, body: "第一个回答内容", now: at(1) });
  const quoting = store.addReply({ topicId: q.id, author: third, body: "引用上面的回答", quoteId: a.id, now: at(2) });
  assert.deepEqual(quoting.told.slice(1), [asker, helper]);
  assert.equal(store.topic(q.id).replies[1].quoteId, a.id);
  assert.throws(() => store.addReply({ topicId: q.id, author: third, body: "引用不存在的回复", quoteId: "missing" }), /引用的回复/);
  store.accept(a.id, at(3));
  store.ledger.credit(third, 20, "test", null, at(0));
  store.thank({ kind: "reply", id: a.id }, third, helper, at(4));
  const inbox = store.members.inbox(helper);
  assert.deepEqual(inbox.map((notice) => notice.type), ["thank", "badge", "accept", "reply"]);
  assert.deepEqual([inbox[3].data.kind, inbox[3].actor], ["quote", third]);
  assert.equal(inbox[2].data.amount, 3);
  assert.equal(store.members.inbox(asker).filter((notice) => notice.type === "reply").length, 2);
  assert.deepEqual(store.members.unread(helper), { all: 4, reply: 1, thanks: 2, system: 1 });
  store.members.read(helper, inbox[0].id);
  assert.equal(store.members.unread(helper).all, 3);
  assert.equal(store.members.notice(helper, inbox[0].id).topic_id, q.id);
  assert.equal(store.members.notice(asker, inbox[0].id), null, "someone else's notice is not found");
  assert.equal(store.members.readAll(helper), 3);
  assert.deepEqual(store.members.inbox(helper, "reply").map((notice) => notice.type), ["reply"]);
  assert.deepEqual(store.members.badges(helper), []);
  assert.equal(store.members.badgeState(helper).families.find(item => item.id === "answers").tier, "gold");
  store.members.notify(helper, { type: "system", actor: helper, text: "自己" });
  assert.equal(store.members.unread(helper).all, 0, "nobody is told about their own actions");
});

test("images attach to a post in order, can be swapped when editing, and stale uploads are swept", async (t) => {
  const store = await open(t);
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  for (const id of ids) store.addImage({ id, uploader: reader("r1"), width: 800, height: 600, now: at(0) });
  const meta = { tools: "Midjourney", model: "", usage: "个人使用", prompt: "", promptMode: "hidden", price: 0 };
  const topic = post(store, reader("r1"), { board: "showcase", title: "节气海报", body: "", images: [ids[1], ids[0]], meta });
  assert.deepEqual(store.topic(topic.id).images.map((x) => x.id), [ids[1], ids[0]]);
  assert.deepEqual(store.listTopics(page).items[0].thumbs, [ids[1], ids[0]]);
  assert.throws(() => post(store, reader("r2"), { images: [ids[2]] }), /图片已失效/);
  store.editTopic(topic.id, { title: "节气海报", body: "", images: [ids[2]], editor: reader("r1"), now: at(3) });
  assert.deepEqual(store.topic(topic.id).images.map((x) => x.id), [ids[2]]);
  assert.equal(store.topic(topic.id).fullMeta.tools, "Midjourney", "editing without new meta keeps the old");
  assert.ok(store.image(ids[0]).deleted_at, "an image taken out is soft-deleted");
  const stale = "44444444-4444-4444-8444-444444444444";
  store.addImage({ id: stale, uploader: reader("r1"), width: 10, height: 10, now: at(4) });
  assert.deepEqual(store.sweepImages(Date.parse(at(4)) + 23 * 3600e3), [], "a fresh upload is kept");
  assert.deepEqual(store.sweepImages(Date.parse(at(4)) + 25 * 3600e3), [stale]);
  assert.equal(store.image(stale), null);
});

test("the monthly contribution ranking and the owner's 星尘 flow", async (t) => {
  const store = await open(t);
  const now = Date.parse("2026-09-30T04:00:00Z");
  const iso = new Date(now).toISOString();
  const a = post(store, reader("a"), { now: iso });
  const b = post(store, reader("b"), { now: iso });
  const c = post(store, owner, { now: iso });
  for (const liker of ["x", "y"]) store.like({ kind: "topic", id: a.id }, reader(liker), true, { now: iso });
  store.like({ kind: "topic", id: c.id }, reader("x"), true, { now: iso });
  store.setFeatured(b.id, true, { now: iso });
  assert.deepEqual(store.members.contributions(now).map((entry) => [entry.member.id, entry.score]), [["b", 10], ["a", 2]], "the owner is not ranked");
  assert.equal(store.members.contributions(Date.parse("2026-10-05T04:00:00Z")).length, 0, "a new month starts again");
  const flow = store.ledger.flow(7, now);
  assert.equal(flow.length, 7);
  assert.deepEqual(flow.at(-1), { day: "2026-09-30", issued: 2 + 2 + 2 + 15, recovered: 0 });
  assert.equal(store.activity(now).topics24h, 3);
});
