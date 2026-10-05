import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { communityHeaderHTML, communityBoards } from '../src/community.ts';
import { communityRulesHTML } from '../src/community-pages.ts';
import { communityRules } from '../src/community-rules.ts';
import { createFeedShell } from '../src/community-layout/feed-shell.ts';
import { publicRoute } from '../src/access-policy.ts';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & { close(): void; MutationObserver: typeof MutationObserver } } };
const common = { t: (zh: string, _en: string) => zh, esc: (value: unknown = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };

test('the convention remains inside the logged-in community boundary', async () => {
  assert.equal(publicRoute('community'), false);
  assert.equal(publicRoute('post'), false);
  const app = await readFile(new URL('../src/app.mjs', import.meta.url), 'utf8');
  assert.match(app, /!publicRoute\(route\.page\)/);
});

test('the member convention has numbered sections, board guidance and accurate account, exchange and enforcement limits', t => {
  const dom = new JSDOM(communityRulesHTML(common));
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.equal(doc.querySelector('h1')?.textContent, '社区公约');
  assert.equal(doc.querySelectorAll('.community-rule-section').length, 6);
  assert.equal(doc.querySelectorAll('.community-rule-section h2').length, 6);
  assert.equal(new Set(Array.from(doc.querySelectorAll('.community-rule-section')).map(node => node.id)).size, 6);
  for (const board of communityBoards) assert.ok(doc.querySelector(`a[href="#/community/boards/${board.id}"]`));
  const text = doc.body.textContent || '';
  assert.match(text, /2 MiB[\s\S]*VIP/);
  assert.match(text, /六个自然月[\s\S]*帖子[\s\S]*星尘/);
  assert.match(text, /取消待发货订单[\s\S]*退还星尘/);
  assert.match(text, new RegExp(`违规删除[\\s\\S]*${communityRules.penalty}`));
  assert.match(text, /自行删除[\s\S]*不等同/);
  assert.match(text, /禁言期间[\s\S]*不能/);
  assert.doesNotMatch(text, /最终解释权|保证追回全部|兑换后不能退回|冻结余额|注册满 60 天/);
  assert.ok(doc.querySelector('a[href="#/community/stardust/rules"]'));
  assert.equal(doc.querySelector<HTMLAnchorElement>('a[href="https://qm.qq.com/q/l4344ltsBi"]')?.rel, 'noopener noreferrer');
  assert.equal(doc.querySelector('[data-action="community-agree"]'), null, 'consent belongs to the timed dialog');
});

test('the mobile community navigation exposes the same convention address', () => {
  const html = communityHeaderHTML({ view: 'rules', actionsHTML: '', ...common });
  assert.match(html, /class="community-nav-guidelines" href="#\/community\/rules" aria-current="page">社区公约/);
});

test('the convention link moves to the auxiliary rail and returns to the mobile menu as the same node', t => {
  const header = communityHeaderHTML({ view: 'home', actionsHTML: '', ...common });
  const dom = new JSDOM(`<header id="site-header">${header}</header><section id="frame"><div class="community-layout"><div class="community-main"><a class="community-post" href="#/community/new">发帖</a></div></div></section>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const original = doc.body.innerHTML;
  const link = doc.querySelector<HTMLAnchorElement>('.community-nav-guidelines')!;
  const callbacks = new Set<EventListener>();
  const media = { matches: false, addEventListener: (_name: string, fn: EventListener) => { callbacks.add(fn); }, removeEventListener: (_name: string, fn: EventListener) => { callbacks.delete(fn); } };
  const shell = createFeedShell(doc.querySelector<HTMLElement>('#frame')!, { matchMedia: () => media });
  t.after(() => shell.release());
  link.focus();
  shell.sync();
  const rail = doc.querySelector('.community-feed-rail')!;
  assert.equal(rail.querySelector(':scope > .community-nav-guidelines'), link);
  assert.equal(link.previousElementSibling?.className, 'community-feed-rail-compose');
  assert.equal(link.nextElementSibling?.className, 'community-feed-return');
  assert.equal(doc.querySelector('#navigation .community-nav-guidelines'), null);
  const observer = new dom.window.MutationObserver(() => {});
  observer.observe(rail, { childList: true, subtree: true, attributes: true });
  shell.sync();
  assert.equal(observer.takeRecords().length, 0, 'stable synchronization does not move links or redraw attributes');
  observer.disconnect();
  assert.equal(doc.querySelectorAll('a[href="#/community/rules"]').length, 1);
  media.matches = true;
  for (const fn of callbacks) fn(new Event('change'));
  assert.equal(doc.body.innerHTML, original);
  assert.equal(doc.activeElement, link);
});

test('an in-place navigation rebuild replaces the borrowed convention link without leaving a duplicate', t => {
  const header = communityHeaderHTML({ view: 'home', actionsHTML: '', ...common });
  const dom = new JSDOM(`<header id="site-header">${header}</header><section id="frame"><div class="community-layout"><div class="community-main"></div></div></section>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const media = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  const nav = doc.querySelector<HTMLElement>('#navigation')!;
  const original = nav.innerHTML;
  const old = nav.querySelector('.community-nav-guidelines')!;
  const shell = createFeedShell(doc.querySelector<HTMLElement>('#frame')!, { matchMedia: () => media });
  shell.sync();
  nav.innerHTML = original;
  const replacement = nav.querySelector('.community-nav-guidelines')!;
  shell.sync();
  assert.equal(old.isConnected, false);
  assert.equal(doc.querySelectorAll('.community-nav-guidelines').length, 1);
  assert.equal(doc.querySelector('.community-feed-rail > .community-nav-guidelines'), replacement);
  shell.release();
  assert.equal(nav.querySelector('.community-nav-guidelines'), replacement);
  assert.equal(nav.innerHTML, original);
});
