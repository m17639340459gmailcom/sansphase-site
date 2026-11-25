import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { parseSiteBackendOrigin } from "../src/lib/site-backend.ts";

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "./site-publication-date" ? specifier + ".ts" : specifier, context);
  },
});
const { readSiteArticle, siteArticleMeta } = await import("../src/lib/site-articles.ts");
hook.deregister();

const origin = "http://127.0.0.1:4315";
const article = {
  id: "existing-article",
  title: "原有文章",
  summary: "原摘要",
  date: "2026-10-01T16:00:00Z",
  tags: ["资料", "资料"],
  coverSrc: "/api/media/a2f300fa-e0ba-456c-a463-367762ae6c22?w=960&view=content",
  coverWidth: 800,
  coverHeight: 600,
  bodyHTML: "<h2>目录</h2><p>原正文</p><h2>目录</h2>",
  attachments: [
    { name: "资料", url: "/api/media/a2f300fa-e0ba-456c-a463-367762ae6c22?download=1" },
    { name: "草稿附件", url: "/api/media/a2f300fa-e0ba-456c-a463-367762ae6c22?download=1&preview=private" },
    { name: "外站", url: "https://example.test/file" },
  ],
};

test("the backend origin is explicit, and invalid configuration fails closed", () => {
  assert.equal(parseSiteBackendOrigin(undefined), null);
  assert.equal(parseSiteBackendOrigin(origin), origin);
  assert.equal(parseSiteBackendOrigin("https://stage.example.test"), "https://stage.example.test");
  for (const value of ["http://example.test", "https://host.example.test/path", "https://user@host.example.test", "https://stage.example.test/?test=1"]) {
    assert.throws(() => parseSiteBackendOrigin(value), /site backend origin/i);
  }
});

test("published article lookup uses the existing public endpoint with fresh anonymous reads", async () => {
  const post = await readSiteArticle(origin, "en", article.id, async (url, options) => {
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, "/api/content");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      view: "detail", kind: "notes", public: "1", id: article.id,
    });
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    return Response.json({ item: article });
  });
  assert.equal(post.title, article.title);
  assert.equal(post.locale, "zh");
  assert.equal(post.date, "2026-10-02");
  assert.equal(post.cover, article.coverSrc);
  assert.deepEqual(post.coverSize, { width: 800, height: 600 });
  assert.deepEqual(post.tags, ["资料"]);
  assert.deepEqual(post.attachments, article.attachments.slice(0, 1));
  assert.equal(post.bodyHTML, article.bodyHTML);
});

test("missing, private, and mismatched records cannot resolve to a different article", async () => {
  for (const status of [401, 403, 404]) {
    assert.equal(await readSiteArticle(origin, "zh", article.id, async () => new Response(null, { status })), null);
  }
  for (const item of [{ ...article, id: "another" }, { ...article, locked: true }]) {
    assert.equal(await readSiteArticle(origin, "zh", article.id, async () => Response.json({ item })), null);
  }
  assert.equal(await readSiteArticle(origin, "zh", "../invalid", async () => assert.fail("unexpected request")), null);
  await assert.rejects(readSiteArticle(origin, "zh", article.id, async () => new Response(null, { status: 503 })), /article service unavailable/i);
});

test("catalog metadata keeps existing IDs and excludes invalid or restricted entries", () => {
  assert.equal(siteArticleMeta({ ...article, en: "English", coverSrc: "//example.test/cover.jpg" }, "en")?.title, "English");
  assert.equal(siteArticleMeta({ ...article, coverSrc: "//example.test/cover.jpg" }, "zh")?.cover, "/share/cover.jpg");
  assert.equal(siteArticleMeta({ ...article, locked: true }, "zh"), null);
  assert.equal(siteArticleMeta({ ...article, date: "unknown" }, "zh"), null);
});
