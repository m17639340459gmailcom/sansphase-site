import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parseRoute } from '../src/core.ts';
import { publicRoute } from '../src/access-policy.ts';
import { communityView, inCommunityArea } from '../src/community.ts';
import { communityHostRoute, communityEntryDestination } from '../src/community-entry.ts';
import { createDeferredModuleLoader } from '../src/admin-route.ts';

const app = readFileSync(new URL('../src/app.mjs', import.meta.url), 'utf8');
const renderSource = app.slice(app.indexOf('async function render(options={})'), app.indexOf('function renderView('));
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

test('published main entry does not eagerly fetch community controllers, templates or layout', () => {
  const visited = new Set();
  function visit(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = ts.createSourceFile(url.pathname, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) visit(new URL(specifier.text, url));
    }
  }
  visit(new URL('../dist/app.mjs', import.meta.url));
  for (const path of ['community-ui.mjs', 'community.mjs', 'community-layout.mjs', 'community-runtime-client.mjs', 'community-management.mjs']) {
    assert.equal(visited.has(new URL('../dist/' + path, import.meta.url).href), false, path + ' belongs to the deferred community graph');
  }
});

function setup(hash = '#/community/home') {
  const rendered = [], activated = [];
  let resolveModule, rejectModule;
  const pending = new Promise((resolve, reject) => { resolveModule = resolve; rejectModule = reject; });
  pending.catch(() => {});
  let imports = 0;
  const context = {
    siteContent: { communityEnabled: true, reader: { nickname: '当前账号' } },
    location: { hash, pathname: '/', search: '' },
    communityOnly: () => false, communityEnabled: () => true,
    communityHostRoute, communityEntryDestination, communityView, inCommunityArea, parseRoute, publicRoute,
    communityEntry: { cancel() {} }, communityModule: null,
    loadCommunityRuntime: () => { imports++; return pending; },
    activateCommunityRuntime: module => { activated.push(module); context.communityModule = module; },
    readerAccessEnabled: true, renderGeneration: 0,
    communityStyleReady: true, ensureRouteStyle: async () => {},
    prepareCommunityLanding: async () => {},
    contentReader: { cancel() {}, presentation: { release() {} } },
    loadedContentKey: '', remotePage: null, filterPage: '',
    activeCategory: '', activeQuery: '', catalogPageNumber: 1,
    window: {}, renderView: options => rendered.push({ ...options, hash: context.location.hash }),
  };
  vm.createContext(context);
  vm.runInContext(renderSource + '\nglobalThis.render = render;', context);
  return { context, rendered, activated, resolveModule, rejectModule, imports: () => imports };
}

test('first forum render waits for its runtime and commits once; subsequent routes stay synchronous', async () => {
  const s = setup();
  const pending = s.context.render(); await turn();
  assert.equal(s.rendered.length, 0, 'no unconnected forum controls are painted');
  assert.equal(s.imports(), 1);
  s.resolveModule({ ready: true }); await pending;
  assert.equal(s.activated.length, 1); assert.equal(s.rendered.length, 1);
  s.context.location.hash = '#/community/u/10004/frames';
  const next = s.context.render();
  assert.equal(s.rendered.length, 2, 'the persistent forum is not blanked on every tab switch');
  await next; assert.equal(s.imports(), 1);
});

test('ordinary pages and signed-out gates do not load the forum runtime', async () => {
  for (const hash of ['#/notes', '#/account', '#/community/home']) {
    const s = setup(hash);
    if (hash === '#/community/home') s.context.siteContent.reader = null;
    await s.context.render();
    assert.equal(s.imports(), 0); assert.equal(s.activated.length, 0);
    assert.equal(s.rendered.length, 1);
    if (hash === '#/community/home') assert.equal(s.rendered[0].contentStatus, 'auth');
  }
});

test('the shared community introduction prepares its own scene without loading forum controls', async () => {
  const s = setup('#/community');
  let imported = 0, prepared = 0;
  s.context.loadCommunityRuntime = async () => { imported++; return { ready: true }; };
  s.context.prepareCommunityLanding = async () => { prepared++; };
  await s.context.render();
  assert.equal(prepared, 1);
  assert.equal(imported, 0);
  assert.equal(s.activated.length, 0);
  assert.equal(s.rendered.length, 1);
  assert.equal(s.rendered[0].hash, '#/community');
});

test('late runtime success or failure cannot activate or overwrite a newer ordinary page', async () => {
  for (const failure of [false, true]) {
    const s = setup();
    const pending = s.context.render(); await turn();
    s.context.location.hash = '#/notes'; await s.context.render();
    if (failure) s.rejectModule(new Error('runtime unavailable')); else s.resolveModule({ ready: true });
    await pending;
    assert.equal(s.activated.length, 0); assert.equal(s.rendered.length, 1);
    assert.equal(s.rendered[0].hash, '#/notes');
  }
});

test('runtime failure shows the existing retry state; stale identity gates keep the module inactive', async () => {
  const s = setup();
  const pending = s.context.render(); await turn(); s.rejectModule(new Error('offline')); await pending;
  assert.equal(s.activated.length, 0); assert.equal(s.rendered[0].contentStatus, 'error');
  const changing = setup();
  const preparing = changing.context.render(); await turn();
  changing.context.siteContent.reader = null; await changing.context.render();
  changing.resolveModule({ ready: true }); await preparing;
  assert.equal(changing.activated.length, 0);
  assert.equal(changing.rendered.length, 1); assert.equal(changing.rendered[0].contentStatus, 'auth');
});

test('a runtime deadline reveals retry and an old import cannot replace the successful retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  const releases = [];
  s.context.loadCommunityRuntime = createDeferredModuleLoader(() => new Promise(resolve => {
    releases.push(resolve);
  }), { timeoutMs: 10 });

  const first = s.context.render();
  await Promise.resolve();
  assert.equal(releases.length, 1);
  assert.equal(s.rendered.length, 0, 'preparing controls remain hidden');
  t.mock.timers.tick(10);
  await first;
  assert.equal(s.activated.length, 0);
  assert.equal(s.context.communityModule, null);
  assert.equal(s.rendered.length, 1);
  assert.equal(s.rendered[0].contentStatus, 'error', 'the actual dispatcher commits its retry state');

  const retry = s.context.render();
  await Promise.resolve();
  assert.equal(releases.length, 2, 'retry starts a fresh bounded attempt');
  releases[0]({ stale: true });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(s.activated.length, 0, 'the expired import cannot activate controllers');
  assert.equal(s.rendered.length, 1);

  const current = { ready: true };
  releases[1](current);
  await retry;
  assert.deepEqual(s.activated, [current]);
  assert.equal(s.context.communityModule, current);
  assert.equal(s.rendered.length, 2);
  assert.notEqual(s.rendered[1].contentStatus, 'error');

  t.mock.timers.tick(1000);
  assert.equal(s.rendered.length, 2, 'settled deadline timers do not commit additional states');
  s.context.location.hash = '#/community/u/10004/frames';
  const next = s.context.render();
  assert.equal(s.rendered.length, 3, 'already prepared tab navigation remains synchronous');
  await next;
  assert.equal(releases.length, 2);
});
