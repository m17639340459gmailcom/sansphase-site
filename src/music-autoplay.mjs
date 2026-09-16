// Readiness and browser activation are separate: never hold the scene loader for audio.
export function createMusicAutoplay({document:doc,play,onBlocked=()=>{},onError=()=>{}}) {
  let enabled=false,ready=false,started=false,cancelled=false,pending=false,blocked=false,disposed=false;
  const events=['pointerup','click','touchend','keydown'];
  function attempt() {
    if(disposed||!enabled||!ready||started||cancelled||pending||doc.hidden)return;
    pending=true;
    let result;
    try {result=play();} catch(error){result=Promise.reject(error);}
    Promise.resolve(result).then(()=>{started=true;blocked=false;},error=>{
      if(disposed||cancelled)return;
      blocked=error?.name==='NotAllowedError';
      if(blocked)onBlocked();else if(error?.name!=='AbortError')onError(error);
    }).finally(()=>{pending=false;});
  }
  function gesture(event) {
    if(!event.isTrusted||!blocked||event.target?.closest?.('.vinyl-player,.home-music-controls,[data-action^="site-music"]'))return;
    if(event.type==='keydown'&&(event.ctrlKey||event.metaKey||event.altKey||event.key==='Escape'))return;
    attempt();
  }
  const visibility=()=>{if(!doc.hidden&&!blocked)attempt();};
  events.forEach(event=>doc.addEventListener(event,gesture));
  doc.addEventListener('visibilitychange',visibility);
  return {
    update(options){enabled=options.enabled;ready=options.ready;if(!blocked)attempt();},
    cancel(){cancelled=true;blocked=false;},
    dispose(){disposed=true;events.forEach(event=>doc.removeEventListener(event,gesture));doc.removeEventListener('visibilitychange',visibility);},
  };
}
