// Follow the reading position without moving the page or changing directory disclosure.
export function createSectionPositionTracker({content,sidebar,toolbar,getChapter,getFirstPart,isPaused=()=>false}) {
 const doc=content.ownerDocument,win=doc.defaultView;
 let entries=[],buttons=[],chapterButton=null,currentButton=null,currentHidden=false,followPending=false,frame=0,disposed=false;
 function refresh(){
  const chapter=getChapter();
  for(const button of buttons)button.removeAttribute('aria-current');
  const group=[...sidebar.querySelectorAll('[data-section-headings]')].find(n=>n.dataset.sectionHeadings===chapter?.id);
  buttons=group?[...group.querySelectorAll('[data-section-heading],[data-section-anchor]')]:[];
  chapterButton=[...sidebar.querySelectorAll('[data-section-chapter]')].find(button=>button.dataset.sectionChapter===chapter?.id)||null;
  const byBlock=new Map();
  chapter?.headings?.forEach((h,index)=>{if(!byBlock.has(h.block))byBlock.set(h.block,[]);byBlock.get(h.block).push({...h,index});});
  entries=[...content.querySelectorAll('.section-body h2,.section-body h3,.section-body h4')].map((node,index)=>{
   if(!chapter?.headings)return {node,index};
   const block=node.closest('[data-book-block][data-book-offset]');if(!block)return null;
   const range=doc.createRange();range.selectNodeContents(block);range.setEndBefore(node);
   const offset=(Number(block.dataset.bookOffset)||0)+range.toString().length;
   const heading=byBlock.get(block.dataset.bookBlock)?.find(h=>h.offset===offset);
   return heading?{node,index:heading.index}:null;
  }).filter(Boolean);
  schedule();
 }
 function keepVisible(button){
  if(sidebar.clientHeight<=0||sidebar.scrollHeight<=sidebar.clientHeight)return;
  const box=sidebar.getBoundingClientRect(),item=button.getBoundingClientRect();
  const top=Math.max(0,doc.getElementById('site-header')?.getBoundingClientRect().bottom||0,box.top+sidebar.clientTop),bottom=Math.min(win.innerHeight,box.top+sidebar.clientTop+sidebar.clientHeight);
  if(bottom<=top||item.height<=0)return;
  // Use the nearest edge; an oversized title keeps its beginning visible.
  let delta=0;
  if(item.height>bottom-top){if(item.top<top||item.bottom>bottom)delta=item.top-top;}
  else if(item.top<top)delta=item.top-top;
  else if(item.bottom>bottom)delta=item.bottom-bottom;
  const next=Math.max(0,Math.min(sidebar.scrollHeight-sidebar.clientHeight,sidebar.scrollTop+delta));
  // Scroll this viewport directly so the reading page and keyboard focus stay put.
  if(next!==sidebar.scrollTop)sidebar.scrollTop=next;
 }
 function update(){
  if(disposed||isPaused())return;
  const chapter=getChapter();let selected=-1;
  if(chapter){
   // A bookmark may begin halfway through a subsection whose title is not loaded.
   chapter.headings?.forEach((h,index)=>{if(Number.isInteger(h.part)&&h.part<getFirstPart())selected=index;});
   const line=Math.max(170,toolbar.getBoundingClientRect().bottom+20);
   for(const entry of entries){if(entry.node.getBoundingClientRect().top<=line)selected=entry.index;else break;}
   // Only at the actual page end may a short final subsection win early.
   // Merely seeing the article bottom still leaves the previous subsection active.
   if(entries.length&&win.scrollY>0&&doc.documentElement.scrollHeight<=win.scrollY+win.innerHeight+1)selected=entries.at(-1).index;
  }
  buttons.forEach((button,index)=>{
   const active=Boolean(chapter)&&index===selected;
   if(active&&button.getAttribute('aria-current')!=='location')button.setAttribute('aria-current','location');
   else if(!active&&button.hasAttribute('aria-current'))button.removeAttribute('aria-current');
  });
  const button=chapter?(buttons[selected]||chapterButton):null,hidden=Boolean(button?.closest('[hidden]'));
  const follow=button!==currentButton||(currentHidden&&!hidden)||followPending;
  currentButton=button;currentHidden=hidden;followPending=false;
  if(follow&&button&&!hidden)keepVisible(button);
 }
 function schedule(){if(!disposed&&!frame)frame=win.requestAnimationFrame(()=>{frame=0;update();});}
 function resized(){followPending=true;schedule();}
 const resize=win.ResizeObserver?new win.ResizeObserver(schedule):null;resize?.observe(content);
 win.addEventListener('scroll',schedule,{passive:true});win.addEventListener('resize',resized);
 sidebar.addEventListener('click',schedule);
 content.addEventListener('load',schedule,true);
 return {refresh,update,schedule,destroy(){disposed=true;win.cancelAnimationFrame(frame);resize?.disconnect();win.removeEventListener('scroll',schedule);win.removeEventListener('resize',resized);sidebar.removeEventListener('click',schedule);content.removeEventListener('load',schedule,true);}};
}
