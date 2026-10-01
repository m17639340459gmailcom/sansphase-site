import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Keep test module instances isolated across independent navigation fixtures.
let copies = 0;
const load = () => import(`../src/nav-slider.mjs?copy=${copies++}`);

function nav(current) {
  const dom = new JSDOM(
    `<!doctype html><nav id="navigation"><a href="#/notes">博客</a><a href="#/works">作品</a><a href="#/software">软件推荐</a></nav>`,
    { pretendToBeVisual: true },
  );
  const doc = dom.window.document;
  // jsdom has no layout: give each link a fixed box.
  [...doc.querySelectorAll("a")].forEach((link, index) => {
    Object.defineProperty(link, "offsetLeft", { get: () => 8 + index * 80 });
    Object.defineProperty(link, "offsetWidth", { get: () => 64 + index * 10 });
  });
  if (current !== undefined) doc.querySelectorAll("a")[current].setAttribute("aria-current", "page");
  return { dom, doc, w: dom.window, el: doc.querySelector("nav") };
}
const frame = (w) => new Promise((resolve) => w.requestAnimationFrame(() => resolve()));

test("one highlight sits on the current section and follows the pointer and focus", async () => {
  const { mountNavSlider } = await load();
  const { w, doc, el } = nav(0);
  const dispose = mountNavSlider(el);
  const indicator = el.querySelector(".nav-indicator");
  assert.equal(indicator.getAttribute("aria-hidden"), "true");
  assert.equal(el.firstElementChild, indicator, "the highlight sits under the links");
  await frame(w);
  assert.equal(indicator.style.transform, "translateX(8px)");
  assert.equal(indicator.style.width, "64px");
  assert(indicator.classList.contains("is-visible"));
  const links = doc.querySelectorAll("a");
  links[2].dispatchEvent(new w.Event("pointerover", { bubbles: true }));
  assert.equal(indicator.style.transform, "translateX(168px)");
  assert.equal(indicator.style.width, "84px");
  el.dispatchEvent(new w.Event("pointerleave"));
  assert.equal(indicator.style.transform, "translateX(8px)", "it returns to the current section");
  links[1].dispatchEvent(new w.FocusEvent("focusin", { bubbles: true }));
  assert.equal(indicator.style.transform, "translateX(88px)");
  links[1].dispatchEvent(new w.FocusEvent("focusout", { bubbles: true, relatedTarget: links[2] }));
  assert.equal(indicator.style.transform, "translateX(88px)", "moving focus within the navigation does not snap back");
  dispose();
  links[2].dispatchEvent(new w.Event("pointerover", { bubbles: true }));
  assert.equal(indicator.style.transform, "translateX(88px)", "cleanup stops following");
  w.close();
});

test("a re-rendered header is already on its current section before a route snapshot", async () => {
  const { mountNavSlider } = await load();
  const first = nav(0);
  const disposeFirst = mountNavSlider(first.el);
  await frame(first.w);
  disposeFirst();
  first.w.close();
  const next = nav(2);
  const dispose = mountNavSlider(next.el);
  const indicator = next.el.querySelector(".nav-indicator");
  assert.equal(indicator.style.transform, "translateX(168px)", "never snapshots an old hover/route position");
  assert(indicator.classList.contains("is-visible"));
  assert(!indicator.classList.contains("is-instant"));
  await frame(next.w);
  assert.equal(indicator.style.transform, "translateX(168px)");
  dispose();
  next.w.close();
});

test("a route outside the navigation never flashes a remembered hover highlight", async () => {
  const { mountNavSlider } = await load();
  const first = nav(0);
  const cleanup = mountNavSlider(first.el);
  await frame(first.w);
  first.el.querySelectorAll('a')[2].dispatchEvent(new first.w.Event('pointerover', { bubbles:true }));
  cleanup();
  const next = nav();
  const dispose = mountNavSlider(next.el);
  assert(!next.el.querySelector('.nav-indicator').classList.contains('is-visible'));
  dispose(); first.w.close(); next.w.close();
});

test("pages outside the navigation show no highlight", async () => {
  const { mountNavSlider } = await load();
  const { w, el } = nav();
  const dispose = mountNavSlider(el);
  await frame(w);
  assert(!el.querySelector(".nav-indicator").classList.contains("is-visible"));
  assert.equal(typeof mountNavSlider(null), "function", "no navigation, nothing to do");
  dispose();
  w.close();
});
