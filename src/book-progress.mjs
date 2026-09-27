const key='sansphase-book-reading-v1';
export function createBookProgress(storage,bookId) {
 let all={};let available=true;
 try{all=JSON.parse(storage.getItem(key)||'{}');if(!all||Array.isArray(all)||typeof all!=='object')all={};}catch{all={};}
 let state=all[bookId];
 if(!state||typeof state!=='object')state={};
 const valid=a=>a&&typeof a.chapter==='string'&&typeof a.block==='string'&&Number.isFinite(a.offset);
 state={progress:valid(state.progress)?state.progress:null,bookmarks:Array.isArray(state.bookmarks)?state.bookmarks.filter(valid).slice(0,100):[]};
 function write(){
  try{
   // Merge with other tabs before saving, and bound the local collection.
   const latest=JSON.parse(storage.getItem(key)||'{}');
   all=latest&&typeof latest==='object'&&!Array.isArray(latest)?latest:{};
   all[bookId]={...state,updatedAt:Date.now()};
   const entries=Object.entries(all).sort((a,b)=>(b[1]?.updatedAt||0)-(a[1]?.updatedAt||0)).slice(0,100);
   storage.setItem(key,JSON.stringify(Object.fromEntries(entries)));available=true;
  }catch{available=false;}
 }
 const same=(a,b)=>a.chapter===b.chapter&&a.block===b.block&&Math.abs(a.offset-b.offset)<4;
 return {
  get value(){return structuredClone(state);},get available(){return available;},
  save(anchor){if(valid(anchor)){state.progress={...anchor};write();}},
  toggle(anchor){if(!valid(anchor))return false;const index=state.bookmarks.findIndex(x=>same(x,anchor));if(index>=0)state.bookmarks.splice(index,1);else state.bookmarks.unshift({...anchor,createdAt:Date.now()});state.bookmarks=state.bookmarks.slice(0,100);write();return index<0;},
  remove(index){state.bookmarks.splice(index,1);write();},
 };
}
