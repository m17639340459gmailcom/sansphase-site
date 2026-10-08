import { communityHomeHref } from './community.mjs';
import type { Common, CommunityMe } from './community.ts';
import type { CommunityManage } from './community-pages.ts';
import { communityStaffRoles } from './community-staff.mjs';
import type { CommunityStaffRole } from './community-staff.ts';

export type ManagementSection = [id: string, href: string, label: string, count?: number];
const sectionIcons: Record<string, string> = { review: 'check', profiles: 'user', content: 'reply', features: 'award', banners: 'image', boards: 'grid', orders: 'truck', items: 'box', stewards: 'users', sanctions: 'shield', data: 'trending', contact: 'mail', convention: 'bookmark' };

// Presentation follows the latest management response. Server authorization
// remains final, including a role change while an operation is in flight.
export function communityCanManageItems(data: Pick<CommunityManage, 'owner' | 'actorStaff' | 'allowedTabs'> | null, me: CommunityMe | null): boolean {
  if (me?.management?.browsingAsReader) return false;
  const owner = data ? data.owner : me?.owner;
  const staff = data ? data.actorStaff : me?.staff;
  return Boolean((owner || staff?.role === 'general') && (!data?.allowedTabs || data.allowedTabs.includes('items')));
}

export function communityManagementShellHTML(owner: boolean | null, tab: string, sections: ManagementSection[], content: string, { t, esc, icons = {} }: Common, canBrowseAsReader = true, staffRole?: CommunityStaffRole | null) {
  const definition = communityStaffRoles.find(item => item.id === staffRole);
  const role = definition ? t(definition.name, definition.nameEn) : owner === true ? t('作者', 'Owner') : owner === false ? t('版主', 'Moderator') : t('社区管理', 'Management');
  return `<section class="page community-page community-management-page" data-community="manage" data-tab="${esc(tab)}">`
    + `<aside class="community-management-nav"><div class="community-management-role"><span>${icons.shield || ''}</span><div><strong>${role}</strong><small>${t('社区管理工作台', 'Community workspace')}</small></div></div>`
    + `<nav aria-label="${t('管理分类', 'Management sections')}">${sections.map(([id, href, label, count]) => `<a href="${href}"${tab === id || (id === 'review' && ['queue', 'reports'].includes(tab)) ? ' aria-current="page"' : ''}>${icons[sectionIcons[id]] || ''}<span>${label}</span>${count ? `<b class="community-tab-n">${count}</b>` : ''}</a>`).join('')}</nav>`
    + `<div class="community-management-exits"><a href="${communityHomeHref}">${icons.left || ''}<span>${t('返回社区', 'Back to community')}</span></a>${canBrowseAsReader ? `<button type="button" data-action="community-browse-mode" data-reader="true">${icons.eye || ''}<span>${t('以读者身份浏览', 'Browse as a reader')}</span></button>` : ''}</div></aside>`
    + `<div class="community-management-content">${content}</div></section>`;
}
