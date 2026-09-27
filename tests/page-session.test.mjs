import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const code = await readFile(new URL("../src/page-session.js", import.meta.url), "utf8");
const key = "sansphase-page-view-v1";
const entry = { route: "/#/notes", scrollY: 800, view: { calendarOpen: true } };
function boot({ type = "reload", saved = entry, hash = "#/notes", blocked = false } = {}) {
  const dom = new JSDOM("<main>Stable page</main>", { url: `https://test.invalid/${hash}`, runScripts: "outside-only" });
  const w = dom.window, calls = [];
  w.performance.getEntriesByType = () => [{ type }];
  w.history.scrollRestoration = "auto";
  w.scrollTo = (args) => calls.push(args);
  if (saved !== undefined) w.sessionStorage.setItem(key, typeof saved === "string" ? saved : JSON.stringify(saved));
  if (blocked) Object.defineProperty(w, "sessionStorage", { get() { throw new Error("blocked"); } });
  w.eval(code);
  return { dom, w, calls, session: w.sansphasePageSession };
}

test("manual reload restoration starts early, then commits once without moving DOM", () => {
  const { dom, w, calls, session } = boot();
  try {
    assert.equal(w.history.scrollRestoration, "manual");
    assert.equal(session.view.calendarOpen, true);
    assert.equal(calls.length, 0, "wait for complete synchronous rendering");
    const html = w.document.body.innerHTML;
    session.commit(); session.commit();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].top, 800);
    assert.equal(calls[0].behavior, "instant");
    assert.equal(w.document.body.innerHTML, html);
  } finally { dom.window.close(); }
});

test("new navigation, another route, invalid storage and blocked storage keep native defaults", () => {
  for (const options of [{ type: "navigate" }, { type: "back_forward" }, { hash: "#/home" },
    { saved: "{broken" }, { saved: { ...entry, scrollY: -1 } }, { blocked: true }]) {
    const { dom, w, calls, session } = boot(options);
    try {
      assert.equal(session.view, undefined);
      assert.equal(w.history.scrollRestoration, "auto");
      session.commit();
      assert.equal(calls.length, 0);
    } finally { dom.window.close(); }
  }
});

test("leaving saves browsing state without destroying or collapsing the departing DOM", () => {
  const { dom, w, session } = boot({ type: "navigate" });
  try {
    Object.defineProperty(w, "scrollY", { value: 1234 });
    session.trackView(() => ({ weatherOpen: true, blogView: "grid" }));
    const html = w.document.body.innerHTML;
    w.dispatchEvent(new w.PageTransitionEvent("pagehide", { persisted: false }));
    assert.deepEqual(JSON.parse(w.sessionStorage.getItem(key)), {
      route: "/#/notes", scrollY: 1234, view: { weatherOpen: true, blogView: "grid" },
    });
    assert.equal(w.document.body.innerHTML, html);
  } finally { dom.window.close(); }
});
