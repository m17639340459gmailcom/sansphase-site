import test from "node:test";
import assert from "node:assert/strict";
import { journeyStep } from "../src/journey.mjs";

test("ordinary travel is its own journey", () => {
  const step = journeyStep(1.4, null);
  assert.equal(step.virtual, 1.4);
  assert.equal(step.chapterOf(2), 2);
  assert.equal(journeyStep(1.4, { from: 1, to: 2 }).virtual, 1.4, "a one-chapter rail step needs no mapping");
});

test("a jump across chapters flies as one step between its real ends", () => {
  const jump = { from: 1, to: 3 };
  assert.equal(journeyStep(1, jump).virtual, 1);
  assert.equal(journeyStep(2, jump).virtual, 1.5, "halfway through the jump is halfway through one step");
  assert.equal(journeyStep(3, jump).virtual, 2);
  const mid = journeyStep(2, jump);
  assert.equal(mid.chapterOf(1), 1);
  assert.equal(mid.chapterOf(2), 3, "the far end of the step is the real destination");
});

test("jumps to or from the opening are a single dive or emergence", () => {
  const out = { from: 0, to: 3 };
  assert.equal(journeyStep(0, out).virtual, 0);
  assert.equal(journeyStep(1.5, out).virtual, 0.5);
  assert.equal(journeyStep(3, out).chapterOf(1), 3);
  const back = { from: 3, to: 0 };
  assert.equal(journeyStep(3, back).virtual, 1);
  assert.equal(journeyStep(0, back).virtual, 0);
  assert.equal(journeyStep(3, back).chapterOf(1), 3, "the hole is left from the real chapter's sky");
  const down = { from: 3, to: 1 };
  assert.equal(journeyStep(3, down).virtual, 3);
  assert.equal(journeyStep(1, down).virtual, 2);
  assert.equal(journeyStep(1, down).chapterOf(2), 1);
});
