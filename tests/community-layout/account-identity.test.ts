import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import postcss from 'postcss';
import { communityAccountHTML, type CommunityMe } from '../../src/community.ts';
import { composeCommunityStyles } from '../../scripts/compose-community-styles.mjs';

interface TestWindow extends Window { close(): void }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string) => { window: TestWindow };
};
const common = { t: (zh: string) => zh, esc: (value: unknown = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!),
  icons: { 'chevron-down': '<svg class="ui-icon" aria-hidden="true"></svg>' } };
const me: CommunityMe = { name: '八个字的测试昵称', uid: '10009', role: 'reader', staffRole: 'general', vip: true, level: 3,
  growth: { level: 10, points: 72000, configured: true }, owner: false, mod: true, balance: 0, checkedIn: true, streak: 1,
  nextReward: { total: 1, bonus: 0 }, gainedToday: 0, behaviourToday: 0, dailyCap: 6, agreed: true,
  unread: { all: 0, reply: 0, thanks: 0, system: 0 }, inventory: { makeup: 0, pin: 0, highlight: 0 }, muted: null };

async function cssAt(width: number) {
  const base = await Promise.all(['styles-foundation.css', 'styles-reading.css', 'styles-content.css', 'styles-blog.css', 'styles-controls.css'].map(file => readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8')));
  const sheet = postcss.parse(base.join('\n') + '\n' + await composeCommunityStyles());
  sheet.walkAtRules('media', rule => {
    const max = /max-width:\s*(\d+)px/.exec(rule.params), min = /min-width:\s*(\d+)px/.exec(rule.params);
    if ((!max && !min) || max && width > Number(max[1]) || min && width < Number(min[1])) rule.remove();
    else rule.replaceWith(...rule.nodes!);
  });
  sheet.walkAtRules('container', rule => rule.remove());
  return sheet.toString();
}

test('long account nicknames keep their full accessible name alongside fixed decorations', () => {
  for (const name of [me.name, 'AbcDefGh', '旧资料保留的特别长昵称用于检验省略', '<昵称"&>']) {
    const { window } = new JSDOM(communityAccountHTML({ ...common, me: { ...me, name } }));
    try {
      const button = window.document.querySelector<HTMLButtonElement>('.account-button')!;
      assert.equal(button.title, name);
      assert.ok(button.getAttribute('aria-label')!.includes(name));
      assert.equal(button.querySelector('.community-uname')!.textContent, name);
      assert.equal(button.querySelectorAll('.community-level-badge').length, 1);
      assert.equal(button.querySelectorAll('.community-staff-frame').length, 1);
      assert.equal(window.document.querySelector('.community-menu-head b')!.getAttribute('title'), name);
      assert.equal(window.document.querySelector('昵称'), null, 'nickname text cannot inject markup');
    } finally { window.close(); }
  }
});

test('formal header cascade reserves the actual frame size and a nickname column; mobile retains the avatar and menu arrow', async () => {
  for (const width of [1600, 1100, 761, 701, 641, 640, 390, 320]) {
    const { window } = new JSDOM(`<style>${await cssAt(width)}</style><body class="community-open community-frame-open"><header id="site-header" class="community-header"><div class="header-actions">${communityAccountHTML({ ...common, me })}</div></header></body>`);
    try {
      const doc = window.document, style = (selector: string) => window.getComputedStyle(doc.querySelector(selector)!);
      assert.equal(style('.account-button').display, 'inline-grid');
      if (width > 640) assert.match(style('.account-button').gridTemplateColumns, /minmax\(0,\s*1fr\)/);
      else assert.equal(style('.account-button').gridTemplateColumns, 'auto auto');
      assert.equal(style('.account-button .community-av.is-staff-frame').marginRight, '8px', '26px avatar reserves the frame’s additional 7.8px on each side');
      assert.equal(style('.account-button .community-name').display, width <= 640 ? 'none' : 'inline-grid');
      assert.notEqual(style('.account-button .community-av').display, 'none');
      assert.notEqual(style('.account-button > .ui-icon').display, 'none');
      assert.equal(style('.account-button .community-uname').textOverflow, 'ellipsis');
      assert.equal(style('.account-button .community-uname').whiteSpace, 'nowrap');
      assert.equal(parseFloat(style('.community-account').minWidth), 0);
      assert.equal(doc.querySelector('.account-button')!.getAttribute('aria-controls'), 'community-account-menu');
    } finally { window.close(); }
  }
});

test('a selected achievement fits the nickname slot instead of inheriting the large collection artwork size', async () => {
  const { window } = new JSDOM(`<style>${await cssAt(1100)}</style><body class="community-open"><header id="site-header" class="community-header"><div class="header-actions">${communityAccountHTML({ ...common, me: { ...me, icon: 'badge:attendance:aurora' } })}</div></header></body>`);
  try {
    const doc = window.document;
    assert.equal(window.getComputedStyle(doc.querySelector('.community-level-badge.is-badge')!).width, '26px');
    assert.equal(window.getComputedStyle(doc.querySelector('.community-level-badge.is-badge .community-badge-art')!).width, '100%');
    assert.equal(doc.querySelector('.account-button')!.querySelectorAll('[data-name-icon]').length, 1);
  } finally { window.close(); }
});
