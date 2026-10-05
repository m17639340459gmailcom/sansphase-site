import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test, type TestContext } from "node:test";
import { createFeedThread } from "../../src/community-layout/feed-thread.ts";

interface TestWindow extends Window { MutationObserver: typeof MutationObserver }
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: { url: string }) => { window: TestWindow };
};
const headerMarkup = '<div class="community-post-flags">精华</div><h1 id="community-post-title">真实作品</h1><div class="community-post-by"><a class="community-av" href="#/community/members/person">头像</a><span class="community-who">作者</span><time datetime="2026-10-04">今天</time><span class="community-views">3 次浏览</span></div>';

function fixture(t: TestContext) {
  const { window } = new JSDOM(`<section class="community-page" data-community="post" data-thread-design="feed"><div class="community-post-grid"><article class="community-thread"><nav class="community-crumb">社区</nav><div class="community-notice">审核状态</div><header class="community-post-head">${headerMarkup}</header><div class="community-gallery"><button data-action="community-lightbox">真实图片</button></div><div class="community-text">原正文</div><div class="community-bounty">悬赏</div><div class="community-res">资源反馈</div><div class="community-actbar"><button data-action="community-like">赞</button><button data-action="community-report">举报</button></div><section class="community-discussion"><h2>回复</h2></section><form data-community-form="reply"><textarea>未提交草稿</textarea></form></article><aside class="community-post-side"><section class="community-author-card"><button data-action="community-follow">关注</button></section><section class="community-prompt is-locked"><button data-action="community-unlock">解锁</button></section><ul class="community-related"><li>相关讨论</li></ul></aside></div></section>`, { url: "http://localhost/?interior=feed#/post/example" });
  const host = window.document.querySelector<HTMLElement>("section")!;
  const thread = createFeedThread(host);
  t.after(() => { thread.release(); window.close(); });
  return { window, document: window.document, host, thread };
}

test("thread presents the original author and publication metadata before the title", t => {
  const { host, thread } = fixture(t);
  const header = host.querySelector(".community-post-head")!;
  const byline = header.querySelector(".community-post-by");
  const title = header.querySelector("h1");
  const existing = [...host.querySelectorAll("button,form,textarea,.community-notice,.community-res,.community-bounty,.community-related")];
  thread.sync();
  assert.equal(header.firstElementChild, byline);
  assert.equal(header.lastElementChild, title);
  assert.equal(byline!.querySelectorAll("time,.community-av,.community-who,.community-views").length, 4);
  assert.deepEqual([...host.querySelectorAll("button,form,textarea,.community-notice,.community-res,.community-bounty,.community-related")], existing);
  assert.equal(host.querySelector("textarea")!.value, "未提交草稿");
});

test("moving metadata retains original node handlers and keyboard focus", t => {
  const { document, host, thread } = fixture(t);
  const author = host.querySelector<HTMLAnchorElement>(".community-post-by .community-av")!;
  let clicks = 0;
  author.addEventListener("click", event => { event.preventDefault(); clicks++; });
  author.focus();
  thread.sync();
  assert.equal(document.activeElement, author);
  author.click();
  assert.equal(clicks, 1);
  assert.equal(host.querySelector(".community-post-by .community-av"), author);
  thread.release();
  assert.equal(document.activeElement, author);
});

test("stable synchronization makes no mutations", t => {
  const { window, host, thread } = fixture(t);
  thread.sync();
  const observer = new window.MutationObserver(() => {});
  observer.observe(host, { childList: true, subtree: true, attributes: true, characterData: true });
  for (let index = 0; index < 4; index++) thread.sync();
  assert.equal(observer.takeRecords().length, 0);
  observer.disconnect();
});

test("release restores exact author/title order and removes placement markers", t => {
  const { host, thread } = fixture(t);
  const before = host.innerHTML;
  thread.sync();
  thread.release();
  thread.release();
  assert.equal(host.innerHTML, before);
});

test("a replacement header keeps fresh app data and the detached header is restored", t => {
  const { document, host, thread } = fixture(t);
  const oldHeader = host.querySelector(".community-post-head")!;
  const oldHTML = oldHeader.innerHTML;
  thread.sync();
  const replacement = document.createElement("header");
  replacement.className = "community-post-head";
  replacement.innerHTML = headerMarkup.replace("3 次浏览", "7 次浏览");
  oldHeader.replaceWith(replacement);
  thread.sync();
  assert.equal(oldHeader.innerHTML, oldHTML);
  assert.equal(replacement.firstElementChild?.className, "community-post-by");
  assert.equal(replacement.querySelector(".community-views")!.textContent, "7 次浏览");
  thread.release();
  assert.equal(replacement.lastElementChild?.className, "community-post-by");
});

test("an in-place renderer refresh supersedes stale author nodes", t => {
  const { host, thread } = fixture(t);
  const header = host.querySelector(".community-post-head")!;
  thread.sync();
  header.innerHTML = headerMarkup.replace("作者", "更新后的作者");
  thread.sync();
  assert.equal(header.firstElementChild?.className, "community-post-by");
  assert.equal(header.querySelectorAll(".community-post-by").length, 1);
  assert.equal(header.querySelector(".community-who")!.textContent, "更新后的作者");
});

test("non-feed and loading states stay untouched, and removing the scope restores the original order", t => {
  const { host, thread } = fixture(t);
  host.removeAttribute("data-thread-design");
  const before = host.innerHTML;
  thread.sync();
  assert.equal(host.innerHTML, before);
  host.dataset.threadDesign = "feed";
  thread.sync();
  host.removeAttribute("data-thread-design");
  thread.sync();
  assert.equal(host.innerHTML, before);
  host.replaceChildren();
  host.dataset.threadDesign = "feed";
  thread.sync();
  assert.equal(host.childNodes.length, 0);
});
