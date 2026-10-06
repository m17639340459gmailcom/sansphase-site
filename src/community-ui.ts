// 社区页面的数据和交互：读接口、排序、搜索、加载更多、发帖（按版块类型）、编辑、回复（引用、@、排序）、
// 赞、收藏、感谢、采纳、举报、删除、悬赏、提示词解锁、资源投票、付费置顶和高亮、签到和补签、星尘明细、
// 兑换所、关注、通知，以及站长和协管的置顶、精华、锁帖、移动、审核、禁言、举报处理、发货和上架。
// 页面 HTML 由 community.ts、community-post.ts 和 community-pages.ts 生成；这里先用缓存立即渲染，再在路由变化时刷新。
import {
  communityRoute, communityHomeHTML, communityBoardsHTML, communityBoardHTML, communityTagHTML, communityBookmarksHTML,
  communityBodyHTML, communityBoards, communityRules, communitySearchLimit, isCommunitySort, boardHref, postHref, readyData, imageLimit, avatarHTML, nameLabelHTML, communityManagementRole, communityReaderReadOnly,
} from './community.mjs';
import type {
  CommunityLoad, CommunityListing, CommunitySort, CommunitySummary, CommunityRoute, CommunityMe, CommunityPerson, CommunityModerationContact, CommunityModerationContacts, Escape, Translate,
} from './community.ts';
import { communityPostHTML, communityComposeHTML, communityLimits, bodyLimits, composePreviewHTML, editingFrom } from './community-post.mjs';
import type { CommunityThread, CommunityUpload, CommunityTarget, CommunityReplySort } from './community-post.ts';
import { bodyImageContent } from './community-body-images.mjs';
import { communityImageBytes, communityNameEffect } from './community-rules.mjs';
import { readNameEffectFile } from './community-equipment-import.mjs';
import type { ShopCategory } from './community-rules.ts';
import { autosizeCommunityTextarea } from './community-editor-size.mjs';
import { createCommunityBannerController } from './community-banner-controller.mjs';
import { createCommunityConventionConsent } from './community-convention-consent.mjs';
import { createCommunityLevelExplorer } from './community-level-explorer.mjs';
import { createCommunityBadgeExplorer } from './community-badge-explorer.mjs';
import type { CommunityConvention } from './community-convention.ts';
import type { CommunityGrowthState, CommunityVIPGrowthState } from './community-growth.ts';
import { createCommunityWriteRequest } from './community-write-request.mjs';
import { createCommunityProfileDialog } from './community-profile-dialog.mjs';
import type { CommunityProfile } from './community-profile.ts';
import { communityFrameBannersHTML } from './community-frame-banners.mjs';
import type { CommunityBannerConfig } from './community-banners.ts';
import type { CommunityComposeEditor } from './community-compose-editor.ts';
import {
  communityCheckinHTML, communityStardustHTML, communityShopHTML, communityShopMineHTML, communityRankHTML, communityMemberHTML,
  communityInboxHTML, communityRulesHTML, communityManageHTML, communityConventionBodyHTML,
} from './community-pages.mjs';
import type {
  CommunityCheckin, CommunityStardust, CommunityFlow, CommunityShop, CommunityShopMine, CommunityDelivery, CommunityRank,
  CommunityMember, CommunityInbox, CommunityManage, CommunityItemEditing,
} from './community-pages.ts';

export type CommunityContext = {
  t: Translate; esc: Escape; icons: Record<string, string>; members: boolean;
  // The owner's avatar on the main site, for the owner's posts.
  ownerAvatar?: string | null;
  // A short confirmation (the site's toast).
  notify?: (message: string) => void;
  // The header's bell and account menu read `me`; this redraws them when it changes.
  headerChanged?: () => void;
  // Optional local layout host, notified after data replaces the center page.
  painted?: () => void;
  // A layout can retain its scroll container across a structural repaint.
  beforePaint?: () => (() => void);
  showPostingTips?: boolean;
  showActiveMembers?: boolean;
  showHomeCompose?: boolean;
  simpleCompose?: boolean;
  mountSelect?: (select: HTMLSelectElement, icons: Record<string, string>) => { update(): void; dispose(): void };
};
type Options = { request?: typeof fetch; navigate?: (hash: string) => void; createProfileCrop?: typeof import('./community-profile-crop.ts').createCommunityProfileCrop };
type ApiError = Error & { status: number };
type Form = HTMLFormElement;
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const loading = { state: 'loading' } as const;
const failure = (error: unknown): { state: 'error'; status: number; message: string } =>
  ({ state: 'error', status: (error as ApiError).status ?? 0, message: error instanceof Error ? error.message : '' });
const length = (value: string) => [...value.trim()].length;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
// Attribute values in selectors (ids are server UUIDs, but stay safe).
const quoted = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`;
const enc = encodeURIComponent;

// Markdown buttons wrap the selection (or insert a placeholder) and keep the caret sensible.
function applyMarkdown(field: HTMLTextAreaElement, kind: string, tr: Translate) {
  const { value } = field;
  const start = field.selectionStart ?? value.length, end = field.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const lines = (prefix: string) => (selected || tr('文字', 'text')).split('\n').map(line => `${prefix}${line}`).join('\n');
  let insert: string, from: number, to: number;
  if (kind === 'bold') { const inner = selected || tr('加粗文字', 'bold text'); insert = `**${inner}**`; from = 2; to = 2 + inner.length; }
  else if (kind === 'code' && selected.includes('\n')) { insert = '```\n' + selected + '\n```'; from = 4; to = 4 + selected.length; }
  else if (kind === 'code') { const inner = selected || 'code'; insert = `\`${inner}\``; from = 1; to = 1 + inner.length; }
  else if (kind === 'link') { const inner = selected || tr('链接文字', 'link text'); insert = `[${inner}](https://)`; from = inner.length + 3; to = insert.length - 1; }
  else if (kind === 'quote') { insert = lines('> '); from = 0; to = insert.length; }
  else { insert = lines('- '); from = 0; to = insert.length; }
  // A block starts on its own line.
  if ((kind === 'quote' || kind === 'list' || insert.startsWith('```')) && start > 0 && value[start - 1] !== '\n') { insert = '\n' + insert; from++; to++; }
  if (typeof field.setRangeText === 'function') field.setRangeText(insert, start, end, 'start');
  else field.value = value.slice(0, start) + insert + value.slice(end);
  field.focus({ preventScroll: true });
  field.setSelectionRange(start + from, start + to);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

export function createCommunityUI({ request = (...args) => fetch(...args), navigate: go = (hash) => { location.hash = hash; }, createProfileCrop }: Options = {}) {
  let sort: CommunitySort = 'active';
  let summary: CommunityLoad<CommunitySummary> | null = null;
  const frameHighlights = new Map<string, CommunityLoad<CommunityListing>>();
  const frameHighlightsPending = new Map<string, Promise<void>>();
  const banners = new Map<string, CommunityLoad<CommunityBannerConfig>>();
  const bannerRequests = new Map<string, Promise<void>>();
  let frameIdentity = 0;
  let paintedAccount: string | null = null;
  let browseRequest = 0;
  let switchingBrowseMode = false;
  let me: CommunityLoad<CommunityMe> | null = null;
  let profile: CommunityLoad<CommunityProfile> | null = null;
  let profileWrite: object | null = null;
  let profileRequest = 0;
  let legacyProfileOpened = false;
  const profileDialog = createCommunityProfileDialog({
    crop: createProfileCrop,
    busy: () => Boolean(profileWrite), click: onClick, submit: onSubmit, input: onInput,
    retry: () => { void loadProfile().then(() => profileDialog.render(profile || loading)); },
    returnFocus: () => mounted?.main.querySelector<HTMLElement>('[data-action="community-profile-edit"]') || null,
  });
  let moderationContacts: CommunityLoad<CommunityModerationContacts> | null = null;
  let convention: CommunityLoad<CommunityConvention> | null = null;
  let checkin: CommunityLoad<CommunityCheckin> | null = null;
  let checkinMonth = '';
  let bookmarks: CommunityLoad<CommunityListing> | null = null;
  let shop: CommunityLoad<CommunityShop> | null = null;
  let shopMine: CommunityLoad<CommunityShopMine> | null = null;
  let rank: CommunityLoad<CommunityRank> | null = null;
  let flow: CommunityFlow = 'all';
  const stardusts = new Map<CommunityFlow, CommunityLoad<CommunityStardust>>();
  const levelExplorer = createCommunityLevelExplorer({
    root: () => route().view === 'stardust' && route().tab === 'levels' ? mounted?.main.querySelector<HTMLElement>('[data-level-explorer]') || null : null,
    data: () => readyData(stardusts.get(flow)),
    common: () => mounted?.ctx || null,
  });
  const memberPages = new Map<string, CommunityLoad<CommunityMember>>();
  const memberProfileEpochs = new Map<string, number>();
  const badgeExplorer = createCommunityBadgeExplorer({
    root: () => route().view === 'member' && route().tab === 'badges' ? mounted?.main.querySelector<HTMLElement>('[data-badge-explorer]') || null : null,
    data: () => { const current = route(); return readyData(memberPages.get(memberKey(current.id, current.tab)))?.badgeState || null; },
    common: () => mounted?.ctx || null,
  });
  const inboxes = new Map<string, CommunityLoad<CommunityInbox>>();
  const manages = new Map<string, CommunityLoad<CommunityManage>>();
  const manageRequests = new Map<string, number>();
  const lists = new Map<string, CommunityLoad<CommunityListing>>();
  const threads = new Map<string, CommunityLoad<CommunityThread>>();
  // Search terms per list scope: '' is the home page, a board id, or `tag:<tag>`.
  const queries = new Map<string, string>();
  // Page-local state, reset on every new page.
  let reporting: CommunityTarget | null = null;
  let editingReply: string | null = null;
  let quoting: string | null = null;
  let replySort: CommunityReplySort = 'floor';
  let postMenu = false;
  let deleting: CommunityTarget | null = null;
  let moving = false;
  let retagging = false;
  let redeeming: string | null = null;
  let delivery: CommunityDelivery | null = null;
  let muting = false;
  let itemEditing: CommunityItemEditing | null = null;
  let shippingOrder: string | null = null;
  let rejecting: string | null = null;
  const reviewSelection = new Set<string>();
  let reviewBusy = false;
  let managementBoard = '';
  let stewardCandidate: CommunityLoad<CommunityMember> | null = null;
  let stewardLookupUid = '';
  let stewardLookupRequest = 0;
  let stewardBusy = false;
  let stewardEditingUid: string | null = null;
  let stewardScopeDraft: { uid: string; boards: string[] } | null = null;
  let managementOpener: { action: string; id: string } | null = null;
  const managementBackground = new Map<HTMLElement, boolean>();
  // The board picked in the compose form (null: the one in the address).
  let composeBoard: string | null = null;
  let uploads: CommunityUpload[] = [];
  let uploadsFor = '';
  let mounted: { main: HTMLElement; ctx: CommunityContext } | null = null;
  // The reading frame owns its inner viewport. Management and baseline pages
  // scroll the document, whose height can collapse while a request is pending.
  let documentReading: {
    hash: string; node: HTMLElement; minHeight: string; height: number;
    left: number; top: number
  } | null = null;
  let documentReadingFrame: number | null = null;
  const editors = new Map<HTMLElement, CommunityComposeEditor>();
  const selects = new Map<HTMLSelectElement, { update(): void; dispose(): void }>();
  const editorFor = (field: Element | null) => [...editors.values()].find(editor => editor.field === field);
  let composeEditorModule: Promise<typeof import('./community-compose-editor.mjs')> | null = null;
  let lastHash = '';
  let approvedNavigation = '';
  let restoringHistory = false;
  let headerKey = '';
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let equipmentDragDepth = 0;

  // Drafts are deliberately text-only. Storage can be disabled or quota-limited in
  // private browsing, so every access is best-effort and never blocks the editor.
  const draftPrefix = 'sansphase:community:draft:';
  const memoryDrafts = new Map<string, string>();
  const storage = () => { try { return window.localStorage; } catch { return null; } };
  const draftIdentity = () => {
    const current = readyData(me);
    return current?.uid ? `${current.role}:${current.uid}` : null;
  };
  const draftKey = (kind: 'compose' | 'reply', id: string) => {
    const identity = draftIdentity();
    return identity ? `${draftPrefix}${encodeURIComponent(identity)}:${kind}:${id}` : null;
  };
  const readDraft = <T>(key: string | null): T | null => {
    if (!key) return null;
    try { const raw = memoryDrafts.get(key) || storage()?.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { const raw = memoryDrafts.get(key); return raw ? JSON.parse(raw) as T : null; }
  };
  const writeDraft = (key: string | null, value: unknown) => { if (!key) return; const raw = JSON.stringify(value); memoryDrafts.set(key, raw); try { storage()?.setItem(key, raw); } catch { /* storage is optional */ } };
  const removeDraft = (key: string | null) => { if (!key) return; memoryDrafts.delete(key); try { storage()?.removeItem(key); } catch { /* storage is optional */ } };
  type SavedComposeDraft = { board: string; title: string; body: string; tags: string[]; bounty: number };
  const draftHasText = (value: SavedComposeDraft | { body: string } | null) => Boolean(value && (value.body.trim() || ('title' in value && value.title.trim()) || ('tags' in value && value.tags.length) || ('bounty' in value && value.bounty)));
  const hasUnsavedDraft = (hash = location.hash) => {
    const current = communityRoute(hash);
    if (profileDialog.opened()) return Boolean(profileWrite || profileDialog.dirty());
    if (current.view === 'new') return draftHasText(readDraft<SavedComposeDraft>(draftKey('compose', hash)));
    if (current.view === 'post') return draftHasText(readDraft<{ body: string }>(draftKey('reply', current.id)));
    return false;
  };
  const draftTags = (form: Form) => [...form.querySelectorAll<HTMLInputElement>('input[name="tags"]:checked')].map(item => item.value).slice(0, communityRules.tagMax);
  const navigate = (hash: string) => {
    go(hash);
  };

  const businessWrites = new Map<object, number>();
  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const writing = init.method === 'POST' && path !== 'browse-mode';
    const operation = {};
    if (writing) businessWrites.set(operation, frameIdentity);
    try {
      const viewer = readyData(me);
      if (writing && /^manage(?:\/|\?|$)/.test(path) && (!(viewer?.owner || viewer?.mod) || viewer.management?.browsingAsReader))
        throw Object.assign(Error(tr('请先返回管理身份。', 'Restore management first.')), { status: 403 });
      return await requestAPI<T>(path, init);
    } finally { businessWrites.delete(operation); }
  }
  async function requestAPI<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try { response = await request('/api/community/' + path, { credentials: 'same-origin', ...init }); }
    catch { throw Object.assign(new Error('网络连接失败，请稍后重试。'), { status: 0 }); }
    let value: { error?: string };
    try { value = await response.json() as { error?: string }; }
    catch {
      throw Object.assign(new Error(response.ok ? '响应读取失败，请稍后重试。' : '社区暂时无法读取。'), { status: response.ok ? 0 : response.status });
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw Object.assign(new Error('响应读取失败，请稍后重试。'), { status: response.ok ? 0 : response.status });
    if (!response.ok) throw Object.assign(new Error(value.error || '社区暂时无法读取。'), { status: response.status });
    return value as T;
  }
  const writeRequests = createCommunityWriteRequest({
    request: api,
    identity: () => {
      const person = readyData(me);
      return person?.uid ? `${person.role}:${person.uid}` : null;
    },
    storage: () => window.sessionStorage,
  });
  const send = <T>(path: string, body: object = {}) => writeRequests.send<T>(path, body);
  // Client state only avoids redundant requests. The server owns the daily
  // account key, award, VIP status and transaction; storage cannot grant XP.
  let activeVisitDone = '';
  let activeVisitPending: { key: string; token: object; result: Promise<boolean> } | null = null;
  let activeVisitRetryAt = 0;
  async function recordActiveVisit(): Promise<boolean> {
    const current = readyData(me), view = route().view;
    if (!mounted || mounted.main.ownerDocument.visibilityState !== 'visible' || !current?.uid || current.role !== 'reader' || current.owner || communityReaderReadOnly(current) || !current.agreed || current.convention?.agreed === false || !current.growth?.configured || view === 'unknown' || view === 'landing') return false;
    const identity = frameIdentity;
    const key = `${current.uid}:${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}`;
    if (key === activeVisitDone) return false;
    if (activeVisitPending?.key === key) return activeVisitPending.result;
    if (Date.now() < activeVisitRetryAt) return false;
    const token = {};
    const result = (async () => {
      try {
        const visit = await send<{ uid: string | null; awarded: number; visited: boolean; growth: CommunityGrowthState | null; vipGrowth: CommunityVIPGrowthState | null }>('active/visit');
        const viewer = readyData(me);
        if (identity !== frameIdentity || activeVisitPending?.token !== token || !mounted || viewer?.uid !== current.uid) return false;
        if (typeof visit.uid !== 'string' || !visit.uid) throw Error('The visit response did not identify its account.');
        // Cookies can change in another tab while this page still shows the
        // previous account. Never attach another account's progress to it.
        if (visit.uid !== current.uid) { clearData(); await refresh(); return false; }
        activeVisitDone = key;
        viewer.growth = visit.growth; viewer.vipGrowth = visit.vipGrowth;
        for (const value of stardusts.values()) if (value.state === 'ready') {
          value.data.growth = visit.growth; value.data.vipGrowth = visit.vipGrowth;
        }
        headerKey = ''; mounted.ctx.headerChanged?.();
        return true;
      } catch {
        // A failed request cannot fabricate progress. A later real entrance
        // or interaction retries the same protected write request.
        if (identity === frameIdentity && activeVisitPending?.token === token) activeVisitRetryAt = Date.now() + 15000;
        return false;
      }
    })();
    activeVisitPending = { key, token, result };
    try { return await result; }
    finally { if (activeVisitPending?.result === result) activeVisitPending = null; }
  }
  const onActiveVisibility = () => { void recordActiveVisit().then(changed => { if (changed) paint(); }); };
  const onActiveInteraction = (event: Event) => { if (event.isTrusted) onActiveVisibility(); };
  const conventionConsent = createCommunityConventionConsent({
    request: api, send, renderBody: (body, common) => communityConventionBodyHTML(body, common, 'community-consent-rule'),
    accepted: version => {
      const current = readyData(me);
      if (current) { current.agreed = true; current.convention = { version, agreed: true }; }
      void reload().then(recordActiveVisit).then(changed => { if (changed) paint(); });
    },
  });
  function syncConvention() {
    if (!mounted) return;
    const current = readyData(me);
    // The mandatory convention owns the modal lock while it is open. Restore
    // the management panel's lock first so nested dialogs do not trap each other.
    if (current?.convention && !current.convention.agreed) { profileDialog.suspend(); restoreManagementBackground(); }
    conventionConsent.sync(current, mounted.main.ownerDocument, mounted.ctx);
    if (!current?.convention || current.convention.agreed) {
      // Legacy bookmarks open the editor only after mandatory consent has
      // released its modal lock, including the first visit to this route.
      if (current && route().view === 'profile' && !legacyProfileOpened && !profileDialog.opened()) {
        legacyProfileOpened = true;
        profileDialog.open(mounted.main.ownerDocument, mounted.ctx, profile || loading);
      }
      profileDialog.resume();
    }
  }
  // A failed background refresh keeps what is already on screen; only a
  // definite answer (signed out, gone, not open) replaces it.
  const settle = <T>(current: CommunityLoad<T> | null | undefined, error: unknown): CommunityLoad<T> =>
    current?.state === 'ready' && !(error as ApiError).status ? current : failure(error);
  async function load<T>(path: string, current: CommunityLoad<T> | null | undefined): Promise<CommunityLoad<T>> {
    try { return { state: 'ready', data: await api<T>(path) }; }
    catch (error) { return settle(current, error); }
  }
  const notify = (text: string) => mounted?.ctx.notify?.(text);
  const tr = (zh: string, en: string) => mounted ? mounted.ctx.t(zh, en) : zh;
  const route = () => communityRoute(location.hash);
  const bannerEditor = createCommunityBannerController({
    request: api, paint, notify, t: tr,
    active: () => Boolean(mounted && route().view === 'manage' && route().tab === 'banners' && !readyData(me)?.management?.browsingAsReader),
    owner: () => Boolean(readyData(me)?.owner),
    saved: config => {
      const data = readyData(manages.get('banners'));
      if (data?.banners) data.banners = data.banners.map(item => item.scope === config.scope ? config : item);
      banners.delete(config.scope); bannerRequests.delete(config.scope);
    },
    conflict: () => loadManage('banners'),
  });

  const scopeOf = (current = route()) => current.view === 'board' ? current.board : current.view === 'tag' ? `tag:${current.id}` : '';
  const queryOf = (scope: string) => queries.get(scope) || '';
  const listKey = (scope: string) => `${scope}|${sort}|${queryOf(scope)}`;
  const listPath = (scope: string, page: number) => {
    const query = queryOf(scope);
    const where: Record<string, string> = scope.startsWith('tag:') ? { tag: scope.slice(4) } : scope ? { board: scope } : {};
    return `topics?${new URLSearchParams({ ...where, ...(query ? { q: query } : {}), sort, page: String(page) })}`;
  };
  const memberKey = (uid: string, tab: string) => `${uid}|${tab}`;
  function updateCachedProfile(updated: CommunityProfile) {
    const uid = updated.person.uid;
    if (!uid) return;
    memberProfileEpochs.set(uid, (memberProfileEpochs.get(uid) || 0) + 1);
    for (const [key, value] of memberPages) if (key.startsWith(`${uid}|`) && value.state === 'ready') {
      memberPages.set(key, { ...value, data: { ...value.data, person: updated.person, bio: updated.signature,
        background: updated.background.approved, cover: updated.cover ?? null, coverImage: updated.coverImage ?? null, coverName: updated.coverName ?? null } });
    }
  }
  function invalidateMemberProfile(uid: string | null | undefined) {
    if (!uid) return;
    memberProfileEpochs.set(uid, (memberProfileEpochs.get(uid) || 0) + 1);
    for (const key of memberPages.keys()) if (key.startsWith(`${uid}|`)) memberPages.delete(key);
    if (readyData(profile)?.person.uid === uid) { profile = null; profileRequest++; }
  }

  async function assignLoad<T>(path: string, current: CommunityLoad<T> | null | undefined, assign: (value: CommunityLoad<T>) => void) {
    const identity = frameIdentity;
    const value = await load<T>(path, current);
    if (identity === frameIdentity) assign(value);
  }
  async function loadSummary() { await assignLoad('summary', summary, value => { summary = value; }); }
  async function loadModerationContacts() { await assignLoad('moderation-contacts', moderationContacts, value => { moderationContacts = value; }); }
  async function loadConvention() { await assignLoad('convention', convention, value => { convention = value; }); }
  function loadFrameHighlights(scope: string): Promise<void> {
    const existing = frameHighlightsPending.get(scope);
    if (existing) return existing;
    const identity = frameIdentity;
    const params = new URLSearchParams({ ...(scope ? { board: scope } : {}), sort: 'active', page: '1' });
    const pending = load<CommunityListing>(`topics?${params}`, frameHighlights.get(scope)).then(value => {
      if (identity === frameIdentity) frameHighlights.set(scope, value);
    }).finally(() => { if (frameHighlightsPending.get(scope) === pending) frameHighlightsPending.delete(scope); });
    frameHighlightsPending.set(scope, pending);
    return pending;
  }
  const highlightsFor = (scope: string) => frameHighlights.get(scope) || lists.get(`${scope}|active|`) || loading;
  function loadBanners(scope: string): Promise<void> {
    const existing = bannerRequests.get(scope);
    if (existing) return existing;
    const identity = frameIdentity;
    const pending = load<CommunityBannerConfig>(`banners?scope=${enc(scope)}`, banners.get(scope)).then(value => {
      if (identity === frameIdentity && bannerRequests.get(scope) === pending) banners.set(scope, value);
    }).finally(() => { if (bannerRequests.get(scope) === pending) bannerRequests.delete(scope); });
    bannerRequests.set(scope, pending);
    return pending;
  }
  async function loadMe() {
    const identity = frameIdentity;
    await assignLoad('me', me, value => { me = value; });
    if (identity !== frameIdentity) return;
    const data = readyData(me);
    const key = data ? [data.name, data.uid, data.avatar, data.frame, data.color, JSON.stringify(data.nameEffect), data.level, JSON.stringify(data.growth), JSON.stringify(data.vipGrowth), data.steward, data.mod, JSON.stringify(data.management), data.balance, data.checkedIn, data.unread.all].join('|') : '';
    if (key !== headerKey) { headerKey = key; mounted?.ctx.headerChanged?.(); }
    syncConvention();
  }
  async function loadProfile() {
    const requestId = ++profileRequest;
    await assignLoad('profile', profile, value => { if (requestId === profileRequest && !profileWrite) profile = value; });
  }
  async function openProfile() {
    if (!mounted || switchingBrowseMode || communityReaderReadOnly(readyData(me))) return;
    const current = route(), viewer = readyData(me);
    if (!viewer?.uid || !['member', 'profile'].includes(current.view)) return;
    const uid = current.view === 'profile' ? viewer.uid : current.id;
    const tab = current.view === 'profile' ? 'topics' : current.tab;
    if (uid !== viewer.uid || !readyData(memberPages.get(memberKey(uid, tab)))?.self) return;
    if (viewer.convention && !viewer.convention.agreed) { syncConvention(); return; }
    if (current.view === 'profile') legacyProfileOpened = true;
    profileDialog.open(mounted.main.ownerDocument, mounted.ctx, loading);
    await loadProfile();
    profileDialog.render(profile || loading);
  }
  let checkinRequest = 0;
  async function loadCheckin() {
    const token = ++checkinRequest, month = checkinMonth;
    const value = await load<CommunityCheckin>(`checkin${month ? `?month=${month}` : ''}`, checkin);
    const current = token === checkinRequest && month === checkinMonth;
    if (current) checkin = value;
    return current;
  }
  async function loadBookmarks() { await assignLoad('bookmarks', bookmarks, value => { bookmarks = value; }); }
  async function loadShop() { await assignLoad('shop', shop, value => { shop = value; }); }
  async function loadShopMine() { await assignLoad('shop/mine', shopMine, value => { shopMine = value; }); }
  async function loadRank() { await assignLoad('rank', rank, value => { rank = value; }); }
  let stardustRequest = 0;
  async function loadStardust() {
    const token = ++stardustRequest, selected = flow;
    const value = await load<CommunityStardust>(`stardust${selected === 'all' ? '' : `?flow=${selected}`}`, stardusts.get(selected));
    const current = token === stardustRequest;
    if (current) stardusts.set(selected, value);
    return current;
  }
  async function loadMember(uid: string, tab: string) {
    const key = memberKey(uid, tab), epoch = memberProfileEpochs.get(uid) || 0;
    await assignLoad(`members/${enc(uid)}?tab=${enc(tab)}`, memberPages.get(key), value => {
      // Reads started before a confirmed profile/background change cannot put
      // its retired appearance back into another cached tab.
      if (epoch === (memberProfileEpochs.get(uid) || 0)) memberPages.set(key, value);
    });
  }
  async function loadInbox(tab: string) { await assignLoad(`inbox?tab=${enc(tab)}`, inboxes.get(tab), value => { inboxes.set(tab, value); }); }
  async function loadManage(tab: string) {
    const requestId = (manageRequests.get(tab) || 0) + 1;
    manageRequests.set(tab, requestId);
    await assignLoad(`manage?tab=${enc(tab)}`, manages.get(tab), value => {
      if (manageRequests.get(tab) !== requestId) return;
      manages.set(tab, value);
      const data = readyData(value);
      if (data && !data.owner && managementBoard && data.moderationBoards && !data.moderationBoards.includes(managementBoard) && route().view === 'manage' && route().tab === tab) { managementBoard = ''; reviewSelection.clear(); }
      if (data) for (const id of reviewSelection) if (!data.queue.topics.some(topic => topic.id === id && topic.pending)) reviewSelection.delete(id);
      if (tab === 'banners' && data) bannerEditor.sync(data.banners || []);
    });
  }
  // The latest request per list wins: a refresh that finishes after "load
  // more" must not replace the longer list with its first page.
  const listRequests = new Map<string, object>();
  const claim = (key: string) => { const token = {}; listRequests.set(key, token); return () => listRequests.get(key) === token; };
  async function loadList(scope: string) {
    const key = listKey(scope), current = claim(key);
    // Reuse the normal active list for the frame's supporting content.
    const suppliesHighlights = Boolean(mounted?.ctx.painted) && sort === 'active' && !queryOf(scope) && !scope.startsWith('tag:');
    try { const data = await api<CommunityListing>(listPath(scope, 1)); if (current()) lists.set(key, { state: 'ready', data }); }
    catch (error) { if (current()) lists.set(key, settle(lists.get(key), error)); }
    if (current() && suppliesHighlights) frameHighlights.set(scope, lists.get(key)!);
  }
  async function loadThread(id: string) { await assignLoad(`topics/${enc(id)}`, threads.get(id), value => { threads.set(id, value); }); }
  const members = (ctx = mounted?.ctx) => {
    const viewer = readyData(me);
    if (communityReaderReadOnly(viewer)) return viewer?.management?.role === 'owner' && viewer.vip === true;
    return Boolean(ctx?.members || viewer?.vip || viewer?.owner || (viewer?.mod && viewer.moderationBoards?.includes('vip')));
  };
  function loadsFor(current: CommunityRoute): Array<() => Promise<void>> {
    const page = ((): Array<() => Promise<void>> => {
      switch (current.view) {
        case 'home': return [loadSummary, () => loadList('')];
        case 'boards': return [loadSummary];
        case 'board': return current.board === 'vip' && !members() ? [loadSummary] : [loadSummary, () => loadList(current.board)];
        case 'tag': return [() => loadList(`tag:${current.id}`)];
        case 'post': case 'edit': return [() => loadThread(current.id)];
        case 'checkin': return [async () => { await loadCheckin(); }];
        case 'bookmarks': return [loadBookmarks];
        case 'manage': return [() => loadManage(['contact', 'convention'].includes(current.tab) ? 'queue' : current.tab), ...(current.tab === 'convention' ? [loadConvention] : [])];
        case 'rules': return [loadModerationContacts, loadConvention];
        case 'member': return [() => loadMember(current.id, current.tab)];
        case 'profile': return [loadProfile];
        case 'stardust': return [async () => { await loadStardust(); }];
        case 'inbox': return [() => loadInbox(current.tab)];
        case 'shop': return [current.tab === 'mine' ? loadShopMine : loadShop];
        case 'rank': return [loadRank];
        default: return [];
      }
    })();
    const sharedFrame = Boolean(mounted?.ctx.painted);
    const highlightScope = current.view === 'board' ? current.board : '';
    const canLoadHighlights = current.view === 'home' || current.view === 'board' && (current.board !== 'vip' || members());
    const loadsHighlightList = canLoadHighlights && sort === 'active' && !queryOf(highlightScope);
    const needsHighlights = sharedFrame && ['home', 'board'].includes(current.view)
      && canLoadHighlights && highlightsFor(highlightScope).state !== 'ready' && !loadsHighlightList;
    return current.view === 'unknown' || current.view === 'landing' ? page : [...page,
      ...(sharedFrame && !summary && !page.includes(loadSummary) ? [loadSummary] : []),
      ...(needsHighlights ? [() => loadFrameHighlights(highlightScope)] : []),
      ...(sharedFrame && canLoadHighlights ? [() => loadBanners(highlightScope || 'home')] : []), loadMe];
  }
  async function refresh(current = route()) {
    const hash = location.hash, identity = frameIdentity;
    if (current.view === 'board' && current.board === 'vip' && !readyData(me)) {
      await loadMe();
      if (location.hash !== hash || identity !== frameIdentity) return;
    }
    await Promise.all(loadsFor(current).map(run => run()));
    if (current.view === 'profile' && location.hash === hash && identity === frameIdentity) {
      const uid = readyData(me)?.uid || readyData(profile)?.person.uid;
      if (uid) await loadMember(uid, 'topics');
    }
    if (location.hash === hash && identity === frameIdentity) await recordActiveVisit();
    if (location.hash === hash && identity === frameIdentity) paint();
  }
  // Reloads what the current page shows, then repaints.
  async function reload(...extra: Array<() => Promise<void>>) {
    const identity = frameIdentity;
    await Promise.all([...loadsFor(route()), ...extra].map(run => run()));
    if (identity === frameIdentity) paint();
  }

  // Compose images belong to one page: a new post starts empty, editing starts with the post's images.
  function composeUploads(current: CommunityRoute, thread: CommunityThread | null) {
    const key = `${current.view}:${current.id || current.board}`;
    if (uploadsFor === key) return uploads;
    if (current.view === 'edit' && !thread) return [];
    uploadsFor = key;
    uploads = current.view === 'edit' && thread ? (thread.topic.images || []).map(image => ({ id: image.id, name: '', state: 'ready' as const })) : [];
    return uploads;
  }

  function draftComposeValues(current: CommunityRoute): SavedComposeDraft | null {
    if (current.view !== 'new') return null;
    const saved = readDraft<SavedComposeDraft>(draftKey('compose', location.hash));
    return saved && typeof saved === 'object' ? saved : null;
  }

  // The page for the current route, from what is cached; null outside the pages this module owns.
  function pageHTML(ctx: CommunityContext) {
    const identity = readyData(me);
    const canPostMembers = !communityReaderReadOnly(identity) && Boolean(ctx.members || identity?.vip || identity?.owner);
    ctx = { ...ctx, members: members(ctx) };
    const current = route();
    const common = { t: ctx.t, esc: ctx.esc, icons: ctx.icons, ownerAvatar: ctx.ownerAvatar ?? null, showTopicCovers: ctx.simpleCompose, meForSort: identity };
    const viewer = readyData(me);
    const savedCompose = draftComposeValues(current);
    if (!ctx.simpleCompose && current.view === 'new' && composeBoard === null && !current.board && savedCompose?.board) composeBoard = savedCompose.board;
    switch (current.view) {
      case 'home': return communityHomeHTML({ ...common, summary: summary || loading, list: lists.get(listKey('')) || loading, sort, query: queryOf(''), members: ctx.members, me, showCompose: ctx.showHomeCompose });
      case 'boards': return communityBoardsHTML({ ...common, summary: summary || loading, members: ctx.members });
      case 'board': return communityBoardHTML({ ...common, board: current.board, summary: summary || loading, list: lists.get(listKey(current.board)) || loading, sort, query: queryOf(current.board), members: ctx.members, me: viewer, showPostingTips: ctx.showPostingTips, showActiveMembers: ctx.showActiveMembers });
      case 'tag': return communityTagHTML({ ...common, tag: current.id, list: lists.get(listKey(`tag:${current.id}`)) || loading, sort, query: queryOf(`tag:${current.id}`), me: viewer });
      case 'new': return communityComposeHTML({ ...common, board: ctx.simpleCompose ? current.board : composeBoard ?? current.board, members: canPostMembers, me: viewer, uploads: composeUploads(current, null), simple: ctx.simpleCompose });
      case 'edit': {
        const thread = threads.get(current.id);
        const asEdit = (markup: string) => markup.replace('data-community="post"', 'data-community="edit"');
        if (switchingBrowseMode) return asEdit(communityPostHTML({ ...common, thread: loading }));
        if (thread?.state !== 'ready') return asEdit(communityPostHTML({ ...common, thread: thread || loading }));
        if (!thread.data.topic.canEdit) return asEdit(communityPostHTML({ ...common, thread: { state: 'error', status: 403, message: ctx.t('这个帖子已经过了可以编辑的时间，或者不是你发的。', 'This post can no longer be edited, or is not yours.') } }));
        return communityComposeHTML({ ...common, board: thread.data.topic.board, members: ctx.members, me: viewer, uploads: composeUploads(current, thread.data), editing: editingFrom(thread), simple: ctx.simpleCompose });
      }
      case 'post': return communityPostHTML({ ...common, thread: threads.get(current.id) || loading, me: viewer, reporting, editingReply, menuOpen: postMenu, deleting, moving, retagging, quoting, replySort });
      case 'checkin': return communityCheckinHTML({ ...common, checkin: checkin || loading, me: viewer });
      case 'bookmarks': return communityBookmarksHTML({ ...common, list: bookmarks || loading });
      case 'manage': return communityManageHTML({ ...common, manage: manages.get(['contact', 'convention'].includes(current.tab) ? 'queue' : current.tab) || loading, tab: current.tab, itemEditing, shippingOrder, rejecting, deleting, me: viewer, selectedReviews: [...reviewSelection], managementBoard, stewardCandidate, stewardEditingUid, bannerEditor: bannerEditor.state(), convention });
      case 'member': return communityMemberHTML({ ...common, member: memberPages.get(memberKey(current.id, current.tab)) || loading, me: viewer, muting, badgeSelection: badgeExplorer.state() });
      case 'profile': return communityMemberHTML({ ...common, member: memberPages.get(memberKey(viewer?.uid || readyData(profile)?.person.uid || '', 'topics')) || loading, me: viewer });
      case 'stardust': return communityStardustHTML({ ...common, stardust: stardusts.get(flow) || loading, tab: current.tab, levelSelection: levelExplorer.state() });
      case 'inbox': return communityInboxHTML({ ...common, inbox: inboxes.get(current.tab) || loading, tab: current.tab, me: viewer });
      case 'shop': return current.tab === 'mine'
        ? communityShopMineHTML({ ...common, mine: shopMine || loading, me: viewer, delivery })
        : communityShopHTML({ ...common, shop: shop || loading, tab: current.tab, me: viewer, redeeming, delivery });
      case 'rank': return communityRankHTML({ ...common, rank: rank || loading, me: viewer });
      case 'rules': return communityRulesHTML({ ...common, me: viewer, contacts: moderationContacts || loading, convention: convention || loading });
      default: return null;
    }
  }
  function html(ctx: CommunityContext) {
    return pageHTML(ctx);
  }

  function renderedPage(): HTMLElement | null {
    if (!mounted) return null;
    const markup = html(mounted.ctx);
    if (markup === null) return null;
    const template = document.createElement('template');
    template.innerHTML = markup;
    return template.content.firstElementChild as HTMLElement | null;
  }

  // Sorting/searching must not collapse a long list while its replacement loads.
  // The controls and surrounding page remain the same DOM nodes.
  function listBusy(on: boolean) {
    const results = mounted?.main.querySelector('.community-results');
    if (on) results?.setAttribute('aria-busy', 'true');
    else results?.removeAttribute('aria-busy');
    mounted?.main.querySelectorAll<HTMLElement>('[data-action="community-sort"]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.sort === sort));
    });
  }
  function paintList(append = false) {
    const results = mounted?.main.querySelector('.community-results');
    const next = renderedPage()?.querySelector('.community-results');
    if (!results || !next) return;
    const restoreView = mounted?.ctx.beforePaint?.();
    const section = results.closest<HTMLElement>('[data-community]');
    const documentPosition = !restoreView && section ? preserveDocumentReading(section) : null;
    mounted?.main.classList.remove('community-entering');
    if (append) {
      const rows = results.querySelector('.community-topics');
      const incoming = next.querySelector('.community-topics');
      if (rows && incoming) {
        const href = (row: Element) => row.querySelector('.community-topic-replies')?.getAttribute('href');
        const known = new Set([...rows.children].map(href));
        for (const row of [...incoming.children]) if (!known.has(href(row))) rows.append(row);
        // Keep the existing list attached: moving it through a fragment would
        // invalidate the browser's scroll anchor despite retaining its children.
        for (const child of [...results.children]) if (child !== rows) child.remove();
        for (const child of [...next.children]) {
          if (child === incoming) continue;
          if (child.classList.contains('community-search-summary')) rows.before(child);
          else results.append(child);
        }
      } else results.replaceChildren(...next.childNodes);
    } else results.replaceChildren(...next.childNodes);
    listBusy(false);
    mounted?.ctx.painted?.();
    restoreView?.();
    if (documentPosition && section) restoreDocumentReading(section, documentPosition);
  }
  let listChange = 0;
  async function changeList() {
    const change = ++listChange;
    const scope = scopeOf(), key = listKey(scope), hash = location.hash;
    const section = mounted?.main.querySelector('[data-community]');
    listBusy(true);
    await loadList(scope);
    if (change === listChange && location.hash === hash && listKey(scopeOf()) === key && mounted?.main.querySelector('[data-community]') === section) paintList();
  }
  function sortReplies() {
    const rows = mounted?.main.querySelector('.community-replies');
    const next = renderedPage()?.querySelector('.community-replies');
    if (rows && next) {
      const existing = new Map([...rows.children].map(row => [row.id, row]));
      [...next.children].forEach((row, index) => {
        const current = existing.get(row.id);
        if (current && rows.children[index] !== current) rows.insertBefore(current, rows.children[index] || null);
      });
    }
    mounted?.main.querySelectorAll<HTMLElement>('[data-action="community-reply-sort"]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.sort === replySort));
    });
  }

  // Structural panels still repaint, retaining fields, previews and focus.
  function mountComposeEditor() {
    if (!mounted) return;
    for (const [root, editor] of editors) if (!root.isConnected) { editor.destroy(); editors.delete(root); }
    const roots = [...mounted.main.querySelectorAll<HTMLElement>('[data-inline-editor]')].filter(root => !editors.has(root));
    if (!roots.length) return;
    composeEditorModule ||= import('./community-compose-editor.mjs');
    void composeEditorModule.then(module => {
      for (const root of roots) {
        if (!root.isConnected || !mounted || editors.has(root)) continue;
        const hadFocus = root.contains(document.activeElement);
        const editor = module.mountCommunityComposeEditor(root, { request, prepare: async file => file, t: mounted.ctx.t, owner: () => Boolean(readyData(me)?.owner) });
        editors.set(root, editor);
        const button = root.querySelector<HTMLButtonElement>('[data-action="community-md-preview"]');
        if (button?.getAttribute('aria-pressed') === 'true') editor.preview(true);
        else if (hadFocus) editor.focus();
      }
    }).catch(() => {
      composeEditorModule = null;
      for (const root of roots) {
        const line = root.querySelector('.community-editor-upload-status');
        if (root.isConnected && line) line.textContent = tr('图片编辑器未能加载，请刷新后重试。文字内容仍然保留。', 'The image editor could not load. Refresh to retry; your text is retained.');
      }
    });
  }

  function releaseDocumentReading() {
    if (documentReadingFrame !== null) window.cancelAnimationFrame?.(documentReadingFrame);
    documentReadingFrame = null;
    const reading = documentReading;
    documentReading = null;
    if (reading) reading.node.style.minHeight = reading.minHeight;
  }
  function preserveDocumentReading(section: HTMLElement) {
    if (documentReading?.hash !== location.hash) releaseDocumentReading();
    if (documentReadingFrame !== null) window.cancelAnimationFrame?.(documentReadingFrame);
    documentReadingFrame = null;
    const rect = section.getBoundingClientRect();
    if (!documentReading) documentReading = {
      hash: location.hash, node: section, minHeight: section.style.minHeight, height: rect.height,
      left: window.scrollX, top: window.scrollY,
    };
    const reading = documentReading;
    // A scroll event can be queued behind this interaction. Read the live
    // viewport before mutating it so the user's latest position still wins.
    reading.left = window.scrollX; reading.top = window.scrollY;
    const pageTop = rect.top + window.scrollY;
    reading.height = Math.max(reading.height, rect.height, reading.top > 0 ? reading.top + window.innerHeight - pageTop : 0);
    section.style.minHeight = `${Math.ceil(reading.height)}px`;
    return reading;
  }
  function restoreDocumentReading(next: HTMLElement, reading: NonNullable<typeof documentReading>) {
    if (documentReading !== reading || reading.hash !== location.hash) return;
    const restore = () => {
      if (window.scrollX !== reading.left || window.scrollY !== reading.top) window.scrollTo({ left: reading.left, top: reading.top, behavior: 'instant' });
    };
    restore();
    if (next.querySelector('[aria-busy="true"]')) return;
    const finish = () => {
      if (documentReading !== reading || reading.hash !== location.hash) return;
      // The last input may precede its scroll event; capture it while the
      // guard still supports the viewport, before removing temporary height.
      reading.left = window.scrollX; reading.top = window.scrollY;
      // Final short content settles at its nearest valid position. The old
      // height is only a loading guard, never permanent empty page padding.
      releaseDocumentReading();
      restore();
    };
    if (window.requestAnimationFrame) documentReadingFrame = window.requestAnimationFrame(finish);
    else finish();
  }
  function onDocumentReadingScroll() {
    if (!documentReading || documentReading.hash !== location.hash) return;
    if (window.scrollX === documentReading.left && window.scrollY === documentReading.top) return;
    documentReading.left = window.scrollX; documentReading.top = window.scrollY;
  }

  function paint() {
    if (!mounted) return;
    const section = mounted.main.querySelector<HTMLElement>('[data-community]');
    const markup = html(mounted.ctx);
    if (!section || markup === null) return;
    const restoreView = mounted.ctx.beforePaint?.();
    const documentPosition = restoreView ? null : preserveDocumentReading(section);
    const template = document.createElement('template');
    template.innerHTML = markup;
    const next = template.content.firstElementChild as HTMLElement;
    const currentAccount = draftIdentity();
    const sameAccount = currentAccount !== null && paintedAccount === currentAccount;
    for (const field of sameAccount ? section.querySelectorAll<Field>('input[name], textarea[name], select[name]') : []) {
      const sourceForm = field.closest('form');
      const form = sourceForm?.dataset.communityForm;
      // Banner values are keyed by scope and item in the controller. Copying
      // the previous form would undo cancel, reordering or a scope change.
      if (form === 'banners' || form === 'banner-search') continue;
      const uidSelector = sourceForm?.dataset.uid ? `[data-uid=${quoted(sourceForm.dataset.uid)}]` : '';
      const choice = field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox');
      const twin = [...next.querySelectorAll<Field>(`form[data-community-form="${form}"]${uidSelector} [name="${field.name}"]`)]
        .find(item => !choice || item.value === field.value);
      if (!twin) continue;
      if (twin instanceof HTMLInputElement && twin.type === 'file') {
        // Browsers prohibit assigning FileList. Keep the real selected input
        // across ordinary same-account paints instead of losing its upload.
        if (form?.startsWith('profile-') && field instanceof HTMLInputElement && field.files?.length) twin.replaceWith(field);
        continue;
      }
      if (choice) (twin as HTMLInputElement).checked = (field as HTMLInputElement).checked;
      else twin.value = field.value;
    }
    const previews = [...section.querySelectorAll<HTMLElement>('[data-action="community-md-preview"][aria-pressed="true"]')].map(button => button.dataset.for || '');
    const extras = next.querySelector<HTMLDetailsElement>('[data-compose-extras]');
    if (extras) extras.open = Boolean(section.querySelector<HTMLDetailsElement>('[data-compose-extras]')?.open);
    for (const description of section.querySelectorAll<HTMLDetailsElement>('[data-shop-description][open]')) {
      const twin = next.querySelector<HTMLDetailsElement>(`[data-shop-description=${quoted(description.dataset.shopDescription || '')}]`);
      if (twin) twin.open = true;
    }
    const categoryManager = next.querySelector<HTMLDetailsElement>('[data-management-categories]');
    if (categoryManager) categoryManager.open = Boolean(section.querySelector<HTMLDetailsElement>('[data-management-categories]')?.open);
    const previousItemForm = section.querySelector<Form>('form[data-community-form="item"]');
    const nextItemForm = next.querySelector<Form>('form[data-community-form="item"]');
    const preserveItemOperation = previousItemForm?.dataset.uploading === 'true' && nextItemForm && previousItemForm.dataset.id === nextItemForm.dataset.id;
    if (previousItemForm && nextItemForm && previousItemForm.dataset.id === nextItemForm.dataset.id) {
      const sample = !preserveItemOperation && previousItemForm.querySelector('[data-item-wear-sample]');
      if (sample) nextItemForm.querySelector('[data-item-wear-sample]')?.replaceWith(sample);
      if (previousItemForm.dataset.frameReady) nextItemForm.dataset.frameReady = previousItemForm.dataset.frameReady;
    }
    const active = document.activeElement as HTMLInputElement | null;
    const caret = active && 'selectionStart' in active && active.selectionStart !== null ? [active.selectionStart, active.selectionEnd ?? active.selectionStart] as const : null;
    const focusSource = active?.closest('.community-select-menu') ? section.querySelector<HTMLElement>('.community-select-trigger[data-state="open"]')
      : active && section.contains(active) ? active : null;
    const data = focusSource?.dataset;
    const focusSelector = focusSource
      ? focusSource.id ? `[id=${quoted(focusSource.id)}]`
        : data?.action ? `[data-action=${quoted(data.action)}]${data.sort ? `[data-sort=${quoted(data.sort)}]` : ''}${data.kind ? `[data-kind=${quoted(data.kind)}]` : ''}${data.id ? `[data-id=${quoted(data.id)}]` : ''}${data.value ? `[data-value=${quoted(data.value)}]` : ''}${data.board !== undefined ? `[data-board=${quoted(data.board)}]` : ''}${data.uid ? `[data-uid=${quoted(data.uid)}]` : ''}${data.index !== undefined ? `[data-index=${quoted(data.index)}]` : ''}${data.scope ? `[data-scope=${quoted(data.scope)}]` : ''}` : ''
      : '';
    const images = new Map<string, HTMLImageElement[]>();
    for (const image of section.querySelectorAll<HTMLImageElement>('img[src]')) {
      const key = `${image.getAttribute('src')}|${image.className}`;
      const group = images.get(key) || []; group.push(image); images.set(key, group);
    }
    for (const image of next.querySelectorAll<HTMLImageElement>('img[src]')) {
      const previous = images.get(`${image.getAttribute('src')}|${image.className}`)?.shift();
      if (previous) { previous.alt = image.alt; image.replaceWith(previous); }
    }
    const fieldScroll = new Map([...section.querySelectorAll<HTMLElement>('textarea[id]')].map(field => [field.id, field.scrollTop]));
    for (const editor of editors.values()) {
      if (!sameAccount) continue;
      if (!section.contains(editor.root)) continue;
      const nextEditor = next.querySelector<HTMLTextAreaElement>(`[id=${quoted(editor.field.id)}]`)?.closest<HTMLElement>('[data-inline-editor]');
      if (!nextEditor || nextEditor.closest('form')?.dataset.id !== editor.field.form?.dataset.id) continue;
      editor.root.dataset.imageMax = nextEditor.dataset.imageMax;
      nextEditor.replaceWith(editor.root);
    }
    mounted.main.classList.remove('community-entering');
    // An in-flight asset operation owns its form and lock until it completes;
    // a structural repaint must not unlock a twin or discard the response.
    if (preserveItemOperation && previousItemForm) nextItemForm?.replaceWith(previousItemForm);
    if (documentPosition) {
      documentPosition.node = next; documentPosition.minHeight = next.style.minHeight;
      next.style.minHeight = `${Math.ceil(documentPosition.height)}px`;
    }
    section.replaceWith(next);
    paintedAccount = currentAccount;
    for (const field of next.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[name], textarea[name]')) { count(field); autosize(field); }
    for (const id of previews) { const button = next.querySelector<HTMLButtonElement>(`[data-action="community-md-preview"][data-for=${quoted(id)}]`); if (button) togglePreview(button, true); }
    const current = route();
    if (current.view === 'new' && !next.querySelector('form[data-edit]')) {
      const draft = draftComposeValues(current);
      if (draft) {
        const form = next.querySelector<Form>('form[data-community-form="topic"]');
        if (form) {
          const set = (name: string, value: string) => { const field = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null; if (field) field.value = value; };
          set('title', draft.title || ''); set('body', draft.body || '');
          for (const tag of form.querySelectorAll<HTMLInputElement>('input[name="tags"]')) tag.checked = draft.tags.includes(tag.value);
          const bounty = form.querySelector<HTMLInputElement>(`input[name="bounty"][value="${draft.bounty || 0}"]`); if (bounty && !bounty.disabled) bounty.checked = true;
        }
      }
    } else if (current.view === 'post') {
      const draft = readDraft<{ body: string }>(draftKey('reply', current.id));
      const field = next.querySelector<HTMLTextAreaElement>('form[data-community-form="reply"] textarea[name="body"]');
      if (draft && field && draft.body) field.value = draft.body;
    }
    syncForms(next);
    mountSelects();
    syncManagementDialog();
    profileDialog.render(profile || loading);
    for (const field of next.querySelectorAll<HTMLTextAreaElement>('textarea')) autosize(field);
    const focused = focusSelector ? next.querySelector<HTMLInputElement>(focusSelector) : null;
    focused?.focus({ preventScroll: true });
    if (focused && caret) try { focused.setSelectionRange(...caret); } catch { /* not a text field */ }
    for (const field of next.querySelectorAll<HTMLElement>('textarea[id]')) field.scrollTop = fieldScroll.get(field.id) || 0;
    mounted?.ctx.painted?.();
    restoreView?.();
    if (documentPosition) restoreDocumentReading(next, documentPosition);
    const itemForm = next.querySelector<Form>('form[data-community-form="item"]');
    if (itemForm) updateProductPreview(itemForm, valueOf(itemForm, 'image'));
    syncConvention();
    mountComposeEditor();
  }

  function mountSelects() {
    for (const [select, control] of selects) {
      if (!select.isConnected) { control.dispose(); selects.delete(select); }
    }
    if (!mounted?.ctx.mountSelect) return;
    for (const select of mounted.main.querySelectorAll<HTMLSelectElement>('select.community-select')) {
      if (!selects.has(select)) selects.set(select, mounted.ctx.mountSelect(select, mounted.ctx.icons));
      else selects.get(select)?.update();
    }
  }

  function count(field: HTMLInputElement | HTMLTextAreaElement) {
    const output = field.form?.querySelector(`[data-count-for="${field.name}"]`);
    const content = field.name === 'body' ? bodyImageContent(field.value).text : field.value;
    if (output && field.maxLength > 0) output.textContent = `${[...content].length} / ${field.maxLength}`;
  }
  function autosize(field: HTMLInputElement | HTMLTextAreaElement) {
    if (field instanceof HTMLTextAreaElement) autosizeCommunityTextarea(field);
  }
  // Form parts that follow other fields: the unlock price row and the list preview while composing.
  function syncForms(root: ParentNode) {
    syncStewardTools(root);
    syncReviewTools(root);
    const item = root.querySelector<Form>('form[data-community-form="item"]');
    if (item) syncItemForm(item);
    const form = root.querySelector<Form>('form[data-community-form="topic"]');
    if (!form || !mounted) return;
    const mode = (form.querySelector('input[name="promptMode"]:checked') as HTMLInputElement | null)?.value;
    const row = form.querySelector<HTMLElement>('[data-price-row]');
    if (row) row.hidden = mode !== 'paid';
    const price = form.elements.namedItem('promptPrice') as HTMLInputElement | null;
    if (price) { price.disabled = mode !== 'paid'; price.required = mode === 'paid'; }
    const preview = mounted.main.querySelector<HTMLElement>('[data-compose-preview]');
    if (preview) {
      const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value || '';
      const board = checkedOf(form, 'board');
      preview.innerHTML = composePreviewHTML({
        board, title: value('title'), body: value('body'),
        tags: [...form.querySelectorAll<HTMLInputElement>('input[name="tags"]:checked')].map(box => box.value),
        images: uploads.filter(upload => upload.id).map(upload => upload.id!),
        bounty: Number((form.querySelector('input[name="bounty"]:checked') as HTMLInputElement | null)?.value || 0),
      }, readyData(me), { t: mounted.ctx.t, esc: mounted.ctx.esc, icons: mounted.ctx.icons, ownerAvatar: mounted.ctx.ownerAvatar ?? null });
    }
  }
  function togglePreview(button: HTMLButtonElement, on = button.getAttribute('aria-pressed') !== 'true') {
    const id = button.dataset.for || '';
    const root = button.closest('.community-editor');
    const field = root?.querySelector<HTMLTextAreaElement>(`[id=${quoted(id)}]`);
    const preview = root?.querySelector<HTMLElement>(`[data-preview-for=${quoted(id)}]`);
    if (!field || !preview || !mounted) return;
    button.setAttribute('aria-pressed', String(on));
    root?.querySelectorAll<HTMLButtonElement>('[data-action="community-md"]').forEach(tool => { tool.disabled = on; });
    if (on) {
      const thread = readyData(threads.get(route().id));
      preview.innerHTML = communityBodyHTML(field.value, mounted.ctx.esc, thread?.mentions || {}, root?.hasAttribute('data-inline-editor') ? bodyImageContent(field.value).images : []) || `<p class="community-muted">${tr('还没有内容。', 'Nothing yet.')}</p>`;
    }
    preview.hidden = !on;
    field.hidden = on;
    const editor = editorFor(field);
    if (editor) editor.preview(on); else if (!on) autosize(field);
  }
  function status(form: Form, text: string) {
    const line = form.querySelector('.community-form-status');
    if (line) line.textContent = text;
  }
  function invalid(form: Form, field: Element | null, text: string) {
    status(form, text);
    form.querySelectorAll('[aria-invalid]').forEach(item => item.removeAttribute('aria-invalid'));
    field?.setAttribute('aria-invalid', 'true');
    const details = field?.closest('details');
    if (details) details.open = true;
    const editor = editorFor(field);
    if (editor) editor.focus();
    else (field as HTMLElement | null)?.focus({ preventScroll: true });
    return false;
  }
  const fieldOf = (form: Form, name: string) => form.elements.namedItem(name) as HTMLInputElement | null;
  const valueOf = (form: Form, name: string) => fieldOf(form, name)?.value || '';
  const checkedOf = (form: Form, name: string) => {
    if (name === 'board' && mounted?.ctx.simpleCompose) {
      const current = route();
      return current.view === 'edit' ? readyData(threads.get(current.id))?.topic.board || '' : current.board || '';
    }
    return (form.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement | null)?.value || '';
  };
  function checkText(form: Form, name: string, [min, max]: readonly [number, number], label: [string, string]) {
    const field = fieldOf(form, name);
    const value = field?.value || '';
    const size = length(name === 'body' ? bodyImageContent(value).text : value);
    if (size < min) return invalid(form, field, tr(`${label[0]}至少 ${min} 个字。`, `${label[1]} needs at least ${min} characters.`));
    if (size > max) return invalid(form, field, tr(`${label[0]}最多 ${max} 个字。`, `${label[1]} can be at most ${max} characters.`));
    return true;
  }
  function imagesReady(form: Form) {
    const editor = editorFor(form.querySelector('textarea[name="body"]'));
    if (editor?.state().pending) { status(form, tr('图片还在上传，请稍等。', 'Images are still uploading.')); return false; }
    if (editor?.state().failed) { status(form, tr('有图片上传失败，请移除后重新粘贴。', 'An image failed to upload. Remove it and paste it again.')); return false; }
    return true;
  }
  function focusBody(id: string) {
    const field = mounted?.main.querySelector<HTMLTextAreaElement>(`[id=${quoted(id)}]`);
    const editor = editorFor(field || null);
    if (editor) editor.focus(); else field?.focus({ preventScroll: true });
  }
  async function busy(form: Form, text: string, work: () => Promise<void>) {
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const label = button?.innerHTML || '';
    form.querySelectorAll('[aria-invalid]').forEach(item => item.removeAttribute('aria-invalid'));
    if (button) { button.disabled = true; button.textContent = text; }
    status(form, '');
    try { await work(); }
    catch (error) {
      status(form, message(error));
      if ((error as ApiError).status === 428) void loadMe();
    }
    finally { if (button?.isConnected) { button.disabled = false; button.innerHTML = label; } }
  }
  function otherProfileImageDraft(form: Form) {
    return [...(profileDialog.root()?.querySelectorAll<HTMLInputElement>('input[type="file"]') || [])].some(field => field.closest('form') !== form && Boolean(field.files?.length));
  }
  function lockProfileControls(disabled: boolean) {
    profileDialog.root()?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button').forEach(field => { field.disabled = disabled; });
  }
  async function submitProfile(form: Form, kind: 'signature' | 'avatar' | 'background') {
    if (profileWrite || !readyData(profile)?.canEditProfile) return;
    if (otherProfileImageDraft(form)) return status(form, tr('请先提交另一项已选择的图片，或取消选择。', 'Submit the other selected image first, or clear that selection.'));
    if (kind === 'signature' && !checkText(form, 'signature', [0, 100], ['个签', 'Signature'])) return;
    let body: FormData | undefined;
    if (kind === 'avatar' || kind === 'background') {
      const file = profileDialog.file(kind);
      if (!file) return status(form, tr('请先选择图片并确认裁剪。', 'Choose an image and confirm the crop first.'));
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return status(form, tr('请选择 JPG、PNG 或 WebP 图片。', 'Choose JPG, PNG or WebP.'));
      if (file.size > 2 * 1024 * 1024) return status(form, tr('图片不能超过 2MB。', 'Image cannot exceed 2MB.'));
      body = new FormData(); body.append('file', file);
    }
    const identity = frameIdentity, token = {};
    let saved = false;
    profileRequest++;
    profileWrite = token;
    lockProfileControls(true);
    const currentHash = location.hash;
    await busy(form, tr('正在保存…', 'Saving…'), async () => {
      let updated: CommunityProfile;
      if (body) updated = await api<CommunityProfile>(`profile/${kind}`, { method: 'POST', headers: { 'X-Reader-Request': '1' }, body });
      else updated = await send<CommunityProfile>('profile', { signature: valueOf(form, 'signature') });
      if (identity !== frameIdentity || profileWrite !== token) return;
      profile = { state: 'ready', data: updated };
      updateCachedProfile(updated);
      saved = true;
      // Mark confirmed controls clean before repaint; unrelated form drafts are retained.
      form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(field => {
        if (field instanceof HTMLInputElement && field.type === 'file') field.value = ''; else field.defaultValue = field.value;
      });
      await loadMe();
      if (identity !== frameIdentity || currentHash !== location.hash) return;
      const current = route();
      if (current.view === 'member') await loadMember(current.id, current.tab);
      else if (current.view === 'profile' && updated.person.uid) await loadMember(updated.person.uid, 'topics');
      if (identity !== frameIdentity || currentHash !== location.hash) return;
      notify(tr('已提交，审核通过后生效。', 'Submitted; changes appear after approval.'));
    });
    if (profileWrite === token) {
      profileWrite = null;
      if (identity === frameIdentity && currentHash === location.hash) {
        const feedback = form.querySelector('.community-form-status')?.textContent || '';
        lockProfileControls(false);
        if (saved) paint();
        else profileDialog.render(profile || loading);
        const next = profileDialog.root()?.querySelector<Form>(`[data-community-form="profile-${kind}"]`);
        if (next && feedback) status(next, feedback);
      }
    }
  }
  async function removeProfile(target: HTMLButtonElement, kind: string | undefined) {
    if (profileWrite || !readyData(profile)?.canEditProfile || !['avatar', 'background'].includes(kind || '')) return;
    const form = target.closest<Form>('form');
    if (!form) return;
    if (otherProfileImageDraft(form)) return status(form, tr('请先提交另一项已选择的图片，或取消选择。', 'Submit the other selected image first, or clear that selection.'));
    const identity = frameIdentity, token = {}, hash = location.hash;
    let saved = false;
    profileRequest++;
    profileWrite = token;
    lockProfileControls(true);
    await act(target, async () => {
      const updated = await send<CommunityProfile>(`profile/${kind}/remove`);
      if (identity !== frameIdentity || profileWrite !== token) return;
      profile = { state: 'ready', data: updated }; saved = true;
      updateCachedProfile(updated);
      const file = form.querySelector<HTMLInputElement>('[type="file"]');
      if (file) file.value = '';
      await loadMe();
      if (identity === frameIdentity && hash === location.hash) {
        const current = route();
        if (current.view === 'member') await loadMember(current.id, current.tab);
        else if (current.view === 'profile' && updated.person.uid) await loadMember(updated.person.uid, 'topics');
      }
      if (identity === frameIdentity && hash === location.hash) notify(tr('已恢复默认。', 'Default restored.'));
    });
    if (profileWrite === token) { profileWrite = null; if (identity === frameIdentity && hash === location.hash) { lockProfileControls(false); if (saved) paint(); else profileDialog.render(profile || loading); } }
  }
  const profileReviewWrites = new Set<string>();
  async function reviewProfile(target: HTMLButtonElement) {
    const { id, decision } = target.dataset;
    if (!id || !['approve', 'reject'].includes(decision || '') || profileReviewWrites.has(id)) return;
    profileReviewWrites.add(id);
    const controls = [...(target.closest('[data-profile-review]')?.querySelectorAll<HTMLButtonElement>('button') || [])];
    controls.forEach(button => { button.disabled = true; });
    const identity = frameIdentity;
    try {
      await act(target, async () => {
        try {
          await send(`manage/profiles/${enc(id)}/${decision}`);
          if (identity === frameIdentity) notify(tr('审核已处理。', 'Review processed.'));
        } finally {
          if (identity === frameIdentity) { await loadManage('profiles'); paint(); }
        }
      });
    } finally { profileReviewWrites.delete(id); controls.forEach(button => { if (button.isConnected) button.disabled = false; }); }
  }
  async function reviewBackground(form: Form, event: Event) {
    const submitter = (event as SubmitEvent).submitter;
    const decision = submitter instanceof HTMLButtonElement ? submitter.value : '';
    if (!['approve', 'reject'].includes(decision)) return;
    const key = `background:${form.dataset.uid}:${form.dataset.image}`;
    if (profileReviewWrites.has(key)) return;
    const reason = valueOf(form, 'reason').trim();
    if (decision === 'reject' && !reason) return invalid(form, fieldOf(form, 'reason'), tr('请填写驳回理由。', 'Give a rejection reason.'));
    const identity = frameIdentity;
    const controls = [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')];
    profileReviewWrites.add(key); controls.forEach(field => { field.disabled = true; });
    try {
      await busy(form, tr('正在处理…', 'Processing…'), async () => {
        try { await send('manage/profile-background', { memberUid: form.dataset.uid, imageId: form.dataset.image, approve: decision === 'approve', reason }); }
        catch (error) { if (identity === frameIdentity) notify(message(error)); }
        finally { if (identity === frameIdentity) { await loadManage('profiles'); paint(); } }
      });
    } finally { profileReviewWrites.delete(key); controls.forEach(field => { if (field.isConnected) field.disabled = false; }); }
  }
  const earned = (amount?: number) => { if (amount) notify(tr(`+${amount} 星尘`, `+${amount} stardust`)); };
  async function submitConvention(form: Form) {
    if (!readyData(me)?.owner) return;
    const body = valueOf(form, 'body').trim();
    if (!body || body.length > 20000) { invalid(form, fieldOf(form, 'body'), tr('公约不能为空，最多 20000 个字符。', 'Enter convention terms, up to 20000 characters.')); return; }
    const identity = frameIdentity;
    await busy(form, tr('正在发布…', 'Publishing…'), async () => {
      const current = await send<CommunityConvention>('manage/convention', { version: valueOf(form, 'version'), body });
      if (identity !== frameIdentity) return;
      convention = { state: 'ready', data: current };
      const versionField = fieldOf(form, 'version');
      if (versionField) versionField.value = current.version;
      status(form, tr('公约已保存，新版本需要重新阅读并同意。', 'Convention saved. New versions require reading and agreeing again.'));
      await loadMe();
    });
  }
  async function submitModerationContact(form: Form) {
    const qq = valueOf(form, 'qq').trim();
    const email = valueOf(form, 'email').trim();
    if (qq && !/^[1-9]\d{4,11}$/.test(qq)) { invalid(form, fieldOf(form, 'qq'), tr('QQ 请填写 5–12 位数字。', 'Enter a QQ number of 5–12 digits.')); return; }
    if (email && (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) { invalid(form, fieldOf(form, 'email'), tr('请填写有效的联系邮箱。', 'Enter a valid contact email.')); return; }
    const identity = frameIdentity;
    await busy(form, tr('正在保存…', 'Saving…'), async () => {
      const contact = await send<CommunityModerationContact>('me/contact', { qq, email });
      if (identity !== frameIdentity) return;
      const current = readyData(me);
      if (current) current.moderationContact = contact;
      moderationContacts = null;
      status(form, tr('联系方式已保存。', 'Contact saved.'));
    });
  }
  const level = () => { const data = readyData(me); return data ? (data.owner ? 4 : data.trustLevel ?? data.level ?? 0) : 0; };

  async function submitTopic(form: Form) {
    const simple = Boolean(mounted?.ctx.simpleCompose);
    const board = checkedOf(form, 'board');
    if (!board) return invalid(form, form.querySelector('input[name="board"]'), tr('先选版块。', 'Choose a board first.'));
    const moment = board === 'moments';
    if ((simple || !moment) && !checkText(form, 'title', simple ? [1, communityLimits.title[1]] : communityLimits.title, ['标题', 'The title'])) return;
    if (!checkText(form, 'body', bodyLimits(board, simple), moment ? ['内容', 'The text'] : ['正文', 'The post'])) return;
    if (!imagesReady(form)) return;
    if (uploads.some(upload => upload.state === 'uploading')) return status(form, tr('图片还在上传，请稍等。', 'Images are still uploading.'));
    const images = simple ? bodyImageContent(valueOf(form, 'body')).images : board === 'tools' ? [] : uploads.filter(upload => upload.state === 'ready' && upload.id).map(upload => upload.id!);
    if (simple && !images.length) return invalid(form, fieldOf(form, 'body'), tr('请在正文添加至少 1 张图片，第一张自动作为封面。', 'Add at least one image to the body. The first image is the cover.'));
    if (!simple && board === 'showcase' && !images.length) return invalid(form, form.querySelector('[data-community-upload]'), tr('作品帖至少要有 1 张图。', 'A work needs at least one image.'));
    if (!simple && board === 'showcase' && !length(valueOf(form, 'tools'))) return invalid(form, fieldOf(form, 'tools'), tr('请写上用了哪些工具。', 'Name the tools you used.'));
    if (board === 'tools' && (!simple || valueOf(form, 'url').trim()) && !/^https?:\/\/\S+\.\S+/.test(valueOf(form, 'url').trim())) return invalid(form, fieldOf(form, 'url'), tr('请填写正确的链接，以 http:// 或 https:// 开头。', 'Enter a link starting with http:// or https://.'));
    const promptMode = checkedOf(form, 'promptMode') || 'public';
    const promptPrice = Number(valueOf(form, 'promptPrice'));
    if (board === 'showcase' && promptMode === 'paid' && (!Number.isInteger(promptPrice) || promptPrice < communityRules.unlockMin || promptPrice > communityRules.unlockMax)) {
      const field = fieldOf(form, 'promptPrice');
      const extras = field?.closest<HTMLDetailsElement>('details');
      if (extras) extras.open = true;
      return invalid(form, field, tr(`解锁数量须为 ${communityRules.unlockMin}–${communityRules.unlockMax} 之间的整数。`, `Enter an integer from ${communityRules.unlockMin} to ${communityRules.unlockMax} for the unlock amount.`));
    }
    const payload = {
      board, title: moment && !simple ? '' : valueOf(form, 'title'), body: valueOf(form, 'body'), images,
      tags: [...form.querySelectorAll<HTMLInputElement>('input[name="tags"]:checked')].map(box => box.value),
      ...(board === 'showcase' ? { tools: valueOf(form, 'tools'), model: valueOf(form, 'model'), usage: valueOf(form, 'usage'), prompt: valueOf(form, 'prompt'),
        promptMode, ...(promptMode === 'paid' ? { promptPrice } : {}) } : {}),
      ...(board === 'tools' ? { url: valueOf(form, 'url').trim(), kind: valueOf(form, 'kind'), ...(!simple ? { price: valueOf(form, 'price') } : {}), platform: valueOf(form, 'platform') } : {}),
      ...(board === 'qa' && !simple ? { bounty: Number(checkedOf(form, 'bounty') || 0) } : {}),
      ...(fieldOf(form, 'announce')?.checked ? { announce: true } : {}),
    };
    const editing = form.dataset.edit;
    await busy(form, editing ? tr('正在保存…', 'Saving…') : tr('正在发布…', 'Publishing…'), async () => {
      if (editing) {
        await send(`topics/${enc(editing)}/edit`, payload);
        threads.delete(editing);
        uploadsFor = '';
        notify(tr('修改已保存。', 'Changes saved.'));
        navigate(postHref(editing));
        return;
      }
      const result = await send<{ id: string; earned?: number; pending?: boolean }>('topics', payload);
      removeDraft(draftKey('compose', location.hash));
      form.reset();
      uploadsFor = '';
      composeBoard = null;
      if (result.pending) notify(tr('帖子已提交，站长审核通过后大家就能看到。', 'Submitted. Others will see it once it is approved.'));
      else notify(result.earned
        ? tr(`发布成功，+${result.earned} 星尘。`, `Published. +${result.earned} stardust.`)
        : tr('发布成功。', 'Published.'));
      void loadMe();
      navigate(postHref(result.id));
    });
  }
  async function submitReply(form: Form) {
    if (!checkText(form, 'body', communityLimits.reply, ['回复', 'A reply'])) return;
    if (!imagesReady(form)) return;
    const topic = form.dataset.topic || '';
    const field = form.elements.namedItem('body') as HTMLTextAreaElement;
    await busy(form, tr('正在发送…', 'Sending…'), async () => {
      const result = await send<{ id: string; earned?: number }>(`topics/${enc(topic)}/replies`, { body: field.value, ...(quoting ? { quote: quoting } : {}) });
      const editor = editorFor(field);
      if (editor) editor.clear(); else field.value = '';
      removeDraft(draftKey('reply', topic));
      quoting = null;
      earned(result.earned);
      await loadThread(topic);
      paint();
      const reply = mounted?.main.querySelector<HTMLElement>(`[id=${quoted(`reply-${result.id}`)}]`);
      reply?.focus({ preventScroll: true });
    });
  }
  async function submitReplyEdit(form: Form) {
    if (!checkText(form, 'body', communityLimits.reply, ['回复', 'A reply'])) return;
    if (!imagesReady(form)) return;
    const id = form.dataset.id || '';
    const body = (form.elements.namedItem('body') as HTMLTextAreaElement).value;
    await busy(form, tr('正在保存…', 'Saving…'), async () => {
      await send(`replies/${enc(id)}/edit`, { body });
      editingReply = null;
      await reloadThread();
      mounted?.main.querySelector<HTMLElement>(`[id=${quoted(`reply-${id}`)}]`)?.focus({ preventScroll: true });
    });
  }
  async function submitReport(form: Form) {
    const reason = checkedOf(form, 'reason');
    if (!reason) return invalid(form, form.querySelector('input[name="reason"]'), tr('请选择举报原因。', 'Choose a reason.'));
    await busy(form, tr('正在提交…', 'Sending…'), async () => {
      const result = await send<{ hidden?: boolean }>('reports', { kind: form.dataset.kind, id: form.dataset.id, reason, note: valueOf(form, 'note').trim() });
      reporting = null;
      if (result.hidden) await reloadThread(); else paint();
      notify(result.hidden ? tr('已提交举报，内容已先隐藏，等站长复核。', 'Reported; the content is hidden until reviewed.') : tr('已提交举报，站长会尽快处理。', 'Reported. The owner will review it.'));
    });
  }
  // A moderator removing someone else's post or reply: as a violation or not, with an optional mute.
  async function submitDelete(form: Form) {
    const reason = valueOf(form, 'reason').trim();
    if (length(reason) < 2 || length(reason) > 200) return invalid(form, fieldOf(form, 'reason'), tr('请填写 2–200 字的删除理由。', 'Enter a deletion reason of 2–200 characters.'));
    const kind = form.dataset.kind === 'reply' ? 'reply' : 'topic', id = form.dataset.id || '';
    const topic = readyData(threads.get(currentThreadId()));
    await busy(form, tr('正在删除…', 'Deleting…'), async () => {
      if (form.dataset.report) await send(`manage/reports/${enc(form.dataset.report)}`, { uphold: true, reason });
      else await send(`${kind === 'topic' ? 'topics' : 'replies'}/${enc(id)}/delete`, { reason, violation: Boolean(fieldOf(form, 'violation')?.checked), mute: Number(checkedOf(form, 'mute') || 0) });
      deleting = null;
      notify(tr('已删除。', 'Deleted.'));
      if (route().view === 'manage') { threads.clear(); await reload(); }
      else if (kind === 'topic') { threads.delete(id); navigate(topic ? boardHref(topic.topic.board) : '#/community/home'); }
      else await reloadThread();
    });
  }
  async function submitMove(form: Form) {
    const board = valueOf(form, 'board');
    await busy(form, tr('正在移动…', 'Moving…'), async () => {
      await send(`topics/${enc(form.dataset.id || '')}/move`, { board });
      moving = false;
      notify(tr('已移动。', 'Moved.'));
      await reloadThread();
    });
  }
  async function submitRetag(form: Form) {
    const tags = [...form.querySelectorAll<HTMLInputElement>('input[name="tags"]:checked')].map(box => box.value);
    await busy(form, tr('正在保存…', 'Saving…'), async () => {
      await send(`topics/${enc(form.dataset.id || '')}/retag`, { tags });
      retagging = false;
      await reloadThread();
    });
  }
  async function submitRedeem(form: Form) {
    const id = form.dataset.id || '';
    const uid = readyData(me)?.uid, identity = frameIdentity;
    const goods = Boolean(fieldOf(form, 'address'));
    if (goods) {
      if (!length(valueOf(form, 'name'))) return invalid(form, fieldOf(form, 'name'), tr('请填写收件人。', 'Enter the recipient.'));
      if (!/^1[3-9]\d{9}$/.test(valueOf(form, 'phone').replace(/[\s-]/g, ''))) return invalid(form, fieldOf(form, 'phone'), tr('请填写正确的手机号，用于快递联系。', 'Enter a valid mobile number for the courier.'));
      if (length(valueOf(form, 'address')) < 5) return invalid(form, fieldOf(form, 'address'), tr('请填写完整的收货地址。', 'Enter the full address.'));
    }
    await busy(form, tr('正在兑换…', 'Redeeming…'), async () => {
      const result = await send<{ item: { name: string; kind: string } }>('shop/redeem', { item: id, ...(goods ? { shipping: { name: valueOf(form, 'name'), phone: valueOf(form, 'phone'), address: valueOf(form, 'address') } } : {}) });
      if (result.item.kind === 'cover' && identity === frameIdentity) invalidateMemberProfile(uid);
      redeeming = null;
      notify(result.item.kind === 'goods' ? tr(`已兑换「${result.item.name}」，站长会尽快发货。`, `Redeemed “${result.item.name}”; it will ship soon.`) : tr(`已兑换「${result.item.name}」。`, `Redeemed “${result.item.name}”.`));
      await reload();
    });
  }
  async function submitMute(form: Form) {
    const reason = checkedOf(form, 'reason');
    if (!reason) return invalid(form, form.querySelector('input[name="reason"]'), tr('请选择禁言原因。', 'Choose a reason.'));
    await busy(form, tr('正在禁言…', 'Muting…'), async () => {
      await send(`members/${enc(form.dataset.uid || '')}/mute`, { days: Number(checkedOf(form, 'days') || 1), reason });
      muting = false;
      notify(tr('已禁言。', 'Muted.'));
      await reload();
    });
  }
  async function submitItem(form: Form) {
    if (form.dataset.uploading === 'true') return status(form, tr('请等待素材处理完成。', 'Wait for the asset to finish processing.'));
    const id = form.dataset.id || '';
    const number = (name: string) => valueOf(form, name) === '' ? null : Number(valueOf(form, name));
    const kind = checkedOf(form, 'kind') || valueOf(form, 'kind');
    const effect = communityNameEffect({ style: valueOf(form, 'effectStyle'), colors: [valueOf(form, 'effectStart'), ...(valueOf(form, 'effectStyle') === 'solid' ? [] : [valueOf(form, 'effectEnd')])] });
    if (kind === 'frame' && !valueOf(form, 'image')) return status(form, tr('请先上传透明头像框素材。', 'Upload a transparent frame first.'));
    if (kind === 'frame' && form.dataset.frameReady === 'false') return status(form, tr('当前图片不能作为头像框：请上传正方形素材，并保持中央透明。', 'Upload a square asset with a transparent centre.'));
    if (kind === 'cover' && !valueOf(form, 'image')) return status(form, tr('请先上传主页背景图片。', 'Upload a profile background first.'));
    if (kind === 'color' && !effect) return status(form, tr('请先拖入制作好的昵称特效文件。', 'Drop a finished nickname effect file first.'));
    const payload = {
      cat: checkedOf(form, 'cat') || valueOf(form, 'cat'), name: valueOf(form, 'name'), description: valueOf(form, 'description'),
      kind: kind === 'frame' || kind === 'color' || kind === 'cover' ? kind : undefined, category: valueOf(form, 'category') || null, effect: kind === 'color' ? effect : null,
      price: number('price'), stock: kind === 'frame' || kind === 'color' || kind === 'cover' ? null : number('stock'), limitPer: valueOf(form, 'limitPer') || null, limitN: number('limitN'),
      minLevel: number('minLevel') ?? 0, minDays: number('minDays') ?? 0, delivery: valueOf(form, 'delivery'), note: valueOf(form, 'note'),
      active: Boolean(fieldOf(form, 'active')?.checked),
      image: valueOf(form, 'image') || null,
    };
    await busy(form, tr('正在保存…', 'Saving…'), async () => {
      await send(id ? `manage/items/${enc(id)}` : 'manage/items', payload);
      itemEditing = null;
      notify(tr('已保存。', 'Saved.'));
      await reload();
    });
  }
  async function submitCategory(form: Form) {
    const name = valueOf(form, 'name').trim();
    if (length(name) < 2 || length(name) > 20) return invalid(form, fieldOf(form, 'name'), tr('分类名称需要 2–20 个字。', 'Category names require 2–20 characters.'));
    await busy(form, tr('正在添加…', 'Adding…'), async () => {
      const category = await send<ShopCategory>('manage/categories', { name });
      const data = readyData(manages.get('items'));
      if (data) { data.categories ||= []; data.categories.push(category); }
      shop = null;
      const list = form.closest('[data-management-categories]')?.querySelector('[data-category-list]');
      const chip = document.createElement('span'); chip.textContent = category.name; list?.append(chip);
      const select = mounted?.main.querySelector<HTMLSelectElement>('form[data-community-form="item"] select[name="category"]');
      if (select) { const option = document.createElement('option'); option.value = category.id; option.textContent = category.name; select.append(option); select.value = category.id; selects.get(select)?.update(); }
      const input = fieldOf(form, 'name'); if (input) input.value = '';
      status(form, tr('分类已添加，可在商品里选择。', 'Category added. Select it for the product.'));
    });
  }
  async function submitShip(form: Form) {
    const id = form.dataset.id || '';
    await busy(form, tr('正在更新…', 'Updating…'), async () => {
      await send(`manage/orders/${enc(id)}/ship`, { company: valueOf(form, 'company').trim(), tracking: valueOf(form, 'tracking').trim() });
      shippingOrder = null;
      notify(tr('已标记发货，收货信息已删除。', 'Marked shipped; recipient details were deleted.'));
      await reload();
    });
  }
  async function submitReject(form: Form) {
    if (reviewBusy) return;
    const id = form.dataset.id || '';
    const reason = checkedOf(form, 'reason');
    if (!reason) return invalid(form, form.querySelector('input[name="reason"]'), tr('请选择审核不通过的理由。', 'Choose a rejection reason.'));
    await reviewTask(() => busy(form, tr('正在处理…', 'Processing…'), async () => {
      if (form.dataset.batch) {
        if (!reviewSelection.size) throw new Error(tr('请选择待审帖子。', 'Select pending posts.'));
        await send('manage/review', { action: 'reject', ids: [...reviewSelection], reason, note: valueOf(form, 'note').trim() });
        reviewSelection.clear();
      } else await send(`manage/topics/${enc(id)}/reject`, { reason, note: valueOf(form, 'note').trim() });
      rejecting = null;
      notify(tr('已记录拒绝理由并通知作者。', 'The reason was recorded and the author was notified.'));
      await reload();
    }));
  }

  const currentThreadId = () => { const current = route(); return current.view === 'post' ? current.id : ''; };
  async function reloadThread() {
    const id = currentThreadId();
    if (id) await loadThread(id);
    paint();
  }
  async function submitStewardLookup(form: Form) {
    if (!readyData(me)?.owner || route().view !== 'manage' || route().tab !== 'stewards') return;
    const uid = valueOf(form, 'uid').trim();
    if (!uid || uid.length > 64) return invalid(form, fieldOf(form, 'uid'), tr('请输入有效的读者 UID。', 'Enter a valid reader UID.'));
    if (stewardBusy || (stewardCandidate?.state === 'loading' && stewardLookupUid === uid)) return;
    const requestId = ++stewardLookupRequest, identity = frameIdentity, hash = location.hash;
    stewardLookupUid = uid;
    stewardCandidate = loading;
    paint();
    const result = await load<CommunityMember>(`members/${enc(uid)}?tab=topics`, null);
    if (requestId !== stewardLookupRequest || identity !== frameIdentity || hash !== location.hash) return;
    stewardCandidate = result;
    if (result.state === 'ready' && result.data.steward) {
      await loadManage('stewards');
      if (requestId !== stewardLookupRequest || identity !== frameIdentity || hash !== location.hash) return;
    }
    paint();
  }
  function syncStewardTools(root: ParentNode) {
    const scopeDraft = stewardScopeDraft;
    root.querySelectorAll<HTMLButtonElement>('[data-action="community-steward"], [data-action="community-steward-edit"], [data-action="community-steward-edit-cancel"], [data-community-form="steward-scope"] button[type="submit"]').forEach(control => { control.disabled = stewardBusy; });
    root.querySelectorAll<HTMLInputElement>('[data-community-form="steward-scope"] input[name="boards"]').forEach(control => {
      control.disabled = stewardBusy;
      if (stewardBusy && scopeDraft && control.form?.dataset.uid === scopeDraft.uid) control.checked = scopeDraft.boards.includes(control.value);
    });
    const lookup = root.querySelector<HTMLButtonElement>('[data-community-form="steward-lookup"] button[type="submit"]');
    if (lookup) lookup.disabled = stewardBusy || stewardCandidate?.state === 'loading';
  }
  async function submitStewardScope(form: Form) {
    if (stewardBusy || !readyData(me)?.owner || route().view !== 'manage' || route().tab !== 'stewards') return;
    const uid = form.dataset.uid || '';
    const existing = form.dataset.existing === 'true';
    if (existing) {
      if (uid !== stewardEditingUid || !readyData(manages.get('stewards'))?.stewards?.some(person => person.uid === uid && person.role === 'reader')) return;
    } else {
      const candidate = readyData(stewardCandidate);
      const lookup = mounted?.main.querySelector<Form>('[data-community-form="steward-lookup"]');
      if (!candidate?.canAppoint || candidate.self || candidate.steward || candidate.person.role !== 'reader' || candidate.person.uid !== uid || !lookup || valueOf(lookup, 'uid').trim() !== uid) return;
    }
    const boards = [...form.querySelectorAll<HTMLInputElement>('input[name="boards"]:checked')].map(input => input.value);
    if (!boards.length) return invalid(form, form.querySelector('input[name="boards"]'), tr('请至少选择一个负责板块。', 'Select at least one assigned board.'));
    if (new Set(boards).size !== boards.length || boards.some(id => !communityBoards.some(board => board.id === id))) return status(form, tr('板块选择无效，请重新选择。', 'Invalid board selection. Select again.'));
    stewardScopeDraft = { uid, boards };
    await saveSteward(uid, true, boards);
  }
  async function updateSteward(button: HTMLButtonElement) {
    if (stewardBusy || !readyData(me)?.owner) return;
    const uid = button.dataset.uid || '';
    if (!uid || button.dataset.on !== 'false') return;
    if (!confirmed(button, tr('确认撤销', 'Confirm removal'))) return;
    await saveSteward(uid, false);
  }
  async function saveSteward(uid: string, on: boolean, boards?: string[]) {
    const roster = route().view === 'manage' && route().tab === 'stewards';
    const requestId = stewardLookupRequest, identity = frameIdentity, hash = location.hash;
    stewardBusy = true;
    if (mounted) syncStewardTools(mounted.main);
    try {
      await send(`members/${enc(uid)}/steward`, { on, ...(on ? { boards } : {}) });
      if (identity !== frameIdentity) return;
      notify(tr('版主已更新。', 'Moderator updated.'));
      if (stewardEditingUid === uid) stewardEditingUid = null;
      stewardScopeDraft = null;
      if (!roster) { await reload(); return; }
      const refreshCandidate = async () => {
        if (stewardLookupUid !== uid || requestId !== stewardLookupRequest) return;
        const result = await load<CommunityMember>(`members/${enc(uid)}?tab=topics`, null);
        if (requestId === stewardLookupRequest && identity === frameIdentity && hash === location.hash) stewardCandidate = result;
      };
      await Promise.all([loadManage('stewards'), loadMe(), refreshCandidate()]);
      if (identity === frameIdentity && hash === location.hash) paint();
    } catch (error) {
      if (identity !== frameIdentity || hash !== location.hash) return;
      const form = mounted?.main.querySelector<Form>(`[data-community-form="steward-scope"][data-uid=${quoted(uid)}]`) || mounted?.main.querySelector<Form>('[data-community-form="steward-lookup"]');
      if (form) status(form, message(error)); else notify(message(error));
    } finally {
      if (identity === frameIdentity) {
        stewardBusy = false;
        stewardScopeDraft = null;
        if (mounted) syncStewardTools(mounted.main);
      }
    }
  }
  // Confirming actions take two clicks on the same button: the first asks.
  const confirmTimers = new Set<ReturnType<typeof setTimeout>>();
  function confirmed(button: HTMLButtonElement, ask: string) {
    if (button.dataset.confirm === 'true') return true;
    const label = button.querySelector('span') || button;
    const original = label.textContent || '';
    button.dataset.confirm = 'true';
    label.textContent = ask;
    const timer = setTimeout(() => { confirmTimers.delete(timer); if (button.isConnected) { delete button.dataset.confirm; label.textContent = original; } }, 5000);
    confirmTimers.add(timer);
    return false;
  }
  // Runs a button's request; problems go to the toast (or the reply form when there is no toast).
  async function act(button: HTMLButtonElement, work: () => Promise<void>) {
    button.disabled = true;
    try { await work(); }
    catch (error) {
      if (button.isConnected) button.disabled = false;
      if ((error as ApiError).status === 428) { await loadMe(); return; }
      if (mounted?.ctx.notify) notify(message(error));
      else { const form = mounted?.main.querySelector<Form>('.community-reply-form'); if (form) status(form, message(error)); }
    }
  }
  async function remove(button: HTMLButtonElement) {
    const isTopic = button.dataset.action === 'community-delete-topic';
    if (button.dataset.panel === 'true') {
      deleting = { kind: isTopic ? 'topic' : 'reply', id: button.dataset.id || '' };
      postMenu = false;
      paint();
      mounted?.main.querySelector<HTMLElement>('form[data-community-form="delete"] textarea')?.focus({ preventScroll: true });
      return;
    }
    if (!confirmed(button, tr('确认删除', 'Confirm delete'))) return;
    const id = currentThreadId();
    const topic = id ? threads.get(id) : null;
    await act(button, async () => {
      await send(`${isTopic ? 'topics' : 'replies'}/${enc(button.dataset.id || '')}/delete`);
      if (isTopic) {
        threads.delete(id);
        navigate(topic?.state === 'ready' ? boardHref(topic.data.topic.board) : '#/community/home');
      } else {
        await reloadThread();
        mounted?.main.querySelector<HTMLElement>('#community-replies-title')?.focus?.();
      }
    });
  }
  // Likes and bookmarks update in place from the server's counts.
  async function toggle(button: HTMLButtonElement, kind: 'like' | 'bookmark') {
    const on = button.getAttribute('aria-pressed') !== 'true';
    const target = button.dataset.kind === 'reply' ? 'replies' : 'topics';
    const threadId = currentThreadId();
    await act(button, async () => {
      const result = await send<{ likes?: number; bookmarks?: number }>(`${target}/${enc(button.dataset.id || '')}/${kind}`, { on });
      const thread = threads.get(threadId);
      if (thread?.state === 'ready') {
        const item = target === 'topics' ? thread.data.topic : thread.data.replies.find(reply => reply.id === button.dataset.id);
        if (item && kind === 'like') Object.assign(item, { liked: on, likes: result.likes });
        if (kind === 'bookmark') Object.assign(thread.data.topic, { bookmarked: on, bookmarks: result.bookmarks });
      }
      if (!button.isConnected || currentThreadId() !== threadId) return;
      const selector = `[data-action="community-${kind}"][data-id=${quoted(button.dataset.id || '')}]`;
      const updated = renderedPage()?.querySelector(selector);
      if (updated) {
        button.innerHTML = updated.innerHTML;
        button.className = updated.className;
        button.setAttribute('aria-pressed', String(on));
        const label = updated.getAttribute('aria-label');
        if (label) button.setAttribute('aria-label', label);
      }
      button.disabled = false;
    });
  }
  async function thank(button: HTMLButtonElement) {
    if (!confirmed(button, tr(`确认花 ${communityRules.thankCost} 星尘感谢`, `Spend ${communityRules.thankCost} stardust`))) return;
    await act(button, async () => {
      await send(`${button.dataset.kind === 'reply' ? 'replies' : 'topics'}/${enc(button.dataset.id || '')}/thank`);
      notify(tr(`已感谢，作者得到 ${communityRules.thankToAuthor} 星尘。`, `Thanked; the author gets ${communityRules.thankToAuthor} stardust.`));
      void loadMe();
      await reloadThread();
    });
  }
  async function doCheckin(button: HTMLButtonElement) {
    await act(button, async () => {
      const result = await send<{ reward: number; bonus: number; streak: number }>('checkin');
      notify(tr(`签到成功，连签 ${result.streak} 天，+${result.reward} 星尘${result.bonus ? `（含自然月满勤奖励 ${result.bonus}）` : ''}`, `Checked in: ${result.streak}-day streak, +${result.reward} stardust${result.bonus ? ` (including ${result.bonus} full-month bonus)` : ''}`));
      await Promise.all([loadMe(), route().view === 'checkin' ? loadCheckin() : loadSummary()]);
      paint();
    });
  }
  // A topic action with an on/off state (pin, feature, lock) or none (approve, paid pin, highlight).
  async function topicAction(button: HTMLButtonElement, what: string, body: object = {}, done = '') {
    postMenu = false;
    await act(button, async () => {
      await send(`topics/${enc(button.dataset.id || '')}/${what}`, body);
      if (done) notify(done);
      void loadMe();
      await reload();
    });
  }
  async function dismissReport(button: HTMLButtonElement) {
    await act(button, async () => {
      await send(`manage/reports/${enc(button.dataset.id || '')}`, { uphold: false });
      notify(tr('已驳回。', 'Dismissed.'));
      await reload();
    });
  }
  async function copy(button: HTMLButtonElement, text: string, idle: string) {
    const label = button.querySelector('span') || button;
    try { await navigator.clipboard.writeText(text); label.textContent = tr('已复制', 'Copied'); }
    catch { label.textContent = tr('复制失败，请手动复制', 'Copy it by hand'); }
    const timer = setTimeout(() => { confirmTimers.delete(timer); if (button.isConnected) label.textContent = idle; }, 2000);
    confirmTimers.add(timer);
  }

  // Images upload one at a time as they are chosen; the post only sends their ids.
  async function upload(files: FileList) {
    const current = route();
    const form = mounted?.main.querySelector<Form>('form[data-community-form="topic"]');
    const board = form ? checkedOf(form, 'board') : current.board;
    const max = imageLimit(mounted?.ctx.simpleCompose && board === 'tools' ? 'qa' : board, level());
    const cap = communityImageBytes(Boolean(readyData(me)?.owner));
    const typed = [...files].filter(file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type));
    const images = typed.filter(file => file.size <= cap);
    if (typed.length !== images.length) notify(tr(`单张图片不能超过 ${cap / 1024 ** 2}MB。`, `Each image must be ${cap / 1024 ** 2}MB or smaller.`));
    if (typed.length !== files.length) {
      const text = tr('只支持 JPG、PNG、WebP 图片，不支持视频。', 'Only JPG, PNG and WebP images are supported, not videos.');
      if (form) status(form, text);
      notify(text);
    }
    const chosen = images.slice(0, Math.max(0, max - uploads.length));
    if (chosen.length < images.length) notify(tr(`最多 ${max} 张图。`, `Up to ${max} images.`));
    if (!chosen.length) return;
    const entries = chosen.map(file => ({ name: file.name, state: 'uploading' as CommunityUpload['state'] } as CommunityUpload));
    uploads.push(...entries);
    paint();
    await Promise.all(chosen.map(async (file, i) => {
      const entry = entries[i];
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        const response = await request('/api/community/images', { method: 'POST', credentials: 'same-origin', headers: { 'X-Reader-Request': '1' }, body: form });
        const value = await response.json().catch(() => ({})) as { id?: string; error?: string };
        if (!response.ok || !value.id) throw new Error(value.error || tr('上传失败', 'Upload failed'));
        Object.assign(entry, { id: value.id, state: 'ready' });
      } catch (error) { Object.assign(entry, { state: 'error', message: message(error) }); }
      paint();
    }));
  }

  // A full-size image over the page; a click anywhere or Escape closes it.
  function openLightbox(src: string, opener: HTMLElement) {
    const box = document.createElement('div');
    box.className = 'community-lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', tr('查看图片', 'Image'));
    box.innerHTML = `<img src="${src.replace(/"/g, '&quot;')}" alt=""><button type="button" class="community-lightbox-close" aria-label="${tr('关闭', 'Close')}">×</button>`;
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); opener.focus({ preventScroll: true }); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    box.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.append(box);
    box.querySelector<HTMLElement>('button')?.focus();
  }

  // Search the list on this page; an empty term shows everything again.
  async function search(value: string) {
    clearTimeout(searchTimer);
    const scope = scopeOf(), query = value.trim();
    if ([...query].length > communitySearchLimit || query === queryOf(scope)) return;
    if (query) queries.set(scope, query); else queries.delete(scope);
    await changeList();
  }

  async function loadMore() {
    const scope = scopeOf();
    const key = listKey(scope), current = lists.get(key);
    if (current?.state !== 'ready' || current.more) return;
    const latest = claim(key);
    const hash = location.hash, section = mounted?.main.querySelector('[data-community]');
    const visible = () => location.hash === hash && listKey(scopeOf()) === key && mounted?.main.querySelector('[data-community]') === section;
    lists.set(key, { ...current, more: true });
    const button = mounted?.main.querySelector<HTMLButtonElement>('[data-action="community-more"]');
    if (button) { button.disabled = true; button.textContent = tr('正在加载…', 'Loading…'); }
    const known = new Set(current.data.items.map(item => item.id));
    try {
      const next = await api<CommunityListing>(listPath(scope, Math.floor(current.data.items.length / current.data.pageSize) + 1));
      if (!latest()) return;
      const added = next.items.filter(item => !known.has(item.id));
      lists.set(key, { state: 'ready', data: { ...next, items: [...current.data.items, ...added] } });
      if (!visible()) return;
      paintList(true);
      const link = added[0] && mounted?.main.querySelector<HTMLElement>(`.community-topic a[href=${quoted(postHref(added[0].id))}]`);
      link?.focus({ preventScroll: true });
    } catch {
      if (!latest()) return;
      lists.set(key, current);
      if (visible()) paintList(true);
    }
  }

  // Opens a page-local panel and puts focus in it.
  function openPanel(selector: string) {
    paint();
    const panel = mounted?.main.querySelector<HTMLElement>(selector);
    // The first field, or the confirming button when there is nothing to fill in.
    (panel?.querySelector<HTMLElement>('input:not([type="hidden"]), .community-select-trigger, select:not([hidden]), textarea') || panel?.querySelector<HTMLElement>('button[type="submit"], button'))?.focus({ preventScroll: true });
  }
  function setPostMenu(open: boolean, focusButton = false) {
    if (postMenu === open) return;
    postMenu = open;
    const menu = mounted?.main.querySelector<HTMLElement>('#community-post-menu');
    const button = mounted?.main.querySelector<HTMLElement>('[data-action="community-post-menu"]');
    if (menu) menu.hidden = !open;
    button?.setAttribute('aria-expanded', String(open));
    if (open) menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    else if (focusButton) button?.focus({ preventScroll: true });
  }

  function onClick(event: Event) {
    const target = (event.target as Element).closest<HTMLButtonElement>('[data-action^="community-"]');
    if (postMenu && !(event.target as Element).closest?.('.community-more-menu')) setPostMenu(false);
    if (!target || !mounted) return;
    if (switchingBrowseMode) { notify(tr('正在切换浏览身份，请稍候。', 'Switching browsing perspective; please wait.')); return; }
    const { action, id = '', kind } = target.dataset;
    if (route().view === 'manage' && ['community-ship', 'community-reject', 'community-queue-delete', 'community-batch-reject', 'community-uphold'].includes(action || '')) managementOpener = { action: action!, id };
    if (communityReaderReadOnly(readyData(me)) && ![
      'community-browse-mode', 'community-sort', 'community-more', 'community-search-clear', 'community-retry', 'community-reply-sort',
      'community-lightbox', 'community-post-menu', 'community-copy-link', 'community-copy-prompt', 'community-copy-delivery',
      'community-delivery', 'community-delivery-close', 'community-month', 'community-flow', 'community-notice',
      'community-level-mode', 'community-level-select', 'community-badge-family', 'community-badge-tier',
    ].includes(action || '')) {
      notify(tr('当前预览仅供查看，请先返回管理身份。', 'This preview is read-only. Restore management first.')); return;
    }
    if (readyData(me)?.management?.browsingAsReader && [
      'community-pin', 'community-feature', 'community-lock', 'community-approve', 'community-batch-approve', 'community-batch-reject',
      'community-restore', 'community-queue-delete', 'community-move', 'community-management-board', 'community-profile-review',
      'community-mute', 'community-steward', 'community-steward-edit', 'community-lift', 'community-ship', 'community-reject',
      'community-cancel-order', 'community-item-edit', 'community-uphold', 'community-dismiss',
    ].includes(action || '')) { notify(tr('请先返回管理身份。', 'Restore management first.')); return; }
    if (bannerEditor.action(target)) return;
    if (levelExplorer.action(target)) return;
    if (badgeExplorer.action(target)) return;
    switch (action) {
      case 'community-profile-edit': void openProfile(); return;
      case 'community-profile-remove': void removeProfile(target, kind); return;
      case 'community-profile-review': void reviewProfile(target); return;
      case 'community-management-board': {
        if (reviewBusy || route().view !== 'manage' || !['queue', 'reports'].includes(route().tab)) return;
        const board = target.dataset.board || '';
        if (board && !communityBoards.some(item => item.id === board)) return;
        const data = readyData(manages.get(route().tab));
        if (board && data && !data.owner && data.moderationBoards && !data.moderationBoards.includes(board)) return;
        if (board === managementBoard) return;
        managementBoard = board;
        reviewSelection.clear();
        target.focus({ preventScroll: true });
        paint();
        return;
      }
      case 'community-sort':
        if (!isCommunitySort(target.dataset.sort)) return;
        if (target.dataset.sort === sort) return;
        sort = target.dataset.sort;
        // Not every browser focuses a clicked button; keep the place explicitly.
        mounted.main.querySelector<HTMLElement>(`[data-action="community-sort"][data-sort="${sort}"]`)?.focus({ preventScroll: true });
        void changeList();
        return;
      case 'community-more': void loadMore(); return;
      case 'community-search-clear': {
        const field = mounted.main.querySelector<HTMLInputElement>('#community-search');
        if (field) { field.value = ''; field.focus({ preventScroll: true }); }
        void search('');
        return;
      }
      case 'community-retry': {
        const current = route();
        threads.delete(current.id);
        summary = null; checkin = null; bookmarks = null; shop = null; shopMine = null; rank = null;
        stardusts.clear(); memberPages.clear(); inboxes.clear(); manages.clear();
        lists.delete(listKey(scopeOf(current)));
        paint();
        void refresh(current);
        return;
      }
      case 'community-delete-topic': case 'community-delete-reply': void remove(target); return;
      case 'community-delete-cancel': deleting = null; paint(); restoreManagementFocus(); return;
      case 'community-copy-link': void copy(target, location.href, tr('复制链接', 'Copy link')); return;
      case 'community-copy-prompt': void copy(target, mounted.main.querySelector('[data-prompt]')?.textContent || '', tr('复制', 'Copy')); return;
      case 'community-copy-delivery': void copy(target, mounted.main.querySelector('[data-delivery]')?.textContent || '', tr('复制', 'Copy')); return;
      case 'community-like': void toggle(target, 'like'); return;
      case 'community-bookmark': void toggle(target, 'bookmark'); return;
      case 'community-thank': void thank(target); return;
      case 'community-checkin': void doCheckin(target); return;
      case 'community-accept':
        if (!confirmed(target, tr('确认采纳', 'Confirm'))) return;
        void act(target, async () => { const result = await send<{ earned: number }>(`replies/${enc(id)}/accept`); notify(tr(`已采纳，回答者得到 ${result.earned} 星尘。`, `Accepted; the author gets ${result.earned} stardust.`)); await reloadThread(); });
        return;
      case 'community-report':
        reporting = { kind: kind === 'reply' ? 'reply' : 'topic', id };
        openPanel('form[data-community-form="report"]');
        return;
      case 'community-report-cancel': reporting = null; paint(); return;
      case 'community-edit-reply':
        editingReply = id;
        paint();
        focusBody('community-reply-edit');
        return;
      case 'community-edit-cancel': editingReply = null; paint(); return;
      case 'community-post-menu': setPostMenu(!postMenu); return;
      case 'community-pin': void topicAction(target, 'pin', { on: target.getAttribute('aria-pressed') !== 'true' }); return;
      case 'community-feature': void topicAction(target, 'feature', { on: target.getAttribute('aria-pressed') !== 'true' }); return;
      case 'community-lock': void topicAction(target, 'lock', { on: target.getAttribute('aria-pressed') !== 'true' }, target.getAttribute('aria-pressed') === 'true' ? tr('已解除锁定。', 'Unlocked.') : tr('已锁定。', 'Locked.')); return;
      case 'community-approve': void reviewTask(() => topicAction(target, 'approve', {}, tr('已通过审核。', 'Approved.'))); return;
      case 'community-batch-approve':
        if (!reviewSelection.size) return;
        void reviewTask(() => act(target, async () => { const ids = [...reviewSelection]; await send('manage/review', { action: 'approve', ids }); reviewSelection.clear(); notify(tr(`已通过 ${ids.length} 个帖子。`, `Approved ${ids.length} posts.`)); await reload(); })); return;
      case 'community-batch-reject':
        if (!reviewBusy && reviewSelection.size) { rejecting = 'batch'; openPanel('form[data-community-form="reject"]'); } return;
      case 'community-paid-pin':
        if (!confirmed(target, tr('确认推荐 24 小时', 'Confirm the recommendation'))) return;
        void topicAction(target, 'paid-pin', {}, tr('已推荐 24 小时。', 'Recommended for 24 hours.'));
        return;
      case 'community-highlight': void topicAction(target, 'highlight', {}, tr(`标题会发光 ${communityRules.glowDays} 天。`, `The title glows for ${communityRules.glowDays} days.`)); return;
      case 'community-restore':
        postMenu = false;
        void act(target, async () => { await send(`${kind === 'reply' ? 'replies' : 'topics'}/${enc(id)}/restore`); notify(tr('已恢复显示。', 'Shown again.')); await reload(); });
        return;
      case 'community-queue-delete':
        { const data = readyData(manages.get(route().tab));
          const author = kind === 'reply' ? data?.queue.replies.find(reply => reply.id === id)?.author : [...(data?.content || []), ...(data?.queue.topics || [])].find(topic => topic.id === id)?.author;
          deleting = { kind: kind === 'reply' ? 'reply' : 'topic', id, mine: Boolean(author?.uid && author.uid === readyData(me)?.uid) };
          openPanel('form[data-community-form="delete"]'); }
        return;
      case 'community-move': postMenu = false; moving = true; retagging = false; openPanel('form[data-community-form="move"]'); return;
      case 'community-move-cancel': moving = false; paint(); return;
      case 'community-retag': postMenu = false; retagging = true; moving = false; openPanel('form[data-community-form="retag"]'); return;
      case 'community-retag-cancel': retagging = false; paint(); return;
      case 'community-reply-sort':
        if (target.dataset.sort !== 'floor' && target.dataset.sort !== 'likes') return;
        replySort = target.dataset.sort;
        sortReplies();
        return;
      case 'community-quote':
        quoting = id;
        paint();
        focusBody('community-reply');
        return;
      case 'community-unquote': quoting = null; paint(); focusBody('community-reply'); return;
      case 'community-vote': {
        const value = target.getAttribute('aria-pressed') === 'true' ? null : target.dataset.value;
        void act(target, async () => {
          const result = await send<{ vote: 'alive' | 'dead' | null; alive: number; dead: number }>(`topics/${enc(id)}/vote`, { value });
          const thread = readyData(threads.get(currentThreadId()));
          if (thread?.topic.resource) Object.assign(thread.topic.resource, { myVote: result.vote, alive: result.alive, dead: result.dead });
          paint();
        });
        return;
      }
      case 'community-unlock':
        if (!confirmed(target, tr('确认解锁', 'Confirm unlock'))) return;
        void act(target, async () => { await send(`topics/${enc(id)}/unlock`); notify(tr('已解锁提示词。', 'Prompt unlocked.')); void loadMe(); await reloadThread(); });
        return;
      case 'community-follow': {
        const on = target.getAttribute('aria-pressed') !== 'true';
        void act(target, async () => { await send(`members/${enc(target.dataset.uid || '')}/follow`, { on }); notify(on ? tr('已关注。', 'Following.') : tr('已取消关注。', 'Unfollowed.')); await reload(); });
        return;
      }
      case 'community-md': {
        const field = mounted.main.querySelector<HTMLTextAreaElement>(`[id=${quoted(target.dataset.for || '')}]`);
        const editor = editorFor(field);
        if (editor) { editor.command(target.dataset.md || ''); return; }
        if (field) applyMarkdown(field, target.dataset.md || '', tr);
        return;
      }
      case 'community-md-preview': togglePreview(target); return;
      case 'community-month': {
        checkinMonth = target.dataset.month || '';
        const hash = location.hash, month = checkinMonth;
        void loadCheckin().then(current => { if (current && location.hash === hash && checkinMonth === month) paint(); });
        return;
      }
      case 'community-makeup': {
        const data = readyData(checkin);
        const cost = data?.makeup.cards ? tr('用补签卡', 'use a card') : data?.makeup.free ? tr('免费', 'free') : tr(`${communityRules.makeupCost} 星尘`, `${communityRules.makeupCost} stardust`);
        if (!confirmed(target, tr(`补签？${cost}`, `Make up? ${cost}`))) return;
        void act(target, async () => { const result = await send<{ streak: number; bonus: number }>('checkin/makeup', { day: target.dataset.day }); notify(tr(`补签成功，连签 ${result.streak} 天。${result.bonus ? `自然月满勤奖励 +${result.bonus} 星尘。` : ''}`, `Made up: ${result.streak}-day streak.${result.bonus ? ` Full-month bonus +${result.bonus} stardust.` : ''}`)); await reload(); });
        return;
      }
      case 'community-flow': {
        const value = target.dataset.flow;
        if (value !== 'all' && value !== 'in' && value !== 'out') return;
        flow = value;
        const hash = location.hash;
        if (readyData(stardusts.get(value))) paint();
        else {
          // Retain the table and filters until the replacement arrives.
          mounted.main.querySelector('.community-ledger-wrap')?.setAttribute('aria-busy', 'true');
          for (const button of mounted.main.querySelectorAll<HTMLElement>('[data-action="community-flow"]')) {
            button.setAttribute('aria-pressed', String(button.dataset.flow === value));
          }
        }
        void loadStardust().then(current => { if (current && location.hash === hash && flow === value) paint(); });
        return;
      }
      case 'community-redeem': redeeming = id; delivery = null; openPanel('form[data-community-form="redeem"]'); return;
      case 'community-redeem-cancel': redeeming = null; paint(); return;
      case 'community-equip': {
        const uid = readyData(me)?.uid, identity = frameIdentity;
        void act(target, async () => {
          await send('shop/equip', { kind: target.dataset.kind, ref: target.dataset.ref || null });
          if (target.dataset.kind === 'cover' && identity === frameIdentity) invalidateMemberProfile(uid);
          notify(target.dataset.ref ? tr('已换上。', 'Applied.') : target.dataset.kind === 'cover' ? tr('已恢复默认背景。', 'Default background restored.') : tr('已取下。', 'Removed.'));
          await reload();
        });
        return;
      }
      case 'community-delivery':
        void act(target, async () => {
          const data = await api<{ name: string; delivery: string }>(`shop/items/${enc(id)}/delivery`);
          delivery = { id, ...data };
          redeeming = null;
          openPanel('.community-delivery');
        });
        return;
      case 'community-delivery-close': delivery = null; paint(); return;
      case 'community-read-all':
        void act(target, async () => { await send('inbox/read-all'); await reload(); });
        return;
      case 'community-notice': {
        const href = target.dataset.href || '';
        void act(target, async () => {
          if (!communityReaderReadOnly(readyData(me))) {
            await send('inbox/read', { id });
            inboxes.clear();
          }
          if (href && href !== location.hash) navigate(href); else await reload();
        });
        return;
      }
      case 'community-mute': muting = true; openPanel('form[data-community-form="mute"]'); return;
      case 'community-mute-cancel': muting = false; paint(); return;
      case 'community-steward':
        void updateSteward(target);
        return;
      case 'community-steward-edit':
        if (stewardBusy || !readyData(me)?.owner || route().view !== 'manage' || route().tab !== 'stewards' || !readyData(manages.get('stewards'))?.stewards?.some(person => person.uid === target.dataset.uid)) return;
        stewardEditingUid = target.dataset.uid || null; paint();
        return;
      case 'community-steward-edit-cancel':
        if (!stewardBusy) {
          const form = target.closest<Form>('[data-community-form="steward-scope"]');
          if (form?.dataset.existing === 'false') { stewardCandidate = null; stewardLookupUid = ''; stewardLookupRequest++; }
          else if (form?.dataset.uid === stewardEditingUid) stewardEditingUid = null;
          paint();
        }
        return;
      case 'community-lift':
        if (!confirmed(target, tr('确认解除', 'Confirm'))) return;
        void act(target, async () => { await send(`manage/sanctions/${enc(id)}/lift`); notify(tr('已解除禁言。', 'Mute lifted.')); await reload(); });
        return;
      case 'community-ship': shippingOrder = id; openPanel('form[data-community-form="ship"]'); return;
      case 'community-ship-cancel': shippingOrder = null; paint(); restoreManagementFocus(); return;
      case 'community-reject': rejecting = id; openPanel('form[data-community-form="reject"]'); return;
      case 'community-reject-cancel': if (!reviewBusy) { rejecting = null; paint(); restoreManagementFocus(); } return;
      case 'community-cancel-order':
        if (!confirmed(target, tr('确认取消并退回', 'Confirm cancel'))) return;
        void act(target, async () => { await send(`manage/orders/${enc(id)}/cancel`); notify(tr('已取消，星尘已退回。', 'Cancelled and refunded.')); await reload(); });
        return;
      case 'community-item-edit': itemEditing = { id: id || null }; openPanel('form[data-community-form="item"]'); return;
      case 'community-item-cancel': itemEditing = null; paint(); return;
      case 'community-item-image-remove': {
        const form = target.closest<Form>('form');
        if (form && form.dataset.uploading !== 'true') { const image = fieldOf(form, 'image'); if (image) image.value = ''; updateProductPreview(form, ''); }
        return;
      }
      case 'community-uphold': {
        const report = readyData(manages.get(route().tab))?.reports.find(report => report.id === id);
        if (report) { deleting = { kind: report.target.kind, id: report.target.id || report.target.topicId || '', reportId: id }; openPanel('form[data-community-form="delete"]'); }
        return;
      }
      case 'community-dismiss': void dismissReport(target); return;
      case 'community-image-remove':
        uploads.splice(Number(target.dataset.index), 1);
        paint();
        return;
      case 'community-lightbox': openLightbox(target.dataset.src || '', target); return;
    }
  }
  // Ctrl+Enter (⌘+Enter on Mac) sends a reply or publishes a post; Escape closes the post menu.
  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    levelExplorer.keydown(event);
    if (event.defaultPrevented) return;
    badgeExplorer.keydown(event);
    if (event.defaultPrevented) return;
    const dialog = mounted?.main.querySelector('[role="dialog"][aria-modal="true"]');
    if (dialog && event.key === 'Escape') { event.preventDefault(); if (!dialog.querySelector('button[type="submit"]:disabled')) { rejecting = null; deleting = null; shippingOrder = null; paint(); restoreManagementFocus(); } return; }
    if (dialog && event.key === 'Tab') {
      const candidates = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href]')].filter(control => !control.closest('[hidden]'));
      const controls = candidates.filter(control => {
        if (!(control instanceof HTMLInputElement) || control.type !== 'radio') return true;
        const radios = candidates.filter((node): node is HTMLInputElement => node instanceof HTMLInputElement && node.type === 'radio' && node.name === control.name);
        return (radios.find(radio => radio.checked) || radios[0]) === control;
      });
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus({ preventScroll: true }); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus({ preventScroll: true }); }
    }
    if (event.key === 'Escape' && postMenu) { event.preventDefault(); setPostMenu(false, true); return; }
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    const form = (event.target as Element).closest?.<Form>('form[data-community-form="reply"], form[data-community-form="topic"], form[data-community-form="reply-edit"]');
    if (!form) return;
    event.preventDefault();
    form.requestSubmit();
  }
  function restoreManagementFocus() {
    if (!managementOpener || route().view !== 'manage') return;
    const { action, id } = managementOpener;
    mounted?.main.querySelector<HTMLElement>(`[data-action=${quoted(action)}]${id ? `[data-id=${quoted(id)}]` : ''}`)?.focus({ preventScroll: true });
    managementOpener = null;
  }
  function restoreManagementBackground() {
    for (const [node, wasInert] of managementBackground) node.inert = wasInert;
    managementBackground.clear();
  }
  function syncManagementDialog() {
    restoreManagementBackground();
    const current = readyData(me);
    if (current?.convention && !current.convention.agreed) return;
    let child: HTMLElement | null = mounted?.main.querySelector<HTMLElement>('.community-management-dialog') || null;
    while (child?.parentElement) {
      const parent: HTMLElement = child.parentElement;
      for (const sibling of parent.children) {
        if (sibling === child || !(sibling instanceof HTMLElement) || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) continue;
        managementBackground.set(sibling, Boolean(sibling.inert)); sibling.inert = true;
      }
      if (parent === document.body) break;
      child = parent;
    }
  }
  // Cards glow where the pointer is (demo "spot").
  function onPointer(event: PointerEvent) {
    const card = (event.target as Element).closest?.<HTMLElement>('.community-spot');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    card.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }
  function onSubmit(event: Event) {
    const form = (event.target as Element).closest<Form>('form[data-community-form]');
    if (!form || !mounted) return;
    event.preventDefault();
    if (switchingBrowseMode) { status(form, tr('正在切换浏览身份，请稍候。', 'Switching browsing perspective; please wait.')); return; }
    if (communityReaderReadOnly(readyData(me)) && form.dataset.communityForm !== 'search') { status(form, tr('请先返回管理身份。', 'Restore management first.')); return; }
    if (form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled) return;
    if (bannerEditor.submit(form)) return;
    const handlers: Record<string, (form: Form) => unknown> = {
      'profile-signature': item => submitProfile(item, 'signature'), 'profile-avatar': item => submitProfile(item, 'avatar'),
      'profile-background': item => submitProfile(item, 'background'),
      'profile-background-review': item => reviewBackground(item, event),
      search: item => search((item.elements.namedItem('q') as HTMLInputElement).value),
      topic: submitTopic, reply: submitReply, 'reply-edit': submitReplyEdit, report: submitReport, delete: submitDelete,
      move: submitMove, retag: submitRetag, redeem: submitRedeem, mute: submitMute, item: submitItem, category: submitCategory, ship: submitShip, reject: submitReject, 'steward-lookup': submitStewardLookup, 'steward-scope': submitStewardScope, 'moderation-contact': submitModerationContact, convention: submitConvention,
    };
    void handlers[form.dataset.communityForm || '']?.(form);
  }
  function onInput(event: Event) {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    if (!field.closest?.('form[data-community-form]')) return;
    if (field instanceof HTMLInputElement && bannerEditor.input(field)) return;
    if (field.name === 'q') {
      // Search as the visitor pauses typing; Enter searches at once.
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { if (field.isConnected) void search(field.value); }, 350);
      return;
    }
    field.removeAttribute('aria-invalid');
    count(field);
    autosize(field);
    const form = field.form;
    if (form?.dataset.communityForm === 'steward-lookup' && field.name === 'uid') {
      stewardLookupRequest++;
      stewardLookupUid = '';
      stewardCandidate = null;
      mounted?.main.querySelector('.community-steward-candidate')?.replaceChildren();
      mounted?.main.querySelector('.community-steward-candidate')?.removeAttribute('aria-busy');
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]'); if (button) button.disabled = stewardBusy;
      status(form, '');
    }
    if (form?.dataset.communityForm === 'topic' && !form.dataset.edit) {
      writeDraft(draftKey('compose', location.hash), {
        board: checkedOf(form, 'board'), title: valueOf(form, 'title'), body: valueOf(form, 'body'),
        tags: draftTags(form), bounty: Number(checkedOf(form, 'bounty') || 0),
      });
    } else if (form?.dataset.communityForm === 'reply') {
      writeDraft(draftKey('reply', form.dataset.topic || route().id), { body: valueOf(form, 'body') });
    }
    if (field.form?.dataset.communityForm === 'topic') syncForms(mounted?.main || document);
    if (field.form?.dataset.communityForm === 'item') syncItemForm(field.form);
  }
  function updateProductPreview(form: Form, id: string) {
    const preview = form.querySelector<HTMLElement>('[data-item-image-preview]');
    if (!preview) return;
    const src = id ? `/api/community/images/${enc(id)}.webp` : '';
    if (id && preview.querySelector('img')?.getAttribute('src') !== src) { const img = document.createElement('img'); img.src = src; img.alt = tr('商品图片预览', 'Product preview'); preview.replaceChildren(img); }
    else if (!id && preview.querySelector('img')) { const label = document.createElement('span'); label.textContent = tr('商品图片', 'Product image'); preview.replaceChildren(label); }
    const remove = form.querySelector<HTMLButtonElement>('[data-action="community-item-image-remove"]');
    if (remove) remove.hidden = !id;
    syncItemForm(form);
  }
  function syncItemForm(form: Form) {
    if (!mounted) return;
    const kind = checkedOf(form, 'kind') || valueOf(form, 'kind') || 'goods';
    const wearable = kind === 'frame' || kind === 'color' || kind === 'cover';
    const cat = fieldOf(form, 'cat'); if (cat) cat.value = wearable ? 'look' : kind;
    const show = (selector: string, visible: boolean) => { const node = form.querySelector<HTMLElement>(selector); if (node) node.hidden = !visible; };
    show('[data-item-media]', kind !== 'color'); show('[data-item-effect]', kind === 'color'); show('[data-item-wear-preview]', wearable);
    show('[data-item-delivery]', kind === 'digital'); show('[data-item-stock]', !wearable);
    const stock = fieldOf(form, 'stock'); if (stock) stock.disabled = wearable;
    const help = form.querySelector('[data-item-media-help]');
    if (help) help.textContent = kind === 'frame' ? tr('上传正方形透明 PNG / WebP / GIF，中心留空；支持动画，最多 25MB / 120 帧。', 'Square transparent PNG / WebP / GIF with a clear centre; up to 25MB / 120 frames.') : kind === 'cover' ? tr('主页背景支持 JPG、PNG、WebP、GIF，最多 25MB / 120 帧。建议使用横向图片。', 'Profile backgrounds: JPG, PNG, WebP, GIF; up to 25MB / 120 frames. Landscape artwork is recommended.') : tr('商品展示图支持 JPG、PNG、WebP、GIF，最多 25MB / 120 帧。', 'Artwork: JPG, PNG, WebP, GIF; up to 25MB / 120 frames.');
    const hint = form.querySelector('[data-item-wear-help]');
    if (hint) hint.textContent = kind === 'frame' ? tr('素材会叠加在用户头像上；兑换后自动换上，也可以从已拥有取下。', 'The asset overlays the avatar. Redemption applies it; remove it from Owned items.') : kind === 'cover' ? tr('仅用于社区个人主页背景；兑换后自动使用，也可以在已拥有中更换。一次只显示一张背景。', 'Community profile background only. Redemption applies it; switch it in Owned items. One background is displayed at a time.') : tr('兑换后会应用到社区昵称，帖子、回复和排行榜统一显示。', 'Applies to names in posts, replies and rankings.');
    const effect = kind === 'color' ? communityNameEffect({ style: valueOf(form, 'effectStyle'), colors: [valueOf(form, 'effectStart'), ...(valueOf(form, 'effectStyle') === 'solid' ? [] : [valueOf(form, 'effectEnd')])] }) : null;
    const sample: CommunityPerson = { name: readyData(me)?.name || tr('無相', 'Preview'), uid: null, role: 'reader', frame: kind === 'frame' && valueOf(form, 'image') ? `image:${valueOf(form, 'image')}` : null, nameEffect: effect };
    const preview = form.querySelector('[data-item-wear-sample]');
    const image = valueOf(form, 'image');
    const key = `${kind}|${image}|${sample.frame}|${sample.name}|${JSON.stringify(effect)}`;
    if (preview && wearable && preview.getAttribute('data-preview-key') !== key) {
      preview.innerHTML = kind === 'cover' ? /^[0-9a-f-]{36}$/.test(image) ? `<span class="community-cover-sample"><img src="/api/community/images/${mounted.ctx.esc(image)}.webp" alt="${tr('主页背景预览', 'Profile background preview')}"></span>` : '' : avatarHTML(sample, mounted.ctx, 'lg', false) + nameLabelHTML(sample, mounted.ctx);
      preview.setAttribute('data-preview-key', key);
    }
  }
  function equipmentStatus(form: Form, text: string, effect = false) {
    const line = form.querySelector<HTMLElement>(effect ? '[data-item-effect-status]' : '[data-item-upload-status]');
    if (line) line.textContent = text;
  }
  function setEquipmentBusy(form: Form, value: boolean) {
    if (value) form.dataset.uploading = 'true'; else delete form.dataset.uploading;
    form.setAttribute('aria-busy', String(value));
    form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-community-item-upload], [data-community-effect-upload], button[type="submit"]').forEach(field => { field.disabled = value; });
  }
  async function uploadProduct(form: Form, file?: File) {
    if (!file || form.dataset.uploading === 'true' || form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled) return;
    const line = form.querySelector<HTMLElement>('[data-item-upload-status]');
    const say = (text: string) => { if (line) line.textContent = text; };
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { say(tr('请选择 JPG、PNG、WebP 或 GIF 图片。', 'Choose JPG, PNG, WebP or GIF.')); return; }
    if (file.size > communityImageBytes(true)) { say(tr('商品图片不能超过 25MB。', 'Product images cannot exceed 25MB.')); return; }
    const identity = frameIdentity;
    setEquipmentBusy(form, true);
    say(tr('正在上传商品图片…', 'Uploading product image…'));
    try {
      const body = new FormData(); body.append('file', file);
      const image = await api<{ id: string; frameReady: boolean }>('manage/item-image', { method: 'POST', headers: { 'X-Reader-Request': '1' }, body });
      if (!form.isConnected || identity !== frameIdentity) return;
      const value = fieldOf(form, 'image'); if (value) value.value = image.id;
      form.dataset.frameReady = String(image.frameReady);
      updateProductPreview(form, image.id); say(tr('图片已上传，保存商品后生效。', 'Image uploaded; save the product to apply it.'));
    } catch (error) { if (form.isConnected) say(message(error)); }
    finally { if (form.isConnected) setEquipmentBusy(form, false); }
  }
  async function importNameEffect(form: Form, file?: File) {
    if (!file || form.dataset.uploading === 'true' || form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled) return;
    const identity = frameIdentity;
    setEquipmentBusy(form, true);
    equipmentStatus(form, tr('正在读取昵称特效…', 'Reading nickname effect…'), true);
    try {
      const effect = await readNameEffectFile(file);
      if (!form.isConnected || identity !== frameIdentity) return;
      if ((checkedOf(form, 'kind') || valueOf(form, 'kind')) !== 'color') {
        equipmentStatus(form, tr('物品类型已切换，未应用这个昵称特效。', 'Product type changed; this nickname effect was not applied.'), true);
        return;
      }
      const style = fieldOf(form, 'effectStyle'), start = fieldOf(form, 'effectStart'), end = fieldOf(form, 'effectEnd');
      if (style) style.value = effect.style;
      if (start) start.value = effect.colors[0];
      if (end) end.value = effect.colors[1] || effect.colors[0];
      syncItemForm(form);
      equipmentStatus(form, tr('效果已导入，请确认预览；保存商品后生效。', 'Effect imported. Check the preview, then save the product.'), true);
    } catch (error) { if (form.isConnected && identity === frameIdentity) equipmentStatus(form, message(error), true); }
    finally { if (form.isConnected) setEquipmentBusy(form, false); }
  }
  function equipmentForm() {
    // Only an open author product editor accepts desktop files. Other page
    // editors retain their own drag handlers, including inline reply images.
    return mounted?.main.querySelector<Form>('form[data-community-form="item"]') || null;
  }
  function clearEquipmentDrag() {
    equipmentDragDepth = 0;
    mounted?.main.querySelectorAll('.community-equipment-drop.is-dragging').forEach(zone => zone.classList.remove('is-dragging'));
  }
  function fileTransfer(event: DragEvent) {
    return event.dataTransfer && (Array.from(event.dataTransfer.types).includes('Files') || event.dataTransfer.files.length > 0);
  }
  function onEquipmentDrag(event: DragEvent) {
    if (bannerEditor.drag(event)) return;
    const form = equipmentForm();
    if (!form || !fileTransfer(event)) return;
    event.preventDefault();
    if (event.type === 'dragenter') equipmentDragDepth++;
    const busy = form.dataset.uploading === 'true' || form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled;
    if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
    if (!busy) {
      const effect = (checkedOf(form, 'kind') || valueOf(form, 'kind')) === 'color';
      form.querySelector(effect ? '.community-effect-import' : '[data-item-media]')?.classList.add('is-dragging');
    }
  }
  function onEquipmentLeave(event: DragEvent) {
    if (bannerEditor.drag(event)) return;
    if (!equipmentForm() || !fileTransfer(event)) return;
    equipmentDragDepth = Math.max(0, equipmentDragDepth - 1);
    if (equipmentDragDepth === 0) clearEquipmentDrag();
  }
  function onEquipmentDrop(event: DragEvent) {
    if (bannerEditor.drag(event)) return;
    const form = equipmentForm();
    if (!form || !fileTransfer(event)) return;
    event.preventDefault();
    clearEquipmentDrag();
    const effect = (checkedOf(form, 'kind') || valueOf(form, 'kind')) === 'color';
    if (form.dataset.uploading === 'true' || form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled) return;
    const files = event.dataTransfer?.files;
    if (files?.length !== 1) {
      equipmentStatus(form, files?.length ? tr('每次请拖入一个素材文件。', 'Drop one asset file at a time.') : tr('请打开文件夹，拖入里面的素材文件。', 'Open the folder and drag an asset file from inside it.'), effect);
      return;
    }
    if (effect) void importNameEffect(form, files[0]); else void uploadProduct(form, files[0]);
  }
  async function reviewTask(work: () => Promise<void>) {
    if (reviewBusy) return;
    reviewBusy = true; syncReviewTools();
    try { await work(); } finally { reviewBusy = false; syncReviewTools(); }
  }
  function syncReviewTools(root: ParentNode | undefined = mounted?.main) {
    if (!root) return;
    const boxes = [...root.querySelectorAll<HTMLInputElement>('[data-community-review-select]')];
    boxes.forEach(box => { box.checked = reviewSelection.has(box.value); });
    const all = root.querySelector<HTMLInputElement>('[data-community-review-all]');
    if (all) { all.checked = Boolean(boxes.length) && boxes.slice(0, 50).every(box => box.checked); all.indeterminate = reviewSelection.size > 0 && !all.checked; }
    const count = root.querySelector('[data-review-count]');
    if (count) count.textContent = tr(`已选 ${reviewSelection.size} 个 · 每批最多 50 个`, `${reviewSelection.size} selected · up to 50`);
    root.querySelectorAll<HTMLButtonElement>('[data-action="community-batch-approve"], [data-action="community-batch-reject"]').forEach(button => { button.disabled = reviewBusy || !reviewSelection.size; });
    root.querySelectorAll<HTMLInputElement>('[data-community-review-select], [data-community-review-all]').forEach(field => { field.disabled = reviewBusy; });
    root.querySelectorAll<HTMLButtonElement>('[data-action="community-approve"], [data-action="community-reject"]').forEach(button => { button.disabled = reviewBusy; });
    root.querySelectorAll<HTMLButtonElement>('[data-action="community-management-board"]').forEach(button => { button.disabled = reviewBusy; });
  }
  function onChange(event: Event) {
    const field = event.target as HTMLInputElement;
    if (field instanceof HTMLInputElement && bannerEditor.change(field)) return;
    if (field.matches?.('[data-community-review-select], [data-community-review-all]')) {
      if (reviewBusy) return;
      const pending = readyData(manages.get(route().tab))?.queue.topics.filter(topic => topic.pending && (!managementBoard || topic.board === managementBoard)) || [];
      if (field.hasAttribute('data-community-review-all')) { reviewSelection.clear(); if (field.checked) pending.slice(0, 50).forEach(topic => reviewSelection.add(topic.id)); }
      else if (field.checked) { if (reviewSelection.size < 50) reviewSelection.add(field.value); else { field.checked = false; notify(tr('每批最多选择 50 个帖子。', 'Select up to 50 posts per batch.')); } }
      else reviewSelection.delete(field.value);
      syncReviewTools();
    } else if (field.matches?.('[data-community-item-upload]')) { if (field.form) void uploadProduct(field.form, field.files?.[0]); field.value = ''; }
    else if (field.matches?.('[data-community-effect-upload]')) { if (field.form) void importNameEffect(field.form, field.files?.[0]); field.value = ''; }
    else if (field.matches?.('[data-community-upload]') && field.files?.length) {
      if (field.closest('[data-inline-editor]')) return;
      void upload(field.files);
      field.value = '';
    } else if (field.name === 'tags' && field.checked && field.form) {
      const checked = field.form.querySelectorAll('input[name="tags"]:checked').length;
      if (checked > communityRules.tagMax) { field.checked = false; status(field.form, tr(`最多选 ${communityRules.tagMax} 个标签。`, `Up to ${communityRules.tagMax} tags.`)); }
      if (field.form.dataset.communityForm === 'topic') syncForms(mounted?.main || document);
    } else if (field.name === 'board' && !mounted?.ctx.simpleCompose && field.form?.dataset.communityForm === 'topic') {
      // Each board has its own fields: repaint the form for it; what was typed stays.
      composeBoard = field.value;
      writeDraft(draftKey('compose', location.hash), {
        board: field.value, title: valueOf(field.form, 'title'), body: valueOf(field.form, 'body'),
        tags: draftTags(field.form), bounty: Number(checkedOf(field.form, 'bounty') || 0),
      });
      paint();
    } else if (field.form?.dataset.communityForm === 'item') syncItemForm(field.form);
    else if (field.form?.dataset.communityForm === 'topic') {
      const form = field.form;
      if (!form.dataset.edit) writeDraft(draftKey('compose', location.hash), { board: checkedOf(form, 'board'), title: valueOf(form, 'title'), body: valueOf(form, 'body'), tags: draftTags(form), bounty: Number(checkedOf(form, 'bounty') || 0) });
      syncForms(mounted?.main || document);
    } else if (field.form?.dataset.communityForm === 'reply') {
      writeDraft(draftKey('reply', field.form.dataset.topic || route().id), { body: valueOf(field.form, 'body') });
    }
  }
  // A click outside the page closes the post menu without rebuilding the thread.
  function onDocumentClick(event: Event) {
    if (postMenu && mounted && !event.composedPath().includes(mounted.main)) setPostMenu(false);
  }
  const onDraftNavigation = (event: Event) => {
    if (!hasUnsavedDraft()) return;
    const link = (event.target as Element).closest?.<HTMLAnchorElement>('a[href^="#/"]');
    if (!link || link.getAttribute('href') === location.hash || link.target === '_blank' || link.hasAttribute('download')) return;
    event.preventDefault(); event.stopPropagation();
    if (profileWrite) { notify(tr('正在提交资料，请稍候。', 'Profile submission in progress. Please wait.')); return; }
    const href = link.getAttribute('href') || '';
    if (typeof window.confirm === 'function' && !window.confirm(tr('还有未发布的内容，确定离开吗？', 'You have an unsent draft. Leave this page?'))) return;
    approvedNavigation = href;
    go(href);
  };
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasUnsavedDraft()) return;
    event.preventDefault();
    event.returnValue = tr('还有未发布的内容。', 'You have an unsent draft.');
  };
  const onHistoryNavigation = () => {
    if (restoringHistory) {
      if (location.hash === lastHash) restoringHistory = false;
      return;
    }
    if (!hasUnsavedDraft(lastHash) || location.hash === lastHash) return;
    if (approvedNavigation === location.hash) {
      return;
    }
    if (typeof window.confirm === 'function' && !window.confirm(tr('还有未发布的内容，确定离开吗？', 'You have an unsent draft. Leave this page?'))) {
      // A history traversal has already changed the hash. Move back to the
      // entry the draft belongs to; replaceState would overwrite that entry.
      restoringHistory = true;
      window.history.forward();
      return;
    }
    lastHash = location.hash;
  };

  function clearData(clearWrites = true) {
    profileReviewWrites.clear();
    activeVisitDone = ''; activeVisitPending = null; activeVisitRetryAt = 0;
    conventionConsent.close();
    profileDialog.close(); profileRequest++; legacyProfileOpened = false;
    convention = null;
    if (clearWrites) writeRequests.clear();
    releaseDocumentReading();
    bannerEditor.reset(); banners.clear(); bannerRequests.clear();
    browseRequest++;
    switchingBrowseMode = false;
    managementOpener = null;
    reviewBusy = false;
    reviewSelection.clear();
    managementBoard = ''; stewardCandidate = null; stewardLookupUid = ''; stewardLookupRequest++; stewardBusy = false; stewardEditingUid = null; stewardScopeDraft = null;
    checkinRequest++; stardustRequest++;
    levelExplorer.reset();
    badgeExplorer.reset();
    frameIdentity++; frameHighlightsPending.clear(); frameHighlights.clear(); listRequests.clear();
    summary = null; me = null; profile = null; profileWrite = null; moderationContacts = null; checkin = null; bookmarks = null; shop = null; shopMine = null; rank = null; headerKey = '';
    stardusts.clear(); memberPages.clear(); memberProfileEpochs.clear(); inboxes.clear(); manages.clear(); manageRequests.clear(); lists.clear(); threads.clear(); lastHash = '';
    deleting = null; itemEditing = null; rejecting = null; shippingOrder = null; redeeming = null; delivery = null;
  }
  async function setBrowsing(reader: boolean) {
    if (switchingBrowseMode) return;
    if (!communityManagementRole(readyData(me))) {
      notify(tr('只有作者和版主可以切换浏览身份。', 'Only owners and moderators can switch browsing perspectives.'));
      return;
    }
    if (writeRequests.hasPending() || [...businessWrites.values()].includes(frameIdentity)) {
      notify(tr('还有提交尚未确认，请先重试原操作并确认结果，再切换身份。', 'A submission is still unconfirmed. Retry it and confirm the result before switching identities.'));
      return;
    }
    // Existing-content edits and product forms have no independent saved
    // draft. Do not discard them when their write permissions disappear.
    if (profileDialog.opened() && hasUnsavedDraft() || reader && (bannerEditor.dirty() || bannerEditor.state().busy || mounted?.main.querySelector('form[data-community-form="topic"][data-edit], form[data-community-form="reply-edit"], form[data-community-form="item"]'))) {
      notify(tr('请先完成或取消当前编辑，再切换浏览身份。', 'Finish or cancel the current edit before switching perspectives.'));
      return;
    }
    let identity = frameIdentity;
    let operation = ++browseRequest;
    switchingBrowseMode = true;
    try {
      await send('browse-mode', { reader });
      if (identity !== frameIdentity) return;
      // Switching is allowed only after writes are confirmed. Keep request
      // ownership intact; the writer reconciles the next reader identity.
      clearData(false);
      identity = frameIdentity;
      operation = browseRequest;
      switchingBrowseMode = true;
      await loadMe();
      if (identity !== frameIdentity) return;
      // Switching perspective never opens the workspace. On public pages keep
      // the current route, drafts and scroll; leaving a workspace returns home.
      if (route().view === 'manage') navigate('#/community/home');
      else await refresh();
      if (identity === frameIdentity) notify(reader ? tr('已切换为读者视角。', 'Reader perspective enabled.') : tr('已返回管理身份。', 'Management perspective restored.'));
    } catch (error) { if (identity === frameIdentity) notify(message(error)); }
    finally {
      if (operation === browseRequest) {
        switchingBrowseMode = false;
        if (identity === frameIdentity && route().view === 'edit') paint();
      }
    }
  }
  return {
    setBrowsing,
    html,
    frameHTML: (ctx: CommunityContext) => {
      const current = route();
      const scope = current.view === 'board' ? current.board : '';
      const activityBoard = current.view === 'board' || current.view === 'new' ? current.board
        : current.view === 'post' || current.view === 'edit' ? readyData(threads.get(current.id))?.topic.board || '' : '';
      const visibleMembers = members(ctx);
      const list: CommunityLoad<CommunityListing> = scope === 'vip' && !visibleMembers
        ? { state: 'error', status: 403, message: '' } : highlightsFor(scope);
      return `<div data-frame-highlights-state="${list.state}" data-frame-board="${ctx.esc(activityBoard)}">` + communityHomeHTML({ t: ctx.t, esc: ctx.esc, icons: ctx.icons,
        summary: summary || loading, list, sort: 'active', members: visibleMembers, me, activityBoard, showTopicCovers: ctx.simpleCompose })
        + communityFrameBannersHTML(scope === 'vip' && !visibleMembers ? { state: 'error', status: 403, message: '' } : banners.get(scope || 'home') || loading, ctx, scope || 'home') + '</div>';
    },
    // What the header needs (bell, account menu, check-in dot); null until it is read.
    me: () => readyData(me),
    // Called after each render of a community page; returns the cleanup for the next render.
    mount(main: HTMLElement, ctx: CommunityContext) {
      mounted = { main, ctx };
      paintedAccount = draftIdentity();
      main.addEventListener('click', onClick);
      main.addEventListener('submit', onSubmit);
      main.addEventListener('input', onInput);
      main.addEventListener('change', onChange);
      main.addEventListener('keydown', onKeydown);
      main.addEventListener('pointermove', onPointer);
      main.addEventListener('pointerdown', onActiveInteraction, { passive: true });
      main.addEventListener('keydown', onActiveInteraction);
      document.addEventListener('visibilitychange', onActiveVisibility);
      window.addEventListener('focus', onActiveVisibility);
      document.addEventListener('click', onDocumentClick);
      document.addEventListener('dragenter', onEquipmentDrag);
      document.addEventListener('dragover', onEquipmentDrag);
      document.addEventListener('dragleave', onEquipmentLeave);
      document.addEventListener('drop', onEquipmentDrop);
      document.addEventListener('click', onDraftNavigation, true);
      window.addEventListener('beforeunload', onBeforeUnload);
      window.addEventListener('scroll', onDocumentReadingScroll, { passive: true });
      window.addEventListener('hashchange', onHistoryNavigation, true);
      window.addEventListener('popstate', onHistoryNavigation, true);
      if (location.hash !== lastHash) {
        legacyProfileOpened = false;
        stewardCandidate = null; stewardLookupUid = ''; stewardLookupRequest++;
      }
      syncForms(main);
      paint();
      // Re-render for language or identity changes reuses the data; a new route refreshes it.
      if (location.hash !== lastHash) {
        if (approvedNavigation && approvedNavigation !== location.hash) approvedNavigation = '';
        lastHash = location.hash;
        reporting = null; editingReply = null; quoting = null; postMenu = false; deleting = null; moving = false; retagging = false;
        redeeming = null; delivery = null; muting = false; itemEditing = null; shippingOrder = null; rejecting = null; reviewSelection.clear(); composeBoard = null; replySort = 'floor';
        // A persistent frame owns its center-only transition; do not replay the page rise.
        main.classList.remove('community-entering');
        void refresh();
      }
      return () => {
        conventionConsent.close();
        profileDialog.close();
        releaseDocumentReading();
        restoreManagementBackground();
        for (const editor of editors.values()) editor.destroy();
        editors.clear();
        for (const control of selects.values()) control.dispose();
        selects.clear();
        main.removeEventListener('click', onClick);
        main.removeEventListener('submit', onSubmit);
        main.removeEventListener('input', onInput);
        main.removeEventListener('change', onChange);
        main.removeEventListener('keydown', onKeydown);
        main.removeEventListener('pointermove', onPointer);
        main.removeEventListener('pointerdown', onActiveInteraction);
        main.removeEventListener('keydown', onActiveInteraction);
        document.removeEventListener('visibilitychange', onActiveVisibility);
        window.removeEventListener('focus', onActiveVisibility);
        document.removeEventListener('click', onDocumentClick);
        document.removeEventListener('dragenter', onEquipmentDrag);
        document.removeEventListener('dragover', onEquipmentDrag);
        document.removeEventListener('dragleave', onEquipmentLeave);
        document.removeEventListener('drop', onEquipmentDrop);
        clearEquipmentDrag();
        document.removeEventListener('click', onDraftNavigation, true);
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.removeEventListener('scroll', onDocumentReadingScroll);
        window.removeEventListener('hashchange', onHistoryNavigation, true);
        window.removeEventListener('popstate', onHistoryNavigation, true);
        for (const timer of confirmTimers) clearTimeout(timer);
        confirmTimers.clear();
        clearTimeout(searchTimer);
        if (mounted?.main === main) mounted = null;
        // Leaving the community altogether ends the entrance at once.
        main.classList.remove('community-entering');
        // Leaving for another page: coming back to this one refreshes it.
        if (location.hash !== lastHash) {
          const previous = communityRoute(lastHash), current = route();
          if (previous.view !== 'manage' || current.view !== 'manage' || !['queue', 'reports'].includes(previous.tab) || !['queue', 'reports'].includes(current.tab)) managementBoard = '';
          stewardCandidate = null; stewardLookupUid = ''; stewardLookupRequest++; stewardEditingUid = null; stewardScopeDraft = null;
          reviewSelection.clear();
          lastHash = '';
        }
      };
    },
    // Signing in or out changes what the community shows.
    clear: clearData,
  };
}
