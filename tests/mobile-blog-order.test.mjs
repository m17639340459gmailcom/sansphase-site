import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFile, readdir } from "node:fs/promises";
import { mountMobileBlogOrder } from "../src/mobile-blog-order.mjs";

test("mobile ordering shares the existing UI entry without another startup module request", async () => {
  const app = await readFile("dist/app.mjs", "utf8");
  const ui = await readFile("dist/ui.bundle.mjs", "utf8");
  assert.doesNotMatch(app, /from ["']\.\/mobile-blog-order\.mjs["']/);
  assert.match(ui, /mountMobileBlogOrder/);
  assert.ok(!(await readdir("dist")).includes("mobile-blog-order.mjs"));
});

test("mobile blog order moves original cards and restores desktop order on cleanup", () => {
  const dom = new JSDOM(`<div class="blog-layout">
    <section class="blog-main"><div class="blog-notice">notice</div><div class="blog-article-area"><div class="blog-search">search</div><div id="results">articles</div></div></section>
    <aside class="blog-left"><div class="blog-identity">profile</div><div class="blog-music-card">music</div><div class="blog-tags-card">tags</div></aside>
    <aside class="blog-sidebar"><div class="blog-weather-card">weather</div><div class="blog-date-card">time</div></aside>
  </div>`);
  const { document } = dom.window;
  const layout = document.querySelector(".blog-layout");
  const originals = [...layout.querySelectorAll(".blog-notice, .blog-identity, .blog-music-card, .blog-weather-card, .blog-date-card, .blog-article-area, .blog-tags-card")];
  const media = Object.assign(new dom.window.EventTarget(), { matches: false });
  dom.window.matchMedia = (query) => {
    assert.equal(query, "(max-width: 900px)");
    return media;
  };

  const cleanup = mountMobileBlogOrder(layout);
  media.matches = true;
  media.dispatchEvent(new dom.window.Event("change"));
  assert.ok(layout.classList.contains("is-mobile-flow"));
  assert.deepEqual(
    [...layout.children].filter((node) => node.matches?.(".blog-notice, .blog-identity, .blog-music-card, .blog-weather-card, .blog-date-card, .blog-article-area"))
      .map((node) => node.textContent.trim()),
    ["notice", "profile", "music", "weather", "time", "searchtagsarticles"],
    "phones show the announcement and side information before articles",
  );
  assert.equal(document.querySelector(".blog-tags-card").parentElement, document.querySelector(".blog-article-area"));
  assert.equal(document.querySelector(".blog-tags-card").previousElementSibling.className, "blog-search");
  assert.equal(document.querySelector(".blog-tags-card").nextElementSibling.id, "results");

  media.matches = false;
  media.dispatchEvent(new dom.window.Event("change"));
  assert.ok(!layout.classList.contains("is-mobile-flow"));
  assert.equal(document.querySelector(".blog-tags-card").parentElement.className, "blog-left");
  assert.ok(originals.every((node) => document.contains(node)), "cards must be moved, not recreated");

  cleanup();
  assert.doesNotMatch(layout.innerHTML, /card-position/, "cleanup removes position markers");
  media.matches = true;
  media.dispatchEvent(new dom.window.Event("change"));
  assert.ok(!layout.classList.contains("is-mobile-flow"), "cleanup removes the breakpoint listener");
  dom.window.close();
});
