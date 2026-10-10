import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';
import { bodyImageContent } from '../src/community-body-images.ts';
import { uploadImageFile, waitForImageState } from './fixtures/upload-image-file.mjs';

const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const turn = () => new Promise(resolve => setTimeout(resolve, 30));
test('two inline reply editors retain their own images and draft through quotes, edits, previews and sending', async t => {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost:4214/#/post/p1', pretendToBeVisual: true });
  const w = dom.window;
  const globals = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(globals.map(name => [name, globalThis[name]]));
  for (const name of globals) globalThis[name] = name === 'window' ? w : w[name];
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  const me = { name: '读者', uid: '10001', owner: false, level: 2, agreed: true, inventory: {}, unread: {} };
  const data = {
    topic: { id: 'p1', board: 'qa', title: '讨论', body: '正文', author: me, canReply: true, images: [] },
    author: me, related: [],
    replies: [{ id: 'r1', body: '原回复', author: me, createdAt: '2026-10-05T01:00:00Z', canEdit: true, byTopicAuthor: false }],
  };
  const calls = [];
  let finishUpload;
  const request = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/images')) return new Promise(resolve => { finishUpload = () => resolve({ ok: true, json: async () => ({ id: image }) }); });
    let result;
    if (url.endsWith('/me')) result = me;
    else if (url.endsWith('/topics/p1')) result = data;
    else if (url.endsWith('/replies/r1/edit')) { data.replies[0].body = JSON.parse(init.body).body; result = { ok: true }; }
    else if (url.endsWith('/topics/p1/replies')) {
      data.replies.push({ ...data.replies[0], id: 'r2', body: JSON.parse(init.body).body }); result = { id: 'r2' };
    } else throw Error(`Unexpected request: ${url}`);
    return { ok: true, json: async () => structuredClone(result) };
  };
  const ui = createCommunityUI({ request });
  const main = w.document.querySelector('main');
  const ctx = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'), icons: {}, members: true, simpleCompose: true, painted() {} };
  main.innerHTML = ui.html(ctx);
  const cleanup = ui.mount(main, ctx);
  t.after(() => {
    w.history.replaceState(null, '', '#/home'); cleanup();
    for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
    w.close();
  });
  for (let i = 0; i < 20 && !main.querySelector('#community-reply-rich'); i++) await turn();
  const replyRoot = main.querySelector('.community-reply-form [data-inline-editor]');
  assert.equal(replyRoot.querySelector('textarea').hidden, true, replyRoot.textContent);
  const paste = (root, text, files) => {
    const event = new w.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files, items: [], getData: type => type === 'text/plain' ? text : '' } });
    root.querySelector('.community-rich-body').dispatchEvent(event);
  };
  const photo = uploadImageFile('image.png');
  paste(replyRoot, '回复截图说明', [photo]);
  await waitForImageState(() => finishUpload, 'reply image reaches the upload endpoint after async preflight');
  const send = () => main.querySelector('.community-reply-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  send(); await turn();
  assert.equal(calls.filter(call => call.url.endsWith('/topics/p1/replies')).length, 0);
  assert.match(main.querySelector('.community-reply-form .community-form-status').textContent, /上传/);
  finishUpload(); await turn();
  const draft = replyRoot.querySelector('textarea').value;
  assert.deepEqual(bodyImageContent(draft).images, [image]);
  main.querySelector('[data-action="community-edit-reply"]').click(); await turn();
  assert.equal(main.querySelector('.community-reply-form [data-inline-editor]'), replyRoot);
  const editRoot = main.querySelector('.community-reply-edit [data-inline-editor]');
  assert.ok(editRoot.querySelector('.community-rich-body'));
  assert.equal(editRoot.querySelector('textarea').value, '原回复');
  main.querySelector('[data-action="community-quote"]').click(); await turn();
  assert.equal(main.querySelector('.community-reply-edit [data-inline-editor]'), editRoot);
  assert.equal(replyRoot.querySelector('textarea').value, draft);
  const preview = replyRoot.querySelector('[data-action="community-md-preview"]');
  preview.click();
  assert.equal(replyRoot.querySelector('.community-ed-preview img').getAttribute('src'), `/api/community/images/${image}.webp`);
  preview.click();
  assert.equal(replyRoot.querySelector('[data-community-rich]').hidden, false);
  main.querySelector('[data-action="community-edit-cancel"]').click(); await turn();
  assert.equal(main.querySelector('.community-reply-form [data-inline-editor]'), replyRoot);
  send(); await turn();
  const sent = calls.find(call => call.url.endsWith('/topics/p1/replies'));
  assert.equal(JSON.parse(sent.init.body).body, draft);
  assert.equal(replyRoot.querySelector('textarea').value, '');
  assert.equal(replyRoot.querySelector('.community-inline-upload'), null);
  assert.equal(main.querySelector('.community-reply-form [data-inline-editor]'), replyRoot);
});
