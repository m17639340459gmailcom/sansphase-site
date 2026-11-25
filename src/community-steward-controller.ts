import { communityBoards, readyData } from './community.mjs';
import { communityStaffCapabilities, communityStaffAssignableRoles, communityStaffCanAppointRole } from './community-staff.mjs';
import type { CommunityLoad, CommunityMe, Translate } from './community.ts';
import type { CommunityManage, CommunityMember } from './community-pages.ts';
import type { CommunityStaffPermission } from './community-staff.ts';

type Form = HTMLFormElement;
type Configuration = { boards: string[]; role?: string; permissions?: CommunityStaffPermission[]; delegable?: CommunityStaffPermission[] };
type Options = {
  root: () => HTMLElement | null;
  viewer: () => CommunityMe | null;
  roster: () => CommunityManage | null;
  inRoster: () => boolean;
  identity: () => number;
  loadMember: (uid: string) => Promise<CommunityLoad<CommunityMember>>;
  refreshRoster: () => Promise<void>;
  refreshViewer: () => Promise<void>;
  save: (uid: string, configuration: { on: boolean } & Partial<Configuration>) => Promise<unknown>;
  reload: () => Promise<void>;
  paint: () => void;
  notify: (text: string) => void;
  t: Translate;
  status: (form: Form, text: string) => void;
  invalid: (form: Form, field: Element | null, text: string) => boolean;
  confirmed: (button: HTMLButtonElement, text: string) => boolean;
  syncSelects: () => void;
};
const loading = { state: 'loading' } as const;
const fieldOf = (form: Form, name: string) => form.elements.namedItem(name) as HTMLInputElement | null;
const valueOf = (form: Form, name: string) => fieldOf(form, name)?.value || '';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const quoted = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`;

/** Appointment drafts are local; the host remains the authority for identity, requests and page refreshes. */
export function createCommunityStewardController(options: Options) {
  const { paint, notify, t: tr, status, invalid, confirmed } = options;
  let stewardCandidate: CommunityLoad<CommunityMember> | null = null;
  let stewardLookupUid = '';
  let stewardLookupRequest = 0;
  let stewardBusy = false;
  let stewardConfirmation: { form: Form; configuration: string } | null = null;
  let stewardEditingUid: string | null = null;
  let stewardScopeDraft: ({ uid: string } & Configuration) | null = null;
  const dirty = () => Boolean([...options.root()?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-community-form="steward-scope"] input, [data-community-form="steward-scope"] select') || []].some(field => field instanceof HTMLInputElement ? field.type === 'checkbox' ? field.checked !== field.defaultChecked : field.value !== field.defaultValue : [...field.options].some(option => option.selected !== option.defaultSelected)));
  async function submitStewardLookup(form: Form) {
    if (!canAppointStaff() || !options.inRoster()) return;
    const uid = valueOf(form, 'uid').trim();
    if (!uid || uid.length > 64) return invalid(form, fieldOf(form, 'uid'), tr('请输入有效的读者 UID。', 'Enter a valid reader UID.'));
    if (stewardBusy || (stewardCandidate?.state === 'loading' && stewardLookupUid === uid)) return;
    const requestId = ++stewardLookupRequest, identity = options.identity(), hash = location.hash;
    stewardLookupUid = uid;
    stewardCandidate = loading;
    paint();
    const result = await options.loadMember(uid);
    if (requestId !== stewardLookupRequest || identity !== options.identity() || hash !== location.hash) return;
    stewardCandidate = result;
    if (result.state === 'ready' && result.data.steward) {
      await options.refreshRoster();
      if (requestId !== stewardLookupRequest || identity !== options.identity() || hash !== location.hash) return;
    }
    paint();
  }
  function syncStewardTools(root: ParentNode) {
    const scopeDraft = stewardScopeDraft;
    root.querySelectorAll<HTMLButtonElement>('[data-action="community-steward"], [data-action="community-steward-edit"], [data-action="community-steward-edit-cancel"], [data-community-form="steward-scope"] button[type="submit"]').forEach(control => { control.disabled = stewardBusy; });
    root.querySelectorAll<HTMLInputElement>('[data-community-form="steward-scope"] input[type="checkbox"]').forEach(control => {
      control.disabled = stewardBusy;
      if (stewardBusy && scopeDraft && control.form?.dataset.uid === scopeDraft.uid) control.checked = (control.name === 'boards' ? scopeDraft.boards : control.name === 'permissions' ? scopeDraft.permissions : scopeDraft.delegable)?.includes(control.value as CommunityStaffPermission) ?? control.checked;
    });
    root.querySelectorAll<HTMLSelectElement>('[data-community-form="steward-scope"] select').forEach(control => { control.disabled = stewardBusy; if (stewardBusy && scopeDraft?.role && control.form?.dataset.uid === scopeDraft.uid) control.value = scopeDraft.role; });
    root.querySelectorAll<Form>('[data-community-form="steward-scope"]').forEach(syncStewardWarning);
    options.syncSelects();
    const lookup = root.querySelector<HTMLButtonElement>('[data-community-form="steward-lookup"] button[type="submit"]');
    if (lookup) lookup.disabled = stewardBusy || stewardCandidate?.state === 'loading';
  }
  function syncStewardWarning(form: Form) {
    const warning = form.querySelector<HTMLElement>('[data-steward-chain-warning]');
    if (warning) warning.hidden = form.dataset.parentChange !== 'true' && valueOf(form, 'role') === form.dataset.originalRole;
  }
  function changeStewardScope(field: HTMLInputElement | HTMLSelectElement) {
    const form = field.form;
    if (!form || form.dataset.communityForm !== 'steward-scope') return false;
    if (stewardBusy) { syncStewardTools(form); return true; }
    stewardConfirmation = null;
    if (field instanceof HTMLInputElement && (field.name === 'permissions' || field.name === 'delegable')) {
      const counterpart = [...form.querySelectorAll<HTMLInputElement>(`input[name="${field.name === 'permissions' ? 'delegable' : 'permissions'}"]`)].find(input => input.value === field.value);
      if (counterpart && (field.name === 'permissions' ? !field.checked : field.checked)) counterpart.checked = field.checked;
    }
    syncStewardWarning(form);
    status(form, '');
    return true;
  }
  async function submitStewardScope(form: Form) {
    if (stewardBusy || !canAppointStaff() || !options.inRoster()) return;
    const uid = form.dataset.uid || '';
    const existing = form.dataset.existing === 'true';
    if (existing) {
      if (uid !== stewardEditingUid || !options.roster()?.stewards?.some(person => person.uid === uid && person.role === 'reader')) return;
    } else {
      const candidate = readyData(stewardCandidate);
      const lookup = options.root()?.querySelector<Form>('[data-community-form="steward-lookup"]');
      if (!candidate?.canAppoint || candidate.self || candidate.steward || candidate.person.role !== 'reader' || candidate.person.uid !== uid || !lookup || valueOf(lookup, 'uid').trim() !== uid) return;
    }
    const boards = [...form.querySelectorAll<HTMLInputElement>('input[name="boards"]:checked')].map(input => input.value);
    if (!boards.length) return invalid(form, form.querySelector('input[name="boards"]'), tr('请至少选择一个负责板块。', 'Select at least one assigned board.'));
    if (new Set(boards).size !== boards.length || boards.some(id => !communityBoards.some(board => board.id === id))) return status(form, tr('板块选择无效，请重新选择。', 'Invalid board selection. Select again.'));
    const staff = options.viewer()?.staff;
    if (staff !== undefined) {
      const target = existing ? options.roster()?.stewards?.find(person => person.uid === uid) : null;
      const role = valueOf(form, 'role');
      if (!staff || !communityStaffCanAppointRole(staff.role, role) || (existing && target?.canAppoint !== true) || boards.some(board => !staff.boards.includes(board))) return status(form, tr('管理身份或板块授权已改变，请重新读取后配置。', 'Management authority or board scope changed; reload before configuring.'));
      const selected = (name: string) => [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(input => input.value);
      const requested = selected('permissions'), delegated = selected('delegable');
      const validCapability = (value: string): value is CommunityStaffPermission => communityStaffCapabilities.some(cap => cap.id === value);
      if (!requested.every(validCapability) || !delegated.every(validCapability) || requested.some(cap => !staff.delegable.includes(cap)) || delegated.some(cap => !requested.includes(cap))) return status(form, tr('只可下发上级允许的能力；可继续下发的能力必须同时设为可执行。', 'Grant only capabilities your superior permits; delegable capabilities must also be granted.'));
      const configuration = { role, boards, permissions: requested, delegable: delegated };
      const chainChanges = existing && (target?.staff?.role !== role || (staff.role === 'owner' && target?.staff?.parent?.kind === 'reader'));
      if (chainChanges) {
        const confirmation = JSON.stringify(configuration);
        if (stewardConfirmation?.form !== form || stewardConfirmation.configuration !== confirmation) {
          stewardConfirmation = { form, configuration: confirmation };
          return status(form, tr('此操作会撤销这位成员的全部下属职务。请核对配置，再次点击保存以确认。', 'This revokes all subordinate appointments. Check the configuration, then click Save again to confirm.'));
        }
      }
      stewardConfirmation = null;
      stewardScopeDraft = { uid, ...configuration };
      await saveSteward(uid, true, configuration);
    } else {
      stewardScopeDraft = { uid, boards };
      await saveSteward(uid, true, { boards });
    }
  }
  function canAppointStaff() {
    const viewer = options.viewer();
    return Boolean(viewer && !viewer.management?.browsingAsReader && (viewer.staff === undefined ? viewer.owner : viewer.staff && communityStaffAssignableRoles(viewer.staff.role).length && viewer.staff.permissions.includes('staff.appoint')));
  }
  async function updateSteward(button: HTMLButtonElement) {
    if (stewardBusy || !canAppointStaff()) return;
    const uid = button.dataset.uid || '';
    if (!uid || button.dataset.on !== 'false') return;
    if (!confirmed(button, tr('确认撤销', 'Confirm removal'))) return;
    await saveSteward(uid, false);
  }
  async function saveSteward(uid: string, on: boolean, configuration?: Configuration) {
    const roster = options.inRoster();
    const requestId = stewardLookupRequest, identity = options.identity(), hash = location.hash;
    stewardBusy = true;
    { const root = options.root(); if (root) syncStewardTools(root); }
    try {
      await options.save(uid, { on, ...(on ? configuration : {}) });
      if (identity !== options.identity()) return;
      notify(tr('管理成员已更新。', 'Staff member updated.'));
      if (stewardEditingUid === uid) stewardEditingUid = null;
      stewardScopeDraft = null;
      if (!roster) { await options.reload(); return; }
      const refreshCandidate = async () => {
        if (stewardLookupUid !== uid || requestId !== stewardLookupRequest) return;
        const result = await options.loadMember(uid);
        if (requestId === stewardLookupRequest && identity === options.identity() && hash === location.hash) stewardCandidate = result;
      };
      await Promise.all([options.refreshRoster(), options.refreshViewer(), refreshCandidate()]);
      if (identity === options.identity() && hash === location.hash) paint();
    } catch (error) {
      if (identity !== options.identity() || hash !== location.hash) return;
      const form = options.root()?.querySelector<Form>(`[data-community-form="steward-scope"][data-uid=${quoted(uid)}]`) || options.root()?.querySelector<Form>('[data-community-form="steward-lookup"]');
      if (form) status(form, message(error)); else notify(message(error));
    } finally {
      if (identity === options.identity()) {
        stewardBusy = false;
        stewardScopeDraft = null;
        { const root = options.root(); if (root) syncStewardTools(root); }
      }
    }
  }
  function invalidateCandidate() { stewardCandidate = null; stewardLookupRequest++; }
  function resetLookup() { invalidateCandidate(); stewardLookupUid = ''; }
  function leave() { resetLookup(); stewardEditingUid = null; stewardScopeDraft = null; }
  function reset() { leave(); stewardBusy = false; stewardConfirmation = null; }
  function edit(target: HTMLButtonElement) {
    if (stewardBusy || !canAppointStaff() || !options.inRoster() || !options.roster()?.stewards?.some(person => person.uid === target.dataset.uid)) return;
    if (options.viewer()?.staff !== undefined && stewardEditingUid !== target.dataset.uid && dirty()
      && !window.confirm(tr('管理配置尚未保存，确定切换成员吗？', 'The management configuration is unsaved. Switch members?'))) return;
    stewardEditingUid = target.dataset.uid || null; paint();
  }
  function cancel(target: HTMLButtonElement) {
    if (!stewardBusy) {
      const form = target.closest<Form>('[data-community-form="steward-scope"]');
      if (form?.dataset.existing === 'false') resetLookup();
      else if (form?.dataset.uid === stewardEditingUid) stewardEditingUid = null;
      paint();
    }
  }
  function input(field: HTMLInputElement | HTMLTextAreaElement) {
    const form = field.form;
    if (form?.dataset.communityForm !== 'steward-lookup' || field.name !== 'uid') return;
    resetLookup();
    options.root()?.querySelector('.community-steward-candidate')?.replaceChildren();
    options.root()?.querySelector('.community-steward-candidate')?.removeAttribute('aria-busy');
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]'); if (button) button.disabled = stewardBusy;
    status(form, '');
  }
  return {
    get candidate() { return stewardCandidate; },
    get editingUid() { return stewardEditingUid; },
    get busy() { return stewardBusy; },
    lookup: submitStewardLookup, submit: submitStewardScope, update: updateSteward,
    sync: syncStewardTools, change: changeStewardScope, edit, cancel, input, dirty,
    invalidateCandidate, resetLookup, leave, reset,
  };
}
