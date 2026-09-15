export const escapeHTML = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pages = new Set([
  "home",
  "works",
  "work",
  "notes",
  "note",
  "resources",
  "software",
  "resource-center",
  "community",
  "post",
  "support",
  "contact",
  "account",
]);
export function parseRoute(hash = "") {
  try {
    const [page = "home", id = ""] = decodeURIComponent(
      hash.replace(/^#\/?/, ""),
    ).split("/");
    return { page: pages.has(page || "home") ? page || "home" : "404", id };
  } catch {
    return { page: "404", id: "" };
  }
}
export function dragTarget(index, delta, width, count) {
  const threshold = Math.min(90, Math.max(36, width * 0.1));
  return Math.max(
    0,
    Math.min(
      count - 1,
      index + (Math.abs(delta) > threshold ? (delta < 0 ? 1 : -1) : 0),
    ),
  );
}
export function dragPosition(index, delta, width, count) {
  const progress = Math.max(-1, Math.min(1, -delta / (width * 0.55)));
  return Math.max(-0.12, Math.min(count - 1 + 0.12, index + progress));
}
export function filterItems(items, category = "all", query = "") {
  const term = query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      (category === "all" || item.category === category) &&
      `${item.title} ${item.summary || ""} ${item.en || ""} ${item.summaryEn || ""} ${(item.tags || []).join(" ")}`
        .toLocaleLowerCase()
        .includes(term),
  );
}
