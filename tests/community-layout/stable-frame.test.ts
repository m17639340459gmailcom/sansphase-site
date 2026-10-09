import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createStableCommunityFrame } from '../../src/community-layout/stable-frame.ts';
import { communityRoute } from '../../src/community.ts';
interface TestWindow extends Window { Event: typeof Event }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: TestWindow } };
const summary = '<section data-community="home"><div class="community-banner-side"><dl class="community-stats"><dd>22</dd></dl><button data-action="community-checkin">签到</button></div><aside class="community-aside"><section class="community-card"><header><h2>热门讨论</h2></header><p>还没有帖子</p></section><section class="community-card"><div class="community-boards">板块</div></section></aside></section>';
const header = '<div class="community-brand-group">社区</div><nav id="navigation" class="nav community-nav"><a href="#/community/home" aria-current="page">首页</a><a href="#/community/boards">版块</a><a href="#/community/checkin">签到</a></nav><div class="header-actions"><button>账号</button></div>';
const page = (view: string) => `<section data-community="${view}"><h1>${view}</h1><button>内容按钮</button></section>`;
const postPage = (author: string) => `<section data-community="post"><div class="community-post-grid"><article class="community-thread"><p>${author}的正文</p><form><textarea>未发送的回复</textarea></form></article><aside class="community-post-side"><section class="community-card community-author-card">${author}<button data-action="community-follow">关注</button></section><section class="community-card"><h2>作品信息</h2><button data-action="community-unlock">解锁</button></section><section class="community-card"><h2>同版块</h2><a href="#/post/related">相关帖子</a></section></aside></div></section>`;

test('a dynamic board activity title follows controller metadata without replacing the reading shell', () => {
  const { window } = new JSDOM('<main></main>', { url: 'https://community.sansphase.com/#/community/boards/board-10a2' });
  const main = window.document.querySelector('main')!;
  const frame = createStableCommunityFrame(window.document, window);
  const supporting = (label: string) => `<section data-community="home" data-frame-board="board-10a2"><div class="community-banner-side"><dl class="community-stats"><dd>1</dd></dl></div><div class="community-boards"><a class="community-board-link" href="#/community/boards/board-10a2" data-board-id="board-10a2" data-board-icon="box" data-board-color="#8fd0c8" data-board-light-color="#2c6d65"><span>${label}</span></a></div></section>`;
  try {
    frame.render(main, page('board'), supporting('模型讨论'));
    const root = main.firstElementChild, right = main.querySelector('[data-frame-right]');
    const center = frame.center()!;
    center.scrollTop = 190;
    assert.equal(right!.querySelector('[data-frame-overview] h2')!.textContent, '模型讨论动态');
    window.document.documentElement.lang = 'en';
    frame.sync(supporting('Models'));
    assert.equal(right!.querySelector('[data-frame-overview] h2')!.textContent, 'Models activity');
    assert.equal(main.firstElementChild, root);
    assert.equal(main.querySelector('[data-frame-right]'), right);
    assert.equal(frame.center(), center);
    assert.equal(center.scrollTop, 190);
  } finally { frame.dispose(); window.close(); }
});

for (const mobile of [false, true]) {
  for (const mode of ['paint', 'tab'] as const) {
    test(`${mobile ? 'mobile document' : 'desktop center'} reserves reading height through ${mode} loading without an intermediate scroll clamp`, () => {
      const { window } = new JSDOM('<main></main>', { url: 'http://localhost/#/community/shop' });
      Object.defineProperty(window, 'matchMedia', { value: (query: string) => ({ matches: mobile && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }) });
      const callbacks = new Map<number, FrameRequestCallback>(); let sequence = 0;
      window.requestAnimationFrame = callback => { callbacks.set(++sequence, callback); return sequence; };
      window.cancelAnimationFrame = id => { callbacks.delete(id); };
      const flush = () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0)); };
      const frame = createStableCommunityFrame(window.document, window);
      const main = window.document.querySelector('main')!;
      const content = (height: number, loading = false) => `<section data-community="shop" data-test-height="${height}"${loading ? ' aria-busy="true"' : ''}>${loading ? '<p class="community-status">正在读取</p>' : '内容'}</section>`;
      try {
        frame.render(main, content(2000), summary); flush();
        const slot = main.querySelector<HTMLElement>('[data-frame-route]')!;
        const host = mobile ? window.document.documentElement : frame.center()!;
        const height = () => Math.max(Number(slot.firstElementChild?.getAttribute('data-test-height') || 0), parseFloat(slot.style.minHeight) || 0);
        slot.getBoundingClientRect = () => ({ height: height(), top: 0, bottom: height(), left: 0, right: 640, width: 640, x: 0, y: 0, toJSON() {} });
        let top = 500;
        Object.defineProperty(host, 'scrollTop', { get: () => top = Math.min(top, Math.max(0, height() - 600)), set: (value: number) => { top = Math.min(value, Math.max(0, height() - 600)); } });
        Object.defineProperty(host, 'clientHeight', { get: () => 600 });
        if (mode === 'paint') {
          const restore = frame.preserveReadingPosition();
          slot.replaceChildren(); slot.innerHTML = content(180, true);
          assert.equal(host.scrollTop, 500, 'loading must not clamp the viewport before restoration'); restore();
        } else {
          window.history.replaceState(null, '', '#/community/shop/card');
          frame.render(main, content(180, true), summary);
          assert.equal(host.scrollTop, 500, 'a category changes content without scrolling to the top');
        }
        flush(); assert.equal(host.scrollTop, 500);
        host.dispatchEvent(new window.Event('wheel', { bubbles: true })); host.scrollTop = 250; flush();
        assert.equal(host.scrollTop, 250, 'user scroll during loading takes priority');
        const restore = frame.preserveReadingPosition(); slot.innerHTML = content(2000); restore(); flush();
        assert.equal(host.scrollTop, 250); assert.equal(slot.style.minHeight, '', 'ready content releases temporary height');
        const finishShort = frame.preserveReadingPosition(); slot.innerHTML = content(400); finishShort(); flush();
        assert.equal(slot.style.minHeight, ''); assert.equal(host.scrollTop, 0, 'final short content settles at its valid limit');
        slot.innerHTML = content(2000); host.scrollTop = 500;
        const stale = frame.preserveReadingPosition(); slot.innerHTML = content(180, true);
        window.history.replaceState(null, '', '#/community/boards/qa');
        frame.render(main, content(2000), summary); stale(); flush();
        assert.equal(host.scrollTop, 0, 'a different page starts at zero and ignores old restoration');
        assert.equal(slot.style.minHeight, '', 'route changes release the old loading height');
      } finally { frame.dispose(); window.close(); }
    });
  }
}
test('management routes do not use the ordinary three-column reading frame', () => {
  const { window } = new JSDOM('<main id="main"></main>', { url: 'http://localhost/#/community/manage/items' });
  const frame = createStableCommunityFrame(window.document, window);
  try {
    assert.equal(frame.enabled(), false);
    assert.equal(frame.render(window.document.getElementById('main')!, page('manage'), summary), false);
    assert.equal(window.document.querySelector('[data-community-frame]'), null);
  } finally { frame.dispose(); window.close(); }
});

test('crossing between the reading frame and management preserves the document scrollbar gutter', async () => {
  const foundation = await readFile(new URL('../../src/styles-foundation.css', import.meta.url), 'utf8');
  const stable = await readFile(new URL('../../src/community-layout/stable-frame.css', import.meta.url), 'utf8');
  const { window } = new JSDOM(`<style>${foundation}\n${stable}</style><body class="community-open community-frame-open"></body>`, { url: 'http://localhost/#/community/home' });
  try {
    const root = window.document.documentElement;
    root.classList.add('community-frame-document');
    const reading = window.getComputedStyle(root);
    const gutter = reading.scrollbarGutter, width = reading.scrollbarWidth;
    assert.equal(gutter, 'stable', 'reserve the outer gutter even while the center owns scrolling');
    assert.equal(width, 'auto', 'a hidden-width scrollbar would remove that reservation');
    root.classList.remove('community-frame-document');
    window.document.body.classList.replace('community-frame-open', 'community-management-open');
    const management = window.getComputedStyle(root);
    assert.equal(management.scrollbarGutter, gutter);
    assert.equal(management.scrollbarWidth, width);
    window.document.body.classList.replace('community-management-open', 'community-frame-open');
    root.classList.add('community-frame-document');
    assert.equal(window.getComputedStyle(root).scrollbarGutter, gutter);
  } finally { window.close(); }
});

for (const mobile of [false, true]) test(`${mobile ? 'mobile document' : 'desktop center'} keeps a visible member tab stationary when its ready content is empty`, () => {
  const { window } = new JSDOM('<main></main>', { url: 'http://localhost/#/community/u/10009/badges' });
  Object.defineProperty(window, 'matchMedia', { value: (query: string) => ({ matches: mobile && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }) });
  const callbacks = new Map<number, FrameRequestCallback>(); let sequence = 0;
  window.requestAnimationFrame = callback => { callbacks.set(++sequence, callback); return sequence; };
  window.cancelAnimationFrame = id => { callbacks.delete(id); };
  const flush = () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0)); };
  const frame = createStableCommunityFrame(window.document, window), main = window.document.querySelector('main')!;
  const member = (height: number) => `<section class="community-member" data-community="member" data-test-height="${height}"><header>统筹</header><nav>头像框</nav><div></div></section>`;
  try {
    frame.render(main, member(2000), summary); flush();
    const slot = main.querySelector<HTMLElement>('[data-frame-route]')!;
    const host = mobile ? window.document.documentElement : frame.center()!;
    const height = () => Math.max(Number(slot.firstElementChild?.getAttribute('data-test-height') || 0), parseFloat(slot.style.minHeight) || 0);
    let top = 400;
    Object.defineProperty(host, 'clientHeight', { get: () => 600 });
    Object.defineProperty(host, 'scrollTop', { get: () => top = Math.min(top, Math.max(0, height() - 600)), set: (value: number) => { top = Math.min(value, Math.max(0, height() - 600)); } });
    frame.center()!.getBoundingClientRect = () => ({ top: 0, height: 600, bottom: 600, left: 0, right: 640, width: 640, x: 0, y: 0, toJSON() {} });
    slot.getBoundingClientRect = () => ({ top: -host.scrollTop, height: height(), bottom: height() - host.scrollTop, left: 0, right: 640, width: 640, x: 0, y: -host.scrollTop, toJSON() {} });
    window.history.replaceState(null, '', '#/community/u/10009/frames');
    frame.render(main, member(450), summary); flush();
    assert.equal(host.scrollTop, 400, 'empty frames must not clamp the clicked tab back down the viewport');
    assert.equal(slot.style.minHeight, '1000px', 'reserve only this viewport, rather than the full old badge page');
    host.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.equal(host.scrollTop, 400, 'pressing another tab must not remove its reading floor before the click');
    host.dispatchEvent(new window.Event('wheel', { bubbles: true })); host.scrollTop = 250;
    const restore = frame.preserveReadingPosition(); slot.innerHTML = member(450); restore(); flush();
    assert.equal(host.scrollTop, 250, 'a user scroll takes priority over the earlier tab position');
    assert.equal(slot.style.minHeight, '850px');
    window.history.replaceState(null, '', '#/community/u/10001/frames');
    frame.render(main, member(450), summary); flush();
    assert.equal(host.scrollTop, 0, 'another member starts at the top');
    assert.equal(slot.style.minHeight, '', 'another member does not inherit empty space from the old page');
  } finally { frame.dispose(); window.close(); }
});
test('in-page category and profile tab navigation retains scroll, including clicking the current tab', () => {
  const { window } = new JSDOM(`<header id="site-header">${header}</header><main id="main"></main>`, { url: 'http://localhost:4214/#/community/shop' });
  const main = window.document.getElementById('main')!;
  const frame = createStableCommunityFrame(window.document, window);
  try {
    for (const [from, to, view] of [
      ['#/community/shop', '#/community/shop/card', 'shop'],
      ['#/community/u/10001', '#/community/u/10001/replies', 'member'],
      ['#/community/stardust', '#/community/stardust/levels', 'stardust'],
      ['#/community/inbox', '#/community/inbox/reply', 'inbox'],
    ]) {
      window.history.replaceState(null, '', from!);
      frame.render(main, page(view!), summary);
      const center = frame.center()!;
      center.dispatchEvent(new window.Event('wheel')); center.scrollTop = 280;
      window.history.replaceState(null, '', to!);
      frame.render(main, `${page(view!)}<a href="${to}">当前分类</a>`, summary);
      assert.equal(center.scrollTop, 280, `${view} tabs stay in the same page`);
      main.querySelector<HTMLAnchorElement>(`[data-frame-route] > a`)!.click();
      assert.equal(center.scrollTop, 280, 'a repeated content-tab click must not act like sidebar navigation');
    }
    window.history.replaceState(null, '', '#/community/shop/card');
    frame.render(main, page('shop'), summary);
    frame.center()!.scrollTop = 280;
    const nav = window.document.querySelector('#navigation')!;
    const shopEntry = window.document.createElement('a');
    shopEntry.href = '#/community/shop'; nav.append(shopEntry);
    shopEntry.click();
    window.history.replaceState(null, '', '#/community/shop');
    frame.render(main, page('shop'), summary);
    assert.equal(frame.center()!.scrollTop, 0, 'the sidebar can explicitly return to the beginning of the same page');
    window.history.replaceState(null, '', '#/community/u/10002');
    frame.render(main, page('member'), summary);
    assert.equal(frame.center()!.scrollTop, 0, 'a different user is a different page');
  } finally { frame.dispose(); window.close(); }
});
test('every route entry starts at the top while both rails and the header stay mounted', () => {
  const { window } = new JSDOM(`<header id="site-header">${header}</header><main id="main"></main>`, { url: 'http://localhost:4212/?layout=stable#/community/home' });
  const main = window.document.getElementById('main')!;
  const frame = createStableCommunityFrame(window.document, window);
  assert.equal(frame.render(main, page('home'), summary), true);
  const root = main.firstElementChild;
  const right = main.querySelector('[data-frame-right]')!;
  const checkin = right.querySelector('button');
  const nav = window.document.getElementById('navigation');
  const center = main.querySelector<HTMLElement>('[data-frame-center]')!;
  center.scrollTop = 345;
  window.history.replaceState(null, '', '#/community/boards/qa');
  frame.render(main, page('board'), summary);
  assert.equal(main.firstElementChild, root);
  assert.equal(main.querySelector('[data-frame-right]'), right);
  assert.equal(right.querySelector('button'), checkin);
  assert.equal(window.document.getElementById('navigation'), nav);
  assert.equal(center.scrollTop, 0);
  window.history.replaceState(null, '', '#/community/home');
  frame.render(main, page('home'), summary);
  assert.equal(center.scrollTop, 0, 'returning to a visited route must also start at the top');
  assert.equal(frame.header(header), true);
  assert.equal(window.document.getElementById('navigation'), nav);
  frame.dispose(); window.close();
});

test('all community route types invalidate an earlier reading-position restore', () => {
  const { window } = new JSDOM(`<header id="site-header">${header}</header><main></main>`, { url: 'http://localhost:4213/#/community/home' });
  const main = window.document.querySelector('main')!;
  const frame = createStableCommunityFrame(window.document, window);
  try {
    frame.render(main, page('home'), summary);
    const center = frame.center()!, right = main.querySelector<HTMLElement>('[data-frame-right]')!;
    const nav = window.document.getElementById('navigation');
    right.scrollTop = 52;
    for (const hash of ['#/community/boards/qa', '#/community/boards/showcase', '#/community/boards/tools', '#/community/boards/moments', '#/community/boards/meta', '#/community/boards/vip', '#/community/checkin', '#/community/shop', '#/community/rank', '#/community/u/u1', '#/community/u/u1/replies', '#/community/stardust', '#/community/stardust/rules', '#/community/inbox', '#/community/inbox/system', '#/community/bookmarks', '#/community/rules', '#/community/new/qa', '#/post/p1', '#/community/home']) {
      const before = communityRoute(window.location.hash), after = communityRoute(hash);
      const samePage = before.view === after.view && before.id === after.id && before.board === after.board;
      center.scrollTop = 300;
      const oldRestore = frame.preserveReadingPosition();
      window.history.replaceState(null, '', hash);
      frame.render(main, page('next'), summary);
      assert.equal(center.scrollTop, samePage ? 300 : 0, hash);
      if (samePage) center.scrollTop = 215;
      oldRestore();
      assert.equal(center.scrollTop, samePage ? 215 : 0, 'an earlier address cannot restore over the current page/tab');
      assert.equal(frame.center(), center);
      assert.equal(main.querySelector('[data-frame-right]'), right);
      assert.equal(right.scrollTop, 52);
      assert.equal(window.document.getElementById('navigation'), nav);
    }
    center.scrollTop = 300;
    const stale = frame.preserveReadingPosition();
    frame.resetToTop();
    stale();
    assert.equal(center.scrollTop, 0, 'an explicit context switch invalidates same-route restores');
  } finally { frame.dispose(); window.close(); }
});

test('community history scroll ownership is released when leaving the frame', () => {
  const { window } = new JSDOM('<main></main>', { url: 'http://localhost:4213/#/community/checkin' });
  Object.defineProperty(window.history, 'scrollRestoration', { configurable: true, writable: true, value: 'auto' });
  const main = window.document.querySelector('main')!;
  const frame = createStableCommunityFrame(window.document, window);
  try {
    frame.render(main, page('checkin'), summary);
    assert.equal(window.history.scrollRestoration, 'manual');
    window.history.replaceState(null, '', '#/notes');
    frame.render(main, '<p>博客</p>', summary);
    assert.equal(window.history.scrollRestoration, 'auto');
  } finally { frame.dispose(); window.close(); }
});
test('right rail data updates in place and leaving the community restores the header', () => {
  const { window } = new JSDOM(`<header id="site-header">${header}</header><main id="main"></main>`, { url: 'http://localhost/?layout=stable#/community/home' });
  const main = window.document.getElementById('main')!;
  const frame = createStableCommunityFrame(window.document, window);
  frame.render(main, page('home'), summary);
  const right = main.querySelector('[data-frame-right]');
  frame.sync(summary.replace('22', '23'));
  assert.equal(main.querySelector('[data-frame-right]'), right);
  assert.equal(right?.querySelector('dd')?.textContent, '23');
  window.history.replaceState(null, '', '#/notes');
  assert.equal(frame.render(main, '<p>博客</p>', summary), false);
  assert.equal(window.document.body.classList.contains('community-frame-open'), false);
  assert.equal(window.document.querySelector('[data-community-frame]'), null);
  frame.dispose(); window.close();
});

test('post support cards move into the right rail, retain handlers and replace stale cards on repaint or navigation', async () => {
  const { composeCommunityStyles } = await import('../../scripts/compose-community-styles.mjs');
  const { window } = new JSDOM(`<style>${await composeCommunityStyles()}</style><main></main>`, { url: 'http://localhost:4213/#/post/first' });
  const document = window.document, main = document.querySelector('main')!;
  const frame = createStableCommunityFrame(document, window);
  try {
    frame.render(main, postPage('作者甲'), summary);
    const right = main.querySelector('[data-frame-right]')!;
    const side = right.querySelector('.community-post-side');
    assert.ok(side, 'post cards replace the generic right-rail contents');
    assert.equal(frame.center()!.querySelector('.community-post-side'), null);
    assert.equal(right.querySelector<HTMLElement>('[data-frame-overview]')!.hidden, true);
    assert.equal(right.querySelector<HTMLElement>('[data-frame-hot]')!.hidden, true);
    assert.equal(window.getComputedStyle(right.querySelector('[data-frame-overview]')!).display, 'none');
    assert.equal(window.getComputedStyle(right.querySelector('[data-frame-hot]')!).display, 'none');
    const follow = side.querySelector<HTMLButtonElement>('[data-action="community-follow"]')!;
    let clicks = 0;
    follow.addEventListener('click', () => clicks++);
    follow.focus();
    frame.sync(summary);
    assert.equal(right.querySelector('.community-post-side'), side);
    assert.equal(document.activeElement, follow);
    follow.click();
    assert.equal(clicks, 1);
    frame.render(main, postPage('更新后的作者甲'), summary);
    assert.equal(main.querySelector('[data-frame-right]'), right);
    assert.equal(main.querySelectorAll('.community-post-side').length, 1);
    assert.match(right.textContent!, /更新后的作者甲/);
    assert.ok(!side.isConnected, 'repainting removes the previous author and prompt nodes');
    window.history.replaceState(null, '', '#/post/second');
    frame.render(main, '<section data-community="post"><div class="community-status">加载中</div></section>', summary);
    assert.equal(right.querySelector('.community-post-side'), null, 'loading another post never shows stale author information');
    frame.render(main, postPage('作者乙'), summary);
    assert.match(right.querySelector('.community-author-card')!.textContent!, /作者乙/);
    window.history.replaceState(null, '', '#/community/home');
    frame.render(main, page('home'), summary);
    assert.equal(right.querySelector('.community-post-side'), null);
    assert.equal(right.querySelector<HTMLElement>('[data-frame-overview]')!.hidden, false);
    assert.equal(right.querySelector<HTMLElement>('[data-frame-hot]')!.hidden, false);
    assert.notEqual(window.getComputedStyle(right.querySelector('[data-frame-overview]')!).display, 'none');
  } finally { frame.dispose(); window.close(); }
});
test('non-community routes and the completed landing page stay outside the reading frame', () => {
  for (const url of ['http://localhost/#/notes', 'https://www.sansphase.com/#/home', 'http://localhost/#/community']) {
    const { window } = new JSDOM('<main id="main">原版</main>', { url });
    const frame = createStableCommunityFrame(window.document, window);
    const main = window.document.getElementById('main')!;
    assert.equal(frame.render(main, page('home'), summary), false);
    assert.equal(main.textContent, '原版'); window.close();
  }
});

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} scroll pauses decorative motion until idle without replacing content`, t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { window } = new JSDOM('<main></main>', { url: 'http://localhost/#/community/u/10001/badges' });
  Object.defineProperty(window, 'matchMedia', { value: (query: string) => ({ matches: mobile && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }) });
  const frame = createStableCommunityFrame(window.document, window);
  try {
    frame.render(window.document.querySelector('main')!, page('member'), summary);
    const root = window.document.querySelector<HTMLElement>('[data-community-frame]')!;
    const content = root.querySelector('[data-frame-route]')!.firstElementChild;
    const host = mobile ? window.document.documentElement : frame.center()!;
    const state = () => window.document.body.style.getPropertyValue('--community-decoration-play-state');
    host.dispatchEvent(new window.Event('scroll'));
    assert.equal(state(), '', 'unchanged position does not pause decoration');
    host.scrollTop = 100; host.dispatchEvent(new window.Event('scroll'));
    assert.equal(state(), 'paused');
    assert.equal(root.style.getPropertyValue('--community-decoration-play-state'), '', 'header and content inherit the same body pause instead of separate scopes');
    t.mock.timers.tick(500);
    host.scrollTop = 200; host.dispatchEvent(new window.Event('scroll'));
    t.mock.timers.tick(599); assert.equal(state(), 'paused');
    t.mock.timers.tick(1); assert.equal(state(), '');
    assert.equal(root.querySelector('[data-frame-route]')!.firstElementChild, content);
    assert.equal(host.scrollTop, 200);
    host.scrollTop = 300; host.dispatchEvent(new window.Event('scroll'));
    frame.dispose();
    assert.equal(state(), '', 'leaving the frame clears paused motion');
    t.mock.timers.tick(600); assert.equal(state(), '');
  } finally { frame.dispose(); window.close(); }
});

test('the center scrollbar starts hidden, shows on scrolling and hides five seconds after the last movement', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { window } = new JSDOM(`<main id="main"></main>`, { url: 'http://localhost:4213/#/community/home' });
  const frame = createStableCommunityFrame(window.document, window);
  try {
    frame.render(window.document.getElementById('main')!, page('home'), summary);
    const center = frame.center()!;
    assert.equal(center.dataset.frameScrolling, undefined);
    center.focus({ preventScroll: true });
    center.dispatchEvent(new window.Event('scroll'));
    window.document.querySelector('[data-frame-right]')!.dispatchEvent(new window.Event('scroll'));
    assert.equal(center.dataset.frameScrolling, undefined, 'focus, unchanged position and right-rail scrolling do not reveal the center scrollbar');
    center.scrollTop = 120;
    center.dispatchEvent(new window.Event('scroll'));
    assert.equal(center.dataset.frameScrolling, 'true');
    t.mock.timers.tick(4999);
    assert.equal(center.dataset.frameScrolling, 'true');
    t.mock.timers.tick(1);
    assert.equal(center.dataset.frameScrolling, undefined);
    center.scrollTop = 240;
    center.dispatchEvent(new window.Event('scroll'));
    t.mock.timers.tick(4000);
    center.scrollTop = 200; // Scrolling back up also counts as activity.
    center.dispatchEvent(new window.Event('scroll'));
    t.mock.timers.tick(4999);
    assert.equal(center.dataset.frameScrolling, 'true', 'the last movement resets the five-second delay');
    t.mock.timers.tick(1);
    assert.equal(center.dataset.frameScrolling, undefined);
    assert.equal(center.scrollTop, 200, 'hiding the control does not alter the reading position');
  } finally { frame.dispose(); window.close(); }
});

test('route restoration does not reveal the scrollbar and disposing the frame removes its timer and activity state', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { window } = new JSDOM('<main id="main"></main>', { url: 'http://localhost:4213/#/community/home' });
  const main = window.document.getElementById('main')!;
  const frame = createStableCommunityFrame(window.document, window);
  try {
    frame.render(main, page('home'), summary);
    const center = frame.center()!;
    center.scrollTop = 180;
    center.dispatchEvent(new window.Event('scroll'));
    assert.equal(center.dataset.frameScrolling, 'true');
    window.history.replaceState(null, '', '#/community/boards/qa');
    frame.render(main, page('board'), summary);
    center.dispatchEvent(new window.Event('scroll'));
    assert.equal(center.dataset.frameScrolling, undefined, 'a new board opens with the control hidden');
    window.history.replaceState(null, '', '#/community/home');
    frame.render(main, page('home'), summary);
    center.dispatchEvent(new window.Event('scroll'));
    assert.equal(center.scrollTop, 0);
    assert.equal(center.dataset.frameScrolling, undefined, 'route resets are not user scrolling');
    center.scrollTop = 240;
    center.dispatchEvent(new window.Event('scroll'));
    assert.equal(center.dataset.frameScrolling, 'true');
    frame.dispose();
    assert.equal(center.dataset.frameScrolling, undefined);
    center.scrollTop = 300;
    center.dispatchEvent(new window.Event('scroll'));
    t.mock.timers.tick(5000);
    assert.equal(center.dataset.frameScrolling, undefined, 'a disposed frame no longer handles scroll events');
    frame.render(main, page('home'), summary);
    assert.equal(frame.center()!.dataset.frameScrolling, undefined);
  } finally { frame.dispose(); window.close(); }
});

test('the combined style cascade gives long center pages natural height inside the scroll viewport', async () => {
  const base = await readFile(new URL('../../src/community.css', import.meta.url), 'utf8');
  const feed = (await readFile(new URL('../../src/community-layout/feed.css', import.meta.url), 'utf8')).replaceAll('.community-page[data-community="home"][data-home-design="feed"]', ':is(.community-page[data-community="home"][data-home-design="feed"], [data-community-frame])');
  const stable = await readFile(new URL('../../src/community-layout/stable-frame.css', import.meta.url), 'utf8');
  const { window } = new JSDOM(`<style>${base}\n${feed}\n${stable}</style><main id="main"></main>`, { url: 'http://localhost/?layout=stable#/community/boards/showcase' });
  const frame = createStableCommunityFrame(window.document, window);
  frame.render(window.document.getElementById('main')!, '<section class="page community-page" data-community="board"><header class="community-board-hero"><h1>作品展廊</h1></header><div class="community-layout"><div class="community-main">长列表</div></div></section>', summary);
  const viewport = window.getComputedStyle(frame.center()!);
  assert.equal(viewport.display, 'block', 'a constrained grid viewport can compress an overflowing child grid header');
  assert.equal(viewport.overflow, 'auto');
  assert.equal(viewport.scrollbarWidth, 'auto');
  assert.equal(viewport.scrollbarGutter, 'stable');
  // JSDOM serializes this two-colour property as one computed RGBA value.
  assert.match(viewport.scrollbarColor, /^(transparent transparent|rgba\(0, 0, 0, 0\))$/, 'the initial scrollbar must be invisible without changing its gutter');
  assert.equal(viewport.overflowAnchor, 'none');
  const aside = window.getComputedStyle(window.document.querySelector('[data-frame-right]')!);
  assert.equal(aside.overflow, 'auto');
  assert.equal(aside.scrollbarWidth, 'none');
  assert.equal(window.getComputedStyle(window.document.documentElement).scrollbarWidth, 'auto');
  assert.equal(window.getComputedStyle(window.document.documentElement).scrollbarGutter, 'stable');
  frame.dispose();
  assert.equal(window.document.documentElement.classList.contains('community-frame-document'), false);
  window.close();
});

test('community center routes retain inner cards and alignment, with compact spacing only below a visible carousel', async () => {
  const { composeCommunityStyles } = await import('../../scripts/compose-community-styles.mjs');
  // Resolve the visual tokens because JSDOM does not resolve inherited variables.
  const css = (await composeCommunityStyles()).replaceAll('var(--feed-edge)', '#a8bfd7').replaceAll('var(--feed-radius)', '18px').replaceAll('var(--line)', '#a8bfd7');
  for (const [view, hash] of [['member', '#/community/u/10001'], ['post', '#/post/example'], ['checkin', '#/community/checkin'], ['shop', '#/community/shop'], ['home', '#/community/home'], ['board', '#/community/boards/qa']]) {
    const { window } = new JSDOM(`<style>${css}</style><main></main>`, { url: `http://localhost:4213/${hash}` });
    const frame = createStableCommunityFrame(window.document, window);
    try {
      frame.render(window.document.querySelector('main')!, `<section class="page community-page" data-community="${view}"><header class="community-m-hero">个人资料</header><div class="community-me-quick"><a href="#/community/checkin">签到</a></div><section class="community-card">保留的小卡片</section></section>`, summary);
      const route = window.getComputedStyle(window.document.querySelector('[data-frame-route]')!);
      assert.equal(route.borderWidth, '0px', `${view} has no enclosing border`);
      assert.equal(parseFloat(route.borderRadius), 0);
      assert.equal(route.backgroundImage, 'none');
      assert.equal(route.backgroundColor, 'rgba(0, 0, 0, 0)');
      assert.equal(route.boxShadow, 'none');
      assert.equal(route.padding, `${view === 'home' || view === 'board' ? 8 : 28}px 28px 4px`, 'horizontal alignment is retained and only the carousel gap is reduced');
      const card = window.getComputedStyle(window.document.querySelector('[data-frame-route] .community-card')!);
      assert.equal(card.borderTopWidth, '1px', 'only the enclosing panel is removed');
      assert.ok(parseFloat(card.borderRadius) > 0);
      const hero = window.getComputedStyle(window.document.querySelector('.community-m-hero')!);
      assert.equal(hero.borderTopWidth, '1px');
      assert.equal(hero.borderRadius, '24px');
      assert.equal(window.getComputedStyle(window.document.querySelector('.community-me-quick a')!).borderRadius, '14px');
    } finally { frame.dispose(); window.close(); }
  }
});

test('discussion separators use a single two-pixel rule in the shared blog-frame colour', async () => {
  const { composeCommunityStyles } = await import('../../scripts/compose-community-styles.mjs');
  // Resolve the custom property here because JSDOM does not resolve inherited CSS variables.
  const css = (await composeCommunityStyles()).replaceAll('var(--feed-row-line)', '#a8bfd7');
  const { window } = new JSDOM(`<style>${css}</style><main></main>`, { url: 'http://localhost:4213/#/community/u/10001' });
  const frame = createStableCommunityFrame(window.document, window);
  try {
    frame.render(window.document.querySelector('main')!, '<section class="page community-page" data-community="member"><div class="community-topics"><article class="community-topic">帖子一</article><article class="community-topic">帖子二</article></div></section>', summary);
    const list = window.getComputedStyle(window.document.querySelector('.community-topics')!);
    assert.equal(list.borderTopWidth, '2px');
    assert.equal(list.borderTopColor, 'rgb(168, 191, 215)');
    for (const row of window.document.querySelectorAll('.community-topic')) {
      const style = window.getComputedStyle(row);
      assert.equal(style.borderTopWidth, '0px', 'adjacent posts do not double up their separator');
      assert.equal(style.borderBottomWidth, '2px');
      assert.equal(style.borderBottomColor, list.borderTopColor);
      assert.equal(style.backgroundImage, 'none');
      assert.equal(style.backgroundColor, 'rgba(0, 0, 0, 0)');
    }
  } finally { frame.dispose(); window.close(); }
});

test('keyboard route focus marks an active scrollbar without revealing it while idle or framing the content', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { composeCommunityStyles } = await import('../../scripts/compose-community-styles.mjs');
  // JSDOM does not invalidate computed styles for focus modality changes.
  const css = (await composeCommunityStyles()).replaceAll(':focus-visible', '.test-keyboard-focus').replaceAll(':focus', '.test-focus');
  const { window } = new JSDOM(`<style>${css}</style><main id="main"></main>`, { url: 'http://localhost/#/community/boards/showcase' });
  const frame = createStableCommunityFrame(window.document, window);
  try {
    frame.render(window.document.getElementById('main')!, page('board'), summary);
    const center = frame.center()!;
    const resting = window.getComputedStyle(center).scrollbarColor;
    center.scrollTop = 240;
    center.focus({ preventScroll: true }); // Same target as app.mjs after Escape/back navigation.
    center.classList.add('test-focus', 'test-keyboard-focus');
    assert.equal(window.document.activeElement, center);
    assert.equal(center.scrollTop, 240);
    const focused = window.getComputedStyle(center);
    assert.equal(focused.outline, 'none');
    assert.equal(focused.boxShadow, 'none', 'a reading viewport must not acquire a large gold frame');
    assert.equal(focused.scrollbarColor, resting, 'route focus alone must not reveal the control');
    center.dispatchEvent(new window.Event('scroll'));
    assert.notEqual(window.getComputedStyle(center).scrollbarColor, resting, 'keyboard scrolling retains visible focus feedback on the active control');
    t.mock.timers.tick(5000);
    assert.equal(window.getComputedStyle(center).scrollbarColor, resting, 'remaining focused does not prevent the idle control from hiding');
  } finally { frame.dispose(); window.close(); }
});
