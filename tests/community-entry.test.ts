import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityEntryDestination, communityEntryTarget, createCommunityEntry, communityHostRoute, rewriteCommunityMainSiteLinks, exitCommunity } from '../src/community-entry.ts';
import { communityLandingHTML, communityAccountHTML } from '../src/community.ts';

const destination = 'https://community.sansphase.com';
const ticket = 'a'.repeat(43);
const target = `${destination}/community-enter#community-entry=${ticket}`;
const config = { communityEnabled: false, communityDestination: destination };
const valid = { url: target, expiresAt: new Date(Date.now() + 60000).toISOString() };
const response = (body: unknown = valid, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('main entry stays closed for disabled, malformed, credentialed or unrelated destinations', () => {
  for (const value of [undefined, '', false, 'http://community.sansphase.com', 'https://evil.example', 'https://community.sansphase.com/path', 'https://user@community.sansphase.com', 'https://community.sansphase.com:444', 'https://community.sansphase.com/?x=1']) assert.equal(communityEntryDestination({ communityDestination: value }), null);
  assert.equal(communityEntryDestination(config), destination);
  assert.equal(communityEntryDestination({ ...config, communityOnly: true }), null);
});

test('server ticket URL must use the configured exact origin, dedicated entry path and a single opaque fragment', () => {
  assert.equal(communityEntryTarget(valid, destination), target);
  for (const url of ['https://evil.example/community-enter#community-entry=' + ticket, 'https://community.sansphase.com.evil.example/community-enter#community-entry=' + ticket, destination + '/path#community-entry=' + ticket, destination + '/?token=' + ticket, destination + '/#community-entry=' + ticket, destination + '/community-enter/#community-entry=' + ticket, destination + '/community-enter#community-entry=' + ticket + '&uid=123', destination + '/community-enter#community-entry=x', 'javascript:alert(1)', destination + '/community-enter#community-entry=' + 'a%2Fb'.repeat(20)]) assert.equal(communityEntryTarget({ ...valid, url }, destination), null);
  assert.equal(communityEntryTarget({ ...valid, expiresAt: 'bad' }, destination), null);
  assert.equal(communityEntryTarget({ ...valid, expiresAt: new Date(0).toISOString() }, destination), null);
});

test('signed-out main visitors use the login gate without issuing an entry request', async () => {
  let requests = 0;
  const entry = createCommunityEntry({ config: () => config, request: async () => { requests++; return response(); }, navigate: () => assert.fail('must not navigate'), fadeOut: async () => {}, changed: () => {} });
  assert.equal(await entry.enter(false), false);
  assert.equal(entry.state(), 'auth'); assert.equal(requests, 0);
});

test('concurrent entry attempts mint once, send same-origin protected request, fade then navigate', async () => {
  let done: (value: ReturnType<typeof response>) => void = () => {};
  const events: string[] = [], calls: Array<[string, RequestInit]> = [];
  const entry = createCommunityEntry({ config: () => config, request: async (url, options) => { calls.push([url, options]); return new Promise(resolve => { done = resolve; }); }, navigate: url => events.push('navigate:' + url), fadeOut: async () => { events.push('fade'); }, changed: () => {} });
  const first = entry.enter(true), second = entry.enter(true);
  await Promise.resolve();
  assert.equal(calls.length, 1); assert.equal(entry.state(), 'pending');
  assert.equal(calls[0][0], '/api/community-entry');
  assert.equal(calls[0][1].credentials, 'same-origin'); assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(calls[0][1].headers, { 'Content-Type': 'application/json', 'X-Reader-Request': '1' });
  assert.equal(calls[0][1].body, '{}');
  done(response()); assert.equal(await first, true); assert.equal(await second, true);
  assert.deepEqual(events, ['fade', 'navigate:' + target]);
});

test('401 restores the existing login flow while 503 and wrong destinations restore a retryable entrance', async () => {
  for (const [reply, expected] of [[response({}, 401), 'auth'], [response({}, 503), 'error'], [response({ ...valid, url: 'https://evil.example/#community-entry=' + ticket }), 'error']] as const) {
    let fades = 0, navigations = 0, resets = 0;
    const entry = createCommunityEntry({ config: () => config, request: async () => reply, navigate: () => { navigations++; }, fadeOut: async () => { fades++; }, restore: () => { resets++; }, changed: () => {} });
    assert.equal(await entry.enter(true), false);
    assert.equal(entry.state(), expected); assert.equal(fades, 0); assert.equal(navigations, 0); assert.equal(resets, 1);
  }
});

test('HK defaults to its community and all other route families return to the fixed main host', () => {
  const host = { communityOnly: true, mainSiteOrigin: 'https://www.sansphase.com' };
  for (const hash of ['', '#/', '#/home', '#/community']) assert.deepEqual(communityHostRoute(host, hash, true), { kind: 'local', hash: '#/community/home' });
  for (const hash of ['#/post/t1', '#/community/checkin', '#/community/u/10001']) assert.deepEqual(communityHostRoute(host, hash), { kind: 'local', hash });
  for (const hash of ['#/account', '#/admin', '#/notes', '#/reset/code', '#/resources', '#/home']) assert.deepEqual(communityHostRoute(host, hash), { kind: 'main', url: 'https://www.sansphase.com/' + hash });
  assert.deepEqual(communityHostRoute({}, '#/home'), { kind: 'local', hash: '#/home' });
});

test('HK logout clears the local session before returning to main and never leaves on a failed logout', async () => {
  const events: string[] = [];
  await exitCommunity({ communityOnly: true, mainSiteOrigin: 'https://www.sansphase.com' }, async (url, init) => { events.push(url); assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'same-origin'); return response(); }, url => events.push(url));
  assert.deepEqual(events, ['/api/reader/logout', 'https://www.sansphase.com/#/home']);
  await assert.rejects(() => exitCommunity({ communityOnly: true }, async () => response({}, 503), () => assert.fail('failed logout must stay visible')));
});

test('HK profile and blog links point to main while ordinary community links retain target behavior', () => {
  const dom = new JSDOM('<a id="account" href="#/account" data-reader-return>账号</a><a id="blog" href="#/notes">博客</a><a id="post" href="#/post/t1" target="_blank" rel="noopener">帖子</a>');
  rewriteCommunityMainSiteLinks(dom.window.document, { communityOnly: true, mainSiteOrigin: 'https://www.sansphase.com' });
  assert.equal(dom.window.document.querySelector('#account')!.getAttribute('href'), 'https://www.sansphase.com/#/account');
  assert.equal(dom.window.document.querySelector('#blog')!.getAttribute('href'), 'https://www.sansphase.com/#/notes');
  assert.equal(dom.window.document.querySelector('#post')!.getAttribute('href'), '#/post/t1');
  assert.equal(dom.window.document.querySelector('#post')!.getAttribute('target'), '_blank');
  dom.window.close();
});

test('the approved introduction retains its heading, sky and keyboard-usable content button in every entry state', () => {
  for (const state of ['idle', 'pending', 'leaving', 'error'] as const) {
    const dom = new JSDOM(communityLandingHTML(zh => zh, {}, { entryState: state }));
    try {
      const doc = dom.window.document, button = doc.querySelector<HTMLButtonElement>('button[data-community-entry-enter]');
      assert.ok(button); assert.equal(button.type, 'button');
      assert.equal(button.disabled, ['pending', 'leaving'].includes(state));
      assert.equal(doc.querySelector('h1')!.textContent, '無相社区');
      assert.ok(doc.querySelector('[data-community="landing"] .community-orbits'));
      assert.equal(doc.querySelector('[role="dialog"]'), null);
      if (state === 'error') assert.match(button.textContent!, /重试/);
    } finally { dom.window.close(); }
  }
});

test('HK owners use the verified community management link without a main-site author-studio control', () => {
  const common = { t: (zh: string) => zh, esc: (value: unknown) => String(value ?? ''), icons: {}, author: true, communityOnly: true };
  const person = { name: '作者', uid: 'owner', role: 'owner' as const, owner: true, mod: true, steward: false, level: 4, avatar: null, balance: 0, unread: { all: 0, reply: 0, thanks: 0, system: 0 }, checkedIn: false, management: { role: 'owner' as const, browsingAsReader: false } };
  for (const me of [null, person]) {
    const dom = new JSDOM(communityAccountHTML({ ...common, me }));
    try {
      const doc = dom.window.document;
      rewriteCommunityMainSiteLinks(doc, { communityOnly: true });
      assert.equal(doc.querySelector('[data-author-login]'), null);
      assert.doesNotMatch(doc.body.textContent!, /作者台/);
      assert.equal(Boolean(doc.querySelector('a[href="#/community/manage"]')), Boolean(me));
      assert.equal(doc.querySelector('a[href="https://www.sansphase.com/#/account"]'), null);
    } finally { dom.window.close(); }
  }
});

test('leaving the entrance invalidates a pending mint and never navigates after a late response', async () => {
  let done: (value: ReturnType<typeof response>) => void = () => {};
  const entry = createCommunityEntry({ config: () => config, request: async () => new Promise(resolve => { done = resolve; }), navigate: () => assert.fail('late request must not navigate'), fadeOut: async () => assert.fail('late request must not fade'), changed: () => {} });
  const pending = entry.enter(true); await Promise.resolve();
  entry.cancel(); done(response());
  assert.equal(await pending, false); assert.equal(entry.state(), 'idle');
});

test('the render callback cannot recursively mint another ticket while showing pending state', async () => {
  let requests = 0;
  let entry: ReturnType<typeof createCommunityEntry>;
  entry = createCommunityEntry({ config: () => config, request: async () => { requests++; return response(); }, navigate: () => {}, fadeOut: async () => {}, changed: state => { if (state === 'pending') void entry.enter(true); } });
  await entry.enter(true); await entry.enter(true);
  assert.equal(requests, 1, 'both render re-entry and an extra activation during departure share the same ticket');
});
