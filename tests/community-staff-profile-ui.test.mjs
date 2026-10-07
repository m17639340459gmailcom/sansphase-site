import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityProfileHTML, communityProfileReviewsHTML } from '../src/community-profile.ts';
import { readerPage } from '../src/reader-ui.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const person = { name: '原昵称', uid: '10001', role: 'reader' };
const profile = { person, signature: '原签名', pendingSignature: null, pendingNickname: '待审昵称', pendingAvatar: false, canEditProfile: true, frames: [], background: { approved: null, pending: null } };
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const review = { id, kind: 'nickname', nickname: '原昵称', uid: '10001', proposedValue: '新昵称', avatarUrl: null, createdAt: '2026-10-07T00:00:00Z', canAdvise: true, canDecide: false, advice: [] };

test('community modal stages the pending nickname while its identity preview keeps the approved name', () => {
  const dom = new JSDOM(communityProfileHTML({ ...common, profile: { state: 'ready', data: profile } }));
  const doc = dom.window.document;
  assert.equal(doc.querySelector('[data-community-form="profile-nickname"] [name="nickname"]')?.value, '待审昵称');
  assert.match(doc.querySelector('.community-profile-identity-text strong').textContent, /^原昵称$/);
  assert.match(doc.querySelector('#community-profile-nickname-hint').textContent, /待审核/);
  assert.equal(doc.querySelector('[name="email"], [name="phone"], [name="id"]'), null);
  dom.window.close();
});

test('main-site profile stages the pending nickname without replacing its approved identity', () => {
  const dom = new JSDOM(readerPage('account', '', { nickname: '原昵称', pendingNickname: '待审昵称', email: 'reader@example.test', signature: '原签名' }));
  assert.equal(dom.window.document.querySelector('[data-reader-form="profile"] [name="nickname"]')?.value, '待审昵称');
  assert.match(dom.window.document.querySelector('#reader-nickname-hint').textContent, /审核/);
  dom.window.close();
});

test('server-proven advice covers every profile kind without gaining final decisions', () => {
  for (const kind of ['avatar', 'signature', 'nickname']) {
    const dom = new JSDOM(communityProfileReviewsHTML([{ ...review, kind }], [], false, common));
    const row = dom.window.document.querySelector('[data-profile-review]'); assert.ok(row, kind);
    const controls = [...row.querySelectorAll('[data-action="community-profile-review"]')];
    assert.deepEqual(controls.map(button => button.dataset.reviewAction), ['advise', 'advise']);
    assert.match(row.textContent, /建议.*不.*公开/);
    assert.equal(row.querySelector('[name="reason"]')?.maxLength, 200);
    dom.window.close();
  }
  const background = { memberUid: '10001', nickname: '原昵称', imageId: id, imageUrl: `/api/community/images/${id}.webp`, createdAt: review.createdAt, width: 800, height: 200, canAdvise: true, canDecide: false, advice: [] };
  const dom = new JSDOM(communityProfileReviewsHTML([], [background], false, common));
  const form = dom.window.document.querySelector('[data-community-form="profile-background-review"]'); assert.ok(form);
  assert.deepEqual([...form.querySelectorAll('button')].map(button => button.dataset.reviewAction), ['advise', 'advise']);
  dom.window.close();
});

test('item proof overrides stale owner hints and final decisions remain visibly distinct from advice', () => {
  const dom = new JSDOM(communityProfileReviewsHTML([{ ...review, canAdvise: false, canDecide: false }], [], true, common));
  assert.equal(dom.window.document.querySelector('[data-action="community-profile-review"]'), null);
  dom.window.close();
  const final = new JSDOM(communityProfileReviewsHTML([{ ...review, canAdvise: false, canDecide: true,
    advice: [{ id: 'advice', decision: 'reject', reason: '<禁止公开>', by: { kind: 'reader', id: 'helper' }, createdAt: review.createdAt }] }], [], false, common));
  const row = final.window.document.querySelector('[data-profile-review]');
  assert.deepEqual([...row.querySelectorAll('button')].map(button => button.dataset.reviewAction), ['decide', 'decide']);
  assert.match(row.textContent, /禁止公开/);
  assert.equal(row.querySelector('禁止公开'), null);
  final.window.close();
});
