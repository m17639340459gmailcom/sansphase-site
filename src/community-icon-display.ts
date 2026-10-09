import { communityIconCatalogue, communityIconDefinition } from './community-icon-policy.mjs';
import type { CommunityIconDefinition, CommunityIconState } from './community-icon-policy.ts';
import { communityGrowthArtHTML, communityTrustArtHTML, communityVipArtHTML } from './community-growth-art.mjs';
import { communityStaffArtHTML } from './community-staff-art.mjs';
import { communityBadgeArtHTML } from './community-badge-icons.mjs';
import { communityBadgeTiers } from './community-badge-policy.mjs';
import type { BadgeFamilyId } from './community-badge-policy.ts';
import type { Common, CommunityPerson } from './community.ts';

export function communityIconArtHTML(icon: CommunityIconDefinition, animate = true): string {
  let artwork: string;
  switch (icon.kind) {
    case 'growth': artwork = communityGrowthArtHTML(icon.level, true); break;
    case 'trust': artwork = communityTrustArtHTML(icon.level, true); break;
    case 'vip': artwork = communityVipArtHTML(icon.level, true); break;
    case 'staff': artwork = communityStaffArtHTML(icon.role, 'badge'); break;
    case 'badge': artwork = communityBadgeArtHTML(icon.family, icon.tier); break;
  }
  // The catalogue is a static preview, not dozens of independently running SVGs.
  // These attributes are emitted only by our fixed, approved artwork renderers.
  return animate ? artwork : artwork.replace(/ data-(?:level-icon|staff-art)="[^"]*"/g, '').replace(/ decoding="async"/g, ' loading="lazy" decoding="async"');
}

const groups = [
  ['staff', '管理身份', 'Management roles'], ['vip', 'VIP 等级', 'VIP levels'],
  ['growth', '成长等级', 'Growth levels'], ['trust', '社区等级', 'Community levels'], ['badge', '成就图标', 'Achievement icons'],
] as const;
export type CommunityIconSelection = { kind: CommunityIconDefinition['kind'] };
export const communityIconCategory = (value: unknown) => groups.find(([kind]) => kind === value)?.[0];
export function communityIconBrowse(state: CommunityIconState, selection?: CommunityIconSelection) {
  const selected = communityIconDefinition(state.selected || state.equipped);
  const kind = selection?.kind ?? selected?.kind ?? 'growth';
  const highest = new Map<BadgeFamilyId, Extract<CommunityIconDefinition, { kind: 'badge' }>>();
  const available = new Set<string>(state.available);
  if (kind === 'badge') for (const ref of available) {
    const icon = communityIconDefinition(ref);
    if (icon?.kind !== 'badge') continue;
    const current = highest.get(icon.family);
    if (!current || communityBadgeTiers.indexOf(icon.tier) > communityBadgeTiers.indexOf(current.tier)) highest.set(icon.family, icon);
  }
  const items = communityIconCatalogue.filter(icon => icon.kind === kind && (icon.kind !== 'badge'
    || highest.get(icon.family)?.ref === icon.ref
    // Retain a saved, revoked choice in grey rather than implying it was never earned.
    || selected?.ref === icon.ref && !available.has(icon.ref)));
  return { kind, items };
}

/** Reconcile eligibility without detaching decoded artwork or the focused card. */
export function syncCommunityIconPanel(current: HTMLElement, next: HTMLElement, action: 'community-icon-equip' | 'community-frame-equip' = 'community-icon-equip'): boolean {
  const key = (button: HTMLButtonElement) => button.dataset.iconRef || button.dataset.iconMode || button.dataset.frameRef || '';
  const buttons = [...current.querySelectorAll<HTMLButtonElement>(`button[data-action="${action}"]`)];
  const replacements = [...next.querySelectorAll<HTMLButtonElement>(`button[data-action="${action}"]`)];
  if (!buttons.length || buttons.length !== replacements.length || buttons.some((button, i) => key(button) !== key(replacements[i]))) return false;
  buttons.forEach((button, i) => {
    const replacement = replacements[i];
    button.className = replacement.className;
    for (const name of ['aria-pressed', 'aria-label', 'data-icon-locked']) {
      const value = replacement.getAttribute(name);
      if (value === null) button.removeAttribute(name); else button.setAttribute(name, value);
    }
    button.disabled = replacement.disabled;
    const status = button.querySelector('.community-icon-choice-status');
    if (status) status.textContent = replacement.querySelector('.community-icon-choice-status')?.textContent ?? '';
    const label = button.querySelector('b');
    if (label) label.textContent = replacement.querySelector('b')?.textContent ?? '';
  });
  return true;
}

export function communityIconPanelHTML(_person: CommunityPerson, state: CommunityIconState | undefined, editable: boolean, common: Common, selection?: CommunityIconSelection): string {
  const { t, esc } = common;
  if (!state) return `<section class="community-card community-icon-panel" data-community-icons><h2>${t('图标', 'Icons')}</h2><p class="community-muted">${t('暂时无法读取佩戴资格，请重新加载。', 'Your icon eligibility could not be loaded. Please retry.')}</p><button type="button" class="community-button is-small" data-action="community-retry">${t('重新加载', 'Retry')}</button></section>`;
  const available = new Set<string>(state.available);
  const selected = state.selected === null ? state.equipped : state.selected;
  const browse = communityIconBrowse(state, selection), group = groups.find(([kind]) => kind === browse.kind)!;
  const action = (mode: 'default' | 'none', label: string) => `<button type="button" class="community-button is-small" data-action="community-icon-equip" data-icon-mode="${mode}" aria-pressed="${mode === 'default' ? state.selected === null : state.selected === ''}"${editable ? '' : ' disabled'}>${esc(label)}</button>`;
  return `<section class="community-card community-icon-panel" data-community-icons data-icon-kind="${browse.kind}" aria-label="${t('昵称图标', 'Nickname icons')}">`
    + `<div class="community-icon-toolbar"><div class="community-level-modes community-icon-categories" role="group" aria-label="${t('图标分类', 'Icon categories')}">${groups.map(([kind, zh, en]) => `<button type="button" data-action="community-icon-category" data-icon-category="${kind}" aria-pressed="${kind === browse.kind}" aria-controls="community-icon-collection">${esc(t(zh, en))}</button>`).join('')}</div><div class="community-icon-actions">${action('default', t('恢复默认', 'Use default'))}${action('none', t('不佩戴', 'Wear none'))}</div></div>`
    + `<div id="community-icon-collection" data-icon-collection><section class="community-icon-group" aria-label="${esc(t(group[1], group[2]))}"><div class="community-icon-grid">${browse.items.map(icon => {
      const allowed = available.has(icon.ref), chosen = selected === icon.ref, label = t(icon.name, icon.en);
      const status = !allowed ? chosen ? t('资格已失效', 'No longer eligible') : t('未获得或未生效', 'Not yet available') : chosen ? t('已佩戴', 'Equipped') : t('可佩戴', 'Available');
      return `<button type="button" class="community-icon-choice${chosen ? ' is-selected' : ''}" data-action="community-icon-equip" data-icon-ref="${esc(icon.ref)}" data-icon-locked="${!allowed}" aria-pressed="${chosen}" aria-label="${esc(`${label}，${status}`)}"${allowed && editable ? '' : ' disabled'}><span class="community-icon-choice-art is-${icon.kind}">${communityIconArtHTML(icon, false)}</span><b>${esc(label)}</b><span class="community-icon-choice-status">${esc(status)}</span></button>`;
    }).join('')}</div></section>`
    + `</div></section>`;
}
