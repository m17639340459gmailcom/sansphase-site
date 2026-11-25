import { beijingTime, cardHead, emptyHTML } from './community.mjs';
import type { Common } from './community.ts';

export type CommunityInvitationRecord = {
  inviteeId: string; registeredAt: string;
  status: 'waiting' | 'rewarded' | 'limit' | 'reverted' | 'ineligible';
  approvedAt: string | null; rewardMonth: string | null; amount: number; topicId: string | null;
  name?: string; revertedAmount?: number; inviteeDeleted?: boolean;
};
export type CommunityInvitations = {
  shareUrl: string; reward: number; monthlyLimit: number; month: string;
  rewardedThisMonth: number; remaining: number; records: CommunityInvitationRecord[];
};

/** This is a link allowlist, not eligibility checking; the server owns attribution and rewards. */
export function invitationShareURL(address: string, origin = typeof location === 'undefined' ? 'https://www.sansphase.com' : location.origin): string | null {
  try {
    if (typeof address !== 'string' || /[\u0000-\u0020\u007f]/.test(address)) return null;
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || ![origin, 'https://www.sansphase.com'].includes(url.origin)
      || !/^\/share\/invite\/[A-Za-z0-9_-]{24}$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

export function communityInvitationsHTML(data: CommunityInvitations | null | undefined, common: Common): string {
  const { t, esc, icons = {} } = common;
  const url = data && invitationShareURL(data.shareUrl);
  if (!data || !url) return `<section class="community-card" data-community-invitations>${emptyHTML(common, t('邀请暂不可用，请使用读者身份再试。', 'Invitations are unavailable. Please use your reader identity and try again.'))}</section>`;
  const statuses: Record<CommunityInvitationRecord['status'], string> = {
    waiting: t('已注册，待首帖审核', 'Registered; first post awaiting approval'),
    rewarded: t('邀请成功', 'Invitation successful'),
    limit: t('本月名额已满', 'Monthly limit reached'),
    reverted: t('奖励已收回', 'Reward reversed'),
    ineligible: t('不符合邀请条件', 'Not eligible'),
  };
  const rows = data.records.map((record, index) => {
    const name = record.inviteeDeleted ? t('已注销成员', 'Deleted member') : record.name || t(`成员 ${index + 1}`, `Member ${index + 1}`);
    const amount = record.status === 'rewarded' ? `+${record.amount}` : record.status === 'reverted' ? `−${record.revertedAmount ?? 0}` : '—';
    return `<tr><td><span class="community-invite-name">${esc(name)}</span></td><td class="is-mono">${esc(beijingTime(record.registeredAt))}</td><td>${statuses[record.status]}${record.status === 'limit' ? `<small class="community-muted">${t('不跨月补发', 'No later-month payout')}</small>` : ''}</td><td class="is-right is-mono${record.status === 'rewarded' ? ' is-plus' : record.status === 'reverted' ? ' is-minus' : ''}">${amount}</td></tr>`;
  }).join('');
  return `<div class="community-invitations" data-community-invitations>`
    + `<section class="community-card community-invitation-panel"><a class="community-invitation-card" data-community-invitation-card href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="/assets/community/atlas-space.webp" width="960" height="540" alt="" loading="lazy" decoding="async"><span class="community-invitation-copy"><small>${t('你的专属邀请', 'YOUR INVITATION')}</small><strong>${t('一起加入無相社区', 'Join the SANSPHASE community')}</strong><span>${t('交流想法，分享创作。', 'Exchange ideas and share your work.')}</span><span class="community-invitation-open">${t('查看邀请卡', 'Preview invitation')}${icons['arrow-right'] || '→'}</span></span></a>`
    + `<div class="community-invitation-actions"><p>${t('成功邀请一位新成员，获得', 'Earn')} <b class="is-plus">${data.reward}</b> ${t('星尘', 'stardust for each successful invitation')}</p><button type="button" class="community-button is-gold" data-action="community-share-invitation">${icons.share || ''}<span>${t('分享邀请', 'Share invitation')}</span></button></div>`
    + `<p class="community-muted community-invitation-rule">${t(`新成员通过你的邀请注册，首篇帖子经人工审核通过后，立即奖励 ${data.reward} 星尘。每位成员仅计一次。`, `A new member registers through your invitation. Once their first post is manually approved, you immediately receive ${data.reward} stardust. Each member counts once.`)}</p>`
    + `<div class="community-invitation-progress"><span>${t('本月已用名额', 'Reward slots used this month')} <b class="is-mono">${data.rewardedThisMonth} / ${data.monthlyLimit}</b></span><span class="community-muted">${t(`还剩 ${data.remaining} 个名额`, `${data.remaining} reward slots left`)}</span></div>`
    + `<p class="community-muted community-invitation-rule">${t(`按审核通过时间计算，北京时间每个自然月最多奖励 ${data.monthlyLimit} 人；名额满后不跨月补发。奖励收回后不恢复名额。`, `Counted in the approval month, using Beijing time: up to ${data.monthlyLimit} members per calendar month. Invitations beyond the limit are not paid in a later month. Reversing a reward does not restore its slot.`)}</p></section>`
    + `<section class="community-card">${cardHead(t('邀请记录', 'Invitation records'))}${rows ? `<div class="community-table-wrap"><table class="community-table community-invitation-records"><thead><tr><th>${t('成员', 'Member')}</th><th>${t('注册时间', 'Registered')}</th><th>${t('状态', 'Status')}</th><th class="is-right">${t('星尘', 'Stardust')}</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyHTML(common, t('还没有邀请记录。', 'No invitations yet.'))}</section></div>`;
}
