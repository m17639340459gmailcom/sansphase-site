import { defaultCommunityBoards, validCommunityBoardId } from "../community.ts";
import { communityBoardIcon } from '../community-board-icons.ts';

type Category = { id: string; href: string; label: string; lock: string | null; icon: string; color: string; lightColor: string };
const validColor = (color: string) => /^#[\da-f]{6}$/i.test(color);

export function readCategories(boards: HTMLElement): Category[] {
  const items: Category[] = [];
  const seen = new Set<string>();
  for (const link of boards.querySelectorAll<HTMLAnchorElement>(":scope > a.community-board-link[href]")) {
    const href = link.getAttribute("href")!;
    const id = /^#\/community\/boards\/([^/]+)$/.exec(href)?.[1];
    if (!id || !validCommunityBoardId(id) || seen.has(href) || link.hidden || link.getAttribute("aria-disabled") === "true") continue;
    // The layout is bundled separately from the API controller. Read dynamic
    // metadata from its authorized markup, not from a second runtime registry.
    const legacy = defaultCommunityBoards.find(board => board.id === id);
    const explicit = link.hasAttribute('data-board-id');
    if (explicit && link.dataset.boardId !== id || !explicit && !legacy) continue;
    const icon = explicit ? link.dataset.boardIcon || '' : legacy!.icon;
    const color = explicit ? link.dataset.boardColor || '' : legacy!.color;
    const lightColor = explicit ? link.dataset.boardLightColor || '' : legacy!.lightColor;
    if (!communityBoardIcon(icon) || !validColor(color) || !validColor(lightColor)) continue;
    const label = link.querySelector(":scope > span:not(.community-board-count):not(.community-board-lock)")?.textContent?.trim();
    if (!label) continue;
    const lock = link.querySelector<HTMLElement>(":scope > .community-board-lock");
    items.push({ id, href, label, icon, color, lightColor, lock: lock && !lock.hidden ? lock.getAttribute("aria-label") || "VIP" : null });
    seen.add(href);
  }
  return items;
}
