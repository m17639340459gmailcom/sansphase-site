import Plyr from "plyr";
import { icons } from "./library-ui.tsx";
import { staticAssetUrl } from "./scene-delivery.mjs";
import { createMusicAutoplay } from './music-autoplay.mjs';
import { musicPlayerShellHTML, musicPlayerControlsHTML } from './music-player-markup.ts';

// Plyr controls playback. Platform share URLs deliberately never become audio sources.
export function mountMusicPlayer(host, tracks, {onState=()=>{},autoplay=false,autoplayReady=true,preparePlayback=true,language='zh'}={}) {
  let index = 0;
  let sourceReady = false;
  const t=(zh,en)=>language==='en'?en:zh;
  host.classList.add('vinyl-player');
  host.removeAttribute('inert');host.removeAttribute('data-music-player-static');
  host.innerHTML = musicPlayerShellHTML({english:language==='en'});
  const audio = host.querySelector("audio");
  const controls=()=>musicPlayerControlsHTML({english:language==='en',icons});
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
  const load = (step = 0, play = false, force = false) => {
    index = (index + step + tracks.length) % tracks.length;
    setPlayback(false,['待播放','Ready']);
    if(preparePlayback || play || force || sourceReady) {
      player.source = { type: "audio", title: tracks[index].title, sources: [{ src: tracks[index].url }] };
      sourceReady = true;
    }
    // Plyr replaces the original audio element on every source change. Buffer
    // the active song during scene preparation; autoplay still waits for readiness.
    player.media.preload = preparePlayback || play ? 'auto' : 'none';
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
    if(event.target.closest('[data-plyr="play"]') && !sourceReady) load(0,false,true);
    if(event.target.closest('[data-prev]'))load(-1,true);else if(event.target.closest('[data-next]'))load(1,true);
  };
  host.addEventListener('click',transport,true);
  player.on("ended", () => load(1, true));
  player.on("error", () => showError('此音频暂时无法播放，请切换下一首或稍后重试。','This track is unavailable. Try the next track or try again later.'));
  for(const [event,label] of Object.entries({playing:['播放中','Playing'],pause:['已暂停','Paused'],ended:['播放结束','Ended'],error:['播放失败','Playback failed'],waiting:['正在缓冲','Buffering']}))player.on(event,()=>setPlayback(event==='playing',label));
  let intersects=true;
  const visibility=()=>host.classList.toggle('is-offscreen',!intersects||host.ownerDocument.hidden);
  host.ownerDocument.addEventListener('visibilitychange',visibility);
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(([entry])=>{intersects=entry.isIntersecting;visibility();}):null;
  observer?.observe(host);visibility();
  const play=()=>{if(!sourceReady)load(0,false,true);return player.play()?.catch(error=>{
    if(error?.name==='NotAllowedError')showError('请点击播放开始收听。','Press play to start listening.');
    else showError('暂时无法播放，请检查音频来源。','Unable to play. Check the audio source.');
    onState(false);
  });};
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
  const dispose=()=>{automatic.dispose();host.removeEventListener('click',transport,true);host.ownerDocument.removeEventListener('visibilitychange',visibility);observer?.disconnect();player.pause();player.destroy();host.classList.remove('is-playing');onState(false);};
  dispose.toggle=()=>{automatic.cancel();return player.paused?play():player.pause();};
  dispose.autoplay=options=>{
    if(options.enabled){preparePlayback=true;if(!sourceReady)load();player.media.preload='auto';}
    automatic.update(options);
  };
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
export function mountSiteMusic(target,settings,onState,{autoplayReady=true,preparePlayback=true,language='zh'}={}) {
  const tracks=settings?.tracks||[];
  const key=JSON.stringify(tracks);
  if(key!==playlistKey) {
    sitePlayer?.();siteHost?.remove();sitePlayer=undefined;siteHost=undefined;playlistKey=key;
    if(tracks.length) {
      siteHost=target?.querySelector(':scope > .site-music-player[data-music-player-static]')||document.createElement('div');siteHost.className='site-music-player';siteHost.hidden=true;document.body.append(siteHost);
      sitePlayer=mountMusicPlayer(siteHost,tracks,{onState,autoplay:false,autoplayReady:false,preparePlayback,language});
    }
  }
  // A persistent player can arrive from another page. Retire only the inert
  // server shell, retaining the live media element and its playback position.
  for(const placeholder of target?.querySelectorAll(':scope > [data-music-player-static]')||[])placeholder.remove();
  if(siteHost && target) {
    if(target.moveBefore && siteHost.isConnected) target.moveBefore(siteHost,null);else target.append(siteHost);
    siteHost.hidden=false;
  } else parkSiteMusic();
  sitePlayer?.setLanguage(language);
  sitePlayer?.autoplay({enabled:preparePlayback&&settings?.autoplay===true,ready:autoplayReady});
}
export function toggleSiteMusic() { sitePlayer?.toggle(); }
export function prepareSiteMusicPlayback() { sitePlayer?.autoplay({enabled:true,ready:true}); }
