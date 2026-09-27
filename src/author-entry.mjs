import {uiText} from './ui-language.mjs';
import {normalizeBodyLinks} from './body-links.mjs';
import {mountEditorToolbar} from './author-editor-toolbar.mjs';
import {mountBookEditor,BookBlockIdentity} from './book-editor.mjs';
import {captureImagePosition,insertImageAtPosition} from './editor-image-position.mjs';
import {mountDiscardSurface} from './author-discard-surface.mjs';
import {mountAuthorOrder} from './author-order.mjs';
import {authorError} from './author-errors.mjs';
import {readMusicTracks,musicTracksMarkup} from './music-settings.mjs';
import {rememberedAccount,rememberSuccessfulLogin} from './login-preferences.mjs';
import {uploadAuthorFile} from './author-upload.mjs';
import {uploadLimits,uploadSizeLabel} from './upload-policy.mjs';
import {imageSources,imageSourceSet} from './image-sources.mjs';
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { socialIcon, socialPlatform } from "./blog-details.mjs";
import { normalizeSocialLink } from "./social-links.mjs";
import {mountCardColorPicker} from "./author-colors.jsx";
import {articleTemplates, catalogTemplates} from './article-templates.mjs';
import { createDialog, icons } from "./library-ui.jsx";
import { escapeHTML as esc } from "./core.mjs";
const names = () => ({
  articles: uiText("博客文章", "Blog posts"),
  resources: uiText("资料", "Materials"),
  works: uiText("作品", "Work"),
  software: uiText("软件推荐", "Software"),
  "resource-center": uiText("资源中心", "Resource center"),
  announcements: uiText("公告", "Announcements"),
});
const payload = document.querySelector("#site-content");
let author = payload ? JSON.parse(payload.textContent).author : null;
let editor, cardColorPicker,
  dirty = false,
  busy = false,
  kind = "articles",
  current = {},
  uploads = [],
  pendingAfterLogin,
  pendingNavigation;
let ordering,orderBaseline=[];
let disposeEditorToolbar;
let bookEditor,imagePosition;
let discardReturnFocus;
let disposeDiscardSurface;
const shell = document.createElement("div");
shell.id = "author-dialog";
shell.className = "dialog-shell author-dialog";
shell.setAttribute("aria-hidden", "true");
shell.setAttribute("aria-labelledby", "author-dialog-title");
shell.innerHTML =
  `<div class="author-dialog-backdrop" aria-hidden="true"></div><section class="author-panel" role="document"><button class="author-close" type="button" data-author-close aria-label="${uiText("关闭作者窗口", "Close author panel")}">` +
  icons.close +
  '</button><button class="author-back" type="button" data-author-back hidden>' +
  icons.left +
  `${uiText(" 返回作者模式", " Back to author mode")}</button><div id="author-dialog-content"></div><div class="author-discard" hidden role="alertdialog" aria-modal="true" aria-labelledby="author-discard-message"><p id="author-discard-message">${uiText("还有未保存的修改。继续编辑，或放弃修改后离开。", "You have unsaved changes. Keep editing, or discard them before leaving.")}</p><button type="button" data-keep-editing>${uiText("继续编辑", "Keep editing")}</button><button type="button" data-discard>${uiText("放弃修改", "Discard changes")}</button></div></section>`;
document.body.append(shell);
const dialog = createDialog(shell),
  host = shell.querySelector("#author-dialog-content");
const discardPrompt=shell.querySelector('.author-discard');
const discardBackground=[host,shell.querySelector('.author-back'),shell.querySelector('.author-close')];
const field = (name, label, value = "", extra = "") =>
  `<label class="author-field">${label}<input name="${name}" value="${esc(value ?? "")}" ${extra}></label>`;
const area = (name, label, value = "", extra = "") =>
  `<label class="author-field">${label}<textarea name="${name}" ${extra}>${esc(value ?? "")}</textarea></label>`;
const status = () =>
  '<p class="author-feedback" role="status" aria-live="polite"></p>';
// Match the existing panel, gallery and avatar sizes, including Retina screens.
const previewSizes = {
  background: '(max-width: 440px) calc(100vw - 60px), (max-width: 600px) calc(50vw - 38px), 228px',
  cover: '(max-width: 600px) calc(100vw - 58px), (max-width: 800px) calc(100vw - 90px), 710px',
  avatar: '72px',
};
const previewSource = (id, type) => `/api/author/media/${id}?w=${type === 'cover' ? 768 : 384}`;
const previewAttributes = (id, type) => {
  if (!id) return 'hidden';
  const source = previewSource(id, type);
  return `src="${esc(source)}" ${imageSources(source, previewSizes[type])} decoding="async"`;
};
const feedback = (message, error = false) => {
  const el = host.querySelector(".author-feedback");
  if (el) {
    el.textContent = message;
    el.classList.toggle("is-error", error);
  }
};
async function api(path, method = "GET", body) {
  const response = await fetch("/api/author/" + path, {
    method,
    credentials: "same-origin",
    headers:
      method === "GET"
        ? {}
        : {
            "X-Author-Request": "1",
            ...(body instanceof FormData
              ? {}
              : { "Content-Type": "application/json" }),
          },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(authorError(data.error) || uiText("操作失败，请稍后再试。", "The operation failed. Please try again later."));
  return data;
}
function show(html, { size = "compact", back = "hub" } = {}) {
  bookEditor=undefined;imagePosition=undefined;
  hideDiscard(false);
  disposeEditorToolbar?.(); disposeEditorToolbar=undefined;
  ordering?.dispose();ordering=undefined;orderBaseline=[];
  cardColorPicker?.dispose(); cardColorPicker=undefined;
  editor?.destroy();
  editor = undefined;
  dirty = false;
  pendingNavigation = undefined;
  shell.dataset.size = size;
  shell.dataset.back = back;
  shell.querySelector('.author-close').setAttribute('aria-label',uiText('关闭作者窗口','Close author panel'));
  shell.querySelector('.author-discard p').textContent=uiText('还有未保存的修改。继续编辑，或放弃修改后离开。','You have unsaved changes. Keep editing, or discard them before leaving.');
  shell.querySelector('[data-keep-editing]').textContent=uiText('继续编辑','Keep editing');
  shell.querySelector('[data-discard]').textContent=uiText('放弃修改','Discard changes');
  const backButton = shell.querySelector("[data-author-back]");
  backButton.hidden = !back;
  backButton.innerHTML =
    icons.left + (back === "list" ? uiText(" 返回内容列表", " Back to content list") : uiText(" 返回作者模式", " Back to author mode"));
  host.innerHTML = html;
  shell.querySelector(".author-discard").hidden = true;
  dialog.show();
  shell.querySelector(".author-panel").scrollTop = 0;
  const heading = host.querySelector("h2");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus({ preventScroll: true });
}
function close() {
  hideDiscard(false);
  disposeEditorToolbar?.(); disposeEditorToolbar=undefined;
  ordering?.dispose();ordering=undefined;
  cardColorPicker?.dispose(); cardColorPicker=undefined;
  editor?.destroy();
  editor = undefined;
  dirty = false;
  dialog.hide();
}
function requestLeave(next) {
  if (busy || !discardPrompt.hidden) return;
  if (dirty) {
    openConfirmation(uiText('还有未保存的修改。继续编辑，或放弃修改后离开。','You have unsaved changes. Keep editing, or discard them before leaving.'),uiText('放弃修改','Discard changes'),next);
  } else next();
}
function openConfirmation(message,label,next,mode='discard') {
    pendingNavigation = next;
    discardPrompt.dataset.action=mode;
    discardPrompt.querySelector('p').textContent=message;
    discardPrompt.querySelector('[data-discard]').textContent=label;
    discardPrompt.querySelector('[data-keep-editing]').textContent=mode==='delete'?uiText('取消','Cancel'):uiText('继续编辑','Keep editing');
    discardReturnFocus=document.activeElement;
    discardPrompt.hidden = false;
    discardBackground.forEach(node=>node.setAttribute('inert',''));
    disposeDiscardSurface=mountDiscardSurface(discardPrompt,host);
    shell.querySelector("[data-keep-editing]").focus({preventScroll:true});
}
function hideDiscard(restoreFocus=true) {
  disposeDiscardSurface?.();disposeDiscardSurface=undefined;
  discardPrompt.hidden=true;
  delete discardPrompt.dataset.action;
  discardBackground.forEach(node=>node.removeAttribute('inert'));
  pendingNavigation=undefined;
  const previous=discardReturnFocus;discardReturnFocus=undefined;
  if(restoreFocus && previous?.isConnected) previous.focus({preventScroll:true});
}
const requestClose = () => requestLeave(close);
function requestBack() {
  const back=shell.dataset.back,selected=kind;
  if(back)requestLeave(()=>task(()=>back==='list'?library(selected):hub()));
}
async function task(action) {
  if (busy) return;
  busy = true;
  host
    .querySelectorAll('[data-save],[data-publish],[data-unpublish],[data-delete-content],[data-save-order],[type="submit"]')
    .forEach((b) => (b.disabled = true));
  try {
    await action();
  } catch (error) {
    feedback(error.message, true);
  } finally {
    busy = false;
    host
      .querySelectorAll('[data-save],[data-publish],[data-unpublish],[data-delete-content],[data-save-order],[type="submit"]')
      .forEach((b) => (b.disabled = false));
    if(ordering)host.querySelector('[data-save-order]').disabled=!dirty;
  }
}
async function updateSite() {
  const response = await fetch("/api/content?view=bootstrap", { credentials: "same-origin" });
  if (!response.ok)
    throw new Error(uiText("已保存，但页面内容暂时无法更新，请稍后刷新。", "Saved, but the page could not be refreshed. Please reload it later."));
  window.dispatchEvent(
    new CustomEvent("author:content", { detail: await response.json() }),
  );
}
function login() {
  show(
    `<h2 id="author-dialog-title">${uiText("登录", "Sign in")}</h2><p class="author-description">${uiText("管理文章、资料和个人设置。", "Manage posts, resources and personal settings.")}</p><form data-author-form="login" method="post" action="/api/author/login" autocomplete="on">${field("email", uiText("账号邮箱", "Account email"), rememberedAccount(), 'id="author-email" type="email" autocomplete="username" required')}${field("password", uiText("密码", "Password"), "", 'id="author-password" type="password" autocomplete="current-password" required')}<p class="author-description">${uiText("账号会在本机记住；密码可由浏览器安全保存和自动填充。", "This device remembers your email. Your browser can securely save and fill your password.")}</p>${status()}<button class="author-primary" type="submit">${uiText("登录 ", "Sign in ")}${icons.right}</button></form>`,
    { size: "login", back: "" },
  );
}
function hub() {
  const entry = (key, label, glyph, description) =>
    `<button type="button" data-author-open="${key}">${icons[glyph]}<span><strong>${label}</strong><small>${description}</small></span>${icons.right}</button>`;
  show(
    `<h2 id="author-dialog-title">${uiText("作者模式", "Author mode")}</h2><section class="author-menu-group" aria-label="${uiText("内容管理", "Content management")}"><h3>${uiText("内容管理", "Content management")}</h3><div class="author-menu-grid">${entry("announcements", uiText("公告", "Announcements"), "bell", uiText("文字 · 海报 · 轮换", "Text · Posters · Rotation"))}${entry("articles", uiText("博客文章", "Blog posts"), "document", uiText("写作 · 草稿 · 发布", "Write · Draft · Publish"))}${entry("works", uiText("作品", "Work"), "grid", uiText("我的软件 · 介绍 · 下载", "My software · Details · Downloads"))}${entry("resources", uiText("资料", "Materials"), "download", uiText("介绍 · 文件 · 链接", "Details · Files · Links"))}${entry("software", uiText("软件推荐", "Software"), "grid", uiText("软件介绍与下载", "Software details and downloads"))}${entry("resource-center", uiText("资源中心", "Resource center"), "download", uiText("书籍 · 章节 · 续写", "Books · Chapters · Writing"))}</div></section><section class="author-menu-group" aria-label="${uiText("个人设置", "Personal settings")}"><h3>${uiText("个人设置", "Personal settings")}</h3><div class="author-menu-grid">${entry("profile", uiText("个人信息", "Profile"), "user", uiText("头像 · 签名 · 主页", "Avatar · Bio · Links"))}${entry("background", uiText("博客背景", "Blog background"), "image", uiText("上传与更换背景", "Upload and change backgrounds"))}${entry("music", uiText("音乐", "Music"), "music", uiText("歌单链接 · 播放设置", "Playlist · Playback settings"))}${entry("appearance", uiText("点缀颜色", "Accent colors"), "tags", uiText("图标 · 文字 · 卡片", "Icons · Text · Cards"))}${entry("admin", uiText("后台管理", "Account management"), "user", uiText("注册账号 · 停用 · 撤销登录", "Readers · Disable · Revoke"))}</div></section>${status()}<div class="author-menu-footer"><button type="button" data-author-logout>${uiText("退出作者模式", "Sign out")}</button></div>`,
    { back: "" },
  );
}
async function library(selected = "articles") {
  kind = selected;
  const sortable=['articles','works','resources','software','resource-center'].includes(selected);
  show(
    `<div class="eyebrow">${uiText("AUTHOR / 内容管理", "AUTHOR / CONTENT")}</div><h2 id="author-dialog-title">${names()[kind]}</h2><div class="author-list-tools"><button type="button" data-new>${icons.plus}${uiText(" 新建", " New ")}${names()[kind]}</button>${sortable?`<button type="button" data-save-order disabled>${uiText('保存顺序','Save order')}</button><button type="button" data-reload-order>${uiText('重新加载','Reload')}</button>`:''}</div>${sortable?`<p class="author-order-hint" id="author-order-hint">${uiText('拖动左侧手柄调整顺序，保存后生效。','Drag the left handle to reorder, then save.')}<span class="sr-only">${uiText('也可以选中手柄，用上下方向键调整。','You can also focus a handle and use the up and down arrow keys.')}</span></p>`:''}${status()}<div class="author-item-list" aria-busy="true"></div>`,
    { size: "list" },
  );
  const list = host.querySelector(".author-item-list");
  const rows = await api("content/" + selected);
  if (!list?.isConnected||kind!==selected) return;
  list.setAttribute("aria-busy", "false");
  list.innerHTML = rows.length
    ? rows
        .map(
          (row) => `${sortable?`<div class="author-order-row" data-order-id="${esc(row.id)}"><button type="button" class="author-order-handle" data-order-handle draggable="true" aria-describedby="author-order-hint" aria-label="${esc(uiText('调整顺序：','Reorder: ')+row.title)}" title="${uiText('拖动排序；↑↓ 调整位置','Drag to reorder; ↑↓ to move')}">${icons.grip}</button>`:''}<button class="author-item" type="button" data-edit="${row.id}"><span><strong>${esc(row.title)}</strong><small>${row.status === "published" ? uiText("已发布", "Published") : row.status === "archived" ? uiText("已归档", "Archived") : uiText("草稿", "Draft")}${row.hasDraft ? uiText(" · 有未发布修改", " · Unpublished changes") : ""}</small></span>${icons.right}</button>${sortable?'</div>':''}`,
        )
        .join("")
    : `<p>${uiText("还没有内容，从新建开始。", "No content yet. Create your first item.")}</p>`;
  if(sortable){
    orderBaseline=rows.map(row=>row.id);
    ordering=mountAuthorOrder(list,{isBusy:()=>busy,onChange(ids){
      dirty=ids.join(',')!==orderBaseline.join(',');
      host.querySelector('[data-save-order]').disabled=!dirty;
      feedback(dirty?uiText('顺序已调整，点击“保存顺序”生效。','Order changed. Select Save order to apply.'):uiText('已恢复当前保存的顺序。','The saved order has been restored.'));
    }});
  }
}
const uploadField = (target, label, imageOnly = true) =>
  `<label class="author-upload">${icons.plus} ${label}<input type="file" data-upload="${target}" ${imageOnly ? 'accept="image/png,image/jpeg,image/webp,image/gif"' : ""}></label>`;
function textTools() {
  return `<details class="author-text-options"><summary>${uiText("文字颜色与字体", "Text colors and fonts")}</summary><div class="author-text-palette" aria-label="${uiText("文字颜色", "Text color")}">${[["",uiText("默认", "Default")],["#bfdfff",uiText("星蓝", "Star blue")],["#dac5ff",uiText("淡紫", "Lavender")],["#afe5d7",uiText("薄荷", "Mint")],["#f3c9b1",uiText("暖杏", "Apricot")],["#f4b8c8",uiText("浅玫红", "Rose")]].map(([color,label])=>`<button type="button" data-text-color="${color}" aria-label="${label}${uiText("文字", " text")}" style="--swatch:${color || '#eef4fc'}"><span></span>${label}</button>`).join('')}</div><div class="author-text-fonts">${[["Microsoft YaHei",uiText("中文常规", "Chinese sans serif")],["New Tegomin",uiText("英文手写", "English handwritten")],["Georgia",uiText("英文衬线", "English serif")],["Consolas",uiText("等宽", "Monospace")]].map(([font,label])=>`<button type="button" data-text-font="${font}">${label}</button>`).join('')}</div><div class="author-text-fonts" aria-label="${uiText("字号", "Font size")}">${[14,16,18,20,24,28,32].map(size=>`<button type="button" data-text-size="${size}">${size}</button>`).join('')}</div></details>`;
}
const deleteButton=()=>`<button type="button" class="author-delete-content" data-delete-content>${uiText('删除内容','Delete content')}</button>`;
function catalogCoverFields() {
  return `<p class="author-description">${coverGuidance(kind)}</p><div class="author-media-row">${uploadField('cover',uiText('上传卡片封面','Upload card cover'))}<button type="button" data-clear-image="cover">${uiText('清除卡片封面','Clear card cover')}</button>${uploadField('showcase_cover',uiText('上传顶部展示图（选填）','Upload showcase image (optional)'))}<button type="button" data-clear-image="showcase_cover">${uiText('清除顶部展示图','Clear showcase image')}</button></div><div data-cover-previews>${coverPreviews()}</div>`;
}
function coverPreviews() {
 const title=host?.querySelector('[name="title"]')?.value || current.title || uiText('内容标题','Content title');
 const summary=host?.querySelector('[name="summary"]')?.value || current.summary || '';
 const img=id=>`<img ${previewAttributes(id,'cover')} alt="${uiText('封面裁切预览','Cover crop preview')}">`;
 return `<p class="author-description">${uiText('卡片预览 · 悬停查看放大效果','Card preview · hover to inspect zoom')}</p><div class="author-poster-preview">${img(current.cover)}<div><strong>${esc(title)}</strong><small>${esc(summary)}</small></div></div><p class="author-description">${uiText('顶部展示预览 · 宽屏 / 手机','Showcase preview · desktop / mobile')}</p><div class="author-showcase-preview">${img(current.showcase_cover || current.cover)}<div><strong>${esc(title)}</strong><small>${esc(summary)}</small></div></div>`;
}
function refreshCoverPreviews() {
 const root=host.querySelector('[data-cover-previews]');if(root)root.innerHTML=coverPreviews();
}
function coverGuidance(selected) {
  if(selected==='announcements')return uiText('公告海报按 12:5 展示，建议 1440 × 600。重要文字留出边距，发布前检查实际公告卡片。','Announcement posters use 12:5; 1440 × 600 is recommended. Leave margins around text and check the published card.');
  if(['works','resources'].includes(selected))return uiText('卡片封面建议 1200 × 1200，主体居中，避免小字。顶部展示图选填，建议 2000 × 600，主体放右侧、左侧留给标题；手机会居中裁切。未上传时使用卡片封面。请分别检查下方两种预览。','Use a centered 1200 × 1200 card cover without small text. An optional 2000 × 600 showcase image should leave space on the left for the title; mobile crops the center. Without one, the card cover is reused. Check both previews below.');
  return uiText('建议上传 1600 × 900 横向封面。此处为 16:9 预览；软件推荐和资源中心网格会居中裁切，请把主体集中在中央，避免边缘小字。发布前检查真实列表和详情。正文图片不受封面比例限制。','A 1600 × 900 landscape cover is recommended. This preview uses 16:9; software and resource-center grids crop from the center. Keep key subjects centered and avoid small text near the edges. Check the actual listing and detail page. Body images have no cover-ratio restriction.');
}
function requestDelete() {
  if(busy || !current.id || !discardPrompt.hidden)return;
  const selected=kind,item={id:current.id,title:current.title,date_updated:current.date_updated};
  const message=uiText(`确认删除「${item.title}」？删除后将从访客页面和作者列表移除，不能在此直接恢复。图片与附件原件会保留。${dirty?'当前未保存的修改也会丢弃。':''}`,`Delete “${item.title}”? This removes it from the public site and author list and cannot be undone here. Original images and attachments are retained.${dirty?' Unsaved changes will also be discarded.':''}`);
  openConfirmation(message,uiText('确认删除','Confirm deletion'),()=>task(async()=>{
    await api(`content/${selected}/${item.id}`,'DELETE',{confirmId:item.id,expectedUpdated:item.date_updated});
    dirty=false;current={};
    await library(selected);
    try {
      await updateSite();
      feedback(uiText('内容已删除，访客页面已更新。','Content deleted. The visitor page has been updated.'));
    }catch {
      feedback(uiText('内容已删除，请刷新页面查看最新内容。','Content deleted. Reload the page to see the latest content.'),true);
    }
  }),'delete');
}
async function edit(selected, id) {
  kind = selected;
  current = id
    ? await api(`content/${kind}/${id}`)
    : {
        status: "draft",
        title: "",
        slug: "",
        summary: "",
        category: kind === "articles" ? uiText("随笔", "Journal") : names()[kind],
        tags: [],
        body: "",
        attachments: [],
      };
  uploads = [...(current.attachments || [])];
  const announcement = kind === "announcements";
  show(
    `<div class="eyebrow">AUTHOR / ${names()[kind]}</div><h2 id="author-dialog-title">${id ? uiText("编辑", "Edit ") : uiText("新建", "New ")}${names()[kind]}</h2><p class="author-description">${current.status === "published" ? uiText("当前内容已发布。保存草稿不会改变访客看到的版本。", "This content is published. Saving a draft will not change the version visitors see.") : uiText("草稿仅作者可见，确认后再发布。", "Only the author can see drafts. Publish when ready.")}</p><form data-author-form="content">${field("title", uiText("标题", "Title"), current.title, 'required maxlength="200"')}${announcement ? "" : `<div class="author-two">${field("slug", uiText("网址名称", "URL slug"), current.slug, uiText("required pattern=\"[a-z0-9]+(-[a-z0-9]+)*\" placeholder=\"例如 my-first-note\"", "required pattern=\"[a-z0-9]+(-[a-z0-9]+)*\" placeholder=\"e.g. my-first-note\""))}${field("category", uiText("栏目", "Category"), current.category, 'maxlength="80"')}</div>`}${area("summary", announcement ? uiText("公告说明", "Announcement details") : uiText("摘要", "Summary"), current.summary, 'rows="2" maxlength="2000"')}${announcement ? `${field("link", uiText("点击跳转网址（选填）", "Link URL (optional)"), current.link, 'type="url" placeholder="https://"')}${field("sort", uiText("显示顺序", "Display order"), current.sort || 0, 'type="number" min="0" max="9999"')}` : `${field("tags", uiText("标签（用逗号分隔）", "Tags (comma-separated)"), (current.tags || []).join("，"))}`}
    ${['works','resources'].includes(kind) ? catalogCoverFields() : `<div class="author-media-row">${uploadField(announcement ? "image" : "cover", announcement ? uiText("上传公告海报", "Upload poster") : uiText("上传封面", "Upload cover"))}<button type="button" data-clear-image>${uiText("清除图片", "Clear image")}</button><div class="cover-frame author-cover-preview  ${announcement ? "cover-frame--notice" : ""}"><img class="author-image-preview" ${previewAttributes(current[announcement ? "image" : "cover"], "cover")} alt="${announcement ? uiText("公告海报裁切预览", "Announcement crop preview") : uiText("文章封面裁切预览", "Post cover crop preview")}"></div></div><p class="author-description">${coverGuidance(kind)}</p>`}

    ${kind === "resource-center" ? `<label class="author-vip-setting"><input type="checkbox" name="vip_only" ${current.vip_only ? "checked" : ""}><span><strong>${uiText("仅 VIP 可阅读", "VIP members only")}</strong><small>${uiText("普通登录用户仍可看到书名、简介与封面；正文、章节、插图和附件仅 VIP 可读取。", "Readers can see the title, summary and cover. Chapters, illustrations and files require VIP.")}</small></span></label>` : ""}
    ${announcement ? "" : `<div class="author-editor-wrap"><div class="author-editor-tools" role="toolbar" aria-label="${uiText("正文格式", "Body formatting")}"><button type="button" data-format="bold" aria-label="${uiText("加粗", "Bold")}"><b>B</b></button><button type="button" data-format="italic" aria-label="${uiText("斜体", "Italic")}"><i>I</i></button><button type="button" data-format="heading">${uiText("标题", "Title")}</button><button type="button" data-format="bulletList">${uiText("列表", "List")}</button><button type="button" data-format="blockquote">${uiText("引用", "Quote")}</button><button type="button" data-format="codeBlock">${uiText("代码", "Code")}</button><button type="button" data-format="undo">${uiText("撤销", "Undo")}</button><button type="button" data-format="redo">${uiText("重做", "Redo")}</button>${uploadField("body", uiText("正文图片", "Body image"))}${textTools()}</div><div class="author-editor" aria-label="${uiText("文章正文", "Article body")}"></div></div><div class="author-preview article-body" hidden></div><div class="author-media-row">${uploadField("attachment", kind === "articles" ? uiText("添加附件", "Add attachment") : kind === "works" ? `${uiText("上传软件文件（最多 ", "Upload software file (up to ")}${uploadSizeLabel(uploadLimits.maxFileBytes)}${uiText("）",")")}` : `${uiText("上传下载文件（最多 ", "Upload download file (up to ")}${uploadSizeLabel(uploadLimits.maxFileBytes)}${uiText("）",")")}`, false)}</div><div class="author-files"></div>${kind === "articles" ? "" : field("external_url", kind === "works" ? uiText("项目或演示链接（选填）", "Project or demo link (optional)") : kind === "resources" ? uiText("来源链接（选填）", "Source link (optional)") : uiText("官方网站（选填）", "Official website (optional)"), current.external_url, 'type="url" placeholder="https://"')}`}
    ${status()}<div class="author-form-actions"><button type="button" data-preview>${announcement ? "" : uiText("预览", "Preview")}</button><button type="submit" data-save>${uiText("保存草稿", "Save draft")}</button><button type="button" class="author-primary" data-publish>${uiText("发布", "Publish")}${current.status === "published" ? uiText("修改", " changes") : ""}</button>${current.status === "published" ? `<button type="button" data-unpublish>${uiText("撤回公开内容", "Unpublish")}</button>` : ""}</div></form>`,
    { size: announcement ? "compact" : "editor", back: "list" },
  );
  if(current.id)host.querySelector('.author-form-actions').insertAdjacentHTML('beforeend',deleteButton());
  if (!announcement) {
    editor = new Editor({
      element: host.querySelector(".author-editor"),
      extensions: [
        StarterKit.configure({ link: { openOnClick: false, markdownLinks: true, autolink: true, linkOnPaste: true, defaultProtocol: 'https' } }),
        Image.configure({ allowBase64: false }),
        TableKit,
        TextStyleKit,
        ...(kind==='resource-center'?[BookBlockIdentity]:[]),
      ],
      content: normalizeBodyLinks(current.body || "<p></p>"),
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": uiText("文章正文", "Article body"),
          "aria-multiline": "true",
        },
      },
      onUpdate() {
        dirty = true;
      },
    });
    disposeEditorToolbar=mountEditorToolbar(host.querySelector('.author-editor-tools'), editor);
    if(kind==='resource-center') {
      bookEditor=mountBookEditor(host,editor,current.body,{text:uiText,onDirty:()=>{dirty=true;},onChapterChange:chapter=>{imagePosition=undefined;refreshChapterPreview(chapter.title);},onTitleChange:chapter=>refreshChapterPreview(chapter.title),isBusy:()=>busy,confirmDelete:(message,remove)=>openConfirmation(message,uiText('删除章节','Delete chapter'),()=>{hideDiscard();remove();},'delete')});
      host.querySelector('[data-preview]').textContent=uiText('预览当前章节','Preview chapter');
      host.querySelector('[data-preview]').insertAdjacentHTML('afterend',`<button type="button" data-preview-book>${uiText('保存草稿并预览整本','Save draft and preview book')}</button>`);
    }
    renderFiles();
    if((kind==='articles' || catalogTemplates[kind]) && !id) {
      const choices=document.createElement('div');
      choices.className='author-article-templates';
      choices.innerHTML=`<p>${uiText("可选写作框架：只加入章节标题，正文由你填写，也可以直接开始写。", "Optional outline: inserts headings only. Write the body yourself, or start from a blank page.")}</p>${Object.entries(kind==='articles'?articleTemplates:{[kind]:catalogTemplates[kind]}).map(([key,item])=>`<button type="button" data-article-template="${key}">${esc(({"技术教程":uiText("技术教程","Technical tutorial"),"项目记录":uiText("项目记录","Project journal"),"图文随笔":uiText("图文随笔","Photo journal"),"软件作品介绍":uiText("软件作品介绍","Software project"),"资料说明":uiText("资料说明","Material guide"),"软件推荐介绍":uiText("软件推荐介绍","Software recommendation")})[item.label] || item.label)}</button>`).join('')}`;
      host.querySelector('.author-editor-wrap').before(choices);
    }
  } else host.querySelector("[data-preview]").hidden = true;
}
function renderFiles() {
  const box = host.querySelector(".author-files");
  if (box)
    box.innerHTML = (
      kind === "articles" ? uploads : current.file ? [current.file] : []
    )
      .map(
        (id, index) =>
          `<div><a href="/api/author/media/${id}" target="_blank" rel="noopener">${icons.document}${uiText(" 附件 ", " Attachment ")}${index + 1}</a><button type="button" data-remove-file="${id}" aria-label="${uiText("移除附件 ", "Remove attachment ")}${index + 1}">${icons.close}</button></div>`,
      )
      .join("");
}
async function saveContent(action) {
  const form = host.querySelector("form");
  if (action !== "unpublish" && !form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form));
  Object.assign(values, {
    action,
    body: bookEditor?bookEditor.serialize():editor?.getHTML() || "",
    tags: String(values.tags || "")
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean),
    cover: current.cover || null,
    ...(kind === 'resource-center' ? {vip_only: form.elements.vip_only.checked} : {}),
    ...(["works","resources"].includes(kind)?{showcase_cover:current.showcase_cover || null}:{}),
    image: current.image || null,
    file: current.file || null,
    attachments: uploads,
    expectedUpdated: current.date_updated,
  });
  const saved = await api(
    `content/${kind}${current.id ? "/" + current.id : ""}`,
    current.id ? "PATCH" : "POST",
    values,
  );
  current = saved;
  if(current.id&&!host.querySelector('[data-delete-content]'))host.querySelector('.author-form-actions').insertAdjacentHTML('beforeend',deleteButton());
  dirty = false;
  await updateSite();
  if (action === "publish" || action === "unpublish") {
    await library(kind);
    feedback(
      action === "publish"
        ? uiText("已发布，访客页面已更新。", "Published. The visitor page has been updated.")
        : uiText("已撤回，访客无法再查看这条内容。", "Unpublished. Visitors can no longer view this item."),
    );
  } else {
    host.querySelector("#author-dialog-title").textContent =
      uiText("编辑", "Edit ") + names()[kind];
    feedback(
      uiText("草稿已保存。", "Draft saved. ") +
        (current.status === "published" ? uiText("访客仍看到之前发布的版本。", "Visitors still see the previously published version.") : ""),
    );
  }
  return saved;
}
function refreshChapterPreview(title=bookEditor?.title){
 const preview=host.querySelector('.author-preview');
 if(preview&&!preview.hidden)preview.innerHTML=`<h2>${esc(title||host.querySelector('[name="title"]').value)}</h2>${editor.getHTML()}`;
}
async function backgrounds() {
  current=await api("profile");
  const library=[...(current.background_library || [])];
  if (current.background && !library.some(item=>item.id===current.background)) library.unshift({id:current.background,name:uiText("当前背景", "Current background")});
  const tile=(item,index)=>`<div class="author-background-tile"><img ${previewAttributes(item.id,"background")} width="320" height="180" alt="${esc(item.name)}" loading="${!item.deletedAt && index < 2 ? "eager" : "lazy"}"><div><strong>${esc(item.name)}</strong><div class="author-background-actions">${item.deletedAt?`<button type="button" data-background-action="restore" data-background-id="${esc(item.id)}">${uiText("恢复", "Restore")}</button>`:`<button type="button" data-background-action="use" data-background-id="${esc(item.id)}" ${current.background===item.id?'disabled':''}>${current.background===item.id?uiText("正在使用", "In use"):uiText("使用背景", "Use background")}</button><button type="button" data-background-action="remove" data-background-id="${esc(item.id)}" ${current.background===item.id?'disabled':''}>${uiText("删除", "Delete")}</button>`}</div></div></div>`;
  show(`<h2 id="author-dialog-title">${uiText("博客背景", "Blog background")}</h2><p class="author-description">${uiText("上传后保存在背景库，点击使用即可切换。删除的图片可在“最近删除”中恢复。", "Uploads are saved to the library. Select one to use it. Deleted images can be restored from Recently deleted.")}</p><div class="author-media-row">${uploadField("background",uiText("上传背景", "Upload background"))}<button type="button" data-background-action="default" ${!current.background?'disabled':''}>${uiText("使用默认背景", "Use default background")}</button></div><div class="author-background-gallery">${library.filter(item=>!item.deletedAt).map(tile).join('') || `<p class="subtle">${uiText("还没有上传背景，当前使用默认星空。", "No uploaded backgrounds yet. The default star field is in use.")}</p>`}</div>${library.some(item=>item.deletedAt)?`<details class="author-deleted-backgrounds"><summary>${uiText("最近删除", "Recently deleted")}</summary><div class="author-background-gallery">${library.filter(item=>item.deletedAt).map(tile).join('')}</div></details>`:''}${status()}`);
}
async function profile(section = "profile") {
  current = await api("profile");
  const content = section === "music"
    ? `${field("music_title", uiText("歌单名称", "Playlist name"), current.music_settings?.title || uiText("我的歌单", "My playlist"), 'maxlength="120"')}<div class="author-media-row">${uploadField("music", uiText("上传音乐", "Upload music"), false)}</div><details class="author-music-sources"><summary>${icons.link}${uiText(" 添加音频链接", " Add audio link")}</summary>${field("music_link_title",uiText("歌曲名称", "Track name"),"",'maxlength="120"')}${field("music_link_url",uiText("音频网址", "Audio URL"),"",'type="url" placeholder="https://…/music.mp3"')}<button type="button" data-add-track>${icons.plus}${uiText(" 加入播放列表", " Add to playlist")}</button><p class="author-description">${uiText("填写可直接播放的 HTTPS 音频网址。普通平台分享页无法直接在本站播放；也可以上传音频文件。歌曲名称仅用于作者管理。", "Use a directly playable HTTPS audio URL, or upload an audio file. Platform share pages cannot play here. Track names are for author management only.")}</p></details><h3>${uiText("本站播放列表", "On-site playlist")}</h3><p class="author-description">${uiText("按从上到下的顺序播放，使用上下箭头调整；保存后生效。", "Tracks play from top to bottom. Use the arrows to reorder them, then save.")}</p><div class="author-music-tracks">${musicTracksMarkup(current.music_settings?.tracks||[],icons)}</div><p class="author-description">${uiText("支持 MP3、M4A、OGG、WAV、FLAC，单首最多 100 MB。保存后生效。", "Supports MP3, M4A, OGG, WAV and FLAC, up to 100 MB per track. Save to apply.")}</p><label class="author-checkbox"><input type="checkbox" name="music_autoplay" ${current.music_settings?.autoplay !== false ? 'checked' : ''}>${uiText("进入页面后自动播放（受浏览器限制时，首次交互后启动）", "Autoplay on entry (starts after the first interaction if blocked by the browser)")}</label>`
    : section === "appearance"
    ? `<p class="author-description">${uiText("选择调色对象，再用下方同一个调色板调整。可以直接选预设颜色，也可以自由取色。", "Choose a target, then adjust it with the shared palette. Select a preset or choose any color.")}</p><div id="author-card-color-picker"></div>`
    : `${field("name", uiText("名称", "Name"), current.name, 'required maxlength="80"')}${field("signature", uiText("个性签名", "Tagline"), current.signature, 'maxlength="200"')}${area("bio", uiText("简介", "Bio"), current.bio, 'rows="2" maxlength="1000"')}<div class="author-media-row">${uploadField("avatar", uiText("更换头像", "Change avatar"))}<img class="author-avatar-preview" ${previewAttributes(current.avatar, "avatar")} alt="${uiText("头像预览", "Avatar preview")}"></div><h3>${uiText("其他平台主页", "Other profiles")}</h3><div class="author-social-rows">${(current.social_links || []).map(socialRow).join("")}</div><button type="button" data-add-social>${icons.plus}${uiText(" 添加主页链接", " Add profile link")}</button>`;
  show(
    `<h2 id="author-dialog-title">${({background:uiText("博客背景", "Blog background"),music:uiText("音乐", "Music"),appearance:uiText("点缀颜色", "Accent colors")})[section] || uiText("个人信息", "Profile")}</h2><form data-author-form="profile" data-settings="${section}">${content}${status()}<div class="author-form-actions"><button class="author-primary" type="submit">${uiText("保存设置", "Save settings")}</button></div></form>`,
  );
  if (section === "music") host.querySelector('[data-upload="music"]').setAttribute('accept','audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/flac,.mp3,.m4a,.ogg,.wav,.flac');
  if (section === "appearance") cardColorPicker=mountCardColorPicker(host.querySelector("#author-card-color-picker"),current.appearance,()=>{dirty=true;});
}
const socialRow = (link = {}) =>
  `<div class="author-social-row"><span class="author-platform-preview" aria-hidden="true">${socialIcon(link.url, icons.link)}</span>${field("social_label", uiText("平台名称", "Platform name"), link.label, uiText("maxlength=\"40\" placeholder=\"例如 GitHub\"", "maxlength=\"40\" placeholder=\"e.g. GitHub\""))}${field("social_url", uiText("主页链接", "Profile URL"), normalizeSocialLink(link.url) || link.url, 'type="url" placeholder="https://"')}<button type="button" data-remove-social aria-label="${uiText("移除此主页链接", "Remove this profile link")}">${icons.close}</button></div>`;
async function open(detail = {}) {
  if (!author) {
    // The shared account form may have signed in before this lazy module loaded.
    // Reuse the existing session endpoint instead of showing a second login.
    try { author = await api("session"); } catch { author = null; }
    if (!author) {
      pendingAfterLogin = detail;
      login();
      return;
    }
  }
  try {
    if (!detail.kind) hub();
    else if (detail.kind === "background") await backgrounds();
    else if (["profile", "music", "appearance"].includes(detail.kind))
      await profile(detail.kind);
    else if (detail.id || detail.new)
      await edit(detail.kind || "articles", detail.id);
    else await library(detail.kind || "articles");
  } catch (error) {
    if (!dialog.shown)
      show(`<h2 id="author-dialog-title">${uiText("暂时无法打开", "Unable to open")}</h2>${status()}`);
    feedback(error.message, true);
  }
}
window.addEventListener("author:identity", event => { author = event.detail; });
document.addEventListener("click", (event) => {
  const loginButton = event.target.closest("[data-author-login]");
  const entry = event.target.closest("[data-author-open]");
  if (loginButton) {
    event.preventDefault();
    open();
  }
  if (entry && !busy) {
    event.preventDefault();
    if (entry.dataset.authorOpen === 'admin') {
      close();
      location.hash = '#/admin';
      return;
    }
    open({
      kind: entry.dataset.authorOpen,
      id: entry.dataset.authorId,
      new: entry.hasAttribute("data-author-new"),
    });
  }
  if (event.target.closest("[data-author-logout]"))
    task(async () => {
      await api("logout", "POST", {});
      author = null;
      window.dispatchEvent(
        new CustomEvent("author:identity", { detail: null }),
      );
      close();
    });
});
shell.addEventListener("input", (event) => {
  if(["title","summary"].includes(event.target.name))refreshCoverPreviews();
  if (event.target.name === "social_url") {
    const row=event.target.closest(".author-social-row"), platform=socialPlatform(event.target.value);
    row.querySelector(".author-platform-preview").innerHTML=socialIcon(event.target.value, icons.link);
    const label=row.querySelector('[name="social_label"]');
    if (!label.value || label.dataset.autoLabel === label.value) {
      label.value=platform?.name || ""; label.dataset.autoLabel=label.value;
    }
  }
  if (!event.target.closest('[data-author-form="login"]')) dirty = true;
});
shell.addEventListener("paste", (event) => {
  if (event.target.name !== "social_url") return;
  const pasted = event.clipboardData?.getData("text/plain");
  const normalized = normalizeSocialLink(pasted);
  if (!normalized || !/^(?:https?:\/\/)(?:[^/]+\.)?douyin\.com\//i.test(normalized)) return;
  event.preventDefault();
  event.target.value = normalized;
  event.target.dispatchEvent(new Event("input", { bubbles: true }));
});
shell.addEventListener("focusout", (event) => {
  if (event.target.name !== "social_url") return;
  const normalized = normalizeSocialLink(event.target.value);
  if (normalized && normalized !== event.target.value) {
    event.target.value = normalized;
    event.target.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
shell.addEventListener("click", (event) => {
  const target = event.target.closest("button,[data-author-close]");
  if (!target) return;
  if (target.hasAttribute('data-move-track')) {
    const rows=[...host.querySelectorAll('[data-track-source]')];
    const index=rows.indexOf(target.closest('[data-track-source]')),next=index+Number(target.dataset.moveTrack);
    if(index<0||next<0||next>=rows.length)return;
    const tracks=readMusicTracks(host);[tracks[index],tracks[next]]=[tracks[next],tracks[index]];
    host.querySelector('.author-music-tracks').innerHTML=musicTracksMarkup(tracks,icons);
    const moved=host.querySelectorAll('[data-track-source]')[next];
    (moved.querySelector('[data-move-track="'+target.dataset.moveTrack+'"]:not(:disabled)')||moved.querySelector('input')).focus();
    dirty=true;return;
  }
  if (target.hasAttribute('data-remove-track')) {
    target.closest('[data-track-source]').remove();
    host.querySelector('.author-music-tracks').innerHTML=musicTracksMarkup(readMusicTracks(host),icons);
    dirty=true;return;
  }
  if (target.hasAttribute('data-add-track')) {
    const title=host.querySelector('[name="music_link_title"]'),link=host.querySelector('[name="music_link_url"]');
    try {
      const url=new URL(link.value.trim());
      if(url.protocol!=='https:' || /(^|\.)(kugou\.com|music\.163\.com|y\.qq\.com)$/.test(url.hostname)) throw new Error();
      const tracks=readMusicTracks(host);
      if(tracks.length>=100) {feedback(uiText("歌单最多 100 首。", "Playlists can contain up to 100 tracks."),true);return;}
      tracks.push({title:title.value.trim()||uiText("音乐", "Music"),url:url.href});
      host.querySelector('.author-music-tracks').innerHTML=musicTracksMarkup(tracks,icons);
      title.value='';link.value='';dirty=true;feedback(uiText("链接已加入，保存设置后生效。", "Link added. Save settings to apply."));
    } catch {feedback(uiText("请输入可直接播放的 HTTPS 音频网址，或上传音频文件；普通平台分享页无法直接播放。", "Use a directly playable HTTPS audio URL, or upload an audio file. Platform share pages cannot play here."),true);}
    return;
  }
  if (target.hasAttribute("data-author-close")) requestClose();
  if (target.hasAttribute("data-keep-editing")) hideDiscard();
  if (target.hasAttribute("data-discard")) {
    const deleting=discardPrompt.dataset.action==='delete';
    const next = pendingNavigation || close;
    hideDiscard(false);
    if(!deleting)dirty = false;
    next();
  }
  if(target.hasAttribute('data-delete-content'))requestDelete();
  if (target.hasAttribute("data-author-back")) requestBack();
  if (target.hasAttribute("data-new")) requestLeave(()=>task(() => edit(kind)));
  if(target.hasAttribute('data-reload-order'))requestLeave(()=>task(()=>library(kind)));
  if(target.hasAttribute('data-save-order')&&ordering)task(async()=>{
    const saved=await api(`content/${kind}/reorder`,'POST',{ids:ordering.ids(),expectedIds:orderBaseline});
    orderBaseline=saved.ids;dirty=false;
    await updateSite();feedback(uiText('顺序已保存，访客页面已更新。','Order saved. The visitor page has been updated.'));
  });
  if(target.dataset.articleTemplate && editor) {
    if(!editor.isEmpty) { feedback(uiText("正文已有内容，写作框架不会覆盖现有文字。", "The body already has content. An outline will not overwrite it.")); return; }
    const template=(kind==='articles'?articleTemplates:catalogTemplates)[target.dataset.articleTemplate];
    if(template) {
      editor.commands.setContent(template.body);
      host.querySelector('[name="category"]').value=template.category;
      target.closest('.author-article-templates').hidden=true;
      dirty=true;
    }
  }
  if (target.dataset.edit) requestLeave(()=>task(() => edit(kind, target.dataset.edit)));
  if (target.hasAttribute("data-publish")) task(() => saveContent("publish"));
  if (target.hasAttribute("data-unpublish"))
    task(() => saveContent("unpublish"));
  if (target.hasAttribute("data-add-social")) {
    host
      .querySelector(".author-social-rows")
      .insertAdjacentHTML("beforeend", socialRow());
    dirty = true;
  }
  if (target.hasAttribute("data-remove-social")) {
    target.closest(".author-social-row").remove();
    dirty = true;
  }
  if (target.hasAttribute("data-clear-image")) {
    const field=target.dataset.clearImage || (kind === "announcements" ? "image" : "cover");
    current[field] = null;
    if(['works','resources'].includes(kind))refreshCoverPreviews();
    else host.querySelector(".author-image-preview").hidden = true;
    dirty = true;
  }
  if (target.dataset.backgroundAction) task(async () => {
    await api("backgrounds", "POST", {action:target.dataset.backgroundAction,id:target.dataset.backgroundId});
    await updateSite();
    await backgrounds();
    feedback(target.dataset.backgroundAction === "remove" ? uiText("已从背景库删除，可在最近删除中恢复。", "Removed from the library. You can restore it from Recently deleted.") : uiText("背景设置已更新。", "Background settings updated."));
  });
  if (target.dataset.removeFile) {
    uploads = uploads.filter((id) => id !== target.dataset.removeFile);
    if (current.file === target.dataset.removeFile) current.file = null;
    renderFiles();
    dirty = true;
  }
  if(target.hasAttribute('data-preview-book')&&bookEditor&&!busy){
    if(!host.querySelector('form').reportValidity())return;
    const previewWindow=window.open('about:blank','_blank');
    if(previewWindow)previewWindow.opener=null;
    task(async()=>{
      try {
        const saved=await saveContent('draft');
        if(!saved){previewWindow?.close();return;}
        const url=`/?preview=${encodeURIComponent(saved.id)}&previewKind=resource-center#/resource-center/${encodeURIComponent(saved.slug)}`;
        if(previewWindow)previewWindow.location.href=url;
        const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.textContent=uiText('打开整本草稿预览','Open book draft preview');
        host.querySelector('.author-feedback').append(' ',link);
      }catch(error){previewWindow?.close();throw error;}
    });
    return;
  }
  if (target.hasAttribute("data-preview") && editor) {
    const preview = host.querySelector(".author-preview"),
      writing = host.querySelector(".author-editor-wrap");
    preview.hidden = !preview.hidden;
    writing.hidden = !preview.hidden;
    refreshChapterPreview();
    target.textContent = preview.hidden ? bookEditor?uiText('预览当前章节','Preview chapter'):uiText("预览", "Preview") : uiText("继续编辑", "Keep editing");
  }
  if (target.hasAttribute("data-text-color") && editor) {
    const chain=editor.chain().focus();
    (target.dataset.textColor ? chain.setColor(target.dataset.textColor) : chain.unsetColor()).run();
  }
  if (target.dataset.textFont && editor) editor.chain().focus().setFontFamily(target.dataset.textFont).run();
  if (target.dataset.textSize && editor) editor.chain().focus().setFontSize(target.dataset.textSize + "px").run();
  if (target.dataset.format && editor) {
    const chain = editor.chain().focus(),
      format = target.dataset.format;
    ({
      bold: () => chain.toggleBold(),
      italic: () => chain.toggleItalic(),
      heading: () => chain.toggleHeading({ level: 2 }),
      bulletList: () => chain.toggleBulletList(),
      blockquote: () => chain.toggleBlockquote(),
      codeBlock: () => chain.toggleCodeBlock(),
      undo: () => chain.undo(),
      redo: () => chain.redo(),
    })
      [format]()
      .run();
  }
});
shell.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  task(async () => {
    if (form.dataset.authorForm === "login") {
      const credentials=Object.fromEntries(new FormData(form));
      author = await api(
        "login",
        "POST",
        credentials,
      );
      void rememberSuccessfulLogin(window,credentials,author.name);
      window.dispatchEvent(
        new CustomEvent("author:identity", { detail: author }),
      );
      const next = pendingAfterLogin || {};
      pendingAfterLogin = null;
      await open(next);
    }
    if (form.dataset.authorForm === "content") await saveContent("draft");
    if (form.dataset.authorForm === "profile") {
      const values = { ...current, ...Object.fromEntries(new FormData(form)) };
      Object.assign(values, {
        avatar: current.avatar || null,
        background: current.background || null,
        social_links:
          form.dataset.settings !== "profile"
            ? current.social_links || []
            : [...form.querySelectorAll(".author-social-row")].map((row) => ({
                label: row.querySelector('[name="social_label"]').value,
                url: row.querySelector('[name="social_url"]').value,
              })),
      });
      if (form.dataset.settings === "music") {
        const tracks=readMusicTracks(host);
        if(tracks.some(track=>!track.title)) throw new Error(uiText("请填写歌曲名称。", "Please enter a track name."));
        if(tracks.some(track=>/^https?:\/\/([^/]*\.)?(kugou\.com|music\.163\.com|y\.qq\.com)(\/|$)/i.test(track.url))) throw new Error(uiText("平台分享页不能用作音频直链，请使用可播放的音频网址或上传音频文件。", "A platform share page is not an audio URL. Use a playable audio link or upload an audio file."));
        values.music_settings = {title:values.music_title,playlistUrl:current.music_settings?.playlistUrl,tracks,autoplay:values.music_autoplay==='on'};
      }
      if (form.dataset.settings === "appearance") values.appearance = cardColorPicker.value();
      await api("profile", "PATCH", values);
      dirty = false;
      await updateSite();
      feedback(uiText("设置已保存。", "Settings saved."));
    }
  });
});
shell.addEventListener('pointerdown',event=>{
  if(!busy&&editor&&event.target.closest('.author-upload')?.querySelector('[data-upload="body"]'))imagePosition=captureImagePosition(editor,shell.querySelector('.author-panel'));
},true);
shell.addEventListener('click',event=>{
  const input=event.target.closest('.author-upload')?.querySelector('[data-upload="body"]');
  if(!editor||!input)return;
  if(busy){event.preventDefault();return;}
  if(!imagePosition)imagePosition=captureImagePosition(editor,shell.querySelector('.author-panel'));
  // Native label activation focuses the hidden file input and scrolls the editor.
  // Open the picker directly so the sticky toolbar does not move the viewport.
  if(event.target!==input){event.preventDefault();input.click();}
},true);
shell.addEventListener('cancel',event=>{if(event.target.matches('[data-upload="body"]'))imagePosition=undefined;},true);
shell.addEventListener("change", (event) => {
  const input = event.target.closest("[data-upload]");
  if (!input || !input.files?.length) return;
  if(input.dataset.upload==='body'&&editor&&!imagePosition)imagePosition=captureImagePosition(editor,shell.querySelector('.author-panel'));
  task(async () => {
    const uploaded = input.files[0];
    const target=input.dataset.upload;
    if(target==='music' && readMusicTracks(host).length>=100) throw new Error(uiText("歌单最多 100 首，请先移除部分歌曲。", "The playlist has reached 100 tracks. Remove some tracks first."));
    const limits=await api('upload');
    const cap=target==='music'||uploaded.type.startsWith('audio/')?limits.maxAudioBytes:uploaded.type.startsWith('image/')?limits.maxImageBytes:limits.maxFileBytes;
    if(uploaded.size>cap) throw new Error(`${uiText("此类文件最多 ", "The limit for this file type is ")}${uploadSizeLabel(cap)}${uiText("。",".")}`);
    feedback(uiText("正在上传 0%…", "Uploading 0%…"));
    const data=new FormData(); data.set('file',uploaded);
    if(['background','music'].includes(target)) data.set('purpose',target);
    const controller=new AbortController();
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent=uiText("取消上传", "Cancel upload");
    cancel.onclick=()=>controller.abort();host.querySelector('.author-feedback').after(cancel);
    let saved;
    try { saved=await uploadAuthorFile(data,{signal:controller.signal,onProgress:percent=>feedback(percent===100?uiText("传输完成，正在保存…", "Transfer complete. Saving…"):`${uiText("正在上传 ", "Uploading ")}${percent}%…`)}); }
    finally {cancel.remove();input.value='';}
    if(target==='music') {
      const tracks=readMusicTracks(host);
      tracks.push({title:saved.name,url:'/api/media/'+saved.id});
      host.querySelector('.author-music-tracks').innerHTML=musicTracksMarkup(tracks,icons);
      dirty=true;feedback(uiText("音乐已加入列表，保存设置后访客可以收听。", "Music added. Save settings so visitors can listen."));return;
    }
    if (target === "background") {
      await backgrounds();
      feedback(uiText("背景已保存到背景库，点击使用即可切换。", "Background saved to the library. Select it to apply."));
      return;
    }
    if (target === "body") {
      insertImageAtPosition(editor,shell.querySelector('.author-panel'),{src:saved.url,alt:saved.name,width:saved.width,height:saved.height},imagePosition);
      imagePosition=undefined;
    }
    else if (target === "attachment") {
      if (kind === "articles") uploads.push(saved.id);
      else current.file = saved.id;
      renderFiles();
    } else {
      current[target] = saved.id;
      if(['works','resources'].includes(kind) && ['cover','showcase_cover'].includes(target)) {
        refreshCoverPreviews();dirty=true;input.value='';
        feedback(uiText('上传完成，保存后生效。','Upload complete. Save to apply.'));return;
      }
      const image = host.querySelector(
        target === "avatar"
          ? ".author-avatar-preview"
          : target === "background"
            ? ".author-background-preview"
            : ".author-image-preview",
      );
      const previewType = target === "avatar" ? "avatar" : "cover";
      const source = previewSource(saved.id, previewType);
      image.sizes = previewSizes[previewType];
      image.srcset = imageSourceSet(source);
      image.src = source;
      image.hidden = false;
    }
    dirty = true;
    input.value = "";
    feedback(uiText("上传完成，保存后生效。", "Upload complete. Save to apply."));
  });
});
document.addEventListener(
  "keydown",
  (event) => {
    if(dialog.shown && !discardPrompt.hidden && event.key==='Tab') {
      event.preventDefault();event.stopImmediatePropagation();
      const buttons=[...discardPrompt.querySelectorAll('button')];
      const current=buttons.indexOf(document.activeElement);
      const next=current<0?0:(current+(event.shiftKey?-1:1)+buttons.length)%buttons.length;
      buttons[next].focus({preventScroll:true});
      return;
    }
    if (dialog.shown && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if(event.repeat || event.isComposing || busy) return;
      if(!discardPrompt.hidden) hideDiscard();
      else requestBack();
    }
  },
  true,
);
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
