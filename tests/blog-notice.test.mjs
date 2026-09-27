import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createBlogNotice } from '../src/blog-notice.mjs';
import { escapeHTML } from '../src/core.mjs';
import { imageSources } from '../src/image-sources.mjs';
import { siteCopy } from '../src/site-copy.mjs';

test('blog notice keeps image, link, accessibility and locale in one rotating card', () => {
  const dom = new JSDOM('<main></main>');
  const { document } = dom.window;
  let english = false;
  let notices = [
    {title:'这里记录正在发生的事。',summary:'AI 学习、作品制作与网站建设会逐步整理在这里。',image:'/poster.jpg',link:'https://example.com/first'},
    {title:'博客内容会逐步更新。',summary:'文章、资料和作品会在准备好后陆续发布。',link:'https://example.com/second'},
  ];
  const notice = createBlogNotice({document, announcements:()=>notices, english:()=>english, icons:{bell:'B',left:'L',right:'R'}, escapeHTML, imageSources, copy:value=>siteCopy(value,english?'en':'zh')});
  document.querySelector('main').innerHTML = notice.html();
  const card = document.querySelector('.blog-notice');
  assert.ok(card.classList.contains('is-poster'));
  assert.equal(card.querySelector('.blog-notice-mark').textContent, '01 / 02');
  assert.equal(card.querySelectorAll('.blog-notice-slide a')[0].tabIndex, 0);
  assert.equal(card.querySelectorAll('.blog-notice-slide a')[1].tabIndex, -1);
  assert.match(card.innerHTML, /这里记录正在发生的事/);
  assert.match(card.innerHTML, /src="\/poster\.jpg"/);

  notice.rotate(1);
  assert.ok(!card.classList.contains('is-poster'));
  assert.equal(card.querySelector('.blog-notice-mark').textContent, '02 / 02');
  assert.equal(card.querySelectorAll('.blog-notice-slide')[0].getAttribute('aria-hidden'), 'true');
  assert.equal(card.querySelectorAll('.blog-notice-slide')[1].getAttribute('aria-hidden'), 'false');
  assert.equal(card.querySelectorAll('.blog-notice-slide a')[0].tabIndex, -1);
  assert.equal(card.querySelectorAll('.blog-notice-slide a')[1].tabIndex, 0);

  english = true;
  document.querySelector('main').innerHTML = notice.html();
  assert.match(document.querySelector('main').textContent, /The blog will grow over time/);
  notices = [];
  assert.equal(notice.html(), '');
  dom.window.close();
});

test('blog notice timer is active only on blog and stops on cleanup', () => {
  const dom = new JSDOM('<main></main>');
  const calls = [];
  const notice = createBlogNotice({
    document:dom.window.document,
    announcements:()=>[{title:'One',summary:'A'},{title:'Two',summary:'B'}],
    english:()=>false,
    icons:{bell:'B',left:'L',right:'R'},
    escapeHTML, imageSources, copy:value=>value,
    setInterval(callback, delay) { calls.push(['start',delay]); return callback; },
    clearInterval(callback) { calls.push(['stop',typeof callback]); },
  });
  notice.sync('notes');
  notice.sync('works');
  notice.sync('notes');
  notice.stop();
  assert.deepEqual(calls, [['start',6500],['stop','function'],['start',6500],['stop','function']]);
  dom.window.close();
});

test('notice logic stays in the existing UI bundle without adding a startup module', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const app = await readFile('dist/app.mjs','utf8');
  const ui = await readFile('dist/ui.bundle.mjs','utf8');
  assert.doesNotMatch(app, /from ["']\.\/blog-notice\.mjs["']/);
  assert.match(ui, /createBlogNotice/);
  assert.ok(!(await readdir('dist')).includes('blog-notice.mjs'));
});
