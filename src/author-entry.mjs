import {readMusicTracks,musicTracksMarkup} from './music-settings.mjs';
import {rememberedAccount,rememberSuccessfulLogin} from './login-preferences.mjs';
import {uploadAuthorFile} from './author-upload.mjs';
import {uploadLimits,uploadSizeLabel} from './upload-policy.mjs';
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
const names = {
  articles: "博客文章",
  resources: "资料",
  works: "作品",
  software: "软件推荐",
  "resource-center": "资源中心",
  announcements: "公告",
};
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
const shell = document.createElement("div");
shell.id = "author-dialog";
shell.className = "dialog-shell author-dialog";
shell.setAttribute("aria-hidden", "true");
shell.setAttribute("aria-labelledby", "author-dialog-title");
shell.innerHTML =
  '<div class="author-dialog-backdrop" data-author-close></div><section class="author-panel" role="document"><button class="author-close" type="button" data-author-close aria-label="关闭作者窗口">' +
  icons.close +
  '</button><button class="author-back" type="button" data-author-back hidden>' +
  icons.left +
  ' 返回作者模式</button><div id="author-dialog-content"></div><div class="author-discard" hidden role="alert"><p>还有未保存的修改。继续编辑，或放弃修改后离开。</p><button type="button" data-keep-editing>继续编辑</button><button type="button" data-discard>放弃修改</button></div></section>';
document.body.append(shell);
const dialog = createDialog(shell),
  host = shell.querySelector("#author-dialog-content");
const field = (name, label, value = "", extra = "") =>
  `<label class="author-field">${label}<input name="${name}" value="${esc(value ?? "")}" ${extra}></label>`;
const area = (name, label, value = "", extra = "") =>
  `<label class="author-field">${label}<textarea name="${name}" ${extra}>${esc(value ?? "")}</textarea></label>`;
const status = () =>
  '<p class="author-feedback" role="status" aria-live="polite"></p>';
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
  if (!response.ok) throw new Error(data.error || "操作失败，请稍后再试。");
  return data;
}
function show(html, { size = "compact", back = "hub" } = {}) {
  cardColorPicker?.dispose(); cardColorPicker=undefined;
  editor?.destroy();
  editor = undefined;
  dirty = false;
  pendingNavigation = undefined;
  shell.dataset.size = size;
  shell.dataset.back = back;
  const backButton = shell.querySelector("[data-author-back]");
  backButton.hidden = !back;
  backButton.innerHTML =
    icons.left + (back === "list" ? " 返回内容列表" : " 返回作者模式");
  host.innerHTML = html;
  shell.querySelector(".author-discard").hidden = true;
  dialog.show();
  shell.querySelector(".author-panel").scrollTop = 0;
  const heading = host.querySelector("h2");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus({ preventScroll: true });
}
function close() {
  cardColorPicker?.dispose(); cardColorPicker=undefined;
  editor?.destroy();
  editor = undefined;
  dirty = false;
  dialog.hide();
}
function requestLeave(next) {
  if (busy) return;
  if (dirty) {
    pendingNavigation = next;
    shell.querySelector(".author-discard").hidden = false;
    shell.querySelector("[data-keep-editing]").focus();
  } else next();
}
const requestClose = () => requestLeave(close);
async function task(action) {
  if (busy) return;
  busy = true;
  host
    .querySelectorAll('[data-save],[data-publish],[type="submit"]')
    .forEach((b) => (b.disabled = true));
  try {
    await action();
  } catch (error) {
    feedback(error.message, true);
  } finally {
    busy = false;
    host
      .querySelectorAll('[data-save],[data-publish],[type="submit"]')
      .forEach((b) => (b.disabled = false));
  }
}
async function updateSite() {
  const response = await fetch("/api/content", { credentials: "same-origin" });
  if (!response.ok)
    throw new Error("已保存，但页面内容暂时无法更新，请稍后刷新。");
  window.dispatchEvent(
    new CustomEvent("author:content", { detail: await response.json() }),
  );
}
function login() {
  show(
    `<h2 id="author-dialog-title">登录</h2><p class="author-description">管理文章、资料和个人设置。</p><form data-author-form="login" method="post" action="/api/author/login" autocomplete="on">${field("email", "账号邮箱", rememberedAccount(), 'id="author-email" type="email" autocomplete="username" required')}${field("password", "密码", "", 'id="author-password" type="password" autocomplete="current-password" required')}<p class="author-description">账号会在本机记住；密码可由浏览器安全保存和自动填充。</p>${status()}<button class="author-primary" type="submit">登录 ${icons.right}</button></form>`,
    { size: "login", back: "" },
  );
}
function hub() {
  const entry = (key, label, glyph, description) =>
    `<button type="button" data-author-open="${key}">${icons[glyph]}<span><strong>${label}</strong><small>${description}</small></span>${icons.right}</button>`;
  show(
    `<h2 id="author-dialog-title">作者模式</h2><section class="author-menu-group" aria-label="内容管理"><h3>内容管理</h3><div class="author-menu-grid">${entry("announcements", "公告", "bell", "文字 · 海报 · 轮换")}${entry("articles", "博客文章", "document", "写作 · 草稿 · 发布")}${entry("works", "作品", "grid", "我的软件 · 介绍 · 下载")}${entry("resources", "资料", "download", "介绍 · 文件 · 链接")}${entry("software", "软件推荐", "grid", "软件介绍与下载")}${entry("resource-center", "资源中心", "download", "资源发布 · 文件 · 下载")}</div></section><section class="author-menu-group" aria-label="个人设置"><h3>个人设置</h3><div class="author-menu-grid">${entry("profile", "个人信息", "user", "头像 · 签名 · 主页")}${entry("background", "博客背景", "image", "上传与更换背景")}${entry("music", "音乐", "music", "歌单链接 · 播放设置")}${entry("appearance", "点缀颜色", "tags", "图标 · 文字 · 卡片")}</div></section>${status()}<div class="author-menu-footer"><button type="button" data-author-logout>退出作者模式</button></div>`,
    { back: "" },
  );
}
async function library(selected = "articles") {
  kind = selected;
  show(
    `<div class="eyebrow">AUTHOR / 内容管理</div><h2 id="author-dialog-title">${names[kind]}</h2><div class="author-list-tools"><button type="button" data-new>${icons.plus} 新建${names[kind]}</button></div>${status()}<div class="author-item-list" aria-busy="true"></div>`,
    { size: "list" },
  );
  const rows = await api("content/" + kind);
  const list = host.querySelector(".author-item-list");
  if (!list) return;
  list.setAttribute("aria-busy", "false");
  list.innerHTML = rows.length
    ? rows
        .map(
          (row) =>
            `<button class="author-item" type="button" data-edit="${row.id}"><span><strong>${esc(row.title)}</strong><small>${row.status === "published" ? "已发布" : row.status === "archived" ? "已归档" : "草稿"}${row.hasDraft ? " · 有未发布修改" : ""}</small></span>${icons.right}</button>`,
        )
        .join("")
    : "<p>还没有内容，从新建开始。</p>";
}
const uploadField = (target, label, imageOnly = true) =>
  `<label class="author-upload">${icons.plus} ${label}<input type="file" data-upload="${target}" ${imageOnly ? 'accept="image/png,image/jpeg,image/webp,image/gif"' : ""}></label>`;
function textTools() {
  return `<details class="author-text-options"><summary>文字颜色与字体</summary><div class="author-text-palette" aria-label="文字颜色">${[["","默认"],["#bfdfff","星蓝"],["#dac5ff","淡紫"],["#afe5d7","薄荷"],["#f3c9b1","暖杏"],["#f4b8c8","浅玫红"]].map(([color,label])=>`<button type="button" data-text-color="${color}" aria-label="${label}文字" style="--swatch:${color || '#eef4fc'}"><span></span>${label}</button>`).join('')}</div><div class="author-text-fonts">${[["Microsoft YaHei","中文常规"],["New Tegomin","英文手写"],["Georgia","英文衬线"],["Consolas","等宽"]].map(([font,label])=>`<button type="button" data-text-font="${font}">${label}</button>`).join('')}</div><div class="author-text-fonts" aria-label="字号">${[14,16,18,20,24,28,32].map(size=>`<button type="button" data-text-size="${size}">${size}</button>`).join('')}</div></details>`;
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
        category: kind === "articles" ? "随笔" : names[kind],
        tags: [],
        body: "",
        attachments: [],
      };
  uploads = [...(current.attachments || [])];
  const announcement = kind === "announcements";
  show(
    `<div class="eyebrow">AUTHOR / ${names[kind]}</div><h2 id="author-dialog-title">${id ? "编辑" : "新建"}${names[kind]}</h2><p class="author-description">${current.status === "published" ? "当前内容已发布。保存草稿不会改变访客看到的版本。" : "草稿仅作者可见，确认后再发布。"}</p><form data-author-form="content">${field("title", "标题", current.title, 'required maxlength="200"')}${announcement ? "" : `<div class="author-two">${field("slug", "网址名称", current.slug, 'required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="例如 my-first-note"')}${field("category", "栏目", current.category, 'maxlength="80"')}</div>`}${area("summary", announcement ? "公告说明" : "摘要", current.summary, 'rows="2" maxlength="2000"')}${announcement ? `${field("link", "点击跳转网址（选填）", current.link, 'type="url" placeholder="https://"')}${field("sort", "显示顺序", current.sort || 0, 'type="number" min="0" max="9999"')}` : `${field("tags", "标签（用逗号分隔）", (current.tags || []).join("，"))}`}
    <div class="author-media-row">${uploadField(announcement ? "image" : "cover", announcement ? "上传公告海报" : "上传封面")}<button type="button" data-clear-image>清除图片</button><div class="cover-frame author-cover-preview ${announcement ? "cover-frame--notice" : ""}"><img class="author-image-preview" ${current[announcement ? "image" : "cover"] ? `src="/api/author/media/${current[announcement ? "image" : "cover"]}"` : "hidden"} alt="${announcement ? "公告海报裁切预览" : "文章封面裁切预览"}"></div></div><p class="author-description">${announcement ? "公告海报固定按 12:5 展示，建议上传 1440 × 600 像素的横图。" : ["works", "resources", "software"].includes(kind) ? "此处按 16:9 预览原始封面；作品、资料及软件推荐网格以大封面展示，下方为 70 像素信息栏，标题和简介各一行。图片居中裁切，请把主体放在中央。" : "封面固定按 16:9 展示，建议上传 1600 × 900 像素的横图。"}其他比例会居中裁切，请将重要文字和主体放在中间。原图保留，正文图片不受此比例限制。</p>
    ${announcement ? "" : `<div class="author-editor-wrap"><div class="author-editor-tools" role="toolbar" aria-label="正文格式"><button type="button" data-format="bold" aria-label="加粗"><b>B</b></button><button type="button" data-format="italic" aria-label="斜体"><i>I</i></button><button type="button" data-format="heading">标题</button><button type="button" data-format="bulletList">列表</button><button type="button" data-format="blockquote">引用</button><button type="button" data-format="codeBlock">代码</button><button type="button" data-format="undo">撤销</button><button type="button" data-format="redo">重做</button>${uploadField("body", "正文图片")}${textTools()}</div><div class="author-editor" aria-label="文章正文"></div></div><div class="author-preview article-body" hidden></div><div class="author-media-row">${uploadField("attachment", kind === "articles" ? "添加附件" : kind === "works" ? `上传软件文件（最多 ${uploadSizeLabel(uploadLimits.maxFileBytes)}）` : `上传下载文件（最多 ${uploadSizeLabel(uploadLimits.maxFileBytes)}）`, false)}</div><div class="author-files"></div>${kind === "articles" ? "" : field("external_url", kind === "works" ? "项目或演示链接（选填）" : kind === "resources" ? "来源链接（选填）" : "官方网站（选填）", current.external_url, 'type="url" placeholder="https://"')}`}
    ${status()}<div class="author-form-actions"><button type="button" data-preview>${announcement ? "" : "预览"}</button><button type="submit" data-save>保存草稿</button><button type="button" class="author-primary" data-publish>发布${current.status === "published" ? "修改" : ""}</button>${current.status === "published" ? '<button type="button" data-unpublish>撤回公开内容</button>' : ""}</div></form>`,
    { size: announcement ? "compact" : "editor", back: "list" },
  );
  if (!announcement) {
    editor = new Editor({
      element: host.querySelector(".author-editor"),
      extensions: [
        StarterKit.configure({ link: { openOnClick: false } }),
        Image.configure({ allowBase64: false }),
        TableKit,
        TextStyleKit,
      ],
      content: current.body || "<p></p>",
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": "文章正文",
          "aria-multiline": "true",
        },
      },
      onUpdate() {
        dirty = true;
      },
    });
    renderFiles();
    if((kind==='articles' || catalogTemplates[kind]) && !id) {
      const choices=document.createElement('div');
      choices.className='author-article-templates';
      choices.innerHTML=`<p>可选写作框架：只加入章节标题，正文由你填写，也可以直接开始写。</p>${Object.entries(kind==='articles'?articleTemplates:{[kind]:catalogTemplates[kind]}).map(([key,item])=>`<button type="button" data-article-template="${key}">${esc(item.label)}</button>`).join('')}`;
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
          `<div><a href="/api/author/media/${id}" target="_blank" rel="noopener">${icons.document} 附件 ${index + 1}</a><button type="button" data-remove-file="${id}" aria-label="移除附件 ${index + 1}">${icons.close}</button></div>`,
      )
      .join("");
}
async function saveContent(action) {
  const form = host.querySelector("form");
  if (action !== "unpublish" && !form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form));
  Object.assign(values, {
    action,
    body: editor?.getHTML() || "",
    tags: String(values.tags || "")
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean),
    cover: current.cover || null,
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
  dirty = false;
  await updateSite();
  if (action === "publish" || action === "unpublish") {
    await library(kind);
    feedback(
      action === "publish"
        ? "已发布，访客页面已更新。"
        : "已撤回，访客无法再查看这条内容。",
    );
  } else {
    host.querySelector("#author-dialog-title").textContent =
      "编辑" + names[kind];
    feedback(
      "草稿已保存。" +
        (current.status === "published" ? "访客仍看到之前发布的版本。" : ""),
    );
  }
}
async function backgrounds() {
  current=await api("profile");
  const library=[...(current.background_library || [])];
  if (current.background && !library.some(item=>item.id===current.background)) library.unshift({id:current.background,name:"当前背景"});
  const tile=item=>`<div class="author-background-tile"><img src="/api/author/media/${esc(item.id)}" width="320" height="180" alt="${esc(item.name)}" loading="lazy"><div><strong>${esc(item.name)}</strong><div class="author-background-actions">${item.deletedAt?`<button type="button" data-background-action="restore" data-background-id="${esc(item.id)}">恢复</button>`:`<button type="button" data-background-action="use" data-background-id="${esc(item.id)}" ${current.background===item.id?'disabled':''}>${current.background===item.id?'正在使用':'使用背景'}</button><button type="button" data-background-action="remove" data-background-id="${esc(item.id)}" ${current.background===item.id?'disabled':''}>删除</button>`}</div></div></div>`;
  show(`<h2 id="author-dialog-title">博客背景</h2><p class="author-description">上传后保存在背景库，点击使用即可切换。删除的图片可在“最近删除”中恢复。</p><div class="author-media-row">${uploadField("background","上传背景")}<button type="button" data-background-action="default" ${!current.background?'disabled':''}>使用默认背景</button></div><div class="author-background-gallery">${library.filter(item=>!item.deletedAt).map(tile).join('') || '<p class="subtle">还没有上传背景，当前使用默认星空。</p>'}</div>${library.some(item=>item.deletedAt)?`<details class="author-deleted-backgrounds"><summary>最近删除</summary><div class="author-background-gallery">${library.filter(item=>item.deletedAt).map(tile).join('')}</div></details>`:''}${status()}`);
}
async function profile(section = "profile") {
  current = await api("profile");
  const content = section === "music"
    ? `${field("music_title", "歌单名称", current.music_settings?.title || "我的歌单", 'maxlength="120"')}<div class="author-media-row">${uploadField("music", "上传音乐", false)}</div><details class="author-music-sources"><summary>${icons.link} 添加音频链接</summary>${field("music_link_title","歌曲名称","",'maxlength="120"')}${field("music_link_url","音频网址","",'type="url" placeholder="https://…/music.mp3"')}<button type="button" data-add-track>${icons.plus} 加入播放列表</button><p class="author-description">填写可公开播放的音频直链，酷狗分享页请放在下方平台入口中。</p></details><h3>本站播放列表</h3><div class="author-music-tracks">${musicTracksMarkup(current.music_settings?.tracks||[],icons.close)}</div><p class="author-description">支持 MP3、M4A、OGG、WAV、FLAC，单首最多 100 MB。保存后生效。</p><details class="author-music-sources"><summary>平台歌单入口（选填）</summary>${field("playlist_url", "平台歌单链接（选填）", current.music_settings?.playlistUrl, 'type="url" placeholder="https://t1.kugou.com/…"')}<p class="author-description">保留前往酷狗等平台收听的入口，不会替代本站播放列表。</p></details><label class="author-checkbox"><input type="checkbox" name="music_autoplay" ${current.music_settings?.autoplay !== false ? 'checked' : ''}>尝试自动播放（浏览器可能要求访客先点击播放）</label>`
    : section === "appearance"
    ? `<p class="author-description">选择调色对象，再用下方同一个调色板调整。可以直接选预设颜色，也可以自由取色。</p><div id="author-card-color-picker"></div>`
    : `${field("name", "名称", current.name, 'required maxlength="80"')}${field("signature", "个性签名", current.signature, 'maxlength="200"')}${area("bio", "简介", current.bio, 'rows="2" maxlength="1000"')}<div class="author-media-row">${uploadField("avatar", "更换头像")}<img class="author-avatar-preview" ${current.avatar ? `src="/api/author/media/${current.avatar}"` : "hidden"} alt="头像预览"></div><h3>其他平台主页</h3><div class="author-social-rows">${(current.social_links || []).map(socialRow).join("")}</div><button type="button" data-add-social>${icons.plus} 添加主页链接</button>`;
  show(
    `<h2 id="author-dialog-title">${({background:"博客背景",music:"音乐",appearance:"点缀颜色"})[section] || "个人信息"}</h2><form data-author-form="profile" data-settings="${section}">${content}${status()}<div class="author-form-actions"><button class="author-primary" type="submit">保存设置</button></div></form>`,
  );
  if (section === "music") host.querySelector('[data-upload="music"]').setAttribute('accept','audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/flac,.mp3,.m4a,.ogg,.wav,.flac');
  if (section === "appearance") cardColorPicker=mountCardColorPicker(host.querySelector("#author-card-color-picker"),current.appearance,()=>{dirty=true;});
}
const socialRow = (link = {}) =>
  `<div class="author-social-row"><span class="author-platform-preview" aria-hidden="true">${socialIcon(link.url, icons.link)}</span>${field("social_label", "平台名称", link.label, 'maxlength="40" placeholder="例如 GitHub"')}${field("social_url", "主页链接", normalizeSocialLink(link.url) || link.url, 'type="url" placeholder="https://"')}<button type="button" data-remove-social aria-label="移除此主页链接">${icons.close}</button></div>`;
async function open(detail = {}) {
  if (!author) {
    pendingAfterLogin = detail;
    login();
    return;
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
      show(`<h2 id="author-dialog-title">暂时无法打开</h2>${status()}`);
    feedback(error.message, true);
  }
}
document.addEventListener("click", (event) => {
  const loginButton = event.target.closest("[data-author-login]");
  const entry = event.target.closest("[data-author-open]");
  if (loginButton) {
    event.preventDefault();
    open();
  }
  if (entry && !busy) {
    event.preventDefault();
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
  if (target.hasAttribute('data-remove-track')) {
    target.closest('[data-track-source]').remove();
    host.querySelector('.author-music-tracks').innerHTML=musicTracksMarkup(readMusicTracks(host),icons.close);
    dirty=true;return;
  }
  if (target.hasAttribute('data-add-track')) {
    const title=host.querySelector('[name="music_link_title"]'),link=host.querySelector('[name="music_link_url"]');
    try {
      const url=new URL(link.value.trim());
      if(url.protocol!=='https:' || /(^|\.)(kugou\.com|music\.163\.com|y\.qq\.com)$/.test(url.hostname)) throw new Error();
      const tracks=readMusicTracks(host);
      if(tracks.length>=100) {feedback('歌单最多 100 首。',true);return;}
      tracks.push({title:title.value.trim()||'音乐',url:url.href});
      host.querySelector('.author-music-tracks').innerHTML=musicTracksMarkup(tracks,icons.close);
      title.value='';link.value='';dirty=true;feedback('链接已加入，保存设置后生效。');
    } catch {feedback('请输入 HTTPS 音频直链，平台分享页请填写在平台歌单入口中。',true);}
    return;
  }
  if (target.hasAttribute("data-author-close")) requestClose();
  if (target.hasAttribute("data-keep-editing"))
    shell.querySelector(".author-discard").hidden = true;
  if (target.hasAttribute("data-discard")) {
    const next = pendingNavigation || close;
    dirty = false;
    next();
  }
  if (target.hasAttribute("data-author-back"))
    requestLeave(() =>
      task(() => (shell.dataset.back === "list" ? library(kind) : hub())),
    );
  if (target.hasAttribute("data-new")) task(() => edit(kind));
  if(target.dataset.articleTemplate && editor) {
    if(!editor.isEmpty) { feedback('正文已有内容，写作框架不会覆盖现有文字。'); return; }
    const template=(kind==='articles'?articleTemplates:catalogTemplates)[target.dataset.articleTemplate];
    if(template) {
      editor.commands.setContent(template.body);
      host.querySelector('[name="category"]').value=template.category;
      target.closest('.author-article-templates').hidden=true;
      dirty=true;
    }
  }
  if (target.dataset.edit) task(() => edit(kind, target.dataset.edit));
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
    current[kind === "announcements" ? "image" : "cover"] = null;
    host.querySelector(".author-image-preview").hidden = true;
    dirty = true;
  }
  if (target.dataset.backgroundAction) task(async () => {
    await api("backgrounds", "POST", {action:target.dataset.backgroundAction,id:target.dataset.backgroundId});
    await updateSite();
    await backgrounds();
    feedback(target.dataset.backgroundAction === "remove" ? "已从背景库删除，可在最近删除中恢复。" : "背景设置已更新。");
  });
  if (target.dataset.removeFile) {
    uploads = uploads.filter((id) => id !== target.dataset.removeFile);
    if (current.file === target.dataset.removeFile) current.file = null;
    renderFiles();
    dirty = true;
  }
  if (target.hasAttribute("data-preview") && editor) {
    const preview = host.querySelector(".author-preview"),
      writing = host.querySelector(".author-editor-wrap");
    preview.hidden = !preview.hidden;
    writing.hidden = !preview.hidden;
    if (!preview.hidden)
      preview.innerHTML = `<h2>${esc(host.querySelector('[name="title"]').value)}</h2>${editor.getHTML()}`;
    target.textContent = preview.hidden ? "预览" : "继续编辑";
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
        if(tracks.some(track=>!track.title)) throw new Error('请填写歌曲名称。');
        if (values.playlist_url && !/^https:\/\//.test(values.playlist_url)) throw new Error("歌单链接请使用 HTTPS 网址。");
        if(tracks.some(track=>/^https?:\/\/([^/]*\.)?(kugou\.com|music\.163\.com|y\.qq\.com)(\/|$)/i.test(track.url))) throw new Error('平台分享页不能用作音频直链，请填写在上方平台歌单链接中。');
        values.music_settings = {title:values.music_title,playlistUrl:values.playlist_url,tracks,autoplay:values.music_autoplay==='on'};
      }
      if (form.dataset.settings === "appearance") values.appearance = cardColorPicker.value();
      await api("profile", "PATCH", values);
      dirty = false;
      await updateSite();
      feedback("设置已保存。");
    }
  });
});
shell.addEventListener("change", (event) => {
  const input = event.target.closest("[data-upload]");
  if (!input || !input.files?.length) return;
  task(async () => {
    const uploaded = input.files[0];
    const target=input.dataset.upload;
    if(target==='music' && readMusicTracks(host).length>=100) throw new Error('歌单最多 100 首，请先移除部分歌曲。');
    const limits=await api('upload');
    const cap=target==='music'||uploaded.type.startsWith('audio/')?limits.maxAudioBytes:uploaded.type.startsWith('image/')?limits.maxImageBytes:limits.maxFileBytes;
    if(uploaded.size>cap) throw new Error(`此类文件最多 ${uploadSizeLabel(cap)}。`);
    feedback('正在上传 0%…');
    const data=new FormData(); data.set('file',uploaded);
    if(['background','music'].includes(target)) data.set('purpose',target);
    const controller=new AbortController();
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消上传';
    cancel.onclick=()=>controller.abort();host.querySelector('.author-feedback').after(cancel);
    let saved;
    try { saved=await uploadAuthorFile(data,{signal:controller.signal,onProgress:percent=>feedback(percent===100?'传输完成，正在保存…':`正在上传 ${percent}%…`)}); }
    finally {cancel.remove();input.value='';}
    if(target==='music') {
      const tracks=readMusicTracks(host);
      tracks.push({title:saved.name,url:'/api/media/'+saved.id});
      host.querySelector('.author-music-tracks').innerHTML=musicTracksMarkup(tracks,icons.close);
      dirty=true;feedback('音乐已加入列表，保存设置后访客可以收听。');return;
    }
    if (target === "background") {
      await backgrounds();
      feedback("背景已保存到背景库，点击使用即可切换。");
      return;
    }
    if (target === "body")
      editor
        ?.chain()
        .focus()
        .setImage({ src: saved.url, alt: saved.name })
        .run();
    else if (target === "attachment") {
      if (kind === "articles") uploads.push(saved.id);
      else current.file = saved.id;
      renderFiles();
    } else {
      current[target] = saved.id;
      const image = host.querySelector(
        target === "avatar"
          ? ".author-avatar-preview"
          : target === "background"
            ? ".author-background-preview"
            : ".author-image-preview",
      );
      image.src = saved.url;
      image.hidden = false;
    }
    dirty = true;
    input.value = "";
    feedback("上传完成，保存后生效。");
  });
});
document.addEventListener(
  "keydown",
  (event) => {
    if (dialog.shown && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      requestClose();
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
