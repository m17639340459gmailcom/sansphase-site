import assert from "node:assert/strict";
import test from "node:test";
import { sampleMeteorField, paintMeteorField } from "../../src/community-atlas/meteor-field.ts";

test("meteor field uses a deterministic active clock and emits nothing at rest or for invalid sizes", () => {
  for (const time of [0, -1, NaN, Infinity]) assert.deepEqual(sampleMeteorField(1440, 900, time), []);
  for (const [width, height] of [[0, 900], [1440, 0], [NaN, 900], [1440, Infinity]]) {
    assert.deepEqual(sampleMeteorField(width!, height!, 8), []);
  }
  for (let frame = 0; frame < 900; frame++) {
    const time = frame / 30;
    assert.deepEqual(sampleMeteorField(1440, 900, time), sampleMeteorField(1440, 900, time));
  }
});

test("meteor rhythm is irregular, sparse, bounded and has a finite lifecycle", () => {
  const events = new Map<string, { start: number; end: number }>();
  let emptyFrames = 0;
  let simultaneous = 0;
  for (let frame = 0; frame < 18000; frame++) {
    const time = frame / 30;
    const meteors = sampleMeteorField(1440, 900, time);
    assert.ok(meteors.length <= 2, "no meteor rain or backlog burst");
    simultaneous = Math.max(simultaneous, meteors.length);
    if (!meteors.length) emptyFrames++;
    for (const meteor of meteors) {
      const event = events.get(meteor.id);
      if (event) event.end = time;
      else events.set(meteor.id, { start: time, end: time });
      assert.ok(meteor.opacity > 0 && meteor.opacity <= 1);
      assert.ok(meteor.width > 0 && meteor.width <= 2);
      for (const value of [meteor.x, meteor.y, meteor.tailX, meteor.tailY, meteor.opacity]) assert.ok(Number.isFinite(value));
    }
  }
  assert.ok(events.size > 130 && events.size < 210, "web display cadence remains a few seconds per group");
  assert.ok(emptyFrames > 7000, "the scene retains calm intervals");
  assert.equal(simultaneous, 2, "occasional pairs add variety");
  assert.ok([...events.values()].every(({ start, end }) => end - start < 1.6));
  const starts = [...events.values()].map(event => event.start);
  const intervals = starts.slice(1).map((start, index) => +(start - starts[index]!).toFixed(1));
  assert.ok(new Set(intervals).size > 10, "events must not tick on a fixed interval");
});

test("paths follow one projected radiant, begin away from it, and scale in CSS pixels", () => {
  for (const [width, height] of [[1440, 900], [390, 844], [2560, 1080]]) {
    const radiant = { x: width! * 0.88, y: height! * -0.35 };
    for (let frame = 0; frame < 900; frame++) {
      const time = frame / 30;
      const meteors = sampleMeteorField(width!, height!, time);
      const larger = sampleMeteorField(width! * 2, height! * 2, time);
      assert.equal(meteors.length, larger.length);
      meteors.forEach((meteor, index) => {
        const dx = meteor.x - meteor.tailX, dy = meteor.y - meteor.tailY;
        const rx = meteor.x - radiant.x, ry = meteor.y - radiant.y;
        assert.ok(Math.abs(dx * ry - dy * rx) < 1e-7, "track traces back toward the shared radiant");
        assert.ok(dx * rx + dy * ry > 0, "heads move away from the radiant");
        assert.ok(meteor.tailY > radiant.y + height! * 0.25, "visible tails never originate at the radiant");
        assert.ok(Math.abs(larger[index]!.x - meteor.x * 2) < 1e-7);
        assert.ok(Math.abs(larger[index]!.tailY - meteor.tailY * 2) < 1e-7);
      });
    }
  }
});

test("painting is deterministic, does not clear the backdrop, and uses no unbounded persistent trail", () => {
  function render(time: number) {
    const operations: unknown[] = [];
    const ctx = {
      beginPath() {},
      moveTo(...values: number[]) { operations.push(["move", ...values]); },
      lineTo(...values: number[]) { operations.push(["line", ...values]); },
      arc(...values: number[]) { operations.push(["arc", ...values]); },
      fill() {},
      stroke() {},
      createLinearGradient(...values: number[]) { operations.push(values); return { addColorStop(p: number, value: string) { operations.push([p, value]); } }; },
      createRadialGradient(...values: number[]) { operations.push(values); return { addColorStop(p: number, value: string) { operations.push([p, value]); } }; },
      clearRect() { assert.fail("the meteor painter must not erase stars"); },
      fillRect() { assert.fail("no full-frame fading overlay"); },
    } as unknown as CanvasRenderingContext2D;
    paintMeteorField(ctx, 1440, 900, time);
    return operations;
  }
  assert.deepEqual(render(0), []);
  for (const time of [1.8, 4, 9, 100000, 1e7, Number.MAX_VALUE]) {
    assert.deepEqual(render(time), render(time));
    assert.ok(render(time).length < 100, "sampling far in the future cannot replay past events");
  }
});
