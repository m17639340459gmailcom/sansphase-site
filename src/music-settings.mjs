import {escapeHTML as esc} from './core.mjs';
export function readMusicTracks(host) {
  return [...host.querySelectorAll('[data-track-source]')].map(row=>({title:row.querySelector('input').value.trim(),url:row.dataset.trackSource}));
}
export function musicTracksMarkup(tracks,removeIcon) {
  if(!tracks.length) return '<p class="author-description">还没有添加歌曲。可以添加音频链接，或上传自己的音乐。</p>';
  return tracks.map((track,index)=>`<div class="author-music-track" data-track-source="${esc(track.url)}"><label><span>${index+1} · ${track.url.startsWith('/api/media/')?'上传的音乐':'链接音源'}</span><input aria-label="歌曲名称 ${index+1}" value="${esc(track.title)}" maxlength="120" required></label><button type="button" data-remove-track aria-label="移除歌曲 ${index+1}">${removeIcon}</button></div>`).join('');
}
