export function contentQuery({page,id},{page:pageNumber=1,category='all',query=''}={}) {
 const kind=page==='note'?'notes':page==='work'?'works':page;
 if(!['notes','works','resources','software','resource-center'].includes(kind)) return null;
 return new URLSearchParams(id?{view:'detail',kind,id}:{view:'list',kind,page:String(pageNumber),category,q:query});
}
export function createContentReader(fetcher=fetch,{maxEntries=12,maxBytes=2*1024*1024,now=Date.now,allowBookPreview=false}={}) {
 let active,bytes=0;
 const cache=new Map();
 const drop=key=>{const entry=cache.get(key);if(entry)bytes-=entry.bytes;cache.delete(key);};
 const cancel=()=>{active?.controller.abort();active=undefined;};
 function request(query,prefetch=false) {
  const params=new URLSearchParams(query);
  const privatePreview=params.has('preview');
  if(!['list','detail','book-part'].includes(params.get('view'))||(privatePreview&&(!allowBookPreview||params.get('view')!=='book-part'||params.get('previewKind')!=='resource-center'))) return Promise.reject(new Error('Only public content can be reused'));
  if(privatePreview){params.delete('public');if(prefetch)return Promise.resolve(null);}else params.set('public','1');params.sort();
  const key=params.toString();
  if(active?.key===key&&!active.controller.signal.aborted) {
   if(!prefetch) {active.prefetch=false;active.deadline(15000);}
   return active.promise.then(text=>JSON.parse(text));
  }
  // At most one speculative request; it cannot interrupt an actual navigation.
  if(prefetch&&active)return Promise.resolve(null);
  cancel();
  let cached=cache.get(key);
  if(cached&&now()-cached.time>300000){drop(key);cached=undefined;}
  if(prefetch&&cached&&now()-cached.time<10000)return Promise.resolve(null);
  const job={key,prefetch,controller:new AbortController(),timer:null};
  job.deadline=ms=>{clearTimeout(job.timer);job.timer=setTimeout(()=>job.controller.abort(new DOMException('Request timed out','TimeoutError')),ms);};
  active=job;job.deadline(prefetch?4000:15000);
  job.promise=(async()=>{
   try {
    const response=await fetcher(`/api/content?${key}`,{credentials:'same-origin',cache:'no-store',headers:cached?{'If-None-Match':cached.etag}:{},signal:job.controller.signal,priority:prefetch?'low':'high'});
    job.controller.signal.throwIfAborted();
    if(response.status===304&&cached) {
     cache.delete(key);cache.set(key,{...cached,time:now()});
     return cached.text;
    }
    if(!response.ok) {
     const problem=response.headers.get('content-type')?.includes('application/json')
       ? await response.json().catch(()=>null) : null;
     throw Object.assign(new Error('Content unavailable'),{status:response.status,
       code:problem?.code,item:problem?.item});
    }
    const {author,preview,...value}=await response.json();
    job.controller.signal.throwIfAborted();
    const text=JSON.stringify(value),etag=response.headers.get('etag');
    drop(key);
    const size=new TextEncoder().encode(text).length;
    if(!privatePreview&&etag&&size<=maxBytes&&maxEntries>0) {
     cache.set(key,{text,etag,time:now(),bytes:size});bytes+=size;
     while(cache.size>maxEntries||bytes>maxBytes)drop(cache.keys().next().value);
    }
    return text;
   } catch(error) {drop(key);throw error;}
   finally {clearTimeout(job.timer);if(active===job)active=undefined;}
  })();
  return job.promise.then(text=>JSON.parse(text));
 }
 return {cancel,clear(){cancel();cache.clear();bytes=0;},read:query=>request(query),prefetch:query=>request(query,true)};
}
