import assert from "node:assert/strict";
import test from "node:test";
import { scrollToTarget, setLenis } from "../src/components/fx/lenis.ts";

test("an immediate navigation scroll resets the browser when Lenis still has the old target", () => {
  const lenis = {
    isStopped: false,
    targetScroll: 0,
    actualScroll: 700,
    start() {},
    resize() {
      this.targetScroll = this.actualScroll;
    },
    scrollTo(target, { immediate, offset }) {
      assert.equal(immediate, true);
      const destination = target + offset;
      // Lenis returns immediately if a scroll request matches its cached target.
      if (destination === this.targetScroll) return;
      this.targetScroll = this.actualScroll = destination;
    },
  };

  setLenis(lenis);
  try {
    scrollToTarget(0, { immediate: true });
    assert.equal(lenis.actualScroll, 0);
  } finally {
    setLenis(null);
  }
});
