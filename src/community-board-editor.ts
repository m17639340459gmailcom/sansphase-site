import type { Common, CommunityBoard, CommunityBoardCatalog } from './community.ts';
import { availableCommunityBoardIcons, communityBoardIcon } from './community-board-icons.mjs';

export type { CommunityBoardCatalog } from './community.ts';
export type CommunityBoardCreateInput = { name: string; description: string; icon: string; id?: string };
type CreateDraft = { name: string; description: string; icon: string; id: string };
export type CommunityBoardEditorState = {
  catalog: CommunityBoardCatalog | null;
  draftOrder: string[];
  createDraft: CreateDraft;
  busy: boolean;
  conflicted: boolean;
  message: string;
  createMessage: string;
};
type ControllerOptions = Common & {
  root: () => HTMLElement | null;
  active: () => boolean;
  owner: () => boolean;
  create: (input: CommunityBoardCreateInput, version: number) => Promise<CommunityBoardCatalog>;
  reorder: (ids: string[], version: number) => Promise<CommunityBoardCatalog>;
  reload?: () => Promise<CommunityBoardCatalog>;
  saved: (catalog: CommunityBoardCatalog) => void;
  notify: (message: string) => void;
};

const emptyDraft = (): CreateDraft => ({ name: '', description: '', icon: '', id: '' });
const copyCatalog = (catalog: CommunityBoardCatalog): CommunityBoardCatalog => ({ version: catalog.version, items: catalog.items.map(item => ({ ...item, tips: [...item.tips], tipsEn: [...item.tipsEn] })) });
const sameOrder = (left: string[], right: string[]) => left.length === right.length && left.every((id, index) => id === right[index]);
const fixedOrder = (ids: string[]) => [...ids.filter(id => id !== 'vip'), ...ids.filter(id => id === 'vip')];
const catalogOrder = (catalog: CommunityBoardCatalog) => fixedOrder(catalog.items.map(item => item.id));
const exhaustedMessage = (common: Common) => common.t('备用图标已全部使用，暂时无法创建新板块。', 'All reserve icons are in use. A new board cannot be created yet.');
const iconOptionsHTML = (catalog: CommunityBoardCatalog, selected: string, common: Common) => {
  const choices = availableCommunityBoardIcons(catalog.items);
  return choices.length ? choices.map(({ id, zh, en }) => `<option value="${id}"${selected === id ? ' selected' : ''}>${common.t(zh, en)}</option>`).join('') : `<option value="">${common.t('暂无可用图标', 'No available icons')}</option>`;
};

function boardRowHTML(board: CommunityBoard, index: number, movableCount: number, busy: boolean, common: Common) {
  const { t, esc, icons = {} } = common;
  const action = (direction: 'up' | 'down') => {
    const label = direction === 'up' ? t('上移', 'Move up') : t('下移', 'Move down');
    const unavailable = busy || board.id === 'vip' || (direction === 'up' ? index === 0 : index >= movableCount - 1);
    return `<button type="button" class="community-button is-small" data-action="community-board-${direction}" data-id="${esc(board.id)}" aria-label="${esc(t(`${label}「${board.zh}」`, `${label}: ${board.en}`))}"${unavailable ? ' disabled' : ''}>${icons[`chevron-${direction}`] || ''}<span>${label}</span></button>`;
  };
  return `<li class="community-board-edit-row" data-board-row="${esc(board.id)}"><span class="community-board-position" data-board-position aria-hidden="true">${index + 1}</span><span class="community-board-edit-icon" aria-hidden="true">${icons[communityBoardIcon(board.icon) ? board.icon : 'megaphone'] || ''}</span><div class="community-board-edit-info"><div class="community-board-edit-name"><strong data-board-name>${esc(t(board.zh, board.en))}</strong>${board.id === 'vip' ? `<span class="community-tag">${t('VIP · 固定', 'VIP · Fixed')}</span>` : ''}</div><p data-board-description>${esc(t(board.description, board.descriptionEn))}</p></div><div class="community-action-group">${action('up')}${action('down')}</div></li>`;
}

export function communityBoardEditorHTML(options: CommunityBoardEditorState & Common): string {
  const { catalog, draftOrder, createDraft, busy, conflicted, message, createMessage, t, esc, icons = {} } = options;
  if (!catalog) return `<div class="community-board-editor-state" role="status">${t('正在读取板块设置…', 'Loading board settings…')}</div>`;
  const boards = new Map(catalog.items.map(item => [item.id, item]));
  const ordered = draftOrder.map(id => boards.get(id)).filter((item): item is CommunityBoard => Boolean(item));
  const dirty = !sameOrder(draftOrder, catalogOrder(catalog));
  const movableCount = ordered.filter(item => item.id !== 'vip').length;
  const noIcons = !availableCommunityBoardIcons(catalog.items).length;
  const disabled = busy ? ' disabled' : '';
  return `<section class="community-board-editor" data-board-editor aria-busy="${busy}"><div class="community-editor-heading"><h2>${t('板块管理', 'Board management')}</h2><p class="community-muted">${t('创建新的交流板块，或调整现有板块的展示顺序。', 'Create a discussion board or arrange the existing boards.')}</p></div>`
    + `<form class="community-board-order-form" data-community-form="board-order"><div class="community-board-section-heading"><h3>${t('板块顺序', 'Board order')}</h3><span data-board-count>${ordered.length} ${t('个板块', 'boards')}</span></div><p class="community-muted">${t('普通板块可以调整顺序；左侧显示前 5 个，会员茶室固定在最后。其余板块可在全部板块页查看。', 'Arrange ordinary boards, then save. The menu shows the first five with Members last. Other boards remain in the directory.')}</p><ol class="community-board-edit-list" data-board-order-list>${ordered.map((item, index) => boardRowHTML(item, index, movableCount, busy || conflicted, options)).join('')}</ol><div class="community-board-save-bar"><p class="community-form-status" data-board-order-status role="status" aria-live="polite">${esc(message || (dirty ? t('顺序有未保存的修改', 'Board order has unsaved changes') : t('当前顺序已保存', 'Current order is saved')))}</p><div class="community-action-group"><button type="button" class="community-button" data-action="community-board-cancel"${disabled}>${conflicted ? t('取消并读取最新', 'Discard and reload') : t('取消修改', 'Discard changes')}</button><button type="submit" class="community-button is-gold" data-board-save${busy || conflicted || !dirty ? ' disabled' : ''}>${t('保存顺序', 'Save order')}</button></div></div></form>`
    + `<form class="community-board-create-form" data-community-form="board-create" novalidate><div class="community-board-section-heading"><h3>${t('新建板块', 'Create a board')}</h3></div><p class="community-muted">${t('新板块对所有成员开放，创建后排在普通板块末尾。已使用的图标不会出现在选项中。', 'New boards are open to all members and follow the ordinary boards. Icons already in use are excluded.')}</p><div class="community-board-create-fields"><div class="community-field"><label class="community-field-l" for="community-board-name">${t('板块名称', 'Board name')}</label><input id="community-board-name" name="name" type="text" maxlength="24" required value="${esc(createDraft.name)}" placeholder="${t('例如：创作交流', 'e.g. Creative discussions')}" aria-describedby="community-board-name-help"${disabled}><small id="community-board-name-help">${t('2–24 个字', '2–24 characters')}</small></div><div class="community-field"><label class="community-field-l" for="community-board-icon">${t('板块图标', 'Board icon')}</label><select id="community-board-icon" name="icon" class="community-select"${busy || noIcons ? ' disabled' : ''}>${iconOptionsHTML(catalog, createDraft.icon, options)}</select></div><div class="community-field community-board-description-field"><label class="community-field-l" for="community-board-description">${t('板块说明', 'Board description')}</label><textarea id="community-board-description" name="description" maxlength="120" required aria-describedby="community-board-description-help" placeholder="${t('介绍这个板块适合讨论什么', 'Describe what members can discuss here')}"${disabled}>${esc(createDraft.description)}</textarea><small id="community-board-description-help">${t('2–120 个字', '2–120 characters')}</small></div></div><details class="community-board-link-settings" data-board-link-settings${createDraft.id ? ' open' : ''}><summary>${t('自定义链接标识', 'Custom link identifier')}<span>${t('可选', 'Optional')}</span></summary><div class="community-field"><label class="community-field-l" for="community-board-id">${t('链接标识', 'Link identifier')}</label><input id="community-board-id" name="id" type="text" maxlength="48" value="${esc(createDraft.id)}" placeholder="${t('留空自动生成；例如 ai-talk', 'Leave blank to generate; e.g. ai-talk')}" aria-describedby="community-board-id-help" autocapitalize="none" spellcheck="false"${disabled}><small id="community-board-id-help">${t('2–48 位，以小写字母开头，可用数字和连字符；创建后固定。', '2–48 characters, starting with a lowercase letter; digits and hyphens allowed. Fixed after creation.')}</small></div></details><div class="community-board-save-bar"><p class="community-form-status" data-board-create-status role="status" aria-live="polite">${esc(noIcons ? exhaustedMessage(options) : createMessage)}</p><button type="submit" class="community-button is-gold" data-board-create${busy || conflicted || noIcons ? ' disabled' : ''}>${icons.plus || ''}<span>${t('创建板块', 'Create board')}</span></button></div></form></section>`;
}

/** A page-local editor. Ordering keeps existing row nodes, fields and focus attached. */
export function createCommunityBoardController(options: ControllerOptions) {
  let catalog: CommunityBoardCatalog | null = null;
  let latest: CommunityBoardCatalog | null = null;
  let draftOrder: string[] = [];
  let createDraft = emptyDraft();
  let iconEdited = false;
  let busy = false, conflicted = false;
  let message = '', createMessage = '';
  let epoch = 0;
  const orderDirty = () => Boolean(catalog && !sameOrder(draftOrder, catalogOrder(catalog)));
  const valid = () => Boolean(catalog && options.active() && options.owner());
  const editor = () => {
    const root = options.root();
    return root?.matches('[data-board-editor]') ? root : root?.querySelector<HTMLElement>('[data-board-editor]') || null;
  };
  const state = (): CommunityBoardEditorState => ({ catalog: catalog ? copyCatalog(catalog) : null, draftOrder: [...draftOrder], createDraft: { ...createDraft }, busy, conflicted, message, createMessage });
  const dirty = () => orderDirty() || Boolean(createDraft.name.trim() || createDraft.description.trim() || createDraft.id.trim() || iconEdited);

  function reconcileIcon() {
    if (!catalog) return;
    const available = availableCommunityBoardIcons(catalog.items);
    if (available.some(icon => icon.id === createDraft.icon)) return;
    const replaced = Boolean(createDraft.icon);
    createDraft = { ...createDraft, icon: available[0]?.id || '' };
    iconEdited = false;
    if (replaced && available.length) createMessage = options.t('原图标已被使用，已选择下一个可用图标；名称和说明草稿已保留。', 'The previous icon is now in use. Another available icon is selected; your name and description draft is retained.');
  }

  function patch() {
    const panel = editor();
    if (!panel || !catalog) return;
    const list = panel.querySelector<HTMLOListElement>('[data-board-order-list]');
    if (!list) return;
    const existing = new Map(Array.from(list.querySelectorAll<HTMLElement>('[data-board-row]')).map(row => [row.dataset.boardRow!, row]));
    const definitions = new Map(catalog.items.map(item => [item.id, item]));
    const movableCount = draftOrder.filter(id => id !== 'vip').length;
    draftOrder.forEach((id, index) => {
      const board = definitions.get(id);
      if (!board) return;
      let row = existing.get(id);
      if (!row) {
        const fragment = list.ownerDocument.createElement('template');
        fragment.innerHTML = boardRowHTML(board, index, movableCount, busy, options);
        row = fragment.content.firstElementChild as HTMLElement;
      }
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
      const position = row.querySelector<HTMLElement>('[data-board-position]');
      if (position) position.textContent = String(index + 1);
      const name = row.querySelector<HTMLElement>('[data-board-name]');
      if (name) name.textContent = options.t(board.zh, board.en);
      const description = row.querySelector<HTMLElement>('[data-board-description]');
      if (description) description.textContent = options.t(board.description, board.descriptionEn);
      for (const direction of ['up', 'down'] as const) {
        const button = row.querySelector<HTMLButtonElement>(`[data-action="community-board-${direction}"]`);
        if (button) button.disabled = busy || conflicted || !options.owner() || id === 'vip' || (direction === 'up' ? index === 0 : index >= movableCount - 1);
      }
    });
    for (const [id, row] of existing) if (!draftOrder.includes(id)) row.remove();
    panel.setAttribute('aria-busy', String(busy));
    const orderStatus = panel.querySelector<HTMLElement>('[data-board-order-status]');
    if (orderStatus) orderStatus.textContent = message || (busy ? options.t('正在保存…', 'Saving…') : orderDirty() ? options.t('顺序有未保存的修改', 'Board order has unsaved changes') : options.t('当前顺序已保存', 'Current order is saved'));
    const createStatus = panel.querySelector<HTMLElement>('[data-board-create-status]');
    const noIcons = !availableCommunityBoardIcons(catalog.items).length;
    if (createStatus) createStatus.textContent = noIcons ? exhaustedMessage(options) : createMessage;
    const count = panel.querySelector<HTMLElement>('[data-board-count]');
    if (count) count.textContent = `${draftOrder.length} ${options.t('个板块', 'boards')}`;
    const cancel = panel.querySelector<HTMLButtonElement>('[data-action="community-board-cancel"]');
    if (cancel) { cancel.disabled = busy || !options.owner(); cancel.textContent = conflicted ? options.t('取消并读取最新', 'Discard and reload') : options.t('取消修改', 'Discard changes'); }
    const save = panel.querySelector<HTMLButtonElement>('[data-board-save]');
    if (save) save.disabled = busy || conflicted || !options.owner() || !orderDirty();
    const create = panel.querySelector<HTMLButtonElement>('[data-board-create]');
    if (create) create.disabled = busy || conflicted || !options.owner() || noIcons;
    for (const field of panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-community-form="board-create"] input, [data-community-form="board-create"] textarea, [data-community-form="board-create"] select')) field.disabled = busy || !options.owner() || (field.name === 'icon' && noIcons);
    // The existing enhanced select observes child/selected changes. Update only
    // its options, retaining the trigger, focused fields, and the rest of the form.
    const select = panel.querySelector<HTMLSelectElement>('[name="icon"]');
    if (select) {
      const choices = availableCommunityBoardIcons(catalog.items);
      const ids = choices.length ? choices.map(icon => icon.id) : [''];
      if (!sameOrder(Array.from(select.options).map(option => option.value), ids)) select.innerHTML = iconOptionsHTML(catalog, createDraft.icon, options);
      select.value = createDraft.icon;
      for (const option of Array.from(select.options)) option.toggleAttribute('selected', option.value === createDraft.icon);
    }
  }
  function conflict() {
    conflicted = true;
    message = options.t('板块已在其他页面更新。你的排序草稿已保留，请取消并读取最新设置后重新调整。', 'Boards changed in another session. Your order draft is retained. Discard it and reload the latest settings before rearranging.');
  }
  function sync(next: CommunityBoardCatalog) {
    const incoming = copyCatalog(next);
    // A read started before a successful write must not roll that write back.
    if (catalog && incoming.version < catalog.version || latest && incoming.version < latest.version) return;
    if (catalog && incoming.version !== catalog.version && orderDirty()) { latest = incoming; conflict(); }
    else if (!conflicted) { catalog = incoming; draftOrder = catalogOrder(incoming); reconcileIcon(); }
    else latest = incoming;
    patch();
  }
  function reset() {
    epoch++; catalog = null; latest = null; draftOrder = []; createDraft = emptyDraft(); iconEdited = false;
    busy = false; conflicted = false; message = ''; createMessage = '';
  }
  async function cancel() {
    if (!valid() || busy || !catalog) return;
    if (conflicted && !latest && options.reload) {
      const identity = epoch;
      busy = true; patch();
      try {
        const result = await options.reload();
        if (identity !== epoch || !options.owner()) return;
        latest = copyCatalog(result);
      } catch (error) {
        if (identity === epoch) message = error instanceof Error ? error.message : options.t('无法读取最新设置，请重试。', 'Could not reload settings. Try again.');
      } finally { if (identity === epoch) { busy = false; patch(); } }
      if (identity !== epoch || !latest) return;
    }
    if (conflicted && !latest) { patch(); return; }
    catalog = latest || catalog; latest = null;
    draftOrder = catalogOrder(catalog); conflicted = false; message = ''; reconcileIcon();
    patch();
  }
  function action(target: HTMLElement) {
    const name = target.dataset.action || '';
    if (!name.startsWith('community-board-')) return false;
    if (!valid() || busy) return true;
    if (name === 'community-board-cancel') { void cancel(); return true; }
    if (conflicted || !['community-board-up', 'community-board-down'].includes(name)) return true;
    const index = draftOrder.indexOf(target.dataset.id || '');
    const destination = index + (name === 'community-board-up' ? -1 : 1);
    if (index < 0 || destination < 0 || destination >= draftOrder.length) return true;
    if (draftOrder[index] === 'vip' || draftOrder[destination] === 'vip') return true;
    [draftOrder[index], draftOrder[destination]] = [draftOrder[destination], draftOrder[index]];
    message = ''; patch();
    const row = target.closest('[data-board-row]');
    const focus = target.hasAttribute('disabled') ? row?.querySelector<HTMLElement>('button:not(:disabled)') : target;
    focus?.focus({ preventScroll: true });
    return true;
  }
  function input(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
    if (field.form?.dataset.communityForm !== 'board-create') return false;
    if (!valid() || busy || !['name', 'description', 'icon', 'id'].includes(field.name)) return true;
    createDraft = { ...createDraft, [field.name]: field.value };
    if (field.name === 'icon') iconEdited = field.value !== availableCommunityBoardIcons(catalog!.items)[0]?.id;
    field.removeAttribute('aria-invalid'); createMessage = '';
    const status = editor()?.querySelector<HTMLElement>('[data-board-create-status]');
    if (status) status.textContent = availableCommunityBoardIcons(catalog!.items).length ? '' : exhaustedMessage(options);
    return true;
  }
  function invalid(fieldName: keyof CreateDraft, value: string) {
    createMessage = value; patch();
    const field = editor()?.querySelector<HTMLElement>(`[name="${fieldName}"]`);
    field?.setAttribute('aria-invalid', 'true');
    field?.closest<HTMLDetailsElement>('details')?.setAttribute('open', '');
    const selectTrigger = field?.parentElement?.querySelector<HTMLElement>('.community-select-trigger');
    (field?.hidden ? selectTrigger : field)?.focus({ preventScroll: true });
  }
  async function create() {
    if (!valid() || busy || conflicted || !catalog) return;
    const name = createDraft.name.trim(), description = createDraft.description.trim(), id = createDraft.id.trim(), icon = createDraft.icon;
    if ([...name].length < 2 || [...name].length > 24) { invalid('name', options.t('板块名称需要 2–24 个字。', 'Board names need 2–24 characters.')); return; }
    if ([...description].length < 2 || [...description].length > 120) { invalid('description', options.t('板块说明需要 2–120 个字。', 'Board descriptions need 2–120 characters.')); return; }
    if (id && !/^[a-z][a-z0-9-]{1,47}$/.test(id)) { invalid('id', options.t('链接标识需要 2–48 位，以小写字母开头，只使用小写字母、数字和连字符。', 'Use 2–48 lowercase letters, digits or hyphens, starting with a letter.')); return; }
    if (!availableCommunityBoardIcons(catalog.items).some(choice => choice.id === icon)) { invalid('icon', options.t('请选择尚未使用的板块图标。', 'Choose an unused board icon.')); return; }
    const identity = epoch, version = catalog.version, retainedOrder = [...draftOrder], retainOrder = orderDirty();
    busy = true; createMessage = options.t('正在创建板块…', 'Creating board…'); patch();
    try {
      const result = await options.create({ name, description, icon, ...(id ? { id } : {}) }, version);
      if (identity !== epoch || !options.owner()) return;
      catalog = copyCatalog(result); latest = null; conflicted = false;
      const ids = catalogOrder(result);
      draftOrder = retainOrder ? fixedOrder([...retainedOrder.filter(value => ids.includes(value)), ...ids.filter(value => !retainedOrder.includes(value))]) : ids;
      createDraft = emptyDraft(); iconEdited = false; reconcileIcon();
      const form = editor()?.querySelector<HTMLFormElement>('[data-community-form="board-create"]');
      if (form) {
        for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')) {
          const key = field.name as keyof CreateDraft;
          if (key in createDraft) { field.value = createDraft[key]; field.removeAttribute('aria-invalid'); }
          if (field.tagName === 'SELECT') for (const option of Array.from((field as HTMLSelectElement).options)) option.selected = option.value === createDraft.icon;
        }
        form.querySelector<HTMLDetailsElement>('details')?.removeAttribute('open');
      }
      createMessage = options.t('板块已创建，可以在社区中查看。', 'Board created and available in the community.');
      options.saved(copyCatalog(result)); options.notify(options.t('板块已创建。', 'Board created.'));
    } catch (error) {
      if (identity === epoch) {
        createMessage = error instanceof Error ? error.message : options.t('创建失败，请稍后重试。', 'Could not create the board. Try again.');
        if (error && typeof error === 'object' && 'status' in error && error.status === 409) conflict();
      }
    } finally { if (identity === epoch) { busy = false; patch(); } }
  }
  async function saveOrder() {
    if (!valid() || busy || conflicted || !catalog || !orderDirty()) return;
    const identity = epoch, ids = [...draftOrder], version = catalog.version;
    busy = true; message = ''; patch();
    try {
      const result = await options.reorder(ids, version);
      if (identity !== epoch || !options.owner()) return;
      catalog = copyCatalog(result); latest = null; draftOrder = catalogOrder(result); reconcileIcon();
      conflicted = false; message = options.t('板块顺序已保存。', 'Board order saved.');
      options.saved(copyCatalog(result)); options.notify(message);
    } catch (error) {
      if (identity === epoch) {
        message = error instanceof Error ? error.message : options.t('保存失败，请稍后重试。', 'Could not save the order. Try again.');
        if (error && typeof error === 'object' && 'status' in error && error.status === 409) conflict();
      }
    } finally { if (identity === epoch) { busy = false; patch(); } }
  }
  function submit(form: HTMLFormElement) {
    if (form.dataset.communityForm === 'board-create') { void create(); return true; }
    if (form.dataset.communityForm === 'board-order') { void saveOrder(); return true; }
    return false;
  }
  return { sync, state, action, input, submit, saveOrder, create, dirty, reset };
}
