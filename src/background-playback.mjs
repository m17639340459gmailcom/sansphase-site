// CSS visibility does not stop a WebGL loop. Keep the existing canvas but let
// its player sleep whenever the background is hidden or the tab is inactive.
export function observeBackgroundPlayback(doc, notify) {
  let previous;
  const sync = () => {
    const paused = doc.hidden || !doc.body.classList.contains("blog-open");
    if (paused !== previous) {
      previous = paused;
      notify(paused);
    }
  };
  const observer = new doc.defaultView.MutationObserver(sync);
  observer.observe(doc.body, { attributes: true, attributeFilter: ["class"] });
  doc.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    observer.disconnect();
    doc.removeEventListener("visibilitychange", sync);
  };
}
