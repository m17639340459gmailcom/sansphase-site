import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, rmdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  cleanupAdminConsoleDirectory,
  createAdminConsolePreview,
} from "../scripts/preview-admin-console.ts";

test(
  "closing a used preview releases its database and listener before removing its directory",
  { timeout: 60000 },
  async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const preview = await createAdminConsolePreview({
        port: 0,
        buildAssets: false,
      });
      const login = await fetch(preview.origin + "/api/author/login", {
        method: "POST",
        headers: {
          Origin: preview.origin,
          "X-Author-Request": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "owner@example.test",
          password: "DemoLogin2026!",
        }),
      });
      assert.equal(login.status, 200);
      await login.arrayBuffer();
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const readers = await fetch(preview.origin + "/api/manage/readers", {
        headers: { Cookie: cookie },
      });
      assert.equal(readers.status, 200);
      await readers.arrayBuffer();
      const firstClose = preview.close();
      assert.equal(
        preview.close(),
        firstClose,
        "concurrent close calls share one shutdown",
      );
      await firstClose;
      await assert.rejects(access(preview.directory), { code: "ENOENT" });
      await assert.rejects(
        fetch(preview.origin + "/preview-login", {
          signal: AbortSignal.timeout(1000),
        }),
      );
      await preview.close();
    }
  },
);

test(
  "a preview startup failure still reaps its process and temporary directory",
  { timeout: 30000 },
  async () => {
    let failedDirectory = "";
    await assert.rejects(
      createAdminConsolePreview({ port: -1, buildAssets: false }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.match(String(error.errors[0]), /Invalid local preview port/);
        assert.ok(
          "previewDirectory" in error &&
            typeof error.previewDirectory === "string",
        );
        failedDirectory = error.previewDirectory;
        return true;
      },
    );
    assert.equal(resolve(".local", basename(failedDirectory)), failedDirectory);
    assert.match(basename(failedDirectory), /^admin-console-preview-/);
    await assert.rejects(access(failedDirectory), { code: "ENOENT" });
  },
);

async function directory(
  t: test.TestContext,
  prefix = "admin-console-preview-",
) {
  const root = resolve(".local");
  const path = await mkdtemp(resolve(root, prefix));
  t.after(async () => {
    assert.equal(resolve(root, basename(path)), path);
    await rmdir(path);
  });
  return path;
}
test("a persistent preview file lock has three bounded attempts and reports its exact retained directory", async (t) => {
  const path = await directory(t);
  let attempts = 0;
  await assert.rejects(
    cleanupAdminConsoleDirectory(path, async (target, options) => {
      assert.equal(target, path);
      assert.equal(options.maxRetries, 0);
      attempts++;
      throw Object.assign(Error("locked"), { code: "EPERM" });
    }),
    (error) =>
      error instanceof Error &&
      error.message.includes(path) &&
      error.message.includes("清理失败"),
  );
  assert.equal(attempts, 3);
});
test("transient preview locks retry without nested recursive retries", async (t) => {
  const path = await directory(t);
  let attempts = 0;
  await cleanupAdminConsoleDirectory(path, async (_target, options) => {
    assert.deepEqual(options, { recursive: true, force: true, maxRetries: 0 });
    if (++attempts === 1) throw Object.assign(Error("busy"), { code: "EBUSY" });
  });
  assert.equal(attempts, 2);
});
test("cleanup keeps ownership validation and does not retry unexpected filesystem failures", async (t) => {
  const unexpected = await directory(t, "admin-cleanup-refusal-");
  let invoked = false;
  await assert.rejects(
    cleanupAdminConsoleDirectory(unexpected, async () => {
      invoked = true;
    }),
    /Unsafe local preview cleanup path/,
  );
  assert.equal(invoked, false);
  const path = await directory(t);
  let attempts = 0;
  await assert.rejects(
    cleanupAdminConsoleDirectory(path, async () => {
      attempts++;
      throw Object.assign(Error("I/O failure"), { code: "EIO" });
    }),
    /清理失败/,
  );
  assert.equal(attempts, 1);
});
