import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { adminReadersPage, mountReaderAdmin } from '../src/admin-readers.mjs';

async function reviewFixture(run) {
  const dom = new JSDOM(`<main>${adminReadersPage({ name: 'Owner' })}</main>`, { url: 'http://localhost/#/admin' });
  const previous = Object.fromEntries(['window', 'document', 'fetch', 'FormData'].map(key => [key, globalThis[key]]));
  const pending = [];
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, FormData: dom.window.FormData,
    fetch: (url, options) => new Promise(resolve => pending.push({ url, options, resolve })) });
  const root = document.querySelector('main');
  root.querySelector('dialog').close = () => {};
  const cleanup = mountReaderAdmin(root);
  const finish = async (value, ok = true) => { pending.shift().resolve({ ok, json: async () => value }); await new Promise(resolve => setTimeout(resolve, 0)); };
  const queue = { profiles: [{ id: 'proposal-fixture', nickname: '原昵称', kind: 'nickname', proposedValue: '新昵称', createdAt: '2026-10-07T00:00:00Z', advice: [
    { id: 'advice-fixture', decision: 'reject', reason: '<img src=x onerror=alert(1)> 请修改', by: { kind: 'reader', id: 'private-reviewer-id' }, createdAt: '2026-10-07T01:00:00Z' },
  ] }], expired: [], files: [], versions: [], media: [] };
  try {
    await finish({ users: [], total: 0, totalPages: 1, summary: { total: 0, active: 0, disabled: 0, vip: 0, expiredVip: 0 } });
    root.querySelector('[data-admin-view="review"]').click();
    await finish(queue);
    await run({ root, pending, finish, queue });
  } finally { cleanup(); Object.assign(globalThis, previous); dom.window.close(); }
}

test('profile queue labels nickname and separates escaped advice from a final decision', async () => {
  await reviewFixture(async ({ root }) => {
    const card = root.querySelector('.reader-admin-review-item');
    assert.match(card.querySelector('small').textContent, /^昵称 ·/);
    assert.match(card.textContent, /审核建议（尚未决定）/);
    assert.match(card.textContent, /建议驳回/);
    assert.match(card.textContent, /<img src=x onerror=alert\(1\)> 请修改/);
    assert.equal(card.querySelector('img'), null, 'advice is text, never interpreted HTML');
    assert.doesNotMatch(card.textContent, /private-reviewer-id/);
    assert.equal(card.querySelector('[data-admin-review-reason]').getAttribute('maxlength'), '200');
  });
});

test('reject requires a reason without sending a request; a submitted reason prevents concurrent decisions', async () => {
  await reviewFixture(async ({ root, pending, finish, queue }) => {
    const reject = root.querySelector('[data-admin-review-action="reject"]');
    const approve = root.querySelector('[data-admin-review-action="approve"]');
    reject.click();
    assert.equal(pending.length, 0, 'no reason must not start a rejection');
    const reason = root.querySelector('[data-admin-review-reason]');
    assert.equal(reason.getAttribute('aria-invalid'), 'true');
    assert.equal(document.activeElement, reason);
    reason.value = '  昵称含有联系方式，请修改。  ';
    reject.click();
    assert.equal(pending.length, 1);
    assert.deepEqual(JSON.parse(pending[0].options.body), { reason: '昵称含有联系方式，请修改。' });
    assert.match(pending[0].url, /proposal-fixture\/reject$/);
    assert.equal(approve.disabled, true);
    assert.equal(reject.disabled, true);
    approve.click();
    assert.equal(pending.length, 1);
    await finish({ error: '权限已变化' }, false);
    assert.equal(approve.disabled, false);
    assert.equal(reject.disabled, false);
    assert.equal(reason.value, '  昵称含有联系方式，请修改。  ');
    approve.click();
    assert.deepEqual(JSON.parse(pending[0].options.body), { reason: '昵称含有联系方式，请修改。' });
    await finish({ ok: true });
    assert.match(pending[0].url, /\/review$/);
    await finish({ ...queue, profiles: [] });
    assert.equal(root.querySelector('[data-admin-review-action]'), null);
  });
});

test('approve permits an empty reason, while invalid rejection text remains editable', async () => {
  await reviewFixture(async ({ root, pending, finish }) => {
    const reason = root.querySelector('[data-admin-review-reason]');
    const reject = root.querySelector('[data-admin-review-action="reject"]');
    for (const invalid of ['<script>', 'a\u0000b', '字'.repeat(201)]) {
      reason.value = invalid;
      reject.click();
      assert.equal(pending.length, 0);
    }
    reason.value = '';
    root.querySelector('[data-admin-review-action="approve"]').click();
    assert.deepEqual(JSON.parse(pending[0].options.body), { reason: '' });
    await finish({ error: '暂时不可用' }, false);
    assert.equal(reason.value, '');
  });
});

test('review navigation preserves the reason and per-proposal lock across a new card', async () => {
  await reviewFixture(async ({ root, pending, finish, queue }) => {
    const reason = root.querySelector('[data-admin-review-reason]');
    reason.value = '昵称含有联系方式。';
    reason.dispatchEvent(new window.Event('input', { bubbles: true }));
    root.querySelector('[data-admin-review-action="reject"]').click();
    root.querySelector('[data-admin-view="review"]').click();
    assert.equal(pending.length, 2);
    const queueRead = pending.splice(1, 1)[0];
    queueRead.resolve({ ok: true, json: async () => queue });
    await new Promise(resolve => setTimeout(resolve, 0));
    const currentReason = root.querySelector('[data-admin-review-reason]');
    assert.equal(currentReason.value, '昵称含有联系方式。');
    assert.equal(currentReason.readOnly, true);
    const approve = root.querySelector('[data-admin-review-action="approve"]');
    assert.equal(approve.disabled, true);
    approve.click();
    assert.equal(pending.length, 1, 'redrawing the card cannot start a conflicting decision');
    await finish({ error: '请重新确认权限' }, false);
    assert.equal(approve.disabled, false, 'failure unlocks the live card, not the detached one');
    assert.equal(currentReason.readOnly, false);
    assert.equal(currentReason.value, '昵称含有联系方式。');
  });
});

test('an older review GET cannot replace a newer queue or delete its reason draft', async () => {
  await reviewFixture(async ({ root, pending, finish, queue }) => {
    const reason = root.querySelector('[data-admin-review-reason]');
    reason.value = '请修改昵称。';
    reason.dispatchEvent(new window.Event('input', { bubbles: true }));
    root.querySelector('[data-admin-view="review"]').click();
    root.querySelector('[data-admin-view="review"]').click();
    const newest = pending.splice(1, 1)[0];
    newest.resolve({ ok: true, json: async () => ({ ...queue, profiles: [{ ...queue.profiles[0], proposedValue: '新队列值' }] }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(root.querySelector('.reader-admin-review-item').textContent, /新队列值/);
    assert.equal(root.querySelector('[data-admin-review-reason]').value, '请修改昵称。');
    await finish({ ...queue, profiles: [] });
    assert.match(root.querySelector('.reader-admin-review-item').textContent, /新队列值/);
    assert.equal(root.querySelector('[data-admin-review-reason]').value, '请修改昵称。');
  });
});
