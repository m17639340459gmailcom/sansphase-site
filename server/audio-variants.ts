import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,stat,rename,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';

const execute=promisify(execFile);
const isMissing=(error:unknown)=>error instanceof Error && 'code' in error && error.code==='ENOENT';
export function createAudioVariants(directory:string,{ffmpeg='ffmpeg'}:{ffmpeg?:string}={}) {
  const cache=resolve(directory,'audio-cache'),pending=new Map<string,Promise<string|null>>(),failed=new Set<string>();
  let queue:Promise<unknown>=Promise.resolve();
  return async(source:string,mime:string)=>{
    if(!/^audio\/(mpeg|mp3)$/.test(mime))return null;
    const info=await stat(source);
    // A playback copy is optional; large downloads keep using the original.
    if(!info.size||info.size>256*1024**2)return null;
    const key=createHash('sha256').update(`v1-mp3-index:${source}:${info.size}:${info.mtimeMs}`).digest('hex');
    const path=resolve(cache,`${key}.mp3`);
    if(failed.has(key))return null;
    try{await stat(path);return path;}catch(error){if(!isMissing(error))throw error;}
    if(!pending.has(key)){
      const job=queue.then(async()=>{
        const temporary=resolve(cache,`${key}-${randomUUID()}.tmp.mp3`);
        try{
          await mkdir(cache,{recursive:true,mode:0o700});
          // Copy encoded audio packets unchanged. Add duration/seeking headers
          // so browsers need not scan a minute of MP3 frames before starting.
          await execute(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-f','mp3','-i',source,'-map','0:a:0','-c:a','copy','-map_metadata','-1','-write_xing','1','-n',temporary],{timeout:15000,maxBuffer:256*1024,windowsHide:true});
          if(!(await stat(temporary)).size)throw Error('Empty audio copy');
          await rename(temporary,path);
          return path;
        }catch{
          // Missing FFmpeg or an unsupported file must never prevent playback.
          failed.add(key);if(failed.size>128){const oldest=failed.values().next().value;if(oldest)failed.delete(oldest);}
          return null;
        }finally{await unlink(temporary).catch(error=>{if(!isMissing(error))throw error;});}
      });
      queue=job.catch(()=>{});pending.set(key,job);
      job.finally(()=>pending.delete(key)).catch(()=>{});
    }
    return pending.get(key)!;
  };
}
