import {visitorTimezone, validTimezone, locateVisitor, searchWeatherCities,watchVisitorLocation} from './visitor-location.mjs';
import {imageSources, imageSourceSet} from './image-sources.mjs';
import {preparePageImages} from './home-preload.mjs';
import {mountRouteAssets} from './route-assets.mjs';
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
  enterPage,
  mountFilters,
  mountGlassSurface,
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
let notes = siteContent?.notes ?? [];
let resources = siteContent?.resources ?? [];
let resourceCenter = siteContent?.['resource-center'] ?? [];
let software = siteContent?.software ?? [];
let works = siteContent?.works ?? [];
const noteDate = (item) => item.date ? new Intl.DateTimeFormat('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.date)) : ''; 
const restoredView = window.sansphasePageSession?.view || {};
let language = restoredView.language === "en" ? "en" : "zh";
import { universeMarkup, mountUniverse } from "./universe.mjs";
let cleanStage = () => {};
let cleanArticleReading = () => {};
let homeRoot;
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
const personalPage = (page) => ['notes','note','works','work','resources','software','resource-center'].includes(page);
const catalogUI = () => ({t, icons, tagTone});
const catalogState = () => ({category: activeCategory, query: activeQuery, page: catalogPageNumber, view: catalogView});
let musicModule;
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
let blogNoticeIndex = 0;
let blogNoticeTimer;
let localTimezone = visitorTimezone();
let timezoneManual = restoredView.timezoneManual === true;
let blogTimezone = timezoneManual && validTimezone(restoredView.timezone) ? restoredView.timezone : localTimezone;
let visitorWeatherPlace = null;
let locatingWeather = null;
let attemptedLocation = false;
let manualWeatherPlace=false,stopWeatherWatch;
let weatherCityResults = [];
let weatherCityAbort;
let locationGeneration=0;
let weatherRefreshTimer;
let blogClockTimer;
let blogTheme = (() => {
  try {
    return localStorage.getItem("sansphase-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
})();
let blogWeatherRequest;
let blogWeatherKey = "";
let blogWeatherAbort;
let blogCalendarOpen = restoredView.calendarOpen === true;
let blogWeatherOpen = restoredView.weatherOpen === true;
let filterPage = typeof restoredView.filterPage === "string" ? restoredView.filterPage : "";
let hasRenderedOnce = false;
const t = (zh, en) => (language === "zh" ? zh : en);
const main = document.querySelector("#main");
const blogPhoto = document.querySelector("#blog-backdrop img");
let blogRevealGeneration = 0;
const afterLayout = (callback) =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 0);
mountToaster(document.querySelector("#toast"));
let categoryUI;
let cleanTimezone;
window.sansphasePageSession?.trackView(() => ({
  language, category: activeCategory, query: activeQuery, filterPage, blogView,
  catalogView, catalogPage: catalogPageNumber,
  timezone: blogTimezone, timezoneManual, calendarOpen: blogCalendarOpen, weatherOpen: blogWeatherOpen,
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
function header(page) {
  const parent =
    { work: "works", note: "notes", post: "community" }[page] || page;
  const support =
    page === "home"
      ? ""
      : `<a class="support-header" href="#/support">${t("支持", "Support")}</a>`;
  const personalAccount = page !== 'home' && siteContent
    ? `<button class="account-button" data-author-login>${siteContent.author ? esc(siteContent.author.name || t('我的账号','My account')) : t('登录','Sign in')}</button>` : '';
  const homeNav =
    page === "home"
      ? ""
      : `<a class="home-nav" href="#/home" aria-label="${t("返回首页", "Back to home")}">${t("首页", "Home")}</a>`;
  // The public-facing pages use one fixed space theme. Keep the theme state
  // for backwards-compatible routing, but do not expose a toggle in chrome.
  const themeToggle = "";
  document.querySelector("#site-header").innerHTML =
    `<a href="#/home" class="brand ${page === "home" ? "" : "brand-hidden"}" ${page === "home" ? "" : 'aria-hidden="true" tabindex="-1"'} aria-label="${t("無相 · 返回首页", "無相 · Back to home")}"><strong>無相</strong></a><nav class="nav" id="navigation" aria-label="${t("主导航", "Main navigation")}">${siteSections
      .map(
        ({ id, zh, en }) =>
          `<a href="#/${id}" ${parent === id ? 'aria-current="page"' : ""}>${t(zh, en)}</a>`,
      )
      .join(
        "",
      )}</nav><div class="header-actions">${homeNav}${support}${themeToggle}${page==='home'?`<button type="button" class="site-music-toggle ${musicIsPlaying?'is-playing':''}" data-action="site-music" aria-pressed="${musicIsPlaying}" aria-label="${musicIsPlaying?t('暂停音乐','Pause music'):t('播放音乐','Play music')}">${icons.disc}</button>`:''}<button class="language" data-action="language" aria-label="${t("Switch to English", "切换到中文")}">${t("中 / EN", "EN / 中")}</button>${personalAccount}<button class="icon-button menu-button" data-action="menu" aria-controls="navigation" aria-expanded="false" aria-label="${t("打开菜单", "Open menu")}">${icons.menu}</button></div>`;
}
function home() {
  return "";
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
    onPrepared: () => {
      const warm = () => preparePageImages(document,siteContent,{concurrency:1}).catch(() => {});
      if(window.requestIdleCallback) window.requestIdleCallback(warm);
      else window.setTimeout(warm, 0);
    },
    isBlocked: () =>
      (menuMedia.matches && Boolean(document.querySelector(".nav.open"))),
  });
}
const displayTitle = (item) => t(item.title, item.en || item.title);
const displaySummary = (item) =>
  t(item.summary, item.summaryEn || item.summary);
const categoryLabel = (name, list) => {
  if (name === "all") return t("全部", "All");
  const item = list.find((i) => i.category === name);
  return t(name, item?.categoryEn || name);
};
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
    items: ["all", ...new Set(items.map((item) => item.category))].map(
      (value) => ({ value, label: categoryLabel(value, items) }),
    ),
    onChange(value) {
      activeCategory = value;
      catalogPageNumber = 1;
      refreshResults();
    },
  });
}
function filtered(items) {
  return filterItems(items, activeCategory, activeQuery);
}
function emptyState() {
  return `<div class="empty"><h2>${t("暂时没有找到", "No matches yet")}</h2><p>${t("试试换一个关键词，或者查看全部内容。", "Try another word, or return to all content.")}</p><button class="text-link" data-action="clear-search" style="margin-top:20px">${t("清除筛选", "Clear filters")} ${icons.right}</button></div>`;
}
function worksPage() {
  return collectionPage('works', works, catalogState(), catalogUI());
}
function worksResults() {
  return catalogResults('works', works, catalogState(), catalogUI());
}
function notesResults() {
  const items = filtered(notes);
  return items.length
    ? items
        .map(
          (n, i) =>
            `<a class="blog-card ${n.coverSrc ? "has-cover" : ""}" href="#/note/${esc(n.id)}">${n.coverSrc ? `<div class="cover-frame"><img class="blog-post-cover" src="${esc(n.coverSrc)}" ${imageSources(n.coverSrc, '(max-width: 700px) 100vw, 800px')} decoding="async" alt="${esc(displayTitle(n))}" width="960" height="540" loading="lazy"></div>` : ''}<div class="blog-card-copy"><div class="blog-card-top"><span class="row-number">${String(i + 1).padStart(2, "0")}</span><span class="blog-date">${icons.calendar}${esc(noteDate(n))}</span></div><div class="eyebrow">${icons.document}${esc(categoryLabel(n.category, notes))}</div><h2>${esc(displayTitle(n))}</h2><p>${esc(displaySummary(n))}</p><div class="blog-card-bottom">${(n.tags || ['AI 学习','建站记录']).map(tag=>`<span class="tag" data-tone="${tagTone(tag)}">${esc(tag)}</span>`).join('')}${arrow}</div></div></a>`,
        )
        .join("")
    : emptyState();
}
function noticeItems() {
  if (siteContent) return siteContent.announcements;
  return [
    ["这里记录正在发生的事。", "A record of what is taking shape.", "AI 学习、作品制作与网站建设会逐步整理在这里。", "AI learning, project making, and site development will be organised here."],
    ["首页宇宙入口已完成。", "The immersive home is in place.", "首页保留空间场景，博客从导航进入，不打断首屏体验。", "The space scene remains the entrance; the blog opens from navigation."],
    ["博客内容会逐步更新。", "The blog will grow over time.", "文章、资料和作品会在准备好后陆续发布。", "Notes, resources, and work will be published as they are ready."],
  ].map(item=>({title:t(item[0],item[1]),summary:t(item[2],item[3])}));
}
function blogNotice() {
  const notices=noticeItems();
  if(!notices.length) return '';
  const slides=notices.map((item,index)=>`<div class="blog-notice-slide" aria-hidden="${index !== blogNoticeIndex}">${item.image?`<div class="cover-frame cover-frame--notice"><img class="blog-notice-poster" src="${esc(item.image)}" ${imageSources(item.image, '(max-width: 700px) 100vw, 800px')} decoding="async" alt="${esc(item.title)}" width="960" height="400"></div>`:''}<div class="blog-notice-copy"><span class="eyebrow">${icons.bell}${t("公告","NOTICE")}</span><h2>${esc(item.title)}</h2><p>${esc(item.summary)}</p>${item.link?`<a href="${esc(item.link)}" target="_blank" rel="noopener noreferrer" tabindex="${index===blogNoticeIndex?0:-1}">${t('查看公告','Read notice')} ${icons.right}</a>`:''}</div></div>`).join('');
  return `<div class="blog-notice" role="region" aria-label="${t("公告","Notices")}" aria-live="polite"><div class="blog-notice-slides">${slides}</div><div class="blog-notice-side"><span class="blog-notice-mark">${String(blogNoticeIndex+1).padStart(2,'0')} / ${String(notices.length).padStart(2,'0')}</span><div class="blog-notice-controls"><button data-action="blog-notice-prev" aria-label="${t("上一条公告","Previous notice")}">${icons.left}</button><button data-action="blog-notice-next" aria-label="${t("下一条公告","Next notice")}">${icons.right}</button></div></div></div>`;
}
function stopBlogNoticeRotation() {
  if (blogNoticeTimer) clearInterval(blogNoticeTimer);
  blogNoticeTimer = undefined;
}
function rotateBlogNotice(direction = 1) {
  const count=noticeItems().length;
  if(count<2) return;
  blogNoticeIndex = (blogNoticeIndex + direction + count) % count;
  const current = document.querySelector(".blog-notice");
  if (current) {
    current.querySelectorAll(".blog-notice-slide").forEach((slide, index) => {
      slide.setAttribute("aria-hidden", String(index !== blogNoticeIndex));
      slide.querySelectorAll('a').forEach(link=>link.tabIndex=index===blogNoticeIndex?0:-1);
    });
    const mark = current.querySelector(".blog-notice-mark");
    if (mark) mark.textContent = `${String(blogNoticeIndex + 1).padStart(2, "0")} / ${String(count).padStart(2,'0')}`;
  }
}
function syncBlogNoticeRotation(page) {
  stopBlogNoticeRotation();
  if (page !== "notes" || noticeItems().length<2) return;
  blogNoticeTimer = setInterval(() => rotateBlogNotice(1), 6500);
}
function blogDatePanel() {
  const parts = zonedDateParts(blogTimezone);
  const year = parts.year;
  const month = parts.month - 1;
  const today = parts.day;
  const monthName = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "long", timeZone: blogTimezone }).format(new Date());
  const firstDay = new Date(Date.UTC(year, month, 1, 12)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const weekdays = language === "zh" ? ["日", "一", "二", "三", "四", "五", "六"] : ["S", "M", "T", "W", "T", "F", "S"];
  const cells = Array.from({ length: firstDay + days }, (_, index) => {
    if (index < firstDay) return `<span class="calendar-empty" aria-hidden="true"></span>`;
    const day = index - firstDay + 1;
    return `<span class="calendar-day ${day === today ? "is-today" : ""}"${day === today ? ` aria-current="date"` : ""}>${day}</span>`;
  }).join("");
  const currentTime = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: blogTimezone }).format(new Date());
  const dayLabel = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit", timeZone: blogTimezone }).format(new Date());
  return `<div class="blog-side-card blog-date-card"><div class="date-panel-heading"><span class="eyebrow">${icons.clock}${t("时间与提醒", "TIME & NOTE")}</span><button class="calendar-toggle" data-action="blog-calendar" aria-expanded="${blogCalendarOpen}" aria-controls="blog-calendar-body">${blogCalendarOpen ? t("收起", "Close") : t("日历", "Calendar")} <span class="control-icon" aria-hidden="true">${icons.calendar}</span></button></div><div class="calendar-time" data-clock-time>${esc(currentTime)}</div><div class="calendar-head"><strong data-clock-day>${esc(dayLabel)}</strong><span data-clock-zone>${esc(blogTimezone)}</span></div><label class="timezone-label" for="blog-timezone">${t("当前时区", "TIME ZONE")}</label><div id="blog-timezone-control"></div><div id="blog-calendar-body" class="calendar-body" ${blogCalendarOpen ? "" : "hidden"}><div class="calendar-weekdays">${weekdays.map((day) => `<span>${day}</span>`).join("")}</div><div class="calendar-grid">${cells}</div><p>${t("下一节点 · 国庆节", "Next marker · National Day")}</p></div></div>`;
}
function zonedDateParts(timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).filter(({ type }) => ["year", "month", "day"].includes(type)).map(({ type, value }) => [type, Number(value)]));
  return values;
}
function updateBlogClock() {
  const time = document.querySelector("[data-clock-time]");
  const date = document.querySelector("[data-clock-day]");
  if (!time || !date) return;
  time.textContent = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: blogTimezone }).format(new Date());
  date.textContent = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit", timeZone: blogTimezone }).format(new Date());
}
function stopBlogClock() {
  if (blogClockTimer) clearInterval(blogClockTimer);
  blogClockTimer = undefined;
}
function syncBlogClock(page) {
  stopBlogClock();
  if (page === "notes") blogClockTimer = setInterval(updateBlogClock, 1000);
}
function weatherLocation() {
  return visitorWeatherPlace || [null,null,"等待定位","Location pending"];
}
async function requestWeatherLocation() {
  if (locatingWeather) return locatingWeather;
  attemptedLocation = true;
  const generation=++locationGeneration;
  const detail=document.querySelector('[data-weather-detail]');
  if(detail) detail.textContent=t('正在请求定位许可…','Requesting location permission…');
  locatingWeather=locateVisitor().then(place=>{
    if(generation!==locationGeneration) return;
    visitorWeatherPlace=place;
    syncBlogWeather(parseRoute(location.hash).page);
  }).catch(error=>{
    if(generation!==locationGeneration) return;
    const value=document.querySelector('[data-weather-value]');
    const detail=document.querySelector('[data-weather-detail]');
    if(value) value.textContent=t('请选择位置','Choose location');
    if(detail) detail.textContent=error.message;
  }).finally(()=>{locatingWeather=null;});
  return locatingWeather;
}
function weatherText(code) {
  const labels = {
    0: ["晴朗", "Clear sky"],
    1: ["基本晴朗", "Mainly clear"],
    2: ["局部多云", "Partly cloudy"],
    3: ["阴天", "Overcast"],
    45: ["雾", "Fog"],
    48: ["雾凇", "Rime fog"],
    51: ["小毛毛雨", "Light drizzle"],
    53: ["毛毛雨", "Drizzle"],
    55: ["较强毛毛雨", "Dense drizzle"],
    61: ["小雨", "Light rain"],
    63: ["中雨", "Rain"],
    65: ["大雨", "Heavy rain"],
    71: ["小雪", "Light snow"],
    73: ["中雪", "Snow"],
    75: ["大雪", "Heavy snow"],
    80: ["阵雨", "Rain showers"],
    81: ["阵雨", "Rain showers"],
    82: ["强阵雨", "Heavy showers"],
    95: ["雷雨", "Thunderstorm"],
    96: ["雷雨伴冰雹", "Thunderstorm with hail"],
    99: ["强雷雨伴冰雹", "Heavy thunderstorm with hail"],
  };
  return labels[code] || ["天气状况未知", "Conditions unavailable"];
}
function weatherGlyph(code, isDay = 1) {
  if (code === 0) return isDay ? icons.sun : icons.moon;
  if ([1, 2].includes(code)) return isDay ? icons["cloud-sun"] : icons.moon;
  if ([3, 45, 48, 51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return icons["cloud-sun"];
  if ([95, 96, 99].includes(code)) return icons.sun;
  return icons["cloud-sun"];
}
function blogWeatherPanel() {
  const [, , cityZh, cityEn] = weatherLocation();
  return `<div class="blog-side-card blog-weather-card"><div class="weather-heading"><span class="eyebrow">${icons["cloud-sun"]}${t("天气", "WEATHER")}</span><span class="weather-source">${t("实时", "LIVE")}</span></div><div class="weather-line"><span class="weather-orb" data-weather-glyph aria-hidden="true">${icons.sun}</span><div><strong data-weather-value>${t("正在获取…", "Loading…")}</strong><span class="weather-location" data-weather-location>${t(cityZh, cityEn)}</span></div></div><div class="weather-range" data-weather-range>${t("最高 —°C · 最低 —°C", "High —°C · Low —°C")}</div><button class="weather-details-toggle" data-action="weather-details" aria-expanded="${blogWeatherOpen}" aria-controls="blog-weather-details">${blogWeatherOpen ? t("收起详情", "Hide details") : t("查看详情", "View details")} <span class="control-icon" aria-hidden="true">${icons.document}</span></button><div id="blog-weather-details" class="weather-details" ${blogWeatherOpen ? "" : "hidden"}><div><span>${t("风力", "WIND")}</span><strong data-weather-wind>—</strong></div><div><span>${t("能见度", "VISIBILITY")}</span><strong data-weather-visibility>—</strong></div><div><span>${t("湿度", "HUMIDITY")}</span><strong data-weather-humidity>—</strong></div><div><span>${t("气压", "PRESSURE")}</span><strong data-weather-pressure>—</strong></div><div><span>${t("降水量", "PRECIPITATION")}</span><strong data-weather-precipitation>—</strong></div><div><span>${t("日出", "SUNRISE")}</span><strong data-weather-sunrise>—</strong></div></div><details class="weather-city-picker"><summary>${t("位置设置", "Location")}</summary><button type="button" data-action="weather-locate">${icons.clock}${t("使用当前位置", "Use my location")}</button><form id="weather-city-search"><label class="search"><input name="city" minlength="2" required aria-label="${t("搜索天气城市", "Search weather city")}" placeholder="${t("城市名称", "City name")}"></label><button type="submit">${icons.search}${t("搜索", "Search")}</button></form><div data-weather-cities role="status"></div></details><p data-weather-detail>${t("正在连接公开天气服务。", "Connecting to a public weather service.")}</p></div>`;
}
function syncBlogWeather(page) {
  clearTimeout(weatherRefreshTimer);
  if (blogWeatherAbort) blogWeatherAbort.abort();
  blogWeatherAbort = undefined;
  blogWeatherRequest = undefined;
  if (page !== "notes" || document.hidden || typeof fetch !== "function") {stopWeatherWatch?.();stopWeatherWatch=undefined;return;}
  if (!visitorWeatherPlace) {
    if (!attemptedLocation) requestWeatherLocation();
    else if (!locatingWeather) {
      const status=document.querySelector('[data-weather-detail]');
      if(status) status.textContent=t('请允许定位或搜索城市。','Allow location or search a city.');
      const value=document.querySelector('[data-weather-value]');
      if(value) value.textContent=t('请选择位置','Choose location');
    }
    return;
  }
  if(!manualWeatherPlace&&!stopWeatherWatch)stopWeatherWatch=watchVisitorLocation(next=>{
    if(manualWeatherPlace||document.hidden||parseRoute(location.hash).page!=='notes')return;
    if(next[0]===visitorWeatherPlace?.[0]&&next[1]===visitorWeatherPlace?.[1])return;
    visitorWeatherPlace=next;syncBlogWeather('notes');
  });
  weatherRefreshTimer=setTimeout(()=>syncBlogWeather(parseRoute(location.hash).page),10*60*1000);
  const [latitude, longitude, cityZh, cityEn] = weatherLocation();
  const key = `${latitude}:${longitude}:${language}`;
  blogWeatherKey = key;
  const controller = new AbortController();
  blogWeatherAbort = controller;
  blogWeatherRequest = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,visibility,precipitation,surface_pressure,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=1&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto`, { signal: controller.signal })
    .then((response) => {
      if (!response.ok) throw new Error(`weather ${response.status}`);
      return response.json();
    })
    .then((data) => {
      if (blogWeatherKey !== key || parseRoute(location.hash).page !== "notes") return;
      if(!Number.isFinite(data.current?.temperature_2m)||!Number.isFinite(data.current?.weather_code))throw new Error('Incomplete weather data');
      const value = document.querySelector("[data-weather-value]");
      const detail = document.querySelector("[data-weather-detail]");
      const place = document.querySelector("[data-weather-location]");
      const [labelZh, labelEn] = weatherText(data.current?.weather_code);
      if (value) value.textContent = `${Math.round(Number(data.current?.temperature_2m))}°C · ${t(labelZh, labelEn)}`;
      if (place) place.textContent = t(cityZh, cityEn);
      const range = document.querySelector("[data-weather-range]");
      const wind = document.querySelector("[data-weather-wind]");
      const visibility = document.querySelector("[data-weather-visibility]");
      const humidity = document.querySelector("[data-weather-humidity]");
      const pressure = document.querySelector("[data-weather-pressure]");
      const precipitation = document.querySelector("[data-weather-precipitation]");
      const sunrise = document.querySelector("[data-weather-sunrise]");
      const glyph = document.querySelector("[data-weather-glyph]");
      const current = data.current || {};
      const daily = data.daily || {};
      const formatClock = (value) => value ? value.split("T").pop().slice(0, 5) : "—";
      if (range) range.textContent = t(`最高 ${Math.round(Number(daily.temperature_2m_max?.[0]))}°C · 最低 ${Math.round(Number(daily.temperature_2m_min?.[0]))}°C`, `High ${Math.round(Number(daily.temperature_2m_max?.[0]))}°C · Low ${Math.round(Number(daily.temperature_2m_min?.[0]))}°C`);
      if (wind) wind.textContent = `${Math.round(Number(current.wind_speed_10m) || 0)} km/h`;
      if (visibility) visibility.textContent = `${Math.round((Number(current.visibility) || 0) / 1000)} km`;
      if (humidity) humidity.textContent = `${Math.round(Number(current.relative_humidity_2m) || 0)}%`;
      if (pressure) pressure.textContent = `${Math.round(Number(current.surface_pressure) || 0)} hPa`;
      if (precipitation) precipitation.textContent = `${Number(current.precipitation || 0).toFixed(1)} mm`;
      if (sunrise) sunrise.textContent = formatClock(daily.sunrise?.[0]);
      if (glyph) glyph.innerHTML = weatherGlyph(current.weather_code, current.is_day);
      if (detail) detail.textContent = t(`更新于 ${current.time?.replace("T", " ") || ""}`, `Updated ${current.time?.replace("T", " ") || ""}`);
    })
    .catch(() => {
      if (controller.signal.aborted || blogWeatherKey !== key) return;
      const value = document.querySelector("[data-weather-value]");
      const detail = document.querySelector("[data-weather-detail]");
      if (value) value.textContent = t("暂时无法获取", "Unavailable");
      if (detail) detail.textContent = t("公开天气服务暂时没有响应。", "The public weather service did not respond.");
    });
}
function blogMusicPanel() {
  const music=siteContent?.profile?.music || {};
  return `<div class="blog-side-card blog-music-card"><span class="eyebrow">${icons.music}${t("音乐", "MUSIC")}</span>${music.tracks?.length ? `<div id="blog-audio-player" aria-label="${esc(music.title || t('音乐歌单','Playlist'))}"></div>` : `<div class="music-heading"><strong>${esc(music.title || t("音乐歌单","Playlist"))}</strong></div><p>${t("听一些喜欢的歌。","A few songs I enjoy.")}</p>`}${music.playlistUrl ? `<a class="music-platform-link" href="${esc(music.playlistUrl)}" target="_blank" rel="noopener noreferrer">${icons.music}${t("前往平台听歌单","Open playlist")} ${icons.right}</a>` : ''}${!music.tracks?.length && !music.playlistUrl ? `<p class="subtle">${t("歌单待更新","Playlist coming soon")}</p>` : ''}</div>`;
}
function blogTagsPanel() {
  const tags = [...new Set(notes.flatMap(note=>note.tags||['AI 学习','建站记录']))];
  return `<div class="blog-side-card blog-tags-card"><span class="eyebrow">${icons.tags}${t("标签", "TAGS")}</span><div class="blog-tags">${tags.map((tag) => `<button type="button" data-blog-tag="${esc(tag)}" class="tag" data-tone="${tagTone(tag)}">${esc(tag)}</button>`).join("")}</div><p>${t("标签会随着文章内容增加。", "Tags will grow with the notes.")}</p></div>`;
}
function adBox() {
  return `<aside class="ad-box"><span class="tag">${t("赞助展示位 · 预留", "SPONSOR PLACEMENT")}</span><h2>${t("让好作品被看见", "Good work deserves an audience")}</h2><p>${t("这里留给契合内容的品牌合作。<br>当前没有投放广告。", "A place for relevant brand partnerships.<br>No advertisement is currently running.")}</p><a href="#/contact" class="text-link">${t("了解合作", "Let’s talk")}${arrow}</a></aside>`;
}
function blogAuthorPanel() {
  const profile=siteContent?.profile;
  if(!profile) return `<div class="blog-identity"><span class="eyebrow">${icons.user}${t("内容作者", "AUTHOR")}</span><div class="identity-mark" aria-hidden="true">無</div><h2>無相</h2><p>${t("AI · 创作 · 学习", "AI · Making · Learning")}</p><div class="identity-line"></div><span class="subtle">${t("把想法做成可以被看见的作品。", "Turning ideas into work that can be seen.")}</span><nav class="identity-links" aria-label="${t("站内入口", "Site links")}"><a href="#/community" aria-label="${t("社区交流", "Community")}">${icons.link}</a><a href="#/resource-center" aria-label="${t("资源中心", "Resource center")}">${icons.document}</a><a href="#/contact" aria-label="${t("联系", "Contact")}">${icons.right}</a></nav></div>`;
  const tags=[...new Set(notes.flatMap(note=>note.tags||[]))];
  return `<div class="blog-identity">${profile.avatar?`<img class="identity-avatar" src="${esc(profile.avatar)}" ${imageSources(profile.avatar, '136px')} decoding="async" alt="${esc(profile.name)}" width="136" height="136">`:'<div class="identity-mark" aria-hidden="true">無</div>'}<h2>${esc(profile.name)}</h2><p>${esc(profile.signature)}</p><div class="identity-line"></div><span class="subtle identity-bio">${esc(profile.bio)}</span><p class="identity-count">${notes.length} ${t('篇文章','articles')} · ${tags.length} ${t('个标签','tags')}</p><nav class="identity-links" aria-label="${t('作者其他平台','Author links')}">${profile.socialLinks.map(link=>`<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(link.label || socialPlatform(link.url)?.name || "个人主页")}" title="${esc(link.label || socialPlatform(link.url)?.name || "个人主页")}">${socialIcon(link.url, icons.link)}<span class="sr-only">${esc(link.label || socialPlatform(link.url)?.name || "个人主页")}</span></a>`).join('')}</nav></div>`;
}
function notesPage() {
  const nextView = blogView === "list" ? t("切换为网格", "Switch to grid") : t("切换为列表", "Switch to list");
  return `<section class="page catalog-page blog-page fade-in" data-section="notes"><header class="blog-masthead"><div><div class="eyebrow">BLOG / NOTES</div><h1 id="blog-page-title">${t("博客 · 记录与发现", "Blog · Notes & findings")}</h1><p>${t("把学习、创作和建设过程整理成可以回看的片段。", "A considered record of learning, making, and building.")}</p></div><span class="page-meta">${t("持续更新", "ONGOING")}</span></header><div class="blog-layout"><aside class="blog-left" aria-label="${t("作者与博客辅助信息", "Author and blog information")}">${blogAuthorPanel()}${blogMusicPanel()}${blogTagsPanel()}</aside><section class="blog-main" aria-labelledby="blog-page-title">${blogNotice()}<section class="blog-article-area" aria-labelledby="blog-article-heading"><div class="blog-toolbar"><h2 id="blog-article-heading" class="sr-only">${t("博客文章", "Blog articles")}</h2><div id="category-filter"></div><label class="search">${icons.search}<input type="search" id="content-search" placeholder="${t("搜索博客文章", "Search notes")}" aria-label="${t("搜索博客文章", "Search notes")}" value="${esc(activeQuery)}"></label><button class="blog-view-button blog-view-switch" data-action="blog-view" data-view="${blogView === "list" ? "grid" : "list"}" aria-label="${esc(nextView)}">${blogView === "list" ? t("列表", "List") : t("网格", "Grid")} ${icons.grid}</button></div><div class="blog-results ${blogView === "grid" ? "is-grid" : ""}" id="results">${notesResults()}</div></section></section><aside class="blog-sidebar" aria-label="${t("辅助信息", "Supporting information")}">${blogWeatherPanel()}${blogDatePanel()}</aside></div></section>`;
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
  if(id) return libraryDetail(resourceCenter.find(item=>item.id===id),'resource-center');
  return collectionPage('resource-center',resourceCenter,catalogState(),catalogUI());
}
function closedPage(section, title, message) {
  return `<section class="page catalog-page" data-section="${section}">${pageHeading(section.toUpperCase(),title,message)}<div class="empty" data-content-state="not-open"><p>${t('你可以先浏览博客、作品与资料。','Explore the blog, projects and learning materials.')}</p><a class="button" href="#/notes">${t('浏览博客','Read the blog')} ${arrow}</a></div></section>`;
}
function communityPage() {
  return closedPage('community',t('社区交流','Community'),t('社区正在准备中，暂未开放注册与讨论。','The community is being prepared. Registration and discussions are not open yet.'));
}
function sectionsHTML(item) {
  if (typeof item.bodyHTML === 'string') return item.bodyHTML;
  return t(item.sections, item.sectionsEn)
    .map(([title, body]) => `<h2>${esc(title)}</h2><p>${esc(body)}</p>`)
    .join("");
}
function articlePage(kind, id) {
  const isWork = kind === "work";
  const item = (!isWork && siteContent?.preview?.id === id) ? siteContent.preview : (isWork ? works : notes).find((x) => x.id === id);
  if (!item) return notFound();
  return `<section class="page fade-in"><article class="article ${isWork ? "" : "reading-article"}"><a class="back-link" href="#/${isWork ? "works" : "notes"}">${icons.left} ${t(isWork ? "返回作品集" : "返回博客", isWork ? "Back to work" : "Back to blog")}</a><div class="eyebrow">${isWork ? "PROJECT ARCHIVE" : "FIELD NOTES"} / ${esc(categoryLabel(item.category, isWork ? works : notes))}</div><h1>${esc(displayTitle(item))}</h1><div class="post-tags"><span>${esc(siteContent?.profile?.name || "無相")}</span>${item.date ? `<time datetime="${esc(item.date)}">${esc(noteDate(item))}</time>` : ""}${(item.tags||[]).map(tag=>`<span class="article-meta-tag">${esc(tag)}</span>`).join("")}</div><p class="article-intro">${esc(displaySummary(item))}</p>${item.coverSrc ? `<div class="cover-frame"><img class="article-cover" src="${esc(item.coverSrc)}" ${imageSources(item.coverSrc, '(max-width: 960px) 100vw, 960px')} decoding="async" alt="${esc(t(item.coverAlt || item.title, item.coverAltEn || item.en || item.title))}"></div>` : ""}<div class="article-body">${siteContent?.preview === item ? `<p class="article-preview-label" role="status">作者预览 · 此预览仅登录作者可见</p>` : ""}${sectionsHTML(item)}${item.attachments?.length ? `<section class="article-attachments"><h2>${t("附件下载","Attachments")}</h2>${item.attachments.map(file=>`<a class="text-link" href="${esc(file.url)}" download>${icons.download}${esc(file.name)}</a>`).join("")}</section>` : ""}</div><div class="article-bottom"><span class="subtle">${t(isWork ? "有相似的想法？一起聊聊。" : "有自己的观察？欢迎继续交流。", isWork ? "Have something in mind? Let’s talk." : "Something to add? Keep the conversation going.")}</span><a class="text-link" href="#/${isWork ? "contact" : "community"}">${t(isWork ? "联系与合作" : "进入社区", isWork ? "Let’s talk" : "Visit the community")}${arrow}</a></div></article></section>`;
}
function postPage() { return communityPage(); }
function supportPage() {
  return closedPage('support',t('赞助与支持','Support'),t('感谢你的关注。赞助渠道暂未开放。','Thank you for your interest. Support channels are not open yet.'));
}
function contactPage() {
  return closedPage('contact',t('联系与合作','Contact'),t('合作联系方式正在准备中。','Contact details will be available here.'));
}
function accountPage() { return communityPage(); }
function notFound() {
  return `<section class="page"><div class="empty" style="margin-top:50px"><div class="eyebrow" style="justify-content:center;margin-bottom:20px">404 / A LITTLE OFF TRACK</div><h1>${t("这个角落还没有内容。", "Nothing here just yet.")}</h1><p style="margin:20px 0 28px">${t("这条链接可能已变更，或内容尚未公开。", "The link may have changed, or this content is not public yet.")}</p><a class="button" href="#/home">${t("回到首页", "Back home")} ${arrow}</a></div></section>`;
}
function render({silent=false}={}) {
  setupStage();
  musicModule?.parkSiteMusic();
  document.body.dataset.blogAccent=siteContent?.profile?.appearance?.accent || "blue";
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
  if(personalPage(page) && blogPhoto && !blogPhoto.hasAttribute('src')) {
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
    notes: notesPage,
    resources: resourcesPage,
    software: softwarePage,
    "resource-center": resourceCenterPage,
    community: communityPage,
    support: supportPage,
    contact: contactPage,
    account: accountPage,
    work: () => libraryDetail(works.find(item => item.id === id), 'works'),
    note: () => articlePage("note", id),
    post: () => postPage(id),
  };
  categoryUI?.dispose();
  categoryUI = undefined;
  cleanTimezone?.();
  cleanTimezone = undefined;
  cleanGlassSurfaces();
  main.innerHTML = (views[page] || notFound)();
  cleanArticleReading=enhanceArticleReading(main.querySelector(".reading-article"),{english:language==="en"});
  mountBlogGlassSurfaces();
  const musicHost=document.querySelector("#blog-audio-player");
  const musicGeneration=++musicRenderGeneration;
  if(siteContent?.profile?.music?.tracks?.length || musicModule) import('./music.bundle.mjs').then(module=>{
    if(musicGeneration!==musicRenderGeneration) return;
    musicModule=module;
    module.mountSiteMusic(musicHost,siteContent?.profile?.music,musicState);
    musicState(musicIsPlaying);
  }).catch(()=>{ if(musicHost?.isConnected) musicHost.textContent=t('播放器暂时无法载入。','Player unavailable.'); });
  const timezoneHost = document.querySelector("#blog-timezone-control");
  if (timezoneHost) cleanTimezone = mountTimezoneSelect(timezoneHost, {
    value: timezoneManual ? blogTimezone : "auto",
    locale: language === 'zh' ? 'zh-CN' : 'en-US',
    label: t("选择时区", "Choose time zone"),
    onChange: changeBlogTimezone,
  });
  syncBlogNoticeRotation(page);
  syncBlogClock(page);
  syncBlogWeather(page);
  connectFilters(page);
  // Initial rendering and blog navigation must not run an entrance transform.
  // Other route changes retain their short entrance motion.
  if (!silent && hasRenderedOnce && !personalPage(page)) enterPage(main.firstElementChild);
  hasRenderedOnce = true;
  document.title =
    page === "home"
      ? t("無相 · 博客与作品", "無相 · Blog and work")
      : `${t({ works: "作品", work: "作品详情", notes: "博客", note: "博客文章", resources: "资料", software: "软件推荐", "resource-center": "资源中心", community: "社区交流", post: "社区讨论", support: "赞助与支持", contact: "联系与合作", account: "个人空间" }[page] || "页面未找到", { works: "Work", work: "Project", notes: "Blog", note: "Blog post", resources: "Learning materials", software: "Software", "resource-center": "Resource center", community: "Community", post: "Discussion", support: "Support", contact: "Contact", account: "Your space" }[page] || "Page not found")} · 無相`;
  document.querySelector("#site-footer").innerHTML =
    `<span>© 無相</span><a class="site-registration" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">豫ICP备2026037683号-1</a><div class="footer-links"><a href="#/contact">${t("联系与合作", "Contact")}</a><a href="#/support">${t("赞助与支持", "Support")}</a><span>${t("记录 · 创作 · 分享", "Learn · Create · Share")}</span></div>${page==='notes'?`<span class="weather-attribution">${t('天气数据','Weather data')}：<a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> · ${t('城市数据','Location data')}：<a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></span>`:''}`;
}
function refreshResults() {
  const page = parseRoute(location.hash).page;
  const renderer = {
    works: worksResults,
    notes: notesResults,
    resources: resourceResults,
    software: () => catalogResults('software', software, catalogState(), catalogUI()),
    'resource-center':()=>catalogResults('resource-center',resourceCenter,catalogState(),catalogUI()),
  }[page];
  if (renderer && document.querySelector("#results")) {
    const results = document.querySelector("#results");
    cleanGlassSurfaces(results);
    results.innerHTML = renderer();
    mountBlogGlassSurfaces(results);
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
    case 'catalog-view': {
      if (!['software','resource-center'].includes(parseRoute(location.hash).page) || a.disabled) break;
      catalogView = catalogView === 'grid' ? 'list' : 'grid';
      document.querySelector('.catalog-grid')?.classList.toggle('is-list',catalogView==='list');
      syncCatalogViewButton();
      break;
    }
    case "language":
      language = language === "zh" ? "en" : "zh";
      render();
      document.querySelector('[data-action="language"]').focus();
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
      const scrollY = window.scrollY;
      blogCalendarOpen = !blogCalendarOpen;
      const body = document.querySelector("#blog-calendar-body");
      if (body) body.hidden = !blogCalendarOpen;
      a.setAttribute("aria-expanded", String(blogCalendarOpen));
      a.firstChild.textContent = `${blogCalendarOpen ? t("收起", "Close") : t("日历", "Calendar")} `;
      afterLayout(() => {
        if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: "instant" });
      });
      break;
    }
    case "weather-details": {
      const scrollY = window.scrollY;
      blogWeatherOpen = !blogWeatherOpen;
      const details = document.querySelector("#blog-weather-details");
      if (details) details.hidden = !blogWeatherOpen;
      a.setAttribute("aria-expanded", String(blogWeatherOpen));
      a.firstChild.textContent = `${blogWeatherOpen ? t("收起详情", "Hide details") : t("查看详情", "View details")} `;
      afterLayout(() => {
        if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: "instant" });
      });
      break;
    }
    case "blog-notice-prev":
      rotateBlogNotice(-1);
      break;
    case "blog-notice-next":
      rotateBlogNotice(1);
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
    refreshResults();
  }
});
function changeBlogTimezone(value) {
  timezoneManual = value !== "auto";
  blogTimezone = value === "auto" ? localTimezone : value;
  updateBlogClock();
  const zone = document.querySelector("[data-clock-zone]");
  if (zone) zone.textContent = blogTimezone;
  const calendar = document.querySelector("#blog-calendar-body");
  if (calendar) {
    const next = document.createElement("div");
    next.innerHTML = blogDatePanel();
    calendar.innerHTML = next.querySelector("#blog-calendar-body").innerHTML;
  }
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (e.defaultPrevented || document.querySelector('.blog-timezone-menu[data-state="open"]')) return;
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
window.addEventListener("hashchange", () => {
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
  (parseRoute(location.hash).page === "home"
    ? homeRoot.querySelector(".universe-stage")
    : main
  ).focus({ preventScroll: true });
});
window.addEventListener("pagehide", (e) => {
  if (!e.persisted) {
    stopBlogNoticeRotation();
    stopBlogClock();
    blogWeatherAbort?.abort();
    // The browser owns disposal of a departing document. Unmounting React
    // here collapses the still-visible cards, clamps scrollY, and changes the
    // position the browser saves for reload. Keep the last frame intact.
    // In-document route changes still dispose their own roots in render().
  }
});
window.addEventListener('author:identity',event=>{
  if(!siteContent)return;
  siteContent.author=event.detail;
  const y=scrollY;render({silent:true});window.scrollTo({top:y,behavior:'instant'});
});
window.addEventListener('author:content',async event=>{
  const y=scrollY;
  siteContent=event.detail;resourceCenter=siteContent['resource-center']||[];notes=siteContent.notes;resources=siteContent.resources;software=siteContent.software;works=siteContent.works||[];
  const background=siteContent.profile?.background||'./assets/materials/blog-space.png';
  if(blogPhoto&&blogPhoto.getAttribute('src')!==background){const photo=new Image();photo.sizes='100vw';photo.srcset=imageSourceSet(background);photo.src=background;try{await photo.decode();blogPhoto.sizes=photo.sizes;blogPhoto.srcset=photo.srcset;blogPhoto.src=background;}catch{}}
  render({silent:true});window.scrollTo({top:y,behavior:'instant'});
});

render();
// All synchronous wrappers, filters and expanded regions are in place now.
// Restore before yielding a frame, without an entrance animation or scroll tween.
window.sansphasePageSession?.commit();


document.addEventListener("click", event => {
  const tag=event.target.closest("[data-blog-tag]");
  if (!tag) return;
  activeCategory="all";
  const input=document.querySelector("#content-search");
  if (input) { input.value=tag.dataset.blogTag; input.dispatchEvent(new Event("input", {bubbles:true})); }
});

document.addEventListener('click',event=>{
  if(event.target.closest('[data-action="weather-locate"]')) { manualWeatherPlace=false;visitorWeatherPlace=null; requestWeatherLocation(); }
  const city=event.target.closest('[data-weather-city]');
  if(city && weatherCityResults[Number(city.dataset.weatherCity)]) {
    locationGeneration++;
    manualWeatherPlace=true;stopWeatherWatch?.();stopWeatherWatch=undefined;
    visitorWeatherPlace=weatherCityResults[Number(city.dataset.weatherCity)];
    weatherCityAbort?.abort();
    const picker=city.closest('details'); if(picker) picker.open=false;
    syncBlogWeather(parseRoute(location.hash).page);
  }
});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&!timezoneManual){localTimezone=visitorTimezone();blogTimezone=localTimezone;updateBlogClock();}
  const page=parseRoute(location.hash).page;
  if(document.hidden)syncBlogWeather(page);
  else if(page==='notes'){if(manualWeatherPlace)syncBlogWeather(page);else requestWeatherLocation();}
});
if(navigator.permissions?.query)navigator.permissions.query({name:'geolocation'}).then(permission=>{
  permission.addEventListener('change',()=>{
    if(permission.state==='granted'&&!manualWeatherPlace&&!document.hidden&&parseRoute(location.hash).page==='notes')requestWeatherLocation();
  });
}).catch(()=>{});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='weather-city-search') return;
  event.preventDefault();
  const result=document.querySelector('[data-weather-cities]');
  weatherCityAbort?.abort(); const controller=new AbortController(); weatherCityAbort=controller;
  result.textContent=t('正在搜索…','Searching…');
  try {
    const cities=await searchWeatherCities(new FormData(event.target).get('city'),{signal:controller.signal});
    if(!result.isConnected || controller.signal.aborted) return;
    weatherCityResults=cities;
    result.innerHTML=cities.length ? cities.map((city,i)=>`<button type="button" data-weather-city="${i}">${esc(city[2])}</button>`).join('') : t('没有找到，请尝试英文名或附近城市。','No results. Try another name or a nearby city.');
  }catch(error){ if(!controller.signal.aborted && result.isConnected) result.textContent=error.message; }
});
