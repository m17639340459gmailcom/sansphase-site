import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createBookImageViewer } from '../src/book-image-viewer.mjs';

test('community image popup fits tall originals, zooms without closing and restores the opener', () => {
  const dom = new JSDOM('<button><img src="/thumbnail.webp"></button>', { url: 'https://community.test' });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const opener = w.document.querySelector('button'), image = opener.querySelector('img');
  const viewer = createBookImageViewer(w.document.body, { className: 'community-image-viewer' });
  try {
    viewer.open(image, { source: '/original.webp', opener });
    const dialog = w.document.querySelector('dialog');
    assert.ok(dialog.classList.contains('community-image-viewer'));
    const picture = dialog.querySelector('img');
    assert.equal(picture.getAttribute('src'), '/original.webp');
    Object.defineProperties(picture, { naturalWidth: { value: 1200 }, naturalHeight: { value: 3600 } });
    picture.dispatchEvent(new w.Event('load'));
    const fitted = parseFloat(picture.style.height);
    assert.ok(fitted > 0 && fitted < w.innerHeight * .76);
    assert.ok(parseFloat(dialog.style.width) < w.innerWidth);
    dialog.querySelector('[data-image-action="more"]').click();
    assert.ok(parseFloat(picture.style.height) > fitted);
    assert.equal(viewer.active, true);
    picture.click();
    assert.equal(viewer.active, true);
    dialog.querySelector('[data-image-action="fit"]').click();
    assert.equal(parseFloat(picture.style.height), fitted);
    dialog.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(viewer.active, false);
    assert.equal(w.document.activeElement, opener);
    viewer.open(image, { source: '/original.webp', opener });
    viewer.close();
    assert.equal(w.document.querySelector('dialog'), null);
  } finally { viewer.destroy(); w.close(); }
});
