import test from "node:test";
import assert from "node:assert/strict";
import { createDeferredModuleLoader } from "../src/admin-route.mjs";

test("admin module is shared across simultaneous and later visits", async () => {
  let attempts = 0;
  const module = { adminReadersPage() {}, mountReaderAdmin() {} };
  const load = createDeferredModuleLoader(async () => {
    attempts++;
    return module;
  });
  const [first, second] = await Promise.all([load(), load()]);
  assert.equal(first, module);
  assert.equal(second, module);
  assert.equal(await load(), module);
  assert.equal(attempts, 1);
});

test("a failed admin module download is retried on the next visit", async () => {
  let attempts = 0;
  const load = createDeferredModuleLoader(async () => {
    if (++attempts === 1) throw Error("network");
    return { adminReadersPage() {}, mountReaderAdmin() {} };
  });
  await assert.rejects(load(), /network/);
  assert.ok((await load()).adminReadersPage);
  assert.equal(attempts, 2);
});
