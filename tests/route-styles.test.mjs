import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ensureRouteStyle } from "../src/route-styles.mjs";

function page() {
  return new JSDOM(`<!doctype html><html><head>
    <link rel="stylesheet" href="./catalog.css">
    <link rel="stylesheet" href="./visitor-controls.css">
    <link rel="stylesheet" href="./reader.css">
  </head><body></body></html>`, { url: "https://www.sansphase.com/" });
}

test("route styles load once, preserving book-before-author-before-visitor order", async () => {
  const dom = page();
  const { document } = dom.window;
  const author = ensureRouteStyle(document, "author");
  const book = ensureRouteStyle(document, "book");
  assert.equal(ensureRouteStyle(document, "book"), book);
  assert.deepEqual([...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.getAttribute("href")), [
    "./catalog.css", "./book-reader.css", "./author.css", "./visitor-controls.css", "./reader.css",
  ]);
  document.querySelector('[data-route-style="author"]').dispatchEvent(new dom.window.Event("load"));
  document.querySelector('[data-route-style="book"]').dispatchEvent(new dom.window.Event("load"));
  await Promise.all([author, book]);
  dom.window.close();
});

test("failed route style load can be retried without leaving a broken link", async () => {
  const dom = page();
  const { document } = dom.window;
  const first = ensureRouteStyle(document, "book");
  document.querySelector('[data-route-style="book"]').dispatchEvent(new dom.window.Event("error"));
  await assert.rejects(first);
  assert.equal(document.querySelector('[data-route-style="book"]'), null);
  const retry = ensureRouteStyle(document, "book");
  document.querySelector('[data-route-style="book"]').dispatchEvent(new dom.window.Event("load"));
  await retry;
  dom.window.close();
});

test("route style URLs honor the existing static asset base", async () => {
  const dom = page();
  const { document } = dom.window;
  document.documentElement.dataset.staticBase = "https://static.example/assets/site/version/";
  const pending = ensureRouteStyle(document, "author");
  assert.equal(document.querySelector('[data-route-style="author"]').href, "https://static.example/assets/site/version/author.css");
  document.querySelector('[data-route-style="author"]').dispatchEvent(new dom.window.Event("load"));
  await pending;
  dom.window.close();
});
