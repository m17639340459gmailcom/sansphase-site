type Placement = { parent: HTMLElement; side: HTMLElement; marker: Comment };

/** Relocate the original post controls within main, retaining delegated events. */
export function createFrameThreadSidebar(route: HTMLElement, right: HTMLElement) {
  let placement: Placement | null = null;
  const release = () => {
    if (!placement) return;
    const { parent, side, marker } = placement;
    if (marker.parentNode === parent && (side.parentElement === parent || side.parentElement === right)) marker.replaceWith(side);
    else marker.remove();
    placement = null;
  };
  return {
    preserveFocus() {
      const active = right.ownerDocument.activeElement;
      if (!active || !placement?.side.contains(active)) return () => {};
      const names = ['data-action', 'data-id', 'data-uid', 'href', 'id'];
      const identity = names.map(name => [name, active.getAttribute(name)] as const);
      return () => {
        if (active.isConnected || !placement) return;
        const control = [...placement.side.querySelectorAll<HTMLElement>('button, a[href], input, textarea')]
          .find(candidate => candidate.localName === active.localName && identity.every(([name, value]) => candidate.getAttribute(name) === value));
        control?.focus({ preventScroll: true });
      };
    },
    sync(post: boolean, collapsed: boolean) {
      const parent = post ? route.querySelector<HTMLElement>('[data-community="post"] > .community-post-grid') : null;
      const next = parent?.querySelector<HTMLElement>(':scope > .community-post-side');
      if (placement && next && next !== placement.side && placement.parent === parent) {
        // An in-place renderer replacement owns its fresh supporting content.
        placement.side.remove(); placement.marker.remove(); placement = null;
      }
      if (placement && (placement.parent !== parent || placement.marker.parentNode !== parent)) release();
      if (!parent) return;
      if (!placement && next) {
        const marker = route.ownerDocument.createComment('post supporting information position');
        next.before(marker);
        placement = { parent, side: next, marker };
      }
      if (!placement) return;
      const { side, marker } = placement;
      const target = collapsed ? parent : right;
      if (side.parentElement === target) return;
      const active = route.ownerDocument.activeElement;
      const focus = active && side.contains(active) ? active as HTMLElement : null;
      if (collapsed) marker.after(side); else right.append(side);
      focus?.focus({ preventScroll: true });
    },
    release,
  };
}
