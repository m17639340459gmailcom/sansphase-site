import {mountDirectoryReturn} from './article-directory-return.mjs';
import {mountReadingLayout} from './reading-layout.mjs';

let directoryId = 0;

// The five reading routes share this enhancement. Buttons intentionally leave
// the hash alone: the site uses that hash for its page router.
function mountDirectory(article, body, headings, english, sidebar) {
  const doc=article.ownerDocument,win=doc.defaultView;
  const contents=doc.createElement('details');
  contents.className='article-contents';contents.id=`article-contents-${++directoryId}`;
  const summary=doc.createElement('summary');summary.textContent=english?'On this page':'文章目录';
  const nav=doc.createElement('nav');nav.setAttribute('aria-label',summary.textContent);
  const list=doc.createElement('ol');nav.append(list);contents.append(summary,nav);body.before(contents);
  const listeners=[],tabIndexes=headings.map(h=>h.getAttribute('tabindex'));
  const buttons=[];
  headings.forEach(h=>{
    const li=doc.createElement('li'),button=doc.createElement('button');
    button.type='button';button.textContent=h.textContent.trim();
    if(h.tagName==='H3')button.className='article-contents-child';
    const jump=()=>{
      h.setAttribute('tabindex','-1');
      h.scrollIntoView({block:'start',behavior:win.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      h.focus({preventScroll:true});
    };
    button.addEventListener('click',jump);listeners.push(()=>button.removeEventListener('click',jump));
    li.append(button);list.append(li);buttons.push(button);
  });
  if(sidebar) {
    contents.classList.add('reading-directory-card');
    const narrow=win.matchMedia?.('(max-width: 900px)');
    const place=()=>{
      if(narrow?.matches){body.before(contents);contents.open=false;}
      else{sidebar.append(contents);contents.open=true;}
    };
    place();narrow?.addEventListener('change',place);
    listeners.push(()=>narrow?.removeEventListener('change',place));
    let frame=null,current=-1;
    const update=()=>{
      frame=null;
      const top=(doc.querySelector('#site-header')?.getBoundingClientRect().bottom||0)+40;
      let next=0;
      headings.forEach((h,i)=>{if(h.getBoundingClientRect().top<=top)next=i;});
      if(current===next)return;current=next;
      buttons.forEach((button,i)=>{if(i===next)button.setAttribute('aria-current','location');else button.removeAttribute('aria-current');});
      // Scroll only the directory's own viewport, never the page.
      if(contents.open){const item=buttons[next].getBoundingClientRect(),box=nav.getBoundingClientRect();
        if(item.top<box.top)nav.scrollTop+=item.top-box.top;
        else if(item.bottom>box.bottom)nav.scrollTop+=item.bottom-box.bottom;
      }
    };
    const queue=()=>{if(frame===null)frame=win.requestAnimationFrame(update);};
    win.addEventListener('scroll',queue,{passive:true});win.addEventListener('resize',queue);update();
    listeners.push(()=>{win.removeEventListener('scroll',queue);win.removeEventListener('resize',queue);if(frame!==null)win.cancelAnimationFrame(frame);});
  }
  const cleanReturn=mountDirectoryReturn(article,contents,summary,english);
  return ()=>{
    cleanReturn();listeners.forEach(fn=>fn());
    headings.forEach((h,i)=>{if(tabIndexes[i]===null)h.removeAttribute('tabindex');else h.setAttribute('tabindex',tabIndexes[i]);});
    contents.remove();
  };
}

function mountShare(article, {english,copy}) {
  const footer=article.querySelector('.article-bottom'),more=footer?.querySelector('.article-more');
  if(!more) return ()=>{};
  const doc=article.ownerDocument,win=doc.defaultView;
  const group=doc.createElement('div'); group.className='article-footer-links';
  const share=doc.createElement('div'); share.className='article-share';
  const button=doc.createElement('button'); button.type='button'; button.className='article-share-button';
  button.textContent=english?'Share':'分享';
  const feedback=doc.createElement('div'); feedback.className='article-share-feedback'; feedback.setAttribute('role','status');
  const separator=doc.createElement('span'); separator.className='article-share-separator'; separator.textContent='·'; separator.setAttribute('aria-hidden','true');
  share.append(button,feedback); more.before(group); group.append(share,separator,more);
  footer.classList.add('article-reading-footer');
  let disposed=false,timer,busy=false;
  const message=text=>{
    if(disposed) return;
    win.clearTimeout(timer); feedback.textContent=text;
    timer=win.setTimeout(()=>{feedback.replaceChildren();},4000);
  };
  const onShare=async()=>{
    if(busy) return;
    busy=true;
    const url=win.location.href,title=article.querySelector('h1')?.textContent || doc.title;
    try {
      if(typeof win.navigator.share==='function') {
        try {await win.navigator.share({title,url}); return;}
        catch(error) {if(error.name==='AbortError') return;}
      }
      if(disposed) return;
      await copy(url);
      message(english?'Link copied':'链接已复制');
    } catch {
      if(disposed) return;
      win.clearTimeout(timer); feedback.textContent=english?'Copy this link:':'请复制此链接：';
      const input=doc.createElement('input'); input.readOnly=true; input.value=url;
      input.setAttribute('aria-label',english?'Link to this content':'当前内容链接');
      feedback.append(input); input.focus(); input.select();
    } finally {busy=false;}
  };
  const dismiss=event=>{if(!share.contains(event.target)||event.key==='Escape'){feedback.replaceChildren();win.clearTimeout(timer);}};
  button.addEventListener('click',onShare); doc.addEventListener('click',dismiss); share.addEventListener('keydown',dismiss);
  return ()=>{
    disposed=true;win.clearTimeout(timer);
    button.removeEventListener('click',onShare);doc.removeEventListener('click',dismiss);share.removeEventListener('keydown',dismiss);
    group.replaceWith(more);footer.classList.remove('article-reading-footer');
  };
}

export function enhanceArticleReading(article, {english=false, sidebarHTML='', copy=text=>article.ownerDocument.defaultView.navigator.clipboard.writeText(text)}={}) {
  if (!article) return () => {};
  const body=article.querySelector('.article-body');
  if (!body) return () => {};
  const doc=article.ownerDocument;
  const headings=[...body.querySelectorAll('h2,h3')].filter(h=>h.textContent.trim());
  const cleanup=[];
  const layout=sidebarHTML?mountReadingLayout(article,sidebarHTML,english):null;
  if(layout)cleanup.push(()=>layout.dispose());
  cleanup.push(mountShare(article,{english,copy}));
  if (headings.length>(layout?0:1)) {
    cleanup.push(mountDirectory(article,body,headings,english,layout?.directory));
  }
  for(const pre of body.querySelectorAll('pre')) {
    const toolbar=doc.createElement('div'); toolbar.className='article-code-tools';
    const button=doc.createElement('button'); button.type='button'; button.textContent=english?'Copy code':'复制代码';
    const status=doc.createElement('span'); status.setAttribute('role','status');
    let active=true;
    const onCopy=async()=>{try{await copy(pre.querySelector('code')?.textContent ?? pre.textContent);if(active)status.textContent=english?'Copied':'已复制';}catch{if(active)status.textContent=english?'Select and copy the code manually.':'复制失败，请选中代码后手动复制。';}};
    button.addEventListener('click',onCopy); toolbar.append(button,status); pre.before(toolbar);
    cleanup.push(()=>{active=false;button.removeEventListener('click',onCopy);toolbar.remove();});
  }
  return ()=>cleanup.reverse().forEach(fn=>fn());
}
