import {filterItems} from '../src/core.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {bookManifest,bookPart} from './book-delivery.mjs';

const kinds=['notes','works','resources','software','resource-center'];
const bootstraps=new WeakMap();
const responses=new WeakMap();
// Only explicit public list/detail responses use this cache. Every HTTP read
// must first acquire the current, permission-checked publication snapshot.
export function publicPageResponse(data,params) {
 let state=responses.get(data);
 if(!state)responses.set(data,state={revision:randomUUID(),pages:new Map(),bytes:0});
 const normalized=new URLSearchParams(params);normalized.sort();
 const key=normalized.toString();
 let entry=state.pages.get(key);
 if(entry){state.pages.delete(key);state.pages.set(key,entry);return entry;}
 const body=JSON.stringify(publicPage(data,params));
 const bytes=Buffer.byteLength(body);
 entry={body,etag:'"'+createHash('sha256').update(state.revision+':'+key).digest('hex')+'"'};
 if(bytes<=2*1024*1024) {
  state.pages.set(key,{...entry,bytes});state.bytes+=bytes;
  while(state.pages.size>64||state.bytes>2*1024*1024) {
   const oldest=state.pages.keys().next().value;state.bytes-=state.pages.get(oldest).bytes;state.pages.delete(oldest);
  }
 }
 return entry;
}
// The internal publication snapshot remains the sole source of media permissions.
// Public transport is bounded independently of that snapshot and never includes
// every article body in the homepage or a collection response.
const summary=({bodyHTML,attachments,...item})=>item;
const metadata=items=>{
 const tags=[...new Set(items.flatMap(item=>item.tags||[]))];
 return {totalPublished:items.length,tagCount:tags.length,tags:tags.slice(0,100)};
};
export function publicBootstrap(data) {
 let bootstrap=bootstraps.get(data);
 if(!bootstrap) {
 bootstrap={
  source:data.source,delivery:'paged-v1',profile:data.profile,announcements:data.announcements,
  ...Object.fromEntries(kinds.map(kind=>[kind,[]])),
  collections:Object.fromEntries(kinds.map(kind=>[kind,metadata(data[kind]||[])])),
 };
 bootstraps.set(data,bootstrap);
 }
 // Identity/preview fields are attached by the HTTP layer per request.
 return {...bootstrap};
}
export function publicPage(data,params) {
 const view=params.get('view');
 if(view==='bootstrap') return publicBootstrap(data);
 const kind=params.get('kind');
 if(!kinds.includes(kind)||!['list','detail','book-part'].includes(view)) throw Object.assign(new Error('Invalid content query'),{status:400});
 const items=data[kind]||[];
 if(view==='book-part') {
  if(kind!=='resource-center')throw Object.assign(new Error('Invalid book query'),{status:400});
  const item=items.find(item=>item.id===params.get('id'));
  if(!item)throw Object.assign(new Error('Not found'),{status:404});
  if(item.locked)throw Object.assign(new Error('VIP membership required'),{status:403,code:'VIP_REQUIRED',item:summary(item)});
  return bookPart(item,Object.fromEntries(params));
 }
 if(view==='detail') {
  const item=items.find(item=>item.id===params.get('id'));
  if(!item) throw Object.assign(new Error('Not found'),{status:404});
  if(item.locked)throw Object.assign(new Error('VIP membership required'),{status:403,code:'VIP_REQUIRED',item:summary(item)});
  return {item:kind==='resource-center'?{...summary(item),book:bookManifest(item)}:item};
 }
 const category=(params.get('category')||'all').slice(0,200);
 const query=(params.get('q')||'').slice(0,200);
 const matched=filterItems(items,category,query);
 const pages=Math.max(1,Math.ceil(matched.length/12));
 const requested=Number(params.get('page'));
 const page=Math.min(pages,Math.max(1,Number.isFinite(requested)?Math.floor(requested):1));
 return {
  items:matched.slice((page-1)*12,page*12).map(summary),total:matched.length,page,pages,
  totalPublished:items.length,
  categories:[...new Set(items.map(item=>item.category).filter(Boolean))].slice(0,100),
  highlights:['works','resources'].includes(kind)?items.filter(item=>item.coverSrc).slice(0,3).map(summary):[],
 };
}
