import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { communityStardustHTML, communityInboxHTML } from '../src/community-pages.ts';
import { communityRoute } from '../src/community-routing.ts';
import { invitationShareURL } from '../src/community-invitations.ts';
import { createCommunityUI } from '../src/community-ui.ts';

const url = 'https://www.sansphase.com/share/invite/abcdefghijklmnopqrstuvwx';
const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'), icons: {}, members: true };
const referrals = { shareUrl: url, reward: 15, monthlyLimit: 10, month: '2026-10', rewardedThisMonth: 2, remaining: 8,
  records: [{ inviteeId: 'reader-one', name: '<img src=x onerror=alert(1)>', registeredAt: '2026-10-11T01:00:00Z', status: 'waiting', approvedAt: null, rewardMonth: null, amount: 0, topicId: null },
    { inviteeId: 'reader-two', registeredAt: '2026-10-11T01:00:00Z', status: 'rewarded', approvedAt: '2026-10-11T02:00:00Z', rewardMonth: '2026-10', amount: 15, topicId: 'p1' },
    { inviteeId: 'reader-three', registeredAt: '2026-10-11T01:00:00Z', status: 'limit', approvedAt: '2026-10-11T02:00:00Z', rewardMonth: '2026-10', amount: 0, topicId: 'p2' }] };
const stardust = { balance: 30, gainedToday: 0, behaviourToday: 0, dailyCap: 6, checkedIn: true, month: { gained: 30, spent: 0 }, flow: 'all', ledger: [], level: 2, owner: false, steward: false, stats: {}, progress: null, referrals };
const page = data => new JSDOM(communityStardustHTML({ ...common, stardust: { state: 'ready', data }, tab: 'invites' }));

test('invitation tab displays a clickable cover card, exact reward rules and safe private records without raw link text', () => {
  const dom = page(stardust), doc = dom.window.document;
  try {
    assert.equal(communityRoute('#/community/stardust/invites').tab, 'invites');
    const card = doc.querySelector('[data-community-invitation-card]');
    assert.equal(card.getAttribute('href'), url);
    assert.equal(card.getAttribute('target'), '_blank');
    assert.match(card.getAttribute('rel'), /noopener/);
    assert.ok(card.querySelector('img[width][height]'));
    assert.doesNotMatch(doc.body.textContent, /https?:\/\//);
    assert.match(doc.body.textContent, /15.*星尘/);
    assert.match(doc.body.textContent, /人工审核通过/);
    assert.match(doc.body.textContent, /北京时间.*10/);
    assert.match(doc.body.textContent, /不跨月补发/);
    assert.match(doc.body.textContent, /2\s*\/\s*10/);
    assert.match(doc.body.textContent, /本月已用名额/);
    assert.match(doc.body.textContent, /奖励收回后不恢复名额/);
    assert.match(doc.body.textContent, /已注册，待首帖审核/);
    assert.match(doc.body.textContent, /本月名额已满/);
    assert.equal(doc.querySelectorAll('[onerror], script').length, 0);
    assert.equal(doc.querySelectorAll('[data-action="community-share-invitation"]').length, 1);
  } finally { dom.window.close(); }
});

test('unconfigured or owner invitation data does not invent a personal link', () => {
  for (const data of [{ ...stardust, referrals: null }, { ...stardust, owner: true, referrals: undefined }, { ...stardust, referrals: { ...referrals, shareUrl: 'https://evil.test/share/invite/abcdefghijklmnopqrstuvwx' } }]) {
    const dom = page(data);
    try {
      assert.equal(dom.window.document.querySelector('[data-community-invitation-card]'), null);
      assert.equal(dom.window.document.querySelector('[data-action="community-share-invitation"]'), null);
      assert.match(dom.window.document.body.textContent, /读者身份/);
    } finally { dom.window.close(); }
  }
});

test('deleted members stay anonymous and reversed rewards display the actual recovered amount', () => {
  const dom = page({ ...stardust, referrals: { ...referrals, records: [{ ...referrals.records[0], name: '不应再展示的昵称', status: 'reverted', amount: 15, revertedAmount: 3, inviteeDeleted: true }] } });
  try {
    const row = dom.window.document.querySelector('.community-invitation-records tbody tr');
    assert.match(row.textContent, /已注销成员.*奖励已收回.*−3/);
    assert.doesNotMatch(row.textContent, /不应再展示的昵称|−15/);
  } finally { dom.window.close(); }
});

test('English invitation quota distinguishes used reward slots from successful invitations', () => {
  const dom = new JSDOM(communityStardustHTML({ ...common, t: (_zh, en) => en, stardust: { state: 'ready', data: stardust }, tab: 'invites' }));
  try {
    assert.match(dom.window.document.body.textContent, /Reward slots used this month/);
    assert.match(dom.window.document.body.textContent, /Reversing a reward does not restore its slot/);
  } finally { dom.window.close(); }
});

test('invitation URLs reject external, malformed and credential-bearing links but allow main-site links from the community', () => {
  assert.equal(invitationShareURL(url, 'https://community.sansphase.com'), url);
  const local = 'http://127.0.0.1:4244/share/invite/abcdefghijklmnopqrstuvwx';
  assert.equal(invitationShareURL(local, 'http://127.0.0.1:4244'), local);
  for (const bad of ['javascript:alert(1)', url + '?email=a', url + '#private', url.replace('www.sansphase.com', 'evil.test'), url.replace('https://', 'https://user:pass@'), url.slice(0, -1), local]) {
    assert.equal(invitationShareURL(bad, 'https://community.sansphase.com'), null, bad);
  }
});

test('referral reward is readable in the ledger and notification routes to invitation records', () => {
  const ledger = new JSDOM(communityStardustHTML({ ...common, stardust: { state: 'ready', data: { ...stardust, ledger: [{ id: 'l1', amount: 15, kind: 'in', reason: 'referral', createdAt: '2026-10-11T00:00:00Z', reverted: false, topic: null }] } }, tab: 'ledger' }));
  try { assert.match(ledger.window.document.body.textContent, /成功邀请/); } finally { ledger.window.close(); }
  const inbox = new JSDOM(communityInboxHTML({ ...common, tab: 'system', inbox: { state: 'ready', data: { tab: 'system', unread: { all: 1, system: 1 }, items: [{ id: 'n1', type: 'system', actor: null, topicId: null, replyId: null, text: '邀请成功，获得 15 星尘。', data: { amount: 15 }, link: '#/community/stardust/invites', count: 1, createdAt: '2026-10-11T00:00:00Z', read: false, topicTitle: null }] } } }));
  try { assert.match(inbox.window.document.body.textContent, /15.*星尘/); assert.equal(inbox.window.document.querySelector('[data-action="community-notice"]').dataset.href, '#/community/stardust/invites'); } finally { inbox.window.close(); }
});

const flush = async () => { for (let i = 0; i < 12; i++) await setImmediate(); };
test('only the invitation tab requests referral data; copying keeps the same panel and scroll position', async t => {
  const w = new JSDOM('<main></main>', { url: 'https://community.sansphase.com/#/community/stardust', pretendToBeVisual: true }).window;
  const names = ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? w : w[name] });
  w.scrollTo = () => {};
  const copied = [], notices = [], calls = [];
  Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied.push(value); } } });
  const person = { name: '读者', uid: '10001', role: 'reader', owner: false, vip: false, agreed: true, unread: { all: 0 }, balance: 30, checkedIn: true, streak: 1, nextReward: { total: 1 } };
  const request = async address => {
    calls.push(address);
    const data = address.endsWith('/me') ? person : address.endsWith('/summary') ? { total: 0, repliesToday: 0, checkinsToday: 0, boards: {}, tags: {}, hot: [] }
      : address.startsWith('/api/community/stardust') ? { ...stardust, referrals: address.includes('tab=invites') ? referrals : undefined }
      : address.startsWith('/api/community/banners') ? { scope: 'home', version: 1, items: [] } : null;
    assert.ok(data, address); return { ok: true, json: async () => structuredClone(data) };
  };
  const ui = createCommunityUI({ request }), main = w.document.querySelector('main'), ctx = { ...common, notify: value => notices.push(value) };
  main.innerHTML = ui.html(ctx); let cleanup = ui.mount(main, ctx);
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  await flush();
  assert.ok(calls.some(call => call === '/api/community/stardust'));
  assert.equal(calls.some(call => call.includes('tab=invites')), false);
  w.history.replaceState(null, '', '#/community/stardust/invites'); cleanup(); main.innerHTML = ui.html(ctx); cleanup = ui.mount(main, ctx); await flush();
  assert.ok(calls.some(call => call === '/api/community/stardust?tab=invites'));
  const panel = main.querySelector('[data-community-invitations]'), button = main.querySelector('[data-action="community-share-invitation"]');
  assert.ok(panel); main.scrollTop = 180;
  const before = calls.length; button.click(); await flush();
  assert.deepEqual(copied, [url]);
  assert.ok(notices.some(text => text === '分享地址已复制，卡片显示取决于聊天平台'));
  assert.equal(main.querySelector('[data-community-invitations]'), panel);
  assert.equal(main.scrollTop, 180);
  assert.equal(button.disabled, false);
  assert.equal(calls.length, before, 'sharing does not trigger a reload or reward request');
  const shared = [];
  Object.defineProperty(w.navigator, 'share', { configurable: true, value: async data => { shared.push(data); } });
  button.click(); await flush();
  assert.deepEqual(shared, [{ title: '一起加入無相社区', url }]);
  assert.equal(copied.length, 1, 'native share does not also copy');
  assert.equal(button.disabled, false);
  Object.defineProperty(w.navigator, 'share', { configurable: true, value: async () => { throw new w.DOMException('Cancelled', 'AbortError'); } });
  button.click(); await flush();
  assert.equal(copied.length, 1, 'cancelled native sharing does not copy against the user intent');
  assert.equal(button.disabled, false);
  Object.defineProperty(w.navigator, 'share', { configurable: true, value: async () => { throw new Error('Sharing unsupported'); } });
  button.click(); await flush();
  assert.equal(copied.length, 2, 'unsupported native sharing falls back to the existing clipboard flow');
  assert.equal(main.querySelector('[data-community-invitations]'), panel);
  assert.equal(main.scrollTop, 180);
  assert.equal(calls.length, before);
  w.history.replaceState(null, '', '#/community/stardust/levels'); cleanup(); main.innerHTML = ui.html(ctx); cleanup = ui.mount(main, ctx); await flush();
  assert.equal(main.querySelector('[data-community-invitations]'), null, 'the invitation cache does not replace the levels view');
  assert.equal(calls.filter(call => call.startsWith('/api/community/stardust')).at(-1), '/api/community/stardust', 'other tabs never request attribution even after visiting invitations');
});
