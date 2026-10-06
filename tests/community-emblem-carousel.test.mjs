import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { communityLevelExplorerHTML, createCommunityLevelExplorer } from '../src/community-level-explorer.ts';
import { communityBadgeExplorerHTML, createCommunityBadgeExplorer } from '../src/community-badge-explorer.ts';
import { emptyBadgeMetrics, evaluateCommunityBadges } from '../src/community-badge-policy.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const levels = { owner: false, level: 1, growth: { level: 5, points: 0, configured: false } };
const badges = evaluateCommunityBadges(emptyBadgeMetrics(), [
  { family: 'appreciation', tier: 'gold', achievedAt: '2026-09-01T00:00:00Z', revokedAt: null },
  { family: 'appreciation', tier: 'diamond', achievedAt: '2026-09-02T00:00:00Z', revokedAt: null },
]);

test('level carousel shows a large center, adjacent artwork and three arc stops instead of a full strip', () => {
  for (const mode of ['growth', 'trust', 'vip']) {
    const doc = new JSDOM(communityLevelExplorerHTML(levels, common, { mode, growth: 5, trust: 2, vip: 4 })).window.document;
    const carousel = doc.querySelector('[data-level-carousel]');
    assert.ok(carousel);
    assert.equal(carousel.querySelectorAll('[data-level-preview]').length, 1);
    assert.equal(carousel.querySelectorAll('[data-carousel-neighbour]').length, 2);
    assert.equal(carousel.querySelectorAll('[data-level-step]').length, 2);
    assert.equal(carousel.querySelectorAll('[data-level-track] [data-level]').length, 3);
    assert.equal(carousel.querySelectorAll('[data-level-track] [aria-pressed="true"]').length, 1);
    assert.ok(carousel.querySelector('[data-carousel-arc] path'));
    assert.equal(doc.querySelector('[data-level-gallery], .community-level-controls'), null);
    assert.ok(doc.querySelector('[data-level-detail]'), 'the existing detail region is preserved');
    doc.defaultView.close();
  }
});

test('step browsing preserves the page and focus; endpoints never wrap or produce a phantom level', () => {
  const dom = new JSDOM('<main>' + communityLevelExplorerHTML(levels, common) + '</main>', { pretendToBeVisual: true });
  const oldDocument = globalThis.document, oldElement = globalThis.Element;
  globalThis.document = dom.window.document; globalThis.Element = dom.window.Element;
  try {
    const doc = dom.window.document, main = doc.querySelector('main'), panel = doc.querySelector('[data-level-explorer]');
    const controller = createCommunityLevelExplorer({ root: () => panel, data: () => levels, common: () => common });
    main.scrollTop = 210;
    for (const n of [6, 7, 8, 9, 10]) {
      controller.action(panel.querySelector('[data-level-step="1"]'));
      assert.equal(panel.querySelector('[data-level-preview]').dataset.selectedLevel, String(n));
      assert.equal(main.querySelector('[data-level-explorer]'), panel);
      assert.equal(main.scrollTop, 210);
      assert.equal(panel.querySelectorAll('[data-level-track] [data-level]').length, n === 10 ? 2 : 3);
      assert.equal(doc.activeElement, panel.querySelector(n === 10 ? '[data-level-preview]' : '[data-level-step="1"]'));
    }
    const last = panel.querySelector('[data-level-step="1"]');
    assert.equal(last.disabled, true);
    controller.action(last);
    assert.equal(panel.querySelector('[data-level-preview]').dataset.selectedLevel, '10');
    const preview = panel.querySelector('[data-level-preview]');
    controller.keydown({ target: preview, key: 'Home', preventDefault() {} });
    assert.equal(panel.querySelector('[data-level-preview]').dataset.selectedLevel, '1');
    assert.equal(panel.querySelector('[data-level-step="-1"]').disabled, true);
    assert.equal(panel.querySelectorAll('[data-carousel-neighbour]').length, 1);
    assert.equal(panel.querySelector('[data-level="0"]'), null);
    assert.equal(main.scrollTop, 210);
  } finally { globalThis.document = oldDocument; globalThis.Element = oldElement; dom.window.close(); }
});

test('badge material carousel has adjacent samples and an arc; browsing leaves earned honors intact', () => {
  const dom = new JSDOM('<main>' + communityBadgeExplorerHTML(badges, [], common) + '</main>', { pretendToBeVisual: true });
  const doc = dom.window.document, root = doc.querySelector('[data-badge-explorer]'), main = doc.querySelector('main');
  const wall = doc.querySelector('.community-badge-wall');
  const controller = createCommunityBadgeExplorer({ root: () => root, data: () => badges, common: () => common });
  main.scrollTop = 230;
  assert.equal(doc.querySelectorAll('[data-badge-carousel] [data-carousel-neighbour]').length, 2);
  assert.equal(doc.querySelectorAll('[data-badge-track] [data-badge-tier]').length, 3);
  assert.ok(doc.querySelector('[data-badge-carousel] [data-carousel-arc] path'));
  assert.equal(doc.querySelector('[data-badge-finishes], [data-badge-gallery-host]'), null);
  controller.action(root.querySelector('[data-badge-step="1"]'));
  assert.equal(root.querySelector('[data-badge-detail]').dataset.tier, 'aurora');
  assert.equal(root.querySelector('[data-badge-detail]').dataset.earned, 'false');
  assert.equal(root.querySelector('[data-badge-carousel] [data-badge-art]').dataset.finish, 'diamond', 'the adjacent sample is separate from the locked central emblem');
  assert.equal(root.querySelector('[data-badge-preview] [data-badge-art]').dataset.finish, 'locked');
  assert.equal(root.querySelector('[data-badge-step="1"]').disabled, true);
  assert.equal(root.querySelector('.community-badge-wall'), wall);
  assert.equal(wall.querySelector('[data-badge-family-card="appreciation"]').dataset.tier, 'diamond');
  assert.equal(main.scrollTop, 230);
  dom.window.close();
});

test('shared art tracks shrink within their slots instead of overlapping neighbouring emblems', () => {
  const css = postcss.parse(readFileSync(new URL('../src/community.css', import.meta.url), 'utf8'));
  const declarations = selector => {
    const rule = css.nodes.find(node => node.type === 'rule' && node.selector === selector);
    assert.ok(rule);
    return new Map(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  };
  for (const selector of ['.community-badge-detail-art', '.community-level-emblem', '.community-emblem-side button']) {
    assert.equal(declarations(selector).get('grid-template-columns'), 'minmax(0, 1fr)', `${selector} must not grow an implicit track to the intrinsic art size`);
  }
  assert.equal(declarations('.community-badge-detail-art .community-badge-art').get('width'), 'min(100%, 210px)');
  assert.equal(declarations('.community-emblem-side .community-badge-art').get('width'), 'min(100%, 78px)');
  assert.equal(declarations('.community-emblem-stage').get('gap'), '6px');
  assert.equal(declarations('.community-emblem-arrow').get('width'), '44px');
});
