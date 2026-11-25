import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage } from 'node:http';
import type { SQLiteAdapter } from '@payloadcms/db-sqlite';
import { getPayload } from 'payload';
import { makePayloadConfig } from '../server/payload/config.ts';
import { createPayloadStore } from '../server/payload/store.ts';
import { createAuthorService } from '../server/author-service.ts';
import { createReaderService } from '../server/reader-service.ts';
import { createReaderAdminService } from '../server/reader-admin-service.ts';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { createReaderProfileCommands } from '../server/reader-profile-commands.ts';
import { createReaderUidStore, readerUidsTableSql, readerUidsTriggerSql } from '../server/reader-uids.ts';
import { loginEventsSchema } from '../server/payload/reader-migration.ts';
import { readerAudit, removeReaderAccount } from '../server/reader-account-removal.ts';
import { createPreviewServer } from '../server.mjs';

test('private remarks persist, search literally, retain other account state and stay out of reader identities', { timeout: 90000 }, async t => {
  const reservation = createServer();
  await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>(done => reservation.close(() => done()));
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-private-remarks-'));
  const secret = randomBytes(48).toString('hex');
  const payload = await getPayload({ key: directory, config: makePayloadConfig({ directory, secret, siteOrigin: origin, push: true }) });
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec(readerUidsTableSql + readerUidsTriggerSql + loginEventsSchema); db.close();
  const uidStore = createReaderUidStore(directory), workflow = createReaderWorkflow(directory, secret);
  const profiles = createReaderProfileCommands({ payload, directory, workflow, uidStore });
  let afterMutation: (() => Promise<void>) | undefined;
  const accountMutation = profiles.accountMutation;
  profiles.accountMutation = async <T>(operation: () => Promise<T>) => {
    const result = await accountMutation(operation);
    const complete = afterMutation; afterMutation = undefined;
    await complete?.(); return result;
  };
  const owner = await payload.create({ collection: 'authors', data: { email: 'owner@example.test', password: 'OwnerTesting2026!', first_name: '作者', role: 'owner' } });
  const alice = await payload.create({ collection: 'readers', disableVerificationEmail: true,
    data: { email: 'alice@example.test', password: 'ReaderTesting2026!', nickname: '昵称不变', phone: '13800138000', _verified: true } });
  const bob = await payload.create({ collection: 'readers', disableVerificationEmail: true,
    data: { email: 'bob@example.test', password: 'ReaderTesting2026!', nickname: '普通读者', phone: '13900139000', _verified: true } });
  const authorService = createAuthorService({ url: origin, siteOrigin: origin, authorId: String(owner.id), store: createPayloadStore(payload, { directory, authorId: String(owner.id) }) });
  let remarkObserved: (() => void) | undefined;
  const ownerIdentity = authorService.identity;
  authorService.identity = async req => {
    const identity = await ownerIdentity(req);
    if (req.method === 'POST' && req.url?.endsWith('/remark')) { remarkObserved?.(); remarkObserved = undefined; }
    return identity;
  };
  const readerService = createReaderService({ payload, siteOrigin: origin, directory, emailReady: false, authorService, uidStore, workflow, profileCommands: profiles, ownerReaderId: String(alice.id) });
  const options = { authorService, readerService, readerAdminService: createReaderAdminService({ payload, authorService, siteOrigin: origin, directory, authorId: String(owner.id), uidStore, workflow, profileCommands: profiles }) };
  const server = createPreviewServer(options);
  await new Promise<void>(done => server.listen(address.port, '127.0.0.1', done));
  t.after(async () => {
    try { await new Promise<void>(done => server.close(() => done())); }
    finally {
      uidStore.close(); await payload.destroy(); (payload.db as unknown as SQLiteAdapter).client.close();
      assert.equal(resolve(tmpdir(), basename(directory)), directory); assert.match(basename(directory), /^sansphase-private-remarks-/);
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
  const request = (path: string, cookie = '', body?: unknown, extra: Record<string, string> = {}) => fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-Author-Request': '1', 'X-Reader-Request': '1', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
  });
  const login = await request('/api/author/login', '', { email: 'owner@example.test', password: 'OwnerTesting2026!' });
  assert.equal(login.status, 200); let ownerCookie = login.headers.get('set-cookie')!.split(';')[0];
  const readerLogin = await request('/api/reader/login', '', { email: 'alice@example.test', password: 'ReaderTesting2026!' });
  assert.equal(readerLogin.status, 200); const readerCookie = readerLogin.headers.get('set-cookie')!.split(';')[0];
  const path = `/api/manage/readers/${alice.id}/remark`;
  const sentinel = '仅作者备注%_合作成员🔒';
  for (const cookie of ['', readerCookie]) {
    assert.equal((await request('/api/manage/readers?q=' + encodeURIComponent(sentinel), cookie)).status, 403);
    assert.equal((await request(path, cookie, { confirmId: alice.id, remark: sentinel })).status, 403);
  }
  assert.equal((await request(path, ownerCookie, { confirmId: alice.id, remark: sentinel }, { Origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await request(path, ownerCookie, { confirmId: alice.id, remark: sentinel }, { 'X-Author-Request': '' })).status, 403);
  for (const body of [{ confirmId: bob.id, remark: sentinel }, { confirmId: alice.id }, { confirmId: alice.id, remark: null },
    { confirmId: alice.id, remark: '🔒'.repeat(201) }, { confirmId: alice.id, remark: sentinel, nickname: '不能偷偷改名' }]) {
    assert.equal((await request(path, ownerCookie, body)).status, 400);
  }
  const saved = await request(path, ownerCookie, { confirmId: alice.id, remark: `  ${sentinel}  ` });
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.match(saved.headers.get('cache-control') || '', /\bno-store\b/);
  assert.equal((await saved.json()).remark, sentinel);
  assert.equal((await request(path, ownerCookie, { confirmId: alice.id, remark: '🔒'.repeat(200) })).status, 200, 'limit counts Unicode codepoints, not UTF-16 units');
  assert.equal((await request(path, ownerCookie, { confirmId: alice.id, remark: sentinel })).status, 200);
  for (const q of ['%_', '%', '_', '合作成员', '仅作者', uidStore.get(alice.id), '昵称不变']) {
    const result = await (await request('/api/manage/readers?q=' + encodeURIComponent(q), ownerCookie)).json();
    assert.equal(result.total, 1, `literal search ${q}`); assert.equal(result.users[0].id, alice.id); assert.equal(result.users[0].remark, sentinel);
  }
  const missing = await (await request('/api/manage/readers?q=' + encodeURIComponent("%' OR 1=1 --"), ownerCookie)).json();
  assert.equal(missing.total, 0);
  const publicRead = await payload.findByID({ collection: 'readers', id: alice.id });
  assert.equal(publicRead.admin_remark, undefined, 'default Payload projections hide the field');
  const restricted = await payload.findByID({ collection: 'readers', id: alice.id, overrideAccess: false, showHiddenFields: true,
    user: { ...owner, collection: 'authors' } });
  assert.equal(restricted.admin_remark, undefined, 'field access still denies even a generic owner collection read');
  for (const publicDTO of [await (await request('/api/reader/session', readerCookie)).json(),
    await readerService.identityStrict({ headers: { cookie: readerCookie } } as IncomingMessage),
    await readerService.ownerReaderIdentity({ headers: { cookie: ownerCookie } } as IncomingMessage)]) {
    assert.doesNotMatch(JSON.stringify(publicDTO), /remark|仅作者备注/); assert.equal(publicDTO?.nickname, '昵称不变');
  }
  const token = decodeURIComponent(readerCookie.slice(readerCookie.indexOf('=') + 1));
  assert.doesNotMatch(Buffer.from(token.split('.')[1], 'base64url').toString(), /remark|仅作者备注/);
  const profileUpdate = await request('/api/reader/profile', readerCookie, { nickname: '昵称不变', phone: '13800138000', admin_remark: '伪造备注', remark: '伪造备注' });
  assert.equal(profileUpdate.status, 200); assert.doesNotMatch(await profileUpdate.text(), /remark|仅作者备注/);
  for (const action of ['vip-grant', 'disable', 'enable', 'revoke', 'vip-add-days', 'vip-revoke']) {
    const response = await request(`/api/manage/readers/${alice.id}/${action}`, ownerCookie, { confirmId: alice.id, ...(action === 'vip-add-days' ? { days: 1 } : {}) });
    assert.equal(response.status, 200); const user = await response.json(); assert.equal(user.remark, sentinel, action); assert.equal(user.nickname, '昵称不变');
  }
  const queue = await request('/api/manage/review', ownerCookie); assert.doesNotMatch(await queue.text(), /remark|仅作者备注/);
  const audit = await readFile(resolve(directory, 'reader-admin-audit.jsonl'), 'utf8');
  assert.match(audit, /remark/); assert.doesNotMatch(audit, /仅作者备注|合作成员|🔒/);

  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const enteredQueue = new Promise<void>(done => { entered = done; });
  const hold = profiles.accountMutation(async () => { entered!(); await new Promise<void>(done => { release = done; }); });
  await enteredQueue;
  const initialIdentityChecked = new Promise<void>(done => { remarkObserved = done; });
  const staleWrite = request(path, ownerCookie, { confirmId: alice.id, remark: '退出后不得保存' });
  try {
    await initialIdentityChecked;
    assert.equal((await request('/api/author/logout', ownerCookie, {})).status, 200);
  } finally { release!(); }
  await hold;
  assert.equal((await staleWrite).status, 403, 'queued remark writes recheck the current owner session');
  const signedInAgain = await request('/api/author/login', '', { email: 'owner@example.test', password: 'OwnerTesting2026!' });
  assert.equal(signedInAgain.status, 200); ownerCookie = signedInAgain.headers.get('set-cookie')!.split(';')[0];
  const unchanged = await (await request('/api/manage/readers?q=' + encodeURIComponent(sentinel), ownerCookie)).json();
  assert.equal(unchanged.users[0].remark, sentinel);
  afterMutation = async () => { assert.equal((await request('/api/author/logout', ownerCookie, {})).status, 200); };
  const privateLateResponse = await request(path, ownerCookie, { confirmId: alice.id, remark: '已合法保存但退出后不应回传的备注' });
  assert.equal(privateLateResponse.status, 403, 'a late response cannot expose notes after the owner session is revoked');
  assert.doesNotMatch(await privateLateResponse.text(), /已合法保存|remark/);
  const finalLogin = await request('/api/author/login', '', { email: 'owner@example.test', password: 'OwnerTesting2026!' });
  assert.equal(finalLogin.status, 200); ownerCookie = finalLogin.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await request(path, ownerCookie, { confirmId: alice.id, remark: sentinel })).status, 200);

  await mkdir(resolve(directory, 'uploads'), { recursive: true });
  await writeFile(resolve(directory, 'migration-complete.json'), JSON.stringify({ provider: 'payload' }));
  const config = resolve(directory, 'test-config.json');
  await writeFile(config, JSON.stringify({ directory, secret, authorId: owner.id, siteOrigin: origin }));
  await promisify(execFile)(process.execPath, ['scripts/backup-payload.mjs', resolve(directory, 'verified-backup')],
    { cwd: resolve('.'), env: { ...process.env, PAYLOAD_CONFIG_FILE: config }, timeout: 20000 });
  const snapshot = new DatabaseSync(resolve(directory, 'verified-backup/content.db'), { readOnly: true });
  try { assert.equal(snapshot.prepare('SELECT admin_remark FROM readers WHERE id=?').get(String(alice.id))?.admin_remark, sentinel); }
  finally { snapshot.close(); }
  assert.equal((await request(path, ownerCookie, { confirmId: alice.id, remark: '' })).status, 200);
  const cleared = await (await request('/api/manage/readers?q=' + encodeURIComponent(sentinel), ownerCookie)).json(); assert.equal(cleared.total, 0);
  await request(path, ownerCookie, { confirmId: alice.id, remark: sentinel });
  assert.equal((await request(`/api/manage/readers/${alice.id}/delete`, ownerCookie, { confirmId: alice.id, confirmEmail: alice.email })).status, 200);
  const current = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try { assert.equal(current.prepare('SELECT admin_remark FROM readers WHERE id=?').get(String(alice.id)), undefined); }
  finally { current.close(); }

  // Automatic retention deletes the same account row rather than leaving an orphan note.
  await request(`/api/manage/readers/${bob.id}/remark`, ownerCookie, { confirmId: bob.id, remark: sentinel });
  const writer = new DatabaseSync(resolve(directory, 'content.db'));
  try { writer.prepare('UPDATE readers SET created_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z', String(bob.id)); } finally { writer.close(); }
  const removed = await removeReaderAccount({ payload, directory, uidStore, workflow, row: { id: String(bob.id) },
    audit: readerAudit(directory, String(owner.id)), action: 'auto-delete-inactive', cleanupCondition: { now: Date.now() } });
  assert.equal(removed.deleted, true);
  await assert.rejects(payload.findByID({ collection: 'readers', id: bob.id }), { status: 404 });
});
