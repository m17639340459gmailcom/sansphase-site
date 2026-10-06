import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityLevelExplorerHTML } from '../src/community-level-explorer.ts';
import { whoHTML } from '../src/community.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') };
const thresholds = [0, 1200, 3600, 7200, 13200, 21600, 31200, 43200, 56400, 72000];
const data = {
  owner: false, level: 1, vip: true,
  experienceCatalogue: thresholds.map((threshold, index) => ({ level: index + 1, threshold })),
  vipCatalogue: [2, 3, 4, 6, 8, 11, 15, 20].map((multiplier, index) => ({ level: index + 1, multiplier })),
  growth: { level: 1, points: 100, configured: true, startThreshold: 0, nextLevel: 2, nextThreshold: 1200, remaining: 1100, progress: 100 / 1200 },
  vipGrowth: { active: true, level: 3, days: 120, nextDays: 180, remaining: 60, multiplier: 4, progress: 1 / 3 },
};
const selection = (mode, level) => ({ mode, growth: mode === 'growth' ? level : null, trust: null, vip: mode === 'vip' ? level : null });
const doc = (value = data, mode = 'growth', level = 1) => new JSDOM(communityLevelExplorerHTML(value, common, selection(mode, level))).window.document;

test('growth displays server experience, next threshold, remaining and progress while browsing preserves actual experience', () => {
  for (const selected of [1, 5, 10]) {
    const page = doc(data, 'growth', selected);
    assert.equal(page.querySelector('[data-experience-current]').textContent, '100');
    assert.equal(page.querySelector('[data-experience-next]').textContent, '1,200');
    assert.equal(page.querySelector('[data-experience-remaining]').textContent, '1,100');
    assert.equal(page.querySelector('[data-experience-target]').textContent, thresholds[selected - 1].toLocaleString('en-US'));
    const bar = page.querySelector('[data-experience-progress]');
    assert.equal(Number(bar.getAttribute('aria-valuenow')), 8.3);
    assert.match(page.querySelector('[data-level-status]').textContent, /当前 星芽/);
    assert.doesNotMatch(page.body.textContent, /G(?:10|[1-9])\b|首次回答|首条有效回复|首个通过审核/);
    page.defaultView.close();
  }
});

test('unconfigured old stardust contribution points and owner account never fabricate settled experience', () => {
  for (const value of [{ ...data, growth: { level: 1, points: 37, configured: false } }, { ...data, owner: true, growth: null }]) {
    const page = doc(value);
    assert.equal(page.querySelector('[data-experience-current]'), null);
    assert.equal(page.querySelector('[data-experience-progress]'), null);
    assert.doesNotMatch(page.querySelector('[data-level-detail]').textContent, /37|当前经验\s*0/);
    page.defaultView.close();
  }
});

test('highest growth grade shows actual experience and completed progress without inventing another grade', () => {
  const page = doc({ ...data, growth: { level: 10, points: 72010, configured: true, startThreshold: 72000, nextLevel: null, nextThreshold: null, remaining: 0, progress: 1 } }, 'growth', 10);
  assert.equal(page.querySelector('[data-experience-current]').textContent, '72,010');
  assert.equal(page.querySelector('[data-experience-next]'), null);
  assert.equal(page.querySelector('[data-experience-progress]').getAttribute('aria-valuenow'), '100');
  assert.match(page.querySelector('[data-level-detail]').textContent, /已达到最高成长等级/);
  page.defaultView.close();
});

test('VIP progress belongs to actual rank while the selected rank shows its server multiplier', () => {
  const page = doc(data, 'vip', 8);
  assert.equal(page.querySelector('[data-vip-multiplier]').textContent, '20×');
  assert.match(page.querySelector('[data-level-status]').textContent, /VIP3/);
  assert.equal(page.querySelector('[data-vip-days]').textContent, '120');
  assert.equal(page.querySelector('[data-vip-next-days]').textContent, '180');
  assert.equal(page.querySelector('[data-vip-remaining]').textContent, '60');
  assert.equal(page.querySelector('[data-vip-progress]').getAttribute('aria-valuenow'), '33.3');
  page.defaultView.close();
});

test('expired VIP keeps recorded days but shows paused membership and no active multiplier', () => {
  const page = doc({ ...data, vip: false, vipGrowth: { ...data.vipGrowth, active: false, level: null, multiplier: 1 } }, 'vip', 3);
  assert.match(page.querySelector('[data-level-status]').textContent, /普通读者/);
  assert.match(page.querySelector('[data-level-detail]').textContent, /暂停/);
  assert.equal(page.querySelector('[data-vip-days]').textContent, '120');
  assert.equal(page.querySelector('[data-vip-progress]').hasAttribute('aria-valuenow'), false);
  page.defaultView.close();
});

test('missing or malformed server progress does not invent completion or print non-finite numbers', () => {
  const page = doc({ ...data, growth: { level: 1, points: Infinity, configured: true } });
  assert.equal(page.querySelector('[data-experience-current]').textContent, '—');
  assert.equal(page.querySelector('[data-experience-progress]').hasAttribute('aria-valuenow'), false);
  assert.doesNotMatch(page.body.textContent, /Infinity|NaN|已达到最高/);
  assert.match(page.body.textContent, /升级进度暂未提供/);
  page.defaultView.close();
});

test('shared nickname VIP icon uses the actual server rank and disappears after expiry', () => {
  const reader = { name: '读者', role: 'reader', uid: '10001', level: 1, growth: data.growth, vip: true, vipGrowth: data.vipGrowth };
  const page = new JSDOM(whoHTML(reader, common));
  assert.equal(page.window.document.querySelector('.is-vip [data-vip-art]').dataset.vipArt, '3');
  assert.equal(page.window.document.querySelector('.is-vip').getAttribute('aria-label'), 'VIP3');
  assert.doesNotMatch(whoHTML({ ...reader, vip: false, vipGrowth: { ...data.vipGrowth, active: false, level: null } }, common), /is-vip/);
  page.window.close();
});

test('missing personal growth rank or out-of-range VIP rank remains unknown rather than a fabricated grade', () => {
  const growthPage = doc({ ...data, growth: { points: 37, configured: true } });
  assert.match(growthPage.querySelector('[data-level-status]').textContent, /暂未提供/);
  assert.equal(growthPage.querySelector('[data-experience-current]'), null);
  const vipPage = doc({ ...data, vipGrowth: { ...data.vipGrowth, level: 99 } }, 'vip', 3);
  assert.doesNotMatch(vipPage.body.textContent, /VIP99/);
  assert.equal(vipPage.querySelector('[data-vip-progress]').hasAttribute('aria-valuenow'), false);
  const missingVIP = doc({ ...data, vipGrowth: { level: 1 } }, 'vip', 1);
  assert.match(missingVIP.querySelector('[data-level-detail]').textContent, /会员成长记录暂未提供/);
  assert.doesNotMatch(missingVIP.querySelector('[data-level-detail]').textContent, /会员成长已暂停/);
  missingVIP.defaultView.close();
  growthPage.defaultView.close(); vipPage.defaultView.close();
});
