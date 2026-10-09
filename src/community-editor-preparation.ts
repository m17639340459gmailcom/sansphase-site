import type { CommunityComposeEditor } from './community-compose-editor.ts';
import type { Translate } from './community.ts';

export type CommunityComposeModule = typeof import('./community-compose-editor.mjs');
type Owner = { main: HTMLElement; frame: number; hash: string };
type Options = {
  load: () => Promise<CommunityComposeModule>;
  current: () => Owner | null;
  mount: (module: CommunityComposeModule, root: HTMLElement) => CommunityComposeEditor;
  removed: (root: HTMLElement) => void;
  t: Translate;
};
type Binding = {
  root: HTMLElement; field: HTMLTextAreaElement; status: HTMLElement; owner: Owner;
  phase: 'loading' | 'text' | 'ready' | 'disposed'; attempt: number;
  timer?: ReturnType<typeof setTimeout>; retryTimer?: ReturnType<typeof setTimeout>;
  composing: boolean; retry: boolean; editor?: CommunityComposeEditor;
  disposeEvents: () => void;
};

// Each inline editor owns its preparation attempt. The import stays eager;
// only an explicit retry can replace the stable native-text recovery state.
export function createCommunityEditorPreparation({ load, current, mount, removed, t }: Options) {
  const bindings = new Map<HTMLElement, Binding>();
  let modulePromise: Promise<CommunityComposeModule> | null = null;
  const pending = (node: Element | null) => Boolean(node?.closest('[data-inline-editor][data-editor-state="loading"]')
    || node?.querySelector('[data-inline-editor][data-editor-state="loading"]'));
  const valid = (binding: Binding) => {
    const now = current();
    return binding.phase !== 'disposed' && bindings.get(binding.root) === binding && binding.root.isConnected
      && now?.main === binding.owner.main && now.frame === binding.owner.frame && now.hash === binding.owner.hash
      && now.main.contains(binding.root);
  };
  const previewing = (binding: Binding) => binding.root.querySelector('[data-action="community-md-preview"]')?.getAttribute('aria-pressed') === 'true';
  function controls(binding: Binding, loading: boolean) {
    const preview = previewing(binding);
    binding.field.disabled = loading;
    binding.root.querySelectorAll<HTMLButtonElement>('[data-action="community-md"], [data-action="community-md-preview"]').forEach(button => {
      button.disabled = loading || (preview && button.dataset.action === 'community-md');
    });
    const picker = binding.root.querySelector<HTMLInputElement>('[data-community-upload]');
    if (picker) picker.disabled = loading || binding.phase !== 'ready' || preview;
  }
  function focus(node: Element | null) {
    const root = node?.closest<HTMLElement>('[data-inline-editor]') || node?.querySelector<HTMLElement>('[data-inline-editor][data-editor-state="loading"]');
    if (!root || !pending(root)) return false;
    root.querySelector<HTMLElement>('.community-editor-upload-status')?.focus({ preventScroll: true });
    return true;
  }
  function recovery(binding: Binding, timeout: boolean) {
    if (!valid(binding)) return;
    const focused = binding.root.ownerDocument.activeElement === binding.status;
    clearTimeout(binding.timer); binding.timer = undefined;
    binding.phase = 'text'; binding.root.dataset.editorState = 'text'; binding.root.removeAttribute('aria-busy');
    const host = binding.root.querySelector<HTMLElement>('[data-community-rich]');
    if (host) { host.hidden = true; host.replaceChildren(); }
    binding.field.hidden = previewing(binding);
    binding.root.ownerDocument.getElementById(`${binding.field.id}-label`)?.setAttribute('for', binding.field.id);
    controls(binding, false);
    binding.status.textContent = timeout
      ? t('编辑器准备超时，可先输入文字；插入图片请重试。', 'Editor preparation timed out. You can type; retry to insert images.')
      : t('编辑器未能加载，可先输入文字；插入图片请重试。', 'The editor could not load. You can type; retry to insert images.');
    const retry = binding.root.ownerDocument.createElement('button');
    retry.type = 'button'; retry.dataset.communityEditorRetry = ''; retry.className = 'community-button is-small';
    retry.textContent = t('重试', 'Retry'); binding.status.append(' ', retry);
    if (focused && !previewing(binding)) binding.field.focus({ preventScroll: true });
  }
  function start(binding: Binding, explicit = false) {
    if (!valid(binding)) return;
    // A pending write owns its form. Retrying preparation must never unlock it.
    if (binding.root.hasAttribute('data-community-busy') || binding.root.closest('form')?.hasAttribute('data-community-busy')) return;
    clearTimeout(binding.retryTimer); binding.retryTimer = undefined; binding.retry = false;
    const active = binding.root.ownerDocument.activeElement;
    const handoff = explicit && Boolean(active && binding.root.contains(active));
    binding.phase = 'loading'; binding.root.dataset.editorState = 'loading'; binding.root.setAttribute('aria-busy', 'true');
    controls(binding, true);
    binding.status.textContent = t('正在准备编辑器…', 'Preparing the editor…');
    if (handoff) binding.status.focus({ preventScroll: true });
    const attempt = ++binding.attempt;
    if (!modulePromise) {
      const promise = Promise.resolve().then(load); modulePromise = promise;
      void promise.catch(() => { if (modulePromise === promise) modulePromise = null; });
    }
    const promise = modulePromise;
    binding.timer = setTimeout(() => {
      if (binding.attempt !== attempt || binding.phase !== 'loading') return;
      if (modulePromise === promise) modulePromise = null;
      recovery(binding, true);
    }, 10000);
    void promise.then(module => {
      if (!valid(binding) || binding.phase !== 'loading' || binding.attempt !== attempt) return;
      clearTimeout(binding.timer); binding.timer = undefined;
      const focused = binding.root.ownerDocument.activeElement === binding.status;
      try {
        binding.editor = mount(module, binding.root);
        binding.phase = 'ready'; binding.root.dataset.editorState = 'ready'; binding.root.removeAttribute('aria-busy');
        controls(binding, false); binding.status.replaceChildren();
        if (previewing(binding)) binding.editor.preview(true);
        else if (focused) binding.editor.focus();
      } catch {
        binding.editor?.destroy(); binding.editor = undefined; removed(binding.root);
        recovery(binding, false);
      }
    }, () => { if (binding.phase === 'loading' && binding.attempt === attempt) recovery(binding, false); });
  }
  function register(root: HTMLElement, owner: Owner) {
    const field = root.querySelector<HTMLTextAreaElement>('textarea');
    const status = root.querySelector<HTMLElement>('.community-editor-upload-status');
    if (!field || !status) return;
    const binding: Binding = { root, field, status, owner, phase: 'loading', attempt: 0, composing: false, retry: false, disposeEvents: () => {} };
    status.tabIndex = -1;
    bindings.set(root, binding);
    const scheduleRetry = () => {
      clearTimeout(binding.retryTimer); binding.retryTimer = undefined;
      if (!binding.retry || binding.composing) return;
      // The final native input event follows compositionend in the same task.
      binding.retryTimer = setTimeout(() => { binding.retryTimer = undefined; if (binding.retry && !binding.composing) start(binding, true); }, 0);
    };
    const retry = (event: Event) => {
      if (!(event.target as Element).closest('[data-community-editor-retry]')) return;
      event.preventDefault(); event.stopPropagation();
      if (!valid(binding) || binding.phase !== 'text') return;
      if (root.hasAttribute('data-community-busy') || root.closest('form')?.hasAttribute('data-community-busy')) return;
      binding.retry = true; scheduleRetry();
    };
    const compositionStart = () => { binding.composing = true; clearTimeout(binding.retryTimer); binding.retryTimer = undefined; };
    const compositionEnd = () => { binding.composing = false; scheduleRetry(); };
    const input = () => { if (binding.retry) scheduleRetry(); };
    const mediaUnavailable = () => {
      const button = status.querySelector('[data-community-editor-retry]');
      status.textContent = t('图片编辑器尚未就绪，文字已保留；插入图片请重试。', 'The image editor is not ready. Your text is retained; retry to insert images.');
      if (button) status.append(' ', button);
    };
    const paste = (event: ClipboardEvent) => {
      if (binding.phase === 'ready' || event.target !== field) return;
      if (binding.phase === 'loading') { event.preventDefault(); focus(root); return; }
      if (!valid(binding) || binding.phase !== 'text') return;
      const data = event.clipboardData;
      if (!data?.files.length && ![...(data?.items || [])].some(item => item.kind === 'file')) return;
      event.preventDefault();
      const text = data?.getData('text/plain') || '';
      if (text) {
        field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
        field.dispatchEvent(new root.ownerDocument.defaultView!.Event('input', { bubbles: true }));
      }
      mediaUnavailable();
    };
    const files = (event: Event) => {
      if (binding.phase === 'ready' || !(event.target as Element).matches('[data-community-upload]')) return;
      event.stopImmediatePropagation();
      (event.target as HTMLInputElement).value = '';
      if (binding.phase === 'text') mediaUnavailable();
    };
    const drop = (event: DragEvent) => {
      if (binding.phase === 'ready' || !event.dataTransfer?.files.length) return;
      event.preventDefault(); if (binding.phase === 'text') mediaUnavailable();
    };
    root.addEventListener('click', retry);
    field.addEventListener('compositionstart', compositionStart);
    field.addEventListener('compositionend', compositionEnd);
    field.addEventListener('input', input);
    root.addEventListener('paste', paste);
    root.addEventListener('change', files, true);
    root.addEventListener('drop', drop);
    binding.disposeEvents = () => {
      root.removeEventListener('click', retry);
      field.removeEventListener('compositionstart', compositionStart); field.removeEventListener('compositionend', compositionEnd);
      field.removeEventListener('input', input); root.removeEventListener('paste', paste);
      root.removeEventListener('change', files, true); root.removeEventListener('drop', drop);
    };
    start(binding);
  }
  function dispose(binding: Binding) {
    binding.phase = 'disposed'; binding.attempt++;
    clearTimeout(binding.timer); clearTimeout(binding.retryTimer); binding.disposeEvents();
    binding.editor?.destroy(); removed(binding.root); bindings.delete(binding.root);
    binding.root.removeAttribute('aria-busy');
  }
  return {
    pending, focus,
    roots: () => [...bindings.keys()],
    sync() {
      for (const binding of bindings.values()) if (!valid(binding)) dispose(binding);
      const owner = current(); if (!owner) return;
      for (const root of owner.main.querySelectorAll<HTMLElement>('[data-inline-editor]')) if (!bindings.has(root)) register(root, owner);
    },
    clear() { for (const binding of bindings.values()) dispose(binding); },
  };
}
