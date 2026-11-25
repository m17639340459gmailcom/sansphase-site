import { blogPath } from './blog-route.mjs';
import { renderBlogAuthor, renderBlogMusic } from './blog-reading-sidebar.ts';
// Blog list presentation only. The app still owns routes, filters, content
// requests and live widgets; this module reads their current state at render.
import type { escapeHTML, filterItems as filterContent } from './core.ts';
import type { imageSources as responsiveImageSources } from './image-sources.ts';

type LocalizedCopy = string | {zh?: string; en?: string};
type BlogNote = {
  id: string; title: string; summary?: string; category?: string; date?: string;
  tags?: string[]; coverSrc?: string; coverWidth?: number; coverHeight?: number;
};
type BlogState = {
  notes: BlogNote[]; activeCategory: string; activeQuery: string; blogView: 'list' | 'grid';
  remotePage?: {page: number; pages: number} | null;
  siteContent?: {
    delivery?: string;
    profile?: {name: string; avatar?: string; signature?: LocalizedCopy; bio?: LocalizedCopy;
      socialLinks: {url: string; label?: string}[]; music?: {tracks?: unknown[]}} | null;
    collections?: {notes?: {tags?: string[]; totalPublished?: number; tagCount?: number; latest?: string}};
  } | null;
};
type BlogDependencies = {
  getState: () => BlogState; t: (zh: string,en: string) => string; icons: Record<string,string>;
  esc: typeof escapeHTML; filterItems: typeof filterContent; imageSources: typeof responsiveImageSources;
  tagTone: (tag: string) => string | number; socialIcon: (url: string,fallback: string) => string;
  socialPlatform: (url: string) => {name?: string} | null | undefined;
  categoryLabel: (category: string | undefined,notes: BlogNote[]) => string;
  noteDate: (note: BlogNote) => string; copy: (value: LocalizedCopy | undefined) => string;
  arrow: string; notice: {html: () => string}; weather: {html: () => string}; clock: {html: () => string};
};

export function createBlogPage({
  getState,t,icons,esc,filterItems,imageSources,tagTone,socialIcon,socialPlatform,
  categoryLabel,noteDate,copy,arrow,notice,weather,clock,
}: BlogDependencies) {
  function emptyState() {
    return `<div class="empty"><h2>${t('暂时没有找到','No matches yet')}</h2><p>${t('试试换一个关键词，或者查看全部内容。','Try another word, or return to all content.')}</p><button class="text-link" data-action="clear-search" style="margin-top:20px">${t('清除筛选','Clear filters')} ${icons.right}</button></div>`;
  }
  // All articles share one card layout, including the first filtered result.
  function results() {
    const {siteContent,notes,activeCategory,activeQuery,remotePage}=getState();
    const items=siteContent?.delivery==='paged-v1'?notes:filterItems(notes,activeCategory,activeQuery);
    const cards=items.length?items.map(n=>{
      const coverSizes='(max-width: 700px) 40vw, 400px';
      return `<a class="blog-card ${n.coverSrc?'has-cover':''}" href="${esc(blogPath(n.id))}"><div class="blog-card-copy"><div class="blog-card-meta">${n.date?`<time class="blog-date" datetime="${esc(n.date)}">${esc(noteDate(n))}</time>`:''}${n.category?`<span class="blog-card-category">${esc(categoryLabel(n.category,notes))}</span>`:''}</div><h2>${esc(n.title)}</h2><p>${esc(n.summary)}</p><div class="blog-card-bottom"><div class="blog-card-tags">${(n.tags||[]).map(tag=>`<span class="blog-card-tag">${esc(tag)}</span>`).join('')}</div>${arrow}</div></div>${n.coverSrc?`<div class="cover-frame"><img class="blog-post-cover" src="${esc(n.coverSrc)}" ${imageSources(n.coverSrc,coverSizes,n.coverWidth)} decoding="async" alt="${esc(n.title)}" width="${Number(n.coverWidth)||960}" height="${Number(n.coverHeight)||540}" loading="lazy"></div>`:''}</a>`;
    }).join(''):emptyState();
    return cards+(remotePage && remotePage.pages>1?`<nav class="catalog-pagination" aria-label="${t('内容分页','Pagination')}"><button type="button" data-catalog-page="${remotePage.page-1}" ${remotePage.page===1?'disabled':''}>${icons.left}${t('上一页','Previous')}</button><span>${remotePage.page} / ${remotePage.pages}</span><button type="button" data-catalog-page="${remotePage.page+1}" ${remotePage.page===remotePage.pages?'disabled':''}>${t('下一页','Next')}${icons.right}</button></nav>`:'');
  }
  function music() {
    return renderBlogMusic(getState(),{t,icons});
  }
  function tags() {
    const {siteContent,notes}=getState();
    const values=siteContent?.collections?.notes?.tags??[...new Set(notes.flatMap(note=>note.tags||[]))];
    return `<div class="blog-side-card blog-tags-card"><span class="eyebrow">${icons.tags}${t('标签','TAGS')}</span><div class="blog-tags">${values.map(tag=>`<button type="button" data-blog-tag="${esc(tag)}" class="tag" data-tone="${tagTone(tag)}">${esc(tag)}</button>`).join('')}</div></div>`;
  }
  function author() {
    return renderBlogAuthor(getState(),{t,icons,esc,imageSources,copy,socialIcon,socialPlatform});
  }
  // Published totals come from the bootstrap summary, so the masthead never
  // counts only the page that happens to be loaded.
  function stats() {
    const {siteContent,notes}=getState();
    const summary=siteContent?.collections?.notes;
    const total=summary?.totalPublished??notes.length;
    const tagCount=summary?.tagCount??new Set(notes.flatMap(note=>note.tags||[])).size;
    const latest=new Date(summary?.latest||'');
    const pad=(value: number)=>String(value).padStart(2,'0');
    const figures=[[pad(total),t('篇文章','articles')],[pad(tagCount),t('个标签','tags')]];
    if(!Number.isNaN(latest.getTime()))figures.push([`${pad(latest.getMonth()+1)}.${pad(latest.getDate())}`,t('最近更新','last update')]);
    return `<dl class="blog-stats">${figures.map(([value,label])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
  }
  function html() {
    const {blogView,activeQuery}=getState();
    const nextView=blogView==='list'?t('切换为网格','Switch to grid'):t('切换为列表','Switch to list');
    return `<section class="page catalog-page blog-page fade-in" data-section="notes"><header class="blog-masthead"><div class="blog-masthead-copy"><div class="eyebrow">FIELD NOTES</div><h1 id="blog-page-title">${t('博客','Blog')}</h1><p>${t('把学习、创作和建设过程，整理成可以回看的片段。','A considered record of learning, making, and building.')}</p></div>${stats()}</header><div class="blog-layout"><section class="blog-main" aria-labelledby="blog-page-title">${notice.html()}<section class="blog-article-area" aria-labelledby="blog-article-heading"><div class="blog-toolbar"><h2 id="blog-article-heading" class="sr-only">${t('博客文章','Blog articles')}</h2><div id="category-filter"></div><label class="search">${icons.search}<input type="search" id="content-search" placeholder="${t('搜索博客文章','Search notes')}" aria-label="${t('搜索博客文章','Search notes')}" value="${esc(activeQuery)}"></label><button class="blog-view-button blog-view-switch" data-action="blog-view" data-view="${blogView==='list'?'grid':'list'}" aria-label="${esc(nextView)}">${blogView==='list'?t('列表','List'):t('网格','Grid')} ${icons.grid}</button></div><div class="blog-results ${blogView==='grid'?'is-grid':''}" id="results">${results()}</div></section></section><aside class="blog-left" aria-label="${t('作者与博客辅助信息','Author and blog information')}">${author()}${music()}${tags()}</aside><aside class="blog-sidebar" aria-label="${t('辅助信息','Supporting information')}">${weather.html()}${clock.html()}</aside></div></section>`;
  }
  return {results,author,music,tags,stats,html};
}
