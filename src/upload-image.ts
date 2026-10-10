import { readerImageBytes, uploadLimits } from './upload-policy.mjs';
import type { StaticCompressionOptions } from './image-compression-library.ts';

export type UploadImageOptions = { signal?: AbortSignal; allowAnimation?: boolean };
type CompressionLibrary = {
  compressStaticImage: (file: File, options: StaticCompressionOptions, signal: AbortSignal) => Promise<Blob>;
};
type LibraryLoader = () => Promise<CompressionLibrary>;
type ImageInspector = (file: File, signal?: AbortSignal) => Promise<void>;
const staticTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const abortError = () => new DOMException('图片处理已取消。', 'AbortError');
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw signal.reason ?? abortError(); };

/** Inspect container flags only. Canvas compression must never flatten product animations. */
async function animated(file: File) {
  if (file.type === 'image/gif') return true;
  if (file.type === 'image/webp') {
    const header = new Uint8Array(await file.slice(0, 30).arrayBuffer());
    return header.length >= 21 && new TextDecoder().decode(header.slice(8, 16)) === 'WEBPVP8X' && Boolean(header[20] & 2);
  }
  if (file.type === 'image/png') {
    let offset = 8;
    // Chunk sizes let us skip pixel bytes rather than reading the whole original.
    for (let chunks = 0; chunks < 512 && offset + 8 <= file.size; chunks++) {
      const header = await file.slice(offset, offset + 8).arrayBuffer();
      if (header.byteLength !== 8) throw new Error('图片格式无法读取，请重新导出图片后上传。');
      const kind = new TextDecoder().decode(new Uint8Array(header, 4, 4));
      if (kind === 'acTL') return true;
      if (kind === 'IDAT' || kind === 'IEND') return false;
      const next = offset + new DataView(header).getUint32(0) + 12;
      if (next > file.size) throw new Error('图片格式无法读取，请重新导出图片后上传。');
      offset = next;
    }
    throw new Error('图片动画信息无法确认，请重新导出图片后上传。');
  }
  return false;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => { cleanup(); reject(signal.reason ?? abortError()); };
    const cleanup = () => signal.removeEventListener('abort', cancel);
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Size policy and upload glue; encoding, orientation and canvas cleanup belong to CompressorJS. */
export function createUploadImagePreparer(
  load: LibraryLoader = () => import('./image-compression-library.mjs'),
  timeoutMs = 45_000,
  inspect: ImageInspector = async (file, signal) => (await import('./upload-image-metadata.mjs')).inspectUploadImage(file, signal),
) {
  let library: Promise<CompressionLibrary> | undefined;
  let queue: Promise<void> = Promise.resolve();
  const getLibrary = () => {
    if (!library) {
      const attempt = Promise.resolve().then(load);
      library = attempt;
      void attempt.catch(() => { if (library === attempt) library = undefined; });
    }
    return library;
  };
  return async function prepareUploadImage(file: File, options: UploadImageOptions = {}): Promise<File> {
    checkAbort(options.signal);
    if (!staticTypes.has(file.type) && !(options.allowAnimation && file.type === 'image/gif')) throw new Error('请选择 JPG、PNG、WebP 图片。');
    if (!file.size || file.size > uploadLimits.maxImageBytes) throw new Error('原图不能超过 25MB，请换一张图片。');
    const preflight = new AbortController();
    const cancelPreflight = () => preflight.abort(options.signal?.reason ?? abortError());
    options.signal?.addEventListener('abort', cancelPreflight, { once: true });
    const inspectTimer = setTimeout(() => preflight.abort(new Error('图片处理超时，请换一张较小的图片后重试。')), timeoutMs);
    try { await abortable(inspect(file, preflight.signal), preflight.signal); }
    finally { clearTimeout(inspectTimer); options.signal?.removeEventListener('abort', cancelPreflight); }
    checkAbort(options.signal);
    // Small uploads keep exact bytes; only header inspection loads, never the codec.
    if (file.size <= readerImageBytes) return file;
    if (await animated(file)) {
      checkAbort(options.signal);
      if (options.allowAnimation) return file;
      throw new Error('动态图不能通过静态图片压缩，请选择不超过 2MB 的图片。');
    }
    checkAbort(options.signal);
    const run = async () => {
      checkAbort(options.signal);
      const controller = new AbortController();
      const cancel = () => controller.abort(options.signal?.reason ?? abortError());
      options.signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('图片处理超时，请换一张较小的图片后重试。')), timeoutMs);
      try {
        const pending = getLibrary();
        let codec: CompressionLibrary;
        try { codec = await abortable(pending, controller.signal); }
        catch (error) { if (library === pending) library = undefined; throw error; }
        // Match the existing server's maximum 2048px image size. Retry the
        // original, never a previously compressed result, and bound all work.
        const attempts = [[2048, .92], [1536, .88], [1024, .84], [768, .8]] as const;
        for (const [size, quality] of attempts) {
          checkAbort(controller.signal);
          // Yield so the existing uploading state can paint between images/attempts.
          await abortable(new Promise<void>(resolve => setTimeout(resolve, 0)), controller.signal);
          const output = await abortable(codec.compressStaticImage(file, {
            maxWidth: size, maxHeight: size, quality,
            mimeType: file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp',
            convertTypes: [], retainExif: false,
          }, controller.signal), controller.signal);
          checkAbort(controller.signal);
          if (!output.size || !staticTypes.has(output.type) || (file.type !== 'image/jpeg' && output.type === 'image/jpeg')) throw new Error('图片压缩结果无法读取，请换一张图片。');
          if (output.size <= readerImageBytes) {
            const extension = output.type === 'image/jpeg' ? 'jpg' : output.type === 'image/png' ? 'png' : 'webp';
            return new File([output], `${file.name.replace(/\.[^./\\]*$/, '')}.${extension}`, { type: output.type, lastModified: file.lastModified });
          }
        }
        throw new Error('图片自动压缩后仍超过 2MB，请换一张较小的图片。');
      } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
    };
    // Avoid decoding several large pasted/selected pictures simultaneously.
    const operation = queue.then(run);
    queue = operation.then(() => undefined, () => undefined);
    return options.signal ? await abortable(operation, options.signal) : await operation;
  };
}

export const prepareUploadImage = createUploadImagePreparer();
