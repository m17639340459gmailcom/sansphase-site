import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityBodyHTML, communityTopicsHTML } from '../src/community.ts';
import { communityComposeHTML, communityPostHTML } from '../src/community-post.ts';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const marker = `![图片](/api/community/images/${id}.webp)`;
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const common = { t: zh => zh, esc, members: true, me: { name: '读者', level: 2, agreed: true } };
test('inline images retain text-image-text order and render only attached image IDs', () => {
  const body = `图片前的说明\n\n${marker}\n\n图片后的说明`;
  const html = communityBodyHTML(body, esc, {}, [id]);
  assert.match(html, /图片前的说明<\/p>.*<img .*图片后的说明/s);
  assert.equal(new JSDOM(html).window.document.querySelectorAll('img').length, 1);
  assert.equal(new JSDOM(communityBodyHTML(body, esc)).window.document.querySelectorAll('img').length, 0);
  assert.equal(new JSDOM(communityBodyHTML('![图片](https://untrusted.test/a.png)', esc, {}, [id])).window.document.querySelectorAll('img').length, 0);
  assert.equal(new JSDOM(communityBodyHTML('```\n' + marker + '\n```', esc, {}, [id])).window.document.querySelectorAll('img').length, 0);
});
test('each compose board has a required title and an image picker inside the body toolbar, with no separate gallery', () => {
  for (const board of ['qa', 'showcase', 'tools', 'moments', 'meta', 'vip']) {
    const doc = new JSDOM(communityComposeHTML({ ...common, board, simple: true })).window.document;
    assert.equal(doc.querySelector('[name="title"]')?.required, true, board);
    assert.equal(doc.querySelector('[name="body"]').required, true);
    assert.equal(doc.querySelector('.community-uploads'), null);
    assert.ok(doc.querySelector('.community-editor [data-community-upload]'));
    assert.ok(doc.querySelector('[data-community-rich]'));
  }
});
test('post details do not duplicate an inline picture in the old gallery', () => {
  const topic = { id: 'p1', board: 'qa', title: '标题', body: `说明\n\n${marker}`, author: { name: '作者' }, images: [{ id, width: 100, height: 100 }] };
  const doc = new JSDOM(communityPostHTML({ ...common, thread: { state: 'ready', data: { topic, replies: [], related: [], author: { name: '作者' } } } })).window.document;
  assert.equal(doc.querySelectorAll(`img[src*="${id}"]`).length, 1);
  assert.ok(doc.querySelector('.community-text img'));
});

test('reply and reply-edit use inline image tools without cover requirements, and render attached pictures', () => {
  const topic = { id: 'p1', board: 'qa', title: '标题', body: '正文', canReply: true, author: common.me };
  const reply = { id: 'r1', body: `截图说明\n\n${marker}`, author: common.me, canEdit: true, images: [{ id, width: 100, height: 100 }] };
  const thread = { state: 'ready', data: { topic, replies: [reply], related: [], author: common.me } };
  const doc = new JSDOM(communityPostHTML({ ...common, thread })).window.document;
  assert.ok(doc.querySelector('.community-reply-form [data-inline-editor] [data-community-upload]'));
  assert.equal(doc.querySelectorAll(`.community-reply img[src*="${id}"]`).length, 1);
  assert.doesNotMatch(doc.querySelector('.community-reply-form').textContent, /封面|至少 1 张/);
  const edit = new JSDOM(communityPostHTML({ ...common, thread, editingReply: 'r1' })).window.document;
  assert.equal(edit.querySelectorAll('[data-inline-editor]').length, 2);
  assert.ok(edit.querySelector('.community-reply-edit [data-community-rich]'));
});

test('moments show the entered title in the list and detail, while old untitled moments keep their excerpt', () => {
  const topic = { id: 'p2', board: 'moments', title: '保留我的标题', hasTitle: true, rawTitle: '保留我的标题', body: '正文内容', excerpt: '正文内容', author: { name: '作者' }, replies: 0, likes: 0 };
  const list = new JSDOM(communityTopicsHTML([topic], common)).window.document;
  assert.equal(list.querySelector('h3 a')?.textContent, '保留我的标题');
  const detail = new JSDOM(communityPostHTML({ ...common, thread: { state: 'ready', data: { topic, replies: [], related: [], author: topic.author } } })).window.document;
  assert.equal(detail.querySelector('h1').classList.contains('sr-only'), false);
  const legacy = new JSDOM(communityTopicsHTML([{ ...topic, hasTitle: false }], common)).window.document;
  assert.equal(legacy.querySelector('.community-topic-moment').textContent, '正文内容');
});

test('the candidate list uses the first body image as one cover in every board', () => {
  for (const board of ['qa', 'showcase', 'tools', 'moments', 'meta', 'vip']) {
    const topic = { id: board, board, title: '标题', author: common.me, thumbs: [id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] };
    const doc = new JSDOM(communityTopicsHTML([topic], { ...common, showTopicCovers: true })).window.document;
    assert.equal(doc.querySelectorAll('.community-topic-thumbs img').length, 1);
    assert.equal(doc.querySelector('.community-topic-thumbs img').getAttribute('src'), `/api/community/images/${id}.webp?w=768`, 'a single cover starts with one complete-proportion list image');
    assert.equal(doc.querySelector('.community-topic-thumbs img').getAttribute('loading'), 'lazy');
  }
});

test('single image previews preserve the complete source while multi-image previews retain their thumbnail grid', () => {
  for (const board of ['showcase', 'moments']) {
    for (const count of [1, 2, 3, 4]) {
      const ids = [id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'].slice(0, count);
      const dom = new JSDOM(communityTopicsHTML([{ id: 'p1', board, title: '完整海报', author: common.me, thumbs: ids }], common));
      try {
        const images = [...dom.window.document.querySelectorAll('.community-topic-thumbs img')];
        assert.equal(images.length, count);
        assert.deepEqual(images.map(image => image.getAttribute('src')), ids.map(value => `/api/community/images/${value}.webp?w=${count === 1 ? 768 : 384}`));
      } finally { dom.window.close(); }
    }
  }
});
