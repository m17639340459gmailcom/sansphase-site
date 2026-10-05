import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { JSDOM } from 'jsdom';
import { communityHeaderHTML } from '../src/community.mjs';
import { communityManagementShellHTML } from '../src/community-management.mjs';

const common = { t: zh => zh, esc: value => String(value ?? ''), icons: {} };
const actions = '<button class="language">中 / EN</button><button class="account-button">無相</button><button class="menu-button" aria-controls="navigation">菜单</button>';

test('management has no duplicate header return or menu while retaining the sidebar exit for both roles', () => {
  for (const owner of [true, false]) {
    const header = communityHeaderHTML({ view: 'manage', actionsHTML: actions, ...common });
    const workspace = communityManagementShellHTML(owner, 'content', [['content', '#/community/manage/content', '帖子管理']], '<h1>社区管理</h1>', common);
    const dom = new JSDOM(`<header id="site-header">${header}</header><main>${workspace}</main>`);
    try {
      const doc = dom.window.document;
      assert.equal(doc.querySelector('#site-header nav'), null);
      assert.doesNotMatch(doc.querySelector('#site-header').textContent, /返回社区/);
      assert.equal(doc.querySelector('.community-brand').getAttribute('href'), '#/community/home');
      assert.ok(doc.querySelector('#site-header .language'));
      assert.ok(doc.querySelector('#site-header .account-button'));
      const exits = doc.querySelectorAll('.community-management-exits a[href="#/community/home"]');
      assert.equal(exits.length, 1);
      assert.equal(exits[0].textContent, '返回社区');
      assert.ok(doc.querySelector('.community-management-exits [data-action="community-browse-mode"]'));
    } finally { dom.window.close(); }
  }
});

test('management header keeps actions at the right and hides the menu without changing ordinary community headers', async () => {
  const properties = new Set(['display', 'grid-template-columns', 'justify-self']);
  const sources = await Promise.all(['styles-foundation.css', 'styles-content.css', 'community.css', 'community-management.css'].map(file => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')));
  for (const width of [1440, 760]) {
    // JSDOM does not evaluate viewport media queries. Select the actual source
    // rules for each viewport, then let its cascade compute the header styles.
    const css = sources.map(source => {
      const rules = [];
      postcss.parse(source).walkRules(rule => {
        if (rule.parent.type !== 'root') {
          const max = rule.parent.type === 'atrule' && rule.parent.name === 'media' && /^\(max-width:\s*(\d+)px\)$/.exec(rule.parent.params);
          if (!max || width > Number(max[1])) return;
        }
        const declarations = rule.nodes.filter(node => node.type === 'decl' && properties.has(node.prop));
        if (declarations.length) rules.push(`${rule.selector}{${declarations.map(node => node.toString()).join(';')}}`);
      });
      return rules.join('\n');
    }).join('\n');
    const dom = new JSDOM(`<style>${css}</style><body class="community-open community-management-open"><header id="site-header" class="community-header">${communityHeaderHTML({ view: 'manage', actionsHTML: actions, ...common })}</header></body>`);
    try {
      const { document, getComputedStyle } = dom.window;
      assert.equal(getComputedStyle(document.getElementById('site-header')).gridTemplateColumns, 'minmax(0, 1fr) auto');
      assert.equal(getComputedStyle(document.querySelector('.header-actions')).justifySelf, 'end');
      assert.equal(getComputedStyle(document.querySelector('.menu-button')).display, 'none');
      document.body.classList.remove('community-management-open');
      document.getElementById('site-header').innerHTML = communityHeaderHTML({ view: 'shop', actionsHTML: actions, ...common });
      assert.equal(getComputedStyle(document.getElementById('site-header')).gridTemplateColumns, width > 1200 ? 'minmax(0, 1fr) auto minmax(0, 1fr)' : 'minmax(0, 1fr) auto');
      assert.equal(getComputedStyle(document.querySelector('.menu-button')).display, width > 1200 ? 'none' : 'inline-grid');
      assert.equal(document.querySelector('#navigation a[aria-current="page"]').getAttribute('href'), '#/community/shop');
    } finally { dom.window.close(); }
  }
});
