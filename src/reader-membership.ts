import { escapeHTML as esc } from "./core.mjs";

export type MembershipIdentity = { vip?: boolean; vipUntil?: string | null };
const hour = 3600000,
  day = 24 * hour;

// Presentation only: a future date never grants membership without server approval.
export function membershipSummary(
  reader: MembershipIdentity,
  now = Date.now(),
  english = false,
) {
  const until = Date.parse(reader.vipUntil || "");
  const valid = Number.isFinite(until),
    left = valid ? Math.max(0, until - now) : 0;
  const active = reader.vip === true && left > 0;
  const status = active
    ? "active"
    : valid && until <= now
      ? "expired"
      : "inactive";
  const days = Math.floor(left / day),
    hours = Math.floor((left % day) / hour);
  const remaining = !active
    ? "—"
    : days > 0
      ? english
        ? `${days}d ${hours}h`
        : `${days} 天 ${hours} 小时`
      : hours > 0
        ? english
          ? `${hours}h`
          : `${hours} 小时`
        : english
          ? "Less than 1 hour"
          : "不足 1 小时";
  return {
    active,
    status,
    expiring: active && left <= 5 * day,
    remaining,
    until: valid ? new Date(until).toISOString() : null,
    left,
  };
}

function membershipBody(
  reader: MembershipIdentity,
  english: boolean,
  now: number,
) {
  const value = membershipSummary(reader, now, english),
    tr = (zh: string, en: string) => (english ? en : zh);
  const title = value.active
    ? "VIP"
    : value.status === "expired"
      ? tr("会员已到期", "Membership expired")
      : tr("普通读者", "Reader");
  const expiry = value.until
    ? new Date(value.until).toLocaleString(english ? "en-US" : "zh-CN")
    : null;
  return `<div class="reader-membership-heading"><h2>${tr("我的会员", "My membership")}</h2><span class="reader-membership-state${value.active ? " is-active" : ""}">${title}</span></div><dl class="reader-membership-facts"><div><dt>${tr("剩余时间", "Time remaining")}</dt><dd>${value.remaining}</dd></div><div><dt>${tr("到期时间", "Expires at")}</dt><dd>${expiry ? `<time datetime="${esc(value.until)}">${esc(expiry)}</time>` : "—"}</dd></div></dl><p class="reader-membership-notice${value.expiring ? " is-expiring" : ""}" role="status">${value.expiring ? tr("会员将在 5 天内到期，续期后可继续阅读 VIP 专属内容。", "Your membership expires within five days. Renew to keep reading VIP content.") : value.active ? tr("有效期内可阅读标注为 VIP 的资源中心书籍。", "Read VIP-labelled library books while your membership is active.") : value.status === "expired" ? tr("VIP 专属内容的阅读权限已结束，普通阅读权限不受影响。", "VIP reading access has ended. Regular reading access is unchanged.") : tr("可阅读普通开放内容；VIP 专属书籍需在会员有效期内阅读。", "Read regular content; VIP books require active membership.")}</p>`;
}

export function renderMembership(
  reader: MembershipIdentity,
  english = false,
  now = Date.now(),
) {
  return `<section class="reader-membership" data-reader-membership data-vip="${reader.vip === true}" data-until="${esc(reader.vipUntil || "")}" aria-label="${english ? "My membership" : "我的会员"}">${membershipBody(reader, english, now)}</section>`;
}

export function refreshMembership(
  root: ParentNode,
  english = false,
  now = Date.now(),
) {
  const section = root.querySelector<HTMLElement>("[data-reader-membership]");
  if (!section) return;
  const reader = {
    vip: section.dataset.vip === "true",
    vipUntil: section.dataset.until,
  };
  const state = membershipSummary(reader, now, english);
  // Updating only the summary preserves focus and unsaved profile edits.
  const html = membershipBody(reader, english, now);
  if (section.innerHTML !== html) section.innerHTML = html;
  const card = section.closest(".reader-card--profile");
  card
    ?.querySelector(".reader-profile-card")
    ?.classList.toggle("reader-profile-card--vip", state.active);
  const badge = card?.querySelector(".reader-profile-status");
  if (badge) {
    badge.classList.toggle("reader-profile-status--vip", state.active);
    badge.innerHTML = state.active
      ? `<span aria-hidden="true">✦</span> ${english ? "VIP MEMBER" : "VIP 会员"}`
      : english
        ? "Reader"
        : "普通读者";
  }
  return state;
}

export function mountMembershipClock(root: Document, english: () => boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    clearTimeout(timer);
    const state = refreshMembership(root, english());
    if (!state || root.hidden) return;
    timer = setTimeout(
      update,
      state.active ? Math.min(60000, Math.max(1, state.left + 1)) : 60000,
    );
  };
  root.addEventListener("visibilitychange", update);
  return {
    update,
    dispose() {
      clearTimeout(timer);
      root.removeEventListener("visibilitychange", update);
    },
  };
}
