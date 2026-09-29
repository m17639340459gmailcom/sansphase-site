// Move the existing cards instead of cloning them, so the player and form state
// survive a breakpoint change. Markers restore the original desktop order.
// Phones read the notice and the articles first; profile, music, tags,
// weather and time follow as a single column underneath.
export function mountMobileBlogOrder(layout) {
  if (!layout) return () => {};
  const doc = layout.ownerDocument;
  const media = doc.defaultView.matchMedia("(max-width: 900px)");
  const selectors = [
    ".blog-notice",
    ".blog-article-area",
    ".blog-identity",
    ".blog-music-card",
    ".blog-tags-card",
    ".blog-weather-card",
    ".blog-date-card",
  ];
  const entries = selectors.flatMap((selector) => {
    const node = layout.querySelector(selector);
    if (!node) return [];
    const marker = doc.createComment("card-position");
    node.before(marker);
    return [{ node, marker }];
  });
  const move = (parent, node, before = null) => {
    if (parent.moveBefore && node.isConnected) parent.moveBefore(node, before);
    else parent.insertBefore(node, before);
  };
  const restore = () => entries.forEach(({ node, marker }) => move(marker.parentNode, node, marker));
  const update = () => {
    layout.classList.toggle("is-mobile-flow", media.matches);
    if (media.matches) entries.forEach(({ node }) => move(layout, node));
    else restore();
  };
  media.addEventListener("change", update);
  update();
  return () => {
    media.removeEventListener("change", update);
    restore();
    entries.forEach(({ marker }) => marker.remove());
  };
}
