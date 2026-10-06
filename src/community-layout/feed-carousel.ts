export type FeedCarouselOptions = {
  section: HTMLElement;
  track: HTMLElement;
};

/** Native scrolling over the existing cards; user interaction outranks autoplay. */
export function createFeedCarousel({ section, track }: FeedCarouselOptions): { refresh: () => void; release: () => void } {
  const document = section.ownerDocument;
  const window = document.defaultView;
  const motion = window?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reduced = Boolean(motion?.matches);
  let hovered = false;
  let focused = false;
  let dragging = false;
  let visible = !window?.IntersectionObserver;
  let released = false;
  let index = 0;
  let count = 0;
  let width = 0;
  let timer: number | null = null;

  const stopTimer = () => {
    if (timer !== null) window?.clearTimeout(timer);
    timer = null;
  };
  const eligible = () => !released && !reduced && count > 1 && track.clientWidth > 0
    && !hovered && !focused && !dragging && visible && !document.hidden && section.isConnected;
  const scroll = (left: number, behavior: ScrollBehavior) => {
    if (typeof track.scrollTo === 'function') track.scrollTo({ left, behavior });
    else track.scrollLeft = left;
  };
  const show = (nextIndex: number) => {
    if (released || count < 1 || track.clientWidth <= 0) return;
    index = (nextIndex + count) % count;
    scroll(index * track.clientWidth, reduced ? 'auto' : 'smooth');
  };
  const schedule = () => {
    if (!eligible() || !window) { stopTimer(); return; }
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      if (!eligible()) return;
      show(index + 1);
      schedule();
    }, 5000);
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || count <= 1) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    stopTimer();
    show(index + (event.key === 'ArrowLeft' ? -1 : 1));
    schedule();
  };
  const onScroll = () => {
    if (released || !count || track.clientWidth <= 0) return;
    index = Math.max(0, Math.min(count - 1, Math.round(track.scrollLeft / track.clientWidth)));
  };
  const onDragStart = () => { dragging = true; schedule(); };
  const onDragEnd = () => { dragging = false; schedule(); };
  const onWheel = (event: WheelEvent) => { if (event.deltaX || event.shiftKey) { stopTimer(); schedule(); } };
  const onEnter = () => { hovered = true; schedule(); };
  const onLeave = () => { hovered = false; schedule(); };
  const onFocus = () => { focused = true; schedule(); };
  const onBlur = (event: FocusEvent) => {
    const target = event.relatedTarget;
    if (target && section.contains(target as Node)) return;
    focused = false;
    schedule();
  };
  const onVisibility = () => schedule();
  const onMotion = () => { reduced = Boolean(motion?.matches); schedule(); };
  const refresh = () => {
    if (released) return;
    count = track.querySelectorAll(':scope > .community-feed-showcase-card').length;
    index = Math.max(0, Math.min(Math.max(0, count - 1), index));
    const nextWidth = track.clientWidth;
    if (nextWidth > 0 && width !== nextWidth && track.scrollLeft !== index * nextWidth) scroll(index * nextWidth, 'auto');
    width = nextWidth;
    schedule();
  };

  const dragEndEvents = ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const;
  track.addEventListener('keydown', onKeydown);
  track.addEventListener('pointerdown', onDragStart, { passive: true });
  track.addEventListener('touchstart', onDragStart, { passive: true });
  track.addEventListener('wheel', onWheel, { passive: true });
  track.addEventListener('scroll', onScroll, { passive: true });
  for (const event of dragEndEvents) window?.addEventListener(event, onDragEnd, { passive: true });
  section.addEventListener('mouseenter', onEnter);
  section.addEventListener('mouseleave', onLeave);
  section.addEventListener('focusin', onFocus);
  section.addEventListener('focusout', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  motion?.addEventListener('change', onMotion);
  const resize = window?.ResizeObserver ? new window.ResizeObserver(refresh) : null;
  const intersection = window?.IntersectionObserver ? new window.IntersectionObserver(entries => {
    if (released) return;
    const entry = entries.find(value => value.target === section);
    if (entry) { visible = entry.isIntersecting; schedule(); }
  }) : null;
  resize?.observe(track);
  intersection?.observe(section);
  if (!resize) window?.addEventListener('resize', refresh);

  return {
    refresh,
    release: () => {
      if (released) return;
      released = true;
      stopTimer();
      track.removeEventListener('keydown', onKeydown);
      track.removeEventListener('pointerdown', onDragStart);
      track.removeEventListener('touchstart', onDragStart);
      track.removeEventListener('wheel', onWheel);
      track.removeEventListener('scroll', onScroll);
      for (const event of dragEndEvents) window?.removeEventListener(event, onDragEnd);
      section.removeEventListener('mouseenter', onEnter);
      section.removeEventListener('mouseleave', onLeave);
      section.removeEventListener('focusin', onFocus);
      section.removeEventListener('focusout', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      motion?.removeEventListener('change', onMotion);
      resize?.disconnect();
      intersection?.disconnect();
      if (!resize) window?.removeEventListener('resize', refresh);
    },
  };
}
