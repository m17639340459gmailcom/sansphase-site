import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import postcss from 'postcss';
import { communityBoards, communityTopicsHTML } from '../../src/community.ts';
import { communityComposeHTML } from '../../src/community-post.ts';
import { createFeedShell } from '../../src/community-layout/feed-shell.ts';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Window } };
const prefix = 'body.community-open:is(.community-frame-open, .community-management-open)[data-community-theme="light"]';
function contrast(a: string, b: string) {
  const light = (hex: string) => {
    assert.match(hex, /^#[a-f\d]{6}$/i);
    const c = [1, 3, 5].map(i => { const x = parseInt(hex.slice(i, i + 2), 16) / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
    return c[0]! * .2126 + c[1]! * .7152 + c[2]! * .0722;
  };
  const values = [light(a), light(b)].sort((x, y) => y - x);
  return (values[0]! + .05) / (values[1]! + .05);
}
async function styles(file = 'appearance.css') {
  const result = new Map<string, Map<string, string>>();
  postcss.parse(await readFile(new URL(`../../src/community-layout/${file}`, import.meta.url), 'utf8')).walkRules(rule => {
    if (rule.parent?.type !== 'root') return;
    const values = new Map<string, string>(); rule.walkDecls(d => { values.set(d.prop, d.value); }); result.set(rule.selector, values);
  });
  return result;
}
test('every board has a readable light icon colour; theme-aware badges have distinct visible fills', async () => {
  const css = await styles(), tokens = css.get(prefix)!;
  for (const board of communityBoards) assert.ok(contrast(board.lightColor, tokens.get('--bg')!) >= 4.5, `${board.id} icon needs clear colour on paper`);
  for (const name of ['--cm-lv0', '--cm-lv1', '--cm-lv2', '--cm-lv3', '--cm-lv4', '--cm-vip']) {
    assert.ok(contrast(tokens.get(name)!, tokens.get('--community-identity-fill')!) >= 4.5, `${name} stays readable inside its identity mark`);
  }
  const fills = new Set<string>();
  for (const tone of ['tool', 'method', 'creative', 'guide']) {
    const tag = css.get(`${prefix} .community-tag[data-tag-tone="${tone}"]`)!;
    assert.ok(tag, `${tone} has its own tag material`);
    assert.ok(contrast(tag.get('color')!, tag.get('background')!) >= 4.5);
    fills.add(tag.get('background')!);
  }
  assert.equal(fills.size, 4);
});
test('list statistics show existing SVG drawings for both likes and replies and tags keep their links', () => {
  const html = communityTopicsHTML([{ id: 'post-1', board: 'tools', title: '工具', author: { name: '星野', uid: 'u1', role: 'reader', level: 1 }, createdAt: '2026-10-05', lastActivityAt: '2026-10-05', likes: 6, replies: 2, tags: ['本地模型', '效率'] }], {
    t: zh => zh, esc: String, icons: { like: '<svg class="ui-icon" data-test-like></svg>', reply: '<svg class="ui-icon" data-test-reply></svg>' },
  });
  const { window } = new JSDOM(html, { url: 'http://localhost/' });
  try {
    const statistics = window.document.querySelector('.community-topic-replies')!;
    assert.ok(statistics.querySelector('small [data-test-like]'));
    assert.ok(statistics.querySelector('span [data-test-reply]'));
    assert.equal(statistics.getAttribute('href'), '#/post/post-1');
    assert.match(statistics.getAttribute('aria-label')!, /2 条回复，6 个赞/);
    assert.equal(window.document.querySelector(`[href="#/community/tag/${encodeURIComponent('本地模型')}"]`)?.getAttribute('data-tag-tone'), 'tool');
    assert.equal(window.document.querySelector(`[href="#/community/tag/${encodeURIComponent('效率')}"]`)?.getAttribute('data-tag-tone'), 'guide');
  } finally { window.close(); }
});
test('publishing uses a real SVG plus and a separate label, instead of a misaligned font glyph', () => {
  const { window } = new JSDOM('<header id="site-header"><nav id="navigation" class="community-nav"><a href="#/community/home">首页</a></nav></header><section data-community="home"><div class="community-layout"><main class="community-main"><a class="community-post" href="#/community/new/qa">发布讨论</a></main><aside class="community-aside"></aside></div></section>', { url: 'http://localhost/' });
  const shell = createFeedShell(window.document.querySelector('section')!, { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  try {
    shell.sync();
    const publish = window.document.querySelector('.community-feed-rail-compose')!;
    assert.ok(publish.querySelector('svg.community-compose-icon'));
    assert.equal(publish.querySelector('[data-compose-label]')?.textContent, '发布讨论');
    assert.equal(publish.getAttribute('href'), '#/community/new/qa');
  } finally { shell.release(); window.close(); }
});

test('the composer uses the same two board palettes as navigation and topic lists', () => {
  for (const simple of [true, false]) {
    const html = communityComposeHTML({ board: 'qa', members: false, simple, t: zh => zh, esc: String });
    const { window } = new JSDOM(html, { url: 'http://localhost/' });
    try {
      const board = window.document.querySelector<HTMLElement>(simple ? '.community-compose-destination strong' : '.community-bp')!;
      assert.equal(board.style.getPropertyValue('--board-light'), communityBoards[0]!.lightColor);
      assert.equal(board.style.getPropertyValue('--board'), communityBoards[0]!.color);
    } finally { window.close(); }
  }
});
test('shared controls and author information use a legible scale with a compact header', async () => {
  const root = (await styles('stable-frame.css')).get('body.community-open:is(.community-frame-open, .community-management-open)')!;
  const css = await styles('../community.css');
  assert.ok(parseFloat(root.get('--header-h')!) <= 72, 'the former 96px header wastes vertical reading space');
  assert.ok(parseFloat(css.get('.community-uname')?.get('font-size') || '') >= 16, 'coloured names need enough glyph area in either theme');
  const feed = await styles('feed.css');
  const host = ':is(.community-page[data-community="home"][data-home-design="feed"], [data-community-frame])';
  assert.ok(parseFloat(feed.get(`${host} .community-topic-replies .ui-icon`)?.get('width') || '') >= 20);
  assert.notEqual(feed.get(`${host} .community-topic-replies .ui-icon`)?.get('display'), 'none');
  assert.equal(feed.has(`${host} .community-feed-rail-compose::before`), false, 'there must not be a second plus after adding the SVG');
});

test('secondary controls are shared without widening the compact navigation', async () => {
  const css = await styles();
  assert.ok(parseFloat((await styles('../community.css')).get('.community-bell .ui-icon')?.get('width') || '') >= 20);
  const raw = postcss.parse(await readFile(new URL('../../src/community-layout/stable-frame.css', import.meta.url), 'utf8'));
  const desktop = (await styles('stable-frame.css')).get('body.community-open:is(.community-frame-open, .community-management-open)')!;
  assert.equal(desktop.get('--community-nav-font'), '15px');
  let narrowFont = '';
  raw.walkAtRules('media', media => {
    if (!media.params.includes('max-width: 1000px')) return;
    media.walkDecls('--community-nav-font', declaration => { narrowFont = declaration.value; });
  });
  assert.equal(narrowFont, '14px', 'the 112px navigation keeps a smaller label beside its 20px icon');
  assert.ok(css.has(`${prefix} .community-button:not(.is-gold, .is-good, .is-danger, [aria-pressed="true"]):hover:not(:disabled)`), 'neutral hover must not repaint semantic or selected actions');
});
