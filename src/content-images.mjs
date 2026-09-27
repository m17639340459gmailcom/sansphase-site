// Size responsive sources after the card layout is mounted, including the
// pixels hidden by object-fit:cover. Observe layout changes, not network state.
export function setContentHTML(root,html) {
  // Template contents are inert: do not start a large fallback request before
  // the mounted card has been measured and the right responsive size selected.
  const template=root.ownerDocument.createElement('template');
  template.innerHTML=html;
  for(const image of template.content.querySelectorAll('img[srcset]')) {
    image.dataset.contentSrc=image.getAttribute('src') || '';
    image.dataset.contentSrcset=image.getAttribute('srcset');
    image.removeAttribute('srcset');image.removeAttribute('src');
  }
  root.replaceChildren(template.content);
}

export function enhanceContentImages(root, {english=false}={}) {
  if (!root) return ()=>{};
  const win=root.ownerDocument.defaultView, cleanups=[];
  const images=[...root.querySelectorAll('img')];
  const size=image=>{
    if(!image.hasAttribute('srcset') && !image.dataset.contentSrcset) return;
    const box=image.getBoundingClientRect();
    if(!box.width) return;
    const ratio=Number(image.getAttribute('width')) / Number(image.getAttribute('height')) || 16/9;
    const width=win.getComputedStyle(image).objectFit==='cover' ? Math.max(box.width,box.height*ratio) : box.width;
    image.sizes=`${Math.ceil(width)}px`;
  };
  const observer=win.ResizeObserver ? new win.ResizeObserver(entries=>entries.forEach(e=>size(e.target))) : null;
  for(const image of images) {
    size(image);observer?.observe(image);
    if(image.dataset.contentSrcset) {
      image.setAttribute('srcset',image.dataset.contentSrcset);
      if(image.dataset.contentSrc) image.setAttribute('src',image.dataset.contentSrc);
      delete image.dataset.contentSrcset;delete image.dataset.contentSrc;
    }
    let retry;
    const loaded=()=>{retry?.remove();retry=null;};
    const failed=()=>{
      if(retry) return;
      retry=root.ownerDocument.createElement('button');retry.type='button';retry.className='content-image-retry';
      retry.textContent=english?'Image unavailable · Reload':'图片暂未加载 · 重新加载';
      retry.onclick=event=>{
        event.preventDefault();event.stopPropagation();
        const src=image.getAttribute('src'),sources=image.getAttribute('srcset');
        image.removeAttribute('srcset');image.removeAttribute('src');
        if(sources) image.setAttribute('srcset',sources);
        if(src) image.setAttribute('src',src);
      };
      (image.closest('a') || image).after(retry);
    };
    image.addEventListener('load',loaded);image.addEventListener('error',failed);
    if(image.complete && image.getAttribute('src') && !image.naturalWidth) failed();
    cleanups.push(()=>{image.removeEventListener('load',loaded);image.removeEventListener('error',failed);loaded();});
  }
  return ()=>{observer?.disconnect();cleanups.forEach(fn=>fn());};
}
