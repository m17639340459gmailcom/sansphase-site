// Blog list presentation only. The app still owns routes, filters, content
// requests and live widgets; this module reads their current state at render.
export function createBlogPage({
  getState,t,icons,esc,filterItems,imageSources,tagTone,socialIcon,socialPlatform,
  categoryLabel,noteDate,copy,arrow,notice,weather,clock,
}) {
  function emptyState() {
    return `<div class="empty"><h2>${t('暂时没有找到','No matches yet')}</h2><p>${t('试试换一个关键词，或者查看全部内容。','Try another word, or return to all content.')}</p><button class="text-link" data-action="clear-search" style="margin-top:20px">${t('清除筛选','Clear filters')} ${icons.right}</button></div>`;
  }
  // The first entry of the first list page opens as a large cover story; the
  // rest read as a quiet index separated by hairlines.
  function results() {
    const {siteContent,notes,activeCategory,activeQuery,remotePage,blogView}=getState();
    const items=siteContent?.delivery==='paged-v1'?notes:filterItems(notes,activeCategory,activeQuery);
    const featureFirst=blogView!=='grid'&&(remotePage?.page??1)===1;
    const cards=items.length?items.map((n,index)=>{
      const featured=featureFirst&&index===0;
      const coverSizes=featured?'(max-width: 900px) 100vw, 880px':'(max-width: 700px) 40vw, 400px';
      return `<a class="blog-card ${n.coverSrc?'has-cover':''} ${featured?'is-featured':''}" href="#/note/${esc(n.id)}"><div class="blog-card-copy"><div class="blog-card-meta">${n.date?`<time class="blog-date" datetime="${esc(n.date)}">${esc(noteDate(n))}</time>`:''}${n.category?`<span class="blog-card-category">${esc(categoryLabel(n.category,notes))}</span>`:''}</div><h2>${esc(n.title)}</h2><p>${esc(n.summary)}</p><div class="blog-card-bottom"><div class="blog-card-tags">${(n.tags||[]).map(tag=>`<span class="blog-card-tag">${esc(tag)}</span>`).join('')}</div>${featured?`<span class="blog-card-more">${t('阅读全文','Read')}${arrow}</span>`:arrow}</div></div>${n.coverSrc?`<div class="cover-frame">${featured?`<span class="blog-card-badge">${t('最新','Latest')}</span>`:''}<img class="blog-post-cover" src="${esc(n.coverSrc)}" ${imageSources(n.coverSrc,coverSizes,n.coverWidth)} decoding="async" alt="${esc(n.title)}" width="${Number(n.coverWidth)||960}" height="${Number(n.coverHeight)||540}" loading="${featured?'eager':'lazy'}"></div>`:''}</a>`;
    }).join(''):emptyState();
    return cards+(remotePage?.pages>1?`<nav class="catalog-pagination" aria-label="${t('内容分页','Pagination')}"><button type="button" data-catalog-page="${remotePage.page-1}" ${remotePage.page===1?'disabled':''}>${icons.left}${t('上一页','Previous')}</button><span>${remotePage.page} / ${remotePage.pages}</span><button type="button" data-catalog-page="${remotePage.page+1}" ${remotePage.page===remotePage.pages?'disabled':''}>${t('下一页','Next')}${icons.right}</button></nav>`:'');
  }
  function music() {
    const tracks=getState().siteContent?.profile?.music?.tracks;
    return `<div class="blog-side-card blog-music-card"><span class="eyebrow">${icons.music}${t('音乐','MUSIC')}</span>${tracks?.length?`<div id="blog-audio-player" aria-label="${t('音乐播放器','Music player')}"></div>`:`<p class="subtle">${t('歌单待更新','Playlist coming soon')}</p>`}</div>`;
  }
  function tags() {
    const {siteContent,notes}=getState();
    const values=siteContent?.collections?.notes?.tags??[...new Set(notes.flatMap(note=>note.tags||[]))];
    return `<div class="blog-side-card blog-tags-card"><span class="eyebrow">${icons.tags}${t('标签','TAGS')}</span><div class="blog-tags">${values.map(tag=>`<button type="button" data-blog-tag="${esc(tag)}" class="tag" data-tone="${tagTone(tag)}">${esc(tag)}</button>`).join('')}</div></div>`;
  }
  function author() {
    const {siteContent,notes}=getState();
    const profile=siteContent?.profile;
    if(!profile)return `<div class="blog-identity"><span class="eyebrow">${icons.user}${t('内容作者','AUTHOR')}</span><div class="identity-mark" aria-hidden="true">無</div><h2>無相</h2><p>${t('AI · 创作 · 学习','AI · Making · Learning')}</p><div class="identity-line"></div><span class="subtle">${t('把想法做成可以被看见的作品。','Turning ideas into work that can be seen.')}</span><nav class="identity-links" aria-label="${t('站内入口','Site links')}"><a href="#/community" aria-label="${t('社区交流','Community')}">${icons.link}</a><a href="#/resource-center" aria-label="${t('资源中心','Resource center')}">${icons.document}</a><a href="#/contact" aria-label="${t('联系','Contact')}">${icons.right}</a></nav></div>`;
    const uniqueTags=[...new Set(notes.flatMap(note=>note.tags||[]))];
    return `<div class="blog-identity">${profile.avatar?`<img class="identity-avatar" src="${esc(profile.avatar)}" ${imageSources(profile.avatar,'136px')} decoding="async" alt="${esc(profile.name)}" width="136" height="136">`:'<div class="identity-mark" aria-hidden="true">無</div>'}<h2>${esc(profile.name)}</h2><p>${esc(copy(profile.signature))}</p><div class="identity-line"></div><span class="subtle identity-bio">${esc(copy(profile.bio))}</span><p class="identity-count">${siteContent?.collections?.notes?.totalPublished??notes.length} ${t('篇文章','articles')} · ${siteContent?.collections?.notes?.tagCount??uniqueTags.length} ${t('个标签','tags')}</p><nav class="identity-links" aria-label="${t('作者其他平台','Author links')}">${profile.socialLinks.map(link=>`<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(link.label||socialPlatform(link.url)?.name||t('个人主页','Profile'))}" title="${esc(link.label||socialPlatform(link.url)?.name||t('个人主页','Profile'))}">${socialIcon(link.url,icons.link)}<span class="sr-only">${esc(link.label||socialPlatform(link.url)?.name||t('个人主页','Profile'))}</span></a>`).join('')}</nav></div>`;
  }
  // Published totals come from the bootstrap summary, so the masthead never
  // counts only the page that happens to be loaded.
  function stats() {
    const {siteContent,notes}=getState();
    const summary=siteContent?.collections?.notes;
    const total=summary?.totalPublished??notes.length;
    const tagCount=summary?.tagCount??new Set(notes.flatMap(note=>note.tags||[])).size;
    const latest=new Date(summary?.latest||'');
    const pad=value=>String(value).padStart(2,'0');
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
