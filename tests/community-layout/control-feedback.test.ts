import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { communityComposeHTML } from '../../src/community-post.ts';
import { composeCommunityStyles } from '../../scripts/compose-community-styles.mjs';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window };
};
const light = 'body.community-open:is(.community-frame-open, .community-management-open)[data-community-theme="light"]';
const palettes = {
  light: { fill: 'rgb(220, 199, 163)', ink: 'rgb(87, 66, 33)', edge: 'rgb(147, 113, 73)' },
  dark: { fill: 'rgb(58, 73, 96)', ink: 'rgb(240, 223, 190)', edge: 'rgb(186, 161, 111)' },
};

async function fixture(theme: keyof typeof palettes, content: string) {
  const tokens = new Map<string, string>();
  const source = await composeCommunityStyles();
  postcss.parse(source).walkRules(rule => {
    if (rule.parent?.type !== 'root') return;
    if (!['body.community-open', 'body.community-open:is(.community-frame-open, .community-management-open)', ...(theme === 'light' ? [light] : [])].includes(rule.selector)) return;
    rule.walkDecls(d => { if (d.prop.startsWith('--')) tokens.set(d.prop, d.value); });
  });
  // JSDOM does not resolve inherited custom properties; use the corresponding
  // desktop theme tokens. Component-local artwork palettes are not tested here.
  let css = source.replaceAll(':hover', '.test-hover').replaceAll(':focus-visible', '.test-focus');
  for (let n = 0; n < 10; n++) css = css.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g,
    (match: string, name: string, fallback: string | undefined) => tokens.get(name) ?? fallback ?? match);
  const { window } = new JSDOM(`<style>${css}</style><body class="community-open community-frame-open" data-community-theme="${theme}">${content}</body>`, { url: `http://localhost/?communityTheme=${theme}#/community/new/showcase` });
  return { window, tokens, style: (element: Element) => window.getComputedStyle(element) };
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: prompt modes and tags show a persistent selection and clear after deselecting`, async () => {
    const composer = communityComposeHTML({ board: 'showcase', members: false, simple: true, t: zh => zh, esc: String });
    const { window, style } = await fixture(theme, composer);
    try {
      let epoch = 0;
      // JSDOM does not invalidate its computed-style cache on native checked
      // property changes. A neutral attribute mutation refreshes that cache.
      const refreshStyles = () => { window.document.body.dataset.testState = String(++epoch); };
      const radios = [...window.document.querySelectorAll<HTMLInputElement>('input[name="promptMode"]')];
      assert.equal(radios.length, 3);
      for (const radio of radios) {
        radio.click();
        assert.equal(radio.checked, true);
        refreshStyles();
        assert.equal(window.document.querySelectorAll('input[name="promptMode"]:checked').length, 1);
        assert.equal(style(radio.nextElementSibling!).backgroundColor, palettes[theme].fill, `${radio.value} selection has a visible fill`);
        assert.equal(style(radio.nextElementSibling!).color, palettes[theme].ink);
        assert.equal(style(radio.nextElementSibling!).borderColor, palettes[theme].edge);
        for (const other of radios.filter(other => other !== radio)) assert.notEqual(style(other.nextElementSibling!).backgroundColor, palettes[theme].fill);
      }
      const tag = window.document.querySelector<HTMLInputElement>('input[name="tags"]')!;
      tag.click();
      refreshStyles();
      assert.equal(style(tag.nextElementSibling!).backgroundColor, palettes[theme].fill);
      tag.click();
      refreshStyles();
      assert.notEqual(style(tag.nextElementSibling!).backgroundColor, palettes[theme].fill);
      const disabled = radios[0]!;
      disabled.disabled = true;
      disabled.click();
      assert.equal(disabled.checked, false, 'disabled choices must not become selected');
    } finally { window.close(); }
  });

  test(`${theme}: filters, reply sorting, likes, bookmarks, preview and follow share durable feedback`, async () => {
    const { window, style } = await fixture(theme, `
      <section class="page community-page" data-community-frame="stable">
        <div class="community-seg"><button aria-pressed="true" data-case="filter">筛选</button><a aria-current="page" data-case="shop">道具卡</a></div>
        <div class="community-sort-tabs"><button aria-pressed="true" data-case="sort">热门</button></div>
        <section class="community-page" data-community="post" data-thread-design="feed"><div class="community-actbar"><button class="community-act is-on" aria-pressed="true" data-case="like">赞</button></div></section>
        <div class="community-reply-acts"><button class="community-act is-on is-small" aria-pressed="true" data-case="bookmark">收藏</button></div>
        <div class="community-ed-tools"><button class="community-ed-prev" aria-pressed="true" data-case="preview">预览</button></div>
        <button class="community-button is-small" aria-pressed="true" data-case="follow">已关注</button>
        <div class="community-post-menu"><button aria-pressed="true" data-case="pin">取消置顶</button><button data-test-neutral-menu>编辑</button></div>
        <fieldset class="community-radio-list"><label data-case="report"><input type="radio" checked>举报原因</label></fieldset>
      </section>`);
    try {
      assert.match(style(window.document.querySelector('.community-post-menu')!).backgroundImage, /linear-gradient/, 'the menu surface follows the page appearance instead of keeping a dark fill');
      for (const chosen of window.document.querySelectorAll<HTMLElement>('[data-case]')) {
        assert.equal(style(chosen).backgroundColor, palettes[theme].fill, `${chosen.dataset.case} keeps its active fill`);
        assert.equal(style(chosen).color, palettes[theme].ink);
        chosen.classList.add('test-hover');
        assert.equal(style(chosen).backgroundColor, palettes[theme].fill, `${chosen.dataset.case} hover cannot replace selection`);
      }
    } finally { window.close(); }
  });

  test(`${theme}: header, names and icon proportions are shared by both appearances`, async () => {
    const { window, tokens, style } = await fixture(theme, `<section class="page community-page" data-community-frame="stable">
      <div class="community-ck-pill"><button class="community-button is-small"><svg class="ui-icon" data-case="button"></svg></button></div>
      <a class="community-bell"><svg class="ui-icon" data-case="bell"></svg></a>
      <div class="community-account-menu"><svg class="ui-icon" data-case="menu"></svg></div>
      <div class="community-actbar"><button class="community-act"><svg class="ui-icon" data-case="action"></svg></button></div>
      <div class="community-bc-icon"><svg class="ui-icon" data-case="board"></svg></div>
      <div class="community-search"><svg class="ui-icon" data-case="search"></svg></div>
      <span class="community-feed-byline"><span class="community-who"><a class="community-uname">彩色昵称</a></span></span>
    </section>`);
    try {
      assert.equal(tokens.get('--header-h'), '72px');
      for (const [name, width] of [['button', '18px'], ['bell', '20px'], ['menu', '20px'], ['action', '22px'], ['board', '24px'], ['search', '18px']]) {
        assert.equal(style(window.document.querySelector(`[data-case="${name}"]`)!).width, width, `${name} matches the common scale`);
      }
      assert.equal(style(window.document.querySelector('.community-uname')!).fontSize, '16px');
      assert.equal(style(window.document.querySelector('.community-ck-pill .community-button')!).height, '36px');
    } finally { window.close(); }
  });
}

test('the header uses one uniform solid stroke instead of a fading decorative divider', async () => {
  const rules = postcss.parse(await readFile(new URL('../../src/community.css', import.meta.url), 'utf8'));
  let background = '';
  rules.walkRules('.community-header::after', rule => { rule.walkDecls('background', d => { background = d.value; }); });
  assert.equal(background, 'var(--community-header-edge)');
  const frame = await readFile(new URL('../../src/community-layout/stable-frame.css', import.meta.url), 'utf8');
  assert.doesNotMatch(frame, /\.community-header::after\s*\{[^}]*community-reading-divider/);
});
