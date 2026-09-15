import { imageSourceSet } from "./image-sources.mjs";

// Use the same responsive candidates as the visible cards. No attachments,
// audio streams, third-party pages or original-size download links are warmed.
export function collectPageImages(doc, content) {
  const items = new Map();
  function add(
    src,
    sizes = "(max-width: 960px) 100vw, 960px",
    srcset = imageSourceSet(src),
  ) {
    if (!src) return;
    const url = new URL(src, doc.baseURI);
    if (
      url.origin !== new URL(doc.baseURI).origin ||
      !/^https?:$/.test(url.protocol)
    )
      return;
    const key = JSON.stringify([url.href, sizes, srcset]);
    items.set(key, { src: url.href, sizes, srcset });
  }
  add(content?.profile?.avatar, "136px");
  add(content?.profile?.background, "100vw");
  for (const notice of content?.announcements || []) add(notice.image);
  for (const kind of [
    "notes",
    "works",
    "resources",
    "software",
    "resource-center",
  ]) {
    for (const item of content?.[kind] || []) {
      add(
        item.coverSrc,
        kind === "notes"
          ? "(max-width: 960px) 100vw, 720px"
          : "(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 25vw",
      );
      const template = doc.createElement("template");
      template.innerHTML = item.bodyHTML || "";
      for (const image of template.content.querySelectorAll("img"))
        add(
          image.getAttribute("src"),
          image.getAttribute("sizes") || "960px",
          image.getAttribute("srcset") ||
            imageSourceSet(image.getAttribute("src")),
        );
    }
  }
  return [...items.values()];
}

const decodedByDocument = new WeakMap();
function decodeImage(doc, item, signal) {
  let cache = decodedByDocument.get(doc);
  if (!cache) decodedByDocument.set(doc, (cache = new Map()));
  const key = JSON.stringify(item);
  if (cache.has(key)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const image = new doc.defaultView.Image();
    const abort = () => {
      image.srcset = "";
      image.removeAttribute("src");
      finish(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    let settled = false;
    function finish(error) {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      image.onload = image.onerror = null;
      if (error) reject(error);
      else {
        cache.set(key, image);
        while (cache.size > 12) cache.delete(cache.keys().next().value);
        resolve();
      }
    }
    signal?.addEventListener("abort", abort, { once: true });
    image.decoding = "async";
    image.fetchPriority = "low";
    image.sizes = item.sizes;
    image.onerror = () => finish(new Error("Image preparation failed"));
    image.onload = () => {
      if (!image.decode) finish();
    };
    if (item.srcset) image.srcset = item.srcset;
    image.src = item.src;
    if (image.decode) image.decode().then(() => finish(), finish);
    if (signal?.aborted) abort();
  });
}

export async function preparePageImages(
  doc,
  content,
  {
    signal,
    onProgress = () => {},
    decode = (item) => decodeImage(doc, item, signal),
  } = {},
) {
  signal?.throwIfAborted();
  const items = collectPageImages(doc, content);
  let cursor = 0,
    completed = 0,
    error;
  const worker = async () => {
    while (cursor < items.length && !error) {
      signal?.throwIfAborted();
      const item = items[cursor++];
      try {
        await decode(item);
        signal?.throwIfAborted();
        onProgress(++completed / Math.max(1, items.length));
      } catch (reason) {
        error = reason;
        throw reason;
      }
    }
  };
  await Promise.all([worker(), worker()]);
  signal?.throwIfAborted();
  onProgress(1);
}
