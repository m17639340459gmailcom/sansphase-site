import type { CommandPageKey } from "./types";

/** `g` + key jumps to a page (Vim/GitHub style). */
export const GO_KEYS = {
  h: "home",
  p: "work",
  r: "resources",
  b: "blog",
  l: "learning",
  s: "software",
  m: "community",
  a: "about",
  c: "contact",
} as const satisfies Record<string, CommandPageKey>;

export const GO_KEY_OF = Object.fromEntries(
  Object.entries(GO_KEYS).map(([key, page]) => [page, key]),
) as Record<CommandPageKey, keyof typeof GO_KEYS>;

export const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
export const KONAMI_GLYPHS = "↑↑↓↓←→←→BA";

/** Fired on `document` to launch the easter-egg fireworks (Konami code, palette command). */
export const CELEBRATE_EVENT = "tdx:celebrate";

const TEXT_ENTRY =
  "input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=range], [type=color], [type=file]), textarea, select, [contenteditable]:not([contenteditable=false])";

/** Plain-key shortcuts stay out of the way while the user types. */
export function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest(TEXT_ENTRY) !== null);
}

/** A modal (a site dialog, a lightbox, the palette itself) currently owns the keyboard. */
export function modalOpen() {
  return document.querySelector("dialog[open], [aria-modal='true']") !== null;
}

/** Letters compare case-insensitively; named keys (ArrowUp, Escape) as-is. */
export function keyOf(event: KeyboardEvent) {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

export function isApplePlatform() {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}
