import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  membershipSummary,
  renderMembership,
  refreshMembership,
} from "../src/reader-membership.ts";
import { readerPage } from "../src/reader-ui.ts";

const now = Date.parse("2026-09-30T08:00:00Z");
test("account page includes membership without adding checkout or replacing profile controls", () => {
  const html = readerPage("account", "", {
    nickname: "测试读者",
    email: "reader@example.test",
    vip: false,
  });
  assert.match(html, /data-reader-membership/);
  assert.match(html, /data-reader-form="profile"/);
  assert.doesNotMatch(html, /模拟支付|data-checkout|支付宝/);
});
test("membership display respects server authority and exact five-day boundary", () => {
  assert.equal(
    membershipSummary({ vip: false, vipUntil: "2026-11-01T08:00:00Z" }, now)
      .active,
    false,
  );
  assert.equal(
    membershipSummary({ vip: true, vipUntil: "invalid" }, now).active,
    false,
  );
  assert.equal(
    membershipSummary(
      { vip: true, vipUntil: new Date(now + 5 * 86400000).toISOString() },
      now,
    ).expiring,
    true,
  );
  assert.equal(
    membershipSummary(
      { vip: true, vipUntil: new Date(now + 5 * 86400000 + 1).toISOString() },
      now,
    ).expiring,
    false,
  );
  assert.equal(
    membershipSummary(
      { vip: true, vipUntil: new Date(now + 1).toISOString() },
      now,
    ).remaining,
    "不足 1 小时",
  );
  assert.equal(
    membershipSummary({ vip: true, vipUntil: new Date(now).toISOString() }, now)
      .status,
    "expired",
  );
  assert.equal(
    membershipSummary(
      { vip: true, vipUntil: new Date(now + 25 * 3600000).toISOString() },
      now,
    ).remaining,
    "1 天 1 小时",
  );
});
test("time refresh expires visual membership without rebuilding or losing an unsaved profile", () => {
  const reader = { vip: true, vipUntil: new Date(now + 60000).toISOString() };
  const dom = new JSDOM(
    `<div class="reader-card--profile"><section class="reader-profile-card reader-profile-card--vip"><span class="reader-profile-status reader-profile-status--vip">VIP</span></section>${renderMembership(reader, false, now)}<input value="before"></div>`,
  );
  const doc = dom.window.document;
  doc.querySelector("input").value = "尚未保存的签名";
  refreshMembership(doc, false, now + 60000);
  assert.match(
    doc.querySelector("[data-reader-membership]").textContent,
    /会员已到期/,
  );
  assert.doesNotMatch(
    doc.querySelector(".reader-profile-status").textContent,
    /VIP/,
  );
  assert.equal(doc.querySelector(".reader-profile-card--vip"), null);
  assert.equal(doc.querySelector("input").value, "尚未保存的签名");
  dom.window.close();
});
