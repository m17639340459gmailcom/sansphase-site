import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';

const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const authorImage = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {}, members: false };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const response = data => ({ ok: true, status: 200, json: async () => structuredClone(data) });

async function fixture(t) {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost/#/community/u/10001/replies', pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'FormData', 'File', 'Event', 'CustomEvent', 'getComputedStyle'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  w.scrollTo = () => {};
  const person = { name: '读者', uid: '10001', role: 'reader', avatar: null };
  const background = { id: image, url: `/api/community/profile/background/${image}.webp`, width: 800, height: 200 };
  const profile = { person, signature: '已通过', pendingSignature: null, pendingAvatar: false, canEditProfile: true, frames: [], background: { approved: background, pending: null }, cover: null, coverImage: null, coverName: null };
  const cover = { id: 'custom-cover', cat: 'look', kind: 'cover', ref: `image:${authorImage}`, image: authorImage, name: '林间背景', desc: '背景', price: 120, active: true, builtin: false };
  const mine = { balance: 500, inventory: {}, decorations: { frame: null, color: null, cover: null }, looks: [cover], digital: [], orders: [] };
  let pendingRead = null;
  const members = (uid, tab) => ({
    person: uid === person.uid ? profile.person : { name: '另一位读者', uid, role: 'reader', avatar: null }, bio: uid === person.uid ? profile.signature : '别人的资料', joinedAt: null,
    cover: uid === person.uid ? profile.cover : null, coverImage: uid === person.uid ? profile.coverImage : null, background: uid === person.uid ? profile.background.approved : null,
    streak: 0, stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, following: false, self: uid === person.uid,
    badges: [], muted: null, canMute: false, canAppoint: false, steward: false, tab, topics: [], replies: [], bookmarks: [], counts: { topics: 0, replies: 0, bookmarks: 0 }, quick: null,
  });
  const request = async (url, init = {}) => {
    if (url.endsWith('/me')) return response({ ...person, owner: false, mod: false, unread: { all: 0 } });
    const member = /\/members\/(\d+)\?tab=([a-z]+)/.exec(url);
    if (member) {
      const value = structuredClone(members(member[1], member[2]));
      if (pendingRead?.uid === member[1] && pendingRead.tab === member[2]) { const wait = pendingRead; pendingRead = null; await wait.promise; }
      return response(value);
    }
    if (url.endsWith('/profile/background/remove')) { profile.background = { approved: null, pending: null }; profile.cover = null; profile.coverImage = null; return response(profile); }
    if (url.endsWith('/profile') && init.method === 'POST') { profile.signature = JSON.parse(init.body).signature; return response(profile); }
    if (url.endsWith('/profile')) return response(profile);
    if (url.endsWith('/shop/mine')) return response(mine);
    if (url.endsWith('/shop')) return response({ ...mine, level: 1, owner: false, items: [{ ...cover, state: { owned: false, ok: true } }] });
    if (url.endsWith('/shop/equip') || url.endsWith('/shop/redeem')) {
      profile.background = { approved: null, pending: null }; profile.cover = cover.ref; profile.coverImage = `/api/community/images/${authorImage}.webp`; mine.decorations.cover = cover.ref;
      return response(url.endsWith('/shop/redeem') ? { item: cover } : mine.decorations);
    }
    throw Error(url);
  };
  const ui = createCommunityUI({ request }), main = w.document.querySelector('main');
  main.innerHTML = ui.html(common); let cleanup = ui.mount(main, common);
  t.after(async () => { cleanup(); ui.clear(); await settle(); w.close(); for (const [name, saved] of previous) { if (saved === undefined) delete globalThis[name]; else globalThis[name] = saved; } });
  const mount = hash => { w.history.replaceState(null, '', hash); cleanup(); main.innerHTML = ui.html(common); cleanup = ui.mount(main, common); };
  const initialMember = (uid, tab = 'replies') => { w.history.replaceState(null, '', `#/community/u/${uid}/${tab}`); return new JSDOM(ui.html(common)); };
  await settle();
  return { w, main, ui, profile, mount, initialMember, deferMember(uid, tab) { let release; const promise = new Promise(resolve => { release = resolve; }); pendingRead = { uid, tab, promise }; return release; } };
}

test('profile reset and confirmed details update every cached tab for that UID without clearing other members', async t => {
  const { w, main, mount, initialMember } = await fixture(t);
  mount('#/community/u/20002/replies'); await settle();
  mount('#/community/u/10001'); await settle();
  main.querySelector('[data-action="community-profile-edit"]').click(); await settle();
  w.document.querySelector('[data-action="community-profile-remove"][data-kind="background"]').click(); await settle();
  assert.equal(main.querySelector('.community-m-cover img'), null);
  w.document.querySelector('[data-profile-close]').click(); await settle();
  mount('#/community/u/10001/replies');
  assert.equal(main.querySelector('.community-m-cover img'), null, 'the previously visited tab must never redisplay the retired background');
  await settle();
  main.querySelector('[data-action="community-profile-edit"]').click(); await settle();
  const form = w.document.querySelector('[data-community-form="profile-signature"]');
  form.elements.namedItem('signature').value = '已确认的新资料';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await settle();
  const self = initialMember('10001', 'topics');
  try { assert.match(self.window.document.querySelector('.community-m-name').textContent, /已确认的新资料/); } finally { self.window.close(); }
  const other = initialMember('20002');
  try { assert.match(other.window.document.querySelector('.community-m-name').textContent, /别人的资料/); } finally { other.window.close(); }
});

for (const action of ['equip', 'redeem']) test(`applying an author background through ${action} invalidates only this reader's cached member tabs`, async t => {
  const { w, main, mount, initialMember } = await fixture(t);
  mount('#/community/u/20002/replies'); await settle();
  mount(action === 'equip' ? '#/community/shop/mine' : '#/community/shop'); await settle();
  if (action === 'equip') main.querySelector('[data-action="community-equip"]').click();
  else {
    main.querySelector('[data-action="community-redeem"]').click();
    main.querySelector('[data-community-form="redeem"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  }
  await settle();
  const self = initialMember('10001');
  try { assert.equal(self.window.document.querySelector('.community-m-cover img'), null, 'the retired background cannot be rendered before the new member response'); } finally { self.window.close(); }
  const other = initialMember('20002');
  try { assert.match(other.window.document.querySelector('.community-m-name').textContent, /别人的资料/); } finally { other.window.close(); }
  mount('#/community/u/10001/replies'); await settle();
  assert.equal(main.querySelector('.community-m-cover img').getAttribute('src'), `/api/community/images/${authorImage}.webp`);
});

test('an earlier member response cannot restore a retired background after a confirmed profile reset', async t => {
  const { w, main, mount, deferMember } = await fixture(t);
  const release = deferMember('10001', 'replies');
  const retry = w.document.createElement('button'); retry.dataset.action = 'community-retry'; main.append(retry);
  retry.click();
  mount('#/community/u/10001'); await settle();
  main.querySelector('[data-action="community-profile-edit"]').click(); await settle();
  w.document.querySelector('[data-action="community-profile-remove"][data-kind="background"]').click(); await settle();
  release(); await settle();
  w.document.querySelector('[data-profile-close]').click(); await settle();
  mount('#/community/u/10001/replies');
  assert.equal(main.querySelector('.community-m-cover img'), null, 'a late pre-write read must not overwrite confirmed profile state');
});
