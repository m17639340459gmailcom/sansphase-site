import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSkyParallax } from '../src/black-hole-background.ts';

test('opposed sky motion is driven by actual observer movement and has no independent drift', () => {
  // In the opening camera convention, observer +a samples the sky at -a.
  // Added sky lookup rotation must exceed that motion to move features left.
  const observer = 0.1;
  const lookup = advanceSkyParallax(0, observer, 0);
  const apparentStarAngle = observer - lookup;
  assert.ok(apparentStarAngle < -observer && apparentStarAngle > -observer * 2);
  assert.equal(advanceSkyParallax(lookup, observer, observer), lookup);
  assert.ok(Math.abs(advanceSkyParallax(lookup, 0, observer)) < 1e-10);
  assert.equal(advanceSkyParallax(0, -observer, 0), -lookup);
});

test('wrapping the observer angle cannot jump the background, invalid samples hold it', () => {
  const short = advanceSkyParallax(0, 0.01, 0);
  const wrapped = advanceSkyParallax(0, 0.005, Math.PI * 2 - 0.005);
  assert.ok(Math.abs(short - wrapped) < 1e-10);
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(advanceSkyParallax(0.4, bad, 0), 0.4);
    assert.equal(advanceSkyParallax(0.4, 0, bad), 0.4);
  }
});
