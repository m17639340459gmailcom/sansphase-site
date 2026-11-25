import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

async function clientBundle() {
  return build({ entryPoints: ['src/teahouse/client.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'session-peer', setup(builder) {
      builder.onResolve({ filter: /^socket\.io-client$/ }, () => ({ path: 'peer', namespace: 'session-peer' }));
      builder.onLoad({ filter: /.*/, namespace: 'session-peer' }, () => ({ contents: 'export const io = options => globalThis.makeTestSocket(options);', loader: 'js' }));
    } }] });
}

test('a different HTTP identity replaces the old socket and clears private state before another write', async t => {
  const bundle = await clientBundle();
  const dom = new JSDOM(await readFile('src/teahouse/index.html', 'utf8'), { url: 'http://localhost/teahouse', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom, { document } = window;
  let handlers = new Map();
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.Headers = Headers;
  window.BroadcastChannel = undefined;
  let actor = { kind: 'owner', id: 'owner-id', uid: 'owner', name: '旧作者身份', role: 'owner', vip: false }, connections = 0, oldAck;
  const sockets = [], flushed = [];
  window.makeTestSocket = options => {
    const listeners = new Map(); handlers = listeners;
    const socket = { connects: 0, connected: false, sendBuffer: [],
      on(event, listener) { listeners.set(event, listener); },
      connect() { connections++; socket.connects++; socket.connected = true; for (const item of socket.sendBuffer.splice(0)) flushed.push({ ...item, author: actor.id }); listeners.get('connect')?.(); },
      disconnect() { if (socket.connected) { socket.connected = false; listeners.get('disconnect')?.(); } },
      loseConnection() { socket.connected = false; listeners.get('disconnect')?.(); if (options.reconnection) queueMicrotask(() => socket.connect()); },
      timeout() { return { emit(event, payload, callback) { if (!socket.connected) socket.sendBuffer.push({ event, payload }); if (event === 'message:send') oldAck = callback; } }; },
    }; sockets.push(socket); return socket;
  };
  const oldMessage = { id: 'private-message', seq: 1, revisionSeq: 1, author: actor, createdAt: new Date().toISOString(), withdrawn: false, text: '旧身份尚未确认的消息', attachments: [] };
  window.fetch = async path => ({ ok: true, json: async () => path.endsWith('/session')
    ? { actor, serverTime: Date.now() } : path.includes('/messages?') ? { messages: [], cursor: 0, hasMore: false } : { announcements: [] } });
  window.eval(bundle.outputFiles[0].text);
  const waitFor = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.fail('Client did not settle after an identity change');
  };
  const input = document.querySelector('#message-input');
  await waitFor(() => !input.disabled);
  const account = document.querySelector('#current-person'), menu = document.querySelector('#account-menu');
  assert.equal(account.tagName, 'BUTTON', 'the account entry must support native mouse and keyboard activation');
  assert.equal(account.disabled, false);
  assert.equal(menu.hidden, true);
  account.click();
  assert.equal(account.getAttribute('aria-expanded'), 'true');
  assert.equal(menu.hidden, false);
  assert.equal(menu.querySelector('a').getAttribute('href'), '/#/community/u/owner');
  assert.equal(document.activeElement, menu.querySelector('a'));
  input.value = '打开个人菜单不会丢失草稿';
  menu.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(document.activeElement.getAttribute('href'), '/#/community/stardust');
  menu.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, account);
  assert.equal(input.value, '打开个人菜单不会丢失草稿');
  account.click(); input.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert.equal(menu.hidden, true, 'outside pointer press closes the menu');
  account.click(); input.focus();
  assert.equal(menu.hidden, true, 'keyboard focus leaving the account area closes the menu');
  account.click();
  handlers.get('message:changed')(oldMessage);
  input.value = '旧身份私有草稿'; input.dispatchEvent(new window.Event('input'));
  document.querySelector('#composer').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await waitFor(() => Boolean(oldAck));
  actor = { kind: 'reader', id: 'reader-id', uid: '357341', name: '新的个人身份', role: null, vip: true };
  document.dispatchEvent(new window.Event('visibilitychange'));
  await waitFor(() => document.querySelector('#current-person').textContent.includes(actor.name) && !input.disabled);
  assert.equal(connections, 2, 'identity switching must establish a socket with current cookies');
  assert.equal(menu.hidden, true, 'identity changes close the old account menu');
  account.click();
  assert.equal(menu.querySelector('a').getAttribute('href'), '/#/community/u/357341');
  assert.doesNotMatch(menu.innerHTML, /owner-id|reader-id|\/u\/owner/);
  assert.equal(menu.querySelectorAll('a').length, 4);
  account.click();
  assert.equal(sockets.length, 2, 'old offline send buffers must belong to an abandoned socket instance');
  assert.equal(sockets[0].connects, 1);
  assert.equal(input.value, '');
  assert.equal(document.querySelectorAll('[data-message-id]').length, 0);
  input.value = '新身份草稿'; input.dispatchEvent(new window.Event('input'));
  oldAck(null, { ok: true, data: oldMessage });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(input.value, '新身份草稿', 'an old ACK must not clear the new identity draft');
  assert.equal(document.querySelectorAll('[data-message-id]').length, 0);

  document.cookie = 'community_browse=reader';
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
  assert.equal(input.value, '', 'BFCache must not retain a visible private draft');
  assert.equal(input.disabled, true);
  assert.equal(account.disabled, true);
  assert.equal(menu.children.length, 0, 'BFCache must not retain account links from a previous identity');
  window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
  await waitFor(() => !input.disabled);
  assert.equal(connections, 3);
  actor = { ...actor, role: 'moderator' };
  input.value = '另一个权限下的草稿';
  handlers.get('access:revoked')({ error: '身份变化', reason: 'identity-changed' });
  await waitFor(() => !input.disabled);
  assert.equal(connections, 4);
  assert.equal(input.value, '');
  input.value = '临时故障保留的草稿';
  for (let i = 0; i < 5; i++) handlers.get('connect_error')(Object.assign(Error('暂时不可用'), { data: { status: 503 } }));
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(connections, 5, 'repeated temporary middleware failures share one retry timer');
  assert.equal(input.value, '临时故障保留的草稿');

  const disconnected = sockets.at(-1);
  // Transport loss can precede the application's disconnect notification.
  disconnected.connected = false;
  input.value = '不能进入断线缓存'; input.dispatchEvent(new window.Event('input'));
  document.querySelector('#composer').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(disconnected.sendBuffer, [], 'an actual disconnected socket must never accept a write into its offline buffer');
  // Model Socket.IO emitBuffered running before its public connect callback.
  disconnected.sendBuffer.push({ event: 'message:send', payload: { text: '旧身份缓存' } });
  actor = { kind: 'owner', id: 'other-owner', name: '离线切换后的作者', role: 'owner', vip: false };
  disconnected.loseConnection();
  await new Promise(resolve => setTimeout(resolve, 1100));
  await waitFor(() => !input.disabled && document.querySelector('#current-person').textContent.includes(actor.name));
  assert.deepEqual(flushed, [], 'reconnect must verify the new identity before any old transport buffer can flush');
  assert.equal(disconnected.connects, 1);
  assert.equal(input.value, '', 'offline identity switching clears the previous private draft');

  input.value = '同身份待确认内容'; input.dispatchEvent(new window.Event('input'));
  document.querySelector('#composer').dispatchEvent(new window.Event('submit', { cancelable: true }));
  const delayedAck = oldAck, beforeRecovery = sockets.at(-1);
  beforeRecovery.loseConnection();
  await new Promise(resolve => setTimeout(resolve, 1100));
  await waitFor(() => sockets.at(-1) !== beforeRecovery && sockets.at(-1).connected);
  input.value = '恢复后保留的草稿';
  delayedAck(null, { ok: true, data: { ...oldMessage, author: actor } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(input.value, '恢复后保留的草稿', 'a retired transport ACK cannot clear a draft even when the account is unchanged');
  assert.equal(document.querySelectorAll('[data-message-id]').length, 0);
  const completedConnections = connections;
  handlers.get('access:revoked')({ error: 'VIP 已失效' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(input.disabled, true);
  assert.equal(connections, completedConnections, 'real access revocation must not reconnect in a loop');
});

test('tea room recall follows server time even if the device clock changes during the session', async t => {
  const bundle = await clientBundle();
  const dom = new JSDOM(await readFile('src/teahouse/index.html', 'utf8'), { url: 'http://localhost/teahouse', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom, { document } = window;
  const serverTime = Date.parse('2026-10-13T08:00:00Z');
  let deviceTime = serverTime - 10_000, elapsed = 0, sessionCalls = 0, recallCalls = 0, withdrawalTick;
  window.Date.now = () => deviceTime;
  Object.defineProperty(window.performance, 'now', { value: () => elapsed });
  const setInterval = window.setInterval.bind(window);
  window.setInterval = (callback, delay) => { if (delay === 15_000) withdrawalTick = callback; return setInterval(callback, 3_600_000); };
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.Headers = Headers;
  window.BroadcastChannel = undefined;
  const actor = { kind: 'reader', id: 'reader-clock', uid: '10001', name: '会员', role: null, vip: true };
  const handlers = new Map();
  window.makeTestSocket = () => {
    const socket = { connected: false,
      on(event, listener) { handlers.set(event, listener); },
      connect() { socket.connected = true; handlers.get('connect')?.(); },
      disconnect() { socket.connected = false; },
      timeout() { return { emit(event, payload, callback) {
        if (event === 'message:withdraw') { recallCalls++; callback(null, { ok: true, data: { ...fresh, id: payload.id, withdrawn: true, revisionSeq: 3, text: undefined } }); }
      } }; },
    };
    return socket;
  };
  window.fetch = async path => ({ ok: true, json: async () => {
    if (path.endsWith('/session')) { sessionCalls++; return { actor, serverTime: serverTime + elapsed }; }
    return path.includes('/messages?') ? { messages: [], cursor: 0, hasMore: false } : { announcements: [] };
  } });
  window.eval(bundle.outputFiles[0].text);
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 5)); };
  await settle();
  assert.equal(document.querySelector('#message-input').disabled, false);
  const expiring = { id: 'near-expiry', seq: 1, revisionSeq: 1, author: actor, createdAt: new Date(serverTime - 299_000).toISOString(), withdrawn: false, text: '还有一秒可撤回', attachments: [] };
  const fresh = { ...expiring, id: 'fresh', seq: 2, revisionSeq: 2, createdAt: new Date(serverTime).toISOString(), text: '新消息' };
  handlers.get('message:changed')(expiring);
  handlers.get('message:changed')(fresh);
  const expiringButton = document.querySelector('[data-message-id="near-expiry"] [data-recall-id]');
  const freshButton = document.querySelector('[data-message-id="fresh"] [data-recall-id]');
  assert.ok(expiringButton); assert.ok(freshButton);
  for (const adjustment of [20_000, -600_000, 86_400_000, -86_400_000]) {
    deviceTime = serverTime + adjustment;
    withdrawalTick();
    assert.equal(expiringButton.hidden, false, `adjustment ${adjustment}ms must not hide an unexpired recall`);
    assert.equal(freshButton.hidden, false);
  }
  elapsed = 1_000;
  withdrawalTick();
  assert.equal(expiringButton.hidden, true, 'the server-relative five-minute boundary still expires');
  assert.equal(freshButton.hidden, false);
  freshButton.click(); await settle();
  assert.equal(recallCalls, 1, 'a local clock adjustment cannot block an allowed recall request');
  const callsBefore = sessionCalls;
  deviceTime -= 10_000;
  document.dispatchEvent(new window.Event('visibilitychange')); await settle();
  assert.ok(sessionCalls > callsBefore, 'foreground synchronization refreshes the existing server time sample');
});
