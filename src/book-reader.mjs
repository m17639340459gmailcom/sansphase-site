import {escapeHTML as esc} from './core.mjs';
import {createContentReader} from './content-reader.mjs';
import {createBookProgress} from './book-progress.mjs';
import {imageSourceSet} from './image-sources.mjs';
import {createBookImageViewer} from './book-image-viewer.mjs';
import {mountSectionReader} from './book-section-reader.mjs';

export function mountBookReader(root,item,{english=false}={}) {
 if(!root)return ()=>{};
 if(item.previewId||new URLSearchParams(root.ownerDocument.defaultView.location.search).get('reader')!=='pages')return mountSectionReader(root,item,{english});
 const t=(zh,en)=>english?en:zh;
 const win=root.ownerDocument.defaultView,doc=root.ownerDocument;
 const flow=root.querySelector('.book-flow'),viewport=root.querySelector('.book-viewport'),drawer=root.querySelector('.book-drawer');
 const heading=root.querySelector('.book-page-heading'),status=root.querySelector('.book-status');
 let storage;try{storage=win.localStorage;}catch{storage={getItem:()=>null,setItem:()=>{throw Error('Storage unavailable');}};}
 const saved=createBookProgress(storage,item.recordId||item.id);
 const imageViewer=createBookImageViewer(root,{english});
 const reader=createContentReader(win.fetch.bind(win),{maxEntries:6,maxBytes:256*1024});
 const chapters=item.book?.chapters||[];
 let mode='intro',part=null,page=0,pages=1,disposed=false,generation=0,resizeTimer,progressTimer,anchor=null,loading=false,retry=null;
 const say=message=>{status.textContent=message;};
 const query=values=>new URLSearchParams({view:'book-part',kind:'resource-center',id:item.id,...values});
 function controls(){
  root.querySelector('[data-book-action="previous"]').disabled=loading||(mode==='intro'&&page===0);
  root.querySelector('[data-book-action="next"]').disabled=loading||(!chapters.length)||(mode==='body'&&page===pages-1&&part.part===part.parts-1&&part.chapter===chapters.at(-1)?.id);
  root.querySelector('.book-pagination').textContent=loading?t('正在加载…','Loading…'):mode==='intro'?t('书籍介绍','About this book'):mode==='contents'?t('目录','Contents')+` · ${page+1} / ${pages}`:`${part.title} · ${t('本章进度','Chapter progress')} ${Math.round((part.part+(page+1)/pages)/part.parts*100)}%`;
 }
 function closeDrawer(){drawer.hidden=true;root.querySelectorAll('.book-tools button').forEach(b=>b.setAttribute('aria-expanded','false'));}
 function layout(){
  const width=viewport.clientWidth,height=viewport.clientHeight;
  flow.style.height=height+'px';flow.style.width=width+'px';flow.style.columnWidth=width+'px';flow.style.columnGap='48px';flow.style.transform='none';
  pages=Math.max(1,Math.ceil((flow.scrollWidth+48)/(width+48)));
  page=Math.min(page,pages-1);paint(false);
 }
 function firstAnchor(){
  if(mode!=='body'||!part)return null;
  const left=viewport.getBoundingClientRect().left;
  const walker=doc.createTreeWalker(flow,win.NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){
   if(!node.textContent.trim())continue;
   const block=node.parentElement.closest('[data-book-block]');if(!block)continue;
   const range=doc.createRange();let low=0,high=node.length;
   while(low<high){const mid=Math.floor((low+high)/2);range.setStart(node,mid);range.setEnd(node,Math.min(node.length,mid+1));const r=range.getBoundingClientRect();if(r.left<left-2)low=mid+1;else high=mid;}
   if(low>=node.length)continue;
   range.setStart(node,low);range.setEnd(node,low+1);const rect=range.getBoundingClientRect();
   if(rect.left<left-2||rect.left>=left+viewport.clientWidth)continue;
   const prefix=doc.createRange();prefix.selectNodeContents(block);prefix.setEnd(node,low);
   return {chapter:part.chapter,block:block.dataset.bookBlock,offset:Number(block.dataset.bookOffset)+prefix.toString().length,title:part.title,quote:node.textContent.slice(low,low+42),revision:part.revision,part:part.part};
  }
  const block=[...flow.querySelectorAll('[data-book-block]')].find(b=>{const r=b.getBoundingClientRect();return r.right>left&&r.left<left+viewport.clientWidth;});
  return block?{chapter:part.chapter,block:block.dataset.bookBlock,offset:Number(block.dataset.bookOffset),title:part.title,quote:t('插图','Illustration'),revision:part.revision,part:part.part}:null;
 }
 function savePosition(){clearTimeout(progressTimer);if(anchor)saved.save(anchor);if(!saved.available)say(t('浏览器不允许保存记录，本次进度无法保留。','Browser storage is unavailable; progress cannot be saved.'));}
 function paint(persist=true){
  flow.style.transform=`translateX(${-page*(viewport.clientWidth+48)}px)`;controls();
  if(mode==='body'){
   anchor=firstAnchor();
   if(persist){clearTimeout(progressTimer);progressTimer=setTimeout(savePosition,250);}
   // Images on distant pages have no src yet, preventing hidden columns from fetching all illustrations.
   const left=viewport.getBoundingClientRect().left;
   for(const img of flow.querySelectorAll('img[data-book-src]')){
    const rect=img.getBoundingClientRect();
    if(rect.right>=left&&rect.left<left+viewport.clientWidth*2+48){loadPreview(img);}
   }
   if(page>=pages-2&&!loading&&!win.navigator.connection?.saveData&&!/2g/.test(win.navigator.connection?.effectiveType||'')) {
    const next=part.part+1<part.parts?{chapter:part.chapter,part:String(part.part+1)}:chapters[chapters.findIndex(c=>c.id===part.chapter)+1];
    if(next)void reader.prefetch(query(next.chapter?next:{chapter:next.id,part:'0'})).catch(()=>{});
   }
  }
 }
 function positionTo(target){
  if(!target)return;
  const candidates=[...flow.querySelectorAll('[data-book-block]')].filter(n=>n.dataset.bookBlock===target.block);
  const block=candidates.find(n=>Number(n.dataset.bookOffset)<=target.offset&&Number(n.dataset.bookOffset)+n.textContent.length>target.offset)||candidates[0];
  if(!block)return;
  let remaining=Math.max(0,target.offset-Number(block.dataset.bookOffset));const walker=doc.createTreeWalker(block,win.NodeFilter.SHOW_TEXT);let node,rect;
  flow.style.transform='none';
  while(node=walker.nextNode()){if(remaining<node.length){const r=doc.createRange();r.setStart(node,remaining);r.setEnd(node,Math.min(node.length,remaining+1));rect=r.getBoundingClientRect();break;}remaining-=node.length;}
  rect ||=block.getBoundingClientRect();page=Math.max(0,Math.min(pages-1,Math.floor((rect.left-viewport.getBoundingClientRect().left+2)/(viewport.clientWidth+48))));paint();
 }
 function loadPreview(img){
  const source=img.dataset.bookSrc;if(!source)return;
  const sources=imageSourceSet(source,Number(img.getAttribute('width'))||0);
  if(sources){img.sizes=`${Math.ceil(img.getBoundingClientRect().width)||640}px`;img.srcset=sources;}
  img.src=source;delete img.dataset.bookSrc;img.loading='eager';img.decoding='async';
 }
 function install(html){
  const template=doc.createElement('template');template.innerHTML=html;
  for(const img of template.content.querySelectorAll('img')){
   img.dataset.bookSrc=img.getAttribute('src')||'';img.removeAttribute('src');img.removeAttribute('srcset');img.removeAttribute('loading');
   img.dataset.bookOriginal=img.dataset.bookSrc;
   if(/^\/api\/(?:author\/)?media\/[0-9a-f-]{36}(?:\?|$)/i.test(img.dataset.bookOriginal)){const url=new URL(img.dataset.bookOriginal,win.location.origin);url.searchParams.delete('w');url.searchParams.delete('presentation');img.dataset.bookOriginal=url.pathname+url.search;}
   if(mode==='body'){img.dataset.bookZoom='';img.tabIndex=0;img.setAttribute('role','button');img.setAttribute('aria-label',t('放大查看：','Enlarge: ')+(img.alt||t('正文插图','Illustration')));img.title=t('点击放大','Click to enlarge');}
   img.style.aspectRatio=`${Number(img.getAttribute('width'))||4} / ${Number(img.getAttribute('height'))||3}`;
   img.addEventListener('error',()=>{img.classList.add('book-image-failed');img.alt=t('插图暂时无法加载，可重新打开本页重试','Illustration unavailable; reopen this page to retry');});
  }
  flow.replaceChildren(template.content);
  page=0;layout();
 }
 function intro(){
  ++generation;reader.cancel();loading=false;mode='intro';closeDrawer();heading.textContent='SANSPHASE / '+t('内容介绍','INTRODUCTION');
  const overview=chapters.slice(0,3).map((chapter,index)=>`<button class="book-intro-chapter" data-book-chapter="${esc(chapter.id)}"><span>${String(index+1).padStart(2,'0')}</span><strong>${esc(chapter.title)}</strong><span aria-hidden="true">↗</span></button>`).join('');
  install(`<div class="book-intro"><div class="book-intro-hero"><div class="book-intro-copy"><div class="book-intro-meta"><span class="book-eyebrow">${esc(item.category||t('资源中心','Library'))}</span><span>${chapters.length} ${t('个章节','chapters')}</span></div><h1>${esc(item.title)}</h1><p>${esc(item.summary||t('从这里开始阅读。','Start reading here.'))}</p><div class="book-start"><button data-book-action="contents-page">${t('开始阅读','Start reading')} →</button>${saved.value.progress?`<button data-book-action="resume">${t('继续上次阅读','Continue reading')}</button>`:''}</div></div>${item.coverSrc?`<img class="book-cover" src="${esc(item.coverSrc)}" alt="${esc(item.title)}">`:''}</div>${chapters.length?`<section class="book-intro-overview"><header><h2>${t('章节概览','Chapter overview')}</h2><button data-book-action="contents-overview">${t('完整目录','All chapters')} →</button></header><div class="book-intro-chapters">${overview}</div></section>`:''}</div>`);
  // Intro illustration is visible immediately; it is not part of a chapter.
  const cover=flow.querySelector('img');if(cover?.dataset.bookSrc)loadPreview(cover);
  if((item.summary||'').length>280){flow.querySelector('.book-intro').classList.add('is-long');layout();}
  say(t('阅读进度与书签保存在此浏览器。','Progress and bookmarks are saved in this browser.'));
 }
 const contentsMarkup=()=>chapters.map((c,i)=>`<button class="book-chapter-link" data-book-chapter="${esc(c.id)}"><span>${String(i+1).padStart(2,'0')}</span><strong>${esc(c.title)}</strong><span>↗</span></button>`).join('');
 function contentsPage(){++generation;reader.cancel();loading=false;mode='contents';closeDrawer();heading.textContent=t('目 录','CONTENTS');install(`<div class="book-toc">${contentsMarkup()}</div>`);say('');}
 async function openChapter(chapterId,{part:partIndex=0,target,last=false}={}) {
  const turn=++generation;loading=true;retry=()=>openChapter(chapterId,{part:partIndex,target,last});closeDrawer();controls();root.setAttribute('aria-busy','true');say('');
  try{
   let chapter=chapters.find(c=>c.id===chapterId);let moved=false;
   if(!chapter){chapter=chapters[0];target=null;moved=true;}if(!chapter)throw Error('No chapters');
   const result=await reader.read(query({chapter:chapter.id,part:String(partIndex),...(target?{block:target.block,offset:String(target.offset)}:{})}));
   if(disposed||turn!==generation)return;
   mode='body';part=result;heading.textContent=result.title;loading=false;install(result.html||`<p>${t('这一章还没有正文。','This chapter is empty.')}</p>`);
   if(last)page=pages-1;
   if(target)positionTo(target);else paint();
   if(moved||result.relocated)say(t('原位置已被修改或删除，已定位到附近内容。','The saved passage changed or was removed. Showing nearby content.'));
   else if(target&&target.revision!==result.revision)say(t('这本书已更新，已按原段落恢复阅读。','This book was updated. Your passage has been restored.'));
   retry=null;
  }catch(error){if(disposed||turn!==generation)return;loading=false;status.innerHTML=`${t('本页加载失败，阅读位置已保留。','Could not load this page. Your position is preserved.')} <button data-book-action="retry">${t('重试','Retry')}</button>`;}
  finally{if(turn===generation&&!disposed){root.removeAttribute('aria-busy');controls();}}
 }
 function navigate(direction){
  if(loading)return;
  if(mode==='intro'){if(page+direction>=0&&page+direction<pages){page+=direction;paint();return;}if(direction>0)contentsPage();return;}
  if(mode==='contents'){
   if(page+direction>=0&&page+direction<pages){page+=direction;paint();return;}
   if(direction<0)intro();else if(chapters.length)void openChapter(chapters[0].id);return;
  }
  if(page+direction>=0&&page+direction<pages){page+=direction;paint();return;}
  if(part.part+direction>=0&&part.part+direction<part.parts){void openChapter(part.chapter,{part:part.part+direction,last:direction<0});return;}
  const index=chapters.findIndex(c=>c.id===part.chapter)+direction;
  if(index<0)contentsPage();else if(index<chapters.length)void openChapter(chapters[index].id,{part:direction<0?chapters[index].parts-1:0,last:direction<0});
 }
 function showDrawer(type){
  if(!drawer.hidden&&drawer.dataset.type===type){closeDrawer();return;}
  drawer.dataset.type=type;drawer.hidden=false;
  root.querySelectorAll('.book-tools button').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.bookAction===type)));
  const marks=saved.value.bookmarks;
  const rows=marks.map((b,i)=>`<div class="book-mark-row"><button data-book-mark="${i}"><strong>${esc(b.title)}</strong><small>${esc(b.quote||'')}</small></button><button data-book-remove="${i}" aria-label="${t('删除书签','Remove bookmark')}">×</button></div>`).join('');
  const empty=`<p>${t('还没有书签。阅读时可在这里收藏当前位置。','No bookmarks yet. Save a passage while reading.')}</p>`;
  const body=type==='contents'
   ? `<button data-book-action="intro">${t('书籍介绍','About this book')}</button>${contentsMarkup()}`
   : `<button data-book-action="bookmark" ${mode!=='body'||loading?'disabled':''}>${t('添加／取消当前页书签','Toggle bookmark for this page')}</button><p class="book-local-note">${t('保存在当前浏览器，清理浏览器数据会丢失。','Stored in this browser; clearing browser data removes bookmarks.')}</p>${marks.length?rows:empty}`;
  drawer.innerHTML=`<header><h2>${t(type==='marks'?'我的书签':'章节目录',type==='marks'?'Bookmarks':'Contents')}</h2><button data-book-action="close" aria-label="${t('关闭','Close')}">×</button></header>${body}`;
 }
 function click(event){const image=event.target.closest('img[data-book-zoom]');if(image){event.preventDefault();imageViewer.open(image);return;}const button=event.target.closest('button');if(!button)return;
  if(button.dataset.bookChapter){void openChapter(button.dataset.bookChapter);return;}
  if(button.hasAttribute('data-book-mark')){const target=saved.value.bookmarks[Number(button.dataset.bookMark)];if(target)void openChapter(target.chapter,{target});return;}
  if(button.hasAttribute('data-book-remove')){saved.remove(Number(button.dataset.bookRemove));drawer.hidden=true;showDrawer('marks');return;}
  switch(button.dataset.bookAction){
   case 'previous':navigate(-1);break;case 'next':navigate(1);break;
   case 'contents':showDrawer('contents');break;case 'marks':showDrawer('marks');break;
   case 'close':closeDrawer();break;case 'intro':intro();break;case 'contents-overview':case 'contents-page':contentsPage();break;
   case 'resume':{const target=saved.value.progress;if(target)void openChapter(target.chapter,{target});break;}
   case 'retry':retry?.();break;
   case 'bookmark':saved.toggle(firstAnchor());drawer.hidden=true;showDrawer('marks');if(!saved.available)say(t('无法保存书签，请检查浏览器存储设置。','Cannot save bookmarks. Check browser storage settings.'));break;
  }
 }
 function keydown(event){if(imageViewer.active||event.defaultPrevented)return;if(event.target.matches('img[data-book-zoom]')&&['Enter',' '].includes(event.key)){event.preventDefault();imageViewer.open(event.target);return;}if(event.target.closest('input,textarea,[contenteditable],.author-dialog')||doc.querySelector('.author-dialog[aria-hidden="false"]'))return;if(event.key==='Escape'){closeDrawer();return;}if(!drawer.hidden)return;if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();navigate(event.key==='ArrowRight'?1:-1);}}
 const resize=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(disposed)return;const target=anchor;layout();if(mode==='body')positionTo(target);},120);};
 const observer=new win.ResizeObserver(resize);observer.observe(viewport);
 root.addEventListener('click',click);doc.addEventListener('keydown',keydown);win.addEventListener('pagehide',savePosition);
 intro();doc.fonts?.ready.then(()=>{if(!disposed)resize();});
 return ()=>{savePosition();disposed=true;++generation;imageViewer.destroy();reader.clear();observer.disconnect();clearTimeout(resizeTimer);clearTimeout(progressTimer);root.removeEventListener('click',click);doc.removeEventListener('keydown',keydown);win.removeEventListener('pagehide',savePosition);};
}

