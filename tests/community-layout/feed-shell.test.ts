import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test, type TestContext } from "node:test";
import { createFeedShell } from "../../src/community-layout/feed-shell.ts";

interface TestWindow extends Window {
  MutationObserver: typeof MutationObserver;
}
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: { url: string }) => { window: TestWindow };
};
const navMarkup = '<nav id="navigation" class="nav community-nav"><span class="nav-indicator"></span><a href="#/community/home" aria-current="page">首页</a><a href="#/community/boards">版块</a><a href="#/community/checkin">签到</a><a href="#/community/shop">兑换</a><a href="#/community/rank">排行</a></nav>';
const headerMarkup = `<header id="site-header" class="community-header"><a class="community-brand" href="#/community/home">社区</a>${navMarkup}<div class="header-actions"><button data-action="menu" aria-controls="navigation">菜单</button></div></header>`;
const hostMarkup = '<section class="community-page" data-community="home"><div class="community-layout"><div class="community-main"><form class="community-search" data-community-form="search"><input name="q"></form><a class="community-post" href="#/community/new"><span>发帖</span></a></div><aside class="community-aside">热门</aside></div></section>';
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(t: TestContext, narrow = false) {
  const { window } = new JSDOM(`${headerMarkup}<main id="main">${hostMarkup}</main>`, { url: "http://localhost/?interior=feed#/community/home" });
  const callbacks = new Set<EventListenerOrEventListenerObject>();
  const media = {
    matches: narrow,
    addEventListener: (_type: string, callback: EventListenerOrEventListenerObject | null) => { if (callback) callbacks.add(callback); },
    removeEventListener: (_type: string, callback: EventListenerOrEventListenerObject | null) => { if (callback) callbacks.delete(callback); },
  };
  const shellWindow = { matchMedia: (query: string) => { assert.equal(query, "(max-width: 1200px)"); return media; } };
  const document = window.document;
  const host = document.querySelector<HTMLElement>("[data-community]")!;
  const shell = createFeedShell(host, shellWindow);
  t.after(() => { shell.release(); window.close(); });
  const resize = (nextNarrow: boolean) => {
    media.matches = nextNarrow;
    for (const callback of callbacks) {
      if (typeof callback === "function") callback(new Event("change"));
      else callback.handleEvent(new Event("change"));
    }
  };
  return { window, document, host, shell, resize, callbacks, shellWindow };
}

test("desktop feed moves the original nav before main and restores exact nodes, links, focus and handlers", t => {
  const { document, host, shell } = fixture(t);
  const original = document.body.innerHTML;
  const nav = document.querySelector<HTMLElement>("#navigation")!;
  const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a"));
  const form = host.querySelector("form");
  let clicks = 0;
  links[2].addEventListener("click", event => { event.preventDefault(); clicks++; });
  links[2].focus();
  shell.sync();
  const rail = document.querySelector(".community-feed-rail")!;
  assert.equal(rail.parentElement, host.querySelector(".community-layout"));
  assert.equal(rail.nextElementSibling, host.querySelector(".community-main"));
  assert.equal(rail.querySelector("nav"), nav);
  assert.deepEqual(Array.from(nav.querySelectorAll("a")), links.filter((_, index) => index !== 1));
  assert.equal(document.activeElement, links[2]);
  assert.equal(document.querySelectorAll("#navigation").length, 1);
  assert.equal(host.querySelector("form"), form);
  assert.equal(rail.querySelector(".community-feed-rail-compose")!.getAttribute("href"), "#/community/new");
  assert.equal(rail.querySelector(".community-feed-rail-compose")!.textContent, "发布讨论");
  assert.equal(rail.querySelector(".community-feed-return")!.getAttribute("href"), "#/home");
  links[2].click();
  assert.equal(clicks, 1);
  shell.release();
  assert.equal(document.body.innerHTML, original);
  assert.equal(document.activeElement, links[2]);
  links[2].click();
  assert.equal(clicks, 2);
  shell.release();
  assert.equal(document.body.innerHTML, original);
});

test("narrow layout retains header navigation and a breakpoint change restores it immediately", t => {
  const { document, shell, resize, callbacks } = fixture(t, true);
  const original = document.body.innerHTML;
  shell.sync();
  assert.equal(document.body.innerHTML, original);
  resize(false);
  assert.ok(document.querySelector(".community-feed-rail #navigation"));
  resize(true);
  assert.equal(document.body.innerHTML, original);
  resize(false);
  assert.equal(document.querySelectorAll("#navigation").length, 1);
  shell.release();
  assert.equal(callbacks.size, 0);
  resize(false);
  shell.sync();
  assert.equal(document.body.innerHTML, original);
});

test("stable sync has no observer mutations", async t => {
  const { document, window, shell } = fixture(t);
  shell.sync();
  let mutations = 0;
  const observer = new window.MutationObserver(records => { mutations += records.length; });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  for (let iteration = 0; iteration < 5; iteration++) shell.sync();
  await settle();
  assert.equal(mutations, 0);
  observer.disconnect();
});

test("the duplicate boards entry is omitted on desktop and restores the same node and handler on resize", t => {
  const { document, shell, resize } = fixture(t);
  const nav = document.querySelector<HTMLElement>("#navigation")!;
  const board = nav.querySelector<HTMLAnchorElement>('a[href="#/community/boards"]')!;
  const original = nav.innerHTML;
  let clicks = 0;
  board.addEventListener("click", event => { event.preventDefault(); clicks++; });
  shell.sync();
  assert.equal(nav.querySelector('a[href="#/community/boards"]'), null);
  assert.equal(board.isConnected, false);
  resize(true);
  assert.equal(nav.querySelector('a[href="#/community/boards"]'), board);
  assert.equal(nav.innerHTML, original);
  board.click();
  assert.equal(clicks, 1);
  resize(false);
  shell.release();
  assert.equal(nav.innerHTML, original);
  assert.equal(nav.querySelector('a[href="#/community/boards"]'), board);
  board.click();
  assert.equal(clicks, 2);
});

test("a focused removed boards entry moves focus to the current home destination", t => {
  const { document, shell } = fixture(t);
  document.querySelector<HTMLAnchorElement>('#navigation a[href="#/community/boards"]')!.focus();
  const home = document.querySelector('#navigation a[href="#/community/home"]');
  shell.sync();
  assert.equal(document.activeElement, home);
});

test("in-place nav rebuilding replaces the omitted board with the fresh app-owned link", t => {
  const { document, shell, resize } = fixture(t);
  const nav = document.querySelector<HTMLElement>("#navigation")!;
  const oldBoard = nav.querySelector('a[href="#/community/boards"]');
  shell.sync();
  nav.innerHTML = '<a href="#/community/home" aria-current="page">Home</a><a href="#/community/boards">New boards</a><a href="#/community/checkin">Check in</a>';
  const freshBoard = nav.querySelector('a[href="#/community/boards"]');
  shell.sync();
  assert.equal(nav.querySelector('a[href="#/community/boards"]'), null);
  resize(true);
  assert.equal(nav.querySelector('a[href="#/community/boards"]'), freshBoard);
  assert.equal(freshBoard!.textContent, "New boards");
  assert.equal(oldBoard!.isConnected, false);
});

test("navigation icons preserve original children and decorate the four retained exact routes", t => {
  const { document, shell } = fixture(t);
  const nav = document.querySelector<HTMLElement>("#navigation")!;
  const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a"));
  const originalIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  originalIcon.classList.add("community-feed-nav-icon");
  links[0].prepend(originalIcon);
  const badge = document.createElement("i");
  badge.className = "community-nav-dot";
  links[2].append(badge);
  const unknown = document.createElement("a");
  unknown.href = "#/community/boards/qa";
  unknown.textContent = "问答";
  nav.append(unknown);
  const original = nav.outerHTML;
  const childNodes = links.map(link => Array.from(link.childNodes));
  const labels = links.map(link => link.textContent);
  shell.sync();
  const shapes = new Set<string>();
  for (const [index, link] of links.entries()) {
    if (index === 1) { assert.equal(link.isConnected, false); continue; }
    const icon = link.firstElementChild!;
    assert.equal(icon.tagName.toLowerCase(), "svg");
    assert.ok(icon.classList.contains("ui-icon"));
    assert.ok(icon.classList.contains("community-feed-nav-icon"));
    assert.equal(icon.getAttribute("aria-hidden"), "true");
    assert.equal(icon.getAttribute("focusable"), "false");
    assert.equal(link.textContent, labels[index]);
    assert.deepEqual(Array.from(link.childNodes).slice(1), childNodes[index]);
    shapes.add(icon.innerHTML);
  }
  assert.equal(shapes.size, 4);
  assert.equal(unknown.querySelector("svg"), null);
  for (let iteration = 0; iteration < 5; iteration++) shell.sync();
  assert.equal(nav.querySelectorAll(".community-feed-nav-icon").length, 5);
  shell.release();
  assert.equal(nav.outerHTML, original);
  assert.equal(links[0].firstElementChild, originalIcon);
  assert.equal(links[2].lastElementChild, badge);
});

test("narrow restoration removes only added icons and wider reentry adds each once", t => {
  const { document, shell, resize } = fixture(t);
  const nav = document.querySelector<HTMLElement>("#navigation")!;
  const original = nav.innerHTML;
  shell.sync();
  const oldIcons = Array.from(nav.querySelectorAll(".community-feed-nav-icon"));
  assert.equal(oldIcons.length, 4);
  resize(true);
  assert.equal(nav.innerHTML, original);
  assert.ok(oldIcons.every(icon => !icon.isConnected));
  resize(false);
  shell.sync();
  assert.equal(nav.querySelectorAll(".community-feed-nav-icon").length, 4);
  shell.release();
  assert.equal(nav.innerHTML, original);
});

test("header rebuilding adopts its new nav without restoring obsolete links or duplicating ids", t => {
  const { document, shell } = fixture(t);
  shell.sync();
  const oldNav = document.querySelector("#navigation")!;
  const header = document.querySelector("#site-header")!;
  header.innerHTML = '<a class="community-brand">Community</a>' + navMarkup.replace("首页", "Home") + '<div class="header-actions">Current account</div>';
  const newNav = header.querySelector("#navigation")!;
  shell.sync();
  assert.equal(document.querySelectorAll("#navigation").length, 1);
  assert.equal(document.querySelector(".community-feed-rail #navigation"), newNav);
  assert.equal(oldNav.isConnected, false);
  shell.release();
  assert.equal(header.querySelector("#navigation"), newNav);
  assert.equal(header.querySelector(".header-actions")!.textContent, "Current account");
  assert.equal(document.querySelectorAll("#navigation").length, 1);
});

test("header rebuilding transfers nav focus only to the replacement link with the same href", t => {
  const { document, shell } = fixture(t);
  shell.sync();
  const oldLink = document.querySelector<HTMLAnchorElement>('#navigation a[href="#/community/checkin"]')!;
  oldLink.focus();
  const header = document.getElementById("site-header")!;
  header.innerHTML = navMarkup.replace("签到", "新签到");
  const nextLink = header.querySelector<HTMLAnchorElement>('a[href="#/community/checkin"]')!;
  shell.sync();
  assert.equal(document.activeElement, nextLink);
  assert.equal(oldLink.isConnected, false);
  assert.equal(nextLink.textContent, "新签到");
  assert.ok(nextLink.closest(".community-feed-rail"));
});

test("header rebuilding does not steal focus from a control outside the previous navigation", t => {
  const { document, shell } = fixture(t);
  shell.sync();
  document.querySelector<HTMLAnchorElement>('#navigation a[href="#/community/checkin"]')!.focus();
  const input = document.querySelector<HTMLInputElement>('.community-search input')!;
  input.focus();
  document.getElementById("site-header")!.innerHTML = navMarkup;
  shell.sync();
  assert.equal(document.activeElement, input);
});

test("header rebuilding without a matching destination does not select another navigation link", t => {
  const { document, shell } = fixture(t);
  shell.sync();
  const oldLink = document.querySelector<HTMLAnchorElement>('#navigation a[href="#/community/checkin"]')!;
  oldLink.focus();
  document.getElementById("site-header")!.innerHTML = navMarkup.replace('<a href="#/community/checkin">签到</a>', '');
  shell.sync();
  assert.equal(oldLink.isConnected, false);
  assert.equal(document.activeElement, document.body);
});

test("layout replacement keeps the live header nav and never resurrects old business content", t => {
  const { document, host, shell } = fixture(t);
  shell.sync();
  const nav = document.querySelector("#navigation")!;
  const oldLayout = host.querySelector(".community-layout")!;
  const next = document.createElement("div");
  next.className = "community-layout";
  next.innerHTML = '<div class="community-main"><a class="community-post" href="#/community/new/qa">New post</a><p>Current results</p></div><aside class="community-aside">Current hot</aside>';
  oldLayout.replaceWith(next);
  shell.sync();
  assert.equal(document.querySelector("#navigation"), nav);
  assert.equal(next.querySelector(".community-feed-rail #navigation"), nav);
  assert.equal(next.querySelector(".community-feed-rail-compose")!.getAttribute("href"), "#/community/new/qa");
  assert.equal(next.querySelector(".community-feed-rail-compose")!.textContent, "Publish");
  assert.equal(next.querySelector(".community-feed-return")!.textContent, "Back to main site");
  assert.equal(oldLayout.querySelector(".community-feed-rail"), null);
  shell.release();
  assert.equal(host.querySelector(".community-layout"), next);
  assert.equal(document.querySelector("#site-header #navigation"), nav);
});

test("a replaced host can release its nav before the new feed starts", t => {
  const { document, host, shell, shellWindow } = fixture(t);
  shell.sync();
  const nav = document.querySelector("#navigation")!;
  const next = document.createElement("div");
  next.innerHTML = hostMarkup;
  const nextHost = next.firstElementChild as HTMLElement;
  host.replaceWith(nextHost);
  shell.release();
  assert.equal(document.querySelector("#site-header #navigation"), nav);
  assert.equal(host.outerHTML, hostMarkup);
  const nextShell = createFeedShell(nextHost, shellWindow);
  nextShell.sync();
  assert.equal(nextHost.querySelector(".community-feed-rail #navigation"), nav);
  nextShell.release();
});

test("missing header, layout, main or matchMedia leaves the page untouched", t => {
  for (const remove of ["#site-header", ".community-layout", ".community-main"]) {
    const { document, shell } = fixture(t);
    document.querySelector(remove)!.remove();
    const original = document.body.innerHTML;
    shell.sync();
    shell.release();
    assert.equal(document.body.innerHTML, original);
  }
  const { document, host } = fixture(t);
  const original = document.body.innerHTML;
  const shell = createFeedShell(host, {});
  shell.sync();
  shell.release();
  assert.equal(document.body.innerHTML, original);
});
