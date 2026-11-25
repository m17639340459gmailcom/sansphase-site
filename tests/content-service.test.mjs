import test from "node:test";
import assert from "node:assert/strict";
import {
  createContentService,
  cleanBody,
  serializeContent,
  isPublished,
} from "../server/content-service.ts";
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
function fixture(library = []) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    let data;
    if (path === '/items/library_entries') data=library;
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
test("publication activity counts all four catalogues on their first published Beijing dates", async () => {
  const row = (id, kind, published_at, extra = {}) => ({
    id, kind, published_at, slug: id, title: `${id} secret`, body: 'Private record body', status: 'published',
    ...extra,
  });
  const { service } = fixture([
    row('book', 'resource-center', '2026-01-03T00:00:00Z'),
    row('book', 'resource-center', '2026-01-01T16:00:00Z'),
    row('book', 'resource-center', '2026-01-01T16:00:00Z'),
    row('book', 'resources', '2026-01-01T20:00:00Z'),
    row('material', 'resources', '2026-01-01T15:59:59Z'),
    row('legacy', 'resources', '2026-01-03'),
    row('draft', 'resources', '2026-01-01T15:00:00Z', {status:'draft'}),
    row('gated', 'resource-center', '2026-01-01T15:00:00Z', {vip_only:true}),
    row('gated-material', 'resources', '2026-01-01T15:00:00Z', {vip_only:true}),
    row('undated', 'resource-center', null, {date_created:'2026-01-01T15:00:00Z'}),
    row('future', 'resources', '2099-01-01T15:00:00Z'),
    row('bad-date', 'resources', '2026-02-30'),
    row('work', 'works', '2026-01-01T15:00:00Z'),
    row('work', 'works', '2026-01-04T15:00:00Z', {date_created:'2026-01-04T14:00:00Z'}),
    row('work', 'software', '2026-01-01T16:00:00Z'),
    row('only-software', 'software', '2026-01-04'),
    row('vip-software', 'software', '2026-01-04', {vip_only:true}),
    row('blog', 'notes', '2026-01-04'),
  ]);
  const { data, resourceActivity } = await service.snapshot();
  assert.deepEqual(resourceActivity, { days: [
    {date:'2026-01-01',resourceCenter:0,materials:1,works:1,software:0},
    {date:'2026-01-02',resourceCenter:1,materials:1,works:0,software:1},
    {date:'2026-01-03',resourceCenter:0,materials:1,works:0,software:0},
    {date:'2026-01-04',resourceCenter:0,materials:0,works:0,software:1},
  ]});
  assert.equal(Object.hasOwn(data,'resourceActivity'),false);
});

test("explicit resource activity publishes only anonymous counters and leaves existing gates untouched", async (t) => {
  const { service } = fixture([
    {id:'one',kind:'resources',slug:'one',title:'Private resource title',status:'published',published_at:'2026-01-01T08:00:00Z'},
    {id:'two',kind:'works',slug:'two',title:'Work title',status:'published',published_at:'2026-01-01T08:00:00Z'},
    {id:'three',kind:'software',slug:'three',title:'Software title',status:'published',published_at:'2026-01-01T08:00:00Z'},
  ]);
  let identityCalls=0,previewCalls=0;
  const server=createPreviewServer({
    contentService:{...service,preview:async()=>{previewCalls++;throw new Error('Unexpected draft read');}},
    readerService:{identity:async()=>{identityCalls++;return null;}},
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/content`;
  const activity=base+'?view=bootstrap&public=1&activity=resources';
  const response=await fetch(activity,{headers:{Cookie:'owner=1'}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await response.json(),{resourceActivity:{days:[{date:'2026-01-01',resourceCenter:0,materials:1,works:1,software:1}]}});
  assert.equal(await (await fetch(activity,{method:'HEAD'})).text(),'');
  for (const path of [activity+'&preview=secret',activity+'&previewKind=resource-center',activity+'&activity=resources',base+'?view=bootstrap&activity=resources']) {
    assert.equal((await fetch(path)).status,400);
  }
  assert.equal(identityCalls,0);
  assert.equal(previewCalls,0);
  for (const path of [base,base+'?view=bootstrap',base+'?view=bootstrap&public=1']) {
    const payload=await (await fetch(path)).json();
    assert.equal(Object.hasOwn(payload,'resourceActivity'),false);
    assert.deepEqual(payload.resources,[]);
  }
  assert.equal((await fetch(base+'?view=list&kind=resources&public=1')).status,401);
  assert.equal((await fetch(base+'?view=list&kind=works&public=1')).status,401);
  assert.equal((await fetch(base+'?view=list&kind=software&public=1')).status,401);
});
test('homepage picks the latest published entry for each category and exposes only card fields', async (t) => {
  const row = (slug, kind, published_at, extra = {}) => article({
    id: `internal-${slug}`, slug, kind, published_at, title: slug, summary: 'Public summary',
    body: 'Private正文', file: { id: fileId }, ...extra,
  });
  const { service } = fixture([
    row('older-work', 'works', '2026-01-01T18:00:00+08:00'),
    row('latest-work', 'works', '2026-01-01T11:00:00Z'),
    row('latest-material', 'resources', '2026-01-01'),
    row('latest-book', 'resource-center', '2026-01-01T11:00:00Z'),
    row('latest-software', 'software', '2026-01-01T11:00:00Z'),
    row('latest-draft', 'works', '2026-01-02T11:00:00Z', { status: 'draft' }),
    row('vip-book', 'resource-center', '2026-01-02T11:00:00Z', { vip_only: true }),
    row('scheduled-software', 'software', '2099-01-01T11:00:00Z'),
    row('bad-date', 'resources', '2026-02-30T11:00:00Z'),
    row('bad/slug', 'resources', '2026-01-02T11:00:00Z'),
    row('untitled', 'software', '2026-01-02T11:00:00Z', { title: '   ' }),
  ]);
  const server = createPreviewServer({ contentService: service, readerService: { identity: async () => null } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/content`;
  const url = base + '?view=bootstrap&public=1&activity=resources&featured=1';
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const { featured, resourceActivity } = await response.json();
  assert.deepEqual(featured, Object.fromEntries([
    ['works', 'latest-work'], ['resources', 'latest-material'],
    ['resource-center', 'latest-book'], ['software', 'latest-software'],
  ].map(([kind, id]) => [kind, { id, title: id, summary: 'Public summary' }])));
  assert(resourceActivity.days.length > 0);
  assert.equal(await (await fetch(url, { method: 'HEAD' })).text(), '');
  assert.equal((await fetch(url + '&featured=1')).status, 400);
  assert.equal((await fetch(url + '&preview=secret')).status, 400);
  assert.equal((await fetch(url.replace('featured=1', 'featured=0'))).status, 400);
  assert.equal((await fetch(base + '?view=detail&kind=works&id=latest-work')).status, 401);
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
