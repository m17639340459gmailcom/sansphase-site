import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createAudioVariants} from '../server/audio-variants.mjs';
const run=promisify(execFile);
test('MP3 playback index preserves encoded audio and coalesces concurrent work',async t=>{
  try{await run('ffmpeg',['-version'],{windowsHide:true});}catch{t.skip('FFmpeg is optional locally; release server must run this test');return;}
  const directory=await mkdtemp(resolve(tmpdir(),'sansphase-audio-'));
  try{
    const source=resolve(directory,'original.mp3');
    await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','libmp3lame','-b:a','320k','-write_xing','0',source],{windowsHide:true});
    const original=await readFile(source),variant=createAudioVariants(directory);
    const paths=await Promise.all([variant(source,'audio/mpeg'),variant(source,'audio/mpeg')]);
    assert(paths[0]);assert.equal(paths[0],paths[1]);assert.notEqual(paths[0],source);
    const header=(await readFile(paths[0])).subarray(0,2048);
    assert(header.includes(Buffer.from('Info'))||header.includes(Buffer.from('Xing')));
    const hash=async path=>(await run('ffmpeg',['-hide_banner','-loglevel','error','-i',path,'-map','0:a:0','-c:a','copy','-f','hash','-hash','sha256','-'],{windowsHide:true})).stdout.trim();
    assert.equal(await hash(source),await hash(paths[0]),'compressed audio packets are identical');
    assert.deepEqual(await readFile(source),original,'upload is never overwritten');
    assert.equal(await variant(source,'audio/mpeg'),paths[0]);
    assert.equal((await readdir(resolve(directory,'audio-cache'))).length,1);
    await writeFile(source,Buffer.concat([original,Buffer.from('changed metadata')]));
    assert.notEqual(await variant(source,'audio/mpeg'),paths[0],'changed source gets its own cache key');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('unsupported audio, missing encoder and malformed MP3 fall back without leaving temporary files',async()=>{
  const directory=await mkdtemp(resolve(tmpdir(),'sansphase-audio-fallback-'));
  try{
    const source=resolve(directory,'invalid.mp3');await writeFile(source,'ID3-audio-test');
    const unavailable=createAudioVariants(directory,{ffmpeg:resolve(directory,'missing-ffmpeg')});
    assert.equal(await unavailable(source,'audio/mpeg'),null);
    assert.equal(await unavailable(source,'audio/mpeg'),null);
    const variant=createAudioVariants(directory);
    assert.equal(await variant(source,'audio/ogg'),null);
    assert.equal(await variant(source,'audio/mpeg'),null);
    assert.deepEqual(await readdir(resolve(directory,'audio-cache')),[]);
  }finally{await rm(directory,{recursive:true,force:true});}
});
