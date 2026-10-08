import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { communityCheckinHTML, communityStardustHTML } from '../src/community-pages.ts';
import type { Common, CommunityMe } from '../src/community.ts';
import type { CommunityCheckin, CommunityStardust } from '../src/community-pages.ts';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: Window & { close(): void } } };
const common: Common = { t: zh => zh, esc: value => String(value ?? ''), now: Date.parse('2026-10-08T04:00:00Z') };
const checkin: CommunityCheckin = {
  checkedIn: false, streak: 1, balance: 20, gainedToday: 0, behaviourToday: 0, vip: false,
  month: '2026-10', days: ['2026-10-07'], checkinsToday: 1, earlyBirds: [], badges: [],
  makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: ['2026-10-06'] },
};
const me: CommunityMe = {
  name: '读者', uid: '10001', role: 'reader', level: 2, vip: true, owner: false, mod: false,
  balance: 20, checkedIn: false, streak: 1, nextReward: { total: 7, bonus: 5, base: 2 },
  gainedToday: 0, behaviourToday: 0, dailyCap: 6, unread: { all: 0, reply: 0, thanks: 0, system: 0 },
  agreed: true, inventory: { makeup: 0, pin: 0, highlight: 0 }, muted: null,
};
const stardust: CommunityStardust = {
  balance: 20, gainedToday: 0, behaviourToday: 0, dailyCap: 6, checkedIn: false,
  month: { gained: 1, spent: 0 }, flow: 'all', ledger: [], level: 2,
  owner: false, steward: false, stats: {}, progress: null,
};
function render(data: CommunityCheckin, english = false, current: CommunityMe | null = null) {
  return new JSDOM(communityCheckinHTML({ ...common, ...(english ? { t: (_zh, en) => en } : {}), me: current, checkin: { state: 'ready', data } }));
}

test('check-in descriptions use the server reward for ordinary and active VIP readers in both languages', () => {
  for (const english of [false, true]) {
    for (const dailyReward of [1, 2]) {
      const dom = render({ ...checkin, dailyReward, vip: dailyReward === 2 }, english);
      try {
        const head = dom.window.document.querySelector('.community-page-head')!.textContent!;
        assert.match(head, new RegExp(english ? `Daily check-in \\+${dailyReward} stardust` : `每日签到 \\+${dailyReward} 星尘`));
        assert.match(head, english ? /Active VIP members earn \+1 extra/ : /有效 VIP 额外 \+1/);
        assert.match(head, english ? /full calendar month \+5/ : /自然月满勤额外 \+5/);
        assert.match(dom.window.document.querySelector('.community-calendar-note')!.textContent!, english ? /without daily income/ : /不补发那天的签到星尘/);
      } finally { dom.window.close(); }
    }
  }
});

test('the owner personal reader VIP display does not invent the daily VIP reward', () => {
  const personal: CommunityMe = { ...me, nextReward: { total: 1, bonus: 0, base: 1 }, management: { role: 'owner', browsingAsReader: true, interactive: true } };
  const dom = render({ ...checkin, vip: true, browsingAsReader: true, readOnly: false, dailyReward: 1 }, false, personal);
  try {
    assert.match(dom.window.document.querySelector('.community-page-head')!.textContent!, /每日签到 \+1 星尘/);
    assert.doesNotMatch(dom.window.document.querySelector('.community-page-head')!.textContent!, /每日签到 \+2 星尘|只读/);
  } finally { dom.window.close(); }
  const updated = render({ ...checkin, vip: false, dailyReward: 2 }, false, personal);
  try {
    assert.match(updated.window.document.querySelector('.community-page-head')!.textContent!, /每日签到 \+2 星尘/, 'the current check-in reward overrides stale account or decorative VIP metadata');
  } finally { updated.window.close(); }
});

test('legacy check-in payloads use the server next-reward base or ordinary reward, never decorative VIP', () => {
  for (const [current, reward] of [[me, 2], [null, 1]] as const) {
    const dom = render({ ...checkin, vip: true }, false, current);
    try {
      assert.match(dom.window.document.querySelector('.community-page-head')!.textContent!, new RegExp(`每日签到 \\+${reward} 星尘`));
      assert.doesNotMatch(dom.window.document.querySelector('.community-page-head')!.textContent!, /每日签到 \+7 星尘/);
      for (const star of dom.window.document.querySelectorAll('.community-cs:not(.is-bonus)')) {
        assert.doesNotMatch(star.getAttribute('aria-label')!, /星尘|stardust/i, 'a recorded day does not reconstruct a historical VIP payout');
      }
    } finally { dom.window.close(); }
  }
  const owner = render({ ...checkin, owner: true, dailyReward: 2 });
  try { assert.match(owner.window.document.querySelector('.community-page-head')!.textContent!, /站长不参与签到/); }
  finally { owner.window.close(); }
});

test('stardust rules disclose ordinary and VIP daily rewards without changing full-month or make-up terms', () => {
  for (const english of [false, true]) {
    const dom = new JSDOM(communityStardustHTML({ ...common, ...(english ? { t: (_zh, en) => en } : {}), stardust: { state: 'ready', data: stardust }, tab: 'rules' }));
    try {
      const row = dom.window.document.querySelector('.community-table tbody tr')!.textContent!;
      assert.match(row, english ? /Regular \+1.*VIP \+2/ : /普通 \+1.*VIP \+2/);
      assert.match(row, english ? /active VIP.*\+1 extra/i : /有效 VIP.*额外 \+1/);
      assert.match(row, english ? /full calendar month \+5/ : /自然月满勤额外 \+5/);
      assert.match(dom.window.document.querySelector('.community-card > .community-muted')!.textContent!, english ? /make-ups do not earn daily stardust or the VIP extra/ : /补签不补发每日星尘或 VIP 额外奖励/);
    } finally { dom.window.close(); }
  }
});
