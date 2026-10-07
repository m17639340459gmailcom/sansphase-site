import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { communityBannerEditorHTML, type CommunityBannerEditorState } from '../src/community-banner-editor.ts';
import type { CommunityBannerConfig } from '../src/community-banners.ts';
import type { Common, CommunityTopic } from '../src/community.ts';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: Window & { close(): void } } };
const common: Common = { t: zh => zh, esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!), icons: { plus: '<svg data-icon="plus"></svg>', image: '<svg data-icon="image"></svg>', search: '<svg data-icon="search"></svg>' } };
const image = '11111111-1111-4111-8111-111111111111';
const qa: CommunityBannerConfig = { scope: 'qa', version: 1, items: [{ topicId: 'post-1', title: '', cover: null, image, topicTitle: '原标题', board: 'qa' }] };
const home: CommunityBannerConfig = { scope: 'home', version: 0, items: [] };
const topic: CommunityTopic = { id: 'post-2', title: '候选帖子', board: 'qa', author: { name: '读者', role: 'reader', uid: 'u1' }, createdAt: '2026-10-05T00:00:00Z', lastActivityAt: '2026-10-05T00:00:00Z', likes: 0, replies: 0 };
const state = (extra: Partial<CommunityBannerEditorState> = {}): CommunityBannerEditorState => ({ configs: [qa], scope: 'qa', draft: qa, candidates: { state: 'ready', data: { items: [topic], total: 1, page: 1, pageSize: 20 } }, query: '', busy: false, ...extra });
const render = (extra: Partial<CommunityBannerEditorState> = {}) => new JSDOM(communityBannerEditorHTML({ ...state(extra), ...common }));

test('scope choices follow server permissions and separate homepage from board configuration', () => {
  const moderator = render();
  assert.deepEqual([...moderator.window.document.querySelectorAll('[data-action="community-banner-scope"]')].map(node => node.getAttribute('data-scope')), ['qa']);
  assert.equal(moderator.window.document.querySelector('[data-action="community-banner-scope"]')!.getAttribute('aria-pressed'), 'true');
  assert.equal(moderator.window.document.querySelector('.community-banner-scope-heading'), null, 'the selected tab identifies the scope without a repeated panel');
  moderator.window.close();
  const owner = render({ configs: [home, qa], scope: 'home', draft: home });
  assert.deepEqual([...owner.window.document.querySelectorAll('[data-action="community-banner-scope"]')].map(node => node.getAttribute('data-scope')), ['home', 'qa']);
  assert.equal(owner.window.document.querySelector('[data-scope="home"]')!.getAttribute('aria-pressed'), 'true');
  owner.window.close();
});

test('banner title, preview, reorder controls and covers remain scoped to their item', () => {
  const custom = { ...qa.items[0], topicId: 'post/<1>', title: '<img src=x onerror=alert(1)>', cover: image };
  const dom = render({ draft: { ...qa, items: [custom, { ...qa.items[0], topicId: 'post-2', image: 'javascript:alert(1)' }] } });
  const doc = dom.window.document;
  const first = doc.querySelector('[data-banner-item="0"]')!;
  assert.equal(first.querySelector('[data-banner-preview-title]')!.textContent, custom.title);
  assert.equal(first.querySelector('input[name="banner-title-0"]')!.getAttribute('value'), custom.title);
  assert.equal(first.querySelector('a')!.getAttribute('href'), '#/post/post%2F%3C1%3E');
  assert.equal(first.querySelector('.community-banner-preview > img')!.getAttribute('src'), `/api/community/images/${image}.webp`);
  assert.ok(first.querySelector('[data-action="community-banner-up"]')!.hasAttribute('disabled'));
  assert.equal(first.querySelector('[data-action="community-banner-down"]')!.hasAttribute('disabled'), false);
  assert.equal(doc.querySelector('[data-banner-item="1"] .community-banner-preview > img'), null);
  assert.match(doc.querySelector('[data-banner-item="1"]')!.textContent!, /使用帖子首图/);
  assert.equal(doc.querySelectorAll('[onerror]').length, 0);
  assert.match(doc.body.textContent!, /有未保存的修改/);
  dom.window.close();
});

test('search and editing use separate accessible forms and all busy actions are disabled', () => {
  const dom = render({ busy: true });
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('form').length, 2);
  assert.equal(doc.querySelectorAll('form form').length, 0);
  const search = doc.querySelector<HTMLFormElement>('[data-community-form="banner-search"]')!;
  assert.equal(search.querySelector<HTMLInputElement>('input[name="query"]')!.value, '');
  const file = doc.querySelector<HTMLInputElement>('input[data-banner-file]')!;
  assert.equal(file.accept, 'image/jpeg,image/png,image/webp');
  assert.equal(file.dataset.index, '0');
  assert.equal(doc.querySelector(`label[for="${file.id}"]`)!.textContent, '选择封面');
  assert.ok(doc.querySelector('[data-banner-drop="true"][data-index="0"]'));
  assert.ok(doc.querySelector('[data-action="community-banner-cancel"]'));
  assert.ok(doc.querySelector('[data-community-form="banners"] .community-form-status[aria-live="polite"]'));
  for (const button of doc.querySelectorAll('button')) assert.ok(button.disabled);
  assert.ok(file.disabled);
  dom.window.close();
});

test('empty, loading and error states are informative and keep configured draft content', () => {
  for (const candidates of [{ state: 'loading' as const }, { state: 'error' as const, status: 500, message: '暂时无法查询' }, { state: 'ready' as const, data: { items: [], total: 0, page: 1, pageSize: 20 } }]) {
    const dom = render({ candidates });
    assert.ok(dom.window.document.querySelector('[data-banner-item="0"]'));
    assert.equal(dom.window.document.querySelectorAll('[data-action="community-banner-add"]').length, 0);
    assert.match(dom.window.document.querySelector('.community-banner-candidates')!.textContent!, /读取|无法查询|没有找到/);
    dom.window.close();
  }
  const empty = render({ draft: home, scope: 'home', configs: [home] });
  assert.match(empty.window.document.body.textContent!, /还没有展示横幅/);
  assert.ok(empty.window.document.querySelector('[data-community-form="banners"]'));
  empty.window.close();
});

test('candidate controls distinguish selected and full lists without permitting duplicate additions', () => {
  const full = { ...qa, items: Array.from({ length: 5 }, (_, index) => ({ ...qa.items[0], topicId: `post-${index + 1}` })) };
  const partial = render({ draft: { ...full, items: full.items.slice(0, 4) }, candidates: { state: 'ready', data: { items: [{ ...topic, id: 'post-5' }], total: 1, page: 1, pageSize: 20 } } });
  assert.equal(partial.window.document.querySelector<HTMLButtonElement>('[data-action="community-banner-add"]')!.disabled, false, 'the fifth slot remains available');
  assert.match(partial.window.document.querySelector('.community-banner-list-heading')!.textContent!, /4 \/ 5/);
  partial.window.close();
  const dom = render({ draft: full, candidates: { state: 'ready', data: { items: [topic, { ...topic, id: 'post-6' }], total: 2, page: 1, pageSize: 20 } } });
  assert.equal(dom.window.document.querySelectorAll('[data-action="community-banner-add"]').length, 2);
  assert.match(dom.window.document.querySelector('[data-action="community-banner-add"][data-id="post-2"]')!.textContent!, /已选择/);
  assert.match(dom.window.document.querySelector('[data-action="community-banner-add"][data-id="post-6"]')!.textContent!, /已满/);
  assert.match(dom.window.document.querySelector('.community-banner-list-heading')!.textContent!, /5 \/ 5/);
  for (const button of dom.window.document.querySelectorAll<HTMLButtonElement>('[data-action="community-banner-add"]')) assert.ok(button.disabled);
  dom.window.close();
});

test('banner editor spacing belongs to the management stylesheet and follows shared theme tokens', async () => {
  const css = await readFile(new URL('../src/community-management.css', import.meta.url), 'utf8');
  assert.match(css, /\.community-banner-editor-grid\s*\{[^}]*grid-template-columns:[^}]*gap: 22px/);
  assert.match(css, /\.community-banner-edit-item\s*\{[^}]*padding: 18px[^}]*gap: 18px[^}]*background: var\(--cm-panel\)/);
  assert.match(css, /\.community-banner-drop:focus-within\s*\{[^}]*border-color: var\(--focus-edge\)/);
  assert.match(css, /\.community-banner-preview\s*\{[^}]*color: #f7f4ee/);
  assert.doesNotMatch(css, /\.community-banner[^}]*!important/);
  assert.match(css, /\.community-banner-preview\.is-image > img\s*\{[^}]*object-fit: contain/);
  assert.doesNotMatch(css, /\.community-banner-preview[^{}]*::(?:before|after)\s*\{[^}]*background:/, 'all banner previews must preserve the artwork without a painted overlay');
});

test('an empty scope exposes independent image upload without an available post', () => {
  const dom = render({ configs: [home], scope: 'home', draft: home, candidates: { state: 'ready', data: { items: [], total: 0, page: 1, pageSize: 20 } } });
  const button = dom.window.document.querySelector<HTMLButtonElement>('[data-action="community-banner-add-image"]');
  assert.ok(button, 'image banners must be available even when no posts exist');
  assert.equal(button.disabled, false);
  assert.match(button.textContent!, /添加图片横幅/);
  dom.window.close();
});

test('independent image previews have no fake post, preserve prepared artwork and share the five-slot limit', () => {
  const standalone = { kind: 'image' as const, topicId: null, title: '活动 <公告>', cover: image, image, topicTitle: '', topicImage: null, board: 'qa' };
  const dom = render({ draft: { ...qa, items: [standalone] } });
  const first = dom.window.document.querySelector('[data-banner-item="0"]')!;
  assert.equal(first.querySelector('a'), null);
  assert.ok(first.querySelector('.community-banner-preview.is-image > img'));
  assert.ok(first.querySelector('[data-banner-file]'));
  assert.match(first.textContent!, /移除图片|等比例/);
  assert.doesNotMatch(first.textContent!, /原帖|恢复帖子封面|使用帖子首图/);
  dom.window.close();
  const full = render({ draft: { ...qa, items: Array.from({ length: 5 }, () => ({ ...standalone })) } });
  assert.ok(full.window.document.querySelector<HTMLButtonElement>('[data-action="community-banner-add-image"]')!.disabled);
  full.window.close();
});
