import { boardName, postHref } from './community.mjs';
import type { Common, CommunityListing, CommunityLoad, CommunityTopic } from './community.ts';
import type { CommunityBannerConfig, CommunityBannerItem } from './community-banners.ts';

export type CommunityBannerEditorState = {
  configs: CommunityBannerConfig[];
  scope: string;
  draft: CommunityBannerConfig | null;
  candidates: CommunityLoad<CommunityListing>;
  query: string;
  busy: boolean;
  message?: string;
  owner?: boolean;
  conflicted?: boolean;
};

const imageHref = (id: string | null | undefined): string | null => id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ? `/api/community/images/${encodeURIComponent(id)}.webp` : null;
const sameItems = (left: CommunityBannerItem[], right: CommunityBannerItem[]) => left.length === right.length
  && left.every((item, index) => (item.kind || 'post') === (right[index]?.kind || 'post') && item.topicId === right[index]?.topicId && item.title === right[index]?.title && item.cover === right[index]?.cover);

function editItemHTML(item: CommunityBannerItem, index: number, length: number, owner: boolean, busy: boolean, common: Common): string {
  const { t, esc, icons = {} } = common;
  const image = imageHref(item.cover || item.image);
  const title = item.title || item.topicTitle;
  const standalone = item.kind === 'image';
  const disabled = busy ? ' disabled' : '';
  const action = (name: string, label: string, glyph: string, unavailable = false) => `<button type="button" class="community-button is-small" data-action="community-banner-${name}" data-index="${index}"${busy || unavailable ? ' disabled' : ''}>${icons[glyph] || ''}<span>${label}</span></button>`;
  const preview = standalone
    ? `<div class="community-banner-preview is-image" aria-label="${esc(title || t('图片横幅预览', 'Image banner preview'))}">${image ? `<img data-banner-preview-image src="${esc(image)}" alt="">` : `<div><strong>${t('请上传横幅图片', 'Upload a banner image')}</strong></div>`}</div>`
    : `<a class="community-banner-preview" href="${esc(postHref(item.topicId))}" aria-label="${esc(t(`查看帖子：${item.topicTitle}`, `View post: ${item.topicTitle}`))}">${image ? `<img data-banner-preview-image src="${esc(image)}" alt="">` : ''}<div><span>${esc(boardName(item.board, t))}</span><strong data-banner-preview-title>${esc(title)}</strong></div></a>`;
  return `<article class="community-banner-edit-item" data-banner-item="${index}">`
    + `<div class="community-banner-item-head"><strong>${t(`横幅 ${index + 1}`, `Banner ${index + 1}`)}</strong><div class="community-action-group">${action('up', t('上移', 'Move up'), 'chevron-up', index === 0)}${action('down', t('下移', 'Move down'), 'chevron-down', index === length - 1)}${action('remove', t('移除', 'Remove'), 'trash')}</div></div>`
    + `<div class="community-banner-item-grid"><div class="community-banner-preview-column">${preview}<span class="community-banner-preview-caption">${standalone ? t('等比例展示完整图片 · 建议比例 2.3:1', 'Full image, original proportions · Suggested ratio 2.3:1') : t('展示预览 · 点击进入原帖', 'Preview · Opens the original post')}</span></div>`
    + `<div class="community-banner-item-fields"><div class="community-field"><label class="community-field-l" for="community-banner-title-${index}">${standalone ? t('图片说明', 'Image description') : t('展示标题', 'Display title')}<em class="is-optional">${t('可选', 'Optional')}</em></label><input id="community-banner-title-${index}" name="banner-title-${index}" type="text" maxlength="80" value="${esc(item.title)}" placeholder="${esc(item.topicTitle)}"${disabled}><small>${standalone ? t('供识别图片内容，不叠加在图片上', 'Describes the image without adding an overlay') : t('留空使用帖子原标题', 'Leave blank to use the original title')}</small></div>`
    + `<div class="community-banner-drop" data-banner-drop="true" data-index="${index}"><span class="community-drop-title">${icons.image || ''}${t('拖拽图片到这里替换封面', 'Drop an image to replace the cover')}</span><span class="community-banner-upload-note">${t(`JPG / PNG / WebP · ${owner ? 25 : 2} MB 以内`, `JPG / PNG / WebP · Up to ${owner ? 25 : 2} MB`)}</span><div class="community-banner-cover-actions"><label for="community-banner-file-${index}" class="community-button is-small${busy ? ' is-disabled' : ''}">${standalone ? t('选择图片', 'Choose image') : t('选择封面', 'Choose cover')}</label><input id="community-banner-file-${index}" class="community-banner-file-input" type="file" accept="image/jpeg,image/png,image/webp" data-banner-file data-index="${index}"${disabled}>${item.cover ? action('cover-remove', standalone ? t('移除图片', 'Remove image') : t('恢复帖子封面', 'Use post cover'), 'close') : standalone ? '' : `<span class="community-banner-default-cover">${t('使用帖子首图，无图则用默认背景', 'Uses the first post image, or the default background')}</span>`}</div></div></div></div>`
    + (standalone ? '' : `<p class="community-banner-source">${t('原帖', 'Original post')}：<a href="${esc(postHref(item.topicId))}">${esc(item.topicTitle)}</a></p>`) + `</article>`;
}

function candidateHTML(topic: CommunityTopic, selected: Set<string>, full: boolean, busy: boolean, common: Common): string {
  const { t, esc, icons = {} } = common;
  const chosen = selected.has(topic.id);
  const image = imageHref(topic.thumbs?.[0]);
  return `<li class="community-banner-candidate">${image ? `<img src="${esc(image)}" alt="" loading="lazy">` : ''}<div><a href="${esc(postHref(topic.id))}">${esc(topic.title || topic.excerpt || t('短动态', 'Note'))}</a><span>${esc(boardName(topic.board, t))} · ${esc(topic.author.name)}</span></div><button type="button" class="community-button is-small" data-action="community-banner-add" data-id="${esc(topic.id)}" aria-pressed="${chosen}"${busy || chosen || full ? ' disabled' : ''}>${chosen ? '' : icons.plus || ''}<span>${chosen ? t('已选择', 'Selected') : full ? t('已满', 'Full') : t('添加', 'Add')}</span></button></li>`;
}

export function communityBannerEditorHTML(options: CommunityBannerEditorState & Common): string {
  const { configs, scope, draft, candidates, query, busy, conflicted = false, message = '', owner = configs.some(config => config.scope === 'home'), t, esc, icons = {} } = options;
  if (!draft) return `<div class="community-banner-editor-state" role="status">${esc(message || t('正在读取横幅设置…', 'Loading banner settings…'))}</div>`;
  const current = configs.find(config => config.scope === scope);
  const dirty = !current || !sameItems(draft.items, current.items);
  const selected = new Set(draft.items.filter(item => item.kind !== 'image').map(item => item.topicId));
  let candidateBody = '';
  if (candidates.state === 'loading') candidateBody = `<p class="community-banner-candidate-status" role="status">${t('正在读取可选帖子…', 'Loading available posts…')}</p>`;
  else if (candidates.state === 'error') candidateBody = `<p class="community-banner-candidate-status is-error" role="status">${esc(candidates.message || t('暂时无法查询帖子，请重新搜索。', 'Could not load posts. Try searching again.'))}</p>`;
  else if (!candidates.data.items.length) candidateBody = `<p class="community-banner-candidate-status">${t('没有找到可选帖子，换个关键词试试。', 'No available posts found. Try another keyword.')}</p>`;
  else candidateBody = `<ul class="community-banner-candidate-list">${candidates.data.items.map(topic => candidateHTML(topic, selected, draft.items.length >= 5, busy, options)).join('')}</ul>${candidates.data.total > candidates.data.items.length ? `<p class="community-banner-upload-note">${t('先显示部分帖子，输入标题可以精确查找。', 'Showing a selection of posts. Search by title to find a specific one.')}</p>` : ''}`;
  return `<section class="community-banner-editor"><div class="community-editor-heading"><h2>${t('顶部横幅', 'Top banners')}</h2><p class="community-muted">${t('添加图片或选择帖子，设置顺序。每处最多 5 张，每 5 秒自动切换。', 'Add images or select posts and set their order. Up to 5 banners per location, rotating every 5 seconds.')}</p></div>`
    + `<div class="community-banner-scopes" role="group" aria-label="${t('选择展示位置', 'Choose location')}">${configs.map(config => `<button type="button" class="community-button is-small" data-action="community-banner-scope" data-scope="${esc(config.scope)}" aria-pressed="${config.scope === scope}"${busy ? ' disabled' : ''}>${config.scope === 'home' ? icons.star || '' : ''}<span>${esc(config.scope === 'home' ? t('社区首页', 'Community home') : boardName(config.scope, t))}</span></button>`).join('')}</div>`
    + `<div class="community-banner-editor-grid"><form class="community-banner-edit-form" data-community-form="banners"><div class="community-banner-list-heading"><h3>${t('当前展示', 'Displayed banners')}</h3><div class="community-action-group"><span>${draft.items.length} / 5</span><button type="button" class="community-button is-small" data-action="community-banner-add-image"${busy || draft.items.length >= 5 ? ' disabled' : ''}>${icons.plus || ''}<span>${t('添加图片横幅', 'Add image banner')}</span></button></div></div><div class="community-banner-edit-list">${draft.items.length ? draft.items.map((item, index) => editItemHTML(item, index, draft.items.length, owner, busy, options)).join('') : `<div class="community-banner-draft-empty"><span>${icons.image || ''}</span><strong>${t('还没有展示横幅', 'No banners selected')}</strong><p>${t('添加图片或选择帖子；留空保存后，此位置不显示横幅。', 'Add an image or choose a post. Saving an empty list hides banners at this location.')}</p></div>`}</div>`
    + `<div class="community-banner-save-bar"><p class="community-form-status" role="status" aria-live="polite">${esc(message || (busy ? t('正在处理，请稍候…', 'Processing…') : dirty ? t('有未保存的修改', 'Unsaved changes') : t('当前设置已保存', 'Current settings are saved')))}</p><div class="community-action-group"><button type="button" class="community-button" data-action="community-banner-cancel"${busy ? ' disabled' : ''}>${conflicted ? t('取消并读取最新', 'Discard and reload') : t('取消修改', 'Discard changes')}</button><button type="submit" class="community-button is-gold"${busy || conflicted ? ' disabled' : ''}>${t('保存横幅', 'Save banners')}</button></div></div></form>`
    + `<aside class="community-banner-candidates" aria-busy="${candidates.state === 'loading'}"><div class="community-banner-list-heading"><h3>${t('可选帖子', 'Available posts')}</h3></div><form class="community-banner-search" data-community-form="banner-search"><div class="community-field"><label class="sr-only" for="community-banner-query">${t('搜索帖子标题', 'Search post titles')}</label><input id="community-banner-query" type="search" name="query" maxlength="100" value="${esc(query)}" placeholder="${t('搜索帖子标题', 'Search post titles')}"${busy ? ' disabled' : ''}></div><button type="submit" class="community-button is-small"${busy ? ' disabled' : ''}>${icons.search || ''}<span>${t('搜索', 'Search')}</span></button></form><p class="community-banner-candidate-hint">${scope === 'home' ? t('可以选择所有公开板块的帖子。', 'Choose posts from public boards.') : t('这里只显示本板块可展示的帖子。', 'Only displayable posts from this board are listed.')}</p>${candidateBody}</aside></div></section>`;
}
