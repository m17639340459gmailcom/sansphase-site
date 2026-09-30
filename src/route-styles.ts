import { staticAssetUrl } from "./scene-delivery.mjs";

const files = Object.freeze({ book: "book-reader.css", author: "author.css", community: "community.css" });
const pendingByDocument = new WeakMap<Document,Map<string,Promise<void>>>();

// Keep the same cascade order as the former links in index.html, regardless of
// whether the editor or the book reader is visited first.
export function ensureRouteStyle(doc:Document, kind:string):Promise<void> {
  const file = files[kind as keyof typeof files];
  if (!file) throw new TypeError(`Unknown route style: ${kind}`);
  let pending = pendingByDocument.get(doc);
  if (!pending) {
    pending = new Map();
    pendingByDocument.set(doc, pending);
  }
  if (pending.has(kind)) return pending.get(kind)!;
  const promise = new Promise<void>((resolve, reject) => {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.dataset.routeStyle = kind;
    const base = doc.documentElement.dataset.staticBase || "";
    link.href = staticAssetUrl(`./${file}`, base);
    if (base) link.crossOrigin = "anonymous";
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => {
      link.remove();
      pending.delete(kind);
      reject(new Error(`Could not load ${file}`));
    }, { once: true });
    const visitor = [...doc.querySelectorAll('link[rel="stylesheet"]')]
      .find(item => /(?:^|\/)visitor-controls\.css(?:\?|$)/.test(item.getAttribute("href") || ""));
    const author = kind === "book" ? doc.querySelector('[data-route-style="author"]') : null;
    doc.head.insertBefore(link, author || visitor || null);
  });
  pending.set(kind, promise);
  return promise;
}
