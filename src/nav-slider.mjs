// A single highlight slides inside the navigation capsule: to the current
// section after a route change (starting from where it last was, since the
// header is re-rendered), and to whatever the pointer or keyboard is on.
// Position is remembered across header renders in this module.
let last = null;

export function mountNavSlider(nav) {
  if (!nav) return () => {};
  const doc = nav.ownerDocument,
    win = doc.defaultView;
  const indicator = doc.createElement("span");
  indicator.className = "nav-indicator";
  indicator.setAttribute("aria-hidden", "true");
  nav.prepend(indicator);
  const current = () => nav.querySelector('a[aria-current="page"]');
  const place = (link, animate = true) => {
    if (!animate) indicator.classList.add("is-instant");
    if (!link) {
      indicator.classList.remove("is-visible");
    } else {
      last = { left: link.offsetLeft, width: link.offsetWidth };
      indicator.style.transform = `translateX(${last.left}px)`;
      indicator.style.width = `${last.width}px`;
      indicator.classList.add("is-visible");
    }
    if (!animate) {
      void indicator.offsetWidth;
      indicator.classList.remove("is-instant");
    }
  };
  // Start where the previous header's highlight was, then glide to the
  // current section on the next frame.
  if (last) {
    indicator.classList.add("is-instant", "is-visible");
    indicator.style.transform = `translateX(${last.left}px)`;
    indicator.style.width = `${last.width}px`;
    void indicator.offsetWidth;
    indicator.classList.remove("is-instant");
  }
  const frame = win.requestAnimationFrame(() => place(current()));
  const follow = (event) => {
    const link = event.target.closest?.("a");
    if (link && nav.contains(link)) place(link);
  };
  const settle = (event) => {
    if (event.type === "focusout" && nav.contains(event.relatedTarget)) return;
    place(current());
  };
  nav.addEventListener("pointerover", follow);
  nav.addEventListener("focusin", follow);
  nav.addEventListener("pointerleave", settle);
  nav.addEventListener("focusout", settle);
  const resize = () => place(current(), false);
  win.addEventListener("resize", resize);
  return () => {
    win.cancelAnimationFrame(frame);
    win.removeEventListener("resize", resize);
    nav.removeEventListener("pointerover", follow);
    nav.removeEventListener("focusin", follow);
    nav.removeEventListener("pointerleave", settle);
    nav.removeEventListener("focusout", settle);
  };
}
