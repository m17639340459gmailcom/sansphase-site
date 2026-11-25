import { ArrowRight, FileText, Link, Music2, UserRound } from 'lucide';
import { glyph } from './article-page.ts';
import { escapeHTML } from './core.mjs';
import { imageSources } from './image-sources.mjs';
import { socialIcon, socialPlatform } from './blog-details.mjs';
import { siteCopy } from './site-copy.mjs';

type LocalizedCopy = string | { zh?: string; en?: string };
export type BlogSidebarState = {
  notes: readonly { tags?: readonly string[] }[];
  siteContent?: {
    profile?: { name: string; avatar?: string; signature?: LocalizedCopy; bio?: LocalizedCopy;
      socialLinks?: { url: string; label?: string }[]; music?: { tracks?: unknown[] } } | null;
    collections?: { notes?: { totalPublished?: number; tagCount?: number } };
  } | null;
};
type Options = {
  english?: boolean; t?: (zh: string, en: string) => string; icons?: Record<string, string>;
  esc?: typeof escapeHTML; imageSources?: typeof imageSources;
  copy?: (value: LocalizedCopy | undefined) => string;
  socialIcon?: (url: string, fallback: string) => string;
  socialPlatform?: (url: string) => { name?: string } | null | undefined;
};
const defaultIcons = { user: glyph(UserRound), music: glyph(Music2), link: glyph(Link), document: glyph(FileText), right: glyph(ArrowRight) };
function dependencies(options: Options) {
  const locale = options.english ? 'en' : 'zh';
  return {
    t: options.t || ((zh: string, en: string) => options.english ? en : zh),
    icons: options.icons || defaultIcons, esc: options.esc || escapeHTML,
    imageSources: options.imageSources || imageSources, socialIcon: options.socialIcon || socialIcon,
    socialPlatform: options.socialPlatform || socialPlatform,
    copy: options.copy || ((value: LocalizedCopy | undefined) => typeof value === 'string'
      ? siteCopy(value, locale) || '' : value?.[locale] || value?.zh || value?.en || ''),
  };
}

// The blog list, client reading rail and initial server article use these exact
// templates. Callers keep ownership of music/widget mounting and language state.
export function renderBlogMusic(state: BlogSidebarState, options: Options = {}): string {
  const { t, icons } = dependencies(options), tracks = state.siteContent?.profile?.music?.tracks;
  return `<div class="blog-side-card blog-music-card"><span class="eyebrow">${icons.music}${t('音乐','MUSIC')}</span>${tracks?.length?`<div id="blog-audio-player" aria-label="${t('音乐播放器','Music player')}"></div>`:`<p class="subtle">${t('歌单待更新','Playlist coming soon')}</p>`}</div>`;
}

export function renderBlogAuthor(state: BlogSidebarState, options: Options = {}): string {
  const { t, icons, esc, imageSources, copy, socialIcon, socialPlatform } = dependencies(options);
  const { siteContent, notes } = state, profile = siteContent?.profile;
  if(!profile)return `<div class="blog-identity"><span class="eyebrow">${icons.user}${t('内容作者','AUTHOR')}</span><div class="identity-mark" aria-hidden="true">無</div><h2>無相</h2><p>${t('AI · 创作 · 学习','AI · Making · Learning')}</p><div class="identity-line"></div><span class="subtle">${t('把想法做成可以被看见的作品。','Turning ideas into work that can be seen.')}</span><nav class="identity-links" aria-label="${t('站内入口','Site links')}"><a href="#/community" aria-label="${t('社区交流','Community')}">${icons.link}</a><a href="#/resource-center" aria-label="${t('资源中心','Resource center')}">${icons.document}</a><a href="#/contact" aria-label="${t('联系','Contact')}">${icons.right}</a></nav></div>`;
  const uniqueTags=[...new Set(notes.flatMap(note=>note.tags||[]))];
  return `<div class="blog-identity">${profile.avatar?`<img class="identity-avatar" src="${esc(profile.avatar)}" ${imageSources(profile.avatar,'136px')} decoding="async" alt="${esc(profile.name)}" width="136" height="136">`:'<div class="identity-mark" aria-hidden="true">無</div>'}<h2>${esc(profile.name)}</h2><p>${esc(copy(profile.signature))}</p><div class="identity-line"></div><span class="subtle identity-bio">${esc(copy(profile.bio))}</span><p class="identity-count">${siteContent?.collections?.notes?.totalPublished??notes.length} ${t('篇文章','articles')} · ${siteContent?.collections?.notes?.tagCount??uniqueTags.length} ${t('个标签','tags')}</p><nav class="identity-links" aria-label="${t('作者其他平台','Author links')}">${(profile.socialLinks || []).map(link=>`<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(link.label||socialPlatform(link.url)?.name||t('个人主页','Profile'))}" title="${esc(link.label||socialPlatform(link.url)?.name||t('个人主页','Profile'))}">${socialIcon(link.url,icons.link)}<span class="sr-only">${esc(link.label||socialPlatform(link.url)?.name||t('个人主页','Profile'))}</span></a>`).join('')}</nav></div>`;
}
