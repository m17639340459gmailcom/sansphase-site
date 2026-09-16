import Plyr from "plyr";
import { icons } from "./library-ui.jsx";
import { staticAssetUrl } from "./scene-delivery.mjs";
import { createMusicAutoplay } from './music-autoplay.mjs';

// Plyr controls playback. Platform share URLs deliberately never become audio sources.
export function mountMusicPlayer(host, tracks, {onState=()=>{},autoplay=false,autoplayReady=true,language='zh'}={}) {
  let index = 0;
  const t=(zh,en)=>language==='en'?en:zh;
  host.classList.add('vinyl-player');
  host.innerHTML = `<div class="music-turntable" aria-hidden="true"><div class="music-record"><div class="music-record-label"><span>無相</span><img hidden alt="" decoding="async"></div></div><svg class="music-tonearm" viewBox="0 0 70 90"><circle cx="10" cy="8" r="8" fill="#666a74" stroke="#242832" stroke-width="2"/><circle cx="10" cy="8" r="5" fill="#d4d6df"/><path d="M10 8 C11 35 12 48 23 57 L43 71" fill="none" stroke="#a5a9b5" stroke-width="5" stroke-linecap="round"/><path d="M10 8 C11 35 12 48 23 57 L43 71" fill="none" stroke="#f3f0ee" stroke-width="3" stroke-linecap="round"/><path d="m39 64 14 9 -5 8 -14 -9z" fill="#e6e4e6" stroke="#a6a4af"/><path d="m42 78 4 3" stroke="#e1dace" stroke-width="2"/></svg></div><p class="music-current" aria-live="polite"></p><div class="music-track-caption"><span data-music-state>待播放</span><span aria-hidden="true">·</span><span data-track-count></span></div><audio preload="none"></audio><p class="music-error" role="status"></p>`;
  const audio = host.querySelector("audio");
  const controls=()=>`<div class="plyr__controls vinyl-controls">
    <div class="music-seek-row"><div class="plyr__time plyr__time--current" aria-label="${t('已播放','Elapsed time')}">00:00</div><div class="plyr__progress"><input data-plyr="seek" type="range" min="0" max="100" step="0.01" value="0" aria-label="${t('播放进度','Seek')}"><progress class="plyr__progress__buffer" min="0" max="100" value="0"></progress></div><div class="plyr__time plyr__time--duration" aria-label="${t('总时长','Duration')}">00:00</div></div>
    <div class="music-transport"><button type="button" data-prev aria-label="${t('上一首','Previous track')}">${icons.previous}</button><button type="button" class="plyr__control" data-plyr="play" aria-label="${t('播放','Play')}"><span class="icon--pressed">${icons.pause}</span><span class="icon--not-pressed">${icons.play}</span></button><button type="button" data-next aria-label="${t('下一首','Next track')}">${icons.next}</button></div>
    <div class="music-volume-row"><button type="button" class="plyr__control" data-plyr="mute" aria-label="${t('静音','Mute')}"><span class="icon--pressed">${icons.muted}</span><span class="icon--not-pressed">${icons.volume}</span></button><div class="plyr__volume"><input data-plyr="volume" type="range" min="0" max="1" step="0.05" value="1" autocomplete="off" aria-label="${t('音量','Volume')}"></div><span class="music-position" data-track-position aria-hidden="true"></span></div>
  </div>`;
  const player = new Plyr(audio, {
    controls:controls(), volume:0.4, invertTime:false, toggleInvert:false,
    iconUrl: staticAssetUrl("/assets/plyr.svg"), loadSprite:false, autoplay: false, storage: { enabled: false },
    i18n: { play: "播放", pause: "暂停", mute: "静音", unmute: "取消静音", volume: "音量", seek: "播放进度", played: "已播放", currentTime: "当前时间" },
  });
  const status = host.querySelector(".music-error");
  let errorMessage=null,playbackLabel=['待播放','Ready'];
  const showError=(zh,en)=>{errorMessage=zh?[zh,en]:null;status.textContent=zh?t(zh,en):'';};
  const automatic=createMusicAutoplay({document:host.ownerDocument,play:()=>player.play(),onBlocked:()=>{showError('');onState(false);},onError:()=>{showError('暂时无法播放，请切换下一首或稍后重试。','Unable to play. Try the next track or try again later.');onState(false);}});
  host.querySelector('.music-track-caption').className='sr-only';
  host.querySelector('.music-current').classList.add('sr-only');
  const artwork=host.querySelector('.music-record-label img');
  artwork.addEventListener('error',()=>{artwork.hidden=true;});
  const setPlayback=(playing,label)=>{
    playbackLabel=label;
    host.classList.toggle('is-playing',playing);
    host.querySelector('[data-music-state]').textContent=t(...label);
    onState(playing);
  };
  const load = (step = 0, play = false) => {
    index = (index + step + tracks.length) % tracks.length;
    setPlayback(false,['待播放','Ready']);
    player.source = { type: "audio", title: tracks[index].title, sources: [{ src: tracks[index].url }] };
    // Plyr replaces the original audio element on every source change. Buffer
    // the active song during scene preparation; autoplay still waits for readiness.
    player.media.preload = 'auto';
    host.querySelector(".music-current").textContent = tracks[index].title;
    host.querySelector("[data-track-count]").textContent = `${index + 1} / ${tracks.length}`;
    host.querySelector('[data-track-position]').textContent=`${index+1}/${tracks.length}`;
    artwork.hidden=true;artwork.removeAttribute('src');
    if(tracks[index].coverUrl)try{
      const url=new URL(tracks[index].coverUrl,host.ownerDocument.baseURI);
      if(url.protocol==='https:'||(url.origin===location.origin&&url.protocol==='http:')){artwork.src=url.href;artwork.hidden=false;}
    }catch{}
    showError('');
    if (play) player.play()?.catch(() => showError('暂时无法播放，请检查音频来源或稍后重试。','Unable to play. Check the audio source or try again later.'));
  };
  // Plyr rebuilds custom controls when a source changes; delegate from the stable host.
  const transport=event=>{
    if(event.target.closest('[data-plyr="play"],[data-prev],[data-next]'))automatic.cancel();
    if(event.target.closest('[data-prev]'))load(-1,true);else if(event.target.closest('[data-next]'))load(1,true);
  };
  host.addEventListener('click',transport);
  player.on("ended", () => load(1, true));
  player.on("error", () => showError('此音频暂时无法播放，请切换下一首或稍后重试。','This track is unavailable. Try the next track or try again later.'));
  for(const [event,label] of Object.entries({playing:['播放中','Playing'],pause:['已暂停','Paused'],ended:['播放结束','Ended'],error:['播放失败','Playback failed'],waiting:['正在缓冲','Buffering']}))player.on(event,()=>setPlayback(event==='playing',label));
  let intersects=true;
  const visibility=()=>host.classList.toggle('is-offscreen',!intersects||host.ownerDocument.hidden);
  host.ownerDocument.addEventListener('visibilitychange',visibility);
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(([entry])=>{intersects=entry.isIntersecting;visibility();}):null;
  observer?.observe(host);visibility();
  const play=()=>player.play()?.catch(error=>{
    if(error?.name==='NotAllowedError')showError('请点击播放开始收听。','Press play to start listening.');
    else showError('暂时无法播放，请检查音频来源。','Unable to play. Check the audio source.');
    onState(false);
  });
  const setLanguage=next=>{
    language=next==='en'?'en':'zh';
    // Plyr reads this config again for play/mute events and source changes.
    Object.assign(player.config.i18n,{
      play:t('播放','Play'),pause:t('暂停','Pause'),mute:t('静音','Mute'),unmute:t('取消静音','Unmute'),
      volume:t('音量','Volume'),seek:t('播放进度','Seek'),played:t('已播放','Played'),currentTime:t('当前时间','Current time'),
      duration:t('总时长','Duration'),seekLabel:t('{currentTime} / {duration}','{currentTime} of {duration}')
    });
    player.config.controls=controls();
    const labels={'[data-prev]':t('上一首','Previous track'),'[data-next]':t('下一首','Next track'),
      '[data-plyr="play"]':player.paused?t('播放','Play'):t('暂停','Pause'),
      '[data-plyr="mute"]':player.muted?t('取消静音','Unmute'):t('静音','Mute'),
      '[data-plyr="volume"]':t('音量','Volume'),'[data-plyr="seek"]':t('播放进度','Seek'),
      '.plyr__time--current':t('已播放','Elapsed time'),'.plyr__time--duration':t('总时长','Duration')};
    for(const [selector,label]of Object.entries(labels))host.querySelector(selector)?.setAttribute('aria-label',label);
    host.querySelector('[data-music-state]').textContent=t(...playbackLabel);
    if(errorMessage)status.textContent=t(...errorMessage);
  };
  setLanguage(language);
  load();
  automatic.update({enabled:autoplay,ready:autoplayReady});
  const dispose=()=>{automatic.dispose();host.removeEventListener('click',transport);host.ownerDocument.removeEventListener('visibilitychange',visibility);observer?.disconnect();player.pause();player.destroy();host.classList.remove('is-playing');onState(false);};
  dispose.toggle=()=>{automatic.cancel();return player.paused?play():player.pause();};
  dispose.autoplay=options=>automatic.update(options);
  dispose.setLanguage=setLanguage;
  return dispose;
}

let sitePlayer,siteHost,playlistKey;
export function parkSiteMusic() {
  if(!siteHost) return;
  siteHost.hidden=true;
  if(document.body.moveBefore && siteHost.isConnected) document.body.moveBefore(siteHost,null);
  else document.body.append(siteHost);
}
export function mountSiteMusic(target,settings,onState,{autoplayReady=true,language='zh'}={}) {
  const tracks=settings?.tracks||[];
  const key=JSON.stringify(tracks);
  if(key!==playlistKey) {
    sitePlayer?.();siteHost?.remove();sitePlayer=undefined;siteHost=undefined;playlistKey=key;
    if(tracks.length) {
      siteHost=document.createElement('div');siteHost.className='site-music-player';siteHost.hidden=true;document.body.append(siteHost);
      sitePlayer=mountMusicPlayer(siteHost,tracks,{onState,autoplay:false,autoplayReady:false,language});
    }
  }
  if(siteHost && target) {
    if(target.moveBefore && siteHost.isConnected) target.moveBefore(siteHost,null);else target.append(siteHost);
    siteHost.hidden=false;
  } else parkSiteMusic();
  sitePlayer?.setLanguage(language);
  sitePlayer?.autoplay({enabled:settings?.autoplay===true,ready:autoplayReady});
}
export function toggleSiteMusic() { sitePlayer?.toggle(); }
export function prepareSiteMusicPlayback() { sitePlayer?.autoplay({enabled:true,ready:true}); }
