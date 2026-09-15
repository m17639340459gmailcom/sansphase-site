const label = (value, max = 120) => String(value ?? "").trim().slice(0, max);
import {cardAppearance, accentColors} from "../src/glass-theme.mjs";
function httpsLink(value) {
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; }
  catch { return ""; }
}
const localAudio = /^\/api\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function playableAudio(value) {
  if(localAudio.test(value||'')) return value;
  const link=httpsLink(value);
  if(!link) return '';
  const host=new URL(link).hostname;
  // Platform landing/share pages are not audio resources.
  if(/(^|\.)(kugou\.com|music\.163\.com|y\.qq\.com)$/.test(host)) return '';
  return link;
}
export function cleanMusic(value = {}) {
  return {
    autoplay: value?.autoplay !== false,
    title: label(value?.title) || "我的歌单",
    playlistUrl: httpsLink(value?.playlistUrl),
    tracks: (Array.isArray(value?.tracks) ? value.tracks : []).slice(0, 100)
      .map(track => ({ title: label(track.title) || "音乐", url: playableAudio(track.url) }))
      .filter(track => track.url),
  };
}
export const accents = accentColors;
export function cleanAppearance(value = {}) {
  return { accent: Object.hasOwn(accents, value?.accent) ? value.accent : "blue", ...cardAppearance(value) };
}
