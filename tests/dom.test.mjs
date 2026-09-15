// DOM integration checks. This is not a real browser: layout, touch behavior,
// actual pointer capture, downloads, and the native dialog focus trap require visual QA.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM, VirtualConsole } from "jsdom";
import * as visitorLocation from '../src/visitor-location.mjs';
import * as imageSources from '../dist/image-sources.mjs';
import * as homePreload from '../dist/home-preload.mjs';
import {mountRouteAssets} from '../dist/route-assets.mjs';
import * as core from "../dist/core.mjs";
import * as data from "./fixtures/site-data.mjs";
import {
  universeMarkup,
  mountUniverse as mountActualUniverse,
} from "../dist/universe.mjs";

test("local prototype DOM flows", async (t) => {
  const html = await readFile(
    new URL("../dist/index.html", import.meta.url),
    "utf8",
  );
  const runtimeErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => runtimeErrors.push(error.message));
  virtualConsole.on("error", (...messages) => runtimeErrors.push(messages.map(String).join(" ")));
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:4173/?view=universe#/notes",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window: w } = dom;
  const d = w.document;
  const published=d.createElement('script');published.id='site-content';published.type='application/json';
  published.textContent=JSON.stringify({notes:data.notes,resources:data.resources.map(item=>({...item,downloadUrl:'./assets/'+item.file})),works:[],software:[],announcements:[1,2,3].map(i=>({title:"测试公告 "+i,summary:"公告内容"})),profile:null,author:null});
  d.head.append(published);
  w.structuredClone = structuredClone;
  const menuMedia = Object.assign(new w.EventTarget(), { matches: true });
  w.matchMedia = (query) =>
    query === "(max-width: 1200px)"
      ? menuMedia
      : Object.assign(new w.EventTarget(), { matches: false });
  const scrollRequests = [];
  w.scrollTo = (options) => scrollRequests.push({
    ...options,
    cards: d.querySelectorAll(".blog-third-party-glass").length,
    calendarOpen: d.querySelector("#blog-calendar-body")?.hidden === false,
    weatherOpen: d.querySelector("#blog-weather-details")?.hidden === false,
  });
  w.performance.getEntriesByType = () => [{ type: "reload" }];
  w.sessionStorage.setItem("sansphase-page-view-v1", JSON.stringify({
    route: "/#/notes", scrollY: 2133,
    view: { language: "zh", blogView: "grid", calendarOpen: true, weatherOpen: true,
      timezone: "UTC", timezoneManual:true, filterPage: "notes", category: "建站记录", query: "网站" },
  }));
  w.eval(await readFile(new URL("../dist/page-session.js", import.meta.url), "utf8"));
  w.HTMLElement.prototype.scrollIntoView = () => {};
  // jsdom has no layout observer. Enable the real GlassSurface wrappers so
  // filter tests exercise the same nested React roots used in the browser.
  w.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  // Pointer capture is the only browser input primitive stubbed here. Dialog,
  // tabs, filters and notifications load their real third-party browser code.
  w.HTMLElement.prototype.setPointerCapture = function (id) {
    this._capture = id;
  };
  w.HTMLElement.prototype.hasPointerCapture = function (id) {
    return this._capture === id;
  };
  w.HTMLElement.prototype.releasePointerCapture = function () {
    this._capture = null;
  };
  const context = dom.getInternalVMContext();
  const libraryModules = new Map();
  async function loadLibrary(url) {
    if (libraryModules.has(url.href)) return libraryModules.get(url.href);
    // Register synchronously before recursive linking. Two concurrent imports
    // must share one module (especially React's hook dispatcher).
    const loaded = new vm.SourceTextModule(readFileSync(url, "utf8"), {
      context,
      identifier: url.href,
    });
    libraryModules.set(url.href, loaded);
    await loaded.link((specifier) => loadLibrary(new URL(specifier, url)));
    return loaded;
  }
  const mod = new vm.SourceTextModule(
    await readFile(new URL("../dist/app.mjs", import.meta.url), "utf8"),
    { context },
  );
  await mod.link((specifier) => {
    if (specifier === "./ui.bundle.mjs")
      return loadLibrary(new URL("../dist/ui.bundle.mjs", import.meta.url));
    if (specifier === './catalog.mjs')
      return loadLibrary(new URL('../dist/catalog.mjs', import.meta.url));
    const exports =
      specifier === './route-assets.mjs' ? {mountRouteAssets:win=>mountRouteAssets(win,{loadAuthor:async()=>{},loadBackground:async()=>{}})} :
      specifier === './home-preload.mjs' ? homePreload :
      specifier === './image-sources.mjs' ? imageSources :
      specifier.includes("visitor-location") ? visitorLocation :
      specifier === "./core.mjs"
        ? core
        : specifier === "./universe.mjs"
          ? {
              universeMarkup,
              mountUniverse: (root, options) =>
                mountActualUniverse(root, {
                  ...options,
                  prepareContent: async () => {},
                  loadRenderer: async () => ({
                    mountCosmos(canvas, config) {
                      w.queueMicrotask(config.onReady);
                      return {
                        setPointer() {},
                        setOrbit() {},
                        pulse() {},
                        setChapter(value) {
                          config.onProgress(value);
                        },
                        setPaused() {},
                        setReducedMotion() {},
                        resize() {},
                        dispose() {},
                      };
                    },
                  }),
                }),
            }
          : data;
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [key, value] of Object.entries(exports))
          this.setExport(key, value);
      },
      { context },
    );
  });
  await mod.evaluate();
  const q = (s) => {
    const el = d.querySelector(s);
    assert.ok(el, `Missing ${s}`);
    return el;
  };
  const click = (s) => q(s).click();
  const input = (s, value) => {
    const el = q(s);
    Object.getOwnPropertyDescriptor(
      el instanceof w.HTMLTextAreaElement
        ? w.HTMLTextAreaElement.prototype
        : w.HTMLInputElement.prototype,
      "value",
    ).set.call(el, value);
    q(s).dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const submit = (s) =>
    q(s).dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
  const tick = async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    const deadline = Date.now() + 2000;
    while (
      d.querySelector(".universe-home")?.dataset.returning !== "idle" &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(
      d.querySelector(".universe-home")?.dataset.returning,
      "idle",
      "return transition must finish",
    );
  };
  const navigate = async (path) => {
    const changed = w.location.hash !== `#/${path}`;
    const navigation = changed ? new Promise((resolve) => w.addEventListener("hashchange", resolve, { once: true })) : Promise.resolve();
    w.location.hash = `#/${path}`;
    await navigation;
    await tick();
  };
  const clickRoute = async (selector) => {
    // Anchor navigation and hashchange are separate tasks in jsdom. Wait for
    // the event the application renders on, rather than assuming 15 ms is enough.
    const navigation = new Promise((resolve) =>
      w.addEventListener("hashchange", resolve, { once: true }),
    );
    click(selector);
    await navigation;
    await tick();
  };
  try {
    await t.test("reload restores view state before restoring scroll, in the initial render", async () => {
      assert.equal(q("#blog-calendar-body").hidden, false);
      assert.equal(q("#blog-weather-details").hidden, false);
      assert.ok(q("#results").classList.contains("is-grid"));
      assert.equal(q("#content-search").value, "网站");
      assert.equal(q('[data-category="建站记录"]').getAttribute("aria-checked"), "true");
      assert.equal(q("[data-clock-zone]").textContent, "UTC");
      assert.deepEqual(scrollRequests, [{ top: 2133, left: 0, behavior: "instant",
        cards: 8, calendarOpen: true, weatherOpen: true }]);
      click('[data-action="blog-calendar"]');
      click('[data-action="weather-details"]');
      click('[data-action="blog-view"]');
      input("#content-search", "");
      click('[data-category="all"]');
    });
    await t.test('music disc is present only on the homepage',async()=>{
      assert.equal(d.querySelector('[data-action="site-music"]'),null);
      await navigate('home');assert.ok(q('[data-action="site-music"] svg'));
      await navigate('notes');assert.equal(d.querySelector('[data-action="site-music"]'),null);
    });
    await t.test("blog search preserves its input, filters and live sidebar widgets", async () => {
      await navigate("notes");
      const search = q("#content-search");
      const filters = q("#category-filter");
      const weather = q(".blog-weather-card .blog-third-party-glass");
      const notice = q(".blog-notice .blog-third-party-glass");
      const noticeSlides = [...d.querySelectorAll(".blog-notice-slide")];
      assert.equal(noticeSlides.length, 3);
      click('[data-action="blog-notice-next"]');
      assert.equal(noticeSlides[0].getAttribute("aria-hidden"), "true");
      assert.equal(noticeSlides[1].getAttribute("aria-hidden"), "false");
      assert.equal(q(".blog-notice-slide"), noticeSlides[0], "rotation keeps all slides mounted so height can be reserved");
      click('[data-action="blog-notice-prev"]');
      const detail = q("[data-weather-detail]");
      detail.textContent = "Updated weather must survive filtering";
      click('[data-action="blog-calendar"]');
      search.focus();
      input("#content-search", "没有这篇文章");
      assert.equal(q("#content-search"), search);
      assert.equal(search.value, "没有这篇文章");
      assert.equal(d.activeElement, search);
      assert.equal(q("#category-filter"), filters);
      assert.ok(filters.querySelector('[data-category="all"]'));
      assert.equal(q(".blog-weather-card .blog-third-party-glass"), weather);
      assert.equal(q(".blog-notice .blog-third-party-glass"), notice);
      assert.equal(q("[data-weather-detail]"), detail);
      assert.equal(detail.textContent, "Updated weather must survive filtering");
      assert.equal(q("#blog-calendar-body").hidden, false);
      assert.ok(!d.querySelector("#results .blog-card"));
      input("#content-search", "");
      assert.ok(q("#results .blog-card .blog-third-party-glass"));
      click('[data-category="建站记录"]');
      assert.equal(q('[data-category="建站记录"]').getAttribute("aria-checked"), "true");
      click('[data-category="all"]');
      click('[data-action="blog-calendar"]');
      const dateSurface = q(".blog-date-card .blog-third-party-glass");
      const timezoneTrigger = q("#blog-timezone");
      timezoneTrigger.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await tick();
      const tokyo = [...d.querySelectorAll('[role="option"]')].find((el) => el.textContent.includes("Tokyo"));
      assert.ok(tokyo, "the real Radix menu exposes a Tokyo option");
      tokyo.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await tick();
      assert.equal(q(".blog-date-card .blog-third-party-glass"), dateSurface);
      assert.equal(q("#blog-timezone"), timezoneTrigger, "timezone changes retain the same trigger and card");
      assert.match(q("#blog-timezone").textContent, /Tokyo/);
      assert.equal(q("[data-clock-zone]").textContent, "Asia/Tokyo");
      timezoneTrigger.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await tick();
      [...d.querySelectorAll('[role="option"]')].find((el) => el.textContent.includes("Beijing"))
        .dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await tick();
    });
    await t.test(
      "blog backdrop survives widgets, themes and routes without remounting",
      async () => {
        const backdrop = q("#blog-backdrop");
        const photograph = q("#blog-backdrop img");
        assert.equal(backdrop.getAttribute("aria-hidden"), "true");
        assert.ok(!q("main").contains(backdrop));
        const source = photograph.getAttribute("src");
        assert.match(source, /blog-space\.png$/);
        await navigate("notes");
        assert.ok(d.body.classList.contains("blog-open"));
        for (const action of ["blog-calendar", "weather-details", "blog-view"]) {
          click(`[data-action="${action}"]`);
          assert.equal(q("#blog-backdrop"), backdrop);
          assert.equal(q("#blog-backdrop img"), photograph);
          assert.equal(photograph.getAttribute("src"), source);
          click(`[data-action="${action}"]`);
        }
        await navigate("note/building-sansphase");
        assert.ok(d.body.classList.contains("blog-open"));
        await navigate("works");
        assert.equal(d.body.classList.contains("blog-open"), true);
        assert.equal(q("#blog-backdrop img"), photograph);
        await navigate("notes");
        assert.equal(q("#blog-backdrop img"), photograph);
        await navigate("home");
        assert.equal(d.body.classList.contains("blog-open"), false);
      },
    );
    await t.test(
      "content preserves the same canvas and the logo returns without creating a second homepage",
      async () => {
        await tick();
        const home = q(".universe-home"),
          video = q(".universe-canvas");
        const initialScene = home.dataset.scene;
        for (const route of ["works", "resources", "community"]) {
          await navigate(route);
          assert.equal(q(".universe-canvas"), video);
          assert.ok(d.body.classList.contains("content-open"));
          assert.equal(home.getAttribute("aria-hidden"), "true");
          assert.ok(!q("main").contains(home));
        }
        click(".brand");
        await tick();
        assert.equal(q(".universe-canvas"), video);
        assert.equal(home.dataset.scene, initialScene);
        assert.equal(home.getAttribute("aria-hidden"), "false");
        assert.equal(d.body.classList.contains("content-open"), false);
        click('[data-action="language"]');
        assert.equal(q(".universe-canvas"), video);
        click('[data-action="language"]');
      },
    );
    await t.test(
      "logo returns from content to home without a duplicate Home nav",
      async () => {
        await navigate("works");
        click(".brand");
        await tick();
        assert.equal(w.location.hash, "#/home");
        assert.ok(q(".universe-home"));
      },
    );
    await t.test(
      "logo resets later chapters even on the same home URL",
      async () => {
        const canvas = q(".universe-canvas");
        const down = () =>
          w.dispatchEvent(
            new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
          );
        down();
        assert.equal(q(".universe-home").dataset.index, "1");
        click(".brand");
        await tick();
        assert.equal(q(".universe-home").dataset.index, "0");
        down();
        down();
        assert.equal(q(".universe-home").dataset.index, "2");
        await navigate("works");
        click(".brand");
        await tick();
        assert.equal(q(".universe-home").dataset.index, "0");
        assert.equal(q(".universe-canvas"), canvas);
      },
    );
    await t.test(
      "immersive home keeps navigation without an introduction or interaction toolbar",
      () => {
        assert.match(q(".brand").textContent, /無相/);
        assert.equal(d.querySelector('.nav a[href="#/home"]'), null);
        assert.equal(q(".brand").getAttribute("href"), "#/home");
        assert.equal(
          d.querySelector('#site-header [data-action="account"]'),
          null,
        );
        assert.doesNotMatch(d.body.textContent, /无相/);
        assert.match(d.title, /無相/);
        assert.equal(
          d.querySelector(
            ".scene-progress, .scene-link, .home-foot, .scene-copy .eyebrow, .universe-heading, .universe-entry, .universe-next, .universe-count, .universe-motion, .universe-hint",
          ),
          null,
        );
        assert.doesNotMatch(
          q(".universe-home").textContent,
          /我是無相|回到起点|暂停动效|继续探索/,
        );
        assert.equal(q(".universe-status").textContent, "");
        assert.equal(q(".universe-retry").hidden, true);
        assert.equal(
          q(".universe-home").querySelector("video, img, .space-home, .jump-button"),
          null,
        );
        assert.equal(new URL(w.location.href).searchParams.has("view"), false);
      },
    );
    await t.test(
      "universe is available without an enter gate and Space switches just one view",
      async () => {
        await tick();
        assert.equal(d.querySelectorAll(".universe-canvas").length, 1);
        q(".universe-stage").dispatchEvent(
          new w.KeyboardEvent("keydown", {
            key: " ",
            code: "Space",
            repeat: false,
            bubbles: true,
          }),
        );
        q(".universe-stage").dispatchEvent(
          new w.KeyboardEvent("keydown", {
            code: "Space",
            repeat: true,
            bubbles: true,
          }),
        );
        await tick();
        assert.equal(q(".universe-home").dataset.scene, "notes");
        assert.equal(q(".universe-home").dataset.index, "1");
        await new Promise((resolve) => setTimeout(resolve, 1220));
        const canvas = q(".universe-canvas");
        click('.chapter-links a[href="#/notes"]');
        await tick();
        assert.equal(w.location.hash, "#/notes");
        assert.ok(d.body.classList.contains("content-open"));
        assert.equal(q(".universe-canvas"), canvas);
        click(".brand");
        await tick();
        assert.equal(q(".universe-home").dataset.index, "0");
        assert.equal(q(".chapter-copy").hidden, true);
      },
    );
    await t.test(
      "all primary routes render coherent pages and preserve active navigation",
      async () => {
        for (const path of [
          "works",
          "notes",
          "resources",
          "software",
          "community",
          "resource-center",
          "support",
          "contact",
          "account",
        ]) {
          await navigate(path);
          assert.ok(q("main h1").textContent);
          assert.equal(d.querySelectorAll("#site-header").length, 1);
          assert.equal(d.activeElement, q("#main"));
        }
        await navigate("works");
        assert.equal(
          q(".nav [aria-current=page]").getAttribute("href"),
          "#/works",
        );
        await navigate("note/building-sansphase");
        assert.equal(
          q(".nav [aria-current=page]").getAttribute("href"),
          "#/notes",
        );
        assert.match(q(".article h1").textContent, /無相网站建设记录/);
        assert.match(q(".article-body").textContent, /本地/);
        assert.doesNotMatch(q(".article").textContent, /示例文章/);
      },
    );
    await t.test(
      "six navigation destinations share a catalog shell and remain available from the menu",
      async () => {
        const destinations = [
          ["notes", "博客"],
          ["works", "作品"],
          ["resources", "资料"],
          ["software", "软件推荐"],
          ["community", "社区交流"],
          ["resource-center", "资源中心"],
        ];
        for (const [route, label] of destinations) {
          await navigate(route);
          assert.deepEqual(
            Array.from(d.querySelectorAll(".nav a"), (a) => a.textContent),
            destinations.map((x) => x[1]),
          );
          assert.equal(
            q('.nav [aria-current="page"]').getAttribute("href"),
            `#/${route}`,
          );
          assert.equal(d.querySelectorAll("main .catalog-page").length, 1);
          assert.equal(d.querySelectorAll("main h1").length, 1);
          assert.equal(q(".catalog-page").dataset.section, route);
          click('[data-action="menu"]');
          assert.equal(q(".nav").classList.contains("open"), true);
          assert.equal(q(`.nav a[href="#/${route}"]`).textContent, label);
          click(`.nav a[href="#/${route}"]`);
          await tick();
          assert.equal(
            q('[data-action="menu"]').getAttribute("aria-expanded"),
            "false",
          );
        }
        await navigate("software");
        assert.match(q("main").textContent, /推荐清单尚未发布/);
        assert.equal(d.querySelectorAll('main a[href^="http"]').length, 0);
        await navigate("resource-center");
        assert.match(q("main").textContent, /资源尚未发布/);
        assert.equal(d.querySelectorAll("main .download-index").length,0);

        assert.ok(q('#content-search'));
      },
    );
    await t.test(
      "unpublished work stays empty and keeps a cooperation entry",
      async () => {
        await navigate("works");
        assert.equal(d.querySelectorAll(".work-card").length, 0);
        assert.match(
          q('[data-content-state="unpublished"]').textContent,
          /作品尚未发布/,
        );
        assert.equal(
          q('main a[href="#/contact"]').textContent.includes("联系与合作"),
          true,
        );
        assert.doesNotMatch(
          q("main").textContent,
          /界面之外|灵感的秩序|一页之间|SELECTED EXPERIMENTS/,
        );
        await navigate("work/beyond-interface");
        assert.match(q("main").textContent, /404/);
      },
    );
    await t.test("search, category and empty-state recovery", async () => {
      await navigate("resources");
      input("#content-search", "不会找到的内容");
      assert.ok(q(".empty"));
      click("[data-action=clear-search]");
      assert.equal(d.querySelectorAll(".catalog-card").length, 3);
      click('[data-category="学习记录"]');
      assert.equal(d.querySelectorAll(".catalog-card").length, 1);
      input("#content-search", "checklist");
      assert.equal(d.querySelectorAll(".catalog-card").length, 0);
      click("[data-action=clear-search]");
      input("#content-search", "checklist");
      assert.equal(d.querySelectorAll(".catalog-card").length, 1);
    });
    await t.test(
      "skip link moves focus without changing the page route",
      async () => {
        await navigate("community");
        const before = w.location.hash;
        const title = q("main h1").textContent;
        click(".skip-link");
        await tick();
        assert.equal(w.location.hash, before);
        assert.equal(q("main h1").textContent, title);
        assert.equal(d.activeElement, q("#main"));
      },
    );
    await t.test(
      "mobile menu closes on same-page navigation and Escape",
      async () => {
        await navigate("community");
        click("[data-action=menu]");
        assert.equal(
          q("[data-action=menu]").getAttribute("aria-expanded"),
          "true",
        );
        assert.equal(d.activeElement, q('.nav a[aria-current="page"]'));
        click('.nav a[href="#/community"]');
        await tick();
        assert.equal(
          q("[data-action=menu]").getAttribute("aria-expanded"),
          "false",
        );
        assert.equal(d.activeElement, q("#main"));
        click("[data-action=menu]");
        d.dispatchEvent(
          new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        assert.equal(
          q("[data-action=menu]").getAttribute("aria-expanded"),
          "false",
        );
        assert.equal(d.activeElement, q("[data-action=menu]"));
        click("[data-action=menu]");
        q("[data-action=menu]").focus();
        menuMedia.matches = false;
        menuMedia.dispatchEvent(new w.Event("change"));
        assert.equal(q(".nav").classList.contains("open"), false);
        assert.equal(
          q("[data-action=menu]").getAttribute("aria-expanded"),
          "false",
        );
        assert.equal(d.activeElement, q('.nav a[aria-current="page"]'));
        menuMedia.matches = true;
        menuMedia.dispatchEvent(new w.Event("change"));
        assert.equal(d.activeElement, q("[data-action=menu]"));
      },
    );
    await t.test(
      "resources have real local files and valid download anchors",
      async () => {
        await navigate("resources");
        assert.equal(d.querySelectorAll(".catalog-card").length, 3);
        assert.equal(d.querySelector('[data-action="catalog-view"]'),null);
        assert.match(q("main").textContent, /本站模板/);
        const detailRoutes = [...d.querySelectorAll('.catalog-card-title')].map(a=>a.getAttribute('href').slice(2));
        for (const route of detailRoutes) {
          await navigate(route);
          const a = q('.catalog-download a[download]');
          const text = await readFile(
            new URL(`../dist/${a.getAttribute("href")}`, import.meta.url),
            "utf8",
          );
          assert.ok(text.length > 200);
          assert.match(text, /SANSPHASE/);
        }
      },
    );
    await t.test('phase-two routes never offer fake account or publishing actions', async()=>{
      for(const route of ['community','account','post/old-demo','contact','support']) {
        await navigate(route);
        assert.ok(d.querySelector('[data-content-state="not-open"]'));
        assert.equal(d.querySelector('#demo-login,#compose-form,#reply-form,#contact-form,[data-action="checkin"],[data-action="account"]'),null);
        assert.doesNotMatch(q('main').textContent,/演示账号|体验登录|本地预览/);
      }
    });
    await t.test(
      "language switch renders English content and data safely",
      async () => {
        await navigate("notes");
        click("[data-action=language]");
        assert.equal(d.documentElement.lang, "en");
        assert.equal(d.activeElement, q('[data-action="language"]'));
        assert.match(q("main h1").textContent, /Blog/);
        await navigate("note/building-sansphase");
        assert.match(
          q(".article h1").textContent,
          /Website development journal/,
        );
        assert.match(q(".article-body").textContent, /local prototype/);
        await navigate("community");
        assert.match(q("main").textContent, /not open yet/);
        click("[data-action=language]");
        assert.equal(d.documentElement.lang, "zh-CN");
      },
    );
    await t.test('invalid links provide a recovery path',async()=>{
      await navigate('not-a-page');assert.match(q('main').textContent,/404/);
      assert.equal(q('main a.button').getAttribute('href'),'#/home');
    });
    await t.test("refresh keeps the outgoing page intact until the browser replaces it", async () => {
      await navigate("notes");
      const before = q("#main").innerHTML;
      const roots = [...d.querySelectorAll(".blog-third-party-glass")];
      assert.ok(roots.length >= 8);
      w.dispatchEvent(new w.PageTransitionEvent("pagehide", { persisted: false }));
      assert.ok(q("#main").innerHTML === before, "pagehide must not empty visible cards or controls");
      for (const root of roots) assert.ok(root.isConnected);
    });
    await t.test('published catalogs support stable view toggle, pagination, search and software details', async () => {
      await navigate('works');
      const catalogItems = Array.from({length:15},(_,i)=>({id:`tool-${i}`,title:`验证软件 ${i}`,category:'桌面工具',summary:'软件用途',tags:['Windows'],date:'2026-09-15',coverSrc:'./assets/materials/blog-space.png',bodyHTML:'<h2>安装与使用</h2><p>详情内容</p>',file:'tool.zip',downloadUrl:'/api/media/test?download=1'}));
      w.dispatchEvent(new w.CustomEvent('author:content',{detail:{notes:data.notes,works:catalogItems,resources:[],software:[catalogItems[0]],profile:null,announcements:[]}}));
      assert.equal(d.querySelectorAll('.catalog-card').length,12);
      assert.equal(d.querySelector('[data-action="catalog-view"]'),null);
      assert.equal(q('.catalog-grid').classList.contains('is-list'),false);
      click('[data-catalog-page="2"]');
      assert.equal(d.querySelectorAll('.catalog-card').length,3);
      input('#content-search','软件 0');
      assert.equal(d.querySelectorAll('.catalog-card').length,1,'search resets the page');
      await clickRoute('.catalog-card-title');
      assert.equal(w.location.hash,'#/work/tool-0');
      assert.match(q('.reading-article').textContent,/安装与使用/);
      assert(q('.catalog-download a[download]'));
      await navigate('software');
      assert.equal(q('#content-search').value,'','categories and search do not leak between catalogs');
      const first=q('.catalog-card .blog-third-party-glass');
      const gridIcon=q('[data-action="catalog-view"] svg').innerHTML;
      click('[data-action="catalog-view"]');
      assert(q('.catalog-grid').classList.contains('is-list'));
      assert.notEqual(q('[data-action="catalog-view"] svg').innerHTML,gridIcon);
      assert.equal(q('[data-action="catalog-view"] span').textContent,'列表');
      assert.equal(q('[data-action="catalog-view"]').getAttribute('title'),'切换为网格');
      assert.equal(q('.catalog-card .blog-third-party-glass'),first,'view switching must not remount the material');
      click('[data-action="catalog-view"]');
      assert.equal(q('[data-action="catalog-view"] svg').innerHTML,gridIcon);
      assert.equal(q('[data-action="catalog-view"] span').textContent,'网格');
      input('#content-search','不存在的软件');
      assert(q('.catalog-empty'));
      assert.equal(q('[data-action="catalog-view"]').disabled,true);
      click('[data-action="clear-search"]');
      assert.equal(q('[data-action="catalog-view"]').disabled,false);
      await clickRoute('.catalog-card-title');
      assert.equal(w.location.hash,'#/software/tool-0');
      assert.match(q('main h1').textContent,/验证软件/);
    });
  } finally {
    w.dispatchEvent(
      new w.PageTransitionEvent("pagehide", { persisted: false }),
    );
    dom.window.close();
    assert.deepEqual(
      runtimeErrors,
      [],
      "Navigation must not log uncaught runtime errors",
    );
  }
});
