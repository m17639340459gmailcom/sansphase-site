import type { Translate, Icons } from './community.ts';
import type { CommunityEntryState } from './community-entry.ts';
import { communityHomeHref } from './community-routing.mjs';

export function communityLandingHTML(t: Translate, icons: Icons, { entryState }: { entryState?: CommunityEntryState } = {}) {
  const busy = entryState === 'pending' || entryState === 'leaving';
  const entry = entryState === undefined
    ? `<a class="community-enter" href="${communityHomeHref}">${icons.message || ""}<span>${t("进入社区", "Enter the community")}</span></a>`
    : `<button type="button" class="community-enter" data-community-entry-enter${busy ? ' disabled aria-busy="true"' : ''}>${icons.message || ""}<span aria-live="polite">${busy ? t("正在进入…", "Opening…") : entryState === 'error' ? t("暂时无法进入，点击重试", "Could not open, try again") : t("进入社区", "Enter the community")}</span></button>`;
  return `<section class="page community-landing" data-community="landing">`
    + `<div class="community-orbits" aria-hidden="true"></div>`
    + `<div class="eyebrow">COMMUNITY · ${t("社区交流", "Community")}</div>`
    + `<h1>${t("無相社区", "SANSPHASE Community")}</h1>`
    + `<p>${t("聊 AI 学习、AI 创作，以及好用的软件和资源。提问、晒作品、推荐工具，都在这里。", "Talk about learning AI, making things with it, and useful tools: ask, show your work, share what helps.")}</p>`
    + `<div class="community-landing-actions">${entry}</div>`
    + `</section>`;
}
