import Plyr from "plyr";
import { icons } from "./library-ui.jsx";
import { staticAssetUrl } from "./scene-delivery.mjs";
import { createMusicAutoplay } from './music-autoplay.mjs';

// Plyr controls playback. Platform share URLs deliberately never become audio sources.
export function mountMusicPlayer(host, tracks, {onState=()=>{},autoplay=false,autoplayReady=true}={}) {
  let index = 0;
  host.classList.add('vinyl-player');
  host.innerHTML = `<div class="music-turntable" aria-hidden="true"><div class="music-record"><div class="music-record-label"><span>無相</span><img hidden alt="" decoding="async"></div></div><svg class="music-tonearm" viewBox="0 0 70 90"><circle cx="10" cy="8" r="8" fill="#666a74" stroke="#242832" stroke-width="2"/><circle cx="10" cy="8" r="5" fill="#d4d6df"/><path d="M10 8 C11 35 12 48 23 57 L43 71" fill="none" stroke="#a5a9b5" stroke-width="5" stroke-linecap="round"/><path d="M10 8 C11 35 12 48 23 57 L43 71" fill="none" stroke="#f3f0ee" stroke-width="3" stroke-linecap="round"/><path d="m39 64 14 9 -5 8 -14 -9z" fill="#e6e4e6" stroke="#a6a4af"/><path d="m42 78 4 3" stroke="#e1dace" stroke-width="2"/></svg></div><p class="music-current" aria-live="polite"></p><div class="music-track-caption"><span data-music-state>待播放</span><span aria-hidden="true">·</span><span data-track-count></span></div><audio preload="none"></audio><p class="music-error" role="status"></p>`;
  const audio = host.querySelector("audio");
  const controls=`<div class="plyr__controls vinyl-controls">
    <div class="music-seek-row"><div class="plyr__time plyr__time--current" aria-label="已播放">00:00</div><div class="plyr__progress"><input data-plyr="seek" type="range" min="0" max="100" step="0.01" value="0" aria-label="播放进度"><progress class="plyr__progress__buffer" min="0" max="100" value="0"></progress></div><div class="plyr__time plyr__time--duration" aria-label="总时长">00:00</div></div>
    <div class="music-transport"><button type="button" data-prev aria-label="上一首">${icons.previous}</button><button type="button" class="plyr__control" data-plyr="play" aria-label="播放"><span class="icon--pressed">${icons.pause}</span><span class="icon--not-pressed">${icons.play}</span></button><button type="button" data-next aria-label="下一首">${icons.next}</button></div>
    <div class="music-volume-row"><button type="button" class="plyr__control" data-plyr="mute" aria-label="静音"><span class="icon--pressed">${icons.muted}</span><span class="icon--not-pressed">${icons.volume}</span></button><div class="plyr__volume"><input data-plyr="volume" type="range" min="0" max="1" step="0.05" value="1" autocomplete="off" aria-label="音量"></div><span class="music-position" data-track-position aria-hidden="true"></span></div>
  </div>`;
  const player = new Plyr(audio, {
    controls, invertTime:false, toggleInvert:false,
    iconUrl: staticAssetUrl("/assets/plyr.svg"), loadSprite:false, autoplay: false, storage: { enabled: false },
    i18n: { play: "播放", pause: "暂停", mute: "静音", unmute: "取消静音", volume: "音量", seek: "播放进度", played: "已播放", currentTime: "当前时间" },
  });
  const status = host.querySelector(".music-error");
  const automatic=createMusicAutoplay({document:host.ownerDocument,play:()=>player.play(),onBlocked:()=>{status.textContent='';onState(false);},onError:()=>{status.textContent='暂时无法播放，请切换下一首或稍后重试。';onState(false);}});
  host.querySelector('.music-track-caption').className='sr-only';
  host.querySelector('.music-current').classList.add('sr-only');
  const artwork=host.querySelector('.music-record-label img');
  artwork.addEventListener('error',()=>{artwork.hidden=true;});
  const setPlayback=(playing,label)=>{
    host.classList.toggle('is-playing',playing);
    host.querySelector('[data-music-state]').textContent=label;
    onState(playing);
  };
  const load = (step = 0, play = false) => {
    index = (index + step + tracks.length) % tracks.length;
    setPlayback(false,'待播放');
    player.source = { type: "audio", title: tracks[index].title, sources: [{ src: tracks[index].url }] };
    host.querySelector(".music-current").textContent = tracks[index].title;
    host.querySelector("[data-track-count]").textContent = `${index + 1} / ${tracks.length}`;
    host.querySelector('[data-track-position]').textContent=`${index+1}/${tracks.length}`;
    artwork.hidden=true;artwork.removeAttribute('src');
    if(tracks[index].coverUrl)try{
      const url=new URL(tracks[index].coverUrl,host.ownerDocument.baseURI);
      if(url.protocol==='https:'||(url.origin===location.origin&&url.protocol==='http:')){artwork.src=url.href;artwork.hidden=false;}
    }catch{}
    status.textContent = "";
    if (play) player.play()?.catch(() => { status.textContent = "暂时无法播放，请检查音频来源或稍后重试。"; });
  };
  // Plyr rebuilds custom controls when a source changes; delegate from the stable host.
  const transport=event=>{
    if(event.target.closest('[data-plyr="play"],[data-prev],[data-next]'))automatic.cancel();
    if(event.target.closest('[data-prev]'))load(-1,true);else if(event.target.closest('[data-next]'))load(1,true);
  };
  host.addEventListener('click',transport);
  player.on("ended", () => load(1, true));
  player.on("error", () => { status.textContent = "此音频暂时无法播放，请切换下一首或稍后重试。"; });
  for(const [event,label] of Object.entries({playing:'播放中',pause:'已暂停',ended:'播放结束',error:'播放失败',waiting:'正在缓冲'}))player.on(event,()=>setPlayback(event==='playing',label));
  player.on('volumechange',()=>onState(!player.paused));
  let intersects=true;
  const visibility=()=>host.classList.toggle('is-offscreen',!intersects||host.ownerDocument.hidden);
  host.ownerDocument.addEventListener('visibilitychange',visibility);
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(([entry])=>{intersects=entry.isIntersecting;visibility();}):null;
  observer?.observe(host);visibility();
  const play=()=>player.play()?.catch(error=>{
    status.textContent=error?.name==='NotAllowedError'?'请点击播放开始收听。':'暂时无法播放，请检查音频来源。';onState(false);
  });
  load();
  automatic.update({enabled:autoplay,ready:autoplayReady});
  const dispose=()=>{automatic.dispose();host.removeEventListener('click',transport);host.ownerDocument.removeEventListener('visibilitychange',visibility);observer?.disconnect();player.pause();player.destroy();host.classList.remove('is-playing');onState(false);};
  dispose.toggle=()=>{automatic.cancel();return player.paused?play():player.pause();};
  dispose.volume=value=>{player.volume=Math.max(0,Math.min(1,Number(value)));player.muted=false;};
  dispose.mute=()=>{player.muted=!player.muted;};
  dispose.state=()=>({volume:player.volume,muted:player.muted,paused:player.paused});
  dispose.autoplay=options=>automatic.update(options);
  return dispose;
}

let sitePlayer,siteHost,playlistKey;
export function parkSiteMusic() {
  if(!siteHost) return;
  siteHost.hidden=true;
  if(document.body.moveBefore && siteHost.isConnected) document.body.moveBefore(siteHost,null);
  else document.body.append(siteHost);
}
export function mountSiteMusic(target,settings,onState,{autoplayReady=true}={}) {
  const tracks=settings?.tracks||[];
  const key=JSON.stringify(tracks);
  if(key!==playlistKey) {
    sitePlayer?.();siteHost?.remove();sitePlayer=undefined;siteHost=undefined;playlistKey=key;
    if(tracks.length) {
      siteHost=document.createElement('div');siteHost.className='site-music-player';siteHost.hidden=true;document.body.append(siteHost);
      sitePlayer=mountMusicPlayer(siteHost,tracks,{onState,autoplay:false,autoplayReady:false});
    }
  }
  if(siteHost && target) {
    if(target.moveBefore && siteHost.isConnected) target.moveBefore(siteHost,null);else target.append(siteHost);
    siteHost.hidden=false;
  } else parkSiteMusic();
  sitePlayer?.autoplay({enabled:settings?.autoplay===true,ready:autoplayReady});
}
export function toggleSiteMusic() { sitePlayer?.toggle(); }
export function setSiteMusicVolume(value) { sitePlayer?.volume(value); }
export function toggleSiteMusicMute() { sitePlayer?.mute(); }
export function siteMusicState() { return sitePlayer?.state(); }
export function prepareSiteMusicPlayback() { sitePlayer?.autoplay({enabled:true,ready:true}); }
