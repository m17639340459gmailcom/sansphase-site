import CropperExport from 'cropperjs';
import type { CropperImage, CropperSelection } from 'cropperjs';
import type { Common } from './community.ts';
import { readerImageBytes } from './upload-policy.mjs';

export type CommunityProfileCropOptions = {
  container: HTMLElement; kind: 'avatar' | 'background'; file: File; common: Common;
  onUse: (file: File) => void; onCancel: () => void;
};
export type CommunityProfileCropSession = { destroy(): void };
type Bounds = { x: number; y: number; width: number; height: number };
// Cropper 2 ships an ESM constructor with a CommonJS-classified declaration.
// NodeNext nests its declared default; retain that exact public constructor type.
const Cropper = CropperExport as unknown as typeof CropperExport.default;
type CropperInstance = InstanceType<typeof Cropper>;

const template = (avatar: boolean) => `<cropper-canvas background>
  <cropper-image scalable translatable initial-fit="contain"></cropper-image>
  <cropper-shade></cropper-shade><cropper-handle action="move" plain></cropper-handle>
  <cropper-selection initial-coverage="0.65" initial-aspect-ratio="${avatar ? 1 : 16 / 9}" ${avatar ? 'aspect-ratio="1"' : ''} movable resizable precise>
    <cropper-grid role="presentation" bordered covered></cropper-grid><cropper-crosshair centered></cropper-crosshair>
    <cropper-handle action="move" theme-color="rgba(255,255,255,.12)"></cropper-handle>
    ${['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'].map(side => `<cropper-handle action="${side}-resize"></cropper-handle>`).join('')}
  </cropper-selection></cropper-canvas>`;
const contains = (outer: Bounds, inner: Bounds) => [outer.x, outer.y, outer.width, outer.height, inner.x, inner.y, inner.width, inner.height].every(Number.isFinite)
  && inner.width > 0 && inner.height > 0 && inner.x >= outer.x - 0.01 && inner.y >= outer.y - 0.01
  && inner.x + inner.width <= outer.x + outer.width + 0.01 && inner.y + inner.height <= outer.y + outer.height + 0.01;

/** One local crop editor. Uploading and moderation remain the profile dialog's responsibility. */
export async function createCommunityProfileCrop(options: CommunityProfileCropOptions): Promise<CommunityProfileCropSession> {
  const { container, kind, file, common: { t }, onUse, onCancel } = options;
  const doc = container.ownerDocument, view = doc.defaultView;
  if (!view?.URL.createObjectURL) throw Error(t('当前浏览器无法打开图片裁剪，请更新浏览器后再试。', 'Update your browser to crop this image.'));
  const avatar = kind === 'avatar', url = view.URL.createObjectURL(file);
  const root = doc.createElement('section'); root.className = 'community-profile-crop'; root.dataset.profileCrop = kind;
  const heading = doc.createElement('h3'); heading.textContent = t(avatar ? '调整头像' : '调整主页背景', avatar ? 'Adjust avatar' : 'Adjust profile background');
  const hint = doc.createElement('p'); hint.className = 'community-profile-crop-hint';
  hint.textContent = t(avatar ? '拖动裁剪框选取位置，也可以缩放原图。头像将以圆形显示。' : '拖动裁剪框选取位置，拖动边角自由调整长宽比例。', avatar ? 'Move the crop selection or zoom the image. Your avatar displays as a circle.' : 'Move the selection and drag its edges to adjust the aspect ratio freely.');
  const stage = doc.createElement('div'); stage.className = 'community-profile-crop-stage'; stage.dataset.profileCropStage = '';
  stage.tabIndex = 0; stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', t('图片裁剪画布；方向键移动裁剪框，加减键缩放图片', 'Crop canvas; arrow keys move the selection, plus and minus zoom the image'));
  const source = doc.createElement('img'); source.src = url; source.alt = t('待裁剪的原图', 'Original image to crop'); stage.append(source);
  const controls = doc.createElement('div'); controls.className = 'community-profile-crop-controls';
  const zoom = doc.createElement('div'); zoom.className = 'community-profile-crop-zoom';
  const actions = doc.createElement('div'); actions.className = 'community-profile-crop-actions';
  const control = (action: string, zh: string, en: string) => {
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'community-profile-crop-button';
    button.dataset.profileCropAction = action; button.textContent = t(zh, en); return button;
  };
  const smaller = control('zoom-out', '缩小', 'Zoom out'), larger = control('zoom-in', '放大', 'Zoom in');
  const reset = control('reset', '重置裁剪', 'Reset crop'), cancel = control('cancel', '取消', 'Cancel'), use = control('use', '使用此裁剪', 'Use this crop');
  use.classList.add('community-profile-crop-use'); zoom.append(smaller, larger, reset); actions.append(cancel, use); controls.append(zoom, actions);
  const status = doc.createElement('p'); status.className = 'community-profile-crop-status'; status.dataset.profileCropStatus = ''; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(heading, hint, stage, controls, status); container.append(root);
  let cropper: CropperInstance | null = null, image: CropperImage | null = null, selection: CropperSelection | null = null;
  let disposed = false, busy = false, resetting = false, cancelReady: ((reason: Error) => void) | null = null;
  const cleanups: Array<() => void> = [];
  const listen = (node: EventTarget, type: string, handler: EventListener) => { node.addEventListener(type, handler); cleanups.push(() => node.removeEventListener(type, handler)); };
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    cancelReady?.(Error(t('已取消裁剪。', 'Cropping cancelled.'))); cancelReady = null;
    for (const remove of cleanups.splice(0)) remove();
    image?.removeAttribute('src');
    cropper?.destroy(); cropper = null;
    image = null; selection = null;
    source.removeAttribute('src'); root.remove(); view.URL.revokeObjectURL(url);
  };
  // The parent can close or replace its editor before image decoding resolves.
  const observer = new view.MutationObserver(() => { if (!root.isConnected) destroy(); });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  cleanups.push(() => observer.disconnect());
  const imageBounds = (): Bounds => {
    const canvas = cropper?.getCropperCanvas(), rect = image?.getBoundingClientRect(), parent = canvas?.getBoundingClientRect();
    return rect && parent ? { x: rect.left - parent.left, y: rect.top - parent.top, width: rect.width, height: rect.height } : { x: 0, y: 0, width: 0, height: 0 };
  };
  const initialize = () => {
    if (!image || !selection) return;
    resetting = true;
    try {
      image.$resetTransform().$center('contain');
      const bounds = imageBounds(), ratio = avatar ? 1 : 16 / 9;
      const width = Math.min(bounds.width * 0.8, bounds.height * 0.8 * ratio), height = width / ratio;
      selection.$change(bounds.x + (bounds.width - width) / 2, bounds.y + (bounds.height - height) / 2, width, height, avatar ? 1 : NaN);
    } finally { resetting = false; }
  };
  const encodeCanvas = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) reject(Error(t('裁剪图片未能生成，请重试。', 'The crop could not be generated. Please try again.')));
      else if (blob.type !== 'image/webp') reject(Error(t('当前浏览器不支持 WebP 图片导出，请更新浏览器后再试。', 'Your browser does not support WebP export. Please update it.')));
      else resolve(blob);
    }, 'image/webp', quality);
  });
  const exportFile = async () => {
    if (!selection || !image || !contains(imageBounds(), selection)) throw Error(t('请将裁剪框放在原图范围内后再试。', 'Keep the crop selection inside the image.'));
    const scale = Math.abs(image.$getTransform()[0]);
    if (!scale || !Number.isFinite(scale)) throw Error(t('裁剪位置无效，请重置裁剪后再试。', 'Reset the crop and try again.'));
    let width = avatar ? 320 : Math.max(1, Math.round(selection.width / scale));
    let height = avatar ? 320 : Math.max(1, Math.round(selection.height / scale));
    const limit = Math.min(1, 2048 / Math.max(width, height)); width = Math.max(1, Math.round(width * limit)); height = Math.max(1, Math.round(height * limit));
    for (let size = 0; size < (avatar ? 1 : 4); size++) {
      if (disposed) return null;
      const canvas = await selection.$toCanvas({ width, height });
      for (const quality of [0.9, 0.78, 0.65, 0.5]) {
        if (disposed) return null;
        const blob = await encodeCanvas(canvas, quality);
        if (disposed) return null;
        if (blob.size > 0 && blob.size <= readerImageBytes) return new view.File([blob], avatar ? 'avatar-crop.webp' : 'background-crop.webp', { type: 'image/webp', lastModified: Date.now() });
      }
      width = Math.max(1, Math.round(width * 0.8)); height = Math.max(1, Math.round(height * 0.8));
    }
    throw Error(t('裁剪图片仍超过 2 MB，请缩小选取范围后重试。', 'The crop is still larger than 2 MB. Select a smaller area and try again.'));
  };
  const apply = async () => {
    if (disposed || busy || !selection) return;
    busy = true; use.disabled = smaller.disabled = larger.disabled = reset.disabled = true;
    const canvas = cropper?.getCropperCanvas(); if (canvas) canvas.disabled = true;
    status.textContent = t('正在处理图片…', 'Processing image…');
    let output: File | null = null;
    try { output = await exportFile(); }
    catch (error) { if (!disposed) status.textContent = error instanceof Error ? error.message : t('图片裁剪失败，请重试。', 'Cropping failed. Please try again.'); }
    finally {
      busy = false;
      if (!disposed) { use.disabled = smaller.disabled = larger.disabled = reset.disabled = false; if (canvas) canvas.disabled = false; }
    }
    if (output && !disposed) { destroy(); onUse(output); }
  };
  listen(root, 'click', event => {
    const target = event.target instanceof view.Element ? event.target.closest<HTMLButtonElement>('[data-profile-crop-action]') : null;
    if (!target || disposed) return;
    event.stopPropagation();
    const action = target.dataset.profileCropAction;
    if (action === 'cancel') { destroy(); onCancel(); return; }
    if (busy) return;
    if (action === 'use') { void apply(); return; }
    if (action === 'reset') initialize();
    else if (action === 'zoom-in' || action === 'zoom-out') image?.$zoom(action === 'zoom-in' ? 0.15 : -0.15);
  });
  listen(stage, 'keydown', event => {
    if (disposed || busy || event.target !== stage || !(event instanceof view.KeyboardEvent)) return;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[event.key];
    if (move) { event.preventDefault(); selection?.$move(move[0] * (event.shiftKey ? 10 : 1), move[1] * (event.shiftKey ? 10 : 1)); }
    else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); image?.$zoom(event.key === '-' ? -0.15 : 0.15); }
  });
  try {
    if (!root.isConnected) throw Error('Crop container is no longer available.');
    cropper = new Cropper(source, { container: stage, template: template(avatar) });
    image = cropper.getCropperImage(); selection = cropper.getCropperSelection();
    if (!image || !selection) throw Error('Missing cropper elements.');
    const cancelled = new Promise<never>((_, reject) => { cancelReady = reject; });
    const ready = await Promise.race([image.$ready(), cancelled]); cancelReady = null;
    if (disposed || !root.isConnected || !ready.naturalWidth || !ready.naturalHeight) throw Error('Image is no longer available.');
    initialize();
    listen(selection, 'change', event => {
      if (!resetting && event instanceof view.CustomEvent && !contains(imageBounds(), event.detail as Bounds)) event.preventDefault();
    });
    listen(image, 'change', event => {
      // Cropper 2.2 "change" carries the proposed image rectangle; "transform" carries matrices.
      if (!resetting && event instanceof view.CustomEvent && selection && !contains(event.detail as Bounds, selection)) event.preventDefault();
    });
    stage.focus({ preventScroll: true });
    return { destroy };
  } catch {
    const wasDisposed = disposed;
    destroy();
    if (wasDisposed) throw Error(t('已取消裁剪。', 'Cropping cancelled.'));
    throw Error(t('图片无法读取，请换一张 JPG、PNG 或 WebP 图片后重试。', 'The image could not be read. Try another JPG, PNG or WebP image.'));
  }
}
