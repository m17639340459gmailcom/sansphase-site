import assert from "node:assert/strict";
import test from "node:test";
import { constellationLayout } from "../../src/community-atlas/constellation-layout.ts";
import type { AstralState } from "../../src/community-atlas/types.ts";

const initial: AstralState = { width: 840, height: 720, time: 0, hover: 0, quietRects: [] };
test("the background constellation stays fixed around the title as light and pointer state change", () => {
  const first = constellationLayout(initial);
  for (const time of [10, 100, 1000]) {
    const next = constellationLayout({ ...initial, time, hover: 1, pointerX: 650, pointerY: 500 });
    assert.deepEqual(next, first);
  }
});
