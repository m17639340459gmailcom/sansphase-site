import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import postcss from 'postcss';
import { communityShopHTML, communityShopMineHTML, communityShopDetailHTML } from '../../src/community-pages.ts';
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
    { id: 'portrait-card', cat: 'digital', kind: 'digital', name: '卡片展示图', image: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', desc: '完整保留卡片的上沿与下沿。', price: 8, builtin: false, active: true,
      state: { owned: false, left: null, ok: true, code: 'ok', why: '' } },
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
  test(`${theme}: built-in and uploaded tool cards share a portrait silhouette and rightward direction`, async () => {
    const uploaded: CommunityShopItem = { ...shop.items.find(item => item.id === 'portrait-card')!, cat: 'card', kind: 'card', ref: 'makeup' };
    const data = { ...shop, items: [shop.items.find(item => item.id === 'card-pin')!, uploaded] };
    const details = data.items.map(item => communityShopDetailHTML({ item, shop: data, showPrice: true, common })).join('');
    const { window, style } = await fixture(theme, communityShopHTML({ shop: { state: 'ready', data }, tab: 'card', ...common }) + details);
    try {
      const builtIn = style(window.document.querySelector('.community-sitem-art.is-tool-card .community-holo:not(.is-uploaded)')!);
      const width = parseFloat(builtIn.width), height = parseFloat(builtIn.height);
      assert.ok(width / height >= .69 && width / height <= .71, 'the built-in card follows the uploaded portrait rather than the old wide, squat shape');
      const angle = Number(builtIn.transform.match(/\brotate\(([\d.-]+)deg\)/)?.[1]);
      assert.ok(angle >= 4 && angle <= 6, 'the built-in card leans right like the artwork itself');
      const radians = angle * Math.PI / 180;
      const projectedWidth = (width * Math.cos(radians) + height * Math.sin(radians)) * 1.035;
      const projectedHeight = (height * Math.cos(radians) + width * Math.sin(radians)) * 1.035;
      const stageHeight = parseFloat(style(window.document.querySelector('.community-sitem-art.is-tool-card')!).height);
      assert.ok(width >= 115 && height >= 160, 'the drawing must grow with the widened merchandise card');
      assert.ok(projectedWidth < 190 && projectedHeight < stageHeight - 16, 'the full silhouette and hover enlargement leave breathing room inside the larger stage');
      const uploadedStyle = style(window.document.querySelector('.community-sitem-art.is-tool-card .community-holo.is-uploaded')!);
      assert.doesNotMatch(uploadedStyle.transform, /\brotate\(/, 'an image that already contains a tilt receives no additional planar rotation');
      const detailBuiltIn = style(window.document.querySelector('.community-shop-detail-art .community-holo:not(.is-uploaded)')!);
      assert.match(detailBuiltIn.transform, /\brotate\(5deg\)/, 'opening details preserves the list direction');
      assert.equal(detailBuiltIn.aspectRatio, '7 / 10', 'the detail drawing keeps the same portrait ratio when the viewport narrows');
      assert.equal(detailBuiltIn.height, 'auto', 'height must follow the constrained width instead of squeezing the portrait');
      assert.doesNotMatch(style(window.document.querySelector('.community-shop-detail-art .community-holo.is-uploaded')!).transform, /\brotate\(/, 'details also preserve the uploaded image direction');
    } finally { window.close(); }
  });

  test(`${theme}: exchange and owned looks keep compact tracks even when a category has few items`, async () => {
    const mine: CommunityShopMine = { balance: 1000, inventory: shop.inventory, decorations: shop.decorations,
      looks: shop.items.filter(item => item.id === 'frame-gold'), digital: [], orders: [] };
    const { window, style } = await fixture(theme, communityShopHTML({ shop: { state: 'ready', data: shop }, tab: 'all', ...common }) + communityShopMineHTML({ mine: { state: 'ready', data: mine }, ...common }));
    try {
      for (const grid of window.document.querySelectorAll('.community-shop-grid, .community-inv-grid')) {
        const columns = style(grid).gridTemplateColumns;
        assert.doesNotMatch(columns, /1fr/, 'a short category must not stretch its cards across the whole row');
        assert.match(columns, grid.classList.contains('community-shop-grid') ? /208px/ : /176px/,
          'merchandise cards gain readable width while the owned inventory retains its compact layout');
        assert.equal(style(grid).alignItems, 'stretch', 'items in the same collection must share the row height');
        assert.equal(style(grid).gridAutoRows, '1fr', 'separate rows must follow the same height rule');
      }
      for (const art of window.document.querySelectorAll('.community-sitem-art, .community-inv .community-sart')) {
        const item = shop.items.find(candidate => candidate.id === (art as HTMLElement).dataset.id);
        assert.equal(style(art).height, item?.kind === 'card' ? '208px' : '112px', 'tool cards are legible without enlarging other merchandise or owned inventory');
      }
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
        const title = card.querySelector<HTMLElement>('.community-sitem-title')!;
        assert.equal(title.getAttribute('aria-haspopup'), 'dialog');
        assert.equal(card.querySelector('details'), null, 'long explanations must not expand a card or its neighbours');
      }
    } finally { window.close(); }
  });

  test(`${theme}: item artwork fits its merchandise stage without clipping on hover`, async () => {
    const { window, style } = await fixture(theme, communityShopHTML({ shop: { state: 'ready', data: shop }, tab: 'all', ...common }));
    try {
      for (const selector of ['.community-sart .community-av-xl', '.community-cover-sample', '.community-holo', '.community-file', '.community-goods']) {
        const artwork = style(window.document.querySelector(selector)!);
        const limit = selector === '.community-holo' ? 176 : 96;
        assert.ok(parseFloat(artwork.height) <= limit, `${selector} leaves room for rotation and hover inside its own stage`);
        if (selector === '.community-holo') assert.ok(parseFloat(artwork.height) >= 160, 'the built-in tool card also fills the larger display instead of leaving its old tiny drawing');
        assert.ok(parseFloat(artwork.width) <= 140, `${selector} leaves horizontal breathing room`);
      }
    } finally { window.close(); }
  });
}

test('a listed portrait grows inside the wider card while its complete image and sheen stay aligned', async () => {
  const uploaded: CommunityShopItem = { ...shop.items.find(item => item.id === 'portrait-card')!, cat: 'card', kind: 'card', ref: 'makeup' };
  const { window, style } = await fixture('light', communityShopHTML({ shop: { state: 'ready', data: { ...shop, items: [uploaded] } }, tab: 'card', ...common }));
  try {
    const stage = style(window.document.querySelector('.community-sitem-art')!);
    const drawing = style(window.document.querySelector('.community-sart.is-uploaded-card')!);
    const grid = style(window.document.querySelector('.community-shop-grid')!);
    const track = Number(grid.gridTemplateColumns.match(/(\d+)px\)\)$/)?.[1]);
    assert.equal(track, 208, 'use the same category track for existing uploaded merchandise');
    // JSDOM misreports border widths when a shorthand contains CSS variables.
    // Read the literal thickness from the accepted cascade for this fit budget.
    const css = postcss.parse(await composeCommunityStyles());
    let itemBorder = '', stageBorder = '';
    css.walkRules('.community-sitem', rule => rule.walkDecls('border', declaration => { itemBorder = declaration.value; }));
    css.walkRules('.community-sitem-art', rule => rule.walkDecls('border-bottom', declaration => { stageBorder = declaration.value; }));
    const border = parseFloat(itemBorder), stageBorderWidth = parseFloat(stageBorder);
    assert.ok(Number.isFinite(border) && Number.isFinite(stageBorderWidth));
    const availableWidth = track - border * 2 - parseFloat(drawing.paddingLeft) - parseFloat(drawing.paddingRight);
    const availableHeight = parseFloat(stage.height) - stageBorderWidth - parseFloat(drawing.paddingTop) - parseFloat(drawing.paddingBottom);
    const aspect = .7;
    const fittedWidth = Math.min(availableWidth, availableHeight * aspect);
    const fittedHeight = fittedWidth / aspect;
    assert.ok(fittedWidth >= 130 && fittedHeight >= 185, 'widening only the outside must not leave the reported 111 by 159 portrait unchanged');
    assert.ok(fittedWidth * 1.035 < track - border * 2 && fittedHeight * 1.035 < parseFloat(stage.height) - stageBorderWidth, 'hover enlargement stays within the stage');
    assert.equal(style(window.document.querySelector('.community-holo.is-uploaded > img')!).objectFit, 'contain', 'the improvement must not crop the original image');
  } finally { window.close(); }
});

test('item descriptions live in a separate dialog while prices, limits, stock and actions stay visible in the collection', async () => {
  const { window } = await fixture('dark', communityShopHTML({ shop: { state: 'ready', data: shop }, tab: 'all', ...common }));
  try {
    const cards = [...window.document.querySelectorAll('.community-sitem')];
    assert.equal(cards.length, shop.items.length, 'all six kinds of merchandise remain available');
    for (const card of cards) {
      assert.equal(card.querySelector('details'), null);
      const title = card.querySelector<HTMLButtonElement>('h3 .community-sitem-title')!;
      assert.ok(title);
      assert.equal(title.dataset.action, 'community-shop-detail');
      assert.equal(title.getAttribute('aria-haspopup'), 'dialog');
      assert.equal(card.querySelector('.community-sitem-art')!.getAttribute('aria-haspopup'), 'dialog');
      for (const control of card.querySelectorAll('.community-price, .community-stags, .community-stock, .community-sitem-foot button')) assert.equal(control.closest('details'), null, 'purchase conditions stay visible in the collection');
    }
    assert.ok(window.document.querySelector('[data-action="community-equip"][data-kind="frame"][data-ref=""]'));
    assert.ok(window.document.querySelector<HTMLButtonElement>('.community-sitem-foot button:disabled'));
    assert.match(window.document.querySelector('.community-stock')!.textContent!, /剩 3 \/ 10/);
    const popup = window.document.createElement('div');
    popup.innerHTML = communityShopDetailHTML({ item: shop.items.find(item => item.id === 'guide')!, shop, showPrice: true, common });
    assert.equal(popup.querySelector('.community-shop-detail-description')!.textContent, '完整使用说明与 <参数> 示例。', 'descriptions keep escaped content');
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

test('tool-card hover preserves its presentation angle without changing inventory drawing or interactions', async () => {
  const css = postcss.parse(await composeCommunityStyles());
  const declarations = new Map<string, Map<string, string>>();
  css.walkRules(rule => {
    if (rule.parent?.type === 'atrule') return;
    const values = new Map<string, string>(); rule.walkDecls(d => values.set(d.prop, d.value)); declarations.set(rule.selector, values);
  });
  const hover = [...declarations].find(([selector]) => selector.includes('.community-sitem:hover .community-sitem-art.is-tool-card .community-holo:not(.is-uploaded)'));
  assert.ok(hover, 'the hover rule is scoped to the actual tool-card list and its detail view');
  assert.ok(hover[0].includes('.community-shop-detail-art:is(:hover, :focus-visible)'));
  assert.ok(hover[0].includes('.community-sitem-art.is-tool-card:focus-visible'));
  assert.match(hover[1].get('transform') || '', /\brotate\(5deg\).*scale\(1\.035\)/, 'hover and keyboard focus retain the rightward tilt and share the uploaded-card enlargement');
  const inventory = declarations.get('.community-inv:hover .community-holo')!;
  assert.ok(inventory, 'the existing inventory interaction remains independent');
  assert.match(inventory.get('transform') || '', /scale\(1\.06\)/);
  assert.doesNotMatch(inventory.get('transform') || '', /\brotate\(/);
  const base = declarations.get('.community-holo')!;
  assert.equal(base.get('width'), '72px'); assert.equal(base.get('height'), '92px');
  assert.match(base.get('transform') || '', /\brotate\(-6deg\)/, 'other inventory artwork retains its existing orientation');
});

test('narrow screens retain compact artwork and stack complete product details within the viewport', async () => {
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
  assert.match(narrow.get('.community-shop-grid')?.get('grid-template-columns') || '', /repeat\(2, minmax\(0, 208px\)\)/);
  const toolCard = narrow.get('.community-sitem-art.is-tool-card .community-holo:not(.is-uploaded)');
  const widthBudget = toolCard?.get('width')?.match(/^min\(([\d.]+)px, ([\d.]+)%\)$/);
  assert.ok(widthBudget, 'a narrow track must scale the built-in drawing instead of clipping its fixed width');
  assert.equal(toolCard?.get('height'), 'auto', 'the portrait height follows the constrained width');
  assert.equal(toolCard?.get('aspect-ratio'), '7 / 10');
  const angle = 5 * Math.PI / 180;
  for (const trackWidth of [100, 132, 156, 208]) {
    const width = Math.min(Number(widthBudget[1]), trackWidth * Number(widthBudget[2]) / 100);
    const height = width * 10 / 7;
    const projectedWidth = (width * Math.cos(angle) + height * Math.sin(angle)) * 1.035;
    assert.ok(projectedWidth < trackWidth - 8, `the complete tilted drawing fits the ${trackWidth}px mobile track on hover`);
  }
  assert.equal(narrow.get('.community-sitem-art')?.get('height'), undefined, 'mobile must not restore the old 156px stage');
  assert.equal(narrow.get('.community-sitem-art .community-sart')?.get('transform'), undefined, 'individual objects now have the correct dimensions without shrinking their text again');
  assert.equal(narrow.get('.community-sitem-body p')?.get('-webkit-line-clamp'), undefined, 'opening a description must reveal all of it');
  assert.equal(narrow.get('.community-shop-detail-content')?.get('grid-template-columns'), 'minmax(0, 1fr)', 'phone details use one column');
  assert.equal(narrow.get('.community-shop-detail-window')?.get('max-height'), 'calc(100dvh - 24px)', 'long text stays within a scrollable popup');
  assert.equal(narrow.get('.community-shop-detail-art')?.get('--tool-card-stage-height'), 'min(280px, 35dvh)', 'the complete card and its proportional drawing share the screen with the description');
  assert.equal(narrow.get('.community-inv .community-sart')?.get('height'), '48px', 'the existing mobile inventory remains a compact row');
});

test('uploaded portraits and landscape artworks have a bounded, shrinkable grid cell and contain their complete image', async () => {
  const css = postcss.parse(await composeCommunityStyles());
  const declarations = new Map<string, Map<string, string>>();
  css.walkRules(rule => {
    if (rule.parent?.type === 'atrule') return;
    const values = new Map<string, string>(); rule.walkDecls(d => values.set(d.prop, d.value)); declarations.set(rule.selector, values);
  });
  const art = declarations.get('.community-sitem-art')!;
  assert.equal(art.get('grid-template-rows'), 'minmax(0, 1fr)', 'intrinsic portrait height must not grow the grid row behind the clip');
  for (const selector of ['.community-sitem-art > .community-product-image', '.community-shop-detail-art > .community-product-image']) {
    const image = declarations.get(selector)!;
    assert.equal(image.get('object-fit'), 'contain');
    assert.equal(image.get('min-height'), '0');
    assert.equal(image.get('max-height'), '100%');
    assert.equal(image.get('max-width'), '100%');
  }
  assert.equal(declarations.has('.community-sitem-details > summary'), false, 'the superseded expansion styles must be removed');
});

test('only genuine uploaded tool cards keep the holo material around their complete artwork', async () => {
  const portrait = shop.items.find(item => item.id === 'portrait-card')!;
  const card: CommunityShopItem = { ...portrait, id: 'actual-card', cat: 'card', kind: 'card', ref: 'makeup', name: '补签卡' };
  const cover: CommunityShopItem = { ...portrait, id: 'photo-cover', cat: 'look', kind: 'cover', ref: `image:${portrait.image}` };
  const data = { ...shop, items: [card, portrait, cover] };
  const { window, style } = await fixture('light', communityShopHTML({ shop: { state: 'ready', data }, tab: 'all', ...common }));
  try {
    const artwork = window.document.querySelector('[data-id="actual-card"].community-sitem-art')!;
    assert.equal(style(artwork).height, '208px', 'the full portrait gets a larger stage instead of being cropped to simulate enlargement');
    const holo = artwork.querySelector<HTMLElement>('.community-holo.is-uploaded')!;
    assert.ok(holo, 'an uploaded PNG must not bypass the original holographic card renderer');
    assert.ok(holo.hasAttribute('data-community-card-art'));
    assert.match(holo.getAttribute('style') || '', /--card-image:\s*url\(['"]?\/api\/community\/images\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\.webp/);
    assert.equal(holo.querySelector('img')!.getAttribute('src'), '/api/community/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp');
    for (const id of ['portrait-card', 'photo-cover']) {
      const ordinary = window.document.querySelector(`[data-id="${id}"].community-sitem-art`)!;
      assert.equal(ordinary.querySelector('.community-holo'), null, 'a card name or photograph does not grant card effects');
      assert.equal(style(ordinary).height, '112px', 'ordinary photos retain the existing compact layout');
    }
    const popup = window.document.createElement('div');
    popup.innerHTML = communityShopDetailHTML({ item: card, shop: data, showPrice: true, common });
    assert.ok(popup.querySelector('.community-shop-detail-art .community-holo.is-uploaded'));
    assert.equal(popup.querySelector('.community-shop-detail-art')!.getAttribute('tabindex'), '0', 'the detail artwork has a keyboard focus state too');
  } finally { window.close(); }
});

test('reduced motion removes uploaded-card transforms from both collection and detail', async () => {
  const portrait = shop.items.find(item => item.id === 'portrait-card')!;
  const item: CommunityShopItem = { ...portrait, cat: 'card', kind: 'card', ref: 'makeup' };
  const data = { ...shop, items: [item] };
  const css = postcss.parse(await composeCommunityStyles());
  css.walkAtRules('media', media => {
    if (media.params === '(prefers-reduced-motion: reduce)') media.replaceWith(...media.nodes);
    else media.remove();
  });
  const content = communityShopHTML({ shop: { state: 'ready', data }, tab: 'card', ...common })
    + communityShopDetailHTML({ item, shop: data, showPrice: true, common });
  const { window } = new JSDOM(`<style>${css}</style><body class="community-open community-frame-open" data-community-theme="light">${content}</body>`, { url: 'http://localhost:4225/' });
  try {
    const artworks = window.document.querySelectorAll('.community-holo.is-uploaded');
    assert.equal(artworks.length, 2);
    for (const art of artworks) assert.equal(window.getComputedStyle(art).transform, 'none', 'the normal scoped transform must not override the reduced-motion state');
  } finally { window.close(); }
});

test('uploaded holo sheen uses the image alpha with bounded tilt and respects reduced motion', async () => {
  const css = postcss.parse(await composeCommunityStyles());
  const declarations = new Map<string, Map<string, string>>();
  css.walkRules(rule => {
    if (rule.parent?.type === 'atrule') return;
    const values = new Map<string, string>(); rule.walkDecls(d => values.set(d.prop, d.value)); declarations.set(rule.selector, values);
  });
  const uploaded = declarations.get('.community-holo.is-uploaded')!;
  assert.ok(uploaded);
  assert.equal(uploaded.get('background'), 'transparent'); assert.equal(uploaded.get('box-shadow'), 'none');
  assert.equal(uploaded.get('max-width'), '100%'); assert.equal(uploaded.get('max-height'), '100%');
  const image = declarations.get('.community-holo.is-uploaded > .community-product-image')!;
  assert.equal(image.get('object-fit'), 'contain'); assert.equal(image.get('min-height'), '0');
  const mask = declarations.get('.community-holo.is-uploaded::before, .community-holo.is-uploaded::after')!;
  assert.equal(mask.get('mask-image'), 'var(--card-image)'); assert.equal(mask.get('mask-size'), 'contain');
  assert.equal(mask.get('mask-repeat'), 'no-repeat'); assert.equal(mask.get('mask-mode'), 'alpha');
  assert.equal(mask.get('pointer-events'), 'none');
  assert.match(declarations.get('.community-holo::before')!.get('animation') || '', /community-holo 4s linear infinite/);
  let reduced = false;
  css.walkAtRules('media', media => {
    if (media.params !== '(prefers-reduced-motion: reduce)') return;
    media.walkRules(rule => {
      if (!rule.selector.includes('.community-holo.is-uploaded')) return;
      rule.walkDecls('transform', declaration => { if (declaration.value === 'none') reduced = true; });
    });
  });
  assert.equal(reduced, true, 'reduced-motion cards never tilt or scale');
});
