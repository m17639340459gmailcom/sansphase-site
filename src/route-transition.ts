// Animate the live content, never a full-document snapshot: visible navigation
// and page controls must remain hit-testable while a route is entering.
export function createRouteTransitions(doc: Document = document) {
  const win = doc.defaultView;
  let active: Animation | null = null;
  let disposed = false;
  let leaving: HTMLElement | null = null;
  let previousOpacity = '';
  const stop = () => {
    const previous = active;
    active = null;
    previous?.cancel();
  };
  const events = ['pointerdown', 'keydown', 'wheel'] as const;
  for (const event of events) doc.addEventListener(event, stop, { capture: true, passive: true });

  return {
    async leave(): Promise<void> {
      stop();
      const target = doc.getElementById('main');
      if (!target || !win || disposed || doc.hidden || win.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof target.animate !== 'function') return;
      leaving = target; previousOpacity = target.style.opacity;
      const easing = win.getComputedStyle(doc.documentElement).getPropertyValue('--ease').trim() || 'ease-out';
      const animation = target.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing, fill: 'forwards' });
      active = animation;
      try { await animation.finished; } catch { return; }
      if (active === animation) target.style.opacity = '0';
    },
    restore() {
      stop();
      if (leaving) leaving.style.opacity = previousOpacity;
      leaving = null;
    },
    arrive() {
      stop();
      delete doc.body.dataset.communityBoot;
      if (disposed || !win || doc.hidden || win.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof doc.body.animate !== 'function') return;
      const easing = win.getComputedStyle(doc.documentElement).getPropertyValue('--ease').trim() || 'ease-out';
      const animation = doc.body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing });
      active = animation;
      const clear = () => { if (active === animation) active = null; };
      void animation.finished.then(clear, clear);
    },
    run<T>(fromPage: string, toPage: string, update: () => T): T {
      stop();
      // Bind the new controls immediately. Network loading is owned by the
      // existing renderer and must not hold navigation behind a visual effect.
      const result = update();
      const target = doc.getElementById('main');
      if (disposed || !win || doc.hidden || toPage === 'home' ||
          win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
          typeof target?.animate !== 'function') return result;

      // Opacity only: the painted controls and their click targets stay aligned.
      const animation = target.animate([{ opacity: 0.72 }, { opacity: 1 }], {
        duration: fromPage === 'home' ? 260 : 180,
        easing: 'ease-out',
      });
      active = animation;
      const clear = () => { if (active === animation) active = null; };
      void animation.finished.then(clear, clear);
      return result;
    },
    dispose() {
      disposed = true;
      stop();
      for (const event of events) doc.removeEventListener(event, stop, { capture: true });
    },
  };
}
