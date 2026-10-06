import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRouteTransitions } from '../src/route-transition.mjs';

function setup({ reduced = false, animate = true } = {}) {
  const dom = new JSDOM('<!doctype html><header id="site-header"></header><main id="main"></main>', { pretendToBeVisual: true });
  const { window: win } = dom, doc = win.document;
  win.matchMedia = () => ({ matches: reduced });
  let snapshots = 0;
  doc.startViewTransition = update => {
    snapshots++;
    const updateCallbackDone = Promise.resolve().then(update);
    return { updateCallbackDone, finished: updateCallbackDone, ready: Promise.resolve() };
  };
  const animations = [];
  if (animate) doc.querySelector('main').animate = (frames, options) => {
    let resolve, reject;
    const finished = new Promise((done, fail) => { resolve = done; reject = fail; });
    const animation = { frames, options, finished, finish: resolve, cancelled: 0,
      cancel() { this.cancelled++; reject(new Error('cancelled')); } };
    animations.push(animation);
    return animation;
  };
  const transitions = createRouteTransitions(doc);
  return { doc, win, animations, transitions, snapshots: () => snapshots,
    close() { transitions.dispose(); dom.window.close(); } };
}

test('route updates run immediately and the fade waits for async content readiness', async () => {
  const s = setup();
  try {
    let updated = false, resolve;
    const loading = new Promise(done => { resolve = done; });
    const result = s.transitions.run('notes', 'works', () => { updated = true; return loading; });
    assert.equal(updated, true, 'controls must bind before any animation capture');
    assert.equal(result, loading, 'fetching stays independent of the visual effect');
    assert.equal(s.snapshots(), 0);
    assert.equal(s.animations.length, 0, 'the previous page must not fade in as the new page while assets are pending');
    resolve('loaded'); assert.equal(await result, 'loaded');
    assert.equal(s.animations.length, 1);
    assert(s.animations[0].frames.every(frame => !('transform' in frame) && !('clipPath' in frame)), 'button hit areas must not move or be clipped');
  } finally { s.close(); }
});

test('a stale, rejected, disposed or input-interrupted async update never starts a late fade', async () => {
  for (const action of ['new-route', 'rejected', 'disposed', 'pointerdown']) {
    const s = setup();
    let resolve, reject;
    const loading = new Promise((done, fail) => { resolve = done; reject = fail; });
    try {
      const result = s.transitions.run('notes', 'community', () => loading);
      if (action === 'new-route') s.transitions.run('community', 'works', () => {});
      if (action === 'disposed') s.transitions.dispose();
      if (action === 'pointerdown') s.doc.dispatchEvent(new s.win.Event('pointerdown'));
      const count = s.animations.length;
      if (action === 'rejected') { reject(new Error('asset unavailable')); await assert.rejects(result); }
      else { resolve(); await result; }
      await Promise.resolve();
      assert.equal(s.animations.length, count, action);
    } finally { s.close(); }
  }
});

test('pointer, keyboard and scroll interrupt the fade without consuming input', () => {
  const s = setup();
  try {
    for (const name of ['pointerdown', 'keydown', 'wheel']) {
      s.transitions.run('home', 'notes', () => {});
      const event = new s.win.Event(name, { bubbles: true, cancelable: true });
      const control = s.doc.querySelector('main');
      let received = 0;
      control.addEventListener(name, () => received++, { once: true });
      control.dispatchEvent(event);
      assert.equal(s.animations.at(-1).cancelled, 1);
      assert.equal(received, 1); assert.equal(event.defaultPrevented, false);
    }
  } finally { s.close(); }
});

test('rapid routes cancel old motion; late completion cannot clear the new animation', async () => {
  const s = setup();
  try {
    s.transitions.run('notes', 'works', () => {});
    const first = s.animations[0];
    s.transitions.run('works', 'resources', () => {});
    const second = s.animations[1];
    assert.equal(first.cancelled, 1);
    await Promise.resolve();
    s.doc.dispatchEvent(new s.win.Event('pointerdown'));
    assert.equal(second.cancelled, 1);
    s.transitions.run('resources', 'software', () => {});
    s.transitions.run('software', 'home', () => {});
    assert.equal(s.animations[2].cancelled, 1);
    assert.equal(s.animations.length, 3, 'home keeps its own scene animation');
  } finally { s.close(); }
});

test('reduced motion, hidden pages and unsupported animation still update synchronously', () => {
  for (const options of [{ reduced: true }, { animate: false }, { hidden: true }]) {
    const s = setup(options);
    try {
      if (options.hidden) Object.defineProperty(s.doc, 'hidden', { value: true });
      assert.equal(s.transitions.run('notes', 'works', () => 'done'), 'done');
      assert.equal(s.animations.length, 0); assert.equal(s.snapshots(), 0);
    } finally { s.close(); }
  }
});

test('dispose cancels motion and leaves updates functional without new animation', () => {
  const s = setup();
  s.transitions.run('notes', 'works', () => {}); s.transitions.dispose();
  assert.equal(s.animations[0].cancelled, 1);
  s.doc.dispatchEvent(new s.win.Event('pointerdown'));
  assert.equal(s.animations[0].cancelled, 1);
  assert.equal(s.transitions.run('works', 'notes', () => 'done'), 'done');
  assert.equal(s.animations.length, 1); s.close();
});

test('community entrance uses live content and remains immediately interruptible', () => {
  const s = setup();
  try {
    let updated = 0;
    assert.equal(s.transitions.run('community', 'community', () => ++updated), 1);
    assert.equal(s.snapshots(), 0);
    assert.equal(s.animations.length, 1);
    s.doc.dispatchEvent(new s.win.Event('pointerdown'));
    assert.equal(s.animations[0].cancelled, 1);
  } finally { s.close(); }
});

test('external community leave fades live content and failure restores its original opacity', async () => {
  const s = setup();
  try {
    s.doc.querySelector('main').style.opacity = '.9';
    const leaving = s.transitions.leave();
    assert.equal(s.animations.length, 1);
    assert.deepEqual(s.animations[0].frames, [{ opacity: 1 }, { opacity: 0 }]);
    s.animations[0].finish(); await leaving;
    assert.equal(s.doc.querySelector('main').style.opacity, '0');
    s.transitions.restore();
    assert.equal(s.doc.querySelector('main').style.opacity, '0.9');
    assert.equal(s.snapshots(), 0);
  } finally { s.close(); }
});

test('HK ready reveals the existing body, and reduced motion skips both external fades', async () => {
  const s = setup({ reduced: true });
  try {
    s.doc.body.dataset.communityBoot = 'pending';
    await s.transitions.leave(); s.transitions.arrive();
    assert.equal(s.animations.length, 0);
    assert.equal(s.doc.body.hasAttribute('data-community-boot'), false);
    assert.equal(s.doc.querySelector('main').style.opacity, '');
  } finally { s.close(); }
});
