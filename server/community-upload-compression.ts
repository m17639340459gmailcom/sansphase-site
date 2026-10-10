import sharp from 'sharp';
import { readerImageBytes } from '../src/upload-policy.mjs';
import { fail } from './community-db.ts';

const attempts = [
  { quality: 72, scale: 1 },
  { quality: 60, scale: 1 },
  { quality: 60, scale: .75 },
  { quality: 55, scale: .5 },
  { quality: 50, scale: .3 },
] as const;

/** Receives the existing validated WebP output; bounded images keep their exact bytes. */
export async function compressCommunityUpload(input: Buffer, maximumBytes = readerImageBytes): Promise<Buffer> {
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > readerImageBytes) throw Error('Image compression limit must remain within the upload output ceiling.');
  if (input.length <= maximumBytes) return input;
  const metadata = await sharp(input, { animated: true, limitInputPixels: 40_000_000 }).metadata();
  const pages = metadata.pages || 1, frameHeight = metadata.pageHeight || metadata.height;
  if (metadata.format !== 'webp' || !metadata.width || !metadata.height || !frameHeight || pages > 120 || metadata.width * metadata.height > 40_000_000) throw fail('图片无法读取或分辨率过大，请换一张。');
  if (pages > 1 && (metadata.loop === undefined || metadata.delay?.length !== pages)) throw fail('动态图的播放信息无法读取，请换一张。');
  const animation = pages > 1 ? { loop: metadata.loop, delay: metadata.delay } : {};
  for (const attempt of attempts) {
    // Every attempt starts from the original encoded upload, avoiding cumulative
    // resampling. Sharp resizes each animation frame without flattening it.
    const output = await sharp(input, { animated: true, limitInputPixels: 40_000_000 })
      .resize({ width: Math.max(1, Math.round(metadata.width * attempt.scale)), height: Math.max(1, Math.round(frameHeight * attempt.scale)), fit: 'inside', withoutEnlargement: true })
      .webp({ quality: attempt.quality, alphaQuality: 100, effort: 4, ...animation }).toBuffer();
    if (output.length > maximumBytes) continue;
    const result = await sharp(output, { animated: true, limitInputPixels: 40_000_000 }).metadata();
    if ((result.pages || 1) !== pages || metadata.hasAlpha && !result.hasAlpha) continue;
    if (pages > 1 && (result.loop !== metadata.loop || result.delay?.length !== pages || result.delay.some((delay, frame) => delay !== metadata.delay![frame]))) continue;
    return output;
  }
  throw fail('图片无法在保留动画和透明通道的前提下压缩到 2 MB，请缩短动态图或降低分辨率后重试。', 413);
}
