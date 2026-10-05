import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const bundle = await build({
  entryPoints: ['src/community-select.tsx'], bundle: true, write: false,
  format: 'iife', globalName: 'CommunitySelectGutterTest', platform: 'browser',
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  footer: { js: 'window.CommunitySelectGutterTest = CommunitySelectGutterTest;' },
});
const sources = await Promise.all(['styles-foundation.css', 'community.css'].map(file => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')));
const settle = () => new Promise(resolve => setTimeout(resolve, 40));

test('community dropdown uses one scrollbar compensation and restores the page in both themes and dialogs', async () => {
  for (const theme of ['light', 'dark']) for (const inDialog of [false, true]) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error));
    virtualConsole.on('error', error => errors.push(error));
    const field = '<label for="category">类别</label><select id="category" name="category"><option value="a">头像框</option><option value="b">昵称特效</option></select>';
    const content = inDialog ? `<section role="dialog" aria-modal="true">${field}</section>` : `<form>${field}</form>`;
    const dom = new JSDOM(`<!doctype html><html><head><style>${sources.join('\n')}</style></head><body class="community-open" data-community-theme="${theme}" style="margin: 0; padding: 0">${content}</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole, url: 'https://example.test/' });
    const win = dom.window, doc = win.document;
    win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    win.HTMLElement.prototype.scrollIntoView = function () {};
    win.HTMLElement.prototype.hasPointerCapture = function () { return false; };
    win.HTMLElement.prototype.releasePointerCapture = function () {};
    win.HTMLElement.prototype.setPointerCapture = function () {};
    Object.defineProperty(win, 'innerWidth', { configurable: true, value: 1200 });
    // JSDOM has no layout engine. Model the classic Windows 16px gutter from
    // the actual root CSS; the real Radix dependency performs the measurement
    // and injects its own body margin, so no scroll-lock implementation is mocked.
    Object.defineProperty(doc.documentElement, 'clientWidth', {
      configurable: true,
      get: () => win.getComputedStyle(doc.documentElement).scrollbarGutter === 'stable' ? 1184 : 1200,
    });
    const page = () => ({
      gutter: win.getComputedStyle(doc.documentElement).scrollbarGutter,
      margin: parseFloat(win.getComputedStyle(doc.body).marginRight) || 0,
      gap: win.innerWidth - doc.documentElement.clientWidth,
    });
    const originalStyle = doc.body.style.cssText;
    let control;
    try {
      win.eval(bundle.outputFiles[0].text);
      control = win.CommunitySelectGutterTest.mountCommunitySelect(doc.querySelector('select'), {});
      await settle();
      const before = page();
      assert.deepEqual(before, { gutter: 'stable', margin: 0, gap: 16 });
      doc.querySelector('.community-select-trigger').click();
      await settle();
      assert.ok(doc.body.hasAttribute('data-scroll-locked'));
      assert.ok(doc.querySelector('.community-select-menu'));
      if (inDialog) assert.ok(doc.querySelector('[role="dialog"] .community-select-menu'));
      const open = page();
      assert.equal(open.margin, 16, 'the actual Radix dependency must compensate for the measured scrollbar');
      assert.equal(open.gutter, 'auto', 'a locked community dropdown must release the pre-reserved root gutter');
      assert.equal(open.gap + open.margin, before.gap + before.margin, 'root gutter plus body compensation must remain 16px, never double to 32px');
      doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await settle();
      assert.equal(doc.body.hasAttribute('data-scroll-locked'), false);
      assert.equal(doc.querySelector('.community-select-menu'), null);
      assert.deepEqual(page(), before);
      assert.equal(doc.body.style.cssText, originalStyle);
    } finally {
      control?.dispose();
      dom.window.close();
    }
    assert.deepEqual(errors, [], 'the real Radix component must not produce runtime errors');
  }
});
