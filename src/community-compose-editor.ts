import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { AuthorEditorViewport } from './author-editor-viewport.ts';
import { communityBodyHTML } from './community.mjs';
import { bodyImageContent, bodyImageMarker, imageIdFromPath } from './community-body-images.mjs';
import type { Translate } from './community.ts';
import { communityImageBytes } from './community-rules.mjs';

const escape = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Keep the existing Markdown storage contract; image blocks reference uploaded IDs.
export function composeMarkdown(node: JSONContent): string {
  const children = () => (node.content || []).map(composeMarkdown);
  if (node.type === 'text') {
    let text = node.text || '';
    for (const mark of node.marks || []) {
      if (mark.type === 'bold') text = `**${text}**`;
      if (mark.type === 'code') text = `\`${text}\``;
      if (mark.type === 'link' && /^https?:\/\//.test(String(mark.attrs?.href))) text = `[${text}](${String(mark.attrs?.href)})`;
    }
    return text;
  }
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'image') {
    const id = imageIdFromPath(String(node.attrs?.src || ''));
    return id ? bodyImageMarker(id) : '';
  }
  if (node.type === 'paragraph') return children().join('');
  if (node.type === 'codeBlock') return '```\n' + children().join('') + '\n```';
  if (node.type === 'blockquote') return children().join('\n').split('\n').map(line => `> ${line}`).join('\n');
  if (node.type === 'bulletList') return children().map(line => `- ${line.replaceAll('\n', '\n  ')}`).join('\n');
  return children().join('\n\n');
}

type Options = { request: typeof fetch; prepare: (file: File, signal: AbortSignal) => Promise<Blob>; t: Translate; owner?: boolean | (() => boolean) };
export type CommunityComposeEditor = ReturnType<typeof mountCommunityComposeEditor>;

export function mountCommunityComposeEditor(root: HTMLElement, { request, prepare, t, owner = false }: Options) {
  const field = root.querySelector<HTMLTextAreaElement>('textarea[name="body"]')!;
  const host = root.querySelector<HTMLElement>('[data-community-rich]')!;
  const status = root.querySelector<HTMLElement>('.community-editor-upload-status')!;
  const picker = root.querySelector<HTMLInputElement>('[data-community-upload]')!;
  const document = root.ownerDocument;
  const abort = new AbortController();
  const jobs = new Map<string, { file: File; preview: string }>();
  const completed = new Map<string, { state: 'ready' | 'error'; src?: string; error?: string }>();
  let destroyed = false;
  let reconcileQueued = false;
  const announce = (message: string) => { status.textContent = message; };
  const imageCount = () => {
    let total = 0;
    editor.state.doc.descendants(node => { if (node.type.name === 'image') total++; });
    return total;
  };
  const sync = () => {
    field.value = composeMarkdown(editor.getJSON()).trim();
    field.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true }));
    host.dataset.empty = String(editor.isEmpty);
    markCover();
  };
  const markCover = () => {
    host.querySelectorAll<HTMLElement>('.community-inline-upload').forEach((figure, index) => {
      const cover = root.dataset.imageCover === 'true' && index === 0;
      figure.dataset.cover = String(cover);
      figure.querySelector('img')?.setAttribute('alt', cover ? t('封面：正文第一张图', 'Cover: first body image') : t('正文图片', 'Body image'));
    });
  };
  const findUpload = (upload: string) => {
    let position: number | undefined;
    editor.state.doc.descendants((node, pos) => { if (node.attrs.upload === upload) position = pos; });
    return position;
  };
  // Undo can remove a placeholder before its request finishes. Keep the result
  // for redo, without inserting images the user has removed.
  const reconcileRestoredImages = () => {
    if (reconcileQueued || destroyed || !completed.size) return;
    reconcileQueued = true;
    queueMicrotask(() => {
      reconcileQueued = false;
      if (destroyed) return;
      const tr = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        const result = completed.get(String(node.attrs.upload));
        if (node.type.name === 'image' && node.attrs.state === 'uploading' && result) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...result });
      });
      if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false));
    });
  };
  const InlineImage = Image.extend({
    addAttributes() {
      return { ...this.parent?.(), upload: { default: null }, state: { default: 'ready' }, error: { default: '' } };
    },
    addInputRules() { return []; },
    parseHTML() {
      return [{ tag: 'img[src]', getAttrs: element => imageIdFromPath(element.getAttribute('src') || '') ? null : false }];
    },
    addNodeView() {
      return ({ node, getPos, editor: instance }) => {
        const figure = document.createElement('figure');
        figure.className = 'community-inline-upload';
        figure.contentEditable = 'false';
        const img = document.createElement('img'); img.alt = t('正文图片', 'Post image');
        const caption = document.createElement('figcaption');
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'community-inline-remove'; remove.textContent = '×';
        remove.setAttribute('aria-label', t('移除正文图片', 'Remove image'));
        remove.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          const pos = getPos();
          if (typeof pos === 'number') instance.view.dispatch(instance.state.tr.delete(pos, pos + node.nodeSize));
          instance.view.focus();
        });
        figure.append(img, caption, remove);
        const draw = () => {
          const src = String(node.attrs.src || '');
          const preview = jobs.get(String(node.attrs.upload))?.preview || '';
          const visible = imageIdFromPath(src) ? src : preview;
          img.hidden = !visible;
          if (visible && img.getAttribute('src') !== visible) img.src = visible;
          figure.dataset.state = String(node.attrs.state);
          caption.textContent = node.attrs.state === 'uploading' ? t('图片上传中…', 'Uploading image…') : node.attrs.state === 'error' ? String(node.attrs.error) : '';
        };
        draw();
        return {
          dom: figure, stopEvent: event => event.target instanceof document.defaultView!.HTMLElement && Boolean(event.target.closest('button')),
          update(next) { if (next.type !== node.type) return false; node = next; draw(); return true; },
        };
      };
    },
  }).configure({ allowBase64: false, resize: false });

  const editor = new Editor({
    element: host,
    extensions: [AuthorEditorViewport, StarterKit.configure({ heading: false, horizontalRule: false, orderedList: false, italic: false, strike: false, underline: false, link: { openOnClick: false, autolink: false, protocols: ['http', 'https'] } }), InlineImage],
    content: communityBodyHTML(field.value, escape, {}, bodyImageContent(field.value).images),
    editorProps: {
      attributes: { id: `${field.id}-rich`, role: 'textbox', 'aria-multiline': 'true', 'aria-required': 'true', 'aria-labelledby': `${field.id}-label`, class: 'community-rich-body community-text' },
      handlePaste(_view, event) {
        const data = event.clipboardData;
        if (!data) return false;
        const files = [...data.files];
        if (!files.length) for (const item of [...data.items]) { const file = item.kind === 'file' ? item.getAsFile() : null; if (file) files.push(file); }
        if (!files.length) return false;
        event.preventDefault();
        void insertImages(files, data.getData('text/plain'));
        return true;
      },
      handleDrop(_view, event) {
        if (!event.dataTransfer?.files.length) return false;
        // Keep native document/image dragging; never let file drops import video or remote HTML.
        event.preventDefault();
        announce(t('请把图片粘贴到正文，或使用工具栏的图片按钮。', 'Paste images or use the image button in the toolbar.'));
        return true;
      },
    },
    onUpdate: sync,
    onTransaction: reconcileRestoredImages,
  });

  async function insertImages(files: readonly File[], text = '') {
    if (destroyed) return;
    const messages: string[] = [];
    const typed = files.filter(file => imageTypes.has(file.type));
    if (typed.length !== files.length) messages.push(t('只支持 JPG、PNG、WebP 图片，不支持视频。', 'Only JPG, PNG and WebP images are supported, not videos.'));
    const cap = communityImageBytes(true), label = `${cap / 1024 ** 2}MB`;
    const valid = typed.filter(file => file.size <= cap);
    if (valid.length !== typed.length) messages.push(t(`单张图片不能超过 ${label}。`, `Each image must be ${label} or smaller.`));
    const max = Number(root.dataset.imageMax || 0);
    const selected = valid.slice(0, Math.max(0, max - imageCount()));
    if (selected.length < valid.length) messages.push(t(`此处最多 ${max} 张图片。`, `Up to ${max} images here.`));
    announce(messages.join(' '));
    if (!selected.length) {
      if (text) editor.commands.insertContent(text.split(/\r?\n/).map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })));
      return;
    }
    const batch = selected.map(file => {
      const id = crypto.randomUUID();
      // Originals have not passed dimensions/format checks yet. Keep the
      // existing upload placeholder instead of decoding all originals at once.
      jobs.set(id, { file, preview: '' });
      return id;
    });
    const content: JSONContent[] = text ? text.split(/\r?\n/).map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) : [];
    content.push(...batch.map(id => ({ type: 'image', attrs: { upload: id, state: 'uploading' } })), { type: 'paragraph' });
    editor.chain().setMeta('paste', true).insertContent(content).run();
    // Reserve positions before requests start. Editing or deleting a placeholder
    // while an upload is pending never moves its image to a different paragraph.
    await Promise.all(batch.map(async id => {
      const job = jobs.get(id)!;
      try {
        const blob = await prepare(job.file, abort.signal);
        if (destroyed || findUpload(id) === undefined) return;
        if (blob.size > communityImageBytes(typeof owner === 'function' ? owner() : owner)) throw new Error(t('图片自动压缩后仍超过 2MB，请换一张较小的图片。', 'The compressed image is still too large. Choose a smaller image.'));
        job.preview = URL.createObjectURL(blob);
        const preparedPosition = findUpload(id);
        if (preparedPosition !== undefined) editor.view.dispatch(editor.state.tr.setNodeMarkup(preparedPosition, undefined, { ...editor.state.doc.nodeAt(preparedPosition)!.attrs }).setMeta('addToHistory', false));
        const form = new FormData(); form.append('file', blob, blob instanceof File ? blob.name : job.file.name);
        const response = await request('/api/community/images', { method: 'POST', credentials: 'same-origin', headers: { 'X-Reader-Request': '1' }, body: form, signal: abort.signal });
        const result = await response.json() as { id?: string; error?: string };
        if (!response.ok || !result.id || !imageIdFromPath(`/api/community/images/${result.id}.webp`)) throw new Error(result.error || t('图片上传失败，请移除后重试。', 'Upload failed. Remove the image and try again.'));
        if (destroyed) return;
        completed.set(id, { src: `/api/community/images/${result.id}.webp`, state: 'ready' });
        const pos = findUpload(id);
        if (pos !== undefined) {
          const node = editor.state.doc.nodeAt(pos)!;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: `/api/community/images/${result.id}.webp`, state: 'ready' }).setMeta('addToHistory', false));
        }
      } catch (error) {
        if (destroyed) return;
        const message = error instanceof Error ? error.message : t('图片上传失败', 'Image upload failed');
        completed.set(id, { state: 'error', error: message });
        const pos = findUpload(id);
        if (pos !== undefined) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, state: 'error', error: message }).setMeta('addToHistory', false));
      } finally {
        if (!destroyed && !completed.has(id)) completed.set(id, { state: 'error', error: t('上传已取消，请移除后重新粘贴。', 'Upload cancelled. Remove and paste the image again.') });
        URL.revokeObjectURL(job.preview); jobs.delete(id);
      }
    }));
  }
  const onFiles = (event: Event) => {
    event.stopPropagation();
    if (picker.files?.length) void insertImages([...picker.files]);
    picker.value = '';
  };
  const retainSelection = (event: MouseEvent) => {
    if ((event.target as Element).closest('[data-action="community-md"]')) event.preventDefault();
  };
  picker.addEventListener('change', onFiles);
  root.addEventListener('mousedown', retainSelection);
  host.hidden = false; field.hidden = true;
  field.disabled = false; picker.disabled = false;
  root.dataset.editorState = 'ready'; root.removeAttribute('aria-busy');
  root.querySelectorAll<HTMLButtonElement>('[data-action="community-md"], [data-action="community-md-preview"]').forEach(button => { button.disabled = false; });
  if (status) status.textContent = '';
  host.dataset.placeholder = field.placeholder;
  host.dataset.empty = String(editor.isEmpty);
  markCover();
  document.getElementById(`${field.id}-label`)?.setAttribute('for', `${field.id}-rich`);

  return {
    root, field, editor,
    focus() { editor.view.focus(); },
    clear() { editor.commands.clearContent(); sync(); },
    state() {
      let pending = false, failed = false;
      editor.state.doc.descendants(node => { if (node.type.name === 'image') { pending ||= node.attrs.state === 'uploading'; failed ||= node.attrs.state === 'error'; } });
      return { pending, failed };
    },
    command(kind: string) {
      const chain = editor.chain().focus(undefined, { scrollIntoView: false });
      if (kind === 'bold') chain.toggleBold().run();
      else if (kind === 'code') chain.toggleCode().run();
      else if (kind === 'quote') chain.toggleBlockquote().run();
      else if (kind === 'list') chain.toggleBulletList().run();
      else if (kind === 'link') {
        const href = document.defaultView!.prompt(t('链接地址（http:// 或 https://）', 'Link URL (http:// or https://)'), editor.getAttributes('link').href || 'https://');
        if (href === null) return;
        if (/^https?:\/\/[^\s]+\.[^\s]+$/.test(href)) chain.setLink({ href }).run();
        else announce(t('请填写有效的链接地址。', 'Enter a valid link URL.'));
      }
    },
    preview(on: boolean) { host.hidden = on; field.hidden = true; picker.disabled = on; },
    destroy() {
      if (destroyed) return;
      destroyed = true; abort.abort(); editor.destroy();
      picker.removeEventListener('change', onFiles); root.removeEventListener('mousedown', retainSelection);
      for (const job of jobs.values()) URL.revokeObjectURL(job.preview);
      jobs.clear(); completed.clear();
    },
  };
}
