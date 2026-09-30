// Route changes animate with the View Transitions API where the browser has
// it. Leaving the homepage flies on into the scene while the destination
// opens as an iris from the point that was clicked (the same grammar as the
// chapters). Between sections the pages sit side by side in navigation order,
// so the content slides towards the section chosen; within one section
// (a list and its articles) it is a short rise. Returning home keeps the
// scene's own return animation. Without the API, while hidden, or with
// reduced motion, the update simply runs as before.
// `sectionOf(page)` gives a page's position in the navigation (or -1).
// A caller may name the kind instead (entering the community: "enter").
export function createRouteTransitions(doc = document, { settle = 220, sectionOf = () => -1 } = {}) {
  const win = doc.defaultView;
  const root = doc.documentElement;
  let origin = null;
  const remember = (event) => {
    origin = { x: event.clientX, y: event.clientY, at: win.performance.now() };
  };
  doc.addEventListener("pointerdown", remember, { capture: true, passive: true });

  function run(fromPage, toPage, update, named) {
    const reduced = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (typeof doc.startViewTransition !== "function" || reduced || doc.hidden || toPage === "home")
      return update();
    const from = sectionOf(fromPage),
      to = sectionOf(toPage);
    const kind = named || (fromPage === "home" ? "warp" : from >= 0 && to >= 0 && from !== to ? "slide" : "page");
    root.style.setProperty("--route-dir", to < from ? "-1" : "1");
    // A click within the last second is where the iris opens; keyboard
    // navigation opens it from the centre.
    const recent = origin && win.performance.now() - origin.at < 1000;
    root.style.setProperty("--route-x", `${recent ? origin.x : win.innerWidth / 2}px`);
    root.style.setProperty("--route-y", `${recent ? origin.y : win.innerHeight / 2}px`);
    root.dataset.routeTransition = kind;
    let result;
    // Wait briefly for content that is already cached, so the new page is
    // captured complete; a slow network is captured in its loading state.
    const transition = doc.startViewTransition(() => {
      result = update();
      return Promise.race([
        Promise.resolve(result).catch(() => {}),
        new Promise((resolve) => win.setTimeout(resolve, settle)),
      ]);
    });
    const clear = () => {
      if (root.dataset.routeTransition === kind) delete root.dataset.routeTransition;
    };
    transition.finished.then(clear, clear);
    transition.ready?.catch(() => {});
    return transition.updateCallbackDone.then(() => result, () => result);
  }
  return {
    run,
    dispose() {
      doc.removeEventListener("pointerdown", remember, { capture: true });
    },
  };
}
