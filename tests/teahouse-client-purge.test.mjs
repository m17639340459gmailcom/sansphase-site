import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('account purge removes every visible private copy and ignores late history and member snapshots', async t => {
  const html = await readFile('src/teahouse/index.html', 'utf8');
  const bundle = await build({
    entryPoints: ['src/teahouse/client.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'socket-test-peer', setup(builder) {
      builder.onResolve({ filter: /^socket\.io-client$/ }, () => ({ path: 'peer', namespace: 'socket-test-peer' }));
      builder.onLoad({ filter: /.*/, namespace: 'socket-test-peer' }, () => ({ contents: 'export const io = () => globalThis.testSocket;', loader: 'js' }));
    } }],
  });
  const dom = new JSDOM(html, { url: 'http://localhost/teahouse', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom, { document } = window;
  const handlers = new Map();
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.Headers = Headers;
  window.testSocket = {
    connected: true,
    on(event, listener) { handlers.set(event, listener); },
    connect() { handlers.get('connect')?.(); }, disconnect() {},
  };
  const member = { kind: 'reader', id: 'deleted-reader', name: '待注销昵称', avatarUrl: '/old-avatar.webp', icon: 'vip:1', vip: true, role: 'moderator' };
  const message = { id: 'message', seq: 1, revisionSeq: 1, author: member, createdAt: new Date().toISOString(), withdrawn: false, text: '待删除正文', attachments: [{ id: 'picture', url: '/api/teahouse/attachments/picture', mime: 'image/png', size: 40, width: 40, height: 40 }] };
  const notice = { id: 'notice', title: '待删除公告', text: '公告正文', author: member, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1, pinned: true };
  let historyReads = 0;
  window.fetch = async path => { if (path.includes('/messages?')) historyReads++; return { ok: true, json: async () => path.endsWith('/session')
    ? { actor: { kind: 'owner', id: 'owner', name: '作者', role: 'owner', vip: false }, serverTime: Date.now() }
    : path.includes('/messages?') ? { messages: [message], cursor: 1, hasMore: false } : { announcements: [notice] } }; };
  window.eval(bundle.outputFiles[0].text);
  for (let i = 0; i < 30 && !document.querySelector('.message-text'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(document.querySelector('.message-text')?.textContent, message.text);
  const originalNode = document.querySelector('[data-message-id]'), beforeReads = historyReads;
  for (let i = 0; i < 30; i++) handlers.get('history:sync')();
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(historyReads, beforeReads + 1, 'a burst of broadcast recovery hints performs one history read');
  assert.equal(document.querySelector('[data-message-id]'), originalNode, 'unchanged replay does not detach the message or decoded images');
  handlers.get('members:changed')({ members: [member] });
  document.querySelector('[data-preview-image]').click();
  assert.equal(document.querySelector('#image-dialog').open, true);
  document.querySelector('#announcements-open').click();
  document.querySelector('[data-announcement-id]').click();
  document.querySelector('#announcement-edit').click();
  assert.equal(document.querySelector('#announcement-body-input').value, notice.text);
  document.querySelector('#announcement-cancel').click();
  assert.equal(document.querySelector('#announcement-body-input').value, '', 'closing an editor must not retain a hidden private copy');
  document.querySelector('[data-announcement-id]').click();
  document.querySelector('#announcement-edit').click();

  handlers.get('reader:purged')({ id: member.id });
  handlers.get('message:changed')({ ...message, id: 'late-history', seq: 2 });
  handlers.get('announcements:changed')({ announcements: [notice] });
  handlers.get('members:changed')({ members: [member] });

  assert.equal(document.querySelectorAll('.message-text, .message-media, .announcement-card, #member-list li').length, 0);
  assert.equal(document.querySelectorAll('.withdrawn-message').length, 2);
  assert.equal(document.querySelector('#image-dialog').open, false);
  assert.equal(document.querySelector('#lightbox-image').hasAttribute('src'), false);
  assert.equal(document.querySelector('#announcement-body-input').value, '');
  assert.equal(document.querySelector('#announcement-title-input').value, '');
  assert.equal(document.body.textContent.includes(member.name), false);
  assert.equal(document.body.textContent.includes(message.text), false);
  assert.equal(document.body.textContent.includes(notice.text), false);
  assert.equal(document.querySelector('img[src="/old-avatar.webp"]'), null);
});
