import { escapeHTML as esc } from './core.mjs';

let mode = 'login';
let returnTo = '#/notes';
const field = (name, label, type, autocomplete, extra = '', english = false) => {
  if (type === 'password') return `<div class="reader-field"><label for="reader-password">${label}</label><div class="reader-password-field"><input id="reader-password" name="${name}" type="password" autocomplete="${autocomplete}" ${extra} required><button class="reader-password-toggle" type="button" data-reader-password-toggle aria-controls="reader-password" aria-pressed="false" aria-label="${english ? 'Show password' : '显示密码'}" title="${english ? 'Show password' : '显示密码'}"><svg class="reader-eye-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="reader-eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 6.1A11.4 11.4 0 0 1 12 6c6.4 0 10 6 10 6a13 13 0 0 1-3.1 3.5M6.3 6.3C3.5 8.2 2 12 2 12s3.6 6 10 6a10.8 10.8 0 0 0 4.3-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/></svg></button></div></div>`;
  return `<label class="reader-field"><span>${label}</span><input name="${name}" type="${type}" autocomplete="${autocomplete}" ${extra} required></label>`;
};
const submit = label => `<button class="button reader-primary" type="submit">${label}</button>`;
const shell = (body, english, variant = '') => `<section class="page reader-page"><div class="reader-card reader-card--auth ${variant}"><div class="reader-visual" aria-hidden="true"><span class="reader-visual-brand">無相 <i></i> SANSPHASE</span><div class="reader-visual-copy"><span class="reader-visual-symbol">✦</span><strong>${english ? 'A space to keep<br>exploring.' : '星光之下，<br>继续探索。'}</strong><span>${english ? 'Works · Notes · Library' : '作品 · 资料 · 资源中心'}</span></div></div><div class="reader-content"><div class="reader-topline"><span class="eyebrow">SANSPHASE / ACCOUNT</span><a href="#/notes" class="reader-exit">${english ? '← Read the blog' : '← 返回博客'}</a></div>${body}</div></div></section>`;

export function readerGate(english = false) {
  return shell(`<div class="reader-heading"><span class="reader-kicker">${english ? 'READER ACCESS' : '读者入口'}</span><h1>${english ? 'Keep reading' : '继续阅读'}</h1><p>${english ? 'The homepage and blog are open. Sign in to explore this section.' : '首页和博客无需登录。登录后可继续探索这个栏目。'}</p></div><a class="button reader-primary reader-gate-action" href="#/account" data-reader-return>${english ? 'Sign in' : '前往登录'} <span aria-hidden="true">↗</span></a>`, english);
}

export function readerPage(page, id, reader, english = false, registrationEnabled = true, owner = null) {
  const tr = (zh, en) => english ? en : zh;
  if (page === 'verify') return shell(`<div class="reader-heading"><span class="reader-kicker">EMAIL VERIFICATION</span><h1>${tr('验证邮箱', 'Verify email')}</h1></div><p data-reader-message role="status">${tr('正在验证邮箱…', 'Verifying your email…')}</p><button class="button reader-primary" data-reader-verify="${esc(id)}" hidden>${tr('重试验证', 'Retry verification')}</button><div class="reader-verified" data-reader-verified role="status" aria-live="polite" hidden><span aria-hidden="true">✓</span><h2>${tr('注册验证成功', 'Account verified')}</h2><p>${tr('邮箱已验证，账号可以登录。', 'Your email is verified. You can now sign in.')}</p><a class="button reader-primary" href="#/account">${tr('立即登录', 'Sign in now')}</a></div>`, english);
  if (page === 'reset') return shell(`<div class="reader-heading"><span class="reader-kicker">PASSWORD RESET</span><h1>${tr('设置新密码', 'Set a new password')}</h1></div><form data-reader-form="reset" data-token="${esc(id)}">${field('password', tr('新密码（至少 8 个字符）', 'New password (at least 8 characters)'), 'password', 'new-password', 'minlength="8" maxlength="128"', english)}${submit(tr('保存新密码', 'Save new password'))}</form><p data-reader-message role="status"></p>`, english);
  if (owner) return shell(`<div class="reader-heading"><span class="reader-kicker">OWNER ACCOUNT</span><h1>${tr('作者账号', 'Owner account')}</h1><p>${tr('已以作者身份登录：', 'Signed in as the owner: ')}${esc(owner.name || tr('作者', 'Owner'))}</p><p>${tr('进入作者台编辑和发布内容，也可从作者台管理读者账号。', 'Open the author studio to publish content and manage reader accounts.')}</p></div><button type="button" class="button reader-primary reader-gate-action" data-author-login>${tr('进入作者台', 'Open author studio')} <span aria-hidden="true">↗</span></button>`, english);
  if (reader) {
    const initial = Array.from(String(reader.nickname || '').trim())[0] || '✦';
    const signature = reader.signature ? esc(reader.signature) : `<span class="reader-profile-empty">${tr('还没有填写个性签名', 'No signature yet')}</span>`;
    const avatar = /^\/api\/reader\/avatar\/[0-9a-f-]{36}\.webp$/.test(String(reader.avatar || '')) ? reader.avatar : '';
    const avatarFace = avatar ? `<img class="reader-profile-avatar-image" src="${esc(avatar)}" alt="" width="58" height="58" decoding="async">` : esc(initial);
    const avatarControl = `<div class="reader-avatar-anchor"><button class="reader-profile-avatar" type="button" data-reader-avatar-trigger aria-label="${tr('修改头像', 'Edit avatar')}" aria-expanded="false" aria-controls="reader-avatar-panel"><span aria-hidden="true">${avatarFace}</span></button><div class="reader-avatar-panel" id="reader-avatar-panel" data-reader-avatar-panel role="group" aria-label="${tr('头像设置', 'Avatar settings')}" hidden><strong>${tr('修改头像', 'Edit avatar')}</strong><p>${reader.pendingAvatar ? tr('新头像正在审核，当前头像会保持显示。', 'The new avatar is pending review; the current one remains visible.') : tr('JPG、PNG 或 WebP，最多 4 MB；审核通过后更新。请勿包含手机号、微信号或二维码。', 'JPG, PNG or WebP, up to 4 MB. Updated after review. Do not include phone numbers, WeChat contacts or QR codes.')}</p><input type="file" accept="image/jpeg,image/png,image/webp" data-reader-avatar-file hidden><div class="reader-avatar-actions"><button type="button" data-reader-avatar-pick>${tr(avatar ? '更换图片' : '上传图片', avatar ? 'Change image' : 'Upload image')}</button>${avatar || reader.pendingAvatar ? `<button type="button" data-reader-avatar-remove>${tr(avatar ? '恢复默认' : '取消待审核', avatar ? 'Use default' : 'Cancel pending')}</button>` : ''}</div><p data-reader-avatar-message role="status" aria-live="polite"></p></div></div>`;
    const profileCard = `<section class="reader-profile-card${reader.vip ? ' reader-profile-card--vip' : ''}" aria-label="${tr('个人资料卡', 'Profile card')}"><div class="reader-profile-card-head"><span>${tr('个人资料', 'PROFILE')}</span><span class="reader-profile-status${reader.vip ? ' reader-profile-status--vip' : ''}">${reader.vip ? `<span aria-hidden="true">✦</span> ${tr('VIP 会员', 'VIP MEMBER')}` : tr('普通读者', 'Reader')}</span></div><div class="reader-profile-person">${avatarControl}<div><strong>${esc(reader.nickname)}</strong><span class="reader-account-uid">UID ${esc(reader.uid || '—')}</span></div></div><p class="reader-profile-signature">${signature}</p><dl class="reader-profile-facts"><div><dt>${tr('登录邮箱', 'Email')}</dt><dd>${esc(reader.email)}</dd></div>${reader.vip && reader.vipUntil ? `<div><dt>${tr('会员有效至', 'VIP until')}</dt><dd>${esc(new Date(reader.vipUntil).toLocaleString(english ? 'en-US' : 'zh-CN'))}</dd></div>` : ''}</dl></section>`;
    const profileForm = `<form class="reader-profile-form" data-reader-form="profile">${field('nickname', tr('昵称', 'Nickname'), 'text', 'nickname', `minlength="2" maxlength="30" value="${esc(reader.nickname)}"`)}<label class="reader-field"><span>${tr('个性签名', 'Signature')}</span><input name="signature" type="text" maxlength="100" autocomplete="off" placeholder="${tr('写一句介绍自己或记录此刻的心情', 'A few words about yourself')}" aria-describedby="reader-signature-hint" value="${esc(reader.pendingSignature ?? reader.signature ?? '')}"><small id="reader-signature-hint">${reader.pendingSignature !== null && reader.pendingSignature !== undefined ? tr('当前修改待审核；上方仍显示已通过的个签。', 'Pending review; the card still shows the approved signature.') : tr('最多 100 字，可留空；审核通过后生效。请勿填写手机号或微信号。', 'Up to 100 characters. Changes appear after review. Do not include phone or WeChat contacts.')}</small></label>${field('phone', tr('中国大陆手机号（11 位，未经短信验证）', 'Mainland China mobile number (11 digits, not SMS-verified)'), 'tel', 'tel', `data-reader-phone inputmode="numeric" pattern="1[3-9][0-9]{9}" minlength="11" maxlength="11" value="${esc(reader.phone || '')}"`)}${submit(tr('保存资料', 'Save profile'))}</form>`;
    return shell(`<div class="reader-heading reader-heading--profile"><span class="reader-kicker">YOUR SPACE</span><h1>${tr('我的账号', 'My account')}</h1><p>${tr('管理你的个人资料与阅读身份。', 'Manage your profile and reading identity.')}</p></div>${profileCard}<div class="reader-profile-edit-title"><div><h2>${tr('编辑个人资料', 'Edit profile')}</h2><p>${tr('个签和头像需审核通过后更新上方资料卡。', 'Signature and avatar changes appear after approval.')}</p></div></div>${profileForm}<p data-reader-message role="status"></p><button class="reader-quiet-link" type="button" data-reader-logout>${tr('退出登录', 'Sign out')}</button>`, english, 'reader-card--profile');
  }
  if (!registrationEnabled && ['forgot', 'resend'].includes(mode)) mode = 'login';
  const heading = { login: tr('账号登录', 'Sign in'), register: registrationEnabled ? tr('加入阅读', 'Join the journey') : tr('注册暂未开放', 'Registration is coming soon'), forgot: tr('找回密码', 'Reset password'), resend: tr('重发验证邮件', 'Resend verification') }[mode];
  const form = mode === 'resend'
    ? `${field('email', tr('注册邮箱', 'Registration email'), 'email', 'email')}${submit(heading)}`
    : mode === 'forgot'
    ? `${field('email', tr('邮箱', 'Email'), 'email', 'email')}${submit(tr('发送重置邮件', 'Send reset email'))}`
    : `${mode === 'register' ? field('nickname', tr('昵称', 'Nickname'), 'text', 'nickname', 'minlength="2" maxlength="30"') : ''}${field('email', tr('邮箱', 'Email'), 'email', 'username')}${mode === 'register' ? field('phone', tr('中国大陆手机号（11 位，仅作联系资料）', 'Mainland China mobile number (11 digits; contact only)'), 'tel', 'tel', 'data-reader-phone inputmode="numeric" pattern="1[3-9][0-9]{9}" minlength="11" maxlength="11"') : ''}${field('password', mode === 'register' ? tr('密码（至少 8 个字符）', 'Password (at least 8 characters)') : tr('密码', 'Password'), 'password', mode === 'register' ? 'new-password' : 'current-password', mode === 'register' ? 'minlength="8" maxlength="128"' : '', english)}${submit(mode === 'register' ? tr('创建账号', 'Create account') : tr('登录', 'Sign in'))}${mode === 'register' ? `<p class="reader-retention-note">${tr('邮箱验证后，如连续 30 天未登录，账号会自动清理；有效期内的 VIP 账号暂不清理。', 'After email verification, accounts with no sign-in for 30 consecutive days are removed. Active VIP accounts are exempt.')}</p>` : ''}`;
  const description = mode === 'register'
    ? registrationEnabled
      ? tr('支持 QQ、Gmail、网易等常用邮箱；请在 5 分钟内验证。超时需重新注册，有效期内可以重发邮件。', 'QQ, Gmail, NetEase and other common email addresses are supported. Verify within five minutes. Register again after expiry; resend is available while the request is active.')
      : tr('邮箱验证服务尚未接通。开放后可使用 QQ、Gmail、网易等常用邮箱注册。', 'Email verification is not connected yet. QQ, Gmail, NetEase and other providers will be supported when registration opens.')
    : mode === 'login'
      ? tr('使用邮箱和密码登录，系统会自动识别账号身份。', 'Sign in with your email and password. Your account access is recognized automatically.')
      : tr('通过已验证的邮箱管理账号访问。', 'Manage account access with your verified email.');
  return shell(`<div class="reader-heading"><span class="reader-kicker">${mode === 'register' ? 'CREATE ACCOUNT' : 'ACCOUNT ACCESS'}</span><h1>${heading}</h1><p>${description}</p></div><div class="reader-tabs"><button type="button" data-reader-mode="login" ${mode === 'login' ? 'aria-current="page"' : ''}>${tr('登录', 'Sign in')}</button><button type="button" data-reader-mode="register" ${mode === 'register' ? 'aria-current="page"' : ''}>${tr('注册', 'Register')}</button></div>${mode === 'register' && !registrationEnabled ? `<div class="reader-unavailable" role="status"><span aria-hidden="true">✦</span><p>${tr('目前可以继续阅读首页与博客。注册开放后，再来探索作品、资料和书籍。', 'You can keep reading the homepage and blog. Return when registration opens to explore works and the library.')}</p><a href="#/notes">${tr('继续看博客', 'Continue to the blog')} →</a></div>` : `<form data-reader-form="${mode}" autocomplete="on">${form}</form>`}<p data-reader-message role="status"></p><p class="reader-mail-note">${tr('为保护账号及配合依法调查，登录时会记录账号、时间、来源 IP 和浏览器信息，并仅向有权限的管理者提供。', 'For account security and lawful investigations, sign-ins record the account, time, source IP and browser information. Only authorized administrators can access these records.')}</p>${registrationEnabled ? `<div class="reader-help">${mode !== 'forgot' ? `<button type="button" data-reader-mode="forgot">${tr('忘记密码？', 'Forgot password?')}</button>` : ''}${mode !== 'resend' ? `<button type="button" data-reader-mode="resend">${tr('重发验证邮件', 'Resend verification')}</button>` : ''}</div>` : mode !== 'register' ? `<p class="reader-mail-note">${tr('当前仅已有账号可登录；注册与找回密码将在邮件服务接通后开放。', 'Only existing accounts can sign in. Registration and password recovery will open when email delivery is ready.')}</p>` : ''}`, english);
}

export function mountReaderUI({ render, onIdentity, english = () => false }) {
  const tr = (zh, en) => english() ? en : zh;
  const checkPhone = input => input.setCustomValidity(input.value && !/^1[3-9]\d{9}$/.test(input.value) ? tr('请输入正确的手机号', 'Enter a valid mainland China mobile number') : '');
  async function api(path, body) {
    const response = await fetch('/api/reader/' + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Reader-Request': '1' }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || tr('操作失败，请稍后重试。', 'Please try again later.'));
    return value;
  }
  const message = value => { const target = document.querySelector('[data-reader-message]'); if (target) target.textContent = value; };
  const avatarMessage = value => { const target = document.querySelector('[data-reader-avatar-message]'); if (target) target.textContent = value; };
  const profileDirty = () => [...(document.querySelector('[data-reader-form="profile"]')?.querySelectorAll('input') || [])].some(input => input.value !== input.defaultValue);
  document.addEventListener('input', event => { if (event.target.matches?.('[data-reader-phone]')) checkPhone(event.target); });
  document.addEventListener('invalid', event => { if (event.target.matches?.('[data-reader-phone]')) checkPhone(event.target); }, true);
  document.addEventListener('click', async event => {
    const passwordToggle = event.target.closest('[data-reader-password-toggle]');
    if (passwordToggle) {
      const input = passwordToggle.closest('.reader-password-field')?.querySelector('input');
      if (!input) return;
      const visible = input.type === 'password';
      const start = input.selectionStart, end = input.selectionEnd;
      input.type = visible ? 'text' : 'password';
      passwordToggle.setAttribute('aria-pressed', String(visible));
      passwordToggle.setAttribute('aria-label', tr(visible ? '隐藏密码' : '显示密码', visible ? 'Hide password' : 'Show password'));
      passwordToggle.title = passwordToggle.getAttribute('aria-label');
      input.focus({ preventScroll: true });
      if (start !== null && end !== null) input.setSelectionRange(start, end);
      return;
    }
    const avatarPanel = document.querySelector('[data-reader-avatar-panel]');
    const avatarTrigger = event.target.closest('[data-reader-avatar-trigger]');
    if (avatarTrigger) {
      avatarPanel.hidden = !avatarPanel.hidden;
      avatarTrigger.setAttribute('aria-expanded', String(!avatarPanel.hidden));
      return;
    }
    if (avatarPanel && !avatarPanel.hidden && !event.target.closest('.reader-avatar-anchor')) {
      avatarPanel.hidden = true;
      document.querySelector('[data-reader-avatar-trigger]')?.setAttribute('aria-expanded', 'false');
    }
    const back = event.target.closest('[data-reader-return]');
    if (back) returnTo = location.hash || '#/notes';
    const switcher = event.target.closest('[data-reader-mode]');
    if (switcher) { mode = switcher.dataset.readerMode; render({ silent: true }); return; }
    if (event.target.closest('[data-reader-avatar-pick]')) {
      if (profileDirty()) { avatarMessage(tr('请先保存其他资料，再更换头像。', 'Save your other profile changes before changing the avatar.')); return; }
      document.querySelector('[data-reader-avatar-file]')?.click(); return;
    }
    const removeAvatar = event.target.closest('[data-reader-avatar-remove]');
    if (removeAvatar) {
      if (profileDirty()) { avatarMessage(tr('请先保存其他资料，再恢复默认头像。', 'Save your other profile changes first.')); return; }
      removeAvatar.disabled = true;
      try { onIdentity(await api('avatar/remove', {})); avatarMessage(tr('已恢复默认头像。', 'Default avatar restored.')); }
      catch (error) { avatarMessage(error.message); removeAvatar.disabled = false; }
      return;
    }
    if (event.target.closest('[data-reader-logout]')) {
      try { await api('logout', {}); onIdentity(null); location.hash = '#/notes'; }
      catch (error) { message(error.message); }
    }
    const verify = event.target.closest('[data-reader-verify]');
    if (verify) {
      try { await api('verify', { token: verify.dataset.readerVerify }); mode = 'login'; message(''); verify.hidden = true; const success = document.querySelector('[data-reader-verified]'); if (success) success.hidden = false; }
      catch (error) { message(error.message); verify.hidden = false; }
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const panel = document.querySelector('[data-reader-avatar-panel]');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    const trigger = document.querySelector('[data-reader-avatar-trigger]');
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.focus();
    event.stopPropagation();
  });
  document.addEventListener('change', async event => {
    const input = event.target.closest('[data-reader-avatar-file]');
    if (!input) return;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 ** 2) {
      avatarMessage(tr('请选择不超过 4 MB 的 JPG、PNG 或 WebP 图片。', 'Choose a JPG, PNG or WebP image under 4 MB.')); return;
    }
    const button = document.querySelector('[data-reader-avatar-pick]');
    if (button) button.disabled = true;
    avatarMessage(tr('头像上传中…', 'Uploading avatar…'));
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch('/api/reader/avatar', { method: 'POST', credentials: 'same-origin', headers: { 'X-Reader-Request': '1' }, body: form });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || tr('上传失败，请重试。', 'Upload failed. Please try again.'));
      onIdentity(value);
      avatarMessage(tr('头像已提交审核；通过后会自动更新。', 'Avatar submitted for review and will update after approval.'));
    } catch (error) { avatarMessage(error.message); if (button) button.disabled = false; }
  });
  document.addEventListener('submit', async event => {
    const form = event.target.closest('[data-reader-form]');
    if (!form) return;
    event.preventDefault();
    const action = form.dataset.readerForm, button = form.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    if (action === 'reset') values.token = form.dataset.token;
    button.disabled = true;
    try {
      const value = await api(action, values);
      if (action === 'login') {
        if (value.role === 'owner') {
          const destination = returnTo && returnTo !== '#/account' ? returnTo : '#/notes';
          window.history.replaceState(window.history.state, '', location.pathname + location.search + destination);
          window.dispatchEvent(new CustomEvent('author:identity', { detail: value }));
          await render({ silent: true });
          document.querySelector('[data-author-login]')?.click();
        } else {
          onIdentity(value);
          const alreadyThere = location.hash === returnTo;
          location.hash = returnTo;
          if (alreadyThere) render({ silent: true });
        }
      }
      else if (action === 'reset') { mode = 'login'; history.replaceState(history.state, '', location.pathname + location.search + '#/account'); render({ silent: true }); message(tr('密码已更新，请登录。', 'Password updated. Please sign in.')); }
      else if (action === 'profile') { onIdentity(value); message(value.reviewPending ? tr('资料已保存，个性签名待审核。', 'Profile saved; signature pending review.') : tr('资料已保存。', 'Profile saved.')); }
      else message(value.message);
    } catch (error) { message(error.message); }
    finally { button.disabled = false; }
  });
  let lastVerification = '';
  return {
    route(page, id) {
      if (page !== 'verify' || !id || id === lastVerification) return;
      lastVerification = id;
      const button = document.querySelector('[data-reader-verify]');
      button?.click();
    },
  };
}
