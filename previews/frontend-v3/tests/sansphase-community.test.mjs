import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sansphaseLinks } from "../src/data/sansphase.ts";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const community = "app/[locale]/(site)/community";
const loadDemo = () => import("../src/data/sansphase-community.ts");

test("main navigation opens a single community gateway in local and connected modes", async () => {
  assert.equal(sansphaseLinks.community, "/community");
  assert.match(await source("data/nav.ts"), /key:\s*"community",\s*href:\s*sansphaseLinks\.community/);
  const page = await source(`${community}/page.tsx`);
  assert.doesNotMatch(page, /officialSiteLinks|https?:\/\/|community-enter|\/api\/community/i);
  assert.match(page, /<CommunityEntry\b/);
  assert.match(page, /communityPublicHref\(post\)/);
  assert.doesNotMatch(page, /CommunityFeed|CommunityBoards|demoTopicSummaries|\/community\/(?:new|convention)/);
});

test("demo boards retain production categories and every public board is populated", async () => {
  const { demoBoards, demoTopics, publicDemoBoards } = await loadDemo();
  assert.deepEqual(demoBoards.map(({ id }) => id), ["qa", "showcase", "tools", "moments", "meta", "vip"]);
  assert.equal(publicDemoBoards.length, 5);
  for (const board of publicDemoBoards) {
    assert.ok(board.name.zh && board.name.en && board.description.zh && board.description.en);
    assert.ok(demoTopics.some((topic) => topic.board === board.id), board.id);
  }
  assert.equal(demoTopics.some((topic) => topic.board === "vip"), false);
});

test("demo topics, replies and cross-page targets are internally consistent", async () => {
  const { demoTopics, communityTopicHref, communityBoardHref, getDemoTopic } = await loadDemo();
  assert.ok(demoTopics.length >= 8);
  assert.equal(new Set(demoTopics.map((topic) => topic.id)).size, demoTopics.length);
  for (const topic of demoTopics) {
    assert.equal(getDemoTopic(topic.id), topic);
    assert.equal(communityTopicHref(topic.id), `/community/post/${topic.id}`);
    assert.equal(communityBoardHref(topic.board), `/community/boards/${topic.board}`);
    assert.equal(topic.body.zh.length, topic.body.en.length);
    assert.ok(topic.body.zh.length >= 2, topic.id);
    assert.ok(topic.replies.length, topic.id);
    assert.ok(topic.tags.length, topic.id);
    assert.ok(topic.title.zh && topic.title.en && topic.excerpt.zh && topic.excerpt.en, topic.id);
    if (topic.related) assert.match(topic.related.href, /^\/(?:learning|resources|projects|blog)(?:\/|$)/);
    if (topic.cover) await readFile(new URL(`../public${topic.cover.src}`, import.meta.url));
  }
  assert.equal(getDemoTopic("missing-topic"), undefined);
});

test("feed filters both languages, handles empty results and sorts newest replies", async () => {
  const { demoTopics, selectDemoTopics } = await loadDemo();
  const getIds = (options) => selectDemoTopics(demoTopics, options).map(({ id }) => id);
  assert.deepEqual(getIds({ locale: "zh", query: "片尾 字幕" }), ["captions-path"]);
  assert.deepEqual(getIds({ locale: "en", query: " blue HOUR  " }), ["blue-hour-test"]);
  assert.deepEqual(getIds({ locale: "zh", query: "不存在的筛选" }), []);
  assert.deepEqual(getIds({ locale: "zh", board: "vip" }), []);
  const featured = selectDemoTopics(demoTopics, { locale: "zh", sort: "featured" });
  assert.equal(featured.length, demoTopics.filter((topic) => topic.featured).length);
  const active = selectDemoTopics(demoTopics, { locale: "zh", sort: "active" });
  const latest = active.map((topic) => topic.replies.at(-1).date);
  assert.deepEqual(latest, [...latest].sort().reverse());
});

test("board, thread, convention and composer routes all live under the locale segment", async () => {
  const demo = `${community}/(demo)`;
  const layout = await source(`${demo}/layout.tsx`);
  assert.match(layout, /await connection\(\);[\s\S]*?siteBackendOrigin\(\)[\s\S]*?redirect\(localizedPath\(locale, "\/community"\)\)/);
  const pages = await Promise.all([
    "boards/[board]/page.tsx",
    "post/[slug]/page.tsx",
    "new/page.tsx",
    "convention/page.tsx",
  ].map((leaf) => source(`${demo}/${leaf}`)));
  for (const page of pages) assert.doesNotMatch(page, /officialSiteLinks|community-enter|\/api\/community|\bfetch\s*\(/i);
  for (const page of pages.slice(0, 2)) assert.match(page, /generateStaticParams/);
});
