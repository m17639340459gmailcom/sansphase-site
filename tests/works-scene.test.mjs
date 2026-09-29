import test from "node:test";
import assert from "node:assert/strict";
import {
  cosmosFraming,
  skyLayerOpacity,
  skyLayerOffset,
  photographsCoverPanorama,
} from "../src/library-layout.mjs";

test('panorama remains available until a loaded, visible photograph is fully opaque', () => {
  const photograph={visible:true,material:{map:{isTexture:true},opacity:0.9999}};
  assert.equal(photographsCoverPanorama([undefined,photograph]),false);
  photograph.material.opacity=1;
  assert.equal(photographsCoverPanorama([undefined,photograph]),true);
  photograph.visible=false;
  assert.equal(photographsCoverPanorama([photograph]),false);
  photograph.visible=true;photograph.material.map=null;
  assert.equal(photographsCoverPanorama([photograph]),false);
  assert.equal(photographsCoverPanorama([]),false);
});

test("successive skies enter below and leave above without a discontinuity on reverse scroll", () => {
  for (const chapter of [1, 2, 3]) {
    assert.ok(skyLayerOffset(chapter - 0.5, chapter) < -0.05);
    assert.equal(skyLayerOffset(chapter, chapter), 0);
    assert.ok(skyLayerOffset(chapter + 0.5, chapter) > 0.05);
    const positions = Array.from({ length: 101 }, (_, i) =>
      skyLayerOffset(chapter - 1 + i / 50, chapter),
    );
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] >= positions[i - 1]);
      assert.ok(positions[i] - positions[i - 1] < 0.005);
    }
    for (const p of [chapter - 0.001, chapter, chapter + 0.001]) {
      assert.ok(
        cosmosFraming(1.7, p).fall < 0.0001,
        "the camera catches the model smoothly at each settled scene",
      );
    }
  }
});

test("works imagery fades continuously without changing the approved opening", () => {
  for (let chapter = 1; chapter <= 3; chapter++) {
    assert.equal(skyLayerOpacity(0, chapter), 0);
    assert.equal(skyLayerOpacity(chapter - 0.92, chapter), 0);
    assert.equal(skyLayerOpacity(chapter, chapter), 1);
    assert.equal(skyLayerOpacity(chapter - 1, chapter), 0);
  }
  let previous = 0;
  for (let step = 0; step <= 100; step++) {
    const current = skyLayerOpacity(step / 100, 1);
    assert.ok(current >= previous && current <= 1);
    assert.ok(current - previous < 0.023);
    previous = current;
  }
  assert.equal(cosmosFraming(1.7, 0).yaw, 0);
  assert.ok(Math.abs(Math.sin(cosmosFraming(1.7, 1).yaw)) < 1e-8);
  assert.ok(Math.cos(cosmosFraming(1.7, 1).yaw) > 0.999999);
  for (const p of [0.08, 0.95, 1.1, 1.9]) {
    const left = cosmosFraming(1.7, p - 0.00001).yaw;
    const right = cosmosFraming(1.7, p + 0.00001).yaw;
    assert.ok(Math.abs(right - left) < 0.001);
  }
});

test("each adjacent chapter completes one full turn and settles facing forward", () => {
  for (let chapter = 0; chapter < 3; chapter++) {
    const start = cosmosFraming(1.7, chapter).yaw;
    const end = cosmosFraming(1.7, chapter + 1).yaw;
    assert.ok(Math.abs(end - start + Math.PI * 2) < 1e-8);
    assert.ok(Math.cos(end) > 0.999999);
    let previous = start;
    for (let step = 1; step <= 100; step++) {
      const current = cosmosFraming(1.7, chapter + step / 100).yaw;
      assert.ok(current <= previous);
      assert.ok(
        previous - current < 0.14,
        "no angle snapping at scene boundaries",
      );
      previous = current;
    }
  }
});

test("chapter flights: each change flies through the current sky and opens the next from the centre", async () => {
  const { skyChoreography } = await import("../src/library-layout.mjs");
  const rest = skyChoreography(2);
  assert.deepEqual([rest.a, rest.b, rest.iris, rest.streak], [1, 1, 0, 0], "a chapter at rest shows one photograph");
  const mid = skyChoreography(1.5);
  assert.deepEqual([mid.a, mid.b], [0, 1]);
  assert.ok(mid.streak > 0.5 && mid.zoomA > 1.3, "the outgoing sky rushes past with speed lines");
  assert.ok(mid.iris > 0.2 && mid.iris < 0.8 && mid.rim > 0.3, "the next opens as a rimmed iris");
  // Arriving at a chapter from below and leaving it upwards meet seamlessly.
  const below = skyChoreography(2 - 1e-6), above = skyChoreography(2 + 1e-6);
  assert.ok(below.iris > 0.999 && below.streak < 1e-3 && Math.abs(below.zoomB - 1) < 1e-3);
  assert.ok(above.iris < 1e-3 && above.streak < 1e-3 && Math.abs(above.zoomA - 1) < 1e-3);
  assert.equal(below.b, above.a, "the same photograph on both sides of the chapter");
  let previous = skyChoreography(1);
  for (let p = 1.01; p < 1.995; p += 0.01) {
    const now = skyChoreography(p);
    assert.ok(now.iris >= previous.iris - 1e-9, "the iris only widens on the way forward");
    previous = now;
  }
  assert.equal(skyChoreography(3).a, 2);
  assert.ok(skyChoreography(0.5).zoomA > 1.2, "the first photograph waits close up behind the hole");
  assert.equal(skyChoreography(1).zoomA, 1);
});
