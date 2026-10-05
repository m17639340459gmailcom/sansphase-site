import assert from "node:assert/strict";
import test from "node:test";
import { sampleNebulaVolume } from "../../src/community-atlas/nebula-volume.ts";

const probes = [.1, .3, .5, .7, .9].flatMap(y =>
  [.08, .22, .36, .5, .64, .78, .92].map(x => ({ x, y })));
const spatial = (time: number) => probes.map(({ x, y }) => sampleNebulaVolume(x, y, time));

test("volume samples remain finite and bounded across space and long-running scene times", () => {
  const points = [...probes, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }];
  for (const time of [0, .001, 3, 8, 17.999, 18, 40, 719.999, 720, 720.001, 1440, 100000]) {
    for (const { x, y } of points) {
      const sample = sampleNebulaVolume(x, y, time);
      assert.ok(Object.values(sample).every(Number.isFinite), `${x},${y} at ${time}s must be finite`);
      assert.ok(sample.opacity >= 0 && sample.opacity <= .8, `opacity ${sample.opacity}`);
      assert.ok(sample.light >= 0 && sample.light <= 2, `light ${sample.light}`);
      assert.ok(Math.abs(sample.dx) < .012 && Math.abs(sample.dy) < .012, "local displacement never becomes a screen-wide warp");
    }
  }
});

test("volume sampling is deterministic and independent of previously sampled frames", () => {
  const frozen = spatial(8);
  for (const time of [10000, .01, 719, 3, 18, 0, 240]) spatial(time);
  assert.deepEqual(spatial(8), frozen, "rewinding or jumping scene time must not retain a previous frame's density");
  assert.deepEqual(spatial(8), frozen, "a paused renderer can repaint without changing the volume");
  for (const { x, y } of probes) {
    const zero = sampleNebulaVolume(x, y, 0);
    assert.deepEqual(sampleNebulaVolume(x, y, NaN), zero);
    assert.deepEqual(sampleNebulaVolume(x, y, -.001), zero);
    assert.deepEqual(sampleNebulaVolume(x, y, -720), zero);
  }
});

test("density evolves locally between three and eight seconds instead of uniformly blinking", () => {
  const first = spatial(3).map(sample => sample.opacity);
  const later = spatial(8).map(sample => sample.opacity);
  const changes = later.map((value, index) => value - first[index]!);
  assert.ok(Math.max(...changes) - Math.min(...changes) > .001,
    "different cloud regions need different density changes, not one shared additive pulse");
  // A masked image with a single exposure oscillator can pass the first check.
  // Reject that as well: no one gain should explain every point's new opacity.
  const firstEnergy = first.reduce((sum, value) => sum + value * value, 0);
  assert.ok(firstEnergy > 1e-6, "the density layer must contain some visible cloud volume");
  const bestGain = first.reduce((sum, value, index) => sum + value * later[index]!, 0) / firstEnergy;
  const residual = later.reduce((sum, value, index) => sum + Math.abs(value - first[index]! * bestGain), 0);
  assert.ok(residual > .001, `the spatial field cannot be explained by uniform exposure alone: residual ${residual}`);
});

test("the field does not repeat the rejected eighteen-second wallpaper cycle", () => {
  for (const time of [0, 3, 8]) {
    const first = spatial(time), later = spatial(time + 18);
    const difference = first.reduce((sum, value, index) => sum + Math.abs(value.opacity - later[index]!.opacity), 0);
    assert.ok(difference > .005, `${time}s and ${time + 18}s repeat too closely: total density difference ${difference}`);
  }
});

test("short time advances and the long-cycle boundary do not pop the density", () => {
  // Sample 1ms neighbourhoods throughout the first forty seconds, including
  // several independent clouds and the quiet centre rather than a single point.
  const continuityProbes = [{ x: .12, y: .18 }, { x: .24, y: .36 }, { x: .2, y: .72 },
    { x: .5, y: .5 }, { x: .74, y: .2 }, { x: .84, y: .7 }, { x: .9, y: .88 }];
  for (let step = 0; step <= 160; step++) {
    const time = step / 4;
    for (const { x, y } of continuityProbes) {
      const first = sampleNebulaVolume(x, y, time), next = sampleNebulaVolume(x, y, time + .001);
      assert.ok(Math.abs(next.opacity - first.opacity) < .01, `density popped near ${time}s at ${x},${y}`);
    }
  }
  for (const { x, y } of probes) {
    const before = sampleNebulaVolume(x, y, 719.999), boundary = sampleNebulaVolume(x, y, 720);
    const after = sampleNebulaVolume(x, y, 720.001), initial = sampleNebulaVolume(x, y, 0);
    for (const [a, b] of [[before, boundary], [boundary, after], [before, initial]] as const) {
      assert.ok(Math.abs(a.opacity - b.opacity) < .01, `the 720-second wrap has a density seam at ${x},${y}`);
      assert.ok(Math.abs(a.light - b.light) < .01, `the 720-second wrap has an illumination seam at ${x},${y}`);
      assert.ok(Math.abs(a.dx - b.dx) < .0001 && Math.abs(a.dy - b.dy) < .0001,
        `the 720-second wrap jumps the local cloud position at ${x},${y}`);
    }
  }
});
