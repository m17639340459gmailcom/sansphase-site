import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { parseRoute } from '../src/core.mjs';
import { communityRoute, inCommunityArea } from '../src/community.mjs';

const source = await readFile(new URL('../src/app.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('app.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

function appHandlers() {
  const state = ast.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'communityManagementSwitch'));
  const remember = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'rememberCommunityManagementSwitch');
  const listeners = ast.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression));
  const click = listeners.find(node => node.expression.expression.getText(ast) === 'document.addEventListener'
    && node.expression.arguments[0]?.text === 'click'
    && node.expression.arguments[1]?.getText(ast) === 'rememberCommunityManagementSwitch');
  const change = listeners.find(node => node.expression.expression.getText(ast) === 'window.addEventListener'
    && node.expression.arguments[0]?.text === 'hashchange');
  assert.ok(state && remember && click && change, 'the application must record and consume only explicit management content switches');
  // Execute the actual application listeners, rather than copying their logic.
  // Other app boot tasks are unrelated to these navigation decisions.
  return [state, remember, click, change].map(node => node.getText(ast)).join('\n');
}

function setup(t, hash = '#/community/manage/content') {
  const dom = new JSDOM('<main tabindex="-1"></main><div id="home-root"></div>', {
    url: `http://localhost/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window, main = w.document.querySelector('main');
  let top = 418;
  const scrolls = [], renders = [];
  Object.defineProperty(w, 'scrollY', { get: () => top });
  w.scrollTo = options => { scrolls.push(options); top = options.top; };
  const context = dom.getInternalVMContext();
  Object.assign(context, {
    parseRoute, communityRoute, inCommunityArea, communityEnabled: () => true, main,
    homeRoot: w.document.getElementById('home-root'),
    communityFrame: { enabled: () => communityRoute(w.location.hash).view !== 'manage', center: () => main },
    routeTransitions: { run: (_from, _to, update) => update() },
    render: (options = {}) => {
      renders.push(JSON.parse(JSON.stringify(options)));
      if (!options.preserveScroll) top = 0;
      return Promise.resolve();
    },
  });
  vm.runInContext(`let searchTimer; let loadedContentKey = '';\n${appHandlers()}`, context);
  const press = (href, marker = 'reports', init = {}, cancelled = false, attributes = {}) => {
    const link = w.document.createElement('a');
    link.setAttribute('href', href);
    for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
    if (marker !== null) link.dataset.communityManagementSwitch = marker;
    const label = w.document.createElement('span'); link.append(label); main.append(link);
    const event = new w.MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    // Dispatch on document with the real nested target, avoiding JSDOM's
    // deferred default anchor navigation; the hash event is controlled below.
    Object.defineProperty(event, 'target', { value: label });
    if (cancelled) event.preventDefault();
    w.document.dispatchEvent(event);
    return event;
  };
  const navigate = hash => {
    const oldURL = w.location.href;
    w.history.replaceState(null, '', hash);
    w.dispatchEvent(new w.HashChangeEvent('hashchange', { oldURL, newURL: w.location.href }));
  };
  return { w, press, navigate, renders, scrolls, top: () => top };
}

test('management queue and report cards preserve the current document position for mouse and keyboard activation', t => {
  for (const [href, marker, detail] of [['#/community/manage', 'queue', 1], ['#/community/manage/reports', 'reports', 0]]) {
    const fixture = setup(t);
    fixture.press(href, marker, { detail }); fixture.navigate(href);
    assert.deepEqual(fixture.renders, [{ preserveScroll: true }]);
    assert.equal(fixture.top(), 418);
    assert.equal(fixture.scrolls.length, 0, 'content switches must not issue a reset to zero');
  }
});

test('ordinary management sidebar navigation still starts at the top', t => {
  const fixture = setup(t);
  fixture.press('#/community/manage/reports', null); fixture.navigate('#/community/manage/reports');
  assert.deepEqual(fixture.renders, [{}]);
  assert.equal(fixture.top(), 0);
  assert.equal(fixture.scrolls.length, 1);
  assert.equal(fixture.scrolls[0].top, 0);
});

test('modified, cancelled and foreign marked links never preserve a later navigation', t => {
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { button: 1 }]) {
    const fixture = setup(t);
    fixture.press('#/community/manage/reports', 'reports', init); fixture.navigate('#/community/manage/reports');
    assert.deepEqual(fixture.renders, [{}]);
  }
  const cancelled = setup(t);
  cancelled.press('#/community/manage/reports', 'reports', {}, true); cancelled.navigate('#/community/manage/reports');
  assert.deepEqual(cancelled.renders, [{}]);
  const foreign = setup(t, '#/community/home');
  foreign.press('#/community/manage/reports', 'reports'); foreign.navigate('#/community/manage/reports');
  assert.deepEqual(foreign.renders, [{}]);
  for (const attributes of [{ target: '_blank' }, { download: '' }]) {
    const fixture = setup(t);
    fixture.press('#/community/manage/reports', 'reports', {}, false, attributes); fixture.navigate('#/community/manage/reports');
    assert.deepEqual(fixture.renders, [{}]);
  }
  for (const [href, marker] of [['#/community/manage/items', 'reports'], ['#/community/manage/reports', 'queue']]) {
    const fixture = setup(t);
    fixture.press(href, marker); fixture.navigate(href);
    assert.deepEqual(fixture.renders, [{}]);
  }
});

test('switch preservation is consumed once and cannot survive mismatching or repeated destinations', t => {
  const fixture = setup(t);
  fixture.press('#/community/manage/reports', 'reports'); fixture.navigate('#/community/manage/reports');
  fixture.navigate('#/community/manage/content'); fixture.navigate('#/community/manage/reports');
  assert.deepEqual(fixture.renders, [{ preserveScroll: true }, {}, {}]);
  const mismatched = setup(t);
  mismatched.press('#/community/manage/reports', 'reports'); mismatched.navigate('#/community/manage');
  mismatched.navigate('#/community/manage/reports');
  assert.deepEqual(mismatched.renders, [{}, {}]);
  const current = setup(t, '#/community/manage/reports');
  const event = current.press('#/community/manage/reports', 'reports');
  assert.equal(event.defaultPrevented, true, 'choosing the already displayed queue is a no-op');
  current.navigate('#/community/manage/content'); current.navigate('#/community/manage/reports');
  assert.deepEqual(current.renders, [{}, {}]);
});
