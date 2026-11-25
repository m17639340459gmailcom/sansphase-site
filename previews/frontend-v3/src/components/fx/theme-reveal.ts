import { REDUCED_MOTION_QUERY } from "./hooks";
import { rememberBeijingTheme } from "../providers/beijing-theme";

export type ThemeName = "light" | "dark";

const DURATION = 720;
const EASE = "cubic-bezier(0.76, 0, 0.24, 1)";

/** Applies the theme class synchronously (next-themes would only do it in an effect). */
function applyTheme(theme: ThemeName, setTheme: (theme: ThemeName) => void) {
  rememberBeijingTheme(theme);
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
  setTheme(theme);
}

/** A glowing front on the clip edge. It lives in the live DOM, so it renders inside the new snapshot. */
function createRevealRing(x: number, y: number, radius: number) {
  const ring = document.createElement("div");
  ring.setAttribute("aria-hidden", "true");
  ring.className = "fx-theme-ring";
  ring.style.cssText = `left:${x - radius}px;top:${y - radius}px;width:${radius * 2}px;height:${radius * 2}px;transform:scale(0)`;
  document.body.append(ring);
  return ring;
}

/** Reveal origin for a click: the pointer, or the control's centre for keyboard activation. */
export function themeRevealOrigin(event: { clientX: number; clientY: number; detail: number; currentTarget: EventTarget | null }) {
  if (event.detail > 0 || !(event.currentTarget instanceof Element)) return { x: event.clientX, y: event.clientY };
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Switches theme with a circle expanding from (x, y) via the View Transitions API.
 * Falls back to an instant switch without API support or under reduced motion.
 * Pass next-themes' `setTheme`; the class on <html> is applied inside the transition.
 */
export function startThemeReveal(
  x: number,
  y: number,
  theme: ThemeName,
  setTheme: (theme: ThemeName) => void,
) {
  const root = document.documentElement;
  const reduced = window.matchMedia(REDUCED_MOTION_QUERY).matches;
  if (typeof document.startViewTransition !== "function" || reduced) {
    applyTheme(theme, setTheme);
    return;
  }

  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  root.style.setProperty("--reveal-x", `${x}px`);
  root.style.setProperty("--reveal-y", `${y}px`);
  root.style.setProperty("--reveal-r", `${radius}px`);
  root.dataset.themeReveal = "";

  let ring: HTMLDivElement | null = null;
  const transition = document.startViewTransition(() => {
    applyTheme(theme, setTheme);
    ring = createRevealRing(x, y, radius);
  });
  transition.ready
    .then(() => {
      ring?.animate(
        [
          { transform: "scale(0)", opacity: 1 },
          { transform: "scale(0.7)", opacity: 1, offset: 0.7 },
          { transform: "scale(1)", opacity: 0 },
        ],
        { duration: DURATION, easing: EASE, fill: "forwards" },
      );
    })
    .catch(() => {});
  transition.finished.finally(() => {
    ring?.remove();
    delete root.dataset.themeReveal;
    root.style.removeProperty("--reveal-x");
    root.style.removeProperty("--reveal-y");
    root.style.removeProperty("--reveal-r");
  });
}
