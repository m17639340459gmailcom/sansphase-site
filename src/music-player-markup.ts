import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide';
import { glyph } from './article-page.ts';

type MusicIcons = Record<'previous' | 'next' | 'play' | 'pause' | 'muted' | 'volume', string>;
type Options = { english?: boolean; icons?: MusicIcons };
const defaultIcons: MusicIcons = { previous: glyph(SkipBack), next: glyph(SkipForward), play: glyph(Play), pause: glyph(Pause), muted: glyph(VolumeX), volume: glyph(Volume2) };

// Playback stays with Plyr. These are the existing drawings and custom control
// rows, also used by the inert server shell to reserve their natural geometry.
export function musicPlayerShellHTML({ english = false }: Pick<Options, 'english'> = {}): string {
  const t = (zh: string, en: string) => english ? en : zh;
  return `<div class="music-turntable" aria-hidden="true"><div class="music-record"><div class="music-record-label"><span>無相</span><img hidden alt="" decoding="async"></div></div><svg class="music-tonearm" viewBox="0 0 70 90"><circle cx="10" cy="8" r="8" fill="#666a74" stroke="#242832" stroke-width="2"/><circle cx="10" cy="8" r="5" fill="#d4d6df"/><path d="M10 8 C11 35 12 48 23 57 L43 71" fill="none" stroke="#a5a9b5" stroke-width="5" stroke-linecap="round"/><path d="M10 8 C11 35 12 48 23 57 L43 71" fill="none" stroke="#f3f0ee" stroke-width="3" stroke-linecap="round"/><path d="m39 64 14 9 -5 8 -14 -9z" fill="#e6e4e6" stroke="#a6a4af"/><path d="m42 78 4 3" stroke="#e1dace" stroke-width="2"/></svg></div><p class="music-current" aria-live="polite"></p><div class="music-track-caption"><span data-music-state>${t('待播放','Ready')}</span><span aria-hidden="true">·</span><span data-track-count></span></div><audio preload="none"></audio><p class="music-error" role="status"></p>`;
}

export function musicPlayerControlsHTML({ english = false, icons = defaultIcons }: Options = {}): string {
  const t = (zh: string, en: string) => english ? en : zh;
  return `<div class="plyr__controls vinyl-controls">
    <div class="music-seek-row"><div class="plyr__time plyr__time--current" aria-label="${t('已播放','Elapsed time')}">00:00</div><div class="plyr__progress"><input data-plyr="seek" type="range" min="0" max="100" step="0.01" value="0" aria-label="${t('播放进度','Seek')}"><progress class="plyr__progress__buffer" min="0" max="100" value="0"></progress></div><div class="plyr__time plyr__time--duration" aria-label="${t('总时长','Duration')}">00:00</div></div>
    <div class="music-transport"><button type="button" data-prev aria-label="${t('上一首','Previous track')}">${icons.previous}</button><button type="button" class="plyr__control" data-plyr="play" aria-label="${t('播放','Play')}"><span class="icon--pressed">${icons.pause}</span><span class="icon--not-pressed">${icons.play}</span></button><button type="button" data-next aria-label="${t('下一首','Next track')}">${icons.next}</button></div>
    <div class="music-volume-row"><button type="button" class="plyr__control" data-plyr="mute" aria-label="${t('静音','Mute')}"><span class="icon--pressed">${icons.muted}</span><span class="icon--not-pressed">${icons.volume}</span></button><div class="plyr__volume"><input data-plyr="volume" type="range" min="0" max="1" step="0.05" value="1" autocomplete="off" aria-label="${t('音量','Volume')}"></div><span class="music-position" data-track-position aria-hidden="true"></span></div>
  </div>`;
}

/** Initial, non-interactive markup: no audio URL or fixed-height placeholder. */
export function musicPlayerStaticHTML({ english = false, icons = defaultIcons, trackCount = 1 }: Options & { trackCount?: number } = {}): string {
  const count = Number.isSafeInteger(trackCount) && trackCount > 0 ? trackCount : 1;
  const controls = musicPlayerControlsHTML({ english, icons })
    .replace('value="1" autocomplete="off"', 'value="0.4" autocomplete="off" style="--value: 40%;"')
    .replace('data-track-position aria-hidden="true"></span>', `data-track-position aria-hidden="true">1/${count}</span>`);
  const shell = musicPlayerShellHTML({ english })
    .replace('class="music-current"', 'class="music-current sr-only"')
    .replace('class="music-track-caption"', 'class="sr-only"')
    .replace('data-track-count></span>', `data-track-count>1 / ${count}</span>`)
    .replace('<audio preload="none"></audio>', `<div class="plyr plyr--full-ui plyr--audio plyr--html5 plyr--paused plyr--stopped">${controls}<audio preload="none"></audio></div>`);
  return `<div class="site-music-player vinyl-player" data-music-player-static inert>${shell}</div>`;
}
