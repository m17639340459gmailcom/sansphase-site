import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {getPayload} from 'payload';
import sharp from 'sharp';
import {createPayloadStore} from '../server/payload/store.ts';
import {makePayloadConfig} from '../server/payload/config.ts';
import {createContentService} from '../server/content-service.ts';

const shared='11111111-1111-4111-8111-111111111111';
const attachment='22222222-2222-4222-8222-222222222222';
const futureImage='33333333-3333-4333-8333-333333333333';
const future=Date.now()+86400000;
const project=(row,select)=>!select?structuredClone(row):Object.fromEntries(Object.entries(row).filter(([key])=>key==='id'||select[key]===true));
function fixture() {
 const article=(id,attachments=[])=>({id,slug:id,status:'published',title:id,summary:'Summary',category:'Notes',tags:['tag'],body:`<p><img src="/api/media/${shared}"><img src="/api/media/${shared}"></p>`,cover:shared,published_at:null,date_created:'2026-01-01',attachments,pending_content:{body:'private draft'},updatedAt:'unused'});
 const rows={
  articles:[article('first',[{id:'a',directus_files_id:attachment},{id:'b',directus_files_id:attachment}]),article('second',[{id:'c',directus_files_id:{id:attachment}}]),{...article('future'),published_at:new Date(future).toISOString(),cover:futureImage,body:''}],
  site_profile:[{id:'profile',name:'Author',signature:'Signature',bio:'Bio',avatar:shared,background:shared,social_links:[],music_settings:{},appearance:{},content_order:{articles:['second','first']},background_library:[{id:futureImage}],updatedAt:'unused'}],
  announcements:[{id:'notice',status:'published',title:'Notice',summary:'Summary',image:shared,link:'https://example.test',sort:2,pending_content:{summary:'private notice'}}],
  library_entries:[{...article('book'),kind:'resource-center',vip_only:true,showcase_cover:shared,file:attachment,external_url:'https://example.test/book'}],
 };
 const media=new Map([
  [shared,{id:shared,title:'Cover',filename:'cover.png',originalName:'Original cover.png',mimeType:'image/png',filesize:60,width:640,height:480,legacyFilename:'private storage detail'}],
  [attachment,{id:attachment,title:'Attachment',filename:'guide.pdf',originalName:'Original guide.pdf',mimeType:'application/pdf',filesize:1024}],
 ]);
 const finds=[],reads=[];let failMedia;
 const payload={
  async find(options){finds.push(options);return {docs:rows[options.collection].map(row=>project(row,options.select))};},
  async findByID(options){reads.push(options);await Promise.resolve();if(failMedia)throw failMedia;if(!media.has(options.id))throw Object.assign(Error('Not found'),{status:404});return project(media.get(options.id),options.select);},
 };
 const store=createPayloadStore(payload,{directory:tmpdir(),authorId:'unused',mediaRetention:{}});
 return {rows,media,finds,reads,store,setMediaFailure(error){failMedia=error;}};
}

test('one public rebuild shares each media read across articles, duplicate attachments and library entries',async()=>{
 const f=fixture(),[articles,profile,announcements,library,next]=await f.store.publicData();
 assert.deepEqual(f.reads.map(call=>call.id).sort(),[shared,attachment].sort(),'seven repeated lookups become two unique reads');
 assert.deepEqual(articles.map(row=>row.slug),['first','second']);assert.equal(next,future);
 assert.equal(articles[0].imageDimensions[shared].width,640);
 assert.equal(articles[0].attachments.length,2,'deduplicating reads must not remove repeated attachments');
 assert.equal(articles[0].attachments[0].directus_files_id.filename_download,'Original guide.pdf');
 assert.equal(library[0].file.filesize,1024);assert.equal(library[0].vip_only,true);
 assert.deepEqual(profile.content_order.articles,['second','first']);assert.equal(announcements[0].image,shared);
 assert(!f.reads.some(call=>call.id===futureImage));
});

test('public queries exclude editor-only fields while retaining every publication and permission field',async()=>{
 const f=fixture(),rows=await f.store.publicData();
 for(const call of f.finds)assert(call.select,'public collection reads use the installed Payload select API');
 for(const call of f.reads)assert(call.select,'media metadata reads use a narrow projection');
 assert.equal(rows[0][0].pending_content,undefined);assert.equal(rows[1].background_library,undefined);
 assert.equal(rows[2][0].pending_content,undefined);assert.equal(rows[3][0].pending_content,undefined);
 const content=createContentService({url:'https://example.test',store:f.store});
 const snapshot=await content.snapshot();
 assert.deepEqual(snapshot.data.notes.map(row=>row.id),['second','first']);
 assert.equal(snapshot.data['resource-center'][0].vipOnly,true);
 assert.equal(snapshot.expiresAt,future);assert(snapshot.media.has(shared));assert(snapshot.media.has(attachment));
 assert(!snapshot.media.has(futureImage));assert(!JSON.stringify(snapshot.data).includes('private draft'));
});

test('media read reuse ends with the rebuild, including changed metadata and failed lookups',async()=>{
 const f=fixture();await f.store.publicData();
 f.media.get(shared).width=1280;f.media.get(attachment).title='Updated attachment';f.reads.length=0;
 const fresh=await f.store.publicData();
 assert.equal(f.reads.length,2);assert.equal(fresh[0][0].imageDimensions[shared].width,1280);
 assert.equal(fresh[0][0].attachments[0].directus_files_id.title,'Updated attachment');
 f.setMediaFailure(Object.assign(Error('database unavailable'),{status:503}));
 await assert.rejects(f.store.publicData(),{status:503});
 f.setMediaFailure(undefined);assert.equal((await f.store.publicData())[0].length,2);
});

test('missing illustration dimensions remain optional, but missing attachments and library downloads fail closed',async()=>{
 const f=fixture();f.media.delete(shared);
 const rows=await f.store.publicData();assert.deepEqual(rows[0][0].imageDimensions,{});
 assert.equal(f.reads.filter(call=>call.id===shared).length,1,'a missing shared illustration is looked up once');
 f.media.delete(attachment);await assert.rejects(f.store.publicData(),{status:404});
 const libraryOnly=fixture();libraryOnly.rows.articles=[];libraryOnly.media.delete(attachment);
 await assert.rejects(libraryOnly.store.publicData(),{status:404});
 const sameMissing=fixture();sameMissing.media.delete(shared);sameMissing.rows.articles[0].attachments=[{directus_files_id:shared}];
 await assert.rejects(sameMissing.store.publicData(),{status:404},'an optional image lookup must not hide the required attachment failure');
});

test('actual Payload select preserves public data, scheduling and shared media while excluding drafts', {timeout:60000},async()=>{
 const directory=await mkdtemp(resolve(tmpdir(),'sansphase-public-projection-'));
 let payload;
 try {
  payload=await getPayload({config:makePayloadConfig({directory,secret:randomBytes(48).toString('hex'),push:true})});
  const bytes=await sharp({create:{width:48,height:32,channels:3,background:'#102030'}}).png().toBuffer();
  const media=await payload.create({collection:'media',data:{title:'Shared cover',originalName:'cover.png'},file:{data:bytes,mimetype:'image/png',name:'cover.png',size:bytes.length}});
  const base={status:'published',title:'Published',slug:'published',summary:'Summary',body:`<p><img src="/api/media/${media.id}"></p>`,cover:media.id,pending_content:{body:'SECRET DRAFT'},date_created:'2026-01-01'};
  const first=await payload.create({collection:'articles',data:{...base,attachments:[{id:randomUUID(),directus_files_id:media.id}]}});
  await payload.create({collection:'articles',data:{...base,title:'Scheduled',slug:'scheduled',published_at:new Date(future).toISOString()}});
  await payload.create({collection:'library_entries',data:{...base,slug:'vip-book',kind:'resource-center',vip_only:true,file:media.id,showcase_cover:media.id}});
  await payload.create({collection:'site_profile',data:{name:'Author',content_order:{articles:[first.id]},background_library:[{id:media.id}]}});
  await payload.create({collection:'announcements',data:{title:'Notice',status:'published',image:media.id,sort:1,pending_content:{summary:'SECRET NOTICE'}}});
  const mediaReads=[];
  const adapter={find:options=>payload.find(options),findByID:options=>{mediaReads.push(options);return payload.findByID(options);}};
  const store=createPayloadStore(adapter,{directory,authorId:'unused',mediaRetention:{}});
  const rows=await store.publicData();
  assert.equal(mediaReads.length,1);assert.equal(rows[0].length,1);assert.equal(rows[0][0].id,first.id);
  assert.equal(rows[0][0].imageDimensions[media.id].width,48);assert.equal(rows[0][0].attachments[0].directus_files_id.id,media.id);
  assert.equal(rows[3][0].file.filename_download,'cover.png');assert.equal(rows[3][0].vip_only,true);assert.equal(rows[4],future);
  assert.equal(rows[1].background_library,undefined);assert(!JSON.stringify(rows).includes('SECRET'));
 } finally {
  if(payload){await payload.destroy();payload.db.client.close();}
  const target=resolve(directory);assert(target.startsWith(resolve(tmpdir())+sep)&&target.split(sep).at(-1).startsWith('sansphase-public-projection-'));
  await rm(target,{recursive:true,force:true,maxRetries:2,retryDelay:50}).catch(error=>{if(error.code!=='EBUSY')throw error;});
 }
});
