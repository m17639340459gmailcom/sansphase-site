import assert from "node:assert/strict";
import test from "node:test";
import {
  communityEntryPost,
  communityPublicHref,
  readCommunityAccess,
  requestCommunityEntry,
  trustedCommunitySite,
} from "../src/lib/community-entry.ts";

const signal = new AbortController().signal;
const community = "https://community.sansphase.com";
const post = "822f0d06-eed2-4dc5-b0ad-5bc3907484e3";
const handoff = `${community}/community-enter#community-entry=${"a".repeat(43)}`;
const response = (value) => Response.json(value);

test("community reads only the existing same-origin bootstrap and preserves unavailable state", async () => {
  const read = (data) => readCommunityAccess(signal, async (path, options) => {
    assert.equal(path, "/api/content?view=bootstrap");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    return response(data);
  });
  assert.equal(await read({ communityDestination: community, reader: { nickname: "Reader" } }), "ready");
  assert.equal(await read({ communityDestination: community, author: { name: "Author" } }), "ready");
  assert.equal(await read({ communityDestination: community, reader: null, author: null }), "auth");
  assert.equal(await read({ communityDestination: community, communityOnly: true }), "disabled");
  assert.equal(await read({ communityDestination: `${community}/unexpected`, reader: { nickname: "Reader" } }), "disabled");
  await assert.rejects(readCommunityAccess(signal, async () => new Response(null, { status: 503 })));
});

test("community starts the existing one-use handoff without accepting an arbitrary destination or client clock", async () => {
  const issue = (value, targetPost = post) => requestCommunityEntry(targetPost, signal, async (path, options) => {
    assert.equal(path, "/api/community-entry");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(new Headers(options.headers).get("X-Reader-Request"), "1");
    assert.equal(options.body, "{}");
    assert.equal(options.redirect, "error");
    return response(value);
  });
  const result = await issue({ url: handoff, expiresAt: "2020-01-01T00:00:00.000Z" });
  assert.deepEqual(result, { status: "leaving", destination: `${handoff}&post=${post}` });
  assert.deepEqual(await issue({ url: handoff, expiresAt: 1 }, "x&post=x"), { status: "leaving", destination: handoff });
  for (const invalid of [
    { url: handoff.replace(community, "https://other.example"), expiresAt: 1 },
    { url: handoff.replace("/community-enter#", "/community-enter?a=secret#"), expiresAt: 1 },
    { url: `${handoff}&post=already-injected`, expiresAt: 1 },
    { url: handoff, expiresAt: "invalid" },
  ]) await assert.rejects(issue(invalid));
  assert.deepEqual(await requestCommunityEntry(null, signal, async () => new Response(null, { status: 401 })), { status: "auth" });
});

test("the community gateway works without newer AbortSignal methods", async (t) => {
  t.mock.method(AbortSignal, "any", () => assert.fail("AbortSignal.any is unavailable"));
  t.mock.method(AbortSignal, "timeout", () => assert.fail("AbortSignal.timeout is unavailable"));
  const access = await readCommunityAccess(signal, async (_path, options) => {
    assert.equal(options.signal.aborted, false);
    return response({ communityDestination: community, reader: { nickname: "Reader" } });
  });
  assert.equal(access, "ready");
  const entry = await requestCommunityEntry(null, signal, async (_path, options) => {
    assert.equal(options.signal.aborted, false);
    return response({ url: handoff, expiresAt: 1 });
  });
  assert.deepEqual(entry, { status: "leaving", destination: handoff });
});

test("community accepts one public post UUID and keeps local runtimes away from the live handoff", () => {
  assert.equal(communityEntryPost(post), post);
  assert.equal(communityEntryPost([post, post]), null);
  assert.equal(communityEntryPost("anything"), null);
  assert.equal(trustedCommunitySite("https://www.sansphase.com"), true);
  for (const origin of ["http://localhost:4308", "http://127.0.0.1:4309", "http://www.sansphase.com", community, "https://www.sansphase.com.example.org"]) {
    assert.equal(trustedCommunitySite(origin), false);
  }
});

test("the isolated gateway opens the fixed community site without creating a handoff", () => {
  assert.equal(communityPublicHref(null), `${community}/#/community/home`);
  assert.equal(communityPublicHref(post), `${community}/#/post/${post}`);
  assert.equal(communityPublicHref("https://untrusted.example"), `${community}/#/community/home`);
});
