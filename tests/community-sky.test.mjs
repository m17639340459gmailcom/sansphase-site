import assert from 'node:assert/strict';
import { test } from 'node:test';
import { communitySkyFixture as fixture } from './helpers/community-sky.mjs';

test('optional meteor renderer receives logical dimensions and replaces only the meteor layer', (t) => {
  const painted = [];
  let enabled = true;
  const view = fixture(t, undefined, { skyOptions: {
    meteorPainter: () => enabled ? (_ctx, frame) => painted.push({ ...frame }) : undefined,
  } });
  assert.deepEqual(painted, [{ width: 400, height: 300, seconds: 0 }]);
  view.step(3000);
  view.step(3500);
  assert.deepEqual(painted.at(-1), { width: 400, height: 300, seconds: 3.5 });
  assert.equal(view.last().strokes, 0, 'no original meteor can run beneath the optional layer');
  assert.ok(view.last().points.length > 0, 'stars remain rendered');
  enabled = false;
  view.step(4000);
  view.step(4300);
  assert.ok(view.last().strokes > 0, 'omitting the renderer restores the original meteor branch');
});

test('community sky disables mouse and scroll displacement while preserving twinkle and meteors', (t) => {
  const view = fixture(t, undefined, { parallax: () => false });
  const initial = view.last();
  view.pointer(390, 290);
  view.win.scrollY = 900;
  view.step(1000);
  assert.deepEqual(view.last().points, initial.points);
  assert.notDeepEqual(view.last().colors, initial.colors, 'twinkle still changes brightness');
  view.step(3000);
  view.step(3200);
  assert.deepEqual(view.last().points, initial.points);
  assert.ok(view.last().strokes > 0, 'meteor path is still rendered');
});

test('community sky defaults to parallax and dynamically restores it after opt-out', (t) => {
  let enabled = true;
  const view = fixture(t, undefined, { parallax: () => enabled });
  const initial = view.last().points;
  view.pointer(390, 290);
  view.win.scrollY = 500;
  view.step(1000);
  assert.notDeepEqual(view.last().points, initial);
  enabled = false;
  view.step(1100);
  assert.deepEqual(view.last().points, initial, 'disabling discards prior mouse smoothing and scroll offsets');
  view.pointer(20, 25);
  view.step(1200);
  assert.deepEqual(view.last().points, initial);
  enabled = true;
  view.pointer(20, 25);
  view.step(1300);
  assert.notDeepEqual(view.last().points, initial);

  const original = fixture(t);
  const originalPoints = original.last().points;
  original.pointer(390, 290);
  original.step(1000);
  assert.notDeepEqual(original.last().points, originalPoints, 'existing two-argument callers keep their original parallax');
});

test('community sky frozen mode and cleanup retain their original frame lifecycle', (t) => {
  const frozen = fixture(t, undefined, { reduced: true, parallax: () => false });
  const count = frozen.records.length;
  frozen.pointer(390, 290);
  frozen.win.scrollY = 800;
  frozen.step(1000);
  assert.equal(frozen.records.length, count);
  assert.equal(frozen.queued(), 0);
  const view = fixture(t, undefined, { parallax: () => false });
  view.visible(false);
  view.step(1000);
  assert.equal(view.queued(), 0);
  view.visible(true);
  assert.equal(view.queued(), 1);
  view.dispose();
  const disposedCount = view.records.length;
  view.pointer(20, 25);
  view.win.dispatchEvent(new view.win.Event('resize'));
  view.visible(true);
  view.step(1100);
  assert.equal(view.records.length, disposedCount);
  assert.equal(view.queued(), 0);
  assert.equal(view.host.querySelector('canvas'), null);
});
