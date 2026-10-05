import assert from "node:assert/strict";
import test from "node:test";
import { paintConstellation } from "../../src/community-atlas/constellation-field.ts";

test("the constellation clears transparently at each viewport without replacing the sky", () => {
  {
    const painter = paintConstellation;
    let clears = 0;
    let operations = 0;
    let saves = 0;
    const finite = (...values: number[]) => {
      assert.ok(values.every(Number.isFinite));
      operations++;
    };
    const gradient = { addColorStop(offset: number) { assert.ok(offset >= 0 && offset <= 1); } };
    const context = {
      globalCompositeOperation: "source-over",
      save() { saves++; }, restore() { saves--; },
      clearRect(...values: number[]) { finite(...values); clears++; },
      beginPath() {}, stroke() {}, fill() {},
      moveTo: finite, lineTo: finite, arc: finite,
      getTransform: () => ({ a: 1.6, b: 0, c: 0, d: 1.6, e: 0, f: 0 }),
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      fillText() {}, measureText: (text:string) => ({width:text.length*7}),
      fillRect(...values: number[]) {
        assert.fail("The constellation must not paint a background or mask behind the content");
        finite(...values);
      },
    };
    for (const [width, height] of [[380, 640], [1050, 820]]) {
      painter(context as unknown as CanvasRenderingContext2D, {
        width: width!, height: height!, time: 600, hover: .8, pointerX: 100, pointerY: 80,
        quietRects: [{ left: 90, top: 160, right: 300, bottom: 220 }],
      });
    }
    assert.equal(clears, 2);
    assert.equal(saves, 0);
    assert.ok(operations > 100);
  }
});
