import { ArrowLeft, ArrowRight, Download } from 'lucide';
import type { IconNode } from 'lucide';
import { escapeHTML as esc } from './core.mjs';
import { imageSources } from './image-sources.mjs';

export type ArticleItem = {
  id: string; title: string; summary?: string; category?: string; categoryEn?: string; en?: string;
  date?: string; tags?: string[]; coverSrc?: string | null; coverWidth?: number; coverHeight?: number;
  coverAlt?: string; coverAltEn?: string; bodyHTML?: string; sections?: Array<[string, string]>;
  attachments?: Array<{url: string; name: string}>;
};
type ArticleOptions = {siteName?: string; english?: boolean; preview?: boolean; isWork?: boolean; categoryLabel?: string};

// The same Lucide drawings and SVG attributes used by library-ui, rendered as
// markup here so an anonymous server document does not need a browser DOM.
export function glyph(nodes: IconNode, classes = ''): string {
  const shapes = nodes.map(([tag, attrs]) => `<${tag}${Object.entries(attrs).map(([key, value]) => ` ${key}="${esc(value)}"`).join('')}></${tag}>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="ui-icon ${classes}" aria-hidden="true" focusable="false">${shapes}</svg>`;
}
export const articleIcons = {left: glyph(ArrowLeft), download: glyph(Download), arrow: glyph(ArrowRight, 'arrow')};

export function renderArticlePage(item: ArticleItem, {siteName = '無相', english = false, preview = false, isWork = false, categoryLabel}: ArticleOptions = {}): string {
  const t = (zh: string, en: string) => english ? en : zh;
  const date = item.date ? new Intl.DateTimeFormat('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.date)).replaceAll('/', '.') : '';
  const body = typeof item.bodyHTML === 'string' ? item.bodyHTML : (item.sections || []).map(([title, text]) => `<h2>${esc(title)}</h2><p>${esc(text)}</p>`).join('');
  const {left, download, arrow} = articleIcons;
  const coverSrc = item.coverSrc?.startsWith('./assets/') ? item.coverSrc.slice(1) : item.coverSrc;
  return `<section class="page fade-in"><article class="article ${isWork ? '' : 'reading-article'}"><a class="back-link" href="/#/${isWork ? 'works' : 'notes'}">${left} ${t(isWork ? '返回作品集' : '返回博客', isWork ? 'Back to work' : 'Back to blog')}</a><div class="eyebrow">${isWork ? 'PROJECT ARCHIVE' : 'FIELD NOTES'} / ${esc(categoryLabel ?? item.category)}</div><h1>${esc(item.title)}</h1><div class="post-tags"><span>${esc(siteName)}</span>${item.date ? `<time datetime="${esc(item.date)}">${esc(date)}</time>` : ''}${(item.tags || []).map(tag => `<span class="article-meta-tag">${esc(tag)}</span>`).join('')}</div><p class="article-intro">${esc(item.summary)}</p>${coverSrc ? `<div class="cover-frame"><img class="article-cover" src="${esc(coverSrc)}" ${imageSources(coverSrc, '(max-width: 960px) 100vw, 960px', item.coverWidth)} width="${Number(item.coverWidth) || 960}" height="${Number(item.coverHeight) || 540}" decoding="async" alt="${esc(t(item.coverAlt || item.title, item.coverAltEn || item.en || item.title))}"></div>` : ''}<div class="article-body">${preview ? `<p class="article-preview-label" role="status">${t('作者预览 · 此预览仅登录作者可见', 'Author preview · Visible only to the signed-in author')}</p>` : ''}${body}${item.attachments?.length ? `<section class="article-attachments"><h2>${t('附件下载', 'Attachments')}</h2>${item.attachments.map(file => `<a class="text-link" href="${esc(file.url)}" download>${download}${esc(file.name)}</a>`).join('')}</section>` : ''}</div><div class="article-bottom"><a class="text-link article-more" href="/#/${isWork ? 'works' : 'notes'}">${t('浏览更多', 'Browse more')}${arrow}</a></div></article></section>`;
}
