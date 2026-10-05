import { escapeHTML as esc } from "../../src/core.ts";
import type { DemoOrder, OrderPage } from "./orders.ts";

export const labels = {
  pending: "待支付",
  paid: "支付成功",
  failed: "支付失败",
  cancelled: "已取消",
};
export const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN") : "—";
export const amount = (value: number) => `¥${(value / 100).toFixed(2)}`;
export const statusLabel = (order: DemoOrder) =>
  `<span class="vip-order-status is-${order.status}">${labels[order.status]}</span>`;
export function orderDetails(order: DemoOrder) {
  return `<dl><div><dt>订单号</dt><dd>${esc(order.id)}</dd></div><div><dt>创建时间</dt><dd>${date(order.createdAt)}</dd></div><div><dt>联系方式</dt><dd>${order.contactKind === "qq" ? "QQ" : "微信"} · ${esc(order.contact)}</dd></div>${order.paidAt ? `<div><dt>支付时间</dt><dd>${date(order.paidAt)}</dd></div><div><dt>本单续期至</dt><dd>${date(order.vipUntil)}</dd></div>` : ""}</dl>`;
}
export function pagination(value: OrderPage) {
  return `<nav class="vip-pagination" aria-label="订单分页"><span>共 ${value.total} 笔 · 第 ${value.page} / ${value.totalPages} 页</span><button class="vip-secondary" data-order-page="${value.page - 1}" ${value.page <= 1 ? "disabled" : ""}>上一页</button><button class="vip-secondary" data-order-page="${value.page + 1}" ${value.page >= value.totalPages ? "disabled" : ""}>下一页</button></nav>`;
}
export function readerOrders(value: OrderPage) {
  return `<div class="vip-order-scroll">${value.orders.length ? `<ol>${value.orders.map((order) => `<li><details><summary><span><strong>VIP 月度会员</strong><small>${date(order.createdAt)} · ${amount(order.amountFen)}</small></span>${statusLabel(order)}<span class="vip-detail-hint">详情</span></summary>${orderDetails(order)}${order.status === "pending" ? `<button class="vip-secondary" data-open-order="${esc(order.id)}">继续支付</button>` : ""}</details></li>`).join("")}</ol>` : '<div class="vip-empty"><strong>还没有订单</strong><p>创建会员订单后，可在这里查看支付状态和续期结果。</p></div>'}</div>${pagination(value)}`;
}

export function mountOrderDialog(
  api: <T>(path: string) => Promise<T>,
  openCheckout: (order: DemoOrder) => void,
) {
  const dialog = document.createElement("dialog");
  dialog.className = "vip-dialog vip-orders-dialog";
  dialog.setAttribute("aria-labelledby", "orders-title");
  dialog.innerHTML =
    '<header><h2 id="orders-title">我的订单</h2><button aria-label="关闭订单窗口" data-close-orders>×</button></header><div class="vip-orders" data-order-body></div>';
  document.body.append(dialog);
  const body = dialog.querySelector<HTMLElement>("[data-order-body]")!;
  let orders: DemoOrder[] = [],
    generation = 0;
  async function load(page: number, restoreFocus = true) {
    const current = ++generation;
    body.setAttribute("aria-busy", "true");
    body
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = true));
    try {
      const value = await api<OrderPage>(`orders?page=${page}`);
      if (current !== generation || !dialog.open) return;
      orders = value.orders;
      body.innerHTML = readerOrders(value);
      if (restoreFocus)
        body
          .querySelector<HTMLButtonElement>(
            `[data-order-page="${page > 1 ? value.page - 1 : value.page + 1}"]:not(:disabled)`,
          )
          ?.focus({ preventScroll: true });
    } catch {
      if (current === generation && dialog.open)
        body.innerHTML =
          '<p role="alert">订单暂时无法读取，请重试。</p><button class="vip-secondary" data-order-page="1">重新加载</button>';
    } finally {
      if (current === generation) body.setAttribute("aria-busy", "false");
    }
  }
  dialog.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target.closest("[data-close-orders]")) dialog.close();
    const page = target.closest<HTMLElement>("[data-order-page]");
    if (page) void load(Number(page.dataset.orderPage));
    const id =
      target.closest<HTMLElement>("[data-open-order]")?.dataset.openOrder;
    const order = orders.find((item) => item.id === id);
    if (order) {
      dialog.close();
      openCheckout(order);
    }
  });
  dialog.addEventListener("close", () => {
    generation++;
  });
  return {
    open() {
      orders = [];
      body.innerHTML = '<p role="status">正在读取订单…</p>';
      dialog.showModal();
      void load(1, false);
    },
  };
}
