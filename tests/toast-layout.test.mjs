import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { JSDOM } from 'jsdom';

const outerSelector = '[data-sonner-toaster].site-toaster[data-x-position="center"]';
const toastSelector = '[data-sonner-toaster].site-toaster [data-sonner-toast][data-styled="true"]';
const contentSelector = '[data-sonner-toaster].site-toaster [data-sonner-toast][data-styled="true"] [data-content]';
const textSelector = '[data-sonner-toaster].site-toaster [data-sonner-toast][data-styled="true"] :is([data-title], [data-description])';
const descriptionSelector = '[data-sonner-toaster].site-toaster [data-sonner-toast][data-styled="true"] [data-description]';
const sources = async () => ({ site: await readFile('src/styles-content.css', 'utf8'), vendor: await readFile('node_modules/sonner/dist/styles.css', 'utf8') });
const properties = (css, selector) => {
  const rule = css.nodes.find(node => node.type === 'rule' && node.selector === selector);
  assert.ok(rule, `the shared notification module owns ${selector}`);
  return Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
};

test('short notices use their text width within a centered viewport-safe envelope', async () => {
  const { site, vendor } = await sources();
  const css = postcss.parse(site);
  const outer = properties(css, outerSelector);
  const toast = properties(css, toastSelector);
  assert.equal(outer.width, 'min(360px, calc(100vw - 32px))');
  assert.equal(outer.left, '50%');
  assert.equal(outer.right, 'auto');
  assert.equal(outer.transform, 'translateX(-50%)', 'centering must also override Sonner’s mobile reset');
  assert.equal(toast.width, 'max-content');
  assert.equal(toast['max-width'], '100%');
  assert.equal(toast['min-width'], '0');
  assert.equal(toast.left, '50%');
  assert.equal(toast.right, 'auto');
  assert.equal(toast.translate, '-50% 0');
  assert.equal(toast.padding, '12px 16px');
  assert.equal(toast['min-height'], '44px');
  assert.equal(toast['border-radius'], '10px');
  const dom = new JSDOM(`<style>${vendor}\n${site}</style><ol data-sonner-toaster class="site-toaster" data-x-position="center"><li data-sonner-toast data-styled="true"><div data-content><div data-title>保存成功</div></div></li></ol>`);
  try {
    const style = dom.window.getComputedStyle(dom.window.document.querySelector('[data-sonner-toast]'));
    assert.equal(style.width, 'max-content', 'the vendor’s fixed --width no longer determines a short notice');
    assert.equal(style.maxWidth, '100%');
    assert.equal(style.translate, '-50% 0');
  } finally { dom.window.close(); }
});

test('long Chinese, English and URL messages may wrap without clipping text or expanding the envelope', async () => {
  const { site, vendor } = await sources();
  const css = postcss.parse(site);
  const content = properties(css, contentSelector);
  const text = properties(css, textSelector);
  assert.equal(content['min-width'], '0');
  assert.equal(text['white-space'], 'normal');
  assert.equal(text['overflow-wrap'], 'anywhere');
  assert.equal(text['max-width'], '100%');
  assert.ok(!('text-overflow' in text) && !('overflow' in text), 'important operation feedback must not be truncated');
  const dom = new JSDOM(`<style>${vendor}\n${site}</style><ol data-sonner-toaster class="site-toaster" data-x-position="center"><li data-sonner-toast data-styled="true"><div data-content><div data-title></div><div data-description></div></div></li></ol>`);
  try {
    for (const message of ['本板块推荐内容已经保存，其他板块和首页的内容保持独立。'.repeat(4), 'An operation could not be completed. Please try again when the connection is available.', 'https://example.invalid/' + 'a'.repeat(300)]) {
      const title = dom.window.document.querySelector('[data-title]');
      title.textContent = message;
      const style = dom.window.getComputedStyle(title);
      assert.equal(style.whiteSpace, 'normal');
      assert.equal(style.overflowWrap, 'anywhere');
      assert.equal(title.textContent, message);
    }
  } finally { dom.window.close(); }
});

test('the content centering leaves Sonner entry, stacking and exit transforms intact', async () => {
  const { site, vendor } = await sources();
  const css = postcss.parse(site);
  for (const rule of css.nodes.filter(node => node.type === 'rule' && node.selector.includes('[data-sonner-toast]'))) {
    for (const declaration of rule.nodes.filter(node => node.type === 'decl')) {
      assert.ok(!declaration.important);
      assert.ok(!['transform', '--y', 'opacity', 'height', 'transition', 'animation'].includes(declaration.prop), `the library still owns ${declaration.prop} on the animated toast`);
    }
  }
  const dom = new JSDOM(`<style>${vendor}\n${site}</style><ol data-sonner-toaster class="site-toaster" data-x-position="center"><li data-sonner-toast data-styled="true" data-y-position="top"><div data-content><div data-title>操作完成</div></div></li></ol>`);
  try {
    const toast = dom.window.document.querySelector('[data-sonner-toast]');
    for (const state of [
      { mounted: 'false', y: 'translateY(-100%)' },
      { mounted: 'true', y: 'translateY(0)' },
      { mounted: 'true', removed: 'true', front: 'true', swipeOut: 'false', y: 'translateY(calc(var(--lift) * -100%))' },
    ]) {
      for (const [name, value] of Object.entries(state)) if (name !== 'y') toast.dataset[name] = value;
      const style = dom.window.getComputedStyle(toast);
      assert.equal(style.transform, 'var(--y)');
      assert.equal(style.getPropertyValue('--y').replaceAll(/\s/g, ''), state.y.replaceAll(/\s/g, ''));
      assert.equal(style.translate, '-50% 0', 'content centering persists throughout the library’s animation');
    }
  } finally { dom.window.close(); }
});

test('notice descriptions inherit their theme ink instead of Sonner’s fixed dark-theme text', async () => {
  const { site, vendor } = await sources();
  const css = postcss.parse(site);
  assert.equal(properties(css, descriptionSelector).color, 'inherit');
  for (const color of ['rgb(235, 235, 240)', 'rgb(52, 67, 85)']) {
    const dom = new JSDOM(`<style>${vendor}\n${site}</style><ol data-sonner-toaster class="site-toaster" data-x-position="center" data-sonner-theme="dark"><li data-sonner-toast data-styled="true" style="color:${color}"><div data-content><div data-title>提示</div><div data-description>详细提示</div></div></li></ol>`);
    try {
      assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('[data-description]')).color, color);
    } finally { dom.window.close(); }
  }
});
