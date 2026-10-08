import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const bundle = await build({
  entryPoints: ['src/community-select.tsx'], bundle: true, write: false,
  format: 'iife', globalName: 'CommunitySelectTest', platform: 'browser',
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  footer: { js: 'window.CommunitySelectTest = CommunitySelectTest;' },
});
const source = bundle.outputFiles[0].text;
const icons = { check: '<svg aria-hidden="true"><path d="M0 0"/></svg>', 'chevron-down': '<svg aria-hidden="true"><path d="M1 1"/></svg>', 'chevron-up': '<svg aria-hidden="true"><path d="M2 2"/></svg>' };
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

function setup(content) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  virtualConsole.on('error', error => errors.push(error));
  const dom = new JSDOM(`<!doctype html><body>${content}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole, url: 'https://example.test/' });
  const win = dom.window;
  win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.HTMLElement.prototype.hasPointerCapture = function () { return false; };
  win.HTMLElement.prototype.releasePointerCapture = function () {};
  win.HTMLElement.prototype.setPointerCapture = function () {};
  const focusCalls = [];
  const nativeFocus = win.HTMLElement.prototype.focus;
  win.HTMLElement.prototype.focus = function (options) { focusCalls.push({ node: this, options }); nativeFocus.call(this, options); };
  win.eval(source);
  const select = win.document.querySelector('select');
  const control = win.CommunitySelectTest.mountCommunitySelect(select, icons);
  const trigger = () => win.document.querySelector('.community-select-trigger');
  const key = (node, value) => node.dispatchEvent(new win.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  const open = async () => { trigger().click(); await settle(); };
  const close = async () => { key(win.document.activeElement, 'Escape'); await settle(); };
  const dispose = () => { control.dispose(); dom.window.close(); assert.deepEqual(errors, [], 'the real Radix component must run without runtime errors'); };
  return { dom, win, select, control, trigger, key, open, close, dispose, focusCalls };
}

test('custom dropdown keeps one named native form field and connects the existing label', async () => {
  const env = setup('<form><label for="category">类别</label><select name="category" id="category"><option value="">未分类</option><option value="frame">头像框</option></select></form>');
  await settle();
  assert.equal(env.select.hidden, true);
  assert.ok(env.select.hasAttribute('data-community-select-native'));
  assert.equal(env.select.disabled, false);
  assert.equal(env.win.document.querySelector('label').control, env.trigger());
  assert.match(env.trigger().textContent, /未分类/);
  assert.equal(env.trigger().getAttribute('role'), 'combobox');
  assert.deepEqual([...new env.win.FormData(env.win.document.querySelector('form'))], [['category', '']]);
  assert.equal(env.win.CommunitySelectTest.mountCommunitySelect(env.select, icons), env.control);
  assert.equal(env.win.document.querySelectorAll('.community-select-host').length, 1);
  env.dispose();
});

test('selection writes back to native select and dispatches one bubbling change', async () => {
  const env = setup('<form><select name="kind"><option value="">请选择</option><option value="frame">头像框</option><option value="color">昵称特效</option></select></form>');
  const changes = [];
  env.win.document.querySelector('form').addEventListener('change', event => { if (event.target === env.select) changes.push(env.select.value); });
  await env.open();
  const option = [...env.win.document.querySelectorAll('[role="option"]')].find(node => node.textContent.includes('昵称特效'));
  option.click();
  await settle();
  assert.equal(env.select.value, 'color');
  assert.deepEqual(changes, ['color']);
  assert.match(env.trigger().textContent, /昵称特效/);
  assert.deepEqual([...new env.win.FormData(env.win.document.querySelector('form'))], [['kind', 'color']]);
  await env.open();
  [...env.win.document.querySelectorAll('[role="option"]')].find(node => node.textContent.includes('请选择')).click();
  await settle();
  assert.equal(env.select.value, '');
  assert.match(env.trigger().textContent, /请选择/);
  env.dispose();
});

test('enhancement exposes only the original field change and ignores unchanged updates', async () => {
  const env = setup('<form><label for="mode">模式</label><select id="mode" name="mode"><option value="a">星海</option><option value="b">流光</option></select></form>');
  await settle();
  const changes = [];
  env.win.document.querySelector('form').addEventListener('change', event => changes.push({ original: event.target === env.select, value: event.target.value }));
  env.control.update();
  env.select.dispatchEvent(new env.win.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(changes, [{ original: true, value: 'a' }]);
  changes.length = 0;
  await env.open();
  [...env.win.document.querySelectorAll('[role="option"]')].find(node => node.textContent.includes('流光')).click();
  await settle();
  assert.deepEqual(changes, [{ original: true, value: 'b' }], 'Radix presentation controls must not leak a second unnamed change into the existing controller');
  env.dispose();
});

test('label and ARIA metadata updates remain visible when selection is unchanged', async () => {
  const env = setup('<label for="meta">模式</label><select id="meta" name="mode"><option value="a">星海</option></select><span id="hint">提示</span>');
  await settle();
  const trigger = env.trigger();
  env.select.setAttribute('aria-label', '新的模式');
  env.select.setAttribute('aria-describedby', 'hint');
  env.select.title = '查看模式';
  env.select.required = true;
  await settle();
  assert.equal(env.trigger(), trigger);
  assert.equal(trigger.getAttribute('aria-label'), '新的模式');
  assert.equal(trigger.getAttribute('aria-describedby'), 'hint');
  assert.equal(trigger.title, '查看模式');
  assert.equal(trigger.getAttribute('aria-required'), 'true');
  env.select.options[0].textContent = '星海更新';
  await settle();
  assert.match(trigger.textContent, /星海更新/);
  env.dispose();
});

test('keyboard navigation skips disabled options and optgroups, while Escape retains the value', async () => {
  const env = setup('<label>品类<select><option value="a">默认</option><option value="b" disabled>不可用</option><optgroup label="装扮"><option value="c">头像框</option></optgroup><optgroup label="暂停" disabled><option value="d">暂停项</option></optgroup></select></label>');
  env.trigger().focus();
  env.key(env.trigger(), 'ArrowDown');
  await settle();
  assert.equal(env.trigger().getAttribute('aria-expanded'), 'true');
  assert.equal(env.win.document.querySelector('[role="group"]').getAttribute('aria-labelledby') !== null, true);
  const disabled = [...env.win.document.querySelectorAll('[role="option"]')].filter(node => node.hasAttribute('data-disabled'));
  assert.equal(disabled.length, 2);
  env.key(env.win.document.activeElement, 'ArrowDown');
  await settle();
  assert.match(env.win.document.activeElement.textContent, /头像框/);
  await env.close();
  assert.equal(env.select.value, 'a');
  assert.equal(env.win.document.querySelector('[role="listbox"]'), null);
  assert.equal(env.win.document.activeElement, env.trigger());
  assert.equal(env.focusCalls.at(-1).options?.preventScroll, true);
  env.dispose();
});

test('native change, new categories and disabled state synchronise without remounting', async () => {
  const env = setup('<select><option value="">未分类</option><option value="first">第一类</option></select>');
  const trigger = env.trigger();
  env.select.value = 'first';
  env.select.dispatchEvent(new env.win.Event('change', { bubbles: true }));
  await settle();
  assert.match(trigger.textContent, /第一类/);
  const option = new env.win.Option('新增类别', 'second');
  env.select.append(option);
  option.selected = true;
  await settle();
  assert.equal(env.trigger(), trigger);
  assert.match(trigger.textContent, /新增类别/);
  env.select.disabled = true;
  await settle();
  assert.equal(trigger.disabled, true);
  trigger.click();
  await settle();
  assert.equal(env.win.document.querySelector('[role="listbox"]'), null);
  env.select.disabled = false;
  await settle();
  await env.open();
  assert.ok([...env.win.document.querySelectorAll('[role="option"]')].some(node => node.textContent.includes('新增类别')));
  await env.close();
  env.dispose();
});

test('replacing available options while open retains the trigger and updates labels, choices and native form value', async () => {
  const env = setup('<form><label for="board-icon">板块图标</label><select id="board-icon" name="icon"><option value="cpu">芯片</option><option value="bot">机器人</option><option value="sparkles">灵感</option></select></form>');
  try {
    const trigger = env.trigger();
    await env.open();
    const menu = env.win.document.querySelector('[role="listbox"]');
    assert.ok(menu);
    assert.match(trigger.textContent, /芯片/);

    // A completed board creation consumes its icon. Patch the existing native
    // field while its enhanced menu is open, then choose the next reserve.
    env.select.replaceChildren(
      new env.win.Option('机器人', 'bot', true, true),
      new env.win.Option('灵感', 'sparkles'),
    );
    await settle();

    assert.equal(env.trigger(), trigger, 'the existing trigger and its focus target remain attached');
    assert.equal(env.win.document.querySelector('[role="listbox"]'), menu, 'the open menu updates in place');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(env.select.value, 'bot');
    assert.match(trigger.textContent, /机器人/);
    const choices = [...menu.querySelectorAll('[role="option"]')];
    assert.deepEqual(choices.map(option => option.textContent), ['机器人', '灵感']);
    assert.deepEqual(choices.filter(option => option.dataset.state === 'checked').map(option => option.textContent), ['机器人']);

    choices.find(option => option.textContent === '灵感').click();
    await settle();
    assert.equal(env.trigger(), trigger);
    assert.equal(env.select.value, 'sparkles');
    assert.match(trigger.textContent, /灵感/);
    assert.deepEqual([...new env.win.FormData(env.win.document.querySelector('form'))], [['icon', 'sparkles']]);
    assert.equal(env.win.document.querySelector('[role="listbox"]'), null);
  } finally {
    env.dispose();
  }
});

test('dropdown portals stay inside their enclosing dialog and option text is not HTML', async () => {
  const env = setup('<section role="dialog"><label for="item">项目</label><select id="item"><option value="a">&lt;img src=x onerror=alert(1)&gt;</option></select></section>');
  await env.open();
  const menu = env.win.document.querySelector('.community-select-menu');
  assert.equal(menu.closest('[role="dialog"]'), env.win.document.querySelector('[role="dialog"]'));
  assert.equal(menu.querySelector('img'), null);
  assert.match(menu.textContent, /<img src=x onerror=alert\(1\)>/);
  await env.close();
  env.dispose();
});

test('form reset restores the original selection and disposal restores native labels and attributes', async () => {
  const env = setup('<form><label for="which">选择</label><select id="which" name="which" aria-describedby="hint"><option value="a">初始</option><option value="b">之后</option></select><small id="hint">说明</small></form>');
  const label = env.win.document.querySelector('label');
  let resetChanges = 0;
  env.select.addEventListener('change', () => { resetChanges++; });
  env.select.value = 'b';
  env.control.update();
  await settle();
  assert.match(env.trigger().textContent, /之后/);
  assert.equal(env.trigger().getAttribute('aria-describedby'), 'hint');
  env.win.document.querySelector('form').reset();
  await settle();
  assert.equal(env.select.value, 'a');
  assert.match(env.trigger().textContent, /初始/);
  assert.equal(resetChanges, 0, 'reset must preserve native reset behaviour without emitting an extra change');
  env.control.dispose();
  assert.equal(env.select.hidden, false);
  assert.equal(env.select.hasAttribute('data-community-select-native'), false);
  assert.equal(label.getAttribute('for'), 'which');
  assert.equal(label.hasAttribute('id'), false);
  assert.equal(label.control, env.select);
  assert.equal(env.win.document.querySelector('.community-select-host'), null);
  env.select.append(new env.win.Option('after dispose', 'c'));
  env.select.dispatchEvent(new env.win.Event('change', { bubbles: true }));
  await settle();
  assert.equal(env.win.document.querySelector('.community-select-host'), null);
  env.dispose();
});

test('native required validation focuses the enhanced trigger without scrolling', async () => {
  const env = setup('<form><label for="required-kind">必填类别</label><select id="required-kind" name="kind" required><option value="">请选择</option><option value="frame">头像框</option></select></form>');
  await settle();
  assert.equal(env.trigger().getAttribute('aria-required'), 'true');
  assert.equal(env.win.document.querySelector('form').reportValidity(), false);
  assert.equal(env.win.document.activeElement, env.trigger());
  assert.equal(env.focusCalls.at(-1).options?.preventScroll, true);
  assert.equal(env.trigger().getAttribute('aria-invalid'), 'true');
  assert.equal(env.select.getAttribute('aria-invalid'), 'true');
  await env.open();
  [...env.win.document.querySelectorAll('[role="option"]')].find(node => node.textContent.includes('头像框')).click();
  await settle();
  assert.equal(env.win.document.querySelector('form').reportValidity(), true);
  assert.equal(env.trigger().hasAttribute('aria-invalid'), false);
  assert.equal(env.select.hasAttribute('aria-invalid'), false);
  env.dispose();
});

test('a stable trigger ID allows keyboard focus to restore after rebuilding the field', async () => {
  const env = setup('<label for="author-category">类别</label><select id="author-category"><option value="a">分类</option></select>');
  await settle();
  env.trigger().focus();
  const focusedId = env.win.document.activeElement.id;
  assert.equal(focusedId, 'author-category-trigger');
  env.control.dispose();
  const nextSelect = env.select.cloneNode(true);
  env.select.replaceWith(nextSelect);
  const rebuilt = env.win.CommunitySelectTest.mountCommunitySelect(nextSelect, icons);
  await settle();
  env.win.document.getElementById(focusedId).focus({ preventScroll: true });
  assert.equal(env.win.document.activeElement, env.trigger());
  assert.equal(env.focusCalls.at(-1).options?.preventScroll, true);
  rebuilt.dispose();
  env.dispose();
});

test('trigger IDs avoid existing nodes and invalid feedback mirrors native changes', async () => {
  const env = setup('<div id="author-kind-trigger">existing</div><label for="author-kind">类型</label><select id="author-kind" aria-invalid="true"><option value="a">初始</option><option value="b">头像框</option></select>');
  await settle();
  assert.equal(env.trigger().id, 'author-kind-trigger-1');
  assert.equal(env.win.document.querySelector('label').control, env.trigger());
  assert.equal(env.trigger().getAttribute('aria-invalid'), 'true');
  env.select.setAttribute('aria-invalid', 'false');
  await settle();
  assert.equal(env.trigger().getAttribute('aria-invalid'), 'false');
  env.select.setAttribute('aria-invalid', 'true');
  await settle();
  await env.open();
  [...env.win.document.querySelectorAll('[role="option"]')].find(node => node.textContent.includes('头像框')).click();
  await settle();
  assert.equal(env.select.value, 'b');
  assert.equal(env.select.hasAttribute('aria-invalid'), false);
  assert.equal(env.trigger().hasAttribute('aria-invalid'), false);
  env.dispose();
});
