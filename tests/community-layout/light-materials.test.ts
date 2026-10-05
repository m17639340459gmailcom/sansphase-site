import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import postcss from 'postcss';

const prefix = 'body.community-open:is(.community-frame-open, .community-management-open)[data-community-theme="light"]';
async function rules(file = 'appearance.css') {
  const result = new Map<string, Map<string, string>>();
  postcss.parse(await readFile(new URL(`../../src/community-layout/${file}`, import.meta.url), 'utf8')).walkRules(rule => {
    if (rule.parent?.type !== 'root') return;
    const values = new Map<string, string>();
    rule.walkDecls(declaration => { values.set(declaration.prop, declaration.value); });
    result.set(rule.selector, values);
  });
  return result;
}
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    assert.match(hex, /^#[a-f\d]{6}$/i);
    const [r, g, blue] = [1, 3, 5].map(offset => {
      const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    });
    return r! * .2126 + g! * .7152 + blue! * .0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + .05) / (values[1]! + .05);
}

test('all three exchange artwork contexts use light display surfaces and readable item labels', async () => {
  const css = await rules();
  const stage = css.get(`${prefix} :is(.community-sitem-art, .community-redeem-art, .community-inv .community-sart)`)!;
  assert.ok(stage, 'shop, confirmation and inventory must share the artwork palette');
  assert.match(stage.get('background')!, /gradient/);
  assert.match(stage.get('--community-art-top')!, /^#(?:d|e|f)/, 'light mode must not keep the previous dark display board');
  assert.equal(stage.get('color'), 'var(--text)', 'hologram names inherit the stage ink, not the page ink; changing variables alone does not change inherited color');
  for (const foreground of ['--text', '--dim', '--signal']) {
    for (const background of ['--community-art-top', '--community-art-base']) {
      assert.ok(contrast(stage.get(foreground)!, stage.get(background)!) >= 4.5, `${foreground} must remain readable inside the artwork`);
    }
  }
  const objects = css.get(`${prefix} :is(.community-holo, .community-goods)`)!;
  assert.ok(objects, 'the light stage and dark object use separate inks');
  assert.ok(objects.has('--signal'), 'holograms and goods retain luminous details inside the light display');
});

test('both nickname finishes and selected text remain readable on light surfaces', async () => {
  const css = await rules(), tokens = css.get(prefix)!;
  for (const token of ['--community-name-gold-shine', '--community-name-aurora']) {
    const colours = tokens.get(token)?.match(/#[a-f\d]{6}/gi) || [];
    assert.ok(new Set(colours).size >= 3, `${token} needs distinct shades rather than a flat colour`);
    for (const colour of colours) assert.ok(contrast(colour, tokens.get('--community-reading-card-bottom')!) >= 4.5, `${colour} must stay visible on paper`);
  }
  const selected = css.get(`${prefix} ::selection`)!;
  assert.ok(selected, 'selection must not inherit the main-site pale accent over paper');
  assert.ok(contrast(selected.get('color')!, selected.get('background')!) >= 4.5);
  assert.equal(selected.get('-webkit-text-fill-color'), selected.get('color'), 'selected gradient nicknames must use readable solid ink');
});

test('all member levels retain bright ink on the dark profile cover in light mode', async () => {
  const css = await rules(), cover = css.get(`${prefix} .community-m-intro`)!;
  // 85% #1b2b40 over a white cover is approximately #3d4b5d, the
  // brightest possible backing behind a profile identity mark.
  for (const name of ['--cm-lv0', '--cm-lv1', '--cm-lv2', '--cm-lv3', '--cm-lv4', '--cm-vip']) {
    assert.ok(cover.get(name), `${name} must not inherit dark paper ink on the cover`);
    assert.ok(contrast(cover.get(name)!, '#3d4b5d') >= 4.5);
  }
});

test('carousel caption and route heading have one compact gap while the banner keeps its fixed height', async () => {
  const css = await rules('stable-frame.css');
  const slot = css.get('.page.community-page[data-community-frame="stable"] [data-frame-showcase]')!;
  assert.equal(slot.get('min-height'), undefined, 'the track already reserves banner height; do not reserve a second caption height');
  const adjacent = css.get('.page.community-page[data-community-frame="stable"] [data-frame-showcase]:not([hidden]) + .community-frame-route')!;
  assert.ok(adjacent);
  assert.ok(parseFloat(slot.get('margin-bottom')!) + parseFloat(adjacent.get('padding-top')!) <= 24, 'caption-to-heading whitespace is limited to 24px');
});

test('light publishing uses a warm surface and the star field has visible tonal depth with soft edges', async () => {
  const css = await rules();
  const publish = css.get(`${prefix} :is(.community-post, .community-feed-rail-compose)`)!;
  assert.ok(publish);
  assert.ok(parseFloat(publish.get('border-radius')!) <= 12, 'publishing follows the smaller paper control shape');
  assert.match(publish.get('background')!, /gradient/);
  const haze = css.get(`${prefix} .community-star-map::before`)!;
  const opacities = [...haze.get('background')!.matchAll(/\/\s*(\d+)%/g)].map(match => Number(match[1]));
  assert.ok(opacities.filter(value => value >= 50).length >= 2, 'the astronomical haze must not dissolve into an almost plain paper field');
  assert.match(haze.get('mask-image')!, /transparent 100%/);
  assert.equal(css.get(`${prefix} .community-star-map`)?.get('background'), 'none', 'keep the canvas open rather than add a rectangular panel');
});
