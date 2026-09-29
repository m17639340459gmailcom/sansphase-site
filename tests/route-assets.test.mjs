import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountRouteAssets } from "../src/route-assets.mjs";

test("home and content routes load no author code until it is asked for", async () => {
  const dom = new JSDOM("<button data-author-login>登录</button>", {
    url: "https://www.sansphase.com/#/home",
  });
  let authors = 0;
  const dispose = mountRouteAssets(dom.window, {
    loadAuthorStyle: async () => {},
    loadAuthor: async () => authors++,
  });
  assert.equal(authors, 0);
  dom.window.location.hash = "#/notes";
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(authors, 0);
  dispose();
  dom.window.close();
});

test("the site shell no longer starts a background WebGL layer", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile("src/index.html", "utf8");
  assert.doesNotMatch(html, /blog-galaxy/);
});

test("a first login click waits for the editor and opens it exactly once", async () => {
  const dom = new JSDOM("<button data-author-login>登录</button>", {
    url: "https://www.sansphase.com/#/notes",
  });
  const { document } = dom.window;
  let finish,
    opened = 0,
    loads = 0;
  const dispose = mountRouteAssets(dom.window, {
    loadBackground: async () => {},
    loadAuthorStyle: async () => {},
    loadAuthor: async () => {
      loads++;
      await new Promise((r) => (finish = r));
      document.addEventListener("click", () => opened++);
    },
  });
  const button = document.querySelector("button");
  button.click();
  button.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(loads, 1);
  assert.equal(opened, 0);
  assert.equal(button.getAttribute("aria-busy"), "true");
  finish();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(opened, 1);
  assert.equal(button.textContent, "登录");
  button.click();
  assert.equal(opened, 2);
  dispose();
  dom.window.close();
});

test("failed editor download permits retry and a removed login button is not replayed", async () => {
  const dom = new JSDOM("<button data-author-login>登录</button>", {
    url: "https://www.sansphase.com/",
  });
  let attempt = 0,
    finish;
  const dispose = mountRouteAssets(dom.window, {
    loadBackground: async () => {},
    loadAuthorStyle: async () => {},
    loadAuthor: async () => {
      if (++attempt === 1) throw Error("network");
      await new Promise((r) => (finish = r));
    },
  });
  const button = dom.window.document.querySelector("button");
  button.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(button.getAttribute("aria-busy"), null);
  assert.match(button.title, /重试/);
  button.click();
  button.remove();
  await new Promise((r) => setTimeout(r, 0));
  finish();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(attempt, 2);
  dispose();
  dom.window.close();
});
