type Route = {page: string; id?: string};
type QueryOptions = {page?: number; category?: string; query?: string};
type ReaderOptions = {maxEntries?: number; maxBytes?: number; now?: () => number; allowBookPreview?: boolean};
type CachedResponse = {text: string; etag: string; time: number; bytes: number};
type ActiveRequest = {key: string; prefetch: boolean; controller: AbortController; timer: ReturnType<typeof setTimeout> | null; deadline: (ms: number) => void; promise: Promise<string>};
type ContentQuery = URLSearchParams | string | Record<string, string>;

// Keep only an already committed publication page during a very short read.
// This does not expose a cached target before the server validates it, and book
// bodies, author previews and non-content screens are never retained.
function createContentPresentation() {
 let committed: {host: HTMLElement; children: ChildNode[]} | null=null;
 let pending: {host: HTMLElement; inert: string | null; busy: string | null; timer: ReturnType<typeof setTimeout> | null} | null=null;
 const release=()=>{
  const held=pending;pending=null;
  if(!held)return;
  if(held.timer)clearTimeout(held.timer);
  for(const [attribute,value] of [['inert',held.inert],['aria-busy',held.busy]] as const) {
   if(value===null)held.host.removeAttribute(attribute);
   else held.host.setAttribute(attribute,value);
  }
 };
 const clear=()=>{release();committed=null;};
 return {
  release,clear,
  commit(host: HTMLElement | null,query: ContentQuery) {
   clear();
   const params=new URLSearchParams(query),view=params.get('view'),kind=params.get('kind');
   if(!host||host.hidden||!host.isConnected||!host.hasChildNodes()||params.has('preview')||
      !['notes','works','resources','software','resource-center'].includes(kind || '')||
      !(view==='list'||(view==='detail'&&kind!=='resource-center')))return;
   committed={host,children:[...host.childNodes]};
  },
  begin(host: HTMLElement | null,show: () => void) {
   release();
   if(!host||host.hidden||!host.isConnected||committed?.host!==host||
      committed.children.length!==host.childNodes.length||
      committed.children.some((child,index)=>child!==host.childNodes[index])) {
    show();return ()=>{};
   }
   const held={host,inert:host.getAttribute('inert'),busy:host.getAttribute('aria-busy'),timer:null as ReturnType<typeof setTimeout> | null};
   pending=held;
   host.setAttribute('inert','');host.setAttribute('aria-busy','true');
   const finish=()=>{if(pending===held)release();};
   held.timer=setTimeout(()=>{if(pending!==held)return;finish();show();},120);
   return finish;
  },
 };
}
export function contentQuery({page,id}: Route,{page:pageNumber=1,category='all',query=''}: QueryOptions={}) {
 const kind=page==='note'?'notes':page==='work'?'works':page;
 if(!['notes','works','resources','software','resource-center'].includes(kind)) return null;
 return new URLSearchParams(id?{view:'detail',kind,id}:{view:'list',kind,page:String(pageNumber),category,q:query});
}
export function createContentReader(fetcher: typeof fetch=fetch,{maxEntries=12,maxBytes=2*1024*1024,now=Date.now,allowBookPreview=false}: ReaderOptions={}) {
 let active: ActiveRequest | undefined,bytes=0;
 const presentation=createContentPresentation();
 const cache=new Map<string, CachedResponse>();
 const drop=(key: string)=>{const entry=cache.get(key);if(entry)bytes-=entry.bytes;cache.delete(key);};
 const cancel=()=>{active?.controller.abort();active=undefined;};
 function request(query: ContentQuery,prefetch=false) {
  const params=new URLSearchParams(query);
  const privatePreview=params.has('preview');
  if(!['list','detail','book-part'].includes(params.get('view') || '')||(privatePreview&&(!allowBookPreview||params.get('view')!=='book-part'||params.get('previewKind')!=='resource-center'))) return Promise.reject(new Error('Only public content can be reused'));
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
  const job: ActiveRequest={key,prefetch,controller:new AbortController(),timer:null,deadline:()=>{},promise:Promise.resolve('')};
  job.deadline=ms=>{if(job.timer)clearTimeout(job.timer);job.timer=setTimeout(()=>job.controller.abort(new DOMException('Request timed out','TimeoutError')),ms);};
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
     while(cache.size>maxEntries||bytes>maxBytes)drop(cache.keys().next().value as string);
    }
    return text;
   } catch(error) {drop(key);throw error;}
   finally {if(job.timer)clearTimeout(job.timer);if(active===job)active=undefined;}
  })();
  return job.promise.then(text=>JSON.parse(text));
 }
 return {presentation,cancel(){cancel();presentation.clear();},clear(){cancel();presentation.clear();cache.clear();bytes=0;},read:(query: ContentQuery)=>request(query),prefetch:(query: ContentQuery)=>request(query,true)};
}
