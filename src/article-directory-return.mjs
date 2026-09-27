// The shared reading drawer stays collapsed until explicitly opened.
export function mountDirectoryReturn(article, contents, summary, english) {
  const doc=article.ownerDocument,win=doc.defaultView,header=doc.querySelector('#site-header');
  if(!header) return ()=>{};
  const drawer=doc.createElement('div');drawer.className='reading-drawer';
  const card=doc.createElement('div');card.className='reading-drawer-card';
  const trigger=doc.createElement('button');trigger.type='button';trigger.className='reading-drawer-toggle';
  const chevron=doc.createElement('span');chevron.className='reading-drawer-chevron';chevron.setAttribute('aria-hidden','true');trigger.append(chevron);
  const panel=doc.createElement('nav');panel.className='reading-drawer-panel';panel.id=`${contents.id}-drawer`;
  panel.setAttribute('aria-label',english?'Reading navigation':'阅读导航');trigger.setAttribute('aria-controls',panel.id);
  const clip=doc.createElement('div');clip.className='reading-drawer-clip';
  const links=doc.createElement('div');links.className='reading-drawer-links';
  const back=doc.createElement('button');back.type='button';back.dataset.readingJump='contents';back.textContent=english?'Back to contents':'回到目录';
  const bottom=doc.createElement('button');bottom.type='button';bottom.dataset.readingJump='bottom';bottom.textContent=english?'Go to bottom':'到达底部';
  const separator=doc.createElement('span');separator.textContent='·';separator.setAttribute('aria-hidden','true');
  links.append(back,separator,bottom);clip.append(links);panel.append(clip);card.append(panel,trigger);drawer.append(card);header.append(drawer);
  const bottomTarget=article.querySelector('.article-bottom')||article;
  const previousTabIndex=bottomTarget.getAttribute('tabindex');
  let shown=false,opened=false,disposed=false,frame=null,idleTimer=null,hovered=false,keyboardFocus=false;
  const schedule=win.requestAnimationFrame?.bind(win)||(fn=>win.setTimeout(fn,16));
  const cancel=win.cancelAnimationFrame?.bind(win)||win.clearTimeout.bind(win);
  drawer.setAttribute('aria-hidden','true');trigger.disabled=true;trigger.tabIndex=-1;
  const setOpen=value=>{
    opened=Boolean(value&&shown);drawer.classList.toggle('is-open',opened);
    trigger.setAttribute('aria-expanded',String(opened));
    trigger.setAttribute('aria-label',english?(opened?'Close reading navigation':'Open reading navigation'):(opened?'收起阅读导航':'展开阅读导航'));
    panel.setAttribute('aria-hidden',String(!opened));panel.inert=!opened;
    for(const button of [back,bottom]){button.disabled=!opened;button.tabIndex=opened?0:-1;}
  };
  setOpen(false);
  const clearIdle=()=>{if(idleTimer!==null){win.clearTimeout(idleTimer);idleTimer=null;}};
  const armIdle=()=>{
    clearIdle();
    if(shown&&!hovered&&!keyboardFocus&&!disposed)idleTimer=win.setTimeout(()=>{idleTimer=null;show(false);},1500);
  };
  const show=value=>{
    if(shown===value)return;
    shown=value;
    if(!value){clearIdle();setOpen(false);if(drawer.contains(doc.activeElement))doc.activeElement.blur();}
    drawer.classList.toggle('is-visible',value);drawer.setAttribute('aria-hidden',String(!value));
    trigger.disabled=!value;trigger.tabIndex=value?0:-1;
  };
  const readingPage=article.closest('.reading-page');
  const place=()=>{
    const value=`${header.getBoundingClientRect().height}px`;
    article.style.setProperty('--reading-header-offset',value);
    readingPage?.style.setProperty('--reading-header-offset',value);
  };
  const update=()=>{
    frame=null;if(disposed)return;
    const top=header.getBoundingClientRect().bottom;
    const passed=win.scrollY>0&&contents.getBoundingClientRect().bottom<=top;
    const reading=article.getBoundingClientRect().bottom>top+40;
    show(passed&&reading&&!header.querySelector('.nav.open'));
    armIdle();
  };
  const queue=()=>{if(frame===null&&!disposed)frame=schedule(update);};
  const resize=()=>{place();queue();};
  const motion=()=>win.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
  const toggle=()=>{setOpen(!opened);if(opened&&keyboardFocus)back.focus({preventScroll:true});armIdle();};
  const toContents=()=>{
    contents.open=true;summary.focus({preventScroll:true});setOpen(false);
    contents.scrollIntoView({block:'start',behavior:motion()});queue();
  };
  const toBottom=()=>{
    bottomTarget.setAttribute('tabindex','-1');bottomTarget.focus({preventScroll:true});setOpen(false);
    article.scrollIntoView({block:'end',behavior:motion()});queue();
  };
  const escape=event=>{if(event.key==='Escape'&&opened){event.preventDefault();trigger.focus({preventScroll:true});setOpen(false);}};
  const outside=event=>{if(!drawer.contains(event.target)){keyboardFocus=false;if(opened)setOpen(false);armIdle();}};
  const pointerEnter=event=>{if(event.pointerType!=='touch'){hovered=true;clearIdle();}};
  const pointerLeave=()=>{hovered=false;armIdle();};
  const focusIn=event=>{keyboardFocus=event.target.matches(':focus-visible');armIdle();};
  const focusOut=event=>{
    if(!event.relatedTarget||!drawer.contains(event.relatedTarget)){
      keyboardFocus=false;
      if(opened&&event.relatedTarget)setOpen(false);
      armIdle();
    }
  };
  trigger.addEventListener('click',toggle);back.addEventListener('click',toContents);bottom.addEventListener('click',toBottom);
  drawer.addEventListener('keydown',escape);drawer.addEventListener('focusin',focusIn);drawer.addEventListener('focusout',focusOut);
  drawer.addEventListener('pointerenter',pointerEnter);drawer.addEventListener('pointerleave',pointerLeave);doc.addEventListener('pointerdown',outside);
  win.addEventListener('scroll',queue,{passive:true});win.addEventListener('resize',resize);contents.addEventListener('toggle',queue);
  const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(resize):null;
  observer?.observe(header);observer?.observe(article);
  const menuObserver=typeof win.MutationObserver==='function'?new win.MutationObserver(queue):null;
  const nav=header.querySelector('.nav');if(nav)menuObserver?.observe(nav,{attributes:true,attributeFilter:['class']});
  place();update();
  return ()=>{
    disposed=true;clearIdle();if(frame!==null)cancel(frame);observer?.disconnect();menuObserver?.disconnect();
    win.removeEventListener('scroll',queue);win.removeEventListener('resize',resize);contents.removeEventListener('toggle',queue);
    trigger.removeEventListener('click',toggle);back.removeEventListener('click',toContents);bottom.removeEventListener('click',toBottom);
    drawer.removeEventListener('keydown',escape);drawer.removeEventListener('focusin',focusIn);drawer.removeEventListener('focusout',focusOut);
    drawer.removeEventListener('pointerenter',pointerEnter);drawer.removeEventListener('pointerleave',pointerLeave);doc.removeEventListener('pointerdown',outside);
    drawer.remove();article.style.removeProperty('--reading-header-offset');readingPage?.style.removeProperty('--reading-header-offset');
    if(previousTabIndex===null)bottomTarget.removeAttribute('tabindex');else bottomTarget.setAttribute('tabindex',previousTabIndex);
  };
}
