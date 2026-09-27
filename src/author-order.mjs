// Sorting is staged in the existing author list; only its Save button persists it.
export function mountAuthorOrder(list,{onChange,isBusy=()=>false}) {
  let dragged=null;
  const rows=()=>[...list.querySelectorAll('[data-order-id]')];
  const ids=()=>rows().map(row=>row.dataset.orderId);
  const clearMarkers=()=>rows().forEach(row=>row.classList.remove('is-drop-before','is-drop-after'));
  const finish=()=>{clearMarkers();dragged?.classList.remove('is-dragging');dragged=null;};
  const start=event=>{
    const handle=event.target.closest('[data-order-handle]');
    if(!handle||isBusy()){event.preventDefault();return;}
    dragged=handle.closest('[data-order-id]');
    event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragged.dataset.orderId);
    event.dataTransfer.setDragImage?.(dragged,20,20);dragged.classList.add('is-dragging');
  };
  const target=event=>event.target.closest('[data-order-id]');
  const over=event=>{
    if(!dragged||isBusy())return;
    event.preventDefault();event.dataTransfer.dropEffect='move';clearMarkers();
    const row=target(event);if(!row||row===dragged)return;
    const bounds=row.getBoundingClientRect();row.classList.add(event.clientY<bounds.top+bounds.height/2?'is-drop-before':'is-drop-after');
    const scroller=list.closest('.author-panel'),box=scroller?.getBoundingClientRect();
    if(box){if(event.clientY>box.bottom-45)scroller.scrollTop+=14;else if(event.clientY<box.top+45)scroller.scrollTop-=14;}
  };
  const drop=event=>{
    if(!dragged||isBusy())return;
    event.preventDefault();const row=target(event),before=ids().join(',');
    if(row&&row!==dragged){const box=row.getBoundingClientRect();list.insertBefore(dragged,event.clientY<box.top+box.height/2?row:row.nextSibling);}
    finish();if(ids().join(',')!==before)onChange(ids());
  };
  const keyboard=event=>{
    if(!event.target.matches('[data-order-handle]')||isBusy())return;
    const steps={ArrowUp:-1,ArrowDown:1,Home:-Infinity,End:Infinity};if(!(event.key in steps))return;
    event.preventDefault();const all=rows(),row=event.target.closest('[data-order-id]'),from=all.indexOf(row);
    const to=Math.max(0,Math.min(all.length-1,from+steps[event.key]));if(to===from)return;
    list.insertBefore(row,to>from?all[to].nextSibling:all[to]);event.target.focus({preventScroll:true});
    row.scrollIntoView?.({block:'nearest'});onChange(ids());
  };
  const handlers={dragstart:start,dragover:over,drop,dragend:finish,keydown:keyboard};
  for(const [name,fn] of Object.entries(handlers))list.addEventListener(name,fn);
  return {ids,dispose(){finish();for(const [name,fn] of Object.entries(handlers))list.removeEventListener(name,fn);}};
}
