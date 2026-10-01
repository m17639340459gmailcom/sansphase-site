import test from 'node:test';
import assert from 'node:assert/strict';
import { holeBufferSize, advanceHoleClock } from '../src/black-hole-render.ts';

test('black hole detail scales with the viewport within a bounded GPU budget', () => {
  for (const [width, height] of [[390, 844], [1280, 720], [1920, 1080], [3840, 2160]]) {
    const high = holeBufferSize(width, height, 1);
    const low = holeBufferSize(width, height, 0.5);
    assert.ok(high[0] <= width && high[1] <= height);
    assert.ok(high[0] * high[1] <= 562000, 'large screens do not get an unbounded cost');
    assert.ok(low[0] * low[1] <= high[0] * high[1]);
    assert.ok(Math.abs(high[0] / high[1] - width / height) < 0.01);
  }
  const [w, h] = holeBufferSize(1920, 1080);
  assert.ok(w >= 990 && h >= 550, 'desktop detail is materially above the former 706×397 buffer');
  for (const args of [[0, 0, 1], [NaN, Infinity, NaN], [-4, 10, -1]]) {
    assert.ok(holeBufferSize(...args).every(value => Number.isInteger(value) && value >= 1));
  }
});

test('flow time keeps advancing during the dive and never jumps after suspension', () => {
  let clock = 40;
  for (const rate of [0.96, 0.8, 0.3, 0.96]) {
    const next = advanceHoleClock(clock, 1 / 60, rate);
    assert.ok(next > clock, 'scroll direction and approach do not freeze the light flow');
    assert.ok(next - clock >= 0.009, 'flow stays perceptible near the horizon');
    clock = next;
  }
  assert.equal(advanceHoleClock(clock, 5, 1), advanceHoleClock(clock, 0.05, 1));
  assert.equal(advanceHoleClock(clock, -1, 1), clock);
  assert.equal(advanceHoleClock(clock, NaN, 1), clock);
});
