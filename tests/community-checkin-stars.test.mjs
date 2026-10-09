import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import { communityCheckinHTML } from '../src/community-pages.mjs';
import { checkinMonth } from '../src/community-rules.mjs';

const data = {
  checkedIn: false, streak: 6, balance: 42, gainedToday: 0, behaviourToday: 0,
  vip: false, month: '2026-09', days: Array.from({length: 6}, (_, i) => `2026-09-0${i + 1}`), checkinsToday: 2, earlyBirds: [], badges: [],
  makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: [] },
};
const common = { t: (zh) => zh, esc: (s) => String(s), now: Date.parse('2026-09-07T12:00:00Z') };
function render(overrides = {}, english = false, now = common.now, me = null) {
  return new JSDOM(communityCheckinHTML({ ...common, now, me, ...(english ? { t: (_, en) => en } : {}), checkin: { state: 'ready', data: { ...data, ...overrides } } }));
}

test('every check-in day is a star; day and reward labels live outside the star field', () => {
  const dom = render();
  const d = dom.window.document;
  const map = d.querySelector('.community-star-map');
  assert.ok(map);
  assert.equal(map.querySelectorAll('.community-cs').length, 30);
  assert.equal(map.querySelectorAll('.community-star-rays').length, 30);
  assert.equal(map.querySelectorAll('text, .community-cs-pulse, .community-cs-day, .community-cs-bonus').length, 0);
  assert.equal(map.querySelectorAll('.community-cs.is-on').length, 6);
  assert.equal(map.querySelector('.is-now').dataset.day, '7');
  assert.match(d.querySelector('.community-star-current').textContent, /7 日/);
  const milestones = [...d.querySelectorAll('.community-star-milestones li')];
  assert.deepEqual(milestones.map(item => Number(item.dataset.day)), [30]);
  assert.match(milestones[0].textContent, /签满 30 天额外获得\+5/);
  dom.window.close();
});

test('star counts and recorded dates follow the calendar month rather than the streak', () => {
  for (const month of ['2027-02', '2028-02', '2026-04', '2026-10']) {
    const { dates, totalDays } = checkinMonth(month, []);
    for (const checkedIn of [false, true]) {
      const days = dates.slice(0, checkedIn ? totalDays : totalDays - 1).filter(key => !key.endsWith('-02'));
      const dom = render({ month, days, streak: 100, checkedIn }, false, Date.parse(`${month}-${totalDays}T04:00:00Z`));
      const d = dom.window.document;
      assert.equal(d.querySelectorAll('.community-cs').length, totalDays);
      assert.equal(d.querySelectorAll('.community-cs.is-on').length, days.length);
      assert.equal(d.querySelector('.community-cs[data-day="2"]').classList.contains('is-on'), false);
      assert.equal(d.querySelectorAll('.community-cs.is-now').length, 1);
      assert.equal(Number(d.querySelector('.community-cs.is-now').dataset.day), totalDays);
      assert.equal(d.querySelector('[data-action="community-checkin"]'), null, 'no duplicate check-in action in the center');
      assert.equal(d.querySelector('.community-star-milestones .is-on'), null, 'the last day alone does not imply full attendance');
      dom.window.close();
    }
  }
});

test('the constellation has irregular local peaks while keeping a readable continuous route', () => {
  const dom = render();
  const nodes = [...dom.window.document.querySelectorAll('.community-star-map .community-cs')];
  assert.equal(nodes.length, 30);
  for (const [prefix, width, height, axis, minimum] of [['', 560, 300, 0, 19], ['compact-', 240, 440, 1, 16]]) {
    const points = nodes.map(node => [
      Number.parseFloat(node.style.getPropertyValue(`--${prefix}star-x`)) / 100 * width,
      Number.parseFloat(node.style.getPropertyValue(`--${prefix}star-y`)) / 100 * height,
    ]);
    points.forEach(([x, y], index) => {
      assert.ok(x >= 18 && x <= width - 18 && y >= 20 && y <= height - 20, `edge clearance, day ${index + 1}`);
      points.slice(index + 1).forEach(([x2, y2]) => assert.ok(Math.hypot(x2 - x, y2 - y) >= minimum, 'star spacing'));
    });
    const forward = points.slice(1).map((p, i) => p[axis] - points[i][axis]);
    assert.ok(forward.some(d => d < 0) && forward.some(d => d > 0), 'the reference allows free two-dimensional bends, rather than one-way x spacing');
    const cross = points.map(p => p[1 - axis]);
    const directions = cross.slice(1).map((p, i) => Math.sign(p - cross[i])).filter(Boolean);
    assert.ok(directions.filter((d, i) => i && d !== directions[i - 1]).length >= 8, 'several irregular changes of height, not a smooth periodic wave');
    const distances = points.slice(1).map(([x, y], i) => Math.hypot(x - points[i][0], y - points[i][1]));
    assert.ok(Math.max(...distances) > Math.min(...distances) * 1.5, 'varying connection lengths');
  }
  const done = render({ checkedIn: true, streak: 7, days: [...data.days, '2026-09-07'] });
  assert.deepEqual([...done.window.document.querySelectorAll('.community-star-map .community-cs')].map(node => node.getAttribute('style')), nodes.map(node => node.getAttribute('style')), 'checking in changes brightness without moving stars');
  done.window.close();
  dom.window.close();
});

test('each responsive drawing connects the same 30 stars with one unbranched, noncrossing chain', () => {
  const dom = render();
  for (const group of dom.window.document.querySelectorAll('.community-star-links > g')) {
    const compact = group.classList.contains('community-star-compact');
    const prefix = compact ? 'compact-' : '';
    const points = [...dom.window.document.querySelectorAll('.community-star-map .community-cs')].map(node => [
      Number.parseFloat(node.style.getPropertyValue(`--${prefix}star-x`)),
      Number.parseFloat(node.style.getPropertyValue(`--${prefix}star-y`)),
    ]);
    const lines = [...group.querySelectorAll('line')];
    assert.equal(lines.length, 29, 'no extra branches or closing edge');
    lines.forEach((line, i) => {
      assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map(name => Number(line.getAttribute(name))), [...points[i], ...points[i + 1]]);
    });
    const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let i = 0; i < points.length - 1; i++) {
      for (let j = i + 2; j < points.length - 1; j++) {
        const a = points[i], b = points[i + 1], c = points[j], d = points[j + 1];
        assert.ok(!(side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0), 'crossings would visually imply a branch');
      }
    }
  }
  dom.window.close();
});

test('owner remains read only, and English status and milestone labels stay available', () => {
  const owner = render({ owner: true, streak: 0 });
  assert.equal(owner.window.document.querySelector('[data-action="community-checkin"]'), null);
  assert.equal(owner.window.document.querySelector('.community-cs.is-now'), null);
  owner.window.close();
  const dom = render({}, true);
  assert.match(dom.window.document.querySelector('.community-star-current').textContent, /Day 7/);
  assert.match(dom.window.document.querySelector('.community-star-milestones').textContent, /30 days/);
  assert.match(dom.window.document.querySelector('.community-star-map').getAttribute('aria-label'), /6 lit/);
  dom.window.close();
});

test('a moderator reader preview shows attendance read-only while allowing calendar navigation', () => {
  const recorded = data.days.filter(day => day !== '2026-09-02');
  const dom = render({ browsingAsReader: true, owner: false, days: recorded, makeup: { ...data.makeup, days: ['2026-09-02'] } }, false, common.now,
    { management: { role: 'steward', browsingAsReader: true } });
  const doc = dom.window.document;
  assert.equal(doc.querySelector('[data-action="community-makeup"]'), null);
  assert.match(doc.querySelector('.community-page-head').textContent, /只读|仅供查看/);
  assert.match(doc.querySelector('.community-calendar-note').textContent, /返回版主身份/);
  assert.equal(doc.querySelector('[data-action="community-month"]').disabled, false);
  assert.equal(doc.querySelectorAll('.community-cs.is-on').length, recorded.length, 'a real reader account retains its recorded attendance');
  dom.window.close();
});

test('check-in panels retain date actions and earned badges within the new presentation', () => {
  const dom = render({ days: ['2026-09-01', '2026-09-04', '2026-09-05', '2026-09-06'], badges: ['first_checkin', 'streak7'],
    makeup: { ...data.makeup, days: ['2026-09-02', '2026-09-03'] },
    earlyBirds: [{ person: { name: '早鸟成员', uid: 'u1', role: 'reader', level: 1 }, at: '2026-09-07T00:02:00+08:00' }] });
  const d = dom.window.document;
  const calendar = d.querySelector('.community-ck-calendar'), early = d.querySelector('.community-ck-early');
  assert.ok(calendar); assert.ok(early); assert.ok(d.querySelector('.community-ck-badges'));
  const calendarBody = calendar.querySelector('.community-ck-calendar-body');
  assert.ok(calendarBody, 'weekdays and dates share a compact body, separate from the heading and note');
  assert.equal(calendarBody.querySelectorAll('.community-cal-week > span').length, 7);
  assert.equal(calendarBody.querySelectorAll('.community-cal > .community-cal-day').length, 30);
  assert.equal(calendar.querySelectorAll('.community-cal-day.is-ok').length, 4);
  assert.deepEqual([...calendar.querySelectorAll('[data-action="community-makeup"]')].map(button => button.dataset.day), ['2026-09-02', '2026-09-03']);
  assert.equal(calendar.querySelector('[aria-current="date"]').textContent, '7');
  assert.equal(calendar.querySelector('[data-action="community-month"][aria-label="下个月"]').disabled, true);
  assert.match(early.querySelector('.community-rank').textContent, /早鸟成员/);
  assert.equal(early.querySelector('.community-card-h .community-muted'), null, 'the caption must not enlarge only the early-bird heading');
  assert.match(early.querySelector('.community-ck-early-body > .community-muted').textContent, /前 10 名/);
  assert.ok(early.querySelector('.community-ck-early-body > .community-rank'));
  assert.equal(d.querySelectorAll('.community-ck-achievement').length, 2);
  assert.equal(d.querySelectorAll('.community-ck-achievement[data-earned="true"]').length, 0);
  assert.equal(d.querySelectorAll('.community-ck-achievement[data-earned="false"]').length, 2);
  assert.equal(d.querySelectorAll('[data-badge-legacy]').length, 2, 'old earned records remain in history');
  assert.equal(d.querySelectorAll('.community-ck-achievement button, .community-ck-achievement a').length, 0);
  assert.equal(d.querySelector('[data-action="community-checkin"]'), null);
  assert.equal(d.querySelector('[data-community="checkin"] .community-card, [data-community="checkin"] .community-banner, [data-community="checkin"] .community-spot'), null, 'the check-in view is open, without card surfaces or card effects');
  assert.equal(d.querySelector('.community-page-head h1').textContent, '签到');
  dom.window.close();
});

test('check-in halos, blinking status and board glow share the existing scroll pause', () => {
  const css = postcss.parse(readFileSync(new URL('../src/community.css', import.meta.url), 'utf8'));
  for (const selector of ['.community-ck-dot', '.community-bh-glow',
    '.community-star-map .community-cs.is-on .community-star-aura', '.community-star-map .community-cs.is-now .community-star-aura']) {
    const rule = css.nodes.find(node => node.type === 'rule' && node.selector === selector);
    assert.ok(rule, `${selector} retains its original animation rule`);
    const animation = rule.nodes.findIndex(node => node.type === 'decl' && node.prop === 'animation');
    const pause = rule.nodes.findIndex(node => node.type === 'decl' && node.prop === 'animation-play-state');
    assert.ok(animation >= 0);
    assert.ok(pause > animation, `${selector} must set play-state after the animation shorthand resets it`);
    assert.equal(rule.nodes[pause].value, 'var(--community-decoration-play-state, running)');
    assert.equal(Boolean(rule.nodes[pause].important), false);
  }
});

test('the marked header, status and month controls retain meaning without decorative button clutter', () => {
  const css = postcss.parse(readFileSync(new URL('../src/community.css', import.meta.url), 'utf8'));
  const centering = new Map();
  css.walkRules('.community-cal-nav .community-act', rule => rule.walkDecls(decl => centering.set(decl.prop, decl.value)));
  assert.equal(centering.get('display'), 'grid');
  assert.equal(centering.get('place-items'), 'center', 'the arrow must be centered horizontally as well as vertically');
  for (const english of [false, true]) {
    const dom = render({}, english);
    const d = dom.window.document;
    assert.equal(d.querySelector('.community-page-head .eyebrow'), null, 'no redundant, widely spaced English month marker');
    const state = d.querySelector('.community-star-current .community-star-state');
    assert.ok(state);
    assert.equal(state.dataset.lit, 'false');
    assert.match(state.textContent, english ? /Ready to light/ : /等待点亮/);
    assert.equal(d.querySelector('.community-star-current button, .community-star-current b'), null);
    const buttons = [...d.querySelectorAll('.community-cal-nav button')];
    assert.equal(buttons.length, 2);
    for (const button of buttons) {
      assert.ok(button.querySelector('svg.ui-icon'), 'month arrows are vector icons, not tiny font-dependent characters');
      assert.ok(button.getAttribute('aria-label'));
      assert.equal(button.dataset.action, 'community-month');
    }
    assert.ok(buttons[0].classList.contains('is-prev'));
    assert.equal(buttons[1].disabled, true);
    dom.window.close();
  }
  const signed = render({ days: [...data.days, '2026-09-07'] });
  assert.equal(signed.window.document.querySelector('.community-star-state').dataset.lit, 'true');
  signed.window.close();
});

test('check-in families use the approved atlas and keep earlier awards in history without granting new materials', () => {
  const dom = render({ badges: ['first_checkin', 'early'] });
  const d = dom.window.document;
  const badges = [...d.querySelectorAll('.community-ck-achievement')];
  assert.deepEqual(badges.map(badge => badge.dataset.badgeFamily), ['attendance', 'early']);
  assert.deepEqual([...d.querySelectorAll('[data-badge-legacy]')].map(badge => badge.dataset.badgeLegacy), ['first_checkin', 'early']);
  badges.forEach(badge => {
    assert.equal(badge.dataset.earned, 'false');
    assert.equal(badge.querySelector('.community-badge').classList.contains('is-off'), true);
    assert.equal(badge.querySelector('.community-badge-art').getAttribute('aria-hidden'), 'true');
    assert.equal(badge.querySelector('svg.ui-icon, input, select'), null);
    assert.match(badge.textContent, /状态暂未提供/);
    assert.ok(badge.querySelector('.community-badge').getAttribute('title'));
  });
  dom.window.close();
});

test('optical star hierarchy and connection gradients preserve the check-in data', () => {
  const dom = render();
  const d = dom.window.document;
  const nodes = [...d.querySelectorAll('.community-star-map .community-cs')];
  assert.ok(new Set(nodes.map(node => node.style.getPropertyValue('--star-size'))).size >= 4, 'ordinary stars have varied optical sizes');
  assert.equal(d.querySelectorAll('.community-star-detail').length, 30);
  assert.match(nodes[29].querySelector('.community-star-detail').textContent, /30 日.*5/);
  assert.equal(d.querySelectorAll('.community-star-map button, .community-star-map a').length, 0, 'the map does not introduce fake actions');
  const ids = [...d.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(new Set(ids).size, ids.length, 'gradient IDs are unique');
  for (const line of d.querySelectorAll('.community-star-link')) {
    const id = line.getAttribute('stroke').match(/^url\(#(.+)\)$/)?.[1];
    const gradient = d.getElementById(id);
    assert.ok(gradient, 'every connection references an existing gradient');
    assert.equal(gradient.getAttribute('gradientUnits'), 'userSpaceOnUse', 'horizontal and vertical connections both render');
    assert.equal(gradient.querySelectorAll('stop').length, 4);
  }
  assert.equal(d.querySelector('.community-star-dust').getAttribute('aria-hidden'), 'true');
  const next = render({ checkedIn: true, streak: 7, days: [...data.days, '2026-09-07'] });
  assert.equal(next.window.document.querySelector('.community-star-dust').outerHTML, d.querySelector('.community-star-dust').outerHTML, 'decorative stars never jump on state changes');
  next.window.close();
  dom.window.close();
});

test('the larger today star stays clear of neighboring rays on every day of the cycle', () => {
  for (let day = 1; day <= 31; day++) {
    const dom = render({ month: '2026-10', days: [], streak: day - 1 }, false, Date.parse(`2026-10-${String(day).padStart(2, '0')}T04:00:00Z`));
    const nodes = [...dom.window.document.querySelectorAll('.community-star-map .community-cs')];
    for (const [prefix, width, height] of [['', 560, 300], ['compact-', 240, 440]]) {
      const points = nodes.map(node => ({
        x: Number.parseFloat(node.style.getPropertyValue(`--${prefix}star-x`)) * width / 100,
        y: Number.parseFloat(node.style.getPropertyValue(`--${prefix}star-y`)) * height / 100,
        size: node.classList.contains('is-now') ? (prefix ? 29 : 34)
          : node.classList.contains('is-big') ? (prefix ? 27 : 32)
          : node.classList.contains('is-bonus') ? (prefix ? 22 : 25)
          : Number.parseFloat(node.style.getPropertyValue('--star-size')) * (prefix ? .85 : 1),
      }));
      points.forEach((a, i) => points.slice(i + 1).forEach(b => {
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) - (a.size + b.size) * .47 >= 2, `ray clearance on day ${day}, ${prefix || 'wide'}`);
      }));
    }
    dom.window.close();
  }
});

test('oversized star glyphs and breathing halos remain anchored at the line endpoint', () => {
  // DOM coordinate equality alone misses CSS grid's minimum-content expansion.
  // Check the positioning contract separately; real browser layout is not simulated here.
  const css = postcss.parse(readFileSync(new URL('../src/community.css', import.meta.url), 'utf8'));
  const declarations = selector => {
    const values = new Map();
    css.walkRules(selector, rule => rule.walkDecls(decl => values.set(decl.prop, decl.value)));
    return values;
  };
  const nodes = declarations('.community-star-nodes');
  assert.equal(nodes.get('position'), 'absolute');
  assert.equal(nodes.get('inset'), '0', 'stars and lines occupy the same coordinate frame');
  for (const selector of ['.community-star-map .community-star-glyph', '.community-star-aura']) {
    const values = declarations(selector);
    assert.equal(values.get('position'), 'absolute');
    assert.equal(values.get('left'), '50%');
    assert.equal(values.get('top'), '50%');
    assert.equal(values.get('translate'), '-50% -50%', 'center translation stays independent of hover/breathing scale');
  }
  assert.equal(declarations('.community-star-map .community-cs').get('display'), 'block', 'optical size must not expand an implicit grid track');
  assert.equal(declarations('.community-star-map .community-cs:is(:hover, :focus-visible) .community-star-glyph').get('translate'), undefined, 'hover cannot replace center translation');
});
