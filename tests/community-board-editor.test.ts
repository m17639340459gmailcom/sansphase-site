import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { communityBoardEditorHTML, createCommunityBoardController, type CommunityBoardCatalog, type CommunityBoardCreateInput } from '../src/community-board-editor.ts';
import type { Common, CommunityBoard } from '../src/community.ts';
import { communityBoardIconChoices, availableCommunityBoardIcons } from '../src/community-board-icons.ts';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: Window & { close(): void } } };
const common: Common = { t: zh => zh, esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!), icons: { plus: '<svg data-icon="plus"></svg>', help: '<svg data-icon="help"></svg>', 'chevron-up': '<svg data-icon="up"></svg>', 'chevron-down': '<svg data-icon="down"></svg>' } };
const board = (id: string, name = id): CommunityBoard => ({ id, zh: name, en: name, description: '板块说明', descriptionEn: 'Description', icon: 'help', color: '#9fb8e0', lightColor: '#41658f', kind: '讨论帖', kindEn: 'Discussion', tips: [], tipsEn: [] });
const catalog = (version = 1, ids = ['qa', 'tools', 'vip']): CommunityBoardCatalog => ({ version, items: ids.map(id => board(id)) });

function fixture(options: { create?: (input: CommunityBoardCreateInput, version: number) => Promise<CommunityBoardCatalog>; reorder?: (ids: string[], version: number) => Promise<CommunityBoardCatalog>; reload?: () => Promise<CommunityBoardCatalog>; owner?: () => boolean } = {}) {
  const dom = new JSDOM('<main></main>');
  const main = dom.window.document.querySelector<HTMLElement>('main')!;
  const saved: CommunityBoardCatalog[] = [], notices: string[] = [];
  const ui = createCommunityBoardController({ root: () => main, active: () => true, owner: options.owner || (() => true), ...common,
    create: options.create || (async (input, version) => ({ version: version + 1, items: [...catalog().items, { ...board(input.id || 'board-new', input.name), icon: input.icon }] })),
    reorder: options.reorder || (async (ids, version) => catalog(version + 1, ids)), reload: options.reload, saved: value => saved.push(value), notify: value => notices.push(value) });
  ui.sync(catalog());
  main.innerHTML = communityBoardEditorHTML({ ...ui.state(), ...common });
  const action = (name: string, id?: string) => ui.action(main.querySelector<HTMLElement>(`[data-action="community-board-${name}"]${id ? `[data-id="${id}"]` : ''}`)!);
  const input = (name: string, value: string) => {
    const field = main.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`)!;
    field.value = value;
    ui.input(field);
    return field;
  };
  return { dom, main, ui, saved, notices, action, input };
}

test('board editor escapes saved data, labels every control and keeps protected board access descriptive', () => {
  const original = fixture();
  const state = original.ui.state();
  original.dom.window.close();
  const dom = new JSDOM(communityBoardEditorHTML({ ...state, catalog: { version: 1, items: [board('qa', '<img src=x onerror=bad()>'), board('vip')] }, draftOrder: ['qa', 'vip'], ...common }));
  const doc = dom.window.document;
  assert.equal(doc.querySelector('[data-board-name]')!.textContent, '<img src=x onerror=bad()>');
  assert.equal(doc.querySelectorAll('[onerror]').length, 0);
  assert.equal(doc.querySelectorAll('form').length, 2);
  assert.equal(doc.querySelectorAll('form form').length, 0);
  for (const field of doc.querySelectorAll<HTMLInputElement>('input, textarea, select')) assert.ok(doc.querySelector(`label[for="${field.id}"]`));
  assert.equal(doc.querySelectorAll('select.community-select option').length, communityBoardIconChoices.length - 1);
  assert.equal(doc.querySelector('option[value="help"]'), null, 'used icons are not offered');
  assert.equal(doc.querySelector('[name="vip"]'), null);
  assert.match(doc.querySelector('[data-board-row="vip"]')!.textContent!, /VIP/);
  assert.ok(doc.querySelector('[data-board-order-status][aria-live="polite"]'));
  dom.window.close();
});

test('reordering moves the same DOM nodes and focuses an available control on the moved board', () => {
  const f = fixture();
  const row = f.main.querySelector<HTMLElement>('[data-board-row="tools"]')!;
  const field = f.input('name', '未提交的名字');
  const up = row.querySelector<HTMLButtonElement>('[data-action="community-board-up"]')!;
  up.focus();
  f.ui.action(up);
  assert.deepEqual(f.ui.state().draftOrder, ['tools', 'qa', 'vip']);
  assert.equal(f.main.querySelector('[data-board-row="tools"]'), row);
  assert.equal(f.main.querySelector('[name="name"]'), field);
  assert.equal(field.value, '未提交的名字');
  assert.equal(f.dom.window.document.activeElement?.closest('[data-board-row]'), row);
  assert.equal((f.dom.window.document.activeElement as HTMLButtonElement).disabled, false);
  assert.deepEqual([...f.main.querySelectorAll('[data-board-position]')].map(node => node.textContent), ['1', '2', '3']);
  assert.ok(f.ui.dirty());
  assert.match(f.main.querySelector('[data-board-order-status]')!.textContent!, /未保存/);
  f.dom.window.close();
});

test('moving never writes until explicit save, and saves every ID with the captured catalog version', async () => {
  const calls: Array<{ ids: string[]; version: number }> = [];
  const f = fixture({ reorder: async (ids, version) => { calls.push({ ids, version }); return catalog(version + 1, ids); } });
  f.action('up', 'tools');
  assert.equal(calls.length, 0);
  await f.ui.saveOrder();
  assert.deepEqual(calls, [{ ids: ['tools', 'qa', 'vip'], version: 1 }]);
  assert.equal(f.ui.dirty(), false);
  assert.equal(f.saved[0].version, 2);
  assert.match(f.notices[0], /顺序已保存/);
  f.dom.window.close();
});

test('busy order saves block duplicate requests and edits without replacing rows', async () => {
  let finish!: (value: CommunityBoardCatalog) => void;
  let calls = 0;
  const f = fixture({ reorder: async () => { calls++; return await new Promise(resolve => { finish = resolve; }); } });
  f.action('up', 'tools');
  const row = f.main.querySelector('[data-board-row="tools"]');
  const pending = f.ui.saveOrder();
  await f.ui.saveOrder();
  f.action('down', 'tools');
  assert.equal(calls, 1);
  assert.deepEqual(f.ui.state().draftOrder, ['tools', 'qa', 'vip']);
  for (const button of f.main.querySelectorAll<HTMLButtonElement>('button')) assert.equal(button.disabled, true);
  finish(catalog(2, ['tools', 'qa', 'vip']));
  await pending;
  assert.equal(f.main.querySelector('[data-board-row="tools"]'), row);
  f.dom.window.close();
});

test('cancel restores order but keeps a separate in-progress creation form', () => {
  const f = fixture();
  const field = f.input('name', '兴趣交流');
  const row = f.main.querySelector('[data-board-row="tools"]');
  f.action('up', 'tools');
  f.action('cancel');
  assert.deepEqual(f.ui.state().draftOrder, ['qa', 'tools', 'vip']);
  assert.equal(f.main.querySelector('[data-board-row="tools"]'), row);
  assert.equal(field.value, '兴趣交流');
  assert.equal(f.ui.dirty(), true, 'creation input remains a guarded draft');
  f.dom.window.close();
});

test('creation trims the minimal payload and keeps an unsaved order when appending the new board', async () => {
  const calls: Array<{ input: CommunityBoardCreateInput; version: number }> = [];
  const f = fixture({ create: async (input, version) => { calls.push({ input, version }); return { version: 2, items: [...catalog().items, { ...board('board-new', input.name), icon: input.icon }] }; } });
  const row = f.main.querySelector('[data-board-row="tools"]');
  f.action('up', 'tools');
  f.input('name', '  兴趣交流  '); f.input('description', '  分享我们的兴趣  '); f.input('icon', 'feather');
  await f.ui.create();
  assert.deepEqual(calls, [{ input: { name: '兴趣交流', description: '分享我们的兴趣', icon: 'feather' }, version: 1 }]);
  assert.deepEqual(f.ui.state().draftOrder, ['tools', 'qa', 'board-new', 'vip']);
  assert.equal(f.main.querySelector('option[value="feather"]'), null, 'the created board consumes its icon immediately');
  assert.equal(f.main.querySelector('[data-board-row="tools"]'), row);
  assert.equal(f.main.querySelector<HTMLInputElement>('[name="name"]')!.value, '');
  assert.ok(f.ui.dirty(), 'the earlier order draft still requires save');
  assert.equal(f.ui.state().catalog?.version, 2);
  f.dom.window.close();
});

test('invalid names, unknown icons and invalid optional IDs do not write; errors focus the affected field', async () => {
  let calls = 0;
  const f = fixture({ create: async () => { calls++; return catalog(2); } });
  await f.ui.create();
  assert.equal(calls, 0);
  assert.equal(f.dom.window.document.activeElement?.getAttribute('name'), 'name');
  assert.equal(f.main.querySelector('[name="name"]')!.getAttribute('aria-invalid'), 'true');
  f.input('name', '兴趣交流'); f.input('description', '分享兴趣'); f.input('id', '../api'); await f.ui.create();
  assert.equal(calls, 0);
  assert.equal(f.dom.window.document.activeElement?.getAttribute('name'), 'id');
  f.input('id', 'custom-board'); f.input('icon', 'unsafe'); await f.ui.create();
  assert.equal(calls, 0);
  assert.match(f.ui.state().createMessage, /图标/);
  f.dom.window.close();
});

test('creation failures preserve the form, and identity reset ignores late successful writes', async () => {
  const failed = fixture({ create: async () => { throw Error('暂时无法创建'); } });
  failed.input('name', '兴趣交流'); failed.input('description', '分享兴趣'); await failed.ui.create();
  assert.equal(failed.main.querySelector<HTMLInputElement>('[name="name"]')!.value, '兴趣交流');
  assert.match(failed.ui.state().createMessage, /暂时无法创建/);
  failed.dom.window.close();
  let finish!: (value: CommunityBoardCatalog) => void;
  const f = fixture({ create: async () => await new Promise(resolve => { finish = resolve; }) });
  f.input('name', '兴趣交流'); f.input('description', '分享兴趣'); const pending = f.ui.create();
  f.ui.reset(); f.ui.sync(catalog(7));
  finish({ version: 2, items: [...catalog().items, board('board-new')] }); await pending;
  assert.equal(f.saved.length, 0);
  assert.equal(f.ui.state().catalog?.version, 7);
  assert.equal(f.ui.state().busy, false);
  f.dom.window.close();
});

test('background catalog updates preserve order drafts and block stale saves until explicit cancel', async () => {
  let calls = 0;
  const f = fixture({ reorder: async () => { calls++; return catalog(3); } });
  f.action('up', 'tools'); f.input('name', '草稿名字');
  f.ui.sync(catalog(2, ['vip', 'qa', 'tools', 'board-new']));
  assert.equal(f.ui.state().conflicted, true);
  assert.deepEqual(f.ui.state().draftOrder, ['tools', 'qa', 'vip']);
  await f.ui.saveOrder(); assert.equal(calls, 0);
  f.action('cancel');
  assert.deepEqual(f.ui.state().draftOrder, ['qa', 'tools', 'board-new', 'vip']);
  assert.equal(f.ui.state().catalog?.version, 2);
  assert.equal(f.ui.state().conflicted, false);
  assert.equal(f.main.querySelector<HTMLInputElement>('[name="name"]')!.value, '草稿名字');
  f.dom.window.close();
});

test('HTTP conflicts preserve drafts, offer reloading and allow retrying only the latest version', async () => {
  const f = fixture({ reorder: async () => { throw Object.assign(Error('已更新'), { status: 409 }); } });
  f.action('up', 'tools'); await f.ui.saveOrder();
  assert.equal(f.ui.state().conflicted, true);
  assert.deepEqual(f.ui.state().draftOrder, ['tools', 'qa', 'vip']);
  assert.match(f.ui.state().message, /读取最新/);
  f.dom.window.close();
});

test('discarding a conflict fetches a new version and a subsequent save uses it', async () => {
  const versions: number[] = [];
  let reloads = 0;
  const f = fixture({ reorder: async (ids, version) => {
    versions.push(version);
    if (version === 1) throw Object.assign(Error('已更新'), { status: 409 });
    return catalog(version + 1, ids);
  }, reload: async () => { reloads++; return catalog(2, ['vip', 'qa', 'tools']); } });
  f.action('up', 'tools'); await f.ui.saveOrder();
  f.action('cancel'); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(reloads, 1);
  assert.equal(f.ui.state().conflicted, false);
  assert.equal(f.ui.state().catalog?.version, 2);
  assert.deepEqual(f.ui.state().draftOrder, ['qa', 'tools', 'vip']);
  f.action('up', 'tools'); await f.ui.saveOrder();
  assert.deepEqual(versions, [1, 2]);
  f.dom.window.close();
});

test('failed conflict reloads retain the draft and remain blocked for retry', async () => {
  const f = fixture({ reorder: async () => { throw Object.assign(Error('已更新'), { status: 409 }); }, reload: async () => { throw Error('网络暂时不可用'); } });
  f.action('up', 'tools'); await f.ui.saveOrder();
  f.action('cancel'); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.ui.state().conflicted, true);
  assert.deepEqual(f.ui.state().draftOrder, ['tools', 'qa', 'vip']);
  assert.match(f.ui.state().message, /网络暂时不可用/);
  assert.equal(f.main.querySelector<HTMLButtonElement>('[data-board-save]')!.disabled, true);
  f.dom.window.close();
});

test('late background reads cannot replace a successful write with an older catalog', async () => {
  const f = fixture();
  f.action('up', 'tools'); await f.ui.saveOrder();
  f.ui.sync(catalog());
  assert.equal(f.ui.state().catalog?.version, 2);
  assert.deepEqual(f.ui.state().draftOrder, ['tools', 'qa', 'vip']);
  assert.equal(f.ui.state().conflicted, false);
  f.dom.window.close();
});

test('conflict rendering disables both reorder directions and write buttons while retaining cancel', () => {
  const f = fixture();
  f.action('up', 'tools'); f.ui.sync(catalog(2));
  const dom = new JSDOM(communityBoardEditorHTML({ ...f.ui.state(), ...common }));
  for (const button of dom.window.document.querySelectorAll<HTMLButtonElement>('[data-action="community-board-up"], [data-action="community-board-down"], [data-board-save], [data-board-create]')) assert.equal(button.disabled, true);
  assert.equal(dom.window.document.querySelector<HTMLButtonElement>('[data-action="community-board-cancel"]')!.disabled, false);
  dom.window.close(); f.dom.window.close();
});

test('both native forms dispatch to the matching operation and unrelated forms are ignored', async () => {
  let creates = 0, reorders = 0;
  const f = fixture({ create: async () => { creates++; return catalog(2); }, reorder: async (ids, version) => { reorders++; return catalog(version + 1, ids); } });
  f.input('name', '兴趣交流'); f.input('description', '分享兴趣');
  assert.equal(f.ui.submit(f.main.querySelector<HTMLFormElement>('[data-community-form="board-create"]')!), true);
  await new Promise(resolve => setTimeout(resolve, 0));
  f.action('up', 'tools');
  assert.equal(f.ui.submit(f.main.querySelector<HTMLFormElement>('[data-community-form="board-order"]')!), true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual([creates, reorders], [1, 1]);
  assert.equal(f.ui.submit({ dataset: { communityForm: 'banners' } } as HTMLFormElement), false);
  f.dom.window.close();
});

test('non-owner identities cannot create or reorder even with manually invoked controller methods', async () => {
  let calls = 0;
  const f = fixture({ owner: () => false, create: async () => { calls++; return catalog(2); }, reorder: async () => { calls++; return catalog(2); } });
  f.action('up', 'tools'); f.input('name', '兴趣交流'); await f.ui.create(); await f.ui.saveOrder();
  assert.equal(calls, 0);
  assert.deepEqual(f.ui.state().draftOrder, ['qa', 'tools', 'vip']);
  assert.equal(f.ui.dirty(), false);
  f.dom.window.close();
});

test('foreign actions and boundary moves do not mutate the order', () => {
  const f = fixture();
  assert.equal(f.ui.action({ dataset: { action: 'community-banner-up', id: 'qa' } } as HTMLElement), false);
  f.action('up', 'qa'); f.action('down', 'vip'); f.action('up', 'vip'); f.action('down', 'tools');
  assert.deepEqual(f.ui.state().draftOrder, ['qa', 'tools', 'vip']);
  assert.equal(f.ui.dirty(), false);
  f.dom.window.close();
});

test('VIP stays last in legacy catalogs without implicitly saving or marking an order draft', () => {
  const f = fixture();
  f.ui.sync(catalog(2, ['vip', 'qa', 'tools']));
  assert.deepEqual(f.ui.state().draftOrder, ['qa', 'tools', 'vip']);
  assert.equal(f.ui.dirty(), false);
  assert.equal(f.main.querySelector<HTMLButtonElement>('[data-board-row="vip"] [data-action="community-board-up"]')!.disabled, true);
  assert.equal(f.main.querySelector<HTMLButtonElement>('[data-board-row="tools"] [data-action="community-board-down"]')!.disabled, true);
  assert.equal(f.saved.length, 0);
  f.dom.window.close();
});

test('catalog changes refresh unused icons while preserving fields, focus, and the native select node', () => {
  const f = fixture();
  assert.equal(f.ui.dirty(), false, 'an automatically selected unused icon is not a draft');
  const select = f.main.querySelector<HTMLSelectElement>('[name="icon"]')!;
  const field = f.input('name', 'AI 咨询');
  field.focus();
  f.input('icon', 'brain');
  const updated = catalog(2);
  updated.items.push({ ...board('ai'), icon: 'brain' });
  f.ui.sync(updated);
  assert.equal(f.main.querySelector('[name="icon"]'), select);
  assert.equal(f.main.querySelector('[name="name"]'), field);
  assert.equal(f.dom.window.document.activeElement, field);
  assert.equal(field.value, 'AI 咨询');
  assert.equal(select.querySelector('option[value="brain"]'), null);
  assert.ok(availableCommunityBoardIcons(updated.items).some(item => item.id === f.ui.state().createDraft.icon));
  assert.match(f.ui.state().createMessage, /图标/);
  f.input('icon', 'bot');
  f.ui.sync({ ...updated, version: 3 });
  assert.equal(select.value, 'bot', 'an available chosen icon survives refresh');
  f.dom.window.close();
});

test('exhausted icons disable creation with an explanation and re-enable after a catalog refresh', async () => {
  let writes = 0;
  const f = fixture({ create: async () => { writes++; return catalog(5); } });
  const full = { version: 2, items: communityBoardIconChoices.map((icon, index) => ({ ...board(`board-${index}`), icon: icon.id })) };
  f.ui.sync(full);
  f.input('name', '新讨论'); f.input('description', '分享新的话题');
  assert.equal(f.main.querySelector<HTMLSelectElement>('[name="icon"]')!.disabled, true);
  assert.equal(f.main.querySelector<HTMLButtonElement>('[data-board-create]')!.disabled, true);
  assert.match(f.main.querySelector('[data-board-create-status]')!.textContent!, /图标/);
  await f.ui.create();
  assert.equal(writes, 0);
  f.ui.sync({ version: 3, items: full.items.slice(0, -1) });
  assert.equal(f.main.querySelector<HTMLSelectElement>('[name="icon"]')!.disabled, false);
  assert.equal(f.main.querySelector<HTMLButtonElement>('[data-board-create]')!.disabled, false);
  assert.equal(f.ui.state().createDraft.icon, 'wrench');
  f.dom.window.close();
});

test('board editor uses shared theme tokens with responsive rows and no layered or animated rendering', async () => {
  const css = await readFile(new URL('../src/community-management.css', import.meta.url), 'utf8');
  assert.match(css, /\.community-board-edit-row\s*\{[^}]*background: var\(--cm-panel\)/);
  assert.match(css, /\.community-board-editor[^}]*min-width: 0/);
  assert.match(css, /\.community-board-create-fields\s*\{[^}]*minmax\(0, 1fr\)/);
  assert.doesNotMatch(css, /\.community-board-(?:edit|editor|create|order)[^{}]*\{[^}]*(?:!important|backdrop-filter|will-change|transform:|animation:|box-shadow:)/);
});
