import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityHostDocument } from '../server/community-host-document.ts';

test('community HTML starts its own stylesheet early, retaining shared layout while omitting unused renderer styles', () => {
  for (const base of ['', 'https://static.sansphase.com/assets/site/0123456789abcdef01234567/']) {
    const prefix = base || './';
    const html = `<html${base ? ` data-static-base="${base}"` : ''}><head><link rel="stylesheet" href="${prefix}styles.css"><link rel="stylesheet" href="${prefix}home.css"><link rel="stylesheet" href="${prefix}cosmos.bundle.css"><script src="${prefix}app.mjs" type="module"></script></head><body><main id="main"></main></body></html>`;
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
    assert.ok(doc.querySelector('main#main'));
    assert.equal(doc.querySelector('script')?.getAttribute('src'), `${prefix}app.mjs`);
  }
});
