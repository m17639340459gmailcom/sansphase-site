import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import postcss from "postcss";
import { createFeedLayout } from "../../src/community-layout/feed.ts";
import { startCommunityLayout } from "../../src/community-layout/runtime.ts";

interface TestWindow extends Window {
  MutationObserver: typeof MutationObserver;
  Event: typeof Event;
  PageTransitionEvent: typeof PageTransitionEvent;
}
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: { url: string }) => { window: TestWindow };
};
const topicMarkup = `<article class="community-topic"><a class="community-av" href="#/community/members/author">A</a><div class="community-topic-main"><h3><a href="#/post/example">真实讨论</a></h3><div class="community-topic-thumbs"><img src="/fixture.webp" alt="已有配图"></div><p class="community-topic-meta"><a class="community-topic-board" href="#/community/boards/qa">问答</a> <span class="community-dot"></span><span class="community-who"><a class="community-uname" href="#/community/members/author">作者</a><span class="community-vip">VIP</span></span><span class="community-dot"></span> <time datetime="2026-10-03">今天</time> </p></div><a class="community-topic-replies" href="#/post/example">3 回复</a></article>`;
const bannerMarkup = `<header class="community-banner"><div class="community-banner-text"><h1>社区</h1><p>原有社区说明</p></div><div class="community-banner-side"><dl class="community-stats"><dt>主题</dt><dd>12</dd></dl><button data-action="community-checkin">签到</button></div></header>`;
const hostMarkup = `<section class="community-page" data-community="home">${bannerMarkup}<div class="community-layout"><aside class="community-aside"><a href="#/post/hot">热门讨论</a></aside> <div class="community-main"><div class="community-topics">${topicMarkup}</div></div></div></section>`;
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('one image fits the preview without clipping while two, three and four keep their established grid', async () => {
  const css = postcss.parse(await readFile(new URL('../../src/community-layout/feed.css', import.meta.url), 'utf8'));
  const { window } = new JSDOM('<section data-community-frame="stable"></section>', { url: 'http://localhost/' });
  try {
    const host = window.document.querySelector('section')!;
    for (const count of [1, 2, 3, 4]) {
      host.innerHTML = `<a class="community-topic-thumbs">${'<img>'.repeat(count)}</a>`;
      const container = host.firstElementChild!, image = container.firstElementChild!;
      const declarationsFor = (node: Element) => {
        const declarations = new Map<string, string>();
        css.walkRules(rule => {
          if (rule.parent?.type !== 'root' || !rule.selector.includes('.community-topic-thumbs') || !node.matches(rule.selector)) return;
          rule.walkDecls(declaration => { declarations.set(declaration.prop, declaration.value); });
        });
        return declarations;
      };
      const frame = declarationsFor(container), picture = declarationsFor(image);
      assert.equal(picture.get('object-fit'), count === 1 ? 'contain' : 'cover', `preview with ${count} image(s)`);
      assert.equal(picture.get('width'), '100%');
      assert.equal(picture.get('height'), count === 1 ? 'auto' : '100%');
      if (count === 1) { assert.equal(frame.get('background'), 'transparent'); assert.equal(frame.get('border'), '0'); }
      assert.equal(frame.get('aspect-ratio'), ['auto', '2 / 1', '3 / 1', '1'][count - 1]);
    }
  } finally { window.close(); }
});
function fixture(t: TestContext, start = false) {
  const { window } = new JSDOM(`<main id="main">${hostMarkup}</main>`, { url: "http://localhost/?interior=feed#/community/home" });
  const stop = start ? startCommunityLayout(window.document, window) : () => {};
  t.after(() => { stop(); window.close(); });
  return { window, document: window.document, host: window.document.querySelector<HTMLElement>("section")!, stop };
}

test("feed keeps the original avatar with author and time and restores exact DOM and handlers", (t) => {
  const { document, host } = fixture(t);
  const original = host.innerHTML;
  const originalNodes = Array.from(document.querySelector(".community-topic-meta")!.childNodes);
  const who = document.querySelector<HTMLElement>(".community-who")!;
  const time = document.querySelector("time")!;
  const authorLink = who.querySelector<HTMLAnchorElement>("a")!;
  const avatar = host.querySelector<HTMLAnchorElement>(".community-topic > .community-av")!;
  let authorClicks = 0;
  let avatarClicks = 0;
  authorLink.addEventListener("click", event => { event.preventDefault(); authorClicks++; });
  avatar.addEventListener("click", event => { event.preventDefault(); avatarClicks++; });
  const bylines = createFeedLayout(host);
  bylines.sync();
  const byline = document.querySelector(".community-feed-byline")!;
  assert.deepEqual(Array.from(byline.childNodes), [avatar, who, time]);
  avatar.click();
  assert.equal(avatarClicks, 1);
  assert.equal(document.querySelector(".community-topic-main")!.firstChild, byline);
  assert.equal(authorLink.getAttribute("href"), "#/community/members/author");
  authorLink.click();
  assert.equal(authorClicks, 1);
  assert.equal(document.querySelectorAll("img").length, 1);
  assert.equal(document.querySelectorAll("h3").length, 1);
  bylines.release();
  assert.equal(host.innerHTML, original);
  assert.deepEqual(Array.from(document.querySelector(".community-topic-meta")!.childNodes), originalNodes);
  assert.equal(document.querySelector(".community-who"), who);
  assert.equal(host.querySelector(".community-topic > .community-av"), avatar);
  authorLink.click();
  assert.equal(authorClicks, 2);
  bylines.release();
  assert.equal(host.innerHTML, original);
});

test("feed sync is idempotent and does not schedule an observer mutation loop", async (t) => {
  const { document, window, host } = fixture(t);
  const bylines = createFeedLayout(host);
  bylines.sync();
  let mutations = 0;
  const observer = new window.MutationObserver(records => { mutations += records.length; });
  observer.observe(host, { childList: true, subtree: true });
  for (let iteration = 0; iteration < 5; iteration++) bylines.sync();
  await settle();
  assert.equal(mutations, 0);
  assert.equal(document.querySelectorAll(".community-feed-byline").length, 1);
  observer.disconnect();
  bylines.release();
});

test("feed shows the true publication time while preserving source reply and like counts", t => {
  const { host } = fixture(t);
  const topic = host.querySelector<HTMLElement>('.community-topic')!;
  topic.dataset.createdAt = '2026-09-28T08:00:00.000Z';
  const time = topic.querySelector('time')!;
  time.dateTime = '2026-10-03T10:00:00.000Z';
  time.textContent = '其他人 1 天前回复';
  const stats = topic.querySelector<HTMLElement>('.community-topic-replies')!;
  stats.innerHTML = '<span>3</span><small>7 赞</small>';
  const original = host.innerHTML;
  const feed = createFeedLayout(host);
  feed.sync();
  assert.equal(topic.querySelector('.community-feed-byline > time'), time);
  assert.equal(time.dateTime, '2026-09-28T08:00:00.000Z');
  assert.match(time.textContent!, /发布$/);
  assert.doesNotMatch(time.textContent!, /回复/);
  assert.equal(stats.textContent, '37 赞');
  assert.equal(stats.getAttribute('href'), '#/post/example');
  feed.release();
  assert.equal(host.innerHTML, original);
});

test("feed puts the original main before its sibling aside for reading and keyboard order", (t) => {
  const { host } = fixture(t);
  const original = host.innerHTML;
  const layout = host.querySelector(".community-layout")!;
  const originalNodes = Array.from(layout.childNodes);
  const main = layout.querySelector<HTMLElement>(".community-main")!;
  const aside = layout.querySelector(".community-aside")!;
  let clicks = 0;
  main.addEventListener("click", event => { event.preventDefault(); clicks++; });
  const feed = createFeedLayout(host);
  feed.sync();
  assert.deepEqual(Array.from(layout.children), [main, aside]);
  main.click();
  assert.equal(clicks, 1);
  feed.release();
  assert.equal(host.innerHTML, original);
  assert.deepEqual(Array.from(layout.childNodes), originalNodes);
  main.click();
  assert.equal(clicks, 2);
});

test("feed moves the banner into main and existing stats and check-in above trending without losing listeners", (t) => {
  const { host } = fixture(t);
  const original = host.innerHTML;
  const originalNodes = Array.from(host.childNodes);
  const banner = host.querySelector<HTMLElement>(".community-banner")!;
  const side = banner.querySelector(".community-banner-side")!;
  const checkin = side.querySelector<HTMLButtonElement>("button")!;
  let clicks = 0;
  checkin.addEventListener("click", () => { clicks++; });
  const feed = createFeedLayout(host);
  feed.sync();
  const main = host.querySelector(".community-main")!;
  const aside = host.querySelector(".community-aside")!;
  const overview = aside.firstElementChild!;
  assert.equal(main.firstElementChild, banner);
  assert.equal(overview.className, "community-feed-overview community-card");
  assert.equal(overview.querySelector(".community-card-h h2")!.textContent, "社区动态");
  assert.equal(overview.querySelector(".community-banner-side"), side);
  checkin.click();
  assert.equal(clicks, 1);
  banner.querySelector("h1")!.textContent = "Community";
  feed.sync();
  assert.equal(overview.querySelector("h2")!.textContent, "Community activity");
  banner.querySelector("h1")!.textContent = "社区";
  feed.release();
  assert.equal(host.innerHTML, original);
  assert.deepEqual(Array.from(host.childNodes), originalNodes);
  checkin.click();
  assert.equal(clicks, 2);
});

test("feed preserves live summary replacements and sidebar rebuilding on release", (t) => {
  const { document, host } = fixture(t);
  const feed = createFeedLayout(host);
  feed.sync();
  const banner = host.querySelector(".community-banner")!;
  const oldSide = host.querySelector(".community-banner-side")!;
  const newSide = document.createElement("div");
  newSide.className = "community-banner-side";
  newSide.innerHTML = '<dl class="community-stats"><dt>主题</dt><dd>13</dd></dl><a href="#/community/checkin">已签到</a>';
  oldSide.replaceWith(newSide);
  feed.sync();
  assert.equal(host.querySelector(".community-feed-overview .community-banner-side"), newSide);
  const aside = host.querySelector(".community-aside")!;
  aside.innerHTML = '<a href="#/post/new-hot">新的热门</a>';
  feed.sync();
  assert.equal(aside.querySelector(".community-banner-side"), newSide);
  assert.equal(aside.querySelectorAll(".community-feed-overview").length, 1);
  feed.release();
  assert.equal(banner.querySelector(".community-banner-side"), newSide);
  assert.equal(host.contains(oldSide), false);
  assert.equal(aside.innerHTML, '<a href="#/post/new-hot">新的热门</a>');
  assert.equal(host.querySelector(".community-feed-overview"), null);
});

test("feed accepts a replacement banner and its current summary without reviving the old banner", (t) => {
  const { document, host } = fixture(t);
  const feed = createFeedLayout(host);
  feed.sync();
  const oldBanner = host.querySelector(".community-banner")!;
  const container = document.createElement("div");
  container.innerHTML = bannerMarkup.replace("12", "99").replace("社区</h1>", "Community</h1>");
  const newBanner = container.firstElementChild!;
  oldBanner.replaceWith(newBanner);
  feed.sync();
  assert.equal(host.querySelectorAll(".community-banner").length, 1);
  assert.equal(host.querySelector(".community-banner"), newBanner);
  assert.equal(host.querySelector(".community-feed-overview h2")!.textContent, "Community activity");
  assert.equal(host.querySelector(".community-feed-overview dd")!.textContent, "99");
  assert.equal(oldBanner.outerHTML, bannerMarkup);
  feed.release();
  assert.equal(host.firstElementChild, newBanner);
  assert.equal(newBanner.querySelector("dd")!.textContent, "99");
  assert.equal(host.contains(oldBanner), false);
});

test("feed upgrades only known same-origin community thumbnails and restores their exact attributes", (t) => {
  const { document, host } = fixture(t);
  const images = host.querySelector(".community-topic-thumbs")!;
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const sources = [`/api/community/images/${id}.thumb.webp`, `http://localhost/api/community/images/${id}.thumb.webp`, `https://other.example/api/community/images/${id}.thumb.webp`, `/api/community/images/${id}.thumb.webp?custom=1`, "/fixture.webp", "/api/community/images/not-an-id.thumb.webp"];
  images.replaceChildren(...sources.map(src => {
    const img = document.createElement("img");
    img.setAttribute("src", src);
    img.setAttribute("width", "84");
    img.setAttribute("height", "60");
    img.setAttribute("loading", "lazy");
    return img;
  }));
  const original = images.innerHTML;
  const feed = createFeedLayout(host);
  feed.sync();
  const next = Array.from(images.querySelectorAll("img"));
  assert.deepEqual(next.map(img => img.getAttribute("src")), [`/api/community/images/${id}.webp`, `/api/community/images/${id}.webp`, ...sources.slice(2)]);
  assert.ok(next.every(img => img.width === 84 && img.height === 60 && img.getAttribute("loading") === "lazy"));
  feed.release();
  assert.equal(images.innerHTML, original);
});

test("feed respects source updates and restores removed image nodes without reviving them", (t) => {
  const { document, host } = fixture(t);
  const img = host.querySelector("img")!;
  const thumb = "/api/community/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.thumb.webp";
  img.setAttribute("src", thumb);
  const feed = createFeedLayout(host);
  feed.sync();
  img.setAttribute("src", "/updated.webp");
  feed.sync();
  assert.equal(img.getAttribute("src"), "/updated.webp");
  img.setAttribute("src", thumb);
  feed.sync();
  const replacement = document.createElement("img");
  replacement.setAttribute("src", "/replacement.webp");
  img.replaceWith(replacement);
  feed.sync();
  assert.equal(img.getAttribute("src"), thumb);
  feed.release();
  assert.equal(host.querySelector("img"), replacement);
  assert.equal(replacement.getAttribute("src"), "/replacement.webp");
});

test("feed ignores nested columns and already ordered sibling columns", (t) => {
  const { host } = fixture(t);
  for (const content of [
    '<div class="community-layout"><div><aside class="community-aside">热门</aside></div><div class="community-main">帖子</div></div>',
    '<div class="community-layout"><div class="community-main">帖子</div><aside class="community-aside">热门</aside></div>',
    '<div><div class="community-layout"><aside class="community-aside">热门</aside><div class="community-main">帖子</div></div></div>',
  ]) {
    host.innerHTML = content;
    const feed = createFeedLayout(host);
    feed.sync();
    assert.equal(host.innerHTML, content);
    feed.release();
    assert.equal(host.innerHTML, content);
  }
});

test("replacing the main column never resurrects the previous business subtree", async (t) => {
  const { document, host, stop } = fixture(t, true);
  const oldMain = host.querySelector(".community-main")!;
  const replacement = document.createElement("div");
  replacement.className = "community-main";
  replacement.innerHTML = `<div class="community-topics">${topicMarkup}</div>`;
  oldMain.replaceWith(replacement);
  await settle();
  assert.equal(host.querySelectorAll(".community-main").length, 1);
  assert.equal(host.querySelector(".community-main"), replacement);
  assert.equal(oldMain.querySelector(".community-feed-byline"), null);
  assert.equal(replacement.querySelectorAll(".community-feed-byline").length, 1);
  stop();
  assert.equal(host.querySelectorAll(".community-main").length, 1);
  assert.equal(host.querySelector(".community-main"), replacement);
  assert.equal(host.querySelector(".community-feed-byline"), null);
  assert.equal(host.outerHTML, hostMarkup);
});

test("replacing topics or their content restores detached nodes and enhances only new nodes", async (t) => {
  const { document, host } = fixture(t, true);
  const oldTopic = document.querySelector<HTMLElement>(".community-topic")!;
  const expected = new JSDOM(topicMarkup, { url: "http://localhost" });
  const original = expected.window.document.querySelector("article")!.outerHTML;
  expected.window.close();
  const replacement = document.createElement("div");
  replacement.innerHTML = topicMarkup;
  const newTopic = replacement.firstElementChild!;
  oldTopic.replaceWith(newTopic);
  await settle();
  assert.equal(oldTopic.outerHTML, original);
  assert.equal(newTopic.querySelectorAll(".community-feed-byline").length, 1);
  const oldMain = newTopic.querySelector(".community-topic-main")!;
  const oldMainOriginal = oldTopic.querySelector(".community-topic-main")!.outerHTML;
  const nextMain = document.createElement("div");
  nextMain.innerHTML = oldMainOriginal;
  oldMain.replaceWith(nextMain.firstElementChild!);
  await settle();
  assert.equal(oldMain.outerHTML, oldMainOriginal);
  assert.equal(host.querySelectorAll(".community-feed-byline").length, 1);
});

test("feed host replacement, pagehide, BFCache and disposal restore exact original DOM", async (t) => {
  const { document, window, host, stop } = fixture(t, true);
  const newHost = document.createElement("div");
  newHost.innerHTML = hostMarkup;
  host.replaceWith(newHost.firstElementChild!);
  await settle();
  assert.equal(host.outerHTML, hostMarkup);
  assert.equal(document.querySelectorAll(".community-feed-byline").length, 1);
  window.dispatchEvent(new window.PageTransitionEvent("pagehide"));
  assert.equal(document.querySelector("#main")!.innerHTML, hostMarkup);
  window.dispatchEvent(new window.PageTransitionEvent("pageshow", { persisted: true }));
  assert.equal(document.querySelectorAll(".community-feed-byline").length, 1);
  stop();
  assert.equal(document.querySelector("#main")!.innerHTML, hostMarkup);
  await settle();
  assert.equal(document.querySelector("#main")!.innerHTML, hostMarkup);
});

test("feed tolerates missing author or time without creating empty wrappers", (t) => {
  const { host } = fixture(t);
  host.querySelector(".community-who")!.remove();
  const original = host.innerHTML;
  const bylines = createFeedLayout(host);
  bylines.sync();
  assert.equal(host.querySelector(".community-feed-byline"), null);
  bylines.release();
  assert.equal(host.innerHTML, original);
});
