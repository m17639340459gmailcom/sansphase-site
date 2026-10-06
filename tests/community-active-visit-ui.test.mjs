import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {}, members: true };
const growth = { level: 1, points: 0, configured: true, startThreshold: 0, nextLevel: 2, nextThreshold: 1200, remaining: 1200, progress: 0 };
const vipGrowth = { active: true, level: 1, days: 0, nextDays: 30, remaining: 30, multiplier: 2, progress: 0 };
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await turn(); };
async function setup(t, { hidden = false, person = {}, delayed = false, switched = false, crossDay = false } = {}) {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost/#/community/stardust/levels', pretendToBeVisual: true });
  const w = dom.window, names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  w.scrollTo = () => {};
  let visibility = hidden ? 'hidden' : 'visible', switchedOnce = false;
  const releases = [];
  Object.defineProperty(w.document, 'visibilityState', { get: () => visibility });
  const calls = [], me = { name: '读者', uid: '10001', role: 'reader', owner: false, agreed: true, convention: { agreed: true, version: 'current' }, unread: { all: 0 }, vip: true, growth, vipGrowth, ...person };
  const stardust = { balance: 37, gainedToday: 0, behaviourToday: 0, dailyCap: 6, checkedIn: false, month: { gained: 0, spent: 0 }, flow: 'all', ledger: [], level: 0, owner: false, steward: false, stats: {}, progress: null, growth, vipGrowth, vipCatalogue: [{ level: 1, multiplier: 2 }], ...person };
  const request = async (url, init) => {
    calls.push({ url, init });
    const ok = value => ({ ok: true, json: async () => structuredClone(value) });
    if (url.endsWith('/me')) return ok(switchedOnce ? { ...me, name: '另一读者', uid: '10002' } : me);
    if (url.endsWith('/stardust')) return ok(stardust);
    if (url.endsWith('/active/visit')) {
      const visitNumber = calls.filter(call => call.url.endsWith('/active/visit')).length;
      if (delayed) await new Promise(resolve => { releases.push(resolve); });
      if (switched && !switchedOnce) {
        switchedOnce = true;
        return ok({ uid: '10002', visited: true, awarded: 20, growth: { ...growth, points: 999, remaining: 201, progress: 999 / 1200 }, vipGrowth });
      }
      const points = crossDay ? visitNumber * 20 : 20;
      return ok({ uid: switchedOnce ? '10002' : '10001', visited: true, awarded: 20, growth: { ...growth, points, remaining: 1200 - points, progress: points / 1200 }, vipGrowth: { ...vipGrowth, days: 1, remaining: 29, progress: 1 / 30 } });
    }
    if (url.endsWith('/convention')) return ok({ version: 'current', body: '公约' });
    if (url.endsWith('/convention/read')) return ok({ version: 'current', eligibleAt: new Date(Date.now() + 10000).toISOString() });
    throw Error(url);
  };
  const main = w.document.querySelector('main'), ui = createCommunityUI({ request });
  main.innerHTML = ui.html(common); const cleanup = ui.mount(main, common);
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });
  await settle();
  return { main, ui, calls, w, visits: () => calls.filter(call => call.url.endsWith('/active/visit')), visible: () => { visibility = 'visible'; w.document.dispatchEvent(new w.Event('visibilitychange')); }, release: (index = 0) => releases[index]?.() };
}

test('frontmost agreed reader enters through one protected empty POST and receives server XP without check-in', async t => {
  const { main, calls, visits, w } = await setup(t);
  assert.equal(visits().length, 1);
  const write = visits()[0];
  assert.equal(write.init.method, 'POST');
  const body = JSON.parse(write.init.body);
  assert.equal(body.points, undefined); assert.equal(body.level, undefined); assert.equal(body.multiplier, undefined);
  assert.equal(main.querySelector('[data-experience-current]').textContent, '20');
  assert.equal(calls.filter(call => /\/checkin(?:$|\?)/.test(call.url)).length, 0);
  for (let i = 0; i < 5; i++) { w.dispatchEvent(new w.Event('focus')); main.querySelector('[data-level-step="1"]').click(); }
  await settle(); assert.equal(visits().length, 1);
  assert.equal(main.querySelector('[data-experience-current]').textContent, '20');
});

test('a background tab GET does not grant XP; becoming visible records the active entrance once', async t => {
  const { main, visits, visible } = await setup(t, { hidden: true });
  assert.equal(visits().length, 0);
  assert.equal(main.querySelector('[data-experience-current]').textContent, '0');
  visible(); await settle(); assert.equal(visits().length, 1);
  visible(); await settle(); assert.equal(visits().length, 1);
});

test('owner, reader preview and missing current consent cannot trigger active XP', async t => {
  for (const person of [{ owner: true, role: 'owner', growth: null }, { management: { role: 'steward', browsingAsReader: true } }, { agreed: false, convention: { version: 'current', agreed: false } }]) {
    await t.test(JSON.stringify(person), async child => {
      const { visits, visible } = await setup(child, { person }); visible(); await settle();
      assert.equal(visits().length, 0);
    });
  }
});

test('a verified interactive owner personal reader records the actual reader daily entrance', async t => {
  const { visits, main } = await setup(t, { person: { management: { role: 'owner', browsingAsReader: true, interactive: true } } });
  assert.equal(visits().length, 1);
  assert.equal(main.querySelector('[data-experience-current]').textContent, '20');
});

test('clearing identity while a visit is pending discards its result', async t => {
  const { main, ui, visits, release } = await setup(t, { delayed: true });
  assert.equal(visits().length, 1);
  ui.clear(); release(); await settle();
  assert.notEqual(main.querySelector('[data-experience-current]')?.textContent, '20');
});

test('daily XP processing does not block the first paint of the ready growth page', async t => {
  const { main, visits, release } = await setup(t, { delayed: true });
  assert.equal(visits().length, 1);
  assert.equal(main.querySelector('[data-experience-current]')?.textContent, '0');
  release(); await settle();
  assert.equal(main.querySelector('[data-experience-current]')?.textContent, '20');
});

test('only a new Beijing day with a visible return starts another visit request', async t => {
  const original = Date.now;
  let now = Date.parse('2026-10-06T15:59:50Z');
  Date.now = () => now;
  t.after(() => { Date.now = original; });
  const { visits, visible, w } = await setup(t);
  assert.equal(visits().length, 1);
  now += 20000;
  await settle(); assert.equal(visits().length, 1, 'elapsed time alone does not start a visit');
  visible(); await settle(); assert.equal(visits().length, 2);
  w.dispatchEvent(new w.Event('focus')); await settle(); assert.equal(visits().length, 2);
});

test('another tab changing the session cannot attach its response to the previously cached account', async t => {
  const { main, calls, visits } = await setup(t, { switched: true });
  assert.equal(visits().length, 2);
  assert.equal(calls.filter(call => call.url.endsWith('/me')).length, 2, 'mismatched UID refreshes the actual identity');
  assert.equal(main.querySelector('[data-experience-current]').textContent, '20');
  assert.doesNotMatch(main.querySelector('[data-level-detail]').textContent, /999/);
});

test('the previous Beijing day response cannot overwrite a completed newer daily snapshot', async t => {
  const original = Date.now;
  let now = Date.parse('2026-10-06T15:59:50Z');
  Date.now = () => now; t.after(() => { Date.now = original; });
  const { main, visits, visible, release } = await setup(t, { delayed: true, crossDay: true });
  assert.equal(visits().length, 1);
  now += 20000; visible(); await settle(); assert.equal(visits().length, 2);
  release(1); await settle(); assert.equal(main.querySelector('[data-experience-current]').textContent, '40');
  release(0); await settle(); assert.equal(main.querySelector('[data-experience-current]').textContent, '40');
  visible(); await settle(); assert.equal(visits().length, 2, 'the older result cannot reset the completed daily key');
});
