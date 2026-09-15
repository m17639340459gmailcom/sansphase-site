import test from "node:test";
import assert from "node:assert/strict";
import {
  validateArticle,
  assertAuthorOrigin,
  createAuthorService,
} from "../server/author-service.mjs";
test("author writes reject untrusted origins, absent intent headers and injected CMS fields", () => {
  assert.throws(() =>
    assertAuthorOrigin(
      { origin: "https://evil.test", "x-author-request": "1" },
      "http://127.0.0.1:4176",
    ),
  );
  assert.throws(() =>
    assertAuthorOrigin(
      { origin: "http://127.0.0.1:4176" },
      "http://127.0.0.1:4176",
    ),
  );
  assertAuthorOrigin(
    { origin: "http://127.0.0.1:4176", "x-author-request": "1" },
    "http://127.0.0.1:4176",
  );
  const payload = validateArticle(
    {
      title: "文章",
      slug: "valid-title",
      body: "<p>Hello</p>",
      status: "published",
      user_created: "attacker",
      role: "admin",
      tags: ["one"],
    },
    "articles",
  );
  assert.equal(payload.status, undefined);
  assert.equal(payload.role, undefined);
  assert.equal(payload.user_created, undefined);
  assert.throws(() =>
    validateArticle({ title: "", slug: "wrong slug" }, "articles"),
  );
});
test("a different CMS user cannot become the personal website author", async () => {
  const service = createAuthorService({
    url: "http://127.0.0.1:8055",
    authorId: "owner",
    store: {identity:async()=>({id:'community-admin',first_name:'Other admin'})},
  });
  assert.equal(
    await service.identity({
      headers: { cookie: "sansphase_author_session=other-session" },
    }),
    null,
  );
});
