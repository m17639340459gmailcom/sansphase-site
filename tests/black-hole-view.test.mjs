import test from "node:test";
import assert from "node:assert/strict";
import { blackHoleView, descentReadout } from "../src/black-hole-view.mjs";

test("the opening rests at 14 Rs with nothing covering it", () => {
  const view = blackHoleView(0);
  assert.equal(view.distance, 14);
  assert.equal(view.blackout, 0);
  assert.equal(view.emerge, 0);
  assert.equal(view.readout, 0, "no readout while nothing is falling");
  assert.equal(view.visible, true);
  assert.ok(view.centerX > 0.6, "landscape frames the hole to the right of the headline");
  assert.equal(blackHoleView(0, { portrait: true }).centerX, 0.5);
});

test("the dive closes in monotonically, darkens at the horizon, then opens the next chapter", () => {
  let previous = Infinity;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const view = blackHoleView(p);
    assert.ok(view.distance <= previous + 1e-9, "the camera never backs away while falling in");
    assert.ok(view.timeRate > 0 && view.timeRate < 1);
    previous = view.distance;
  }
  assert.equal(blackHoleView(0.5).blackout, 0);
  assert.equal(blackHoleView(0.92).blackout, 1);
  assert.ok(blackHoleView(0.3).readout > 0.9, "the readout shows during the fall");
  assert.equal(blackHoleView(1).emerge, 1);
  assert.equal(blackHoleView(1).visible, false, "the hole is no longer drawn at chapter 1");
  assert.equal(blackHoleView(2.5).visible, false);
});

test("the entrance flies in from further out while the disk warms up", () => {
  const start = blackHoleView(0, { entrance: 0 }),
    end = blackHoleView(0, { entrance: 1 });
  assert.equal(start.distance, 24);
  assert.equal(start.heat, 0);
  assert.equal(end.distance, 14);
  assert.equal(end.heat, 1);
});

test("the descent readout is plain text in both languages", () => {
  const view = blackHoleView(0.5);
  assert.match(descentReadout(view), /^r \d+\.\d Rs · 时间流速 0\.\d\d× · 视场 \d+°$/);
  assert.match(descentReadout(view, true), /^r \d+\.\d Rs · time rate 0\.\d\d× · FOV \d+°$/);
});
