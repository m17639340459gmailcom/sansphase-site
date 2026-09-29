import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {applyContentOrder,validateContentOrder,orderedContentKinds} from '../server/content-order.mjs';
import {createAuthorService} from '../server/author-service.ts';
import {createContentService} from '../server/content-service.mjs';
import {createPreviewServer} from '../server.mjs';

test('manual order keeps new entries first and rejects incomplete or stale orders',()=>{
  const [a,b,c]=Array.from({length:3},()=>randomUUID()),rows=[{id:c},{id:a},{id:b}];
  assert.deepEqual(applyContentOrder(rows,[b,a]).map(x=>x.id),[c,b,a]);
  assert.deepEqual(rows.map(x=>x.id),[c,a,b]);
  assert.deepEqual(validateContentOrder({ids:[b,a,c],expectedIds:[c,a,b]},[c,a,b]),[b,a,c]);
  for(const ids of [[a,a,c],[a,b],[a,b,randomUUID()],['wrong',a,b]])
    assert.throws(()=>validateContentOrder({ids,expectedIds:[c,a,b]},[c,a,b]),{status:400});
  assert.throws(()=>validateContentOrder({ids:[a,b,c],expectedIds:[a,b,c]},[c,a,b]),{status:409});
});

test('owner ordering is isolated per kind, atomic, conflict-aware and never publishes drafts',async t=>{
  const rows=Object.fromEntries(orderedContentKinds.map(kind=>[kind,
    ['published','draft','published'].map((status,i)=>({id:randomUUID(),kind,slug:kind+'-'+i,title:kind+' '+i,status,body:'<p>Public body</p>',date_updated:'unchanged',pending_content:i===0?{body:'private edit'}:null}))]));
  let profile={name:'Author',content_order:{}};
  const before=structuredClone(rows),writes=[];
  const store={
    mediaPrefix:'/api/media',identity:async()=>({id:'owner',first_name:'Author'}),
    list:async(collection,{kind})=>structuredClone(rows[kind||'articles']),
    profile:async()=>structuredClone(profile),
    saveProfile:async patch=>{await new Promise(r=>setTimeout(r,5));writes.push(patch);profile={...profile,...patch};return profile;},
    publicData:async()=>[structuredClone(rows.articles),structuredClone(profile),[],Object.entries(rows).filter(([k])=>k!=='articles').flatMap(([,v])=>structuredClone(v))],
  };
  const reservation=createPreviewServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
  const port=reservation.address().port;await new Promise(r=>reservation.close(r));const origin='http://127.0.0.1:'+port;
  const author=createAuthorService({url:origin,siteOrigin:origin,authorId:'owner',store}),content=createContentService({url:origin,store});
  const app=createPreviewServer({authorService:author,contentService:content});await new Promise(r=>app.listen(port,'127.0.0.1',r));t.after(()=>app.close());
  const request=(kind,body,extra={})=>fetch(origin+'/api/author/content/'+kind+(body?'/reorder':''),{
    method:body?'POST':'GET',headers:{Cookie:'sansphase_author_session=test',Origin:origin,'X-Author-Request':'1','Content-Type':'application/json',...extra},body:body&&JSON.stringify(body)});
  const submission=kind=>({ids:rows[kind].map(x=>x.id).reverse(),expectedIds:rows[kind].map(x=>x.id)});
  assert.equal((await request('articles',submission('articles'),{Cookie:''})).status,401);
  assert.equal((await request('articles',submission('articles'),{Origin:'https://evil.test'})).status,403);
  assert.equal((await request('articles',{...submission('articles'),ids:rows.works.map(x=>x.id)})).status,400);
  assert.equal(writes.length,0);
  const responses=await Promise.all(orderedContentKinds.map(kind=>request(kind,submission(kind))));
  for(const response of responses)assert.equal(response.status,200,await response.clone().text());
  for(const kind of orderedContentKinds){
    assert.deepEqual((await(await request(kind)).json()).map(x=>x.id),submission(kind).ids);
    assert.deepEqual(profile.content_order[kind],submission(kind).ids);
  }
  assert.equal((await request('articles',submission('articles'))).status,409);
  const current=profile.content_order.articles;
  const concurrent=await Promise.all([request('articles',{ids:[...current].reverse(),expectedIds:current}),request('articles',{ids:[current[1],current[0],current[2]],expectedIds:current})]);
  assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);
  const {data}=await content.snapshot();assert.equal(data.notes.length,2);
  for(const kind of orderedContentKinds.slice(1))assert.deepEqual(data[kind].map(x=>x.recordId),[rows[kind][2].id,rows[kind][0].id]);
  assert(!JSON.stringify(data).includes('private edit'));assert(!JSON.stringify(data).includes('content_order'));
  assert.deepEqual(rows,before);assert(writes.every(p=>Object.keys(p).join()==='content_order'));
  const saved=structuredClone(profile);store.saveProfile=async()=>{throw new Error('disk unavailable');};
  assert.equal((await request('works',{ids:rows.works.map(x=>x.id),expectedIds:profile.content_order.works})).status,503);
  assert.deepEqual(profile,saved);
});
