import { avatarHTML, communityStatusHTML, emptyHTML, beijingTime, communityReaderReadOnly } from './community.mjs';
import type { Common, CommunityLoad, CommunityPerson, CommunityMe } from './community.ts';

export type CommunityProfileFrame = { id: string; name: string; ref: string; image: string | null };
export type CommunityProfileImage = { id: string; url: string; width: number; height: number };
export type CommunityProfileBackground = {
  approved: CommunityProfileImage | null;
  pending: (CommunityProfileImage & { createdAt: string }) | null;
};
export type CommunityProfile = {
  person: CommunityPerson; signature: string; pendingSignature: string | null;
  pendingNickname?: string | null;
  pendingAvatar: boolean; canEditProfile: boolean;
  frames: CommunityProfileFrame[]; background: CommunityProfileBackground;
  cover?: string | null; coverImage?: string | null; coverName?: string | null;
};
export type CommunityProfileAdvice = { id: string; decision: 'approve' | 'reject'; reason: string; by: { kind: 'owner' | 'reader'; id: string }; createdAt: string };
export type CommunityProfileReviewProof = { canAdvise?: boolean; canDecide?: boolean; advice?: CommunityProfileAdvice[] };
export type CommunityProfileReview = CommunityProfileReviewProof & {
  id: string; kind: 'avatar' | 'signature' | 'nickname'; nickname: string; uid: string | null;
  proposedValue: string | null; avatarUrl: string | null; createdAt: string;
};
export type CommunityBackgroundReview = CommunityProfileReviewProof & {
  memberUid: string; nickname: string; imageId: string; imageUrl: string;
  createdAt: string; width: number; height: number;
};

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const imagePath = new RegExp(`^/api/community/(?:images/${uuid}(?:\\.thumb)?\\.webp|profile/background/${uuid}\\.webp|manage/profiles/${uuid}/avatar\\.webp)$`);
export const profileImageURL = (value: string | null | undefined) => value && imagePath.test(value) ? value : '';
const statusLine = '<p class="community-form-status" role="status" aria-live="polite"></p>';

export function communityProfileFramesHTML(profile: CommunityLoad<CommunityProfile>, me: CommunityMe | null, common: Common): string {
  const { t, esc } = common;
  if (profile.state !== 'ready') return `<section class="community-card">${communityStatusHTML(profile, common)}</section>`;
  const data = profile.data;
  if (!me?.uid || data.person.uid !== me.uid) return `<section class="community-card"><p class="community-muted">${t('请重新加载本人的头像框。', 'Reload your own avatar frames.')}</p></section>`;
  const editable = !communityReaderReadOnly(me), staff = me.role !== 'owner' && Boolean(me.staffRole);
  return `<section class="community-card community-icon-panel" data-community-frames><header class="community-icon-panel-head"><div><h2>${t('头像框佩戴', 'Avatar frames')}</h2><p class="community-muted">${t('只展示你已拥有的头像框，佩戴不会重复兑换或扣除星尘。', 'Only your owned frames are shown. Equipping does not redeem again or cost stardust.')}</p></div><button type="button" class="community-button is-small" data-action="community-frame-equip" data-frame-ref="" aria-pressed="${!me.frame}"${editable ? '' : ' disabled'}>${t('取下商城头像框', 'Remove shop frame')}</button></header>`
    + (staff ? `<p class="community-muted" data-frame-staff-hint>${t('当前职务头像框会优先自动显示；这里选择的商城头像框会保留，在职务结束后使用。', 'Your current staff frame takes priority. Your shop-frame selection stays saved and is used when the appointment ends.')}</p>` : '')
    + `<p class="community-icon-current"><span>${esc(me.name)}</span><span>${t(me.frame ? staff ? '商城头像框已设置' : '当前已佩戴' : '当前未设置商城头像框', me.frame ? 'Shop frame selected' : 'No shop frame selected')}</span></p>`
    + (data.frames.length ? `<div class="community-icon-grid community-frame-grid">${data.frames.map(frame => {
      const selected = me.frame === frame.ref;
      return `<button type="button" class="community-icon-choice community-frame-choice${selected ? ' is-selected' : ''}" data-action="community-frame-equip" data-frame-ref="${esc(frame.ref)}" aria-pressed="${selected}" aria-label="${esc(`${frame.name}，${selected ? t('已设置', 'Selected') : t('可佩戴', 'Available')}`)}"${editable ? '' : ' disabled'}><span class="community-frame-choice-preview">${avatarHTML({ name: me.name, uid: null, role: 'reader', staffRole: null, frame: frame.ref }, common, 'xl', false)}</span><b>${esc(frame.name)}</b><span class="community-icon-choice-status">${selected ? staff ? t('已设置', 'Selected') : t('已佩戴', 'Equipped') : t('可佩戴', 'Available')}</span></button>`;
    }).join('')}</div>` : `<p class="community-muted">${t('你还没有拥有商城头像框。', 'You do not own any shop frames yet.')}</p>`)
    + `<a class="community-more" href="#/community/shop/look">${t('前往兑换商城', 'Visit the exchange')}</a></section>`;
}

export function communityProfileHTML({ profile, ...common }: Common & { profile: CommunityLoad<CommunityProfile> }) {
  const { t, esc, icons = {} } = common;
  if (profile.state !== 'ready') return `<div class="community-profile-loading">${communityStatusHTML(profile, common)}</div>`;
  const data = profile.data;
  if (!data.canEditProfile) return `<p class="community-muted">${t('当前身份不能修改读者资料。', 'This identity cannot edit reader details.')}</p>`;
  const pick = (kind: 'avatar' | 'background') => `<label class="community-profile-picker community-button is-small" for="community-profile-${kind}">${icons.image || ''}<span>${kind === 'avatar' ? t('更换头像', 'Change avatar') : t('选择背景', 'Choose background')}</span><input id="community-profile-${kind}" type="file" name="file" data-profile-file="${kind}" accept="image/jpeg,image/png,image/webp" aria-describedby="community-profile-${kind}-hint"></label>`;
  const uploadActions = (kind: 'avatar' | 'background', canReset: boolean) => `<div data-profile-crop="${kind}" hidden></div><div class="community-profile-upload-actions"><button class="community-button is-small is-gold" type="submit" data-profile-upload-submit hidden>${t('提交审核', 'Submit for review')}</button><button class="community-button is-small" type="button" data-profile-clear="${kind}" hidden>${t('取消选择', 'Clear selection')}</button>${canReset ? `<button class="community-button is-small" type="button" data-action="community-profile-remove" data-kind="${kind}">${t('恢复默认', 'Reset to default')}</button>` : ''}</div>`;
  const pendingAvatar = data.pendingAvatar ? `<div class="community-profile-pending"><img src="/api/community/profile/avatar/pending.webp" alt="${t('待审核头像', 'Pending avatar')}" width="36" height="36"><span>${t('新头像待审核', 'New avatar pending review')}</span></div>` : '';
  const avatar = `<form class="community-profile-identity" data-community-form="profile-avatar"><div class="community-profile-avatar" data-profile-preview="avatar">${avatarHTML(data.person, common, 'xl', false)}</div><div class="community-profile-identity-text"><strong>${esc(data.person.name)}</strong><span class="community-profile-uid">UID ${esc(data.person.uid || '—')}</span><p data-profile-approved-signature>${esc(data.signature)}</p><div class="community-profile-avatar-tools">${pick('avatar')}${pendingAvatar}</div></div><div class="community-profile-upload-foot"><p class="community-profile-hint" id="community-profile-avatar-hint">${t('JPG、PNG、WebP · 原图最大 25MB · 裁剪后提交审核，与主站同步', 'JPG, PNG, WebP · Originals up to 25MB · Crop and submit for review; synced after approval')}</p><p class="community-profile-file-name" data-profile-file-name="avatar" hidden></p>${statusLine}${uploadActions('avatar', Boolean(data.person.avatar || data.pendingAvatar))}</div></form>`;
  const signature = `<form class="community-profile-section" data-community-form="profile-signature"><div class="community-profile-section-head"><label class="community-field-l" for="community-profile-signature">${t('个性签名', 'Signature')}</label><span class="community-profile-tag">${t('与主站同步', 'Shared with main site')}</span></div><div class="community-field"><textarea id="community-profile-signature" name="signature" rows="2" maxlength="100" autocomplete="off" placeholder="${t('写一句话介绍自己', 'A few words about yourself')}" aria-describedby="community-profile-signature-hint">${esc(data.pendingSignature ?? data.signature)}</textarea><small data-count-for="signature">${[...(data.pendingSignature ?? data.signature)].length} / 100</small></div><div class="community-profile-section-foot"><p class="community-profile-hint" id="community-profile-signature-hint">${data.pendingSignature !== null ? t('个签待审核，主页仍显示已通过的内容。', 'Pending review; your approved signature remains visible.') : t('审核通过后展示，可以留空。', 'Visible after approval. Can be left empty.')}</p><button type="submit" class="community-button is-small is-gold">${t('保存个签', 'Save signature')}</button></div>${statusLine}</form>`;
  const nickname = `<form class="community-profile-section" data-community-form="profile-nickname"><div class="community-profile-section-head"><label class="community-field-l" for="community-profile-nickname">${t('昵称', 'Nickname')}</label><span class="community-profile-tag">${t('与主站同步', 'Shared with main site')}</span></div><div class="community-field"><input id="community-profile-nickname" name="nickname" type="text" minlength="2" maxlength="128" autocomplete="nickname" value="${esc(data.pendingNickname ?? data.person.name)}" aria-describedby="community-profile-nickname-hint"></div><div class="community-profile-section-foot"><p class="community-profile-hint" id="community-profile-nickname-hint">${data.pendingNickname != null ? t('昵称待审核，主页仍显示已通过的昵称。', 'Pending review; your approved nickname remains visible.') : t('2–8 个可见字符，审核通过后展示。', '2–8 visible characters; shown after approval.')}</p><button type="submit" class="community-button is-small is-gold">${t('保存昵称', 'Save nickname')}</button></div>${statusLine}</form>`;
  const background = `<form class="community-profile-section" data-community-form="profile-background"><div class="community-profile-section-head"><h3>${t('主页背景', 'Profile background')}</h3><span class="community-profile-tag">${t('仅社区展示', 'Community only')}</span></div>${backgroundPreview(data, common)}<div class="community-profile-section-foot">${pick('background')}<p class="community-profile-hint" id="community-profile-background-hint">${t('JPG、PNG、WebP · 原图最大 25MB · 可自由裁剪，只保留当前背景和待审核替换图', 'JPG, PNG, WebP · Originals up to 25MB · Free crop; one current background and one pending replacement')}</p></div><p class="community-profile-file-name" data-profile-file-name="background" hidden></p>${statusLine}${uploadActions('background', Boolean(data.background?.approved || data.background?.pending || data.cover))}</form>`;
  return avatar + nickname + signature + background;
}

export function communityProfileDialogHTML(common: Common) {
  const { t, icons = {} } = common;
  return `<div class="community-profile-backdrop" data-a11y-dialog-hide aria-hidden="true"></div><section class="community-profile-window" role="document"><header class="community-profile-head"><div><h2 id="community-profile-title">${t('编辑资料', 'Edit profile')}</h2><p>${t('让大家认识现在的你', 'Let others get to know you')}</p></div><button type="button" class="community-profile-close" data-a11y-dialog-hide data-profile-close aria-label="${t('关闭编辑资料', 'Close profile editor')}">${icons.close || '×'}</button></header><div class="community-profile-content" data-profile-content></div><footer class="community-profile-footer"><a class="community-profile-frames-link" href="#/community/shop/mine" data-profile-owned-frames>${icons.box || ''}${t('头像框与背景 · 前往已拥有', 'Frames and backgrounds · Owned items')}${icons.right || '›'}</a><button type="button" class="community-button is-small" data-a11y-dialog-hide>${t('完成', 'Done')}</button><p class="community-form-status" data-profile-dialog-status role="status" aria-live="polite"></p></footer></section>`;
}

function backgroundPreview(data: CommunityProfile, { t, esc }: Common) {
  const background = data.background;
  const preview = (value: string | null | undefined, caption: string) => {
    const url = profileImageURL(value);
    return url ? `<figure class="community-profile-background"><img src="${esc(url)}" alt="${caption}"><figcaption>${caption}</figcaption></figure>` : '';
  };
  const shown = background?.pending || background?.approved;
  const image = preview(shown?.url || data.coverImage, background?.pending ? t('待审核 · 通过后替换当前背景', 'Pending review · Replaces your background after approval') : t('当前背景', 'Current background'));
  const preset = data.cover && /^[a-z]+$/.test(data.cover) ? data.cover : '';
  const fallback = preset ? `<figure class="community-profile-background"><span class="community-cover-sample is-cover-${preset}" aria-hidden="true"><i></i><i></i></span><figcaption>${esc(data.coverName || t('当前背景', 'Current background'))}</figcaption></figure>` : `<div class="community-profile-background-default"><span>${t('默认社区背景', 'Default community background')}</span></div>`;
  return `<div class="community-profile-background-preview" data-profile-preview="background">${image || fallback}</div>`;
}

export function communityProfileReviewsHTML(profiles: readonly CommunityProfileReview[], backgrounds: readonly CommunityBackgroundReview[], owner: boolean, common: Common) {
  const { t, esc } = common;
  const proof = (item: CommunityProfileReviewProof, legacy: boolean) => ({ advise: item.canAdvise === true, decide: item.canDecide ?? legacy });
  const adviceHTML = (item: CommunityProfileReviewProof) => (item.advice || []).length ? `<div class="community-profile-advice"><p class="community-muted">${t('审核建议（资料仍待最终决定）', 'Review advice (awaiting a final decision)')}</p><ul>${item.advice!.map(entry => `<li>${esc(entry.decision === 'approve' ? t('建议通过', 'Recommend approval') : t('建议驳回', 'Recommend rejection'))}${entry.reason ? ` · ${esc(entry.reason)}` : ''}<span class="community-muted"> · ${esc(beijingTime(entry.createdAt))}</span></li>`).join('')}</ul></div>` : '';
  const reasonHTML = (id: string) => `<div class="community-field"><label class="community-field-l" for="profile-review-reason-${esc(id)}">${t('审核理由（驳回必填）', 'Reason (required for rejection)')}</label><input id="profile-review-reason-${esc(id)}" name="reason" maxlength="200" type="text"></div>${statusLine}`;
  const buttons = (rights: { advise: boolean; decide: boolean }, render: (decision: string, action: 'advise' | 'decide', label: string) => string) => (['advise', 'decide'] as const).flatMap(action => rights[action === 'advise' ? 'advise' : 'decide'] ? ['approve', 'reject'].map(decision => render(decision, action, action === 'advise' ? decision === 'approve' ? t('建议通过', 'Recommend approval') : t('建议驳回', 'Recommend rejection') : decision === 'approve' ? t('通过', 'Approve') : t('驳回', 'Reject'))) : []).join('');
  const rows = profiles.filter(item => item.canAdvise !== undefined || item.canDecide !== undefined || owner || item.kind === 'avatar').map(item => {
    const url = profileImageURL(item.avatarUrl);
    const rights = proof(item, owner || item.kind === 'avatar');
    return `<li class="community-queue-item" data-profile-review="${esc(item.id)}"><form class="community-queue-main" data-community-form="profile-review" data-id="${esc(item.id)}"><strong>${esc(item.nickname)} · ${item.kind === 'avatar' ? t('头像', 'Avatar') : item.kind === 'nickname' ? t('昵称', 'Nickname') : t('个签', 'Signature')}</strong><span class="community-muted">${esc(beijingTime(item.createdAt))}</span>${item.kind === 'avatar' ? url ? `<img class="community-profile-review-avatar" src="${esc(url)}" alt="${t('待审核头像', 'Pending avatar')}">` : '' : `<p class="community-queue-body">${esc(item.proposedValue ?? '')}</p>`}${adviceHTML(item)}${rights.advise ? `<p class="community-muted">${t('建议不会公开或驳回资料，仍须有最终审批权限的上级决定。', 'Advice does not publish or reject the profile; an authorized final reviewer must decide.')}</p>` : ''}${rights.advise || rights.decide ? reasonHTML(item.id) : ''}<div class="community-form-actions is-start">${buttons(rights, (decision, action, label) => `<button class="community-button is-small${decision === 'approve' ? ' is-good' : ' is-danger'}" type="button" data-action="community-profile-review" data-id="${esc(item.id)}" data-decision="${decision}" data-review-action="${action}">${label}</button>`)}</div></form></li>`;
  });
  for (const item of backgrounds.filter(item => owner || item.canAdvise !== undefined || item.canDecide !== undefined)) {
    const url = profileImageURL(item.imageUrl);
    const rights = proof(item, owner);
    rows.push(`<li class="community-queue-item" data-background-review="${esc(item.imageId)}"><form class="community-queue-main" data-community-form="profile-background-review" data-uid="${esc(item.memberUid)}" data-image="${esc(item.imageId)}"><strong>${esc(item.nickname)} · ${t('个人主页背景', 'Profile background')}</strong><span class="community-muted">${esc(beijingTime(item.createdAt))}</span>${url ? `<img class="community-profile-review-background" src="${esc(url)}" alt="${t('待审核背景', 'Pending background')}">` : ''}${adviceHTML(item)}${rights.advise ? `<p class="community-muted">${t('建议不会公开或驳回背景，仍待最终审批。', 'Advice does not publish or reject the background; a final decision is still required.')}</p>` : ''}${rights.advise || rights.decide ? reasonHTML(`background-${item.imageId}`) : ''}<div class="community-form-actions is-start">${buttons(rights, (decision, action, label) => `<button class="community-button is-small${decision === 'approve' ? ' is-good' : ' is-danger'}" type="submit" name="decision" value="${decision}" data-review-action="${action}">${label}</button>`)}</div></form></li>`);
  }
  return rows.length ? `<ul class="community-queue">${rows.join('')}</ul>` : emptyHTML(common, t('没有待审核资料', 'No profiles awaiting review'));
}
