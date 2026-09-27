// Runs in <head>, before the asynchronous module graph. Reload restoration
// belongs to the same render transaction as the view, not a later browser frame.
(() => {
  if (!location.hash || /^#\/?(?:home)?\/?$/.test(location.hash))
    document.documentElement.classList.add('is-home-boot', 'is-site-preparing');
  const key = "sansphase-page-view-v1";
  const route = () => location.pathname + location.hash;
  let saved = null;
  let readView;
  let committed = false;
  try {
    const entry = JSON.parse(sessionStorage.getItem(key));
    if (
      performance.getEntriesByType("navigation")[0]?.type === "reload" &&
      entry?.route === route() &&
      Number.isFinite(entry.scrollY) && entry.scrollY >= 0 &&
      entry.view && typeof entry.view === "object"
    ) {
      saved = entry;
      history.scrollRestoration = "manual";
    }
  } catch {
    // Storage may be unavailable. Leave native restoration enabled then.
  }

  window.sansphasePageSession = {
    view: saved?.view,
    trackView(reader) { readView = reader; },
    commit() {
      if (committed) return;
      committed = true;
      if (saved && saved.route === route()) {
        window.scrollTo({ top: saved.scrollY, left: 0, behavior: "instant" });
      }
    },
  };

  addEventListener("pagehide", () => {
    if (!readView) return; // Do not replace a valid entry with a partial boot.
    try {
      sessionStorage.setItem(key, JSON.stringify({
        route: route(), scrollY: window.scrollY, view: readView(),
      }));
    } catch {
      // Public browsing still works when session storage is disabled/full.
    }
  });
})();
