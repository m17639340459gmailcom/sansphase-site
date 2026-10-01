import test from 'node:test';
import assert from 'node:assert/strict';
import { cinematicHolePose } from '../src/black-hole-cinema.ts';

test('cinematic opening keeps a readable inclination and returns smoothly to the original dive', () => {
  const opening = cinematicHolePose(0);
  assert.ok(opening.tilt > 0.1 && opening.tilt < 0.25);
  assert.ok(Math.abs(opening.roll) > 0.1 && Math.abs(opening.roll) < 0.3);
  for (const p of [0.7, 0.9, 1, 3]) {
    assert.deepEqual(cinematicHolePose(p), { tilt: 0, roll: 0 });
  }
  let previous = opening;
  for (let p = 0.001; p <= 1; p += 0.001) {
    const next = cinematicHolePose(p);
    assert.ok(Math.abs(next.tilt - previous.tilt) < 0.002);
    assert.ok(Math.abs(next.roll - previous.roll) < 0.002);
    previous = next;
  }
  for (const p of [NaN, Infinity, -1]) {
    assert.ok(Object.values(cinematicHolePose(p)).every(Number.isFinite));
  }
});
