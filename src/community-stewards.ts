import { avatarHTML, nameHTML, communityBoards } from './community.mjs';
import type { Common, CommunityLoad, CommunityPerson } from './community.ts';
import type { CommunityMember } from './community-pages.ts';

export function communityStewardsHTML(stewards: CommunityPerson[], candidate: CommunityLoad<CommunityMember> | null, common: Common, editingUid: string | null = null): string {
  const { t, esc, icons = {} } = common;
  const boardsHTML = (person: CommunityPerson) => {
    const scope = person.moderationBoards;
    const labels = scope === undefined
      ? `<span class="community-tag is-legacy">${t('全部板块（原有权限）', 'All boards (existing permission)')}</span>`
      : communityBoards.filter(board => scope.includes(board.id)).map(board => `<span class="community-tag" data-steward-board="${board.id}">${esc(t(board.zh, board.en))}</span>`).join('') || `<span class="community-muted">${t('未分配板块', 'No boards assigned')}</span>`;
    return `<div class="community-steward-boards">${labels}</div>`;
  };
  const personHTML = (person: CommunityPerson, existing = false) => `<div class="community-steward-person">${avatarHTML(person, common, 'md')}<div>${nameHTML(person, common)}<span class="community-muted is-mono">${person.uid ? `UID ${esc(person.uid)}` : t('没有读者 UID', 'No reader UID')}</span>${existing ? boardsHTML(person) : ''}</div></div>`;
  const revokeHTML = (uid: string, fromLookup = false) => `<button type="button" class="community-button is-small is-danger" data-action="community-steward" data-uid="${esc(uid)}" data-on="false"${fromLookup ? ' data-steward-candidate="true"' : ''}>${icons.shield || ''}<span>${t('撤销版主', 'Revoke moderator')}</span></button>`;
  const scopeFormHTML = (person: CommunityPerson, existing: boolean, fromLookup = false) => {
    const uid = person.uid || '';
    const id = `community-steward-scope-${encodeURIComponent(uid)}`;
    const selected = new Set(person.moderationBoards ?? (existing ? communityBoards.map(board => board.id) : []));
    return `<form id="${esc(id)}" class="community-steward-scope" data-community-form="steward-scope" data-uid="${esc(uid)}" data-existing="${existing}"${fromLookup ? ' data-steward-candidate="true"' : ''} novalidate>`
      + `<fieldset class="community-choices" aria-describedby="${esc(id)}-hint"><legend>${t('负责板块', 'Assigned boards')}</legend><div class="community-choice-list">${communityBoards.map(board => `<label class="community-choice" for="${esc(id)}-${board.id}"><input id="${esc(id)}-${board.id}" type="checkbox" name="boards" value="${board.id}"${selected.has(board.id) ? ' checked' : ''}><span>${esc(t(board.zh, board.en))}</span></label>`).join('')}</div></fieldset>`
      + `<p id="${esc(id)}-hint" class="community-muted">${t('至少选择一个板块，可多选；版主只能管理所选板块内容，也可以执行全社区禁言。', 'Select one or more boards. Moderators can manage content in their assigned boards and issue community-wide mutes.')}</p>`
      + `<p class="community-form-status" role="status" aria-live="polite"></p><div class="community-action-group"><button type="submit" class="community-button is-gold">${icons.shield || ''}<span>${existing ? t('保存负责板块', 'Save assigned boards') : t('任命为版主', 'Appoint moderator')}</span></button><button type="button" class="community-button" data-action="community-steward-edit-cancel">${t('取消', 'Cancel')}</button></div></form>`;
  };
  const editHTML = (uid: string) => `<button type="button" class="community-button is-small" data-action="community-steward-edit" data-uid="${esc(uid)}" aria-expanded="${editingUid === uid}" aria-controls="community-steward-scope-${esc(encodeURIComponent(uid))}">${icons.pen || ''}<span>${t('调整负责板块', 'Edit assigned boards')}</span></button>`;
  const list = stewards.length
    ? stewards.map(person => `<div class="community-steward-row">${personHTML(person, true)}${person.uid ? `<div class="community-action-group">${editHTML(person.uid)}${revokeHTML(person.uid)}</div>${editingUid === person.uid ? scopeFormHTML(person, true) : ''}` : ''}</div>`).join('')
    : `<p class="community-muted">${t('还没有版主。', 'No moderators yet.')}</p>`;

  let result = '';
  if (candidate?.state === 'loading') result = `<p class="community-form-status" role="status">${t('正在查找读者…', 'Looking up the reader…')}</p>`;
  else if (candidate?.state === 'error') {
    const fallback = candidate.status === 404 ? t('没有找到这位读者，请检查 UID。', 'Reader not found. Check the UID.') : t('暂时无法查找，请稍后重试。', 'Could not look up the reader. Please retry.');
    result = `<p class="community-form-status" role="status">${esc(candidate.message || fallback)}</p>`;
  } else if (candidate?.state === 'ready') {
    const member = candidate.data;
    const uid = member.person.uid;
    const eligible = member.canAppoint && member.person.role === 'reader' && !member.self && Boolean(uid);
    const alreadyEditing = eligible && member.steward && editingUid === uid && stewards.some(person => person.uid === uid);
    result = `<div class="community-steward-row">${personHTML(member.person, member.steward)}${eligible && uid && member.steward ? `<div class="community-action-group">${editHTML(uid)}${revokeHTML(uid, true)}</div>` : ''}${eligible && !member.steward ? scopeFormHTML(member.person, false, true) : ''}</div>`
      + (alreadyEditing ? `<p class="community-muted" role="status">${t('正在上方调整这位版主的负责板块。', 'This moderator’s assigned boards are being edited above.')}</p>` : eligible ? '' : `<p class="community-muted" role="status">${t('这位成员不能任命为版主。', 'This member cannot be appointed as a moderator.')}</p>`);
  }

  return `<section class="community-steward-section"><h2>${t('当前版主', 'Current moderators')}</h2>${list}</section>`
    + `<section class="community-steward-section"><h2>${t('添加版主', 'Add a moderator')}</h2><form class="community-steward-lookup" data-community-form="steward-lookup">`
    + `<div class="community-field"><label class="community-field-l" for="community-steward-uid">${t('读者 UID', 'Reader UID')}</label><input id="community-steward-uid" name="uid" type="text" required maxlength="64" autocomplete="off" placeholder="${t('输入读者 UID', 'Enter the reader UID')}"></div>`
    + `<button type="submit" class="community-button">${icons.search || ''}<span>${t('查找读者', 'Find reader')}</span></button><p class="community-form-status" role="status" aria-live="polite"></p></form>`
    + `<div class="community-steward-candidate" aria-live="polite"${candidate?.state === 'loading' ? ' aria-busy="true"' : ''}>${result}</div></section>`;
}
