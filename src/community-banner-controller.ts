import { communityImageBytes } from './community-rules.mjs';
import type { CommunityBannerConfig } from './community-banners.ts';
import type { CommunityBannerEditorState } from './community-banner-editor.ts';
import type { CommunityListing, CommunityLoad, Translate } from './community.ts';

type Options = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  paint: () => void;
  notify: (message: string) => void;
  t: Translate;
  active: () => boolean;
  owner: () => boolean;
  saved: (config: CommunityBannerConfig) => void;
  conflict?: () => Promise<void>;
};
const copy = (config: CommunityBannerConfig): CommunityBannerConfig => ({ ...config, items: config.items.map(item => ({ ...item })) });
const editable = (config: CommunityBannerConfig | undefined) => JSON.stringify(config?.items.map(({ topicId, title, cover }) => ({ topicId, title, cover })) || []);

/** Local drafts belong to a verified account and an independently saved scope. */
export function createCommunityBannerController(options: Options) {
  let configs: CommunityBannerConfig[] = [];
  const drafts = new Map<string, CommunityBannerConfig>();
  const conflicts = new Set<string>();
  let scope = '';
  let query = '';
  let candidates: CommunityLoad<CommunityListing> = { state: 'loading' };
  let busy = false;
  let message = '';
  let epoch = 0;
  let searchRequest = 0;
  let loadedKey = '';
  const paint = () => { if (options.active()) options.paint(); };
  const draft = () => drafts.get(scope) || null;
  const valid = () => Boolean(options.active() && configs.some(config => config.scope === scope));
  const reset = () => {
    epoch++; searchRequest++; configs = []; drafts.clear(); conflicts.clear(); scope = ''; query = ''; loadedKey = '';
    candidates = { state: 'loading' }; busy = false; message = '';
  };
  const dirty = () => configs.some(config => editable(drafts.get(config.scope)) !== editable(config));
  async function search(value = query) {
    if (!valid()) return;
    query = value.trim().slice(0, 40);
    const selected = scope, identity = epoch, token = ++searchRequest;
    loadedKey = `${scope}|${query}`;
    candidates = { state: 'loading' }; paint();
    const parameters = new URLSearchParams({ sort: 'newest', page: '1', ...(scope === 'home' ? {} : { board: scope }), ...(query ? { q: query } : {}) });
    try {
      const data = await options.request<CommunityListing>(`topics?${parameters}`);
      if (identity !== epoch || token !== searchRequest || selected !== scope) return;
      candidates = { state: 'ready', data: { ...data, items: data.items.filter(topic => !topic.pending && !topic.hidden && (scope === 'home' || topic.board === scope)) } };
    } catch (error) {
      if (identity !== epoch || token !== searchRequest || selected !== scope) return;
      candidates = { state: 'error', status: error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0, message: error instanceof Error ? error.message : '' };
    }
    paint();
  }
  function sync(next: CommunityBannerConfig[]) {
    const allowed = new Set(next.map(config => config.scope));
    for (const key of drafts.keys()) if (!allowed.has(key)) drafts.delete(key);
    for (const key of conflicts) if (!allowed.has(key)) conflicts.delete(key);
    if (scope && !allowed.has(scope)) { epoch++; searchRequest++; busy = false; loadedKey = ''; message = ''; }
    for (const config of next) {
      const previous = configs.find(item => item.scope === config.scope);
      if (!drafts.has(config.scope) || editable(drafts.get(config.scope)) === editable(previous)) drafts.set(config.scope, copy(config));
    }
    configs = next.map(copy);
    if (!allowed.has(scope)) { scope = next[0]?.scope || ''; query = ''; }
    if (scope && loadedKey !== `${scope}|${query}` && options.active()) void search();
  }
  function state(): CommunityBannerEditorState {
    return { configs, scope, draft: draft(), candidates, query, busy, message, conflicted: conflicts.has(scope) };
  }
  function action(target: HTMLElement) {
    const name = target.dataset.action || '';
    if (!name.startsWith('community-banner-')) return false;
    if (!valid() || busy) return true;
    const current = draft();
    if (!current) return true;
    message = '';
    if (name === 'community-banner-scope') {
      const selected = target.dataset.scope;
      if (!selected || selected === scope || !configs.some(config => config.scope === selected)) return true;
      scope = selected; query = ''; loadedKey = ''; void search(); return true;
    }
    if (name === 'community-banner-add') {
      const topic = candidates.state === 'ready' ? candidates.data.items.find(item => item.id === target.dataset.id) : null;
      if (!topic || current.items.length >= 5 || current.items.some(item => item.topicId === topic.id)) return true;
      current.items.push({ topicId: topic.id, title: '', cover: null, board: topic.board, topicTitle: topic.title, image: topic.thumbs?.[0] || null, topicImage: topic.thumbs?.[0] || null });
    } else if (name === 'community-banner-cancel') {
      const original = configs.find(config => config.scope === scope);
      if (original) drafts.set(scope, copy(original));
      conflicts.delete(scope);
    } else {
      const index = Number(target.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= current.items.length) return true;
      if (name === 'community-banner-remove') current.items.splice(index, 1);
      else if (name === 'community-banner-cover-remove') { current.items[index].cover = null; current.items[index].image = current.items[index].topicImage || null; }
      else if (name === 'community-banner-up' && index > 0) [current.items[index - 1], current.items[index]] = [current.items[index], current.items[index - 1]];
      else if (name === 'community-banner-down' && index < current.items.length - 1) [current.items[index + 1], current.items[index]] = [current.items[index], current.items[index + 1]];
    }
    paint(); return true;
  }
  function input(field: HTMLInputElement) {
    if (field.form?.dataset.communityForm === 'banner-search' && field.name === 'query') { query = field.value; return true; }
    if (field.form?.dataset.communityForm !== 'banners') return false;
    const match = /^banner-title-(\d+)$/.exec(field.name);
    const item = match && draft()?.items[Number(match[1])];
    if (!item || !valid() || busy) return true;
    item.title = field.value;
    const preview = field.closest('[data-banner-item]')?.querySelector('[data-banner-preview-title]');
    if (preview) preview.textContent = item.title.trim() || item.topicTitle;
    message = '';
    return true;
  }
  async function save() {
    const current = draft();
    if (!valid() || busy || !current || conflicts.has(scope)) return;
    if (current.items.some(item => [...item.title.trim()].length > 80)) { message = options.t('展示标题最多 80 个字。', 'Display titles can have up to 80 characters.'); paint(); return; }
    const identity = epoch, selected = scope;
    const payload = { scope, version: current.version, items: current.items.map(({ topicId, title, cover }) => ({ topicId, title: title.trim(), cover })) };
    busy = true; message = ''; paint();
    try {
      const saved = await options.request<CommunityBannerConfig>('manage/banners', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reader-Request': '1' }, body: JSON.stringify(payload) });
      if (identity !== epoch || selected !== scope) return;
      configs = configs.map(config => config.scope === selected ? copy(saved) : config);
      drafts.set(selected, copy(saved));
      options.saved(saved);
      message = options.t('已保存，仅更新当前展示位置。', 'Saved. Only this location was updated.');
      options.notify(options.t('横幅已保存。', 'Banners saved.'));
    } catch (error) {
      if (identity === epoch && selected === scope) {
        message = error instanceof Error ? error.message : options.t('保存失败，请稍后重试。', 'Could not save. Please retry.');
        if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
          await options.conflict?.();
          if (identity === epoch && selected === scope) {
            conflicts.add(scope);
            message = options.t('其他管理者已更新此处。你的修改已保留，请取消并读取最新配置后重新编辑。', 'Another manager updated this location. Your draft is retained. Discard it and load the latest settings before editing again.');
          }
        }
      }
    } finally { if (identity === epoch && selected === scope) { busy = false; paint(); } }
  }
  async function upload(index: number, file: File | undefined) {
    const item = draft()?.items[index];
    if (!valid() || busy || !item || !file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { message = options.t('横幅封面支持 JPG、PNG、WebP 图片。', 'Choose a JPG, PNG or WebP cover.'); paint(); return; }
    if (file.size > communityImageBytes(options.owner())) { message = options.owner() ? options.t('封面不能超过 25MB。', 'Covers cannot exceed 25MB.') : options.t('封面不能超过 2MB。', 'Covers cannot exceed 2MB.'); paint(); return; }
    const identity = epoch, selected = scope;
    const body = new FormData(); body.append('file', file);
    busy = true; message = options.t('正在上传封面…', 'Uploading cover…'); paint();
    try {
      const image = await options.request<{ id: string }>(`manage/banner-image?scope=${encodeURIComponent(selected)}`, { method: 'POST', headers: { 'X-Reader-Request': '1' }, body });
      if (identity !== epoch || selected !== scope || draft()?.items[index] !== item) return;
      item.cover = image.id; item.image = image.id;
      message = options.t('封面已上传，保存后生效。', 'Cover uploaded. Save to publish it.');
    } catch (error) { if (identity === epoch && selected === scope) message = error instanceof Error ? error.message : options.t('封面上传失败。', 'Could not upload the cover.'); }
    finally { if (identity === epoch && selected === scope) { busy = false; paint(); } }
  }
  function change(field: HTMLInputElement) {
    if (!field.matches('[data-banner-file]')) return false;
    const index = Number(field.dataset.index); const file = field.files?.[0]; field.value = '';
    if (Number.isInteger(index)) void upload(index, file);
    return true;
  }
  function submit(form: HTMLFormElement) {
    if (form.dataset.communityForm === 'banners') { void save(); return true; }
    if (form.dataset.communityForm === 'banner-search') { const field = form.elements.namedItem('query'); if (field && 'value' in field) void search(String(field.value)); return true; }
    return false;
  }
  function drag(event: DragEvent) {
    if (!options.active() || !event.dataTransfer || !Array.from(event.dataTransfer.types).includes('Files')) return false;
    const target = event.target as Element;
    const zone = target.closest?.<HTMLElement>('[data-banner-drop]');
    // Prevent an accidental file drop elsewhere in this editor from navigating away.
    if (!zone && !target.closest?.('[data-community="manage"][data-tab="banners"]')) return false;
    event.preventDefault();
    if (event.type === 'dragenter' || event.type === 'dragover') { if (zone && !busy) zone.classList.add('is-dragging'); event.dataTransfer.dropEffect = zone && !busy ? 'copy' : 'none'; }
    else if (event.type === 'dragleave') zone?.classList.remove('is-dragging');
    else if (event.type === 'drop') {
      zone?.classList.remove('is-dragging');
      if (!zone || busy) return true;
      if (event.dataTransfer.files.length !== 1) { message = options.t('每次请拖入一张封面图片。', 'Drop one cover image at a time.'); paint(); }
      else void upload(Number(zone.dataset.index), event.dataTransfer.files[0]);
    }
    return true;
  }
  return { sync, state, action, input, change, submit, drag, save, search, reset, dirty };
}
