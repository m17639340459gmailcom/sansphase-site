import { communityBoard } from "../community.ts";

type Category = { href: string; label: string; lock: string | null };

export function readCategories(boards: HTMLElement): Category[] {
  const items: Category[] = [];
  const seen = new Set<string>();
  for (const link of boards.querySelectorAll<HTMLAnchorElement>(":scope > a.community-board-link[href]")) {
    const href = link.getAttribute("href")!;
    const id = /^#\/community\/boards\/([a-z]+)$/.exec(href)?.[1];
    if (!id || !communityBoard(id) || seen.has(href) || link.hidden || link.getAttribute("aria-disabled") === "true") continue;
    const label = link.querySelector(":scope > span:not(.community-board-count):not(.community-board-lock)")?.textContent?.trim();
    if (!label) continue;
    const lock = link.querySelector<HTMLElement>(":scope > .community-board-lock");
    items.push({ href, label, lock: lock && !lock.hidden ? lock.getAttribute("aria-label") || "VIP" : null });
    seen.add(href);
  }
  return items;
}
