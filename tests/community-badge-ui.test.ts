import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import { communityBadgeAtlasPosition } from '../src/community-badge-icons.ts';
import { communityBadgeExplorerHTML, createCommunityBadgeExplorer } from '../src/community-badge-explorer.ts';
import { communityBadgeFamilies, communityBadgeTiers } from '../src/community-badge-policy.ts';
import type { CommunityBadgeState } from '../src/community-badge-policy.ts';
import { badgeHTML } from '../src/community.ts';
import { communityCheckinHTML } from '../src/community-pages.ts';

const common = { t: (zh: string) => zh, esc: (value?: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') };
function state(): CommunityBadgeState {
  return { version: 1, families: communityBadgeFamilies.map(family => ({ id: family.id, tier: family.id === 'appreciation' ? 'diamond' : null, achievedAt: family.id === 'appreciation' ? '2026-09-01T00:00:00Z' : null,
    tiers: communityBadgeTiers.map(tier => ({ tier, achieved: family.id === 'appreciation' && tier !== 'aurora', achievedAt: family.id === 'appreciation' && tier !== 'aurora' ? '2026-09-01T00:00:00Z' : null, eligible: false, requirements: [{ key: 'count', label: '有效赞', labelEn: 'Valid likes', have: 320, need: tier === 'gold' ? 10 : tier === 'diamond' ? 300 : 1500, met: tier !== 'aurora' }], blockedReasons: [] })) })), legacy: [{ id: 'streak365', achievedAt: '2025-09-01T00:00:00Z', revokedAt: null }] };
}

test('approved atlas uses optical crops in six columns and three material rows', () => {
  for (let column = 0; column < 6; column++) for (const [row, tier] of communityBadgeTiers.entries()) {
    const position = communityBadgeAtlasPosition(column, tier);
    assert.equal(position.x, `${([143, 398, 643, 885, 1150, 1405][column] - 124) / (1536 - 248) * 100}%`);
    assert.equal(position.y, `${[50, 370, 683][row] / (1024 - 300) * 100}%`);
  }
  assert.throws(() => communityBadgeAtlasPosition(6, 'gold'), RangeError);
});

test('personal collection shows one actual highest award per family and preserves legacy without upgrading it', () => {
  const dom = new JSDOM(communityBadgeExplorerHTML(state(), ['streak365'], common));
  const doc = dom.window.document;
  const cards = [...doc.querySelectorAll<HTMLElement>('[data-badge-family-card]')];
  assert.equal(cards.length, 6);
  const appreciation = cards.find(card => card.dataset.badgeFamilyCard === 'appreciation')!;
  assert.equal(appreciation.dataset.tier, 'diamond');
  assert.equal(appreciation.dataset.earned, 'true');
  const attendance = cards.find(card => card.dataset.badgeFamilyCard === 'attendance')!;
  assert.equal(attendance.dataset.earned, 'false', 'a historic 365-day badge does not imply a new aurora award');
  assert.match(attendance.textContent!, /未获得/);
  assert.equal(doc.querySelectorAll('[data-badge-legacy="streak365"]').length, 1);
  assert.match(doc.querySelector('[data-badge-history]')!.textContent!, /历史/);
  assert.equal(doc.querySelector('input, select, [data-action="community-badge-earned"]'), null);
  dom.window.close();
});

test('material browsing updates the existing detail only and never changes actual awards', () => {
  const awards = state(), dom = new JSDOM(communityBadgeExplorerHTML(awards, ['streak365'], common));
  const doc = dom.window.document, root = doc.querySelector<HTMLElement>('[data-badge-explorer]')!;
  const card = root.querySelector<HTMLElement>('[data-badge-family-card="appreciation"]')!;
  const controller = createCommunityBadgeExplorer({ root: () => root, data: () => awards, common: () => common });
  controller.action(card);
  const selected = root.querySelector<HTMLElement>('[data-badge-tier="aurora"]')!;
  controller.action(selected);
  assert.equal(root.querySelector('[data-badge-detail]')!.getAttribute('data-tier'), 'aurora');
  assert.match(root.querySelector('[data-badge-detail]')!.textContent!, /未获得/);
  assert.equal(root.querySelector('[data-badge-family-card="appreciation"]'), card, 'the actual wall is never replaced by browsing');
  assert.equal(card.dataset.tier, 'diamond');
  assert.equal(awards.families.find(family => family.id === 'appreciation')!.tier, 'diamond');
  assert.equal(doc.activeElement, root.querySelector('[data-badge-tier="aurora"]'));
  controller.action(root.querySelector<HTMLElement>('[data-badge-tier="gold"]')!);
  assert.match(root.querySelector('[data-badge-detail]')!.textContent!, /已获得/);
  dom.window.close();
});

test('badge renderer keeps the legacy name and tier while family cards use the approved art', () => {
  const old = new JSDOM(badgeHTML('streak365', true, common, 'sm', true));
  assert.match(old.window.document.body.textContent!, /一整年/);
  assert.equal(old.window.document.querySelector('.community-badge')!.classList.contains('is-gold'), true);
  assert.equal(old.window.document.querySelector('[data-finish="aurora"]'), null, 'legacy awards cannot acquire the new aurora animation');
  const family = new JSDOM(badgeHTML('appreciation', true, common, 'lg', true, 'diamond'));
  assert.equal(family.window.document.querySelector('[data-badge-art="appreciation"]')!.getAttribute('data-finish'), 'diamond');
  assert.equal(family.window.document.querySelector('svg.ui-icon'), null);
  old.window.close(); family.window.close();
});

test('check-in shows two family awards and earned legacy records, with no fabricated fallback awards', () => {
  const dom = new JSDOM(communityCheckinHTML({ ...common, checkin: { state: 'ready', data: { checkedIn: false, streak: 365, balance: 0, gainedToday: 0, behaviourToday: 0, vip: false, month: '2026-09', days: [], checkinsToday: 0, earlyBirds: [], makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: [] }, badges: ['streak365'], badgeState: state() } } }));
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.community-ck-achievement[data-badge-family]').length, 2);
  assert.equal(doc.querySelector('.community-ck-achievement[data-badge-family="attendance"]')!.getAttribute('data-earned'), 'false');
  assert.equal(doc.querySelectorAll('[data-badge-legacy="streak365"]').length, 1);
  assert.equal(doc.querySelector('.community-ck-achievement svg.ui-icon'), null);
  dom.window.close();
});

test('aurora is masked inside the approved emblem and has theme-specific four-second reduced-motion styles', () => {
  const css = readFileSync(new URL('../src/community.css', import.meta.url), 'utf8');
  const light = readFileSync(new URL('../src/community-layout/appearance.css', import.meta.url), 'utf8');
  assert.match(css, /mask-image: url\('\/assets\/community\/badges\/badge-atlas\.png'\)/);
  assert.match(css, /animation: community-sheen 4s linear infinite/);
  assert.match(css, /\.community-badge-art\[data-finish="aurora"\]/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*community-badge-art[\s\S]*animation: none/);
  assert.match(css, /--cm-badge-aurora-start: #8fe3c8/);
  assert.match(light, /--cm-badge-aurora-start: #186a55/);
  const atlas = readFileSync(new URL('../public/assets/community/badges/badge-atlas.png', import.meta.url));
  assert.equal(atlas.readUInt32BE(16), 1536); assert.equal(atlas.readUInt32BE(20), 1024);
});

test('different requirement lengths keep the showcase height stable and let long conditions scroll within the detail', () => {
  const css = postcss.parse(readFileSync(new URL('../src/community.css', import.meta.url), 'utf8'));
  const baseRules = css.nodes.filter(node => node.type === 'rule');
  const declarations = (selector: string) => {
    const rule = baseRules.find(node => node.type === 'rule' && node.selector === selector);
    assert.ok(rule && rule.type === 'rule');
    return new Map(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  };
  assert.equal(declarations('.community-badge-showcase').get('height'), '434px');
  assert.equal(declarations('.community-badge-showcase').get('grid-template-rows'), '296px 136px');
  assert.equal(declarations('.community-badge-detail-copy').get('min-height'), '0');
  assert.equal(declarations('.community-badge-detail-copy').get('overflow-y'), 'auto');
  const narrow = css.nodes.find(node => node.type === 'atrule' && node.name === 'container' && node.params === 'community-badges (max-width: 600px)');
  assert.ok(narrow && narrow.type === 'atrule');
  const copy = narrow.nodes?.find(node => node.type === 'rule' && node.selector === '.community-badge-detail-copy');
  assert.ok(copy && copy.type === 'rule');
  assert.ok(copy.nodes.some(node => node.type === 'decl' && node.prop === 'height' && node.value === '350px'));
});

test('English condition browsing uses shared requirement translations and treats unknown labels as escaped text', () => {
  const awards = state(), requirement = awards.families[0].tiers[0].requirements[0];
  requirement.label = '<未知>'; requirement.labelEn = '<unknown>';
  const dom = new JSDOM(communityBadgeExplorerHTML(awards, [], { ...common, t: (_zh, en) => en }, { family: 'attendance', tier: 'gold' }));
  assert.match(dom.window.document.querySelector('[data-badge-detail]')!.textContent!, /Check-in achievement/);
  assert.match(dom.window.document.querySelector('.community-badge-requirements')!.textContent!, /<unknown>/);
  assert.equal(dom.window.document.querySelector('.community-badge-requirements unknown'), null);
  dom.window.close();
});
