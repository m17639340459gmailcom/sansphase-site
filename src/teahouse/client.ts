import { io } from 'socket.io-client';
import { createIcons, Sun, Moon, House, Sparkles, Gift, Trophy, CircleHelp, Image, Box, Feather, Megaphone, Coffee, ArrowUpRight, LockKeyhole, PanelRight, ChevronRight, ChevronDown, ArrowDown, Smile, X, ArrowLeft, Plus, Pin, Pencil, UserRound, Star, Bell, Bookmark } from 'lucide';
import { prepareUploadImage } from '../upload-image.ts';
import { communityIconDefinition } from '../community-icon-policy.ts';
import { communityIconArtHTML } from '../community-icon-display.ts';
import { isTeahouseManager } from '../teahouse-types.ts';
import type { TeahouseActor, TeahouseAuthor, TeahouseAttachment, TeahouseMessage, TeahouseHistory, TeahouseSendInput, TeahouseAnnouncement, TeahouseAnnouncementInput } from '../teahouse-types.ts';
import { mergeMessages, createPendingSend, mayWithdraw, mayEditAnnouncement } from './client-state.ts';
import { createAccountMenu } from './account-menu.ts';

type Ack<T> = { ok: true; data: T } | { ok: false; error: string; status: number };
type View = 'list' | 'detail' | 'editor';
function el<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing tea room element: ${id}`);
  return value as T;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
}
const messageList = el('message-list'), messages = el('messages');
const composer = el<HTMLFormElement>('composer'), input = el<HTMLTextAreaElement>('message-input');
const sendButton = el<HTMLButtonElement>('send-button'), attachButton = el<HTMLButtonElement>('attach-button');
const imageInput = el<HTMLInputElement>('image-input'), attachmentTray = el('attachment-tray');
const historyButton = el<HTMLButtonElement>('load-history'), chatStatus = el('chat-status');
const emojiToggle = el<HTMLButtonElement>('emoji-toggle'), emojiPanel = el('emoji-panel');
const newMessages = el<HTMLButtonElement>('new-messages');
const accountMenu = createAccountMenu(el('account-entry'), el<HTMLButtonElement>('current-person'), el('account-menu'));
const imageDialog = el<HTMLDialogElement>('image-dialog'), lightboxImage = el<HTMLImageElement>('lightbox-image');
const announcementsDialog = el<HTMLDialogElement>('announcements-dialog'), announcementsOpen = el<HTMLButtonElement>('announcements-open');
const announcementEditor = el<HTMLFormElement>('announcement-editor');
const announcementTitleInput = el<HTMLInputElement>('announcement-title-input'), announcementBodyInput = el<HTMLTextAreaElement>('announcement-body-input');
const announcementPinInput = el<HTMLInputElement>('announcement-pin-input');
// Reconnection goes through HTTP identity verification. Socket.IO flushes its
// offline send buffer before `connect`, so its automatic reconnect is unsafe
// when the shared login cookie changed in another tab while we were offline.
const createSocket = () => io({ path: '/api/teahouse/socket.io', autoConnect: false, reconnection: false, withCredentials: true, forceNew: true });
let socket = createSocket(), socketAttempted = false;
const state = new Map<string, TeahouseMessage>(), messageNodes = new Map<string, HTMLElement>();
const announcementNodes = new Map<string, HTMLButtonElement>();
const memberNodes = new Map<string, HTMLLIElement>();
const purgedReaders = new Set<string>();
const visibleAuthor = (author: TeahouseAuthor) => author.kind !== 'reader' || !purgedReaders.has(author.id);
let actor: TeahouseActor | undefined, connected = false, revoked = false;
let serverClock = { time: 0, sampledAt: 0 };
let identityEpoch = 0, pageActive = true;
let replayTimer: ReturnType<typeof setTimeout> | undefined, replayInFlight = false, replayAgain = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined, retryDelay = 1000;
let initialized = false, replayCursor = 0, hasEarlier = false, loadingEarlier = false, syncRun = 0;
let sending = false, uploading = false, composing = false, followBottom = true;
let attachments: TeahouseAttachment[] = [], pendingSend: TeahouseSendInput | undefined;
let announcements: TeahouseAnnouncement[] = [], selectedAnnouncement = '', editingAnnouncement: TeahouseAnnouncement | undefined;
let announcementView: View = 'list', noticeSaving = false, noticeEventVersion = 0;
let uploadAbort = new AbortController();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const icons = () => createIcons({ icons: { Sun, Moon, House, Sparkles, Gift, Trophy, CircleHelp, Image, Box, Feather, Megaphone, Coffee, ArrowUpRight, LockKeyhole, PanelRight, ChevronRight, ChevronDown, ArrowDown, Smile, X, ArrowLeft, Plus, Pin, Pencil, UserRound, Star, Bell, Bookmark } });
// Preserve the server's time sample when the device clock is adjusted.
// Foreground and reconnect synchronization refresh the sample; the server
// remains authoritative for the actual five-minute withdrawal limit.
const now = () => serverClock.time + performance.now() - serverClock.sampledAt;
const own = (author: TeahouseAuthor) => actor?.kind === author.kind && actor.id === author.id;
const dateLabel = (date: string) => new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作暂时没有完成，请重试。';
function tell(text: string) {
  const toast = el('toast');
  clearTimeout(toastTimer); toast.textContent = text; toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}
class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
class IdentityChangedError extends Error {}
const accessKey = (value: TeahouseActor) => JSON.stringify([value.kind, value.id, value.role]);
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.method && init.method !== 'GET') headers.set('X-Reader-Request', '1');
  const response = await fetch(`/api/teahouse/${path}`, { credentials: 'same-origin', cache: 'no-store', ...init, headers });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '暂时无法连接茶室，请稍后重试。';
    throw new HttpError(error, response.status);
  }
  return body as T;
}
function ack<T>(event: string, payload: unknown): Promise<T> {
  if (!connected || !socket.connected || revoked) return Promise.reject(new Error('连接正在恢复，请稍后再试。'));
  const epoch = identityEpoch, sendingSocket = socket;
  return new Promise((resolve, reject) => {
    sendingSocket.timeout(12000).emit(event, payload, (error: Error | null, result: Ack<T>) => {
      if (epoch !== identityEpoch || !pageActive) { reject(new IdentityChangedError('登录身份已变化。')); return; }
      if (sendingSocket !== socket) { reject(new Error('连接已恢复，待确认内容已保留，请重试。')); return; }
      if (error) { reject(new Error('尚未收到服务器确认。内容已保留，点击重试不会重复发送。')); return; }
      if (!result.ok) { reject(new HttpError(result.error, result.status)); return; }
      resolve(result.data);
    });
  });
}
function syncComposer() {
  const locked = !connected || !socket.connected || revoked || !actor || actor.muted === true;
  input.disabled = locked || sending;
  attachButton.disabled = locked || sending || uploading || attachments.length >= 6;
  emojiToggle.disabled = locked || sending;
  sendButton.disabled = locked || sending || uploading || (!input.value.trim() && !attachments.length);
  sendButton.textContent = sending ? '发送中…' : uploading ? '处理图片…' : '发送';
  composer.setAttribute('aria-busy', String(sending || uploading));
}
function setStatus(text: string) { el('connection-status').textContent = text; }
function iconFor(author: TeahouseAuthor): HTMLElement | undefined {
  const definition = communityIconDefinition(author.icon);
  if (!definition) return;
  const wrapper = node('span', 'name-badge');
  wrapper.dataset.iconRef = definition.ref;
  wrapper.title = definition.name;
  wrapper.setAttribute('aria-label', definition.name);
  // Only an allowlisted catalogue definition enters the existing static art renderer.
  wrapper.innerHTML = communityIconArtHTML(definition, false);
  return wrapper;
}
function avatarFor(author: TeahouseAuthor): HTMLElement {
  const avatar = node('span', `avatar ${own(author) ? 'avatar-me' : 'avatar-sage'}`, Array.from(author.name)[0] || '人');
  avatar.dataset.avatarSignature = JSON.stringify([author.avatarUrl ?? '', Array.from(author.name)[0] ?? '']);
  if (author.avatarUrl) {
    try {
      const url = new URL(author.avatarUrl, location.origin);
      if (url.protocol === 'https:' || url.origin === location.origin) {
        const image = node('img'); image.src = url.href; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
        image.addEventListener('error', () => { image.remove(); }, { once: true });
        avatar.append(image);
      }
    } catch { /* Invalid historical avatars fall back to initials. */ }
  }
  avatar.setAttribute('aria-hidden', 'true');
  return avatar;
}
let actorSignature = '';
function renderActor() {
  if (!actor) return;
  const signature = JSON.stringify(actor);
  if (signature === actorSignature) return;
  actorSignature = signature;
  const person = el('current-person'), avatar = avatarFor(actor); avatar.classList.add('avatar-small');
  person.replaceChildren(avatar, node('strong', '', actor.name));
  const badge = iconFor(actor); if (badge) person.append(badge);
  const chevron = node('i'); chevron.dataset.lucide = 'chevron-down'; chevron.setAttribute('aria-hidden', 'true'); person.append(chevron);
  accountMenu.update(actor); icons();
  el('notice-role-current').textContent = actor.role === 'owner' ? '作者' : actor.role === 'general' ? '总版主' : actor.role === 'moderator' ? '版主' : '普通会员';
}
function isNearBottom() { return messageList.scrollHeight - messageList.clientHeight - messageList.scrollTop < 64; }
function scrollToEnd() { messageList.scrollTop = messageList.scrollHeight; newMessages.hidden = true; }
function createMessage(message: TeahouseMessage): HTMLElement {
  const article = node('article', `message${own(message.author) ? ' is-own' : ''}`); article.dataset.messageId = message.id; article.dataset.seq = String(message.seq);
  article.dataset.revision = String(message.revisionSeq);
  if (message.withdrawn) { article.classList.add('withdrawn-message'); article.append(node('span', 'message-time', '消息已撤回')); return article; }
  const content = node('div', 'message-content'), meta = node('div', 'message-meta');
  meta.append(node('strong', '', message.author.name));
  const badge = iconFor(message.author); if (badge) meta.append(badge);
  const time = node('time', 'message-time', new Date(message.createdAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }));
  time.dateTime = message.createdAt; time.title = dateLabel(message.createdAt); meta.append(time);
  if (actor && mayWithdraw(actor, message, now())) {
    const recall = node('button', 'message-recall', '撤回'); recall.type = 'button'; recall.dataset.recallId = message.id;
    recall.title = isTeahouseManager(actor) ? '撤回这条消息' : '发送后 5 分钟内可撤回'; meta.append(recall);
  }
  const bubble = node('div', 'message-bubble');
  if (message.text) bubble.append(node('p', 'message-text', message.text));
  if (message.attachments.length) {
    const media = node('div', 'message-media');
    for (const attachment of message.attachments) {
      const button = node('button', 'image-message'); button.type = 'button'; button.dataset.previewImage = attachment.url; button.setAttribute('aria-label', '放大查看图片');
      const image = node('img'); image.src = attachment.url; image.alt = '聊天图片'; image.decoding = 'async'; image.loading = 'lazy'; image.width = attachment.width; image.height = attachment.height;
      button.append(image); media.append(button);
    }
    bubble.append(media);
  }
  content.append(meta, bubble); article.append(avatarFor(message.author), content); return article;
}
/** Change only affected rows; leave decoded images, focus and the reading position intact. */
function applyMessages(incoming: readonly TeahouseMessage[], history = false) {
  const atBottom = !history && followBottom;
  const viewportTop = messageList.getBoundingClientRect().top;
  const anchor = [...messageNodes.values()].find(value => value.getBoundingClientRect().bottom > viewportTop);
  const anchorTop = anchor?.getBoundingClientRect().top;
  const previousHeight = messageList.scrollHeight;
  const changed = mergeMessages(state, incoming, purgedReaders);
  for (const message of changed) {
    const previous = messageNodes.get(message.id);
    if (previous && previous.dataset.revision === String(message.revisionSeq) && previous.classList.contains('withdrawn-message') === message.withdrawn) {
      // Identity hydration must not detach decoded message images or the bubble.
      const meta = previous.querySelector('.message-meta');
      const name = meta?.querySelector('strong'); if (name) name.textContent = message.author.name;
      const oldBadge = meta?.querySelector('.name-badge'), badge = iconFor(message.author);
      if (badge && oldBadge) { if (oldBadge.getAttribute('data-icon-ref') !== badge.dataset.iconRef) oldBadge.replaceWith(badge); }
      else if (badge && name) name.after(badge); else oldBadge?.remove();
      const oldAvatar = previous.querySelector<HTMLElement>(':scope > .avatar'), avatar = avatarFor(message.author);
      if (oldAvatar && oldAvatar.dataset.avatarSignature !== avatar.dataset.avatarSignature) oldAvatar.replaceWith(avatar);
      continue;
    }
    const current = createMessage(message);
    if (previous) previous.replaceWith(current);
    else {
      const after = [...messages.children].find(child => Number((child as HTMLElement).dataset.seq) > message.seq);
      messages.insertBefore(current, after ?? null);
    }
    messageNodes.set(message.id, current);
    if (message.withdrawn && lightboxImage.dataset.messageId === message.id) closeImage();
  }
  if (!changed.length) return;
  if (atBottom) scrollToEnd();
  else if (anchor && anchorTop !== undefined && anchor.isConnected) messageList.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
  else if (history) messageList.scrollTop += messageList.scrollHeight - previousHeight;
  if (!history && !atBottom && changed.some(message => !message.withdrawn)) newMessages.hidden = false;
  chatStatus.textContent = state.size ? '' : '还没有消息，来聊聊吧。';
}
messageList.addEventListener('scroll', () => { followBottom = isNearBottom(); if (followBottom) newMessages.hidden = true; }, { passive: true });
newMessages.addEventListener('click', () => { followBottom = true; scrollToEnd(); });
const resizeObserver = new ResizeObserver(() => { if (followBottom) scrollToEnd(); });
resizeObserver.observe(messages); resizeObserver.observe(messageList);
historyButton.addEventListener('click', async () => {
  if (!hasEarlier || loadingEarlier || !connected) return;
  const before = Math.min(...[...state.values()].map(item => item.seq));
  if (!Number.isFinite(before)) return;
  loadingEarlier = true; historyButton.disabled = true;
  const run = syncRun;
  try {
    const history = await api<TeahouseHistory>(`messages?before=${before}&limit=50`);
    if (run !== syncRun || revoked) return;
    applyMessages(history.messages, true); hasEarlier = history.hasMore; historyButton.hidden = !hasEarlier;
  } catch (error) { tell(errorText(error)); }
  finally { loadingEarlier = false; historyButton.disabled = false; }
});
function renderAttachments() {
  attachmentTray.replaceChildren(); attachmentTray.hidden = attachments.length === 0;
  for (const attachment of attachments) {
    const tile = node('div', 'attachment-preview'), image = node('img'); image.src = attachment.url; image.alt = '待发送的图片';
    const remove = node('button', 'attachment-remove', '×'); remove.type = 'button'; remove.setAttribute('aria-label', '移除待发送图片'); remove.disabled = sending;
    remove.addEventListener('click', () => { if (sending) return; attachments = attachments.filter(item => item.id !== attachment.id); renderAttachments(); syncComposer(); });
    tile.append(image, remove); attachmentTray.append(tile);
  }
}
async function addImages(files: File[]) {
  if (!connected || revoked || sending || uploading || actor?.muted) return;
  const epoch = identityEpoch, signal = uploadAbort.signal;
  uploading = true; syncComposer();
  try {
    for (const file of files) {
      if (attachments.length >= 6) { tell('一次最多发送 6 张图片。'); break; }
      try {
        const prepared = await prepareUploadImage(file, { signal });
        const form = new FormData(); form.append('file', prepared);
        const attachment = await api<TeahouseAttachment>('attachments', { method: 'POST', body: form, signal });
        if (revoked || epoch !== identityEpoch) return;
        attachments.push(attachment); renderAttachments();
      } catch (error) { if (epoch !== identityEpoch) return; if (!revoked) tell(errorText(error)); }
    }
  } finally { if (epoch === identityEpoch) { uploading = false; syncComposer(); } }
}
attachButton.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', () => { void addImages(Array.from(imageInput.files ?? [])); imageInput.value = ''; });
input.addEventListener('paste', event => {
  const files = Array.from(event.clipboardData?.items ?? []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((item): item is File => item !== null);
  if (files.length) { event.preventDefault(); void addImages(files); }
});
for (const area of [messageList, composer]) {
  area.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); composer.classList.add('is-dragging'); } });
  area.addEventListener('dragleave', event => { if (!(event.relatedTarget instanceof Node) || !area.contains(event.relatedTarget)) composer.classList.remove('is-dragging'); });
  area.addEventListener('drop', event => { event.preventDefault(); composer.classList.remove('is-dragging'); if (event.dataTransfer?.files.length) void addImages(Array.from(event.dataTransfer.files)); });
}
async function sendMessage() {
  if (sendButton.disabled || composing) return;
  const epoch = identityEpoch;
  pendingSend = createPendingSend(pendingSend, input.value.trim(), attachments.map(item => item.id));
  sending = true; syncComposer(); renderAttachments();
  try {
    const message = await ack<TeahouseMessage>('message:send', pendingSend);
    if (revoked || epoch !== identityEpoch) return;
    applyMessages([message]); input.value = ''; input.scrollTop = 0; attachments = []; pendingSend = undefined; renderAttachments();
    followBottom = true; scrollToEnd();
  } catch (error) { if (epoch === identityEpoch) tell(errorText(error)); }
  finally { if (epoch === identityEpoch) { sending = false; syncComposer(); renderAttachments(); if (!revoked) input.focus({ preventScroll: true }); } }
}
composer.addEventListener('submit', event => { event.preventDefault(); void sendMessage(); });
input.addEventListener('input', syncComposer);
input.addEventListener('compositionstart', () => { composing = true; });
input.addEventListener('compositionend', () => { composing = false; });
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing && event.keyCode !== 229) { event.preventDefault(); void sendMessage(); } });
function setEmojiPanel(open: boolean) { emojiPanel.hidden = !open; emojiToggle.setAttribute('aria-expanded', String(open)); }
emojiToggle.addEventListener('click', () => setEmojiPanel(emojiPanel.hidden));
emojiPanel.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-emoji]') : null;
  const emoji = button?.dataset.emoji;
  if (!emoji || input.disabled || composing) return;
  if (input.value.length - (input.selectionEnd - input.selectionStart) + emoji.length > input.maxLength) { tell('文字已达到输入上限。'); return; }
  input.setRangeText(emoji, input.selectionStart, input.selectionEnd, 'end'); syncComposer(); setEmojiPanel(false); input.focus({ preventScroll: true });
});
document.addEventListener('click', event => { if (event.target instanceof Node && !emojiPanel.contains(event.target) && !emojiToggle.contains(event.target)) setEmojiPanel(false); });
function closeImage() { imageDialog.close(); lightboxImage.removeAttribute('src'); delete lightboxImage.dataset.messageId; }
el('image-close').addEventListener('click', closeImage);
imageDialog.addEventListener('click', event => { if (event.target === imageDialog) closeImage(); });
imageDialog.addEventListener('close', () => { lightboxImage.removeAttribute('src'); delete lightboxImage.dataset.messageId; });
messages.addEventListener('click', async event => {
  if (!(event.target instanceof Element)) return;
  const recall = event.target.closest<HTMLButtonElement>('[data-recall-id]');
  if (recall) {
    const epoch = identityEpoch;
    const current = state.get(recall.dataset.recallId ?? '');
    if (!current || !actor || !mayWithdraw(actor, current, now())) { tell('已超过可撤回时间。'); return; }
    recall.disabled = true;
    try { const result = await ack<TeahouseMessage>('message:withdraw', { id: current.id }); if (!revoked && epoch === identityEpoch) applyMessages([result]); }
    catch (error) { if (epoch === identityEpoch) { tell(errorText(error)); recall.disabled = false; } }
    return;
  }
  const button = event.target.closest<HTMLElement>('[data-preview-image]');
  const url = button?.dataset.previewImage;
  if (!url) return;
  lightboxImage.src = url; lightboxImage.dataset.messageId = button?.closest<HTMLElement>('[data-message-id]')?.dataset.messageId;
  imageDialog.showModal(); el('image-close').focus({ preventScroll: true });
});
const withdrawalTimer = setInterval(() => {
  for (const button of messages.querySelectorAll<HTMLButtonElement>('[data-recall-id]')) {
    const message = state.get(button.dataset.recallId ?? '');
    button.hidden = !actor || !message || !mayWithdraw(actor, message, now());
  }
}, 15000);

function selectedNotice() { return announcements.find(item => item.id === selectedAnnouncement); }
async function refreshAnnouncements(run = syncRun) {
  const version = noticeEventVersion;
  const result = await api<{ announcements: TeahouseAnnouncement[] }>('announcements');
  // A newer full-list socket event supersedes a slower HTTP snapshot.
  if (run !== syncRun || revoked || version !== noticeEventVersion) return;
  announcements = result.announcements.filter(item => visibleAuthor(item.author)); renderAnnouncements();
}
function renderAnnouncements() {
  const featured = announcements.find(item => item.pinned) ?? announcements[0];
  el('notice-label').textContent = featured?.pinned ? '置顶公告' : '群公告'; el('notice-title').textContent = featured?.title ?? '暂无公告';
  el('announcement-count').textContent = String(announcements.length);
  const list = el('announcement-list'), ids = new Set(announcements.map(item => item.id));
  for (const [id, card] of announcementNodes) if (!ids.has(id)) { card.remove(); announcementNodes.delete(id); }
  for (const item of announcements) {
    let card = announcementNodes.get(item.id);
    if (!card || card.dataset.revision !== String(item.revision)) {
      const next = node('button', 'announcement-card'); next.type = 'button'; next.dataset.announcementId = item.id; next.dataset.revision = String(item.revision);
      const meta = node('span', 'notice-card-meta'); meta.append(node('span', 'notice-author-avatar', Array.from(item.author.name)[0]), node('span', 'notice-card-author', item.author.name), node('small', 'notice-card-date', dateLabel(item.updatedAt)));
      next.append(meta, node('strong', '', item.title), node('p', 'notice-card-excerpt', item.text), node('span', 'notice-card-footer', item.pinned ? '置顶公告 · 查看详情' : '查看详情'));
      next.addEventListener('click', () => { selectedAnnouncement = item.id; renderAnnouncements(); setNoticeView('detail', true); });
      if (card) card.replaceWith(next); else list.append(next);
      card = next; announcementNodes.set(item.id, card);
    }
  }
  // Move only rows whose server order changed, keeping unchanged cards attached.
  let previous: Element | null = null;
  for (const item of announcements) {
    const card = announcementNodes.get(item.id)!;
    if (card.previousElementSibling !== previous) list.insertBefore(card, previous ? previous.nextElementSibling : list.firstElementChild);
    previous = card;
  }
  if (!selectedNotice()) selectedAnnouncement = featured?.id ?? '';
  const current = selectedNotice();
  if (!current && announcementView === 'detail') setNoticeView('list');
  el('announcement-title').textContent = current?.title ?? ''; el('announcement-body').textContent = current?.text ?? '';
  el('announcement-author').textContent = current?.author.name ?? ''; el('announcement-date').textContent = current ? dateLabel(current.updatedAt) : '';
  el('announcement-pinned').hidden = !current?.pinned;
  el('announcement-management').hidden = !actor || actor.muted === true || !current || !mayEditAnnouncement(actor, current);
  el('announcement-pin-toggle').textContent = current?.pinned ? '取消置顶' : '置顶公告';
  el('announcement-new').hidden = !actor || !isTeahouseManager(actor) || actor.muted === true || announcementView === 'editor';
}
function setNoticeView(view: View, focus = false) {
  if (announcementView === 'editor' && view !== 'editor') announcementEditor.reset();
  announcementView = view;
  announcementEditor.hidden = view !== 'editor'; el('announcements-reader').hidden = view === 'editor';
  el('announcement-history').hidden = view !== 'list'; el('announcement-detail').hidden = view !== 'detail'; el('announcement-back').hidden = view === 'list';
  el('announcement-new').hidden = !actor || !isTeahouseManager(actor) || actor.muted === true || view === 'editor';
  el('announcements-heading').textContent = view === 'list' ? '群公告' : view === 'detail' ? '公告详情' : editingAnnouncement ? '编辑公告' : '发布公告';
  if (focus) {
    const target = view === 'editor' ? announcementTitleInput : view === 'detail' ? el('announcement-title') : el('announcements-heading');
    target.tabIndex = view === 'editor' ? 0 : -1; target.focus({ preventScroll: true });
  }
}
function openEditor(item?: TeahouseAnnouncement) {
  if (!actor || !isTeahouseManager(actor) || actor.muted || item && !mayEditAnnouncement(actor, item)) return;
  editingAnnouncement = item; announcementTitleInput.value = item?.title ?? ''; announcementBodyInput.value = item?.text ?? ''; announcementPinInput.checked = item?.pinned ?? false;
  el('announcement-save').textContent = item ? '保存修改' : '发布公告'; setNoticeView('editor', true);
}
announcementsOpen.addEventListener('click', () => { setEmojiPanel(false); renderAnnouncements(); setNoticeView('list'); announcementsDialog.showModal(); });
el('announcements-close').addEventListener('click', () => announcementsDialog.close());
announcementsDialog.addEventListener('click', event => { if (event.target === announcementsDialog) announcementsDialog.close(); });
announcementsDialog.addEventListener('close', () => { editingAnnouncement = undefined; setNoticeView('list'); });
el('announcement-new').addEventListener('click', () => openEditor());
el('announcement-edit').addEventListener('click', () => openEditor(selectedNotice()));
el('announcement-back').addEventListener('click', () => { if (!noticeSaving) { editingAnnouncement = undefined; setNoticeView('list', true); } });
el('announcement-cancel').addEventListener('click', () => { if (!noticeSaving) { editingAnnouncement = undefined; setNoticeView('list', true); } });
async function saveNotice(payload: TeahouseAnnouncementInput) {
  if (noticeSaving) return;
  const epoch = identityEpoch;
  noticeSaving = true;
  const buttons = [...announcementsDialog.querySelectorAll<HTMLButtonElement>('button')]; buttons.forEach(button => { button.disabled = true; });
  try {
    const saved = await ack<TeahouseAnnouncement>('announcement:save', payload);
    if (revoked || epoch !== identityEpoch) return;
    selectedAnnouncement = saved.id; editingAnnouncement = undefined;
    await refreshAnnouncements();
    if (revoked || epoch !== identityEpoch) return;
    renderAnnouncements(); setNoticeView(selectedNotice() ? 'detail' : 'list', true); el('announcement-status').textContent = '公告已保存';
  } catch (error) { if (epoch === identityEpoch) tell(errorText(error)); }
  finally { if (epoch === identityEpoch) { noticeSaving = false; buttons.forEach(button => { button.disabled = false; }); } }
}
announcementEditor.addEventListener('submit', event => {
  event.preventDefault();
  if (!announcementEditor.reportValidity()) return;
  const title = announcementTitleInput.value.trim(), text = announcementBodyInput.value.trim();
  if (!title || !text) { tell('请填写公告标题和内容。'); return; }
  void saveNotice({ id: editingAnnouncement?.id, revision: editingAnnouncement?.revision, title, text, pinned: announcementPinInput.checked });
});
el('announcement-pin-toggle').addEventListener('click', () => { const item = selectedNotice(); if (item) void saveNotice({ id: item.id, revision: item.revision, title: item.title, text: item.text, pinned: !item.pinned }); });
el('announcement-delete').addEventListener('click', async () => {
  const item = selectedNotice(); if (!item || noticeSaving || !confirm('删除这条公告？')) return;
  const epoch = identityEpoch;
  noticeSaving = true;
  try { await ack<unknown>('announcement:delete', { id: item.id, revision: item.revision }); if (epoch !== identityEpoch || revoked) return; announcements = announcements.filter(notice => notice.id !== item.id); renderAnnouncements(); setNoticeView('list'); }
  catch (error) { if (epoch === identityEpoch) tell(errorText(error)); }
  finally { if (epoch === identityEpoch) noticeSaving = false; }
});

let memberSignature = '';
function renderMembers(incoming: TeahouseActor[]) {
  const members = incoming.filter(visibleAuthor);
  const signature = JSON.stringify(members);
  if (signature === memberSignature) return;
  memberSignature = signature; el('member-count').textContent = String(members.length);
  if (connected) setStatus(`${members.length} 人在线`);
  const list = el('member-list'), memberKey = (member: TeahouseActor) => `${member.kind}:${member.id}`;
  const active = new Set(members.map(memberKey));
  for (const [key, row] of memberNodes) if (!active.has(key)) { row.remove(); memberNodes.delete(key); }
  let previous: HTMLLIElement | null = null;
  for (const member of members) {
    const key = memberKey(member), signature = JSON.stringify(member), existing = memberNodes.get(key);
    if (existing?.dataset.signature === signature) {
      if (existing.previousElementSibling !== previous) list.insertBefore(existing, previous ? previous.nextElementSibling : list.firstElementChild);
      previous = existing; continue;
    }
    const row = node('li'), content = node('div'), name = node('span', 'member-name', member.name);
    row.dataset.signature = signature;
    const icon = iconFor(member); if (icon) name.append(icon); if (own(member)) name.append(node('small', '', '我'));
    content.append(name); row.append(avatarFor(member), content, node('span', 'presence-dot'));
    if (existing) existing.replaceWith(row); else list.append(row);
    if (row.previousElementSibling !== previous) list.insertBefore(row, previous ? previous.nextElementSibling : list.firstElementChild);
    memberNodes.set(key, row); previous = row;
  }
}
function clearPrivateState() {
  identityEpoch++; syncRun++; connected = false; uploadAbort.abort(); socket.disconnect();
  clearTimeout(replayTimer); replayTimer = undefined; replayInFlight = false; replayAgain = false;
  clearTimeout(retryTimer); retryTimer = undefined; retryDelay = 1000;
  actor = undefined; actorSignature = ''; el('current-person').replaceChildren();
  accountMenu.update();
  initialized = false; replayCursor = 0; hasEarlier = false; loadingEarlier = false;
  sending = false; uploading = false; composing = false; noticeSaving = false; followBottom = true;
  state.clear(); messageNodes.clear(); messages.replaceChildren(); attachments = []; pendingSend = undefined; input.value = ''; renderAttachments();
  selectedAnnouncement = ''; editingAnnouncement = undefined; noticeEventVersion++; announcementEditor.reset();
  announcementsDialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; });
  announcements = []; announcementNodes.clear(); el('announcement-list').replaceChildren(); renderAnnouncements();
  announcementsDialog.close(); closeImage(); renderMembers([]); syncComposer();
  setEmojiPanel(false); newMessages.hidden = true; historyButton.hidden = true; historyButton.disabled = false;
  clearTimeout(toastTimer); el('toast').hidden = true; el('announcement-status').textContent = ''; el('notice-role-current').textContent = '';
}
function restartIdentity() {
  clearPrivateState(); revoked = false; uploadAbort = new AbortController();
  // A fresh instance cannot replay Socket.IO's old offline send buffer under
  // another identity. ACKs still in flight are rejected by identityEpoch.
  socket = createSocket(); socketAttempted = false; bindSocket(socket);
  announcementsOpen.disabled = false; chatStatus.textContent = '正在确认当前登录身份…'; setStatus('连接中…');
  if (pageActive) void start();
}
function revokeAccess(message: string) {
  revoked = true; clearPrivateState();
  chatStatus.textContent = message; setStatus('暂不可进入'); historyButton.hidden = true; announcementsOpen.disabled = true; el('retry-chat').hidden = false;
}
async function synchronize() {
  if (!pageActive || revoked || !socket.connected) return;
  const run = ++syncRun;
  try {
    const session = await api<{ actor: TeahouseActor; serverTime: number }>('session');
    if (run !== syncRun || revoked) return;
    if (actor && accessKey(actor) !== accessKey(session.actor)) { restartIdentity(); return; }
    actor = session.actor; serverClock = { time: session.serverTime, sampledAt: performance.now() }; renderActor();
    connected = true; syncComposer(); el('retry-chat').hidden = true;
    let more = true;
    while (more && run === syncRun && !revoked) {
      const history = await api<TeahouseHistory>(`messages?${initialized ? `after=${replayCursor}&` : ''}limit=50`);
      if (run !== syncRun || revoked) return;
      applyMessages(history.messages);
      replayCursor = history.cursor;
      if (!initialized) { hasEarlier = history.hasMore; historyButton.hidden = !hasEarlier; initialized = true; more = false; followBottom = true; scrollToEnd(); }
      else more = history.hasMore;
    }
    await refreshAnnouncements(run);
    if (run !== syncRun || revoked) return;
    chatStatus.textContent = actor.muted ? '当前账号已被禁言，仍可阅读聊天记录。' : state.size ? '' : '还没有消息，来聊聊吧。';
    clearTimeout(retryTimer); retryTimer = undefined; retryDelay = 1000;
    setStatus(`${el('member-count').textContent ?? '0'} 人在线`);
  } catch (error) {
    if (run !== syncRun || revoked) return;
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) revokeAccess(error.message);
    else { chatStatus.textContent = errorText(error); setStatus('加载未完成'); el('retry-chat').hidden = false; scheduleRetry(); }
  }
}
function scheduleRetry() {
  if (retryTimer || revoked || !pageActive) return;
  const epoch = identityEpoch;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    if (epoch !== identityEpoch || revoked || !pageActive) return;
    if (connected && socket.connected) void synchronize(); else void start();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 15000);
}
function scheduleHistorySync() {
  if (!pageActive || revoked) return;
  replayAgain = true;
  if (replayTimer || replayInFlight) return;
  replayTimer = setTimeout(() => {
    replayTimer = undefined; replayInFlight = true; replayAgain = false;
    const epoch = identityEpoch;
    void synchronize().finally(() => {
      if (epoch !== identityEpoch) return;
      replayInFlight = false;
      if (replayAgain) scheduleHistorySync();
    });
  }, 80);
}
function bindSocket(currentSocket: ReturnType<typeof createSocket>) {
currentSocket.on('connect', () => { if (currentSocket === socket) { clearTimeout(retryTimer); retryTimer = undefined; void synchronize(); } });
currentSocket.on('disconnect', () => { if (currentSocket !== socket) return; connected = false; syncRun++; syncComposer(); if (!revoked) { setStatus('连接中断，正在重连…'); scheduleRetry(); } });
currentSocket.on('connect_error', (error: Error & { data?: { status?: number } }) => {
  if (currentSocket !== socket) return;
  connected = false; syncComposer();
  if (error.data?.status === 401 || error.data?.status === 403) revokeAccess(error.message);
  else { chatStatus.textContent = '暂时无法连接，正在重试。'; setStatus('连接中…'); scheduleRetry(); }
});
currentSocket.on('message:changed', (message: TeahouseMessage) => { if (currentSocket === socket && connected && !revoked) applyMessages([message]); });
currentSocket.on('announcements:changed', (data: { announcements: TeahouseAnnouncement[] }) => { if (currentSocket === socket && connected && !revoked) { noticeEventVersion++; announcements = data.announcements.filter(item => visibleAuthor(item.author)); renderAnnouncements(); } });
currentSocket.on('members:changed', (data: { members: TeahouseActor[] }) => { if (currentSocket === socket && connected && !revoked) renderMembers(data.members); });
currentSocket.on('history:sync', () => { if (currentSocket === socket && connected && !revoked) scheduleHistorySync(); });
currentSocket.on('access:revoked', (data: { error: string; reason?: string }) => { if (currentSocket !== socket) return; if (data.reason === 'identity-changed') restartIdentity(); else revokeAccess(data.error); });
currentSocket.on('reader:purged', (data: { id: string }) => {
  if (currentSocket !== socket) return;
  purgedReaders.add(data.id);
  if (actor?.kind === 'reader' && actor.id === data.id) { revokeAccess('账号已注销，请重新登录。'); return; }
  applyMessages([...state.values()].filter(item => item.author.kind === 'reader' && item.author.id === data.id));
  announcements = announcements.filter(item => visibleAuthor(item.author));
  if (editingAnnouncement && !visibleAuthor(editingAnnouncement.author)) { editingAnnouncement = undefined; announcementEditor.reset(); setNoticeView('list'); }
  noticeEventVersion++; renderAnnouncements();
  const member = memberNodes.get(`reader:${data.id}`); member?.remove(); memberNodes.delete(`reader:${data.id}`); memberSignature = '';
  el('member-count').textContent = String(memberNodes.size); if (connected) setStatus(`${memberNodes.size} 人在线`);
});
}
bindSocket(socket);

const membersPanel = el('members-panel'), membersToggle = el('members-toggle'), narrow = matchMedia('(max-width: 1100px)');
function setMembers(open: boolean) {
  membersPanel.hidden = !open; membersPanel.setAttribute('aria-hidden', String(!open)); membersPanel.classList.toggle('is-open', open);
  document.body.classList.toggle('members-open', open); membersToggle.setAttribute('aria-expanded', String(open));
}
setMembers(!narrow.matches); narrow.addEventListener('change', () => setMembers(!narrow.matches));
membersToggle.addEventListener('click', () => setMembers(membersPanel.hidden)); el('members-close').addEventListener('click', () => setMembers(false));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { if (!emojiPanel.hidden) setEmojiPanel(false); else if (narrow.matches) setMembers(false); } });
const themeKey = 'sansphase-teahouse-theme';
function setTheme(theme: 'light' | 'dark') {
  document.body.dataset.theme = theme;
  const button = el('theme-toggle'), icon = node('i'); icon.dataset.lucide = theme === 'dark' ? 'moon' : 'sun';
  button.replaceChildren(icon, node('span', '', theme === 'dark' ? '深色' : '明亮')); button.setAttribute('aria-label', theme === 'dark' ? '切换浅色主题' : '切换深色主题'); icons();
  try { localStorage.setItem(themeKey, theme); } catch { /* Session-only theme remains usable. */ }
}
let theme: string | null = new URLSearchParams(location.search).get('communityTheme');
try { theme ??= localStorage.getItem(themeKey); } catch { /* Defaults to the approved light theme. */ }
setTheme(theme === 'dark' ? 'dark' : 'light'); el('theme-toggle').addEventListener('click', () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));
window.addEventListener('pagehide', event => {
  pageActive = false; clearPrivateState();
  if (!event.persisted) { clearInterval(withdrawalTimer); resizeObserver.disconnect(); }
});
window.addEventListener('pageshow', event => { pageActive = true; if (event.persisted && !revoked) restartIdentity(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && connected && !revoked) void synchronize(); });
syncComposer(); renderAnnouncements(); setNoticeView('list');
el('retry-chat').addEventListener('click', () => location.reload());
async function start() {
  const epoch = identityEpoch;
  try {
    const session = await api<{ actor: TeahouseActor; serverTime: number }>('session');
    if (epoch !== identityEpoch || !pageActive || revoked) return;
    if (actor && accessKey(actor) !== accessKey(session.actor)) { restartIdentity(); return; }
    actor = session.actor; serverClock = { time: session.serverTime, sampledAt: performance.now() }; renderActor();
    if (socketAttempted) {
      // Retire the old instance even for the same actor. No transport buffer or
      // delayed ACK may cross this connection boundary; the app keeps its draft
      // and idempotency UUID until the user explicitly retries.
      const previousSocket = socket;
      socket = createSocket(); bindSocket(socket); previousSocket.disconnect();
    }
    socketAttempted = true; socket.connect();
  } catch (error) {
    if (epoch !== identityEpoch || !pageActive) return;
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) revokeAccess(errorText(error));
    else { connected = false; syncComposer(); chatStatus.textContent = errorText(error); setStatus('连接中…'); el('retry-chat').hidden = false; scheduleRetry(); }
  }
}
void start();
