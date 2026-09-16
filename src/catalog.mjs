import { escapeHTML as esc, filterItems } from "./core.mjs";
import {imageSources} from './image-sources.mjs';

// Shared presentation for three independent author-managed collections.
export const catalogKinds = {
  'resource-center': {
    label:['资源中心','Resource center'],title:['资源中心 · 收藏与分享','Resources · Collections & sharing'],
    kicker:'RESOURCE CENTER',icon:'download',search:['搜索资源名称、分类或标签','Search resources, categories or tags'],
    description:['分享收藏的素材、工具与资源，查看介绍后按需下载。','Curated assets, tools and resources. Read the description before downloading.'],
    empty:['资源尚未发布','No resources published yet'],link:['来源链接','Source link'],
  },
  works: {
    label: ["作品", "Work"],
    title: ["作品 · 软件与创作", "Work · Software & making"],
    kicker: "WORK / SOFTWARE",
    icon: "grid",
    search: ["搜索软件名称、功能或标签", "Search software, features or tags"],
    description: [
      "自己开发的软件，记录从想法到实现的过程。",
      "Software I build, from the first idea to the finished tool.",
    ],
    empty: ["作品尚未发布", "Projects are not published yet"],
    link: ["项目链接", "Project link"],
  },
  resources: {
    label: ["资料", "Learning materials"],
    title: ["资料 · 学习与实践", "Learning · Resources & practice"],
    kicker: "LEARNING / MATERIALS",
    icon: "document",
    search: ["搜索资料名称、用途或标签", "Search materials, purpose or tags"],
    description: [
      "整理学习资料、实践笔记和模板，先了解用途，再选择下载。",
      "Learning resources, practical notes and templates. Read before downloading.",
    ],
    empty: ["资料尚未发布", "Materials are not published yet"],
    link: ["来源链接", "Source link"],
  },
  software: {
    label: ["软件推荐", "Software"],
    title: ["软件推荐 · 工具与体验", "Software · Tools & experience"],
    kicker: "SOFTWARE / RECOMMENDATIONS",
    icon: "grid",
    search: ["搜索软件名称、用途或标签", "Search software, purpose or tags"],
    description: [
      "分享软件的用途、使用方法与体验，帮助你找到合适的工具。",
      "Software purpose, usage and experience to help you find the right tools.",
    ],
    empty: ["推荐清单尚未发布", "Recommendations are not published yet"],
    link: ["官方网站", "Official website"],
  },
};
const href = (kind, item) =>
  `#/${kind === "works" ? "work" : kind}/${encodeURIComponent(item.id)}`;
const exhibition = (kind) => kind === "works" || kind === "resources";
export function catalogViewPresentation(view, { t, icons }, available = true) {
  const isList = view === "list";
  return {
    disabled: !available,
    label: !available
      ? t("暂无内容可切换", "No content to switch")
      : isList
        ? t("切换为网格", "Switch to grid")
        : t("切换为列表", "Switch to list"),
    html: `${isList ? icons.list : icons.grid}<span>${isList ? t("列表", "List") : t("网格", "Grid")}</span>`,
  };
}
const safeURL = (value) => {
  if (typeof value !== "string") return "";
  if (/^(?:\/api\/media\/|\.\/assets\/)/.test(value) && !/[\\\s]/.test(value))
    return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};
const title = (item, t) => t(item.title, item.en || item.title);
const summary = (item, t) =>
  t(item.summary || "", item.summaryEn || item.summary || "");
const date = (value) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString().slice(0, 10).replaceAll("-", " / ")
    : "";
export function fileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${+(bytes / 1024).toFixed(1)} KB`;
  return `${+(bytes / 1048576).toFixed(1)} MB`;
}
export function selectCatalogItems(
  items,
  { category = "all", query = "", page = 1 } = {},
) {
  const matched = filterItems(items, category, query);
  const pages = Math.max(1, Math.ceil(matched.length / 12));
  const current = Math.min(
    pages,
    Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1),
  );
  return {
    items: matched.slice((current - 1) * 12, current * 12),
    total: matched.length,
    page: current,
    pages,
  };
}
function tags(item, ui) {
  return (item.tags || [])
    .map(
      (tag) =>
        `<span class="tag" data-tone="${ui.tagTone(tag)}">${esc(tag)}</span>`,
    )
    .join("");
}
function cover(item, ui, sizes = '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 25vw') {
  const src = safeURL(item.coverSrc);
  return src
    ? `<div class="cover-frame"><img class="catalog-cover" src="${esc(src)}" ${imageSources(src, sizes)} alt="${esc(title(item, ui.t))}" width="960" height="540" loading="lazy" decoding="async"></div>`
    : "";
}
function actions(kind, item, ui) {
  const download = safeURL(item.downloadUrl);
  const external = safeURL(item.externalUrl);
  return `${download ? `<a class="text-link catalog-action" href="${esc(download)}" download="${esc(item.file || "")}" aria-label="${esc(ui.t("下载 ", "Download ") + title(item, ui.t))}">${ui.icons.download}${ui.t("下载文件", "Download")}</a>` : ""}${external ? `<a class="text-link catalog-action" href="${esc(external)}" target="_blank" rel="noopener noreferrer">${ui.icons.link}${ui.t(...catalogKinds[kind].link)}</a>` : ""}`;
}
function card(kind, item, ui) {
  const { t, icons } = ui;
  const image = cover(item, ui);
  if (exhibition(kind)) {
    return `<article class="blog-card catalog-card catalog-poster ${image ? "has-cover" : ""}"><a class="catalog-cover-link" href="${href(kind, item)}" tabindex="-1" aria-hidden="true">${image}</a><div class="catalog-card-copy"><h2><a class="catalog-card-title" href="${href(kind, item)}">${esc(title(item, t))}</a></h2><p>${esc(summary(item, t))}</p></div></article>`;
  }
  return `<article class="blog-card catalog-card catalog-poster ${image ? "has-cover" : ""}"><a class="catalog-cover-link" href="${href(kind, item)}" tabindex="-1" aria-hidden="true">${image}</a><div class="catalog-card-copy"><div class="catalog-card-meta"><span class="eyebrow">${icons[catalogKinds[kind].icon]}${esc(t(item.category,item.categoryEn||item.category) || t(...catalogKinds[kind].label))}</span>${date(item.date) ? `<time datetime="${esc(item.date)}">${date(item.date)}</time>` : ""}</div><h2><a class="catalog-card-title" href="${href(kind, item)}">${esc(title(item, t))}</a></h2><p>${esc(summary(item, t))}</p><div class="catalog-tags">${tags(item, ui)}</div><div class="catalog-card-actions"><a class="text-link catalog-read" href="${href(kind, item)}">${t("查看介绍", "Read more")}${icons.right}</a>${actions(kind, item, ui)}</div></div></article>`;
}
export function catalogResults(kind, all, state, ui) {
  const { t, icons } = ui;
  const selected = selectCatalogItems(all, state);
  if (!all.length) {
    const placeholder = `<div class="blog-side-card catalog-empty" data-content-state="${kind === "software" ? "no-recommendations" : "unpublished"}"><div class="empty">${icons[catalogKinds[kind].icon]}<h2>${t(...catalogKinds[kind].empty)}</h2><p>${t("整理完成的内容会在这里发布。", "Finished content will be published here.")}</p>${kind === "works" ? `<a class="text-link" href="#/contact">${t("联系与合作", "Contact & collaboration")}${icons.right}</a>` : ""}</div></div>`;
    return kind === "software"
      ? `<div class="catalog-grid catalog-placeholder-grid ${state.view === "list" ? "is-list" : ""}">${placeholder}</div>`
      : placeholder;
  }
  if (!selected.total)
    return `<div class="blog-side-card catalog-empty"><div class="empty"><h2>${t("暂时没有找到", "No matches yet")}</h2><p>${t("试试其他关键词，或者清除筛选。", "Try another keyword, or clear the filters.")}</p><button type="button" data-action="clear-search">${t("清除筛选", "Clear filters")}</button></div></div>`;
  return `<div class="catalog-result-meta" role="status">${t(`共 ${selected.total} 项`, `${selected.total} items`)}${selected.pages > 1 ? ` · ${selected.page} / ${selected.pages}` : ""}</div><div class="catalog-grid ${!exhibition(kind) && state.view === "list" ? "is-list" : ""}">${selected.items.map((item) => card(kind, item, ui)).join("")}</div>${selected.pages > 1 ? `<nav class="catalog-pagination" aria-label="${t("内容分页", "Pagination")}"><button type="button" data-catalog-page="${selected.page - 1}" ${selected.page === 1 ? "disabled" : ""}>${icons.left}${t("上一页", "Previous")}</button><span>${selected.page} / ${selected.pages}</span><button type="button" data-catalog-page="${selected.page + 1}" ${selected.page === selected.pages ? "disabled" : ""}>${t("下一页", "Next")}${icons.right}</button></nav>` : ""}`;
}
function feature(kind, item, ui, hero = false) {
  const { t, icons } = ui;
  const image = cover(item, ui).replace(
    'loading="lazy"',
    hero ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"',
  );
  return `<article class="blog-card catalog-feature ${hero ? "catalog-hero" : ""}"><a class="catalog-cover-link" href="${href(kind, item)}" tabindex="-1" aria-hidden="true">${image}</a><div class="catalog-feature-copy"><span class="eyebrow">${esc(t(item.category,item.categoryEn||item.category) || t(...catalogKinds[kind].label))}</span><h2><a class="catalog-feature-title" href="${href(kind, item)}">${esc(title(item, t))}</a></h2><p>${esc(summary(item, t))}</p>${hero ? `<a class="text-link" href="${href(kind, item)}">${t("查看详情", "Explore")}${icons.right}</a>` : ""}</div></article>`;
}
function exhibitionPage(kind, items, state, ui) {
  const { t, icons } = ui,
    spec = catalogKinds[kind];
  // Use actual published covers in the existing content order, never fabricated promos.
  const highlights = items.filter((item) => safeURL(item.coverSrc)).slice(0, 3);
  const allLabel =
    kind === "works"
      ? t("全部作品", "All projects")
      : t("全部资料", "All materials");
  return `<section class="page catalog-page blog-page collection-page catalog-exhibition" data-section="${kind}">
    <header class="catalog-exhibition-heading"><div class="eyebrow">${spec.kicker}</div><h1>${t(...spec.label)}</h1><p>${t(...spec.description)}</p></header>
    ${
      highlights.length
        ? `<section class="catalog-showcase" aria-label="${kind === "works" ? t("最新作品展示", "Latest projects") : t("最新资料展示", "Latest materials")}">${feature(kind, highlights[0], ui, true)}${
            highlights.length > 1
              ? `<div class="catalog-highlights">${highlights
                  .slice(1)
                  .map((item) => feature(kind, item, ui))
                  .join("")}</div>`
              : ""
          }</section>`
        : ""
    }
    <section class="catalog-listing" aria-labelledby="catalog-all-heading"><div class="catalog-section-heading"><h2 id="catalog-all-heading">${allLabel}</h2><span class="page-meta">${t(`${items.length} 项已发布`, `${items.length} published`)}</span></div>
      <div class="blog-toolbar catalog-toolbar catalog-toolbar-grid-only"><div id="category-filter"></div><label class="search">${icons.search}<input type="search" id="content-search" placeholder="${t(...spec.search)}" aria-label="${t(...spec.search)}" value="${esc(state.query || "")}"></label></div>
      <div id="results" class="catalog-results">${catalogResults(kind, items, state, ui)}</div>
    </section></section>`;
}
export function catalogPage(kind, items, state, ui) {
  if (exhibition(kind)) return exhibitionPage(kind, items, state, ui);
  const { t, icons } = ui,
    spec = catalogKinds[kind];
  const view = catalogViewPresentation(
    state.view,
    ui,
    !items.length || selectCatalogItems(items, state).total > 0,
  );
  return `<section class="page catalog-page blog-page collection-page" data-section="${kind}"><header class="blog-masthead"><div><div class="eyebrow">${icons[spec.icon]}${spec.kicker}</div><h1>${t(...spec.title)}</h1><p>${t(...spec.description)}</p></div><span class="page-meta">${t(`${items.length} 项已发布`, `${items.length} published`)}</span></header><section class="catalog-listing" aria-label="${t(...spec.label)}"><div class="blog-toolbar catalog-toolbar"><div id="category-filter"></div><label class="search">${icons.search}<input type="search" id="content-search" placeholder="${t(...spec.search)}" aria-label="${t(...spec.search)}" value="${esc(state.query || "")}"></label><button type="button" class="blog-view-button catalog-view-button" data-action="catalog-view" aria-label="${view.label}" title="${view.label}" ${view.disabled ? "disabled" : ""}>${view.html}</button></div><div id="results" class="catalog-results">${catalogResults(kind, items, state, ui)}</div></section></section>`;
}
export function catalogDetail(kind, item, ui) {
  const { t, icons } = ui;
  const download = safeURL(item.downloadUrl);
  return `<section class="page catalog-detail-page"><article class="article reading-article"><a class="back-link" href="#/${kind}">${icons.left}${t("返回", "Back to ")}${t(...catalogKinds[kind].label)}</a><div class="eyebrow">${icons[catalogKinds[kind].icon]}${esc(t(item.category,item.categoryEn||item.category))}</div><h1>${esc(title(item, t))}</h1><div class="post-tags">${date(item.date) ? `<time datetime="${esc(item.date)}">${date(item.date)}</time>` : ""}${(item.tags || []).map((tag) => `<span class="article-meta-tag">${esc(tag)}</span>`).join("")}</div><p class="article-intro">${esc(summary(item, t))}</p>${cover(item, ui, '(max-width: 960px) 100vw, 960px').replace("catalog-cover", "article-cover").replace('loading="lazy"', 'loading="eager"')}<div class="article-body">${item.bodyHTML || `<p>${esc(summary(item, t))}</p>`}</div>${download || safeURL(item.externalUrl) ? `<section class="catalog-download" aria-label="${t("获取与链接", "Downloads and links")}">${download ? `<div><h2>${t("下载文件", "Download file")}</h2><p>${esc(item.file || t("附件", "Attachment"))}${fileSize(item.fileSize) ? ` · ${fileSize(item.fileSize)}` : ""}</p></div>` : ""}<div class="catalog-detail-actions">${actions(kind, item, ui)}</div></section>` : ""}<div class="article-bottom"><a class="text-link" href="#/${kind}">${icons.left}${t("浏览更多", "Browse more")}</a></div></article></section>`;
}
