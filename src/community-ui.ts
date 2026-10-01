// 社区页面的数据和交互：读接口、排序、搜索、加载更多、发帖（按版块类型）、编辑、回复（引用、@、排序）、
// 赞、收藏、感谢、采纳、举报、删除、悬赏、提示词解锁、资源投票、付费置顶和高亮、签到和补签、星尘明细、
// 兑换所、关注、通知，以及站长和协管的置顶、精华、锁帖、移动、审核、禁言、举报处理、发货和上架。
// 页面 HTML 由 community.ts、community-post.ts 和 community-pages.ts 生成；这里先用缓存立即渲染，再在路由变化时刷新。
import {
  communityRoute, communityHomeHTML, communityBoardsHTML, communityBoardHTML, communityTagHTML, communityBookmarksHTML,
  communityBodyHTML, communityRules, communitySearchLimit, isCommunitySort, boardHref, postHref, readyData, imageLimit,
} from './community.mjs';
import type {
  CommunityLoad, CommunityListing, CommunitySort, CommunitySummary, CommunityRoute, CommunityMe, Escape, Translate,
} from './community.ts';
import { communityPostHTML, communityComposeHTML, communityLimits, bodyLimits, composePreviewHTML, editingFrom } from './community-post.mjs';
import type { CommunityThread, CommunityUpload, CommunityTarget, CommunityReplySort } from './community-post.ts';
import {
  communityCheckinHTML, communityStardustHTML, communityShopHTML, communityShopMineHTML, communityRankHTML, communityMemberHTML,
  communityInboxHTML, communityRulesHTML, communityManageHTML,
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
};
type Options = { request?: typeof fetch; navigate?: (hash: string) => void };
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

// Phone photos are often larger than the 2 MB upload limit: shrink them in the
// browser first (JPEG, longest side 2560, lower quality if still too large).
async function shrinkImage(file: File): Promise<Blob> {
  if (file.size <= communityRules.imageBytes || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    for (const [side, quality] of [[2560, 0.86], [2048, 0.8], [1600, 0.75]] as const) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/jpeg', quality));
      if (blob && blob.size <= communityRules.imageBytes) return blob;
    }
  } catch { /* the server explains what went wrong */ }
  return file;
}

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
  field.focus();
  field.setSelectionRange(start + from, start + to);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

export function createCommunityUI({ request = (...args) => fetch(...args), navigate: go = (hash) => { location.hash = hash; } }: Options = {}) {
  let sort: CommunitySort = 'active';
  let summary: CommunityLoad<CommunitySummary> | null = null;
  let me: CommunityLoad<CommunityMe> | null = null;
  let checkin: CommunityLoad<CommunityCheckin> | null = null;
  let checkinMonth = '';
  let bookmarks: CommunityLoad<CommunityListing> | null = null;
  let shop: CommunityLoad<CommunityShop> | null = null;
  let shopMine: CommunityLoad<CommunityShopMine> | null = null;
  let rank: CommunityLoad<CommunityRank> | null = null;
  let flow: CommunityFlow = 'all';
  const stardusts = new Map<CommunityFlow, CommunityLoad<CommunityStardust>>();
  const memberPages = new Map<string, CommunityLoad<CommunityMember>>();
  const inboxes = new Map<string, CommunityLoad<CommunityInbox>>();
  const manages = new Map<string, CommunityLoad<CommunityManage>>();
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
  // The board picked in the compose form (null: the one in the address).
  let composeBoard: string | null = null;
  let uploads: CommunityUpload[] = [];
  let uploadsFor = '';
  let mounted: { main: HTMLElement; ctx: CommunityContext } | null = null;
  let lastHash = '';
  let approvedNavigation = '';
  let restoringHistory = false;
  let headerKey = '';
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  // Drafts are deliberately text-only. Storage can be disabled or quota-limited in
  // private browsing, so every access is best-effort and never blocks the editor.
  const draftPrefix = 'sansphase:community:draft:';
  const memoryDrafts = new Map<string, string>();
  const storage = () => { try { return window.localStorage; } catch { return null; } };
  const draftKey = (kind: 'compose' | 'reply', id: string) => `${draftPrefix}${kind}:${id}`;
  const readDraft = <T>(key: string): T | null => {
    try { const raw = memoryDrafts.get(key) || storage()?.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { const raw = memoryDrafts.get(key); return raw ? JSON.parse(raw) as T : null; }
  };
  const writeDraft = (key: string, value: unknown) => { const raw = JSON.stringify(value); memoryDrafts.set(key, raw); try { storage()?.setItem(key, raw); } catch { /* storage is optional */ } };
  const removeDraft = (key: string) => { memoryDrafts.delete(key); try { storage()?.removeItem(key); } catch { /* storage is optional */ } };
  type SavedComposeDraft = { board: string; title: string; body: string; tags: string[]; bounty: number };
  const composeDraft = (current = route()) => current.view === 'new' ? readDraft<SavedComposeDraft>(draftKey('compose', location.hash)) : null;
  const draftHasText = (value: SavedComposeDraft | { body: string } | null) => Boolean(value && (value.body.trim() || ('title' in value && value.title.trim()) || ('tags' in value && value.tags.length) || ('bounty' in value && value.bounty)));
  const hasUnsavedDraft = (hash = location.hash) => {
    const current = communityRoute(hash);
    if (current.view === 'new') return draftHasText(readDraft<SavedComposeDraft>(draftKey('compose', hash)));
    if (current.view === 'post') return draftHasText(readDraft<{ body: string }>(draftKey('reply', current.id)));
    return false;
  };
  const draftTags = (form: Form) => [...form.querySelectorAll<HTMLInputElement>('input[name="tags"]:checked')].map(item => item.value).slice(0, communityRules.tagMax);
  const navigate = (hash: string) => {
    go(hash);
  };

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try { response = await request('/api/community/' + path, { credentials: 'same-origin', ...init }); }
    catch { throw Object.assign(new Error('网络连接失败，请稍后重试。'), { status: 0 }); }
    const value = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw Object.assign(new Error(value.error || '社区暂时无法读取。'), { status: response.status });
    return value as T;
  }
  const send = <T>(path: string, body: object = {}) => api<T>(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reader-Request': '1' }, body: JSON.stringify(body),
  });
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

  const scopeOf = (current = route()) => current.view === 'board' ? current.board : current.view === 'tag' ? `tag:${current.id}` : '';
  const queryOf = (scope: string) => queries.get(scope) || '';
  const listKey = (scope: string) => `${scope}|${sort}|${queryOf(scope)}`;
  const listPath = (scope: string, page: number) => {
    const query = queryOf(scope);
    const where: Record<string, string> = scope.startsWith('tag:') ? { tag: scope.slice(4) } : scope ? { board: scope } : {};
    return `topics?${new URLSearchParams({ ...where, ...(query ? { q: query } : {}), sort, page: String(page) })}`;
  };
  const memberKey = (uid: string, tab: string) => `${uid}|${tab}`;

  async function loadSummary() { summary = await load('summary', summary); }
  async function loadMe() {
    me = await load('me', me);
    const data = readyData(me);
    const key = data ? [data.name, data.uid, data.avatar, data.frame, data.level, data.steward, data.mod, data.balance, data.checkedIn, data.unread.all].join('|') : '';
    if (key !== headerKey) { headerKey = key; mounted?.ctx.headerChanged?.(); }
  }
  async function loadCheckin() { checkin = await load(`checkin${checkinMonth ? `?month=${checkinMonth}` : ''}`, checkin); }
  async function loadBookmarks() { bookmarks = await load('bookmarks', bookmarks); }
  async function loadShop() { shop = await load('shop', shop); }
  async function loadShopMine() { shopMine = await load('shop/mine', shopMine); }
  async function loadRank() { rank = await load('rank', rank); }
  async function loadStardust() { stardusts.set(flow, await load(`stardust${flow === 'all' ? '' : `?flow=${flow}`}`, stardusts.get(flow))); }
  async function loadMember(uid: string, tab: string) { const key = memberKey(uid, tab); memberPages.set(key, await load(`members/${enc(uid)}?tab=${enc(tab)}`, memberPages.get(key))); }
  async function loadInbox(tab: string) { inboxes.set(tab, await load(`inbox?tab=${enc(tab)}`, inboxes.get(tab))); }
  async function loadManage(tab: string) { manages.set(tab, await load(`manage?tab=${enc(tab)}`, manages.get(tab))); }
  // The latest request per list wins: a refresh that finishes after "load
  // more" must not replace the longer list with its first page.
  const listRequests = new Map<string, object>();
  const claim = (key: string) => { const token = {}; listRequests.set(key, token); return () => listRequests.get(key) === token; };
  async function loadList(scope: string) {
    const key = listKey(scope), current = claim(key);
    try { const data = await api<CommunityListing>(listPath(scope, 1)); if (current()) lists.set(key, { state: 'ready', data }); }
    catch (error) { if (current()) lists.set(key, settle(lists.get(key), error)); }
  }
  async function loadThread(id: string) { threads.set(id, await load(`topics/${enc(id)}`, threads.get(id))); }
  const members = () => Boolean(mounted?.ctx.members);
  function loadsFor(current: CommunityRoute): Array<() => Promise<void>> {
    const page = ((): Array<() => Promise<void>> => {
      switch (current.view) {
        case 'home': return [loadSummary, () => loadList('')];
        case 'boards': return [loadSummary];
        case 'board': return current.board === 'vip' && !members() ? [loadSummary] : [loadSummary, () => loadList(current.board)];
        case 'tag': return [() => loadList(`tag:${current.id}`)];
        case 'post': case 'edit': return [() => loadThread(current.id)];
        case 'checkin': return [loadCheckin];
        case 'bookmarks': return [loadBookmarks];
        case 'manage': return [() => loadManage(current.tab)];
        case 'member': return [() => loadMember(current.id, current.tab)];
        case 'stardust': return [loadStardust];
        case 'inbox': return [() => loadInbox(current.tab)];
        case 'shop': return [current.tab === 'mine' ? loadShopMine : loadShop];
        case 'rank': return [loadRank];
        default: return [];
      }
    })();
    return current.view === 'unknown' || current.view === 'landing' ? page : [...page, loadMe];
  }
  async function refresh(current = route()) {
    const hash = location.hash;
    await Promise.all(loadsFor(current).map(run => run()));
    if (location.hash === hash) paint();
  }
  // Reloads what the current page shows, then repaints.
  async function reload(...extra: Array<() => Promise<void>>) {
    await Promise.all([...loadsFor(route()), ...extra].map(run => run()));
    paint();
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
  function html(ctx: CommunityContext) {
    const current = route();
    const common = { t: ctx.t, esc: ctx.esc, icons: ctx.icons, ownerAvatar: ctx.ownerAvatar ?? null };
    const viewer = readyData(me);
    const savedCompose = draftComposeValues(current);
    if (current.view === 'new' && composeBoard === null && !current.board && savedCompose?.board) composeBoard = savedCompose.board;
    switch (current.view) {
      case 'home': return communityHomeHTML({ ...common, summary: summary || loading, list: lists.get(listKey('')) || loading, sort, query: queryOf(''), members: ctx.members, me });
      case 'boards': return communityBoardsHTML({ ...common, summary: summary || loading, members: ctx.members });
      case 'board': return communityBoardHTML({ ...common, board: current.board, summary: summary || loading, list: lists.get(listKey(current.board)) || loading, sort, query: queryOf(current.board), members: ctx.members, me: viewer });
      case 'tag': return communityTagHTML({ ...common, tag: current.id, list: lists.get(listKey(`tag:${current.id}`)) || loading, sort, query: queryOf(`tag:${current.id}`), me: viewer });
      case 'new': return communityComposeHTML({ ...common, board: composeBoard ?? current.board, members: ctx.members, me: viewer, uploads: composeUploads(current, null) });
      case 'edit': {
        const thread = threads.get(current.id);
        const asEdit = (markup: string) => markup.replace('data-community="post"', 'data-community="edit"');
        if (thread?.state !== 'ready') return asEdit(communityPostHTML({ ...common, thread: thread || loading }));
        if (!thread.data.topic.canEdit) return asEdit(communityPostHTML({ ...common, thread: { state: 'error', status: 403, message: ctx.t('这个帖子已经过了可以编辑的时间，或者不是你发的。', 'This post can no longer be edited, or is not yours.') } }));
        return communityComposeHTML({ ...common, board: thread.data.topic.board, members: ctx.members, me: viewer, uploads: composeUploads(current, thread.data), editing: editingFrom(thread) });
      }
      case 'post': return communityPostHTML({ ...common, thread: threads.get(current.id) || loading, me: viewer, reporting, editingReply, menuOpen: postMenu, deleting, moving, retagging, quoting, replySort });
      case 'checkin': return communityCheckinHTML({ ...common, checkin: checkin || loading });
      case 'bookmarks': return communityBookmarksHTML({ ...common, list: bookmarks || loading });
      case 'manage': return communityManageHTML({ ...common, manage: manages.get(current.tab) || loading, tab: current.tab, itemEditing, shippingOrder, rejecting });
      case 'member': return communityMemberHTML({ ...common, member: memberPages.get(memberKey(current.id, current.tab)) || loading, me: viewer, muting });
      case 'stardust': return communityStardustHTML({ ...common, stardust: stardusts.get(flow) || loading, tab: current.tab });
      case 'inbox': return communityInboxHTML({ ...common, inbox: inboxes.get(current.tab) || loading, tab: current.tab, me: viewer });
      case 'shop': return current.tab === 'mine'
        ? communityShopMineHTML({ ...common, mine: shopMine || loading, me: viewer, delivery })
        : communityShopHTML({ ...common, shop: shop || loading, tab: current.tab, me: viewer, redeeming, delivery });
      case 'rank': return communityRankHTML({ ...common, rank: rank || loading, me: viewer });
      case 'rules': return communityRulesHTML({ ...common, me: viewer });
      default: return null;
    }
  }

  // Replace the page in place, keeping what the visitor typed, open previews and where focus was.
  function paint() {
    if (!mounted) return;
    const section = mounted.main.querySelector<HTMLElement>('[data-community]');
    const markup = html(mounted.ctx);
    if (!section || markup === null) return;
    const template = document.createElement('template');
    template.innerHTML = markup;
    const next = template.content.firstElementChild as HTMLElement;
    for (const field of section.querySelectorAll<Field>('input[name], textarea[name], select[name]')) {
      const form = field.closest('form')?.dataset.communityForm;
      const choice = field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox');
      const twin = [...next.querySelectorAll<Field>(`form[data-community-form="${form}"] [name="${field.name}"]`)]
        .find(item => !choice || item.value === field.value);
      if (!twin || (twin instanceof HTMLInputElement && twin.type === 'file')) continue;
      if (choice) (twin as HTMLInputElement).checked = (field as HTMLInputElement).checked;
      else twin.value = field.value;
    }
    const previews = [...section.querySelectorAll<HTMLElement>('[data-action="community-md-preview"][aria-pressed="true"]')].map(button => button.dataset.for || '');
    const active = document.activeElement as HTMLInputElement | null;
    const caret = active && 'selectionStart' in active && active.selectionStart !== null ? [active.selectionStart, active.selectionEnd ?? active.selectionStart] as const : null;
    const data = active?.dataset;
    const focusSelector = active && section.contains(active)
      ? active.id ? `[id=${quoted(active.id)}]`
        : data?.action ? `[data-action=${quoted(data.action)}]${data.sort ? `[data-sort=${quoted(data.sort)}]` : ''}${data.kind ? `[data-kind=${quoted(data.kind)}]` : ''}${data.id ? `[data-id=${quoted(data.id)}]` : ''}${data.value ? `[data-value=${quoted(data.value)}]` : ''}` : ''
      : '';
    section.replaceWith(next);
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
    const focused = focusSelector ? next.querySelector<HTMLInputElement>(focusSelector) : null;
    focused?.focus({ preventScroll: true });
    if (focused && caret) try { focused.setSelectionRange(...caret); } catch { /* not a text field */ }
  }

  function count(field: HTMLInputElement | HTMLTextAreaElement) {
    const output = field.form?.querySelector(`[data-count-for="${field.name}"]`);
    if (output && field.maxLength > 0) output.textContent = `${[...field.value].length} / ${field.maxLength}`;
  }
  function autosize(field: HTMLInputElement | HTMLTextAreaElement) {
    if (!(field instanceof HTMLTextAreaElement) || !field.form?.matches('form[data-community-form="topic"], form[data-community-form="reply"], form[data-community-form="reply-edit"]')) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, Math.floor(window.innerHeight * 0.5))}px`;
  }
  // Form parts that follow other fields: the unlock price row and the list preview while composing.
  function syncForms(root: ParentNode) {
    const form = root.querySelector<Form>('form[data-community-form="topic"]');
    if (!form || !mounted) return;
    const mode = (form.querySelector('input[name="promptMode"]:checked') as HTMLInputElement | null)?.value;
    const row = form.querySelector<HTMLElement>('[data-price-row]');
    if (row) row.hidden = mode !== 'paid';
    const price = form.elements.namedItem('promptPrice') as HTMLInputElement | null;
    const output = form.querySelector('[data-price-output]');
    if (price && output) output.textContent = tr(`${price.value} 星尘`, `${price.value} stardust`);
    const preview = mounted.main.querySelector<HTMLElement>('[data-compose-preview]');
    if (preview) {
      const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value || '';
      const board = (form.querySelector('input[name="board"]:checked') as HTMLInputElement | null)?.value || '';
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
      preview.innerHTML = communityBodyHTML(field.value, mounted.ctx.esc, thread?.mentions || {}) || `<p class="community-muted">${tr('还没有内容。', 'Nothing yet.')}</p>`;
    }
    preview.hidden = !on;
    field.hidden = on;
  }
  function status(form: Form, text: string) {
    const line = form.querySelector('.community-form-status');
    if (line) line.textContent = text;
  }
  function invalid(form: Form, field: Element | null, text: string) {
    status(form, text);
    form.querySelectorAll('[aria-invalid]').forEach(item => item.removeAttribute('aria-invalid'));
    field?.setAttribute('aria-invalid', 'true');
    (field as HTMLElement | null)?.focus();
    return false;
  }
  const fieldOf = (form: Form, name: string) => form.elements.namedItem(name) as HTMLInputElement | null;
  const valueOf = (form: Form, name: string) => fieldOf(form, name)?.value || '';
  const checkedOf = (form: Form, name: string) => (form.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement | null)?.value || '';
  function checkText(form: Form, name: string, [min, max]: readonly [number, number], label: [string, string]) {
    const field = fieldOf(form, name);
    const size = length(field?.value || '');
    if (size < min) return invalid(form, field, tr(`${label[0]}至少 ${min} 个字。`, `${label[1]} needs at least ${min} characters.`));
    if (size > max) return invalid(form, field, tr(`${label[0]}最多 ${max} 个字。`, `${label[1]} can be at most ${max} characters.`));
    return true;
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
      // The guidelines must be accepted before the first post.
      if ((error as ApiError).status === 428) form.querySelector<HTMLInputElement>('input[name="agree"]')?.focus();
    }
    finally { if (button?.isConnected) { button.disabled = false; button.innerHTML = label; } }
  }
  const earned = (amount?: number) => { if (amount) notify(tr(`+${amount} 星尘`, `+${amount} stardust`)); };
  const level = () => { const data = readyData(me); return data ? (data.owner || data.steward ? 4 : data.level ?? 0) : 0; };

  async function submitTopic(form: Form) {
    const board = checkedOf(form, 'board');
    if (!board) return invalid(form, form.querySelector('input[name="board"]'), tr('先选版块。', 'Choose a board first.'));
    const moment = board === 'moments';
    if (!moment && !checkText(form, 'title', communityLimits.title, ['标题', 'The title'])) return;
    if (!checkText(form, 'body', bodyLimits(board), moment ? ['内容', 'The text'] : ['正文', 'The post'])) return;
    if (uploads.some(upload => upload.state === 'uploading')) return status(form, tr('图片还在上传，请稍等。', 'Images are still uploading.'));
    const images = board === 'tools' ? [] : uploads.filter(upload => upload.state === 'ready' && upload.id).map(upload => upload.id!);
    if (board === 'showcase' && !images.length) return invalid(form, form.querySelector('[data-community-upload]'), tr('作品帖至少要有 1 张图。', 'A work needs at least one image.'));
    if (board === 'showcase' && !length(valueOf(form, 'tools'))) return invalid(form, fieldOf(form, 'tools'), tr('请写上用了哪些工具。', 'Name the tools you used.'));
    if (board === 'tools' && !/^https?:\/\/\S+\.\S+/.test(valueOf(form, 'url').trim())) return invalid(form, fieldOf(form, 'url'), tr('请填写正确的链接，以 http:// 或 https:// 开头。', 'Enter a link starting with http:// or https://.'));
    const agree = fieldOf(form, 'agree');
    if (agree && !agree.checked) return invalid(form, agree, tr('第一次发帖前请先阅读并同意社区公约。', 'Please agree to the guidelines before your first post.'));
    const payload = {
      board, title: moment ? '' : valueOf(form, 'title'), body: valueOf(form, 'body'), images,
      tags: [...form.querySelectorAll<HTMLInputElement>('input[name="tags"]:checked')].map(box => box.value),
      ...(board === 'showcase' ? { tools: valueOf(form, 'tools'), model: valueOf(form, 'model'), usage: valueOf(form, 'usage'), prompt: valueOf(form, 'prompt'), promptMode: checkedOf(form, 'promptMode') || 'public', promptPrice: Number(valueOf(form, 'promptPrice') || 0) } : {}),
      ...(board === 'tools' ? { url: valueOf(form, 'url').trim(), kind: valueOf(form, 'kind'), price: valueOf(form, 'price'), platform: valueOf(form, 'platform') } : {}),
      ...(board === 'qa' ? { bounty: Number(checkedOf(form, 'bounty') || 0) } : {}),
      ...(fieldOf(form, 'announce')?.checked ? { announce: true } : {}),
      ...(agree ? { agree: true } : {}),
    };
    const editing = form.dataset.edit;
    await busy(form, editing ? tr('正在保存…', 'Saving…') : tr('正在发布…', 'Publishing…'), async () => {
      if (editing) {
        await send(`topics/${enc(editing)}/edit`, payload);
        threads.delete(editing);
        uploadsFor = '';
        navigate(postHref(editing));
        return;
      }
      const result = await send<{ id: string; earned?: number; pending?: boolean }>('topics', payload);
      removeDraft(draftKey('compose', location.hash));
      form.reset();
      uploadsFor = '';
      composeBoard = null;
      if (result.pending) notify(tr('帖子已提交，站长审核通过后大家就能看到。', 'Submitted. Others will see it once it is approved.'));
      else earned(result.earned);
      void loadMe();
      navigate(postHref(result.id));
    });
  }
  async function submitReply(form: Form) {
    if (!checkText(form, 'body', communityLimits.reply, ['回复', 'A reply'])) return;
    const topic = form.dataset.topic || '';
    const field = form.elements.namedItem('body') as HTMLTextAreaElement;
    await busy(form, tr('正在发送…', 'Sending…'), async () => {
      const result = await send<{ id: string; earned?: number }>(`topics/${enc(topic)}/replies`, { body: field.value, ...(quoting ? { quote: quoting } : {}) });
      removeDraft(draftKey('reply', topic));
      field.value = '';
      quoting = null;
      earned(result.earned);
      await loadThread(topic);
      paint();
      const reply = mounted?.main.querySelector<HTMLElement>(`[id=${quoted(`reply-${result.id}`)}]`);
      reply?.scrollIntoView?.({ block: 'center' });
      reply?.focus({ preventScroll: true });
    });
  }
  async function submitReplyEdit(form: Form) {
    if (!checkText(form, 'body', communityLimits.reply, ['回复', 'A reply'])) return;
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
    const kind = form.dataset.kind === 'reply' ? 'reply' : 'topic', id = form.dataset.id || '';
    const topic = readyData(threads.get(currentThreadId()));
    await busy(form, tr('正在删除…', 'Deleting…'), async () => {
      await send(`${kind === 'topic' ? 'topics' : 'replies'}/${enc(id)}/delete`, { violation: Boolean(fieldOf(form, 'violation')?.checked), mute: Number(checkedOf(form, 'mute') || 0) });
      deleting = null;
      notify(tr('已删除。', 'Deleted.'));
      if (kind === 'topic') { threads.delete(id); navigate(topic ? boardHref(topic.topic.board) : '#/community/home'); }
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
    const goods = Boolean(fieldOf(form, 'address'));
    if (goods) {
      if (!length(valueOf(form, 'name'))) return invalid(form, fieldOf(form, 'name'), tr('请填写收件人。', 'Enter the recipient.'));
      if (!/^1[3-9]\d{9}$/.test(valueOf(form, 'phone').replace(/[\s-]/g, ''))) return invalid(form, fieldOf(form, 'phone'), tr('请填写正确的手机号，用于快递联系。', 'Enter a valid mobile number for the courier.'));
      if (length(valueOf(form, 'address')) < 5) return invalid(form, fieldOf(form, 'address'), tr('请填写完整的收货地址。', 'Enter the full address.'));
    }
    await busy(form, tr('正在兑换…', 'Redeeming…'), async () => {
      const result = await send<{ item: { name: string; kind: string } }>('shop/redeem', { item: id, ...(goods ? { shipping: { name: valueOf(form, 'name'), phone: valueOf(form, 'phone'), address: valueOf(form, 'address') } } : {}) });
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
    const id = form.dataset.id || '';
    const number = (name: string) => valueOf(form, name) === '' ? null : Number(valueOf(form, name));
    const payload = {
      cat: checkedOf(form, 'cat') || valueOf(form, 'cat'), name: valueOf(form, 'name'), description: valueOf(form, 'description'),
      price: number('price'), stock: number('stock'), limitPer: valueOf(form, 'limitPer') || null, limitN: number('limitN'),
      minLevel: number('minLevel') ?? 0, minDays: number('minDays') ?? 0, delivery: valueOf(form, 'delivery'), note: valueOf(form, 'note'),
      active: Boolean(fieldOf(form, 'active')?.checked),
    };
    await busy(form, tr('正在保存…', 'Saving…'), async () => {
      await send(id ? `manage/items/${enc(id)}` : 'manage/items', payload);
      itemEditing = null;
      notify(tr('已保存。', 'Saved.'));
      await reload();
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
    const id = form.dataset.id || '';
    const reason = checkedOf(form, 'reason');
    if (!reason) return invalid(form, form.querySelector('input[name="reason"]'), tr('请选择审核不通过的理由。', 'Choose a rejection reason.'));
    await busy(form, tr('正在处理…', 'Processing…'), async () => {
      await send(`manage/topics/${enc(id)}/reject`, { reason, note: valueOf(form, 'note').trim() });
      rejecting = null;
      notify(tr('已记录拒绝理由并通知作者。', 'The reason was recorded and the author was notified.'));
      await reload();
    });
  }

  const currentThreadId = () => { const current = route(); return current.view === 'post' ? current.id : ''; };
  async function reloadThread() {
    const id = currentThreadId();
    if (id) await loadThread(id);
    paint();
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
      mounted?.main.querySelector<HTMLElement>('form[data-community-form="delete"] input')?.focus();
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
    await act(button, async () => {
      const result = await send<{ likes?: number; bookmarks?: number }>(`${target}/${enc(button.dataset.id || '')}/${kind}`, { on });
      const thread = threads.get(currentThreadId());
      if (thread?.state === 'ready') {
        const item = target === 'topics' ? thread.data.topic : thread.data.replies.find(reply => reply.id === button.dataset.id);
        if (item && kind === 'like') Object.assign(item, { liked: on, likes: result.likes });
        if (kind === 'bookmark') Object.assign(thread.data.topic, { bookmarked: on, bookmarks: result.bookmarks });
      }
      paint();
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
      notify(tr(`签到成功，连签 ${result.streak} 天，+${result.reward} 星尘${result.bonus ? `（含连签奖励 ${result.bonus}）` : ''}`, `Checked in: ${result.streak}-day streak, +${result.reward} stardust`));
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
  async function resolve(button: HTMLButtonElement, uphold: boolean) {
    if (uphold && !confirmed(button, tr('确认删除内容', 'Confirm removal'))) return;
    await act(button, async () => {
      await send(`manage/reports/${enc(button.dataset.id || '')}`, { uphold });
      notify(uphold ? tr('举报成立，内容已删除。', 'Upheld; the content was removed.') : tr('已驳回。', 'Dismissed.'));
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
    const board = (mounted?.main.querySelector('input[name="board"]:checked') as HTMLInputElement | null)?.value || current.board || 'qa';
    const max = imageLimit(board, level());
    const chosen = [...files].slice(0, Math.max(0, max - uploads.length));
    if (chosen.length < files.length) notify(tr(`最多 ${max} 张图。`, `Up to ${max} images.`));
    const entries = chosen.map(file => ({ name: file.name, state: 'uploading' as CommunityUpload['state'] } as CommunityUpload));
    uploads.push(...entries);
    paint();
    await Promise.all(chosen.map(async (file, i) => {
      const entry = entries[i];
      try {
        const form = new FormData();
        form.append('file', await shrinkImage(file), file.name);
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
    const hash = location.hash;
    paint();
    await loadList(scope);
    if (location.hash === hash) paint();
  }

  async function loadMore() {
    const scope = scopeOf();
    const key = listKey(scope), current = lists.get(key);
    if (current?.state !== 'ready' || current.more) return;
    const latest = claim(key);
    lists.set(key, { ...current, more: true });
    paint();
    const known = new Set(current.data.items.map(item => item.id));
    try {
      const next = await api<CommunityListing>(listPath(scope, Math.floor(current.data.items.length / current.data.pageSize) + 1));
      if (!latest()) return;
      const added = next.items.filter(item => !known.has(item.id));
      lists.set(key, { state: 'ready', data: { ...next, items: [...current.data.items, ...added] } });
      paint();
      const link = added[0] && mounted?.main.querySelector<HTMLElement>(`.community-topic a[href=${quoted(postHref(added[0].id))}]`);
      link?.focus({ preventScroll: true });
    } catch {
      if (!latest()) return;
      lists.set(key, current);
      paint();
    }
  }

  // Opens a page-local panel and puts focus in it.
  function openPanel(selector: string) {
    paint();
    const panel = mounted?.main.querySelector<HTMLElement>(selector);
    panel?.scrollIntoView?.({ block: 'nearest' });
    // The first field, or the confirming button when there is nothing to fill in.
    (panel?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea') || panel?.querySelector<HTMLElement>('button[type="submit"], button'))?.focus({ preventScroll: true });
  }
  function setPostMenu(open: boolean, focusButton = false) {
    if (postMenu === open) return;
    postMenu = open;
    paint();
    if (open) mounted?.main.querySelector<HTMLElement>('#community-post-menu [role="menuitem"]')?.focus();
    else if (focusButton) mounted?.main.querySelector<HTMLElement>('[data-action="community-post-menu"]')?.focus();
  }

  function onClick(event: Event) {
    const target = (event.target as Element).closest<HTMLButtonElement>('[data-action^="community-"]');
    if (postMenu && !(event.target as Element).closest?.('.community-more-menu')) setPostMenu(false);
    if (!target || !mounted) return;
    const { action, id = '', kind } = target.dataset;
    switch (action) {
      case 'community-sort':
        if (!isCommunitySort(target.dataset.sort) || target.dataset.sort === sort) return;
        sort = target.dataset.sort;
        paint();
        // Not every browser focuses a clicked button; keep the place explicitly.
        mounted.main.querySelector<HTMLElement>(`[data-action="community-sort"][data-sort="${sort}"]`)?.focus({ preventScroll: true });
        void refresh();
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
      case 'community-delete-cancel': deleting = null; paint(); return;
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
        mounted.main.querySelector<HTMLTextAreaElement>('#community-reply-edit')?.focus();
        return;
      case 'community-edit-cancel': editingReply = null; paint(); return;
      case 'community-post-menu': setPostMenu(!postMenu); return;
      case 'community-pin': void topicAction(target, 'pin', { on: target.getAttribute('aria-pressed') !== 'true' }); return;
      case 'community-feature': void topicAction(target, 'feature', { on: target.getAttribute('aria-pressed') !== 'true' }); return;
      case 'community-lock': void topicAction(target, 'lock', { on: target.getAttribute('aria-pressed') !== 'true' }, target.getAttribute('aria-pressed') === 'true' ? tr('已解除锁定。', 'Unlocked.') : tr('已锁定。', 'Locked.')); return;
      case 'community-approve': void topicAction(target, 'approve', {}, tr('已通过审核。', 'Approved.')); return;
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
        if (!confirmed(target, target.dataset.violation === 'true' ? tr('确认按违规删除', 'Confirm removal') : tr('确认不通过', 'Confirm rejection'))) return;
        void act(target, async () => { await send(`${kind === 'reply' ? 'replies' : 'topics'}/${enc(id)}/delete`, { violation: target.dataset.violation === 'true' }); notify(tr('已处理。', 'Done.')); await reload(); });
        return;
      case 'community-move': postMenu = false; moving = true; retagging = false; openPanel('form[data-community-form="move"]'); return;
      case 'community-move-cancel': moving = false; paint(); return;
      case 'community-retag': postMenu = false; retagging = true; moving = false; openPanel('form[data-community-form="retag"]'); return;
      case 'community-retag-cancel': retagging = false; paint(); return;
      case 'community-reply-sort':
        if (target.dataset.sort !== 'floor' && target.dataset.sort !== 'likes') return;
        replySort = target.dataset.sort;
        paint();
        return;
      case 'community-quote':
        quoting = id;
        paint();
        mounted.main.querySelector<HTMLTextAreaElement>('#community-reply')?.focus();
        return;
      case 'community-unquote': quoting = null; paint(); mounted.main.querySelector<HTMLTextAreaElement>('#community-reply')?.focus(); return;
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
        if (field) applyMarkdown(field, target.dataset.md || '', tr);
        return;
      }
      case 'community-md-preview': togglePreview(target); return;
      case 'community-month':
        checkinMonth = target.dataset.month || '';
        void loadCheckin().then(paint);
        return;
      case 'community-makeup': {
        const data = readyData(checkin);
        const cost = data?.makeup.cards ? tr('用补签卡', 'use a card') : data?.makeup.free ? tr('免费', 'free') : tr(`${communityRules.makeupCost} 星尘`, `${communityRules.makeupCost} stardust`);
        if (!confirmed(target, tr(`补签？${cost}`, `Make up? ${cost}`))) return;
        void act(target, async () => { const result = await send<{ streak: number }>('checkin/makeup', { day: target.dataset.day }); notify(tr(`补签成功，连签 ${result.streak} 天。`, `Made up: ${result.streak}-day streak.`)); await reload(); });
        return;
      }
      case 'community-flow': {
        const value = target.dataset.flow;
        if (value !== 'all' && value !== 'in' && value !== 'out') return;
        flow = value;
        paint();
        void loadStardust().then(paint);
        return;
      }
      case 'community-redeem': redeeming = id; delivery = null; openPanel('form[data-community-form="redeem"]'); return;
      case 'community-redeem-cancel': redeeming = null; paint(); return;
      case 'community-equip':
        void act(target, async () => { await send('shop/equip', { kind: target.dataset.kind, ref: target.dataset.ref || null }); notify(target.dataset.ref ? tr('已换上。', 'Applied.') : tr('已取下。', 'Removed.')); await reload(); });
        return;
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
          await send('inbox/read', { id });
          inboxes.clear();
          if (href && href !== location.hash) navigate(href); else await reload();
        });
        return;
      }
      case 'community-agree':
        void act(target, async () => { await send('agree'); notify(tr('谢谢，你已同意社区公约。', 'Thanks for agreeing to the guidelines.')); await reload(); });
        return;
      case 'community-mute': muting = true; openPanel('form[data-community-form="mute"]'); return;
      case 'community-mute-cancel': muting = false; paint(); return;
      case 'community-steward':
        if (!confirmed(target, target.dataset.on === 'true' ? tr('确认任命', 'Confirm') : tr('确认撤销', 'Confirm'))) return;
        void act(target, async () => { await send(`members/${enc(target.dataset.uid || '')}/steward`, { on: target.dataset.on === 'true' }); notify(tr('已更新。', 'Updated.')); await reload(); });
        return;
      case 'community-lift':
        if (!confirmed(target, tr('确认解除', 'Confirm'))) return;
        void act(target, async () => { await send(`manage/sanctions/${enc(id)}/lift`); notify(tr('已解除禁言。', 'Mute lifted.')); await reload(); });
        return;
      case 'community-ship': shippingOrder = id; openPanel('form[data-community-form="ship"]'); return;
      case 'community-ship-cancel': shippingOrder = null; paint(); return;
      case 'community-reject': rejecting = id; openPanel('form[data-community-form="reject"]'); return;
      case 'community-reject-cancel': rejecting = null; paint(); return;
      case 'community-cancel-order':
        if (!confirmed(target, tr('确认取消并退回', 'Confirm cancel'))) return;
        void act(target, async () => { await send(`manage/orders/${enc(id)}/cancel`); notify(tr('已取消，星尘已退回。', 'Cancelled and refunded.')); await reload(); });
        return;
      case 'community-item-edit': itemEditing = { id: id || null }; openPanel('form[data-community-form="item"]'); return;
      case 'community-item-cancel': itemEditing = null; paint(); return;
      case 'community-uphold': void resolve(target, true); return;
      case 'community-dismiss': void resolve(target, false); return;
      case 'community-image-remove':
        uploads.splice(Number(target.dataset.index), 1);
        paint();
        return;
      case 'community-lightbox': openLightbox(target.dataset.src || '', target); return;
    }
  }
  // Ctrl+Enter (⌘+Enter on Mac) sends a reply or publishes a post; Escape closes the post menu.
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && postMenu) { event.preventDefault(); setPostMenu(false, true); return; }
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    const form = (event.target as Element).closest?.<Form>('form[data-community-form="reply"], form[data-community-form="topic"], form[data-community-form="reply-edit"]');
    if (!form) return;
    event.preventDefault();
    form.requestSubmit();
  }
  // Cards glow where the pointer is (demo "spot").
  function onPointer(event: PointerEvent) {
    const card = (event.target as Element).closest?.<HTMLElement>('.community-spot');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    card.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }
  // Entering a community page: blocks rise in order once; later repaints do not replay it.
  let enteringTimer: ReturnType<typeof setTimeout> | undefined;
  function enter(main: HTMLElement) {
    clearTimeout(enteringTimer);
    main.classList.add('community-entering');
    enteringTimer = setTimeout(() => main.classList.remove('community-entering'), 1500);
  }
  function onSubmit(event: Event) {
    const form = (event.target as Element).closest<Form>('form[data-community-form]');
    if (!form || !mounted) return;
    event.preventDefault();
    const handlers: Record<string, (form: Form) => unknown> = {
      search: item => search((item.elements.namedItem('q') as HTMLInputElement).value),
      topic: submitTopic, reply: submitReply, 'reply-edit': submitReplyEdit, report: submitReport, delete: submitDelete,
      move: submitMove, retag: submitRetag, redeem: submitRedeem, mute: submitMute, item: submitItem, ship: submitShip, reject: submitReject,
    };
    void handlers[form.dataset.communityForm || '']?.(form);
  }
  function onInput(event: Event) {
    const field = event.target as HTMLInputElement;
    if (!field.closest?.('form[data-community-form]')) return;
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
    if (form?.dataset.communityForm === 'topic' && !form.dataset.edit) {
      writeDraft(draftKey('compose', location.hash), {
        board: checkedOf(form, 'board'), title: valueOf(form, 'title'), body: valueOf(form, 'body'),
        tags: draftTags(form), bounty: Number(checkedOf(form, 'bounty') || 0),
      });
    } else if (form?.dataset.communityForm === 'reply') {
      writeDraft(draftKey('reply', form.dataset.topic || route().id), { body: valueOf(form, 'body') });
    }
    if (field.form?.dataset.communityForm === 'topic') syncForms(mounted?.main || document);
  }
  function onChange(event: Event) {
    const field = event.target as HTMLInputElement;
    if (field.matches?.('[data-community-upload]') && field.files?.length) {
      void upload(field.files);
      field.value = '';
    } else if (field.name === 'tags' && field.checked && field.form) {
      const checked = field.form.querySelectorAll('input[name="tags"]:checked').length;
      if (checked > communityRules.tagMax) { field.checked = false; status(field.form, tr(`最多选 ${communityRules.tagMax} 个标签。`, `Up to ${communityRules.tagMax} tags.`)); }
      if (field.form.dataset.communityForm === 'topic') syncForms(mounted?.main || document);
    } else if (field.name === 'board' && field.form?.dataset.communityForm === 'topic') {
      // Each board has its own fields: repaint the form for it; what was typed stays.
      composeBoard = field.value;
      writeDraft(draftKey('compose', location.hash), {
        board: field.value, title: valueOf(field.form, 'title'), body: valueOf(field.form, 'body'),
        tags: draftTags(field.form), bounty: Number(checkedOf(field.form, 'bounty') || 0),
      });
      paint();
    } else if (field.form?.dataset.communityForm === 'topic') {
      const form = field.form;
      if (!form.dataset.edit) writeDraft(draftKey('compose', location.hash), { board: checkedOf(form, 'board'), title: valueOf(form, 'title'), body: valueOf(form, 'body'), tags: draftTags(form), bounty: Number(checkedOf(form, 'bounty') || 0) });
      syncForms(mounted?.main || document);
    } else if (field.form?.dataset.communityForm === 'reply') {
      writeDraft(draftKey('reply', field.form.dataset.topic || route().id), { body: valueOf(field.form, 'body') });
    }
  }
  // A click outside the page closes the post menu. The path is the one the click had when it
  // started: the button that opened the menu is already replaced by the repaint.
  function onDocumentClick(event: Event) {
    if (postMenu && mounted && !event.composedPath().includes(mounted.main)) setPostMenu(false);
  }
  const onDraftNavigation = (event: Event) => {
    if (!hasUnsavedDraft()) return;
    const link = (event.target as Element).closest?.<HTMLAnchorElement>('a[href^="#/"]');
    if (!link || link.getAttribute('href') === location.hash || link.target === '_blank' || link.hasAttribute('download')) return;
    event.preventDefault(); event.stopPropagation();
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

  return {
    html,
    // What the header needs (bell, account menu, check-in dot); null until it is read.
    me: () => readyData(me),
    // Called after each render of a community page; returns the cleanup for the next render.
    mount(main: HTMLElement, ctx: CommunityContext) {
      mounted = { main, ctx };
      main.addEventListener('click', onClick);
      main.addEventListener('submit', onSubmit);
      main.addEventListener('input', onInput);
      main.addEventListener('change', onChange);
      main.addEventListener('keydown', onKeydown);
      main.addEventListener('pointermove', onPointer);
      document.addEventListener('click', onDocumentClick);
      document.addEventListener('click', onDraftNavigation, true);
      window.addEventListener('beforeunload', onBeforeUnload);
      window.addEventListener('hashchange', onHistoryNavigation, true);
      window.addEventListener('popstate', onHistoryNavigation, true);
      syncForms(main);
      paint();
      // Re-render for language or identity changes reuses the data; a new route refreshes it.
      if (location.hash !== lastHash) {
        if (approvedNavigation && approvedNavigation !== location.hash) approvedNavigation = '';
        lastHash = location.hash;
        reporting = null; editingReply = null; quoting = null; postMenu = false; deleting = null; moving = false; retagging = false;
        redeeming = null; delivery = null; muting = false; itemEditing = null; shippingOrder = null; rejecting = null; composeBoard = null; replySort = 'floor';
        enter(main);
        void refresh();
      }
      return () => {
        main.removeEventListener('click', onClick);
        main.removeEventListener('submit', onSubmit);
        main.removeEventListener('input', onInput);
        main.removeEventListener('change', onChange);
        main.removeEventListener('keydown', onKeydown);
        main.removeEventListener('pointermove', onPointer);
        document.removeEventListener('click', onDocumentClick);
        document.removeEventListener('click', onDraftNavigation, true);
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.removeEventListener('hashchange', onHistoryNavigation, true);
        window.removeEventListener('popstate', onHistoryNavigation, true);
        for (const timer of confirmTimers) clearTimeout(timer);
        confirmTimers.clear();
        clearTimeout(searchTimer);
        if (mounted?.main === main) mounted = null;
        // Leaving the community altogether ends the entrance at once.
        if (!['community', 'post'].includes(location.hash.replace(/^#\/?/, '').split('/')[0])) { clearTimeout(enteringTimer); main.classList.remove('community-entering'); }
        // Leaving for another page: coming back to this one refreshes it.
        if (location.hash !== lastHash) lastHash = '';
      };
    },
    // Signing in or out changes what the community shows.
    clear() {
      summary = null; me = null; checkin = null; bookmarks = null; shop = null; shopMine = null; rank = null; headerKey = '';
      stardusts.clear(); memberPages.clear(); inboxes.clear(); manages.clear(); lists.clear(); threads.clear(); lastHash = '';
    },
  };
}
