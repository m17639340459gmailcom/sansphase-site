import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createElement, ArrowLeft, ArrowRight, Download } from 'lucide';
import { renderArticlePage, articleIcons } from '../src/article-page.ts';

test('shared article glyphs retain the current Lucide UI exactly without needing a server DOM', () => {
  const dom = new JSDOM('');
  const old = globalThis.document;
  Object.assign(globalThis, { document: dom.window.document });
  try {
    for (const [name, node, classes] of [['left', ArrowLeft, ''], ['download', Download, ''], ['arrow', ArrowRight, 'arrow']] as const) {
      assert.equal(articleIcons[name], createElement(node, {class: `ui-icon ${classes}`, 'aria-hidden': 'true', focusable: 'false', 'stroke-width': 1.6}).outerHTML);
    }
  } finally { Object.assign(globalThis, { document: old }); dom.window.close(); }
});

test('server and client share article structure, escaping, attachments, authored language and responsive covers', () => {
  const item = { id: 'test', title: 'Title <unsafe>', en: 'Other title', summary: 'Summary & more', category: '随笔',
    date: '2026-10-11T12:00:00+08:00', tags: ['<tag>'], coverSrc: '/api/media/11111111-1111-4111-8111-111111111111', coverWidth: 800, coverHeight: 450,
    bodyHTML: '<h2>Body</h2><p>Sanitized published text</p>', attachments: [{url: '/api/media/attachment', name: '<file>'}] };
  for (const english of [false, true]) {
    const dom = new JSDOM(renderArticlePage(item, {siteName: '作者', english}));
    try {
      const doc = dom.window.document;
      assert.equal(doc.querySelector('h1')!.textContent, item.title);
      assert.equal(doc.querySelector('.article-body > h2')!.textContent, 'Body');
      assert.equal(doc.querySelector('.post-tags span')!.textContent, '作者');
      assert.equal(doc.querySelector('.article-attachments a')!.textContent, '<file>');
      assert.equal(doc.querySelector('.back-link')!.getAttribute('href'), '/#/notes');
      assert(doc.querySelector('.page.fade-in > .article.reading-article .cover-frame img[srcset]'));
      assert.equal(doc.querySelector('.article-preview-label'), null);
    } finally { dom.window.close(); }
  }
});

test('site-owned relative artwork resolves identically on old and ordinary article URLs', () => {
  const html = renderArticlePage({id:'sample', title:'Title', coverSrc:'./assets/materials/eso-orion.jpg'});
  for (const url of ['https://site.test/#/note/sample', 'https://site.test/blog/sample']) {
    const dom = new JSDOM(html, {url});
    assert.equal(dom.window.document.querySelector<HTMLImageElement>('.article-cover')!.src, 'https://site.test/assets/materials/eso-orion.jpg');
    dom.window.close();
  }
});
