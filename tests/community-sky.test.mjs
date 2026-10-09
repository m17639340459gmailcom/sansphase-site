import assert from 'node:assert/strict';
import { test } from 'node:test';
import { communitySkyFixture as fixture } from './helpers/community-sky.mjs';

test('live reduced-motion changes stop the current loop and resume through one media controller', t => {
  const view = fixture(t, undefined, { parallax: () => false });
  view.step(1000);
  assert.equal(view.queued(), 1);
  view.motion(true);
  const frozen = view.records.length;
  assert.equal(view.queued(), 0, 'enabling reduced motion cancels the next animated paint immediately');
  view.step(1100);
  assert.equal(view.records.length, frozen);
  view.motion(false);
  assert.equal(view.queued(), 1);
  view.step(1200);
  assert.equal(view.records.length, frozen + 1);
  assert.equal(view.mediaReads(), 1, 'a mounted background retains one media query instead of creating it per frame');
  assert.equal(view.motionListeners(), 1);
  view.dispose();
  const disposed = view.records.length;
  assert.equal(view.motionListeners(), 0);
  view.motion(true); view.motion(false); view.step(1300);
  assert.equal(view.records.length, disposed);
  assert.equal(view.queued(), 0);
});

test('an initially reduced background starts animating when the live preference is cleared', t => {
  const view = fixture(t, undefined, { reduced: true, parallax: () => false });
  assert.equal(view.queued(), 0);
  const frozen = view.records.length;
  view.motion(false);
  assert.equal(view.queued(), 1);
  view.step(1000);
  assert.equal(view.records.length, frozen + 1);
});

test('changing the motion preference never bypasses the last scrolling deadline', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = fixture(t, undefined, { parallax: () => false, skyOptions: { pauseWhileScrolling: true } });
  view.step(1000);
  view.host.dispatchEvent(new view.win.Event('scroll'));
  const frozen = view.records.length;
  t.mock.timers.tick(200);
  view.motion(true); view.motion(false);
  assert.equal(view.records.length, frozen, 'preference changes preserve the last canvas while scrolling');
  assert.equal(view.queued(), 0);
  t.mock.timers.tick(399);
  assert.equal(view.queued(), 0);
  t.mock.timers.tick(1);
  assert.equal(view.queued(), 1);
  view.step(1700);
  view.host.dispatchEvent(new view.win.Event('scroll'));
  const reduced = view.records.length;
  view.motion(true);
  t.mock.timers.tick(599);
  assert.equal(view.records.length, reduced);
  t.mock.timers.tick(1);
  assert.equal(view.queued(), 0, 'a reduced preference stays static after the idle deadline');
  assert.equal(view.records.length, reduced + 1);
});

test('motion changes while hidden do not paint or queue work and showing respects the final preference', t => {
  const view = fixture(t, undefined, { parallax: () => false });
  view.visible(false); view.step(1000);
  const hidden = view.records.length;
  view.motion(true); view.motion(false); view.motion(true);
  assert.equal(view.records.length, hidden);
  assert.equal(view.queued(), 0);
  view.visible(true);
  assert.equal(view.records.length, hidden + 1);
  assert.equal(view.queued(), 0);
  view.visible(false); view.motion(false);
  assert.equal(view.records.length, hidden + 1);
  assert.equal(view.queued(), 0);
  view.visible(true);
  assert.equal(view.queued(), 1);
});

test('sky backing pixels stay within budget while normal DPR, logical dimensions and resize remain intact', t => {
  const painted = [];
  const view = fixture(t, undefined, { width: 800, height: 600, pixelRatio: 2, skyOptions: {
    meteorPainter: () => (_ctx, frame) => painted.push({ ...frame }),
  } });
  const canvas = view.host.querySelector('canvas');
  assert.deepEqual([canvas.width, canvas.height], [1600, 1200], 'an ordinary viewport retains its original DPR');
  view.resize(3840, 2160, 2); view.step(1000);
  assert.ok(canvas.width * canvas.height <= 2_000_000, '4K displays cannot allocate a 33-million-pixel backing canvas');
  const ratio = Math.sqrt(2_000_000 / (3840 * 2160));
  assert.deepEqual([canvas.width, canvas.height], [Math.floor(3840 * ratio), Math.floor(2160 * ratio)]);
  assert.deepEqual(painted.at(-1), { width: 3840, height: 2160, seconds: 1 }, 'renderers keep logical viewport coordinates');
  view.resize(800, 600, 1.5); view.step(1100);
  assert.deepEqual([canvas.width, canvas.height], [1200, 900], 'shrinking the viewport restores the normal device ratio');
});

test('reading scroll freezes backdrop drawing until scrolling settles and disposal cancels resumption', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = fixture(t, undefined, { parallax: () => false, skyOptions: { pauseWhileScrolling: true } });
  view.step(1000);
  const drawn = view.records.length;
  view.host.dispatchEvent(new view.win.Event('scroll'));
  view.step(1016);
  assert.equal(view.records.length, drawn, 'nested scrolling must not compete with background canvas paints');
  t.mock.timers.tick(599);
  assert.equal(view.queued(), 0);
  t.mock.timers.tick(1);
  assert.equal(view.queued(), 1);
  view.step(1700);
  assert.equal(view.records.length, drawn + 1);
  view.host.dispatchEvent(new view.win.Event('scroll'));
  view.dispose();
  t.mock.timers.tick(1000);
  assert.equal(view.queued(), 0, 'a disposed background never resumes');
});

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
