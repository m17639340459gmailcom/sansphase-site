import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { updateBlogMetadata } from '../src/blog-metadata.ts';

test('article metadata survives client takeover and is removed when leaving or previewing', () => {
  const dom = new JSDOM('<head><title>Website</title><meta name="description" content="Website"><link rel="canonical" href="https://site.test/"></head>');
  const doc = dom.window.document;
  const options = {origin:'https://site.test', siteName:'作者', page:'note', item:{id:'sample',title:'文章标题',summary:'摘要',coverSrc:'/api/media/11111111-1111-4111-8111-111111111111'}};
  try {
    updateBlogMetadata(doc, options);
    assert.equal(doc.title, '文章标题 · 作者');
    assert.equal(doc.querySelector('meta[name="description"]')!.getAttribute('content'), '摘要');
    assert.equal(doc.querySelector('link[rel="canonical"]')!.getAttribute('href'), 'https://site.test/blog/sample');
    assert.equal(doc.querySelector('meta[property="og:type"]')!.getAttribute('content'), 'article');
    updateBlogMetadata(doc, options);
    assert.equal(doc.querySelectorAll('link[rel="canonical"]').length, 1);
    doc.title = '博客 · 無相';
    updateBlogMetadata(doc, {...options, page:'notes', item:null});
    assert.equal(doc.title, '博客 · 無相');
    assert.equal(doc.querySelector('meta[property="og:type"]')!.getAttribute('content'), 'website');
    assert.equal(doc.querySelector('link[rel="canonical"]'), null, 'do not advertise the departed article');
    updateBlogMetadata(doc, {...options, preview:true});
    assert.equal(doc.querySelector('link[rel="canonical"]'), null, 'draft previews never claim the public article canonical');
    assert.equal(doc.querySelector('meta[name="robots"]')!.getAttribute('content'), 'noindex');
    updateBlogMetadata(doc, options);
    assert.equal(doc.querySelector('meta[name="robots"]'), null);
  } finally { dom.window.close(); }
});
