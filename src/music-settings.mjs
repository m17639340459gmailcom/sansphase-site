import {uiText} from './ui-language.mjs';
import {escapeHTML as esc} from './core.mjs';
export function readMusicTracks(host) {
  return [...host.querySelectorAll('[data-track-source]')].map(row=>({title:row.querySelector('input').value.trim(),url:row.dataset.trackSource}));
}
export function musicTracksMarkup(tracks,icons) {
  if(!tracks.length) return `<p class="author-description">${uiText("还没有添加歌曲。可以添加音频链接，或上传自己的音乐。", "No tracks yet. Add an audio link or upload your own music.")}</p>`;
  return tracks.map((track,index)=>`<div class="author-music-track" data-track-source="${esc(track.url)}"><label><span>${index+1} · ${track.url.startsWith('/api/media/')?uiText("上传的音乐", "Uploaded audio"):uiText("链接音源", "Linked audio")}</span><input aria-label="${uiText("歌曲名称 ", "Track name ")}${index+1}" value="${esc(track.title)}" maxlength="120" required></label><div class="author-music-order"><button type="button" data-move-track="-1" aria-label="${uiText("上移歌曲 ", "Move track up ")}${index+1}" title="${uiText("上移", "Move up")}" ${index===0?'disabled':''}>${icons['chevron-up']}</button><button type="button" data-move-track="1" aria-label="${uiText("下移歌曲 ", "Move track down ")}${index+1}" title="${uiText("下移", "Move down")}" ${index===tracks.length-1?'disabled':''}>${icons['chevron-down']}</button><button type="button" data-remove-track aria-label="${uiText("移除歌曲 ", "Remove track ")}${index+1}" title="${uiText("移除", "Remove")}">${icons.close}</button></div></div>`).join('');
}
