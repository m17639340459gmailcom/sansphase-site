import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { communityRoute, inCommunityArea } from '../src/community.ts';
import { communityProfileHTML, communityProfileDialogHTML, communityProfileReviewsHTML } from '../src/community-profile.ts';
import { communityMemberHTML } from '../src/community-pages.ts';
import { createCommunityUI } from '../src/community-ui.ts';

const common = { t: zh => zh, esc: v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const person = { name: '读者', uid: '10001', role: 'reader', avatar: null };
const profile = { person, signature: '已通过', pendingSignature: '待审<签名>', pendingAvatar: true, canEditProfile: true, frames: [], background: { approved: null, pending: null } };

test('member cover applies default artwork only without an approved or equipped cover', async () => {
  const css = postcss.parse(await readFile(new URL('../src/community.css', import.meta.url), 'utf8'));
  const member = { person, bio: '', joinedAt: null, cover: null, self: true, streak: 0, stats: {}, follows: {}, badges: [], topics: [], replies: [], bookmarks: [], counts: {}, tab: 'topics' };
  const approved = '/api/community/profile/background/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp';
  const equipped = '/api/community/images/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp';
  const cases = [
    { data: {}, image: null, defaultArt: true },
    { data: { cover: 'aurora' }, image: null, defaultArt: false },
    { data: { cover: 'abyss' }, image: null, defaultArt: false },
    { data: { coverImage: equipped }, image: equipped, defaultArt: false },
    { data: { background: { url: approved }, coverImage: equipped, cover: 'aurora' }, image: approved, defaultArt: false },
    { data: { background: { pending: { url: approved } } }, image: null, defaultArt: true }
  ];
  for (const entry of cases) {
    const dom = new JSDOM(communityMemberHTML({ ...common, member: { state: 'ready', data: { ...member, ...entry.data } } }));
    try {
      const cover = dom.window.document.querySelector('.community-m-cover');
      assert.equal(cover.querySelectorAll('img').length, entry.image ? 1 : 0);
      assert.equal(cover.querySelector('img')?.getAttribute('src') || null, entry.image);
      assert.equal(cover.querySelectorAll('i').length, entry.image ? 0 : 2);
      const defaultLayers = [];
      css.walkRules(rule => {
        if (rule.parent?.type !== 'root') return;
        for (const selector of rule.selectors) {
          if (!selector.includes('.community-m-cover') || !cover.matches(selector.replace(/::after$/, ''))) continue;
          rule.walkDecls('background', declaration => {
            if (entry.image || selector.endsWith('::after') || declaration.value.includes('hsl(var(--h)')) defaultLayers.push(declaration.value);
          });
        }
      });
      assert.equal(defaultLayers.length, entry.defaultArt ? 2 : 0, `cover ${JSON.stringify(entry.data)}`);
    } finally { dom.window.close(); }
  }
});

test('the editor and member page show one equipped author background and a pending replacement takes preview priority', () => {
  const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const pending = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const coverImage = `/api/community/images/${image}.webp`;
  const data = { ...profile, cover: `image:${image}`, coverImage, coverName: '林间背景' };
  for (const hasPending of [false, true]) {
    const background = { approved: null, pending: hasPending ? { id: pending, url: `/api/community/profile/background/${pending}.webp`, width: 800, height: 200, createdAt: '2026-10-07T00:00:00Z' } : null };
    const dom = new JSDOM(communityProfileHTML({ ...common, profile: { state: 'ready', data: { ...data, background } } }));
    try {
      const preview = dom.window.document.querySelector('[data-profile-preview="background"]');
      assert.equal(preview.querySelectorAll('img').length, 1);
      assert.equal(preview.querySelector('img').getAttribute('src'), hasPending ? background.pending.url : coverImage);
      assert.ok(dom.window.document.querySelector('[data-action="community-profile-remove"][data-kind="background"]'));
    } finally { dom.window.close(); }
  }
  const member = { person, bio: '', joinedAt: null, cover: data.cover, coverImage, self: true, streak: 0, stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, badges: [], topics: [], replies: [], bookmarks: [], counts: {}, tab: 'topics' };
  const dom = new JSDOM(communityMemberHTML({ ...common, member: { state: 'ready', data: member } }));
  try {
    assert.equal(dom.window.document.querySelectorAll('.community-m-cover img').length, 1);
    assert.equal(dom.window.document.querySelector('.community-m-cover img').getAttribute('src'), coverImage);
  } finally { dom.window.close(); }
});

test('profile editor keeps the legacy route but presents a compact modal body without frame selection', () => {
  assert.equal(communityRoute('#/community/profile').view, 'profile');
  assert.equal(inCommunityArea('profile'), true);
  const doc = new JSDOM(communityProfileHTML({ ...common, profile: { state: 'ready', data: profile } })).window.document;
  assert.equal(doc.querySelector('[name="signature"]').value, profile.pendingSignature);
  assert.equal(doc.querySelector('[name="signature"]').maxLength, 100);
  assert.equal(doc.querySelector('[data-profile-approved-signature]').textContent, profile.signature);
  assert.ok(doc.querySelector('[data-profile-file="avatar"]'));
  assert.ok(doc.querySelector('[data-profile-file="background"]'));
  assert.equal(doc.querySelector('[name="email"], [name="phone"], [name="id"]'), null);
  assert.equal(doc.querySelector('[name="nickname"]').value, person.name);
  assert.equal(doc.querySelector('a[href="#/account"]'), null);
  assert.equal(doc.querySelector('[data-community-form="profile-frame"]'), null);
  const shell = new JSDOM(communityProfileDialogHTML(common)).window.document;
  assert.equal(shell.querySelector('[data-profile-owned-frames]').getAttribute('href'), '#/community/shop/mine');
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

test('self profile edit opens a dialog instead of navigating to another page', () => {
  const member = { person, bio: '', joinedAt: null, cover: null, streak: 0, stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, following: false, self: true, badges: [], muted: null, canMute: false, canAppoint: false, steward: false, tab: 'topics', topics: [], replies: [], bookmarks: [], counts: { topics: 0, replies: 0, bookmarks: 0 }, quick: null };
  const doc = new JSDOM(communityMemberHTML({ ...common, member: { state: 'ready', data: member } })).window.document;
  const edit = doc.querySelector('[data-action="community-profile-edit"]');
  assert.equal(edit.tagName, 'BUTTON');
  assert.equal(edit.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(edit.hasAttribute('href'), false);
  assert.equal(edit.hasAttribute('data-reader-return'), false);
});

const settle = async () => { for (let n = 0; n < 7; n++) await new Promise(resolve => setTimeout(resolve, 0)); };
async function controller(t, { delayed = false, rejected = false, preview = false, interactive = false, moderator = false, manage = false, advice = false, member = false, updatedConvention = false, unagreed = false } = {}) {
  const dom = new JSDOM('<header id="site-header"><button>导航</button></header><main id="main"></main>', { url: `http://localhost/#/community/${manage ? 'manage/profiles' : member ? 'u/10001' : 'profile'}`, pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'FormData', 'File', 'Event', 'CustomEvent', 'getComputedStyle'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  w.scrollTo = () => {};
  let value = structuredClone({ ...profile, pendingSignature: null, canEditProfile: !preview || interactive });
  const calls = []; let release; let needsConvention = unagreed;
  const request = async (url, init = {}) => {
    calls.push({ url, init });
    const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => structuredClone(data) });
    if (url.endsWith('/me')) return response({ ...person, agreed: !needsConvention, owner: false, mod: moderator || manage, unread: { all: 0 }, ...(updatedConvention || unagreed ? { convention: { version: 'new', agreed: !needsConvention } } : {}), management: preview ? { role: 'owner', browsingAsReader: true, ...(interactive ? { interactive: true } : {}) } : moderator || manage ? { role: 'steward', browsingAsReader: false } : undefined });
    if (url.endsWith('/convention')) return response({ version: 'new', body: '请阅读新的公约' });
    if (url.endsWith('/convention/read')) return response({ version: 'new', eligibleAt: new Date(Date.now() + 10000).toISOString() });
    if (url.endsWith('/manage?tab=profiles')) return response({ owner: false, tab: 'profiles', counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 0, replies24h: 0 }, profiles: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: advice ? 'nickname' : 'avatar', nickname: '读者', uid: '10001', proposedValue: advice ? '新名字' : null, avatarUrl: null, createdAt: '2026-10-07T00:00:00Z', ...(advice ? { canAdvise: true, canDecide: false, advice: [] } : {}) }], backgrounds: [] });
    if (/\/manage\/profiles\/[^/]+\/(approve|reject|advise)$/.test(url)) { if (delayed) await new Promise(resolve => { release = resolve; }); return response({ ok: true }); }
    if (url.endsWith('/profile') && !init.method) return response(value);
    if (url.includes('/members/10001?')) return response({ person, bio: value.signature, joinedAt: null, cover: null, streak: 0, stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, following: false, self: true, badges: [], muted: null, canMute: false, canAppoint: false, steward: false, tab: 'topics', topics: [], replies: [], bookmarks: [], counts: { topics: 0, replies: 0, bookmarks: 0 }, quick: null });
    if (url.endsWith('/profile') && init.method === 'POST') {
      if (delayed) await new Promise(resolve => { release = resolve; });
      if (updatedConvention) { needsConvention = true; return response({ error: '请同意新公约。' }, 428); }
      if (rejected) return response({ error: '审核通道暂不可用。' }, 503);
      const submitted = JSON.parse(init.body);
      if ('signature' in submitted) value.pendingSignature = submitted.signature;
      if ('nickname' in submitted) value.pendingNickname = submitted.nickname;
      return response(value);
    }
    if (url.endsWith('/shop/equip')) { value.person.frame = JSON.parse(init.body).ref; return response({ ok: true }); }
    if (url.endsWith('/profile/avatar')) { if (rejected) return response({ error: '图片未能提交。' }, 503); value.pendingAvatar = true; return response(value); }
    if (url.endsWith('/profile/avatar/remove')) { value.person.avatar = null; value.pendingAvatar = false; return response(value); }
    throw Error(url);
  };
  const crops = [];
  const createProfileCrop = async options => {
    const confirm = w.document.createElement('button'); confirm.type = 'button'; confirm.dataset.testCropConfirm = options.kind;
    confirm.textContent = '使用裁剪';
    const entry = { options, destroyed: false, use: file => options.onUse(file) };
    confirm.addEventListener('click', () => entry.use(new w.File(['cropped'], `${options.kind}-cropped.webp`, { type: 'image/webp' })));
    options.container.replaceChildren(confirm); crops.push(entry);
    return { destroy() { entry.destroyed = true; options.container.replaceChildren(); } };
  };
  const main = w.document.querySelector('main'), ui = createCommunityUI({ request, createProfileCrop });
  main.innerHTML = ui.html({ ...common, members: false });
  let cleanup = ui.mount(main, { ...common, members: false });
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, saved] of previous) { if (saved === undefined) delete globalThis[name]; else globalThis[name] = saved; } });
  await settle();
  const submit = (kind, signature) => {
    const form = w.document.querySelector(`[data-community-form="profile-${kind}"]`);
    if (signature !== undefined) form.elements.namedItem('signature').value = signature;
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  };
  const remount = async hash => {
    w.history.replaceState(null, '', hash);
    cleanup(); main.innerHTML = ui.html({ ...common, members: false });
    cleanup = ui.mount(main, { ...common, members: false });
    await settle();
  };
  return { w, main: manage ? main : w.document.body, page: main, ui, calls, crops, submit, remount, release: () => release?.(), resolveConvention: () => { needsConvention = false; } };
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

test('community nickname submission stages only the new name and never changes the approved identity', async t => {
  const { main, calls, w } = await controller(t);
  const form = main.querySelector('[data-community-form="profile-nickname"]');
  form.elements.namedItem('nickname').value = '新的昵称';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await settle();
  const write = calls.find(call => call.init.method === 'POST'); assert.ok(write);
  assert.equal(write.url, '/api/community/profile');
  assert.deepEqual(JSON.parse(write.init.body), { nickname: '新的昵称' });
  assert.equal(main.querySelector('.community-profile-identity-text strong').textContent, person.name);
  assert.equal(main.querySelector('[name="nickname"]').value, '新的昵称');
  assert.match(main.querySelector('#community-profile-nickname-hint').textContent, /待审核/);
});

test('nickname drafts keep Escape, close, navigation and perspective switches guarded', async t => {
  const { main, w, ui, calls } = await controller(t, { moderator: true });
  const input = main.querySelector('[name="nickname"]'); input.value = '未提交昵称';
  let prompts = 0; w.confirm = () => { prompts++; return false; };
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
  assert.ok(main.querySelector('[role="dialog"]')); assert.equal(prompts, 1);
  main.querySelector('[data-profile-close]').click(); await settle();
  assert.equal(prompts, 2); assert.equal(main.querySelector('[name="nickname"]'), input);
  const link = w.document.createElement('a'); link.href = '#/community/home'; main.append(link); link.click(); await settle();
  assert.equal(w.location.hash, '#/community/profile'); assert.equal(prompts, 3);
  await ui.setBrowsing(true); await settle();
  assert.equal(calls.some(call => call.url.endsWith('/browse-mode')), false);
  assert.equal(main.querySelector('[name="nickname"]').value, '未提交昵称');
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
  const { main, page, w } = await controller(t);
  const field = main.querySelector('[data-profile-file="avatar"]');
  const file = new w.File(['picture'], 'avatar.webp', { type: 'image/webp' });
  Object.defineProperty(field, 'files', { value: [file] });
  const retry = w.document.createElement('button'); retry.dataset.action = 'community-retry'; page.append(retry);
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

test('profile advice uses the existing advisory route, and a rejection requires a reason', async t => {
  const { main, calls } = await controller(t, { manage: true, advice: true });
  const reject = main.querySelector('[data-decision="reject"]');
  reject.click(); await settle();
  assert.equal(calls.some(call => call.init.method === 'POST'), false);
  assert.match(main.querySelector('.community-form-status').textContent, /驳回理由/);
  main.querySelector('[name="reason"]').value = '请换成可识别的名字';
  reject.click(); await settle();
  const write = calls.find(call => call.init.method === 'POST');
  assert.ok(write.url.endsWith('/manage/profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/advise'));
  assert.deepEqual(JSON.parse(write.init.body), { decision: 'reject', reason: '请换成可识别的名字' });
  assert.equal(main.querySelector('[data-review-action="decide"]'), null);
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

test('the verified owner personal reader saves signature in the dialog and changes frames from owned inventory', async t => {
  const { main, calls, submit } = await controller(t, { preview: true, interactive: true });
  assert.ok(main.querySelector('[data-community-form="profile-avatar"]'));
  submit('signature', '站长的个人签名'); await settle();
  const signature = calls.find(call => call.url.endsWith('/profile') && call.init.method === 'POST');
  assert.deepEqual(JSON.parse(signature.init.body), { signature: '站长的个人签名' });
  assert.equal(main.querySelector('[data-community-form="profile-frame"]'), null);
  assert.equal(calls.some(call => call.url.endsWith('/shop/equip')), false);
  assert.equal(calls.some(call => /\/manage(?:\/|\?)/.test(call.url)), false);
  assert.equal(main.querySelector('[data-profile-owned-frames]').getAttribute('href'), '#/community/shop/mine');
});

test('leaving an unsaved community signature asks once and keeps the draft when cancelled', async t => {
  const { main, w } = await controller(t);
  let confirmations = 0; w.confirm = () => { confirmations++; return false; };
  main.querySelector('[name="signature"]').value = '尚未保存';
  main.querySelector('[data-profile-owned-frames]').click(); await settle();
  assert.equal(confirmations, 1);
  assert.equal(w.location.hash, '#/community/profile');
  assert.equal(main.querySelector('[name="signature"]').value, '尚未保存');
});

test('clicking edit leaves the personal homepage in place; Escape closes and returns focus', async t => {
  const { main, page, w, calls } = await controller(t, { member: true });
  const opener = page.querySelector('[data-action="community-profile-edit"]');
  opener.focus(); opener.click(); await settle();
  assert.equal(w.location.hash, '#/community/u/10001');
  assert.equal(page.querySelector('[data-community="member"]') !== null, true);
  assert.ok(main.querySelector('[role="dialog"][aria-modal="true"]'));
  assert.equal(page.inert, true);
  assert.equal(w.document.getElementById('site-header').inert, true);
  assert.equal(calls.filter(call => call.url.endsWith('/profile')).length, 1);
  w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.equal(main.querySelector('[role="dialog"]'), null);
  assert.equal(page.inert, false);
  assert.equal(w.document.activeElement, opener);
});

test('closing a dirty editor keeps its draft if discard is cancelled', async t => {
  const { main, w } = await controller(t);
  let confirmations = 0;
  w.confirm = () => { confirmations++; return false; };
  const input = main.querySelector('[name="signature"]');
  input.value = '未保存的个签';
  main.querySelector('[data-profile-close]').click(); await settle();
  assert.equal(confirmations, 1);
  assert.ok(main.querySelector('[role="dialog"]'));
  assert.equal(main.querySelector('[name="signature"]'), input);
  w.confirm = () => true;
  main.querySelector('[data-profile-close]').click(); await settle();
  assert.equal(main.querySelector('[role="dialog"]'), null);
});

test('a submitting editor cannot be closed or submit twice and closes cleanly after saving', async t => {
  const { main, w, submit, calls, release } = await controller(t, { delayed: true });
  submit('signature', '等审核'); await settle();
  w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  submit('signature'); await settle();
  assert.ok(main.querySelector('[role="dialog"]'));
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  release(); await settle();
  main.querySelector('[data-profile-close]').click(); await settle();
  assert.equal(main.querySelector('[role="dialog"]'), null);
});

test('reopening the editor never accumulates hidden old layers or duplicate IDs', async t => {
  const { main, page } = await controller(t, { member: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    page.querySelector('[data-action="community-profile-edit"]').click(); await settle();
    assert.equal(main.querySelectorAll('#community-profile-dialog').length, 1);
    main.querySelector('[data-profile-close]').click(); await settle();
    assert.equal(main.querySelectorAll('#community-profile-dialog').length, 0);
    assert.equal(page.inert, false);
  }
});

test('local image previews reject invalid replacements and revoke URLs without uploading', async t => {
  const { main, w, calls } = await controller(t);
  const created = [], revoked = [];
  w.URL.createObjectURL = file => { created.push(file.name); return `blob:preview-${created.length}`; };
  w.URL.revokeObjectURL = url => revoked.push(url);
  const field = main.querySelector('[data-profile-file="avatar"]');
  const select = file => {
    Object.defineProperty(field, 'files', { value: file ? [file] : [], configurable: true });
    field.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  select(new w.File(['picture'], 'avatar.webp', { type: 'image/webp' }));
  assert.equal(main.querySelector('[data-profile-preview="avatar"] img').getAttribute('src'), 'blob:preview-1');
  assert.equal(main.querySelector('[data-profile-clear="avatar"]').hidden, false);
  select(new w.File([new Uint8Array(25 * 1024 * 1024 + 1)], 'too-large.webp', { type: 'image/webp' }));
  assert.equal(main.querySelector('[src="blob:preview-1"]'), null);
  assert.deepEqual(revoked, ['blob:preview-1']);
  assert.match(main.querySelector('[data-community-form="profile-avatar"] .community-form-status').textContent, /25MB/);
  select(new w.File(['picture'], 'avatar-again.webp', { type: 'image/webp' }));
  assert.equal(main.querySelector('[data-profile-preview="avatar"] img').getAttribute('src'), 'blob:preview-2');
  assert.equal(main.querySelector('[data-community-form="profile-avatar"] .community-form-status').textContent, '');
  assert.equal(calls.some(call => call.init.method === 'POST'), false);
  select(null);
  main.querySelector('[data-profile-close]').click(); await settle();
  assert.deepEqual(revoked, ['blob:preview-1', 'blob:preview-2']);
  assert.equal(main.querySelector('[role="dialog"]'), null);
});

test('the owned-inventory link cannot abandon an ongoing profile submission', async t => {
  const { main, w, calls, submit, release } = await controller(t, { delayed: true });
  let confirms = 0; w.confirm = () => { confirms++; return true; };
  submit('signature', '待审核'); await settle();
  main.querySelector('[data-profile-owned-frames]').click(); await settle();
  assert.equal(w.location.hash, '#/community/profile');
  assert.equal(confirms, 0);
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  release(); await settle();
});

test('a large original avatar is cropped locally before the existing small upload is submitted', async t => {
  const { main, w, crops, calls, submit } = await controller(t);
  w.URL.createObjectURL = file => `blob:${file.name}`; const revoked = [];
  w.URL.revokeObjectURL = url => revoked.push(url);
  const field = main.querySelector('[data-profile-file="avatar"]');
  const original = new w.File([new Uint8Array(3 * 1024 * 1024)], 'portrait.png', { type: 'image/png' });
  Object.defineProperty(field, 'files', { value: [original], configurable: true });
  field.dispatchEvent(new w.Event('change', { bubbles: true })); await settle();
  assert.equal(crops.length, 1); assert.equal(crops[0].options.file, original);
  assert.equal(main.querySelector('[data-profile-upload-submit]').hidden, true);
  submit('avatar'); await settle();
  assert.equal(calls.some(call => call.url.endsWith('/profile/avatar')), false);
  assert.match(main.querySelector('[data-community-form="profile-avatar"] .community-form-status').textContent, /确认裁剪/);
  main.querySelector('[data-test-crop-confirm="avatar"]').click(); await settle();
  assert.equal(crops[0].destroyed, true);
  assert.equal(main.querySelector('[data-profile-upload-submit]').hidden, false);
  submit('avatar'); await settle();
  const write = calls.find(call => call.url.endsWith('/profile/avatar'));
  assert.ok(write); assert.equal(write.init.body.get('file').name, 'avatar-cropped.webp');
  assert.equal(write.init.body.get('file').size, 7);
  assert.ok(revoked.includes('blob:portrait.png'));
});

test('background crop selection survives refresh and cancellation releases the local editor without uploading', async t => {
  const { main, page, w, crops, calls } = await controller(t);
  w.URL.createObjectURL = file => `blob:${file.name}`; const revoked = [];
  w.URL.revokeObjectURL = url => revoked.push(url);
  const field = main.querySelector('[data-profile-file="background"]');
  const original = new w.File(['landscape'], 'landscape.jpg', { type: 'image/jpeg' });
  Object.defineProperty(field, 'files', { value: [original], configurable: true });
  field.dispatchEvent(new w.Event('change', { bubbles: true })); await settle();
  const cropNode = main.querySelector('[data-profile-crop="background"]');
  const cropControl = main.querySelector('[data-test-crop-confirm="background"]'); cropControl.focus();
  const retry = w.document.createElement('button'); retry.dataset.action = 'community-retry'; page.append(retry);
  retry.click(); await settle();
  assert.equal(main.querySelector('[data-profile-crop="background"]'), cropNode);
  assert.equal(w.document.activeElement, cropControl, 'retaining a crop must also retain its keyboard focus through refresh');
  assert.equal(crops.length, 1);
  Object.defineProperty(field, 'files', { value: [], configurable: true });
  crops[0].options.onCancel(); await settle();
  assert.equal(crops[0].destroyed, true);
  assert.equal(main.querySelector('[data-profile-upload-submit]').hidden, true);
  assert.ok(revoked.includes('blob:landscape.jpg'));
  assert.equal(calls.some(call => call.init.method === 'POST'), false);
});

test('a crop result from a cleared identity cannot stage or submit the previous account image', async t => {
  const { main, w, crops, ui, calls } = await controller(t);
  const revoked = []; w.URL.createObjectURL = file => `blob:${file.name}`;
  w.URL.revokeObjectURL = url => revoked.push(url);
  const field = main.querySelector('[data-profile-file="avatar"]');
  const original = new w.File(['original'], 'old-account.png', { type: 'image/png' });
  Object.defineProperty(field, 'files', { value: [original], configurable: true });
  field.dispatchEvent(new w.Event('change', { bubbles: true })); await settle();
  ui.clear();
  crops[0].use(new w.File(['late'], 'late.webp', { type: 'image/webp' })); await settle();
  assert.equal(main.querySelector('#community-profile-dialog'), null);
  assert.equal(crops[0].destroyed, true);
  assert.deepEqual(revoked, ['blob:old-account.png']);
  assert.equal(calls.some(call => call.init.method === 'POST'), false);
});

test('saving in the modal keeps the homepage and returns focus to its refreshed edit button', async t => {
  const { main, page, w, submit } = await controller(t, { member: true });
  const opener = page.querySelector('[data-action="community-profile-edit"]');
  opener.focus(); opener.click(); await settle();
  submit('signature', '新的个签'); await settle();
  assert.equal(w.location.hash, '#/community/u/10001');
  assert.equal(page.querySelectorAll('[data-community="member"]').length, 1);
  assert.equal(main.querySelector('[data-profile-approved-signature]').textContent, '已通过');
  main.querySelector('[data-profile-close]').click(); await settle();
  assert.equal(w.document.activeElement, page.querySelector('[data-action="community-profile-edit"]'));
});

test('a new convention suspends the editor without discarding its same-account draft', async t => {
  const { main, page, w, submit, resolveConvention } = await controller(t, { updatedConvention: true });
  submit('signature', '应保留的个签'); await settle();
  const dialog = main.querySelector('#community-profile-dialog');
  const input = dialog.querySelector('[name="signature"]');
  assert.equal(dialog.getAttribute('aria-hidden'), 'true');
  assert.equal(input.value, '应保留的个签');
  assert.ok(main.querySelector('.community-convention-dialog'));
  assert.equal(main.querySelectorAll('[role="dialog"][aria-modal="true"]:not([aria-hidden="true"])').length, 1);
  resolveConvention();
  const retry = w.document.createElement('button'); retry.dataset.action = 'community-retry'; page.append(retry);
  retry.click(); await settle();
  assert.equal(main.querySelector('.community-convention-dialog'), null);
  assert.equal(main.querySelector('#community-profile-dialog'), dialog);
  assert.equal(dialog.getAttribute('aria-hidden'), null);
  assert.equal(dialog.querySelector('[name="signature"]').value, '应保留的个签');
});

test('a legacy profile bookmark waits for mandatory convention consent before opening its editor', async t => {
  const { main, page, w, resolveConvention } = await controller(t, { unagreed: true });
  assert.equal(main.querySelector('#community-profile-dialog'), null);
  const convention = main.querySelector('.community-convention-dialog');
  assert.ok(convention);
  assert.equal(Boolean(convention.inert), false);
  assert.equal(main.querySelectorAll('[role="dialog"][aria-modal="true"]:not([aria-hidden="true"])').length, 1);
  assert.ok(convention.contains(w.document.activeElement));
  resolveConvention();
  const retry = w.document.createElement('button'); retry.dataset.action = 'community-retry'; page.append(retry);
  retry.click(); await settle();
  assert.equal(main.querySelector('.community-convention-dialog'), null);
  assert.ok(main.querySelector('#community-profile-dialog [name="signature"]'));
  assert.equal(main.querySelectorAll('[role="dialog"][aria-modal="true"]:not([aria-hidden="true"])').length, 1);
});

test('closing a legacy profile editor stays closed through refresh and only explicit edit or a new visit reopens it', async t => {
  const { main, page, w, remount } = await controller(t);
  main.querySelector('[data-profile-close]').click(); await settle();
  assert.equal(main.querySelector('#community-profile-dialog'), null);
  const retry = w.document.createElement('button'); retry.dataset.action = 'community-retry'; page.append(retry);
  retry.click(); await settle();
  assert.equal(main.querySelector('#community-profile-dialog'), null, 'ordinary same-route refresh must not reopen a dismissed editor');
  page.querySelector('[data-action="community-profile-edit"]').click(); await settle();
  assert.ok(main.querySelector('#community-profile-dialog'), 'the homepage edit button still opens the editor on its legacy route');
  main.querySelector('[data-profile-close]').click(); await settle();
  await remount('#/community/u/10001');
  assert.equal(main.querySelector('#community-profile-dialog'), null);
  await remount('#/community/profile');
  assert.ok(main.querySelector('#community-profile-dialog'), 'a new visit to the legacy bookmark opens the editor once');
});
