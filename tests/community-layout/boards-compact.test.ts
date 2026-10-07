import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import postcss from 'postcss';
import { communityBoardsHTML } from '../../src/community.ts';

interface TestWindow extends Window { close(): void }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string) => { window: TestWindow };
};

async function styles(viewport: number, content: number) {
  const { composeCommunityStyles } = await import('../../scripts/compose-community-styles.mjs');
  const sheet = postcss.parse(await composeCommunityStyles());
  sheet.walkAtRules('media', rule => {
    const max = /max-width:\s*(\d+)px/.exec(rule.params), min = /min-width:\s*(\d+)px/.exec(rule.params);
    if ((!max && !min) || (max && viewport > Number(max[1])) || (min && viewport < Number(min[1]))) rule.remove();
    else rule.replaceWith(...rule.nodes!);
  });
  // JSDOM has no layout engine; apply the directory's declared container
  // conditions at representative real center widths before checking cascade.
  sheet.walkAtRules('container', rule => {
    const max = /max-width:\s*(\d+)px/.exec(rule.params);
    if (!rule.params.startsWith('community-board-directory ') || !max || content > Number(max[1])) rule.remove();
    else rule.replaceWith(...rule.nodes!);
  });
  return sheet.toString();
}

test('board cards cap at three columns and respond to center width rather than the full viewport', async () => {
  const html = communityBoardsHTML({ summary: { state: 'ready', data: { total: 0, repliesToday: 0, checkinsToday: 0, boards: {}, tags: {}, hot: [] } }, members: false, t: zh => zh, esc: String });
  for (const [viewport, content, expected] of [[1920, 980, 3], [1440, 734, 3], [1280, 664, 2], [1000, 772, 3], [700, 636, 2], [640, 576, 2], [390, 326, 1]]) {
    const { window } = new JSDOM(`<style>${await styles(viewport!, content!)}</style>${html}`);
    try {
      const grid = window.document.querySelector('.community-board-grid')!;
      assert.equal(window.getComputedStyle(grid).gridTemplateColumns, `repeat(${expected}, minmax(0, 1fr))`, `${content}px center at ${viewport}px viewport`);
      assert.equal(grid.children.length, 6);
      assert.ok(grid.querySelector('.is-locked[href="#/community/boards/vip"]'));
      assert.ok(grid.previousElementSibling?.querySelector('.community-tagcloud'));
    } finally { window.close(); }
  }
});

test('compact directory styling preserves the shared large board artwork and readable content', async () => {
  const css = postcss.parse(await readFile(new URL('../../src/community.css', import.meta.url), 'utf8'));
  const rules = new Map<string, Map<string, string>>();
  css.walkRules(rule => {
    if (rule.parent?.type !== 'root') return;
    const values = new Map<string, string>(); rule.walkDecls(decl => { values.set(decl.prop, decl.value); }); rules.set(rule.selector, values);
  });
  assert.ok(parseFloat(rules.get('.community-board-card')?.get('padding') || '') <= 16);
  assert.equal(rules.get('.community-board-card .community-bc-icon')?.get('width'), '36px');
  assert.equal(rules.get('.community-bc-icon.is-large')?.get('width'), '60px');
  assert.equal(rules.get('.community-bc-icon.is-large .ui-icon')?.get('width'), '26px');
  assert.ok(parseFloat(rules.get('.community-bc-name h2')?.get('font-size') || '') >= 18);
  assert.equal(rules.get('.community-bc-lock')?.get('flex-shrink'), '0');
  assert.equal(rules.get('.community-bc-stats dd')?.get('overflow-wrap'), 'anywhere');
  assert.equal(rules.get('.community-bc-latest time')?.get('grid-column'), '2');
});
