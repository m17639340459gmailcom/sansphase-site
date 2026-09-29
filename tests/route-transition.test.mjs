import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRouteTransitions } from "../src/route-transition.mjs";

function setup({ api = true, reduced = false } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  const { window: w } = dom, doc = w.document;
  w.matchMedia = () => ({ matches: reduced });
  const started = [];
  if (api)
    doc.startViewTransition = (update) => {
      const updateCallbackDone = Promise.resolve().then(update);
      const finished = updateCallbackDone.then(() => {});
      started.push({ kind: doc.documentElement.dataset.routeTransition, x: doc.documentElement.style.getPropertyValue("--route-x") });
      return { updateCallbackDone, finished, ready: Promise.resolve() };
    };
  return { w, doc, started, transitions: createRouteTransitions(doc, { settle: 0 }), close: () => dom.window.close() };
}

test("leaving the homepage warps; content pages rise; returning home is left to the scene", async () => {
  const s = setup();
  s.doc.dispatchEvent(new s.w.MouseEvent("pointerdown", { clientX: 140, clientY: 464 }));
  let updated = 0;
  await s.transitions.run("home", "notes", () => { updated++; });
  assert.equal(updated, 1);
  assert.deepEqual(s.started[0], { kind: "warp", x: "140px" }, "the iris opens where the visitor clicked");
  await s.transitions.run("notes", "note", () => { updated++; });
  assert.equal(s.started[1].kind, "page");
  assert.equal(s.transitions.run("note", "home", () => { updated++; return "plain"; }), "plain", "home keeps its own return");
  assert.equal(s.started.length, 2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(s.doc.documentElement.dataset.routeTransition, undefined, "the marker is cleared afterwards");
  s.transitions.dispose();
  s.close();
});

test("no API or reduced motion: the route simply updates", () => {
  for (const options of [{ api: false }, { reduced: true }]) {
    const s = setup(options);
    let updated = 0;
    assert.equal(s.transitions.run("home", "notes", () => { updated++; return "done"; }), "done");
    assert.equal(updated, 1);
    assert.equal(s.started.length, 0);
    s.close();
  }
});

test("between sections the content slides towards the one chosen, in navigation order", async () => {
  const order = ["notes", "works", "resources", "software"];
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  const { window: w } = dom, doc = w.document, root = doc.documentElement;
  w.matchMedia = () => ({ matches: false });
  const started = [];
  doc.startViewTransition = (update) => {
    started.push({ kind: root.dataset.routeTransition, dir: root.style.getPropertyValue("--route-dir") });
    const updateCallbackDone = Promise.resolve().then(update);
    return { updateCallbackDone, finished: updateCallbackDone, ready: Promise.resolve() };
  };
  const transitions = createRouteTransitions(doc, { settle: 0, sectionOf: (page) => order.indexOf(page === "note" ? "notes" : page) });
  await transitions.run("notes", "software", () => {});
  await transitions.run("software", "works", () => {});
  await transitions.run("notes", "note", () => {});
  await transitions.run("contact", "notes", () => {});
  assert.deepEqual(started, [
    { kind: "slide", dir: "1" },
    { kind: "slide", dir: "-1" },
    { kind: "page", dir: "1" },
    { kind: "page", dir: "1" },
  ], "forward slides left, back slides right; within a section or outside the navigation it rises");
  transitions.dispose();
  w.close();
});
