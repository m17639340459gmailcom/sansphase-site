import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {createPayloadStore} from '../server/payload/store.mjs';
import {createAuthorService} from '../server/author-service.mjs';
import {createContentService} from '../server/content-service.mjs';
import {createPreviewServer} from '../server.mjs';
import {imageSources} from '../src/image-sources.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('author responsive sources retain the authenticated URL and escaped parameters',()=>{
 const id=randomUUID();
 const sources=imageSources(`/api/author/media/${id}?w=384`,'72px');
 assert(sources.includes(`/api/author/media/${id}?w=768 768w`));
 assert(sources.includes('sizes="72px"'));
 assert(!sources.includes('srcset="/api/media/'));
 assert.equal(imageSources(`/api/author/profile/${id}`),'');
 assert.equal(imageSources(`https://evil.test/api/author/media/${id}`),'');
});

test('author thumbnails preserve originals; private validators never bypass current owner authorization',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'sansphase-author-images-'));
 let server;
 try {
  await mkdir(resolve(dir,'uploads'));
  const id=randomUUID(),filename=id+'.png',source=resolve(dir,'uploads',filename);
  await sharp({create:{width:2560,height:1440,channels:3,background:'#344477'}}).png().toFile(source);
  const original=await readFile(source);let allowed=true,mime='image/png';
  const ownerId=randomUUID();
  const payload={auth:async({headers})=>({user:allowed&&headers.get('Authorization')==='JWT valid'?{id:ownerId,collection:'authors',role:'owner'}:null}),
   findByID:async({id:found})=>{assert.equal(found,id);return {id,filename,mimeType:mime};}};
  const store=createPayloadStore(payload,{directory:dir,authorId:ownerId});
  store.publicData=async()=>[[],{},[],[]];
  server=createPreviewServer({authorService:createAuthorService({store,authorId:ownerId,url:'http://cms.test'}),contentService:createContentService({store,url:'http://cms.test'})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port,path='/api/author/media/'+id;
  const headers={Cookie:'sansphase_author_session=valid'};
  assert.equal((await fetch(base+path+'?w=768')).status,401);
  const first=await fetch(base+path+'?w=768',{headers});assert.equal(first.status,200);
  const body=Buffer.from(await first.arrayBuffer());assert.equal((await sharp(body).metadata()).width,768);
  assert(body.length<original.length);assert.equal(first.headers.get('content-type'),'image/webp');
  assert.equal(first.headers.get('content-length'),String(body.length));
  assert.match(first.headers.get('cache-control'),/private/);assert.match(first.headers.get('cache-control'),/must-revalidate/);
  assert.match(first.headers.get('vary'),/Cookie/i);
  const etag=first.headers.get('etag');assert(etag);
  const reused=await fetch(base+path+'?w=768',{headers:{...headers,'If-None-Match':etag}});
  assert.equal(reused.status,304);assert.equal((await reused.arrayBuffer()).byteLength,0);
  const full=await fetch(base+path,{headers:{...headers,'If-None-Match':etag}});
  assert.equal(full.status,200);assert.equal(hash(Buffer.from(await full.arrayBuffer())),hash(original));
  const otherSize=await fetch(base+path+'?w=384',{headers:{...headers,'If-None-Match':etag}});
  assert.equal(otherSize.status,200);assert.equal((await sharp(Buffer.from(await otherSize.arrayBuffer())).metadata()).width,384);
  assert.equal((await fetch(base+'/api/media/'+id+'?w=768')).status,404,'private image is not published by thumbnail generation');
  allowed=false;
  const denied=await fetch(base+path+'?w=768',{headers:{...headers,'If-None-Match':etag}});
  assert.equal(denied.status,401);assert.equal(denied.headers.get('etag'),null);assert.equal(denied.headers.get('cache-control'),'no-store');
  allowed=true;mime='application/octet-stream';
  const attachment=await fetch(base+path+'?w=768',{headers});
  assert.equal(attachment.headers.get('cache-control'),'no-store');assert.equal(attachment.headers.get('content-disposition'),'attachment');
  assert.equal(hash(Buffer.from(await attachment.arrayBuffer())),hash(original));
  assert.equal(hash(await readFile(source)),hash(original));
 }finally{
  if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});
  assert(dir.startsWith(resolve(tmpdir())+sep)&&dir.split(sep).at(-1).startsWith('sansphase-author-images-'));
  await rm(dir,{recursive:true,force:true});
 }
});
