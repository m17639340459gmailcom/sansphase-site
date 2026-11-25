import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readAccount, signIn, signOut } from "../src/lib/account-session.ts";

test("loads the authorized role from same-origin, uncached session endpoints", async () => {
  const sent = [];
  const request = async (path, options) => {
    sent.push({ path, options });
    return Response.json(path.endsWith("/author/session") ? null :
      { nickname: "演示读者", uid: "10004", vip: true, email: "private@example.test" });
  };
  assert.deepEqual(await readAccount(new AbortController().signal, request), {
    role: "reader", name: "演示读者", uid: "10004", vip: true,
  });
  assert.deepEqual(sent.map(({ path }) => path), ["/api/author/session", "/api/reader/session"]);
  assert.ok(sent.every(({ options }) => options.cache === "no-store" && options.credentials === "same-origin"));
  await assert.rejects(readAccount(new AbortController().signal, async () => new Response(null, { status: 404 })), { code: "unavailable" });
});

test("uses the existing reader login and author logout contracts", async () => {
  const sent = [];
  const request = async (path, options) => {
    sent.push({ path, options });
    return Response.json(path.endsWith("/logout") ? { ok: true } : { role: "owner", name: "演示作者" });
  };
  const signal = new AbortController().signal;
  assert.deepEqual(await signIn("owner@example.test", "sample-password", "proof", signal, request), {
    role: "owner", name: "演示作者",
  });
  assert.equal(sent[0].path, "/api/reader/login");
  assert.equal(new Headers(sent[0].options.headers).get("X-Login-Verification"), "proof");
  assert.equal(new Headers(sent[0].options.headers).get("X-Reader-Request"), "1");
  assert.deepEqual(JSON.parse(sent[0].options.body), { email: "owner@example.test", password: "sample-password" });
  await signOut("owner", signal, request);
  assert.equal(sent[1].path, "/api/author/logout");
  assert.equal(new Headers(sent[1].options.headers).get("X-Author-Request"), "1");
  await assert.rejects(signIn("wrong@example.test", "incorrect", "proof", signal,
    async () => Response.json({ error: "bad credentials" }, { status: 401 })), { code: "credentials" });
});

test("account checks and login work without newer AbortSignal methods", async (t) => {
  t.mock.method(AbortSignal, "any", () => assert.fail("AbortSignal.any is unavailable"));
  t.mock.method(AbortSignal, "timeout", () => assert.fail("AbortSignal.timeout is unavailable"));
  const signal = new AbortController().signal;
  const request = async (path, options) => {
    assert.equal(options.signal.aborted, false);
    if (path === "/api/reader/login") assert.equal(options.headers.get("X-Login-Verification"), "proof");
    return Response.json(path === "/api/reader/login" ? { nickname: "Reader" } : null);
  };
  assert.equal(await readAccount(signal, request), null);
  assert.equal((await signIn("reader@example.test", "sample-password", "proof", signal, request)).role, "reader");
});

test("account requests keep their deadline while reading the response and honor cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const waitForAbort = (signal) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const stalled = async (_path, { signal }) => ({ ok: true, json: () => waitForAbort(signal) });

  const check = readAccount(new AbortController().signal, stalled);
  const expired = assert.rejects(check, { name: "TimeoutError" });
  await Promise.resolve();
  t.mock.timers.tick(8_000);
  await expired;

  const controller = new AbortController();
  const login = signIn("reader@example.test", "sample-password", "proof", controller.signal, stalled);
  const cancelled = assert.rejects(login, { name: "AbortError" });
  controller.abort();
  await cancelled;
});

test("the account page mounts the established verification control and posts no password in a URL", async () => {
  const form = await readFile(new URL("../src/components/account/sign-in.tsx", import.meta.url), "utf8");
  assert.match(form, /mountLoginVerificationControl/);
  assert.match(form, /controller\.consume\(\)/);
  assert.match(form, /method="post"/);
  assert.match(form, /type="email" name="email" autoComplete="username"/);
  assert.match(form, /id="v3-account-password"[^>]*name="password" autoComplete="current-password"/);
  assert.match(form, /aria-controls="v3-account-password"/);
  assert.doesNotMatch(form, /localStorage|sessionStorage|dangerouslySetInnerHTML/);
});

test("the signed-in author has a management entry and readers do not", async () => {
  const form = await readFile(new URL("../src/components/account/sign-in.tsx", import.meta.url), "utf8");
  assert.match(form, /const managementEntry = "\/admin-console"/);
  assert.match(form, /identity\.role === "owner" && <a href=\{managementEntry\}[^>]*>\{copy\.openAdmin\}/);
});
