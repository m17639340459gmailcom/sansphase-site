import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { readSiteContent } from "../src/lib/site-reader-request.ts";

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const local = ["./site-articles", "./site-publication-date", "./site-reader-request", "./site-book-position"];
    return nextResolve(local.includes(specifier) ? specifier + ".ts" : specifier, context);
  },
});
const { readSiteBooks, readSiteBook, readSiteBookPart, readSiteBookChapter } = await import("../src/lib/site-books.ts");
const { siteBookPosition, siteBookPositionQuery } = await import("../src/lib/site-book-position.ts");
hook.deregister();

const origin = "http://localhost:4315";
const cookie = "unused=private; sansphase_reader_session=reader.session; next-intl=zh; sansphase_author_session=author.session";
const id = "published-book";
const media = "/api/media/a2f300fa-e0ba-456c-a463-367762ae6c22";
const summary = { id, title: "测试书目", summary: "介绍", tags: ["样例"], category: "图书", date: "2026-10-01T16:00:00Z", vipOnly: true, coverSrc: media + "?w=960&view=content" };
const chapter = { id: "chapter-one", title: "第一章", parts: 3 };
const book = { revision: "existing-revision", chapters: [chapter] };

test("the protected request forwards only reader and owner sessions to the configured API", async () => {
  await readSiteContent(origin, new URLSearchParams({ view: "detail", id }), cookie, async (url, init) => {
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, "/api/content");
    assert.equal(url.searchParams.get("id"), id);
    assert.equal(init.headers.get("cookie"), "sansphase_reader_session=reader.session; sansphase_author_session=author.session");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.ok(init.signal instanceof AbortSignal);
    return new Response();
  });
});

test("the catalogue collects paginated published summaries, never book bodies", async () => {
  const requests = [];
  const remaining = Array.from({ length: 11 }, (_, index) => ({ ...summary, id: "extra-" + index }));
  const result = await readSiteBooks(origin, cookie, async (url) => {
    assert.equal(url.searchParams.get("kind"), "resource-center");
    assert.equal(url.searchParams.get("view"), "list");
    assert.equal(url.searchParams.has("public"), false);
    const page = Number(url.searchParams.get("page"));
    requests.push(page);
    const items = page === 1 ? [{ ...summary, bodyHTML: "<p>hidden</p>", locked: true }, ...remaining] : [{ ...summary, id: "last" }];
    return Response.json({ items, page, pages: 2, total: 13 });
  });
  assert.deepEqual(requests, [1, 2]);
  assert.equal(result.status, "ready");
  assert.equal(result.books.length, 13);
  assert.equal(result.books[0].date, "2026-10-02");
  assert.equal(result.books[0].locked, true);
  assert.equal(result.books[0].cover, summary.coverSrc);
  for (const entry of result.books) assert.equal(Object.hasOwn(entry, "bodyHTML"), false);
  const guest = await readSiteBooks(origin, null, async () => new Response(null, { status: 401 }));
  assert.deepEqual(guest, { status: "sign-in" });
});

test("book detail respects guest, missing, and active VIP eligibility from the backend", async () => {
  const load = (response) => readSiteBook(origin, cookie, id, async () => response);
  assert.deepEqual(await load(new Response(null, { status: 401 })), { status: "sign-in" });
  assert.deepEqual(await load(new Response(null, { status: 404 })), { status: "missing" });
  const locked = await load(Response.json({ code: "VIP_REQUIRED", item: { ...summary, locked: true, book, downloadUrl: media + "?download=1" } }, { status: 403 }));
  assert.equal(locked.status, "vip-required");
  assert.equal(locked.book.title, summary.title);
  assert.equal(Object.hasOwn(locked.book, "chapters"), false);
  assert.equal(Object.hasOwn(locked.book, "download"), false);
  assert.deepEqual(await load(Response.json({ item: { ...summary, id: "another-book", book } })), { status: "missing" });
  const allowed = await load(Response.json({ item: { ...summary, book, downloadUrl: media + "?download=1" } }));
  assert.equal(allowed.status, "ready");
  assert.equal(allowed.book.download, media + "?download=1");
  assert.equal(allowed.book.chapters[0].id, chapter.id);
  const withIdentity = await load(Response.json({ item: { ...summary, recordId: 381, book } }));
  assert.equal(withIdentity.book.readingKey, "381");
  assert.deepEqual(await readSiteBook(origin, cookie, "../invalid", async () => assert.fail("no request expected")), { status: "missing" });
});

test("chapter passage validates the edition and fragments before rendering body HTML", async () => {
  const fragment = { chapter: chapter.id, revision: book.revision, part: 1, parts: chapter.parts, html: "<p>第二页</p>" };
  const read = (response) => readSiteBookPart(origin, cookie, id, book.revision, chapter, 1, async (url) => {
    assert.deepEqual(Object.fromEntries(url.searchParams), { view: "book-part", kind: "resource-center", id, chapter: chapter.id, part: "1" });
    return response;
  });
  assert.deepEqual(await read(Response.json(fragment)), { status: "ready", html: fragment.html, part: 1, relocated: false });
  assert.deepEqual(await read(Response.json({ ...fragment, revision: "updated" })), { status: "changed" });
  assert.deepEqual(await read(Response.json({ ...fragment, part: 2 })), { status: "changed" });
  assert.deepEqual(await read(new Response(null, { status: 401 })), { status: "sign-in" });
  assert.deepEqual(await read(Response.json({ code: "VIP_REQUIRED" }, { status: 403 })), { status: "vip-required" });
});

test("bookmark coordinates use the existing relocation request and cannot choose an arbitrary URL", async () => {
  assert.equal(siteBookPosition("bad/block", "0"), null);
  assert.equal(siteBookPosition("block-abc", ["1", "2"]), null);
  assert.equal(siteBookPosition("block-abc", "-1"), null);
  assert.equal(siteBookPosition("block-abc", "9007199254740992"), null);
  const position = siteBookPosition("block-abc", "1072");
  assert.equal(siteBookPositionQuery(position), "block=block-abc&offset=1072");
  const result = await readSiteBookPart(origin, cookie, id, book.revision, chapter, position, async (url) => {
    assert.equal(url.searchParams.get("block"), "block-abc");
    assert.equal(url.searchParams.get("offset"), "1072");
    assert.equal(url.searchParams.get("part"), "0");
    return Response.json({ chapter: chapter.id, revision: book.revision, part: 2, parts: chapter.parts, html: "<p>原位置</p>", relocated: true });
  });
  assert.deepEqual(result, { status: "ready", html: "<p>原位置</p>", part: 2, relocated: true });
});

test("a chapter loads all its private fragments in order and restores a later bookmark", async () => {
  const requests = [];
  const position = { block: "previous-bookmark", offset: 14 };
  const result = await readSiteBookChapter(origin, cookie, id, book.revision, chapter, position, async (url, init) => {
    assert.equal(init.cache, "no-store");
    assert.match(init.headers.get("cookie"), /sansphase_reader_session=reader.session/);
    const block = url.searchParams.get("block");
    if (block) assert.equal(url.searchParams.get("offset"), "14");
    const part = block ? 2 : Number(url.searchParams.get("part"));
    requests.push(part);
    return Response.json({ chapter: chapter.id, revision: book.revision, part, parts: chapter.parts,
      html: `<p>章节片段 ${part + 1}</p>`, relocated: Boolean(block) });
  });
  assert.deepEqual(requests, [2, 0, 1]);
  assert.deepEqual(result, { status: "ready", fragments: ["<p>章节片段 1</p>", "<p>章节片段 2</p>", "<p>章节片段 3</p>"], part: 2, relocated: true });
});

test("a chapter fails closed if any fragment changes edition or access is revoked", async () => {
  const read = (error) => readSiteBookChapter(origin, cookie, id, book.revision, chapter, 0, async (url) => {
    const part = Number(url.searchParams.get("part"));
    if (part === 2 && error) return error;
    return Response.json({ chapter: chapter.id, revision: part === 2 ? "changed" : book.revision,
      part, parts: chapter.parts, html: `<p>章节片段 ${part + 1}</p>` });
  });
  assert.deepEqual(await read(), { status: "changed" });
  assert.deepEqual(await read(new Response(null, { status: 401 })), { status: "sign-in" });
  assert.deepEqual(await read(Response.json({ code: "VIP_REQUIRED" }, { status: 403 })), { status: "vip-required" });
});
