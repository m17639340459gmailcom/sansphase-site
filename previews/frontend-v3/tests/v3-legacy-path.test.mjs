import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const alias = registerHooks({
  resolve(specifier, context, nextResolve) {
    const local = specifier === "@/lib/community-entry" ? new URL("../src/lib/community-entry.ts", import.meta.url).href : specifier;
    return nextResolve(local, context);
  },
});
const { legacyFrontendPath } = await import("../src/lib/legacy-frontend-path.ts");
alias.deregister();

const post = "822f0d06-eed2-4dc5-b0ad-5bc3907484e3";

test("links issued by V1 and the hosted community land on their V3 counterparts", () => {
  for (const [oldHash, target] of [
    ["#/home", "/"],
    ["#/notes", "/about#blog"],
    ["#/note/personal-knowledge-base-completed", "/blog/personal-knowledge-base-completed"],
    ["#/works/moon-notes", "/projects/moon-notes"],
    ["#/work/moon-notes", "/projects/moon-notes"],
    ["#/resources/study-material", "/learning/study-material"],
    ["#/resource-center/handbook", "/resources/handbook"],
    ["#/software/example", "/software/example"],
    ["#/support", "/support"],
    ["#/contact", "/contact"],
    ["#/admin", "/admin-console/"],
    ["#/community", "/community"],
    ["#/community/home", "/community"],
    [`#/post/${post}`, `/community?post=${post}`],
    [`#/post/${post}/reply/${post}`, `/community?post=${post}`],
  ]) assert.equal(legacyFrontendPath(oldHash), target, oldHash);
  assert.equal(legacyFrontendPath("#/notes", "?q=AI", true), "/en/about?q=AI#blog");
  assert.equal(legacyFrontendPath("#/support", "", true), "/en/support");
  assert.equal(legacyFrontendPath("#/admin", "", true), "/admin-console/");
});

test("legacy account and email links retain their existing context", () => {
  assert.equal(legacyFrontendPath("#/account", "?invite=example&adminReturn=articles"), "/account?invite=example&adminReturn=articles");
  assert.equal(legacyFrontendPath("#/account?return=%2Fcommunity", "?invite=example", true), "/en/account?invite=example&return=%2Fcommunity");
  assert.equal(legacyFrontendPath("#/verify/example?email=reader%40example.test"), "/verify/example?email=reader%40example.test");
  assert.equal(legacyFrontendPath("#/reset/example", "?return=%2Fcommunity"), "/reset?return=%2Fcommunity#example");
  assert.equal(legacyFrontendPath("#/notes", "?q=AI&invite=example&return=%2Fcommunity&adminReturn=articles&returnTo=%2Fcommunity"), "/about?q=AI#blog");
  assert.equal(legacyFrontendPath(`#/community?post=${post}&post=${post}`), "/community");
});

test("stray anchors, unknown targets, traversal and encoded delimiters are rejected", () => {
  for (const hash of [
    "#blog", "#/unknown", "#/notes/extra", "#/note", "#/note/a/b",
    "#/note/%2e%2e", "#/note/%2Fexample", "#/note/%5cexample", "#/note/%0a",
    "#/note/%invalid", "#/post/not-a-post", `#/post/${post}/reply/not-a-reply`,
    "#//other.example", "#/toString",
  ]) assert.equal(legacyFrontendPath(hash), null, hash);
});
