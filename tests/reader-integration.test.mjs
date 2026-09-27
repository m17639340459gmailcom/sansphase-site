import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { getPayload } from 'payload';
import { makePayloadConfig } from '../server/payload/config.mjs';
import { createReaderService } from '../server/reader-service.mjs';
import { createReaderAdminService } from '../server/reader-admin-service.mjs';
import { createPreviewServer } from '../server.mjs';
import { DatabaseSync } from 'node:sqlite';
import { loginEventsSchema } from '../server/payload/reader-migration.mjs';
import { createLoginLedger } from '../server/login-ledger.mjs';
import { createReaderRetention } from '../server/reader-retention.mjs';
import { createReaderWorkflow, registrationLifetimeMs } from '../server/reader-workflow.mjs';
import { readerUidsTableSql, readerUidsTriggerSql, createReaderUidStore } from '../server/reader-uids.mjs';
import sharp from 'sharp';
import { createServer } from 'node:net';

test('reader registers, verifies email, signs in and never receives author permission', { timeout: 90000 }, async t => {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const siteOrigin = `http://127.0.0.1:${port}`;
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-reader-'));
  const sent = [];
  const payload = await getPayload({ config: makePayloadConfig({
    directory, secret: randomBytes(48).toString('hex'), push: true,
    siteOrigin,
    emailAdapter: () => ({ name: 'test', defaultFromAddress: 'test@example.test', defaultFromName: 'Test', sendEmail: async message => { sent.push(message); } }),
  }) });
  const auditDb = new DatabaseSync(resolve(directory, 'content.db'));
  auditDb.exec(loginEventsSchema);
  auditDb.exec(readerUidsTableSql);
  auditDb.exec(readerUidsTriggerSql);
  auditDb.close();
  const loginLedger = createLoginLedger(directory);
  const uidStore = createReaderUidStore(directory);
  const workflow = createReaderWorkflow(directory, payload.config.secret);
  await payload.create({ collection: 'authors', data: { email: 'owner@example.test', password: 'owner-secret-long', first_name: 'Owner', role: 'owner' } });
  const authorService={identity:async req=>req.headers.cookie==='owner=yes'?{name:'Owner'}:null,loginCredentials:async(res,{email,password})=>{if(email!=='owner@example.test'||password!=='owner-secret-long')throw Error('Invalid credentials');res.setHeader('Set-Cookie','owner=yes; HttpOnly; SameSite=Strict; Path=/');return{name:'Owner'};},handle:async (_req,res)=>{res.writeHead(404);res.end();}};
  const server = createPreviewServer({ contentService: { snapshot: async () => ({ data: { source: 'cms', profile: null, announcements: [], notes: [], works: [{ id: 'secret', title: 'Secret', tags: [] }], resources: [], software: [], 'resource-center': [] } }) }, readerService: createReaderService({ payload, siteOrigin, directory, emailReady: true, authorService, loginLedger, uidStore }), authorService, readerAdminService:createReaderAdminService({payload,authorService,siteOrigin,directory,authorId:randomUUID(),loginLedger,uidStore}) });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); loginLedger.close(); uidStore.close(); await payload.destroy(); await payload.db.client.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const base = siteOrigin;
  const post = async (path, body, cookie = '', realIp = '') => fetch(base + '/api/reader/' + path, { method: 'POST', headers: { Origin: base, 'X-Reader-Request': '1', 'Content-Type': 'application/json', cookie, ...(realIp ? { 'X-Real-IP': realIp } : {}) }, body: JSON.stringify(body) });
  const approveReview = async kind => {
    const queue = await (await fetch(base + '/api/manage/review', { headers: { cookie: 'owner=yes' } })).json();
    const row = queue.profiles.find(item => item.kind === kind);
    assert.ok(row, `${kind} is pending owner review`);
    const response = await fetch(base + `/api/manage/review/profile/${row.id}/approve`, {
      method: 'POST', headers: { cookie: 'owner=yes', Origin: base, 'X-Author-Request': '1', 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 200, await response.text());
  };
  const account = { email: 'Reader@Example.Test', nickname: '读者', phone: '13800138000', password: '12345678' };
  assert.equal((await post('register', { ...account, phone: '' })).status, 400);
  for (const invalidPhone of ['66666666', '23800138000', '1380013800', '+8613800138000']) {
    const invalid = await post('register', { ...account, phone: invalidPhone });
    assert.equal(invalid.status, 400, invalidPhone);
    assert.match((await invalid.json()).error, /请输入正确的手机号/);
  }
  assert.equal((await post('register', { ...account, password: '1234567' })).status, 400, 'seven-character passwords are rejected');
  const ownerAccount = { ...account, email: 'owner@example.test' };
  assert.equal((await post('register', ownerAccount)).status, 200);
  assert.equal(sent.length, 0);
  assert.equal((await post('login', { email: ownerAccount.email, password: 'wrong-password' })).status, 401);
  const ownerLogin = await post('login', { email: ownerAccount.email, password: 'owner-secret-long' });
  assert.equal(ownerLogin.status, 200);
  assert.equal((await ownerLogin.json()).role, 'owner');
  assert.match(ownerLogin.headers.get('set-cookie'), /owner=yes/);
  assert.equal((await post('register', account)).status, 200);
  assert.equal(sent.length, 1);
  assert.equal((await fetch(base + '/api/manage/readers?status=pending', { headers: { cookie: 'owner=yes' } })).status, 400);
  const waiting = await (await fetch(base + '/api/manage/readers', { headers: { cookie: 'owner=yes' } })).json();
  assert.equal(waiting.total, 0, 'unverified registrations are absent from account management');
  assert.equal((await post('resend', {email:account.email})).status, 200);
  assert.equal(sent.length, 2);
  let response = await post('login', account);
  assert.equal(response.status, 401);
  const token = /#\/verify\/([^"<]+)/.exec(sent.at(-1).html)?.[1];
  assert.ok(token);
  const verificationAttempts = await Promise.all([
    post('verify', { token: decodeURIComponent(token) }),
    post('verify', { token: decodeURIComponent(token) }),
  ]);
  assert.deepEqual(verificationAttempts.map(result => result.status).sort(), [200, 400], 'one verification link activates an account only once');
  const verified = verificationAttempts.find(result => result.status === 200);
  assert.equal(verified.status, 200);
  assert.match((await verified.json()).message, /验证成功/);
  response = await post('login', account, '', '198.51.100.23');
  assert.equal(response.status, 200);
  const signedIn = await response.json();
  assert.equal(signedIn.nickname, '读者');
  assert.match(signedIn.uid, /^\d{6}$/, 'verified readers receive a six-digit UID');
  const firstUid = signedIn.uid;
  const readerSession = await (await fetch(base + '/api/reader/session', { headers: { cookie: response.headers.get('set-cookie').split(';')[0] } })).json();
  assert.equal(readerSession.phone, '13800138000');
  assert.equal(readerSession.uid, firstUid);
  assert.equal(readerSession.lastLoginIp, undefined);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await fetch(base + '/api/reader/session', { headers: { cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/content?view=detail&kind=works&id=secret', { headers: { cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/author/session', { headers: { cookie } })).status, 404);
  assert.equal((await fetch(base + '/api/manage/readers', { headers: { cookie } })).status, 403,
    'reader sessions cannot view the owner management API');
  assert.equal((await fetch(base + '/api/manage/review', { headers: { cookie } })).status, 403);
  assert.equal((await post('profile', { nickname: '新昵称', phone: 'bad' }, cookie)).status, 400);
  assert.equal((await post('profile', { nickname: '新昵称', phone: '66666666' }, cookie)).status, 400);
  assert.equal((await post('profile', { nickname: '新昵称', phone: '13900139000', signature: 'x'.repeat(101) }, cookie)).status, 400);
  assert.equal((await post('profile', { nickname: '新昵称', phone: '13900139000', signature: '加微信 13800138000' }, cookie)).status, 400);
  assert.equal((await post('profile', { nickname: '新昵称', phone: '13900139000', signature: '在星光里继续阅读' }, cookie)).status, 200);
  assert.equal((await (await fetch(base + '/api/reader/session', { headers: { cookie } })).json()).signature, '');
  await approveReview('signature');
  assert.equal((await (await fetch(base + '/api/reader/session', { headers: { cookie } })).json()).signature, '在星光里继续阅读');
  const avatarUpload = async (data, type = 'image/png', headers = {}, readerCookie = cookie) => {
    const form = new FormData();
    form.append('file', new Blob([data], { type }), 'avatar.png');
    return fetch(base + '/api/reader/avatar', { method: 'POST', headers: { cookie: readerCookie, Origin: base, 'X-Reader-Request': '1', ...headers }, body: form });
  };
  const image = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#795da8' } }).png().toBuffer();
  assert.equal((await avatarUpload(image, 'image/png', { Origin: 'http://untrusted.example' })).status, 403);
  assert.equal((await avatarUpload(Buffer.from('not an image'), 'image/png')).status, 400);
  const uploaded = await avatarUpload(image);
  assert.equal(uploaded.status, 200);
  assert.equal((await uploaded.json()).reviewPending, true);
  await approveReview('avatar');
  const avatar = (await (await fetch(base + '/api/reader/session', { headers: { cookie } })).json()).avatar;
  assert.match(avatar, /^\/api\/reader\/avatar\/[0-9a-f-]{36}\.webp$/);
  assert.equal((await fetch(base + avatar)).status, 401);
  assert.equal((await fetch(base + avatar, { headers: { cookie: 'owner=yes' } })).status, 401);
  const avatarResponse = await fetch(base + avatar, { headers: { cookie } });
  assert.equal(avatarResponse.status, 200);
  assert.equal(avatarResponse.headers.get('content-type'), 'image/webp');
  assert.equal(avatarResponse.headers.get('cache-control'), 'private, no-store');
  const avatarMeta = await sharp(Buffer.from(await avatarResponse.arrayBuffer())).metadata();
  assert.equal(avatarMeta.width, 320);
  assert.equal(avatarMeta.height, 320);
  assert.equal((await (await fetch(base + '/api/reader/session', { headers: { cookie } })).json()).avatar, avatar);
  const replacement = await avatarUpload(image);
  assert.equal(replacement.status, 200);
  assert.equal((await (await fetch(base + '/api/reader/session', { headers: { cookie } })).json()).avatar, avatar, 'old avatar remains while review is pending');
  await approveReview('avatar');
  assert.equal((await fetch(base + avatar, { headers: { cookie } })).status, 404, 'old avatar URL stops working');
  await assert.rejects(access(resolve(directory, 'uploads', `reader-avatar-${avatar.split('/').at(-1).replace(/\.webp$/, '')}.webp`)),
    'replaced avatar bytes are physically removed');
  assert.equal((await avatarUpload(image)).status, 200);
  const rejectedReview = (await (await fetch(base + '/api/manage/review', { headers: { cookie: 'owner=yes' } })).json()).profiles.find(row => row.kind === 'avatar');
  const rejectedAvatarId = workflow.profile(rejectedReview.id).proposed_value;
  const rejection = await fetch(base + `/api/manage/review/profile/${rejectedReview.id}/reject`, {
    method: 'POST', headers: { cookie: 'owner=yes', Origin: base, 'X-Author-Request': '1', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(rejection.status, 200);
  await assert.rejects(access(resolve(directory, 'uploads', `pending-reader-avatar-${rejectedAvatarId}.webp`)));
  const removedAvatar = await post('avatar/remove', {}, cookie);
  assert.equal(removedAvatar.status, 200);
  assert.equal((await removedAvatar.json()).avatar, null);
  assert.equal((await fetch(base + avatar, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(base + '/api/manage/readers')).status, 403);
  const list = await (await fetch(base + '/api/manage/readers', { headers: { cookie: 'owner=yes' } })).json();
  assert.equal(list.users.length, 1);
  assert.deepEqual(list.summary, { total: 1, active: 1, disabled: 0, vip: 0, expiredVip: 0 });
  assert.equal(list.users[0].nickname, '新昵称');
  assert.equal(list.users[0].uid, firstUid);
  assert.equal(list.users[0].phone, '13900139000');
  assert.equal(list.users[0].lastLoginIp, '198.51.100.23');
  assert.match(list.users[0].lastLoginAt, /^\d{4}-\d{2}-\d{2}T/);
  const loginHistory = await (await fetch(base + `/api/manage/readers/${list.users[0].id}/logins`, { headers: { cookie: 'owner=yes' } })).json();
  assert.equal(loginHistory.events[0].ip, '198.51.100.23');
  assert.equal((await fetch(base + `/api/manage/readers/${list.users[0].id}/logins`)).status, 403);
  assert.equal(list.users[0].password, undefined);
  assert.equal(list.users[0].vip, false);
  const phoneSearch = await (await fetch(base + '/api/manage/readers?q=13900139000', { headers: { cookie: 'owner=yes' } })).json();
  assert.equal(phoneSearch.total, 1);
  const uidSearch = await (await fetch(base + `/api/manage/readers?q=UID%20${firstUid}`, { headers: { cookie: 'owner=yes' } })).json();
  assert.equal(uidSearch.total, 1);
  const adminPost = (action, extra = {}, options = {}) => fetch(base + `/api/manage/readers/${list.users[0].id}/${action}`, { method: 'POST', headers: { cookie: options.cookie || 'owner=yes', Origin: options.origin || base, 'X-Author-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmId: list.users[0].id, ...extra }) });
  const beforeDirectGrant = Date.now();
  assert.equal((await adminPost('vip-add-days', { days: 7 })).status, 200, 'the author can grant a specified number of VIP days without opening a month first');
  const directlyGranted = await (await fetch(base + '/api/reader/session', { headers: { cookie } })).json();
  assert.equal(directlyGranted.vip, true);
  assert(Date.parse(directlyGranted.vipUntil) >= beforeDirectGrant + 7 * 86400000);
  assert(Date.parse(directlyGranted.vipUntil) < Date.now() + 7 * 86400000 + 5000);
  assert.equal((await adminPost('vip-revoke')).status, 200);
  assert.equal((await (await fetch(base + '/api/reader/session', { headers: { cookie } })).json()).vip, false);
  assert.equal((await adminPost('vip-grant')).status, 200);
  const vipAccount = await (await fetch(base + '/api/reader/session', { headers: { cookie } })).json();
  assert.equal(vipAccount.vip, true);
  assert.match(vipAccount.vipUntil, /^\d{4}-\d{2}-\d{2}T/);
  for (const days of [0, -1, 1.5, 366, '7', null]) assert.equal((await adminPost('vip-add-days', { days })).status, 400, String(days));
  assert.equal((await adminPost('vip-add-days', { days: 7 }, { cookie })).status, 403, 'reader cannot extend VIP');
  assert.equal((await adminPost('vip-add-days', { days: 7 }, { origin: 'http://untrusted.example' })).status, 403, 'VIP extension requires trusted origin');
  assert.equal((await adminPost('vip-add-days', { days: 7 })).status, 200);
  const extended = await (await fetch(base + '/api/reader/session', { headers: { cookie } })).json();
  assert.equal(Date.parse(extended.vipUntil) - Date.parse(vipAccount.vipUntil), 7 * 86400000);
  const extensionAudit = await (await fetch(base + '/api/manage/audit', { headers: { cookie: 'owner=yes' } })).json();
  assert.equal(extensionAudit.events[0].action, 'vip-add-days');
  assert.equal(extensionAudit.events[0].days, 7);
  assert.equal((await adminPost('vip-grant')).status, 200);
  const renewed = await (await fetch(base + '/api/reader/session', { headers: { cookie } })).json();
  assert.ok(Date.parse(renewed.vipUntil) > Date.parse(extended.vipUntil));
  assert.equal((await adminPost('vip-revoke')).status, 200);
  assert.equal((await (await fetch(base + '/api/reader/session', { headers: { cookie } })).json()).vip, false);
  assert.equal((await adminPost('vip-revoke')).status, 200);
  assert.equal((await adminPost('disable')).status, 200);
  const disabled = await (await fetch(base + '/api/manage/readers?status=disabled', { headers: { cookie: 'owner=yes' } })).json();
  assert.equal(disabled.total, 1);
  assert.deepEqual(disabled.summary, { total: 1, active: 0, disabled: 1, vip: 0, expiredVip: 0 });
  const activity = await (await fetch(base + '/api/manage/audit', { headers: { cookie: 'owner=yes' } })).json();
  assert.equal(activity.events[0].action, 'disable');
  assert.equal((await fetch(base + '/api/content?view=detail&kind=works&id=secret', { headers: { cookie } })).status, 401);
  assert.equal((await adminPost('enable')).status, 200);
  assert.equal((await post('logout', {}, cookie)).status, 200);
  assert.equal((await fetch(base + '/api/content?view=detail&kind=works&id=secret', { headers: { cookie } })).status, 401);
  for (const email of ['reader@qq.com', 'reader@gmail.com', 'reader@163.com', 'reader@126.com', 'reader@yeah.net']) {
    const before = sent.length;
    assert.equal((await post('register', { ...account, email })).status, 200, email);
    assert.equal(sent.length, before + 1, email);
    assert.equal(sent.at(-1).to, email);
    const linkToken = /#\/verify\/([^"<]+)/.exec(sent.at(-1).html)?.[1];
    assert.ok(linkToken, email);
    assert.equal((await post('verify', { token: decodeURIComponent(linkToken) })).status, 200, email);
    assert.equal((await post('login', { email, password: account.password })).status, 200, email);
  }
  const numbered = await (await fetch(base + '/api/manage/readers', { headers: { cookie: 'owner=yes' } })).json();
  const issued = numbered.users.map(user => user.uid);
  assert.equal(issued.length, 6);
  assert.equal(new Set(issued).size, 6, 'random UIDs remain unique');
  assert(issued.every(uid => /^\d{6}$/.test(uid)));
  const anotherUid = issued.find(uid => uid !== firstUid);
  const setUid = (uid, options = {}) => fetch(base + `/api/manage/readers/${list.users[0].id}/uid`, {
    method: 'POST', headers: { cookie: options.cookie || 'owner=yes', Origin: options.origin || base, 'X-Author-Request': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmId: list.users[0].id, uid }),
  });
  assert.equal((await setUid('123456789', { cookie })).status, 403, 'a reader cannot assign UIDs');
  assert.equal((await setUid('123456789', { origin: 'http://untrusted.example' })).status, 403, 'UID edits require a trusted origin');
  for (const invalid of ['0000', '1', 'abcd', '1234567890']) assert.equal((await setUid(invalid)).status, 400, invalid);
  assert.equal((await setUid(anotherUid)).status, 409, 'another reader already owns this UID');
  const changed = await setUid('123456789');
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).uid, '123456789');
  assert.equal((await (await fetch(base + '/api/manage/readers?q=UID%20123456789', { headers: { cookie: 'owner=yes' } })).json()).users[0].id, list.users[0].id);
  assert.equal((await (await fetch(base + `/api/manage/readers?q=UID%20${firstUid}`, { headers: { cookie: 'owner=yes' } })).json()).total, 0);
  const relogin = await post('login', account);
  const readerCookie = relogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await fetch(base + '/api/reader/session', { headers: { cookie: readerCookie } })).json()).uid, '123456789');
  const uidAudit = await (await fetch(base + '/api/manage/audit', { headers: { cookie: 'owner=yes' } })).json();
  assert.equal(uidAudit.events[0].action, 'uid-change');
  assert.equal(uidAudit.events[0].from, firstUid);
  assert.equal(uidAudit.events[0].to, '123456789');
  const nextEmail = 'later@example.test';
  assert.equal((await post('register', { ...account, email: nextEmail })).status, 200);
  const nextToken = /#\/verify\/([^"<]+)/.exec(sent.at(-1).html)?.[1];
  assert.equal((await post('verify', { token: decodeURIComponent(nextToken) })).status, 200);
  const nextLogin = await post('login', { email: nextEmail, password: account.password });
  const nextIdentity = await nextLogin.json();
  const nextUid = nextIdentity.uid;
  assert.match(nextUid, /^\d{6}$/);
  assert(!issued.includes(nextUid), 'new verified readers receive an unused random UID');
  const privateAvatar = await avatarUpload(image, 'image/png', {}, readerCookie);
  assert.equal(privateAvatar.status, 200);
  await approveReview('avatar');
  const privateAvatarUrl = (await (await fetch(base + '/api/reader/session', { headers: { cookie: readerCookie } })).json()).avatar;
  const differentReaderCookie = nextLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + privateAvatarUrl, { headers: { cookie: differentReaderCookie } })).status, 404);
  assert.equal((await fetch(base + privateAvatarUrl, { headers: { cookie: readerCookie } })).status, 200);
  const beforeResetMail = sent.length;
  assert.equal((await post('forgot', { email: nextEmail })).status, 200);
  assert.equal(sent.length, beforeResetMail + 1, 'password recovery sends one email through the configured adapter');
  const resetToken = /#\/reset\/([^"<]+)/.exec(sent.at(-1).html)?.[1];
  assert.ok(resetToken);
  assert.equal((await post('reset', { token: 'invalid-reset-token-value', password: 'replacement-passphrase-123' })).status, 400);
  const shortPassword = await post('reset', { token: decodeURIComponent(resetToken), password: '1234567' });
  assert.equal(shortPassword.status, 400);
  assert.match((await shortPassword.json()).error, /8 至 128/, 'password errors must not be mislabeled as expired links');
  assert.equal((await post('reset', { token: decodeURIComponent(resetToken), password: 'Ab!23456' })).status, 200);
  assert.equal(await (await fetch(base + '/api/reader/session', { headers: { cookie: differentReaderCookie } })).json(), null,
    'password recovery must revoke sessions issued before the reset');
  assert.equal((await post('login', { email: nextEmail, password: account.password })).status, 401, 'old password cannot sign in after recovery');
  assert.equal((await post('login', { email: nextEmail, password: 'Ab!23456' })).status, 200);
  assert.equal((await post('reset', { token: decodeURIComponent(resetToken), password: 'another-passphrase-123' })).status, 400, 'a reset link is single-use');

  assert.equal((await post('register', { ...account, email: 'pending@example.test' })).status, 200);
  assert.equal((await payload.find({ collection: 'readers', where: { email: { equals: 'pending@example.test' } } })).totalDocs, 0,
    'unverified requests never create a formal reader');
  const activePending = workflow.registrationByEmail('pending@example.test');
  const pendingReview = await (await fetch(base + '/api/manage/review', { headers: { cookie: 'owner=yes' } })).json();
  assert(!pendingReview.expired.some(row => row.id === activePending.id), 'active five-minute requests cannot be selected for manual cleanup');
  const cleanupRequests = ids => fetch(base + '/api/manage/review/expired/cleanup', {
    method: 'POST', headers: { cookie: 'owner=yes', Origin: base, 'X-Author-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  });
  assert.equal((await (await cleanupRequests([activePending.id])).json()).cleaned, 0);
  assert(workflow.registrationByEmail('pending@example.test'));
  const expiredPending = workflow.putRegistration({ email: 'expired@example.test', nickname: '过期读者', phone: '13800138000', password: '12345678' }, Date.now() - registrationLifetimeMs - 1000);
  const expiredReview = await (await fetch(base + '/api/manage/review', { headers: { cookie: 'owner=yes' } })).json();
  assert(expiredReview.expired.some(row => row.id === expiredPending.id));
  assert.equal((await (await cleanupRequests([expiredPending.id])).json()).cleaned, 1);
  assert.equal(workflow.expiredRegistrations().some(row => row.id === expiredPending.id), false);
  const legacyUnverified = await payload.create({ collection: 'readers', data: {
    email: 'legacy-pending@example.test', password: '12345678', nickname: '旧申请', phone: '13800138000', disabled: false,
  }, disableVerificationEmail: true });
  const shortRetention = createReaderRetention({ payload, directory, loginLedger, uidStore, workflow });
  const expiredAt = new Date(Date.now() + registrationLifetimeMs + 1000);
  const expiredSweep = await shortRetention.sweepPending(expiredAt);
  assert.equal(expiredSweep.requests, 1, 'temporary registration is physically deleted after five minutes');
  assert.equal(expiredSweep.legacy, 1, 'old unverified reader rows are also removed');
  assert.equal(workflow.registrationByEmail('pending@example.test', expiredAt.getTime()), null);
  assert.equal((await payload.find({ collection: 'readers', where: { id: { equals: legacyUnverified.id } } })).totalDocs, 0);
  await shortRetention.close();
  assert.equal((await (await fetch(base + '/api/manage/readers', { headers: { cookie: 'owner=yes' } })).json()).summary.total, 7,
    'the owner list excludes a newly created account until email verification succeeds');
  const deleteAccount = (confirmEmail, options = {}) => fetch(base + `/api/manage/readers/${list.users[0].id}/delete`, {
    method: 'POST', headers: { cookie: options.cookie || 'owner=yes', Origin: options.origin || base, 'X-Author-Request': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmId: list.users[0].id, confirmEmail }),
  });
  assert.equal((await deleteAccount(account.email, { cookie })).status, 403);
  assert.equal((await deleteAccount(account.email, { origin: 'http://untrusted.example' })).status, 403);
  assert.equal((await deleteAccount('wrong@example.test')).status, 400);
  assert.equal((await fetch(base + '/api/reader/session', { headers: { cookie: readerCookie } })).status, 200);
  const deletion = await deleteAccount(account.email);
  assert.equal(deletion.status, 200);
  assert.deepEqual(await deletion.json(), { id: list.users[0].id, uid: '123456789', deleted: true });
  assert.equal(await (await fetch(base + '/api/reader/session', { headers: { cookie: readerCookie } })).json(), null);
  assert.equal((await post('login', account)).status, 401);
  assert.equal(uidStore.get(list.users[0].id), '123456789', 'deleted UIDs remain reserved');
  assert(loginLedger.list('reader', list.users[0].id).length > 0, 'login audit survives account deletion');
  await assert.rejects(access(resolve(directory, 'uploads', `reader-avatar-${privateAvatarUrl.split('/').at(-1).replace(/\.webp$/, '')}.webp`)));
  assert.equal((await deleteAccount(account.email)).status, 404);

  const grantNextVip = () => fetch(base + `/api/manage/readers/${nextIdentity.id}/vip-grant`, {
    method: 'POST', headers: { cookie: 'owner=yes', Origin: base, 'X-Author-Request': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmId: nextIdentity.id }),
  });
  assert.equal((await grantNextVip()).status, 200);
  assert.equal((await grantNextVip()).status, 200);
  const retention = createReaderRetention({ payload, directory, loginLedger, uidStore });
  const afterThirtyOneDays = new Date(Date.now() + 31 * 86400000);
  const dryRun = await retention.sweep({ now: afterThirtyOneDays, dryRun: true });
  assert.equal(dryRun.eligible, 5, 'five inactive readers are due; active VIP is exempt');
  assert.equal(dryRun.deleted, 0);
  const sweep = await retention.sweep({ now: afterThirtyOneDays });
  assert.equal(sweep.deleted, 5);
  const survivors = await (await fetch(base + '/api/manage/readers', { headers: { cookie: 'owner=yes' } })).json();
  assert.equal(survivors.summary.total, 1);
  assert.equal(survivors.users[0].id, nextIdentity.id);
  assert.equal((await retention.sweep({ now: new Date(Date.now() + 70 * 86400000) })).deleted, 1,
    'an inactive VIP can be cleaned after the membership expires');
  assert.equal((await (await fetch(base + '/api/manage/readers', { headers: { cookie: 'owner=yes' } })).json()).summary.total, 0);

  await t.test('membership filters sort before pagination and exclude never-VIP/revoked/unverified accounts', async () => {
    const until = days => new Date(Date.now() + days * 86400000).toISOString();
    const fixtures = [];
    for (let index = 24; index >= 1; index--) {
      const row = await payload.create({ collection: 'readers', disableVerificationEmail: true, data: {
        email: `sort-${index}@example.test`, password: 'fixture-password', nickname: `Sort fixture ${index}`,
        phone: '13800138000', _verified: true, disabled: false, vip_until: until(index),
      } });
      fixtures.push(row);
    }
    for (const [name, days, verified] of [['expired-old', -9, true], ['expired-recent', -1, true], ['never', null, true], ['revoked', null, true], ['pending', 1, false]]) {
      await payload.create({ collection: 'readers', disableVerificationEmail: true, data: {
        email: `${name}@example.test`, password: 'fixture-password', nickname: name, phone: '13800138000',
        _verified: verified, disabled: false, vip_until: days === null ? null : until(days),
      } });
    }
    const getMembers = async query => {
      const response = await fetch(base + '/api/manage/readers?' + new URLSearchParams(query), { headers: { cookie: 'owner=yes' } });
      assert.equal(response.status, 200); return response.json();
    };
    const first = await getMembers({ membership: 'vip' });
    const second = await getMembers({ membership: 'vip', page: '2' });
    assert.equal(first.total, 24); assert.equal(first.totalPages, 2);
    assert.equal(first.summary.vip, first.total, 'overview counts all VIP users, not just the first page');
    assert.equal(first.summary.expiredVip, 2);
    assert.equal(first.users.length, 20); assert.equal(second.users.length, 4);
    assert.deepEqual([...first.users, ...second.users].map(user => user.email), Array.from({ length: 24 }, (_, index) => `sort-${index + 1}@example.test`));
    assert(first.users.every(user => user.vip));
    const searched = await getMembers({ membership: 'vip', q: 'sort-24@' });
    assert.equal(searched.total, 1); assert.equal(searched.users[0].email, 'sort-24@example.test');
    assert.equal(searched.summary.vip, 24, 'overview is independent of the search and filter');
    assert.equal(searched.summary.expiredVip, 2);
    assert.equal((await getMembers({ membership: 'expired', q: 'sort-24@' })).total, 0);
    const expired = await getMembers({ membership: 'expired' });
    assert.equal(expired.total, 2);
    assert.equal(expired.summary.expiredVip, expired.total);
    assert.deepEqual(expired.users.map(user => user.email), ['expired-recent@example.test', 'expired-old@example.test']);
    assert(expired.users.every(user => !user.vip));
    assert.equal((await getMembers({ membership: 'all' })).total, 28);
    assert.equal((await fetch(base + '/api/manage/readers?membership=invalid', { headers: { cookie: 'owner=yes' } })).status, 400);
    assert.equal((await fetch(base + '/api/manage/readers?membership=vip')).status, 403);
  });
});
