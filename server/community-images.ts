import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { communityImageBytes } from '../src/community-rules.ts';
import { withStreamUpload } from './stream-upload.ts';
import { fail } from './community-db.ts';
import type { Ctx } from './community-context.ts';

async function usableFrame(image: Buffer, width: number, height: number) {
  if (width !== height) return false;
  const { data, info } = await sharp(image, { animated: true, limitInputPixels: 40_000_000 }).ensureAlpha().resize(64, 64, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const pageHeight = info.pageHeight || info.height;
  for (let top = 0; top < info.height; top += pageHeight) {
    let visible = false, center = 0, clear = 0;
    for (let y = 0; y < pageHeight; y++) for (let x = 0; x < info.width; x++) {
      const alpha = data[((top + y) * info.width + x) * info.channels + info.channels - 1];
      if ((x - 31.5) ** 2 + (y - 31.5) ** 2 < 18 ** 2) { center++; if (alpha <= 16) clear++; }
      else if (alpha > 24) visible = true;
    }
    if (!visible || !center || clear / center < 0.98) return false;
  }
  return true;
}

// Product artwork uses the existing private image store. GIF and animated WebP
// stay animated; forum attachments keep their existing static image rules.
export async function saveCommunityImage(ctx: Ctx, shop = false, bannerScope?: string) {
  const bannerAccess = { actor: ctx.me, browsingAsReader: ctx.browsingAsReader, canSeeBoard: ctx.canSeeBoard };
  if (bannerScope !== undefined) ctx.live.banners.authorize(bannerScope, bannerAccess);
  const directory = ctx.options.directory;
  if (!directory) throw fail('图片上传暂未开放。', 503);
  if (!String(ctx.req.headers['content-type'] || '').startsWith('multipart/form-data;')) throw fail('请选择图片文件。', 415);
  ctx.throttle('image');
  const formats: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', ...(shop ? { 'image/gif': 'gif' } : {}) };
  const label = shop ? 'JPG、PNG、WebP 或 GIF' : 'JPG、PNG 或 WebP';
  const bytes = communityImageBytes(ctx.owner), uploads = resolve(directory, 'uploads');
  return withStreamUpload(ctx.req, directory, async (file: { mimetype: string; tempFilePath: string }) => {
    if (!formats[file.mimetype]) throw fail(`图片只支持 ${label}。`, 415);
    let full: Buffer, thumb: Buffer, width: number, height: number;
    try {
      // Bounded by the existing upload ceiling. Buffer input also lets Windows
      // remove the temporary GIF immediately, without libvips retaining a file handle.
      const input = await readFile(file.tempFilePath);
      const source = sharp(input, { limitInputPixels: 40_000_000, animated: shop });
      const metadata = await source.metadata();
      if (metadata.format !== formats[file.mimetype] || !metadata.width || !metadata.height) throw fail('图片无法读取，请换一张。');
      if ((metadata.pages || 1) > 120 || metadata.width * metadata.height > 40_000_000) throw fail('动态图过长或分辨率过大，请缩短后上传。');
      const output = await source.rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer({ resolveWithObject: true });
      full = output.data; width = output.info.width; height = output.info.pageHeight || output.info.height;
      thumb = await sharp(input, { limitInputPixels: 40_000_000, animated: false }).rotate().resize(480, 480, { fit: 'cover', position: 'attention' }).webp({ quality: 76, effort: 4 }).toBuffer();
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw fail(`图片无法读取，请换一张 ${label} 图片。`);
    }
    const frameReady = shop && await usableFrame(full, width, height);
    const id = randomUUID(), imagePath = resolve(uploads, `community-image-${id}.webp`), thumbPath = resolve(uploads, `community-thumb-${id}.webp`);
    await mkdir(uploads, { recursive: true });
    try {
      await writeFile(imagePath, full, { flag: 'wx', mode: 0o600 });
      await writeFile(thumbPath, thumb, { flag: 'wx', mode: 0o600 });
      // Re-encoding and disk writes yield; recheck the real appointment before
      // recording a completed upload, and remove the files when access changed.
      if (bannerScope !== undefined) ctx.live.banners.authorize(bannerScope, bannerAccess);
      ctx.requireConsent();
      ctx.live.addImage({ id, uploader: ctx.me, width, height, purpose: bannerScope !== undefined ? 'banner' : shop ? 'shop' : 'content', frameReady, bannerScope: bannerScope ?? null });
    } catch (error) {
      await Promise.allSettled([unlink(imagePath), unlink(thumbPath)]);
      throw error;
    }
    return { id, width, height, frameReady };
  }, { maxFileBytes: bytes, maxImageBytes: bytes, maxAudioBytes: 0 });
}
