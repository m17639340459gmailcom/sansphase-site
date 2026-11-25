import { avatarHTML, nameLabelHTML } from './community.mjs';
import { communityImageBytes, communityNameEffect } from './community-rules.mjs';
import { readNameEffectFile } from './community-equipment-import.mjs';
import type { Common, CommunityPerson, Translate } from './community.ts';

type Form = HTMLFormElement;
type Options = {
  root: () => HTMLElement | null;
  common: () => Common | null;
  person: () => CommunityPerson | null;
  active: () => boolean;
  identity: () => number;
  prepare: (file: File, allowAnimation: boolean, present: () => boolean) => Promise<File>;
  request: <T>(path: string, init: RequestInit) => Promise<T>;
  t: Translate;
};
const fieldOf = (form: Form, name: string) => form.elements.namedItem(name) as HTMLInputElement | null;
const valueOf = (form: Form, name: string) => fieldOf(form, name)?.value || '';
const checkedOf = (form: Form, name: string) => (form.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement | null)?.value || '';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const enc = encodeURIComponent;

/** Product-form behaviour only. The community host owns event order, authority and request lifetime. */
export function createCommunityEquipmentController(options: Options) {
  const tr = options.t;
  let equipmentDragDepth = 0;
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
    const common = options.common();
    if (!common) return;
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
    const sample: CommunityPerson = { name: options.person()?.name || tr('無相', 'Preview'), uid: null, role: 'reader', frame: kind === 'frame' && valueOf(form, 'image') ? `image:${valueOf(form, 'image')}` : null, nameEffect: effect };
    const preview = form.querySelector('[data-item-wear-sample]');
    const image = valueOf(form, 'image');
    const key = `${kind}|${image}|${sample.frame}|${sample.name}|${JSON.stringify(effect)}`;
    if (preview && wearable && preview.getAttribute('data-preview-key') !== key) {
      preview.innerHTML = kind === 'cover' ? /^[0-9a-f-]{36}$/.test(image) ? `<span class="community-cover-sample"><img src="/api/community/images/${common.esc(image)}.webp" alt="${tr('主页背景预览', 'Profile background preview')}"></span>` : '' : avatarHTML(sample, common, 'lg', false) + nameLabelHTML(sample, common);
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
    if (!options.active()) return;
    if (!file || form.dataset.uploading === 'true' || form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled) return;
    const line = form.querySelector<HTMLElement>('[data-item-upload-status]');
    const say = (text: string) => { if (line) line.textContent = text; };
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { say(tr('请选择 JPG、PNG、WebP 或 GIF 图片。', 'Choose JPG, PNG, WebP or GIF.')); return; }
    if (file.size > communityImageBytes(true)) { say(tr('商品图片不能超过 25MB。', 'Product images cannot exceed 25MB.')); return; }
    const identity = options.identity();
    setEquipmentBusy(form, true);
    say(tr('正在上传商品图片…', 'Uploading product image…'));
    try {
      const prepared = await options.prepare(file, true, () => form.isConnected && options.active());
      if (!form.isConnected || identity !== options.identity() || !options.active()) return;
      const body = new FormData(); body.append('file', prepared);
      const image = await options.request<{ id: string; frameReady: boolean }>('manage/item-image', { method: 'POST', headers: { 'X-Reader-Request': '1' }, body });
      if (!form.isConnected || identity !== options.identity()) return;
      const value = fieldOf(form, 'image'); if (value) value.value = image.id;
      form.dataset.frameReady = String(image.frameReady);
      updateProductPreview(form, image.id); say(tr('图片已上传，保存商品后生效。', 'Image uploaded; save the product to apply it.'));
    } catch (error) { if (form.isConnected) say(message(error)); }
    finally { if (form.isConnected) setEquipmentBusy(form, false); }
  }
  async function importNameEffect(form: Form, file?: File) {
    if (!options.active()) return;
    if (!file || form.dataset.uploading === 'true' || form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled) return;
    const identity = options.identity();
    setEquipmentBusy(form, true);
    equipmentStatus(form, tr('正在读取昵称特效…', 'Reading nickname effect…'), true);
    try {
      const effect = await readNameEffectFile(file);
      if (!form.isConnected || identity !== options.identity()) return;
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
    } catch (error) { if (form.isConnected && identity === options.identity()) equipmentStatus(form, message(error), true); }
    finally { if (form.isConnected) setEquipmentBusy(form, false); }
  }
  function equipmentForm() {
    if (!options.active()) return null;
    // Only an open product manager's editor accepts desktop files. Other page
    // editors retain their own drag handlers, including inline reply images.
    return options.root()?.querySelector<Form>('form[data-community-form="item"]') || null;
  }
  function clearEquipmentDrag() {
    equipmentDragDepth = 0;
    options.root()?.querySelectorAll('.community-equipment-drop.is-dragging').forEach(zone => zone.classList.remove('is-dragging'));
  }
  function fileTransfer(event: DragEvent) {
    return event.dataTransfer && (Array.from(event.dataTransfer.types).includes('Files') || event.dataTransfer.files.length > 0);
  }
  function onEquipmentDrag(event: DragEvent) {
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
    if (!equipmentForm() || !fileTransfer(event)) return;
    equipmentDragDepth = Math.max(0, equipmentDragDepth - 1);
    if (equipmentDragDepth === 0) clearEquipmentDrag();
  }
  function onEquipmentDrop(event: DragEvent) {
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
  return {
    updateProductPreview, syncItemForm, uploadProduct, importNameEffect,
    clear: clearEquipmentDrag, fileTransfer,
    drag: onEquipmentDrag, leave: onEquipmentLeave, drop: onEquipmentDrop,
  };
}
