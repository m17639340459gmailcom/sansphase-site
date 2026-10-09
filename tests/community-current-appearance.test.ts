import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { avatarHTML, growthChipHTML, levelChipHTML, levelMarksHTML, nameHTML, nameLabelHTML } from '../src/community.ts';
import type { Common, CommunityMe, CommunityPerson } from '../src/community.ts';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string) => { window: Window & { close(): void } };
};
const common: Common = {
  t: zh => zh,
  esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!),
  icons: {},
};
const member: CommunityPerson = {
  name: '缓存昵称', uid: '10001', role: 'reader', level: 0, vip: false,
  vipGrowth: { active: false, level: null, days: 0, nextDays: 30, remaining: 30, multiplier: 1, progress: 0 },
  growth: { level: 1, points: 0, configured: true }, staffRole: null, icon: null,
};
const me = (qualifications: Partial<CommunityPerson>): CommunityMe => ({
  ...member, ...qualifications, owner: false, mod: false, balance: 0, checkedIn: false, streak: 0,
  nextReward: { total: 1, bonus: 0 }, gainedToday: 0, behaviourToday: 0, dailyCap: 6,
  unread: { all: 0, reply: 0, thanks: 0, system: 0 }, agreed: true,
  inventory: { makeup: 0, pin: 0, highlight: 0 }, muted: null,
});
const vipGrowth: CommunityPerson['vipGrowth'] = {
  active: true, level: 8, days: 1095, nextDays: null, remaining: 0, multiplier: 20, progress: 1,
};
function inspect(markup: string, check: (document: Document) => void) {
  const dom = new JSDOM(markup);
  try { check(dom.window.document); } finally { dom.window.close(); }
}

test('renewed VIP qualifications reconcile a cached own nickname with its newly selected icon', () => {
  const live = me({ vip: true, vipGrowth, icon: 'vip:8' });
  for (const render of [nameHTML, nameLabelHTML]) inspect(render(member, { ...common, meForSort: live }), document => {
    assert.equal(document.querySelector('[data-name-icon]')?.getAttribute('data-name-icon'), 'vip:8');
    assert.equal(document.querySelectorAll('[data-name-icon]').length, 1);
  });
});

test('current VIP growth replaces the cached tier in default nicknames and independent level previews', () => {
  const cached = { ...member, vip: true, icon: undefined, vipGrowth: { ...vipGrowth, level: 1 } };
  const live = me({ vip: true, vipGrowth, icon: undefined });
  const context = { ...common, meForSort: live };
  inspect(nameHTML(cached, context), document => {
    assert.equal(document.querySelector('[data-name-icon]')?.getAttribute('data-name-icon'), 'vip:8');
  });
  inspect(levelMarksHTML(cached, context), document => {
    assert.equal(document.querySelector('.is-vip [data-level-icon]')?.getAttribute('data-level-icon'), 'vip-8');
  });
});

test('expired VIP membership removes stale default art from nicknames and independent previews', () => {
  const cached = { ...member, vip: true, vipGrowth, icon: undefined };
  const live = me({ vip: false, vipGrowth: member.vipGrowth, icon: undefined });
  const context = { ...common, meForSort: live };
  inspect(nameHTML(cached, context) + levelMarksHTML(cached, context), document => {
    assert.equal(document.querySelector('[data-name-icon], .is-vip'), null);
  });
});

for (const [previous, current] of [[0, 3], [3, 2]] as const) {
  test(`current community level replaces a cached own level (${previous} -> ${current})`, () => {
    const cached = { ...member, level: previous };
    const live = me({ level: current, icon: `trust:${current}` });
    const context = { ...common, meForSort: live };
    inspect(levelChipHTML(cached, context) + levelMarksHTML(cached, context) + nameHTML(cached, context), document => {
      assert.equal(document.querySelector('.community-lv')?.getAttribute('title'), `L${current}`);
      assert.equal(document.querySelector('.is-trust [data-level-icon]')?.getAttribute('data-level-icon'), `trust-l${current}`);
      assert.equal(document.querySelector('[data-name-icon]')?.getAttribute('data-name-icon'), `trust:${current}`);
    });
  });
}

test('the latest growth, staff, VIP and chosen icon reconcile together without modifying cached inputs', () => {
  const cached = structuredClone(member);
  const before = structuredClone(cached);
  const live = me({ level: 3, vip: true, vipGrowth, growth: { level: 10, points: 72000, configured: true }, staffRole: 'general', icon: 'growth:10' });
  const liveBefore = structuredClone(live);
  const context = { ...common, meForSort: live };
  inspect(avatarHTML(cached, context) + levelMarksHTML(cached, context) + growthChipHTML(cached, context) + nameHTML(cached, context), document => {
    assert.ok(document.querySelector('[data-staff-art="frame-general"]'));
    assert.ok(document.querySelector('.is-staff [data-staff-art="badge-general"]'));
    assert.equal(document.querySelector('.is-vip [data-level-icon]')?.getAttribute('data-level-icon'), 'vip-8');
    assert.equal(document.querySelector('.is-trust [data-level-icon]')?.getAttribute('data-level-icon'), 'trust-l3');
    assert.match(document.querySelector('.community-growth-chip')?.textContent ?? '', /星海/);
    assert.equal(document.querySelector('[data-name-icon]')?.getAttribute('data-name-icon'), 'growth:10');
    assert.equal(document.querySelectorAll('[data-name-icon]').length, 1);
  });
  assert.deepEqual(cached, before);
  assert.deepEqual(live, liveBefore);
});

test('legacy own responses with undefined qualifications preserve existing known presentation', () => {
  const cached = { ...member, level: 3, vip: true, vipGrowth, icon: 'vip:8', growth: { level: 10 as const, points: 72000, configured: true } };
  const live = me({ level: undefined, vip: undefined, vipGrowth: undefined, growth: undefined, staffRole: undefined, icon: undefined });
  const context = { ...common, meForSort: live };
  inspect(nameHTML(cached, context) + levelChipHTML(cached, context) + levelMarksHTML(cached, context) + growthChipHTML(cached, context), document => {
    assert.equal(document.querySelector('[data-name-icon]')?.getAttribute('data-name-icon'), 'vip:8');
    assert.equal(document.querySelector('.community-lv')?.getAttribute('title'), 'L3');
    assert.equal(document.querySelector('.is-vip [data-level-icon]')?.getAttribute('data-level-icon'), 'vip-8');
    assert.match(document.querySelector('.community-growth-chip')?.textContent ?? '', /星海/);
  });
});

test('a different or unknown public UID never borrows the viewer qualifications', () => {
  const live = me({ level: 3, vip: true, vipGrowth, staffRole: 'general', icon: 'vip:8' });
  for (const uid of ['10002', null]) {
    const other = { ...member, uid, icon: 'trust:0' };
    const context = { ...common, meForSort: live };
    inspect(nameHTML(other, context) + levelChipHTML(other, context) + levelMarksHTML(other, context) + avatarHTML(other, context), document => {
      assert.equal(document.querySelector('[data-name-icon]')?.getAttribute('data-name-icon'), 'trust:0');
      assert.equal(document.querySelector('.community-lv')?.getAttribute('title'), 'L0');
      assert.equal(document.querySelector('.is-vip, [data-staff-art]'), null);
    });
  }
});

test('explicit none survives current VIP and staff qualifications on a cached nickname', () => {
  const cached = { ...member, vip: true, vipGrowth, staffRole: 'general' as const, icon: 'staff:general' };
  const live = me({ vip: true, vipGrowth, staffRole: 'general', icon: null });
  inspect(nameHTML(cached, { ...common, meForSort: live }), document => {
    assert.equal(document.querySelector('[data-name-icon]'), null);
  });
});

test('a formerly equipped VIP icon cannot survive current membership expiry even in an old response', () => {
  const cached = { ...member, vip: true, vipGrowth, icon: 'vip:8' };
  const live = me({ vip: false, vipGrowth: member.vipGrowth, icon: undefined });
  inspect(nameHTML(cached, { ...common, meForSort: live }), document => {
    assert.equal(document.querySelector('[data-name-icon]'), null);
  });
});

test('a server-approved personal VIP presentation remains visible without granting actual membership', () => {
  const live = me({ vip: false, vipGrowth, icon: 'vip:8' });
  inspect(nameHTML(member, { ...common, meForSort: live }), document => {
    assert.equal(document.querySelector('[data-name-icon]')?.getAttribute('data-name-icon'), 'vip:8');
  });
  assert.equal(live.vip, false);
});

test('a confirmed nickname change replaces the cached own name alongside its current icon', () => {
  const live = me({ name: '审核后的昵称', vip: true, vipGrowth, icon: 'vip:8' });
  inspect(nameHTML(member, { ...common, meForSort: live }), document => {
    assert.match(document.body.textContent ?? '', /审核后的昵称/);
    assert.doesNotMatch(document.body.textContent ?? '', /缓存昵称/);
    assert.equal(document.querySelector('[data-name-icon]')?.getAttribute('data-name-icon'), 'vip:8');
  });
});

test('an inactive current VIP presentation suppresses old art even if a cached VIP flag was true', () => {
  const live = me({ vip: true, vipGrowth: member.vipGrowth, icon: 'vip:8' });
  inspect(nameHTML(member, { ...common, meForSort: live }), document => {
    assert.equal(document.querySelector('[data-name-icon]'), null);
  });
});
