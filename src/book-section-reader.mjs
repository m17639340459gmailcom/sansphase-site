import {escapeHTML as esc} from './core.mjs';
import {createContentReader} from './content-reader.mjs';
import {createBookProgress} from './book-progress.mjs';
import {imageSourceSet} from './image-sources.mjs';
import {createBookImageViewer} from './book-image-viewer.mjs';
import {createSectionPositionTracker} from './section-reading-position.mjs';

export function mountSectionReader(root,item,{english=false}={}) {
 const doc=root.ownerDocument,win=doc.defaultView,t=(zh,en)=>english?en:zh,chapters=item.book?.chapters||[];
 let storage;try{storage=win.localStorage;}catch{storage={getItem:()=>null,setItem:()=>{throw Error('Storage unavailable');}};}
 const saved=createBookProgress(storage,(item.previewId?'preview:':'')+(item.recordId||item.id)),reader=createContentReader(win.fetch.bind(win),{maxEntries:6,maxBytes:256*1024,allowBookPreview:Boolean(item.previewId)});
 const viewer=createBookImageViewer(root,{english});
 let current=null,lastPart=null,firstPart=0,generation=0,disposed=false,busy=false,failed=false,timer,anchor=saved.value.progress,retry=null,focusBeforeDrawer;
 const collapsedChapters=new Set();
 const query=values=>new URLSearchParams({view:'book-part',kind:'resource-center',id:item.id,...(item.previewId?{preview:item.previewId,previewKind:'resource-center'}:{}),...values});
 root.classList.add('section-reader');root.setAttribute('aria-label',t('教程阅读','Tutorial reader'));
 root.innerHTML=`<div class="section-layout"><aside class="section-sidebar"><a class="section-back" href="#/resource-center">← ${t('资源中心','Library')}</a><p class="section-sidebar-label">${t('当前教程','CURRENT GUIDE')}</p><h2>${esc(item.title)}</h2><nav aria-label="${t('章节目录','Chapters')}"><button data-section-intro>${t('介绍与目录','Overview')}</button>${chapters.map((c,i)=>`<div class="section-nav-group"><button data-section-chapter="${esc(c.id)}" aria-expanded="false" aria-controls="section-children-${i}"><span>${String(i+1).padStart(2,'0')}</span><span>${esc(c.title)}</span><span class="section-chevron" aria-hidden="true">⌄</span></button><div id="section-children-${i}" data-section-headings="${esc(c.id)}" hidden></div></div>`).join('')}</nav><p class="section-sidebar-note">${chapters.length} ${t('个章节 · 按节阅读','chapters · Section reading')}</p></aside><div class="section-main"><header class="section-toolbar"><span data-section-breadcrumb></span><div><button data-section-action="marks" aria-expanded="false">${t('书签','Bookmarks')}</button></div></header><article class="section-paper"><div data-section-content></div><div class="section-load"><button data-section-action="more" hidden>${t('继续加载本节','Continue this section')}</button><p data-section-status role="status"></p></div><footer class="section-navigation" hidden></footer></article></div></div><aside class="section-marks" aria-label="${t('书签','Bookmarks')}" hidden></aside>`;
 const content=root.querySelector('[data-section-content]'),status=root.querySelector('[data-section-status]'),more=root.querySelector('[data-section-action="more"]'),navigation=root.querySelector('.section-navigation'),drawer=root.querySelector('.section-marks'),breadcrumb=root.querySelector('[data-section-breadcrumb]');
 const readingPosition=createSectionPositionTracker({content,sidebar:root.querySelector('.section-sidebar'),toolbar:root.querySelector('.section-toolbar'),getChapter:()=>current,getFirstPart:()=>firstPart,isPaused:()=>viewer.active});
 const imageObserver=new win.IntersectionObserver(entries=>{for(const {target,isIntersecting} of entries)if(isIntersecting){const source=target.dataset.sectionSrc;if(source){const sources=imageSourceSet(source,Number(target.getAttribute('width'))||0);if(sources){target.sizes=`${Math.ceil(target.getBoundingClientRect().width)||640}px`;target.srcset=sources;}target.src=source;target.decoding='async';delete target.dataset.sectionSrc;}imageObserver.unobserve(target);}},{rootMargin:'400px'});
 const moreObserver=new win.IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!more.hidden&&!busy&&!failed)void loadMore();},{rootMargin:'500px'});moreObserver.observe(more);
 function top(){win.scrollTo({top:0,behavior:'instant'});}
 function say(text){status.textContent=text;}
 function active(){root.querySelectorAll('[data-section-chapter]').forEach(b=>{if(b.dataset.sectionChapter===current?.id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});root.querySelector('[data-section-intro]').toggleAttribute('aria-current',!current);root.querySelectorAll('[data-section-headings]').forEach(n=>{if(n.dataset.sectionHeadings!==current?.id)n.replaceChildren();});syncDisclosure();}
 function syncDisclosure(){root.querySelectorAll('[data-section-headings]').forEach(group=>{const expanded=group.dataset.sectionHeadings===current?.id&&!collapsedChapters.has(group.dataset.sectionHeadings);group.hidden=!expanded;group.previousElementSibling.setAttribute('aria-expanded',String(expanded));});}
 function closeMarks(){drawer.hidden=true;root.querySelectorAll('.section-toolbar [aria-expanded]').forEach(button=>button.setAttribute('aria-expanded','false'));}
 function outsideMarks(event){
  if(drawer.hidden||drawer.contains(event.target)||root.querySelector('[data-section-action="marks"]').contains(event.target))return;
  closeMarks();
 }
 function persist(){if(anchor)saved.save(anchor);}
 function introduction(){
  clearTimeout(timer);persist();++generation;reader.cancel();imageObserver.disconnect();busy=false;failed=false;current=null;lastPart=null;retry=null;closeMarks();root.removeAttribute('aria-busy');active();top();navigation.hidden=true;more.hidden=true;more.disabled=false;
  breadcrumb.textContent=item.previewId?t('作者草稿预览 · 仅作者可见','Draft preview · Author only'):t('资源中心 / 内容介绍','Library / Overview');
  content.innerHTML=`<div class="section-introduction"><div class="section-intro-hero"><div><span class="section-category">${esc(item.category||t('教程','Guide'))}</span><h1>${esc(item.title)}</h1><p>${esc(item.summary||'')}</p><div class="section-intro-actions"><button data-section-action="start">${t('开始阅读','Start reading')} →</button>${saved.value.progress?`<button data-section-action="resume">${t('继续上次阅读','Continue reading')}</button>`:''}</div></div>${item.coverSrc?`<img class="section-cover" src="${esc(item.coverSrc)}" alt="${esc(item.title)}">`:''}</div><section class="section-full-directory"><header><h2>${t('内容目录','Contents')}</h2><span>${chapters.length} ${t('个章节','chapters')}</span></header><ol>${chapters.map((c,i)=>`<li><button data-section-chapter="${esc(c.id)}"><span class="section-number">${String(i+1).padStart(2,'0')}</span><span><strong>${esc(c.title)}</strong><small>${t('阅读本章','Read chapter')}</small></span><span aria-hidden="true">↗</span></button></li>`).join('')}</ol></section></div>`;
  const related=[];
  if(item.downloadUrl)related.push(`<a href="${esc(item.downloadUrl)}" download>${t('下载附件','Download')} · ${esc(item.file||t('附件','Attachment'))}</a>`);
  if(item.externalUrl)related.push(`<a href="${esc(item.externalUrl)}" target="_blank" rel="noopener noreferrer">${t('相关网站','Related website')} ↗</a>`);
  if(related.length)content.querySelector('.section-intro-hero').insertAdjacentHTML('afterend',`<div class="section-related">${related.join('')}</div>`);
  const cover=content.querySelector('.section-cover');if(cover){const source=cover.getAttribute('src');cover.removeAttribute('src');cover.dataset.sectionSrc=source;imageObserver.observe(cover);}
  say(t('阅读位置和书签保存在当前浏览器。','Reading position and bookmarks are saved in this browser.'));
  readingPosition.refresh();
 }
 function nav(){const i=chapters.findIndex(c=>c.id===current?.id);navigation.hidden=false;navigation.innerHTML=`<button ${i>0?`data-section-chapter="${esc(chapters[i-1].id)}"`:'data-section-intro'}><small>← ${i>0?t('上一节','Previous'):t('返回介绍','Overview')}</small><strong>${esc(i>0?chapters[i-1].title:item.title)}</strong></button>${i+1<chapters.length?`<button data-section-chapter="${esc(chapters[i+1].id)}"><small>${t('下一节','Next')} →</small><strong>${esc(chapters[i+1].title)}</strong></button>`:`<button data-section-intro><small>${t('已到最后一节','Last section')}</small><strong>${t('返回完整目录','Back to contents')}</strong></button>`}`;}
 function append(result){
  const template=doc.createElement('template');template.innerHTML=result.html||'<p></p>';
  for(const img of template.content.querySelectorAll('img')){
   const source=img.getAttribute('src')||'';img.removeAttribute('src');img.removeAttribute('srcset');img.dataset.sectionSrc=source;img.dataset.bookOriginal=source;img.dataset.sectionZoom='';img.tabIndex=0;img.setAttribute('role','button');img.setAttribute('aria-label',t('放大查看：','Enlarge: ')+(img.alt||t('插图','Illustration')));img.title=t('点击放大','Click to enlarge');
   if(/^\/api\/(?:author\/)?media\/[0-9a-f-]{36}(?:\?|$)/i.test(source)){const url=new URL(source,win.location.origin);url.searchParams.delete('w');img.dataset.bookOriginal=url.pathname+url.search;}
   img.style.aspectRatio=`${Number(img.getAttribute('width'))||4}/${Number(img.getAttribute('height'))||3}`;
  }
  const block=doc.createElement('div');block.className='section-fragment';block.dataset.part=result.part;block.dataset.revision=result.revision;block.innerHTML='';block.append(template.content);content.querySelector('.section-body').append(block);
  block.querySelectorAll('img').forEach(img=>imageObserver.observe(img));lastPart=result;more.hidden=result.part+1>=result.parts;
  more.textContent=t('继续加载本节','Continue this section');updateHeadings();nav();
 }
 function updateHeadings(){
  const group=[...root.querySelectorAll('[data-section-headings]')].find(n=>n.dataset.sectionHeadings===current?.id);if(!group)return;
  const headings=current.headings;
  if(headings){
   group.innerHTML=headings.map((h,i)=>`<button data-section-heading="${i}" class="${h.level>2?'is-subheading':''}">${esc(h.title)}</button>`).join('')||`<p class="section-empty-headings">${t('本章暂无小节标题','No subsections in this chapter')}</p>`;
  }else{
   group.innerHTML=[...content.querySelectorAll('.section-body h2,.section-body h3,.section-body h4')].map((h,i)=>{h.id=`section-heading-${i}`;return `<button data-section-anchor="${h.id}" class="${h.tagName!=='H2'?'is-subheading':''}">${esc(h.textContent)}</button>`;}).join('');
  }
  syncDisclosure();readingPosition.refresh();
 }
 function headingClick(event){
  const button=event.target.closest('[data-section-heading]');if(!button)return;
  const heading=current?.headings?.[Number(button.dataset.sectionHeading)];if(!heading)return;
  const block=[...content.querySelectorAll('[data-book-block]')].find(n=>n.dataset.bookBlock===heading.block&&Number(n.dataset.bookOffset)<=heading.offset&&Number(n.dataset.bookOffset)+n.textContent.length>heading.offset);
  if(block){position(heading);anchor=readAnchor();persist();}
  else void openChapter(current.id,heading);
 }
 function readAnchor(){
  if(!current||busy)return anchor;
  const ceiling=170;const blocks=[...content.querySelectorAll('[data-book-block]')];
  const block=blocks.find(n=>n.getBoundingClientRect().bottom>ceiling)||blocks.at(-1);if(!block)return anchor;
  const fragment=block.closest('.section-fragment');let offset=Number(block.dataset.bookOffset)||0,quote=block.textContent.slice(0,42);
  const walker=doc.createTreeWalker(block,win.NodeFilter.SHOW_TEXT);let node,preceding=0;
  while(node=walker.nextNode()) {if(!node.length)continue;const range=doc.createRange();range.selectNodeContents(node);if(range.getBoundingClientRect().bottom<=ceiling){preceding+=node.length;continue;}let lo=0,hi=node.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);range.setStart(node,mid);range.setEnd(node,Math.min(mid+1,node.length));if(range.getBoundingClientRect().bottom<=ceiling)lo=mid+1;else hi=mid;}offset+=preceding+lo;quote=node.textContent.slice(lo,lo+42);break;}
  return {chapter:current.id,block:block.dataset.bookBlock,offset,title:current.title,quote:quote||t('插图','Illustration'),part:Number(fragment.dataset.part),revision:fragment.dataset.revision};
 }
 function position(target){if(!target)return;const nodes=[...content.querySelectorAll('[data-book-block]')].filter(n=>n.dataset.bookBlock===target.block);const block=nodes.find(n=>Number(n.dataset.bookOffset)<=target.offset&&Number(n.dataset.bookOffset)+n.textContent.length>target.offset)||nodes[0];if(!block)return;let remaining=Math.max(0,target.offset-Number(block.dataset.bookOffset));const walker=doc.createTreeWalker(block,win.NodeFilter.SHOW_TEXT);let node,rect;while(node=walker.nextNode()){if(remaining<node.length){const range=doc.createRange();range.setStart(node,remaining);range.setEnd(node,remaining+1);rect=range.getBoundingClientRect();break;}remaining-=node.length;}rect ||=block.getBoundingClientRect();win.scrollTo({top:win.scrollY+rect.top-172,behavior:'instant'});}
 async function openChapter(id,target=null){
  clearTimeout(timer);persist();const turn=++generation;reader.cancel();busy=true;failed=false;more.disabled=false;retry=()=>openChapter(id,target);closeMarks();root.setAttribute('aria-busy','true');say(t('正在加载…','Loading…'));
  try{
   const chapter=chapters.find(c=>c.id===id)||chapters[0];if(!chapter)throw Error('Empty');
   const result=await reader.read(query({chapter:chapter.id,part:'0',...(target?{block:target.block,offset:String(target.offset)}:{})}));if(disposed||turn!==generation)return;
   imageObserver.disconnect();current=chapter;firstPart=result.part;active();breadcrumb.textContent=`${item.previewId?t('作者草稿预览 · ','Draft preview · '):''}${item.title} / ${chapter.title}`;
   content.innerHTML=`${firstPart>0?`<button class="section-earlier" data-section-chapter="${esc(chapter.id)}">↑ ${t('返回本节开头','Read from section start')}</button>`:''}<header class="section-article-heading"><span class="section-category">${esc(item.category||t('教程','Guide'))} / ${String(chapters.indexOf(chapter)+1).padStart(2,'0')}</span><h1>${esc(chapter.title)}</h1></header><div class="section-body"></div>`;
   append(result);busy=false;retry=null;top();if(target)position(target);anchor=readAnchor();persist();say(result.relocated?t('原位置已有修改，已定位到附近内容。','The passage changed. Showing nearby content.'):t('阅读位置会自动保存。','Your reading position is saved automatically.'));
  }catch(e){if(disposed||turn!==generation)return;failed=true;status.innerHTML=`${t('加载失败。','Could not load content.')} <button data-section-action="retry">${t('重试','Retry')}</button>`;}
  finally{if(turn===generation&&!disposed){busy=false;root.removeAttribute('aria-busy');checkMore();}}
 }
 async function loadMore(){
  if(busy||!current||!lastPart||lastPart.part+1>=lastPart.parts)return;
  const turn=generation,next=lastPart.part+1;busy=true;failed=false;more.disabled=true;more.textContent=t('正在加载…','Loading…');
  try{const result=await reader.read(query({chapter:current.id,part:String(next)}));if(disposed||turn!==generation)return;if(result.revision!==lastPart.revision)throw Error('Revision changed');append(result);}
  catch(e){if(turn===generation&&!disposed){failed=true;more.textContent=t('加载未完成，点击重试','Loading failed. Retry');}}
  finally{if(turn===generation&&!disposed){busy=false;more.disabled=false;if(!failed)checkMore();}}
 }
 function checkMore(){if(!more.hidden&&!busy&&!failed&&more.getBoundingClientRect().top<win.innerHeight+500)void loadMore();}
 function marks(){if(!drawer.hidden&&drawer.dataset.panel==='marks'){closeMarks();return;}closeMarks();focusBeforeDrawer=doc.activeElement;drawer.dataset.panel='marks';drawer.setAttribute('aria-label',t('书签','Bookmarks'));drawer.hidden=false;root.querySelector('[data-section-action="marks"]').setAttribute('aria-expanded','true');const entries=saved.value.bookmarks;drawer.innerHTML=`<header><h2>${t('我的书签','Bookmarks')}</h2><button data-section-action="close-marks" aria-label="${t('关闭','Close')}">×</button></header><button data-section-action="save-mark" ${!current?'disabled':''}>${t('添加／取消当前位置书签','Toggle bookmark here')}</button><p>${t('保存在当前浏览器。','Saved in this browser.')}</p>${entries.map((m,i)=>`<div class="section-mark"><button data-section-mark="${i}"><strong>${esc(m.title)}</strong><small>${esc(m.quote||'')}</small></button><button data-section-remove="${i}" aria-label="${t('删除书签','Remove bookmark')}">×</button></div>`).join('')||`<p>${t('还没有书签。','No bookmarks yet.')}</p>`}`;drawer.querySelector('[data-section-action="close-marks"]').focus({preventScroll:true});}
 function click(event){const img=event.target.closest('img[data-section-zoom]');if(img){event.preventDefault();viewer.open(img);return;}const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-section-chapter')){const id=b.dataset.sectionChapter;if(id===current?.id&&b.closest('.section-sidebar')){if(collapsedChapters.has(id))collapsedChapters.delete(id);else collapsedChapters.add(id);syncDisclosure();return;}void openChapter(id);return;}if(b.hasAttribute('data-section-intro')){introduction();return;}if(b.dataset.sectionAnchor){doc.getElementById(b.dataset.sectionAnchor)?.scrollIntoView({block:'start',behavior:'smooth'});return;}if(b.hasAttribute('data-section-mark')){const target=saved.value.bookmarks[Number(b.dataset.sectionMark)];void openChapter(target.chapter,target);return;}if(b.hasAttribute('data-section-remove')){saved.remove(Number(b.dataset.sectionRemove));closeMarks();marks();return;}switch(b.dataset.sectionAction){case 'start':if(chapters[0])void openChapter(chapters[0].id);break;case 'resume':{const target=saved.value.progress;if(target)void openChapter(target.chapter,target);break;}case 'more':void loadMore();break;case 'retry':retry?.();break;case 'marks':marks();break;case 'close-marks':closeMarks();focusBeforeDrawer?.focus({preventScroll:true});break;case 'save-mark':saved.toggle(readAnchor());closeMarks();marks();if(!saved.available)say(t('浏览器无法保存书签。','Browser storage is unavailable.'));break;}}
 function scroll(){if(!current||busy||viewer.active)return;clearTimeout(timer);timer=setTimeout(()=>{anchor=readAnchor();persist();checkMore();},180);}
 function key(event){if(viewer.active)return;if(event.target.matches('img[data-section-zoom]')&&['Enter',' '].includes(event.key)){event.preventDefault();viewer.open(event.target);}if(event.key==='Escape'&&!drawer.hidden){event.preventDefault();event.stopPropagation();closeMarks();focusBeforeDrawer?.focus({preventScroll:true});}}
 root.addEventListener('click',click);root.addEventListener('click',headingClick);root.addEventListener('keydown',key);doc.addEventListener('click',outsideMarks,true);win.addEventListener('scroll',scroll,{passive:true});win.addEventListener('pagehide',persist);introduction();
 return ()=>{disposed=true;++generation;clearTimeout(timer);persist();readingPosition.destroy();viewer.destroy();reader.clear();imageObserver.disconnect();moreObserver.disconnect();root.removeEventListener('click',click);root.removeEventListener('click',headingClick);root.removeEventListener('keydown',key);doc.removeEventListener('click',outsideMarks,true);win.removeEventListener('scroll',scroll);win.removeEventListener('pagehide',persist);};
}
