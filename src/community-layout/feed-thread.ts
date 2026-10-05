type AuthorPlacement = { header: HTMLElement; byline: HTMLElement; marker: Comment };

/** Move the existing author row only; the app retains every control, handler and permission. */
export function createFeedThread(host: HTMLElement): { sync: () => void; release: () => void } {
  let placement: AuthorPlacement | null = null;
  const release = () => {
    if (!placement) return;
    const { header, byline, marker } = placement;
    const active = host.ownerDocument.activeElement;
    const focus = active && byline.contains(active) ? active as HTMLElement : null;
    if (marker.parentNode === header && byline.parentNode === header) marker.replaceWith(byline);
    else marker.remove();
    if (focus?.isConnected) focus.focus({ preventScroll: true });
    placement = null;
  };
  return {
    sync: () => {
      if (!host.matches('[data-community="post"][data-thread-design="feed"]')) { release(); return; }
      const header = host.querySelector<HTMLElement>(":scope > .community-post-grid > .community-thread > .community-post-head");
      const byline = header?.querySelector<HTMLElement>(":scope > .community-post-by");
      if (placement && (placement.header !== header || placement.byline !== byline || placement.marker.parentNode !== header)) release();
      if (!header || !byline) return;
      if (!placement) {
        const marker = host.ownerDocument.createComment("local feed author position");
        byline.before(marker);
        placement = { header, byline, marker };
      }
      if (header.firstElementChild !== byline) {
        const active = host.ownerDocument.activeElement;
        const focus = active && byline.contains(active) ? active as HTMLElement : null;
        header.prepend(byline);
        focus?.focus({ preventScroll: true });
      }
    },
    release,
  };
}
