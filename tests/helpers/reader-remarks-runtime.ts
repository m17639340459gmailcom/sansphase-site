import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getPayload } from 'payload';
import sharp from 'sharp';
import { makePayloadConfig } from '../../server/payload/config.ts';
import { migrateReaderAccounts } from '../../server/payload/reader-migration.ts';

const [mode, directory, sourceRoot] = process.argv.slice(2);
assert.ok(['seed', 'missing-column', 'new', 'rollback', 'return'].includes(mode));
assert.ok(directory && sourceRoot);
const configPath = resolve(directory, 'synthetic-config.json');
const fixturePath = resolve(directory, 'fixture.json');
const password = 'IsolatedRemarkDrill2026!';
const note = '迁移演练私有备注：不得丢失';
const newEmail = 'after-upgrade@example.test';
type Fixture = {
  ownerId: string; readerId: string; articleId: string; mediaId: string;
  avatarId: string; mediaFilename: string; readerUid?: string;
  newId?: string; newUid?: string;
};

async function seed() {
  const data = resolve(directory, 'data');
  await mkdir(data);
  const settings = {
    directory: data, secret: randomBytes(48).toString('hex'), push: false,
    siteOrigin: 'https://remarks-runtime.example.test', sourceURL: 'http://127.0.0.1:1',
    authorId: '', communityEnabled: false, loginVerification: { enabled: false },
  };
  const payload = await getPayload({ config: makePayloadConfig({ ...settings, push: true }) });
  try {
    const owner = await payload.create({ collection: 'authors', data: {
      email: 'owner@example.test', password, first_name: '合成作者', role: 'owner',
    } });
    settings.authorId = String(owner.id);
    const avatarId = randomUUID();
    const reader = await payload.create({ collection: 'readers', disableVerificationEmail: true, data: {
      email: 'reader@example.test', password, nickname: '迁移前读者', phone: '13800138000',
      signature: '保留原个签', avatar: avatarId, _verified: true, disabled: false,
      vip_started_at: '2026-01-01T00:00:00.000Z', vip_until: '2099-06-15T12:00:00.000Z',
    } });
    await mkdir(resolve(data, 'uploads'), { recursive: true });
    await writeFile(resolve(data, 'uploads', `reader-avatar-${avatarId}.webp`),
      await sharp({ create: { width: 8, height: 8, channels: 3, background: '#234567' } }).webp().toBuffer());
    const bytes = Buffer.from('Synthetic upload must survive schema and code changes.');
    const media = await payload.create({ collection: 'media', data: { title: '演练附件', originalName: 'fixture.txt' },
      file: { data: bytes, name: 'fixture.txt', mimetype: 'text/plain', size: bytes.length } });
    const article = await payload.create({ collection: 'articles', data: {
      title: '原有演练文章', slug: 'remarks-runtime-fixture', status: 'published',
      body: '<p>代码切换不得覆盖文章正文。</p>', attachments: [{ id: randomUUID(), directus_files_id: String(media.id) }],
    } });
    await payload.create({ collection: 'site_profile', data: { name: '原有合成博客', signature: '原设置保持' } });
    const fixture: Fixture = {
      ownerId: String(owner.id), readerId: String(reader.id), articleId: String(article.id), mediaId: String(media.id),
      avatarId, mediaFilename: String(media.filename),
    };
    await writeFile(fixturePath, JSON.stringify(fixture));
    await writeFile(configPath, JSON.stringify(settings), { mode: 0o600 });
  } finally {
    await payload.destroy();
    (payload.db as unknown as { client: { close(): void } }).client.close();
  }
  await writeFile(resolve(data, 'migration-complete.json'), JSON.stringify({ provider: 'payload' }));
  await migrateReaderAccounts(data);
  const db = new DatabaseSync(resolve(data, 'content.db'));
  try {
    db.exec('ALTER TABLE readers DROP COLUMN admin_remark');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { db.close(); }
}

async function runRuntime() {
  const config = JSON.parse(await readFile(configPath, 'utf8')) as { directory: string; siteOrigin: string; push: boolean };
  assert.equal(config.push, false);
  const { createPayloadRuntime } = await import(pathToFileURL(resolve(sourceRoot, 'server/payload/runtime.ts')).href) as typeof import('../../server/payload/runtime.ts');
  if (mode === 'missing-column') {
    await assert.rejects(createPayloadRuntime(configPath), /explicit reader account migration/);
    return;
  }
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture;
  const runtime = await createPayloadRuntime(configPath);
  const { createPreviewServer } = await import(pathToFileURL(resolve(sourceRoot, 'server.mjs')).href) as typeof import('../../server.mjs');
  const server = createPreviewServer({ ...runtime, root: resolve(directory, 'empty-public'), release: 'synthetic-remarks-drill' });
  try {
    await runtime.healthCheck();
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const request = (path: string, cookie = '', body?: object) => fetch(base + path, {
      method: body ? 'POST' : 'GET', headers: { Origin: config.siteOrigin, Cookie: cookie,
        'Content-Type': 'application/json', 'X-Author-Request': '1', 'X-Reader-Request': '1' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
    });
    assert.equal((await request('/healthz')).status, 200);
    assert.equal((await request('/api/manage/readers')).status, 403);
    const login = await request('/api/author/login', '', { email: 'owner@example.test', password });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const readerLogin = await request('/api/reader/login', '', { email: 'reader@example.test', password });
    assert.equal(readerLogin.status, 200, await readerLogin.clone().text());
    const readerCookie = readerLogin.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request('/api/manage/readers', readerCookie)).status, 403);
    assert.doesNotMatch(await (await request('/api/reader/session', readerCookie)).text(), /admin_remark|迁移演练私有备注/);
    const list = await (await request('/api/manage/readers', cookie)).json();
    const reader = list.users.find((row: { id: string }) => row.id === fixture.readerId);
    assert.ok(reader);
    if (mode === 'new') {
      fixture.readerUid = reader.uid;
      const saved = await request(`/api/manage/readers/${fixture.readerId}/remark`, cookie, { confirmId: fixture.readerId, remark: note });
      assert.equal(saved.status, 200); assert.equal((await saved.json()).remark, note);
      const created = await runtime.payload.create({ collection: 'readers', disableVerificationEmail: true, data: {
        email: newEmail, password, nickname: '上线后新增合成读者', phone: '13900139000', _verified: true, disabled: false,
      } });
      fixture.newId = String(created.id);
    } else {
      assert.equal(reader.uid, fixture.readerUid);
      const newRow = list.users.find((row: { id: string }) => row.id === fixture.newId);
      assert.ok(newRow); assert.equal(newRow.uid, fixture.newUid);
      assert.equal((await request('/api/reader/login', '', { email: newEmail, password })).status, 200);
      if (mode === 'return') {
        assert.equal(reader.remark, note);
        assert.equal(reader.vipUntil, '2099-06-19T12:00:00.000Z');
      } else {
        assert.equal(reader.remark, undefined, 'the historical admin DTO must really be the pre-remark code');
        assert.equal(reader.vipUntil, '2099-06-18T12:00:00.000Z');
      }
    }
    if (mode !== 'return') {
      const changed = await request(`/api/manage/readers/${fixture.readerId}/vip-add-days`, cookie,
        { confirmId: fixture.readerId, days: mode === 'new' ? 3 : 1 });
      assert.equal(changed.status, 200);
      if (mode === 'new') {
        const users = (await (await request('/api/manage/readers', cookie)).json()).users;
        fixture.newUid = users.find((row: { id: string }) => row.id === fixture.newId).uid;
        await writeFile(fixturePath, JSON.stringify(fixture));
      }
    }
    const publicContent = await request('/api/content');
    assert.equal(publicContent.status, 200, await publicContent.clone().text());
    assert.equal((await request('/api/author/logout', cookie, {})).status, 200);
    assert.equal((await request('/api/manage/readers', cookie)).status, 403);
  } finally {
    await new Promise<void>(done => server.close(() => done()));
    await runtime.close();
  }
}

try {
  if (mode === 'seed') await seed(); else await runRuntime();
  console.log(JSON.stringify({ phase: mode, status: 'passed' }));
  // Each old/new runtime lives in its own process. Exiting also releases native
  // SQLite handles before the parent changes code or snapshots the synthetic DB.
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
