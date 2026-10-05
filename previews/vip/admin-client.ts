// Local author preview only; no production authentication or APIs are used.
import { adminReadersPage } from "../../src/admin-readers.ts";
import { escapeHTML as esc } from "../../src/core.ts";
import {
  amount,
  date,
  labels,
  orderDetails,
  pagination,
  statusLabel,
} from "./order-view.ts";
import type { AdminOrderPage } from "./orders.ts";

const main = document.querySelector<HTMLElement>("#main")!;
main.innerHTML = adminReadersPage({ demo: true });
const rail = main.querySelector(".reader-admin-rail")!;
rail.querySelectorAll("[data-admin-view]").forEach((button) => button.remove());
rail
  .querySelector(".reader-admin-nav-label")!
  .insertAdjacentHTML(
    "afterend",
    '<button class="reader-admin-nav" aria-current="page">订单管理</button>',
  );
rail.querySelector(".reader-admin-rail-bottom")!.innerHTML =
  '本地作者预览<a href="/">返回个人中心 ↗</a>';
const content = main.querySelector<HTMLElement>(".reader-admin-main")!;
content.innerHTML = `<header class="reader-admin-header"><div><span class="reader-admin-kicker">管理后台 / 订单</span><h1>订单管理</h1><p>查看所有演示账号的会员订单、支付状态与续期结果。</p></div><span class="reader-admin-header-badge">本地演示</span></header><div class="vip-admin-toolbar"><div class="reader-admin-filters" role="group" aria-label="订单状态"><button data-status="all" aria-pressed="true">全部</button>${Object.entries(
  labels,
)
  .map(
    ([value, label]) =>
      `<button data-status="${value}" aria-pressed="false">${label}</button>`,
  )
  .join(
    "",
  )}</div><button class="vip-secondary" data-refresh-orders>刷新订单</button></div><p class="vip-admin-message" role="status"></p><div id="admin-orders"></div>`;
const body = content.querySelector<HTMLElement>("#admin-orders")!;
const token = document.querySelector<HTMLMetaElement>(
  'meta[name="preview-token"]',
)!.content;
const detail = main.querySelector<HTMLDialogElement>("#reader-admin-detail")!;
detail.className = "vip-dialog";
detail.setAttribute("aria-label", "订单详情");
detail.addEventListener("click", (event) => {
  if ((event.target as Element).closest("[data-close-detail]")) detail.close();
});
let orders: AdminOrderPage["orders"] = [];
let page = 1,
  status = "all",
  generation = 0;
async function load() {
  const current = ++generation;
  body.setAttribute("aria-busy", "true");
  body
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => (b.disabled = true));
  content.querySelector(".vip-admin-message")!.textContent = "正在读取订单…";
  try {
    const response = await fetch(
      `/demo/admin/orders?page=${page}&status=${status}`,
      { credentials: "omit", headers: { "X-Preview-Token": token } },
    );
    if (!response.ok) throw Error("订单暂时无法读取，请刷新重试。");
    const value = (await response.json()) as AdminOrderPage;
    if (current !== generation) return;
    page = value.page;
    orders = value.orders;
    body.innerHTML = value.orders.length
      ? `<div class="reader-admin-table-wrap"><table class="reader-admin-table vip-admin-table"><thead><tr><th>下单用户</th><th>订单 / 时间</th><th>金额</th><th>支付状态</th><th>联系账号</th><th>明细</th></tr></thead><tbody>${value.orders.map((order) => `<tr><td><strong>${esc(order.nickname)}</strong><small>UID ${esc(order.uid)}</small></td><td><span class="vip-admin-number">${esc(order.id)}</span><small>${date(order.createdAt)}</small></td><td>${amount(order.amountFen)}</td><td>${statusLabel(order)}</td><td>${order.contactKind === "qq" ? "QQ" : "微信"}<small>${esc(order.contact)}</small></td><td><button class="reader-admin-row-open" data-order-detail="${esc(order.id)}">详情</button></td></tr>`).join("")}</tbody></table></div>${pagination(value)}`
      : '<div class="reader-admin-empty"><strong>暂无符合条件的订单</strong><p>用户在本地创建订单后会出现在这里。</p></div>';
    content.querySelector(".vip-admin-message")!.textContent =
      `共 ${value.total} 笔${status === "all" ? "" : labels[status as keyof typeof labels]}订单，每页最多 10 笔。`;
  } catch (error) {
    if (current === generation) {
      body.innerHTML = "";
      content.querySelector(".vip-admin-message")!.textContent =
        error instanceof Error ? error.message : "读取失败，请刷新。";
    }
  } finally {
    if (current === generation) body.setAttribute("aria-busy", "false");
  }
}
content.addEventListener("click", (event) => {
  const target = event.target as Element;
  const id = target.closest<HTMLElement>("[data-order-detail]")?.dataset
    .orderDetail;
  const order = orders.find((item) => item.id === id);
  if (order) {
    detail.innerHTML = `<header><h2>订单详情</h2><button data-close-detail aria-label="关闭订单详情">×</button></header><div class="vip-orders vip-admin-detail"><strong>${esc(order.nickname)} · UID ${esc(order.uid)}</strong><p>VIP 月度会员 · ${amount(order.amountFen)} ${statusLabel(order)}</p>${orderDetails(order)}</div>`;
    detail.showModal();
  }
  const filter = target.closest<HTMLElement>("[data-status]");
  if (filter) {
    status = filter.dataset.status!;
    page = 1;
    content
      .querySelectorAll<HTMLElement>("[data-status]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === filter)));
    void load();
  }
  const pagination = target.closest<HTMLElement>("[data-order-page]");
  if (pagination) {
    page = Number(pagination.dataset.orderPage);
    void load();
  }
  if (target.closest("[data-refresh-orders]")) void load();
});
await load();
