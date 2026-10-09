import { escapeHTML as esc } from './core.mjs';
import { communityVipFrameRef, communityVipFrameSource } from './community-vip-frame.mjs';

export type ReaderFrameIdentity = { uid?: string; email: string; frame?: string | null; frameImage?: string | null; vip?: boolean; vipUntil?: string | null };
type FrameRef = 'gold' | 'orbit' | 'nebula' | typeof communityVipFrameRef | `image:${string}`;
type FrameItem = { id: string; name: string; ref: FrameRef; image: string | null };
export type ReaderFrameState = { frame: FrameRef | null; frameImage: string | null; items: FrameItem[]; available: boolean };
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const customRef = new RegExp(`^image:${uuid}$`);
const framePath = new RegExp(`^/api/reader/frame/${uuid}\\.webp$`);
function frameRef(value: unknown): FrameRef | null {
  return typeof value === 'string' && (['gold', 'orbit', 'nebula', communityVipFrameRef].includes(value) || customRef.test(value)) ? value as FrameRef : null;
}
function frameImage(ref: FrameRef | null, value: unknown): string | null {
  return ref?.startsWith('image:') && typeof value === 'string' && framePath.test(value) &&
    value === `/api/reader/frame/${ref.slice(6)}.webp` ? value : null;
}
function vipFrameCurrent(reader: Pick<ReaderFrameIdentity, 'vip' | 'vipUntil'> | null): boolean {
  return reader !== null && reader.vip !== false && (reader.vipUntil === undefined
    || reader.vipUntil !== null && Number.isFinite(Date.parse(reader.vipUntil)) && Date.parse(reader.vipUntil) > Date.now());
}
export function readerFrameOwner(reader: ReaderFrameIdentity | null): string {
  if (!reader?.email) return '';
  return `${reader.uid || ''}:${reader.email.trim().toLowerCase()}`;
}
/** Normal profile writes do not query the community inventory or return its fields. */
export function retainReaderFrame<T extends ReaderFrameIdentity>(next: T, current: ReaderFrameIdentity | null): T {
  const owner = readerFrameOwner(current);
  if (!owner || owner !== readerFrameOwner(next) || Object.hasOwn(next, 'frame') || Object.hasOwn(next, 'frameImage')) return next;
  const expiredVipFrame = current?.frame === communityVipFrameRef && !vipFrameCurrent(next);
  return { ...next, frame: expiredVipFrame ? null : current?.frame ?? null, frameImage: expiredVipFrame ? null : current?.frameImage ?? null };
}
export function readerFrameDecoration(reader: Pick<ReaderFrameIdentity, 'frame' | 'frameImage' | 'vip' | 'vipUntil'>): { className: string; image: string | null } {
  const ref = frameRef(reader.frame);
  if (ref === communityVipFrameRef && !vipFrameCurrent(reader)) return { className: '', image: null };
  return { className: ref ? `reader-avatar-frame-${ref.startsWith('image:') ? 'custom' : ref}` : '', image: ref === communityVipFrameRef ? communityVipFrameSource(true) : frameImage(ref, reader.frameImage) };
}
export function readerFrameSettingsHTML(english: boolean): string {
  const tr = (zh: string, en: string) => english ? en : zh;
  return `<div class="reader-frame-settings" data-reader-frame-settings><strong>${tr('头像框', 'Avatar frame')}</strong><label for="reader-frame-select">${tr('已拥有的头像框', 'Owned frames')}</label><select id="reader-frame-select" data-reader-frame-select disabled><option value="">${tr('不佩戴头像框', 'No frame')}</option></select><div class="reader-avatar-actions"><button type="button" data-reader-frame-save disabled>${tr('保存穿戴', 'Save frame')}</button></div><p data-reader-frame-message role="status" aria-live="polite">${tr('打开设置后读取已拥有的头像框。', 'Open settings to load your owned frames.')}</p></div>`;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function readFrameState(value: unknown): ReaderFrameState {
  if (!record(value) || typeof value.available !== 'boolean' || !Array.isArray(value.items)) throw new Error('Invalid avatar frame state.');
  const ref = frameRef(value.frame);
  if (value.frame !== null && !ref) throw new Error('Invalid equipped avatar frame.');
  const image = frameImage(ref, value.frameImage);
  if (value.frameImage !== null && !image) throw new Error('Invalid avatar frame image.');
  const seen = new Set<string>();
  const items: FrameItem[] = [];
  for (const item of value.items) {
    if (!record(item) || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    const ownedRef = frameRef(item.ref), ownedImage = frameImage(ownedRef, item.image);
    if (!ownedRef || seen.has(ownedRef) || item.image !== null && !ownedImage) continue;
    seen.add(ownedRef);
    items.push({ id: item.id, name: item.name, ref: ownedRef, image: ownedImage });
  }
  return { frame: ref, frameImage: image, items, available: value.available };
}

/** The account panel uses the community inventory without owning account identity. */
export function mountReaderFrames({ readIdentity, equipped, post, english, doc = document }: {
  readIdentity: () => ReaderFrameIdentity | null;
  equipped: (state: ReaderFrameState) => void;
  post: (ref: string | null) => Promise<unknown>;
  english: () => boolean;
  doc?: Document;
}) {
  const tr = (zh: string, en: string) => english() ? en : zh;
  const unavailable = () => tr('头像框暂时不可用，请稍后重试。', 'Avatar frames are temporarily unavailable. Please try again later.');
  let settings: HTMLElement | null = null, owner = '', generation = 0;
  let state: ReaderFrameState | null = null, loading = false, saving = false;
  let abort: AbortController | null = null;
  const clear = () => {
    generation++;
    abort?.abort(); abort = null;
    settings = null; owner = ''; state = null; loading = saving = false;
  };
  const current = (token: number, root: HTMLElement) => generation === token && settings === root && root.isConnected &&
    owner !== '' && owner === readerFrameOwner(readIdentity()) && root.closest<HTMLElement>('[data-reader-frame-owner]')?.dataset.readerFrameOwner === owner;
  const status = (root: HTMLElement, text: string) => { const line = root.querySelector('[data-reader-frame-message]'); if (line) line.textContent = text; };
  const controls = () => {
    const select = settings?.querySelector<HTMLSelectElement>('[data-reader-frame-select]');
    const save = settings?.querySelector<HTMLButtonElement>('[data-reader-frame-save]');
    const allowed = Boolean(state?.available && !loading && !saving);
    if (select) select.disabled = !allowed;
    if (save) save.disabled = !allowed || !select || (select.value || null) === state?.frame
      || select.value === communityVipFrameRef && !vipFrameCurrent(readIdentity());
  };
  const fill = (root: HTMLElement) => {
    const select = root.querySelector<HTMLSelectElement>('[data-reader-frame-select]');
    if (!select || !state) return;
    select.innerHTML = `<option value="">${tr('不佩戴头像框', 'No frame')}</option>` + state.items.map(item => `<option value="${esc(item.ref)}">${esc(item.name)}</option>`).join('');
    if (state.frame && !state.items.some(item => item.ref === state!.frame)) {
      const option = doc.createElement('option'); option.value = state.frame;
      option.textContent = tr('当前头像框', 'Current frame'); option.disabled = true; select.append(option);
    }
    select.value = state.frame || '';
    controls();
  };
  const paint = (root: HTMLElement) => {
    const avatar = root.closest('.reader-avatar-anchor')?.querySelector<HTMLButtonElement>('[data-reader-avatar-trigger]');
    if (!avatar || !state) return;
    const identity = readIdentity();
    const decoration = readerFrameDecoration({ ...state, vip: identity?.vip, vipUntil: identity?.vipUntil });
    for (const name of ['gold', 'orbit', 'nebula', 'vipmoon', 'custom']) avatar.classList.remove(`reader-avatar-frame-${name}`);
    if (decoration.className) avatar.classList.add(decoration.className);
    avatar.querySelector('.reader-profile-frame-image')?.remove();
    if (decoration.image) {
      const image = doc.createElement('img'); image.className = 'reader-profile-frame-image';
      image.src = decoration.image; image.alt = ''; image.decoding = 'async'; image.setAttribute('aria-hidden', 'true');
      avatar.append(image);
    }
  };
  async function open() {
    const root = settings;
    if (!root || !owner || loading || saving || state?.available) return;
    const token = generation;
    if (!current(token, root)) return;
    loading = true; controls(); status(root, tr('正在读取头像框…', 'Loading avatar frames…'));
    abort = new AbortController();
    try {
      const response = await fetch('/api/reader/frame-state', { method: 'GET', credentials: 'same-origin', headers: { 'X-Reader-Request': '1' }, signal: abort.signal });
      if (!response.ok) throw new Error('Avatar frames are unavailable.');
      const value: unknown = await response.json();
      if (!current(token, root)) return;
      state = readFrameState(value);
      if (state.available) { equipped(state); paint(root); }
      fill(root);
      status(root, !state.available ? unavailable() : state.items.length ? tr('穿戴状态与社区同步。', 'Your equipped frame is shared with the community.') : tr('还没有已拥有的头像框。', 'You do not own any avatar frames yet.'));
    } catch {
      if (current(token, root)) { state = null; status(root, unavailable()); }
    } finally {
      if (current(token, root)) { loading = false; abort = null; controls(); }
    }
  }
  async function save(event: Event) {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>('[data-reader-frame-save]');
    if (!button || button.disabled || !settings || !state?.available || saving || loading) return;
    const root = settings, token = generation;
    if (!current(token, root)) return;
    const select = root.querySelector<HTMLSelectElement>('[data-reader-frame-select]');
    const ref = select?.value || null;
    if (ref && !state.items.some(item => item.ref === ref) || ref === communityVipFrameRef && !vipFrameCurrent(readIdentity())) return;
    saving = true; controls(); status(root, tr('正在保存头像框…', 'Saving avatar frame…'));
    try {
      const value = await post(ref);
      if (!current(token, root)) return;
      const next = readFrameState(value);
      if (!next.available) { state = { ...state, available: false }; status(root, unavailable()); return; }
      state = next; equipped(state); paint(root); fill(root);
      status(root, tr('头像框已保存，与社区同步。', 'Avatar frame saved and shared with the community.'));
    } catch {
      if (current(token, root)) status(root, tr('头像框未能保存，请重试。', 'Could not save the avatar frame. Please try again.'));
    } finally {
      if (current(token, root)) { saving = false; controls(); }
    }
  }
  const change = (event: Event) => { if ((event.target as Element | null)?.matches('[data-reader-frame-select]')) controls(); };
  doc.addEventListener('click', save); doc.addEventListener('change', change);
  doc.defaultView?.addEventListener('reader:identity', clear);
  return {
    open,
    route(page: string) {
      const root = page === 'account' ? doc.querySelector<HTMLElement>('[data-reader-frame-settings]') : null;
      const key = root ? readerFrameOwner(readIdentity()) : '';
      if (root === settings && key === owner) return;
      clear(); settings = root; owner = key; controls();
    },
    dispose() {
      clear(); doc.removeEventListener('click', save); doc.removeEventListener('change', change);
      doc.defaultView?.removeEventListener('reader:identity', clear);
    },
  };
}
