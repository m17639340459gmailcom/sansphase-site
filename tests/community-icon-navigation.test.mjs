import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A synchronous cache loop prevents timers in that same process from firing.
// Run the real UI in a child so a regression fails instead of hanging the suite.
const scenario = String.raw`
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from './src/community-ui.ts';
import { communityIconState } from './src/community-icon-policy.ts';
import { communityBadgeFamilies } from './src/community-badge-policy.ts';

const owner = process.argv[1] === 'owner';
const qualifications = { growthLevel: owner ? 10 : 2, trustLevel: owner ? 3 : 1,
  vipLevel: owner ? 8 : null, staffRole: null,
  badges: owner ? communityBadgeFamilies.map(family => ({ family: family.id, tier: 'aurora' })) : [] };
let selected = null;
const viewer = () => {
  const iconState = communityIconState(selected, qualifications);
  return { name: '导航回归读者', uid: 'icon-reader', role: 'reader', owner: false, mod: false,
    level: qualifications.trustLevel, vip: false, agreed: true, balance: 9,
    checkedIn: true, streak: 4, unread: { all: 0 }, inventory: {},
    growth: { level: qualifications.growthLevel, points: 0, configured: true },
    vipGrowth: { active: owner, level: qualifications.vipLevel, days: owner ? 365 : 0,
      nextDays: null, remaining: 0, multiplier: 1, progress: 1 },
    ...(owner ? { management: { role: 'owner', browsingAsReader: true, interactive: true } } : {}),
    icon: iconState.equipped, iconState };
};
const member = tab => ({ person: viewer(), tab, self: true, canMute: false, canAppoint: false,
  stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 },
  follows: { followers: 0, following: 0 }, counts: { topics: 0, replies: 0, bookmarks: 0 },
  topics: [], replies: [], bookmarks: [], badges: [], bio: '', streak: 4,
  joinedAt: null, muted: null, quick: null, iconState: viewer().iconState });
const dom = new JSDOM('<main></main>', {
  url: 'http://localhost/#/community/u/icon-reader', pretendToBeVisual: true });
const w = dom.window;
for (const name of ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node',
  'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement',
  'HTMLFormElement', 'HTMLAnchorElement', 'Event', 'CustomEvent', 'getComputedStyle'])
  globalThis[name] = name === 'window' ? w : w[name];
const reads = [], writes = [];
const response = data => ({ ok: true, json: async () => structuredClone(data) });
const request = async (path, init = {}) => {
  (init.method === 'POST' ? writes : reads).push(path);
  if (path.endsWith('/me')) return response(viewer());
  if (path.endsWith('/active/visit')) return response({ uid: viewer().uid, visited: true,
    awarded: 0, growth: viewer().growth, vipGrowth: viewer().vipGrowth });
  if (path.includes('/members/icon-reader?')) return response(member(new URL(path, w.location.href).searchParams.get('tab')));
  if (path.endsWith('/profile')) return response({ person: viewer(), frames: [], background: { approved: null, pending: null } });
  throw Error('Unexpected request: ' + path);
};
const ui = createCommunityUI({ request });
const main = w.document.querySelector('main');
const ctx = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
let cleanup = () => {};
const enter = async tab => {
  cleanup();
  w.history.replaceState(null, '', '#/community/u/icon-reader' + (tab === 'topics' ? '' : '/' + tab));
  main.innerHTML = ui.html(ctx);
  cleanup = ui.mount(main, ctx);
  await turn(); await turn();
  assert.equal(main.querySelector('[data-community]')?.dataset.tab, tab);
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
  assert.equal(main.querySelector('[data-community][inert]'), null);
};
try {
  await enter('topics');
  for (const tab of ['badges', 'icons', 'frames', 'replies', 'icons', 'badges', 'icons']) {
    await enter(tab);
    if (tab === 'icons') {
      const panel = main.querySelector('[data-community-icons]');
      assert.ok(panel);
      assert.equal(panel.querySelectorAll('[data-icon-ref]').length, owner ? 8 : 10);
      assert.equal(panel.querySelectorAll('[data-icon-ref]:not(:disabled)').length, owner ? 8 : 2);
    }
  }
  // Eligibility changes still reach cached tabs after removing the live loop.
  qualifications.vipLevel = null;
  selected = owner ? 'vip:8' : 'growth:2';
  await enter('badges'); await enter('icons');
  if (owner) {
    const revoked = main.querySelector('[data-icon-ref="vip:8"]');
    assert.equal(revoked.disabled, true);
    assert.equal(revoked.dataset.iconLocked, 'true');
    assert.equal(ui.me().icon, null);
  } else {
    assert.equal(main.querySelector('[data-icon-ref="growth:2"]').disabled, false);
    assert.equal(ui.me().icon, 'growth:2');
  }
  await turn();
  assert.deepEqual(writes, ['/api/community/active/visit'], 'one daily visit is retained; tab navigation never repeats it or submits equipment');
  assert.equal(reads.filter(path => path.endsWith('/me')).length, 10);
  console.log(JSON.stringify({ passed: true, owner, memberTabs: 10, writes: writes.length }));
} finally {
  cleanup(); w.close();
}
`;

for (const mode of ['owner', 'reader']) test(`${mode} can switch cached member tabs and refresh icon eligibility without blocking the page`, () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', scenario, mode], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 12000,
  });
  assert.equal(child.error?.code, undefined, `UI navigation blocked: ${child.error?.message || ''}\n${child.stderr || ''}`);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.deepEqual(JSON.parse(child.stdout.trim()), { passed: true, owner: mode === 'owner', memberTabs: 10, writes: 1 });
});
