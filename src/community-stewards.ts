import { avatarHTML, nameHTML, communityBoards } from './community.mjs';
import type { Common, CommunityLoad, CommunityPerson } from './community.ts';
import type { CommunityMember } from './community-pages.ts';
import { communityStaffRoles, communityStaffCapabilities, communityStaffDefaultPermissions, communityStaffAssignableRoles } from './community-staff.mjs';
import type { CommunityStaffState, CommunityStaffPermission } from './community-staff.ts';

const permissionGroups: readonly { id: string; zh: string; en: string; scopeZh: string; scopeEn: string; permissions: readonly CommunityStaffPermission[] }[] = [
  { id: 'review', zh: '内容审核', en: 'Content review', scopeZh: '所选板块 · 举报处理不自动附带删除或扣分。', scopeEn: 'Assigned boards · report review does not include deletion or penalties.', permissions: ['content.inspect', 'topic.approve', 'topic.reject', 'report.review'] },
  { id: 'content', zh: '内容维护', en: 'Content management', scopeZh: '所选板块 · 移动主题的来源和目标都必须获授权。', scopeEn: 'Assigned boards · moving a topic requires authority over both boards.', permissions: ['topic.delete', 'reply.delete', 'topic.penalty', 'reply.penalty', 'topic.restore', 'reply.restore', 'topic.pin', 'topic.lock', 'topic.move', 'topic.retag'] },
  { id: 'featured', zh: '精选与横幅', en: 'Featured topics and banners', scopeZh: '所选板块 · 推荐与最终审批分别授权。', scopeEn: 'Assigned boards · recommendation and approval are separate permissions.', permissions: ['feature.recommend', 'feature.decide', 'banner.manage'] },
  { id: 'profile', zh: '资料审核', en: 'Profile review', scopeZh: '全账号 · 不受所选板块限制，建议不能代替最终审批。', scopeEn: 'All accounts · independent of assigned boards; advice is not a final decision.', permissions: ['profile.avatar.advise', 'profile.avatar.decide', 'profile.signature.advise', 'profile.signature.decide', 'profile.nickname.advise', 'profile.nickname.decide', 'profile.background.advise', 'profile.background.decide'] },
  { id: 'members', zh: '成员纪律', en: 'Member discipline', scopeZh: '全社区 · 不得处罚同级或上级。', scopeEn: 'Community wide · peers and superiors are protected.', permissions: ['member.mute', 'member.unmute'] },
  { id: 'appointments', zh: '任命管理', en: 'Staff appointments', scopeZh: '总版主可任命版主，版主可任命协管；协管不能继续任命，即使勾选本项也不生效。', scopeEn: 'General moderators appoint moderators; moderators appoint assistants. Assistants cannot appoint others, even if this capability is selected.', permissions: ['staff.appoint'] },
];

export function communityStewardsHTML(stewards: Array<CommunityPerson & { staff?: CommunityStaffState | null; canAppoint?: boolean }>, candidate: CommunityLoad<CommunityMember> | null, common: Common, editingUid: string | null = null, actorStaff?: CommunityStaffState | null): string {
  const { t, esc, icons = {} } = common;
  const assignableRoles = actorStaff ? communityStaffAssignableRoles(actorStaff.role) : [];
  const modern = actorStaff !== undefined;
  const appointedRole = (person: { staff?: CommunityStaffState | null }, existing: boolean) =>
    existing ? assignableRoles.find(role => role === person.staff?.role) ?? null : assignableRoles[0] ?? null;
  const canRevoke = (person: CommunityPerson & { canAppoint?: boolean }) => !modern || Boolean(assignableRoles.length && actorStaff?.permissions.includes('staff.appoint') && person.canAppoint === true);
  const canConfigure = (person: CommunityPerson & { staff?: CommunityStaffState | null; canAppoint?: boolean }) => !modern || Boolean(canRevoke(person) && appointedRole(person, true));
  const roleLabel = (role: CommunityStaffState['role']) => { const item = communityStaffRoles.find(item => item.id === role)!; return t(item.name, item.nameEn); };
  const boardsHTML = (person: CommunityPerson) => {
    const scope = person.moderationBoards;
    const labels = scope === undefined
      ? `<span class="community-tag is-legacy">${t('全部板块（原有权限）', 'All boards (existing permission)')}</span>`
      : communityBoards.filter(board => scope.includes(board.id)).map(board => `<span class="community-tag" data-steward-board="${board.id}">${esc(t(board.zh, board.en))}</span>`).join('') || `<span class="community-muted">${t('未分配板块', 'No boards assigned')}</span>`;
    return `<div class="community-steward-boards">${labels}</div>`;
  };
  const personHTML = (person: CommunityPerson, existing = false) => `<div class="community-steward-person">${avatarHTML(person, common, 'md')}<div>${nameHTML(person, common)}<span class="community-muted is-mono">${person.uid ? `UID ${esc(person.uid)}` : t('没有读者 UID', 'No reader UID')}</span>${existing ? boardsHTML(person) : ''}</div></div>`;
  const revokeHTML = (uid: string, fromLookup = false) => `<button type="button" class="community-button is-small is-danger" data-action="community-steward" data-uid="${esc(uid)}" data-on="false"${fromLookup ? ' data-steward-candidate="true"' : ''}>${icons.shield || ''}<span>${modern ? t('撤销职务', 'Revoke appointment') : t('撤销版主', 'Revoke moderator')}</span></button>`;
  const scopeFormHTML = (person: CommunityPerson & { staff?: CommunityStaffState | null }, existing: boolean, fromLookup = false) => {
    const role = appointedRole(person, existing);
    const uid = person.uid || '';
    const id = `community-steward-scope-${encodeURIComponent(uid)}`;
    const selected = new Set(person.staff?.boards ?? person.moderationBoards ?? (existing ? communityBoards.map(board => board.id) : []));
    const boards = modern ? communityBoards.filter(board => actorStaff?.boards.includes(board.id)) : communityBoards;
    const caps = communityStaffCapabilities.filter(cap => actorStaff?.delegable.includes(cap.id));
    const permissions = new Set(person.staff?.permissions ?? (role ? communityStaffDefaultPermissions[role] : []));
    const delegable = new Set(person.staff?.delegable ?? []);
    const parentChanges = existing && actorStaff?.role === 'owner' && person.staff?.parent?.kind === 'reader';
    const capabilities = modern && role ? `<div class="community-field community-staff-role"><label class="community-field-l" for="${esc(id)}-role">${t('任命身份', 'Appointed role')}</label><select class="community-select" id="${esc(id)}-role" name="role">${assignableRoles.map(option => `<option value="${option}"${option === role ? ' selected' : ''}>${roleLabel(option)}</option>`).join('')}</select></div>`
      + `<div class="community-staff-permissions"><p class="community-muted">${t('可执行：本人可以使用。可下发：任命下级时可以授予，必须同时有可执行权限。', 'Execute: this member can use the capability. Delegate: this member may grant it to subordinates and must also be able to execute it.')}</p>`
      + (caps.length ? permissionGroups.map(group => {
        const items = group.permissions.flatMap(permission => caps.filter(cap => cap.id === permission));
        if (!items.length) return '';
        const groupId = `${id}-${group.id}`;
        return `<fieldset class="community-staff-permission-group" data-staff-permission-group="${group.id}" aria-describedby="${esc(groupId)}-scope"><legend>${esc(t(group.zh, group.en))}</legend><p id="${esc(groupId)}-scope" class="community-muted">${esc(t(group.scopeZh, group.scopeEn))}</p><div class="community-staff-permission-head" aria-hidden="true"><span>${t('权限', 'Capability')}</span><span>${t('可执行', 'Execute')}</span><span>${t('可下发', 'Delegate')}</span></div>`
          + items.map(cap => `<div class="community-staff-permission-row" data-staff-permission="${cap.id}"><span id="${esc(id)}-label-${cap.id}">${esc(t(cap.name, cap.nameEn))}</span>${(['permissions', 'delegable'] as const).map(kind => `<label class="community-check" for="${esc(id)}-${kind}-${cap.id}"><input id="${esc(id)}-${kind}-${cap.id}" type="checkbox" name="${kind}" value="${cap.id}" aria-labelledby="${esc(id)}-label-${cap.id} ${esc(id)}-${kind}-label-${cap.id}"${(kind === 'permissions' ? permissions : delegable).has(cap.id) ? ' checked' : ''}><span id="${esc(id)}-${kind}-label-${cap.id}">${kind === 'permissions' ? t('可执行', 'Execute') : t('可下发', 'Delegate')}</span></label>`).join('')}</div>`).join('') + '</fieldset>';
      }).join('') : `<p class="community-muted">${t('上级没有授予可下发的能力。', 'No delegable capabilities were granted by the superior.')}</p>`) + '</div>' : '';
    return `<form id="${esc(id)}" class="community-steward-scope" data-community-form="steward-scope" data-uid="${esc(uid)}" data-existing="${existing}"${role && existing ? ` data-original-role="${role}" data-parent-change="${Boolean(parentChanges)}"` : ''}${fromLookup ? ' data-steward-candidate="true"' : ''} novalidate>`
      + `<fieldset class="community-choices" aria-describedby="${esc(id)}-hint"><legend>${t('负责板块', 'Assigned boards')}</legend><div class="community-choice-list">${boards.map(board => `<label class="community-choice" for="${esc(id)}-${board.id}"><input id="${esc(id)}-${board.id}" type="checkbox" name="boards" value="${board.id}"${selected.has(board.id) ? ' checked' : ''}><span>${esc(t(board.zh, board.en))}</span></label>`).join('')}</div></fieldset>${capabilities}`
      + `<p id="${esc(id)}-hint" class="community-muted">${modern ? (actorStaff?.role === 'owner' ? t('站长可直接任命总版主、版主或协管；此处不授予站长账号、VIP 或成长等级。', 'Owners can directly appoint general moderators, moderators or assistants. This does not grant owner accounts, VIP or growth levels.') : t('只可任命相邻的下一级，并分配上级允许你下发的能力。', 'Appoint only the next role and grant capabilities your superior permits you to delegate.')) + t(' 至少选择一个板块；删除、扣分、禁言不会自动获得。', ' Select at least one board. Deletion, penalties and mutes are not automatic.') : t('至少选择一个板块，可多选；版主只能管理所选板块内容，也可以执行全社区禁言。', 'Select one or more boards. Moderators can manage content in their assigned boards and issue community-wide mutes.')}</p>`
      + (modern && existing ? `<p class="community-staff-chain-warning" data-steward-chain-warning${parentChanges ? '' : ' hidden'}>${t('改变身份或将任命接管到站长名下，会撤销这位成员现有的全部下属职务；需要再次确认后保存。', 'Changing the role or taking over this appointment as owner revokes all of this member’s subordinate appointments. Saving requires a second confirmation.')}</p>` : '')
      + `<p class="community-form-status" role="status" aria-live="polite"></p><div class="community-action-group"><button type="submit" class="community-button is-gold">${icons.shield || ''}<span>${modern ? existing ? t('保存管理配置', 'Save management configuration') : t('确认任命', 'Confirm appointment') : existing ? t('保存负责板块', 'Save assigned boards') : t('任命为版主', 'Appoint moderator')}</span></button><button type="button" class="community-button" data-action="community-steward-edit-cancel">${t('取消', 'Cancel')}</button></div></form>`;
  };
  const editHTML = (uid: string) => `<button type="button" class="community-button is-small" data-action="community-steward-edit" data-uid="${esc(uid)}" aria-expanded="${editingUid === uid}" aria-controls="community-steward-scope-${esc(encodeURIComponent(uid))}">${icons.pen || ''}<span>${modern ? t('调整管理配置', 'Edit management configuration') : t('调整负责板块', 'Edit assigned boards')}</span></button>`;
  const list = stewards.length
    ? stewards.map(person => `<div class="community-steward-row">${personHTML(person, true)}${person.staff ? `<span class="community-muted">${roleLabel(person.staff.role)}</span>` : ''}${person.uid && canRevoke(person) ? `<div class="community-action-group">${canConfigure(person) ? editHTML(person.uid) : ''}${revokeHTML(person.uid)}</div>${canConfigure(person) && editingUid === person.uid ? scopeFormHTML(person, true) : ''}` : ''}</div>`).join('')
    : `<p class="community-muted">${modern ? t('还没有管理成员。', 'No staff members yet.') : t('还没有版主。', 'No moderators yet.')}</p>`;

  let result = '';
  if (candidate?.state === 'loading') result = `<p class="community-form-status" role="status">${t('正在查找读者…', 'Looking up the reader…')}</p>`;
  else if (candidate?.state === 'error') {
    const fallback = candidate.status === 404 ? t('没有找到这位读者，请检查 UID。', 'Reader not found. Check the UID.') : t('暂时无法查找，请稍后重试。', 'Could not look up the reader. Please retry.');
    result = `<p class="community-form-status" role="status">${esc(candidate.message || fallback)}</p>`;
  } else if (candidate?.state === 'ready') {
    const member = candidate.data;
    const uid = member.person.uid;
    const eligible = (!modern || Boolean(assignableRoles.length && actorStaff?.permissions.includes('staff.appoint'))) && member.canAppoint && member.person.role === 'reader' && !member.self && Boolean(uid);
    const configurable = canConfigure({ ...member.person, staff: member.staff, canAppoint: member.canAppoint });
    const alreadyEditing = eligible && configurable && member.steward && editingUid === uid && stewards.some(person => person.uid === uid);
    result = `<div class="community-steward-row">${personHTML(member.person, member.steward)}${eligible && uid && member.steward ? `<div class="community-action-group">${configurable ? editHTML(uid) : ''}${revokeHTML(uid, true)}</div>` : ''}${eligible && !member.steward ? scopeFormHTML({ ...member.person, staff: member.staff }, false, true) : ''}</div>`
      + (alreadyEditing ? `<p class="community-muted" role="status">${modern ? t('正在上方调整这位成员的管理配置。', 'This member’s management configuration is being edited above.') : t('正在上方调整这位版主的负责板块。', 'This moderator’s assigned boards are being edited above.')}</p>` : eligible ? '' : `<p class="community-muted" role="status">${modern ? t('这位成员不在你的任命范围内。', 'This member is outside your appointment authority.') : t('这位成员不能任命为版主。', 'This member cannot be appointed as a moderator.')}</p>`);
  }

  return `<section class="community-steward-section"><h2>${modern ? t('当前管理成员', 'Current staff') : t('当前版主', 'Current moderators')}</h2>${list}</section>`
    + (modern && (!assignableRoles.length || !actorStaff?.permissions.includes('staff.appoint')) ? '' : `<section class="community-steward-section"><h2>${modern ? actorStaff?.role === 'owner' ? t('任命管理成员', 'Appoint staff') : t('任命下一级', 'Appoint the next role') : t('添加版主', 'Add a moderator')}</h2><form class="community-steward-lookup" data-community-form="steward-lookup">`
    + `<div class="community-field"><label class="community-field-l" for="community-steward-uid">${t('读者 UID', 'Reader UID')}</label><input id="community-steward-uid" name="uid" type="text" required maxlength="64" autocomplete="off" placeholder="${t('输入读者 UID', 'Enter the reader UID')}"></div>`
    + `<button type="submit" class="community-button">${icons.search || ''}<span>${t('查找读者', 'Find reader')}</span></button><p class="community-form-status" role="status" aria-live="polite"></p></form>`
    + `<div class="community-steward-candidate" aria-live="polite"${candidate?.state === 'loading' ? ' aria-busy="true"' : ''}>${result}</div></section>`);
}
