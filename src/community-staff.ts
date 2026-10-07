// Roles and capability labels are shared display contracts. Authority stays in
// the server's current appointment chain; these helpers never authorize a user.
export const communityStaffRoles = [
  { id: 'owner', name: '站长', nameEn: 'Owner' },
  { id: 'general', name: '总版主', nameEn: 'General moderator' },
  { id: 'moderator', name: '版主', nameEn: 'Moderator' },
  { id: 'assistant', name: '协管', nameEn: 'Assistant moderator' },
] as const;
export type CommunityStaffRole = typeof communityStaffRoles[number]['id'];
export const communityProfileKinds = ['avatar', 'signature', 'nickname', 'background'] as const;
export type CommunityProfileKind = typeof communityProfileKinds[number];
export const communityStaffCapabilities = [
  { id: 'content.inspect', scope: 'board', name: '查看待审及隐藏内容', nameEn: 'Inspect pending and hidden content' },
  { id: 'topic.approve', scope: 'board', name: '通过待审主题', nameEn: 'Approve pending topics' },
  { id: 'topic.reject', scope: 'board', name: '驳回待审主题（须理由）', nameEn: 'Reject pending topics with a reason' },
  { id: 'topic.delete', scope: 'board', name: '删除已发布主题', nameEn: 'Delete published topics' },
  { id: 'reply.delete', scope: 'board', name: '删除已发布回复', nameEn: 'Delete published replies' },
  { id: 'topic.penalty', scope: 'board', name: '主题违规扣除星尘', nameEn: 'Apply a topic penalty' },
  { id: 'reply.penalty', scope: 'board', name: '回复违规扣除星尘', nameEn: 'Apply a reply penalty' },
  { id: 'topic.restore', scope: 'board', name: '恢复隐藏主题', nameEn: 'Restore hidden topics' },
  { id: 'reply.restore', scope: 'board', name: '恢复隐藏回复', nameEn: 'Restore hidden replies' },
  { id: 'topic.pin', scope: 'board', name: '置顶主题', nameEn: 'Pin topics' },
  { id: 'topic.lock', scope: 'board', name: '锁定主题', nameEn: 'Lock topics' },
  { id: 'topic.move', scope: 'board', name: '移动主题（源和目标板块）', nameEn: 'Move topics between assigned boards' },
  { id: 'topic.retag', scope: 'board', name: '调整主题标签', nameEn: 'Retag topics' },
  { id: 'report.review', scope: 'board', name: '处理举报（删除及扣分另授权）', nameEn: 'Review reports' },
  { id: 'feature.recommend', scope: 'board', name: '推荐精选给所属版主审批', nameEn: 'Recommend a featured topic' },
  { id: 'feature.decide', scope: 'board', name: '审批精选', nameEn: 'Decide featured topics' },
  { id: 'banner.manage', scope: 'board', name: '管理所属板块横幅', nameEn: 'Manage board banners' },
  { id: 'member.mute', scope: 'global', name: '全社区禁言（不得处罚同级或上级）', nameEn: 'Mute a member across the community' },
  { id: 'member.unmute', scope: 'global', name: '解除全社区禁言', nameEn: 'Lift a community mute' },
  { id: 'staff.appoint', scope: 'global', name: '任命下一级并配置可委派权限', nameEn: 'Appoint the next role' },
  { id: 'profile.avatar.advise', scope: 'global', name: '全账号头像审核建议', nameEn: 'Advise on account avatars' },
  { id: 'profile.avatar.decide', scope: 'global', name: '全账号头像最终审批', nameEn: 'Decide account avatars' },
  { id: 'profile.signature.advise', scope: 'global', name: '全账号个签审核建议', nameEn: 'Advise on account signatures' },
  { id: 'profile.signature.decide', scope: 'global', name: '全账号个签最终审批', nameEn: 'Decide account signatures' },
  { id: 'profile.nickname.advise', scope: 'global', name: '全账号昵称审核建议', nameEn: 'Advise on account nicknames' },
  { id: 'profile.nickname.decide', scope: 'global', name: '全账号昵称最终审批', nameEn: 'Decide account nicknames' },
  { id: 'profile.background.advise', scope: 'global', name: '全账号社区背景审核建议', nameEn: 'Advise on community backgrounds' },
  { id: 'profile.background.decide', scope: 'global', name: '全账号社区背景最终审批', nameEn: 'Decide community backgrounds' },
] as const;
export type CommunityStaffPermission = typeof communityStaffCapabilities[number]['id'];
export type CommunityStaffState = {
  role: CommunityStaffRole; boards: string[]; permissions: CommunityStaffPermission[]; delegable: CommunityStaffPermission[];
  parent: { kind: 'owner' | 'reader'; id: string } | null;
};
export const communityStaffNextRole = (role: CommunityStaffRole): Exclude<CommunityStaffRole, 'owner'> | null =>
  role === 'owner' ? 'general' : role === 'general' ? 'moderator' : role === 'moderator' ? 'assistant' : null;
export const communityStaffAssignableRoles = (role: CommunityStaffRole): readonly Exclude<CommunityStaffRole, 'owner'>[] => {
  if (role === 'owner') return ['general', 'moderator', 'assistant'];
  const next = communityStaffNextRole(role);
  return next ? [next] : [];
};
export const communityStaffCanAppointRole = (actorRole: CommunityStaffRole, targetRole: string): targetRole is Exclude<CommunityStaffRole, 'owner'> =>
  communityStaffAssignableRoles(actorRole).some(role => role === targetRole);
export const communityStaffRank = (role: CommunityStaffRole) => communityStaffRoles.findIndex(item => item.id === role);
export const communityStaffDefaultPermissions: Readonly<Record<Exclude<CommunityStaffRole, 'owner'>, readonly CommunityStaffPermission[]>> = {
  general: ['content.inspect', 'topic.approve', 'topic.reject', 'feature.recommend', 'feature.decide', 'staff.appoint'],
  moderator: ['content.inspect', 'topic.approve', 'topic.reject', 'feature.recommend', 'feature.decide', 'staff.appoint'],
  assistant: ['content.inspect', 'topic.approve', 'topic.reject', 'feature.recommend', ...communityProfileKinds.map(kind => `profile.${kind}.advise` as CommunityStaffPermission)],
};
