import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { avatarHTML } from '../src/community.ts';
import { communityProfileFramesHTML } from '../src/community-profile.ts';
import { readerFrameDecoration, retainReaderFrame } from '../src/reader-frames.ts';
import { publicationFiles } from '../scripts/publication-files.mjs';
import { readerPage } from '../src/reader-ui.ts';

const common = { t: zh => zh, esc: value => String(value ?? ''), icons: {} };
const source = '/assets/community/vip-frame/compact/frame-moon.webp?v=vip-moon-c78bcdb-r1';
const person = { name: 'VIP读者', uid: '10001', role: 'reader', vip: true, frame: 'vipmoon', staffRole: null };
const inspect = (html, check) => { const dom = new JSDOM(html); try { check(dom.window.document); } finally { dom.window.close(); } };

// JSDOM has no layout engine. Compare the actual styles' declared footprint;
// native scroll position and rendered DOMRect still need browser acceptance.
function footprint(css, html, selector) {
  const dom = new JSDOM(`<style>*{box-sizing:border-box}${css}</style>${html}`);
  try {
    const style = dom.window.getComputedStyle(dom.window.document.querySelector(selector));
    const px = value => Number.parseFloat(value) || 0;
    return { width: px(style.width) + px(style.marginLeft) + px(style.marginRight),
      height: px(style.height) + px(style.marginTop) + px(style.marginBottom) };
  } finally { dom.window.close(); }
}

test('an eligible VIP avatar reserves identical hero and header space before wearing, changing or removing a frame', () => {
  const css = readFileSync(new URL('../src/community.css', import.meta.url), 'utf8');
  const choices = ['vipmoon', null, 'gold', 'orbit', 'image:11111111-1111-4111-8111-111111111111'];
  for (const frame of choices) {
    const member = { ...person, frame };
    assert.deepEqual(footprint(css, `<div class="community-m-id">${avatarHTML(member, common, 'xl', false)}</div>`, '.community-av'),
      { width: 148, height: 148 }, `hero space cannot change for ${frame}`);
    assert.deepEqual(footprint(css, `<div class="community-account"><button class="account-button has-avatar">${avatarHTML(member, common, 'xs', false)}</button></div>`, '.community-av'),
      { width: 42, height: 42 }, `header space cannot change for ${frame}`);
  }
  assert.deepEqual(footprint(css, `<div class="community-m-id">${avatarHTML({ ...person, vip: false, frame: null }, common, 'xl', false)}</div>`, '.community-av'),
    { width: 88, height: 88 }, 'ordinary avatar geometry remains unchanged');
  assert.deepEqual(footprint(css, `<div class="community-m-id">${avatarHTML({ ...person, staffRole: 'general' }, common, 'xl', false)}</div>`, '.community-av'),
    { width: 142, height: 142 }, 'the existing role frame keeps its reserved space');
});

test('the main account reserves the same avatar space for an eligible VIP regardless of its selected frame', () => {
  const css = readFileSync(new URL('../src/reader.css', import.meta.url), 'utf8');
  const account = { uid: '10001', nickname: 'VIP读者', email: 'vip@example.test', vip: true,
    vipUntil: new Date(Date.now() + 86400_000).toISOString(), frameImage: null };
  for (const frame of ['vipmoon', null, 'gold', 'orbit'])
    assert.deepEqual(footprint(css, readerPage('account', '', { ...account, frame }), '.reader-profile-avatar'),
      { width: 98, height: 98 }, `account space cannot change for ${frame}`);
});

test('the same moon frame is available to every active VIP level only after manual selection', () => {
  for (let level = 1; level <= 8; level++) {
    const member = { ...person, vipGrowth: { active: true, level } };
    inspect(avatarHTML(member, common, 'xl', false), doc => {
      assert.equal(doc.querySelector('.community-vip-frame img')?.getAttribute('src'), source);
      assert.equal(doc.querySelectorAll('.community-vip-frame').length, 1);
      assert.ok(doc.querySelector('.community-av > span:not(.community-vip-frame)'), 'the original avatar remains visible');
    });
    inspect(avatarHTML({ ...member, frame: null }, common), doc => assert.equal(doc.querySelector('.community-vip-frame'), null));
  }
});

test('expired or unconfirmed VIP and stale self data cannot render a selected VIP frame', () => {
  for (const member of [{ ...person, vip: false }, { ...person, vip: undefined }, { ...person, vipGrowth: { active: false, level: null } }])
    inspect(avatarHTML(member, common), doc => assert.equal(doc.querySelector('.community-vip-frame'), null));
  inspect(avatarHTML(person, { ...common, meForSort: { ...person, vip: false, frame: null } }), doc => assert.equal(doc.querySelector('.community-vip-frame'), null));
  inspect(avatarHTML({ ...person, uid: '10002' }, { ...common, meForSort: { ...person, vip: false, frame: null } }), doc => assert.ok(doc.querySelector('.community-vip-frame')));
});

test('active staff still displays only its role frame and restores the selected VIP frame when the appointment ends', () => {
  for (const staffRole of ['assistant', 'moderator', 'general']) {
    const member = { ...person, staffRole };
    inspect(avatarHTML(member, common), doc => {
      assert.equal(doc.querySelector('.community-staff-frame')?.getAttribute('data-staff-art'), `frame-${staffRole}`);
      assert.equal(doc.querySelector('.community-vip-frame'), null);
    });
    inspect(avatarHTML({ ...member, staffRole: null }, common), doc => assert.ok(doc.querySelector('.community-vip-frame')));
    assert.equal(member.frame, 'vipmoon', 'rendering does not rewrite the stored selection');
  }
});

test('an eligible profile collection offers exactly one transparent VIP frame choice through the existing equip action', () => {
  const profile = { state: 'ready', data: { person, frames: [{ id: 'frame-vipmoon', name: 'VIP 月相头像框', ref: 'vipmoon', image: null }] } };
  inspect(communityProfileFramesHTML(profile, { ...person, frame: null }, common), doc => {
    const button = doc.querySelector('[data-action="community-frame-equip"]');
    assert.equal(button.dataset.frameRef, 'vipmoon');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(button.querySelector('.community-vip-frame img')?.getAttribute('src'), source);
    assert.equal(button.querySelector('.community-av > span:not(.community-vip-frame)'), null, 'the frame catalogue has a transparent avatar opening');
    assert.equal(doc.querySelectorAll('.community-frame-choice').length, 1);
  });
  inspect(communityProfileFramesHTML(profile, person, common), doc => assert.equal(doc.querySelector('button').getAttribute('aria-pressed'), 'true'));
  assert.equal(communityProfileFramesHTML({ ...profile, data: { person: { ...person, vip: false }, frames: [] } }, { ...person, vip: false }, common), '');
});

test('main-site frames share the fixed static artwork and membership changes cannot retain an expired VIP selection', () => {
  assert.deepEqual(readerFrameDecoration({ frame: 'vipmoon', frameImage: null }), { className: 'reader-avatar-frame-vipmoon', image: source });
  assert.deepEqual(readerFrameDecoration({ frame: 'vipmoon', frameImage: null, vip: false }), { className: '', image: null });
  const current = { uid: '10001', email: 'vip@example.test', vip: true, frame: 'vipmoon', frameImage: null };
  const next = retainReaderFrame({ uid: current.uid, email: current.email, vip: false }, current);
  assert.equal(next.frame, null);
  assert.equal(next.frameImage, null);
  assert.equal(retainReaderFrame({ uid: current.uid, email: current.email, vip: true }, current).frame, 'vipmoon');
  assert.equal(retainReaderFrame({ uid: current.uid, email: current.email, vip: false }, { ...current, frame: 'gold' }).frame, 'gold');
});

test('fresh publication includes the formal VIP builder and sources rather than depending on the collaborator draft directory', async () => {
  const paths = await publicationFiles();
  assert.ok(paths.includes('scripts/community-vip-frame-art.ts'));
  assert.ok(paths.includes('scripts/vip-moon-frame.ts'));
  assert.ok(paths.includes('src/community-vip-frame.ts'));
  assert.ok(paths.includes('public/assets/community/vip-frame/sources.json'));
  assert.equal(paths.some(path => path.startsWith('outputs/vip-moon-frame-v1/')), false);
});
