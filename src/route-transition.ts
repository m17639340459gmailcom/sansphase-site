// Animate the live content, never a full-document snapshot: visible navigation
// and page controls must remain hit-testable while a route is entering.
export function createRouteTransitions(doc: Document = document) {
  const win = doc.defaultView;
  let active: Animation | null = null;
  let disposed = false;
  const stop = () => {
    const previous = active;
    active = null;
    previous?.cancel();
  };
  const events = ['pointerdown', 'keydown', 'wheel'] as const;
  for (const event of events) doc.addEventListener(event, stop, { capture: true, passive: true });

  return {
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
