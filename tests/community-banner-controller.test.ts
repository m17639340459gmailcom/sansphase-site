import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityBannerController } from '../src/community-banner-controller.ts';

const config = (scope = 'home') => ({ scope, version: 1, items: [] });
const listing = (board = 'qa') => ({ items: [{ id: 'p1', board, title: '原帖标题', thumbs: ['11111111-1111-4111-8111-111111111111'] }], total: 1, page: 1, pageSize: 20 });
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const action = (action: string, other = {}) => ({ dataset: { action: `community-banner-${action}`, ...other } });

test('independent scoped drafts, order and cancel never edit another banner configuration', async () => {
  const calls: string[] = [];
  const ui = createCommunityBannerController({ request: async <T>(path: string) => { calls.push(path); return listing() as T; }, paint() {}, notify() {}, t: zh => zh, active: () => true, owner: () => true, saved() {} });
  ui.sync([config(), config('qa')]);
  await turn();
  ui.action(action('add', { id: 'p1' }) as HTMLElement);
  assert.equal(ui.state().draft?.items[0].topicTitle, '原帖标题');
  ui.action(action('scope', { scope: 'qa' }) as HTMLElement);
  await turn();
  assert.equal(ui.state().draft?.items.length, 0);
  ui.action(action('add', { id: 'p1' }) as HTMLElement);
  ui.action(action('scope', { scope: 'home' }) as HTMLElement);
  assert.equal(ui.state().draft?.items.length, 1);
  ui.action(action('cancel') as HTMLElement);
  assert.equal(ui.state().draft?.items.length, 0);
  ui.action(action('scope', { scope: 'qa' }) as HTMLElement);
  assert.equal(ui.state().draft?.items.length, 1);
  assert.ok(calls.some(path => path.includes('board=qa')));
});

test('saving posts only the chosen scope, captured version and editable fields', async () => {
  const writes: Array<{ path: string; body: unknown }> = [];
  const saved: unknown[] = [];
  const notices: string[] = [];
  const ui = createCommunityBannerController({ request: async <T>(path: string, init?: RequestInit) => {
    if (!init?.method) return listing() as T;
    const body = JSON.parse(String(init.body)); writes.push({ path, body }); return { ...body, version: 2 } as T;
  }, paint() {}, notify: value => notices.push(value), t: zh => zh, active: () => true, owner: () => false, saved: value => saved.push(value) });
  ui.sync([config('qa')]); await turn();
  ui.action(action('add', { id: 'p1' }) as HTMLElement);
  await ui.save();
  assert.deepEqual(writes, [{ path: 'manage/banners', body: { scope: 'qa', version: 1, items: [{ topicId: 'p1', title: '', cover: null }] } }]);
  assert.equal(saved.length, 1);
  assert.equal(ui.dirty(), false);
  assert.deepEqual(notices, ['横幅已保存。']);
  assert.match(ui.state().message || '', /仅更新当前展示位置/);
});

test('each scoped draft accepts five unique banners and blocks a sixth without losing the chosen order', async () => {
  const topics = Array.from({ length: 6 }, (_, index) => ({ ...listing().items[0], id: `p${index + 1}` }));
  const ui = createCommunityBannerController({ request: async <T>() => ({ ...listing(), items: topics, total: topics.length }) as T,
    paint() {}, notify() {}, t: zh => zh, active: () => true, owner: () => true, saved() {} });
  ui.sync([config()]); await turn();
  for (const topic of topics) ui.action(action('add', { id: topic.id }) as HTMLElement);
  assert.deepEqual(ui.state().draft?.items.map(item => item.topicId), ['p1', 'p2', 'p3', 'p4', 'p5']);
  ui.action(action('add', { id: 'p1' }) as HTMLElement);
  assert.equal(ui.state().draft?.items.length, 5);
  ui.action(action('remove', { index: '2' }) as HTMLElement);
  ui.action(action('add', { id: 'p6' }) as HTMLElement);
  assert.deepEqual(ui.state().draft?.items.map(item => item.topicId), ['p1', 'p2', 'p4', 'p5', 'p6']);
});

test('identity reset discards late search and save responses and releases locks', async () => {
  let finish!: (value: unknown) => void;
  const saved: unknown[] = [];
  const ui = createCommunityBannerController({ request: async <T>(_path: string, init?: RequestInit) => {
    if (!init?.method) return listing() as T;
    return await new Promise(resolve => { finish = resolve; }) as T;
  }, paint() {}, notify() {}, t: zh => zh, active: () => true, owner: () => true, saved: value => saved.push(value) });
  ui.sync([config()]); await turn(); ui.action(action('add', { id: 'p1' }) as HTMLElement);
  const pending = ui.save(); assert.equal(ui.state().busy, true);
  ui.reset(); ui.sync([config('qa')]);
  finish({ scope: 'home', version: 2, items: [] }); await pending;
  assert.equal(ui.state().scope, 'qa'); assert.equal(ui.state().busy, false); assert.equal(saved.length, 0);
});

test('permission revocation removes stale drafts; conflicts preserve work until explicit cancel', async () => {
  const ui = createCommunityBannerController({ request: async <T>(_path: string, init?: RequestInit) => {
    if (!init?.method) return listing() as T;
    throw Object.assign(Error('配置已更新，请重新读取。'), { status: 409 });
  }, paint() {}, notify() {}, t: zh => zh, active: () => true, owner: () => true, saved() {} });
  ui.sync([config(), config('qa')]); await turn(); ui.action(action('add', { id: 'p1' }) as HTMLElement);
  await ui.save(); assert.equal(ui.dirty(), true); assert.match(ui.state().message || '', /修改已保留/);
  ui.sync([config('qa')]); assert.equal(ui.state().scope, 'qa'); assert.equal(ui.state().draft?.items.length, 0);
  ui.action(action('scope', { scope: 'home' }) as HTMLElement); assert.equal(ui.state().scope, 'qa');
});

test('conflicting saves retain the draft and require explicit reload before submitting a fresh version', async () => {
  const versions: number[] = [];
  let ui: ReturnType<typeof createCommunityBannerController>;
  ui = createCommunityBannerController({ request: async <T>(_path: string, init?: RequestInit) => {
    if (!init?.method) return listing() as T;
    const body = JSON.parse(String(init.body)); versions.push(body.version);
    if (versions.length === 1) throw Object.assign(Error('横幅已更新'), { status: 409 });
    return { ...body, version: 3 } as T;
  }, paint() {}, notify() {}, t: zh => zh, active: () => true, owner: () => true, saved() {}, conflict: async () => { ui.sync([{ ...config(), version: 2 }]); } });
  ui.sync([config()]); await turn(); ui.action(action('add', { id: 'p1' }) as HTMLElement);
  await ui.save(); assert.equal(ui.state().draft?.items.length, 1); assert.equal(ui.state().conflicted, true);
  await ui.save(); assert.deepEqual(versions, [1], 'a repeated save must not overwrite newer changes');
  ui.action(action('cancel') as HTMLElement); assert.equal(ui.state().draft?.version, 2); assert.equal(ui.state().conflicted, false);
  ui.action(action('add', { id: 'p1' }) as HTMLElement); await ui.save(); assert.deepEqual(versions, [1, 2]); assert.equal(ui.dirty(), false);
});

test('an independent image uses the existing upload and save APIs without a topic and requires its image before save', async () => {
  const image = '11111111-1111-4111-8111-111111111111';
  const writes: Array<{ path: string; body: unknown }> = [];
  const ui = createCommunityBannerController({ request: async <T>(path: string, init?: RequestInit) => {
    if (!init?.method) return { ...listing(), items: [], total: 0 } as T;
    if (path.startsWith('manage/banner-image')) { writes.push({ path, body: init.body }); return { id: image } as T; }
    const body = JSON.parse(String(init.body)); writes.push({ path, body });
    return { ...body, version: 2, items: body.items.map((item: { kind: 'image'; topicId: null; cover: string; title: string }) => ({ ...item, board: 'qa', topicTitle: '', topicImage: null, image: item.cover })) } as T;
  }, paint() {}, notify() {}, t: zh => zh, active: () => true, owner: () => false, saved() {} });
  ui.sync([config('qa')]); await turn();
  ui.action(action('add-image') as HTMLElement);
  assert.equal(ui.state().draft?.items.length, 1);
  assert.equal(ui.state().draft?.items[0].topicId, null);
  await ui.save();
  assert.equal(writes.length, 0, 'empty image drafts must not be published');
  assert.match(ui.state().message || '', /上传.*图片/);
  const file = new File(['image'], 'banner.png', { type: 'image/png' });
  ui.change({ matches: () => true, dataset: { index: '0' }, files: [file], value: '' } as unknown as HTMLInputElement);
  await turn();
  assert.equal(writes[0].path, 'manage/banner-image?scope=qa');
  assert.ok(writes[0].body instanceof FormData);
  await ui.save();
  assert.deepEqual(writes[1], { path: 'manage/banners', body: { scope: 'qa', version: 1, items: [{ kind: 'image', topicId: null, title: '', cover: image }] } });
  assert.equal(ui.dirty(), false);
  ui.action(action('cover-remove', { index: '0' }) as HTMLElement);
  assert.equal(ui.state().draft?.items[0].cover, null);
  assert.equal(ui.state().draft?.items[0].image, null);
});

test('image and post drafts share the maximum five slots and retain their order across scopes', async () => {
  const ui = createCommunityBannerController({ request: async <T>() => listing() as T, paint() {}, notify() {}, t: zh => zh, active: () => true, owner: () => true, saved() {} });
  ui.sync([config(), config('qa')]); await turn();
  ui.action(action('add', { id: 'p1' }) as HTMLElement);
  for (let index = 0; index < 5; index++) ui.action(action('add-image') as HTMLElement);
  assert.equal(ui.state().draft?.items.length, 5);
  ui.action(action('up', { index: '1' }) as HTMLElement);
  assert.deepEqual(ui.state().draft?.items.map(item => item.topicId), [null, 'p1', null, null, null]);
  ui.action(action('scope', { scope: 'qa' }) as HTMLElement); await turn();
  assert.equal(ui.state().draft?.items.length, 0);
  ui.action(action('scope', { scope: 'home' }) as HTMLElement);
  assert.equal(ui.state().draft?.items.length, 5);
  ui.action(action('cancel') as HTMLElement);
  assert.equal(ui.state().draft?.items.length, 0);
});
