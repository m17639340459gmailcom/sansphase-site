import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  membershipSummary,
  mountMembershipClock,
  renderMembership,
  refreshMembership,
} from "../src/reader-membership.ts";
import { readerPage } from "../src/reader-ui.ts";

const now = Date.parse("2026-09-30T08:00:00Z");

test('only server-confirmed expiration removes the VIP frame without rebuilding unsaved controls or clearing stored selection', () => {
  const currentTime = Date.now(), expiry = currentTime + 60000;
  for (const frame of ['vipmoon', 'gold']) {
    const reader = { uid: '10001', nickname: 'VIP读者', email: 'vip@example.test', vip: true, vipUntil: new Date(expiry).toISOString(), frame, frameImage: null };
    const dom = new JSDOM(readerPage('account', '', reader));
    try {
      const doc = dom.window.document, input = doc.querySelector('[name="nickname"]');
      input.value = '未保存昵称';
      const avatar = doc.querySelector('[data-reader-avatar-trigger]');
      refreshMembership(doc, false, expiry - 1);
      assert.ok(avatar.classList.contains(`reader-avatar-frame-${frame}`));
      assert.equal(refreshMembership(doc, false, expiry + 5000).active, true);
      assert.ok(avatar.classList.contains(`reader-avatar-frame-${frame}`), 'a fast device clock cannot revoke the server-confirmed membership');
      doc.querySelector('[data-reader-membership]').dataset.vip = 'false';
      assert.equal(refreshMembership(doc, false, expiry + 5000).active, false);
      assert.equal(avatar.classList.contains(`reader-avatar-frame-${frame}`), frame !== 'vipmoon');
      if (frame === 'vipmoon') assert.equal(avatar.querySelector('.reader-profile-frame-image'), null);
      assert.equal(doc.querySelector('[name="nickname"]'), input);
      assert.equal(input.value, '未保存昵称');
      assert.equal(reader.frame, frame, 'expiry is a local display projection, never a persistence mutation');
    } finally { dom.window.close(); }
  }
});
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
    true,
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
    "active",
  );
  assert.equal(
    membershipSummary(
      { vip: true, vipUntil: new Date(now + 25 * 3600000).toISOString() },
      now,
    ).remaining,
    "1 天 1 小时",
  );
});
test("server qualification refresh expires visual membership without rebuilding or losing an unsaved profile", () => {
  const reader = { vip: true, vipUntil: new Date(now + 60000).toISOString() };
  const dom = new JSDOM(
    `<div class="reader-card--profile"><section class="reader-profile-card reader-profile-card--vip"><span class="reader-profile-status reader-profile-status--vip">VIP</span></section>${renderMembership(reader, false, now)}<input value="before"></div>`,
  );
  const doc = dom.window.document;
  doc.querySelector("input").value = "尚未保存的签名";
  refreshMembership(doc, false, now + 60000);
  assert.match(doc.querySelector('.reader-profile-status').textContent, /VIP/);
  assert.ok(doc.querySelector('.reader-profile-card--vip'));
  doc.querySelector('[data-reader-membership]').dataset.vip = 'false';
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

test('seconds, minutes and days of device clock skew never override the latest server membership verdict', () => {
  const expiry = now + 1000;
  for (const offset of [-86400000, -300000, -5000, 0, 5000, 300000, 86400000]) {
    const clock = now + offset;
    const approved = membershipSummary({ vip: true, vipUntil: new Date(expiry).toISOString() }, clock);
    assert.equal(approved.active, true, `server-approved VIP at device offset ${offset}`);
    assert.equal(approved.status, 'active');
    assert.equal(membershipSummary({ vip: false, vipUntil: new Date(expiry).toISOString() }, clock).active, false);
    assert.equal(membershipSummary({ vipUntil: new Date(expiry).toISOString() }, clock).active, false);
  }
  assert.equal(membershipSummary({ vip: true }, now).remaining, '—', 'missing timing data does not invent a countdown');
});

test('an elapsed local estimate cannot create a tight membership refresh loop', t => {
  const dom = new JSDOM(renderMembership({ vip: true, vipUntil: new Date(now).toISOString() }, false, now), { pretendToBeVisual: true });
  const delays = [];
  t.mock.method(globalThis, 'setTimeout', (_update, delay) => { delays.push(delay); return 0; });
  const clock = mountMembershipClock(dom.window.document, () => false);
  try {
    clock.update();
    assert.deepEqual(delays, [60000]);
  } finally { clock.dispose(); dom.window.close(); }
});

test('a long-lived account rechecks server expiry using server time instead of a fast or slow device clock', async t => {
  for (const offset of [-86400000, 86400000]) {
    await t.test(`clock offset ${offset}`, async subt => {
      let elapsed = 0, calls = 0, expired = false;
      const reader = { vip: true, vipUntil: new Date(now + 2000).toISOString() };
      const dom = new JSDOM(`<div class="reader-card--profile"><section class="reader-profile-card reader-profile-card--vip"><span class="reader-profile-status reader-profile-status--vip">VIP</span></section>${renderMembership(reader, false, now)}<input value="draft"></div>`, { pretendToBeVisual: true });
      const schedules = [];
      subt.mock.method(Date, 'now', () => now + offset);
      subt.mock.method(performance, 'now', () => elapsed);
      subt.mock.method(globalThis, 'setTimeout', (callback, delay) => { schedules.push({ callback, delay }); return 0; });
      const clock = mountMembershipClock(dom.window.document, () => false, { async refresh() { calls++; return { reader: { ...reader, vip: !expired }, serverNow: now + elapsed }; } });
      const input = dom.window.document.querySelector('input'); input.value = 'unsaved draft';
      try {
        clock.update();
        assert.equal(calls, 0, 'initial rendering does not invent a network request');
        await clock.recheck();
        assert.equal(calls, 1);
        assert.equal(schedules.at(-1).delay, 3000, 'the next expiry check follows server time');
        assert.match(dom.window.document.querySelector('.reader-profile-status').textContent, /VIP/);
        elapsed = 3000; expired = true;
        schedules.at(-1).callback(); await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls, 2);
        assert.equal(dom.window.document.querySelector('[data-reader-membership]').dataset.vip, 'false');
        assert.equal(dom.window.document.querySelector('.reader-profile-card--vip'), null);
        assert.equal(dom.window.document.querySelector('input'), input);
        assert.equal(input.value, 'unsaved draft');
        assert.equal(schedules.at(-1).delay, 60000);
      } finally { clock.dispose(); dom.window.close(); }
    });
  }
});

test('membership refresh coalesces pending requests and preserves the last server verdict on failure', async t => {
  const reader = { vip: true, vipUntil: new Date(now).toISOString() };
  const dom = new JSDOM(renderMembership(reader, false, now), { pretendToBeVisual: true });
  let calls = 0, reject;
  const delays = [];
  t.mock.method(globalThis, 'setTimeout', (_callback, delay) => { delays.push(delay); return 0; });
  const clock = mountMembershipClock(dom.window.document, () => false, { refresh() { calls++; return new Promise((_resolve, fail) => { reject = fail; }); } });
  try {
    clock.update();
    const pending = clock.recheck(); await clock.recheck();
    assert.equal(calls, 1);
    reject(new Error('offline')); await pending;
    assert.equal(dom.window.document.querySelector('[data-reader-membership]').dataset.vip, 'true');
    assert.equal(delays.at(-1), 60000);
    clock.pause();
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.equal(calls, 1, 'leaving the account view stops membership queries');
  } finally { clock.dispose(); dom.window.close(); }
});

test('a hidden account waits until visibility returns and an old response cannot update a replacement account section', async t => {
  const dom = new JSDOM(renderMembership({ vip: true, vipUntil: new Date(now).toISOString() }, false, now), { pretendToBeVisual: true });
  let hidden = true, calls = 0, resolve;
  Object.defineProperty(dom.window.document, 'hidden', { get: () => hidden });
  t.mock.method(globalThis, 'setTimeout', () => 0);
  const clock = mountMembershipClock(dom.window.document, () => false, { refresh() { calls++; return new Promise(done => { resolve = done; }); } });
  try {
    clock.update(); await clock.recheck(); assert.equal(calls, 0);
    hidden = false;
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.equal(calls, 1);
    const old = dom.window.document.querySelector('[data-reader-membership]');
    const next = old.cloneNode(true); next.dataset.vip = 'false'; old.replaceWith(next);
    resolve({ reader: { vip: true, vipUntil: new Date(now + 86400000).toISOString() }, serverNow: now });
    await new Promise(done => setImmediate(done));
    assert.equal(next.dataset.vip, 'false');
  } finally { clock.dispose(); dom.window.close(); }
});
