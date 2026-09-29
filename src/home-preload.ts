import { imageSourceSet } from "./image-sources.mjs";
type ImageItem={src:string;sizes:string;srcset:string};
type PageContent={profile?:{background?:string;avatar?:string};announcements?:Array<{image?:string}>;notes?:Array<{coverSrc?:string}>};

// Use the same responsive candidates as the visible cards. No attachments,
// audio streams, third-party pages or original-size download links are warmed.
export function collectPageImages(doc:Document, content:PageContent|null|undefined):ImageItem[] {
  const items = new Map<string,ImageItem>();
  function add(
    src:string|undefined,
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
  add(content?.profile?.background, "100vw");
  add(content?.profile?.avatar, "136px");
  for (const notice of (content?.announcements || []).slice(0,1)) add(notice.image);
    for (const item of (content?.notes || []).slice(0,3)) {
      add(
        item.coverSrc,
        "(max-width: 700px) 40vw, 400px",
      );
    }
  return [...items.values()];
}

const decodedByDocument = new WeakMap<Document,Map<string,HTMLImageElement>>();
function decodeImage(doc:Document, item:ImageItem, signal?:AbortSignal):Promise<void> {
  let cache = decodedByDocument.get(doc);
  if (!cache) decodedByDocument.set(doc, (cache = new Map()));
  const readyCache=cache;
  const key = JSON.stringify(item);
  if (readyCache.has(key)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const view=doc.defaultView;
    if(!view) {reject(Error('Document has no window'));return;}
    const image = new view.Image();
    const abort = () => {
      image.removeAttribute("src");
      image.removeAttribute("srcset");
      finish(signal?.reason || new DOMException("Aborted", "AbortError"));
    };
    let settled = false;
    function finish(error?:unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      image.onload = image.onerror = null;
      if (error) reject(error);
      else {
        readyCache.set(key, image);
        while (readyCache.size > 12) {const oldest=readyCache.keys().next().value;if(oldest)readyCache.delete(oldest);}
        resolve();
      }
    }
    signal?.addEventListener("abort", abort, { once: true });
    const timeout=setTimeout(()=>{image.removeAttribute('src');image.removeAttribute('srcset');finish(new Error('Image preparation timed out'));},10000);
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
  doc:Document,
  content:PageContent|null|undefined,
  {
    signal,
    onProgress = () => {},
    concurrency = 2,
    shouldContinue = () => true,
    decode = (item) => decodeImage(doc, item, signal),
  }: {signal?:AbortSignal;onProgress?:(value:number)=>void;concurrency?:number;shouldContinue?:()=>boolean;decode?:(item:ImageItem)=>Promise<unknown>} = {},
) {
  signal?.throwIfAborted();
  const items = collectPageImages(doc, content);
  let cursor = 0,
    completed = 0,
    error:unknown;
  const worker = async () => {
    while (cursor < items.length && !error) {
      signal?.throwIfAborted();
      if(!shouldContinue()) return;
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
  await Promise.all(Array.from({length: Math.max(1, Math.min(2, concurrency))}, worker));
  signal?.throwIfAborted();
  onProgress(1);
}
