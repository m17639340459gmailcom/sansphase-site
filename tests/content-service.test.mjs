import test from "node:test";
import assert from "node:assert/strict";
import {
  createContentService,
  cleanBody,
  serializeContent,
  isPublished,
} from "../server/content-service.mjs";
import { createPreviewServer } from "../server.mjs";
const publishedId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const fileId = "33333333-3333-4333-8333-333333333333";
const draftFile = "44444444-4444-4444-8444-444444444444";
const article = (overrides = {}) => ({
  id: publishedId,
  slug: "published-note",
  status: "published",
  title: "Published",
  body: `<p>Hello</p><img src="http://127.0.0.1:8055/assets/${fileId}">`,
  attachments: [],
  ...overrides,
});
function fixture() {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    let data;
    if (path === '/items/library_entries') data=[];
    else if (path === "/items/articles")
      data = [
        article(),
        article({
          id: draftId,
          slug: "secret-draft",
          status: "draft",
          cover: draftFile,
        }),
        article({ slug: "future-post", published_at: "2099-01-01" }),
      ];
    else if (path === "/items/site_profile")
      data = {
        name: "Author",
        social_links: [
          { label: "unsafe", url: "javascript:alert(1)" },
          { label: "safe", url: "https://example.com/" },
        ],
      };
    else if (path === "/items/announcements")
      data = [
        { status: "draft", title: "Secret announcement" },
        { status: "published", title: "Hello" },
      ];
    else if (path === `/items/articles/${draftId}`) {
      if (options.headers.Cookie !== "directus_session_token=author-session")
        return new Response("{}", { status: 403 });
      data = article({ id: draftId, status: "draft", cover: draftFile });
    } else if (path.startsWith("/assets/"))
      return new Response("file", { headers: { "content-type": "image/png" } });
    else return new Response("{}", { status: 404 });
    return Response.json({ data });
  };
  return {
    service: createContentService({
      url: "http://127.0.0.1:8055",
      token: "SERVER_SECRET",
      fetcher,
    }),
    calls,
  };
}
test("published snapshot excludes drafts, scheduled posts and private announcements even if upstream sends them", async () => {
  const { service } = fixture();
  const { data, media } = await service.snapshot();
  assert.equal(data.notes.length, 1);
  assert.equal(data.announcements.length, 1);
  assert.equal(data.profile.socialLinks.length, 1);
  assert(!media.has(draftFile));
  assert(!serializeContent(data).includes("SERVER_SECRET"));
  assert(isPublished(article()));
  assert(!isPublished(article({ published_at: "invalid" })));
});
test("rich text strips executable content and only rewrites local CMS media", () => {
  const media = new Set();
  const html = cleanBody(
    `<script>alert(1)</script><img src="http://127.0.0.1:8055/assets/${fileId}" onerror="evil()"><img src="https://tracker.example/image"><a href="javascript:evil()">click</a><iframe src="evil"></iframe><p onclick="evil()">Readable</p>`,
    "http://127.0.0.1:8055",
    media,
  );
  assert(html.includes("Readable"));
  assert(html.includes(`/api/media/${fileId}`));
  assert(!/script|onerror|onclick|javascript|iframe|tracker/.test(html));
  assert(
    !serializeContent({ title: "</script><script>evil()</script>" }).includes(
      "<",
    ),
  );
});
test("draft previews require author session, never fall back to the service token", async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.preview(draftId), { status: 403 });
  await assert.rejects(
    service.preview(draftId, "directus_session_token=wrong"),
    { status: 403 },
  );
  const preview = await service.preview(
    draftId,
    "unrelated=1; directus_session_token=author-session",
  );
  assert(preview.note.coverSrc.includes(`preview=${draftId}`));
  assert.equal(calls.at(-1).options.headers.Authorization, undefined);
});
test("unreferenced and draft media are inaccessible through the public adapter", async () => {
  const { service } = fixture();
  await assert.rejects(service.media(draftFile), { status: 404 });
  assert.equal(await (await service.media(fileId)).text(), "file");
  await assert.rejects(service.media(draftFile, { previewId: draftId }), {
    status: 403,
  });
  assert.equal(
    await (
      await service.media(draftFile, {
        previewId: draftId,
        cookie: "directus_session_token=author-session",
      })
    ).text(),
    "file",
  );
});
test("initial HTML contains content before module execution; CMS errors fail closed", async (t) => {
  const { service } = fixture();
  const server = createPreviewServer({ contentService: service });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert(html.includes('id="site-content"'));
  assert(!html.includes("secret-draft"));
  assert(!html.includes("SERVER_SECRET"));
  assert.equal((await fetch(`${origin}/?preview=${draftId}`)).status, 403);
  assert.equal((await fetch(`${origin}/api/media/${draftFile}`)).status, 404);
  assert.equal((await fetch(`${origin}/api/anything`)).status, 404);
});
