import { readerPage } from "../../src/reader-ui.ts";
import { mountMembershipClock } from "../../src/reader-membership.ts";
import { escapeHTML as esc } from "../../src/core.ts";
import { mountOrderDialog, labels, date, amount } from "./order-view.ts";
import type { DemoOrder, DemoReader } from "./orders.ts";

const main = document.querySelector<HTMLElement>("#main")!;
const dialog = document.querySelector<HTMLDialogElement>("#checkout")!;
const token = document.querySelector<HTMLMetaElement>(
  'meta[name="preview-token"]',
)!.content;
const clock = mountMembershipClock(document, () => false);
let readerId = "reader",
  reader: DemoReader,
  orderCount = 0,
  active: DemoOrder | null = null,
  busy = false;
async function api<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("/demo/" + path, {
    method: body ? "POST" : "GET",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      "X-Preview-Token": token,
      "X-Demo-Reader": readerId,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "操作失败，请重试。");
  return data as T;
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
function message(text: string) {
  document.querySelector<HTMLElement>("#preview-message")!.textContent = text;
}
function renderAccount() {
  main.innerHTML = readerPage("account", "", reader);
  const content = main.querySelector(".reader-content")!;
  content
    .querySelector(".reader-exit")
    ?.setAttribute("href", "http://127.0.0.1:4177/#/notes");
  content.querySelector(".reader-heading h1")!.textContent = "个人中心";
  content.querySelector(".reader-heading p")!.textContent =
    "查看个人资料、会员状态和订单记录。";
  content.querySelector(".reader-profile-edit-title")?.remove();
  content.querySelector('[data-reader-form="profile"]')?.remove();
  content.querySelector("[data-reader-logout]")?.remove();
  const avatar = content.querySelector<HTMLButtonElement>(
    "[data-reader-avatar-trigger]",
  );
  if (avatar) {
    avatar.disabled = true;
    avatar.title = "资料编辑沿用正式功能，此预览仅测试会员与订单。";
  }
  content
    .querySelector("[data-reader-membership]")
    ?.insertAdjacentHTML(
      "beforeend",
      `<div class="vip-actions"><button class="reader-primary" data-upgrade>${reader.vip ? "续期 VIP" : "开通 VIP"} · ¥200 / 月</button><button class="vip-secondary" data-show-orders>我的订单 · ${orderCount}</button></div>`,
    );
  // Membership clock only replaces summary contents, so actions sit after it.
  const actions = content.querySelector(".vip-actions");
  if (actions)
    content.querySelector("[data-reader-membership]")!.after(actions);
  clock.update();
}
async function refresh() {
  const state = await api<{ reader: DemoReader; orderCount: number }>("state");
  reader = state.reader;
  orderCount = state.orderCount;
  renderAccount();
}
function checkoutBody() {
  if (!active)
    return `<form id="checkout-form"><div class="vip-offer"><span>月度会员</span><strong>¥200<small> / 一个自然月</small></strong><p>单次购买，不自动扣费续订。</p></div><fieldset class="vip-contact"><legend>联系账号 <span>必填，仅用于订单联系</span></legend><div class="vip-contact-types"><label><input type="radio" name="kind" value="qq" checked> QQ</label><label><input type="radio" name="kind" value="wechat">微信</label></div><label class="reader-field"><span>QQ 号或微信号</span><input name="contact" required maxlength="64" autocomplete="off" placeholder="请填写方便联系到你的账号"></label></fieldset><section class="vip-rules" aria-label="VIP 特权与规则"><h3>VIP 特权与规则</h3><ul><li>有效期内可阅读作者设置为 VIP 专属的资源中心书籍。</li><li>每次购买增加一个自然月；有效会员从原到期时间顺延，已到期会员从支付成功时间开始。目标月份没有对应日期时，取该月最后一天。</li><li>仅支付成功后开通，失败或取消不会增加会员时间。</li><li>VIP 仅提供阅读权限，不包含发布内容或管理网站的权限。</li></ul><p>当前为本地规则演示，正式支付及售后规则接入前另行确认。</p></section><label class="vip-consent"><input type="checkbox" name="agree" required>我已阅读 VIP 特权与规则，并确认联系方式填写无误</label><button class="vip-primary" type="submit">创建订单 · ¥200</button></form>`;
  const done = active.status !== "pending";
  return `<div class="vip-payment"><span class="vip-order-status is-${active.status}">${labels[active.status]}</span><h3>${done ? (active.status === "paid" ? "会员已更新" : active.status === "failed" ? "此次支付未完成" : "订单已取消") : "使用支付宝扫码支付"}</h3><strong class="vip-payment-price">${amount(active.amountFen)}</strong><p class="vip-order-number">订单号 ${esc(active.id)}</p>${!done ? `<div class="vip-qr-placeholder"><span aria-hidden="true">▦</span><strong>支付二维码待接入</strong><p>当前不会收款，无需打开支付宝。</p></div><p>支付成功确认后，会员时间才会增加。</p><div class="vip-simulation"><strong>本地测试操作</strong><p>下面的按钮只改变演示订单，不会真实扣款。</p><div><button class="vip-primary" data-outcome="paid">模拟支付成功</button><button class="vip-secondary" data-outcome="failed">模拟支付失败</button><button class="vip-secondary" data-outcome="cancelled">取消订单</button></div></div>` : `<p>${active.status === "paid" ? `本次续期至 ${date(active.vipUntil)}。` : "会员时间未增加。可关闭窗口后重新创建订单。"}</p><button class="vip-primary" data-close-checkout>返回个人中心</button>`}</div>`;
}
function renderDialog() {
  dialog.querySelector("#checkout-body")!.innerHTML = checkoutBody();
  dialog.querySelector("#checkout-message")!.textContent = "";
}
function openCheckout(order: DemoOrder | null) {
  active = order;
  renderDialog();
  dialog.showModal();
}
function closeCheckout() {
  dialog.close();
  main
    .querySelector<HTMLButtonElement>("[data-upgrade]")
    ?.focus({ preventScroll: true });
}
const orderDialog = mountOrderDialog(api, openCheckout);
document.addEventListener("click", async (event) => {
  const target = event.target as Element;
  if (target.closest("[data-upgrade]")) openCheckout(null);
  if (target.closest("[data-show-orders]")) orderDialog.open();
  if (target.closest("[data-close-checkout]") && !busy) closeCheckout();
  const outcome =
    target.closest<HTMLButtonElement>("[data-outcome]")?.dataset.outcome;
  if (outcome && active && !busy) {
    busy = true;
    dialog
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = true));
    try {
      active = await api<DemoOrder>("outcome", { id: active.id, outcome });
      await refresh();
      renderDialog();
      dialog.querySelector<HTMLButtonElement>("[data-close-checkout]")?.focus();
    } catch (error) {
      dialog.querySelector("#checkout-message")!.textContent = errorText(error);
    } finally {
      busy = false;
      dialog
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => (b.disabled = false));
    }
  }
});
dialog.addEventListener("cancel", (event) => {
  if (busy) event.preventDefault();
});
document.addEventListener("submit", async (event) => {
  const form = event.target as HTMLFormElement;
  if (form.id !== "checkout-form") return;
  event.preventDefault();
  if (busy) return;
  busy = true;
  const button = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )!;
  button.disabled = true;
  try {
    const values = new FormData(form);
    active = await api<DemoOrder>("orders", {
      kind: values.get("kind"),
      contact: values.get("contact"),
      agree: values.get("agree") === "on",
    });
    await refresh();
    renderDialog();
    dialog.querySelector<HTMLButtonElement>("[data-outcome]")?.focus();
  } catch (error) {
    dialog.querySelector("#checkout-message")!.textContent = errorText(error);
  } finally {
    busy = false;
    button.disabled = false;
  }
});
document
  .querySelector<HTMLSelectElement>("#demo-reader")!
  .addEventListener("change", async (event) => {
    const select = event.target as HTMLSelectElement;
    readerId = select.value;
    select.disabled = true;
    main.inert = true;
    try {
      await refresh();
      message("已切换演示账号，订单分别保存。");
    } catch (error) {
      message(errorText(error));
    } finally {
      select.disabled = false;
      main.inert = false;
    }
  });
try {
  await refresh();
} catch (error) {
  message(errorText(error));
}
