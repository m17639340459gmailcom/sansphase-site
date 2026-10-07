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

async function fixture(theme: keyof typeof palettes, content: string, includeFoundation = false, workspace: 'frame' | 'management' = 'frame') {
  const tokens = new Map<string, string>();
  const source = [includeFoundation ? await readFile(new URL('../../src/styles-foundation.css', import.meta.url), 'utf8') : '', await composeCommunityStyles()].join('\n');
  postcss.parse(source).walkRules(rule => {
    if (rule.parent?.type !== 'root') return;
    if (![...(includeFoundation ? [':root'] : []), 'body.community-open', 'body.community-open:is(.community-frame-open, .community-management-open)', ...(theme === 'light' ? [light] : [])].includes(rule.selector)) return;
    rule.walkDecls(d => { if (d.prop.startsWith('--')) tokens.set(d.prop, d.value); });
  });
  // JSDOM does not resolve inherited custom properties; use the corresponding
  // desktop theme tokens. Component-local artwork palettes are not tested here.
  let css = source.replaceAll(':hover', '.test-hover').replaceAll(':focus-visible', '.test-focus').replaceAll(':active', '.test-active');
  for (let n = 0; n < 10; n++) css = css.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g,
    (match: string, name: string, fallback: string | undefined) => tokens.get(name) ?? fallback ?? match);
  const { window } = new JSDOM(`<style>${css}</style><body class="community-open community-${workspace}-open" data-community-theme="${theme}">${content}</body>`, { url: `http://localhost/?communityTheme=${theme}#/community/new/showcase` });
  return { window, tokens, style: (element: Element) => window.getComputedStyle(element) };
}

const actionVariants = [
  { id: 'neutral', className: 'community-button', primary: false },
  { id: 'gold', className: 'community-button is-gold', primary: true },
  { id: 'post', className: 'community-post', primary: true },
  { id: 'good', className: 'community-button is-good', primary: false },
  { id: 'danger', className: 'community-button is-danger', primary: false },
] as const;

for (const theme of ['light', 'dark'] as const) for (const workspace of ['management', 'frame'] as const) {
  test(`${theme}: ${workspace} actions keep one visible edge through keyboard focus, hover and pressing`, async t => {
    const variants = workspace === 'frame' ? [...actionVariants, { id: 'rail-compose', className: 'community-feed-rail-compose', primary: true }] : actionVariants;
    const content = variants.map(variant => variant.id === 'rail-compose'
      ? `<aside class="community-feed-rail"><a href="#/community/new/qa" class="${variant.className}" data-case="${variant.id}"><span data-compose-label>发布讨论</span></a></aside>`
      : variant.id === 'post'
      ? `<a href="#/community/new/qa" class="${variant.className}" data-case="${variant.id}"><span>发布讨论</span></a>`
      : `<button type="button" class="${variant.className}" data-case="${variant.id}"><span>保存管理配置</span></button>`).join('');
    const { window, tokens, style } = await fixture(theme, `<section class="page community-${workspace === 'frame' ? 'page' : 'management-page'}"${workspace === 'frame' ? ' data-community-frame="stable"' : ''}>${content}</section>`, true, workspace);
    try {
      const probe = window.document.createElement('span');
      window.document.body.append(probe);
      const colour = (value: string) => {
        let resolved = value;
        for (let n = 0; n < 10; n++) resolved = resolved.replace(/var\((--[\w-]+)\)/g, (match, name: string) => tokens.get(name) ?? match);
        probe.style.color = resolved;
        return style(probe).color;
      };
      for (const variant of variants) await t.test(variant.id, () => {
        const control = window.document.querySelector<HTMLElement>(`[data-case="${variant.id}"]`)!;
        const normal = { edge: style(control).borderColor, shadow: style(control).boxShadow, fill: style(control).backgroundColor, image: style(control).backgroundImage };
        control.focus();
        control.classList.add('test-focus');
        const expectedEdge = variant.primary ? style(control).color : colour(tokens.get('--focus-edge')!);
        const focusedEdge = () => {
          const focused = style(control);
          assert.equal(focused.borderColor, expectedEdge, `${variant.id} uses its readable focus colour on the existing border`);
          assert.equal(focused.borderTopWidth, '1px', 'focus cannot grow the layout border');
          assert.ok(!focused.outlineStyle || focused.outlineStyle === 'none', 'focus must not add a detached outer outline');
          const edges = [...focused.boxShadow.matchAll(/\binset\s+0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+1\.5px\s+(currentColor|#[a-f\d]+|rgba?\([^)]*\))/gi)];
          assert.equal(edges.length, 1, `${variant.id} keeps one continuous inset stroke against the existing border`);
          assert.equal(edges[0]![1]!.toLowerCase() === 'currentcolor' ? focused.color : colour(edges[0]![1]!), expectedEdge, 'the inset stroke and existing border use the same colour');
        };
        focusedEdge();
        assert.notDeepEqual({ edge: style(control).borderColor, shadow: style(control).boxShadow }, { edge: normal.edge, shadow: normal.shadow }, 'keyboard focus must differ from the normal surface');
        control.classList.add('test-hover');
        focusedEdge();
        control.classList.add('test-active');
        focusedEdge();
        control.classList.remove('test-focus', 'test-hover');
        assert.notDeepEqual({ shadow: style(control).boxShadow, fill: style(control).backgroundColor, image: style(control).backgroundImage }, { shadow: normal.shadow, fill: normal.fill, image: normal.image }, 'pressing provides feedback without moving the control');
        assert.ok(!style(control).transform || style(control).transform === 'none');
        assert.ok(!style(control).filter || style(control).filter === 'none');
        control.classList.remove('test-active');
        control.blur();
      });
    } finally { window.close(); }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: disabled actions retain their surface during hover and pressing`, async () => {
    const { window, style } = await fixture(theme, actionVariants.map(variant => `<button type="button" disabled class="${variant.className}" data-case="${variant.id}"><span>保存管理配置</span></button>`).join(''), true, 'management');
    try {
      for (const control of window.document.querySelectorAll<HTMLButtonElement>('button')) {
        const surface = () => ({ edge: style(control).borderColor, shadow: style(control).boxShadow, fill: style(control).backgroundColor, image: style(control).backgroundImage });
        const normal = surface();
        assert.ok(Number(style(control).opacity) < 1, 'disabled controls are visibly distinct');
        control.classList.add('test-hover', 'test-active');
        assert.deepEqual(surface(), normal, `${control.dataset.case} cannot show enabled hover or pressed feedback while disabled`);
        let clicks = 0;
        control.addEventListener('click', () => { clicks++; });
        control.click();
        assert.equal(clicks, 0);
      }
    } finally { window.close(); }
  });
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
