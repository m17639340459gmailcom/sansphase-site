import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { composeSiteStyles } from '../scripts/compose-site-styles.mjs';

function declarations(css, selector) {
  const values = {};
  for (const rule of css.nodes) {
    if (rule.type !== 'rule' || rule.selector !== selector) continue;
    for (const node of rule.nodes) if (node.type === 'decl') values[node.prop] = node.value;
  }
  return values;
}

function length(value, width, tokens) {
  const resolved = value?.replace(/var\((--[\w-]+)\)/g, (_, name) => tokens[name]);
  assert.ok(resolved, 'page spacing must have an explicit value');
  const pixels = part => {
    const match = /^(\d+(?:\.\d+)?)(px|vw)$/.exec(part.trim());
    assert.ok(match, `unsupported spacing length: ${part}`);
    return Number(match[1]) * (match[2] === 'vw' ? width / 100 : 1);
  };
  if (!resolved.startsWith('clamp(')) return pixels(resolved);
  const [minimum, preferred, maximum] = resolved.slice(6, -1).split(',').map(pixels);
  return Math.min(maximum, Math.max(minimum, preferred));
}

test('main content shares bounded vertical spacing without inheriting the former oversized masthead gap', async () => {
  const css = postcss.parse((await composeSiteStyles()).toString('utf8'));
  const tokens = declarations(css, ':root');
  const page = declarations(css, '.page');
  const blog = declarations(css, '.blog-page');
  const catalog = postcss.parse(await readFile('src/catalog.css', 'utf8'));
  const heading = declarations(catalog, '.catalog-exhibition-heading');
  assert.match(page.padding, /^var\(--page-top\).*var\(--page-bottom\)$/,
    'ordinary pages must use the same spacing budget as the collection pages');
  assert.equal(blog['padding-top'], 'var(--page-top)');
  assert.equal(blog['padding-bottom'], 'var(--page-bottom)');
  for (const width of [768, 1200, 1440, 1920]) {
    const top = length(tokens['--page-top'], width, tokens);
    assert.ok(top >= 24 && top <= 48, `${width}px: top spacing must stay within 24–48px`);
    assert.ok(length(tokens['--page-bottom'], width, tokens) <= 64);
    const [start, end] = heading['padding-block'].split(' ').map(Number.parseFloat);
    assert.ok(top + start <= 48, 'the works/resources heading must not add another large top gap');
    assert.ok(end >= 16 && end <= 32, 'heading and first exhibit need a compact, visible separation');
  }
  const reading = declarations(css, '.page.reading-page').padding.split(' ').map(Number.parseFloat);
  assert.ok(reading[0] >= 24 && reading[0] <= 40);
  assert.ok(reading[2] <= 64);
  const mobile = { nodes: css.nodes.filter(node => node.type === 'atrule' && node.params === '(max-width: 760px)').flatMap(node => node.nodes) };
  assert.ok(Number.parseFloat(declarations(mobile, '.page')['padding-top']) <= 28);
});

test('featured cover shade clears the image half and narrower exhibits place copy below the image', async () => {
  const css = postcss.parse(await readFile('src/catalog.css', 'utf8'));
  const copy = declarations(css, '.catalog-hero .catalog-feature-copy');
  const transparent = /transparent\s+(\d+)%/.exec(copy.background);
  assert.ok(transparent, 'the hero shade needs an explicit transparent stop before the image area');
  assert.ok(Number(transparent[1]) <= 55, 'the right image area must not retain the text shade');
  assert.equal(copy['pointer-events'], 'none', 'the shade must not cover the image link interaction');
  assert.equal(declarations(css, '.catalog-hero .catalog-feature-copy a')['pointer-events'], 'auto');
  const narrow = css.nodes.find(node => node.type === 'atrule' && node.params === '(max-width: 900px)');
  assert.ok(narrow, 'tablet widths need the same unobscured image layout as phones');
  assert.equal(declarations(narrow, '.catalog-hero .catalog-feature-copy').position, 'static');
  assert.equal(declarations(narrow, '.catalog-hero .catalog-feature-copy').background, 'none');
});
