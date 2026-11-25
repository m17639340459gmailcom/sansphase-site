// Light / dark theme. The switch wipes the new theme in as a circle from the
// button using the View Transitions API, with a plain swap as fallback.
export type Theme = 'dark' | 'light';

let current: Theme = 'dark';

export const theme = () => current;

function apply(next: Theme) {
  current = next;
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#0b0b0d' : '#f1f0eb');
  try {
    localStorage.setItem('sansphase-v4-theme', next);
  } catch {
    // Storage may be unavailable; the switch still works for this visit.
  }
  document.getElementById('theme')?.setAttribute('aria-pressed', String(next === 'dark'));
}

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('sansphase-v4-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Fall through to the system preference.
  }
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function setTheme(next: Theme, origin?: { x: number; y: number }, reduced = false) {
  type Transition = { ready: Promise<void> };
  const start = (document as Document & { startViewTransition?: (cb: () => void) => Transition }).startViewTransition;
  if (!origin || reduced || !start) {
    apply(next);
    return;
  }
  const transition = start.call(document, () => apply(next));
  transition.ready.then(() => {
    const r = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${r}px at ${origin.x}px ${origin.y}px)`] },
      { duration: 900, easing: 'cubic-bezier(0.7, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
}

export function initTheme() {
  apply(initialTheme());
}
