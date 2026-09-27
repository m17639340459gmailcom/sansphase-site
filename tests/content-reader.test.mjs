import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentReader,contentQuery} from '../src/content-reader.mjs';
test('private book preview requires explicit opt-in and never caches or prefetches',async()=>{
 const query=new URLSearchParams({view:'book-part',kind:'resource-center',preview:'test',previewKind:'resource-center'}),requests=[];
 const fetcher=async(url,options)=>{requests.push({url,options});return new Response('{"html":"draft"}',{headers:{etag:'"draft"'}});};
 await assert.rejects(createContentReader(fetcher).read(query));
 const reader=createContentReader(fetcher,{allowBookPreview:true});await reader.read(query);await reader.read(query);await reader.prefetch(query);
 assert.equal(requests.length,2);assert(requests.every(r=>!r.url.includes('public=1')&&!r.options.headers['If-None-Match']));reader.clear();
});
test('home never requests article data; route requests are explicit and bounded',()=>{
 assert.equal(contentQuery({page:'home'}),null);
 assert.equal(contentQuery({page:'note',id:'example'}).toString(),'view=detail&kind=notes&id=example');
 assert.equal(contentQuery({page:'resources',id:''},{page:2,query:'word',category:'A'}).get('page'),'2');
});
test('new navigation aborts the old fetch and HTTP errors remain visible',async()=>{
 const requests=[];
 const reader=createContentReader((url,options)=>new Promise(resolve=>requests.push({url,options,resolve})));
 const first=reader.read(new URLSearchParams({view:'list',kind:'notes'}));
 const second=reader.read(new URLSearchParams({view:'list',kind:'software'}));
 assert.equal(requests[0].options.signal.aborted,true);
 requests[1].resolve(new Response(JSON.stringify({items:[]})));
 assert.deepEqual(await second,{items:[]});
 requests[0].resolve(new Response(JSON.stringify({items:['stale']})));
 await assert.rejects(first,{name:'AbortError'});
 const failed=reader.read(new URLSearchParams({view:'detail',kind:'notes',id:'gone'}));
 requests[2].resolve(new Response('',{status:404}));
 await assert.rejects(failed,{status:404});
});

test('same navigation adopts an in-flight intent request without downloading twice',async()=>{
 let complete,calls=0;
 const reader=createContentReader(()=>{calls++;return new Promise(r=>complete=r);});
 const query=new URLSearchParams({view:'list',kind:'notes'});
 const warm=reader.prefetch(query);
 const visible=reader.read(query);
 assert.equal(calls,1);
 complete(new Response(JSON.stringify({items:[{id:'one'}]}),{headers:{ETag:'"v1"'}}));
 await warm;assert.equal((await visible).items[0].id,'one');
 reader.clear();
});

test('cached content is revalidated before reuse and withdrawal clears it',async()=>{
 const calls=[];let pass=0;
 const reader=createContentReader(async(url,options)=>{
  calls.push({url,options});pass++;
  if(pass===1)return new Response(JSON.stringify({item:{id:'one'},author:{name:'Owner'}}),{headers:{ETag:'"v1"'}});
  if(pass===2)return new Response(null,{status:304});
  return new Response('',{status:404});
 });
 const query=new URLSearchParams({view:'detail',kind:'notes',id:'one'});
 const first=await reader.read(query);first.item.id='client mutation';
 assert.equal((await reader.read(query)).item.id,'one');
 assert.equal(calls[1].options.headers['If-None-Match'],'"v1"');
 assert.match(calls[0].url,/public=1/);
 assert.equal('author' in await Promise.resolve(first),false);
 await assert.rejects(reader.read(query),{status:404});
 await assert.rejects(reader.read(query),{status:404});
 assert.equal(calls[3].options.headers['If-None-Match'],undefined);
});

test('cache eviction and identity invalidation remove validators; errors never serve stale content',async()=>{
 const requests=[];let broken=false;
 const reader=createContentReader(async(url,options)=>{
  requests.push(options);
  if(broken)throw Error('offline');
  return new Response(JSON.stringify({items:[]}),{headers:{ETag:'"v1"'}});
 },{maxEntries:1});
 const a=new URLSearchParams({view:'list',kind:'notes'}),b=new URLSearchParams({view:'list',kind:'software'});
 await reader.read(a);await reader.read(b);await reader.read(a);
 assert.equal(requests[2].headers['If-None-Match'],undefined);
 reader.clear();await reader.read(a);
 assert.equal(requests[3].headers['If-None-Match'],undefined);
 broken=true;await assert.rejects(reader.read(a),/offline/);
});
