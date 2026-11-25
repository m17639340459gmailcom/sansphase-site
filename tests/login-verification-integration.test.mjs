import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createLoginVerification } from '../server/login-verification.ts';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { createReaderService } from '../server/reader-service.ts';
import { createAuthorService } from '../server/author-service.ts';

async function fixture(t, enabled = true) {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-login-http-'));
  const calls = { reader: 0, author: 0, verification: 0 };
  let readerService, authorService;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api/reader/')) void readerService.handle(req, res);
    else if (req.url.startsWith('/api/author/')) void authorService.handle(req, res);
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
  const workflow = createReaderWorkflow(directory, 'payload-'.padEnd(64, 'p'));
  const issued = new Set();
  const actual = createLoginVerification({ directory, siteOrigin: origin, settings: enabled ? { enabled: true, engine: 'tianai', serviceOrigin: 'http://127.0.0.1:4253', serviceSecret: 's'.repeat(48), hmacSecret: 'hmac-'.padEnd(64, 'h'), keySecret: 'key-'.padEnd(64, 'k') } : null, workflow,
    engineRequest: async (url, init) => {
      if (new URL(url).pathname === '/verify') { const {id,track}=JSON.parse(init.body); const fresh=issued.delete(id); return Response.json({verified:fresh && track.left===120}); }
      const id=randomUUID(); issued.add(id);
      return Response.json({id,type:'SLIDER',backgroundImage:'data:image/jpeg;base64,/9j/2Q==',templateImage:'data:image/png;base64,iVBORw0KGgo=',backgroundImageWidth:600,backgroundImageHeight:360,templateImageWidth:110,templateImageHeight:360});
    },
  });
  const loginVerification = { issue: actual.issue, match: actual.match, verify: async (...args) => { calls.verification++; return actual.verify(...args); } };
  const store = {
    login: async ({ email, password }) => { calls.author++; if (email !== 'owner@example.test' || password !== 'owner-password') throw Object.assign(Error('Wrong credentials'), { status: 401 }); return 'owner-token'; },
    identity: async () => ({ id: 'owner-id', first_name: 'Owner' }),
    logout: async () => {},
  };
  authorService = createAuthorService({ url: origin, siteOrigin: origin, authorId: 'owner-id', store, loginVerification });
  const payload = {
    config: { secret: 'payload-'.padEnd(64, 'p') },
    find: async ({ collection, where }) => ({ docs: collection === 'authors' && where.email.equals === 'owner@example.test' ? [{ id: 'owner-id', role: 'owner' }] : [] }),
    login: async ({ data }) => {
      calls.reader++;
      if (data.email !== 'reader@example.test' || data.password !== 'reader-password') throw Error('Wrong credentials');
      return { token: 'reader-token', user: { id: 'reader-id', collection: 'readers', email: data.email, nickname: '读者', _verified: true, disabled: false, createdAt: '2026-01-01T00:00:00Z' } };
    },
    auth: async () => ({ user: null }),
  };
  readerService = createReaderService({ payload, siteOrigin: origin, directory, uidStore: { get: () => '10001' }, workflow, authorService, loginVerification });
  const post = (namespace, path, body = {}, headers = {}) => fetch(`${origin}/api/${namespace}/${path}`, {
    method: 'POST', headers: { Origin: origin, [`X-${namespace === 'author' ? 'Author' : 'Reader'}-Request`]: '1', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const challenge = async (namespace = 'reader') => {
    const res = await post(namespace, 'login-challenge'); assert.equal(res.status, 200);
    const value = await res.json(); assert.equal(value.enabled, true);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const match = await post(namespace, 'login-challenge/verify', {token:value.challenge.token,track:{bgImageWidth:300,bgImageHeight:180,templateImageWidth:55,templateImageHeight:180,startTime:Date.now()-1200,stopTime:Date.now(),left:120,top:0,trackList:Array.from({length:20},(_,i)=>({x:i*6,y:i%3,t:i*60,type:i===0?'DOWN':i===19?'UP':'MOVE'}))}}, {Cookie:cookie});
    assert.equal(match.status,200,await match.clone().text());
    return { Cookie: cookie, 'X-Login-Verification': (await match.json()).proof };
  };
  return { directory, origin, post, challenge, calls };
}

test('reader, direct author and reader-to-owner login each validate once before password authentication', async t => {
  const f = await fixture(t);
  for (const [namespace, email, password, role] of [
    ['reader', 'reader@example.test', 'reader-password', 'reader'],
    ['author', 'owner@example.test', 'owner-password', undefined],
    ['reader', 'owner@example.test', 'owner-password', 'owner'],
  ]) {
    const before = f.calls.verification;
    const result = await f.post(namespace, 'login', { email, password }, await f.challenge(namespace));
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal((await result.json()).role, role);
    assert.equal(f.calls.verification, before + 1, 'owner delegation does not consume proof twice');
    assert.match(result.headers.get('set-cookie'), /sansphase_(?:reader|author)_session=/);
  }
  assert.deepEqual(f.calls, { reader: 1, author: 2, verification: 3 });
  const db = new DatabaseSync(resolve(f.directory, 'login-verification.db'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM login_verification_used').get().count, 6); }
  finally { db.close(); }
});

test('missing proof and replay cannot reach authentication, while failed passwords require a fresh proof', async t => {
  const f = await fixture(t);
  for (const namespace of ['reader', 'author']) {
    const result = await f.post(namespace, 'login', { email: 'owner@example.test', password: 'owner-password' });
    assert.equal(result.status, 403); assert.equal(result.headers.get('set-cookie'), null);
  }
  assert.equal(f.calls.author, 0); assert.equal(f.calls.reader, 0);
  const headers = await f.challenge();
  assert.equal((await f.post('reader', 'login', { email: 'reader@example.test', password: 'bad-password' }, headers)).status, 401);
  assert.equal((await f.post('reader', 'login', { email: 'reader@example.test', password: 'reader-password' }, headers)).status, 403);
  assert.equal(f.calls.reader, 1);
  assert.equal((await f.post('reader', 'login', { email: 'reader@example.test', password: 'reader-password' }, await f.challenge())).status, 200);
});

test('parallel HTTP logins with the same proof issue exactly one account session', async t => {
  const f = await fixture(t), headers = await f.challenge();
  const results = await Promise.all(Array.from({ length: 6 }, () => f.post('reader', 'login', { email: 'reader@example.test', password: 'reader-password' }, headers)));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.status === 403).length, 5);
  assert.equal(results.filter(result => result.headers.has('set-cookie')).length, 1);
  assert.equal(f.calls.reader, 1);
});

test('both challenge routes preserve origin/header protections and never issue a cookie to cross-site callers', async t => {
  const f = await fixture(t);
  for (const namespace of ['reader', 'author']) {
    const crossSite = await f.post(namespace, 'login-challenge', {}, { Origin: 'https://evil.example.test' });
    assert.equal(crossSite.status, 403); assert.equal(crossSite.headers.get('set-cookie'), null);
    const noIntent = await f.post(namespace, 'login-challenge', {}, { [`X-${namespace === 'author' ? 'Author' : 'Reader'}-Request`]: '' });
    assert.equal(noIntent.status, 403); assert.equal(noIntent.headers.get('set-cookie'), null);
    const res = await fetch(`${f.origin}/api/${namespace}/login-challenge`);
    assert.equal(res.ok, false);
  }
  const headers = await f.challenge('reader');
  assert.equal((await f.post('author', 'login', { email: 'owner@example.test', password: 'owner-password' }, headers)).status, 403);
  assert.equal((await f.post('reader', 'login', { email: 'owner@example.test', password: 'owner-password' }, headers)).status, 200);
});

test('disabled private configuration remains compatible and unrelated session reads do not request proofs', async t => {
  const f = await fixture(t, false);
  for (const namespace of ['reader', 'author']) {
    const res = await f.post(namespace, 'login-challenge');
    assert.equal(res.status, 200); assert.deepEqual(await res.json(), { enabled: false });
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal((await f.post(namespace, 'login', { email: 'owner@example.test', password: 'owner-password' })).status, 200);
  }
  const before = f.calls.verification;
  assert.equal((await fetch(`${f.origin}/api/reader/session`)).status, 200);
  assert.equal((await fetch(`${f.origin}/api/author/session`)).status, 200);
  assert.equal(f.calls.verification, before);
});
