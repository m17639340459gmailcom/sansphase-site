import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createStableCommunityFrame } from '../src/community-layout/stable-frame.ts';
import { composeCommunityStyles } from '../scripts/compose-community-styles.mjs';
import { publicationFiles } from '../scripts/publication-files.mjs';

test('the accepted layout is enabled without development parameters on the regular origin', () => {
  for (const host of ['http://127.0.0.1:4212', 'https://www.sansphase.com']) {
    const dom = new JSDOM('<main></main>', { url: `${host}/#/community/boards/showcase` });
    const frame = createStableCommunityFrame(dom.window.document, dom.window);
    assert.equal(frame.enabled(), true);
    assert.equal(frame.render(dom.window.document.querySelector('main'), '<section data-community="board">作品展廊</section>', ''), true);
    assert.ok(dom.window.document.querySelector('[data-frame-center]'));
    frame.dispose(); dom.window.close();
  }
});
test('formal community styles and source entry no longer select experimental variants', async () => {
  const css = await composeCommunityStyles();
  assert.doesNotMatch(css, /data-home-design="(?:reading|gallery|editorial)"/);
  assert.match(css, /max-width: 1240px/);
  const app = await readFile('src/app.mjs', 'utf8');
  assert.doesNotMatch(app, /__orbit|previews\/orbit-lab/);
  const files = await publicationFiles();
  assert.ok(files.includes('src/community-layout/stable-frame.ts'));
  assert.ok(files.includes('public/assets/community/atlas-space.webp'));
  assert.ok(files.includes('scripts/compose-community-styles.mjs'));
  assert.ok(!files.some(file => file.startsWith('previews/')));
});
