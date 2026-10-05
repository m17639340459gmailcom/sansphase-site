import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test, type TestContext } from "node:test";
import { createFeedPublicationTime } from "../../src/community-layout/feed-publication-time.ts";

interface TestWindow extends Window { MutationObserver: typeof MutationObserver; }
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options: { url: string }) => { window: TestWindow } };
const markup = '<header class="community-banner"><h1>社区</h1></header><article class="community-topic" data-created-at="2026-10-03T08:00:00Z"><div class="community-topic-main"><div class="community-feed-byline"><time datetime="2026-10-03T09:55:00Z" title="原回复时间"><span>远山</span> 5 分钟前回复</time></div></div></article>';
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(t: TestContext) {
  t.mock.method(Date, "now", () => Date.parse("2026-10-03T10:00:00Z"));
  const { window } = new JSDOM(`<section>${markup}</section>`, { url: "http://localhost" });
  const document = window.document;
  const host = document.querySelector<HTMLElement>("section")!;
  const topic = host.querySelector<HTMLElement>("article")!;
  const time = topic.querySelector<HTMLTimeElement>("time")!;
  const helper = createFeedPublicationTime(host);
  t.after(() => { helper.release(); window.close(); });
  return { window, document, host, topic, time, helper };
}

test("publication time comes from createdAt and restores the original time node, children, attributes and handlers", t => {
  const { host, time, helper } = fixture(t);
  const original = host.innerHTML;
  const nodes = Array.from(time.childNodes);
  const child = time.querySelector<HTMLElement>("span")!;
  let clicks = 0;
  child.addEventListener("click", () => { clicks++; });
  helper.sync();
  assert.equal(time.textContent, "2 小时前发布");
  assert.equal(time.dateTime, "2026-10-03T08:00:00Z");
  assert.equal(time.title, "2026-10-03 16:00 （北京时间）");
  assert.equal(host.querySelector("time"), time);
  helper.release();
  assert.equal(host.innerHTML, original);
  assert.deepEqual(Array.from(time.childNodes), nodes);
  child.click();
  assert.equal(clicks, 1);
  helper.release();
  assert.equal(host.innerHTML, original);
});

test("missing or invalid creation metadata and times outside the byline stay untouched", t => {
  const { topic, time, helper } = fixture(t);
  for (const value of [null, "", "not-a-date", '<script>bad()</script>']) {
    if (value === null) topic.removeAttribute("data-created-at");
    else topic.setAttribute("data-created-at", value);
    const original = time.outerHTML;
    helper.sync();
    assert.equal(time.outerHTML, original);
  }
  topic.setAttribute("data-created-at", "2026-10-03T08:00:00Z");
  time.parentElement!.className = "community-topic-meta";
  const original = time.outerHTML;
  helper.sync();
  assert.equal(time.outerHTML, original);
});

test("English output and changed creation metadata update without losing the original values", t => {
  const { host, topic, time, helper } = fixture(t);
  const original = time.outerHTML;
  helper.sync();
  host.querySelector("h1")!.textContent = "Community";
  topic.dataset.createdAt = "2026-10-03T09:00:00Z";
  helper.sync();
  assert.equal(time.textContent, "Published 1 h ago");
  assert.equal(time.dateTime, "2026-10-03T09:00:00Z");
  assert.equal(time.title, "2026-10-03 17:00 (Beijing time)");
  helper.release();
  assert.equal(time.outerHTML, original);
});

test("stable publication sync makes no DOM mutations", async t => {
  const { window, host, helper } = fixture(t);
  helper.sync();
  let mutations = 0;
  const observer = new window.MutationObserver(records => { mutations += records.length; });
  observer.observe(host, { childList: true, subtree: true, attributes: true, characterData: true });
  for (let index = 0; index < 5; index++) helper.sync();
  await settle();
  assert.equal(mutations, 0);
  observer.disconnect();
});

test("replacing a topic restores its detached time and only enhances the live replacement", t => {
  const { document, host, topic, time, helper } = fixture(t);
  const original = time.outerHTML;
  helper.sync();
  const replacement = document.createElement("div");
  replacement.innerHTML = markup;
  const next = replacement.querySelector("article")!;
  topic.replaceWith(next);
  helper.sync();
  assert.equal(time.outerHTML, original);
  assert.equal(host.querySelector("time")!.textContent, "2 小时前发布");
  helper.release();
  assert.equal(host.contains(topic), false);
  assert.equal(host.querySelector("article"), next);
  assert.equal(next.querySelector("time")!.outerHTML, original);
});

test("later business updates to a live time are preserved and missing metadata restores earlier text", t => {
  const { topic, time, helper } = fixture(t);
  helper.sync();
  time.textContent = "新回复内容";
  time.setAttribute("datetime", "2026-10-03T09:59:00Z");
  time.setAttribute("title", "新回复时间");
  helper.sync();
  assert.equal(time.textContent, "2 小时前发布");
  topic.removeAttribute("data-created-at");
  helper.sync();
  assert.equal(time.textContent, "新回复内容");
  assert.equal(time.dateTime, "2026-10-03T09:59:00Z");
  assert.equal(time.title, "新回复时间");
  helper.release();
  assert.equal(time.textContent, "新回复内容");
});
