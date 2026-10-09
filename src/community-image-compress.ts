// 社区正文图片：超过上传上限时，在浏览器里先缩小并重新编码，再交给上传。
// 服务器保存时本来就会缩到最长边 2048 并转成 WebP（server/community-images.ts），
// 所以这里只是把同一步提前，不改变最终保存的画面；服务器的大小检查照旧。

export type ImageSurface = {
  width: number;
  height: number;
  encode(width: number, height: number, type: string, quality: number): Promise<Blob | null>;
  close(): void;
};
export type ImageDecoder = (file: Blob) => Promise<ImageSurface>;
export type CommunityImageCompressReason = 'unreadable' | 'too-large';
export class CommunityImageCompressError extends Error {
  reason: CommunityImageCompressReason;
  constructor(reason: CommunityImageCompressReason) { super(reason); this.name = 'CommunityImageCompressError'; this.reason = reason; }
}

// The first edge is the one the server keeps. Quality gives way before size does.
const edges = [2048, 1600, 1280, 1024], qualities = [0.86, 0.74, 0.62];
const extensions: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg' };

const browserDecoder: ImageDecoder = async file => {
  const bitmap = await createImageBitmap(file);
  return {
    width: bitmap.width, height: bitmap.height,
    encode(width, height, type, quality) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return Promise.resolve(null);
      // JPEG has no transparency; without a ground, clear areas would turn black.
      if (type === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      return new Promise(resolve => canvas.toBlob(resolve, type, quality));
    },
    close() { bitmap.close(); },
  };
};

/** Returns the file itself when it already fits, otherwise a smaller WebP (or JPEG) copy no larger than `cap`. */
export async function compressCommunityImage(file: File, cap: number, decode: ImageDecoder = browserDecoder): Promise<File> {
  if (file.size <= cap) return file;
  let surface: ImageSurface;
  try { surface = await decode(file); } catch { throw new CommunityImageCompressError('unreadable'); }
  try {
    const longest = Math.max(surface.width, surface.height);
    if (!longest) throw new CommunityImageCompressError('unreadable');
    let type = 'image/webp', lastScale = 0;
    for (const edge of edges) {
      const scale = Math.min(1, edge / longest);
      if (scale === lastScale) continue;
      lastScale = scale;
      const width = Math.max(1, Math.round(surface.width * scale)), height = Math.max(1, Math.round(surface.height * scale));
      for (const quality of qualities) {
        let blob = await surface.encode(width, height, type, quality);
        // A browser without a WebP encoder answers with PNG instead.
        if (blob && blob.type !== type && type === 'image/webp') { type = 'image/jpeg'; blob = await surface.encode(width, height, type, quality); }
        if (!blob || blob.type !== type) throw new CommunityImageCompressError('unreadable');
        if (blob.size <= cap) return new File([blob], `${file.name.replace(/\.[^.\\/]*$/, '')}.${extensions[type]}`, { type });
      }
    }
    throw new CommunityImageCompressError('too-large');
  } finally {
    surface.close();
  }
}
