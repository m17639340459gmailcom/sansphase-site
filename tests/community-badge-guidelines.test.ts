import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityRulesHTML } from '../src/community-pages.ts';
import { communityBadgeFamilies, communityBadgeTiers, communityBadgeCommonRules } from '../src/community-badge-policy.ts';

const esc = (value: unknown = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

test('badge lighting rules use the existing convention page and shared server policy in both languages', () => {
  for (const english of [false, true]) {
    const dom = new JSDOM(communityRulesHTML({ t: (zh, en) => english ? en : zh, esc }));
    try {
      const doc = dom.window.document, section = doc.querySelector('[data-badge-rules]');
      assert.ok(section);
      assert.equal(doc.querySelectorAll('.community-rule-section').length, 6, 'editable convention chapters stay intact');
      assert.equal(section.querySelectorAll('tbody tr').length, 6);
      assert.equal(section.querySelectorAll('thead th').length, 4);
      for (const family of communityBadgeFamilies) for (const tier of communityBadgeTiers) {
        assert.ok(section.textContent!.includes(english ? family.criteriaEn[tier] : family.criteria[tier]));
      }
      if (!english) for (const rule of communityBadgeCommonRules) assert.ok(section.textContent!.includes(rule));
      assert.match(section.textContent!, english ? /365.*180/ : /365.*180/);
      assert.equal(section.querySelector('button, input, [role="dialog"]'), null, 'reading rules needs no new popup or agreement control');
    } finally { dom.window.close(); }
  }
});

test('custom author convention remains intact; badge rules never alter the timed-consent body', () => {
  const dom = new JSDOM(communityRulesHTML({ t: zh => zh, esc, convention: { state: 'ready', data: { version: 'custom', body: '## 作者条例\n这是作者已发布的公约内容。' } } }));
  try {
    assert.match(dom.window.document.querySelector('.community-rule-list')!.textContent!, /作者条例.*作者已发布/);
    assert.doesNotMatch(dom.window.document.querySelector('.community-rule-list')!.textContent!, /星轨同行|落笔成星/);
    assert.equal(dom.window.document.querySelectorAll('[data-badge-rules]').length, 1);
  } finally { dom.window.close(); }
});
