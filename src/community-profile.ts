import { avatarHTML, communityStatusHTML, memberHref, emptyHTML, beijingTime } from './community.mjs';
import type { Common, CommunityLoad, CommunityPerson } from './community.ts';

export type CommunityProfileFrame = { id: string; name: string; ref: string; image: string | null };
export type CommunityProfileImage = { id: string; url: string; width: number; height: number };
export type CommunityProfileBackground = {
  approved: CommunityProfileImage | null;
  pending: (CommunityProfileImage & { createdAt: string }) | null;
};
export type CommunityProfile = {
  person: CommunityPerson; signature: string; pendingSignature: string | null;
  pendingAvatar: boolean; canEditProfile: boolean;
  frames: CommunityProfileFrame[]; background: CommunityProfileBackground;
};
export type CommunityProfileReview = {
  id: string; kind: 'avatar' | 'signature'; nickname: string; uid: string | null;
  proposedValue: string | null; avatarUrl: string | null; createdAt: string;
};
export type CommunityBackgroundReview = {
  memberUid: string; nickname: string; imageId: string; imageUrl: string;
  createdAt: string; width: number; height: number;
};

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const imagePath = new RegExp(`^/api/community/(?:images/${uuid}(?:\\.thumb)?\\.webp|profile/background/${uuid}\\.webp|manage/profiles/${uuid}/avatar\\.webp)$`);
export const profileImageURL = (value: string | null | undefined) => value && imagePath.test(value) ? value : '';
const statusLine = '<p class="community-form-status" role="status" aria-live="polite"></p>';

export function communityProfileHTML({ profile, ...common }: Common & { profile: CommunityLoad<CommunityProfile> }) {
  const { t, esc, icons = {} } = common;
  const start = `<section class="page community-page community-profile" data-community="profile"><header class="community-page-head"><h1>${t('编辑资料', 'Edit profile')}</h1>`;
  if (profile.state !== 'ready') return start + '</header>' + communityStatusHTML(profile, common) + '</section>';
  const data = profile.data;
  const back = `<a class="community-button is-small" data-profile-return href="${memberHref(data.person.uid || 'owner')}">${icons.left || ''}${t('返回我的主页', 'Back to my profile')}</a>`;
  const head = `${start}${back}</header><div class="community-profile-person">${avatarHTML(data.person, common, 'xl', false)}<div><strong>${esc(data.person.name)}</strong><p data-profile-approved-signature>${esc(data.signature)}</p></div></div>`;
  if (!data.canEditProfile) return head + `<p class="community-muted">${t('当前身份不能修改读者资料。', 'This identity cannot edit reader details.')}</p></section>`;
  const pendingAvatar = data.pendingAvatar ? `<div class="community-profile-pending"><img src="/api/community/profile/avatar/pending.webp" alt="${t('待审核头像', 'Pending avatar')}" width="72" height="72"><span>${t('新头像待审核，当前头像保持显示。', 'New avatar pending review; your current avatar remains visible.')}</span></div>` : '';
  const upload = (kind: 'avatar' | 'background', label: string) => `<form class="community-panel" data-community-form="profile-${kind}"><h2 class="community-panel-title">${label}</h2>${kind === 'avatar' ? pendingAvatar : backgroundPreview(data.background, common)}<div class="community-field"><label class="community-field-l" for="community-profile-${kind}">${t('选择图片', 'Choose image')}</label><input id="community-profile-${kind}" type="file" name="file" data-profile-file="${kind}" accept="image/jpeg,image/png,image/webp" required></div><p class="community-muted">${kind === 'avatar' ? t('JPG、PNG 或 WebP，最多 2MB；审核通过后与主站同步。', 'JPG, PNG or WebP, up to 2MB. Synced after approval.') : t('JPG、PNG 或 WebP，最多 2MB；背景仅用于社区个人主页，审核通过后展示。', 'JPG, PNG or WebP, up to 2MB. Used only on your community profile after approval.')}</p>${statusLine}<div class="community-form-actions is-start"><button class="community-button is-gold" type="submit">${t('提交审核', 'Submit for review')}</button>${kind === 'avatar' && (data.person.avatar || data.pendingAvatar) || kind === 'background' && (data.background?.approved || data.background?.pending) ? `<button class="community-button" type="button" data-action="community-profile-remove" data-kind="${kind}">${t('恢复默认并取消待审', 'Reset and cancel pending')}</button>` : ''}</div></form>`;
  const signature = `<form class="community-panel" data-community-form="profile-signature"><h2 class="community-panel-title">${t('个性签名', 'Signature')}</h2><div class="community-field"><label class="community-field-l" for="community-profile-signature">${t('个性签名', 'Signature')}</label><input id="community-profile-signature" name="signature" type="text" maxlength="100" autocomplete="off" value="${esc(data.pendingSignature ?? data.signature)}" aria-describedby="community-profile-signature-hint"></div><p class="community-muted" id="community-profile-signature-hint">${data.pendingSignature !== null ? t('修改待审核，主页仍显示已通过的个签。', 'Changes pending review; the approved signature remains visible.') : t('最多 100 字，可留空。审核通过后与主站同步。', 'Up to 100 characters. Synced after approval.')}</p>${statusLine}<div class="community-form-actions is-start"><button type="submit" class="community-button is-gold">${t('保存个签', 'Save signature')}</button></div></form>`;
  const frame = `<form class="community-panel" data-community-form="profile-frame"><h2 class="community-panel-title">${t('头像框', 'Avatar frame')}</h2><div class="community-field"><label class="community-field-l" for="community-profile-frame">${t('已拥有的头像框', 'Owned frames')}</label><select id="community-profile-frame" name="ref"><option value="">${t('不佩戴头像框', 'No frame')}</option>${(data.frames || []).map(item => `<option value="${esc(item.ref)}"${item.ref === data.person.frame ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div><p class="community-muted">${t('穿戴状态与主站同步。', 'Your equipped frame is shared with the main site.')}</p>${statusLine}<div class="community-form-actions is-start"><button type="submit" class="community-button is-gold">${t('保存穿戴', 'Save frame')}</button></div></form>`;
  return head + `<div class="community-profile-grid">${upload('avatar', t('头像', 'Avatar'))}${signature}${frame}${upload('background', t('个人主页背景', 'Profile background'))}</div></section>`;
}

function backgroundPreview(background: CommunityProfileBackground | undefined, { t, esc }: Common) {
  const preview = (image: CommunityProfileImage | null | undefined, caption: string) => {
    const url = profileImageURL(image?.url);
    return url ? `<figure class="community-profile-background"><img src="${esc(url)}" alt="${caption}"><figcaption>${caption}</figcaption></figure>` : '';
  };
  return preview(background?.approved, t('当前背景', 'Current background')) + preview(background?.pending, t('待审核背景，审核期间保持当前背景。', 'Pending review; your current background stays visible.'));
}

export function communityProfileReviewsHTML(profiles: readonly CommunityProfileReview[], backgrounds: readonly CommunityBackgroundReview[], owner: boolean, common: Common) {
  const { t, esc } = common;
  const rows = profiles.filter(item => owner || item.kind === 'avatar').map(item => {
    const url = profileImageURL(item.avatarUrl);
    return `<li class="community-queue-item" data-profile-review="${esc(item.id)}"><div class="community-queue-main"><strong>${esc(item.nickname)} · ${item.kind === 'avatar' ? t('头像', 'Avatar') : t('个签', 'Signature')}</strong><span class="community-muted">${esc(beijingTime(item.createdAt))}</span>${item.kind === 'avatar' ? url ? `<img class="community-profile-review-avatar" src="${esc(url)}" alt="${t('待审核头像', 'Pending avatar')}">` : '' : `<p class="community-queue-body">${esc(item.proposedValue ?? '')}</p>`}</div><div class="community-queue-acts">${['approve', 'reject'].map(decision => `<button class="community-button is-small${decision === 'approve' ? ' is-good' : ' is-danger'}" type="button" data-action="community-profile-review" data-id="${esc(item.id)}" data-decision="${decision}">${decision === 'approve' ? t('通过', 'Approve') : t('驳回', 'Reject')}</button>`).join('')}</div></li>`;
  });
  if (owner) for (const item of backgrounds) {
    const url = profileImageURL(item.imageUrl);
    rows.push(`<li class="community-queue-item" data-background-review="${esc(item.imageId)}"><form class="community-queue-main" data-community-form="profile-background-review" data-uid="${esc(item.memberUid)}" data-image="${esc(item.imageId)}"><strong>${esc(item.nickname)} · ${t('个人主页背景', 'Profile background')}</strong><span class="community-muted">${esc(beijingTime(item.createdAt))}</span>${url ? `<img class="community-profile-review-background" src="${esc(url)}" alt="${t('待审核背景', 'Pending background')}">` : ''}<div class="community-field"><label class="community-field-l" for="profile-background-reason-${esc(item.imageId)}">${t('驳回理由', 'Rejection reason')}</label><input id="profile-background-reason-${esc(item.imageId)}" name="reason" maxlength="200" type="text"></div>${statusLine}<div class="community-form-actions is-start"><button class="community-button is-small is-good" type="submit" name="decision" value="approve">${t('通过', 'Approve')}</button><button class="community-button is-small is-danger" type="submit" name="decision" value="reject">${t('驳回', 'Reject')}</button></div></form></li>`);
  }
  return rows.length ? `<ul class="community-queue">${rows.join('')}</ul>` : emptyHTML(common, t('没有待审核资料', 'No profiles awaiting review'));
}
