import assert from "node:assert/strict";
import test from "node:test";
import { POSTS_PER_PAGE, queryBlogPosts } from "../src/lib/blog-query.ts";

// Test-only fixtures: these are never added to the published content collection.
const posts = Array.from({ length: 25 }, (_, index) => ({
  slug: `post-${String(index + 1).padStart(2, "0")}`,
  title: `Note ${index + 1}`,
  description: index === 7 ? "A workflow for reviewing changes" : "A short development note",
  date: `2026-01-${String(index + 1).padStart(2, "0")}`,
  tags: index % 2 === 0 ? ["TypeScript", "AI"] : ["工具配置"],
}));

test("25 posts paginate as 12 / 12 / 1 with no omissions or duplicates", () => {
  assert.equal(POSTS_PER_PAGE, 12);
  const pages = [1, 2, 3].map((page) => queryBlogPosts(posts, { page }));
  assert.deepEqual(pages.map((page) => page.posts.length), [12, 12, 1]);
  assert.deepEqual(pages.map((page) => [page.start, page.end]), [[1, 12], [13, 24], [25, 25]]);
  assert.ok(pages.every((page) => page.total === 25 && page.totalPages === 3));
  const slugs = pages.flatMap((page) => page.posts.map((post) => post.slug));
  assert.equal(new Set(slugs).size, 25);
  assert.deepEqual(slugs, posts.map((post) => post.slug).toReversed());
});

test("search matches title, description, and tags, ignoring case and edge whitespace", () => {
  assert.equal(queryBlogPosts(posts, { search: " NOTE 25 " }).posts[0].slug, "post-25");
  assert.equal(queryBlogPosts(posts, { search: "reviewing changes" }).posts[0].slug, "post-08");
  assert.equal(queryBlogPosts(posts, { search: "typescript" }).total, 13);
  assert.equal(queryBlogPosts(posts, { search: "工具配置" }).total, 12);
});

test("search tokens can span fields and normalize full-width input", () => {
  assert.equal(queryBlogPosts(posts, { search: "ＮＯＴＥ 25 ＡＩ" }).posts[0].slug, "post-25");
  assert.equal(queryBlogPosts(posts, { search: "Note 25 工具配置" }).total, 0);
  assert.equal(queryBlogPosts(posts, { search: "  \t\n " }).total, 25);
});

test("filtering happens before pagination and exposes accurate filtered totals", () => {
  const first = queryBlogPosts(posts, { search: "TypeScript", page: 1 });
  const second = queryBlogPosts(posts, { search: "TypeScript", page: 2 });
  assert.equal(first.total, 13);
  assert.equal(first.posts.length, 12);
  assert.equal(second.posts.length, 1);
  assert.equal(second.start, 13);
  assert.equal(second.end, 13);
  assert.equal(second.totalPages, 2);
});

test("newest and oldest order every page by publication date", () => {
  assert.deepEqual(queryBlogPosts(posts, { sort: "newest" }).posts.map((post) => post.slug),
    posts.slice(13).toReversed().map((post) => post.slug));
  assert.deepEqual(queryBlogPosts(posts, { sort: "oldest" }).posts.map((post) => post.slug),
    posts.slice(0, 12).map((post) => post.slug));
});

test("title sorting is locale-aware and keeps numbered titles in natural order", () => {
  const english = queryBlogPosts(posts.toReversed(), { sort: "title", locale: "en" });
  assert.deepEqual(english.posts.map((post) => post.title), posts.slice(0, 12).map((post) => post.title));
  const chinesePosts = [
    { ...posts[0], title: "中间", slug: "zhong" },
    { ...posts[1], title: "阿尔法", slug: "a" },
    { ...posts[2], title: "开发", slug: "kai" },
  ];
  assert.deepEqual(queryBlogPosts(chinesePosts, { sort: "title", locale: "zh" }).posts.map((post) => post.slug),
    ["a", "kai", "zhong"]);
});

test("equal dates and titles use a stable slug tie-breaker", () => {
  const tied = ["z", "a", "m"].map((slug) => ({ ...posts[0], slug }));
  for (const sort of ["newest", "oldest", "title"]) {
    assert.deepEqual(queryBlogPosts(tied, { sort }).posts.map((post) => post.slug), ["a", "m", "z"]);
  }
});

test("out-of-range pages clamp safely, including when filtering reduces page count", () => {
  assert.equal(queryBlogPosts(posts, { page: 99 }).currentPage, 3);
  assert.equal(queryBlogPosts(posts, { page: -4 }).currentPage, 1);
  assert.equal(queryBlogPosts(posts, { page: 2.8 }).currentPage, 2);
  assert.equal(queryBlogPosts(posts, { page: Number.NaN }).currentPage, 1);
  assert.equal(queryBlogPosts(posts, { page: Number.POSITIVE_INFINITY }).currentPage, 1);
  const filtered = queryBlogPosts(posts, { search: "reviewing", page: 3 });
  assert.equal(filtered.currentPage, 1);
  assert.equal(filtered.posts[0].slug, "post-08");
});

test("empty collections and unmatched searches return a useful zero-result state", () => {
  for (const result of [queryBlogPosts([]), queryBlogPosts(posts, { search: "no-such-article", page: 3 })]) {
    assert.deepEqual(result, { posts: [], total: 0, totalPages: 1, currentPage: 1, start: 0, end: 0 });
  }
});

test("querying does not mutate the source collection or its records", () => {
  const frozen = Object.freeze(posts.map((post) => Object.freeze({ ...post, tags: Object.freeze([...post.tags]) })));
  const before = structuredClone(frozen);
  queryBlogPosts(frozen, { search: "note", sort: "oldest", page: 2 });
  assert.deepEqual(frozen, before);
});
