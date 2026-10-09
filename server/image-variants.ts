import sharp from 'sharp';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, stat, rename, unlink, writeFile, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {imageWidths} from '../src/image-sources.mjs';

const widths = new Set(imageWidths);
const isMissing=(error:unknown)=>error instanceof Error && 'code' in error && error.code==='ENOENT';
type VariantQueue = { pending: Map<string,Promise<string|null>>; queue: Promise<unknown> };
const queues = new Map<string,VariantQueue>();
function variantQueue(directory:string) {
  const cache=resolve(directory,'image-cache');
  let state=queues.get(cache);
  if(!state) {state={pending:new Map(),queue:Promise.resolve()};queues.set(cache,state);}
  return state;
}
const variantKey=(source:string, size:number, modified:number, width:number, presentation:boolean)=>createHash('sha256').update(`${presentation ? 'v3-display-q92' : 'v2-lossless'}:${source}:${size}:${modified}:${width}`).digest('hex');

/** Serialize cache removal and the caller's guarded source deletion with generation. */
export async function removeImageVariants(directory:string, source:string, removeSource?:()=>Promise<void>) {
  const state=variantQueue(directory),cache=resolve(directory,'image-cache');
  const job=state.queue.then(async()=>{
    const info=await stat(source).catch(error=>{if(isMissing(error))return null;throw error;});
    if(info) for(const width of imageWidths) for(const presentation of [false,true]) {
      const key=variantKey(source,info.size,info.mtimeMs,width,presentation);
      for(const suffix of ['webp','original']) await unlink(resolve(cache,`${key}.${suffix}`)).catch(error=>{if(!isMissing(error))throw error;});
    }
    await removeSource?.();
  });
  state.queue=job.catch(()=>{});
  await job;
}
export function createImageVariants(directory:string) {
  const cache = resolve(directory, 'image-cache');
  const state=variantQueue(directory),pending=state.pending;
  return async (source:string, requestedWidth:unknown, mime:string, presentation = false) => {
    const width = Number(requestedWidth);
    if (!widths.has(width) || !/^image\/(jpeg|png|webp|avif)$/.test(mime)) return null;
    const info = await stat(source);
    const key = variantKey(source,info.size,info.mtimeMs,width,presentation);
    const path = resolve(cache, `${key}.webp`);
    const originalMarker = resolve(cache, `${key}.original`);
    try {await stat(originalMarker); return null;} catch(error) {if(!isMissing(error)) throw error;}
    try {await stat(path); return path;} catch(error) {if(!isMissing(error)) throw error;}
    if (!pending.has(key)) {
      // Serialize libvips work on the small production server, and coalesce
      // concurrent requests for the same variant. Originals are never modified.
      const job = state.queue.then(async () => {
        // Buffer input keeps libvips from retaining the original's file handle
        // across a later guarded deletion, including local Windows previews.
        const input = sharp(await readFile(source), {limitInputPixels: 100000000});
        const metadata = await input.metadata();
        if (metadata.pages && metadata.pages > 1) return null;
        await mkdir(cache, {recursive:true, mode:0o700});
        const temporary = resolve(cache, `${key}-${randomUUID()}.tmp`);
        try {
          await input.rotate().resize({width, height:width * 2, fit:'inside', withoutEnlargement:true})
            .webp(presentation ? {quality:92, smartSubsample:true, effort:4} : {lossless:true, effort:4}).toFile(temporary);
          if ((await stat(temporary)).size >= info.size) {
            await writeFile(originalMarker, '', {mode:0o600});
            return null;
          }
          await rename(temporary, path);
          return path;
        } finally {await unlink(temporary).catch(error => {if(!isMissing(error)) throw error;});}
      });
      state.queue = job.catch(() => {});
      pending.set(key, job);
      job.finally(() => pending.delete(key)).catch(() => {});
    }
    return pending.get(key)!;
  };
}
