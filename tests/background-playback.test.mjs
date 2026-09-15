import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { observeBackgroundPlayback } from "../src/background-playback.mjs";

test("background playback follows actual page visibility and releases observers", async () => {
  const dom = new JSDOM("<body></body>", { pretendToBeVisual: true });
  const doc = dom.window.document, changes = [];
  let hidden = false;
  Object.defineProperty(doc, "hidden", { get: () => hidden });
  const flush = () => new Promise(resolve => dom.window.queueMicrotask(resolve));
  const stop = observeBackgroundPlayback(doc, value => changes.push(value));
  assert.deepEqual(changes, [true], "homepage has no background animation loop");
  doc.body.classList.add("blog-open"); await flush();
  assert.deepEqual(changes, [true, false]);
  doc.body.classList.add("theme-light"); await flush();
  assert.equal(changes.length, 2, "unrelated classes must not restart the canvas");
  hidden = true; doc.dispatchEvent(new dom.window.Event("visibilitychange"));
  assert.equal(changes.at(-1), true);
  hidden = false; doc.dispatchEvent(new dom.window.Event("visibilitychange"));
  assert.equal(changes.at(-1), false);
  doc.body.classList.remove("blog-open"); await flush();
  assert.equal(changes.at(-1), true);
  stop(); doc.body.classList.add("blog-open"); await flush();
  assert.equal(changes.at(-1), true);
  dom.window.close();
});
