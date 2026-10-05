import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import postcss from 'postcss';
import { communityShopHTML, communityShopMineHTML } from '../../src/community-pages.ts';
import type { CommunityShop, CommunityShopItem, CommunityShopMine } from '../../src/community-pages.ts';
import { communityBuiltinItems } from '../../src/community-rules.ts';
import { composeCommunityStyles } from '../../scripts/compose-community-styles.mjs';
import { escapeHTML } from '../../src/core.mjs';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window };
};
const icons = Object.fromEntries(['star', 'check', 'calendar', 'pin', 'sparkles', 'package', 'eye', 'chevron-down'].map(name => [name, `<svg class="ui-icon" data-icon="${name}" aria-hidden="true"></svg>`]));
const common = { t: (zh: string) => zh, esc: escapeHTML, icons };
const shop: CommunityShop = {
  balance: 1000, level: 2, owner: false, inventory: { makeup: 1, pin: 0, highlight: 0 },
  decorations: { frame: 'gold', color: null, cover: null },
  items: communityBuiltinItems.map((item): CommunityShopItem => ({ ...item, active: true,
    state: { owned: item.id === 'frame-gold', left: null, ok: item.id !== 'frame-gold', code: item.id === 'frame-gold' ? 'owned' : 'ok', why: '' },
  })).concat([
    { id: 'guide', cat: 'digital', kind: 'digital', name: '工作流手册', desc: '完整使用说明与 <参数> 示例。', price: 20, builtin: false, active: true,
      state: { owned: false, left: null, ok: false, code: 'short', why: '还差 20 星尘' } },
    { id: 'bag', cat: 'goods', kind: 'goods', name: '帆布袋', desc: '材料及发货说明。', price: 200, minDays: 30, stock: 10, note: '包邮', builtin: false, active: true,
      state: { owned: false, left: 3, ok: true, code: 'ok', why: '' } },
  ]),
};

async function fixture(theme: 'light' | 'dark', content: string) {
  const css = postcss.parse(await composeCommunityStyles());
  // JSDOM does not evaluate media queries. These checks cover the desktop
  // cascade; the narrow-screen contract is checked separately below.
  css.walkAtRules('media', rule => rule.remove());
  const { window } = new JSDOM(`<style>${css}</style><body class="community-open community-frame-open" data-community-theme="${theme}"><section data-community-frame="stable">${content}</section></body>`, { url: 'http://localhost:4214/#/community/shop' });
  return { window, style: (element: Element) => window.getComputedStyle(element) };
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: exchange and owned looks keep compact tracks even when a category has few items`, async () => {
    const mine: CommunityShopMine = { balance: 1000, inventory: shop.inventory, decorations: shop.decorations,
      looks: shop.items.filter(item => item.id === 'frame-gold'), digital: [], orders: [] };
    const { window, style } = await fixture(theme, communityShopHTML({ shop: { state: 'ready', data: shop }, tab: 'all', ...common }) + communityShopMineHTML({ mine: { state: 'ready', data: mine }, ...common }));
    try {
      for (const grid of window.document.querySelectorAll('.community-shop-grid, .community-inv-grid')) {
        const columns = style(grid).gridTemplateColumns;
        assert.doesNotMatch(columns, /1fr/, 'a short category must not stretch its cards across the whole row');
        assert.match(columns, /176px/, 'desktop cards follow the compact inventory reference');
        assert.equal(style(grid).alignItems, 'stretch', 'items in the same collection must share the row height');
        assert.equal(style(grid).gridAutoRows, '1fr', 'separate rows must follow the same height rule');
      }
      for (const art of window.document.querySelectorAll('.community-sitem-art, .community-inv .community-sart')) assert.equal(style(art).height, '112px');
      assert.equal(style(window.document.querySelector('.community-sitem')!).borderRadius, '12px');
      for (const button of window.document.querySelectorAll('.community-sitem-foot .community-button')) assert.ok(parseFloat(style(button).minHeight) >= 36, 'compacting the card must preserve a usable action');
    } finally { window.close(); }
  });

  test(`${theme}: missing purchase tags still reserve an information slot and the action row stays at the bottom`, async () => {
    const { window, style } = await fixture(theme, communityShopHTML({ shop: { state: 'ready', data: shop }, tab: 'card', ...common }));
    try {
      const cards = [...window.document.querySelectorAll('.community-sitem')];
      assert.equal(cards.length, 3);
      assert.ok(cards.some(card => !card.querySelector('.community-stags')), 'include the tag-free highlight card from the reported screenshot');
      for (const card of cards) {
        const body = card.querySelector('.community-sitem-body')!;
        assert.ok(card.querySelector('.community-sitem-meta'), 'reserve the metadata position even when no limits apply');
        assert.equal(body.children.length, 3, 'name/description, purchase conditions and actions have distinct stable rows');
        assert.match(style(body).gridTemplateRows, /^auto minmax\(24px, 1fr\) auto$/);
        assert.equal(style(card).minHeight, '236px');
        assert.equal(style(card).height, '100%');
        assert.equal(style(card).gridTemplateRows, 'auto minmax(0, 1fr)');
        assert.equal(body.lastElementChild?.className, 'community-sitem-foot');
        card.querySelector<HTMLElement>('summary')!.click();
        assert.equal(style(card.parentElement!).gridAutoRows, '1fr', 'viewing a long description must keep neighbouring card sizes consistent');
      }
    } finally { window.close(); }
  });

  test(`${theme}: item artwork fits the smaller stage without clipping on hover`, async () => {
    const { window, style } = await fixture(theme, communityShopHTML({ shop: { state: 'ready', data: shop }, tab: 'all', ...common }));
    try {
      for (const selector of ['.community-sart .community-av-xl', '.community-cover-sample', '.community-holo', '.community-file', '.community-goods']) {
        const artwork = style(window.document.querySelector(selector)!);
        assert.ok(parseFloat(artwork.height) <= 96, `${selector} leaves room for rotation and hover inside 112px`);
        assert.ok(parseFloat(artwork.width) <= 140, `${selector} leaves horizontal breathing room`);
      }
    } finally { window.close(); }
  });
}

test('item descriptions expand through native summaries while prices, limits, stock and actions stay visible', async () => {
  const { window } = await fixture('dark', communityShopHTML({ shop: { state: 'ready', data: shop }, tab: 'all', ...common }));
  try {
    const cards = [...window.document.querySelectorAll('.community-sitem')];
    assert.equal(cards.length, shop.items.length, 'all six kinds of merchandise remain available');
    for (const card of cards) {
      const details = card.querySelector<HTMLDetailsElement>('details.community-sitem-details');
      assert.ok(details, 'long descriptions should not make every card tall on first render');
      assert.equal(details.open, false);
      const summary = details.querySelector<HTMLElement>('summary')!;
      assert.ok(summary.querySelector('h3'));
      assert.ok(summary.querySelector('[data-icon="chevron-down"]'));
      summary.click();
      assert.equal(details.open, true);
      summary.click();
      assert.equal(details.open, false);
      for (const control of card.querySelectorAll('.community-price, .community-stags, .community-stock, .community-sitem-foot button')) assert.equal(control.closest('details'), null, 'purchase conditions must not disappear inside a collapsed description');
    }
    assert.ok(window.document.querySelector('[data-action="community-equip"][data-kind="frame"][data-ref=""]'));
    assert.ok(window.document.querySelector<HTMLButtonElement>('.community-sitem-foot button:disabled'));
    assert.match(window.document.querySelector('.community-stock')!.textContent!, /剩 3 \/ 10/);
    assert.ok(cards.some(card => card.querySelector('details p')?.textContent === '完整使用说明与 <参数> 示例。'), 'descriptions keep escaped content');
    const confirmation = window.document.createElement('div');
    confirmation.innerHTML = communityShopHTML({ shop: { state: 'ready', data: shop }, tab: 'card', redeeming: 'card-pin', ...common });
    const description = shop.items.find(item => item.id === 'card-pin')!.desc;
    assert.ok([...confirmation.querySelectorAll('.community-redeem-text p')].some(p => p.textContent === description), 'the full explanation is also present before confirming a purchase');
  } finally { window.close(); }
});

test('hovering a merchandise card keeps its outside edges aligned with its neighbours', async () => {
  const css = postcss.parse(await composeCommunityStyles());
  css.walkRules('.community-sitem:hover', rule => {
    rule.walkDecls('transform', declaration => assert.doesNotMatch(declaration.value, /translate/, 'hover feedback should not lift the entire card out of the shared row'));
  });
});

test('narrow screens retain compact artwork and reveal complete descriptions without the former height or line clamp', async () => {
  const css = postcss.parse(await composeCommunityStyles());
  const narrow = new Map<string, Map<string, string>>();
  css.walkAtRules('media', media => {
    if (media.params !== '(max-width: 640px)') return;
    media.walkRules(rule => {
      const declarations = new Map<string, string>();
      rule.walkDecls(d => declarations.set(d.prop, d.value));
      narrow.set(rule.selector, declarations);
    });
  });
  assert.match(narrow.get('.community-shop-grid')?.get('grid-template-columns') || '', /repeat\(2, minmax\(0, 176px\)\)/);
  assert.equal(narrow.get('.community-sitem-art')?.get('height'), undefined, 'mobile must not restore the old 156px stage');
  assert.equal(narrow.get('.community-sitem-art .community-sart')?.get('transform'), undefined, 'individual objects now have the correct dimensions without shrinking their text again');
  assert.equal(narrow.get('.community-sitem-body p')?.get('-webkit-line-clamp'), undefined, 'opening a description must reveal all of it');
  assert.equal(narrow.get('.community-inv .community-sart')?.get('height'), '48px', 'the existing mobile inventory remains a compact row');
});
