import { escapeHTML as esc } from './core.mjs';
type AdminUser = {id: string; uid: string; nickname: string; email: string; phone?: string; disabled: boolean; vip: boolean; vipUntil?: string | null; lastLoginIp?: string | null; lastLoginAt?: string | null; createdAt: string};
type ReaderList = {users: AdminUser[]; page: number; totalPages: number; total: number; summary: {total: number; active: number; disabled: number; vip: number; expiredVip: number}};
type AuditEvent = {action: string; readerId?: string; days?: number; until?: string; from?: string; to?: string; at: string; ip?: string};
type ProfileAdvice = {id: string; decision: 'approve' | 'reject'; reason: string; by: {kind: 'owner' | 'reader'; id: string}; createdAt: string};
type ReviewRow = {id: string; nickname?: string; kind?: string; createdAt?: string; avatarUrl?: string; proposedValue?: string; advice?: ProfileAdvice[]; email?: string; expiresAt?: string; reason?: string; filename?: string; last_error?: string; collection?: string; parent_id?: string; media_id?: string};
type ReviewResult = {profiles: ReviewRow[]; expired: ReviewRow[]; files: ReviewRow[]; versions: ReviewRow[]; media: ReviewRow[]};
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const dateLabel = (value: string | undefined, english: boolean) => {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(english ? 'en-US' : 'zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
};
const remainingLabel = (value: string | undefined, english: boolean) => {
  const ms = Date.parse(value || '') - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return english ? 'Expired' : '已到期';
  const totalHours = Math.ceil(ms / 3600000);
  const days = Math.floor(totalHours / 24), hours = totalHours % 24;
  return english ? `${days}d ${hours}h left` : `剩余 ${days} 天 ${hours} 小时`;
};

export function adminReadersPage(author: unknown, english = false) {
  const tr = (zh: string, en: string) => english ? en : zh;
  if (!author) return `<section class="page reader-page reader-admin-page"><div class="reader-card reader-admin-locked"><span class="eyebrow">SANSPHASE / ADMIN</span><h1>${tr('用户管理', 'User management')}</h1><p>${tr('这里仅供作者管理读者账号。请先登录作者账号。', 'Sign in as the owner to manage reader accounts.')}</p><a class="button" href="#/account">${tr('前往登录', 'Go to sign in')}</a></div></section>`;
  return `<section class="page reader-page reader-admin-page reader-admin-page--workspace"><div class="reader-admin-shell">
    <aside class="reader-admin-rail" aria-label="${tr('管理导航', 'Management navigation')}">
      <div class="reader-admin-brand"><span aria-hidden="true">✦</span><div><strong>無相</strong><small>SANSPHASE / ADMIN</small></div></div>
      <span class="reader-admin-nav-label">${tr('管理菜单', 'MANAGEMENT')}</span>
      <button type="button" class="reader-admin-nav" data-admin-view="accounts" aria-current="page">${tr('用户账号', 'User accounts')}</button>
      <button type="button" class="reader-admin-nav" data-admin-view="memberships">${tr('会员权限', 'VIP memberships')}</button>
      <button type="button" class="reader-admin-nav" data-admin-view="review">${tr('审核与清理', 'Review & cleanup')}</button>
      <button type="button" class="reader-admin-nav" data-admin-view="activity">${tr('操作记录', 'Activity log')}</button>
      <div class="reader-admin-rail-bottom"><span class="reader-admin-owner-dot"></span>${tr('管理员已登录', 'Administrator signed in')}<a href="#/notes">${tr('返回网站', 'Back to site')} ↗</a></div>
    </aside>
    <div class="reader-admin-main">
      <header class="reader-admin-header"><div><span class="reader-admin-kicker">${tr('管理后台 / 账号', 'ADMIN / ACCOUNTS')}</span><h1>${tr('用户管理', 'User management')}</h1><p>${tr('查看注册用户、会员状态和登录记录。', 'Review registered users, memberships, and sign-in history.')}</p></div><span class="reader-admin-header-badge"><i></i>${tr('站点管理员', 'Site administrator')}</span></header>
      <div class="reader-admin-notice" role="status" aria-live="polite" hidden></div>
      <section data-admin-panel="accounts" aria-label="${tr('用户账号', 'User accounts')}">
        <div class="reader-admin-summary" id="reader-admin-summary" aria-label="${tr('账号概览', 'Account overview')}"></div>
        <div class="reader-admin-section-heading"><div><h2>${tr('用户列表', 'Users')}</h2><p>${tr('仅展示完成邮箱验证的账号；可按状态查看并管理权限。', 'Only email-verified accounts appear here. Filter by status and manage access.')}</p></div><span id="reader-admin-count"></span></div>
        <div class="reader-admin-toolbar">
          <form id="reader-admin-search" role="search"><label class="reader-admin-search-label"><span class="sr-only">${tr('搜索 UID、邮箱、手机号或昵称', 'Search UID, email, phone or nickname')}</span><input type="search" name="q" autocomplete="off" placeholder="${tr('搜索 UID、邮箱、手机号或昵称', 'Search UID, email, phone or nickname')}"></label><button type="submit">${tr('搜索', 'Search')}</button></form>
          <div class="reader-admin-filters" role="group" aria-label="${tr('按账号状态筛选', 'Filter by account status')}">
            <button type="button" data-admin-filter="all" aria-pressed="true">${tr('全部', 'All')}</button><button type="button" data-admin-filter="active" aria-pressed="false">${tr('可登录', 'Active')}</button><button type="button" data-admin-filter="disabled" aria-pressed="false">${tr('已停用', 'Disabled')}</button>
          </div>
        </div>
        <div id="reader-admin-list" aria-live="polite"></div><div class="reader-admin-pages" id="reader-admin-pages"></div>
      </section>
      <section data-admin-panel="memberships" aria-label="${tr('会员权限', 'VIP memberships')}" hidden>
        <div class="reader-admin-section-heading"><div><h2>${tr('会员权限', 'VIP memberships')}</h2></div></div>
        <p class="reader-admin-section-copy">${tr('可开通或续期一个自然月，也可直接为读者增加指定天数；到期自动失效。资源中心的书籍可单独设置为 VIP 专属。', 'Grant or renew one calendar month, or directly add a chosen number of days. VIP expires automatically. Individual library books may require VIP.')}</p>
        <div class="reader-admin-toolbar">
          <form id="reader-admin-member-search" role="search"><label class="reader-admin-search-label"><span class="sr-only">${tr('搜索 UID、邮箱或昵称', 'Search UID, email or nickname')}</span><input type="search" name="q" autocomplete="off" placeholder="${tr('搜索 UID、邮箱或昵称', 'Search UID, email or nickname')}"></label><button type="submit">${tr('搜索', 'Search')}</button></form>
          <div class="reader-admin-filters" role="group" aria-label="${tr('按会员状态筛选', 'Filter by membership')}">
            <button type="button" data-admin-member-filter="all" aria-pressed="true">${tr('全部用户', 'All users')}</button><button type="button" data-admin-member-filter="vip" aria-pressed="false">${tr('VIP 用户', 'VIP users')}</button><button type="button" data-admin-member-filter="expired" aria-pressed="false">${tr('VIP 已到期', 'Expired VIP')}</button>
          </div>
        </div>
        <div id="reader-admin-memberships" aria-live="polite"></div><div class="reader-admin-pages" id="reader-admin-member-pages"></div>
      </section>
      <section data-admin-panel="activity" aria-label="${tr('操作记录', 'Activity log')}" hidden>
        <div class="reader-admin-section-heading"><div><h2>${tr('操作记录', 'Activity log')}</h2></div></div>
        <p class="reader-admin-section-copy">${tr('记录账号访问与会员权限的操作。这里只显示最近 20 条已完成操作。', 'The latest 20 completed access and VIP actions are shown here.')}</p>
        <div id="reader-admin-audit" aria-live="polite"></div>
      </section>
      <section data-admin-panel="review" aria-label="${tr('审核与清理', 'Review and cleanup')}" hidden>
        <div class="reader-admin-section-heading"><div><h2>${tr('待处理事项', 'Items to handle')}</h2><p>${tr('资料审核后才会生效；过期注册申请自动清理，失败项可在这里批量重试。', 'Profile changes need approval. Expired registrations are cleaned automatically; retry failures here.')}</p></div></div>
        <div class="reader-admin-filters reader-admin-review-tabs" role="group" aria-label="${tr('审核与清理分类', 'Review categories')}"><button type="button" data-admin-review-tab="profiles" aria-pressed="true">${tr('资料审核', 'Profile review')}</button><button type="button" data-admin-review-tab="expired" aria-pressed="false">${tr('过期申请', 'Expired requests')}</button><button type="button" data-admin-review-tab="files" aria-pressed="false">${tr('头像清理', 'Avatar cleanup')}</button><button type="button" data-admin-review-tab="versions" aria-pressed="false">${tr('历史版本', 'Old versions')}</button><button type="button" data-admin-review-tab="media" aria-pressed="false">${tr('附件清理', 'Media cleanup')}</button></div>
        <div class="reader-admin-review-group" data-admin-review-panel="profiles"><h3>${tr('待审核资料', 'Pending profiles')}</h3><p>${tr('头像含手机号、微信号或二维码时请驳回。', 'Reject avatars containing phone numbers, WeChat contacts or QR codes.')}</p><div id="reader-admin-review-profiles"></div></div>
        <div class="reader-admin-review-group" data-admin-review-panel="expired" hidden><h3>${tr('过期验证申请', 'Expired verification requests')}</h3><p>${tr('验证中且未满 5 分钟的申请不在此列，也不能手动清理。', 'Active requests within five minutes are excluded from manual cleanup.')}</p><div id="reader-admin-review-expired"></div></div>
        <div class="reader-admin-review-group" data-admin-review-panel="files" hidden><h3>${tr('待清理头像文件', 'Avatar file cleanup')}</h3><p>${tr('服务器再次核实文件未被使用后才会删除。', 'The server checks that a file is unused before deleting it.')}</p><div id="reader-admin-review-files"></div></div>
        <div class="reader-admin-review-group" data-admin-review-panel="versions" hidden><h3>${tr('待清理历史版本', 'Historical version cleanup')}</h3><p>${tr('删除内容后，系统会清理旧版本；失败项可以在此重试。', 'Old versions are removed after content deletion; failed items can be retried here.')}</p><div id="reader-admin-review-versions"></div></div>
        <div class="reader-admin-review-group" data-admin-review-panel="media" hidden><h3>${tr('待清理内容附件', 'Content media cleanup')}</h3><p>${tr('删除文章或公告后，只有不再被其他内容引用的附件才会删除。', 'After a post or notice is deleted, media is removed only when nothing else uses it.')}</p><div id="reader-admin-review-media"></div></div>
      </section>
    </div>
  </div><dialog class="reader-admin-dialog" id="reader-admin-detail" aria-label="${tr('账号详情', 'Account details')}"></dialog></section>`;
}

export function mountReaderAdmin(root: HTMLElement | null, { english = false }: {english?: boolean} = {}) {
  if (!root) return () => {};
  const list = root.querySelector<HTMLElement>('#reader-admin-list');
  if (!list) return () => {};
  const tr = (zh: string, en: string) => english ? en : zh;
  const controller = new AbortController();
  const detail = root.querySelector<HTMLDialogElement>('#reader-admin-detail')!;
  const summary = root.querySelector<HTMLElement>('#reader-admin-summary')!;
  const count = root.querySelector<HTMLElement>('#reader-admin-count')!;
  const pages = root.querySelector<HTMLElement>('#reader-admin-pages')!;
  const memberList = root.querySelector<HTMLElement>('#reader-admin-memberships')!;
  const memberPages = root.querySelector<HTMLElement>('#reader-admin-member-pages')!;
  const audit = root.querySelector<HTMLElement>('#reader-admin-audit')!;
  const reviewProfiles = root.querySelector<HTMLElement>('#reader-admin-review-profiles')!;
  const reviewExpired = root.querySelector<HTMLElement>('#reader-admin-review-expired')!;
  const reviewFiles = root.querySelector<HTMLElement>('#reader-admin-review-files')!;
  const reviewVersions = root.querySelector<HTMLElement>('#reader-admin-review-versions')!;
  const reviewMedia = root.querySelector<HTMLElement>('#reader-admin-review-media')!;
  const notice = root.querySelector<HTMLElement>('.reader-admin-notice')!;
  let query = '', status = 'all', page = 1, totalPages = 1, memberQuery = '', memberFilter = 'all', memberPage = 1, memberTotalPages = 1, selected: AdminUser | null = null, view = 'accounts', generation = 0, loginHistory: AuditEvent[] | false | null = null;
  let users = new Map<string, AdminUser>();
  let reviewGeneration = 0;
  const pendingReviews = new Set<string>();
  const profileReasons = new Map<string, string>();
  const reviewRegions = [reviewProfiles, reviewExpired, reviewFiles, reviewVersions, reviewMedia];
  const captureProfileReasons = () => reviewProfiles.querySelectorAll<HTMLInputElement>('[data-admin-review-reason]').forEach(input => {
    const id = input.closest('.reader-admin-review-item')?.querySelector<HTMLButtonElement>('[data-admin-review-action]')?.dataset.id;
    if (id) profileReasons.set(id, input.value);
  });
  const syncReviewLock = (id: string) => reviewProfiles.querySelectorAll<HTMLButtonElement>('[data-admin-review-action]').forEach(button => {
    if (button.dataset.id !== id) return;
    button.disabled = pendingReviews.has(id);
    const input = button.closest('.reader-admin-review-item')?.querySelector<HTMLInputElement>('[data-admin-review-reason]');
    if (input) input.readOnly = pendingReviews.has(id);
  });
  const message = (value: string, error = false) => { notice.textContent = value; notice.hidden = !value; notice.classList.toggle('is-error', error); };
  const request = async <T = unknown>(path: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetch('/api/manage/' + path, { credentials: 'same-origin', signal: controller.signal, ...options });
    const value = await response.json();
    if (!response.ok) throw Error(value.error || tr('读取失败。', 'Request failed.'));
    return value as T;
  };
  const state = (user: AdminUser) => user.disabled ? ['disabled', tr('已停用', 'Disabled')] : ['active', tr('可登录', 'Active')];
  const empty = (title: string, copy: string) => `<div class="reader-admin-empty"><strong>${title}</strong><p>${copy}</p></div>`;
  const renderAccounts = async () => {
    const current = ++generation;
    list.setAttribute('aria-busy', 'true');
    if (!list.hasChildNodes()) list.innerHTML = `<p class="reader-admin-loading">${tr('正在读取账号…', 'Loading accounts…')}</p>`;
    try {
      const value = await request<ReaderList>('readers?' + new URLSearchParams({ q: query, status, page: String(page) }));
      if (controller.signal.aborted || current !== generation) return;
      totalPages = Math.max(1, value.totalPages || 1); page = Math.min(page, totalPages);
      users = new Map(value.users.map(user => [String(user.id), user]));
      const metrics: [string, number, string][] = [[tr('已验证账号', 'Verified accounts'), value.summary.total, 'total'], [tr('可登录', 'Active'), value.summary.active, 'active'], [tr('已停用', 'Disabled'), value.summary.disabled, 'disabled'], [tr('VIP 用户', 'VIP users'), value.summary.vip, 'vip'], [tr('VIP 已到期', 'Expired VIP'), value.summary.expiredVip, 'expired']];
      summary.innerHTML = metrics.map(([label, number, tone]) => `<div class="reader-admin-metric reader-admin-metric--${tone}"><span>${label}</span><strong>${Number(number) || 0}</strong></div>`).join('');
      count.textContent = `${value.total} ${tr('个账号', 'accounts')}`;
      list.innerHTML = value.users.length ? `<div class="reader-admin-table-wrap"><table class="reader-admin-table"><thead><tr><th>${tr('用户', 'User')}</th><th>${tr('手机号', 'Phone')}</th><th>${tr('账号状态', 'Account status')}</th><th>${tr('会员', 'VIP')}</th><th>${tr('最近登录', 'Latest sign-in')}</th><th>${tr('注册时间', 'Registered')}</th><th><span class="sr-only">${tr('操作', 'Actions')}</span></th></tr></thead><tbody>${value.users.map(user => {
        const [tone, label] = state(user);
        return `<tr><td><strong>${esc(user.nickname)}</strong><small class="reader-admin-uid">UID ${esc(user.uid)}</small><small>${esc(user.email)}</small></td><td>${esc(user.phone || '—')}</td><td><span class="reader-admin-status reader-admin-status--${tone}">${label}</span></td><td>${user.vip ? '<span class="reader-admin-vip">VIP</span>' : user.vipUntil ? tr('已到期', 'Expired') : '—'}</td><td><span class="reader-admin-ip">${esc(user.lastLoginIp || '—')}</span><small>${user.lastLoginAt ? esc(dateLabel(user.lastLoginAt, english)) : ''}</small></td><td>${esc(dateLabel(user.createdAt, english))}</td><td><button type="button" class="reader-admin-row-open" data-admin-open="${esc(user.id)}">${tr('管理', 'Manage')}</button></td></tr>`;
      }).join('')}</tbody></table></div>` : empty(query || status !== 'all' ? tr('没有符合条件的账号', 'No matching accounts') : tr('还没有读者注册', 'No readers yet'), query || status !== 'all' ? tr('试试其他关键词，或切换账号状态。', 'Try another search or status filter.') : tr('开放注册后，新账号会自动出现在这里。', 'New registrations will appear here automatically.'));
      pages.innerHTML = value.total > 0 ? `<button type="button" data-admin-page="prev" ${page <= 1 ? 'disabled' : ''}>← ${tr('上一页', 'Previous')}</button><span>${page} / ${totalPages}</span><button type="button" data-admin-page="next" ${page >= totalPages ? 'disabled' : ''}>${tr('下一页', 'Next')} →</button>` : '';
    } catch (error) { if (!controller.signal.aborted && current === generation) list.innerHTML = empty(tr('账号暂时无法读取', 'Accounts unavailable'), esc(errorMessage(error))); }
    finally { if (current === generation) list.setAttribute('aria-busy', 'false'); }
  };
  const renderMemberships = async () => {
    const current = ++generation;
    memberList.setAttribute('aria-busy', 'true');
    if (!memberList.hasChildNodes()) memberList.innerHTML = `<p class="reader-admin-loading">${tr('正在读取会员…', 'Loading memberships…')}</p>`;
    try {
      const value = await request<ReaderList>('readers?' + new URLSearchParams({ q: memberQuery, membership: memberFilter, page: String(memberPage) }));
      if (controller.signal.aborted || current !== generation) return;
      memberTotalPages = Math.max(1, value.totalPages || 1); memberPage = Math.min(memberPage, memberTotalPages);
      users = new Map(value.users.map(user => [String(user.id), user]));
      memberList.innerHTML = value.users.length ? `<div class="reader-admin-table-wrap"><table class="reader-admin-table"><thead><tr><th>${tr('用户', 'User')}</th><th>${tr('会员状态', 'VIP status')}</th><th>${tr('到期时间', 'Expires')}</th><th><span class="sr-only">${tr('操作', 'Actions')}</span></th></tr></thead><tbody>${value.users.map(user => `<tr><td><strong>${esc(user.nickname)}</strong><small class="reader-admin-uid">UID ${esc(user.uid)}</small><small>${esc(user.email)}</small></td><td>${user.vip ? '<span class="reader-admin-vip">VIP</span>' : user.vipUntil ? tr('已到期', 'Expired') : tr('普通读者', 'Reader')}</td><td>${user.vipUntil ? `${esc(dateLabel(user.vipUntil, english))}<small data-vip-remaining="${esc(user.vipUntil)}">${esc(remainingLabel(user.vipUntil, english))}</small>` : '—'}</td><td><button type="button" class="reader-admin-row-open" data-admin-open="${esc(user.id)}">${tr('管理', 'Manage')}</button></td></tr>`).join('')}</tbody></table></div>` : empty(tr('没有符合条件的账号', 'No matching accounts'), tr('可通过 UID、邮箱或昵称查找读者。', 'Search by UID, email or nickname.'));
      memberPages.innerHTML = value.total > 0 ? `<button type="button" data-admin-member-page="prev" ${memberPage <= 1 ? 'disabled' : ''}>← ${tr('上一页', 'Previous')}</button><span>${memberPage} / ${memberTotalPages}</span><button type="button" data-admin-member-page="next" ${memberPage >= memberTotalPages ? 'disabled' : ''}>${tr('下一页', 'Next')} →</button>` : '';
    } catch (error) { if (!controller.signal.aborted && current === generation) memberList.innerHTML = empty(tr('会员暂时无法读取', 'Memberships unavailable'), esc(errorMessage(error))); }
    finally { if (current === generation) memberList.setAttribute('aria-busy', 'false'); }
  };
  const renderAudit = async () => {
    audit.innerHTML = `<p class="reader-admin-loading">${tr('正在读取操作记录…', 'Loading activity…')}</p>`;
    try {
      const value = await request<{events: AuditEvent[]}>('audit');
      if (controller.signal.aborted) return;
      const labels: Record<string, string> = { disable: tr('停用账号', 'Account disabled'), enable: tr('恢复账号', 'Account enabled'), revoke: tr('撤销登录', 'Sessions revoked'), delete: tr('删除账号', 'Account deleted'), 'auto-delete-inactive': tr('半年未登录自动清理', 'Removed after six months of inactivity'), 'vip-grant': tr('开通或续期 VIP', 'VIP granted or renewed'), 'vip-add-days': tr('增加会员天数', 'VIP days added'), 'vip-revoke': tr('撤销 VIP', 'VIP revoked'), 'uid-change': tr('修改 UID', 'UID changed') };
      audit.innerHTML = value.events.length ? `<ol class="reader-admin-timeline">${value.events.map(event => `<li><span class="reader-admin-timeline-mark"></span><div><strong>${labels[event.action] || esc(event.action)}</strong><small>${tr('账号编号', 'Account ID')} ${esc(String(event.readerId || '').slice(0, 8))}…${event.action === 'vip-add-days' ? ` · +${esc(event.days)} ${tr('天', 'days')}` : ''}${event.until ? ` · ${tr('到期', 'Until')} ${esc(dateLabel(event.until, english))}` : ''}${event.action === 'uid-change' ? ` · UID ${esc(event.from)} → ${esc(event.to)}` : ''}</small></div><time>${esc(dateLabel(event.at, english))}</time></li>`).join('')}</ol>` : empty(tr('还没有操作记录', 'No activity yet'), tr('账号或会员操作后，记录会显示在这里。', 'Completed account and VIP actions will appear here.'));
    } catch (error) { if (!controller.signal.aborted) audit.innerHTML = empty(tr('记录暂时无法读取', 'Activity unavailable'), esc(errorMessage(error))); }
  };
  const renderReview = async () => {
    const current = ++reviewGeneration;
    captureProfileReasons();
    for (const region of reviewRegions) {
      region.setAttribute('aria-busy', 'true'); region.setAttribute('inert', '');
      if (!region.hasChildNodes()) region.innerHTML = `<p class="reader-admin-loading">${tr('正在读取…', 'Loading…')}</p>`;
    }
    try {
      const value = await request<ReviewResult>('review');
      if (controller.signal.aborted || current !== reviewGeneration) return;
      captureProfileReasons();
      const visibleIds = new Set(value.profiles.map(row => row.id));
      for (const id of profileReasons.keys()) if (!visibleIds.has(id) && !pendingReviews.has(id)) profileReasons.delete(id);
      reviewProfiles.innerHTML = value.profiles.length ? `<div class="reader-admin-review-list">${value.profiles.map(row => {
        const label = row.kind === 'avatar' ? tr('头像', 'Avatar') : row.kind === 'signature' ? tr('个性签名', 'Signature') : row.kind === 'nickname' ? tr('昵称', 'Nickname') : tr('资料', 'Profile');
        const advice = row.advice?.length ? `<div class="reader-admin-review-advice"><small>${tr('审核建议（尚未决定）', 'Review advice (not a final decision)')}</small>${row.advice.map(item => `<p>${item.decision === 'approve' ? tr('建议通过', 'Suggested approval') : tr('建议驳回', 'Suggested rejection')} · ${item.by.kind === 'owner' ? tr('站长', 'Owner') : tr('社区审核人员', 'Community reviewer')} · ${esc(dateLabel(item.createdAt, english))}${item.reason ? `<br>${esc(item.reason)}` : ''}</p>`).join('')}</div>` : '';
        const busy = pendingReviews.has(row.id);
        return `<article class="reader-admin-review-item"><div class="reader-admin-review-content"><strong>${esc(row.nickname)}</strong><small>${label} · ${esc(dateLabel(row.createdAt, english))}</small>${row.kind === 'avatar' ? `<img src="${esc(row.avatarUrl)}" alt="${tr('待审核头像', 'Pending avatar')}" width="80" height="80">` : `<p>${esc(row.proposedValue)}</p>`}${advice}<label class="reader-admin-review-reason"><span>${tr('审核说明（驳回必填）', 'Review reason (required for rejection)')}</span><input type="text" data-admin-review-reason maxlength="200" autocomplete="off" value="${esc(profileReasons.get(row.id) || '')}"${busy ? ' readonly' : ''}></label></div><div class="reader-admin-review-actions"><button type="button" data-admin-review-action="approve" data-id="${esc(row.id)}"${busy ? ' disabled' : ''}>${tr('通过', 'Approve')}</button><button type="button" data-admin-review-action="reject" data-id="${esc(row.id)}"${busy ? ' disabled' : ''}>${tr('驳回', 'Reject')}</button></div></article>`;
      }).join('')}</div>` : empty(tr('没有待审核资料', 'No pending profiles'), tr('新头像、个签或昵称提交后会显示在这里。', 'New avatar, signature and nickname requests will appear here.'));
      reviewExpired.innerHTML = value.expired.length ? `<div class="reader-admin-review-list"><label class="reader-admin-review-select"><input type="checkbox" data-admin-select-all="expired"> ${tr('全选过期申请', 'Select all expired requests')}</label>${value.expired.map(row => `<label class="reader-admin-review-item"><input type="checkbox" data-admin-select="expired" value="${esc(row.id)}"><span><strong>${esc(row.email)}</strong><small>${tr('到期', 'Expired')} ${esc(dateLabel(row.expiresAt, english))}</small></span></label>`).join('')}<button type="button" data-admin-bulk-clean="expired">${tr('清理所选', 'Clean selected')}</button></div>` : empty(tr('没有过期申请', 'No expired requests'), tr('系统会自动清理；清理失败的申请可在这里重试。', 'Automatic cleanup handles expired requests; retry failures here.'));
      reviewFiles.innerHTML = value.files.length ? `<div class="reader-admin-review-list"><label class="reader-admin-review-select"><input type="checkbox" data-admin-select-all="files"> ${tr('全选待清理文件', 'Select all files')}</label>${value.files.map(row => `<label class="reader-admin-review-item"><input type="checkbox" data-admin-select="files" value="${esc(row.id)}"><span><strong>${esc(row.reason)}</strong><small>${esc(row.filename)}${row.last_error ? ` · ${esc(row.last_error)}` : ''}</small></span></label>`).join('')}<button type="button" data-admin-bulk-clean="files">${tr('清理所选', 'Clean selected')}</button></div>` : empty(tr('没有待清理文件', 'No files to clean'), tr('已替换的头像会自动删除。', 'Replaced avatars are deleted automatically.'));
      reviewVersions.innerHTML = value.versions.length ? `<div class="reader-admin-review-list"><label class="reader-admin-review-select"><input type="checkbox" data-admin-select-all="versions"> ${tr('全选待清理版本', 'Select all versions')}</label>${value.versions.map(row => `<label class="reader-admin-review-item"><input type="checkbox" data-admin-select="versions" value="${esc(row.id)}"><span><strong>${esc(row.collection)}</strong><small>${esc(row.parent_id)}${row.last_error ? ` · ${esc(row.last_error)}` : ''}</small></span></label>`).join('')}<button type="button" data-admin-bulk-clean="versions">${tr('清理所选', 'Clean selected')}</button></div>` : empty(tr('没有待清理版本', 'No versions to clean'), tr('删除内容后的历史版本会自动清理。', 'Historical versions are cleaned automatically.'));
      reviewMedia.innerHTML = value.media.length ? `<div class="reader-admin-review-list"><label class="reader-admin-review-select"><input type="checkbox" data-admin-select-all="media"> ${tr('全选待清理附件', 'Select all media')}</label>${value.media.map(row => `<label class="reader-admin-review-item"><input type="checkbox" data-admin-select="media" value="${esc(row.id)}"><span><strong>${esc(row.media_id)}</strong><small>${row.last_error ? esc(row.last_error) : tr('等待再次检查引用', 'Awaiting reference check')}</small></span></label>`).join('')}<button type="button" data-admin-bulk-clean="media">${tr('清理所选', 'Clean selected')}</button></div>` : empty(tr('没有待清理附件', 'No media to clean'), tr('未被其他内容引用的附件会自动清理。', 'Unreferenced media is cleaned automatically.'));
    } catch (error) { if (!controller.signal.aborted && current === reviewGeneration) for (const region of reviewRegions) region.innerHTML = empty(tr('暂时无法读取', 'Unavailable'), esc(errorMessage(error))); }
    finally { if (!controller.signal.aborted && current === reviewGeneration) for (const region of reviewRegions) { region.setAttribute('aria-busy', 'false'); region.removeAttribute('inert'); } }
  };
  const loginHistoryMarkup = () => loginHistory === null
    ? tr('正在读取…', 'Loading…')
    : loginHistory === false
      ? tr('记录暂时无法读取', 'Sign-in history unavailable')
      : loginHistory.length
        ? `<ol>${loginHistory.map(event => `<li><span class="reader-admin-ip">${esc(event.ip)}</span><time>${esc(dateLabel(event.at, english))}</time></li>`).join('')}</ol>`
        : tr('尚无成功登录', 'No successful sign-ins yet');
  const renderDetail = (user: AdminUser, action = '') => {
    selected = user;
    const [tone, label] = state(user);
    const labels: Record<string, string> = { disable: tr('停用账号', 'Disable account'), enable: tr('恢复账号', 'Enable account'), delete: tr('删除账号', 'Delete account'), revoke: tr('撤销所有登录', 'Revoke all sessions'), 'vip-grant': user.vip ? tr('续期一个月', 'Renew one month') : tr('开通一个月 VIP', 'Grant one month of VIP'), 'vip-add-days': tr('增加会员天数', 'Add VIP days'), 'vip-revoke': tr('撤销 VIP', 'Revoke VIP') };
    const confirmCopy: Record<string, string> = { disable: tr('该账号将无法访问受限内容，现有登录也会失效。', 'Restricted access will stop and existing sessions will be revoked.'), enable: tr('该账号将恢复访问权限。', 'Access will be restored.'), delete: tr('将永久移除该账号及个人资料，无法恢复。必要的登录安全记录仍按留存规则保存。', 'The account and profile will be permanently removed. Required sign-in audit records remain under the retention policy.'), revoke: tr('该账号需要重新登录，资料不会删除。', 'The reader must sign in again. Data will remain.'), 'vip-grant': user.vip ? tr('从当前到期时间起延长一个自然月。不会自动收费。', 'Extend one calendar month from the current expiry. No automatic billing.') : tr('从现在起开通一个自然月。不会自动收费。', 'Grant one calendar month from now. No automatic billing.'), 'vip-add-days': user.vip ? tr('从当前到期时间起增加指定天数，不会自动收费。', 'Add days from the current expiry. No automatic billing.') : tr('从现在起开通指定天数的 VIP，不会自动收费。', 'Grant a chosen number of VIP days from now. No automatic billing.'), 'vip-revoke': tr('会员标识和权益立即失效，原有账号仍可登录。', 'VIP status ends immediately; the account can still sign in.') };
    const header = `<header class="reader-admin-dialog-head"><div><span class="reader-admin-kicker">SANSPHASE / READER</span><h2>${esc(user.nickname)}</h2><p><span class="reader-admin-dialog-uid">UID ${esc(user.uid)}</span><span class="reader-admin-status reader-admin-status--${tone}">${label}</span>${user.vip ? '<span class="reader-admin-vip">VIP</span>' : ''}</p></div><button type="button" data-admin-close aria-label="${tr('关闭', 'Close')}">×</button></header>`;
    const membership = user.vip ? '<span class="reader-admin-vip">VIP</span>' : user.vipUntil ? tr('已到期', 'Expired') : tr('普通读者', 'Reader');
    const uidEditor = `<div class="reader-admin-uid-editor"><div><strong>${tr('显示 UID', 'Display UID')}</strong><p>${tr('4 至 9 位数字，不可与其他用户重复。修改后读者账户显示会同步更新；内部账号 ID 不变。', 'Use 4–9 digits. It must be unique. The reader will see the new UID; the internal account ID stays the same.')}</p></div><form data-admin-uid-form data-id="${esc(user.id)}"><label class="sr-only" for="reader-admin-uid-input">${tr('自定义 UID', 'Custom UID')}</label><input id="reader-admin-uid-input" name="uid" inputmode="numeric" pattern="[0-9]{4,9}" minlength="4" maxlength="9" value="${esc(user.uid)}" required><button type="submit">${tr('保存 UID', 'Save UID')}</button></form><p data-admin-uid-message role="status" aria-live="polite"></p></div>`;
    const info = `<div class="reader-admin-dialog-body"><section class="reader-admin-dialog-section"><div class="reader-admin-dialog-section-head"><span class="reader-admin-kicker">01 / ACCOUNT</span><h3>${tr('账号资料', 'Account details')}</h3></div><dl class="reader-admin-facts"><div><dt>${tr('邮箱', 'Email')}</dt><dd>${esc(user.email)}</dd></div><div><dt>${tr('手机号', 'Phone')}</dt><dd>${esc(user.phone || '—')}<small>${tr('仅作联系资料，未经过短信验证', 'Contact information only; not SMS-verified')}</small></dd></div><div><dt>${tr('注册时间', 'Registered')}</dt><dd>${esc(dateLabel(user.createdAt, english))}</dd></div><div><dt>${tr('内部账号 ID', 'Internal account ID')}</dt><dd class="reader-admin-id">${esc(String(user.id))}</dd></div></dl></section><section class="reader-admin-dialog-section reader-admin-dialog-section--split"><div><div class="reader-admin-dialog-section-head"><span class="reader-admin-kicker">02 / MEMBERSHIP</span><h3>${tr('会员权限', 'VIP membership')}</h3></div><p class="reader-admin-membership-state">${membership}</p>${user.vipUntil ? `<p class="reader-admin-membership-until">${tr('到期', 'Until')} ${esc(dateLabel(user.vipUntil, english))} <span data-vip-remaining="${esc(user.vipUntil)}">${esc(remainingLabel(user.vipUntil, english))}</span></p>` : `<p class="reader-admin-membership-until">${tr('尚未开通会员', 'No membership yet')}</p>`}</div><div><div class="reader-admin-dialog-section-head"><span class="reader-admin-kicker">03 / SECURITY</span><h3>${tr('登录安全', 'Sign-in security')}</h3></div><p class="reader-admin-security-ip">${esc(user.lastLoginIp || '—')}</p><p class="reader-admin-security-time">${user.lastLoginAt ? esc(dateLabel(user.lastLoginAt, english)) : tr('尚无成功登录', 'No successful sign-in yet')}</p></div></section><section class="reader-admin-dialog-section reader-admin-logins"><div class="reader-admin-dialog-section-head"><span class="reader-admin-kicker">04 / HISTORY</span><h3>${tr('最近登录记录', 'Recent sign-ins')}</h3></div><div data-admin-logins>${loginHistoryMarkup()}</div></section></div>`;
    const controls = `<footer class="reader-admin-detail-actions"><div class="reader-admin-action-group"><span>${tr('账号访问', 'Account access')}</span><div><button type="button" data-admin-action="${user.disabled ? 'enable' : 'disable'}" class="${user.disabled ? '' : 'reader-admin-action-danger'}">${labels[user.disabled ? 'enable' : 'disable']}</button><button type="button" data-admin-action="delete" class="reader-admin-action-danger">${labels.delete}</button><button type="button" data-admin-action="revoke">${labels.revoke}</button></div></div><div class="reader-admin-action-group"><span>${tr('会员权限', 'VIP membership')}</span><div><button type="button" class="reader-admin-action-primary" data-admin-action="vip-grant">${labels['vip-grant']}</button><button type="button" data-admin-action="vip-add-days">${labels['vip-add-days']}</button>${user.vipUntil ? `<button type="button" data-admin-action="vip-revoke" class="reader-admin-action-danger">${labels['vip-revoke']}</button>` : ''}</div></div></footer>`;
    const confirmation = `<div class="reader-admin-dialog-body reader-admin-dialog-body--confirm"><section class="reader-admin-confirm ${['disable', 'delete', 'revoke', 'vip-revoke'].includes(action) ? 'reader-admin-confirm--danger' : ''}"><span class="reader-admin-kicker">${tr('操作确认', 'CONFIRM ACTION')}</span><h3>${labels[action]}？</h3><p>${confirmCopy[action]}</p><div class="reader-admin-confirm-account"><strong>${esc(user.nickname)}</strong><span>UID ${esc(user.uid)} · ${esc(user.email)}</span></div>${action === 'vip-add-days' ? `<label class="reader-admin-confirm-days">${tr('增加天数（1 至 365 天）', 'Days to add (1–365)')}<input type="number" data-admin-vip-days min="1" max="365" step="1" value="1" required inputmode="numeric"></label><p class="reader-admin-confirm-error" data-admin-confirm-error role="status"></p>` : ''}${action === 'delete' ? `<label class="reader-admin-confirm-email">${tr('输入完整邮箱确认删除', 'Enter the full email to confirm deletion')}<input type="email" data-admin-delete-email autocomplete="off" spellcheck="false" placeholder="${esc(user.email)}"></label><p class="reader-admin-confirm-error" data-admin-confirm-error role="status"></p>` : ''}</section></div><footer class="reader-admin-confirm-actions"><button type="button" data-admin-cancel>${tr('返回详情', 'Back to details')}</button><button type="button" class="reader-admin-confirm-button ${['disable', 'delete', 'revoke', 'vip-revoke'].includes(action) ? 'reader-admin-confirm-button--danger' : ''}" data-admin-confirm="${action}" data-id="${esc(user.id)}">${labels[action]}</button></footer>`;
    detail.innerHTML = header + (action ? confirmation : info.replace('</dl></section>', `</dl>${uidEditor}</section>`) + controls);
    if (detail.open) detail.querySelector<HTMLElement>(action ? '[data-admin-cancel]' : '[data-admin-close]')?.focus();
  };
  const click = async (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const nav = target.closest<HTMLElement>('[data-admin-view]');
    if (nav) {
      view = nav.dataset.adminView || 'accounts';
      root.querySelectorAll('[data-admin-view]').forEach(button => { if (button === nav) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
      root.querySelectorAll<HTMLElement>('[data-admin-panel]').forEach(panel => { panel.hidden = panel.dataset.adminPanel !== view; });
      const headings: Record<string, string[]> = {
        accounts: [tr('管理后台 / 账号', 'ADMIN / ACCOUNTS'), tr('用户管理', 'User management'), tr('查看注册用户、会员状态和登录记录。', 'Review registered users, memberships, and sign-in history.')],
        memberships: [tr('管理后台 / 会员', 'ADMIN / MEMBERSHIPS'), tr('会员权限', 'VIP memberships'), tr('管理会员状态与到期时间。', 'Manage membership status and expiry.')],
        review: [tr('管理后台 / 审核', 'ADMIN / REVIEW'), tr('审核与清理', 'Review and cleanup'), tr('审核资料，并处理自动清理失败的项目。', 'Review profiles and handle cleanup failures.')],
        activity: [tr('管理后台 / 记录', 'ADMIN / ACTIVITY'), tr('操作记录', 'Activity log'), tr('查看最近完成的管理操作。', 'Review recent management actions.')],
      };
      const [kicker, title, copy] = headings[view] || headings.accounts;
      root.querySelector<HTMLElement>('.reader-admin-header .reader-admin-kicker')!.textContent = kicker;
      root.querySelector<HTMLElement>('.reader-admin-header h1')!.textContent = title;
      root.querySelector<HTMLElement>('.reader-admin-header p')!.textContent = copy;
      if (view === 'activity') await renderAudit(); else if (view === 'memberships') await renderMemberships(); else if (view === 'review') await renderReview(); else await renderAccounts();
      return;
    }
    const reviewTab = target.closest<HTMLElement>('[data-admin-review-tab]');
    if (reviewTab) {
      root.querySelectorAll('[data-admin-review-tab]').forEach(button => button.setAttribute('aria-pressed', String(button === reviewTab)));
      root.querySelectorAll<HTMLElement>('[data-admin-review-panel]').forEach(panel => { panel.hidden = panel.dataset.adminReviewPanel !== reviewTab.dataset.adminReviewTab; });
      return;
    }
    const memberFilterButton = target.closest<HTMLElement>('[data-admin-member-filter]');
    if (memberFilterButton) {
      memberFilter = memberFilterButton.dataset.adminMemberFilter || 'all'; memberPage = 1;
      root.querySelectorAll('[data-admin-member-filter]').forEach(button => button.setAttribute('aria-pressed', String(button === memberFilterButton)));
      await renderMemberships(); return;
    }
    const selectAll = target.closest<HTMLInputElement>('[data-admin-select-all]');
    if (selectAll) { root.querySelectorAll<HTMLInputElement>(`[data-admin-select="${selectAll.dataset.adminSelectAll}"]`).forEach(box => { box.checked = selectAll.checked; }); return; }
    const reviewAction = target.closest<HTMLButtonElement>('[data-admin-review-action]');
    if (reviewAction) {
      const card = reviewAction.closest<HTMLElement>('.reader-admin-review-item');
      const reasonInput = card?.querySelector<HTMLInputElement>('[data-admin-review-reason]');
      const buttons = card?.querySelectorAll<HTMLButtonElement>('[data-admin-review-action]');
      if (!reasonInput || !buttons || reviewProfiles.hasAttribute('inert') || pendingReviews.has(reviewAction.dataset.id || '') || [...buttons].some(button => button.disabled)) return;
      const reason = reasonInput.value.trim();
      const decision = reviewAction.dataset.adminReviewAction;
      if ((decision !== 'approve' && decision !== 'reject') || !reviewAction.dataset.id) return;
      if ((decision === 'reject' && !reason) || [...reason].length > 200 || /[\u0000-\u001f\u007f<>]/u.test(reason)) {
        reasonInput.setAttribute('aria-invalid', 'true');
        message(tr('请填写审核说明，驳回原因不能为空；最多 200 字，不含控制字符或尖括号。', 'Enter a review reason: rejection requires it, with at most 200 characters and no control characters or angle brackets.'), true);
        reasonInput.focus(); return;
      }
      reasonInput.removeAttribute('aria-invalid');
      const id = reviewAction.dataset.id;
      profileReasons.set(id, reasonInput.value);
      pendingReviews.add(id); syncReviewLock(id);
      try {
        await request(`review/profile/${encodeURIComponent(id)}/${decision}`, { method: 'POST', headers: { Origin: window.location.origin, 'X-Author-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
        if (controller.signal.aborted) return;
        profileReasons.delete(id);
        message(tr('审核已完成。', 'Review completed.')); await renderReview();
      } catch (error) { if (!controller.signal.aborted) message(errorMessage(error), true); }
      finally { pendingReviews.delete(id); if (!controller.signal.aborted) syncReviewLock(id); }
      return;
    }
    const bulk = target.closest<HTMLButtonElement>('[data-admin-bulk-clean]');
    if (bulk) {
      if (bulk.closest('[inert]')) return;
      const kind = bulk.dataset.adminBulkClean;
      const ids = [...root.querySelectorAll<HTMLInputElement>(`[data-admin-select="${kind}"]:checked`)].map(box => box.value);
      if (!ids.length) { message(tr('请先勾选要清理的项目。', 'Select items to clean first.'), true); return; }
      bulk.disabled = true;
      try {
        const result = await request<{cleaned: number}>(`review/${kind}/cleanup`, { method: 'POST', headers: { Origin: window.location.origin, 'X-Author-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
        message(`${tr('已清理', 'Cleaned')} ${result.cleaned || 0} ${tr('项', 'items')}。`); await renderReview();
      } catch (error) { message(errorMessage(error), true); bulk.disabled = false; }
      return;
    }
    const filter = target.closest<HTMLElement>('[data-admin-filter]');
    if (filter) { status = filter.dataset.adminFilter || 'all'; page = 1; root.querySelectorAll('[data-admin-filter]').forEach(button => button.setAttribute('aria-pressed', String(button === filter))); await renderAccounts(); return; }
    const paging = target.closest<HTMLElement>('[data-admin-page]');
    if (paging) { page += paging.dataset.adminPage === 'next' ? 1 : -1; await renderAccounts(); return; }
    const memberPaging = target.closest<HTMLElement>('[data-admin-member-page]');
    if (memberPaging) { memberPage += memberPaging.dataset.adminMemberPage === 'next' ? 1 : -1; await renderMemberships(); return; }
    const opener = target.closest<HTMLElement>('[data-admin-open]');
    if (opener) { const user = users.get(opener.dataset.adminOpen || ''); if (user) { loginHistory = null; renderDetail(user); detail.showModal(); try { const value = await request<{events: AuditEvent[]}>(`readers/${encodeURIComponent(user.id)}/logins`); if (selected?.id === user.id && detail.open) { loginHistory = value.events; const box = detail.querySelector('[data-admin-logins]'); if (box) box.innerHTML = loginHistoryMarkup(); } } catch { if (selected?.id === user.id && detail.open) { loginHistory = false; const box = detail.querySelector('[data-admin-logins]'); if (box) box.innerHTML = loginHistoryMarkup(); } } } return; }
    if (target.closest('[data-admin-close]')) { detail.close(); return; }
    const action = target.closest<HTMLElement>('[data-admin-action]');
    if (action && selected) { renderDetail(selected, action.dataset.adminAction); return; }
    if (target.closest('[data-admin-cancel]') && selected) { renderDetail(selected); return; }
    const confirm = target.closest<HTMLButtonElement>('[data-admin-confirm]');
    if (!confirm) return;
    const user = selected, operation = confirm.dataset.adminConfirm;
    if (!user || confirm.dataset.id !== String(user.id) || !operation || !['disable', 'enable', 'delete', 'revoke', 'vip-grant', 'vip-add-days', 'vip-revoke'].includes(operation)) return;
    const daysValue = operation === 'vip-add-days' ? detail.querySelector<HTMLInputElement>('[data-admin-vip-days]')?.value : null;
    const days = daysValue === null || daysValue === '' ? NaN : Number(daysValue);
    if (operation === 'vip-add-days' && (!Number.isInteger(days) || days < 1 || days > 365)) {
      detail.querySelector<HTMLElement>('[data-admin-confirm-error]')!.textContent = tr('请输入 1 至 365 的整数天数。', 'Enter a whole number from 1 to 365.');
      detail.querySelector<HTMLElement>('[data-admin-vip-days]')!.focus();
      return;
    }
    const confirmEmail = operation === 'delete' ? String(detail.querySelector<HTMLInputElement>('[data-admin-delete-email]')?.value || '').trim() : '';
    if (operation === 'delete' && confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
      const error = detail.querySelector('[data-admin-confirm-error]');
      if (error) error.textContent = tr('请输入完整邮箱后再删除。', 'Enter the full email before deleting.');
      detail.querySelector<HTMLElement>('[data-admin-delete-email]')?.focus();
      return;
    }
    confirm.disabled = true;
    try {
      await request(`readers/${encodeURIComponent(user.id)}/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Author-Request': '1' }, body: JSON.stringify({ confirmId: user.id, ...(operation === 'delete' ? { confirmEmail } : {}), ...(operation === 'vip-add-days' ? { days } : {}) }) });
      detail.close(); selected = null; message(operation === 'delete' ? tr('账号已删除。', 'Account deleted.') : operation === 'vip-add-days' ? `${tr('会员有效期已增加', 'VIP extended by')} ${days} ${tr('天。', 'days.')}` : tr('账号操作已完成。', 'Account updated.'));
      if (view === 'memberships') await renderMemberships(); else if (view === 'activity') await renderAudit(); else await renderAccounts();
    } catch (error) { message(errorMessage(error), true); confirm.disabled = false; }
  };
  const search = (event: Event) => { event.preventDefault(); query = String(new FormData(event.currentTarget as HTMLFormElement).get('q') || '').trim(); page = 1; renderAccounts(); };
  const memberSearch = (event: Event) => { event.preventDefault(); memberQuery = String(new FormData(event.currentTarget as HTMLFormElement).get('q') || '').trim(); memberPage = 1; renderMemberships(); };
  const saveUid = async (event: Event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-admin-uid-form]');
    if (!form) return;
    event.preventDefault();
    if (!selected || form.dataset.id !== String(selected.id)) return;
    const uid = String(new FormData(form).get('uid') || '').trim();
    const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const status = detail.querySelector<HTMLElement>('[data-admin-uid-message]')!;
    button.disabled = true;
    status.textContent = '';
    try {
      const updated = await request<AdminUser>(`readers/${encodeURIComponent(selected.id)}/uid`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Author-Request': '1' },
        body: JSON.stringify({ confirmId: selected.id, uid }),
      });
      renderDetail(updated);
      detail.querySelector<HTMLElement>('[data-admin-uid-message]')!.textContent = tr('UID 已更新。', 'UID updated.');
      if (view === 'memberships') await renderMemberships(); else await renderAccounts();
    } catch (error) {
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
      button.disabled = false;
    }
  };
  const outside = (event: MouseEvent) => { if (event.target === detail) detail.close(); };
  const timer = setInterval(() => root.querySelectorAll<HTMLElement>('[data-vip-remaining]').forEach(element => { element.textContent = remainingLabel(element.dataset.vipRemaining, english); }), 60000);
  root.addEventListener('click', click);
  root.querySelector('#reader-admin-search')!.addEventListener('submit', search);
  root.querySelector('#reader-admin-member-search')!.addEventListener('submit', memberSearch);
  detail.addEventListener('submit', saveUid);
  detail.addEventListener('click', outside);
  renderAccounts();
  return () => { controller.abort(); clearInterval(timer); ++generation; ++reviewGeneration; pendingReviews.clear(); profileReasons.clear(); root.removeEventListener('click', click); root.querySelector('#reader-admin-search')?.removeEventListener('submit', search); root.querySelector('#reader-admin-member-search')?.removeEventListener('submit', memberSearch); detail.removeEventListener('submit', saveUid); detail.removeEventListener('click', outside); detail.close(); };
}
