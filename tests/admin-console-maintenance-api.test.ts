import test from "node:test";
import assert from "node:assert/strict";
import {
  createMaintenanceApi,
  cleanupFeedback,
  retainCleanupSelection,
} from "../src/admin-console/maintenance-api.ts";

const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const at = "2026-10-12T08:00:00.000Z";
const queues = {
  profiles: [],
  expired: [{ id: first, email: "expired@example.test", expiresAt: at }],
  files: [
    {
      id: second,
      filename: `reader-avatar-${first}.webp`,
      reason: "reader-deleted",
      created_at: at,
      last_error: "private path error",
    },
  ],
  versions: [
    { id: first, collection: "articles", parent_id: second, created_at: at },
  ],
  media: [
    { id: second, media_id: first, reason: "deleted-content", created_at: at },
  ],
};
function fixture(...values: Array<unknown | Response>) {
  const requests: Array<{ url: string; options: RequestInit }> = [];
  const api = createMaintenanceApi({
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      const value = values.shift();
      return value instanceof Response ? value : Response.json(value);
    },
  });
  return { api, requests };
}
test("maintenance reads only existing owner queues with private same-origin requests", async () => {
  const { api, requests } = fixture(queues);
  const value = await api.loadQueues();
  assert.equal(value.expired[0].title, "expired@example.test");
  assert.equal(value.files[0].needsRetry, true);
  assert.doesNotMatch(JSON.stringify(value), /private path error|profiles/);
  assert.equal(requests[0].url, "/api/manage/review");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.redirect, "error");
});
test("cleanup only sends the frozen selected IDs, validates membership and limits before writing", async () => {
  const { api, requests } = fixture(queues, {
    cleaned: 1,
    failed: 0,
    protected: 0,
  });
  const value = await api.loadQueues();
  await assert.rejects(api.cleanup("files", [first], value.files), {
    status: 400,
  });
  await assert.rejects(api.cleanup("files", [], value.files), { status: 400 });
  await assert.rejects(
    api.cleanup("files", Array(101).fill(second), value.files),
    { status: 400 },
  );
  assert.equal(requests.length, 1);
  await api.cleanup("files", [second, second], value.files);
  assert.equal(requests[1].url, "/api/manage/review/files/cleanup");
  assert.deepEqual(JSON.parse(String(requests[1].options.body)), {
    ids: [second],
  });
  assert.equal(
    new Headers(requests[1].options.headers).get("X-Author-Request"),
    "1",
  );
  assert.deepEqual(retainCleanupSelection([first, second], value.files), [
    second,
  ]);
});
test("cleanup feedback never claims protected, shared, deferred, or missing rows were deleted", () => {
  assert.equal(
    cleanupFeedback(
      { cleaned: 1, failed: 1, protected: 1, shared: 0, deferred: false },
      4,
    ).severity,
    "warning",
  );
  const text = cleanupFeedback(
    { cleaned: 1, failed: 1, protected: 1, shared: 0, deferred: false },
    4,
  ).message;
  assert.match(text, /仍在使用.*1/);
  assert.match(text, /失败.*1/);
  assert.match(text, /未处理.*1/);
  assert.match(
    cleanupFeedback(
      { cleaned: 0, failed: 0, protected: 0, shared: 1, deferred: false },
      1,
    ).message,
    /共享.*保留/,
  );
  assert.match(
    cleanupFeedback(
      { cleaned: 0, failed: 0, protected: 0, shared: 0, deferred: true },
      1,
    ).message,
    /暂缓/,
  );
});
test("failed commands preserve server errors, reject malformed counts and prevent double submission", async () => {
  let release: ((response: Response) => void) | undefined;
  const api = createMaintenanceApi({
    fetch: async () =>
      new Promise((done) => {
        release = done;
      }),
  });
  const row = {
    id: first,
    title: "one",
    description: "",
    createdAt: at,
    needsRetry: false,
  };
  const pending = api.cleanup("expired", [first], [row]);
  await assert.rejects(api.cleanup("expired", [first], [row]), { status: 409 });
  release!(Response.json({ error: "清理暂不可用" }, { status: 503 }));
  await assert.rejects(pending, { status: 503, message: "清理暂不可用" });
  const f = fixture({ cleaned: -1 });
  await assert.rejects(f.api.cleanup("expired", [first], [row]), {
    status: 502,
  });
});
test("recent activity projects only safe known fields and does not retain remark bodies", async () => {
  const { api } = fixture({
    events: [
      {
        action: "remark",
        at,
        readerId: first,
        cleared: false,
        length: 4,
        remark: "private sentinel",
        actorId: second,
      },
    ],
  });
  const events = await api.loadActivity();
  assert.equal(events[0].action, "remark");
  assert.equal(events[0].length, 4);
  assert.doesNotMatch(JSON.stringify(events), /private sentinel|actorId/);
});
