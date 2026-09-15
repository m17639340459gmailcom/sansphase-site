import Plyr from "plyr";
import { icons } from "./library-ui.jsx";

// Plyr controls playback. Platform share URLs deliberately never become audio sources.
export function mountMusicPlayer(host, tracks, {onState=()=>{},autoplay=false}={}) {
  let index = 0;
  host.innerHTML = `<p class="music-current" aria-live="polite"></p><audio preload="none"></audio><div class="music-track-controls"><button type="button" data-prev aria-label="上一首">${icons.left}</button><span data-track-count></span><button type="button" data-next aria-label="下一首">${icons.right}</button></div><p class="music-error" role="status"></p>`;
  const audio = host.querySelector("audio");
  const player = new Plyr(audio, {
    controls: ["play", "progress", "current-time", "mute", "volume"],
    iconUrl: "/assets/plyr.svg", autoplay: false, storage: { enabled: false },
    i18n: { play: "播放", pause: "暂停", mute: "静音", unmute: "取消静音", volume: "音量", seek: "播放进度", played: "已播放", currentTime: "当前时间" },
  });
  const status = host.querySelector(".music-error");
  const load = (step = 0, play = false) => {
    index = (index + step + tracks.length) % tracks.length;
    player.source = { type: "audio", title: tracks[index].title, sources: [{ src: tracks[index].url }] };
    host.querySelector(".music-current").textContent = tracks[index].title;
    host.querySelector("[data-track-count]").textContent = `${index + 1} / ${tracks.length}`;
    status.textContent = "";
    if (play) player.play()?.catch(() => { status.textContent = "暂时无法播放，请检查音频来源或稍后重试。"; });
  };
  host.querySelector("[data-prev]").onclick = () => load(-1, true);
  host.querySelector("[data-next]").onclick = () => load(1, true);
  player.on("ended", () => load(1, true));
  player.on("error", () => { status.textContent = "此音频暂时无法播放，可前往原平台收听。"; });
  for(const event of ['playing','pause','ended','error','waiting']) player.on(event,()=>onState(event==='playing'));
  const play=()=>player.play()?.catch(error=>{
    status.textContent=error?.name==='NotAllowedError'?'请点击播放开始收听。':'暂时无法播放，请检查音频来源。';onState(false);
  });
  load();
  if(autoplay) play();
  const dispose=()=>{player.pause();player.destroy();onState(false);};
  dispose.toggle=()=>player.paused?play():player.pause();
  return dispose;
}

let sitePlayer,siteHost,playlistKey;
export function parkSiteMusic() {
  if(!siteHost) return;
  siteHost.hidden=true;
  if(document.body.moveBefore && siteHost.isConnected) document.body.moveBefore(siteHost,null);
  else document.body.append(siteHost);
}
export function mountSiteMusic(target,settings,onState) {
  const tracks=settings?.tracks||[];
  const key=JSON.stringify(tracks);
  if(key!==playlistKey) {
    sitePlayer?.();siteHost?.remove();sitePlayer=undefined;siteHost=undefined;playlistKey=key;
    if(tracks.length) {
      siteHost=document.createElement('div');siteHost.className='site-music-player';siteHost.hidden=true;document.body.append(siteHost);
      sitePlayer=mountMusicPlayer(siteHost,tracks,{onState,autoplay:settings.autoplay===true});
    }
  }
  if(siteHost && target) {
    if(target.moveBefore && siteHost.isConnected) target.moveBefore(siteHost,null);else target.append(siteHost);
    siteHost.hidden=false;
  } else parkSiteMusic();
}
export function toggleSiteMusic() { sitePlayer?.toggle(); }
