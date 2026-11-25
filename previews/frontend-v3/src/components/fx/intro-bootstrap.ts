/** The opening plays once per tab session. */
export const INTRO_STORAGE_KEY = "tdx-intro-seen";
/** Reports the start and end of the curtain movement. */
export const INTRO_EVENT = "tdx:intro";
export const HOME_INTRO_READY_EVENT = "sansphase:home-ready";
export const INTRO_DEADLINE_MS = 8000;
export const INTRO_READY_HOLD_MS = 140;
export const INTRO_CURTAIN_FALLBACK_MS = 800;

/** Runs as the homepage shell is parsed, including when its content is still streaming. */
export function createIntroScript(homePath: string) {
  return String.raw`(function(){
    if(document.readyState!=="loading"||location.hash||
       (location.pathname.replace(/\/$/,"")||"/")!==${JSON.stringify(homePath)}) return;
    var overlay=document.currentScript?.previousElementSibling;
    if(!overlay?.hasAttribute("data-home-preloader")) return;
    var motion=matchMedia("(prefers-reduced-motion: reduce)");
    if(motion.matches) return;
    try{
      if(sessionStorage.getItem("${INTRO_STORAGE_KEY}")) return;
      sessionStorage.setItem("${INTRO_STORAGE_KEY}","1");
    }catch(e){return}

    var root=document.documentElement, progress=overlay.querySelector("progress");
    var count=overlay.querySelector(".fx-pre-count"), painted=false, ready=false, content=false;
    var timer=0, last=0;
    var observer=new MutationObserver(checkContent);
    var deadline=setTimeout(finish,${INTRO_DEADLINE_MS});

    function notify(){document.dispatchEvent(new Event("${INTRO_EVENT}"))}
    function finish(){
      var from=root.dataset.intro;
      root.dataset.intro="done";
      delete root.dataset.introReady;
      observer.disconnect();
      clearTimeout(deadline);
      clearTimeout(timer);
      document.removeEventListener("${HOME_INTRO_READY_EVENT}",checkContent);
      document.removeEventListener("keydown",blockFocus,true);
      overlay.removeEventListener("animationend",curtainEnded);
      motion.removeEventListener("change",motionChanged);
      window.removeEventListener("pagehide",finish);
      if(from!=="done") notify();
    }
    function blockFocus(event){
      if(event.key==="Tab") event.preventDefault();
    }
    function motionChanged(){if(motion.matches) finish()}
    function curtainEnded(event){if(event.animationName==="fx-pre-bottom") finish()}
    function open(){
      root.dataset.intro="opening";
      notify();
      timer=setTimeout(finish,${INTRO_CURTAIN_FALLBACK_MS});
    }
    function advance(){
      if(!painted||root.dataset.intro!=="play") return;
      var next=ready?100:content?70:30;
      if(next===last) return;
      last=progress.value=next;
      count.textContent=String(next).padStart(3,"0");
      if(!ready) return;
      clearTimeout(deadline);
      root.dataset.introReady="true";
      timer=setTimeout(open,${INTRO_READY_HOLD_MS});
    }
    function checkContent(){
      var marker=document.querySelector("[data-home-intro-content]");
      if(!marker) return;
      content=true;
      ready=marker.hasAttribute("data-home-intro-ready");
      observer.disconnect();
      advance();
    }
    if(!progress||!count){clearTimeout(deadline);return}
    document.addEventListener("${HOME_INTRO_READY_EVENT}",checkContent);
    document.addEventListener("keydown",blockFocus,true);
    overlay.addEventListener("animationend",curtainEnded);
    motion.addEventListener("change",motionChanged);
    window.addEventListener("pagehide",finish);
    root.dataset.intro="play";
    observer.observe(document.body,{subtree:true,childList:true});
    checkContent();
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      painted=true;
      advance();
    })});
  })();`;
}

