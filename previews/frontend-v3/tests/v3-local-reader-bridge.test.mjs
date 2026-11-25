import assert from "node:assert/strict";
import test from "node:test";

import { planLocalAdminEntry, planLocalReaderRequest } from "../src/lib/local-reader-bridge.ts";

const upstream = "http://127.0.0.1:4310";
const siteOrigin = "http://localhost:4308";

function request(pathname, options = {}) {
  return {
    method: options.method ?? "GET",
    pathname,
    search: options.search ?? "",
    headers: new Headers({ host: "localhost:4308", ...options.headers }),
  };
}

test("the reader bridge is disabled by default and accepts only a literal separate loopback origin", () => {
  const session = request("/api/reader/session");
  for (const target of [undefined, "", "https://www.sansphase.com", "http://127.1:4310", "http://127.0.0.1:4310/", "http://127.0.0.1:4310?", "http://127.0.0.1:4310\n", "http://127.0.0.1:4310@www.sansphase.com", "http://127.0.0.1:65536", "http://127.0.0.1:80", "http://127.0.0.1:4308", "http://localhost:4308"]) {
    assert.deepEqual(planLocalReaderRequest(session, target), { status: 404 }, String(target));
  }

  assert.equal(planLocalReaderRequest(session, upstream).destination.href, `${upstream}/api/reader/session`);
});

test("the V3 admin entry only targets the shared-host local backend", () => {
  const integrated = "http://localhost:4315";
  const entry = request("/admin-console");
  assert.equal(planLocalAdminEntry(entry, integrated)?.href, `${integrated}/admin-console/`);
  assert.equal(planLocalAdminEntry(request("/admin-console/", { method: "HEAD" }), integrated)?.href, `${integrated}/admin-console/`);
  assert.equal(planLocalReaderRequest(request("/api/author/session"), integrated).destination.href, `${integrated}/api/author/session`);
  for (const target of [undefined, upstream, "http://localhost:4308", "http://localhost:4315/", "http://localhost:4315@elsewhere.test"]) {
    assert.equal(planLocalAdminEntry(entry, target), null);
  }
  for (const invalid of [
    request("/admin-console", { headers: { host: "elsewhere.test" } }),
    request("/admin-console", { method: "POST" }),
    request("/admin-console", { search: "?next=https://elsewhere.test" }),
    request("/admin-console/private"),
  ]) assert.equal(planLocalAdminEntry(invalid, integrated), null);
});

test("only the local preview host, exact paths, expected methods and query-free requests pass", () => {
  const rejected = [
    request("/api/reader/session", { headers: { host: "127.0.0.1:4308" } }),
    request("/api/reader/session", { headers: { host: "elsewhere.test:4308", "x-forwarded-host": "localhost:4308" } }),
    request("/api/reader/session", { method: "HEAD" }),
    request("/api/reader/session", { method: "OPTIONS" }),
    request("/api/reader/session", { search: "?next=/account" }),
    request("/api/reader/session", { search: "?" }),
    request("/api/reader/session/"),
    request("/api/reader//session"),
    request("/api/reader/%73ession"),
    request("/en/api/reader/session"),
    request("/api/health"),
    request("/api/reader/signup", { method: "POST" }),
    request("/api/author/login", { method: "POST" }),
    request("/api/reader/login", { headers: { origin: siteOrigin, "x-reader-request": "1" } }),
  ];

  for (const entry of rejected) {
    assert.deepEqual(planLocalReaderRequest(entry, upstream), { status: 404 });
  }

  assert.equal(planLocalReaderRequest(request("/api/author/session"), upstream).destination.href, `${upstream}/api/author/session`);
});

test("POST requests prove the browser origin and send the matching reader or author intent", () => {
  const path = "/api/reader/login";
  for (const headers of [
    { "x-reader-request": "1" },
    { origin: siteOrigin },
    { origin: upstream, "x-reader-request": "1" },
    { origin: "http://other.test", "x-reader-request": "1" },
    { origin: siteOrigin, "x-reader-request": "yes" },
    { origin: siteOrigin, "x-author-request": "1" },
  ]) {
    assert.deepEqual(planLocalReaderRequest(request(path, { method: "POST", headers }), upstream), { status: 403 });
  }

  for (const readerPath of ["/api/reader/login-challenge", "/api/reader/login-challenge/verify", path, "/api/reader/logout"]) {
    const decision = planLocalReaderRequest(request(readerPath, {
      method: "POST", headers: { origin: siteOrigin, "x-reader-request": "1" },
    }), upstream);
    assert.equal(decision.destination.href, `${upstream}${readerPath}`);
    assert.equal(decision.headers.get("origin"), upstream);
    assert.equal(decision.headers.get("x-reader-request"), "1");
  }

  const authorPath = "/api/author/logout";
  const author = planLocalReaderRequest(request(authorPath, {
    method: "POST", headers: { origin: siteOrigin, "x-author-request": "1" },
  }), upstream);
  assert.equal(author.destination.href, `${upstream}${authorPath}`);
  assert.equal(author.headers.get("x-author-request"), "1");
  assert.deepEqual(planLocalReaderRequest(request(authorPath, {
    method: "POST", headers: { origin: siteOrigin, "x-reader-request": "1" },
  }), upstream), { status: 403 });
});

test("the bridge preserves the credential flow and strips unrelated request headers", () => {
  const cookie = "sansphase_reader_session=example; sansphase_author_session=example; sansphase_login_verification_nonce=example";
  const headers = {
    origin: siteOrigin,
    "x-reader-request": "1",
    "x-login-verification": "signed-proof",
    "content-type": "application/json",
    "content-length": "30",
    "user-agent": "Local Preview",
    cookie: `${cookie}; NEXT_LOCALE=en; other=unrelated`,
    authorization: "private",
    "x-forwarded-for": "192.0.2.5",
    "x-forwarded-host": "elsewhere.test",
    "x-middleware-rewrite": "http://elsewhere.test",
  };
  const posted = planLocalReaderRequest(request("/api/reader/login", { method: "POST", headers }), upstream);
  assert.equal(posted.headers.get("cookie"), cookie);
  assert.equal(posted.headers.get("x-login-verification"), "signed-proof");
  assert.equal(posted.headers.get("content-type"), "application/json");
  assert.equal(posted.headers.get("content-length"), "30");
  assert.equal(posted.headers.get("user-agent"), "Local Preview");
  assert.equal(posted.headers.get("authorization"), null);
  assert.equal(posted.headers.get("x-forwarded-for"), null);
  assert.equal(posted.headers.get("x-forwarded-host"), null);
  assert.equal(posted.headers.get("x-middleware-rewrite"), null);

  const logout = planLocalReaderRequest(request("/api/reader/logout", { method: "POST", headers }), upstream);
  assert.equal(logout.headers.get("x-login-verification"), null);

  const session = planLocalReaderRequest(request("/api/reader/session", { headers }), upstream);
  assert.equal(session.headers.get("cookie"), cookie);
  assert.equal(session.headers.get("origin"), null);
  assert.deepEqual(planLocalReaderRequest(request("/api/reader/session", {
    headers: { origin: "http://other.test" },
  }), upstream), { status: 403 });
});
