import test from 'node:test';
import assert from 'node:assert/strict';
import {publicBootstrap, publicPage} from '../server/content-delivery.mjs';
import {createPreviewServer} from '../server.mjs';

const data={source:'cms',profile:{name:'Author'},announcements:[],notes:Array.from({length:1000},(_,i)=>({id:`note-${i}`,title:`Article ${i}`,summary:'Summary',category:i%2?'A':'B',tags:['tag'],bodyHTML:'<p>'+ 'Long article '.repeat(1000)+'</p>',attachments:[],coverSrc:'/api/media/cover'})),works:[],resources:[],software:[],'resource-center':[]};
test('homepage bootstrap size is independent of article bodies and lists',()=>{
 const value=publicBootstrap(data);
 assert.equal(value.delivery,'paged-v1');
 assert.deepEqual(value.notes,[]);
 assert.equal(value.collections.notes.totalPublished,1000);
 assert.equal(value.collections.notes.tagCount,1);
 assert(Buffer.byteLength(JSON.stringify(value))<4000);
 assert(!JSON.stringify(value).includes('Long article'));
});
test('pages retain author order, filter across the full collection, and omit bodies',()=>{
 const page=publicPage(data,new URLSearchParams({view:'list',kind:'notes',page:'2',category:'A'}));
 assert.equal(page.items.length,12);
 assert.equal(page.items[0].id,'note-25');
 assert.equal(page.total,500);
 assert.equal(page.pages,42);
 assert(!('bodyHTML' in page.items[0]));
 assert.deepEqual(page.categories,['B','A']);
 const searched=publicPage(data,new URLSearchParams({view:'list',kind:'notes',q:'Article 999'}));
 assert.equal(searched.items[0].id,'note-999');
 assert.equal(searched.total,1);
 assert.equal(publicPage(data,new URLSearchParams({view:'list',kind:'notes',page:'99999'})).page,84);
});
test('detail returns exactly the requested public item and rejects unsupported queries',()=>{
 assert.equal(publicPage(data,new URLSearchParams({view:'detail',kind:'notes',id:'note-900'})).item.bodyHTML,data.notes[900].bodyHTML);
 for(const params of [{view:'detail',kind:'notes',id:'unpublished'},{view:'list',kind:'authors'},{view:'all',kind:'notes'}]) assert.throws(()=>publicPage(data,new URLSearchParams(params)),e=>e.status===404||e.status===400);
});

test('HTTP bootstrap, bounded pages and withdrawal work without leaking author identity',async t=>{
 let current=data;
 const server=createPreviewServer({contentService:{snapshot:async()=>({data:current})},authorService:{identity:async req=>req.headers.cookie?{name:'Owner'}:null}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const html=await (await fetch(base)).text();
 assert(!html.includes('Long article'));
 assert(html.includes('paged-v1'));
 let response=await fetch(base+'/api/content?view=list&kind=notes&page=2');
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await response.json()).items.length,12);
 const privateView=await(await fetch(base+'/api/content?view=bootstrap',{headers:{cookie:'owner=1'}})).json();
 assert.equal(privateView.author.name,'Owner');
 assert.equal((await(await fetch(base+'/api/content?view=bootstrap')).json()).author,null);
 assert.equal(data.author,undefined);
 current={...data,notes:[]};
 assert.equal((await fetch(base+'/api/content?view=detail&kind=notes&id=note-900')).status,404);
 assert.equal((await fetch(base+'/api/content?view=list&kind=users')).status,400);
});

test('explicit public pages revalidate against current publication without identity or draft caching',async t=>{
 let current=data,identityCalls=0;
 const server=createPreviewServer({contentService:{snapshot:async()=>({data:current}),preview:async()=>{throw Object.assign(Error('Denied'),{status:403});}},authorService:{identity:async()=>{identityCalls++;return {name:'Owner'};}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/content`;
 const path=base+'?view=detail&kind=notes&id=note-1&public=1';
 let response=await fetch(path,{headers:{cookie:'owner=1'}});
 const etag=response.headers.get('etag');assert.ok(etag);
 assert.equal(response.headers.get('cache-control'),'private, no-cache');
 assert.equal((await response.json()).author,undefined);assert.equal(identityCalls,0);
 response=await fetch(path,{headers:{'If-None-Match':etag}});assert.equal(response.status,304);
 // Nginx may weaken a strong validator when gzip changes the wire bytes.
 for(const validator of ['W/'+etag,'"unrelated", W/'+etag,'*']) {
  response=await fetch(path,{headers:{'If-None-Match':validator}});assert.equal(response.status,304);
 }
 response=await fetch(base+'?view=detail&kind=notes&id=note-2&public=1',{headers:{'If-None-Match':etag}});assert.equal(response.status,200);await response.text();
 current={...data,notes:[]};
 response=await fetch(path,{headers:{'If-None-Match':etag}});assert.equal(response.status,404);
 response=await fetch(path,{headers:{'If-None-Match':'W/'+etag}});assert.equal(response.status,404);
 response=await fetch(path+'&preview=secret',{headers:{'If-None-Match':etag}});assert.notEqual(response.status,304);assert.equal(response.headers.get('cache-control'),'no-store');
 response=await fetch(base+'?view=bootstrap&public=1');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).author.name,'Owner');
});
