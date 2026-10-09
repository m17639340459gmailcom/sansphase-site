import { staticAssetUrl } from "./scene-delivery.mjs";

const files = Object.freeze({ book: "book-reader.css", author: "author.css", community: "community.css" });
const pendingByDocument = new WeakMap<Document,Map<string,Promise<void>>>();
const STYLE_READ_DEADLINE_MS = 10_000;

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
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  pending.set(kind, promise);
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.dataset.routeStyle = kind;
  const base = doc.documentElement.dataset.staticBase || "";
  link.href = staticAssetUrl(`./${file}`, base);
  if (base) link.crossOrigin = "anonymous";
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    link.removeEventListener("load", loaded);
    link.removeEventListener("error", failed);
    if (error) {
      link.remove();
      if (pending.get(kind) === promise) pending.delete(kind);
      rejectReady(error);
    } else resolveReady();
  };
  const loaded = () => finish();
  const failed = () => finish(new Error(`Could not load ${file}`));
  const deadline = setTimeout(failed, STYLE_READ_DEADLINE_MS);
  link.addEventListener("load", loaded);
  link.addEventListener("error", failed);
  const visitor = [...doc.querySelectorAll('link[rel="stylesheet"]')]
    .find(item => /(?:^|\/)visitor-controls\.css(?:\?|$)/.test(item.getAttribute("href") || ""));
  const author = kind === "book" ? doc.querySelector('[data-route-style="author"]') : null;
  try { doc.head.insertBefore(link, author || visitor || null); }
  catch { failed(); }
  return promise;
}
