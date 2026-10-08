import { communityGrowthLevel } from './community-growth.mjs';
import { communityGrowthArtHTML, communityTrustArtHTML, communityVipArtHTML } from './community-growth-art.mjs';
import { communityLevels, communityLevelPerks } from './community-rules.mjs';
import type { Common } from './community.ts';
import type { CommunityStardust } from './community-pages.ts';
import { communityStaffRoles } from './community-staff.mjs';
import { communityStaffArtRole, communityStaffArtHTML } from './community-staff-art.mjs';

type Mode = 'growth' | 'trust' | 'vip' | 'staff';
export type CommunityLevelSelection = { mode: Mode; growth: number | null; trust: number | null; vip?: number | null; staff?: number | null };
const initial = (): CommunityLevelSelection => ({ mode: 'growth', growth: null, trust: null, vip: null, staff: null });
// The display catalogue contains appointed roles; owner authority is separate.
const staffRanks = communityStaffRoles.filter(role => role.id !== 'owner').reverse();
const bounds = (mode: Mode) => mode === 'growth' ? [1, 10] : mode === 'vip' ? [1, 8] : mode === 'staff' ? [0, staffRanks.length - 1] : [0, 3];
const clamp = (value: number, mode: Mode) => {
  const [min, max] = bounds(mode);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min;
};
const selectedLevel = (data: CommunityStardust, selection: CommunityLevelSelection) => clamp(
  selection[selection.mode] ?? (selection.mode === 'growth' ? data.owner ? 1 : data.growth?.level ?? 1 : selection.mode === 'vip' ? data.vipGrowth?.active ? data.vipGrowth.level ?? 1 : 1 : selection.mode === 'staff' ? Math.max(0, staffRanks.findIndex(item => item.id === (data.owner ? 'owner' : data.staffRole))) : data.owner ? 0 : data.level), selection.mode,
);

const finiteCount = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value).toLocaleString('en-US') : '—';
const percentage = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10 : null;
const validRank = (level: number | null | undefined, min: number, max: number) => typeof level === 'number' && Number.isInteger(level) && level >= min && level <= max;
function progressHTML(attribute: string, label: string, progress: number | undefined) {
  const percent = percentage(progress);
  return `<div class="community-level-progress-track" ${attribute} data-available="${percent !== null}" role="progressbar" aria-label="${label}"${percent === null ? '' : ` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"`}><span style="width:${percent ?? 0}%"></span></div>`;
}

function growthProgressHTML(data: CommunityStardust, common: Common, selected: number) {
  const { esc, t } = common, text = (zh: string, en: string) => esc(t(zh, en));
  if (data.owner) return `<p class="community-level-note">${text('作者账号不参与成长等级。', 'The owner account does not participate in growth levels.')}</p>`;
  const growth = data.growth;
  if (!growth?.configured || !validRank(growth.level, 1, 10)) return `<p class="community-level-note">${text('经验记录暂未提供。', 'Experience records are not available.')}</p>`;
  const next = growth.nextLevel ? communityGrowthLevel(growth.nextLevel) : null;
  const completed = growth.nextLevel === null && growth.nextThreshold === null;
  const target = data.experienceCatalogue?.find(item => item.level === selected);
  return `<div class="community-experience-progress"><dl class="community-level-numbers"><div><dt>${text('当前经验', 'Current experience')}</dt><dd data-experience-current>${finiteCount(growth.points)}</dd></div>${next ? `<div><dt>${text('下一等级所需经验', 'Experience for the next level')}</dt><dd data-experience-next>${finiteCount(growth.nextThreshold)}</dd></div>` : ''}</dl>${progressHTML('data-experience-progress', text('当前成长升级进度', 'Current growth progress'), growth.progress)}<p class="community-level-note">${next ? `${text('距离', 'To')} ${text(next.name, next.en)} ${text('还差', 'remaining')} <b data-experience-remaining>${finiteCount(growth.remaining)}</b> ${text('经验', 'EXP')}` : completed ? text('已达到最高成长等级。', 'The highest growth level has been reached.') : text('升级进度暂未提供。', 'Upgrade progress is not available.')}</p>${target ? `<p class="community-level-note community-level-target">${text('查看等级所需经验', 'Experience for the selected level')} <b data-experience-target>${finiteCount(target.threshold)}</b></p>` : ''}</div>`;
}

const levelIconHTML = (level: number, mode: Mode) => {
  if (mode === 'staff') {
    const role = communityStaffArtRole(staffRanks[level].id);
    return role ? communityStaffArtHTML(role, 'badge') : '';
  }
  if (mode === 'growth') return communityGrowthArtHTML(level);
  if (mode === 'vip') return communityVipArtHTML(level);
  return communityTrustArtHTML(level);
};

function vipProgressHTML(data: CommunityStardust, { esc, t }: Common) {
  const text = (zh: string, en: string) => esc(t(zh, en));
  if (data.owner) return `<p class="community-level-note">${text('作者账号不参与会员成长。', 'The owner account does not participate in membership growth.')}</p>`;
  const title = data.vip === true ? text('会员有效', 'Active member') : data.vip === false ? text('未开通会员', 'No active membership') : text('会员状态暂未提供', 'Membership status unavailable');
  const vip = data.vipGrowth;
  const unavailable = text('会员成长记录暂未提供', 'Membership growth records are not available');
  if (!vip || typeof vip.active !== 'boolean' || vip.active && !validRank(vip.level, 1, 8)) return `<div class="community-vip-progress"><div class="community-vip-progress-head"><span>${text('我的会员', 'My membership')}</span><b>${title}</b></div><div class="community-level-progress-track" data-vip-progress data-available="false" role="progressbar" aria-label="${text('VIP 升级进度', 'VIP upgrade progress')}" aria-valuetext="${unavailable}"></div><p>${unavailable}</p></div>`;
  const status = vip.active && vip.level ? `VIP${vip.level}` : text('会员成长已暂停', 'Membership growth is paused');
  return `<div class="community-vip-progress"><div class="community-vip-progress-head"><span>${text('我的会员', 'My membership')}</span><b>${status}</b></div><dl class="community-level-numbers"><div><dt>${text('已累计成长日', 'Recorded growth days')}</dt><dd data-vip-days>${finiteCount(vip.days)}</dd></div>${vip.active && vip.nextDays !== null ? `<div><dt>${text('下一档所需成长日', 'Days for the next tier')}</dt><dd data-vip-next-days>${finiteCount(vip.nextDays)}</dd></div>` : ''}</dl>${progressHTML('data-vip-progress', text('VIP 升级进度', 'VIP upgrade progress'), vip.active ? vip.progress : undefined)}<p>${!vip.active ? text('开通会员后继续累计，已记录进度保留。', 'Renew membership to continue with the recorded progress.') : vip.nextDays === null ? text('已达到最高会员等级。', 'The highest VIP tier has been reached.') : `${text('距离下一档还差', 'Days remaining to the next tier')} <b data-vip-remaining>${finiteCount(vip.remaining)}</b> ${text('成长日', 'growth days')}`}</p></div>`;
}

function levelBodyHTML(data: CommunityStardust, common: Common, selection: CommunityLevelSelection) {
  const { esc, t } = common, text = (zh: string, en: string) => esc(t(zh, en));
  const mode = selection.mode, growth = mode === 'growth', level = selectedLevel(data, selection);
  const code = (n: number) => mode === 'vip' ? `VIP${n}` : `L${n}`;
  const name = (n: number) => growth ? communityGrowthLevel(n) : mode === 'vip' ? { name: code(n), en: code(n) } : mode === 'staff' ? { name: staffRanks[n].name, en: staffRanks[n].nameEn } : communityLevels[n];
  const rankLabel = (n: number, english = false) => `${mode === 'trust' ? `${code(n)} ` : ''}${english ? name(n).en : name(n).name}`;
  const definition = name(level);
  const [min, max] = bounds(mode);
  const label = (n: number) => text(name(n).name, name(n).en);
  const arrow = (step: -1 | 1) => `<button type="button" class="community-emblem-arrow" data-action="community-level-select" data-level="${clamp(level + step, mode)}" data-level-step="${step}" aria-label="${text(step < 0 ? '查看上一等级' : '查看下一等级', step < 0 ? 'View previous level' : 'View next level')}" aria-controls="community-level-detail"${level + step < min || level + step > max ? ' disabled' : ''}>${common.icons?.[step < 0 ? 'chevron-left' : 'chevron-right'] || (step < 0 ? '‹' : '›')}</button>`;
  const neighbour = (step: -1 | 1) => {
    const n = level + step;
    return `<div class="community-emblem-side" data-side="${step < 0 ? 'previous' : 'next'}">${n < min || n > max ? '' : `<button type="button" data-carousel-neighbour data-action="community-level-select" data-level="${n}" aria-label="${esc(t(`查看 ${rankLabel(n)}`, `View ${rankLabel(n, true)}`))}" aria-controls="community-level-detail">${levelIconHTML(n, mode)}</button>`}</div>`;
  };
  const track = `<div class="community-emblem-track" data-level-track role="group" aria-label="${text('选择相邻等级', 'Choose an adjacent level')}"><svg data-carousel-arc class="community-emblem-arc" viewBox="0 0 400 44" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="community-level-arc-ink" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="currentColor" stop-opacity=".18"/><stop offset="30%" stop-color="currentColor" stop-opacity=".5"/><stop offset="50%" stop-color="currentColor" stop-opacity=".8"/><stop offset="70%" stop-color="currentColor" stop-opacity=".5"/><stop offset="100%" stop-color="currentColor" stop-opacity=".18"/></linearGradient></defs><path d="M 66.667 20 Q 200 44 333.333 20" stroke="url(#community-level-arc-ink)"/></svg>${[-1, 0, 1].map(step => {
    const n = level + step, position = step < 0 ? 'previous' : step > 0 ? 'next' : 'current';
    return `<div class="community-emblem-stop" data-position="${position}">${n < min || n > max ? '' : `<button type="button" data-action="community-level-select" data-level="${n}" aria-pressed="${step === 0}" aria-controls="community-level-detail" aria-keyshortcuts="ArrowLeft ArrowRight Home End"><span class="community-emblem-dot" aria-hidden="true"></span>${step === 0 ? `<span id="community-level-title" class="community-emblem-title">${label(n)}</span>` : `<span>${label(n)}</span>`}</button>`}</div>`;
  }).join('')}</div>`;
  const preview = `<div class="community-level-visual" data-level-carousel><div class="community-emblem-stage">${arrow(-1)}${neighbour(-1)}<div data-level-preview data-selected-level="${level}" class="community-level-preview" tabindex="0" role="group" aria-label="${esc(t(`等级展示：${rankLabel(level)}`, `Level preview: ${rankLabel(level, true)}`))}" aria-controls="community-level-detail" aria-keyshortcuts="ArrowLeft ArrowRight Home End"><div class="community-level-emblem">${levelIconHTML(level, mode)}</div></div>${neighbour(1)}${arrow(1)}</div>${track}</div>`;

  let details: string;
  if (growth) {
    details = `<span class="community-level-caption">${text('成长等级', 'Growth levels')}</span><h3>${text(definition.name, definition.en)}</h3>${growthProgressHTML(data, common, level)}<p class="community-level-note">${text('兑换星尘不影响成长等级。', 'Spending stardust does not affect your growth level.')}</p>`;
  } else if (mode === 'vip') {
    const multiplier = data.vipCatalogue?.find(item => item.level === level)?.multiplier;
    details = `<span class="community-level-caption">${text('会员等级', 'VIP levels')}</span><h3>${code(level)}</h3><div class="community-vip-benefit"><span>${text('登录经验加速', 'Login experience multiplier')}</span><strong data-vip-multiplier>${finiteCount(multiplier)}<small>×</small></strong></div>${vipProgressHTML(data, common)}`;
  } else if (mode === 'staff') {
    const notes = [
      ['协助所属版主审核与推荐精选，建议通过后仍需具有最终审批权的人决定。', 'Assist the assigned moderator with review and featured recommendations; advice still needs a final decision.'],
      ['由总版主任命，管理获分配的板块；可以按上级授予的权限任命和配置协管。', 'Appointed by a general moderator to manage assigned boards and configure assistants within granted authority.'],
      ['由站长任命，协调所负责的板块；可以按站长授予的权限任命和配置版主。', 'Appointed by the owner to coordinate assigned boards and configure moderators within granted authority.'],
    ];
    details = `<span class="community-level-caption">${text('管理身份', 'Management roles')}</span><h3>${text(definition.name, definition.en)}</h3><p>${text(notes[level][0], notes[level][1])}</p><p class="community-level-note">${text('管理身份由上级任命，与社区 L0–L3 等级、成长和 VIP 分开；具体能力及可下发的能力由上级配置。删除、违规扣分和禁言分别授权，不会自动获得。', 'Management roles are appointed separately from earned L0–L3, growth and VIP levels. The superior assigns capabilities and which may be delegated. Deletion, penalties and mutes are granted separately.')}</p><p class="community-level-note">${text('需要申请管理职务时，请通过社区规则中的管理联系方式联系对应上级，由管理台正式任命。读者身份下没有管理权。', 'Apply through the management contacts in the community rules to the appropriate superior; appointments are made in management. Reader perspective has no management authority.')} <a href="#/community/rules">${text('查看管理联系方式', 'View management contacts')}</a></p>`;
  } else {
    details = `<span class="community-level-caption">${text('社区等级', 'Community levels')}</span><h3>${text(`${code(level)} ${definition.name}`, `${code(level)} ${definition.en}`)}</h3><h4>${text('权限与限制', 'Permissions and limits')}</h4><ul class="community-level-perks">${(communityLevelPerks[level] || []).map(([zh, en]) => `<li>${text(zh, en)}</li>`).join('')}</ul><p class="community-level-note">${text('社区等级按参与情况获得，不自动给予管理权；管理身份及具体能力见右侧管理身份页签。VIP 不改变信任等级或管理权。', 'Community levels are earned through participation and do not grant management authority. See Management roles for appointments and specific capabilities. VIP does not change trust or management rights.')}</p>`;
  }
  return preview + `<div id="community-level-detail" class="community-level-detail" data-level-detail role="region" aria-labelledby="community-level-title" tabindex="0">${details}</div>`;
}

function personalStatus(data: CommunityStardust, { esc, t }: Common, mode: Mode) {
  if (mode === 'staff') {
    const item = communityStaffRoles.find(role => role.id === (data.owner ? 'owner' : data.staffRole));
    return esc(item ? t(`当前管理身份：${item.name}`, `Current management role: ${item.nameEn}`) : t('当前为普通读者，没有管理权。', 'Currently a reader, with no management authority.'));
  }
  if (mode === 'vip') return esc(data.owner ? t('作者账号', 'Owner account') : data.vipGrowth?.active && validRank(data.vipGrowth.level, 1, 8) ? t(`当前 VIP${data.vipGrowth.level}`, `Current VIP${data.vipGrowth.level}`) : data.vip === true ? t('当前为 VIP 会员', 'Active VIP member') : data.vip === false ? t('当前为普通读者', 'Regular reader') : t('会员状态暂未提供', 'Membership status unavailable'));
  if (data.owner) return esc(t('作者不参与成长等级，拥有全部管理权限。', 'The owner has no growth level and has all management permissions.'));
  if (mode === 'growth') return data.growth?.configured && validRank(data.growth.level, 1, 10) ? `<span data-personal-level>${esc(t(`当前 ${communityGrowthLevel(data.growth.level).name}`, `Current ${communityGrowthLevel(data.growth.level).en}`))}</span>` : esc(t('成长等级暂未提供', 'Growth level is not available'));
  return esc(t(`当前社区等级：${communityLevels[clamp(data.level, 'trust')].name}`, `Current community level: ${communityLevels[clamp(data.level, 'trust')].en}`));
}

export function communityLevelExplorerHTML(data: CommunityStardust, common: Common, selection: CommunityLevelSelection = initial()) {
  const { esc, t } = common;
  const modes = [['growth', '成长等级', 'Growth levels'], ['trust', '社区等级', 'Community levels'], ['vip', 'VIP 等级', 'VIP levels'], ['staff', '管理身份', 'Management roles']] as const;
  return `<section class="community-card community-level-explorer" data-level-explorer data-mode="${selection.mode}"><header class="community-level-head"><div class="community-level-modes" role="group" aria-label="${esc(t('等级介绍', 'Level information'))}">${modes.map(([mode, zh, en]) => `<button type="button" data-action="community-level-mode" data-level-mode="${mode}" aria-pressed="${mode === selection.mode}">${esc(t(zh, en))}</button>`).join('')}</div><p><span data-level-status>${personalStatus(data, common, selection.mode)}</span></p></header><div class="community-level-body" data-level-body>${levelBodyHTML(data, common, selection)}</div></section>`;
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
    const requested = root.querySelector<HTMLElement>(`${focus}:not(:disabled)`);
    (requested ?? root.querySelector<HTMLElement>('[data-level-preview]'))?.focus({ preventScroll: true });
  }
  function action(target: HTMLElement) {
    if (!target.dataset.action?.startsWith('community-level-')) return false;
    const data = options.data(); if (!data || !options.root()?.contains(target)) return true;
    const level = selectedLevel(data, selection);
    switch (target.dataset.action) {
      case 'community-level-mode': {
        const mode = target.dataset.levelMode;
        if ((mode !== 'growth' && mode !== 'trust' && mode !== 'vip' && mode !== 'staff') || mode === selection.mode) return true;
        selection.mode = mode; update(`[data-level-mode="${mode}"]`); return true;
      }
      case 'community-level-select': {
        const value = Number(target.dataset.level);
        if (!Number.isInteger(value) || value !== clamp(value, selection.mode) || value === level) return true;
        selection[selection.mode] = value;
        update(target.hasAttribute('data-level-step') ? `[data-level-step="${target.dataset.levelStep}"]` : '[data-level-track] [aria-pressed="true"]'); return true;
      }
      default: return true;
    }
  }
  function keydown(event: KeyboardEvent) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-level-preview], [data-action="community-level-select"]') : null;
    const data = options.data();
    if (!target || !data || !options.root()?.contains(target) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const [min, max] = bounds(selection.mode), current = selectedLevel(data, selection);
    const next = event.key === 'Home' ? min : event.key === 'End' ? max : clamp(current + (event.key === 'ArrowLeft' ? -1 : 1), selection.mode);
    selection[selection.mode] = next;
    update(target.hasAttribute('data-level-preview') ? '[data-level-preview]' : target.hasAttribute('data-level-step') ? `[data-level-step="${target.dataset.levelStep}"]` : '[data-level-track] [aria-pressed="true"]');
  }
  return { state: () => selection, reset: () => { selection = initial(); }, action, keydown };
}
