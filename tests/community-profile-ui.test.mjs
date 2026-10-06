import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityRoute, inCommunityArea } from '../src/community.ts';
import { communityProfileHTML, communityProfileReviewsHTML } from '../src/community-profile.ts';
import { communityMemberHTML } from '../src/community-pages.ts';
import { createCommunityUI } from '../src/community-ui.ts';

const common = { t: zh => zh, esc: v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const person = { name: '读者', uid: '10001', role: 'reader', avatar: null };
const profile = { person, signature: '已通过', pendingSignature: '待审<签名>', pendingAvatar: true, canEditProfile: true, frames: [], background: { approved: null, pending: null } };

test('profile editor is a community route and contains only the requested editable fields', () => {
  assert.equal(communityRoute('#/community/profile').view, 'profile');
  assert.equal(inCommunityArea('profile'), true);
  const doc = new JSDOM(communityProfileHTML({ ...common, profile: { state: 'ready', data: profile } })).window.document;
  assert.equal(doc.querySelector('[name="signature"]').value, profile.pendingSignature);
  assert.equal(doc.querySelector('[name="signature"]').maxLength, 100);
  assert.equal(doc.querySelector('[data-profile-approved-signature]').textContent, profile.signature);
  assert.ok(doc.querySelector('[data-profile-file="avatar"]'));
  assert.ok(doc.querySelector('[data-profile-file="background"]'));
  assert.equal(doc.querySelector('[name="email"], [name="phone"], [name="id"], [name="nickname"]'), null);
  assert.equal(doc.querySelector('a[href="#/account"]'), null);
  assert.equal(doc.querySelector('a[data-profile-return]').getAttribute('href'), '#/community/u/10001');
});

test('author brand and reader perspective cannot acquire edit controls', () => {
  const doc = new JSDOM(communityProfileHTML({ ...common, profile: { state: 'ready', data: { ...profile, canEditProfile: false } } })).window.document;
  assert.equal(doc.querySelector('form, input[type="file"]'), null);
});

test('untrusted profile image URLs and proposed text never become executable markup', () => {
  const doc = new JSDOM(communityProfileHTML({ ...common, profile: { state: 'ready', data: { ...profile, background: { approved: { id: 'bad', url: 'https://other.invalid/x', width: 800, height: 200 }, pending: null } } } })).window.document;
  assert.equal(doc.querySelector('img[src^="https:"]'), null);
  assert.equal(doc.querySelector('签名'), null);
});

test('moderators see avatar decisions without signature or personal background submissions', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const entries = [{ id, kind: 'avatar', nickname: '读者', uid: '10001', proposedValue: null, avatarUrl: `/api/community/manage/profiles/${id}/avatar.webp`, createdAt: '2026-10-07T00:00:00Z' }, { id: 'signature', kind: 'signature', nickname: '读者', uid: '10001', proposedValue: 'PRIVATE', avatarUrl: null, createdAt: '2026-10-07T00:00:00Z' }];
  const doc = new JSDOM(communityProfileReviewsHTML(entries, [{ memberUid: '10001', nickname: '读者', imageId: id, imageUrl: `/api/community/images/${id}.webp`, createdAt: entries[0].createdAt, width: 800, height: 200 }], false, common)).window.document;
  assert.equal(doc.querySelectorAll('[data-profile-review]').length, 1);
  assert.equal(doc.querySelector('[data-background-review]'), null);
  assert.ok(!doc.body.textContent.includes('PRIVATE'));
});

test('self profile edit link stays within the community', () => {
  const member = { person, bio: '', joinedAt: null, cover: null, streak: 0, stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, following: false, self: true, badges: [], muted: null, canMute: false, canAppoint: false, steward: false, tab: 'topics', topics: [], replies: [], bookmarks: [], counts: { topics: 0, replies: 0, bookmarks: 0 }, quick: null };
  const doc = new JSDOM(communityMemberHTML({ ...common, member: { state: 'ready', data: member } })).window.document;
  const edit = [...doc.querySelectorAll('a')].find(link => link.textContent.includes('编辑资料'));
  assert.equal(edit.getAttribute('href'), '#/community/profile');
  assert.equal(edit.hasAttribute('data-reader-return'), false);
});

const settle = async () => { for (let n = 0; n < 7; n++) await new Promise(resolve => setTimeout(resolve, 0)); };
async function controller(t, { delayed = false, rejected = false, preview = false, interactive = false, moderator = false, manage = false } = {}) {
  const dom = new JSDOM('<main></main>', { url: `http://localhost/#/community/${manage ? 'manage/profiles' : 'profile'}`, pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'FormData', 'File', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  w.scrollTo = () => {};
  let value = structuredClone({ ...profile, pendingSignature: null, canEditProfile: !preview || interactive });
  const calls = []; let release;
  const request = async (url, init = {}) => {
    calls.push({ url, init });
    const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => structuredClone(data) });
    if (url.endsWith('/me')) return response({ ...person, agreed: true, owner: false, mod: moderator || manage, unread: { all: 0 }, management: preview ? { role: 'owner', browsingAsReader: true, ...(interactive ? { interactive: true } : {}) } : moderator || manage ? { role: 'steward', browsingAsReader: false } : undefined });
    if (url.endsWith('/manage?tab=profiles')) return response({ owner: false, tab: 'profiles', counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 0, replies24h: 0 }, profiles: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'avatar', nickname: '读者', uid: '10001', proposedValue: null, avatarUrl: null, createdAt: '2026-10-07T00:00:00Z' }], backgrounds: [] });
    if (/\/manage\/profiles\/[^/]+\/(approve|reject)$/.test(url)) { if (delayed) await new Promise(resolve => { release = resolve; }); return response({ ok: true }); }
    if (url.endsWith('/profile') && !init.method) return response(value);
    if (url.endsWith('/profile') && init.method === 'POST') {
      if (delayed) await new Promise(resolve => { release = resolve; });
      if (rejected) return response({ error: '审核通道暂不可用。' }, 503);
      value.pendingSignature = JSON.parse(init.body).signature;
      return response(value);
    }
    if (url.endsWith('/shop/equip')) { value.person.frame = JSON.parse(init.body).ref; return response({ ok: true }); }
    if (url.endsWith('/profile/avatar')) { if (rejected) return response({ error: '图片未能提交。' }, 503); value.pendingAvatar = true; return response(value); }
    if (url.endsWith('/profile/avatar/remove')) { value.person.avatar = null; value.pendingAvatar = false; return response(value); }
    throw Error(url);
  };
  const main = w.document.querySelector('main'), ui = createCommunityUI({ request });
  main.innerHTML = ui.html({ ...common, members: false });
  const cleanup = ui.mount(main, { ...common, members: false });
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, saved] of previous) { if (saved === undefined) delete globalThis[name]; else globalThis[name] = saved; } });
  await settle();
  const submit = (kind, signature) => {
    const form = main.querySelector(`[data-community-form="profile-${kind}"]`);
    if (signature !== undefined) form.elements.namedItem('signature').value = signature;
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  };
  return { w, main, ui, calls, submit, release: () => release?.() };
}

test('community signature submission stays on the page and sends only the signature with the write guard', async t => {
  const { main, calls, w, submit } = await controller(t);
  submit('signature', '新个签'); await settle();
  const write = calls.find(call => call.init.method === 'POST');
  assert.equal(write.url, '/api/community/profile');
  assert.deepEqual(JSON.parse(write.init.body), { signature: '新个签' });
  assert.equal(write.init.headers['X-Reader-Request'], '1');
  assert.equal(main.querySelector('[data-profile-approved-signature]').textContent, '已通过');
  assert.equal(main.querySelector('[name="signature"]').value, '新个签');
  assert.equal(w.location.hash, '#/community/profile');
  assert.equal(calls.some(call => call.url.startsWith('/api/reader/')), false);
});

test('failed writes retain the signature draft and reenable controls', async t => {
  const { main, submit } = await controller(t, { rejected: true });
  submit('signature', '仍需保留'); await settle();
  assert.equal(main.querySelector('[name="signature"]').value, '仍需保留');
  assert.equal(main.querySelector('[name="signature"]').disabled, false);
  assert.equal(main.querySelector('[data-community-form="profile-signature"] .community-form-status').textContent, '审核通道暂不可用。');
});

test('submitting another form cannot discard an already selected profile image', async t => {
  const { main, submit, w, calls } = await controller(t);
  const field = main.querySelector('[data-profile-file="background"]');
  const file = new w.File(['picture'], 'background.webp', { type: 'image/webp' });
  Object.defineProperty(field, 'files', { value: [file] });
  submit('signature', '待保留'); await settle();
  assert.equal(calls.some(call => call.init.method === 'POST'), false);
  assert.equal(main.querySelector('[data-profile-file="background"]'), field);
  assert.equal(field.files[0], file);
  assert.match(main.querySelector('[data-community-form="profile-signature"] .community-form-status').textContent, /另一项已选择的图片/);
});

test('an unsuccessful image upload preserves the selected file for retry', async t => {
  const { main, submit, w } = await controller(t, { rejected: true });
  const field = main.querySelector('[data-profile-file="avatar"]');
  const file = new w.File(['picture'], 'avatar.webp', { type: 'image/webp' });
  Object.defineProperty(field, 'files', { value: [file] });
  submit('avatar'); await settle();
  assert.equal(main.querySelector('[data-profile-file="avatar"]'), field);
  assert.equal(field.files[0], file);
  assert.equal(field.disabled, false);
  assert.equal(main.querySelector('[data-community-form="profile-avatar"] .community-form-status').textContent, '图片未能提交。');
});

test('an ordinary profile refresh keeps the selected image input and its FileList', async t => {
  const { main, w } = await controller(t);
  const field = main.querySelector('[data-profile-file="avatar"]');
  const file = new w.File(['picture'], 'avatar.webp', { type: 'image/webp' });
  Object.defineProperty(field, 'files', { value: [file] });
  const retry = w.document.createElement('button'); retry.dataset.action = 'community-retry'; main.append(retry);
  retry.click(); await settle();
  assert.equal(main.querySelector('[data-profile-file="avatar"]'), field);
  assert.equal(field.files[0], file);
});

test('moderator perspective switching cannot silently discard a profile draft', async t => {
  const { main, ui, calls } = await controller(t, { moderator: true });
  main.querySelector('[name="signature"]').value = '未提交的签名';
  await ui.setBrowsing(true); await settle();
  assert.equal(calls.some(call => call.url.endsWith('/browse-mode')), false);
  assert.equal(main.querySelector('[name="signature"]').value, '未提交的签名');
});

test('opposite decisions for one profile cannot be submitted concurrently', async t => {
  const { main, calls, release, w } = await controller(t, { manage: true, delayed: true });
  const approve = main.querySelector('[data-decision="approve"]'), reject = main.querySelector('[data-decision="reject"]');
  approve.click(); await settle();
  assert.equal(reject.disabled, true);
  reject.dispatchEvent(new w.Event('click', { bubbles: true })); await settle();
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  release(); await settle();
});

test('late profile responses cannot restore data after the identity is cleared', async t => {
  const { main, ui, submit, release } = await controller(t, { delayed: true });
  submit('signature', '旧账号待审'); await settle();
  assert.equal(main.querySelector('[name="signature"]').disabled, true);
  ui.clear(); main.innerHTML = '<section data-community="profile">账号已切换</section>';
  release(); await settle();
  assert.equal(main.textContent, '账号已切换');
});

test('reader perspective contains no editable profile forms and never submits a profile write', async t => {
  const { main, calls } = await controller(t, { preview: true });
  assert.equal(main.querySelector('[data-community-form]'), null);
  assert.equal(calls.some(call => call.init.method === 'POST'), false);
});

test('the verified owner personal reader saves signature and owned frame through the normal profile forms', async t => {
  const { main, calls, submit } = await controller(t, { preview: true, interactive: true });
  assert.ok(main.querySelector('[data-community-form="profile-avatar"]'));
  submit('signature', '站长的个人签名'); await settle();
  const signature = calls.find(call => call.url.endsWith('/profile') && call.init.method === 'POST');
  assert.deepEqual(JSON.parse(signature.init.body), { signature: '站长的个人签名' });
  submit('frame'); await settle();
  assert.ok(calls.some(call => call.url.endsWith('/shop/equip') && call.init.method === 'POST'));
  assert.equal(calls.some(call => /\/manage(?:\/|\?)/.test(call.url)), false);
  assert.equal(main.querySelector('[data-profile-return]').getAttribute('href'), '#/community/u/10001');
});

test('leaving an unsaved community signature asks once and keeps the draft when cancelled', async t => {
  const { main, w } = await controller(t);
  let confirmations = 0; w.confirm = () => { confirmations++; return false; };
  main.querySelector('[name="signature"]').value = '尚未保存';
  main.querySelector('[data-profile-return]').click(); await settle();
  assert.equal(confirmations, 1);
  assert.equal(w.location.hash, '#/community/profile');
  assert.equal(main.querySelector('[name="signature"]').value, '尚未保存');
});
