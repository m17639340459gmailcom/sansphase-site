import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { getPayload } from 'payload';
import { makePayloadConfig } from '../server/payload/config.ts';
import { createReaderService } from '../server/reader-service.ts';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { createReaderInvitations } from '../server/reader-invitations.ts';
import { readerUidsTableSql, readerUidsTriggerSql, createReaderUidStore } from '../server/reader-uids.ts';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';

test('verified registrations persist one trusted inviter atomically and retain it through failure recovery', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-register-invite-')), sent = [];
  const origin = 'https://www.sansphase.com';
  const payload = await getPayload({ config: makePayloadConfig({ directory, siteOrigin: origin, secret: randomBytes(48).toString('hex'), push: true,
    emailAdapter: () => ({ name: 'test', defaultFromAddress: 'test@example.test', defaultFromName: 'Test', sendEmail: async value => { sent.push(value); } }),
  }) });
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec(readerUidsTableSql + readerUidsTriggerSql);
  const uidStore = createReaderUidStore(directory), workflow = createReaderWorkflow(directory, payload.config.secret);
  const invitations = createReaderInvitations({ directory });
  await migrateCommunity(directory);
  const community = createCommunityStore(directory);
  let failUid = false;
  const service = createReaderService({ payload, directory, siteOrigin: origin, emailReady: true, workflow, invitations,
    uidStore: { ...uidStore, assignRandom(id) { if (failUid) { failUid = false; throw Error('synthetic UID failure'); } return uidStore.assignRandom(id); } } });
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise(done => server.close(done)); community.close(); invitations.close(); uidStore.close(); db.close(); await payload.destroy(); await payload.db.client.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const local = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(local + '/api/reader/' + path, { method: 'POST', headers: { Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const inviter = await payload.create({ collection: 'readers', data: { email: 'inviter@example.test', password: 'password123', nickname: '邀请人', _verified: true, disabled: false }, disableVerificationEmail: true });
  const other = await payload.create({ collection: 'readers', data: { email: 'other@example.test', password: 'password123', nickname: '另一人', _verified: true, disabled: false }, disableVerificationEmail: true });
  const code = invitations.self(inviter.id).code, otherCode = invitations.self(other.id).code;
  const register = async (email, additions = {}) => {
    const response = await post('register', { email, nickname: '受邀人', phone: '13800138000', password: 'password123', inviteCode: code, ...additions });
    assert.equal(response.status, 200, await response.clone().text());
    return { email, requestId: (await response.json()).requestId, code: /\b(\d{6})\b/.exec(sent.at(-1).text)[1] };
  };
  const row = email => db.prepare('SELECT id,invitation_code,invited_by,invitation_bound FROM readers WHERE email=?').get(email);

  const first = await register('first@example.test', { invited_by: other.id });
  assert.equal(row(first.email), undefined, 'no durable reader exists before email verification');
  const verified = await post('verify', { ...first, inviteCode: otherCode, invited_by: other.id });
  assert.equal(verified.status, 200, await verified.clone().text());
  assert.equal(row(first.email).invited_by, inviter.id); assert.equal(row(first.email).invitation_bound, 1);
  assert.match(row(first.email).invitation_code, /^[A-Za-z0-9_-]{24}$/);
  const duplicate = await post('verify', first); assert.equal(duplicate.status, 400);
  assert.equal(invitations.self(inviter.id).invitees.length, 1);

  const actualReader = { kind: 'reader', id: row(first.email).id }, actualInviter = { kind: 'reader', id: inviter.id };
  const created = community.createTopic({ author: actualReader, board: 'qa', title: '受邀新成员注册后的首次发帖',
    body: '真实注册完成以后提出一个具体的问题，必须由管理员人工审核通过。', referral: invitations.attribution(actualReader.id) });
  assert.equal(created.pending, true); assert.equal(community.ledger.balance(actualInviter), 0);
  invitations.assertActive([actualReader.id, inviter.id]);
  assert.equal(community.approveTopic(created.id, new Date().toISOString(), invitations.attribution(actualReader.id)).referralEarned, 15);
  assert.equal(community.ledger.balance(actualInviter), 15);
  assert.throws(() => community.approveTopic(created.id, new Date().toISOString(), invitations.attribution(actualReader.id)), /待审/);
  assert.equal(community.ledger.balance(actualInviter), 15);
  assert.equal(community.ledger.history(actualInviter).filter(entry => entry.reason === 'referral').length, 1);

  const old = await payload.create({ collection: 'readers', data: { email: 'existing@example.test', password: 'password123', nickname: '老成员', _verified: true, disabled: false }, disableVerificationEmail: true });
  const oldAttempt = await post('register', { email: 'existing@example.test', nickname: '老成员', phone: '13800138000', password: 'password123', inviteCode: code });
  assert.equal(oldAttempt.status, 200); assert.equal(row('existing@example.test').id, old.id);
  assert.equal(row('existing@example.test').invited_by, null); assert.equal(row('existing@example.test').invitation_bound, 0);

  const retry = await register('retry@example.test'); failUid = true;
  const failed = await post('verify', retry); assert.ok(failed.status >= 500);
  assert.equal(row(retry.email), undefined, 'rollback removes the account and its binding together');
  const recovered = await post('verify', { ...retry, inviteCode: otherCode });
  assert.equal(recovered.status, 200, await recovered.clone().text()); assert.equal(row(retry.email).invited_by, inviter.id);

  const expired = await register('expired-inviter@example.test');
  await payload.update({ collection: 'readers', id: inviter.id, data: { disabled: true } });
  const finished = await post('verify', expired); assert.equal(finished.status, 200);
  assert.match((await finished.json()).message, /不再计入邀请奖励/);
  assert.equal(row(expired.email).invited_by, null); assert.equal(row(expired.email).invitation_bound, 1);
  const invalid = await post('register', { email: 'invalid@example.test', nickname: '新成员', phone: '13800138000', password: 'password123', inviteCode: code });
  assert.equal(invalid.status, 400); assert.match((await invalid.json()).error, /普通注册/);
  assert.equal(row('invalid@example.test'), undefined);
  assert.equal(invitations.attribution(row(first.email).id), null, 'disabled inviter cannot receive rewards for an earlier registration');
  assert.throws(() => invitations.assertActive([inviter.id, other.id]), /失效/);
  assert.throws(() => invitations.assertActive([randomUUID()]), /失效/);
});
