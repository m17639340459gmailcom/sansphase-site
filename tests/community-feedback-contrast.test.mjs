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

test('custom nicknames keep dark contrast on photo covers within the light theme', async () => {
  const css = postcss.parse(await readFile('src/community.css', 'utf8'));
  const lightRule = css.nodes.find(node => node.type === 'rule' && node.selector.includes('[data-community-theme="light"]') && node.nodes.some(declaration => declaration.prop === '--name-ink-start'));
  assert.ok(lightRule);
  const dom = new JSDOM('<body class="community-open" data-community-theme="light"><span class="community-uname" data-name-effect="solid"></span><div class="community-m-intro"><span class="community-uname" data-name-effect="solid"></span></div><div class="community-feed-showcase-track"><span class="community-uname" data-name-effect="solid"></span></div></body>');
  const [paper, cover, showcase] = dom.window.document.querySelectorAll('.community-uname');
  assert.equal(paper.matches(lightRule.selector), true);
  assert.equal(cover.matches(lightRule.selector), false);
  assert.equal(showcase.matches(lightRule.selector), false);
  dom.window.close();
});

test('profile cover hover buttons keep a dark background under pale labels', async () => {
  const css = postcss.parse(await readFile('src/community-layout/appearance.css', 'utf8'));
  const rule = css.nodes.find(node => node.type === 'rule' && node.selector.endsWith(' .community-m-intro'));
  const variables = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  assert.ok(contrast(variables['--text'], variables['--community-control-hover']) >= 4.5);
  const hover = css.nodes.find(node => node.type === 'rule' && node.selector.includes('.community-button:not('));
  assert.equal(hover.nodes.find(node => node.prop === 'background').value, 'var(--community-control-hover)');
});
