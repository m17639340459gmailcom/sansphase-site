import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communitySorts, isCommunitySort, sortTopics, communityHomeHTML, communityBoardHTML, communityTagHTML } from '../src/community.ts';
import type { Common, CommunityTopic, CommunityLoad, CommunityListing, CommunitySummary } from '../src/community.ts';

const now = Date.parse('2026-10-09T04:00:00Z');
const esc = (value: unknown = '') => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const common: Common = { t: (zh) => zh, esc, now, icons: { like: '<i-like></i-like>', reply: '<i-reply></i-reply>' } };
const topic = (id: string, extra: Partial<CommunityTopic> = {}): CommunityTopic => ({ id, board: 'qa', title: `讨论 ${id}`, author: { name: '作者', uid: '10001', role: 'reader' }, createdAt: '2026-10-08T01:00:00Z', lastActivityAt: '2026-10-08T01:00:00Z', likes: 0, replies: 0, ...extra });
const summary: CommunityLoad<CommunitySummary> = { state: 'ready', data: { total: 0, repliesToday: 0, checkinsToday: 0, boards: {}, tags: {}, hot: [] } };
const listing = (items: CommunityTopic[], total = items.length): CommunityLoad<CommunityListing> => ({ state: 'ready', data: { items, total, page: 1, pageSize: 6 } });

test('one curated entry precedes newest, latest replies and following, while legacy API sorts stay valid', () => {
  assert.deepEqual(communitySorts.map(([sort, zh]) => [sort, zh]), [['curated', '精选'], ['newest', '最新发布'], ['active', '最新回复'], ['following', '关注']]);
  for (const sort of ['curated', 'newest', 'active', 'following', 'hot', 'featured']) assert.equal(isCommunitySort(sort), true, sort);
  for (const sort of ['random', '', null, undefined, ['curated']]) assert.equal(isCommunitySort(sort), false);
});

test('curated orders all featured topics first, then existing heat, without merging or duplicating arrays', () => {
  const items = [topic('cold'), topic('very-hot', { replies: 99, likes: 10 }), topic('older-featured', { featured: true, createdAt: '2026-01-01T00:00:00Z' }), topic('fresh-featured', { featured: true, lastActivityAt: '2026-10-09T01:00:00Z' }), topic('liked', { likes: 5 })];
  const inputIds = items.map(item => item.id);
  assert.deepEqual(sortTopics(items, 'curated', now).map(item => item.id), ['fresh-featured', 'older-featured', 'very-hot', 'liked', 'cold']);
  assert.deepEqual(items.map(item => item.id), inputIds);
  assert.equal(new Set(sortTopics(items, 'curated', now).map(item => item.id)).size, items.length);
  assert.deepEqual(sortTopics(items, 'featured', now).map(item => item.id), ['fresh-featured', 'older-featured']);
  assert.equal(sortTopics(items, 'hot', now)[0].id, 'very-hot');
});

test('empty featured sets still yield genuine hot discussions in curated, and an empty community stays empty', () => {
  assert.deepEqual(sortTopics([topic('cold'), topic('hot', { replies: 5 })], 'curated', now).map(item => item.id), ['hot', 'cold']);
  assert.deepEqual(sortTopics([], 'curated', now), []);
});

test('curated is a six-row ordered board with safe titles and real metadata instead of full feed images or excerpts', () => {
  const items = Array.from({ length: 6 }, (_, index) => topic(String(index), { featured: index === 0, title: index === 0 ? '<img src=x onerror=alert(1)>' : `完整标题 ${index}`, likes: index + 1, replies: index + 2, thumbs: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], excerpt: '正文与封面不应挤入精选榜单' }));
  const dom = new JSDOM(communityHomeHTML({ ...common, summary, list: listing(items, 10), sort: 'curated', members: false }));
  try {
    const board = dom.window.document.querySelector('.community-curated');
    assert.ok(board);
    assert.equal(board.querySelectorAll('ol.community-curated-list > li').length, 6);
    assert.deepEqual([...board.querySelectorAll('.community-curated-rank')].map(row => row.textContent), ['01', '02', '03', '04', '05', '06']);
    assert.equal(board.querySelector('.community-curated-title')!.textContent, items[0].title);
    assert.equal(board.querySelector('.community-curated-title')!.getAttribute('title'), items[0].title);
    assert.equal(board.querySelector('.community-curated-title')!.getAttribute('href'), '#/post/0');
    assert.equal(board.querySelector('img[src="x"], [onerror], .community-topic-thumbs, .community-topic-excerpt'), null);
    assert.doesNotMatch(board.textContent!, /正文与封面/);
    assert.equal(board.querySelectorAll('.community-curated-author').length, 6);
    assert.equal(board.querySelectorAll('.community-curated-counts').length, 6);
    assert.match(board.querySelector('.community-curated-counts')!.textContent!, /1.*2/);
    assert.equal(board.querySelectorAll('.community-curated-featured').length, 1);
    assert.equal(dom.window.document.querySelector('[data-action="community-more"]')!.textContent, '查看更多');
  } finally { dom.window.close(); }
});

test('curated board and tag pages retain ordinary post images and excerpts while the home ranking stays compact', () => {
  const items = [topic('one', { thumbs: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], excerpt: '普通列表摘要' })];
  for (const html of [communityBoardHTML({ ...common, board: 'qa', summary, list: listing(items), sort: 'curated', members: false, showTopicCovers: true }), communityTagHTML({ ...common, tag: '新手', list: listing(items), sort: 'curated', showTopicCovers: true })]) {
    const dom = new JSDOM(html);
    try {
      assert.equal(dom.window.document.querySelector('.community-curated'), null);
      assert.equal(dom.window.document.querySelectorAll('.community-topic').length, 1);
      assert.equal(dom.window.document.querySelector('.community-topic-thumbs img')?.getAttribute('src'), '/api/community/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp');
      assert.equal(dom.window.document.querySelector('.community-topic-thumbs')?.getAttribute('href'), '#/post/one');
      assert.match(dom.window.document.querySelector('.community-topic-excerpt')!.textContent!, /普通列表摘要/);
      assert.equal(dom.window.document.querySelector('[data-sort="curated"]')?.getAttribute('aria-pressed'), 'true');
    }
    finally { dom.window.close(); }
  }
  const dom = new JSDOM(communityHomeHTML({ ...common, summary, list: listing(items), sort: 'newest', members: false, showTopicCovers: true }));
  try { assert.equal(dom.window.document.querySelector('.community-curated'), null); assert.ok(dom.window.document.querySelector('.community-topic-thumbs')); assert.match(dom.window.document.querySelector('.community-topic-excerpt')!.textContent!, /普通列表摘要/); }
  finally { dom.window.close(); }
});

test('curated never substitutes demo rows for loading, failures or a real empty result and translates labels', () => {
  for (const list of [{ state: 'loading' }, { state: 'error', status: 503, message: '暂不可用' }, listing([])] as CommunityLoad<CommunityListing>[]) {
    const dom = new JSDOM(communityHomeHTML({ ...common, summary, list, sort: 'curated', members: false }));
    try { assert.equal(dom.window.document.querySelector('.community-curated-row'), null); }
    finally { dom.window.close(); }
  }
  const dom = new JSDOM(communityHomeHTML({ ...common, t: (_zh, en) => en, summary, list: listing([topic('one', { featured: true })]), sort: 'curated', members: false }));
  try { assert.equal(dom.window.document.querySelector('.community-sort-tabs button')!.textContent, 'Curated'); assert.match(dom.window.document.querySelector('.community-curated')!.textContent!, /Featured/); }
  finally { dom.window.close(); }
});
