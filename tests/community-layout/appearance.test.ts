import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import postcss from 'postcss';
import { createCommunityAppearance } from '../../src/community-layout/appearance.ts';
import { checkinStarsHTML } from '../../src/community-checkin-stars.ts';

interface TestWindow extends Window { }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => { window: TestWindow };
};
const icons = { sun: '<svg data-test-sun></svg>', moon: '<svg data-test-moon></svg>' };
const t = (zh: string, _en: string) => zh;

test('the paper star map uses an open pale haze and theme-driven lines while keeping day anchors', async () => {
  const css = postcss.parse(await readFile(new URL('../../src/community-layout/appearance.css', import.meta.url), 'utf8'));
  const rules = new Map<string, Map<string, string>>();
  css.walkRules(rule => {
    const declarations = new Map<string, string>();
    rule.walkDecls(declaration => { declarations.set(declaration.prop, declaration.value); });
    rules.set(rule.selector, declarations);
  });
  const prefix = 'body.community-open:is(.community-frame-open, .community-management-open)[data-community-theme="light"]';
  assert.equal(rules.get(`${prefix} .community-star-map`)?.get('background'), 'none');
  const haze = rules.get(`${prefix} .community-star-map::before`)!;
  assert.doesNotMatch(haze.get('background')!, /url\(/);
  assert.match(haze.get('mask-image')!, /transparent 100%/);
  assert.ok(rules.get(`${prefix} .community-star-map .community-cs`)?.has('color'));
  assert.ok(rules.get(`${prefix} .community-star-map .community-cs:is(.is-on, .is-now)`)?.has('color'));
  const { window } = new JSDOM(checkinStarsHTML({ month: '2026-10', today: '2026-10-05', days: ['2026-10-01'] }, t), { url: 'http://localhost/' });
  const nodes = window.document.querySelectorAll('.community-cs');
  assert.equal(nodes.length, 31);
  assert.match(nodes[4].getAttribute('style')!, /--star-x:12%;--star-y:70%/);
  assert.match(window.document.querySelector('stop')!.getAttribute('stop-color')!, /var\(--checkin-link-idle/);
  window.close();
});
function fixture(query = '') {
  const { window } = new JSDOM('<header></header><main><div data-frame-center><textarea>未发布的草稿</textarea></div></main>', { url: `http://localhost:4214/${query}#/community/checkin` });
  return { window, document: window.document };
}

test('each new community document starts light despite legacy dark links and preferences', () => {
  const { window, document } = fixture('?communityTheme=dark');
  window.localStorage.setItem('sansphase-community-study-theme', 'dark');
  window.localStorage.setItem('sansphase-theme', 'dark');
  const appearance = createCommunityAppearance(document, window);
  appearance.sync(true);
  assert.equal(document.body.dataset.communityTheme, 'light');
  assert.equal(window.localStorage.getItem('sansphase-theme'), 'dark');
  assert.equal(window.localStorage.getItem('sansphase-community-study-theme'), 'dark', 'obsolete community preferences are neither adopted nor rewritten');
  appearance.sync(false);
  assert.equal(document.body.dataset.communityTheme, undefined);
  window.close();
});

test('switching changes presentation in place and retains the draft, focus, route and reading position', () => {
  const { window, document } = fixture('?communityTheme=dark&v=genshin-light-2');
  const appearance = createCommunityAppearance(document, window);
  appearance.sync(true);
  document.querySelector('header')!.innerHTML = appearance.buttonHTML(t, icons);
  const button = document.querySelector<HTMLButtonElement>('[data-action="community-theme-toggle"]')!;
  const center = document.querySelector<HTMLElement>('[data-frame-center]')!;
  const editor = document.querySelector<HTMLTextAreaElement>('textarea')!;
  center.scrollTop = 360;
  const initialHref = window.location.href;
  button.focus();
  appearance.toggle();
  assert.equal(document.body.dataset.communityTheme, 'dark');
  assert.equal(document.querySelector('textarea'), editor);
  assert.equal(editor.value, '未发布的草稿');
  assert.equal(center.scrollTop, 360);
  assert.equal(document.activeElement, button);
  assert.equal(window.location.hash, '#/community/checkin');
  assert.equal(new URL(window.location.href).searchParams.get('v'), 'genshin-light-2');
  assert.equal(window.location.href, initialHref, 'a presentation toggle does not encode a startup preference in the URL');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.getAttribute('aria-label'), '切换为明亮模式');
  assert.ok(button.querySelector('[data-test-moon]'));
  assert.equal(window.localStorage.getItem('sansphase-community-study-theme'), null, 'a manual choice lasts for this document only');
  appearance.toggle();
  assert.equal(document.body.dataset.communityTheme, 'light');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.ok(button.querySelector('[data-test-sun]'));
  window.close();
});

test('a manual theme choice survives community route and language updates; leaving the area removes only its own appearance', () => {
  const { window, document } = fixture();
  window.localStorage.setItem('sansphase-community-study-theme', 'light');
  document.body.classList.add('theme-light');
  document.body.dataset.communityTheme = 'external';
  const appearance = createCommunityAppearance(document, window);
  appearance.sync(true);
  assert.equal(document.body.dataset.communityTheme, 'light');
  appearance.toggle();
  window.location.hash = '#/community/new/showcase';
  appearance.sync(true);
  assert.equal(document.body.dataset.communityTheme, 'dark');
  assert.match(appearance.buttonHTML((_zh, en) => en, icons), /Use light mode/);
  appearance.sync(false);
  assert.equal(document.body.dataset.communityTheme, 'external');
  assert.equal(document.body.classList.contains('theme-light'), true);
  appearance.sync(true);
  assert.equal(document.body.dataset.communityTheme, 'dark');
  window.close();
});

test('a manual dark choice follows every community and management route in the same document', () => {
  const { window, document } = fixture();
  const appearance = createCommunityAppearance(document, window);
  appearance.sync(true);
  appearance.toggle();
  for (const route of ['home', 'boards/qa', 'checkin', 'manage', 'manage/items']) {
    window.location.hash = `#/community/${route}`;
    appearance.sync(true);
    assert.equal(document.body.dataset.communityTheme, 'dark', `${route} keeps the current document's manual dark choice`);
    assert.match(appearance.buttonHTML(t, icons), /aria-pressed="false"/);
  }
  const reopened = fixture(new URL(window.location.href).search);
  reopened.window.location.hash = '#/community/manage/items';
  const fresh = createCommunityAppearance(reopened.document, reopened.window);
  fresh.sync(true);
  assert.equal(reopened.document.body.dataset.communityTheme, 'light', 'a fresh management document starts light');
  window.close();
  reopened.window.close();
});

test('unavailable local storage and history never prevent the default or manual theme from displaying', () => {
  const { window, document } = fixture('?communityTheme=light');
  const unavailable = { location: window.location, get localStorage(): Storage { throw new Error('Storage blocked'); } };
  const appearance = createCommunityAppearance(document, unavailable);
  appearance.sync(true);
  assert.equal(document.body.dataset.communityTheme, 'light');
  assert.doesNotThrow(() => appearance.toggle());
  assert.equal(document.body.dataset.communityTheme, 'dark');
  window.close();
});

test('reopening or refreshing after a dark choice starts light without an intermediate dark paint', () => {
  const first = fixture('?communityTheme=dark');
  const appearance = createCommunityAppearance(first.document, first.window);
  appearance.sync(true);
  appearance.toggle();
  assert.equal(first.document.body.dataset.communityTheme, 'dark');
  const reopened = fixture(new URL(first.window.location.href).search);
  reopened.window.localStorage.setItem('sansphase-community-study-theme', 'dark');
  const changes = new reopened.window.MutationObserver(() => {});
  changes.observe(reopened.document.body, { attributes: true, attributeFilter: ['data-community-theme'], attributeOldValue: true });
  const fresh = createCommunityAppearance(reopened.document, reopened.window);
  fresh.sync(true);
  assert.equal(reopened.document.body.dataset.communityTheme, 'light');
  const paints = changes.takeRecords();
  assert.equal(paints.length, 1, 'startup applies its light theme once, with no intermediate dark theme');
  assert.equal(paints[0].oldValue, null);
  changes.disconnect();
  first.window.close();
  reopened.window.close();
});

test('the composed light cascade retains dark ink in selected filters, ranks, links and editor surfaces', async () => {
  const { composeCommunityStyles } = await import('../../scripts/compose-community-styles.mjs');
  const tokens = new Map<string, string>();
  for (const [file, selector] of [['stable-frame.css', 'body.community-open:is(.community-frame-open, .community-management-open)'], ['appearance.css', 'body.community-open:is(.community-frame-open, .community-management-open)[data-community-theme="light"]']]) {
    postcss.parse(await readFile(new URL(`../../src/community-layout/${file}`, import.meta.url), 'utf8')).walkRules(selector, rule => {
      if (rule.parent?.type !== 'root') return;
      rule.walkDecls(declaration => { tokens.set(declaration.prop, declaration.value); });
    });
  }
  // JSDOM doesn't resolve inherited variables. Resolve base theme tokens solely
  // for these components; the real browser still uses scoped variables.
  let css = (await composeCommunityStyles()).replaceAll(':hover', '.test-hover').replaceAll(':focus-within', '.test-field-focus');
  for (let step = 0; step < 8; step++) css = css.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (match: string, name: string, fallback: string | undefined) => tokens.get(name) ?? fallback ?? match);
  const { window } = new JSDOM(`<style>${css}</style><body class="community-open community-frame-open" data-community-theme="light"><section class="page community-page" data-community-frame="stable"><div class="community-sort-tabs"><button aria-pressed="true">最新回复</button></div><span class="community-hot-rank is-top">01</span><a class="community-feed-rail-compose">发布讨论</a><article class="community-topic"><h3><a class="test-hover">标题</a></h3></article><div class="community-editor test-field-focus"><textarea></textarea></div><div class="community-account-menu">账号<div class="community-ac-top"><a class="community-uname is-color-aurora test-hover">极光昵称</a></div></div><ol class="community-rank"><li class="is-me"><a class="community-uname is-color-gold">星光金昵称</a></li></ol></section></body>`, { url: 'http://localhost:4214/?communityTheme=light#/community/home' });
  try {
    const computed = (selector: string) => window.getComputedStyle(window.document.querySelector(selector)!);
    window.document.querySelector('section')!.insertAdjacentHTML('beforeend', `
      <aside class="community-feed-rail"><nav class="nav"><a><svg class="community-feed-nav-icon"></svg>首页</a></nav><div class="community-frame-boards"><a><svg class="community-frame-board-icon"></svg>学习问答</a></div></aside>
      <div class="community-ck-pill"><span>今天还没签到</span><button class="community-button is-small is-gold"><svg class="ui-icon"></svg>签到</button></div>
      <article class="community-topic"><div class="community-feed-byline"><span class="community-who"><a class="community-uname">读者名字</a><span class="community-lv">观测</span></span></div>
        <p class="community-topic-meta"><a class="community-tag" data-tag-tone="tool">本地模型</a><a class="community-tag" data-tag-tone="method">工作流</a><a class="community-tag" data-tag-tone="creative">视频生成</a><a class="community-tag" data-tag-tone="guide">效率</a></p>
        <a class="community-topic-replies"><small><svg class="ui-icon"></svg>6 赞</small><span><svg class="ui-icon"></svg>2</span></a></article>
      <button class="community-button is-good test-hover">确认</button><button class="community-button is-danger test-hover">删除</button>
    `);
    assert.equal(computed('.community-sort-tabs button').color, 'rgb(87, 66, 33)', 'a selected filter retains readable selected ink');
    assert.equal(computed('.community-hot-rank').color, 'rgb(120, 95, 62)');
    assert.equal(computed('.community-topic h3 a').color, 'rgb(38, 54, 78)', 'hover must not turn a title white on paper');
    assert.equal(computed('.community-feed-rail-compose').color, 'rgb(92, 73, 49)');
    assert.equal(computed('.community-editor').backgroundColor, 'rgb(248, 244, 236)');
    assert.equal(computed('.community-editor').borderColor, 'rgb(120, 95, 62)');
    assert.equal(computed('.community-editor textarea').borderWidth, '0px', 'the compound editor retains only its outer focus border');
    assert.equal(computed('.community-account-menu').backdropFilter, 'none');
    assert.equal(computed('.community-feed-nav-icon').width, '22px');
    assert.equal(computed('.community-frame-board-icon').width, '22px');
    assert.equal(computed('.community-feed-byline .community-uname').fontSize, '16px');
    assert.equal(computed('.community-feed-byline .community-lv').backgroundColor, 'rgb(226, 221, 207)', 'byline marks keep their light backing');
    assert.equal(computed('.community-ck-pill .community-button').height, '36px', 'the old pill rule must not shrink the check-in control');
    assert.equal(computed('.community-ck-pill .community-button').fontSize, '14px');
    assert.equal(computed('.community-ck-pill .community-button').color, 'rgb(88, 67, 39)');
    assert.equal(computed('.community-ck-pill .ui-icon').width, '18px');
    assert.equal(computed('.community-topic-replies .ui-icon').width, '22px');
    assert.equal(computed('.community-topic-replies .ui-icon').display, 'block');
    for (const [tone, colour] of [['tool', 'rgb(219, 227, 234)'], ['method', 'rgb(212, 226, 221)'], ['creative', 'rgb(227, 220, 234)'], ['guide', 'rgb(232, 221, 200)']]) {
      assert.equal(computed(`.community-topic-meta [data-tag-tone="${tone}"]`).backgroundColor, colour, `${tone} fill must survive the feed override`);
    }
    assert.equal(computed('.community-button.is-good').backgroundColor, 'rgb(216, 230, 218)', 'neutral hover must retain positive feedback');
    assert.equal(computed('.community-button.is-danger').backgroundColor, 'rgb(239, 217, 212)', 'neutral hover must retain destructive feedback');
    for (const selector of ['.is-color-gold', '.is-color-aurora']) {
      const style = computed(selector);
      assert.match(style.backgroundImage, /linear-gradient/);
      assert.equal(style.backgroundClip, 'text', 'nickname finishes stay clipped to their glyphs');
      assert.equal(style.getPropertyValue('-webkit-text-fill-color'), 'rgba(0, 0, 0, 0)', 'account, rank and hover ink cannot cover the nickname gradient');
    }
  } finally { window.close(); }
});
