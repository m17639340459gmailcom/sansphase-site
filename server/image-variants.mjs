import sharp from 'sharp';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, stat, rename, unlink, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {imageWidths} from '../src/image-sources.mjs';

const widths = new Set(imageWidths);
export function createImageVariants(directory) {
  const cache = resolve(directory, 'image-cache');
  const pending = new Map();
  let queue = Promise.resolve();
  return async (source, requestedWidth, mime) => {
    const width = Number(requestedWidth);
    if (!widths.has(width) || !/^image\/(jpeg|png|webp|avif)$/.test(mime)) return null;
    const info = await stat(source);
    const key = createHash('sha256').update(`v2-lossless:${source}:${info.size}:${info.mtimeMs}:${width}`).digest('hex');
    const path = resolve(cache, `${key}.webp`);
    const originalMarker = resolve(cache, `${key}.original`);
    try {await stat(originalMarker); return null;} catch(error) {if(error.code !== 'ENOENT') throw error;}
    try {await stat(path); return path;} catch(error) {if(error.code !== 'ENOENT') throw error;}
    if (!pending.has(key)) {
      // Serialize libvips work on the small production server, and coalesce
      // concurrent requests for the same variant. Originals are never modified.
      const job = queue.then(async () => {
        const input = sharp(source, {limitInputPixels: 100000000});
        const metadata = await input.metadata();
        if (metadata.pages > 1) return null;
        await mkdir(cache, {recursive:true, mode:0o700});
        const temporary = resolve(cache, `${key}-${randomUUID()}.tmp`);
        try {
          await input.rotate().resize({width, height:width * 2, fit:'inside', withoutEnlargement:true})
            .webp({lossless:true, effort:4}).toFile(temporary);
          if ((await stat(temporary)).size >= info.size) {
            await writeFile(originalMarker, '', {mode:0o600});
            return null;
          }
          await rename(temporary, path);
          return path;
        } finally {await unlink(temporary).catch(error => {if(error.code !== 'ENOENT') throw error;});}
      });
      queue = job.catch(() => {});
      pending.set(key, job);
      job.finally(() => pending.delete(key)).catch(() => {});
    }
    return pending.get(key);
  };
}
