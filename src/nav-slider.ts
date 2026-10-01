// Hover/focus moves one highlight. A newly rendered route starts settled:
// View Transitions must not capture an old position and jump on completion.
export function mountNavSlider(nav: HTMLElement | null): () => void {
  if (!nav || !nav.ownerDocument.defaultView) return () => {};
  const doc = nav.ownerDocument, win = doc.defaultView!;
  const indicator = doc.createElement('span');
  indicator.className = 'nav-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  nav.prepend(indicator);
  const current = () => nav.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
  const place = (link: HTMLAnchorElement | null, animate = true) => {
    if (!animate) indicator.classList.add('is-instant');
    indicator.classList.toggle('is-visible', Boolean(link));
    if (link) {
      indicator.style.transform = `translateX(${link.offsetLeft}px)`;
      indicator.style.width = `${link.offsetWidth}px`;
    }
    if (!animate) {
      void indicator.offsetWidth;
      indicator.classList.remove('is-instant');
    }
  };
  place(current(), false);
  const follow = (event: Event) => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a');
    if (link && nav.contains(link)) place(link);
  };
  const settle = (event: Event) => {
    if (event.type === 'focusout' && nav.contains((event as FocusEvent).relatedTarget as Node | null)) return;
    place(current());
  };
  const resize = () => place(current(), false);
  nav.addEventListener('pointerover', follow);
  nav.addEventListener('focusin', follow);
  nav.addEventListener('pointerleave', settle);
  nav.addEventListener('focusout', settle);
  win.addEventListener('resize', resize);
  return () => {
    win.removeEventListener('resize', resize);
    nav.removeEventListener('pointerover', follow);
    nav.removeEventListener('focusin', follow);
    nav.removeEventListener('pointerleave', settle);
    nav.removeEventListener('focusout', settle);
  };
}
