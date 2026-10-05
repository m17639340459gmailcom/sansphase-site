import { communityGrowthLevel } from './community-growth.mjs';
import { communityGrowthArtHTML } from './community-growth-art.mjs';
import { communityLevels, communityLevelPerks } from './community-rules.mjs';
import type { Common } from './community.ts';
import type { CommunityStardust } from './community-pages.ts';

// Display-only proposal. Live growth configuration and accounting remain unchanged.
export const communityExperienceDraft = {
  status: 'draft',
  thresholds: [0, 1200, 3600, 7200, 13200, 21600, 31200, 43200, 56400, 72000],
  actions: [
    { label: '每日首次访问', en: 'First daily visit', points: 10 },
    { label: '首个通过审核的主题', en: 'First approved topic', points: 20 },
    { label: '首条有效回复', en: 'First eligible reply', points: 10 },
    { label: '首次回答被采纳', en: 'First accepted answer', points: 20 },
  ],
} as const;
// The catalogue shows proposed multipliers, never inferred personal VIP growth.
export const communityVIPMultipliers = [2, 3, 4, 6, 8, 11, 15, 20] as const;

type Mode = 'growth' | 'trust' | 'vip';
export type CommunityLevelSelection = { mode: Mode; growth: number | null; trust: number | null; vip?: number | null };
const initial = (): CommunityLevelSelection => ({ mode: 'growth', growth: null, trust: null, vip: null });
const bounds = (mode: Mode) => mode === 'growth' ? [1, 10] : mode === 'vip' ? [1, 8] : [0, 3];
const clamp = (value: number, mode: Mode) => {
  const [min, max] = bounds(mode);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min;
};
const selectedLevel = (data: CommunityStardust, selection: CommunityLevelSelection) => clamp(
  selection[selection.mode] ?? (selection.mode === 'growth' ? data.owner ? 1 : data.growth?.level ?? 1 : selection.mode === 'vip' ? 1 : data.owner ? 0 : data.level), selection.mode,
);

// Trust retains its existing symbols; growth uses the approved C sequence.
const trustIcons = ['flower-star', 'polar-star', 'beveled-star', 'justice-star'] as const;
const levelIconHTML = (level: number, mode: Mode) => {
  if (mode === 'growth') return communityGrowthArtHTML(level);
  if (mode === 'vip') return `<span class="community-vip-emblem" aria-hidden="true"><span>VIP</span><strong>${level}</strong></span>`;
  const slug = trustIcons[level];
  return `<span class="community-level-icon" data-level-icon="${slug}" style="--level-icon:url('/assets/community/levels/${slug}.svg')" aria-hidden="true"></span>`;
};

function vipProgressHTML(data: CommunityStardust, { esc, t }: Common) {
  const text = (zh: string, en: string) => esc(t(zh, en));
  if (data.owner) return `<p class="community-level-note">${text('作者账号不参与会员成长。', 'The owner account does not participate in membership growth.')}</p>`;
  const title = data.vip === true ? text('会员有效', 'Active member') : data.vip === false ? text('未开通会员', 'No active membership') : text('会员状态暂未提供', 'Membership status unavailable');
  const unavailable = text('会员成长待启用', 'Membership growth is not active');
  // No login-day ledger exists yet. Unknown progress must not masquerade as 0%.
  return `<div class="community-vip-progress"><div class="community-vip-progress-head"><span>${text('我的会员', 'My membership')}</span><b>${title}</b></div><div class="community-vip-progress-track" data-vip-progress data-available="false" role="progressbar" aria-label="${text('VIP 升级进度', 'VIP upgrade progress')}" aria-valuetext="${unavailable}"></div><p>${unavailable}</p></div>`;
}

function levelBodyHTML(data: CommunityStardust, common: Common, selection: CommunityLevelSelection) {
  const { esc, t } = common, text = (zh: string, en: string) => esc(t(zh, en));
  const mode = selection.mode, growth = mode === 'growth', level = selectedLevel(data, selection);
  const code = (n: number) => `${growth ? 'G' : mode === 'vip' ? 'VIP' : 'L'}${n}`;
  const name = (n: number) => growth ? communityGrowthLevel(n) : mode === 'vip' ? { name: code(n), en: code(n) } : communityLevels[n];
  const definition = name(level);
  const [min, max] = bounds(mode);
  const arrow = common.icons?.right || '<span class="community-level-arrow" aria-hidden="true"></span>';
  const neighbour = (step: number) => {
    const n = level + step;
    if (n < min || n > max) return '<span class="community-level-neighbour-empty" aria-hidden="true"></span>';
    return `<button type="button" class="community-level-neighbour community-level-mark" data-tier="${growth || mode === 'vip' ? n : n + 1}" data-action="community-level-select" data-level="${n}" aria-label="${esc(t(`查看 ${code(n)} ${mode === 'vip' ? '' : name(n).name}`, `View ${code(n)} ${mode === 'vip' ? '' : name(n).en}`))}" aria-controls="community-level-detail">${levelIconHTML(n, mode)}<span>${mode === 'vip' ? `${communityVIPMultipliers[n - 1]}×` : text(name(n).name, name(n).en)}</span></button>`;
  };
  const preview = `<div class="community-level-visual"><div class="community-level-stage">${neighbour(-1)}<div data-level-preview data-selected-level="${level}" data-tier="${growth || mode === 'vip' ? level : level + 1}" class="community-level-preview community-level-mark" tabindex="0" role="group" aria-label="${esc(t(`等级展示：${code(level)} ${mode === 'vip' ? '' : definition.name}`, `Level preview: ${code(level)} ${mode === 'vip' ? '' : definition.en}`))}" aria-controls="community-level-detail" aria-keyshortcuts="ArrowLeft ArrowRight Home End"><div class="community-level-emblem">${levelIconHTML(level, mode)}</div><h2 id="community-level-title">${text(definition.name, definition.en)}</h2></div>${neighbour(1)}</div><div class="community-level-controls" role="group" aria-label="${text('切换等级', 'Switch levels')}"><button type="button" class="community-level-nav-button community-level-prev" data-action="community-level-step" data-step="-1" aria-controls="community-level-detail" aria-label="${text('上一个等级', 'Previous level')}"${level === min ? ' disabled' : ''}>${arrow}</button><button type="button" class="community-level-nav-button" data-action="community-level-step" data-step="1" aria-controls="community-level-detail" aria-label="${text('下一个等级', 'Next level')}"${level === max ? ' disabled' : ''}>${arrow}</button></div></div>`;

  let details: string;
  if (growth) {
    details = `<span class="community-level-caption">${text('成长等级 · 待启用', 'Growth levels · not active')}</span><h3>${text(`${code(level)} ${definition.name}`, `${code(level)} ${definition.en}`)}</h3><p class="community-level-note">${text('记录你在社区的成长。', 'A reflection of your community journey.')}</p><p class="community-level-note">${text('兑换星尘不影响成长等级。', 'Spending stardust does not affect your growth level.')}</p>`;
  } else if (mode === 'vip') {
    details = `<span class="community-level-caption">${text('会员等级 · 经验加速待启用', 'VIP levels · experience boost not active')}</span><h3>${code(level)}</h3><div class="community-vip-benefit"><span>${text('登录经验加速', 'Login experience multiplier')}</span><strong data-vip-multiplier>${communityVIPMultipliers[level - 1]}<small>×</small></strong></div>${vipProgressHTML(data, common)}`;
  } else {
    details = `<span class="community-level-caption">${text('社区等级', 'Community levels')}</span><h3>${text(`${code(level)} ${definition.name}`, `${code(level)} ${definition.en}`)}</h3><h4>${text('权限与限制', 'Permissions and limits')}</h4><ul class="community-level-perks">${(communityLevelPerks[level] || []).map(([zh, en]) => `<li>${text(zh, en)}</li>`).join('')}</ul><p class="community-level-note">${text('版主由作者任命，管理指定板块并可执行全社区禁言；VIP 不改变信任等级或管理权。', 'Moderators are appointed by the owner, manage assigned boards and can mute community-wide. VIP does not change trust or management rights.')}</p>`;
  }
  return preview + `<div id="community-level-detail" class="community-level-detail" data-level-detail role="region" aria-labelledby="community-level-title" tabindex="0">${details}</div>`;
}

function personalStatus(data: CommunityStardust, { esc, t }: Common, mode: Mode) {
  if (mode === 'vip') return esc(data.owner ? t('作者账号', 'Owner account') : data.vip === true ? t('当前为 VIP 会员', 'Active VIP member') : data.vip === false ? t('当前为普通读者', 'Regular reader') : t('会员状态暂未提供', 'Membership status unavailable'));
  if (data.owner) return esc(t('作者不参与成长等级，拥有全部管理权限。', 'The owner has no growth level and has all management permissions.'));
  if (mode === 'growth') return data.growth ? `<span data-personal-level>${esc(t(`当前 G${data.growth.level} ${communityGrowthLevel(data.growth.level).name}`, `Current G${data.growth.level} ${communityGrowthLevel(data.growth.level).en}`))}</span>` : esc(t('成长等级暂未提供', 'Growth level is not available'));
  return esc(t(`当前权限：${data.steward ? '版主' : communityLevels[clamp(data.level, 'trust')].name}`, `Current role: ${data.steward ? 'moderator' : communityLevels[clamp(data.level, 'trust')].en}`));
}

export function communityLevelExplorerHTML(data: CommunityStardust, common: Common, selection: CommunityLevelSelection = initial()) {
  const { esc, t } = common;
  const modes = [['growth', '成长等级', 'Growth levels'], ['trust', '社区等级', 'Community levels'], ['vip', 'VIP 等级', 'VIP levels']] as const;
  return `<section class="community-card community-level-explorer" data-level-explorer data-mode="${selection.mode}"><header class="community-level-head"><div class="community-seg is-small" role="group" aria-label="${esc(t('等级介绍', 'Level information'))}">${modes.map(([mode, zh, en]) => `<button type="button" data-action="community-level-mode" data-level-mode="${mode}" aria-pressed="${mode === selection.mode}">${esc(t(zh, en))}</button>`).join('')}</div><p><span data-level-status>${personalStatus(data, common, selection.mode)}</span></p></header><div class="community-level-body" data-level-body>${levelBodyHTML(data, common, selection)}</div></section>`;
}

// Updates only the explorer. No navigation, requests or page repaint.
export function createCommunityLevelExplorer(options: {
  root: () => HTMLElement | null; data: () => CommunityStardust | null; common: () => Common | null;
}) {
  let selection = initial();
  function update(focus: string) {
    const root = options.root(), data = options.data(), common = options.common();
    const body = root?.querySelector<HTMLElement>('[data-level-body]');
    if (!root || !data || !common || !body) return;
    body.innerHTML = levelBodyHTML(data, common, selection);
    root.dataset.mode = selection.mode;
    for (const button of root.querySelectorAll<HTMLElement>('[data-level-mode]')) button.setAttribute('aria-pressed', String(button.dataset.levelMode === selection.mode));
    const status = root.querySelector('[data-level-status]');
    if (status) status.innerHTML = personalStatus(data, common, selection.mode);
    // At the first/last level, the clicked arrow becomes disabled. Focus the preview instead.
    const requested = root.querySelector<HTMLElement>(focus);
    (requested && !requested.matches(':disabled') ? requested : root.querySelector<HTMLElement>('[data-level-preview]'))?.focus({ preventScroll: true });
  }
  function action(target: HTMLElement) {
    if (!target.dataset.action?.startsWith('community-level-')) return false;
    const data = options.data(); if (!data || !options.root()?.contains(target)) return true;
    const level = selectedLevel(data, selection);
    switch (target.dataset.action) {
      case 'community-level-mode': {
        const mode = target.dataset.levelMode;
        if ((mode !== 'growth' && mode !== 'trust' && mode !== 'vip') || mode === selection.mode) return true;
        selection.mode = mode; update(`[data-level-mode="${mode}"]`); return true;
      }
      case 'community-level-select': {
        const value = Number(target.dataset.level);
        if (!Number.isInteger(value) || value !== clamp(value, selection.mode) || value === level) return true;
        selection[selection.mode] = value; update(`[data-level-preview]`); return true;
      }
      case 'community-level-step': {
        const step = Number(target.dataset.step); if (step !== 1 && step !== -1) return true;
        const next = clamp(level + step, selection.mode); if (next === level) return true;
        selection[selection.mode] = next; update(`[data-step="${step}"]`); return true;
      }
      default: return true;
    }
  }
  function keydown(event: KeyboardEvent) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-level-preview], [data-action="community-level-step"], [data-action="community-level-select"]') : null;
    const data = options.data();
    if (!target || !data || !options.root()?.contains(target) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const [min, max] = bounds(selection.mode), current = selectedLevel(data, selection);
    const next = event.key === 'Home' ? min : event.key === 'End' ? max : clamp(current + (event.key === 'ArrowLeft' ? -1 : 1), selection.mode);
    selection[selection.mode] = next; update(`[data-level-preview]`);
  }
  return { state: () => selection, reset: () => { selection = initial(); }, action, keydown };
}
