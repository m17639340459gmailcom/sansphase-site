import assert from "node:assert/strict";
import test from "node:test";
import { loadLocalBookDraft, loadLocalBookChapter, planLocalBookMediaRequest } from "../src/lib/local-book-preview.ts";

const backend = new URL("http://localhost:4313");
const id = "01234567-89ab-cdef-8123-456789abcdef";
const owner = "author-test-session";
const draft = {
  recordId: id, previewId: id, id: "private-book", title: "草稿", summary: "概览",
  category: "教程", vipOnly: true, coverSrc: `/api/author/media/${id}?w=960`,
  book: { revision: "draft-revision", chapters: [{ id: "chapter-one", title: "第一章", parts: 2 }] },
};

test("loads a draft with only the author cookie and without caching or forwarding redirects", async () => {
  const stub = async (url, options) => {
    assert.equal(url.origin, backend.origin);
    assert.equal(url.pathname, "/api/content");
    assert.equal(url.searchParams.get("preview"), id);
    assert.equal(url.searchParams.get("previewKind"), "resource-center");
    assert.deepEqual(options.headers, { Cookie: `sansphase_author_session=${owner}` });
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    return Response.json({ preview: draft, unrelated: "not part of the preview" });
  };
  assert.deepEqual(await loadLocalBookDraft(backend, owner, id, stub), draft);
  const denyNetwork = () => { assert.fail("unauthorized or malformed input must stay local"); };
  for (const args of [[null, owner, id], [backend, "", id], [backend, `${owner}; x=other`, id], [backend, owner, "../private-book"]]) {
    assert.equal(await loadLocalBookDraft(...args, denyNetwork), null);
  }
  for (const status of [401, 403, 404]) {
    assert.equal(await loadLocalBookDraft(backend, owner, id, async () => new Response(null, { status })), null);
  }
  assert.equal(await loadLocalBookDraft(backend, owner, id, async () => Response.json({ preview: { ...draft, previewId: "wrong" } })), null);
});

test("loads fragments of only the selected chapter and rejects a mixed draft revision", async () => {
  const requested = [];
  const chapter = draft.book.chapters[0];
  const results = async (url) => {
    assert.equal(url.searchParams.get("preview"), id);
    assert.equal(url.searchParams.get("view"), "book-part");
    assert.equal(url.searchParams.get("id"), draft.id);
    assert.equal(url.searchParams.get("chapter"), chapter.id);
    const part = Number(url.searchParams.get("part"));
    requested.push(part);
    return { revision: draft.book.revision, chapter: chapter.id, part, parts: 2, html: `<p>第 ${part + 1} 部分</p>` };
  };
  assert.equal(await loadLocalBookChapter(backend, owner, draft, chapter, async (url) => Response.json(await results(url))), "<p>第 1 部分</p><p>第 2 部分</p>");
  assert.deepEqual(requested, [0, 1]);
  assert.equal(await loadLocalBookChapter(backend, owner, draft, chapter, async (url) => {
    const result = await results(url);
    return Response.json(result.part === 1 ? { ...result, revision: "new-draft" } : result);
  }), null);
});

test("private preview media is limited to local authorized image and file reads", () => {
  const media = `/api/author/media/${id}`;
  const req = (pathname = media, search = "?w=960&view=content", method = "GET", host = "localhost:4308") => ({
    method, pathname, search,
    headers: new Headers({ host, cookie: `other=private; sansphase_author_session=${owner}; sansphase_reader_session=reader`, authorization: "private" }),
  });
  const result = planLocalBookMediaRequest(req(), backend);
  assert.equal(result.destination.href, `${backend.origin}${media}?w=960&view=content`);
  assert.deepEqual(Object.fromEntries(result.headers), { cookie: `sansphase_author_session=${owner}`, host: backend.host });
  assert.equal(planLocalBookMediaRequest(req(media, "?download=1"), backend).destination.search, "?download=1");
  for (const entry of [req("/api/author/content"), req(media, "?w=100&w=960"), req(media, "?w=0"), req(media, "?preview=public"), req(media, "?download=1#w=960"), req(media, "", "POST"), req(media, "", "GET", "example.test")]) {
    assert.equal(planLocalBookMediaRequest(entry, backend), null);
  }
  assert.equal(planLocalBookMediaRequest(req(), null), null);
  assert.equal(planLocalBookMediaRequest({ ...req(), headers: new Headers({ host: "localhost:4308", cookie: "sansphase_reader_session=reader" }) }, backend), null);
});
