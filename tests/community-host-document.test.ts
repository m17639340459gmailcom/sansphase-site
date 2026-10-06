import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createCommunityAppearance } from '../src/community-layout/appearance.ts';
import { communityHostDocument } from '../server/community-host-document.ts';

test('community HTML starts its own stylesheet early, retaining shared layout while omitting unused renderer styles', () => {
  for (const base of ['', 'https://static.sansphase.com/assets/site/0123456789abcdef01234567/']) {
    const prefix = base || './';
    const html = `<html${base ? ` data-static-base="${base}"` : ''}><head><meta name="theme-color" content="#090909"><link rel="stylesheet" href="${prefix}styles.css"><link rel="stylesheet" href="${prefix}home.css"><link rel="stylesheet" href="${prefix}cosmos.bundle.css"><script src="${prefix}app.mjs" type="module"></script></head><body><main id="main"></main></body></html>`;
    const doc = new JSDOM(communityHostDocument(html)).window.document;
    assert.equal(doc.querySelectorAll('link[rel="stylesheet"]').length, 2);
    assert.ok(doc.querySelector(`link[rel="stylesheet"][href="${prefix}home.css"]`));
    assert.ok(!doc.querySelector(`link[rel="stylesheet"][href="${prefix}cosmos.bundle.css"]`));
    assert.equal(doc.querySelector('link[rel="stylesheet"]')?.getAttribute('href'), `${prefix}styles.css`);
    const preload = doc.querySelector('link[rel="preload"][as="style"]');
    assert.equal(preload?.getAttribute('href'), `${prefix}community.css`);
    assert.equal(preload?.getAttribute('crossorigin'), base ? 'anonymous' : null);
    assert.equal(doc.body.dataset.communityOnly, 'true');
    assert.equal(doc.body.dataset.communityBoot, 'pending');
    assert.equal(doc.body.dataset.communityTheme, 'light');
    assert.equal(doc.querySelector('meta[name="theme-color"]')?.getAttribute('content'), '#e8e2d6');
    assert.ok(doc.querySelector('main#main'));
    assert.equal(doc.querySelector('script')?.getAttribute('src'), `${prefix}app.mjs`);
  }
});

test('the waiting community document paints paper before application modules load, leaving main-site appearance alone', async () => {
  const css = await readFile(new URL('../src/styles-foundation.css', import.meta.url), 'utf8');
  const html = `<html><head><style>${css}</style></head><body><main id="main"></main></body></html>`;
  for (const community of [false, true]) {
    const dom = new JSDOM(community ? communityHostDocument(html) : html);
    try {
      const { document } = dom.window;
      assert.equal(dom.window.getComputedStyle(document.documentElement).colorScheme, community ? 'light' : 'dark');
      if (community) {
        assert.equal(dom.window.getComputedStyle(document.documentElement).backgroundColor, 'rgb(232, 226, 214)', 'the hidden body cannot expose an old dark canvas');
        assert.equal(dom.window.getComputedStyle(document.body).opacity, '0');
      } else assert.equal(document.body.dataset.communityTheme, undefined);
    } finally { dom.window.close(); }
  }
});

test('the community-only application hook adopts light before its first asynchronous render without changing the main-site hook', async () => {
  const source = await readFile(new URL('../src/app.mjs', import.meta.url), 'utf8');
  const hook = source.slice(source.indexOf('if (communityOnly()) {'), source.indexOf('\nif (communityEnabled()) startCommunityLayout'));
  for (const community of [false, true]) {
    const dom = new JSDOM('<body><div id="site-startup"></div></body>', { url: 'https://community.sansphase.com/#/community/home', runScripts: 'outside-only' });
    try {
      const appearance = createCommunityAppearance(dom.window.document, dom.window);
      const run = new dom.window.Function('communityOnly', 'communityAppearance', 'communityHostRoute', 'siteContent', hook);
      run(() => community, appearance, () => ({ hash: dom.window.location.hash }), {});
      assert.equal(dom.window.document.body.dataset.communityTheme, community ? 'light' : undefined);
      assert.equal(dom.window.document.body.classList.contains('theme-light'), false, 'the main-site theme class is independent');
    } finally { dom.window.close(); }
  }
});

test('the paper canvas remains through community entrance and manual dark mode releases it', async () => {
  const [foundation, appearanceCSS] = await Promise.all([
    readFile(new URL('../src/styles-foundation.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/community-layout/appearance.css', import.meta.url), 'utf8'),
  ]);
  const dom = new JSDOM(communityHostDocument(`<html><head><style>${foundation}${appearanceCSS}</style></head><body></body></html>`));
  try {
    const { document } = dom.window;
    const appearance = createCommunityAppearance(document, dom.window);
    appearance.sync(true);
    document.body.classList.add('community-open', 'community-frame-open');
    delete document.body.dataset.communityBoot;
    document.body.style.opacity = '0';
    assert.equal(dom.window.getComputedStyle(document.documentElement).backgroundColor, 'rgb(232, 226, 214)', 'entrance opacity cannot reveal a different canvas');
    appearance.toggle();
    assert.equal(dom.window.getComputedStyle(document.documentElement).colorScheme, 'dark');
    assert.equal(dom.window.getComputedStyle(document.documentElement).backgroundColor, 'rgba(0, 0, 0, 0)', 'manual dark mode releases the light-only canvas');
  } finally { dom.window.close(); }
});
