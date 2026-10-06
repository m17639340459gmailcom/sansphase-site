import { communityBoard, postHref } from './community.mjs';
import type { Common, CommunityLoad } from './community.ts';
import type { CommunityBannerConfig } from './community-banners.ts';

const imageId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const safeTopicId = (id: string) => Boolean(id && !/[/\\?#\s\u0000-\u001f]/.test(id));

/** The frame receives only the current scope's authorized, resolved configuration. */
export function communityFrameBannersHTML(load: CommunityLoad<CommunityBannerConfig> | null | undefined, common: Common, scope = 'home'): string {
  const { esc } = common;
  const validScope = scope === 'home' || Boolean(communityBoard(scope));
  const state = !validScope ? 'error' : load?.state === 'ready' && load.data.scope !== scope ? 'loading' : load?.state || 'loading';
  const items = state === 'ready' && load?.state === 'ready' ? load.data.items : [];
  const rows = items.map(item => {
    if (item.kind === 'image') {
      if (!item.image || !imageId.test(item.image) || (scope === 'home' ? item.board !== '' : item.board !== scope)) return '';
      return `<div data-frame-banner-item data-frame-banner-kind="image" data-frame-banner-board="${esc(item.board)}" data-frame-banner-image="${esc(item.image)}"><span data-frame-banner-title>${esc(item.title.trim())}</span></div>`;
    }
    if (!safeTopicId(item.topicId) || !communityBoard(item.board) || (scope !== 'home' && item.board !== scope)) return '';
    const title = item.title.trim() || item.topicTitle.trim();
    if (!title) return '';
    const image = item.image && imageId.test(item.image) ? item.image : '';
    return `<a data-frame-banner-item href="${esc(postHref(item.topicId))}" data-frame-banner-board="${esc(item.board)}" data-frame-banner-image="${esc(image)}"><span data-frame-banner-title>${esc(title)}</span></a>`;
  }).join('');
  return `<div data-frame-banners-state="${state}" data-frame-banners-scope="${esc(scope)}">${rows}</div>`;
}
