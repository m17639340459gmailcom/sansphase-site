import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { communityFrameBannersHTML, createSharedFeedShowcase } from '../../src/community-layout/feed-showcase.ts';
import { createStableCommunityFrame } from '../../src/community-layout/stable-frame.ts';
import type { Common } from '../../src/community.ts';
import type { CommunityBannerConfig } from '../../src/community-banners.ts';
interface TestWindow extends Window { close(): void; HTMLElement: typeof HTMLElement }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: TestWindow } };
const imageId = '12345678-1234-1234-1234-123456789abc';
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const item = (id: string, board: string, title: string, image = '') => `<a data-frame-banner-item href="#/post/${escape(id)}" data-frame-banner-board="${escape(board)}" data-frame-banner-image="${escape(image)}"><span data-frame-banner-title>${escape(title)}</span></a>`;
const config = (scope: string, items = '', state = 'ready') => `<div data-frame-banners-state="${state}" data-frame-banners-scope="${escape(scope)}">${items}</div>`;
const pinned = (id: string) => `<div class="community-topics"><article class="community-topic is-pinned"><div class="community-topic-main"><h3><a href="#/post/${id}">自动置顶${id}</a></h3><a class="community-topic-board" href="#/community/boards/qa">学习问答</a></div></article></div>`;
const common: Common = { t: zh => zh, esc: value => escape(String(value ?? '')) };

test('frame renderer uses the resolved authorized image and safely falls back from custom title to the linked topic', () => {
  const data: CommunityBannerConfig = { scope: 'qa', version: 3, items: [
    { topicId: 'a', board: 'qa', title: '', topicTitle: '帖子原始标题', cover: null, image: imageId },
    { topicId: 'b', board: 'qa', title: '<svg onload="alert(1)">', topicTitle: '原始标题', cover: imageId, image: 'https://foreign.example/x.webp' },
    { topicId: 'foreign', board: 'meta', title: '不可见板块', topicTitle: '', cover: null },
  ] };
  const { window } = new JSDOM(`<main></main><div id="source">${communityFrameBannersHTML({ state: 'ready', data }, common, 'qa')}</div>`, { url: 'https://www.sansphase.com/' });
  const showcase = createSharedFeedShowcase(window.document.querySelector('main')!);
  try {
    showcase.sync(window.document.getElementById('source')!, false, 'qa');
    assert.match(window.document.querySelector('main')!.textContent!, /帖子原始标题/);
    assert.match(window.document.querySelector('main')!.textContent!, /<svg onload="alert\(1\)">/);
    assert.equal(window.document.querySelector('[onload]'), null);
    assert.equal(window.document.querySelectorAll('main img').length, 1);
    assert.doesNotMatch(window.document.querySelector('main')!.textContent!, /不可见板块/);
    const mismatched = communityFrameBannersHTML({ state: 'ready', data }, common, 'home');
    assert.match(mismatched, /data-frame-banners-state="loading"/);
    assert.doesNotMatch(mismatched, /帖子原始标题|onload/);
  } finally { showcase.release(); window.close(); }
});

test('saved recommendations preserve order and cards, independently of post pin or feature changes', () => {
  const { window } = new JSDOM('<main></main><div id="source"></div>', { url: 'https://www.sansphase.com/#/community/home' });
  const host = window.document.querySelector('main')!, source = window.document.getElementById('source')!;
  const showcase = createSharedFeedShowcase(host);
  try {
    source.innerHTML = config('home', item('b', 'showcase', '作者选择第二帖') + item('a', 'qa', '作者选择第一帖')) + pinned('unselected');
    showcase.sync(source, false);
    assert.deepEqual([...host.querySelectorAll('a')].map(card => card.getAttribute('href')), ['#/post/b', '#/post/a']);
    assert.equal(host.querySelector('.community-feed-showcase-controls'), null);
    assert.equal(host.querySelector('button'), null, 'banners have no arrows or playback buttons');
    assert.doesNotMatch(host.textContent!, /暂停|播放|\d{2}\s*\/\s*\d{2}/);
    assert.doesNotMatch(host.textContent!, /自动置顶/);
    assert.match(host.textContent!, /推荐/);
    assert.doesNotMatch(host.querySelector('.community-feed-showcase-kind')!.textContent!, /置顶|精华/);
    const card = host.querySelector('a')!;
    source.innerHTML = config('home', item('b', 'showcase', '作者选择第二帖') + item('a', 'qa', '作者选择第一帖')) + pinned('another');
    showcase.sync(source, false);
    assert.equal(host.querySelector('a'), card, 'post list changes must not remount the configured carousel');
  } finally { showcase.release(); window.close(); }
});

test('homepage and board configurations are isolated and foreign-board recommendations cannot leak', () => {
  const { window } = new JSDOM('<main></main><div id="source"></div>', { url: 'https://www.sansphase.com/' });
  const host = window.document.querySelector('main')!, source = window.document.getElementById('source')!;
  const showcase = createSharedFeedShowcase(host);
  try {
    source.innerHTML = config('qa', item('qa-a', 'qa', '问答推荐') + item('foreign', 'showcase', '其他板块内容')) + config('home', item('home-a', 'meta', '首页公告'));
    showcase.sync(source, false, 'qa');
    assert.deepEqual([...host.querySelectorAll('a')].map(card => card.getAttribute('href')), ['#/post/qa-a']);
    assert.match(host.textContent!, /学习问答/);
    assert.doesNotMatch(host.textContent!, /首页公告|其他板块内容/);
    showcase.sync(source, false);
    assert.equal(host.querySelector('a')!.getAttribute('href'), '#/post/home-a');
    showcase.sync(source, false, 'showcase');
    assert.equal(host.querySelector('a'), null, 'a stale homepage or board response cannot become another board’s banner');
  } finally { showcase.release(); window.close(); }
});

test('recommendation strings remain text, only image UUIDs resolve to local image routes and missing art uses the shared fallback', () => {
  const { window } = new JSDOM('<main></main><div id="source"></div>', { url: 'https://www.sansphase.com/' });
  const host = window.document.querySelector('main')!, source = window.document.getElementById('source')!;
  const showcase = createSharedFeedShowcase(host);
  try {
    source.innerHTML = config('qa', item('safe', 'qa', '<img onerror=alert(1)>', imageId) + item('foreign', 'qa', '外部图拒绝', 'https://other.example/image.webp') + item('none', 'qa', '无图'));
    showcase.sync(source, false, 'qa');
    assert.equal(host.querySelectorAll('img').length, 1);
    assert.equal(host.querySelector('img')!.getAttribute('src'), `/api/community/images/${imageId}.webp`);
    assert.match(host.textContent!, /<img onerror=alert\(1\)>/);
    assert.equal(host.querySelector('[onerror]'), null);
    assert.equal(host.querySelectorAll('.community-feed-showcase-art:not(:has(img))').length, 2);
    source.innerHTML = config('qa', item('%2Fsecret', 'qa', '非法帖子') + item('invalid', 'nonexistent', '非法板块'));
    showcase.sync(source, false, 'qa');
    assert.equal(host.querySelector('a'), null);
  } finally { showcase.release(); window.close(); }
});

test('missing, empty or failed configuration never falls back to pinned posts', () => {
  const { window } = new JSDOM('<main></main><div id="source"></div>', { url: 'https://www.sansphase.com/' });
  const host = window.document.querySelector('main')!, source = window.document.getElementById('source')!;
  const showcase = createSharedFeedShowcase(host);
  try {
    for (const [html, expected] of [[pinned('a'), /暂无/], [config('qa') + pinned('a'), /本板块暂无推荐/], [config('qa', '', 'loading') + pinned('a'), /正在读取推荐/], [config('qa', '', 'error') + pinned('a'), /暂时无法读取推荐/]] as const) {
      source.innerHTML = html; showcase.sync(source, false, 'qa');
      assert.equal(host.querySelector('a'), null);
      if (html.startsWith(config('qa'))) {
        assert.equal(host.hidden, true, 'an intentionally empty scope leaves no oversized blank panel');
        assert.equal(host.children.length, 0);
      } else {
        assert.match(host.textContent!, expected);
        assert.equal(host.firstElementChild!.getAttribute('role'), 'status');
        assert.equal(host.hidden, false, 'loading or error remains visible after an empty saved scope');
      }
    }
  } finally { showcase.release(); window.close(); }
});

test('only the first five distinct saved recommendations are shown', () => {
  const { window } = new JSDOM('<main></main><div id="source"></div>', { url: 'https://www.sansphase.com/' });
  const host = window.document.querySelector('main')!, source = window.document.getElementById('source')!;
  const showcase = createSharedFeedShowcase(host);
  try {
    source.innerHTML = config('home', ['a', 'b', 'b', 'c', 'd', 'e', 'f'].map(id => item(id, 'qa', id)).join(''));
    showcase.sync(source, false);
    assert.deepEqual([...host.querySelectorAll('a')].map(card => card.getAttribute('href')), ['#/post/a', '#/post/b', '#/post/c', '#/post/d', '#/post/e']);
  } finally { showcase.release(); window.close(); }
});

function carouselClock(window: TestWindow) {
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let sequence = 0;
  Object.defineProperty(window.document, 'hidden', { get: () => false });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return this.classList.contains('community-feed-showcase-track') ? 640 : 0; } });
  Object.defineProperty(window, 'setTimeout', { value: (callback: () => void, delay: number) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; } });
  Object.defineProperty(window, 'clearTimeout', { value: (id: number) => timers.delete(id) });
  return { timers, tick() { assert.equal(timers.size, 1); const [id, timer] = [...timers][0]; assert.equal(timer.delay, 5000); timers.delete(id); timer.callback(); } };
}

test('shared banners autoplay every five seconds and clear the timer on hidden routes and disposal', () => {
  const { window } = new JSDOM('<main></main>', { url: 'https://www.sansphase.com/#/community/home' });
  const main = window.document.querySelector('main')!;
  const clock = carouselClock(window);
  const frame = createStableCommunityFrame(window.document, window);
  const rows = config('home', ['a', 'b', 'c', 'd', 'e'].map(id => item(id, 'qa', id)).join(''));
  try {
    frame.render(main, '<section data-community="home">首页</section>', rows);
    assert.equal(main.querySelectorAll('.community-feed-showcase-card').length, 5);
    const track = main.querySelector<HTMLElement>('.community-feed-showcase-track')!;
    assert.equal(track.scrollLeft, 0);
    clock.tick();
    assert.equal(track.scrollLeft, 640);
    const timer = [...clock.timers.keys()][0];
    frame.sync(rows);
    assert.equal([...clock.timers.keys()][0], timer, 'unchanged data must not restart the five-second timer');
    window.history.replaceState(null, '', '#/community/shop');
    frame.render(main, '<section data-community="shop">兑换所</section>', rows);
    assert.equal(clock.timers.size, 0, 'leaving a banner page releases its autoplay immediately');
    window.history.replaceState(null, '', '#/community/home');
    frame.render(main, '<section data-community="home">首页</section>', rows);
    assert.equal(clock.timers.size, 1);
    clock.tick();
    assert.equal(main.querySelector<HTMLElement>('.community-feed-showcase-track')!.scrollLeft, 640);
    frame.dispose();
    assert.equal(clock.timers.size, 0);
  } finally { frame.dispose(); window.close(); }
});

test('one or empty configured banner never starts autoplay and scope replacement clears its old timer', () => {
  const { window } = new JSDOM('<main></main><div id="source"></div>', { url: 'https://www.sansphase.com/#/community/home' });
  const host = window.document.querySelector('main')!, source = window.document.getElementById('source')!;
  const clock = carouselClock(window);
  const showcase = createSharedFeedShowcase(host);
  try {
    source.innerHTML = config('home', item('a', 'qa', 'a') + item('b', 'qa', 'b'));
    showcase.sync(source, false);
    assert.equal(clock.timers.size, 1);
    const oldTimer = [...clock.timers.keys()][0];
    source.innerHTML = config('qa', item('qa-a', 'qa', '问答推荐'));
    showcase.sync(source, false, 'qa');
    assert.equal(clock.timers.has(oldTimer), false);
    assert.equal(clock.timers.size, 0);
    source.innerHTML = config('qa');
    showcase.sync(source, false, 'qa');
    assert.equal(clock.timers.size, 0);
    assert.equal(host.hidden, true);
  } finally { showcase.release(); window.close(); }
});

test('configuration loading and readiness retain the shared reading shell and current reading position', () => {
  const { window } = new JSDOM('<main></main>', { url: 'https://www.sansphase.com/#/community/boards/qa' });
  const main = window.document.querySelector('main')!;
  const frame = createStableCommunityFrame(window.document, window);
  const page = '<section data-community="board"><h1>学习问答</h1><p>当前讨论列表</p></section>';
  try {
    frame.render(main, page, config('qa', '', 'loading'));
    const center = frame.center()!, root = main.firstElementChild;
    center.scrollTop = 265;
    frame.sync(config('qa', item('qa-a', 'qa', '新推荐')));
    assert.equal(main.firstElementChild, root);
    assert.equal(frame.center(), center);
    assert.equal(center.scrollTop, 265);
    assert.equal(main.querySelector('.community-feed-showcase-card')!.getAttribute('href'), '#/post/qa-a');
  } finally { frame.dispose(); window.close(); }
});

test('cleared banners collapse the whole slot and later configuration restores it without appearing on other routes', () => {
  const { window } = new JSDOM('<main></main>', { url: 'https://www.sansphase.com/#/community/boards/qa' });
  const main = window.document.querySelector('main')!;
  const frame = createStableCommunityFrame(window.document, window);
  try {
    frame.render(main, '<section data-community="board">问答</section>', config('qa'));
    const slot = main.querySelector<HTMLElement>('[data-frame-showcase]')!;
    assert.equal(slot.hidden, true);
    frame.sync(config('qa', item('qa-a', 'qa', '问答推荐')));
    assert.equal(slot.hidden, false);
    assert.equal(slot.querySelectorAll('.community-feed-showcase-card').length, 1);
    window.history.replaceState(null, '', '#/community/shop');
    frame.render(main, '<section data-community="shop">兑换所</section>', config('home', item('home-a', 'qa', '首页推荐')));
    assert.equal(slot.hidden, true, 'the hidden promotional slot stays hidden on non-feed pages');
    window.history.replaceState(null, '', '#/community/home');
    frame.render(main, '<section data-community="home">首页</section>', config('home', item('home-a', 'qa', '首页推荐')));
    assert.equal(slot.hidden, false);
  } finally { frame.dispose(); window.close(); }
});

test('independent image banners share the carousel, keep artwork unobscured and never create a fake post link', () => {
  const data: CommunityBannerConfig = { scope: 'home', version: 1, items: [
    { kind: 'image', topicId: null, title: '活动图片', cover: imageId, image: imageId, board: '', topicTitle: '', topicImage: null },
    { topicId: 'a', title: '推荐帖子', cover: null, image: null, board: 'qa', topicTitle: '原标题' },
  ] };
  const { window } = new JSDOM(`<main></main><div id="source">${communityFrameBannersHTML({ state: 'ready', data }, common)}</div>`, { url: 'https://community.sansphase.com/#/community/home' });
  const host = window.document.querySelector('main')!, source = window.document.getElementById('source')!;
  const clock = carouselClock(window);
  const showcase = createSharedFeedShowcase(host);
  try {
    showcase.sync(source, false);
    const cards = host.querySelectorAll<HTMLElement>('.community-feed-showcase-card');
    assert.equal(cards.length, 2);
    assert.equal(cards[0].tagName, 'DIV');
    assert.equal(cards[0].getAttribute('href'), null);
    assert.ok(cards[0].classList.contains('is-image'));
    assert.equal(cards[0].querySelector('.community-feed-showcase-copy'), null);
    assert.equal(cards[0].querySelector('img')!.getAttribute('src'), `/api/community/images/${imageId}.webp`);
    assert.equal(cards[1].getAttribute('href'), '#/post/a');
    assert.equal(clock.timers.size, 1);
    clock.tick(); assert.equal(host.querySelector<HTMLElement>('.community-feed-showcase-track')!.scrollLeft, 640);
    const card = cards[0]; showcase.sync(source, false);
    assert.equal(host.querySelector('.community-feed-showcase-card'), card);
    showcase.sync(source, false, 'qa');
    assert.equal(host.querySelector('.community-feed-showcase-card'), null, 'home images cannot become a board banner');
  } finally { showcase.release(); window.close(); }
});

test('standalone banners require server-resolved local image UUIDs and the current board', () => {
  const data: CommunityBannerConfig = { scope: 'qa', version: 1, items: [
    { kind: 'image', topicId: null, title: '', cover: imageId, image: imageId, board: 'qa', topicTitle: '', topicImage: null },
    { kind: 'image', topicId: null, title: 'foreign', cover: imageId, image: imageId, board: 'meta', topicTitle: '', topicImage: null },
    { kind: 'image', topicId: null, title: 'external', cover: imageId, image: 'https://other.example/image', board: 'qa', topicTitle: '', topicImage: null },
  ] };
  const { window } = new JSDOM(`<main></main><div id="source">${communityFrameBannersHTML({ state: 'ready', data }, common, 'qa')}</div>`, { url: 'https://community.sansphase.com/' });
  const showcase = createSharedFeedShowcase(window.document.querySelector('main')!);
  try {
    showcase.sync(window.document.getElementById('source')!, false, 'qa');
    assert.equal(window.document.querySelectorAll('main img').length, 1);
    assert.equal(window.document.querySelector('main a'), null);
    assert.doesNotMatch(window.document.querySelector('main')!.textContent!, /external|foreign/);
  } finally { showcase.release(); window.close(); }
});
