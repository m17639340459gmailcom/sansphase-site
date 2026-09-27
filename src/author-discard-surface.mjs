// Let the warning share the editor's glass surface while excluding the form
// underneath it from painting. No content or scroll position is changed.
export function mountDiscardSurface(prompt, content) {
  const panel=prompt.closest('.author-panel'),win=prompt.ownerDocument.defaultView;
  let frame;
  const measure=()=>{
    const bottom=Math.max(0,content.getBoundingClientRect().bottom-prompt.getBoundingClientRect().top);
    content.style.clipPath=`inset(0px 0px ${Math.ceil(bottom)}px 0px)`;
  };
  const schedule=()=>{
    if(frame===undefined)frame=win.requestAnimationFrame(()=>{frame=undefined;measure();});
  };
  const observer=win.ResizeObserver?new win.ResizeObserver(measure):null;
  observer?.observe(prompt);observer?.observe(content);
  panel.addEventListener('scroll',schedule,{passive:true});
  measure();
  return ()=>{
    observer?.disconnect();panel.removeEventListener('scroll',schedule);
    if(frame!==undefined)win.cancelAnimationFrame(frame);
    content.style.removeProperty('clip-path');
  };
}
