import test from "node:test";
import assert from "node:assert/strict";
import { createAdminConsoleDataProvider } from "../src/admin-console/data-provider.ts";
import type {
  AdminReader,
  AdminProfileReview,
} from "../src/admin-console/types.ts";

const readerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reviewId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reader: AdminReader = {
  id: readerId,
  uid: "10009",
  nickname: "演示读者",
  remark: "",
  email: "reader@example.test",
  phone: "",
  verified: true,
  disabled: false,
  createdAt: "2026-10-01T00:00:00Z",
  lastLoginIp: null,
  lastLoginAt: null,
  vip: true,
  vipStartedAt: "2026-10-01T00:00:00Z",
  vipUntil: "2026-11-01T00:00:00Z",
};
const summary = { total: 1, active: 1, disabled: 0, vip: 1, expiredVip: 0 };
const readers = (users: AdminReader[] = [reader]) => ({
  users,
  page: 1,
  totalPages: 1,
  total: users.length,
  summary,
});
const profile: AdminProfileReview = {
  id: reviewId,
  readerId,
  nickname: reader.nickname,
  kind: "nickname",
  proposedValue: "新昵称",
  avatarUrl: null,
  createdAt: "2026-10-12T00:00:00Z",
  advice: [],
};
const listParams = {
  pagination: { page: 1, perPage: 20 },
  sort: { field: "createdAt", order: "DESC" },
  filter: {},
};

test("login history uses the owner-only endpoint and validates the projected events", async () => {
  const event = {
    id: reviewId,
    at: "2026-10-12T01:02:03Z",
    ip: "192.0.2.8",
    peerIp: "127.0.0.1",
    source: "forwarded",
    userAgent: "Example browser",
  };
  const { provider, requests } = fixture(
    { events: [event] },
    { events: [{ ...event, at: "invalid date" }] },
  );
  const signal = new AbortController().signal;
  assert.deepEqual(await provider.readerLogins(readerId, { signal }), [event]);
  assert.equal(requests[0].url, `/api/manage/readers/${readerId}/logins`);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.signal, signal);
  assert.equal(requests[0].options.credentials, "same-origin");
  await assert.rejects(provider.readerLogins(readerId), { status: 502 });
});

test("UID updates use the existing command, preserve remarks and replace cached lookup hints", async () => {
  const changed = { ...reader, uid: "34567", remark: "仅作者可见" };
  const { provider, requests } = fixture(
    readers(),
    changed,
    readers([changed]),
  );
  await provider.getList("readers", listParams);
  assert.deepEqual(await provider.saveReaderUid(readerId, " 34567 "), changed);
  assert.equal(requests[1].url, `/api/manage/readers/${readerId}/uid`);
  assert.deepEqual(JSON.parse(String(requests[1].options.body)), {
    confirmId: readerId,
    uid: "34567",
  });
  assert.equal(
    new Headers(requests[1].options.headers).get("X-Author-Request"),
    "1",
  );
  assert.deepEqual(
    (await provider.getOne("readers", { id: readerId })).data,
    changed,
  );
  assert.equal(
    new URL(requests[2].url, "http://localhost").searchParams.get("q"),
    "UID 34567",
  );
});

test("invalid UID, empty deletion confirmation and malformed account IDs never issue requests", async () => {
  const { provider, requests } = fixture();
  for (const uid of ["123", "1234567890", "0000", "12a45", "１２３４"])
    await assert.rejects(provider.saveReaderUid(readerId, uid), {
      status: 400,
    });
  await assert.rejects(provider.deleteReaderAccount(readerId, "  "), {
    status: 400,
  });
  await assert.rejects(provider.readerLogins("../other"), { status: 400 });
  await assert.rejects(provider.deleteReaderAccount("../other", reader.email), {
    status: 400,
  });
  assert.equal(requests.length, 0);
});

test("deletion waits for an explicit matching deleted result and clears only its UID hint", async () => {
  const result = { id: readerId, uid: reader.uid, deleted: true };
  const { provider, requests } = fixture(
    readers(),
    { ...result, deleted: false },
    { ...result, id: reviewId },
    result,
  );
  await provider.getList("readers", listParams);
  await assert.rejects(provider.deleteReaderAccount(readerId, reader.email), {
    status: 502,
  });
  await assert.rejects(provider.deleteReaderAccount(readerId, reader.email), {
    status: 502,
  });
  assert.deepEqual(
    await provider.deleteReaderAccount(readerId, ` ${reader.email} `),
    result,
  );
  assert.equal(requests[3].url, `/api/manage/readers/${readerId}/delete`);
  assert.deepEqual(JSON.parse(String(requests[3].options.body)), {
    confirmId: readerId,
    confirmEmail: reader.email,
  });
  await assert.rejects(provider.getOne("readers", { id: readerId }), {
    status: 405,
  });
});

test("UID conflicts and deletion failures preserve the server error and remain retryable", async () => {
  const { provider } = fixture(
    Response.json({ error: "UID 已被使用。" }, { status: 409 }),
    Response.json(
      { error: "请完整输入该账号的邮箱以确认删除。" },
      { status: 400 },
    ),
    { ...reader, uid: "34567", remark: "备注保持" },
  );
  await assert.rejects(provider.saveReaderUid(readerId, "34567"), {
    status: 409,
    message: "UID 已被使用。",
  });
  await assert.rejects(
    provider.deleteReaderAccount(readerId, "wrong@example.test"),
    { status: 400 },
  );
  assert.equal(
    (await provider.saveReaderUid(readerId, "34567")).remark,
    "备注保持",
  );
});

test("UID and permanent deletion share the account mutation lock with notes and VIP commands", async () => {
  let complete: ((response: Response) => void) | undefined;
  let calls = 0;
  const provider = createAdminConsoleDataProvider({
    fetch: async () => {
      calls++;
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    },
  });
  const first = provider.deleteReaderAccount(readerId, reader.email);
  await assert.rejects(provider.deleteReaderAccount(readerId, reader.email), {
    status: 409,
  });
  await assert.rejects(provider.saveReaderUid(readerId, "34567"), {
    status: 409,
  });
  await assert.rejects(provider.saveReaderRemark(readerId, "备注"), {
    status: 409,
  });
  assert.equal(calls, 1);
  complete!(Response.json({ error: "删除暂时失败" }, { status: 503 }));
  await assert.rejects(first, { status: 503 });
  const second = provider.saveReaderUid(readerId, "34567");
  complete!(Response.json({ ...reader, uid: "34567" }));
  assert.equal((await second).uid, "34567");
});

test("private reader remarks use the owner command, stay searchable and can be cleared", async () => {
  const marked = { ...reader, remark: "设计合作 · QQ 朋友 🐱" };
  const { provider, requests } = fixture(marked, readers([marked]), reader);
  const result = await provider.saveReaderRemark(
    readerId,
    "  设计合作 · QQ 朋友 🐱  ",
  );
  assert.equal(result.remark, marked.remark);
  assert.equal(result.nickname, reader.nickname);
  assert.equal(requests[0].url, `/api/manage/readers/${readerId}/remark`);
  assert.deepEqual(JSON.parse(String(requests[0].options.body)), {
    confirmId: readerId,
    remark: marked.remark,
  });
  assert.equal(
    new Headers(requests[0].options.headers).get("X-Author-Request"),
    "1",
  );
  await provider.getList("readers", {
    ...listParams,
    filter: { q: marked.remark },
  });
  assert.equal(
    new URL(requests[1].url, "http://localhost").searchParams.get("q"),
    marked.remark,
  );
  assert.equal((await provider.saveReaderRemark(readerId, "  ")).remark, "");
});

test("remarks count Unicode characters, reject oversize drafts, and preserve server failures", async () => {
  const { provider, requests } = fixture(
    { ...reader, remark: "🐱".repeat(200) },
    Response.json({ error: "保存失败，请重试" }, { status: 503 }),
  );
  await assert.rejects(provider.saveReaderRemark(readerId, "🐱".repeat(201)), {
    status: 400,
  });
  assert.equal(requests.length, 0);
  assert.equal(
    (await provider.saveReaderRemark(readerId, "🐱".repeat(200))).remark,
    "🐱".repeat(200),
  );
  await assert.rejects(provider.saveReaderRemark(readerId, "待保存备注"), {
    status: 503,
    message: "保存失败，请重试",
  });
});

function fixture(...responses: Array<unknown | Response>) {
  const requests: Array<{ url: string; options: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, options = {}) => {
    requests.push({ url: String(input), options });
    assert(responses.length, "Unexpected extra HTTP request");
    const result = responses.shift();
    return result instanceof Response ? result : Response.json(result);
  };
  return {
    requests,
    provider: createAdminConsoleDataProvider({ fetch: fetcher }),
  };
}

test("reader and VIP lists translate the existing page/filter DTO without inventing REST fields", async () => {
  const { provider, requests } = fixture(readers(), readers());
  const signal = new AbortController().signal;
  const result = await provider.getList<AdminReader>("readers", {
    ...listParams,
    filter: { q: " UID 10009 ", status: "active" },
    signal,
  });
  assert.deepEqual(result.data, [reader]);
  assert.equal(result.total, 1);
  assert.deepEqual(result.meta?.summary, summary);
  const url = new URL(requests[0].url, "http://localhost");
  assert.equal(url.pathname, "/api/manage/readers");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    q: "UID 10009",
    status: "active",
    membership: "all",
    page: "1",
  });
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[0].options.signal, signal);
  await provider.getList("memberships", {
    ...listParams,
    filter: { membership: "expired" },
  });
  assert.equal(
    new URL(requests[1].url, "http://localhost").searchParams.get("membership"),
    "expired",
  );
});

test("fixed server pagination and unsupported CRUD fail before any request", async () => {
  const { provider, requests } = fixture();
  await assert.rejects(
    provider.getList("readers", {
      ...listParams,
      pagination: { page: 1, perPage: 25 },
    }),
    { status: 400 },
  );
  await assert.rejects(
    provider.update("readers", {
      id: readerId,
      data: { vip: true },
      previousData: reader,
    }),
    { status: 405 },
  );
  await assert.rejects(
    provider.delete("readers", { id: readerId, previousData: reader }),
    { status: 405 },
  );
  await assert.rejects(provider.getList("unrelated", listParams), {
    status: 404,
  });
  assert.equal(requests.length, 0);
});

test("getOne refreshes by a known UID but never invents GET readers/:id or returns a stale row", async () => {
  const changed = { ...reader, vip: false, vipUntil: null };
  const { provider, requests } = fixture(readers(), readers([changed]));
  await provider.getList("readers", listParams);
  const result = await provider.getOne<AdminReader>("readers", {
    id: readerId,
  });
  assert.equal(result.data.vip, false);
  assert.equal(
    new URL(requests[1].url, "http://localhost").pathname,
    "/api/manage/readers",
  );
  assert.equal(
    new URL(requests[1].url, "http://localhost").searchParams.get("q"),
    "UID 10009",
  );
  provider.clearIdentityCache();
  await assert.rejects(provider.getOne("readers", { id: readerId }), {
    status: 405,
  });
  assert.equal(requests.length, 2);
});

test("explicit UID lookup checks the immutable account UUID, not just a similar search result", async () => {
  const { provider } = fixture(
    readers([{ ...reader, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }]),
  );
  await assert.rejects(
    provider.getOne("readers", { id: readerId, meta: { uid: reader.uid } }),
    { status: 404 },
  );
});

test("profile review lists use the existing bounded queue and GET getOne refetches it", async () => {
  const avatar: AdminProfileReview = {
    ...profile,
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    kind: "avatar",
    proposedValue: null,
    avatarUrl:
      "/api/manage/review/avatar/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp",
  };
  const { provider, requests } = fixture(
    {
      profiles: [profile, avatar],
      expired: [{ id: "do-not-expose" }],
      files: [],
      versions: [],
      media: [],
    },
    { profiles: [] },
  );
  const result = await provider.getList<AdminProfileReview>("profile-reviews", {
    ...listParams,
    filter: { kind: "nickname" },
  });
  assert.deepEqual(result.data, [profile]);
  assert.equal(result.total, 1);
  assert.equal(result.meta?.queueLimit, 100);
  assert.equal(requests[0].url, "/api/manage/review");
  await assert.rejects(provider.getOne("profile-reviews", { id: reviewId }), {
    status: 404,
  });
});

test("dedicated reader commands send existing POST actions with confirmation and safe request headers", async () => {
  const updated = { ...reader, vipUntil: "2026-11-03T00:00:00Z" };
  const { provider, requests } = fixture(updated);
  const result = await provider.readerAction(readerId, "vip-add-days", {
    days: 2,
  });
  assert.deepEqual(result, updated);
  assert.equal(requests[0].url, `/api/manage/readers/${readerId}/vip-add-days`);
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0].options.body)), {
    confirmId: readerId,
    days: 2,
  });
  const headers = new Headers(requests[0].options.headers);
  assert.equal(headers.get("X-Author-Request"), "1");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(requests[0].options.credentials, "same-origin");
});

test("invalid days, ID and rejection reason cannot issue mutations", async () => {
  const { provider, requests } = fixture();
  for (const days of [0, 366, 1.5, NaN])
    await assert.rejects(
      provider.readerAction(readerId, "vip-add-days", { days }),
      { status: 400 },
    );
  await assert.rejects(provider.readerAction("../other", "disable"), {
    status: 400,
  });
  await assert.rejects(
    provider.reviewProfile(reviewId, "reject", { reason: "   " }),
    { status: 400 },
  );
  assert.equal(requests.length, 0);
});

test("review actions send only the existing reason contract and await actual approval success", async () => {
  const { provider, requests } = fixture(
    { ok: true },
    Response.json({ error: "已处理，请刷新列表。" }, { status: 404 }),
  );
  assert.deepEqual(
    await provider.reviewProfile(reviewId, "reject", {
      reason: " 请修改头像 ",
    }),
    { ok: true },
  );
  assert.equal(
    requests[0].url,
    `/api/manage/review/profile/${reviewId}/reject`,
  );
  assert.deepEqual(JSON.parse(String(requests[0].options.body)), {
    reason: "请修改头像",
  });
  await assert.rejects(provider.reviewProfile(reviewId, "approve"), {
    status: 404,
    message: "已处理，请刷新列表。",
  });
});

test("permission loss, server errors and malformed success never become optimistic success", async () => {
  const { provider } = fixture(
    Response.json({ error: "只有作者可以管理读者。" }, { status: 403 }),
    new Response("<html>broken</html>", { status: 502 }),
    { ok: true },
  );
  await assert.rejects(provider.readerAction(readerId, "disable"), {
    status: 403,
    message: "只有作者可以管理读者。",
  });
  await assert.rejects(provider.getList("readers", listParams), {
    status: 502,
  });
  await assert.rejects(provider.readerAction(readerId, "vip-grant"), {
    status: 502,
  });
});

test("one command in flight cannot be submitted twice and failed actions stay retryable", async () => {
  let complete: ((response: Response) => void) | undefined;
  let calls = 0;
  const provider = createAdminConsoleDataProvider({
    fetch: async () => {
      calls++;
      return await new Promise<Response>((resolve) => {
        complete = resolve;
      });
    },
  });
  const first = provider.readerAction(readerId, "vip-grant");
  await assert.rejects(provider.readerAction(readerId, "vip-grant"), {
    status: 409,
  });
  assert.equal(calls, 1);
  complete!(Response.json({ error: "暂时不可用" }, { status: 503 }));
  await assert.rejects(first, { status: 503 });
  const second = provider.readerAction(readerId, "vip-grant");
  assert.equal(calls, 2);
  complete!(Response.json(reader));
  assert.deepEqual(await second, reader);
});

test("permission failure clears UID hints and an in-flight old-identity response cannot restore them", async () => {
  const { provider } = fixture(
    readers(),
    Response.json({ error: "登录已失效。" }, { status: 401 }),
  );
  await provider.getList("readers", listParams);
  await assert.rejects(provider.getList("readers", listParams), {
    status: 401,
  });
  await assert.rejects(provider.getOne("readers", { id: readerId }), {
    status: 405,
  });

  let complete: ((response: Response) => void) | undefined;
  const delayed = createAdminConsoleDataProvider({
    fetch: async () =>
      await new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  });
  const oldRequest = delayed.getList("readers", listParams);
  delayed.clearIdentityCache();
  complete!(Response.json(readers()));
  await assert.rejects(oldRequest, { status: 409 });
  await assert.rejects(delayed.getOne("readers", { id: readerId }), {
    status: 405,
  });
});

test("profile images cannot replace the authenticated review URL with an external or unrelated path", async () => {
  const { provider } = fixture({
    profiles: [
      {
        ...profile,
        kind: "avatar",
        proposedValue: null,
        avatarUrl: "https://unrelated.example/avatar.webp",
      },
    ],
  });
  await assert.rejects(provider.getList("profile-reviews", listParams), {
    status: 502,
  });
});

test("bounded review queue reports its limit and paginates only the loaded records", async () => {
  const profiles = Array.from({ length: 100 }, (_, i) => ({
    ...profile,
    id: `${String(i).padStart(8, "0")}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
  }));
  const { provider } = fixture({ profiles });
  const result = await provider.getList("profile-reviews", {
    ...listParams,
    pagination: { page: 5, perPage: 20 },
  });
  assert.equal(result.data.length, 20);
  assert.equal(result.total, 100);
  assert.deepEqual(result.meta, {
    queueLimit: 100,
    loadedCount: 100,
    mayHaveMore: true,
  });
});

test("aborting a response body preserves cancellation instead of displaying a malformed-data error", async () => {
  const cancelled = new DOMException(
    "The operation was aborted.",
    "AbortError",
  );
  const response = Response.json(readers());
  response.json = async () => {
    throw cancelled;
  };
  const { provider } = fixture(response);
  await assert.rejects(
    provider.getList("readers", listParams),
    (error) => error === cancelled,
  );
});
