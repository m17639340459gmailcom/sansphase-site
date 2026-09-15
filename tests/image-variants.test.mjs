import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import sharp from 'sharp';
import {createImageVariants} from '../server/image-variants.mjs';
import {createPayloadStore} from '../server/payload/store.mjs';
import {createContentService} from '../server/content-service.mjs';
import {createPreviewServer} from '../server.mjs';
import {imageSources} from '../src/image-sources.mjs';
sharp.cache({files:0});
const hash=b=>createHash('sha256').update(b).digest('hex');

test('image variants preserve originals, aspect ratio and cached output; constrain dimensions', async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'sansphase-images-'));
 try {
  const source=resolve(dir,'source.png');
  await sharp({create:{width:2400,height:1600,channels:4,background:'#415478'}}).png().toFile(source);
  const before=hash(await readFile(source));const variant=createImageVariants(dir);
  const paths=await Promise.all([variant(source,384,'image/png'),variant(source,384,'image/png')]);
  assert.equal(paths[0],paths[1]);const meta=await sharp(paths[0]).metadata();
  assert.equal(meta.format,'webp');assert.equal(meta.width,384);assert.equal(meta.height,256);
  const resized = await sharp(source).rotate().resize({width:384,height:768,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer();
  const decoded = await sharp(paths[0]).ensureAlpha().raw().toBuffer();
  assert.deepEqual(decoded,resized,'lossless encoding preserves every resized pixel');
  const modified=(await stat(paths[0])).mtimeMs;assert.equal(await variant(source,384,'image/png'),paths[0]);assert.equal((await stat(paths[0])).mtimeMs,modified);
  assert.equal(await variant(source,999999,'image/png'),null);
  assert.equal(await variant(source,384,'image/gif'),null);
  assert.equal(await variant(source,384,'application/octet-stream'),null);
  assert.equal(hash(await readFile(source)),before);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('responsive sources include high-resolution options and preserve private preview authorization',()=>{
 const id=randomUUID(),preview=randomUUID();
 const attrs=imageSources(`/api/media/${id}?preview=${preview}&w=960`,'136px');
 assert(attrs.includes('3840w'));
 assert(attrs.includes(`preview=${preview}&amp;w=384`));
 assert(attrs.includes('sizes="136px"'));
 assert.equal(imageSources('https://external.example/image.jpg'),'');
});

test('resized media and 304 responses require current publication; downloads remain original', async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'sansphase-media-http-'));
 let server;
 try {
  await mkdir(resolve(dir,'uploads'));
  const id=randomUUID(),filename=id+'.png';const source=resolve(dir,'uploads',filename);
  await sharp({create:{width:1800,height:1200,channels:3,background:'#417faa'}}).png().toFile(source);
  const original=await readFile(source);let published=true;
  const store=createPayloadStore({findByID:async({id:found})=>{assert.equal(found,id);return {id,filename,mimeType:'image/png'};}},{directory:dir});
  store.publicData=async()=>[[],{avatar:published?id:null},[],[]];
  server=createPreviewServer({contentService:createContentService({store,url:'http://cms.test'})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const url=base+'/api/media/'+id+'?w=384';
  const first=await fetch(url);assert.equal(first.status,200);assert.equal(first.headers.get('content-type'),'image/webp');
  const small=Buffer.from(await first.arrayBuffer());assert.equal((await sharp(small).metadata()).width,384);
  const etag=first.headers.get('etag');assert(etag);assert.match(first.headers.get('cache-control'),/must-revalidate/);
  const cached=await fetch(url,{headers:{'If-None-Match':etag}});assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);
  const downloaded=await fetch(url+'&download=1');assert.equal(downloaded.headers.get('content-type'),'image/png');assert.equal(hash(Buffer.from(await downloaded.arrayBuffer())),hash(original));
  const partial=await fetch(url,{headers:{Range:'bytes=0-9'}});assert.equal(partial.status,206);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),small.subarray(0,10));
  published=false;
  assert.equal((await fetch(url,{headers:{'If-None-Match':etag}})).status,404);
 } finally {if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});await rm(dir,{recursive:true,force:true});}
});

