import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('draft navigation confirms once, loads the destination and preserves cancelled history', async (t) => {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost/#/community/new', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const globalNames = ['window', 'document', 'location', 'history', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event', 'CustomEvent', 'BeforeUnloadEvent'];
  const previousGlobals = Object.fromEntries(globalNames.map((name) => [name, globalThis[name]]));
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.location = w.location;
  for (const name of globalNames.slice(3)) globalThis[name] = w[name];
  const module = await import('../dist/community-ui.mjs');
  const requests = [];
  const person = { name: '测试成员', uid: 'u1', role: 'reader', level: 1, owner: false, mod: false, balance: 30, checkedIn: true, streak: 1, nextReward: { total: 10 }, unread: { all: 0 }, inventory: {}, agreed: true };
  const request = async (url) => {
    requests.push(url);
    const data = url.endsWith('/me') ? person : url.endsWith('/summary') ? { total: 0, boards: {}, hot: [] } : { items: [], total: 0, page: 1, pageSize: 20 };
    return { ok: true, json: async () => data };
  };
  const ui = module.createCommunityUI({ request });
  const main = w.document.querySelector('main');
  const ctx = { t: zh => zh, esc: s => String(s || ''), icons: {}, members: true };
  let cleanup;
  const render = () => { cleanup?.(); main.innerHTML = ui.html(ctx); cleanup = ui.mount(main, ctx); };
  w.addEventListener('hashchange', render);
  t.after(() => {
    cleanup?.();
    for (const [key, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    w.close();
  });
  let confirmations = 0;
  const waitFor = async (condition, description) => {
    const deadline = performance.now() + 5000;
    while (!condition()) {
      assert.ok(performance.now() < deadline,
        `${description}: hash=${w.location.hash}, page=${main.querySelector('[data-community]')?.dataset.community || 'none'}, confirmations=${confirmations}, requests=${requests.join(', ')}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const homeReady = () => main.querySelector('[data-community="home"] .community-results .community-empty:not([data-content-state]) h3')?.textContent === '这里还没有帖子';
  render();
  await waitFor(() => Boolean(main.querySelector('#community-title')), 'the draft editor becomes ready');
  const title = main.querySelector('#community-title');
  title.value = '未发送的标题';
  title.dispatchEvent(new w.Event('input', { bubbles: true }));
  w.confirm = () => { confirmations++; return true; };
  const beforeHomeRequests = requests.length;
  main.querySelector('a[href="#/community/home"]').click();
  await waitFor(() => confirmations === 1 && homeReady()
    && requests.slice(beforeHomeRequests).some(url => url.endsWith('/summary'))
    && requests.slice(beforeHomeRequests).some(url => url.includes('/topics?')), 'the accepted destination loads after one confirmation');
  assert.equal(confirmations, 1, 'the link and history event share one confirmation');
  assert.ok(requests.slice(beforeHomeRequests).some(url => url.endsWith('/summary')), `the accepted destination refreshes its API data: ${requests.join(', ')}`);
  assert.equal(main.querySelector('[data-community]')?.dataset.community, 'home');
  w.location.hash = '#/community/new';
  await waitFor(() => w.location.hash === '#/community/new' && main.querySelector('#community-title')?.value === '未发送的标题',
    'returning to the editor restores the saved draft');
  assert.equal(main.querySelector('#community-title').value, '未发送的标题');
  const length = w.history.length;
  const state = structuredClone(w.history.state);
  let replacements = 0;
  const replaceState = w.history.replaceState.bind(w.history);
  w.history.replaceState = (...args) => { replacements++; return replaceState(...args); };
  confirmations = 0;
  w.confirm = () => { confirmations++; return false; };
  w.history.back();
  // JSDOM traverses back and forward through separate queued tasks. A fixed
  // delay can finish after cancellation but before the original entry returns.
  await waitFor(() => confirmations === 1 && w.location.hash === '#/community/new'
    && main.querySelector('#community-title')?.value === '未发送的标题', 'cancelled history navigation restores the original draft entry');
  assert.equal(confirmations, 1, 'back navigation asks once');
  assert.equal(w.location.hash, '#/community/new');
  assert.equal(w.history.length, length);
  assert.deepEqual(w.history.state, state);
  assert.equal(replacements, 0, 'cancel returns to the original entry without overwriting any entry');
  w.confirm = () => true;
  w.history.back();
  await waitFor(() => w.location.hash === '#/community/home' && homeReady(),
    'the preceding destination remains reachable after cancellation');
  assert.equal(w.location.hash, '#/community/home', 'the preceding entry survives cancellation');
});
