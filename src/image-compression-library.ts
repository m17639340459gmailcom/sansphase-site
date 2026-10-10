import Compressor from 'compressorjs';
import { inspectUploadImage } from './upload-image-metadata.ts';

export type StaticCompressionOptions = {
  maxWidth: number; maxHeight: number; quality: number; mimeType: string;
  convertTypes: string[]; retainExif: boolean;
};

export async function compressStaticImage(file: File, options: StaticCompressionOptions, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) throw signal.reason ?? new DOMException('图片处理已取消。', 'AbortError');
  await inspectUploadImage(file, signal);
  return new Promise((resolve, reject) => {
    let compressor: Compressor | undefined;
    let settled = false;
    const release = () => {
      // CompressorJS 1.4.0 revokes this URL on success but not fail/abort.
      // Pinning the reviewed version lets this narrow cleanup cover those paths.
      const image = (compressor as unknown as { image?: HTMLImageElement } | undefined)?.image;
      if (image?.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
    };
    const cleanup = () => { signal.removeEventListener('abort', cancel); release(); };
    const cancel = () => {
      if (settled) return;
      settled = true; cleanup(); compressor?.abort();
      reject(signal.reason ?? new DOMException('图片处理已取消。', 'AbortError'));
    };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    try {
      compressor = new Compressor(file, { ...options,
        // A PNG/WebP must keep alpha; never use the library's PNG-to-JPEG default.
        checkOrientation: true, strict: true,
        success(output) { if (settled) return; settled = true; cleanup(); resolve(output); },
        error(error) { if (settled) return; settled = true; cleanup(); reject(error); },
      });
      if (settled) release();
    } catch (error) { if (!settled) { settled = true; cleanup(); reject(error); } }
  });
}
