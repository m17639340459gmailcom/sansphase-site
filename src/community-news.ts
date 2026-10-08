import { avatarHTML, boardHref, memberHref, nameLabelHTML, postHref } from './community.mjs';
import type { Common, CommunityBoard, CommunityListing, CommunityLoad } from './community.ts';

const normalizedName = (name: string) => name.replace(/\s+/gu, '').toLowerCase();

/** Resolve the actual configured board by its name, never by an assumed slug. */
export function communityNewsBoard(boards: readonly CommunityBoard[]): CommunityBoard | null {
  const matches = boards.filter(board => normalizedName(board.zh) === 'ai资讯');
  return matches.length === 1 ? matches[0] : null;
}

const beijing = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function publishedTime(value: string, { t }: Common): string {
  // A timestamp without its zone is ambiguous. Reject normalized invalid dates
  // such as February 30 instead of allowing Date to turn them into a later day.
  const fields = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value);
  const unknown = () => t('未知时间', 'Unknown time');
  if (!fields || Number(fields[1]) < 1 || Number(fields[4]) > 23 || Number(fields[5]) > 59 || Number(fields[6] || 0) > 59) return unknown();
  const timestamp = Date.parse(value), day = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)) return unknown();
  const parts = Object.fromEntries(beijing.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${parts.year.padStart(4, '0')}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

/** Display the server's newest-first DTO without reordering or fetching it. */
export function communityNewsHTML({ board, list, catalogPending = false, ...common }: Common & { board: CommunityBoard | null; list: CommunityLoad<CommunityListing>; catalogPending?: boolean }): string {
  const { t, esc } = common;
  const actual = communityNewsBoard(board ? [board] : []);
  const heading = `<header class="community-news-head"><div><h2>${esc(t('最新资讯', 'Latest news'))}</h2><p class="community-news-sub">${esc(t('AI资讯 · 北京时间', 'AI News · Beijing time'))}</p></div>`
    + (actual ? `<a class="community-news-more" href="${esc(boardHref(actual.id))}">${esc(t('全部资讯', 'All news'))}</a>` : '') + '</header>';
  const state = (kind: string, message: string) => `<p class="community-news-state" data-news-state="${kind}"${kind === 'loading' ? ' role="status" aria-busy="true"' : ''}>${message}</p>`;
  let content: string;
  if (!actual && catalogPending) content = state('loading', esc(t('正在读取资讯…', 'Loading news…')));
  else if (!actual) content = state('unconfigured', esc(t('AI资讯榜暂不可用，请在板块目录确认唯一的 AI资讯板块。', 'The news list is unavailable. Confirm a single AI News board in the board directory.')));
  else if (list.state === 'loading') content = state('loading', esc(t('正在读取资讯…', 'Loading news…')));
  else if (list.state === 'error') content = state('error', esc(t('资讯暂时无法读取。', 'News could not be loaded.')) + (list.message ? ` ${esc(list.message)}` : ''));
  else {
    // A mismatched DTO must not silently substitute another board's content.
    const items = list.data.items.filter(topic => topic.board === actual.id).slice(0, 6);
    content = items.length ? `<ol class="community-news-list">${items.map((topic, index) => {
      const label = avatarHTML(topic.author, common, 'xs', false) + nameLabelHTML(topic.author, common, false);
      const author = topic.author.uid ? `<a class="community-news-author" href="${esc(memberHref(topic.author.uid))}">${label}</a>` : `<span class="community-news-author">${label}</span>`;
      return `<li class="community-news-row${topic.glow ? ' is-glow' : ''}" data-topic-id="${esc(topic.id)}"><span class="community-news-rank${index < 3 ? ' is-top' : ''}" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>`
        + `<div class="community-news-main"><a class="community-news-title" href="${esc(postHref(topic.id))}" title="${esc(topic.title)}">${esc(topic.title)}</a>`
        + `<div class="community-news-meta">${author}<time class="community-news-time" datetime="${esc(topic.createdAt)}">${esc(publishedTime(topic.createdAt, common))}</time></div></div></li>`;
    }).join('')}</ol>` : state('empty', esc(t('还没有发布资讯。', 'No news has been published yet.')));
  }
  return `<section class="community-news">${heading}${content}</section>`;
}
