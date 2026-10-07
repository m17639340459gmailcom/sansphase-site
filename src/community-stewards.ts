import { avatarHTML, nameHTML, communityBoards } from './community.mjs';
import type { Common, CommunityLoad, CommunityPerson } from './community.ts';
import type { CommunityMember } from './community-pages.ts';
import { communityStaffRoles, communityStaffCapabilities, communityStaffDefaultPermissions, communityStaffNextRole } from './community-staff.mjs';
import type { CommunityStaffState } from './community-staff.ts';

export function communityStewardsHTML(stewards: Array<CommunityPerson & { staff?: CommunityStaffState | null; canAppoint?: boolean }>, candidate: CommunityLoad<CommunityMember> | null, common: Common, editingUid: string | null = null, actorStaff?: CommunityStaffState | null): string {
  const { t, esc, icons = {} } = common;
  const nextRole = actorStaff ? communityStaffNextRole(actorStaff.role) : null;
  const modern = actorStaff !== undefined;
  // Verified state permits owner -> moderator only for a migrated appointment.
  // Preserve that existing role when editing; all new appointments use nextRole.
  const appointedRole = (person: { staff?: CommunityStaffState | null }, existing: boolean) => existing && actorStaff?.role === 'owner'
    && person.staff?.role === 'moderator' && person.staff.parent?.kind === 'owner' ? 'moderator' : nextRole;
  const canRevoke = (person: CommunityPerson & { canAppoint?: boolean }) => !modern || Boolean(actorStaff?.permissions.includes('staff.appoint') && person.canAppoint === true);
  const canConfigure = (person: CommunityPerson & { staff?: CommunityStaffState | null; canAppoint?: boolean }) => !modern || Boolean(canRevoke(person) && appointedRole(person, true) && person.staff?.role === appointedRole(person, true));
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
    const capabilities = modern && role ? `<div class="community-field"><label class="community-field-l" for="${esc(id)}-role">${t('任命身份', 'Appointed role')}</label><select id="${esc(id)}-role" name="role"><option value="${role}">${roleLabel(role)}</option></select></div>${(['permissions', 'delegable'] as const).map(kind => `<fieldset class="community-choices"><legend>${kind === 'permissions' ? t('可执行的能力', 'Granted capabilities') : t('允许继续下发的能力', 'Capabilities that may be delegated')}</legend><div class="community-choice-list">${caps.map(cap => `<label class="community-choice" for="${esc(id)}-${kind}-${cap.id}"><input id="${esc(id)}-${kind}-${cap.id}" type="checkbox" name="${kind}" value="${cap.id}"${(kind === 'permissions' ? permissions : delegable).has(cap.id) ? ' checked' : ''}><span>${esc(t(cap.name, cap.nameEn))}${cap.scope === 'global' ? ` · ${t('全账号 / 全社区', 'Account / community wide')}` : ` · ${t('所选板块', 'Assigned boards')}`}</span></label>`).join('') || `<span class="community-muted">${t('上级没有授予可下发的能力。', 'No delegable capabilities were granted by the superior.')}</span>`}</div></fieldset>`).join('')}` : '';
    return `<form id="${esc(id)}" class="community-steward-scope" data-community-form="steward-scope" data-uid="${esc(uid)}" data-existing="${existing}"${fromLookup ? ' data-steward-candidate="true"' : ''} novalidate>`
      + `<fieldset class="community-choices" aria-describedby="${esc(id)}-hint"><legend>${t('负责板块', 'Assigned boards')}</legend><div class="community-choice-list">${boards.map(board => `<label class="community-choice" for="${esc(id)}-${board.id}"><input id="${esc(id)}-${board.id}" type="checkbox" name="boards" value="${board.id}"${selected.has(board.id) ? ' checked' : ''}><span>${esc(t(board.zh, board.en))}</span></label>`).join('')}</div></fieldset>${capabilities}`
      + `<p id="${esc(id)}-hint" class="community-muted">${modern ? t('只可任命相邻的下一级，并分配上级允许你下发的能力；删除、扣分、禁言不会自动获得。全账号资料审核不受板块限制。允许继续下发的能力必须同时勾选为可执行。', 'Appoint only the next role and grant capabilities your superior permits you to delegate. Deletion, penalties and mutes are not automatic. Account profile review is independent of board scope. A delegable capability must also be granted.') : t('至少选择一个板块，可多选；版主只能管理所选板块内容，也可以执行全社区禁言。', 'Select one or more boards. Moderators can manage content in their assigned boards and issue community-wide mutes.')}</p>`
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
    const eligible = member.canAppoint && member.person.role === 'reader' && !member.self && Boolean(uid);
    const configurable = canConfigure({ ...member.person, staff: member.staff, canAppoint: member.canAppoint });
    const alreadyEditing = eligible && configurable && member.steward && editingUid === uid && stewards.some(person => person.uid === uid);
    result = `<div class="community-steward-row">${personHTML(member.person, member.steward)}${eligible && uid && member.steward ? `<div class="community-action-group">${configurable ? editHTML(uid) : ''}${revokeHTML(uid, true)}</div>` : ''}${eligible && !member.steward ? scopeFormHTML({ ...member.person, staff: member.staff }, false, true) : ''}</div>`
      + (alreadyEditing ? `<p class="community-muted" role="status">${t('正在上方调整这位版主的负责板块。', 'This moderator’s assigned boards are being edited above.')}</p>` : eligible ? '' : `<p class="community-muted" role="status">${modern ? t('这位成员不在你的任命范围内。', 'This member is outside your appointment authority.') : t('这位成员不能任命为版主。', 'This member cannot be appointed as a moderator.')}</p>`);
  }

  return `<section class="community-steward-section"><h2>${modern ? t('当前管理成员', 'Current staff') : t('当前版主', 'Current moderators')}</h2>${list}</section>`
    + `<section class="community-steward-section"><h2>${modern ? t('任命下一级', 'Appoint the next role') : t('添加版主', 'Add a moderator')}</h2><form class="community-steward-lookup" data-community-form="steward-lookup">`
    + `<div class="community-field"><label class="community-field-l" for="community-steward-uid">${t('读者 UID', 'Reader UID')}</label><input id="community-steward-uid" name="uid" type="text" required maxlength="64" autocomplete="off" placeholder="${t('输入读者 UID', 'Enter the reader UID')}"></div>`
    + `<button type="submit" class="community-button">${icons.search || ''}<span>${t('查找读者', 'Find reader')}</span></button><p class="community-form-status" role="status" aria-live="polite"></p></form>`
    + `<div class="community-steward-candidate" aria-live="polite"${candidate?.state === 'loading' ? ' aria-busy="true"' : ''}>${result}</div></section>`;
}
