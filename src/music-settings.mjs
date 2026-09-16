import {escapeHTML as esc} from './core.mjs';
export function readMusicTracks(host) {
  return [...host.querySelectorAll('[data-track-source]')].map(row=>({title:row.querySelector('input').value.trim(),url:row.dataset.trackSource}));
}
export function musicTracksMarkup(tracks,icons) {
  if(!tracks.length) return '<p class="author-description">还没有添加歌曲。可以添加音频链接，或上传自己的音乐。</p>';
  return tracks.map((track,index)=>`<div class="author-music-track" data-track-source="${esc(track.url)}"><label><span>${index+1} · ${track.url.startsWith('/api/media/')?'上传的音乐':'链接音源'}</span><input aria-label="歌曲名称 ${index+1}" value="${esc(track.title)}" maxlength="120" required></label><div class="author-music-order"><button type="button" data-move-track="-1" aria-label="上移歌曲 ${index+1}" title="上移" ${index===0?'disabled':''}>${icons['chevron-up']}</button><button type="button" data-move-track="1" aria-label="下移歌曲 ${index+1}" title="下移" ${index===tracks.length-1?'disabled':''}>${icons['chevron-down']}</button><button type="button" data-remove-track aria-label="移除歌曲 ${index+1}" title="移除">${icons.close}</button></div></div>`).join('');
}
