// 社区：帖子详情（正文、图集、资源、悬赏、提示词、回复和管理操作）和发帖、编辑表单。
// 这里只拼 HTML；读写接口和表单在 community-ui.ts。

import {
  communityBoards, communityBoard, communityHomeHref, boardHref, postHref, memberHref, rulesHref, imageSrc, boardName,
  avatarHTML, whoHTML, levelChipHTML, flagsHTML, badgeHTML, tagLink, dot, cardHead, moreLink, relativeTime, beijingTime,
  communityBodyHTML, communityStatusHTML, communityTopicsHTML, readyData, plainText,
} from './community.mjs';
import type {
  Common, CommunityLoad, CommunityMe, CommunityPerson, CommunityTopic, CommunityShowcaseMeta, CommunityResource,
} from './community.ts';
import {
  communityRules, communityTags, communityReportReasons, communityUsages, communityResourceKinds, communityResourcePrices, imageLimit,
} from './community-rules.mjs';

export type CommunityImage = { id: string; width: number; height: number };
export type CommunityReply = {
  id: string; author: CommunityPerson; body: string; createdAt: string; edited?: boolean;
  likes?: number; liked?: boolean; thanked?: boolean; thanks?: number;
  byTopicAuthor: boolean; accepted?: boolean; mine?: boolean; hidden?: boolean;
  quote?: { id: string; author: string; excerpt: string } | null;
  canDelete: boolean; canEdit?: boolean; canAccept?: boolean; canRestore?: boolean;
};
// The prompt is there only when the viewer may read it; a paid prompt otherwise comes as a masked preview.
export type CommunityThreadMeta = CommunityShowcaseMeta & { prompt: string | null; preview: string | null; unlocked: boolean; unlocks: number };
export type CommunityThreadTopic = Omit<CommunityTopic, "meta" | "resource"> & {
  body: string; canDelete: boolean; images?: CommunityImage[];
  liked?: boolean; bookmarked?: boolean; bookmarks?: number; thanked?: boolean; thanks?: number; mine?: boolean;
  canEdit?: boolean; canModerate?: boolean; canFeature?: boolean; canRetag?: boolean; canPaidPin?: boolean; canHighlight?: boolean; canReply?: boolean;
  meta?: CommunityThreadMeta | null;
  resource?: (CommunityResource & { myVote?: "alive" | "dead" | null }) | null;
  pendingReason?: string | null; hiddenReason?: string | null;
};
export type CommunityAuthorCard = CommunityPerson & {
  topics: number; replies: number; likes?: number; accepted?: number; featured?: number; badges?: string[]; bio?: string; following?: boolean;
};
export type CommunityThread = {
  topic: CommunityThreadTopic; replies: CommunityReply[]; author: CommunityAuthorCard; related: CommunityTopic[];
  // @名字 → UID, for the names in the post that belong to members.
  mentions?: Record<string, string>;
  viewer?: { level: number; muted: { until: string; reason: string } | null };
};
export type CommunityTarget = { kind: "topic" | "reply"; id: string };
export type CommunityReplySort = "floor" | "likes";

// 与服务端校验一致（server/community-routes-content.ts）。随想没有标题，正文 2–300 字；作品和资源的正文可以不写。
export const communityLimits = { title: [4, 60], topic: [10, 10000], reply: [2, 2000], moment: [2, communityRules.momentMax], optional: [0, 10000] } as const;
export const bodyLimits = (board: string) =>
  board === "moments" ? communityLimits.moment : board === "showcase" || board === "tools" ? communityLimits.optional : communityLimits.topic;

/* ---------- 编辑器：格式按钮、正文和预览 ---------- */
type EditorOptions = { id: string; name?: string; rows: number; value?: string; placeholder: string; label: string; limits: readonly [number, number]; hideLabel?: boolean };
export function editorHTML({ id, name = "body", rows, value = "", placeholder, label, limits: [min, max], hideLabel = false }: EditorOptions, { t, esc, icons = {} }: Common) {
  const tool = (md: string, icon: string, title: string) => `<button type="button" data-action="community-md" data-md="${md}" data-for="${id}" title="${title}" aria-label="${title}">${icons[icon] || ""}</button>`;
  return `<div class="community-field"><label class="${hideLabel ? "sr-only" : "community-field-l"}" for="${id}">${label}</label>`
    + `<div class="community-editor"><div class="community-ed-tools" role="toolbar" aria-label="${t("格式", "Formatting")}" aria-controls="${id}">`
    + tool("bold", "bold", t("加粗", "Bold")) + tool("code", "code", t("代码", "Code")) + tool("link", "link", t("链接", "Link"))
    + tool("quote", "quote", t("引用", "Quote")) + tool("list", "list", t("列表", "List"))
    + `<span class="community-ed-sep"></span><button type="button" class="community-ed-prev" data-action="community-md-preview" data-for="${id}" aria-pressed="false">${t("预览", "Preview")}</button></div>`
    + `<textarea id="${id}" name="${name}" rows="${rows}" minlength="${min}" maxlength="${max}"${min ? " required" : ""} placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    + `<div class="community-ed-preview community-text is-small" data-preview-for="${id}" hidden></div></div>`
    + `<small data-count-for="${name}">0 / ${max}</small></div>`;
}

/* ---------- 举报 ---------- */
// 从固定原因里选，可以补一句说明。
function reportFormHTML(target: CommunityTarget, { t, esc }: Common) {
  return `<form class="community-report" data-community-form="report" data-kind="${target.kind}" data-id="${esc(target.id)}" novalidate>`
    + `<fieldset><legend>${t("举报原因", "Reason")}</legend><div class="community-radio-list">${communityReportReasons.map((reason) => `<label><input type="radio" name="reason" value="${esc(reason)}" required><span>${esc(reason)}</span></label>`).join("")}</div></fieldset>`
    + `<div class="community-field"><label for="community-report-note">${t("补充说明（可选）", "Details (optional)")}</label><input id="community-report-note" name="note" type="text" maxlength="200" autocomplete="off"></div>`
    + `<p class="community-form-status" role="status" aria-live="polite"></p>`
    + `<div class="community-form-actions"><button type="button" class="community-button" data-action="community-report-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-gold">${t("提交举报", "Report")}</button></div></form>`;
}

// 站长和协管删除别人的内容：可以按违规处理（收回星尘再扣 20），删帖时还可以同时禁言。
function deletePanelHTML(target: CommunityTarget, { t, esc }: Common) {
  const what = target.kind === "topic" ? t("这个帖子", "this post") : t("这条回复", "this reply");
  return `<form class="community-panel is-danger" data-community-form="delete" data-kind="${target.kind}" data-id="${esc(target.id)}" novalidate>`
    + `<p class="community-panel-title">${t(`删除${what}`, `Delete ${what}`)}</p>`
    + `<label class="community-check"><input type="checkbox" name="violation" checked><span>${t(`按违规处理：收回它带来的星尘，再扣 ${communityRules.penalty}`, `Treat as a violation: take back its stardust and ${communityRules.penalty} more`)}</span></label>`
    + `<fieldset class="community-inline-choices"><legend>${t("同时禁言作者", "Also mute the author")}</legend>${[[0, t("不禁言", "No")], [1, t("1 天", "1 day")], [7, t("7 天", "7 days")], [30, t("30 天", "30 days")]].map(([days, label]) => `<label><input type="radio" name="mute" value="${days}"${days === 0 ? " checked" : ""}><span>${label}</span></label>`).join("")}</fieldset>`
    + `<p class="community-form-status" role="status" aria-live="polite"></p>`
    + `<div class="community-form-actions"><button type="button" class="community-button" data-action="community-delete-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-danger">${t("确认删除", "Delete")}</button></div></form>`;
}

function movePanelHTML(topic: CommunityThreadTopic, { t, esc }: Common) {
  const options = communityBoards.filter((board) => board.id !== topic.board).map((board) => `<option value="${board.id}">${esc(t(board.zh, board.en))}</option>`).join("");
  return `<form class="community-panel" data-community-form="move" data-id="${esc(topic.id)}" novalidate>`
    + `<div class="community-field"><label class="community-field-l" for="community-move-board">${t("移动到", "Move to")}</label><select id="community-move-board" name="board" class="community-select">${options}</select></div>`
    + `<p class="community-muted">${t("作者会收到通知。", "The author is told.")}</p><p class="community-form-status" role="status" aria-live="polite"></p>`
    + `<div class="community-form-actions"><button type="button" class="community-button" data-action="community-move-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-gold">${t("移动", "Move")}</button></div></form>`;
}

function retagPanelHTML(topic: CommunityThreadTopic, { t, esc }: Common) {
  const current = new Set(topic.tags || []);
  return `<form class="community-panel" data-community-form="retag" data-id="${esc(topic.id)}" novalidate>`
    + `<fieldset class="community-choices"><legend>${t(`修改标签（最多 ${communityRules.tagMax} 个）`, `Tags (up to ${communityRules.tagMax})`)}</legend><div class="community-choice-list">${communityTags.map((tag) => `<label class="community-choice is-tag"><input type="checkbox" name="tags" value="${esc(tag)}"${current.has(tag) ? " checked" : ""}><span>${esc(tag)}</span></label>`).join("")}</div></fieldset>`
    + `<p class="community-form-status" role="status" aria-live="polite"></p>`
    + `<div class="community-form-actions"><button type="button" class="community-button" data-action="community-retag-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-gold">${t("保存标签", "Save tags")}</button></div></form>`;
}

/* ---------- 帖子详情的部件 ---------- */
// 图集：作品展廊多图时一张大图加一排小图，其他情况按张数排成网格。点开看大图。
function galleryHTML(images: readonly CommunityImage[], board: string, { t, icons = {} }: Common) {
  if (!images.length) return "";
  const item = (image: CommunityImage, i: number, cls: string) =>
    `<button type="button" class="${cls}" data-action="community-lightbox" data-src="${imageSrc(image.id)}" aria-label="${t(`查看第 ${i + 1} 张图`, `View image ${i + 1}`)}"><img src="${imageSrc(image.id, cls !== "community-g-main" && images.length > 1)}" alt="" loading="lazy" decoding="async" width="${image.width}" height="${image.height}">${cls === "community-g-main" ? `<span class="community-g-count">${icons.image || ""}${images.length}</span>` : ""}</button>`;
  if (board === "showcase" && images.length > 1)
    return `<div class="community-gallery is-show">${item(images[0], 0, "community-g-main")}<div class="community-g-strip">${images.slice(1, 6).map((image, i) => item(image, i + 1, "community-g-item")).join("")}</div></div>`;
  return `<div class="community-gallery is-${Math.min(images.length, 4)}">${images.map((image, i) => item(image, i, "community-g-item")).join("")}</div>`;
}

// 资源帖：官方链接、类型价格平台，以及“仍可用 / 已失效”的反馈。
function resourceHTML(topic: CommunityThreadTopic, { t, esc, icons = {} }: Common) {
  const resource = topic.resource;
  if (!resource) return "";
  let host = resource.url;
  try { host = new URL(resource.url).host; } catch { /* keep the address */ }
  const vote = (value: "alive" | "dead", icon: string, label: string, count: number) =>
    `<button type="button" class="community-vote is-${value}${resource.myVote === value ? " is-on" : ""}" data-action="community-vote" data-value="${value}" data-id="${esc(topic.id)}" aria-pressed="${resource.myVote === value}">${icons[icon] || ""}<span>${label}</span><b>${count}</b></button>`;
  return `<div class="community-res">`
    + `<a class="community-res-link" href="${esc(resource.url)}" target="_blank" rel="noopener noreferrer nofollow ugc">${icons.link || ""}<span><b>${esc(host)}</b><small>${esc(resource.url)}</small></span>${icons.external || ""}</a>`
    + `<dl class="community-res-meta"><div><dt>${t("类型", "Type")}</dt><dd>${esc(resource.kind)}</dd></div><div><dt>${t("价格", "Price")}</dt><dd>${esc(resource.price)}</dd></div><div><dt>${t("平台", "Platform")}</dt><dd>${esc(resource.platform || "—")}</dd></div></dl>`
    + `<div class="community-res-vote"><span class="community-muted">${t("这个资源现在还能用吗？", "Does it still work?")}</span>${vote("alive", "check", t("仍可用", "Works"), resource.alive)}${vote("dead", "close", t("已失效", "Dead"), resource.dead)}</div>`
    + (resource.dead > resource.alive ? `<p class="community-res-warn">${icons.alert || ""}${t("反馈“已失效”的人比较多，使用前请先确认。", "Several people say it no longer works; check before relying on it.")}</p>` : "")
    + `</div>`;
}

// 问答帖：悬赏说明、已采纳的回答，或者采纳规则。
function bountyHTML(topic: CommunityThreadTopic, accepted: CommunityReply | undefined, { t, esc, icons = {} }: Common) {
  if (topic.board !== "qa") return "";
  const amount = topic.bounty || 0;
  if (accepted) return `<div class="community-bounty is-solved">${icons.check || ""}<span>${amount ? t(`悬赏 ${amount} 星尘，已采纳 ${esc(accepted.author.name)} 的回答，星尘已发放。`, `Bounty of ${amount}: ${esc(accepted.author.name)}'s answer was accepted and paid.`) : t(`已采纳 ${esc(accepted.author.name)} 的回答`, `${esc(accepted.author.name)}'s answer was accepted`)}</span></div>`;
  if (topic.bountyState === "open" && amount) return `<div class="community-bounty">${icons.star || ""}<span>${t(`悬赏 <b>${amount}</b> 星尘：采纳后悬赏发给被采纳的回答者，系统另奖励 TA ${communityRules.acceptReward} 星尘；${communityRules.bountyDays} 天没人采纳会退回一半。`, `Bounty <b>${amount}</b>: the bounty goes to the accepted answer; the system also awards them ${communityRules.acceptReward} stardust. Half comes back after ${communityRules.bountyDays} days without one.`)}</span></div>`;
  if (topic.bountyState === "refunded") return `<div class="community-bounty is-plain">${icons.clock || ""}<span>${t(`悬赏 ${amount} 星尘 ${communityRules.bountyDays} 天没人采纳，已退回一半。`, `The ${amount} bounty expired; half went back to the asker.`)}</span></div>`;
  return `<div class="community-bounty is-plain">${icons.help || ""}<span>${t(`提问者可以采纳一个最有用的回答，被采纳的人得 ${communityRules.acceptReward} 星尘。`, `The asker can accept the most useful answer; its author gets ${communityRules.acceptReward} stardust.`)}</span></div>`;
}

// 作品信息：工具、模型、用途，以及提示词（公开、不公开，或花星尘解锁）。
function metaCardHTML(topic: CommunityThreadTopic, { t, esc, icons = {} }: Common) {
  const meta = topic.meta;
  if (!meta) return "";
  let prompt: string;
  if (meta.prompt !== null && meta.prompt !== undefined && meta.promptMode !== "hidden") {
    const note = meta.promptMode !== "paid" ? "" : `<p class="community-muted">${topic.mine ? t(`你设了 ${meta.price} 星尘解锁，已有 ${meta.unlocks} 人解锁。`, `You set ${meta.price} stardust; ${meta.unlocks} unlocked it.`)
      : meta.unlocked ? t("你已解锁。", "Unlocked.") : t(`站长可以直接查看。已有 ${meta.unlocks} 人解锁。`, `Visible to the owner. ${meta.unlocks} unlocked it.`)}</p>`;
    prompt = `<div class="community-prompt"><div class="community-prompt-h"><span>${icons.unlock || ""}${t("提示词", "Prompt")}</span><button type="button" class="community-act is-small" data-action="community-copy-prompt">${icons.copy || ""}<span>${t("复制", "Copy")}</span></button></div><pre data-prompt>${esc(meta.prompt)}</pre>${note}</div>`;
  } else if (meta.promptMode === "paid" && meta.preview) {
    prompt = `<div class="community-prompt is-locked"><div class="community-prompt-h"><span>${icons.lock || ""}${t("提示词", "Prompt")}</span><b class="community-gold">${t(`${meta.price} 星尘`, `${meta.price} stardust`)}</b></div>`
      + `<pre aria-hidden="true">${esc(meta.preview)}</pre>`
      + `<p class="community-muted">${t(`作者得 ${Math.floor(meta.price * communityRules.unlockShare)}，其余销毁。已有 ${meta.unlocks} 人解锁。`, `The author gets ${Math.floor(meta.price * communityRules.unlockShare)}; the rest is burned. ${meta.unlocks} unlocked it.`)}</p>`
      + `<button type="button" class="community-button is-gold is-small is-block" data-action="community-unlock" data-id="${esc(topic.id)}">${icons.unlock || ""}<span>${t(`用 ${meta.price} 星尘解锁`, `Unlock for ${meta.price}`)}</span></button></div>`;
  } else {
    prompt = `<div class="community-prompt is-hidden"><div class="community-prompt-h"><span>${icons.eye || ""}${t("提示词", "Prompt")}</span></div><p class="community-muted">${t("作者没有公开提示词。", "The author keeps the prompt private.")}</p></div>`;
  }
  return `<section class="community-card community-spot">${cardHead(t("作品信息", "About this work"))}`
    + `<dl class="community-kv"><dt>${t("工具", "Tools")}</dt><dd>${esc(meta.tools)}</dd><dt>${t("模型", "Model")}</dt><dd>${esc(meta.model || "—")}</dd><dt>${t("用途", "Usage")}</dt><dd>${esc(meta.usage)}</dd></dl>`
    + prompt + `</section>`;
}

function authorCardHTML(author: CommunityAuthorCard, mine: boolean, common: Common) {
  const { t, esc } = common;
  const uid = author.uid || "";
  const badges = (author.badges || []).slice(0, 6).map((id) => badgeHTML(id, true, common, "sm", true)).join("");
  const follow = !mine && uid && author.role === "reader"
    ? `<button type="button" class="community-button is-small${author.following ? "" : " is-line-gold"}" data-action="community-follow" data-uid="${esc(uid)}" aria-pressed="${Boolean(author.following)}">${author.following ? t("已关注", "Following") : t("关注", "Follow")}</button>`
    : "";
  return `<section class="community-card community-author-card community-spot"><div class="community-ac-top">${avatarHTML(author, common, "lg")}<div>${whoHTML(author, common)}</div></div>`
    + (author.bio ? `<p class="community-muted">${esc(author.bio)}</p>` : "")
    + `<dl class="community-mini-stats"><div><dt>${t("主题", "Topics")}</dt><dd>${author.topics}</dd></div><div><dt>${t("获赞", "Likes")}</dt><dd>${author.likes ?? 0}</dd></div><div><dt>${t("被采纳", "Accepted")}</dt><dd>${author.accepted ?? 0}</dd></div></dl>`
    + (badges ? `<div class="community-badge-row">${badges}</div>` : "")
    + (uid ? `<div class="community-row-2"><a class="community-button is-small" href="${memberHref(uid)}">${t("主页", "Profile")}</a>${follow}</div>` : "")
    + `</section>`;
}

/* ---------- 帖子详情 ---------- */
type PostOptions = Common & {
  thread: CommunityLoad<CommunityThread>;
  me?: CommunityMe | null;
  reporting?: CommunityTarget | null;
  editingReply?: string | null;
  menuOpen?: boolean;
  deleting?: CommunityTarget | null;
  moving?: boolean;
  retagging?: boolean;
  quoting?: string | null;
  replySort?: CommunityReplySort;
};

export function communityPostHTML({ thread, me = null, reporting = null, editingReply = null, menuOpen = false, deleting = null, moving = false, retagging = false, quoting = null, replySort = "floor", ...common }: PostOptions) {
  const { t, esc, now = Date.now(), icons = {} } = common;
  if (thread.state !== "ready") return `<section class="page community-page" data-community="post">${communityStatusHTML(thread, common)}</section>`;
  const { topic, replies, author, related, mentions = {}, viewer } = thread.data;
  const board = communityBoard(topic.board);
  const moment = topic.board === "moments";
  const when = (value: string) => `<time datetime="${esc(value)}" title="${esc(beijingTime(value, true))}">${relativeTime(value, now, t)}</time>`;
  const edited = (flag?: boolean) => flag ? `<span class="community-muted">${t("· 已编辑", "· edited")}</span>` : "";
  const open = (target: CommunityTarget | null, kind: CommunityTarget["kind"], id: string) => target?.kind === kind && target.id === id;
  // Deleting your own content takes two clicks; a moderator removing someone else's gets the panel.
  const deleteButton = (kind: CommunityTarget["kind"], id: string, mine: boolean, small = false) =>
    `<button type="button" class="community-act is-quiet${small ? " is-small" : ""} community-delete" data-action="community-delete-${kind}" data-id="${esc(id)}"${mine ? "" : ' data-panel="true"'}>${icons.trash || ""}<span>${t("删除", "Delete")}</span></button>`;
  const likeButton = (kind: CommunityTarget["kind"], id: string, likes = 0, liked = false, small = false) =>
    `<button type="button" class="community-act${small ? " is-small" : ""}${liked ? " is-on" : ""}" data-action="community-like" data-kind="${kind}" data-id="${esc(id)}" aria-pressed="${liked}" aria-label="${t(`赞，${likes} 人赞过`, `Like, ${likes} likes`)}">${icons.like || ""}<span>${likes}</span></button>`;
  const restricted = !me || (!me.owner && (me.level ?? 0) < 1);
  const lockedHint = t("升到巡天后可用", "Available at Survey level");
  const thankButton = (kind: CommunityTarget["kind"], id: string, thanked = false, small = false) =>
    `<button type="button" class="community-act is-gold${small ? " is-small" : ""}${thanked ? " is-on" : ""}" data-action="community-thank" data-kind="${kind}" data-id="${esc(id)}"${thanked || restricted ? " disabled" : ""}${restricted ? ` aria-disabled="true" title="${lockedHint}"` : ""}>${icons.gift || ""}<span>${thanked ? t("已感谢", "Thanked") : restricted ? t(`感谢（${lockedHint}）`, `Thank (${lockedHint})`) : t("感谢", "Thank")}</span><small>${t(`${communityRules.thankCost} 星尘`, `${communityRules.thankCost} stardust`)}</small></button>`;
  const reportButton = (kind: CommunityTarget["kind"], id: string, small = false) =>
    `<button type="button" class="community-act is-quiet${small ? " is-small" : ""}" data-action="community-report" data-kind="${kind}" data-id="${esc(id)}" aria-label="${restricted ? t(`举报（${lockedHint}）`, `Report (${lockedHint})`) : t("举报", "Report")}"${restricted ? ` aria-disabled="true" disabled title="${lockedHint}"` : ""}>${icons.flag || ""}<span>${restricted ? t(`举报（${lockedHint}）`, `Report (${lockedHint})`) : t("举报", "Report")}</span></button>`;
  const accepted = replies.find((reply) => reply.accepted);
  const canReply = topic.canReply !== false && !topic.locked;
  const [replyMin, replyMax] = communityLimits.reply;
  // Floors follow posting order even when the list is sorted by likes or the accepted answer comes first.
  const floors = new Map([...replies].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((reply, i) => [reply.id, i + 1]));
  const others = replies.filter((reply) => !reply.accepted);
  const ordered = replySort === "likes" ? [...others].sort((a, b) => (b.likes || 0) - (a.likes || 0)) : [...others].sort((a, b) => (floors.get(a.id) || 0) - (floors.get(b.id) || 0));
  const replyHTML = (reply: CommunityReply) => {
    const floor = floors.get(reply.id) || 0;
    if (reply.hidden && !reply.body) return `<li class="community-reply is-gone" id="reply-${esc(reply.id)}"><span class="community-floor">#${floor}</span><p>${t("这条回复被举报，暂时隐藏，等站长复核。", "This reply was reported and is hidden until it is reviewed.")}</p></li>`;
    const editing = editingReply === reply.id;
    const body = editing
      ? `<form class="community-reply-edit" data-community-form="reply-edit" data-id="${esc(reply.id)}" novalidate>${editorHTML({ id: "community-reply-edit", rows: 4, value: reply.body, placeholder: "", label: t("编辑回复", "Edit reply"), limits: communityLimits.reply, hideLabel: true }, common)}<p class="community-form-status" role="status" aria-live="polite"></p><div class="community-form-actions"><button type="button" class="community-button is-small" data-action="community-edit-cancel">${t("取消", "Cancel")}</button><button type="submit" class="community-button is-gold is-small">${t("保存", "Save")}</button></div></form>`
      : `<div class="community-text is-small">${communityBodyHTML(reply.body, esc, mentions)}</div>`;
    const quote = reply.quote ? `<blockquote class="community-quote"><b>${esc(reply.quote.author)}：</b>${esc(plainText(reply.quote.excerpt))}${[...reply.quote.excerpt].length >= 80 ? "…" : ""}</blockquote>` : "";
    const acts = `<div class="community-reply-acts">${likeButton("reply", reply.id, reply.likes, reply.liked, true)}`
      + (canReply ? `<button type="button" class="community-act is-small" data-action="community-quote" data-id="${esc(reply.id)}">${icons.reply || ""}<span>${t("回复", "Reply")}</span></button>` : "")
      + (reply.mine ? "" : thankButton("reply", reply.id, reply.thanked, true))
      + (reply.canAccept ? `<button type="button" class="community-act is-small is-good" data-action="community-accept" data-id="${esc(reply.id)}">${icons.check || ""}<span>${t("采纳这个回答", "Accept this answer")}</span></button>` : "")
      + `<span class="community-act-spacer"></span>`
      + (reply.canRestore ? `<button type="button" class="community-act is-quiet is-small" data-action="community-restore" data-kind="reply" data-id="${esc(reply.id)}">${icons.eye || ""}<span>${t("恢复显示", "Show again")}</span></button>` : "")
      + (reply.canEdit && !editing ? `<button type="button" class="community-act is-quiet is-small" data-action="community-edit-reply" data-id="${esc(reply.id)}">${icons.pen || ""}<span>${t("编辑", "Edit")}</span></button>` : "")
      + (reply.canDelete ? deleteButton("reply", reply.id, Boolean(reply.mine), true) : "")
      + (reply.mine ? "" : reportButton("reply", reply.id, true)) + `</div>`;
    return `<li class="community-reply${reply.accepted ? " is-accepted" : ""}${reply.hidden ? " is-hidden" : ""}" id="reply-${esc(reply.id)}" tabindex="-1">${avatarHTML(reply.author, common, "sm")}<div class="community-reply-main">`
      + `<div class="community-reply-meta">${reply.accepted ? `<span class="community-flag is-solved">${icons.check || ""}${t("已采纳", "Accepted")}</span>` : ""}${reply.hidden ? `<span class="community-flag is-danger">${icons.eye || ""}${t("已隐藏", "Hidden")}</span>` : ""}${whoHTML(reply.author, common)}${reply.byTopicAuthor ? `<span class="community-op">${t("楼主", "OP")}</span>` : ""}${dot}${when(reply.createdAt)}${edited(reply.edited)}<span class="community-floor">#${floor}</span></div>`
      + quote + body + acts
      + (open(reporting, "reply", reply.id) ? reportFormHTML({ kind: "reply", id: reply.id }, common) : "")
      + (open(deleting, "reply", reply.id) ? deletePanelHTML({ kind: "reply", id: reply.id }, common) : "")
      + `</div></li>`;
  };
  const list = (accepted ? [accepted] : []).concat(ordered);
  const repliesHTML = list.length
    ? `<ol class="community-replies">${list.map(replyHTML).join("")}</ol>`
    : `<p class="community-muted community-replies-empty">${topic.board === "qa" ? t("还没有回复。知道答案的话，帮帮忙吧。", "No answers yet.") : t("还没有回复，说点什么吧。", "No replies yet.")}</p>`;
  const sortSeg = replies.length > 1
    ? `<div class="community-seg is-small" role="group" aria-label="${t("回复排序", "Sort replies")}">${([["floor", t("按楼层", "Oldest first")], ["likes", t("按赞数", "Most liked")]] as const).map(([id, label]) => `<button type="button" data-action="community-reply-sort" data-sort="${id}" aria-pressed="${replySort === id}">${label}</button>`).join("")}</div>`
    : "";
  const muted = viewer?.muted;
  const quoted = quoting ? replies.find((reply) => reply.id === quoting) : null;
  const newcomer = me ? !me.owner && (me.level ?? 0) < 1 : false;
  const form = topic.locked
    ? `<div class="community-notice">${icons.lock || ""}<div><b>${t("这个帖子已锁定", "This post is locked")}</b><span>${t("不能再回复了。", "No new replies.")}</span></div></div>`
    : muted
      ? `<div class="community-notice is-danger">${icons.ban || ""}<div><b>${t(`你被禁言到 ${beijingTime(muted.until, true)}`, `You are muted until ${beijingTime(muted.until, true)}`)}</b><span>${t(`原因：${esc(muted.reason)}。觉得处理错了，可以在站务反馈里申诉。`, `Reason: ${esc(muted.reason)}. You can appeal in the Meta board.`)}</span></div></div>`
      : topic.pending
        ? `<div class="community-notice is-warn">${icons.clock || ""}<div><b>${t("审核通过后才能回复", "Replies open after review")}</b></div></div>`
        : `<form class="community-reply-form" data-community-form="reply" data-topic="${esc(topic.id)}" novalidate>`
          + (me ? `<div class="community-rf-head">${avatarHTML(me, common, "sm", false)}<span>${t(`以 <b>${esc(me.name)}</b> 的身份回复`, `Replying as <b>${esc(me.name)}</b>`)}</span></div>` : "")
          + (quoted ? `<div class="community-quoting">${icons.quote || ""}<span>${t(`回复 <b>${esc(quoted.author.name)}</b>：`, `Replying to <b>${esc(quoted.author.name)}</b>: `)}${esc([...plainText(quoted.body)].slice(0, 40).join(""))}…</span><button type="button" class="community-icon-button" data-action="community-unquote" aria-label="${t("取消引用", "Stop quoting")}">${icons.close || "×"}</button></div>` : "")
          + editorHTML({ id: "community-reply", rows: 4, placeholder: t("写下你的回复。输入 @ 加名字可以提到别人。友善、具体。", "Write a reply. Type @ and a name to mention someone. Be kind and specific."), label: t("写回复", "Reply"), limits: [replyMin, replyMax], hideLabel: true }, common)
          + `<p class="community-form-status" role="status" aria-live="polite"></p>`
          + `<div class="community-rf-bar"><span class="community-muted">${newcomer
            ? `${t(`初光：每天最多 ${communityRules.l0RepliesDaily} 条回复，每条最多 ${communityRules.l0Links} 个链接`, `First light: up to ${communityRules.l0RepliesDaily} replies a day, ${communityRules.l0Links} links each`)} <span class="community-shortcut">${t("· Ctrl+Enter 发送", "· Ctrl+Enter sends")}</span>`
            : `${t(`${communityRules.replyMinLength} 字以上的回复 +${communityRules.replyReward} 星尘，每天最多 ${communityRules.replyDaily} 次`, `Replies of ${communityRules.replyMinLength}+ characters earn ${communityRules.replyReward} stardust (${communityRules.replyDaily} a day)`)} <span class="community-shortcut">${t("· Ctrl+Enter 发送", "· Ctrl+Enter sends")}</span>`}</span><button type="submit" class="community-button is-gold">${icons.send || ""}${t("回复", "Reply")}</button></div></form>`;
  const relatedCard = related.length
    ? `<section class="community-card">${cardHead(t("同版块", "In this board"), "", moreLink(boardHref(topic.board), t("更多", "More"), icons))}<ul class="community-related">${related.map((item) => `<li><a href="${postHref(item.id)}">${esc(item.title)}</a><span>${t(`${item.replies} 回复`, `${item.replies} replies`)}</span></li>`).join("")}</ul></section>`
    : "";
  const flags = flagsHTML(topic, common);
  // 更多操作：作者的编辑、付费置顶和高亮；站长和协管的置顶、精华、锁帖、移动、审核、恢复；修改标签；删除。
  const inventory = me?.inventory;
  const menuItems = [
    topic.canEdit && !topic.locked ? `<a role="menuitem" href="#/community/edit/${encodeURIComponent(topic.id)}">${icons.pen || ""}<span>${t("编辑", "Edit")}</span></a>` : "",
    topic.canPaidPin ? `<button type="button" role="menuitem" data-action="community-paid-pin" data-id="${esc(topic.id)}">${icons.sparkles || icons.pin || ""}<span>${inventory?.pin ? t(`推荐 24 小时 · 用推荐卡（剩 ${inventory.pin} 张）`, `Recommend for 24 h · use a card (${inventory.pin} left)`) : t(`推荐 24 小时 · ${communityRules.pinCost} 星尘`, `Recommend for 24 h · ${communityRules.pinCost} stardust`)}</span></button>` : "",
    topic.canHighlight ? `<button type="button" role="menuitem" data-action="community-highlight" data-id="${esc(topic.id)}">${icons.sparkles || ""}<span>${inventory?.highlight ? t(`标题发光 ${communityRules.glowDays} 天 · 用高亮卡（剩 ${inventory.highlight} 张）`, `Glow for ${communityRules.glowDays} days · use a card (${inventory.highlight} left)`) : t(`标题发光 ${communityRules.glowDays} 天 · 需要高亮卡`, `Glow for ${communityRules.glowDays} days · needs a card`)}</span></button>` : "",
    topic.canModerate ? `<button type="button" role="menuitem" data-action="community-pin" data-id="${esc(topic.id)}" aria-pressed="${Boolean(topic.pinned)}">${icons.pin || ""}<span>${topic.pinned ? t("取消置顶", "Unpin") : t("置顶", "Pin")}</span></button>` : "",
    topic.canFeature ? `<button type="button" role="menuitem" data-action="community-feature" data-id="${esc(topic.id)}" aria-pressed="${Boolean(topic.featured)}">${icons.award || ""}<span>${topic.featured ? t("取消精华", "Unfeature") : t(`评为精华（+${communityRules.featureReward} 星尘）`, `Feature (+${communityRules.featureReward})`)}</span></button>` : "",
    topic.canModerate ? `<button type="button" role="menuitem" data-action="community-lock" data-id="${esc(topic.id)}" aria-pressed="${Boolean(topic.locked)}">${icons.lock || ""}<span>${topic.locked ? t("解除锁定", "Unlock") : t("锁定，禁止回复", "Lock replies")}</span></button>` : "",
    topic.canModerate ? `<button type="button" role="menuitem" data-action="community-move" data-id="${esc(topic.id)}">${icons.move || ""}<span>${t("移动到其他版块", "Move to another board")}</span></button>` : "",
    topic.canModerate && topic.hidden ? `<button type="button" role="menuitem" data-action="community-restore" data-kind="topic" data-id="${esc(topic.id)}">${icons.eye || ""}<span>${t("恢复显示", "Show again")}</span></button>` : "",
    topic.canModerate && topic.pending ? `<button type="button" role="menuitem" data-action="community-approve" data-id="${esc(topic.id)}">${icons.check || ""}<span>${t("审核通过", "Approve")}</span></button>` : "",
    topic.canRetag ? `<button type="button" role="menuitem" data-action="community-retag" data-id="${esc(topic.id)}">${icons.tags || ""}<span>${t("修改标签", "Change tags")}</span></button>` : "",
  ].filter(Boolean);
  const menu = menuItems.length
    ? `<div class="community-more-menu"><button type="button" class="community-act is-quiet" data-action="community-post-menu" aria-haspopup="menu" aria-expanded="${menuOpen}" aria-controls="community-post-menu" aria-label="${t("更多操作", "More actions")}">${icons.more || "…"}</button><div class="community-post-menu" id="community-post-menu" role="menu"${menuOpen ? "" : " hidden"}>${menuItems.join("")}</div></div>`
    : "";
  const actbar = `<div class="community-actbar">${likeButton("topic", topic.id, topic.likes, topic.liked)}`
    + `<button type="button" class="community-act${topic.bookmarked ? " is-on" : ""}" data-action="community-bookmark" data-id="${esc(topic.id)}" aria-pressed="${Boolean(topic.bookmarked)}">${icons.bookmark || ""}<span>${t("收藏", "Bookmark")}</span><small>${topic.bookmarks || 0}</small></button>`
    + (topic.mine ? "" : thankButton("topic", topic.id, topic.thanked))
    + `<button type="button" class="community-act" data-action="community-copy-link">${icons.copy || ""}<span>${t("复制链接", "Copy link")}</span></button>`
    + `<span class="community-act-spacer"></span>`
    + (topic.mine ? "" : reportButton("topic", topic.id))
    + (topic.canDelete ? deleteButton("topic", topic.id, Boolean(topic.mine)) : "")
    + menu + `</div>`;
  const notice = topic.pending
    ? `<div class="community-notice is-warn">${icons.clock || ""}<div><b>${t("这个帖子正在等站长审核", "This post is waiting for review")}</b><span>${t(`${esc(topic.pendingReason || "")}。通过后其他人才能看到。`, "Others will see it once it is approved.")}</span></div></div>`
    : topic.hidden
      ? `<div class="community-notice is-danger">${icons.eye || ""}<div><b>${t("这个帖子已被隐藏", "This post is hidden")}</b><span>${t(`${esc(topic.hiddenReason || "")}。站长复核前只有作者和管理者能看到。`, "Only its author and moderators see it until it is reviewed.")}</span></div></div>`
      : "";
  return `<section class="page community-page" data-community="post" style="--board:${board?.color || "#aeb3bd"}"><div class="community-post-grid">`
    + `<article class="community-thread community-rv" style="--i:0" aria-labelledby="community-post-title">`
    + `<nav class="community-crumb" aria-label="${t("位置", "Location")}"><a href="${communityHomeHref}">${t("社区", "Community")}</a>${icons["chevron-right"] || "›"}<a href="${boardHref(topic.board)}">${esc(boardName(topic.board, t))}</a></nav>`
    + notice
    + `<header class="community-post-head">${flags ? `<div class="community-post-flags">${flags}</div>` : ""}<h1 id="community-post-title"${moment ? ' class="sr-only"' : ""}>${esc(topic.title)}</h1>`
    + `<div class="community-post-by">${avatarHTML(topic.author, common, "sm")}${whoHTML(topic.author, common)}${dot}${when(topic.createdAt)}${edited(topic.edited)}${dot}<span class="community-views">${icons.eye || ""}${t(`${topic.views || 0} 次浏览`, `${topic.views || 0} views`)}</span></div></header>`
    + galleryHTML(topic.images || [], topic.board, common)
    + (topic.body ? `<div class="community-text${moment ? " is-moment" : ""}">${communityBodyHTML(topic.body, esc, mentions)}</div>` : "")
    + resourceHTML(topic, common)
    + bountyHTML(topic, accepted, common)
    + (topic.tags?.length ? `<div class="community-post-tags">${topic.tags.map((tag) => tagLink(tag, esc)).join("")}</div>` : "")
    + actbar
    + (open(reporting, "topic", topic.id) ? reportFormHTML({ kind: "topic", id: topic.id }, common) : "")
    + (open(deleting, "topic", topic.id) ? deletePanelHTML({ kind: "topic", id: topic.id }, common) : "")
    + (moving && topic.canModerate ? movePanelHTML(topic, common) : "")
    + (retagging && topic.canRetag ? retagPanelHTML(topic, common) : "")
    + `<section class="community-discussion" aria-labelledby="community-replies-title"><div class="community-replies-head"><h2 id="community-replies-title" tabindex="-1">${t(`${replies.length} 条回复`, `${replies.length} replies`)}</h2>${sortSeg}</div>${repliesHTML}</section>`
    + form + `</article>`
    + `<aside class="community-post-side community-rv" style="--i:2">${authorCardHTML(author, Boolean(topic.mine), common)}${metaCardHTML(topic, common)}${relatedCard}</aside>`
    + `</div></section>`;
}

/* ---------- 发帖与编辑 ---------- */
export type CommunityUpload = { id?: string; name: string; state: "uploading" | "ready" | "error"; message?: string };
export type CommunityEditing = {
  id: string; board: string; title: string; body: string; tags: readonly string[];
  meta?: CommunityThreadMeta | null; resource?: CommunityResource | null;
};
type ComposeOptions = Common & {
  // The board chosen so far ('' before one is picked); editing keeps the post's board.
  board: string; members: boolean; me?: CommunityMe | null; uploads?: readonly CommunityUpload[];
  editing?: CommunityEditing | null;
};
const typeNames: Record<string, [string, string]> = {
  qa: ["问答帖", "Question"], showcase: ["作品帖", "Work"], tools: ["资源帖", "Resource"], moments: ["短动态", "Note"], meta: ["讨论帖", "Discussion"], vip: ["讨论帖", "Discussion"],
};
// 列表里会是这样：用正在写的内容拼一条帖子行。
export type CommunityDraft = { board: string; title: string; body: string; tags: readonly string[]; images: readonly string[]; bounty: number };
export function composePreviewHTML(draft: CommunityDraft, me: CommunityMe | null, common: Common) {
  const { t } = common;
  if (!draft.board) return `<div class="community-compose-empty">${t("先选一个版块", "Choose a board first")}</div>`;
  const moment = draft.board === "moments";
  const person: CommunityPerson = me || { name: t("你", "You"), role: "reader", uid: null };
  const now = new Date(common.now ?? Date.now()).toISOString();
  const topic: CommunityTopic = {
    id: "preview", board: draft.board, title: draft.title.trim() || (moment ? "" : t("（还没有标题）", "(no title yet)")),
    excerpt: moment ? draft.body.trim() || t("（还没有内容）", "(nothing yet)") : undefined,
    author: { ...person, uid: null }, createdAt: now, lastActivityAt: now, replies: 0, likes: 0, tags: [...draft.tags], thumbs: [...draft.images],
    bounty: draft.board === "qa" ? draft.bounty : 0, bountyState: draft.board === "qa" && draft.bounty ? "open" : null,
  };
  // Links in the preview go nowhere.
  return communityTopicsHTML([topic], common).replace(/href="[^"]*"/g, 'href="#" tabindex="-1" aria-disabled="true"');
}

export function communityComposeHTML({ board, members, me = null, uploads = [], editing = null, ...common }: ComposeOptions) {
  const { t, esc, icons = {} } = common;
  const chosen = editing?.board || board;
  const level = me ? (me.owner ? 4 : me.steward ? 4 : me.level ?? 0) : 1;
  const newcomer = me ? level < 1 : false;
  const cancel = editing ? postHref(editing.id) : board ? boardHref(board) : communityHomeHref;
  const moment = chosen === "moments";
  const boards = communityBoards.filter((item) => editing ? item.id === editing.board : members || item.id !== "vip").map((item) =>
    `<label class="community-bp" style="--board:${item.color}"><input type="radio" id="community-board-${item.id}" name="board" value="${item.id}" required${item.id === chosen ? " checked" : ""}>`
    + `<span class="community-bp-top"><i aria-hidden="true"></i><b>${t(item.zh, item.en)}</b></span><span class="community-bp-type">${t(...(typeNames[item.id] || ["讨论帖", "Discussion"]))}</span></label>`).join("");
  const fields: string[] = [];
  if (!moment) {
    const [titleMin, titleMax] = communityLimits.title;
    fields.push(`<div class="community-field"><label class="community-field-l" for="community-title">${t("标题", "Title")} <em>${t("必填", "Required")}</em></label><input id="community-title" name="title" type="text" autocomplete="off" minlength="${titleMin}" maxlength="${titleMax}" required value="${esc(editing?.title || "")}" placeholder="${chosen === "qa" ? t("一句话说清楚你的问题", "Your question in one line") : chosen === "showcase" ? t("作品名，或者一句介绍", "The work's name or a line about it") : t("一句话说清楚要讨论什么", "What is this about?")}"><small data-count-for="title">0 / ${titleMax}</small></div>`);
  }
  const placeholder = chosen === "qa" ? t("写清楚你的环境、做了什么、看到了什么报错，以及已经试过的办法。", "Your setup, what you did, the error you saw and what you have tried.")
    : moment ? t("今天试了什么、看到了什么，随手记一笔。", "What you tried or saw today, in a few lines.")
    : t("写点什么。支持 **加粗**、`代码`、[链接](https://…)、> 引用、- 列表，空一行分段。", "Write something. **Bold**, `code`, [links](https://…), > quotes and - lists work; leave a blank line between paragraphs.");
  fields.push(editorHTML({ id: "community-body", rows: moment ? 5 : 10, value: editing?.body || "", placeholder, label: `${moment ? t("内容", "Text") : t("正文", "Body")} <em${moment || chosen === "qa" || chosen === "meta" || chosen === "vip" || !chosen ? "" : ' class="is-optional"'}>${moment || chosen === "qa" || chosen === "meta" || chosen === "vip" || !chosen ? t("必填", "Required") : t("可选", "Optional")}</em>`, limits: bodyLimits(chosen) }, common));
  if (chosen === "tools") {
    const resource = editing?.resource;
    const select = (name: string, label: string, values: readonly string[], current = values[0]) =>
      `<div class="community-field"><label class="community-field-l" for="community-${name}">${label}</label><select id="community-${name}" name="${name}" class="community-select">${values.map((value) => `<option${value === current ? " selected" : ""}>${esc(value)}</option>`).join("")}</select></div>`;
    fields.push(`<div class="community-field-grid">`
      + `<div class="community-field community-span-2"><label class="community-field-l" for="community-url">${t("链接", "Link")} <em>${t("必填", "Required")}</em></label><input id="community-url" name="url" type="url" inputmode="url" autocomplete="off" maxlength="500" required value="${esc(resource?.url || "")}" placeholder="https://"></div>`
      + select("kind", t("类型", "Type"), communityResourceKinds, resource?.kind) + select("price", t("价格", "Price"), communityResourcePrices, resource?.price)
      + `<div class="community-field community-span-2"><label class="community-field-l" for="community-platform">${t("平台", "Platform")} <em class="is-optional">${t("可选", "Optional")}</em></label><input id="community-platform" name="platform" type="text" autocomplete="off" maxlength="60" value="${esc(resource?.platform || "")}" placeholder="${t("比如 Windows · macOS、网页、Chrome 扩展", "e.g. Windows · macOS, web, Chrome extension")}"></div></div>`);
  } else {
    const max = imageLimit(chosen || "qa", level);
    const images = uploads.map((upload, i) => upload.state === "ready" && upload.id
      ? `<figure class="community-upload"><img src="${imageSrc(upload.id, true)}" alt="${esc(upload.name)}"><button type="button" data-action="community-image-remove" data-index="${i}" aria-label="${t(`移除 ${esc(upload.name) || `第 ${i + 1} 张`}`, `Remove ${esc(upload.name) || `image ${i + 1}`}`)}">${icons.close || "×"}</button></figure>`
      : `<figure class="community-upload is-${upload.state}"><span>${upload.state === "uploading" ? t("上传中…", "Uploading…") : esc(upload.message || t("上传失败", "Failed"))}</span>${upload.state === "error" ? `<button type="button" data-action="community-image-remove" data-index="${i}" aria-label="${t("移除", "Remove")}">${icons.close || "×"}</button>` : ""}</figure>`).join("");
    const picker = uploads.length < max
      ? `<label class="community-upload-add">${icons["image-plus"] || ""}<span>${t("添加图片", "Add images")}</span><input type="file" class="sr-only" accept="image/jpeg,image/png,image/webp" multiple data-community-upload></label>` : "";
    fields.push(`<fieldset class="community-choices"><legend>${t("图片", "Images")} <em${chosen === "showcase" ? "" : ' class="is-optional"'}>${chosen === "showcase" ? t("至少 1 张", "At least one") : t("可选", "Optional")}</em> <span class="community-muted">${t(`最多 ${max} 张，大图会自动压缩`, `Up to ${max}; large ones are resized`)}</span></legend><div class="community-uploads">${images}${picker}</div></fieldset>`);
  }
  if (chosen === "showcase") {
    const meta = editing?.meta;
    const mode = meta?.promptMode || "public";
    const price = meta?.price || 10;
    fields.push(`<div class="community-field-grid">`
      + `<div class="community-field"><label class="community-field-l" for="community-tools">${t("工具", "Tools")} <em>${t("必填", "Required")}</em></label><input id="community-tools" name="tools" type="text" autocomplete="off" maxlength="80" required value="${esc(meta?.tools || "")}" placeholder="${t("比如 Midjourney · Photoshop", "e.g. Midjourney · Photoshop")}"></div>`
      + `<div class="community-field"><label class="community-field-l" for="community-model">${t("模型", "Model")}</label><input id="community-model" name="model" type="text" autocomplete="off" maxlength="80" value="${esc(meta?.model || "")}" placeholder="${t("比如 Midjourney v7、SDXL", "e.g. Midjourney v7, SDXL")}"></div>`
      + `<div class="community-field community-span-2"><label class="community-field-l" for="community-usage">${t("用途", "Usage")}</label><select id="community-usage" name="usage" class="community-select">${communityUsages.map((usage) => `<option${usage === (meta?.usage || communityUsages[0]) ? " selected" : ""}>${esc(usage)}</option>`).join("")}</select></div>`
      + `<div class="community-field community-span-2"><label class="community-field-l" for="community-prompt">${t("提示词", "Prompt")} <em class="is-optional">${t("可选", "Optional")}</em></label><textarea id="community-prompt" name="prompt" class="is-mono" rows="3" maxlength="4000" placeholder="${t("英文提示词、参数都可以贴在这里", "Paste the prompt and parameters here")}">${esc(meta?.prompt || "")}</textarea></div>`
      + `<fieldset class="community-field community-span-2 community-inline-choices"><legend class="community-field-l">${t("提示词给谁看", "Who sees the prompt")}</legend>${([["public", t("公开", "Everyone")], ["hidden", t("不公开", "Nobody")], ["paid", t("星尘解锁", "Unlock with stardust")]] as const).map(([id, label]) => `<label><input type="radio" name="promptMode" value="${id}"${mode === id ? " checked" : ""}><span>${label}</span></label>`).join("")}`
      + `<div class="community-price-row" data-price-row${mode === "paid" ? "" : " hidden"}><label class="sr-only" for="community-prompt-price">${t("解锁价格", "Unlock price")}</label><input type="range" id="community-prompt-price" name="promptPrice" min="${communityRules.unlockMin}" max="${communityRules.unlockMax}" step="5" value="${price}"><output for="community-prompt-price" data-price-output>${t(`${price} 星尘`, `${price} stardust`)}</output><span class="community-muted">${t("别人解锁时你得 80%", "You get 80% of each unlock")}</span></div></fieldset></div>`);
  }
  const tags = communityTags.map((tag) => `<label class="community-choice is-tag"><input type="checkbox" name="tags" value="${esc(tag)}"${editing?.tags.includes(tag) ? " checked" : ""}><span>${esc(tag)}</span></label>`).join("");
  fields.push(`<fieldset class="community-choices"><legend>${t("标签", "Tags")} <em class="is-optional">${t(`最多 ${communityRules.tagMax} 个`, `Up to ${communityRules.tagMax}`)}</em></legend><div class="community-choice-list">${tags}</div></fieldset>`);
  if (chosen === "qa" && !editing) {
    const options = [0, ...communityRules.bountyOptions];
    fields.push(`<fieldset class="community-choices"><legend>${t("悬赏", "Bounty")} <em class="is-optional">${t("可选", "Optional")}</em>${me ? ` <span class="community-muted">${t(`你有 ${me.balance} 星尘`, `You have ${me.balance} stardust`)}</span>` : ""}</legend>`
      + `<div class="community-inline-choices">${options.map((value) => `<label${newcomer && value ? ' class="is-disabled"' : ""}><input type="radio" name="bounty" value="${value}"${value === 0 ? " checked" : ""}${newcomer && value ? ` disabled aria-disabled="true" title="${t("升到巡天后可用", "Available at Survey level")}"` : ""}><span>${value ? (newcomer ? t(`${value} 星尘（升到巡天后可用）`, `${value} stardust (Available at Survey level)`) : t(`${value} 星尘`, `${value} stardust`)) : t("不悬赏", "None")}</span></label>`).join("")}</div>`
      + `<p class="community-muted">${newcomer ? t("初光等级还不能悬赏，升到巡天后可用。", "Bounties are available at Survey level.") : t(`悬赏会先从你的余额里冻结，采纳后悬赏发给被采纳的回答者，系统另奖励 TA ${communityRules.acceptReward} 星尘；${communityRules.bountyDays} 天没人采纳退回一半。`, `The bounty is set aside now and paid to the accepted answer; the system also awards them ${communityRules.acceptReward} stardust. Half comes back after ${communityRules.bountyDays} days without one.`)}</p></fieldset>`);
  }
  if (chosen === "meta" && me?.owner && !editing)
    fields.push(`<label class="community-check"><input type="checkbox" name="announce"><span>${t("作为公告发布并置顶", "Publish as a pinned announcement")}</span></label>`);
  const agree = me && !me.agreed
    ? `<label class="community-check"><input type="checkbox" name="agree" id="community-agree"><span>${t(`我已读过 <a href="${rulesHref}" target="_blank" rel="noopener">社区公约</a>，作品会标注工具和模型`, `I have read the <a href="${rulesHref}" target="_blank" rel="noopener">guidelines</a> and will name tools and models`)}</span></label>` : "";
  const tips = newcomer
    ? [`${icons.alert || ""}${t(`初光每天最多发 ${communityRules.l0TopicsDaily} 个主题`, `Up to ${communityRules.l0TopicsDaily} topics a day at First light`)}`, `${icons.alert || ""}${t(`每帖最多 ${communityRules.l0Images} 张图、${communityRules.l0Links} 个链接`, `${communityRules.l0Images} image and ${communityRules.l0Links} links per post`)}`, `${icons.clock || ""}${t(`前 ${communityRules.l0ReviewCount} 个带链接或图片的帖子要先审核`, `The first ${communityRules.l0ReviewCount} posts with links or images are reviewed first`)}`]
    : [`${icons.check || ""}${t(`发主题 +${communityRules.topicReward} 星尘，每天前 ${communityRules.topicDaily} 个`, `+${communityRules.topicReward} stardust for each of your first ${communityRules.topicDaily} topics a day`)}`];
  tips.push(`${icons.check || ""}${chosen === "showcase" ? t("作品必须写清楚用了什么工具", "Name the tools you used") : chosen === "qa" ? t("别人的回答帮到你了，记得采纳", "Accept the answer that helped") : chosen === "tools" ? t("只推荐你自己用过的", "Recommend only what you have used") : t("对事不对人", "Discuss ideas, not people")}`);
  tips.push(`${icons.check || ""}${level >= 2 ? t(`发布后 ${communityRules.editWindowDaysL2} 天内可以编辑`, `Editable for ${communityRules.editWindowDaysL2} days`) : t(`发布后 ${communityRules.editWindowHours} 小时内可以编辑`, `Editable for ${communityRules.editWindowHours} hours`)}`);
  const draft: CommunityDraft = { board: chosen, title: editing?.title || "", body: editing?.body || "", tags: editing?.tags || [], images: uploads.filter((upload) => upload.id).map((upload) => upload.id!), bounty: 0 };
  return `<section class="page community-page" data-community="${editing ? "edit" : "new"}">`
    + `<header class="community-page-head community-rv" style="--i:0"><div><nav class="community-crumb" aria-label="${t("位置", "Location")}"><a href="${communityHomeHref}">${t("社区", "Community")}</a>${icons["chevron-right"] || "›"}<span>${editing ? t("编辑帖子", "Edit post") : t("发帖", "New post")}</span></nav><h1>${editing ? t("编辑帖子", "Edit post") : t("发帖", "New post")}</h1></div></header>`
    + `<div class="community-compose-grid">`
    + `<form class="community-form community-compose community-rv" style="--i:1" data-community-form="topic"${editing ? ` data-edit="${esc(editing.id)}"` : ""} novalidate>`
    + `<fieldset class="community-choices"><legend>${t("发到哪个版块", "Board")}</legend><div class="community-board-pick">${boards}</div>${chosen === "meta" && me && !me.owner ? `<p class="community-muted">${t("站务反馈：公告只有站长能发，你发的会作为反馈建议。", "Meta: announcements come from the owner; yours is feedback.")}</p>` : ""}</fieldset>`
    + fields.join("")
    + `<div class="community-compose-foot">${agree}<p class="community-rules">${t("请不要留手机号、微信号等联系方式；广告和引流会被删除。", "Do not post phone numbers or other contact details; ads are removed.")} <span class="community-shortcut">${t("Ctrl+Enter 发布", "Ctrl+Enter publishes")}</span></p>`
    + `<p class="community-form-status" role="status" aria-live="polite"></p>`
    + `<div class="community-form-actions"><a class="community-button" href="${cancel}">${t("取消", "Cancel")}</a><button type="submit" class="community-button is-gold">${icons.send || ""}${editing ? t("保存修改", "Save") : t("发布", "Publish")}</button></div></div></form>`
    + `<aside class="community-compose-side community-rv" style="--i:2">`
    + `<section class="community-card">${cardHead(t("在列表里会是这样", "In the list it looks like this"))}<div class="community-preview-box" data-compose-preview>${composePreviewHTML(draft, me, common)}</div></section>`
    + `<section class="community-card">${cardHead(t("发帖须知", "Before posting"), "", me ? levelChipHTML(me, common) : "")}<ul class="community-ticks">${tips.map((tip) => `<li>${tip}</li>`).join("")}</ul></section>`
    + `</aside></div></section>`;
}

// The thread's state for the edit form.
export function editingFrom(thread: CommunityLoad<CommunityThread> | null | undefined): CommunityEditing | null {
  const data = readyData(thread);
  if (!data) return null;
  const { topic } = data;
  return {
    id: topic.id, board: topic.board, title: topic.board === "moments" ? "" : topic.title, body: topic.body, tags: topic.tags || [],
    meta: topic.meta || null, resource: topic.resource || null,
  };
}
