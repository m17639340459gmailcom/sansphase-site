import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewServer} from '../server.mjs';
test('MP3 playback leaves bandwidth for navigation; downloads, other formats and denied media remain unchanged',async t=>{
 let allowed=true,type='audio/mpeg';
 const bytes=new Uint8Array([1,2,3,4]);
 const server=createPreviewServer({contentService:{media:async(_id,options)=>{
  if(!allowed)throw Object.assign(Error('Withdrawn'),{status:404});
  return new Response(bytes,{status:options.range?206:200,headers:{'Content-Type':type,'Content-Length':'4','ETag':'"same-audio"','Accept-Ranges':'bytes',...(options.range?{'Content-Range':'bytes 0-3/4'}:{})}});
 }}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/api/media/example`;
 let response=await fetch(url,{headers:{Range:'bytes=0-3'}});
 assert.equal(response.status,206);assert.equal(response.headers.get('x-accel-limit-rate'),'98304');
 assert.equal(response.headers.get('x-accel-buffering'),'yes');
 assert.equal(response.headers.get('content-range'),'bytes 0-3/4');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 for(const suffix of ['?download=1','?preview=draft']) {response=await fetch(url+suffix);assert.equal(response.headers.get('x-accel-limit-rate'),null);await response.arrayBuffer();}
 for(const mime of ['audio/flac','audio/wav','image/webp']){type=mime;response=await fetch(url);assert.equal(response.headers.get('x-accel-limit-rate'),null);await response.arrayBuffer();}
 allowed=false;response=await fetch(url);assert.equal(response.status,404);assert.equal(response.headers.get('x-accel-limit-rate'),null);
});
