import assert from "node:assert/strict";
import test from "node:test";
import { createConsoleAuthProvider } from "../src/admin-console/auth-provider.ts";

test("anonymous and ordinary-reader author session null goes to the original account login", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      location: {
        origin: "https://example.test",
        hash: "#/memberships?filter=private",
      },
    }),
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const calls: string[] = [];
  let cleared = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    calls.push(String(url));
    return Response.json(null);
  });
  for (const _identity of ["anonymous", "ordinary-reader"]) {
    const provider = createConsoleAuthProvider(() => cleared++);
    await assert.rejects(provider.checkAuth({}), /登录作者/);
    assert.equal(
      await provider.logout({}),
      "https://example.test/?adminReturn=memberships#/account",
    );
  }
  assert.equal(cleared, 2);
  assert.deepEqual(calls, ["/api/author/session", "/api/author/session"]);
});

test("expired author sessions still clear local private state and notify a loaded editor", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const host = Object.assign(new EventTarget(), {
    location: {
      origin: "https://example.test",
      hash: "#/readers?filter=private",
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: host,
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  let cleared = 0,
    signouts = 0;
  host.addEventListener("author:identity", (event) => {
    assert.equal((event as CustomEvent).detail, null);
    signouts++;
  });
  const provider = createConsoleAuthProvider(() => cleared++);
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("", { status: 401 }),
  );
  assert.equal(
    await provider.logout({ userInitiated: true }),
    "https://example.test/?adminReturn=readers#/account",
  );
  assert.equal(cleared, 1);
  assert.equal(signouts, 1);
});

test("a late successful identity check cannot turn automatic retry navigation into a server logout", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      location: { origin: "https://example.test", hash: "#/activity" },
    }),
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const requests: Array<{ url: string; finish: (value: Response) => void }> =
    [];
  t.mock.method(
    globalThis,
    "fetch",
    (url: string | URL | Request) =>
      new Promise<Response>((finish) => {
        requests.push({ url: String(url), finish });
      }),
  );
  const provider = createConsoleAuthProvider(() => {});
  const check = provider.checkAuth({}),
    identity = provider.getIdentity!();
  assert.equal(requests.length, 2);
  requests[0].finish(new Response("", { status: 503 }));
  await assert.rejects(check);
  requests[1].finish(Response.json({ name: "作者" }));
  await identity;
  const automatic = provider.logout({});
  assert.deepEqual(
    requests.map((request) => request.url),
    ["/api/author/session", "/api/author/session"],
  );
  assert.equal(await automatic, "/session-unavailable?section=activity");
});

test("network and server failures preserve the owner session and offer retry without logging out", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      location: {
        origin: "https://example.test",
        hash: "#/maintenance?selected=private",
      },
    }),
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const calls: string[] = [];
  let cleared = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response("unavailable", { status: 503 });
  });
  const provider = createConsoleAuthProvider(() => cleared++);
  await assert.rejects(provider.checkAuth({}), (error) => {
    assert.ok(error instanceof Error && "redirectTo" in error);
    assert.match(error.message, /暂时|重试/);
    assert.equal(error.redirectTo, "/session-unavailable?section=maintenance");
    return true;
  });
  assert.equal(
    await provider.logout({}),
    "/session-unavailable?section=maintenance",
  );
  assert.deepEqual(calls, ["/api/author/session"]);
  assert.equal(cleared, 0);
  await assert.rejects(provider.logout({ userInitiated: true }), /退出失败/);
  assert.equal(cleared, 0);
});

test("denied API access clears identity immediately while normal API failures do not", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      location: { origin: "https://example.test", hash: "#/activity" },
    }),
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  let cleared = 0;
  const provider = createConsoleAuthProvider(() => cleared++);
  await provider.checkError({ status: 500 });
  assert.equal(cleared, 0);
  await assert.rejects(provider.checkError({ status: 403 }), /登录/);
  assert.equal(cleared, 1);
});

test("a late network response cannot override a confirmed missing author session", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      location: { origin: "https://example.test", hash: "#/memberships" },
    }),
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const requests: Array<(value: Response) => void> = [];
  let cleared = 0;
  t.mock.method(
    globalThis,
    "fetch",
    () =>
      new Promise<Response>((finish) => {
        requests.push(finish);
      }),
  );
  const provider = createConsoleAuthProvider(() => cleared++);
  const check = provider.checkAuth({}),
    identity = provider.getIdentity!();
  requests[0](Response.json(null));
  await assert.rejects(check);
  requests[1](new Response("", { status: 503 }));
  await assert.rejects(identity, (error) => {
    assert.ok(error instanceof Error && "redirectTo" in error);
    assert.equal(
      error.redirectTo,
      "https://example.test/?adminReturn=memberships#/account",
    );
    return true;
  });
  assert.equal(cleared, 1);
  assert.equal(
    await provider.logout({}),
    "https://example.test/?adminReturn=memberships#/account",
  );
  assert.equal(requests.length, 2);
});
