import { imageSize, disableTypes, types } from 'image-size';

disableTypes(types.filter(type => !['jpg', 'png', 'webp', 'gif'].includes(type)));

/** Verify headers before any original image preview or browser decode. */
export async function inspectUploadImage(file: File, signal?: AbortSignal): Promise<void> {
  const abort = () => { if (signal?.aborted) throw signal.reason ?? new DOMException('图片处理已取消。', 'AbortError'); };
  abort();
  const header = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  abort();
  let dimensions: ReturnType<typeof imageSize>;
  try { dimensions = imageSize(header); }
  catch { throw new Error('图片格式无法读取，请重新导出图片后上传。'); }
  const actual = dimensions.type === 'jpg' ? 'image/jpeg' : `image/${dimensions.type}`;
  if (actual !== file.type || !dimensions.width || !dimensions.height) throw new Error('图片内容与格式不一致，请重新导出图片后上传。');
  if (dimensions.width * dimensions.height > 40_000_000) throw new Error('图片分辨率过大，请缩小后上传。');
}
