import test from "node:test";
import assert from "node:assert/strict";
import { createDemoOrders } from "./orders.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("local order success grants one calendar month only once; failed/cancelled orders never grant", () => {
  let now = Date.parse("2026-01-31T12:00:00Z");
  const store = createDemoOrders(":memory:", () => now);
  try {
    const before = store.reader("reader");
    const order = store.create("reader", "qq", "12345678");
    assert.equal(order.amountFen, 20000);
    assert.equal(order.status, "pending");
    assert.deepEqual(store.reader("reader"), before);
    const paid = store.finish("reader", order.id, "paid");
    assert.equal(paid.vipUntil, "2026-02-28T12:00:00.000Z");
    now += 1000;
    assert.deepEqual(store.finish("reader", order.id, "paid"), paid);
    const renewal = store.finish(
      "reader",
      store.create("reader", "wechat", "demo_contact").id,
      "paid",
    );
    assert.equal(renewal.vipUntil, "2026-03-28T12:00:00.000Z");
    const fail = store.create("reader", "qq", "12345678");
    store.finish("reader", fail.id, "failed");
    assert.throws(() => store.finish("reader", fail.id, "paid"));
    const cancelled = store.create("reader", "qq", "12345678");
    store.finish("reader", cancelled.id, "cancelled");
    assert.equal(store.reader("reader").vipUntil, renewal.vipUntil);
    assert.equal(store.order("vip", order.id), null);
    assert.throws(() => store.finish("vip", order.id, "paid"));
    assert.throws(() => store.create("reader", "qq", ""));
    assert.throws(() => store.create("reader", "other", "contact"));
    assert.equal(store.count("reader"), 4);
  } finally {
    store.close();
  }
});

test("orders and expiry survive a local server restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sansphase-vip-test-")),
    path = join(directory, "demo.db");
  let store = createDemoOrders(path, () => Date.parse("2026-09-30T08:00:00Z"));
  try {
    const order = store.create("expired", "wechat", "local_contact");
    const paid = store.finish("expired", order.id, "paid");
    store.close();
    store = createDemoOrders(path);
    assert.deepEqual(store.order("expired", order.id), paid);
    assert.equal(store.reader("expired").vipUntil, paid.vipUntil);
    assert.equal(store.count("reader"), 0);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("reader orders paginate without crossing accounts; author sees and filters all orders", () => {
  const store = createDemoOrders(":memory:", () =>
    Date.parse("2026-09-30T08:00:00Z"),
  );
  try {
    const ids = Array.from(
      { length: 12 },
      () => store.create("reader", "qq", "local_reader").id,
    );
    const vipOrder = store.create("vip", "wechat", "local_vip");
    store.finish("vip", vipOrder.id, "paid");
    assert.equal(store.count("reader"), 12);
    const first = store.page("reader", 1);
    assert.equal(first.total, 12);
    assert.equal(first.totalPages, 3);
    assert.deepEqual(
      first.orders.map((o) => o.id),
      ids.slice(-5).reverse(),
    );
    const last = store.page("reader", 999);
    assert.equal(last.page, 3);
    assert.equal(last.orders.length, 2);
    assert.equal(store.page("expired", 1).total, 0);
    assert.throws(() => store.page("unknown", 1));
    assert.throws(() => store.page("reader", NaN));
    const all = store.adminPage(1, "all");
    assert.equal(all.total, 13);
    assert.equal(all.orders.length, 10);
    assert.equal(all.orders[0]!.readerId, "vip");
    assert.equal(store.adminPage(1, "paid").orders[0]!.id, vipOrder.id);
    assert.equal(store.adminPage(1, "failed").total, 0);
    assert.throws(() => store.adminPage(1, "invalid"));
  } finally {
    store.close();
  }
});
