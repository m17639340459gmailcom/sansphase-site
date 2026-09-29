const label = (value:unknown, max = 120) => String(value ?? "").trim().slice(0, max);
import {cardAppearance, accentColors, defaultAccent} from "../src/glass-theme.mjs";
function httpsLink(value:unknown) {
  try { const url = new URL(String(value)); return url.protocol === "https:" ? url.href : ""; }
  catch { return ""; }
}
const localAudio = /^\/api\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function playableAudio(value:unknown) {
  if(typeof value==='string' && localAudio.test(value)) return value;
  const link=httpsLink(value);
  if(!link) return '';
  const host=new URL(link).hostname;
  // Platform landing/share pages are not audio resources.
  if(/(^|\.)(kugou\.com|music\.163\.com|y\.qq\.com)$/.test(host)) return '';
  return link;
}
type MusicInput = {autoplay?:unknown;title?:unknown;playlistUrl?:unknown;tracks?:unknown};
export function cleanMusic(value:MusicInput = {}) {
  return {
    autoplay: value?.autoplay !== false,
    title: label(value?.title) || "我的歌单",
    playlistUrl: httpsLink(value?.playlistUrl),
    tracks: (Array.isArray(value?.tracks) ? value.tracks : []).slice(0, 100)
      .map((track:Record<string,unknown>) => ({ title: label(track?.title) || "音乐", url: playableAudio(track?.url) }))
      .filter(track => track.url),
  };
}
export const accents = accentColors;
export function cleanAppearance(value:Record<string,unknown> = {}) {
  return { accent: typeof value?.accent==='string' && Object.hasOwn(accents, value.accent) ? value.accent : defaultAccent, ...cardAppearance(value) };
}
