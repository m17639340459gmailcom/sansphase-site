import {visitorTimezone, validTimezone, locateVisitor, searchWeatherCities,watchVisitorLocation,localizeWeatherPlace} from './visitor-location.mjs';
import {imageSources, imageSourceSet} from './image-sources.mjs';
import {enhanceContentImages,setContentHTML} from './content-images.mjs';
import {siteCopy,createContentProjection} from './site-copy.mjs';
import {preparePageImages} from './home-preload.mjs';
import {mountNavigationPrefetch} from './navigation-prefetch.mjs';
import {createRouteTransitions} from './route-transition.mjs';
import {mountNavSlider} from './nav-slider.mjs';
import {DEPART_MS} from './journey.mjs';
import {createContentReader,contentQuery} from './content-reader.mjs';
import {readerGate,readerPage,mountReaderUI} from './reader-ui.mjs';
import {loadAdminReaders} from './admin-route.mjs';
import {publicRoute} from './access-policy.mjs';
import {bookShell} from './book-shell.mjs';
import {vipBookGate,mountVipBookPrompt} from './vip-book-prompt.mjs';
import {mountRouteAssets} from './route-assets.mjs';
import {ensureRouteStyle} from './route-styles.mjs';
import {communityView,communityRoute,inCommunityArea,communityHeaderHTML,communityAccountHTML,communityLandingHTML} from './community.mjs';
import {createCommunityUI} from './community-ui.mjs';
import {mountCommunitySky} from './community-sky.mjs';
mountRouteAssets(window);
import {
  escapeHTML as esc,
  parseRoute,
  filterItems,
} from "./core.mjs";
import {siteSections} from "./data.mjs";
import { catalogPage as collectionPage, catalogResults, catalogDetail, catalogViewPresentation } from './catalog.mjs';
import {
  icons,
  socialIcon, socialPlatform, tagTone, applyCardAppearance,
  enhanceArticleReading,
  arrow,
  mountFilters,
  mountGlassSurface,
  mountMobileBlogOrder,
  createBlogNotice,
  createBlogClock,
  createBlogWeather,
  createBlogPage,
  mountTimezoneSelect,
  mountToaster,
  toast,
} from "./ui.bundle.mjs";
// The server embeds the published snapshot before this module runs: no late
// replacement of card contents or page geometry during startup.
let siteContent = (() => {
  const payload = document.querySelector('#site-content');
  return payload ? JSON.parse(payload.textContent) : null;
})();
const readerAccessEnabled = Boolean(siteContent && Object.hasOwn(siteContent, 'reader'));
let notes = siteContent?.notes ?? [];
let resources = siteContent?.resources ?? [];
let resourceCenter = siteContent?.['resource-center'] ?? [];
let software = siteContent?.software ?? [];
let works = siteContent?.works ?? [];
// Dates read as a dotted scale (2026.09.27) in the monospaced figure font.
const noteDate = (item) => item.date ? new Intl.DateTimeFormat('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.date)).replaceAll('/', '.') : '';
const restoredView = window.sansphasePageSession?.view || {};
let language = restoredView.language === "en" ? "en" : "zh";
import { universeMarkup, mountUniverse } from "./universe.mjs";
let cleanStage = () => {};
let cleanArticleReading = () => {};
let cleanBookReading = () => {};
let bookRenderGeneration=0;
let cleanMobileBlogOrder = () => {};
let cleanReaderAdmin = () => {};
let adminReadersModule;
let homeRoot;
let homeWarmup;
// Retired preview links now resolve to the one current homepage.
if (new URL(location.href).searchParams.has("view")) {
  const canonical = new URL(location.href);
  canonical.searchParams.delete("view");
  history.replaceState(history.state, "", canonical);
}
let activeCategory = typeof restoredView.category === "string" ? restoredView.category : "all";
let activeQuery = typeof restoredView.query === "string" ? restoredView.query : "";
let blogView = restoredView.blogView === "grid" ? "grid" : "list";
let catalogView = restoredView.catalogView === 'list' ? 'list' : 'grid';
let catalogPageNumber = Number.isInteger(restoredView.catalogPage) ? Math.max(1, restoredView.catalogPage) : 1;
const personalPage = (page) => ['notes','note','works','work','resources','software','resource-center','community','post','account','verify','reset','admin'].includes(page);
const catalogUI = () => ({t, icons, tagTone});
let remotePage=null, loadedContentKey='', renderGeneration=0, searchTimer;
let readerUI;
const contentReader=createContentReader();
const projectContent=createContentProjection();
let vipBookPrompt;
const catalogState = () => ({category: activeCategory, query: activeQuery, page: catalogPageNumber, view: catalogView, remote:siteContent?.delivery==='paged-v1'?remotePage:null});
let musicModule;
let cleanContentImages;
let musicIsPlaying=false;
let musicRenderGeneration=0;
function musicState(playing) {
  musicIsPlaying=playing;
  const button=document.querySelector('[data-action="site-music"]');
  if(button) {
    button.classList.toggle('is-playing',playing);
    button.setAttribute('aria-pressed',String(playing));
    button.setAttribute('aria-label',playing?t('暂停音乐','Pause music'):t('播放音乐','Play music'));
    button.title=button.getAttribute('aria-label');
  }
}
function homeMusicControls() {
  return `<button type="button" class="site-music-toggle ${musicIsPlaying?'is-playing':''}" data-action="site-music" aria-pressed="${musicIsPlaying}" aria-label="${musicIsPlaying?t('暂停音乐','Pause music'):t('播放音乐','Play music')}">${icons.disc}</button>`;
}
let blogTheme = (() => {
  try {
    return localStorage.getItem("sansphase-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
})();
let filterPage = typeof restoredView.filterPage === "string" ? restoredView.filterPage : "";
const t = (zh, en) => (language === "zh" ? zh : en);
const copy = value => siteCopy(value,language);
const blogNotice = createBlogNotice({
  document,
  announcements: () => siteContent?.announcements,
  english: () => language === 'en',
  icons,
  escapeHTML: esc,
  imageSources,
  copy,
});
const main = document.querySelector("#main");
const blogPhoto = document.querySelector("#blog-backdrop img");
let blogRevealGeneration = 0;
const afterLayout = (callback) =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 0);
const blogClock = createBlogClock({
  document, window, restoredView,
  visitorTimezone, validTimezone, mountTimezoneSelect,
  escapeHTML: esc, icons, t,
  english: () => language === 'en',
  afterLayout,
});
const blogWeather = createBlogWeather({
  document, window, navigator, restoredView,
  route: () => parseRoute(location.hash).page,
  language: () => language,
  icons, escapeHTML: esc,
  locateVisitor, watchVisitorLocation, searchWeatherCities, localizeWeatherPlace,
  afterLayout,
});
mountToaster(document.querySelector("#toast"));
let categoryUI;
window.sansphasePageSession?.trackView(() => ({
  language, category: activeCategory, query: activeQuery, filterPage, blogView,
  catalogView, catalogPage: catalogPageNumber,
  ...blogClock.state(), ...blogWeather.state(),
}));
const glassSurfaceRecords = new Map();
const menuMedia = window.matchMedia("(max-width: 1200px)");
function closeMenu({ restoreFocus = false } = {}) {
  const button = document.querySelector('[data-action="menu"]');
  document.querySelector(".nav")?.classList.remove("open");
  button?.setAttribute("aria-expanded", "false");
  button?.setAttribute("aria-label", t("打开菜单", "Open menu"));
  if (restoreFocus) button?.focus();
}
function syncMenuBreakpoint() {
  const nav = document.querySelector(".nav");
  const button = document.querySelector('[data-action="menu"]');
  const focusIsHidden = menuMedia.matches
    ? nav?.contains(document.activeElement)
    : document.activeElement === button;
  closeMenu();
  if (focusIsHidden) {
    (menuMedia.matches
      ? button
      : nav?.querySelector('[aria-current="page"]') || nav?.querySelector("a")
    )?.focus();
  }
}
menuMedia.addEventListener("change", syncMenuBreakpoint);
let cleanNavSlider = () => {};
function header(page) {
  const parent =
    { work: "works", note: "notes", post: "community" }[page] || page;
  const support =
    page === "home"
      ? ""
      : `<a class="support-header" href="#/support">${t("支持", "Support")}</a>`;
  const personalAccount = page !== 'home' && siteContent
    ? siteContent.author
      ? `<button type="button" class="account-button" data-author-login>${t('作者台','Author studio')}</button>`
      : `<a class="account-button" href="#/account" data-reader-return>${siteContent.reader ? esc(siteContent.reader.nickname) : t('登录 / 注册','Sign in / Register')}</a>`
    : '';
  // The public-facing pages use one fixed space theme. Keep the theme state
  // for backwards-compatible routing, but do not expose a toggle in chrome.
  const themeToggle = "";
  const languageButton = `<button class="language" data-action="language" aria-label="${t("Switch to English", "切换到中文")}">${t("中 / EN", "EN / 中")}</button>`;
  const menuButton = `<button class="icon-button menu-button" data-action="menu" aria-controls="navigation" aria-expanded="false" aria-label="${t("打开菜单", "Open menu")}"><span class="menu-icon-open">${icons.menu}</span><span class="menu-icon-close">${icons.close}</span></button>`;
  const {view} = communityRoute(location.hash);
  if (inCommunityArea(view)) {
    // The community is its own area: its own navigation, notifications, and a way back to the main site.
    const me = communityUI.me();
    const account = siteContent ? communityAccountHTML({t, esc, icons, nickname: siteContent.reader?.nickname, author: Boolean(siteContent.author), me, ownerAvatar: siteContent.profile?.avatar || null}) : '';
    document.querySelector("#site-header").innerHTML = communityHeaderHTML({view, t, icons, unchecked: Boolean(me && !me.owner && !me.checkedIn), actionsHTML: `${languageButton}${account}${menuButton}`});
    document.querySelector("#site-header").classList.add('community-header');
    cleanNavSlider();
    cleanNavSlider = mountNavSlider(document.querySelector("#navigation"));
    return;
  }
  document.querySelector("#site-header").classList.remove('community-header');
  document.querySelector("#site-header").innerHTML =
    `<a href="#/home" class="brand" aria-label="${t("無相 · 返回首页", "無相 · Back to home")}"><strong>無相</strong><span class="brand-english" aria-hidden="true">SANSPHASE</span></a><nav class="nav" id="navigation" aria-label="${t("主导航", "Main navigation")}">${siteSections
      .map(
        ({ id, zh, en }) =>
          `<a href="#/${id}" ${parent === id ? 'aria-current="page"' : ""}>${t(zh, en)}</a>`,
      )
      .join(
        "",
      )}</nav><div class="header-actions">${support}${themeToggle}${page==='home'?homeMusicControls():''}${languageButton}${personalAccount}${menuButton}</div>`;
  cleanNavSlider();
  cleanNavSlider = mountNavSlider(document.querySelector("#navigation"));
}
function home() {
  return "";
}
// Homepage chapters show real, published facts only: bootstrap totals, and the
// three newest article summaries once the scene is ready (one small cached
// list request, the same one the blog page reuses).
let homeLatest = null;
function homeChapterDetails(id, english) {
  const tr = (zh, en) => (english ? en : zh);
  const pad = (value) => String(value ?? 0).padStart(2, "0");
  const collections = siteContent?.collections || {};
  const count = (summary, unit) => summary?.totalPublished ? `${pad(summary.totalPublished)}${unit}` : tr("整理中", "in preparation");
  if (id === "notes") {
    const summary = collections.notes;
    if (!summary) return null;
    const latest = new Date(summary.latest || "");
    const facts = [
      `${pad(summary.totalPublished)} ${tr("篇文章", "articles")}`,
      `${pad(summary.tagCount)} ${tr("个标签", "tags")}`,
      Number.isNaN(latest.getTime()) ? "" : `${tr("最近更新", "updated")} ${pad(latest.getMonth() + 1)}.${pad(latest.getDate())}`,
    ].filter(Boolean).join(" · ");
    return { facts, items: (homeLatest || []).map((item) => ({ href: `#/note/${item.id}`, title: item.title, meta: noteDate(item) })) };
  }
  if (id === "works")
    return collections.works || collections.resources
      ? { facts: `${tr("作品", "Works")} ${count(collections.works, tr(" 项", ""))} · ${tr("资料", "Materials")} ${count(collections.resources, tr(" 份", ""))}` }
      : null;
  if (id === "community")
    return collections["resource-center"]
      ? { facts: `${tr("资源中心", "Resource center")} ${count(collections["resource-center"], tr(" 份", ""))}` }
      : null;
  return null;
}
function loadHomeLatest() {
  if (homeLatest || navigator.connection?.saveData) return;
  if (siteContent?.delivery !== "paged-v1") {
    homeLatest = notes.slice(0, 3);
    cleanStage.refreshDetails?.();
    return;
  }
  contentReader.prefetch(contentQuery({ page: "notes" })).then((value) => {
    if (!value?.items?.length) return;
    homeLatest = value.items.slice(0, 3);
    cleanStage.refreshDetails?.();
  }).catch(() => {});
}
function setupStage() {
  if (homeRoot) return;
  const holder = document.createElement("div");
  holder.innerHTML = universeMarkup(language === "en");
  homeRoot = holder.firstElementChild;
  homeRoot.id = "home-stage";
  main.before(homeRoot);
  document.querySelector('#site-startup')?.remove();
  document.documentElement.classList.remove('is-home-boot');
  cleanStage = mountUniverse(homeRoot, {
    english: language === "en",
    initiallyCovered: parseRoute(location.hash).page !== 'home',
    // Allow the original-resolution scene assets to finish on a slower link.
    // This is only a failure deadline: successful readiness enters immediately.
    loadTimeoutMs: 120000,
    // Homepage readiness includes its own scene and typography. Content-page
    // images are a low-priority warmup after entry, never a homepage barrier.
    prepareContent: () => document.fonts?.ready,
    chapterDetails: homeChapterDetails,
    onPrepared: () => {
      if(parseRoute(location.hash).page==='home'&&siteContent?.profile?.music?.autoplay!==false)musicModule?.prepareSiteMusicPlayback();
      const warm = () => {
        const connection=navigator.connection;
        if(parseRoute(location.hash).page!=='home'||document.hidden||connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType)) return;
        homeWarmup?.abort();
        homeWarmup=new AbortController();
        preparePageImages(document,siteContent,{concurrency:1,signal:homeWarmup.signal,shouldContinue:()=>parseRoute(location.hash).page==='home'}).catch(() => {});
      };
      const warmAll = () => { loadHomeLatest(); warm(); };
      if(window.requestIdleCallback) window.requestIdleCallback(warmAll);
      else window.setTimeout(warmAll, 0);
    },
    isBlocked: () =>
      (menuMedia.matches && Boolean(document.querySelector(".nav.open"))),
  });
}
// Authored posts keep their original language. Only their surrounding UI changes.
const displayTitle = (item) => item.title;
const displaySummary = (item) => item.summary;
const categoryLabel = (name, list) => {
  if (name === "all") return t("全部", "All");
  const item = list.find((i) => i.category === name);
  return list===notes ? name : t(name, item?.categoryEn || name);
};
const blogPage = createBlogPage({
  getState: () => ({siteContent,notes,activeCategory,activeQuery,blogView,remotePage}),
  t, icons, esc, filterItems, imageSources, tagTone, socialIcon, socialPlatform,
  categoryLabel, noteDate, copy, arrow,
  notice: blogNotice, weather: blogWeather, clock: blogClock,
});
function pageHeading(kicker, title, description, meta = "") {
  return `<div class="eyebrow">${kicker}</div><div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${meta ? `<span class="page-meta">${meta}</span>` : ""}</div>`;
}
function catalogPage(id, body) {
  const section = siteSections.find((item) => item.id === id);
  const index = siteSections.indexOf(section) + 1;
  return `<section class="page catalog-page fade-in" data-section="${id}">${pageHeading(`${esc(section.en.toUpperCase())} / 0${index}`, t(section.zh, section.en), t(section.description, section.descriptionEn))}<div class="catalog-body">${body}</div></section>`;
}
function toolbar(items, searchHint) {
  return `<div class="toolbar"><div id="category-filter"></div><label class="search">${icons.search}<input type="search" id="content-search" placeholder="${searchHint}" aria-label="${searchHint}" value="${esc(activeQuery)}"></label></div>`;
}
function connectFilters(page) {
  const container = document.querySelector("#category-filter");
  if (!container) return;
  const items = { works, notes, resources, software, "resource-center":resourceCenter }[page] || [];
  categoryUI = mountFilters(container, {
    value: activeCategory,
    label: t("按分类筛选", "Filter by category"),
    items: ["all", ...(remotePage?.categories ?? [...new Set(items.map((item) => item.category))])].map(
      (value) => ({ value, label: categoryLabel(value, items) }),
    ),
    onChange(value) {
      activeCategory = value;
      catalogPageNumber = 1;
      refreshResults();
    },
  });
}
function worksPage() {
  return collectionPage('works', works, catalogState(), catalogUI());
}
function worksResults() {
  return catalogResults('works', works, catalogState(), catalogUI());
}
function adBox() {
  return `<aside class="ad-box"><span class="tag">${t("赞助展示位 · 预留", "SPONSOR PLACEMENT")}</span><h2>${t("让好作品被看见", "Good work deserves an audience")}</h2><p>${t("这里留给契合内容的品牌合作。<br>当前没有投放广告。", "A place for relevant brand partnerships.<br>No advertisement is currently running.")}</p><a href="#/contact" class="text-link">${t("了解合作", "Let’s talk")}${arrow}</a></aside>`;
}
function resourceResults() {
  return catalogResults('resources', resources, catalogState(), catalogUI());
}
function resourcesPage() {
  const {id}=parseRoute(location.hash);
  if(id) return libraryDetail(resources.find(item=>item.id===id),'resources');
  return collectionPage('resources', resources, catalogState(), catalogUI());
}
function softwarePage() {
  const {id}=parseRoute(location.hash);
  if(id) return libraryDetail(software.find(item=>item.id===id),'software');
  return collectionPage('software', software, catalogState(), catalogUI());
}
function libraryDetail(item,kind) {
  if(!item) return notFound();
  return catalogDetail(kind,item,catalogUI());
}
function resourceCenterPage() {
  const {id}=parseRoute(location.hash);
  if(id) {const item=siteContent?.preview?.kind==='resource-center'&&siteContent.preview.id===id?siteContent.preview:resourceCenter.find(item=>item.id===id);return item?.book?bookShell(item,t):libraryDetail(item,'resource-center');}
  return collectionPage('resource-center',resourceCenter,catalogState(),catalogUI());
}
function closedPage(section, title, message) {
  return `<section class="page catalog-page" data-section="${section}">${pageHeading(section.toUpperCase(),title,message)}<div class="empty" data-content-state="not-open"><p>${t('你可以先浏览博客、作品与资料。','Explore the blog, projects and learning materials.')}</p><a class="button" href="#/notes">${t('浏览博客','Read the blog')} ${arrow}</a></div></section>`;
}
// Every community page after the landing page comes from the community UI.
const communityUI = createCommunityUI();
let cleanCommunity = () => {};
// Community pages use the demo's starfield instead of the blog photo. It stays
// mounted while moving between community pages.
let cleanCommunitySky = null;
function syncCommunitySky(inCommunity) {
  document.body.classList.toggle('community-open', inCommunity);
  if (inCommunity) cleanCommunitySky ??= mountCommunitySky(document.querySelector('#blog-backdrop'));
  else { cleanCommunitySky?.(); cleanCommunitySky = null; }
}
// The header reads the community's `me` (bell, balance, level); when that changes it is redrawn,
// unless the visitor is using the header at that moment.
function refreshCommunityHeader() {
  const bar = document.querySelector('#site-header');
  if (!bar?.classList.contains('community-header') || bar.contains(document.activeElement)) return;
  header(parseRoute(location.hash).page);
}
const communityContext = () => ({t, esc, icons, notify: (message) => toast(message), members: Boolean(siteContent?.reader?.vip || siteContent?.author),
  ownerAvatar: siteContent?.profile?.avatar || null, headerChanged: refreshCommunityHeader});
// The community account menu (with the way back to the main site). The header
// is rebuilt on every route, so a route change also closes it.
function setCommunityAccountMenu(open) {
  const button = document.querySelector('[data-action="community-account"]');
  const menu = document.querySelector('#community-account-menu');
  if (!button || !menu) return false;
  const wasOpen = !menu.hidden;
  button.setAttribute('aria-expanded', String(open));
  menu.hidden = !open;
  return wasOpen;
}
document.addEventListener('click', (event) => {
  if (!event.target.closest?.('.community-account')) setCommunityAccountMenu(false);
});
let communityStyleReady = false;
function communityPage() {
  const {view} = communityRoute(location.hash);
  if (view === 'landing') return communityLandingHTML(t, icons);
  if (view === 'unknown') return notFound();
  return communityUI.html(communityContext()) ?? notFound();
}
function sectionsHTML(item) {
  if (typeof item.bodyHTML === 'string') return item.bodyHTML;
  return item.sections
    .map(([title, body]) => `<h2>${esc(title)}</h2><p>${esc(body)}</p>`)
    .join("");
}
function articlePage(kind, id) {
  const isWork = kind === "work";
  const item = (!isWork && siteContent?.preview?.id === id) ? siteContent.preview : (isWork ? works : notes).find((x) => x.id === id);
  if (!item) return notFound();
  return `<section class="page fade-in"><article class="article ${isWork ? "" : "reading-article"}"><a class="back-link" href="#/${isWork ? "works" : "notes"}">${icons.left} ${t(isWork ? "返回作品集" : "返回博客", isWork ? "Back to work" : "Back to blog")}</a><div class="eyebrow">${isWork ? "PROJECT ARCHIVE" : "FIELD NOTES"} / ${esc(categoryLabel(item.category, isWork ? works : notes))}</div><h1>${esc(displayTitle(item))}</h1><div class="post-tags"><span>${esc(siteContent?.profile?.name || "無相")}</span>${item.date ? `<time datetime="${esc(item.date)}">${esc(noteDate(item))}</time>` : ""}${(item.tags||[]).map(tag=>`<span class="article-meta-tag">${esc(tag)}</span>`).join("")}</div><p class="article-intro">${esc(displaySummary(item))}</p>${item.coverSrc ? `<div class="cover-frame"><img class="article-cover" src="${esc(item.coverSrc)}" ${imageSources(item.coverSrc, '(max-width: 960px) 100vw, 960px',item.coverWidth)} width="${Number(item.coverWidth)||960}" height="${Number(item.coverHeight)||540}" decoding="async" alt="${esc(t(item.coverAlt || item.title, item.coverAltEn || item.en || item.title))}"></div>` : ""}<div class="article-body">${siteContent?.preview === item ? `<p class="article-preview-label" role="status">${t("作者预览 · 此预览仅登录作者可见","Author preview · Visible only to the signed-in author")}</p>` : ""}${sectionsHTML(item)}${item.attachments?.length ? `<section class="article-attachments"><h2>${t("附件下载","Attachments")}</h2>${item.attachments.map(file=>`<a class="text-link" href="${esc(file.url)}" download>${icons.download}${esc(file.name)}</a>`).join("")}</section>` : ""}</div><div class="article-bottom"><a class="text-link article-more" href="#/${isWork ? "works" : "notes"}">${t("浏览更多", "Browse more")}${arrow}</a></div></article></section>`;
}
function postPage() { return communityUI.html(communityContext()) ?? notFound(); }
function supportPage() {
  return closedPage('support',t('赞助与支持','Support'),t('感谢你的关注。赞助渠道暂未开放。','Thank you for your interest. Support channels are not open yet.'));
}
function contactPage() {
  return closedPage('contact',t('联系与合作','Contact'),t('合作联系方式正在准备中。','Contact details will be available here.'));
}
function accountPage() { return readerPage('account','',siteContent?.reader,language==='en',siteContent?.readerRegistrationEnabled !== false,siteContent?.author); }
function adminPage() { return adminReadersModule.adminReadersPage(siteContent?.author,language==='en'); }
function notFound() {
  return `<section class="page"><div class="empty" style="margin-top:50px"><div class="eyebrow" style="justify-content:center;margin-bottom:20px">404 / A LITTLE OFF TRACK</div><h1>${t("这个角落还没有内容。", "Nothing here just yet.")}</h1><p style="margin:20px 0 28px">${t("这条链接可能已变更，或内容尚未公开。", "The link may have changed, or this content is not public yet.")}</p><a class="button" href="#/home">${t("回到首页", "Back home")} ${arrow}</a></div></section>`;
}
document.addEventListener('visibilitychange',()=>{if(document.hidden) homeWarmup?.abort();});
function syncContentCollections() {
  if(!siteContent)return;
  const collections=projectContent(siteContent,language);
  notes=collections.notes;
  works=collections.works;
  resources=collections.resources;
  software=collections.software;
  resourceCenter=collections.resourceCenter;
}
function contentMessage(failed=false) {
 return `<section class="page"><div class="empty" role="status"><p>${failed?t('内容暂时无法读取，请重试。','Content could not be loaded. Please retry.'):t('正在读取内容…','Loading content…')}</p>${failed?`<button type="button" class="button" data-action="retry-content">${t('重试','Retry')}</button>`:''}</div></section>`;
}
function acceptContent(query,value) {
 const kind=query.get('kind');
 siteContent[kind]=query.get('view')==='detail' ? (value.item?[value.item]:[]) : value.items;
 remotePage=query.get('view')==='list'?value:null;
 loadedContentKey=query.toString();
 syncContentCollections();
}
async function render(options={}) {
 const generation=++renderGeneration;
 const route=parseRoute(location.hash);
 if(route.page==='account' && siteContent?.author) {
  // Owners work in the author panel; the reader account card is not an owner destination.
  history.replaceState(history.state,'',location.pathname+location.search+'#/notes');
  await render(options);
  document.querySelector('[data-author-login]')?.click();
  return;
 }
 if(readerAccessEnabled && !siteContent.reader && !siteContent.author && route.page !== '404' && !publicRoute(route.page) && !['account','verify','reset','admin'].includes(route.page)) {
  contentReader.cancel();loadedContentKey='';remotePage=null;
  renderView({...options,contentStatus:'auth'});
  return;
 }
 const bookStyle = route.page==='resource-center' && route.id ? ensureRouteStyle(document,'book').then(()=>true,()=>false) : null;
 // Wait for the community stylesheet only on the first visit; later renders
 // (language switch, sorting) stay synchronous. A failed load still renders.
 const communityStyle = !communityStyleReady && communityView(route.page, route.id) !== 'unknown'
  ? ensureRouteStyle(document,'community').then(()=>{communityStyleReady=true;},()=>{}) : null;
 if(!route.id&&['notes','works','resources','software','resource-center'].includes(route.page)&&filterPage!==route.page) {
  activeCategory='all';activeQuery='';catalogPageNumber=1;filterPage=route.page;
 }
 const query=siteContent?.delivery==='paged-v1' ? contentQuery(route,catalogState()) : null;
 if(query&&siteContent?.preview?.id!==route.id&&loadedContentKey!==query.toString()) {
  remotePage=null;
  renderView({...options,contentStatus:'loading'});
  try {
   const value=await contentReader.read(query);
   if(generation!==renderGeneration) return;
   acceptContent(query,value);
  } catch(error) {
   if(generation!==renderGeneration) return;
   if(error.status===404) acceptContent(query,{item:null});
   else if(error.code==='VIP_REQUIRED') {
    renderView({...options,contentStatus:'vip'});
    vipBookPrompt?.open();
    return;
   }
   else {renderView({...options,contentStatus:'error'});return;}
  }
 } else if(!query) {contentReader.cancel();loadedContentKey='';remotePage=null;}
 if(generation!==renderGeneration) return;
 if(route.page==='admin') {
  try {adminReadersModule=await loadAdminReaders();}
  catch {renderView({...options,contentStatus:'error'});return;}
  if(generation!==renderGeneration) return;
 }
 if(bookStyle) {
  const ready=await bookStyle;
  if(generation!==renderGeneration) return;
  if(!ready) {renderView({...options,contentStatus:'error'});return;}
 }
 if(communityStyle) {
  await communityStyle;
  if(generation!==renderGeneration) return;
 }
 renderView(options);
 window.sansphasePageSession?.commit();
}
function renderView({preserveScroll=false,contentStatus}={}) {
  vipBookPrompt=vipBookPrompt?.updateLanguage(language==='en');
  syncContentCollections();
  const position = preserveScroll ? {left:window.scrollX,top:window.scrollY} : null;
  const anchorSelector='.blog-card, .article-body > *, .blog-side-card';
  const anchorNodes=position?.top>1 ? [...main.querySelectorAll(anchorSelector)] : [];
  const headerBottom=document.querySelector('#site-header').getBoundingClientRect().bottom;
  const anchorIndex=anchorNodes.findIndex(node=>{
    const rect=node.getBoundingClientRect();
    return rect.bottom>headerBottom && rect.top<window.innerHeight;
  });
  const anchorTop=anchorIndex<0 ? null : anchorNodes[anchorIndex].getBoundingClientRect().top;
  const previousMinHeight = main.style.minHeight;
  // Disposing glass roots and parking audio briefly empties the page. Keep its
  // height until the replacement is ready, so the browser cannot clamp scrollY.
  if(position) main.style.minHeight = `${main.getBoundingClientRect().height}px`;
  setupStage();
  musicModule?.parkSiteMusic();
  document.body.dataset.blogAccent=siteContent?.profile?.appearance?.accent || "gold";
  applyCardAppearance(document.body,siteContent?.profile?.appearance);
  const { page, id } = parseRoute(location.hash);
  const isList = !id && ["works", "notes", "resources", "software", "resource-center", "community"].includes(page);
  if (isList && filterPage !== page) {
    activeCategory = "all";
    activeQuery = "";
    filterPage = page;
    catalogPageNumber = 1;
  }
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.body.classList.toggle("is-home", page === "home");
  document.body.classList.toggle("content-open", page !== "home");
  document.body.classList.toggle("blog-open", personalPage(page));
  document.body.classList.toggle("admin-open", page === "admin");
  const inCommunity = communityRoute(location.hash).view !== 'unknown';
  syncCommunitySky(inCommunity);
  if(personalPage(page) && !inCommunity && blogPhoto && !blogPhoto.hasAttribute('src')) {
    blogPhoto.sizes=blogPhoto.dataset.backgroundSizes || '100vw';
    blogPhoto.srcset=blogPhoto.dataset.backgroundSrcset || '';
    blogPhoto.src=blogPhoto.dataset.backgroundSrc;
  }
  syncBlogBackdrop(page);
  document.body.classList.toggle("theme-light", page !== "home" && blogTheme === "light");
  main.hidden = page === "home";
  if (page === "home") homeRoot.setAttribute("role", "main");
  else homeRoot.removeAttribute("role");
  cleanStage.setCovered(page !== "home");
  cleanStage.setLanguage(language === "en");
  header(page);
  const views = {
    home,
    works: worksPage,
    notes: blogPage.html,
    resources: resourcesPage,
    software: softwarePage,
    "resource-center": resourceCenterPage,
    community: communityPage,
    support: supportPage,
    contact: contactPage,
    account: accountPage,
    verify: () => readerPage('verify',id,siteContent?.reader,language==='en',siteContent?.readerRegistrationEnabled !== false),
    reset: () => readerPage('reset',id,siteContent?.reader,language==='en',siteContent?.readerRegistrationEnabled !== false),
    admin: adminPage,
    work: () => libraryDetail(works.find(item => item.id === id), 'works'),
    note: () => articlePage("note", id),
    post: () => postPage(id),
  };
  categoryUI?.dispose();
  categoryUI = undefined;
  blogClock.unmount();
  cleanGlassSurfaces();
  cleanArticleReading?.();
  cleanBookReading?.();
  cleanContentImages?.();
  cleanMobileBlogOrder();
  cleanReaderAdmin();
  cleanCommunity();
  setContentHTML(main,contentStatus ? contentStatus==='auth' ? readerGate(language==='en') : contentStatus==='vip' ? vipBookGate(language==='en') : contentMessage(contentStatus==='error') : (views[page] || notFound)());
  readerUI?.route(page,id);
  cleanCommunity=!contentStatus && (page==='community'||page==='post') ? communityUI.mount(main,communityContext()) : ()=>{};
  cleanReaderAdmin=page==='admin' && adminReadersModule ? adminReadersModule.mountReaderAdmin(main,{english:language==='en'}) : ()=>{};
  const bookRoot=main.querySelector('.book-reader'),bookGeneration=++bookRenderGeneration;
  cleanBookReading=()=>{};
  if(bookRoot)import('./book-reader.mjs').then(({mountBookReader})=>{
    if(bookGeneration===bookRenderGeneration&&bookRoot.isConnected)cleanBookReading=mountBookReader(bookRoot,siteContent?.preview?.kind==='resource-center'&&siteContent.preview.id===id?siteContent.preview:resourceCenter.find(item=>item.id===id),{english:language==='en'});
  }).catch(()=>{if(bookRoot.isConnected)bookRoot.querySelector('.book-status').textContent=t('阅读器加载失败，请刷新后重试。','Reader unavailable. Reload to retry.');});
  cleanMobileBlogOrder=mountMobileBlogOrder(main.querySelector('.blog-layout'));
  cleanArticleReading=enhanceArticleReading(main.querySelector(".reading-article"),{
    english:language==="en",
    sidebarHTML:page==='note'||(['resources','resource-center'].includes(page)&&id)?blogPage.author()+blogPage.music():'',
  });
  mountBlogGlassSurfaces();
  cleanContentImages=enhanceContentImages(main,{english:language==='en'});
  const musicHost=document.querySelector("#blog-audio-player");
  const musicGeneration=++musicRenderGeneration;
  const mountMusic=module=>{
    if(musicGeneration!==musicRenderGeneration) return;
    musicModule=module;
    module.mountSiteMusic(musicHost,siteContent?.profile?.music,musicState,{language,preparePlayback:page==='home',autoplayReady:page==='home'&&homeRoot.classList.contains('is-ready')});
    musicState(musicIsPlaying);
  };
  if(musicModule) mountMusic(musicModule);
  else if((page==='home'||musicHost)&&siteContent?.profile?.music?.tracks?.length) import('./music.bundle.mjs').then(mountMusic).catch(()=>{ if(musicHost?.isConnected) musicHost.textContent=t('播放器暂时无法载入。','Player unavailable.'); });
  blogClock.mount();
  blogNotice.sync(page);
  blogClock.sync(page);
  blogWeather.sync(page);
  connectFilters(page);
  document.title =
    page === "home"
      ? t("無相 · 博客与作品", "無相 · Blog and work")
      : `${t({ works: "作品", work: "作品详情", notes: "博客", note: "博客文章", resources: "资料", software: "软件推荐", "resource-center": "资源中心", community: "社区交流", post: "社区讨论", support: "赞助与支持", contact: "联系与合作", account: "个人空间", verify: "验证邮箱", reset: "重置密码", admin: "用户管理" }[page] || "页面未找到", { works: "Work", work: "Project", notes: "Blog", note: "Blog post", resources: "Learning materials", software: "Software", "resource-center": "Resource center", community: "Community", post: "Discussion", support: "Support", contact: "Contact", account: "Your space", verify: "Verify email", reset: "Reset password", admin: "User management" }[page] || "Page not found")} · 無相`;
  document.querySelector("#site-footer").innerHTML =
    `<div class="footer-identity"><span class="footer-copyright">© 無相</span><a class="site-registration" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">豫ICP备2026037683号-1</a>${siteContent?.reader?.uid && !siteContent.author ? `<span class="footer-reader-uid">UID ${esc(siteContent.reader.uid)}${siteContent.reader.vip ? ' <span class="footer-vip-badge">VIP</span>' : ''}</span>` : ''}</div><div class="footer-links"><a href="#/contact">${t("联系与合作", "Contact")}</a><a href="#/support">${t("赞助与支持", "Support")}</a><span>${t("记录 · 创作 · 分享", "Learn · Create · Share")}</span></div>`;
  document.querySelector('.skip-link').textContent=t('跳到正文','Skip to content');
  document.querySelector('meta[name="description"]').content=t('無相的个人网站，分享博客文章、软件作品、学习资料与工具使用心得。','SANSPHASE: blog posts, software projects, learning resources and practical notes.');
  if(position) {
    main.style.minHeight=previousMinHeight;
    const anchor=anchorIndex<0 ? null : main.querySelectorAll(anchorSelector)[anchorIndex];
    // English may wrap onto extra lines above the viewport. Keep the current
    // article/card in the same visible place, rather than jumping its content.
    if(anchor) position.top=window.scrollY+anchor.getBoundingClientRect().top-anchorTop;
    window.scrollTo({...position,behavior:'instant'});
  }
}
async function refreshResults() {
  if(siteContent?.delivery==='paged-v1') {
    const query=contentQuery(parseRoute(location.hash),catalogState());
    if(query&&loadedContentKey!==query.toString()) {
      const generation=++renderGeneration;
      const host=document.querySelector('#results');
      host?.setAttribute('aria-busy','true');
      try {
        const value=await contentReader.read(query);
        if(generation!==renderGeneration) return;
        acceptContent(query,value);
      } catch(error) {
        if(generation!==renderGeneration) return;
        toast(t('内容暂时无法读取，请重试。','Content could not be loaded. Please retry.'));
        return;
      } finally {if(generation===renderGeneration)host?.removeAttribute('aria-busy');}
    }
  }
  const page = parseRoute(location.hash).page;
  const renderer = {
    works: worksResults,
    notes: blogPage.results,
    resources: resourceResults,
    software: () => catalogResults('software', software, catalogState(), catalogUI()),
    'resource-center':()=>catalogResults('resource-center',resourceCenter,catalogState(),catalogUI()),
  }[page];
  if (renderer && document.querySelector("#results")) {
    const results = document.querySelector("#results");
    cleanGlassSurfaces(results);
    setContentHTML(results,renderer());
    mountBlogGlassSurfaces(results);
    cleanContentImages?.();
    cleanContentImages=enhanceContentImages(main,{english:language==='en'});
  }
  categoryUI?.update(activeCategory);
  if (['software','resource-center'].includes(page)) syncCatalogViewButton();
}
function syncCatalogViewButton() {
  const button = document.querySelector('[data-action="catalog-view"]');
  if (!button) return;
  const presentation = catalogViewPresentation(catalogView,catalogUI(),!!document.querySelector('#results .catalog-grid'));
  button.disabled = presentation.disabled;
  button.setAttribute('aria-label',presentation.label);
  button.setAttribute('title',presentation.label);
  button.innerHTML = presentation.html;
}
function cleanGlassSurfaces(scope = document) {
  for (const [host, cleanup] of glassSurfaceRecords) {
    if (host === scope || scope.contains(host)) {
      cleanup?.();
      glassSurfaceRecords.delete(host);
    }
  }
}
function mountBlogGlassSurfaces(scope = document) {
  // Keep persistent controls and live widgets mounted. A results update owns
  // only the article cards inside #results, never the rest of the blog.
  if (
    !personalPage(parseRoute(location.hash).page) ||
    typeof window.ResizeObserver !== "function"
  )
    return;
  const selector = ".blog-page .blog-card, .blog-page .blog-identity, .blog-page .blog-side-card, .blog-page .blog-notice, .blog-page .blog-toolbar";
  for (const host of scope.querySelectorAll(selector)) {
    if (glassSurfaceRecords.has(host)) continue;
    const html = host.innerHTML;
    host.innerHTML = "";
    glassSurfaceRecords.set(host, mountGlassSurface(
        host,
        html,
        host.classList.contains("blog-card") ? "blog-card-surface" : "blog-panel-surface",
      ));
  }
}
function syncBlogBackdrop(page) {
  const active = personalPage(page);
  const generation = ++blogRevealGeneration;
  if (!active || !blogPhoto) {
    document.body.classList.remove("blog-ready");
    return;
  }
  const reveal = () => {
    if (generation === blogRevealGeneration) document.body.classList.add("blog-ready");
  };
  if (blogPhoto.complete && blogPhoto.naturalWidth > 0) {
    // Cached images are ready now. Revealing on the next frame created a
    // visible flash on every refresh and when switching between blog routes.
    reveal();
    return;
  }
  document.body.classList.remove("blog-ready");
  blogPhoto.addEventListener("load", reveal, { once: true });
  blogPhoto.decode?.().then(reveal, reveal);
}
document.addEventListener("click", (e) => {
  if (e.target.closest('[data-vip-book]')) {
    e.preventDefault();
    vipBookPrompt?.open();
    return;
  }
  if (
    e.target.closest(".brand") &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey &&
    e.button === 0
  ) {
    closeMenu();
    cleanStage.returnToOpening?.();
    if (parseRoute(location.hash).page === "home") {
      e.preventDefault();
      homeRoot.querySelector(".universe-stage")?.focus({ preventScroll: true });
    }
    return;
  }
  const navigation = document.querySelector(".nav");
  if (
    navigation?.classList.contains("open") &&
    (e.target.closest(".nav a") || !e.target.closest("#site-header"))
  ) {
    closeMenu();
    if (e.target.closest(".nav a")?.hash === location.hash) {
      main.focus({ preventScroll: true });
    }
  }
  if (e.target.closest(".skip-link")) {
    e.preventDefault();
    (parseRoute(location.hash).page === "home"
      ? homeRoot.querySelector(".universe-stage")
      : main
    ).focus();
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  const dl = e.target.closest("[data-download]");
  if (dl)
    toast(
      t(
        "正在准备下载文件。",
        "Preparing the file download.",
      ),
    );
  const a = e.target.closest("[data-action]");
  const pagination = e.target.closest('[data-catalog-page]');
  if (pagination) {
    catalogPageNumber = Number(pagination.dataset.catalogPage);
    refreshResults();
    const results = document.querySelector('#results');
    if (results) {
      results.tabIndex = -1;
      results.focus({preventScroll:true});
      window.scrollTo({top: Math.max(0, results.getBoundingClientRect().top + window.scrollY - 130), behavior:'instant'});
    }
    return;
  }
  if (!a) return;
  switch (a.dataset.action) {
    case 'open-vip-prompt': vipBookPrompt?.open();break;
    case 'retry-content': loadedContentKey='';render();break;
    case 'catalog-view': {
      if (!['software','resource-center'].includes(parseRoute(location.hash).page) || a.disabled) break;
      catalogView = catalogView === 'grid' ? 'list' : 'grid';
      document.querySelector('.catalog-grid')?.classList.toggle('is-list',catalogView==='list');
      syncCatalogViewButton();
      break;
    }
    case "language":
      language = language === "zh" ? "en" : "zh";
      render({preserveScroll:true});
      blogWeather.refreshCityLabel();
      document.querySelector('[data-action="language"]').focus({preventScroll:true});
      break;
    case "blog-view":
      blogView = a.dataset.view === "grid" ? "grid" : "list";
      document.querySelector(".blog-results")?.classList.toggle("is-grid", blogView === "grid");
      a.dataset.view = blogView === "list" ? "grid" : "list";
      a.setAttribute("aria-label", blogView === "list" ? t("切换为网格", "Switch to grid") : t("切换为列表", "Switch to list"));
      a.firstChild.textContent = `${blogView === "list" ? t("列表", "List") : t("网格", "Grid")} `;
      a.focus();
      break;
    case "site-music":
      if(siteContent?.profile?.music?.tracks?.length && musicModule) musicModule.toggleSiteMusic();
      else toast(t('作者尚未设置可在本站播放的音乐。','No on-site audio has been configured.'));
      break;
    case "theme-toggle":
      blogTheme = blogTheme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("sansphase-theme", blogTheme);
      } catch {}
      document.body.classList.toggle("theme-light", blogTheme === "light");
      a.setAttribute("aria-pressed", String(blogTheme === "light"));
      a.setAttribute("aria-label", blogTheme === "light" ? t("切换深色主题", "Use dark theme") : t("切换浅色主题", "Use light theme"));
      const glyph = a.querySelector(".theme-glyph");
      if (glyph) glyph.innerHTML = blogTheme === "light" ? icons.moon : icons.sun;
      break;
    case "blog-calendar": {
      blogClock.toggleCalendar(a);
      break;
    }
    case "weather-details": {
      blogWeather.toggleDetails(a);
      break;
    }
    case "community-account": {
      const open = a.getAttribute('aria-expanded') !== 'true';
      setCommunityAccountMenu(open);
      if (open) document.querySelector('#community-account-menu [role="menuitem"]')?.focus();
      break;
    }
    case "blog-notice-prev":
      blogNotice.rotate(-1);
      break;
    case "blog-notice-next":
      blogNotice.rotate(1);
      break;
    case "menu": {
      const expanded = a.getAttribute("aria-expanded") === "true";
      a.setAttribute("aria-expanded", String(!expanded));
      a.setAttribute(
        "aria-label",
        expanded ? t("打开菜单", "Open menu") : t("关闭菜单", "Close menu"),
      );
      document.querySelector(".nav").classList.toggle("open", !expanded);
      if (!expanded) {
        (
          document.querySelector('.nav a[aria-current="page"]') ||
          document.querySelector(".nav a")
        )?.focus();
      }
      break;
    }
    case "clear-search":
      catalogPageNumber = 1;
      activeQuery = "";
      activeCategory = "all";
      if (document.querySelector("#content-search"))
        document.querySelector("#content-search").value = "";
      refreshResults();
      break;

  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "content-search") {
    activeQuery = e.target.value;
    catalogPageNumber = 1;
    clearTimeout(searchTimer);
    if(siteContent?.delivery==='paged-v1') searchTimer=setTimeout(()=>refreshResults(),200);
    else refreshResults();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (e.defaultPrevented || document.querySelector('.blog-timezone-menu[data-state="open"]')) return;
    if (setCommunityAccountMenu(false)) {
      e.preventDefault();
      document.querySelector('[data-action="community-account"]')?.focus();
      return;
    }
    const nav = document.querySelector(".nav");
    if (nav?.classList.contains("open")) {
      e.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }
    const currentPage = parseRoute(location.hash).page;
    if (currentPage !== "home") {
      e.preventDefault();
      if (history.length > 1) history.back();
      else location.hash = "#/home";
    }
  }
});
const routeTransitions = createRouteTransitions(document);
// On the homepage a followed link first flies the scene towards the click for
// DEPART_MS, while the destination's content is fetched. The destination uses
// a live fade, with no snapshot overlay. Reduced motion keeps ordinary links.
let departing = false;
document.addEventListener("click", (event) => {
  const link = event.target.closest?.('a[href^="#/"]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = parseRoute(link.getAttribute("href"));
  if (parseRoute(location.hash).page !== "home" || target.page === "home") return;
  const rect = link.getBoundingClientRect();
  const x = event.detail ? event.clientX : rect.left + rect.width / 2,
    y = event.detail ? event.clientY : rect.top + rect.height / 2;
  if (departing) { event.preventDefault(); return; }
  if (!cleanStage.depart?.(x, y)) return;
  event.preventDefault();
  departing = true;
  const query = siteContent?.delivery === "paged-v1" && contentQuery(target, target.id ? {} : catalogState());
  if (query) contentReader.prefetch(query).catch(() => {});
  setTimeout(() => {
    departing = false;
    location.hash = link.getAttribute("href");
  }, DEPART_MS);
});
window.addEventListener("hashchange", (event) => {
  // Stop scheduling new warmup images, but let the one already in flight be
  // reused by the destination page instead of cancelling and downloading again.
  clearTimeout(searchTimer);
  loadedContentKey='';
  const fromRoute = parseRoute(event.oldURL ? new URL(event.oldURL).hash : "");
  const toRoute = parseRoute(location.hash);
  const from = fromRoute.page, to = toRoute.page;
  const update = () => {
    const rendering = render();
    window.scrollTo({ top: 0, behavior: "instant" });
    (to === "home"
      ? homeRoot.querySelector(".universe-stage")
      : main
    ).focus({ preventScroll: true });
    return rendering;
  };
  // Within the community the page changes in place: the header and the live
  // starfield stay, and the page's own blocks rise in (community-ui). A
  // snapshot cross-fade would freeze the sky and show both pages at once.
  const withinCommunity = inCommunityArea(communityRoute(event.oldURL ? new URL(event.oldURL).hash : '').view) && inCommunityArea(communityRoute(location.hash).view);
  if (withinCommunity) update();
  else routeTransitions.run(from, to, update);
});
window.addEventListener("pagehide", (e) => {
  homeWarmup?.abort();contentReader.cancel();
  if (!e.persisted) {
    blogNotice.stop();
    blogClock.stop();
    blogWeather.dispose();
    // The browser owns disposal of a departing document. Unmounting React
    // here collapses the still-visible cards, clamps scrollY, and changes the
    // position the browser saves for reload. Keep the last frame intact.
    // In-document route changes still dispose their own roots in render().
  }
});
window.addEventListener('author:identity',event=>{
  if(!siteContent)return;
  contentReader.clear();loadedContentKey='';
  siteContent.author=event.detail;
  communityUI.clear();
  render({preserveScroll:true});
});
window.addEventListener('reader:identity',event=>{
  if(!siteContent)return;
  contentReader.clear();loadedContentKey='';remotePage=null;
  siteContent.reader=event.detail;
  communityUI.clear();
  render();
});
readerUI=mountReaderUI({render,onIdentity(value){
  window.dispatchEvent(new CustomEvent('reader:identity',{detail:value}));
},english:()=>language==='en'});
vipBookPrompt=mountVipBookPrompt({english:language==='en'});
window.addEventListener('author:content',async event=>{
  contentReader.clear();
  const y=scrollY;
  siteContent=event.detail;resourceCenter=siteContent['resource-center']||[];notes=siteContent.notes;resources=siteContent.resources;software=siteContent.software;works=siteContent.works||[];
  loadedContentKey='';remotePage=null;
  const background=siteContent.profile?.background||'./assets/materials/blog-space.png';
  if(blogPhoto&&blogPhoto.getAttribute('src')!==background){const photo=new Image();photo.sizes='100vw';photo.srcset=imageSourceSet(background);photo.src=background;try{await photo.decode();blogPhoto.sizes=photo.sizes;blogPhoto.srcset=photo.srcset;blogPhoto.src=background;}catch{}}
  await render({preserveScroll:true});window.scrollTo({top:y,behavior:'instant'});
});

blogWeather.bind();
mountNavigationPrefetch(document,contentReader,{enabled:()=>siteContent?.delivery==='paged-v1'&&!siteContent?.preview&&(parseRoute(location.hash).page!=='home'||Boolean(homeRoot?.classList.contains('is-ready')))});
render();
// All synchronous wrappers, filters and expanded regions are in place now.
// Restore before yielding a frame, without an entrance animation or scroll tween.
// The first complete route, including any requested article, commits restoration.


document.addEventListener("click", event => {
  const tag=event.target.closest("[data-blog-tag]");
  if (!tag) return;
  activeCategory="all";
  const input=document.querySelector("#content-search");
  if (input) { input.value=tag.dataset.blogTag; input.dispatchEvent(new Event("input", {bubbles:true})); }
});

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)blogClock.refreshAutoTimezone();
});
