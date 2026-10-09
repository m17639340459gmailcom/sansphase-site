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

test('a stalled deferred module releases its deadline and retries without adopting a late attempt', async () => {
  let attempts = 0, resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  const current = { ready: true };
  const load = createDeferredModuleLoader(() => ++attempts === 1 ? old : Promise.resolve(current), { timeoutMs: 10 });
  const first = load();
  assert.equal(load(), first, 'concurrent requests share the deadline');
  await assert.rejects(Promise.race([first, new Promise((_, reject) => setTimeout(() => reject(new Error('test deadline missing')), 100))]), /timed out/);
  assert.equal(await load(), current);
  resolveOld({ ready: false }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await load(), current, 'late completion cannot replace the successful retry');
  assert.equal(attempts, 2);
});
