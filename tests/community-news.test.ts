import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { communityNewsBoard, communityNewsHTML } from '../src/community-news.ts';
import type { Common, CommunityBoard, CommunityListing, CommunityLoad, CommunityTopic } from '../src/community.ts';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string) => { window: Window & { close(): void } };
};
const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const common: Common = { t: zh => zh, esc: value => String(value ?? '').replace(/[&<>"']/g, character => entities[character]) };
const board = (id = 'world-agent-updates', zh = 'AI资讯'): CommunityBoard => ({
  id, zh, en: 'AI News', description: 'AI 全球资讯与 Agent 动态。', descriptionEn: 'AI and agent news.',
  color: '#9fb8e0', lightColor: '#41658f', icon: 'bot', kind: '讨论帖', kindEn: 'Discussion', tips: [], tipsEn: [],
});
const news = board();
const topic = (id: string, extra: Partial<CommunityTopic> = {}): CommunityTopic => ({
  id, board: news.id, title: `真实资讯 ${id}`, author: { name: '资讯作者', uid: '10001', role: 'reader' },
  createdAt: '2026-10-09T04:20:30Z', lastActivityAt: '2026-10-09T05:30:00Z', likes: 1, replies: 2, ...extra,
});
const listing = (items: CommunityTopic[]): CommunityLoad<CommunityListing> => ({ state: 'ready', data: { items, total: items.length, page: 1, pageSize: 6 } });
function documentFor(html: string) {
  const dom = new JSDOM(html);
  return { document: dom.window.document, close: () => dom.window.close() };
}

test('news board lookup matches only the exact normalized Chinese name, independent of slug and AI letter case', () => {
  const actual = board('daily-world-agent', '  aI \t资　讯\n');
  assert.equal(communityNewsBoard([board('ai-news', '工具资源'), actual]), actual);
  for (const candidate of [board('ai-news', '工具资源'), board('news', '资讯'), board('world-agent-updates', 'AI资讯推荐'), board('ai', '全球AI资讯'), board('agent', 'AI News')])
    assert.equal(communityNewsBoard([candidate]), null, candidate.zh);
  assert.equal(communityNewsBoard([]), null);
});

test('two configured boards with the same normalized AI news name are ambiguous and never select the first match', () => {
  const first = board('ai-news', 'AI资讯'), second = board('daily-ai', 'AI 资讯');
  assert.equal(communityNewsBoard([first, second]), null);
  assert.equal(communityNewsBoard([second, first]), null, 'catalog order cannot choose an ambiguous source');
});

test('a cold catalog keeps the unconfirmed news source in a loading state instead of claiming it is unconfigured', () => {
  const x = documentFor(communityNewsHTML({ ...common, board: null, catalogPending: true, list: listing([topic('not-yet-confirmed')]) }));
  try {
    const state = x.document.querySelector('.community-news-state'); assert.ok(state);
    assert.equal(state.getAttribute('data-news-state'), 'loading');
    assert.equal(state.getAttribute('role'), 'status'); assert.equal(state.getAttribute('aria-busy'), 'true');
    assert.equal(state.textContent, '正在读取资讯…');
    assert.doesNotMatch(x.document.body.textContent || '', /确认唯一|尚未创建|暂不可用/);
    assert.equal(x.document.querySelector('.community-news-row, .community-news-more'), null);
  } finally { x.close(); }
});

test('ready news uses at most six compact rows with real board links and keeps authoritative DTO order unchanged', () => {
  const items = Array.from({ length: 8 }, (_, index) => topic(`p${index + 1}`, {
    createdAt: index === 0 ? '2026-10-01T00:00:00Z' : '2026-10-09T00:00:00Z',
    excerpt: '不展示正文摘要', thumbs: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
  }));
  const original = items.map(item => item.id), x = documentFor(communityNewsHTML({ ...common, board: news, list: listing(items) }));
  try {
    const section = x.document.querySelector('.community-news'); assert.ok(section);
    assert.equal(section.querySelector('header h2')?.textContent, '最新资讯');
    assert.equal(section.querySelector('.community-news-sub')?.textContent, 'AI资讯 · 北京时间');
    assert.equal(section.querySelector('.community-news-more')?.getAttribute('href'), '#/community/boards/world-agent-updates');
    const rows = [...section.querySelectorAll<HTMLElement>('ol.community-news-list > li.community-news-row')];
    assert.equal(rows.length, 6);
    assert.deepEqual(rows.map(row => row.dataset.topicId), original.slice(0, 6));
    assert.deepEqual(rows.map(row => row.querySelector('.community-news-rank')?.textContent), ['01', '02', '03', '04', '05', '06']);
    assert.deepEqual(rows.map(row => row.querySelector('.community-news-title')?.getAttribute('href')), original.slice(0, 6).map(id => `#/post/${id}`));
    assert.equal(section.querySelector('.community-topic, .community-topic-thumbs, .community-topic-excerpt'), null);
    assert.equal(section.querySelector('img[src*="aaaaaaaa-aaaa"]'), null);
    assert.doesNotMatch(section.textContent || '', /不展示正文摘要/);
    assert.deepEqual(items.map(item => item.id), original, 'the template neither sorts nor mutates server results');
  } finally { x.close(); }
});

test('news refuses unrelated-board rows instead of filling missing AI news with other community posts', () => {
  const x = documentFor(communityNewsHTML({ ...common, board: news, list: listing([topic('foreign', { board: 'tools', title: '不可代入的工具帖子' }), topic('actual')]) }));
  try {
    assert.deepEqual([...x.document.querySelectorAll<HTMLElement>('.community-news-row')].map(row => row.dataset.topicId), ['actual']);
    assert.doesNotMatch(x.document.body.textContent || '', /不可代入的工具帖子/);
    assert.equal(x.document.querySelector('.community-news-rank')?.textContent, '01');
  } finally { x.close(); }
});

test('news reuses existing small avatar and nickname effects, with escaped titles, names and link attributes', () => {
  const title = '<img src=x onerror="alert(1)"> & "资讯"', id = 'p"/<>', name = '<script>昵称</script>';
  const item = topic(id, { title, glow: true, author: { name, uid: '10001', role: 'reader', avatar: '/approved-portrait.webp', frame: 'gold', nameEffect: { style: 'gradient', colors: ['#8AA9D8', '#E7A9C6'] } } });
  const x = documentFor(communityNewsHTML({ ...common, board: news, list: listing([item]) }));
  try {
    const row = x.document.querySelector<HTMLElement>('.community-news-row'); assert.ok(row);
    assert.equal(row.dataset.topicId, id);
    assert.ok(row.classList.contains('is-glow'));
    const link = row.querySelector('.community-news-title'); assert.ok(link);
    assert.equal(link.textContent, title); assert.equal(link.getAttribute('title'), title);
    assert.equal(link.getAttribute('href'), `#/post/${encodeURIComponent(id)}`);
    const author = row.querySelector('.community-news-author'); assert.ok(author);
    assert.equal(author.getAttribute('href'), '#/community/u/10001');
    assert.ok(author.querySelector('.community-av-xs.is-frame-gold img[src="/approved-portrait.webp"]'));
    assert.equal(author.querySelector('.community-uname[data-name-effect="gradient"]')?.textContent, name);
    assert.equal(x.document.querySelector('script, [onerror], img[src="x"]'), null);
  } finally { x.close(); }
});

test('news timestamps show Beijing year/month/day and minutes with midnight and year rollover, preserving original datetime', () => {
  const values = [
    ['2026-12-31T16:05:09.000Z', '2027/01/01 00:05'],
    ['2026-10-08T16:40:59-07:00', '2026/10/09 07:40'],
    ['2026-10-08T09:15:00+08:00', '2026/10/08 09:15'],
  ];
  const x = documentFor(communityNewsHTML({ ...common, board: news, list: listing(values.map(([createdAt], index) => topic(String(index), { createdAt }))) }));
  try {
    const times = [...x.document.querySelectorAll('time.community-news-time')]; assert.equal(times.length, values.length);
    assert.deepEqual(times.map(time => time.textContent), values.map(([, expected]) => expected));
    assert.deepEqual(times.map(time => time.getAttribute('datetime')), values.map(([original]) => original));
  } finally { x.close(); }
});

test('invalid or ambiguous news timestamps remain explicitly unknown rather than fabricated dates', () => {
  const invalid = ['not-a-date', '', '2026-02-30T12:00:00Z', '2026-10-09T24:00:00Z', '2026-10-09T12:00:00', '0'];
  const x = documentFor(communityNewsHTML({ ...common, board: news, list: listing(invalid.map((createdAt, index) => topic(String(index), { createdAt }))) }));
  try {
    const times = [...x.document.querySelectorAll('time.community-news-time')];
    assert.deepEqual(times.map(time => time.textContent), invalid.map(() => '未知时间'));
    assert.deepEqual(times.map(time => time.getAttribute('datetime')), invalid);
  } finally { x.close(); }
});

test('uncreated board, pending reads, failures and genuine empty results have distinct honest states without fabricated news', () => {
  const cases: Array<{ board: CommunityBoard | null; list: CommunityLoad<CommunityListing>; state: string; text: RegExp }> = [
    { board: null, list: listing([topic('not-available')]), state: 'unconfigured', text: /请在板块目录确认唯一的 AI资讯板块/ },
    { board: news, list: { state: 'loading' }, state: 'loading', text: /正在读取资讯/ },
    { board: news, list: { state: 'error', status: 503, message: '<img src=x onerror=alert(1)>' }, state: 'error', text: /资讯暂时无法读取/ },
    { board: news, list: listing([]), state: 'empty', text: /还没有发布资讯/ },
    { board: news, list: listing([topic('wrong', { board: 'tools' })]), state: 'empty', text: /还没有发布资讯/ },
    { board: board('tools', '工具资源'), list: listing([topic('wrong', { board: 'tools' })]), state: 'unconfigured', text: /请在板块目录确认唯一的 AI资讯板块/ },
  ];
  for (const fixture of cases) {
    const x = documentFor(communityNewsHTML({ ...common, ...fixture }));
    try {
      const state = x.document.querySelector('.community-news-state'); assert.ok(state, fixture.state);
      assert.equal(state.getAttribute('data-news-state'), fixture.state);
      assert.match(state.textContent || '', fixture.text);
      assert.equal(x.document.querySelector('.community-news-row'), null);
      assert.equal(x.document.querySelector('img[src="x"], [onerror]'), null);
      if (fixture.state === 'loading') { assert.equal(state.getAttribute('role'), 'status'); assert.equal(state.getAttribute('aria-busy'), 'true'); }
      if (fixture.state === 'unconfigured') assert.equal(x.document.querySelector('.community-news-more'), null);
    } finally { x.close(); }
  }
});

test('news labels and unknown time translate while dates retain the agreed numeric Beijing format', () => {
  const x = documentFor(communityNewsHTML({ ...common, t: (_zh, en) => en, board: news, list: listing([topic('unknown', { createdAt: 'invalid' }), topic('valid')]) }));
  try {
    assert.equal(x.document.querySelector('header h2')?.textContent, 'Latest news');
    assert.equal(x.document.querySelector('.community-news-sub')?.textContent, 'AI News · Beijing time');
    assert.deepEqual([...x.document.querySelectorAll('time')].map(time => time.textContent), ['Unknown time', '2026/10/09 12:20']);
  } finally { x.close(); }
});
