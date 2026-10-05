import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import postcss from 'postcss';
import { createStableCommunityFrame } from '../../src/community-layout/stable-frame.ts';

interface TestWindow extends Window { close(): void; Event: typeof Event }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: TestWindow } };
const header = '<header id="site-header" class="community-header"><div class="community-brand-group">社区</div><nav id="navigation" class="nav community-nav"><a href="#/community/home">首页</a><a href="#/community/checkin">签到</a></nav><div class="header-actions"><button class="menu-button">菜单</button></div></header>';
const summary = '<div class="community-banner-side"><dl class="community-stats"><dd>22</dd></dl><div class="community-ck-pill"><button data-action="community-checkin">签到</button></div></div>';
const content = '<section class="community-page" data-community="compose"><form><textarea>未发布的草稿</textarea></form></section>';

function viewport(window: TestWindow) {
  let width = 1600;
  const queries = new Map<string, { matches: boolean; listeners: Set<EventListenerOrEventListenerObject> }>();
  const matches = (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return Boolean(max && width <= Number(max[1]));
  };
  window.matchMedia = (query: string) => {
    if (!queries.has(query)) queries.set(query, { matches: matches(query), listeners: new Set() });
    const entry = queries.get(query)!;
    return {
      get matches() { return entry.matches; }, media: query, onchange: null,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => { if (listener) entry.listeners.add(listener); },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => { if (listener) entry.listeners.delete(listener); },
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
    };
  };
  return (next: number) => {
    width = next;
    const changed = [...queries].filter(([query, entry]) => entry.matches !== matches(query));
    // Browsers update all query states before dispatching the change events.
    for (const [query, entry] of changed) entry.matches = matches(query);
    for (const [, entry] of changed) for (const listener of [...entry.listeners]) {
      const event = new Event('change');
      if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
    }
  };
}

test('resizing retains the draft, navigation and a single usable check-in action', () => {
  const { window } = new JSDOM(`${header}<main></main>`, { url: 'http://localhost:4212/#/community/new/qa' });
  const resize = viewport(window), document = window.document;
  const frame = createStableCommunityFrame(document, window);
  frame.render(document.querySelector('main')!, content, summary);
  const form = document.querySelector('form'), nav = document.getElementById('navigation');
  const button = document.querySelector<HTMLButtonElement>('[data-action="community-checkin"]')!;
  let clicks = 0;
  button.addEventListener('click', () => clicks++);
  frame.center()!.scrollTop = 260;
  frame.center()!.dispatchEvent(new window.Event('scroll'));
  for (const width of [1240, 1100, 1000, 800, 701, 700, 390, 800, 1100, 1600]) {
    if (width === 700) frame.center()!.scrollTop = 0; // CSS removes the old scrolling box before the media event.
    resize(width);
    assert.equal(document.querySelector('form'), form, `draft survives at ${width}`);
    assert.equal(document.getElementById('navigation'), nav);
    assert.equal(document.querySelectorAll('[data-action="community-checkin"]').length, 1);
    assert.equal(document.querySelector('[data-action="community-checkin"]'), button);
    assert.ok(button.closest(width <= 1240 ? '[data-frame-checkin]' : '[data-frame-right]'), `check-in location at ${width}`);
    assert.ok(nav?.closest(width <= 700 ? '#site-header' : '.community-feed-rail'), `navigation location at ${width}`);
    assert.equal(width <= 700 ? document.documentElement.scrollTop : frame.center()!.scrollTop, 260, `reading position at ${width}`);
    frame.sync(summary); // Normal data refresh cannot re-add a duplicate in the hidden rail.
    button.click();
  }
  assert.equal(clicks, 10);
  assert.equal(frame.center()!.scrollTop, 260, 'returning from mobile retains the reading position');
  resize(1000);
  frame.sync(summary.replace('<button data-action="community-checkin">签到</button>', '<a href="#/community/checkin">已签到</a>'));
  assert.match(document.querySelector('[data-frame-checkin]')!.textContent!, /已签到/);
  assert.equal(document.querySelector('[data-action="community-checkin"]'), null);
  resize(1600);
  assert.match(document.querySelector('[data-frame-right]')!.textContent!, /已签到/);
  frame.dispose(); resize(390); window.close();
});

test('scrollbar activity follows the active center or document scroll host without leaking across mobile breakpoints', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { window } = new JSDOM(`${header}<main></main>`, { url: 'http://localhost:4213/#/community/home' });
  const resize = viewport(window), document = window.document;
  const frame = createStableCommunityFrame(document, window);
  try {
    frame.render(document.querySelector('main')!, content, summary);
    const center = frame.center()!;
    const root = document.documentElement;
    center.scrollTop = 260;
    center.dispatchEvent(new window.Event('scroll'));
    assert.equal(center.dataset.frameScrolling, 'true');
    resize(390);
    assert.equal(center.dataset.frameScrolling, undefined);
    document.dispatchEvent(new window.Event('scroll'));
    assert.equal(root.dataset.frameScrolling, undefined, 'breakpoint restoration does not reveal the document scrollbar');
    root.scrollTop = 320;
    document.dispatchEvent(new window.Event('scroll'));
    assert.equal(root.dataset.frameScrolling, 'true');
    assert.equal(center.dataset.frameScrolling, undefined);
    t.mock.timers.tick(5000);
    assert.equal(root.dataset.frameScrolling, undefined);
    root.scrollTop = 360;
    document.dispatchEvent(new window.Event('scroll'));
    assert.equal(root.dataset.frameScrolling, 'true');
    resize(1600);
    assert.equal(root.dataset.frameScrolling, undefined);
    assert.equal(center.scrollTop, 360);
    center.dispatchEvent(new window.Event('scroll'));
    assert.equal(center.dataset.frameScrolling, undefined);
    center.scrollTop = 400;
    center.dispatchEvent(new window.Event('scroll'));
    assert.equal(center.dataset.frameScrolling, 'true');
    frame.dispose();
    assert.equal(center.dataset.frameScrolling, undefined);
    assert.equal(root.dataset.frameScrolling, undefined);
  } finally { frame.dispose(); window.close(); }
});

test('post information follows the visible rail and retains original controls, focus and reply draft when resizing', () => {
  const { window } = new JSDOM(`${header}<main></main>`, { url: 'http://localhost:4213/#/post/example' });
  const resize = viewport(window), document = window.document;
  const frame = createStableCommunityFrame(document, window);
  try {
    frame.render(document.querySelector('main')!, '<section data-community="post"><div class="community-post-grid"><article class="community-thread"><form><textarea>回复草稿</textarea></form></article><aside class="community-post-side"><section class="community-card"><button data-action="community-follow">关注</button></section></aside></div></section>', summary);
    const side = document.querySelector('.community-post-side')!;
    const follow = side.querySelector<HTMLButtonElement>('button')!;
    const draft = document.querySelector('textarea');
    let clicks = 0;
    follow.addEventListener('click', () => clicks++);
    follow.focus();
    for (const width of [1240, 800, 390, 1600, 1241]) {
      resize(width);
      assert.ok(side.closest(width <= 1240 ? '[data-frame-center]' : '[data-frame-right]'), `post information stays accessible at ${width}`);
      assert.equal(document.querySelectorAll('.community-post-side').length, 1);
      assert.equal(document.activeElement, follow);
      assert.equal(document.querySelector('textarea'), draft);
      assert.equal(draft!.value, '回复草稿');
      assert.equal(document.querySelector<HTMLElement>('[data-frame-checkin]')!.hidden, true, 'post routes do not reintroduce generic activity controls');
      follow.click();
    }
    assert.equal(clicks, 5);
  } finally { frame.dispose(); window.close(); }
});

test('the formal stylesheet cascade collapses right first, narrows left next, and keeps center until mobile', async () => {
  const files = ['styles-foundation.css', 'styles-reading.css', 'styles-content.css', 'styles-blog.css', 'styles-controls.css'];
  const { composeCommunityStyles } = await import('../../scripts/compose-community-styles.mjs');
  const css = (await Promise.all(files.map(file => readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8')))).join('\n') + '\n' + await composeCommunityStyles();
  for (const width of [1600, 1241, 1240, 1100, 1000, 900, 800, 701, 700, 390, 320]) {
    const sheet = postcss.parse(css);
    sheet.walkAtRules('media', rule => {
      const max = /max-width:\s*(\d+)px/.exec(rule.params), min = /min-width:\s*(\d+)px/.exec(rule.params);
      if ((!max && !min) || (max && width > Number(max[1])) || (min && width < Number(min[1]))) rule.remove();
      else rule.replaceWith(...rule.nodes!);
    });
    sheet.walkAtRules('container', rule => { rule.remove(); });
    const { window } = new JSDOM(`<style>${sheet}</style>${header}<main></main>`, { url: 'http://localhost:4212/#/community/new/qa' });
    const resize = viewport(window); resize(width);
    const frame = createStableCommunityFrame(window.document, window);
    frame.render(window.document.querySelector('main')!, content, summary);
    const layout = window.getComputedStyle(window.document.querySelector('[data-community-frame] > .community-layout')!);
    const right = window.getComputedStyle(window.document.querySelector('[data-frame-right]')!);
    if (width > 1240) { assert.equal(layout.gridTemplateColumns, '156px minmax(0, 1fr) 280px'); assert.notEqual(right.display, 'none'); }
    else {
      assert.equal(right.display, 'none', `right must not stack under center at ${width}`);
      if (width > 1000) assert.equal(layout.gridTemplateColumns, '156px minmax(0, 1fr)', `columns at ${width}`);
      else if (width > 700) assert.equal(layout.gridTemplateColumns, '112px minmax(0, 1fr)');
      else assert.equal(layout.display, 'flex');
    }
    const center = window.getComputedStyle(frame.center()!);
    assert.equal(center.overflow, width > 700 ? 'auto' : 'visible');
    if (width > 700) {
      assert.equal(center.gridColumn, '2');
      const nav = window.getComputedStyle(window.document.getElementById('navigation')!);
      assert.equal(nav.zIndex, 'auto', 'left navigation cannot sit behind the page as a mobile overlay');
      assert.equal(nav.display, 'grid');
      assert.equal(window.getComputedStyle(window.document.querySelector('.menu-button')!).display, 'none');
    }
    frame.dispose(); window.close();
  }
});
