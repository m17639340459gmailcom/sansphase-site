import test from 'node:test';
import assert from 'node:assert/strict';
import { blackHoleFormation } from '../src/black-hole-formation.ts';

test('appearance grows from an empty sky while the existing background winds inward without reversing', () => {
  const first = blackHoleFormation(0), middle = blackHoleFormation(0.5), settled = blackHoleFormation(1);
  assert.equal(first.mass, 0);
  assert.equal(first.disk, 0);
  assert.ok(middle.mass > 0 && middle.mass < 1 && middle.disk > 0 && middle.disk < 1);
  assert.ok(first.skyTurn > middle.skyTurn && middle.skyTurn > 0);
  assert.ok(first.skySpread > middle.skySpread && middle.skySpread > 0);
  assert.deepEqual(settled, { mass: 1, disk: 1, skyTurn: 0, skySpread: 0, turn: 0 });
  let previous = first;
  for (let i = 1; i <= 1000; i++) {
    const next = blackHoleFormation(i / 1000);
    assert.ok(next.mass >= previous.mass && next.disk >= previous.disk);
    assert.ok(next.skyTurn <= previous.skyTurn && next.skySpread <= previous.skySpread);
    assert.ok(next.turn <= previous.turn, 'sampling phase decreases so visible gas turns forward');
    assert.ok(Object.values(next).every(Number.isFinite));
    for (const key of Object.keys(next)) assert.ok(Math.abs(next[key] - previous[key]) < 0.03);
    previous = next;
  }
  for (const p of [NaN, Infinity, -1, 2]) assert.ok(Object.values(blackHoleFormation(p)).every(Number.isFinite));
});

test('gas is already turning and visible while the shadow grows, then settles without a phase reset', () => {
  const early = blackHoleFormation(0.3);
  const middle = blackHoleFormation(0.55);
  const late = blackHoleFormation(0.8);
  assert.ok(early.mass > 0 && early.mass < middle.mass);
  assert.ok(early.disk > 0.2, 'the gas must not wait for the centre to finish');
  assert.ok(middle.mass < late.mass && late.mass < 1);
  assert.ok(early.turn - late.turn > 1, 'formation has a readable forward turn');
  assert.ok(blackHoleFormation(0.999).turn < 0.0001);
});
