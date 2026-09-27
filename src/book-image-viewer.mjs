// A modal viewer keeps the reader's page and DOM intact while inspecting an illustration.
export function createBookImageViewer(root,{english=false}={}) {
 const doc=root.ownerDocument,win=doc.defaultView,t=(zh,en)=>english?en:zh;
 let dialog,stage,picture,message,trigger,fit=1,zoom=1,drag=null,dragged=false;
 const button=(action,label)=>`<button type="button" data-image-action="${action}">${label}</button>`;
 function close(){if(!dialog)return;picture.onload=null;picture.onerror=null;drag=null;dragged=false;dialog.close();dialog.remove();dialog=null;trigger?.isConnected&&trigger.focus({preventScroll:true});}
 function measure(){
  if(!picture?.naturalWidth)return;
  const maxWidth=Math.min(win.innerWidth*.78,1000),maxHeight=Math.min(win.innerHeight*.76,760);
  fit=Math.min(1,(maxWidth-18)/picture.naturalWidth,(maxHeight-59)/picture.naturalHeight);
  const width=Math.max(Math.min(300,maxWidth),Math.ceil(picture.naturalWidth*fit)+18);
  dialog.classList.toggle('is-narrow',width<520);dialog.style.width=width+'px';
  const chrome=dialog.querySelector('header').getBoundingClientRect().height+18;
  fit=Math.min(1,(width-18)/picture.naturalWidth,(maxHeight-chrome)/picture.naturalHeight);
  dialog.style.height=Math.ceil(picture.naturalHeight*fit+chrome)+'px';resize(1);
 }
 function resize(value,point=null){
  if(!picture?.naturalWidth)return;
  const oldRect=picture.getBoundingClientRect();
  const relative=point?{x:Math.max(0,Math.min(1,(point.x-oldRect.left)/oldRect.width)),y:Math.max(0,Math.min(1,(point.y-oldRect.top)/oldRect.height))}:null;
  const oldWidth=picture.width||1,oldHeight=picture.height||1;
  const x=(stage.scrollLeft+stage.clientWidth/2)/Math.max(oldWidth,stage.clientWidth),y=(stage.scrollTop+stage.clientHeight/2)/Math.max(oldHeight,stage.clientHeight);
  zoom=Math.max(1,Math.min(Math.max(4,1/fit),value));
  picture.style.width=`${picture.naturalWidth*fit*zoom}px`;picture.style.height=`${picture.naturalHeight*fit*zoom}px`;
  stage.scrollLeft=x*Math.max(picture.width,stage.clientWidth)-stage.clientWidth/2;stage.scrollTop=y*Math.max(picture.height,stage.clientHeight)-stage.clientHeight/2;
  if(point){const rect=picture.getBoundingClientRect();stage.scrollLeft+=rect.left+relative.x*rect.width-point.x;stage.scrollTop+=rect.top+relative.y*rect.height-point.y;}
  dialog.querySelector('output').textContent=`${Math.round(fit*zoom*100)}%`;
  dialog.querySelector('[data-image-action="less"]').disabled=zoom<=1;
  dialog.querySelector('[data-image-action="more"]').disabled=zoom>=Math.max(4,1/fit);
  stage.classList.toggle('is-zoomed',zoom>1);
 }
 function open(image){
  close();trigger=image;dialog=doc.createElement('dialog');dialog.className='book-image-viewer';dialog.setAttribute('aria-label',t('查看大图','Image viewer'));
  dialog.innerHTML=`<header><span>${t('查看大图','Image viewer')}</span><nav aria-label="${t('图片缩放','Image zoom')}">${button('less','−')}<output aria-live="polite"></output>${button('more','＋')}${button('fit',t('适应窗口','Fit'))}${button('original','100%')}${button('close',t('关闭','Close')+' ×')}</nav></header><div class="book-image-canvas"><img draggable="false"></div><p class="book-image-message" role="status"></p>`;
  stage=dialog.querySelector('.book-image-canvas');picture=stage.querySelector('img');message=dialog.querySelector('.book-image-message');picture.alt=image.alt||t('正文插图','Illustration');
  dialog.querySelector('[data-image-action="less"]').setAttribute('aria-label',t('缩小','Zoom out'));dialog.querySelector('[data-image-action="more"]').setAttribute('aria-label',t('放大','Zoom in'));
  const source=image.dataset.bookOriginal||image.currentSrc||image.src;
  function load(){message.hidden=false;message.textContent=t('正在加载高清图片…','Loading full-resolution image…');picture.src=source;}
  picture.onload=()=>{if(!dialog)return;message.textContent=t('滚轮缩放，放大后可拖动图片。','Scroll to zoom; drag to pan.');message.hidden=true;stage.title=message.textContent;measure();};
  picture.onerror=()=>{if(dialog){message.hidden=false;message.innerHTML=t('图片暂时无法加载。','Image could not be loaded.')+' '+button('retry',t('重试','Retry'));}};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  // The site's Escape shortcut leaves the article. A modal must consume it first.
  dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}});
  stage.addEventListener('wheel',event=>{
   event.preventDefault();event.stopPropagation();if(!picture.naturalWidth||!event.deltaY)return;
   const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?stage.clientHeight:1);
   resize(zoom*Math.exp(-Math.max(-180,Math.min(180,pixels))*.0025),{x:event.clientX,y:event.clientY});
  },{passive:false});
  dialog.addEventListener('wheel',event=>{event.preventDefault();event.stopPropagation();},{passive:false});
  dialog.addEventListener('click',event=>{
   const action=event.target.closest('[data-image-action]')?.dataset.imageAction;
   if(action==='close'){close();return;}if(action==='more')resize(zoom*1.5);if(action==='less')resize(zoom/1.5);if(action==='fit')resize(1);if(action==='original')resize(1/fit);if(action==='retry')load();
   if(!action&&!dragged&&(event.target===dialog||event.target===stage))close();dragged=false;
  });
  stage.addEventListener('pointerdown',event=>{if(event.button!==0||event.target!==picture||zoom<=1)return;dragged=false;drag={x:event.clientX,y:event.clientY,left:stage.scrollLeft,top:stage.scrollTop};stage.setPointerCapture(event.pointerId);event.preventDefault();});
  stage.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)dragged=true;stage.scrollLeft=drag.left-dx;stage.scrollTop=drag.top-dy;});
  stage.addEventListener('pointerup',()=>{drag=null;});stage.addEventListener('pointercancel',()=>{drag=null;});
  doc.body.append(dialog);dialog.showModal();dialog.querySelector('[data-image-action="close"]').focus({preventScroll:true});load();
 }
 const onResize=()=>{if(dialog)measure();};win.addEventListener('resize',onResize);
 return {open,get active(){return Boolean(dialog?.open);},destroy(){close();win.removeEventListener('resize',onResize);}};
}
