export function enhanceArticleReading(article, {english=false, copy=text=>navigator.clipboard.writeText(text)}={}) {
  if (!article) return () => {};
  const body=article.querySelector('.article-body');
  if (!body) return () => {};
  const doc=article.ownerDocument;
  const headings=[...body.querySelectorAll('h2,h3')].filter(h=>h.textContent.trim());
  const cleanup=[];
  if (headings.length>1) {
    const contents=doc.createElement('details');
    contents.className='article-contents';
    const summary=doc.createElement('summary'); summary.textContent=english?'On this page':'文章目录';
    const nav=doc.createElement('nav'); nav.setAttribute('aria-label',summary.textContent);
    headings.forEach(h=>{
      const button=doc.createElement('button'); button.type='button'; button.textContent=h.textContent;
      if(h.tagName==='H3')button.className='article-contents-child';
      const jump=()=>{h.setAttribute('tabindex','-1');h.scrollIntoView({block:'start',behavior:'instant'});h.focus({preventScroll:true});};
      button.addEventListener('click',jump); cleanup.push(()=>button.removeEventListener('click',jump)); nav.append(button);
    });
    contents.append(summary,nav); body.before(contents); cleanup.push(()=>contents.remove());
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
  return ()=>cleanup.forEach(fn=>fn());
}
