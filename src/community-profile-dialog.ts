import A11yDialog from 'a11y-dialog';
import { communityProfileHTML, communityProfileDialogHTML } from './community-profile.mjs';
import type { Common, CommunityLoad } from './community.ts';
import type { CommunityProfile } from './community-profile.ts';
import type { CommunityProfileCropOptions, CommunityProfileCropSession } from './community-profile-crop.ts';
import { communityImageBytes } from './community-rules.mjs';

type CropFactory = (options: CommunityProfileCropOptions) => Promise<CommunityProfileCropSession>;
type ImagePreview = { source: File; file: File | null; url: string; cropNode: HTMLElement; crop?: CommunityProfileCropSession };

type Options = {
  busy: () => boolean;
  click: (event: Event) => void;
  submit: (event: Event) => void;
  input: (event: Event) => void;
  retry: () => void;
  returnFocus: () => HTMLElement | null;
  crop?: CropFactory;
};

// Use the installed dialog library for Escape, focus trapping and focus return.
// The editor is mounted once under body, outside the scrolling community frame.
export function createCommunityProfileDialog(options: Options) {
  let layer: HTMLElement | null = null;
  let dialog: A11yDialog | null = null;
  let common: Common | null = null;
  let displayed: CommunityLoad<CommunityProfile> | null = null;
  let forced = false;
  let suspended = false;
  let overflow = '';
  let opener: Element | null = null;
  const background = new Map<HTMLElement, boolean>();
  const previews = new Map<string, ImagePreview>();
  const createCrop: CropFactory = options.crop || (async settings => (await import('./community-profile-crop.mjs')).createCommunityProfileCrop(settings));
  const root = () => layer?.querySelector<HTMLElement>('[data-profile-content]') || null;
  const dirty = () => Boolean([...(root()?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[name="nickname"], [name="signature"]') || [])].some(field => field.value !== field.defaultValue)
    || [...(root()?.querySelectorAll<HTMLInputElement>('[data-profile-file]') || [])].some(field => field.files?.length));
  function releasePreview(kind: string) {
    const value = previews.get(kind);
    if (value) { value.crop?.destroy(); value.cropNode.remove(); layer?.ownerDocument.defaultView?.URL.revokeObjectURL?.(value.url); }
    previews.delete(kind);
  }
  function restoreBackground() {
    for (const [node, inert] of background) node.inert = inert;
    background.clear();
    if (layer) layer.ownerDocument.body.style.overflow = overflow;
  }
  function lockBackground(host: Document) {
    overflow = host.body.style.overflow;
    for (const node of host.body.children) {
      if (node === layer || node.matches('script, style, link')) continue;
      const element = node as HTMLElement; background.set(element, Boolean(element.inert)); element.inert = true;
    }
    host.body.style.overflow = 'hidden';
  }
  function close() {
    forced = true;
    dialog?.hide();
    // destroy() clones an attached container to strip listeners. Detach first,
    // so there is no hidden duplicate editor left in the document.
    layer?.remove(); dialog?.destroy(); dialog = null;
    restoreBackground();
    for (const kind of previews.keys()) releasePreview(kind);
    layer = null; common = null; displayed = null;
    if (opener && !opener.isConnected) options.returnFocus()?.focus({ preventScroll: true });
    opener = null;
    forced = false;
    suspended = false;
  }
  function restoreServerPreview(kind: string) {
    const preview = root()?.querySelector<HTMLElement>(`[data-profile-preview="${kind}"]`);
    if (!preview || !common) return;
    const template = preview.ownerDocument.createElement('template');
    template.innerHTML = communityProfileHTML({ ...common, profile: current });
    const original = template.content.querySelector(`[data-profile-preview="${kind}"]`);
    if (original) preview.replaceChildren(...original.childNodes);
  }
  function showFile(field: HTMLInputElement) {
    const kind = field.dataset.profileFile || '';
    const file = field.files?.[0];
    const form = field.form;
    if (!form || !common) return;
    const caption = form.querySelector<HTMLElement>('[data-profile-file-name]');
    const clear = form.querySelector<HTMLButtonElement>('[data-profile-clear]');
    const submit = form.querySelector<HTMLButtonElement>('[data-profile-upload-submit]');
    const feedback = form.querySelector<HTMLElement>('.community-form-status');
    if (feedback?.dataset.profileFileError) { feedback.textContent = ''; delete feedback.dataset.profileFileError; }
    if (caption) { caption.hidden = !file; caption.textContent = file ? common.t(`已选择：${file.name}`, `Selected: ${file.name}`) : ''; }
    if (clear) clear.hidden = !file;
    if (submit) submit.hidden = !previews.get(kind)?.file;
    if (!file) { releasePreview(kind); restoreServerPreview(kind); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > communityImageBytes(true)) {
      releasePreview(kind); restoreServerPreview(kind);
      if (feedback) { feedback.dataset.profileFileError = 'true'; feedback.textContent = file.size > communityImageBytes(true) ? common.t('原图不能超过 25MB，请换一张图片。', 'Original image cannot exceed 25MB. Choose another image.') : common.t('请选择 JPG、PNG 或 WebP 图片。', 'Choose JPG, PNG or WebP.'); }
      return;
    }
    const urlAPI = layer?.ownerDocument.defaultView?.URL;
    if (!urlAPI?.createObjectURL) return;
    if (previews.get(kind)?.source !== file && (kind === 'avatar' || kind === 'background')) {
      releasePreview(kind);
      const cropNode = field.ownerDocument.createElement('div'); cropNode.dataset.profileCrop = kind;
      const old = form.querySelector(`[data-profile-crop="${kind}"]`);
      if (old) old.replaceWith(cropNode); else form.append(cropNode);
      cropNode.textContent = common.t('正在打开图片…', 'Opening image…');
      const entry: ImagePreview = { source: file, file: null, url: urlAPI.createObjectURL(file), cropNode };
      previews.set(kind, entry);
      const context = common;
      void createCrop({ container: cropNode, kind, file, common: context,
        onUse: cropped => {
          if (previews.get(kind) !== entry || !cropNode.isConnected) return;
          urlAPI.revokeObjectURL?.(entry.url);
          entry.file = cropped; entry.url = urlAPI.createObjectURL(cropped);
          entry.crop?.destroy(); entry.crop = undefined; cropNode.hidden = true;
          showFile(field);
        },
        onCancel: () => {
          if (previews.get(kind) !== entry) return;
          field.value = ''; releasePreview(kind); displayed = null; render(valueForRender());
        },
      }).then(session => {
        if (previews.get(kind) !== entry || !cropNode.isConnected || entry.file) session.destroy();
        else entry.crop = session;
      }).catch(error => {
        if (previews.get(kind) !== entry || !cropNode.isConnected) return;
        cropNode.textContent = error instanceof Error ? error.message : context.t('图片无法读取，请重新选择。', 'Could not read this image. Choose another.');
      });
    }
    if (submit) submit.hidden = !previews.get(kind)?.file;
    const url = previews.get(kind)?.url;
    const preview = root()?.querySelector<HTMLElement>(`[data-profile-preview="${kind}"]`);
    if (!preview || !url) return;
    const image = preview.ownerDocument.createElement('img');
    image.src = url; image.alt = common.t('所选图片预览，尚未提交', 'Selected image preview, not yet submitted');
    image.className = kind === 'avatar' ? 'community-profile-local-avatar' : 'community-profile-local-background';
    preview.replaceChildren(image);
  }
  function render(value: CommunityLoad<CommunityProfile>) {
    const content = root();
    const feedback = layer?.querySelector('[data-profile-dialog-status]');
    if (feedback && !options.busy()) feedback.textContent = '';
    if (!content || !common || displayed === value || options.busy()) return;
    const template = content.ownerDocument.createElement('template');
    template.innerHTML = communityProfileHTML({ ...common, profile: value });
    const active = content.ownerDocument.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const activeID = active && content.contains(active) ? active.id : '';
    const caret = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    for (const field of content.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
      const twin = template.content.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[id="${field.id}"]`);
      if (!twin) continue;
      if (field instanceof HTMLInputElement && field.type === 'file') { if (field.files?.length) twin.replaceWith(field); else releasePreview(field.dataset.profileFile || ''); }
      else if (field.value !== field.defaultValue) twin.value = field.value;
    }
    for (const [kind, entry] of previews) template.content.querySelector(`[data-profile-crop="${kind}"]`)?.replaceWith(entry.cropNode);
    content.replaceChildren(template.content);
    displayed = value;
    for (const field of content.querySelectorAll<HTMLInputElement>('[data-profile-file]')) showFile(field);
    const signature = content.querySelector<HTMLTextAreaElement>('[name="signature"]');
    if (signature) signature.dispatchEvent(new signature.ownerDocument.defaultView!.Event('input', { bubbles: true }));
    const focused = active?.isConnected && content.contains(active) ? active
      : activeID ? content.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[id="${activeID}"]`) : null;
    focused?.focus({ preventScroll: true });
    if (focused && caret && caret[0] !== null && caret[1] !== null) try { focused.setSelectionRange(caret[0], caret[1]); } catch { /* files have no caret */ }
  }
  function open(host: Document, context: Common, value: CommunityLoad<CommunityProfile>) {
    if (layer) { render(value); return; }
    common = context;
    opener = host.activeElement;
    layer = host.createElement('div'); layer.id = 'community-profile-dialog'; layer.className = 'community-profile-dialog';
    layer.setAttribute('aria-labelledby', 'community-profile-title');
    layer.innerHTML = communityProfileDialogHTML(context);
    host.body.append(layer);
    dialog = new A11yDialog(layer);
    dialog.on('hide', event => {
      if (!forced && options.busy()) {
        event.preventDefault();
        const feedback = layer?.querySelector('[data-profile-dialog-status]');
        if (feedback) feedback.textContent = context.t('正在提交，请稍候。', 'Submission in progress. Please wait.');
        return;
      }
      if (!forced && dirty() && !host.defaultView?.confirm(context.t('还有未提交的资料修改，放弃修改并关闭吗？', 'Discard your unsaved profile changes and close?'))) { event.preventDefault(); return; }
      restoreBackground();
      // Removal runs after the library has restored the opener's focus.
      if (!forced) queueMicrotask(close);
    });
    layer.addEventListener('submit', options.submit);
    layer.addEventListener('input', options.input);
    layer.addEventListener('change', event => { if (event.target instanceof HTMLInputElement && event.target.hasAttribute('data-profile-file')) showFile(event.target); });
    layer.addEventListener('click', event => {
      const target = (event.target as Element).closest<HTMLElement>('[data-profile-clear]');
      if (target) {
        const kind = target.dataset.profileClear || '';
        const field = root()?.querySelector<HTMLInputElement>(`[data-profile-file="${kind}"]`);
        if (field) field.value = '';
        releasePreview(kind); displayed = null; render(valueForRender());
        return;
      }
      if ((event.target as Element).closest('[data-action="community-retry"]')) { options.retry(); return; }
      options.click(event);
    });
    render(value); dialog.show();
    lockBackground(host);
  }
  // Clear-selection restores the most recent server state rather than the state
  // captured on opening (a different field may have been saved since then).
  let current: CommunityLoad<CommunityProfile> = { state: 'loading' };
  const valueForRender = () => current;
  return {
    open(host: Document, context: Common, value: CommunityLoad<CommunityProfile>) { current = value; open(host, context, value); },
    render(value: CommunityLoad<CommunityProfile>) { current = value; render(value); },
    suspend() {
      if (!layer || suspended) return;
      forced = true; dialog?.hide(); forced = false; suspended = true;
    },
    resume() {
      if (!layer || !suspended) return;
      suspended = false; dialog?.show(); lockBackground(layer.ownerDocument);
    },
    file(kind: 'avatar' | 'background') {
      const entry = previews.get(kind);
      return entry ? entry.file : root()?.querySelector<HTMLInputElement>(`[data-profile-file="${kind}"]`)?.files?.[0] || null;
    },
    root, dirty, close, opened: () => Boolean(layer),
  };
}
