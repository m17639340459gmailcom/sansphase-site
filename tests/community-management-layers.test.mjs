import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { JSDOM } from 'jsdom';
import { communityManageHTML } from '../src/community-pages.mjs';
import { composeCommunityStyles } from '../scripts/compose-community-styles.mjs';
import { composeSiteStyles } from '../scripts/compose-site-styles.mjs';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const viewer = { name: '無相', uid: 'owner', role: 'owner', owner: true, mod: true };
const data = { owner: true, counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 0, replies24h: 0 }, queue: { topics: [], replies: [] }, reports: [], orders: [], items: [], sanctions: [], data: null };

async function fixture() {
  const sources = await Promise.all([
    composeSiteStyles(), readFile('src/library-home.css', 'utf8'),
    readFile('src/blog-background.css', 'utf8'), composeCommunityStyles(),
  ]);
  // Keep the real selector cascade and stacking declarations. JSDOM supplies
  // computed styles, but does not composite pixels or resolve viewport queries.
  const properties = new Set(['position', 'z-index', 'transform', 'opacity', 'isolation', 'contain', 'visibility', 'display']);
  const layers = [];
  for (const source of sources) postcss.parse(String(source)).walkRules(rule => {
    if (rule.parent.type !== 'root') return;
    const declarations = rule.nodes.filter(node => node.type === 'decl' && properties.has(node.prop));
    if (declarations.length) layers.push(`${rule.selector}{${declarations.map(node => node.toString()).join(';')}}`);
  });
  const dom = new JSDOM(await readFile('src/index.html', 'utf8'), { url: 'http://localhost/#/community/manage' });
  // setupStage() in app.mjs inserts the fixed homepage between the backdrop
  // and main. Include it: index.html alone misses this competing background.
  const stage = dom.window.document.createElement('div'); stage.id = 'home-stage'; stage.className = 'universe-home is-covered';
  stage.inert = true; stage.setAttribute('aria-hidden', 'true');
  dom.window.document.getElementById('main').before(stage);
  const style = dom.window.document.createElement('style'); style.textContent = layers.join('\n');
  dom.window.document.head.append(style);
  return dom;
}

test('management content stays above the full-page background in both themes and loading states', async () => {
  const dom = await fixture(), { document } = dom.window;
  try {
    const main = document.getElementById('main'), backdrop = document.getElementById('blog-backdrop');
    for (const theme of ['light', 'dark']) for (const manage of [{ state: 'loading' }, { state: 'ready', data }]) {
      document.body.className = 'content-open community-open community-management-open';
      document.body.dataset.communityTheme = theme;
      main.innerHTML = communityManageHTML({ ...common, me: viewer, manage, tab: 'queue' });
      assert.ok(main.querySelector('.community-management-nav'));
      assert.ok(main.querySelector('.community-management-content'));
      const backgroundLevel = Number(dom.window.getComputedStyle(backdrop).zIndex || 0);
      const mainLevel = dom.window.getComputedStyle(main).zIndex;
      assert.equal(dom.window.getComputedStyle(main).position, 'relative');
      const contentLevel = mainLevel === 'auto' ? 0 : Number(mainLevel || 0);
      assert.ok(backgroundLevel <= contentLevel, `${theme}/${manage.state}: the background cannot cover the management workspace`);
      if (backgroundLevel === contentLevel) assert.ok(backdrop.compareDocumentPosition(main) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'equal-level background precedes the positioned content');
      const stage = dom.window.getComputedStyle(document.getElementById('home-stage'));
      assert.ok(stage.visibility === 'hidden' || stage.display === 'none' || stage.opacity === '0', `${theme}: the covered homepage cannot replace the community background`);
    }
  } finally { dom.window.close(); }
});

test('management reason dialogs cover the header without an ancestor stacking context', async () => {
  const dom = await fixture(), { document } = dom.window;
  try {
    document.body.className = 'content-open community-open community-management-open';
    const main = document.getElementById('main');
    main.innerHTML = communityManageHTML({ ...common, me: viewer, manage: { state: 'ready', data }, tab: 'queue', rejecting: 'batch', selectedReviews: ['p1'] });
    const dialog = main.querySelector('.community-management-dialog'); assert.ok(dialog);
    assert.ok(Number(dom.window.getComputedStyle(dialog).zIndex) > Number(dom.window.getComputedStyle(document.getElementById('site-header')).zIndex));
    for (let ancestor = dialog.parentElement; ancestor !== document.body; ancestor = ancestor.parentElement) {
      const style = dom.window.getComputedStyle(ancestor);
      assert.ok(!style.zIndex || style.zIndex === 'auto', `${ancestor.id || ancestor.className} must not trap the dialog below the header`);
      assert.ok(!style.transform || style.transform === 'none');
      assert.ok(!style.isolation || style.isolation === 'auto');
      assert.ok(!style.opacity || Number(style.opacity) === 1);
    }
  } finally { dom.window.close(); }
});

test('ordinary community and blog keep their original background and content layers', async () => {
  const dom = await fixture(), { document } = dom.window;
  try {
    for (const classes of ['content-open community-open community-frame-open', 'content-open blog-open']) {
      document.body.className = classes;
      assert.equal(dom.window.getComputedStyle(document.getElementById('blog-backdrop')).zIndex, '1');
      assert.equal(dom.window.getComputedStyle(document.getElementById('main')).zIndex, '2');
      assert.notEqual(dom.window.getComputedStyle(document.getElementById('home-stage')).visibility, 'hidden');
    }
  } finally { dom.window.close(); }
});
