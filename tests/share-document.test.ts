import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { shareDocument, shareDocumentCsp, shareHead } from '../server/share-document.ts';
import type { ShareCard } from '../server/share-document.ts';

const card: ShareCard = {
  title: '星空创作 · 無相',
  description: '一起交流学习与创作。',
  url: 'https://community.example.test/share/post/topic',
  target: 'https://community.example.test/#/post/topic',
  image: 'https://community.example.test/share/cover.jpg',
  siteName: '無相社区',
  type: 'article',
};
const documentFor = (input: ShareCard = card) => new JSDOM(shareDocument(input)).window.document;

test('a share page exposes the public card to crawlers and as one clickable visual card', () => {
  const document = documentFor();
  const metadata = (property: string) => document.querySelector(`meta[property="${property}"]`)?.getAttribute('content');
  assert.equal(document.title, card.title);
  assert.equal(document.querySelector('meta[name="description"]')?.getAttribute('content'), card.description);
  assert.equal(metadata('og:title'), card.title);
  assert.equal(metadata('og:description'), card.description);
  assert.equal(metadata('og:url'), card.url);
  assert.equal(metadata('og:image'), card.image);
  assert.equal(metadata('og:image:alt'), card.title);
  assert.equal(metadata('og:type'), 'article');
  assert.equal(metadata('og:site_name'), card.siteName);
  assert.equal(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), card.url);
  assert.equal(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content'), 'summary_large_image');
  assert.equal(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content'), card.title);
  assert.equal(document.querySelector('meta[name="twitter:description"]')?.getAttribute('content'), card.description);
  assert.equal(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content'), card.image);
  const link = document.querySelector('main a');
  assert.equal(document.querySelectorAll('main a').length, 1);
  assert.equal(link?.getAttribute('href'), card.target);
  assert.equal(link?.querySelector('h1')?.textContent, card.title);
  assert.equal(link?.querySelector('p')?.textContent, card.description);
  assert.equal(link?.querySelector('img')?.getAttribute('src'), card.image);
  assert.equal(link?.querySelector('img')?.getAttribute('alt'), card.title);
  assert.equal(link?.querySelector('img')?.getAttribute('width'), '1200');
  assert.equal(link?.querySelector('img')?.getAttribute('height'), '630');
});

test('homepage head injection leaves the existing document title and description untouched', () => {
  const document = new JSDOM(`<html><head><title>Original</title><meta name="description" content="Existing">${shareHead(card)}</head><body></body></html>`).window.document;
  assert.equal(document.querySelectorAll('title').length, 1);
  assert.equal(document.title, 'Original');
  assert.equal(document.querySelectorAll('meta[name="description"]').length, 1);
  assert.equal(document.querySelector('meta[name="description"]')?.getAttribute('content'), 'Existing');
  assert.equal(document.querySelector('meta[property="og:title"]')?.getAttribute('content'), card.title);
  assert.equal(document.querySelectorAll('style, script, main').length, 0);
  assert.equal(documentFor({ ...card, type: undefined }).querySelector('meta[property="og:type"]')?.getAttribute('content'), 'website');
});

test('malicious-looking titles, descriptions and names stay inert text in both metadata and the visual card', () => {
  const title = '"/><script>alert("title")</script></title><img src=x onerror=alert(1)> & 星轨';
  const description = '</p><svg onload=alert(2)></svg></script> " & <b>literal</b>';
  const siteName = '</span><iframe src="https://attacker.test"></iframe>';
  const document = documentFor({ ...card, title, description, siteName });
  assert.equal(document.title, title);
  assert.equal(document.querySelector('h1')?.textContent, title);
  assert.equal(document.querySelector('main p')?.textContent, description);
  assert.equal(document.querySelector('meta[property="og:title"]')?.getAttribute('content'), title);
  assert.equal(document.querySelector('meta[property="og:description"]')?.getAttribute('content'), description);
  assert.equal(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content'), siteName);
  assert.equal(document.querySelector('img')?.getAttribute('alt'), title);
  assert.equal(document.querySelectorAll('script, iframe, svg, [onerror], [onload]').length, 0);
  assert.equal(document.querySelectorAll('img').length, 1);
});

test('unsafe URL schemes, credentials and remote insecure URLs are rejected before rendering', () => {
  const unsafe = ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/private.txt', '//attacker.test/', '/relative', 'https://reader:secret@example.test/', 'http://example.test/', 'https://example.test/\r\ninjected'];
  for (const key of ['url', 'target', 'image'] as const) {
    for (const value of unsafe) {
      assert.throws(() => shareDocument({ ...card, [key]: value }), /share URL/i, `${key}: ${JSON.stringify(value)}`);
    }
  }
  assert.throws(() => shareHead({ ...card, image: 'javascript:alert(1)' }), /share URL/i);
});

test('HTTPS URL quotes and ampersands remain URL data without injected attributes', () => {
  const image = 'https://community.example.test/image?label=" onerror="alert(1)&size=960';
  const target = 'https://community.example.test/#/post/topic?label=" onclick="alert(1)&mode=read';
  const document = documentFor({ ...card, image, target });
  assert.equal(document.querySelector('img')?.getAttribute('src'), new URL(image).href);
  assert.equal(document.querySelector('main a')?.getAttribute('href'), new URL(target).href);
  assert.equal(document.querySelectorAll('[onerror], [onclick]').length, 0);
});

test('loopback HTTP supports local previews while lookalike hosts are rejected', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const origin = `http://${host}:4244`;
    const document = documentFor({ ...card, url: origin + '/share/site', target: origin + '/', image: origin + '/share/cover.jpg' });
    assert.equal(document.querySelector('main a')?.getAttribute('href'), origin + '/');
  }
  for (const host of ['localhost.attacker.test', '127.0.0.1.attacker.test', '10.0.0.1']) {
    assert.throws(() => shareDocument({ ...card, image: `http://${host}/image.jpg` }), /share URL/i);
  }
});

test('the page reserves image space, keeps its exact CSP style hash and does not force navigation', () => {
  const document = documentFor();
  const styles = document.querySelectorAll('style');
  assert.equal(styles.length, 1);
  const style = styles[0].textContent || '';
  const hash = createHash('sha256').update(style).digest('base64');
  assert.ok(shareDocumentCsp.includes(`style-src 'sha256-${hash}'`));
  assert.ok(shareDocumentCsp.includes("default-src 'none'"));
  assert.ok(shareDocumentCsp.includes("base-uri 'none'"));
  assert.ok(shareDocumentCsp.includes("frame-ancestors 'none'"));
  assert.ok(!shareDocumentCsp.includes("'unsafe-inline'"));
  const image = document.querySelector('img')!;
  assert.ok(Number(image.getAttribute('width')) > 0 && Number(image.getAttribute('height')) > 0);
  assert.equal(document.querySelectorAll('script, base, iframe, meta[http-equiv="refresh"], link[rel="stylesheet"]').length, 0);
  assert.equal(documentFor({ ...card, title: 'Another title' }).querySelector('style')?.textContent, style);
});
