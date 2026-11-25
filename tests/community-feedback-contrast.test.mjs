import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { JSDOM } from 'jsdom';

const luminance = hex => {
  const channels = hex.replace('#', '').match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test('shared notifications inherit community ink and border instead of fixed pale colours', async () => {
  const source = await readFile('src/library-ui.tsx', 'utf8');
  const toaster = source.slice(source.indexOf('export function mountToaster'), source.indexOf('export function createDialog'));
  assert.match(toaster, /color:\s*"var\(--text\)"/);
  assert.doesNotMatch(toaster, /color:\s*"#/);
  assert.match(toaster, /border:\s*"1px solid var\(--line-strong\)"/);
});

test('light notification text, muted text, warnings and errors remain readable on both paper gradient endpoints', async () => {
  const css = postcss.parse(await readFile('src/community-layout/appearance.css', 'utf8'));
  const selector = 'body.community-open:is(.community-frame-open, .community-management-open)[data-community-theme="light"]';
  const variables = Object.fromEntries(css.nodes.find(node => node.type === 'rule' && node.selector === selector).nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  for (const name of ['--text', '--muted', '--cm-warn', '--error']) {
    for (const background of ['--community-reading-card-top', '--community-reading-card-bottom']) {
      assert.ok(contrast(variables[name], variables[background]) >= 4.5, `${name} must remain readable on ${background}`);
    }
  }
});

test('empty pages and image overlays have complete foreground and background pairs in both themes', async () => {
  const css = postcss.parse(await readFile('src/community.css', 'utf8'));
  const stable = postcss.parse(await readFile('src/community-layout/stable-frame.css', 'utf8'));
  const light = postcss.parse(await readFile('src/community-layout/appearance.css', 'utf8'));
  const variables = Object.fromEntries(light.nodes.find(node => node.type === 'rule' && node.selector === 'body.community-open:is(.community-frame-open, .community-management-open)[data-community-theme="light"]').nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  const declarations = (sheet, selector) => Object.fromEntries(sheet.nodes.find(node => node.type === 'rule' && node.selector === selector).nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  const empty = declarations(css, '.community-empty');
  assert.equal(empty.background, 'var(--community-reading-control, var(--cm-panel))');
  assert.ok(contrast(variables['--muted'], variables['--community-reading-control']) >= 4.5);
  for (const [sheet, selector] of [[css, '.community-upload button'], [css, '.community-g-count'], [stable, '[data-inline-editor] .community-inline-upload figcaption'], [stable, '[data-inline-editor] .community-inline-remove']]) {
    const properties = declarations(sheet, selector);
    assert.match(properties.color, /^#[0-9a-f]{6}$/i, 'photo overlays carry their own readable ink');
    // Fully white photos are the brightest backdrop under a dark overlay.
    const rgb = properties.background.startsWith('#') ? properties.background : (() => {
      const numbers = properties.background.match(/[\d.]+/g).map(Number);
      const alpha = numbers[3] / 100;
      return '#' + numbers.slice(0, 3).map(value => Math.round(value * alpha + 255 * (1 - alpha)).toString(16).padStart(2, '0')).join('');
    })();
    assert.ok(contrast(properties.color, rgb) >= 4.5, selector);
  }
  for (const level of [0, 1, 2, 3, 4]) assert.ok(contrast(variables['--cm-level-badge-ink'], variables[`--cm-lv${level}`]) >= 4.5);
});

test('author tools opened from a light community retain a complete dark palette', async () => {
  const css = postcss.parse(await readFile('src/author.css', 'utf8'));
  const rule = css.nodes.find(node => node.type === 'rule' && node.selector === 'body.community-open[data-community-theme="light"] .author-dialog');
  assert.ok(rule, 'the dark author workspace does not inherit paper ink');
  const properties = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  assert.ok(contrast(properties['--text'], properties['--surface']) >= 4.5);
  assert.ok(contrast(properties['--muted'], properties['--surface-2']) >= 4.5);
  assert.match(properties['--dialog-fill'], /28 34 48/);
});

test('custom nickname palette selection preserves the existing photo-cover and showcase exceptions', async () => {
  const css = postcss.parse(await readFile('src/community.css', 'utf8'));
  const lightRule = css.nodes.find(node => node.type === 'rule' && node.selector.includes('[data-community-theme="light"]') && node.nodes.some(declaration => declaration.prop === '--name-ink-start'));
  const darkRule = css.nodes.find(node => node.type === 'rule' && !node.selector.includes('[data-community-theme=') && node.nodes.some(declaration => declaration.prop === '--name-ink-start'));
  assert.ok(lightRule);
  assert.ok(darkRule);
  assert.equal(lightRule.nodes.find(node => node.prop === '--name-ink-start').value, 'var(--name-light-start)');
  assert.equal(darkRule.nodes.find(node => node.prop === '--name-ink-start').value, 'var(--name-dark-start)');
  for (const effect of ['solid', 'gradient', 'shimmer']) {
    const dom = new JSDOM(`<body class="community-open community-frame-open" data-community-theme="light"><span class="community-uname" data-name-effect="${effect}"></span><div class="community-m-intro"><span class="community-uname" data-name-effect="${effect}"></span></div><div class="community-feed-showcase-track"><span class="community-uname" data-name-effect="${effect}"></span></div></body>`);
    try {
      const [paper, cover, showcase] = dom.window.document.querySelectorAll('.community-uname');
      assert.equal(paper.matches(lightRule.selector), true);
      assert.equal(cover.matches(lightRule.selector), false, `${effect} keeps its existing photo-cover palette; the large nickname override is tested separately`);
      assert.equal(showcase.matches(lightRule.selector), false, 'the permanently dark showcase stays a separate case');
      dom.window.document.body.dataset.communityTheme = 'dark';
      for (const name of [paper, cover, showcase]) {
        assert.equal(name.matches(lightRule.selector), false);
        assert.equal(name.matches(darkRule.selector), true);
      }
    } finally { dom.window.close(); }
  }
});

test('profile readability never masks the cover or adds glyph outlines and secondary text shadows', async () => {
  const css = postcss.parse(await readFile('src/community.css', 'utf8'));
  const light = postcss.parse(await readFile('src/community-layout/appearance.css', 'utf8'));
  for (const sheet of [css, light]) {
    sheet.walkRules(rule => {
      assert.doesNotMatch(rule.selector, /\.community-m-(?:intro|id|name)::(?:before|after)/, 'profile readability must not add a panel or scrim over the photo');
      if (/\.community-m-(?:intro|id|name|tags|acts)\b/.test(rule.selector)) {
        for (const declaration of rule.nodes.filter(node => node.type === 'decl')) {
          assert.notEqual(declaration.prop, '-webkit-text-stroke', 'nickname changes must not draw an outline');
          assert.notEqual(declaration.prop, 'paint-order', 'the retired outline treatment must be removed');
          if (declaration.prop === 'text-shadow') assert.equal(declaration.value, 'none', 'profile text must not acquire new shadows');
        }
      }
      assert.doesNotMatch(rule.selector, /\.community-m-acts\s+\.community-button/, 'the nickname fix must retain the original action button appearance');
    });
  }
});

test('profile large nicknames use sampled ink in both themes without replacing finishes elsewhere', async () => {
  const light = postcss.parse(await readFile('src/community-layout/appearance.css', 'utf8'));
  const selector = 'body.community-open:is(.community-frame-open, .community-management-open) .community-m-intro .community-m-name h1 .community-uname';
  const rule = light.nodes.find(node => node.type === 'rule' && node.selector === selector);
  assert.ok(rule, 'large profile nicknames need background-aware ink independent of site theme');
  const properties = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  assert.equal(properties.color, 'var(--profile-name-ink, #ffffff)');
  assert.equal(properties['-webkit-text-fill-color'], 'var(--profile-name-ink, #ffffff)');
  assert.equal(properties['background-image'], 'none');
  assert.equal(properties['text-shadow'], 'none');
  assert.equal(properties.animation, 'none');
  for (const attributes of ['', 'class="is-color-gold"', 'class="is-color-aurora"', 'data-name-effect="solid"', 'data-name-effect="gradient"', 'data-name-effect="shimmer"']) {
    const nickname = attributes.startsWith('class=') ? `<span class="community-uname ${attributes.slice(7, -1)}"></span>` : `<span class="community-uname" ${attributes}></span>`;
    const dom = new JSDOM(`<body class="community-open community-frame-open" data-community-theme="light"><div class="community-m-intro"><div class="community-m-name"><h1>${nickname}</h1><p><span class="community-uname"></span></p></div></div><div class="community-account">${nickname}</div><div class="community-feed-showcase-track">${nickname}</div></body>`);
    try {
      const document = dom.window.document;
      assert.deepEqual([...document.querySelectorAll(selector)], [document.querySelector('.community-m-name h1 .community-uname')], 'only the cover large nickname uses sampled ink');
      document.body.dataset.communityTheme = 'dark';
      assert.deepEqual([...document.querySelectorAll(selector)], [document.querySelector('.community-m-name h1 .community-uname')], 'dark mode keeps the same cover-aware nickname; effects elsewhere remain untouched');
    } finally { dom.window.close(); }
  }
});
