import { communityBadgeFamilies, communityBadgeTiers } from './community-badge-policy.mjs';
import type { BadgeFamilyId, BadgeFamilyState, BadgeTier, CommunityBadgeState } from './community-badge-policy.ts';
import { communityBadges } from './community-rules.mjs';
import { communityBadgeArtHTML, legacyBadgeArtHTML } from './community-badge-icons.mjs';
import type { Common } from './community.ts';

export type CommunityBadgeSelection = { family: BadgeFamilyId | null; tier: BadgeTier | null };
const initial = (): CommunityBadgeSelection => ({ family: null, tier: null });
const tierNames = { gold: ['黄金', 'Gold'], diamond: ['钻石', 'Diamond'], aurora: ['炫彩', 'Aurora'] } as const;
const categoryNames: Record<BadgeFamilyId, string> = { attendance: 'Check-in achievement', early: 'Check-in achievement', writing: 'Content creation', appreciation: 'Community appreciation', answers: 'Helpful answers', featured: 'Featured creations' };
export const communityBadgeTierName = (tier: BadgeTier, { t }: Common) => t(tierNames[tier][0], tierNames[tier][1]);
export function communityBadgeFamilyState(state: CommunityBadgeState | null | undefined, id: BadgeFamilyId): BadgeFamilyState | null {
  return state?.families.find(item => item.id === id) || null;
}
function selected(state: CommunityBadgeState | null | undefined, selection: CommunityBadgeSelection) {
  const family = communityBadgeFamilies.find(item => item.id === selection.family) || communityBadgeFamilies.find(item => communityBadgeFamilyState(state, item.id)?.tier) || communityBadgeFamilies[0];
  const award = communityBadgeFamilyState(state, family.id);
  return { family, award, tier: selection.tier || award?.tier || 'gold' as BadgeTier };
}

export function communityBadgeLegacyHTML(ids: readonly string[], common: Common, state?: CommunityBadgeState | null) {
  const { esc, t } = common;
  const legacy = state ? state.legacy.filter(item => !item.revokedAt).map(item => item.id) : ids;
  const unique = [...new Set(legacy)].filter(id => communityBadges[id]);
  if (!unique.length) return '';
  return `<section class="community-badge-history" data-badge-history><h2>${esc(t('历史徽章', 'Historical badges'))}</h2><p>${esc(t('旧版荣誉保留在这里；新版系列按新的条件授予。', 'Earlier honors are kept here. New family awards use the current requirements.'))}</p><div class="community-badge-legacy-list">${unique.map(id => {
    const badge = communityBadges[id];
    const achievedAt = state?.legacy.find(item => item.id === id && !item.revokedAt)?.achievedAt;
    return `<div class="community-badge-legacy" data-badge-legacy="${esc(id)}">${legacyBadgeArtHTML(id)}<div><b>${esc(t(badge.name, badge.en))}</b><span>${esc(t(badge.desc, badge.descEn))}</span>${achievedAt ? `<time datetime="${esc(achievedAt)}">${esc(achievedAt.slice(0, 10))}</time>` : ''}</div></div>`;
  }).join('')}</div></section>`;
}

function galleryHTML(state: CommunityBadgeState | null | undefined, common: Common, selection: CommunityBadgeSelection) {
  const { family, award, tier } = selected(state, selection), { esc, t } = common;
  return `<div class="community-badge-finishes" data-badge-finishes role="group" aria-label="${esc(t('查看各材质条件', 'View material requirements'))}">${communityBadgeTiers.map(finish => {
    const achieved = award?.tiers.find(item => item.tier === finish)?.achieved === true;
    return `<button type="button" data-action="community-badge-tier" data-badge-tier="${finish}" aria-pressed="${finish === tier}" aria-label="${esc(t(`查看${family.name} · ${communityBadgeTierName(finish, common)}条件，${achieved ? '已获得' : '未获得'}`, `View ${family.en} · ${communityBadgeTierName(finish, common)} requirements, ${achieved ? 'earned' : 'not earned'}`))}">${communityBadgeArtHTML(family.id, finish)}<b>${esc(communityBadgeTierName(finish, common))}</b><span>${esc(achieved ? t('已获得', 'Earned') : t('未获得', 'Not earned'))}</span></button>`;
  }).join('')}</div>`;
}

function detailHTML(state: CommunityBadgeState | null | undefined, common: Common, selection: CommunityBadgeSelection) {
  const { family, award, tier } = selected(state, selection), { esc, t } = common;
  const stage = award?.tiers.find(item => item.tier === tier), achieved = stage?.achieved === true;
  const status = !state ? t('授予状态暂未提供', 'Award status unavailable') : achieved ? t('已获得', 'Earned') : t('未获得', 'Not earned');
  const progress = stage?.requirements.length ? `<dl class="community-badge-requirements">${stage.requirements.map(requirement => `<div data-met="${requirement.met}"><dt>${esc(t(requirement.label, requirement.labelEn || requirement.label))}</dt><dd>${esc(requirement.have.toLocaleString())} / ${esc(requirement.need.toLocaleString())}</dd></div>`).join('')}</dl>` : '';
  return `<div class="community-badge-detail" data-badge-detail data-tier="${tier}" data-earned="${achieved}"><div class="community-badge-detail-art">${communityBadgeArtHTML(family.id, tier, achieved)}<span class="community-badge-detail-status">${esc(communityBadgeTierName(tier, common))} · ${esc(status)}</span></div><div class="community-badge-detail-copy"><div class="community-badge-category">${esc(t(family.category, categoryNames[family.id]))}</div><h2>${esc(t(family.name, family.en))}</h2><p class="community-badge-description">${esc(t(family.description, family.descriptionEn))}</p><p class="community-badge-criterion">${esc(t(family.criteria[tier], family.criteriaEn[tier]))}</p>${progress}${stage?.achievedAt ? `<p class="community-badge-detail-note">${esc(t('获得于', 'Earned on'))} <time datetime="${esc(stage.achievedAt)}">${esc(stage.achievedAt.slice(0, 10))}</time></p>` : ''}${tier === 'aurora' ? `<p class="community-badge-detail-note">${esc(t('炫彩还需注册满 365 天，最近 180 天无已确认违规。', 'Aurora also requires an account at least 365 days old and no confirmed violation in the last 180 days.'))}</p>` : ''}${stage && !achieved && stage.eligible ? `<p class="community-badge-detail-note">${esc(t('条件已达成，等待确认授予。', 'Requirements met; awaiting a confirmed award.'))}</p>` : ''}</div></div>`;
}

export function communityBadgeExplorerHTML(state: CommunityBadgeState | null | undefined, legacy: readonly string[], common: Common, selection: CommunityBadgeSelection = initial()) {
  const { esc, t } = common, current = selected(state, selection);
  return `<section class="community-badge-explorer" data-badge-explorer><div class="community-badge-showcase"><div data-badge-detail-host>${detailHTML(state, common, selection)}</div><div data-badge-gallery-host>${galleryHTML(state, common, selection)}</div></div><div class="community-badge-collection-head"><h2>${esc(t('成就系列', 'Achievement families'))}</h2><p>${esc(t('每个系列展示已获得的最高材质', 'Each family shows its highest earned material'))}</p></div><div class="community-badge-wall">${communityBadgeFamilies.map(family => {
    const award = communityBadgeFamilyState(state, family.id), earned = Boolean(award?.tier), tier = award?.tier || 'gold';
    const status = !state ? t('状态暂未提供', 'Status unavailable') : earned ? communityBadgeTierName(tier, common) : t('未获得', 'Not earned');
    return `<button type="button" class="community-bw-item${earned ? '' : ' is-off'}" data-action="community-badge-family" data-badge-family-card="${family.id}" data-tier="${earned ? tier : 'locked'}" data-earned="${earned}" aria-pressed="${family.id === current.family.id}" aria-label="${esc(t(`查看${family.name}，${status}`, `View ${family.en}, ${status}`))}">${communityBadgeArtHTML(family.id, tier, earned)}<b>${esc(t(family.name, family.en))}</b><span class="community-badge-wall-status">${esc(status)}</span></button>`;
  }).join('')}</div>${communityBadgeLegacyHTML(legacy, common, state)}</section>`;
}

// This controller changes only the viewed family/condition. The award wall and
// server state are never rewritten or inferred from legacy badge IDs.
export function createCommunityBadgeExplorer(options: { root: () => HTMLElement | null; data: () => CommunityBadgeState | null; common: () => Common | null }) {
  let selection = initial();
  function action(target: HTMLElement) {
    if (!['community-badge-family', 'community-badge-tier'].includes(target.dataset.action || '')) return false;
    const root = options.root(), common = options.common(), state = options.data();
    if (!root?.contains(target) || !common) return true;
    if (target.dataset.action === 'community-badge-family') {
      const family = communityBadgeFamilies.find(item => item.id === target.dataset.badgeFamilyCard);
      if (!family) return true;
      selection = { family: family.id, tier: communityBadgeFamilyState(state, family.id)?.tier || 'gold' };
    } else {
      const tier = communityBadgeTiers.find(item => item === target.dataset.badgeTier);
      if (!tier) return true;
      selection = { family: selected(state, selection).family.id, tier };
    }
    const detail = root.querySelector('[data-badge-detail-host]'), gallery = root.querySelector('[data-badge-gallery-host]');
    if (detail) detail.innerHTML = detailHTML(state, common, selection);
    if (gallery) gallery.innerHTML = galleryHTML(state, common, selection);
    for (const card of root.querySelectorAll<HTMLElement>('[data-badge-family-card]')) card.setAttribute('aria-pressed', String(card.dataset.badgeFamilyCard === selection.family));
    const focus = target.dataset.action === 'community-badge-family' ? target : root.querySelector<HTMLElement>(`[data-badge-tier="${selection.tier}"]`);
    focus?.focus({ preventScroll: true });
    return true;
  }
  return { state: () => selection, reset: () => { selection = initial(); }, action };
}
