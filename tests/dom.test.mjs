// DOM integration checks. This is not a real browser: layout, touch behavior,
// actual pointer capture, downloads, and the native dialog focus trap require visual QA.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { JSDOM, VirtualConsole } from "jsdom";
import * as visitorLocation from '../src/visitor-location.mjs';
import * as siteCopy from '../src/site-copy.mjs';
import * as imageSources from '../dist/image-sources.mjs';
import * as homePreload from '../dist/home-preload.mjs';
import * as contentReader from '../dist/content-reader.mjs';
import * as navigationPrefetch from '../dist/navigation-prefetch.mjs';
import {mountRouteAssets} from '../dist/route-assets.mjs';
import * as core from "../dist/core.mjs";
import * as data from "./fixtures/site-data.mjs";
import {
  universeMarkup,
  mountUniverse as mountActualUniverse,
} from "../dist/universe.mjs";

for (const mode of [null, false, true, 'hk', 'hk-reduced']) test(typeof mode === 'string' ? `HK community startup skips the main homepage (${mode})` : mode ? "local prototype DOM flows" : mode === null ? "static pages without bootstrap keep the community closed" : "closed community routes keep the main site available", async (t) => {
  const communityOnly = typeof mode === 'string';
  const communityEnabled = communityOnly ? true : mode;
  const html = await readFile(
    new URL("../dist/index.html", import.meta.url),
    "utf8",
  );
  const runtimeErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => runtimeErrors.push(error.message));
  virtualConsole.on("error", (...messages) => runtimeErrors.push(messages.map(String).join(" ")));
  const dom = new JSDOM(html, {
    url: communityOnly ? 'https://community.sansphase.com/#/home' : `http://127.0.0.1:4173/?view=universe#/${communityEnabled ? 'notes' : 'community/home'}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window: w } = dom;
  const d = w.document;
  const published=d.createElement('script');published.id='site-content';published.type='application/json';
  published.textContent=JSON.stringify({communityEnabled,...(communityOnly ? {communityOnly:true,mainSiteOrigin:'https://www.sansphase.com',delivery:'paged-v1',reader:{nickname:'林间',role:'reader'}} : !communityEnabled ? {reader:null} : {}),notes:data.notes,resources:data.resources.map(item=>({...item,downloadUrl:'./assets/'+item.file})),works:[],software:[],announcements:[1,2,3].map(i=>({title:"测试公告 "+i,summary:"公告内容"})),profile:null,author:null});
  if (communityEnabled !== null) d.head.append(published);
  w.structuredClone = structuredClone;
  // jsdom provides randomUUID but not SubtleCrypto. Use the real browser
  // primitive from Node so protected writes hash their payload asynchronously.
  Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle });
  // An in-memory community API with the server's response shapes. Two topics
  // per page, so "load more" is exercised.
  const community = { topics: [], replies: [], next: 1, requests: [], apiRequests: [], checkedIn: false, balance: 30, frame: null, redeemed: [],
    notices: [{ id: "n1", type: "reply", read: false }, { id: "n2", type: "follow", read: false }] };
  const person = (name) => ({ name, role: "reader", uid: name === "林间" ? "u1" : "u2", avatar: null, vip: false, level: 1, steward: false, frame: name === "林间" ? community.frame : null, color: null });
  w.fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url, "http://127.0.0.1:4173");
    const path = pathname.replace("/api/community/", "");
    const method = init.method || "GET";
    if (pathname.startsWith('/api/community/')) community.apiRequests.push(`${method} ${path}`);
    community.requests.push(`${method} ${path}${[...searchParams].length ? `?${searchParams}` : ""}`);
    const respond = (status, value) => ({ ok: status < 400, status, json: async () => value });
    if (method === "POST" && init.headers?.["X-Reader-Request"] !== "1") return respond(403, { error: "请求来源验证失败" });
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    const live = community.topics.filter((topic) => !topic.deleted);
    const replies = (id) => community.replies.filter((reply) => reply.topicId === id && !reply.deleted);
    const lastReply = (id) => {
      const reply = replies(id).at(-1);
      return reply ? { author: person(reply.author), at: reply.createdAt } : null;
    };
    const dto = ({ body: _body, deleted: _deleted, ...topic }) => ({ ...topic, liked: topic.liked === true, author: person(topic.author), replies: replies(topic.id).length, lastReply: lastReply(topic.id) });
    const byActivity = (list) => [...list].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    const at = () => new Date(Date.parse("2026-09-30T08:00:00Z") + community.next * 60000).toISOString();
    const unread = () => {
      const open = community.notices.filter((notice) => !notice.read);
      const reply = open.filter((notice) => notice.type === "reply").length;
      return { all: open.length, reply, thanks: 0, system: open.length - reply };
    };
    let match;
    if (method === "GET" && path === "summary") {
      const boards = {};
      for (const topic of byActivity(live)) {
        const board = boards[topic.board] ||= { topics: 0, repliesToday: 0, latest: { id: topic.id, title: topic.title, lastActivityAt: topic.lastActivityAt } };
        board.topics++;
        board.repliesToday += replies(topic.id).length;
      }
      const repliesToday = Object.values(boards).reduce((sum, board) => sum + board.repliesToday, 0);
      return respond(200, { total: live.length, repliesToday, checkinsToday: community.checkedIn ? 1 : 0, boards, tags: {}, hot: byActivity(live).slice(0, 5).map(dto) });
    }
    if (method === "GET" && path === "topics") {
      const board = searchParams.get("board"), query = searchParams.get("q"), page = Number(searchParams.get("page") || 1);
      const list = byActivity(live.filter((topic) => (!board || topic.board === board) && (!query || `${topic.title}${topic.body}`.includes(query))));
      const posters = board && !query ? [{ author: person("林间"), topics: list.length }] : undefined;
      return respond(200, { items: list.slice((page - 1) * 2, page * 2).map(dto), total: list.length, page, pageSize: 2, posters });
    }
    if (method === "GET" && (match = /^topics\/([^/]+)$/.exec(path))) {
      const topic = live.find((item) => item.id === match[1]);
      if (!topic) return respond(404, { error: "帖子不存在，或已被删除。" });
      const mine = topic.author === "林间";
      return respond(200, {
        topic: { ...dto(topic), images: (topic.images || []).map(id => ({ id, width: 100, height: 100 })), body: topic.body, canDelete: true, canEdit: mine, mine, canReply: true, bookmarks: topic.bookmarks || 0 },
        replies: replies(topic.id).map((reply) => ({
          ...reply, author: person(reply.author), mine: reply.author === "林间", byTopicAuthor: reply.author === topic.author, canDelete: true, canEdit: reply.author === "林间",
          quote: reply.quote ? { id: reply.quote, author: "远山", excerpt: community.replies.find((item) => item.id === reply.quote)?.body || "" } : null,
        })),
        author: { ...person(topic.author), topics: 1, replies: 0, likes: 0, accepted: 0, featured: 0, badges: ["first_topic"], bio: "", following: false },
        related: byActivity(live.filter((item) => item.board === topic.board && item.id !== topic.id)).slice(0, 4).map(dto),
        mentions: {}, viewer: { level: 1, muted: null },
      });
    }
    if (method === "POST" && path === "topics") {
      if ([...String(body.title || "")].length < 1) return respond(400, { error: "标题至少 4 个字。" });
      const id = `t${community.next++}`, now = at();
      const moment = body.board === "moments";
      community.topics.push({ id, board: body.board, title: body.title.trim(), hasTitle: true, images: body.images || [], body: body.body.trim(), author: "林间",
        createdAt: now, lastActivityAt: now, likes: 0, ...(moment ? { excerpt: body.body.trim() } : {}) });
      community.lastTopic = body;
      return respond(201, { id, earned: 5, pending: false });
    }
    if (method === "POST" && (match = /^topics\/([^/]+)\/replies$/.exec(path))) {
      const topic = live.find((item) => item.id === match[1]);
      const id = `r${community.next++}`, now = at();
      topic.lastActivityAt = now;
      community.replies.push({ id, topicId: topic.id, author: "林间", body: body.body.trim(), createdAt: now, quote: body.quote || null });
      return respond(201, { id, earned: 0 });
    }
    if (method === "POST" && (match = /^(topics|replies)\/([^/]+)\/delete$/.exec(path))) {
      const item = community[match[1]].find((row) => row.id === match[2]);
      if (!item) return respond(404, { error: "不存在" });
      item.deleted = true;
      community.lastDelete = body;
      return respond(200, { ok: true });
    }
    // 签到、赞、收藏：只记本页需要的状态。
    if (method === "GET" && path === "me")
      return respond(200, { ...person("林间"), owner: false, mod: false, checkedIn: community.checkedIn, streak: community.checkedIn ? 7 : 6,
        balance: community.balance, gainedToday: 0, behaviourToday: 0, dailyCap: 60, nextReward: { total: 1, bonus: 0 },
        unread: unread(), agreed: true, inventory: { makeup: 0, pin: 0, highlight: 0 }, muted: null });
    if (method === "GET" && path === "checkin")
      return respond(200, { checkedIn: community.checkedIn, streak: community.checkedIn ? 7 : 6, balance: community.balance, gainedToday: 0, behaviourToday: 0, vip: false,
        month: searchParams.get("month") || "2026-09", days: [], checkinsToday: community.checkedIn ? 1 : 0, earlyBirds: [],
        makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: [] }, badges: [] });
    if (method === "POST" && path === "checkin") {
      if (community.checkedIn) return respond(409, { error: "今天已经签到过了。" });
      community.checkedIn = true;
      community.balance += 1;
      return respond(200, { streak: 7, reward: 1, bonus: 0, balance: community.balance, position: 1 });
    }
    if (method === "POST" && (match = /^topics\/([^/]+)\/(like|bookmark)$/.exec(path))) {
      const topic = live.find((item) => item.id === match[1]);
      topic[match[2] === "like" ? "likes" : "bookmarks"] = body.on ? 1 : 0;
      topic[match[2] === "like" ? "liked" : "bookmarked"] = body.on;
      return respond(200, match[2] === "like" ? { likes: topic.likes, liked: body.on, earned: 0 } : { bookmarks: topic.bookmarks, bookmarked: body.on });
    }
    // 通知：一条回复、一条关注。
    if (method === "GET" && path === "inbox") {
      const topic = live[0];
      const items = community.notices.map((notice) => notice.type === "reply"
        ? { id: notice.id, type: "reply", actor: person("远山"), topicId: topic?.id || null, replyId: null, text: "回复了你的主题", data: { kind: "topic" }, link: null, count: 1, createdAt: "2026-09-30T08:00:00Z", read: notice.read, topicTitle: topic?.title || null }
        : { id: notice.id, type: "follow", actor: person("远山"), topicId: null, replyId: null, text: "关注了你", data: {}, link: null, count: 1, createdAt: "2026-09-30T07:00:00Z", read: notice.read, topicTitle: null });
      const tab = searchParams.get("tab") || "all";
      return respond(200, { tab, unread: unread(), items: items.filter((item) => tab === "all" || (tab === "reply" ? item.type === "reply" : tab === "system" && item.type === "follow")) });
    }
    if (method === "POST" && path === "inbox/read") {
      const notice = community.notices.find((item) => item.id === body.id);
      if (!notice) return respond(404, { error: "通知不存在。" });
      notice.read = true;
      return respond(200, { ok: true });
    }
    if (method === "POST" && path === "inbox/read-all") { community.notices.forEach((notice) => { notice.read = true; }); return respond(200, { read: 2 }); }
    // 兑换所：一个头像框、一件实物。
    const shopItems = () => [
      { id: "frame-gold", cat: "look", kind: "frame", ref: "gold", name: "金环头像框", desc: "一圈细金边，低调。", price: 80, builtin: true, active: true },
      { id: "bag", cat: "goods", kind: "goods", name: "帆布袋", desc: "一个帆布袋。", price: 20, builtin: false, stock: 3, left: 3 - community.redeemed.filter((order) => order.item === "bag").length, minDays: 0, note: "包邮", active: true },
    ].map((item) => {
      const owned = item.kind === "frame" && community.redeemed.some((order) => order.item === item.id);
      const short = community.balance < item.price;
      return { ...item, state: { owned, left: item.stock ? item.left : null, ok: !owned && !short, code: owned ? "owned" : short ? "short" : "ok", why: owned ? "已拥有" : short ? `还差 ${item.price - community.balance} 星尘` : "" } };
    });
    if (method === "GET" && path === "shop")
      return respond(200, { balance: community.balance, level: 1, owner: false, items: shopItems(), inventory: { makeup: 0, pin: 0, highlight: 0 }, decorations: { frame: community.frame, color: null, cover: null } });
    if (method === "POST" && path === "shop/redeem") {
      const item = shopItems().find((entry) => entry.id === body.item);
      if (!item) return respond(404, { error: "没有这个物品。" });
      if (item.kind === "goods" && !/^1[3-9]\d{9}$/.test(String(body.shipping?.phone || "").replace(/[\s-]/g, ""))) return respond(400, { error: "请填写正确的手机号，用于快递联系。" });
      community.balance -= item.price;
      community.redeemed.push({ item: item.id, shipping: body.shipping || null });
      if (item.kind === "frame") community.frame = item.ref;
      return respond(201, { order: `o${community.redeemed.length}`, item: { id: item.id, name: item.name, kind: item.kind }, balance: community.balance });
    }
    if (method === "GET" && path === "rank")
      return respond(200, { contributions: [{ person: person("远山"), score: 12, likes: 7, accepted: 1, featured: 0 }], streaks: [{ person: person("林间"), streak: 7 }], early: [] });
    return respond(404, { error: "Not found" });
  };
  const homeActivity = { mounts: 0, warmups: 0, navigationPrefetch: 0, animations: [] };
  if (communityOnly) d.body.animate = (frames, options) => {
    homeActivity.animations.push({frames,options});
    return {finished:Promise.resolve(),cancel() {}};
  };
  const menuMedia = Object.assign(new w.EventTarget(), { matches: true });
  w.matchMedia = (query) =>
    query === "(max-width: 1200px)"
      ? menuMedia
      : Object.assign(new w.EventTarget(), { matches: mode === 'hk-reduced' && query === '(prefers-reduced-motion: reduce)' });
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
  // jsdom has no 2D canvas; the community starfield must cope without one.
  w.HTMLCanvasElement.prototype.getContext = () => null;
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
  const landingActivity = { imports: 0, preparations: 0, pending: null };
  let landingModule;
  async function loadDynamicModule(specifier) {
    if (specifier === './community-landing.mjs') {
      // Image loading/decoding and WebGL are covered by the atlas tests. This
      // DOM harness models their asynchronous preparation boundary explicitly.
      if (!landingModule) {
        landingActivity.imports++;
        landingModule = new vm.SyntheticModule(['prepareCommunityLanding'], function () {
          this.setExport('prepareCommunityLanding', async () => {
            landingActivity.preparations++;
            if (landingActivity.pending) await landingActivity.pending;
          });
        }, { context });
        await landingModule.link(() => { throw Error('The landing preparation stub has no imports.'); });
        await landingModule.evaluate();
      }
      return landingModule;
    }
    const dependency = await loadLibrary(new URL('../dist/' + specifier.slice(2), import.meta.url));
    if (dependency.status === 'linked') await dependency.evaluate();
    return dependency;
  }
  function loadLibrary(url, chain = new Set()) {
    // Register synchronously before recursive linking. Two concurrent imports
    // must share one module (especially React's hook dispatcher). A module
    // shared by two branches is handed over once it is linked, or a branch can
    // be instantiated before it; only an import cycle gets it while linking.
    const cached = libraryModules.get(url.href);
    if (cached) return chain.has(url.href) ? cached.module : cached.linked;
    const module = new vm.SourceTextModule(readFileSync(url, "utf8"), {
      context,
      identifier: url.href,
      importModuleDynamically: async specifier => {
        const dependency = await loadLibrary(new URL(specifier, url));
        if (dependency.status === 'linked') await dependency.evaluate();
        return dependency;
      },
    });
    const entry = { module, linked: null };
    libraryModules.set(url.href, entry);
    const inner = new Set([...chain, url.href]);
    entry.linked = module.link((specifier) => loadLibrary(new URL(specifier, url), inner)).then(() => module);
    return entry.linked;
  }
  const mod = new vm.SourceTextModule(
    await readFile(new URL("../dist/app.mjs", import.meta.url), "utf8"),
    { context, importModuleDynamically: loadDynamicModule },
  );
  await mod.link((specifier) => {
    if (specifier === "./ui.bundle.mjs")
      return loadLibrary(new URL("../dist/ui.bundle.mjs", import.meta.url));
    if (specifier === './book-shell.mjs' || specifier === './vip-book-prompt.mjs')
      return loadLibrary(new URL('../dist/' + specifier.slice(2), import.meta.url));
    if (['./community.mjs', './community-ui.mjs', './community-sky.mjs', './community-layout.mjs', './community-landing.mjs', './community-entry.mjs'].includes(specifier))
      return loadLibrary(new URL('../dist/' + specifier.slice(2), import.meta.url));
    if (specifier === './catalog.mjs')
      return loadLibrary(new URL('../dist/catalog.mjs', import.meta.url));
    if (specifier === './content-images.mjs')
      return loadLibrary(new URL('../dist/content-images.mjs', import.meta.url));
    // jsdom has no native Element.animate, so route changes take the plain path.
    if (['./route-transition.mjs', './journey.mjs', './nav-slider.mjs'].includes(specifier))
      return loadLibrary(new URL('../dist/' + specifier.slice(2), import.meta.url));
    if (['./reader-ui.mjs','./admin-readers.mjs','./access-policy.mjs'].includes(specifier))
      return loadLibrary(new URL('../dist/' + specifier.slice(2), import.meta.url));
    const exports =
      specifier === './navigation-prefetch.mjs' ? {...navigationPrefetch,mountNavigationPrefetch:(...args)=>{homeActivity.navigationPrefetch++;return navigationPrefetch.mountNavigationPrefetch(...args);}} :
      specifier === './content-reader.mjs' ? contentReader :
      specifier === './site-copy.mjs' ? siteCopy :
      specifier === './route-assets.mjs' ? {mountRouteAssets:win=>mountRouteAssets(win,{loadAuthor:async()=>{},loadBackground:async()=>{}})} :
      specifier === './route-styles.mjs' ? {ensureRouteStyle:async()=>{}} :
      specifier === './admin-route.mjs' ? {loadAdminReaders:async()=>({adminReadersPage:()=>'<section class="page"><h1>用户管理</h1></section>',mountReaderAdmin:()=>()=>{}})} :
      specifier === './home-preload.mjs' ? {...homePreload,preparePageImages:(...args)=>{homeActivity.warmups++;return homePreload.preparePageImages(...args);}} :
      specifier === './image-sources.mjs' ? imageSources :
      specifier.includes("visitor-location") ? visitorLocation :
      specifier === "./core.mjs"
        ? core
        : specifier === "./universe.mjs"
          ? {
              universeMarkup,
              mountUniverse: (root, options) => {
                homeActivity.mounts++;
                return mountActualUniverse(root, {
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
                });
              },
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
    if (communityOnly) return;
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
  const until = async (check, label) => {
    const deadline = Date.now() + 2000;
    while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(check(), label);
  };
  try {
    if (communityOnly) {
      await t.test('real app boots its community, reveals it once and mounts no main-site scene or preload', async () => {
        await until(()=>d.querySelector('.community-topics, .community-empty'),'the HK community finishes loading');
        assert.equal(w.location.hash,'#/community/home');
        assert.equal(homeActivity.mounts,0,'HK must never call mountUniverse');
        assert.equal(d.querySelector('#home-stage,.universe-home,.universe-canvas,#site-startup'),null,'no main homepage layer exists');
        assert.equal(d.documentElement.classList.contains('is-home-boot'),false);
        assert.equal(homeActivity.warmups,0,'no main content image warmup');
        assert.equal(homeActivity.navigationPrefetch,0,'no main-site navigation preload');
        assert.equal(d.body.dataset.communityBoot,undefined,'ready community is revealed');
        assert.equal(homeActivity.animations.length,mode==='hk-reduced'?0:1,'reduced motion skips the initial fade');
        if (homeActivity.animations.length) assert.deepEqual(Array.from(homeActivity.animations[0].frames,frame=>frame.opacity),[0,1]);
        assert.ok(community.apiRequests.includes('GET summary'));
        await navigate('community/boards');
        await navigate('community/checkin');
        assert.equal(homeActivity.mounts,0);
        assert.equal(homeActivity.animations.length,mode==='hk-reduced'?0:1,'community route switches do not replay arrival');
      });
      return;
    }
    if (!communityEnabled) {
      await t.test('landing, deep links and legacy posts are closed before authentication or community mounting', async () => {
        assert.ok(d.querySelector('[data-content-state="not-open"]'), 'the cold initial render is already closed');
        assert.equal(d.querySelector('.reader-gate-action,.community-sky,[data-community-frame]'), null, 'no authentication or community layer appears on the first render');
        for (const route of ['community/home', 'community', 'community/all', 'community/new/qa', 'community/manage', 'community/checkin', 'community/stardust/levels', 'community/u/u1', 'post/t1']) {
          await navigate(route);
          assert.ok(d.querySelector('[data-content-state="not-open"]'), route);
          assert.match(q('main').textContent, /社区尚未开放/);
          assert.equal(q('#site-header').classList.contains('community-header'), false);
          assert.equal(d.body.classList.contains('community-open'), false);
          assert.equal(d.querySelector('[data-community-frame],.community-sky,.community-enter,.reader-gate-action,form[data-community-form]'), null, route);
          assert.ok(q('main a[href="#/notes"]'));
          assert.deepEqual(community.apiRequests, [], 'closed pages make no community requests');
        }
        await navigate('notes');
        assert.ok(d.querySelector('#content-search'), 'the blog remains available');
        await navigate('account');
        assert.ok(d.querySelector('[data-reader-form="login"]'), 'the real reader sign-in remains available');
        assert.deepEqual(community.apiRequests, []);
      });
      return;
    }
    await t.test("reload restores view state before restoring scroll, in the initial render", async () => {
      assert.equal(q("#blog-calendar-body").hidden, false);
      assert.equal(q("#blog-weather-details").hidden, false);
      assert.equal(q(".weather-attribution").closest("#blog-weather-details"),q("#blog-weather-details"),"weather sources belong inside the optional details");
      assert.ok(q("#results").classList.contains("is-grid"));
      assert.equal(q("#content-search").value, "网站");
      assert.equal(q('[data-category="建站记录"]').getAttribute("aria-checked"), "true");
      assert.equal(q("[data-clock-zone]").textContent, "UTC");
      assert.deepEqual(scrollRequests, [{ top: 2133, left: 0, behavior: "instant",
        cards: 8, calendarOpen: true, weatherOpen: true }]);
      click('[data-action="blog-calendar"]');
      click('[data-action="weather-details"]');
      assert.equal(q(".weather-attribution").closest("[hidden]"),q("#blog-weather-details"),"collapsed weather cards do not display source links");
      click('[data-action="blog-view"]');
      input("#content-search", "");
      click('[data-category="all"]');
    });
    await t.test('music disc is present only on the homepage',async()=>{
      assert.equal(d.querySelector('[data-action="site-music"]'),null);
      await navigate('home');assert.ok(q('[data-action="site-music"] svg'));
      await navigate('notes');assert.equal(d.querySelector('[data-action="site-music"]'),null);
    });
    await t.test('reader identity displays the escaped nickname across routes and resets after logout',async()=>{
      assert.equal(q('.account-button').textContent,'登录 / 注册');
      w.dispatchEvent(new w.CustomEvent('reader:identity',{detail:{nickname:'<em>测试昵称</em>',email:'reader@example.test'}}));
      assert.equal(q('.account-button').textContent,'<em>测试昵称</em>');
      assert.equal(q('.account-button').querySelector('em'),null);
      await navigate('works');
      assert.equal(q('.account-button').textContent,'<em>测试昵称</em>');
      w.dispatchEvent(new w.CustomEvent('reader:identity',{detail:null}));
      assert.equal(q('.account-button').textContent,'登录 / 注册');
      await navigate('notes');
    });
    await t.test('owner header opens the studio directly and the account route never shows an interstitial',async()=>{
      w.dispatchEvent(new w.CustomEvent('author:identity',{detail:{name:'站长',role:'owner'}}));
      assert.equal(q('.account-button').tagName,'BUTTON');
      assert.equal(q('.account-button').hasAttribute('data-author-login'),true);
      await navigate('account');
      assert.equal(w.location.hash,'#/notes');
      assert.equal(d.querySelector('.reader-card--auth'),null);
      w.dispatchEvent(new w.CustomEvent('author:identity',{detail:null}));
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
      assert.equal(d.querySelectorAll('[role="option"]').length,1,'no fixed list of cities before searching');
      input('.timezone-search-input','Tokyo');
      await tick();
      const tokyo = [...d.querySelectorAll('[role="option"]')].find((el) => el.textContent.includes("东京"));
      assert.ok(tokyo, "English search finds Tokyo with a Chinese display name");
      const timezoneInput=q('.timezone-search-input');
      timezoneInput.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
      assert.ok(d.querySelector('.timezone-search-panel'),'confirming an IME candidate does not select a timezone');
      assert.equal(q('[role="option"][data-highlighted]').getAttribute('aria-selected'),'true','screen reader selection matches highlighted result');
      tokyo.click();
      await tick();
      assert.equal(q(".blog-date-card .blog-third-party-glass"), dateSurface);
      assert.equal(q("#blog-timezone"), timezoneTrigger, "timezone changes retain the same trigger and card");
      assert.match(q("#blog-timezone").textContent, /东京/);
      assert.equal(q("[data-clock-zone]").textContent, "Asia/Tokyo");
      timezoneTrigger.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await tick();
      input('.timezone-search-input','Shanghai');
      await tick();
      [...d.querySelectorAll('[role="option"]')].find((el) => el.textContent.includes("上海")).click();
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
        await clickRoute('.chapter-links a[href="#/notes"]');
        assert.equal(w.location.hash, "#/notes");
        assert.ok(d.body.classList.contains("content-open"));
        assert.equal(q(".universe-canvas"), canvas);
        await clickRoute(".brand");
        assert.equal(q(".universe-home").dataset.index, "0");
        const openingCopy = q(".chapter-copy");
        assert.ok(
          openingCopy.hidden || openingCopy.querySelector("h2").textContent === "無相",
          "the logo returns to the opening headline, never a later chapter's copy",
        );
      },
    );
    await t.test('the real app waits for the landing preparation boundary without painting an intermediate sky', async () => {
      await navigate('notes');
      const previous = q('main').firstElementChild;
      const preparations = landingActivity.preparations;
      let prepared;
      landingActivity.pending = new Promise(resolve => { prepared = resolve; });
      const opening = navigate('community');
      await until(() => landingActivity.preparations > preparations, 'the lazy landing module starts actual preparation');
      assert.equal(q('main').firstElementChild, previous, 'the existing page remains until the complete landing is ready');
      assert.equal(d.querySelector('[data-community="landing"], .community-orbits i'), null);
      prepared(); landingActivity.pending = null;
      await opening;
      await until(() => d.querySelector('[data-community="landing"] h1'), 'the prepared landing commits');
      assert.equal(landingActivity.imports, 1, 'the lazy module is shared across landing preparations');
      assert.equal(d.querySelector('.community-orbits i'), null, 'the old three-ring layer is absent');
    });
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
        await navigate("admin");
        assert.equal(d.body.classList.contains("admin-open"), true);
        await navigate("works");
        assert.equal(d.body.classList.contains("admin-open"), false);
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
      "six navigation destinations remain available from the menu; five share a catalog shell and the community opens a landing page",
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
          assert.equal(d.querySelectorAll("main h1").length, 1);
          if (route === "community") assert.ok(q('[data-community="landing"]'));
          else {
            assert.equal(d.querySelectorAll("main .catalog-page").length, 1);
            assert.equal(q(".catalog-page").dataset.section, route);
          }
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
    await t.test('the community is its own area: landing, header and account menu', async()=>{
      await navigate('notes');
      await clickRoute('.nav a[href="#/community"]');
      assert.ok(!q('#site-header').classList.contains('community-header'), 'the landing page keeps the main navigation');
      assert.equal(q('.nav [aria-current="page"]').getAttribute('href'),'#/community');
      assert.match(q('main h1').textContent,/無相社区/);
      assert.ok(d.body.classList.contains('community-open'), 'the landing page keeps its own community presentation');
      assert.equal(d.querySelector('#blog-backdrop .community-sky'), null, 'the introduction cannot mount the separate forum starfield');
      assert.equal(q('#blog-backdrop img').hasAttribute('src'), true, 'the blog photo loaded earlier stays for the blog');
      await clickRoute('.community-enter');
      assert.equal(d.querySelectorAll('#blog-backdrop .community-sky').length, 1, 'one sky across community pages');
      assert.ok(q('#site-header').classList.contains('community-header'));
      assert.deepEqual(Array.from(d.querySelectorAll('#navigation a'), a=>a.getAttribute('href')),
        ['#/community/home','#/community/checkin','#/community/shop','#/community/rank']);
      assert.equal(q('#navigation [aria-current="page"]').getAttribute('href'),'#/community/home');
      assert.equal(d.querySelector('.community-back,.community-brand-group a[href="#/home"]'),null,'no back link in the corner');
      assert.equal(q('.community-brand').getAttribute('href'),'#/community/home');
      await until(()=>d.querySelector('.community-bell'),'the header learns about the member');
      assert.equal(q('.community-bell b').textContent,'2','the bell shows unread notifications');
      assert.equal(q('.community-bell').getAttribute('href'),'#/community/inbox');
      assert.ok(q('#navigation a[href="#/community/checkin"] .community-nav-dot'),'check-in shows a dot until today is done');
      assert.deepEqual(Array.from(d.querySelectorAll('#community-account-menu [role="menuitem"]'),item=>item.getAttribute('href')),
        ['#/community/u/u1','#/community/stardust','#/community/inbox','#/community/bookmarks','#/account']);
      assert.match(q('#community-account-menu a[href="#/community/stardust"]').textContent,/我的星尘\s*30/);
      const account=q('[data-action="community-account"]');
      assert.equal(q('#community-account-menu').hidden,true);
      click('[data-action="community-account"]');
      assert.equal(account.getAttribute('aria-expanded'),'true');
      assert.equal(q('#community-account-menu').hidden,false);
      assert.equal(d.activeElement,q('#community-account-menu [role="menuitem"]'));
      d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      assert.equal(q('#community-account-menu').hidden,true);
      assert.equal(d.activeElement,account);
      click('[data-action="community-account"]');
      click('main');
      assert.equal(q('#community-account-menu').hidden,true,'a click elsewhere closes it');
      assert.equal(d.querySelector('#community-account-menu a[href="#/home"], #community-account-menu a[href="#/community/shop"]'),null);
      const outside = d.createElement('button');
      outside.textContent = 'Outside control';
      let activations = 0;
      outside.addEventListener('click', event => { event.stopPropagation(); activations++; });
      q('main').append(outside);
      click('[data-action="community-account"]');
      outside.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
      assert.equal(q('#community-account-menu').hidden, true, 'an outside press closes before the clicked control handles it');
      outside.focus();
      outside.click();
      assert.equal(activations, 1, 'outside controls still work');
      assert.equal(d.activeElement, outside, 'closing does not steal outside focus');
      click('[data-action="community-account"]');
      outside.click();
      assert.equal(q('#community-account-menu').hidden, true, 'keyboard clicks also close even when their handler stops propagation');
      assert.equal(activations, 2);
      outside.remove();
      assert.equal(d.querySelector('#site-header .community-post'),null,'no 发帖 in the header');
      assert.equal(d.querySelector('.community-sort-actions .community-post'),null,'the home does not offer a board-less post action');
      assert.ok(q('.community-sort-actions #community-search'));
    });
    await t.test('operation notices are centered, do not steal focus and disappear without a close button', async () => {
      const library = await loadLibrary(new URL('../dist/ui.bundle.mjs', import.meta.url));
      library.namespace.toast.dismiss();
      const focused = d.activeElement;
      const message = '发布成功（自动关闭测试）';
      library.namespace.toast(message);
      const notice = () => [...d.querySelectorAll('[data-sonner-toast]')].find(node => node.textContent.includes(message));
      await until(notice, 'the operation notice appears');
      const toaster = notice().closest('[data-sonner-toaster]');
      assert.equal(toaster.dataset.xPosition, 'center');
      assert.equal(toaster.dataset.yPosition, 'top');
      assert.equal(toaster.style.top, 'calc(50% - var(--front-toast-height, 0px) / 2)');
      assert.equal(notice().querySelector('[data-close-button]'), null);
      assert.equal(d.activeElement, focused, 'a notice does not move keyboard focus');
      await new Promise(resolve => setTimeout(resolve, 3500));
      assert.equal(notice(), undefined, 'the notice dismisses itself in about three seconds');
    });
    await t.test('community home reads the API, sorts on the server and starts empty', async()=>{
      await until(()=>d.querySelector('.community-topics, .community-empty'),'the home finishes loading');
      assert.ok(q('[data-community="home"]'));
      assert.match(q('.community-results').textContent,/这里还没有帖子/);
      assert.equal(d.querySelectorAll('.community-board-link').length,6);
      assert.ok(q('.community-board-link[href="#/community/boards/vip"] .community-board-lock'),'non-members see the members board locked');
      assert.ok(community.requests.includes('GET summary'));
      assert.ok(community.requests.includes('GET topics?sort=active&page=1'));
      click('[data-action="community-sort"][data-sort="hot"]');
      assert.equal(q('[data-action="community-sort"][aria-pressed="true"]').dataset.sort,'hot');
      await until(()=>community.requests.includes('GET topics?sort=hot&page=1'),'sorting asks the server');
      await until(()=>d.querySelector('.community-empty'),'the sorted list renders');
      assert.equal(d.activeElement,q('[data-action="community-sort"][data-sort="hot"]'),'focus stays on the chosen sort');
      click('[data-action="community-sort"][data-sort="active"]');
    });
    await t.test('posting: validation, publish, then the post page with replies and deletion', async()=>{
      await navigate('community/boards/qa');
      await clickRoute('.community-feed-rail-compose');
      assert.equal(q('input[name="board"]').value,'qa');
      assert.equal(d.querySelector('.community-board-pick'),null);
      input('#community-title','');
      submit('form[data-community-form="topic"]');
      assert.match(q('.community-form-status').textContent,/标题至少 1 个字/);
      assert.equal(q('#community-title').getAttribute('aria-invalid'),'true');
      assert.equal(d.activeElement,q('#community-title'));
      input('#community-title','ComfyUI 人脸一起用就崩');
      input('#community-body','第一段：单独用没问题。\n\n第二段：一起用就崩。\n\n![封面](/api/community/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp)');
      const published=new Promise(resolve=>w.addEventListener('hashchange',resolve,{once:true}));
      submit('form[data-community-form="topic"]');
      assert.equal(q('form[data-community-form="topic"] button[type="submit"]').disabled,true,'no double submit');
      await until(()=>community.lastTopic,'the hashed publishing request reaches the API');
      assert.deepEqual([community.lastTopic.board,community.lastTopic.bounty,community.lastTopic.tags],['qa',undefined,[]]);
      assert.deepEqual(community.lastTopic.images,['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
      await published;
      await tick();
      assert.match(w.location.hash,/^#\/post\/t\d+$/);
      await until(()=>d.querySelector('.community-thread'),'the new post loads');
      await until(()=>[...d.querySelectorAll('[data-sonner-toast]')].some(node => node.textContent.includes('发布成功')), 'publishing confirms success even without a stardust award');
      assert.equal(q('.community-thread h1').textContent,'ComfyUI 人脸一起用就崩');
      const paragraphs = [...d.querySelectorAll('.community-thread > .community-text p')];
      assert.deepEqual(paragraphs.filter(p=>!p.querySelector('img')).map(p=>p.textContent),['第一段：单独用没问题。','第二段：一起用就崩。']);
      assert.equal(q('.community-thread > .community-text img').getAttribute('src'), '/api/community/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp', 'the inline image renders alongside the two text paragraphs');
      assert.equal(q('.community-crumb a:last-child').getAttribute('href'),'#/community/boards/qa');
      assert.match(q('.community-author-card').textContent,/林间/);
      assert.equal(d.querySelector('#navigation [aria-current="page"]'),null);

      input('#community-reply','谢谢分享');
      submit('form[data-community-form="reply"]');
      await until(()=>d.querySelector('.community-reply'),'the reply appears');
      assert.equal(q('#community-replies-title').textContent,'1 条回复');
      assert.equal(q('#community-reply').value,'','the reply box is cleared');
      assert.equal(d.activeElement,q('.community-reply'),'focus moves to the new reply');
      assert.match(q('.community-reply').textContent,/楼主/,'the topic author is marked');
      click('[data-action="community-delete-reply"]');
      assert.equal(q('[data-action="community-delete-reply"]').textContent,'确认删除','the first click only asks');
      assert.ok(d.querySelector('.community-reply'));
      click('[data-action="community-delete-reply"]');
      await until(()=>!d.querySelector('.community-reply'),'the reply is removed');
      assert.equal(q('#community-replies-title').textContent,'0 条回复');
    });
    await t.test('community drafts survive a route change and protect unsent work', async()=>{
      w.localStorage.clear();
      await navigate('community/new/qa');
      input('#community-title','草稿标题');
      input('#community-body','草稿正文，稍后再发。');
      const previous = w.location.hash;
      let confirmations = 0;
      w.confirm = () => { confirmations++; return false; };
      click('a[href="#/community/home"]');
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(w.location.hash, previous, 'leaving with a draft asks first');
      assert.ok(confirmations > 0);
      w.confirm = () => true;
      await navigate('community/home');
      await navigate('community/new/qa');
      assert.equal(q('#community-title').value,'草稿标题');
      assert.equal(q('#community-body').value,'草稿正文，稍后再发。');
      input('#community-title','');
      input('#community-body','');
      w.confirm = () => true;
      w.localStorage.clear();
    });
    await t.test('boards, a board page with load-more, and deleting a topic', async()=>{
      for(const title of ['第二个问题标题','第三个问题标题','第四个问题标题']) {
        const now=new Date(Date.parse('2026-09-30T09:00:00Z')+community.next*60000).toISOString();
        community.topics.push({id:`t${community.next++}`,board:'qa',title,body:'足够长的正文内容。',author:'远山',authorRole:'reader',createdAt:now,lastActivityAt:now,likes:0});
      }
      await navigate('community/boards');
      await until(()=>/主题4/.test(d.querySelector('.community-board-card[href="#/community/boards/qa"] .community-bc-stats')?.textContent||''),'board counts load');
      assert.equal(d.querySelectorAll('.community-board-card').length,6);
      assert.equal(d.querySelector('#navigation [aria-current="page"]'),null);
      await clickRoute('.community-board-card[href="#/community/boards/qa"]');
      assert.equal(q('[data-community="board"]').dataset.board,'qa');
      assert.equal(q('[data-frame-boards] [aria-current="page"]').getAttribute('href'),'#/community/boards/qa');
      assert.equal(q('.community-post').getAttribute('href'),'#/community/new/qa','posting from a board goes to that board');
      await until(()=>d.querySelectorAll('.community-topic').length===2,'the first page shows');
      await until(()=>/主题4/.test(q('.community-board-hero .community-stats').textContent),'the board hero shows its numbers');
      assert.doesNotMatch(q('[data-frame-right]').textContent,/发帖须知|本版活跃/);
      assert.match(q('[data-action="community-more"]').textContent,/还有 2 个/);
      click('[data-action="community-more"]');
      await until(()=>d.querySelectorAll('.community-topic').length===4,'the next page is appended');
      assert.equal(d.querySelector('[data-action="community-more"]'),null,'no button once everything is shown');
      assert.equal(d.activeElement,d.querySelectorAll('.community-topic h3 a')[2],'focus moves to the first new topic');
      input('#community-search','第三');
      submit('form[data-community-form="search"]');
      await until(()=>d.querySelectorAll('.community-topic').length===1,'searching narrows the board');
      assert.ok(community.requests.includes('GET topics?board=qa&q=%E7%AC%AC%E4%B8%89&sort=active&page=1'));
      assert.match(q('.community-search-summary').textContent,/搜索“第三”，找到 1 个主题/);
      assert.equal(q('#community-search').value,'第三');
      click('[data-action="community-search-clear"]');
      await until(()=>d.querySelectorAll('.community-topic').length===2,'clearing shows the board again');
      assert.equal(q('#community-search').value,'');
      assert.equal(d.activeElement,q('#community-search'));
      await navigate('community/new/qa');
      assert.equal(q('input[name="board"]').value,'qa');
      assert.equal(q('.community-form-actions a').getAttribute('href'),'#/community/boards/qa');
      const first=community.topics[0].id;
      await navigate('post/'+first);
      await until(()=>d.querySelector('[data-action="community-delete-topic"]'),'the post loads');
      click('[data-action="community-delete-topic"]');
      const gone=new Promise(resolve=>w.addEventListener('hashchange',resolve,{once:true}));
      click('[data-action="community-delete-topic"]');
      await gone;
      await tick();
      assert.equal(w.location.hash,'#/community/boards/qa','deleting returns to the board');
      await until(()=>d.querySelectorAll('.community-topic').length===2&&/还有 1 个/.test(d.querySelector('[data-action="community-more"]')?.textContent||''),'the list refreshes without it');
      await navigate('post/'+first);
      await until(()=>d.querySelector('[data-content-state="missing"]'),'a deleted post says so');
      await navigate('post/old-demo');
      await until(()=>/帖子不存在/.test(d.querySelector('[data-content-state="missing"]')?.textContent||''),'an unknown post says so');
    });
    await t.test('switching inside the community changes the page in place, without a snapshot transition', async()=>{
      // A snapshot cross-fade froze the live sky and showed both pages at once.
      const snapshots=[];
      d.startViewTransition=(update)=>{snapshots.push(w.location.hash);const done=Promise.resolve(update());return {finished:done,updateCallbackDone:done,ready:done};};
      try {
        await navigate('community/home');
        await navigate('community/boards');
        await navigate('community/checkin');
        assert.deepEqual(snapshots,[],'no snapshot transitions between community pages');
        await navigate('notes');
        assert.deepEqual(snapshots,[],'leaving the community also uses the live, immediately interactive site transition');
      } finally { delete d.startViewTransition; }
    });
    await t.test('check-in from the home page, then the check-in page; likes on a post', async()=>{
      await navigate('community/home');
      await until(()=>d.querySelector('.community-ck-pill.is-todo'),'the check-in pill loads');
      assert.match(q('.community-ck-pill').textContent,/签到后连签 7 天 \+1/);
      click('[data-action="community-checkin"]');
      await until(()=>d.querySelector('.community-ck-pill.is-done'),'checking in updates the pill');
      assert.match(q('.community-ck-pill').textContent,/已连续签到 7 天 · 明天 \+1/);
      assert.ok(community.requests.includes('POST checkin'));
      await clickRoute('.community-ck-pill.is-done');
      assert.equal(w.location.hash,'#/community/checkin');
      assert.equal(q('#navigation [aria-current="page"]').getAttribute('href'),'#/community/checkin');
      await until(()=>d.querySelector('.community-constellation'),'the check-in page loads');
      assert.equal(d.querySelectorAll('.community-cs').length,30);
      assert.match(q('[data-community="checkin"] > .community-page-head').textContent,/每日签到 \+1 星尘，自然月满勤额外 \+5/);
      assert.equal(d.querySelector('[data-community="checkin"] [data-action="community-checkin"]'),null);
      click('[data-action="community-month"]');
      await until(()=>community.requests.includes('GET checkin?month=2026-08'),'the calendar pages back a month');
      const topic=community.topics.find((item)=>!item.deleted);
      await navigate('post/'+topic.id);
      await until(()=>d.querySelector('[data-action="community-like"][data-kind="topic"]'),'the post loads');
      click('[data-action="community-like"][data-kind="topic"]');
      await until(()=>q('[data-action="community-like"][data-kind="topic"]').getAttribute('aria-pressed')==='true','a like shows at once');
      assert.equal(q('[data-action="community-like"][data-kind="topic"] span').textContent,'1');
      click('[data-action="community-bookmark"]');
      await until(()=>q('[data-action="community-bookmark"]').getAttribute('aria-pressed')==='true','so does a bookmark');
    });
    await t.test('the exchange: prices, redeeming goods with shipping details, and categories', async()=>{
      await navigate('community/shop');
      assert.equal(q('#navigation [aria-current="page"]').getAttribute('href'),'#/community/shop');
      await until(()=>d.querySelectorAll('.community-sitem').length===2,'the items load');
      assert.match(q('.community-banner').textContent,/我的星尘\s*31/);
      click('[data-action="community-redeem"][data-id="bag"]');
      const form=q('form[data-community-form="redeem"]');
      assert.equal(d.activeElement,q('#community-ship-name'),'the shipping form takes focus');
      submit('form[data-community-form="redeem"]');
      assert.match(q('.community-form-status').textContent,/请填写收件人/);
      input('#community-ship-name','林间');
      input('#community-ship-phone','12345');
      submit('form[data-community-form="redeem"]');
      assert.match(q('.community-form-status').textContent,/手机号/);
      assert.equal(q('#community-ship-phone').getAttribute('aria-invalid'),'true');
      input('#community-ship-phone','138 0013 8000');
      input('#community-ship-address','浙江省杭州市西湖区某路 1 号');
      submit('form[data-community-form="redeem"]');
      await until(()=>!d.querySelector('form[data-community-form="redeem"]'),'the panel closes after redeeming');
      assert.deepEqual(community.redeemed[0],{item:'bag',shipping:{name:'林间',phone:'138 0013 8000',address:'浙江省杭州市西湖区某路 1 号'}});
      assert.ok(!form.isConnected);
      await until(()=>/我的星尘\s*11/.test(q('.community-banner').textContent),'the balance updates');
      await navigate('community/shop/look');
      await until(()=>d.querySelectorAll('.community-sitem').length===1,'a category shows its items only');
      assert.equal(q('.community-shop-cats [aria-current="page"]').getAttribute('href'),'#/community/shop/look');
      assert.match(q('[data-action="community-redeem"], .community-sitem button').textContent,/还差 69 星尘/,'a short balance says how much is missing');
    });
    await t.test('the ranking lists contributions, streaks and early birds', async()=>{
      await navigate('community/rank');
      await until(()=>d.querySelectorAll('.community-rank-grid .community-card').length===3,'the ranking loads');
      assert.match(q('.community-banner-lead').textContent,/本月第一\s*远山/);
      assert.match(q('.community-rank-grid').textContent,/12[\s\S]*7 天[\s\S]*还没有人/);
      assert.equal(q('.community-rank-bars li.is-me .community-uname').textContent,'林间','the viewer is marked');
    });
    await t.test('notifications: the inbox, reading one, and the way to its post', async()=>{
      await navigate('community/inbox');
      await until(()=>d.querySelectorAll('.community-note').length===2,'the inbox loads');
      assert.equal(d.querySelectorAll('.community-note.is-unread').length,2);
      assert.match(q('.community-note').textContent,/远山\s*回复了你的主题/);
      assert.match(q('.community-tabs a[href="#/community/inbox"]').textContent,/全部\s*2/);
      const topic=community.topics.find((item)=>!item.deleted);
      const opened=new Promise(resolve=>w.addEventListener('hashchange',resolve,{once:true}));
      click('[data-action="community-notice"][data-id="n1"]');
      await opened;
      await tick();
      assert.equal(w.location.hash,'#/post/'+topic.id,'a notice opens its post');
      assert.ok(community.requests.includes('POST inbox/read'));
      await until(()=>q('.community-bell b')?.textContent==='1','the bell counts one fewer');
      await navigate('community/inbox/system');
      await until(()=>d.querySelector('[data-action="community-read-all"]'),'the system tab loads');
      click('[data-action="community-read-all"]');
      await until(()=>!d.querySelector('.community-bell b'),'nothing is unread');
    });
    await t.test('posting by board: required title and cover, with a fixed destination', async()=>{
      await navigate('community/new/moments');
      assert.ok(q('#community-title').required,'moments require a title too');
      assert.equal(q('#community-body').maxLength,300);
      input('#community-title','工作流终于跑通了');
      input('#community-body','今天终于把工作流跑通了');
      submit('form[data-community-form="topic"]');
      assert.match(q('.community-form-status').textContent,/封面/);
      assert.equal(q('input[name="board"]').value,'moments');
      input('#community-body','今天终于把工作流跑通了\n\n![封面](/api/community/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp)');
      const published=new Promise(resolve=>w.addEventListener('hashchange',resolve,{once:true}));
      submit('form[data-community-form="topic"]');
      await published;
      await tick();
      assert.deepEqual([community.lastTopic.board,community.lastTopic.title],['moments','工作流终于跑通了']);
      await until(()=>d.querySelector('.community-thread .community-text.is-moment'),'a moment reads as text');
      // The author's menu opens (a repaint must not close it at once), Escape and outside clicks close it.
      click('[data-action="community-post-menu"]');
      assert.equal(q('#community-post-menu').hidden,false,'the menu stays open after the click that opened it');
      assert.equal(q('[data-action="community-post-menu"]').getAttribute('aria-expanded'),'true');
      assert.equal(d.activeElement,q('#community-post-menu [role="menuitem"]'));
      assert.match(q('#community-post-menu a[role="menuitem"]').getAttribute('href'),/^#\/community\/edit\//);
      q('#community-post-menu').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      assert.equal(q('#community-post-menu').hidden,true);
      assert.equal(d.activeElement,q('[data-action="community-post-menu"]'),'focus returns to the button');
      click('[data-action="community-post-menu"]');
      click('.community-post-head h1');
      assert.equal(q('#community-post-menu').hidden,true,'a click elsewhere closes it');
    });
    await t.test('quoting a reply, and a moderator removing one with a mute', async()=>{
      const topic=community.topics.find((item)=>!item.deleted&&item.board==='qa');
      community.replies.push({id:`r${community.next++}`,topicId:topic.id,author:'远山',body:'试试把权重降到 0.5',createdAt:'2026-09-30T09:30:00Z'});
      await navigate('post/'+topic.id);
      await until(()=>d.querySelector('[data-action="community-quote"]'),'the reply loads');
      click('[data-action="community-quote"]');
      assert.match(q('.community-quoting').textContent,/回复 远山：试试把权重降到 0\.5/);
      const replyEditor=q('#community-reply').closest('[data-inline-editor]');
      assert.equal(d.activeElement,replyEditor.querySelector('.community-rich-body') || q('#community-reply'), 'quoting focuses the visible reply editor');
      input('#community-reply','谢谢，我去试试');
      submit('form[data-community-form="reply"]');
      await until(()=>community.replies.some((reply)=>reply.body==='谢谢，我去试试'),'the reply is sent');
      assert.equal(community.replies.at(-1).quote,community.replies.find((reply)=>reply.author==='远山').id);
      await until(()=>d.querySelector('.community-quote'),'the quote shows above the reply');
      assert.equal(d.querySelector('.community-quoting'),null,'quoting ends after sending');
      const theirs=community.replies.find((reply)=>reply.author==='远山');
      click(`[data-action="community-delete-reply"][data-id="${theirs.id}"]`);
      assert.ok(q('form[data-community-form="delete"]'),"someone else's reply opens the moderation panel");
      click('form[data-community-form="delete"] input[name="mute"][value="7"]');
      input('form[data-community-form="delete"] [name="reason"]','违规回复，已核实');
      submit('form[data-community-form="delete"]');
      await until(()=>!d.querySelector('form[data-community-form="delete"]'),'the panel closes');
      assert.deepEqual(community.lastDelete,{reason:'违规回复，已核实',violation:true,mute:7});
    });
    await t.test('unknown community pages and the way out', async()=>{
      for(const route of ['community/nope','community/boards/INVALID','community/home/extra']) {
        await navigate(route);
        assert.match(q('main').textContent,/这个角落还没有内容/,route);
      }
      await navigate('community/boards/nope');
      assert.match(q('main').textContent,/这个板块不存在/,'safe board URLs confirm existence after reading the catalog');
      assert.ok(q('#site-header').classList.contains('community-header'),'a missing board keeps the community navigation');
      await navigate('notes');
      assert.ok(!q('#site-header').classList.contains('community-header'));
      assert.ok(!d.body.classList.contains('community-open'));
      assert.equal(d.querySelector('.community-sky'),null,'the sky is removed outside the community');
      assert.equal(q('.nav a[href="#/community"]').textContent,'社区交流');
    });
    await t.test('closed routes never offer fake publishing actions; account is real', async()=>{
      for(const route of ['contact','support']) {
        await navigate(route);
        assert.ok(d.querySelector('[data-content-state="not-open"]'));
        assert.equal(d.querySelector('#demo-login,#compose-form,#reply-form,#contact-form,[data-action="checkin"],[data-action="account"]'),null);
        assert.doesNotMatch(q('main').textContent,/演示账号|体验登录|本地预览/);
      }
      await navigate('account');
      assert.ok(d.querySelector('[data-reader-form="login"]'));
      assert.equal(d.querySelector('#compose-form,#reply-form'),null);
    });
    await t.test(
      "language switch translates UI and keeps original authored posts",
      async () => {
        await navigate("notes");
        click("[data-action=language]");
        assert.equal(d.documentElement.lang, "en");
        assert.equal(d.activeElement, q('[data-action="language"]'));
        assert.match(q("main h1").textContent, /Blog/);
        await navigate("note/building-sansphase");
        assert.equal(
          q(".article h1").textContent,
          data.notes.find(item=>item.id==='building-sansphase').title,
        );
        assert.match(q(".article-body").textContent, /本地/);
        await navigate("community");
        assert.match(q("main h1").textContent, /Community/);
        assert.match(q(".community-enter").textContent, /Enter the community/);
        await navigate("community/home");
        assert.match(q(".community-sort").textContent, /Latest replies/);
        assert.match(q(".community-topic-meta").textContent, /Q&A/, "board names follow the language");
        await navigate("community/shop");
        assert.match(q("main h1").textContent, /Exchange/);
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
      w.dispatchEvent(new w.CustomEvent('author:content',{detail:{communityEnabled:true,notes:data.notes,works:catalogItems,resources:[],software:[catalogItems[0]],profile:null,announcements:[]}}));
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
