import {contentQuery} from './content-reader.mjs';
import {parseRoute} from './core.mjs';

// Small public collection responses only. No bodies, downloads or author URLs.
export function mountNavigationPrefetch(doc:Document,reader:{prefetch:(query:URLSearchParams)=>Promise<unknown>},{enabled=()=>true,now=Date.now,delay=120}:{enabled?:()=>boolean;now?:()=>number;delay?:number}={}) {
 const win=doc.defaultView!;
 let timer:number|undefined,last=-Infinity,attempts:number[]=[];
 function stop(){win.clearTimeout(timer);}
 function intent(event:Event) {
  stop();
  if(!enabled()||doc.hidden)return;
  const connection=(win.navigator as Navigator & {connection?:{saveData?:boolean;effectiveType?:string}}).connection;
  if(connection?.saveData||['slow-2g','2g','3g'].includes(connection?.effectiveType || ''))return;
  const link=(event.target as Element|null)?.closest<HTMLAnchorElement>('#navigation a[href]');
  if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
  const url=new URL(link.href,doc.baseURI),current=new URL(doc.baseURI);
  if(url.origin!==current.origin||url.pathname!==current.pathname||url.hash===win.location.hash)return;
  const route=parseRoute(url.hash),query=!route.id&&contentQuery(route);
  if(!query)return;
  const start=()=>{
   if(!enabled()||doc.hidden)return;
   const time=now();attempts=attempts.filter(t=>time-t<60000);
   if(time-last<1500||attempts.length>=5)return;
   last=time;attempts.push(time);
   reader.prefetch(query).catch(()=>{});
  };
  timer=win.setTimeout(start,event.type==='pointerdown'?0:delay);
 }
 const events=['pointerover','focusin','pointerdown'];
 events.forEach(type=>doc.addEventListener(type,intent,{passive:true}));
 doc.addEventListener('pointerout',stop);doc.addEventListener('focusout',stop);
 win.addEventListener('hashchange',stop);
 return ()=>{stop();events.forEach(type=>doc.removeEventListener(type,intent));doc.removeEventListener('pointerout',stop);doc.removeEventListener('focusout',stop);win.removeEventListener('hashchange',stop);};
}
