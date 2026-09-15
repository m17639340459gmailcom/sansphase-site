import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  catalogResults,
  catalogPage,
  catalogDetail,
  selectCatalogItems,
  catalogViewPresentation,
} from "../src/catalog.mjs";

const items = Array.from({ length: 15 }, (_, index) => ({
  id: `tool-${index}`,
  title: `工具 ${index}`,
  category: index % 2 ? "桌面软件" : "开发工具",
  summary: "功能说明",
  tags: ["Windows"],
  date: "2026-09-15",
  bodyHTML: "<h2>使用方法</h2><p>说明正文</p>",
}));
const ui = {
  t: (zh) => zh,
  icons: {
    grid: "",
    document: "",
    download: "",
    calendar: "",
    link: "",
    right: "",
    left: "",
  },
  tagTone: () => 0,
};
test("software cards share poster styling while retaining the list-mode information and links", () => {
  const software = { ...items[0], coverSrc: '/api/media/cover', externalUrl: 'https://example.com/' };
  for (const view of ['grid', 'list']) {
    const doc = new JSDOM(catalogResults('software', [software, items[1]], { view }, ui)).window.document;
    assert.equal(doc.querySelectorAll('.catalog-poster').length, 2);
    assert.equal(doc.querySelector('.catalog-grid').classList.contains('is-list'), view === 'list');
    assert.equal(doc.querySelector('.catalog-card-title').getAttribute('href'), '#/software/tool-0');
    assert.equal(doc.querySelectorAll('.catalog-card-meta, .catalog-tags, .catalog-card-actions').length, 6);
    assert.equal(doc.querySelector('[target="_blank"]').getAttribute('href'), 'https://example.com/');
    assert.equal(doc.querySelectorAll('img').length, 1, 'no-cover entries do not receive invented artwork');
  }
});
test("software view labels and icons describe the same current view", () => {
  const context = {
    ...ui,
    icons: {
      ...ui.icons,
      grid: '<svg data-icon="grid"></svg>',
      list: '<svg data-icon="list"></svg>',
    },
  };
  for (const view of ["grid", "list"]) {
    const button = catalogViewPresentation(view, context);
    const doc = new JSDOM(button.html).window.document;
    assert.equal(doc.querySelector("svg").dataset.icon, view);
    assert.equal(
      doc.querySelector("span").textContent,
      view === "grid" ? "网格" : "列表",
    );
    assert.equal(button.label, view === "grid" ? "切换为列表" : "切换为网格");
    const page = new JSDOM(catalogPage("software", items, { view }, context))
      .window.document;
    assert.equal(
      page.querySelector('[data-action="catalog-view"]').innerHTML,
      button.html,
    );
  }
});
test("software view switch remains available for the unpublished placeholder", () => {
  for (const view of ["grid", "list"]) {
    const doc = new JSDOM(catalogPage("software", [], { view }, ui)).window
      .document;
    assert.equal(
      doc.querySelector('[data-action="catalog-view"]').disabled,
      false,
    );
    assert.ok(
      doc.querySelector(
        '.catalog-grid [data-content-state="no-recommendations"]',
      ),
    );
    assert.equal(
      doc.querySelector(".catalog-grid").classList.contains("is-list"),
      view === "list",
    );
    assert.match(doc.querySelector(".page-meta").textContent, /0 项已发布/);
    assert.equal(doc.querySelector("[download]"), null);
  }
  for (const [data, state] of [[items, { query: "no-matching-software" }]]) {
    const doc = new JSDOM(catalogPage("software", data, state, ui)).window
      .document;
    const button = doc.querySelector('[data-action="catalog-view"]');
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-label"), "暂无内容可切换");
  }
  const populated = new JSDOM(catalogPage("software", items, {}, ui)).window
    .document;
  assert.equal(
    populated.querySelector('[data-action="catalog-view"]').disabled,
    false,
  );
});
test("poster captions contain only title and summary; file information stays in details", () => {
  const withFile = {
    ...items[0],
    file: "guide.pdf",
    fileSize: 2048,
    downloadUrl: "/api/media/guide",
  };
  const doc = new JSDOM(
    catalogResults("resources", [withFile, items[1]], {}, ui),
  ).window.document;
  assert.equal(doc.querySelectorAll(".catalog-file-meta, .eyebrow").length, 0);
  for (const copy of doc.querySelectorAll('.catalog-card-copy')) {
    assert.deepEqual(Array.from(copy.children, e => e.tagName), ['H2', 'P']);
  }
  const detail = new JSDOM(catalogDetail('resources', withFile, ui)).window.document;
  assert.match(detail.querySelector('.catalog-download').textContent, /guide.pdf/);
  assert.match(detail.querySelector('.catalog-download').textContent, /2 KB/);
  assert.equal(doc.querySelector("[download]"), null);
});
test("works and resources ignore saved list mode and use an exhibition above the full grid", () => {
  const covered = items.map((item) => ({
    ...item,
    coverSrc: "/api/media/cover",
  }));
  for (const kind of ["works", "resources"]) {
    const doc = new JSDOM(catalogPage(kind, covered, { view: "list" }, ui))
      .window.document;
    assert.equal(doc.querySelector('[data-action="catalog-view"]'), null);
    assert.equal(doc.querySelector(".is-list"), null);
    assert.equal(doc.querySelectorAll(".catalog-feature").length, 3);
    assert.equal(doc.querySelectorAll(".catalog-card").length, 12);
    assert.equal(
      doc.querySelector(".catalog-hero img").getAttribute("loading"),
      "eager",
    );
    assert.equal(
      doc.querySelector(".catalog-feature-title").getAttribute("href"),
      `#/${kind === "works" ? "work" : kind}/tool-0`,
    );
    assert.equal(
      doc.querySelector("#results [download]"),
      null,
      "downloads belong to the detail page in exhibition catalogs",
    );
    const noCovers = new JSDOM(catalogPage(kind, items, {}, ui)).window
      .document;
    assert.equal(
      noCovers.querySelector(".catalog-feature"),
      null,
      "do not invent cover art",
    );
  }
  const software = new JSDOM(
    catalogPage("software", covered, { view: "list" }, ui),
  ).window.document;
  assert.ok(software.querySelector('[data-action="catalog-view"]'));
  assert.ok(software.querySelector(".is-list"));
});
test("catalog filtering precedes pagination; deleted last pages clamp safely", () => {
  assert.equal(selectCatalogItems(items, { category: "桌面软件" }).total, 7);
  assert.equal(selectCatalogItems(items, { query: "Windows" }).total, 15);
  const second = selectCatalogItems(items, { page: 2 });
  assert.equal(second.items.length, 3);
  assert.equal(second.items[0].id, "tool-12");
  assert.equal(selectCatalogItems(items.slice(0, 2), { page: 2 }).page, 1);
});
test("catalog cards have safe links, optional covers and no phantom downloads", () => {
  const doc = new JSDOM(catalogResults("works", items.slice(0, 1), {}, ui))
    .window.document;
  assert.equal(
    doc.querySelector(".catalog-card-title").getAttribute("href"),
    "#/work/tool-0",
  );
  assert.equal(doc.querySelector("[download]"), null);
  assert.equal(doc.querySelector("img"), null);
  const hostile = {
    ...items[0],
    title: "<script>attack</script>",
    coverSrc: "javascript:alert(1)",
    externalUrl: "javascript:alert(2)",
  };
  const safe = new JSDOM(catalogResults("software", [hostile], {}, ui)).window
    .document;
  assert.equal(safe.querySelector("script"), null);
  assert.equal(safe.querySelector("img"), null);
  assert.equal(safe.querySelector("[target]"), null);
});
test("detail keeps description, cover, tags, attachment and official link together", () => {
  const item = {
    ...items[0],
    coverSrc: "/api/media/cover",
    file: "tool.zip",
    downloadUrl: "/api/media/file?download=1",
    externalUrl: "https://example.com/",
    fileSize: 2048,
  };
  const doc = new JSDOM(catalogDetail("works", item, ui)).window.document;
  assert.equal(doc.querySelector("h1").textContent, item.title);
  assert.equal(
    doc.querySelector(".reading-article .article-body h2").textContent,
    "使用方法",
  );
  assert.match(doc.querySelector(".catalog-download").textContent, /tool.zip/);
  assert.match(doc.querySelector(".catalog-download").textContent, /2 KB/);
  assert.equal(
    doc.querySelector("[target]").getAttribute("rel"),
    "noopener noreferrer",
  );
  assert.equal(
    doc.querySelector(".article-cover").getAttribute("width"),
    "960",
  );
});
