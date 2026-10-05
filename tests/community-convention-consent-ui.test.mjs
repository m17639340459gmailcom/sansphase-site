import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityConventionConsent } from '../src/community-convention-consent.ts';

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const tick = () => new Promise(resolve => setTimeout(resolve, 220));
const common = { t: zh => zh, esc: String, icons: {} };
const member = version => ({ uid: '10001', role: 'reader', convention: { version, agreed: false } });
async function setup(t, override = {}) {
  const dom = new JSDOM('<main><button id="before">原页面</button></main>', { pretendToBeVisual: true });
  const doc = dom.window.document;
  doc.querySelector('button').focus();
  let time = 0, current = 'one';
  const writes = [];
  const consent = createCommunityConventionConsent({
    request: async () => ({ version: current, body: '公约正文' }),
    send: async (path, body) => { writes.push({ path, body }); return path === 'agree' ? { agreed: true, version: current } : { version: current, eligibleAt: new Date(Date.now() + 10000).toISOString() }; },
    renderBody: body => `<p>${body}</p>`, accepted: () => {}, now: () => time, ...override,
  });
  t.after(() => { consent.close(); dom.window.close(); });
  consent.sync(member('one'), doc, common);
  await turn(); await turn();
  return { consent, doc, writes, advance: value => { time = value; }, revise: () => { current = 'two'; } };
}

test('confirmation is at the convention bottom and stays disabled for the full ten seconds', async t => {
  let accepted = '';
  const { consent, doc, writes, advance } = await setup(t, { accepted: version => { accepted = version; } });
  const button = doc.querySelector('[data-convention-confirm]');
  assert.ok(button.closest('footer'));
  assert.equal(doc.querySelector('[data-convention-body]').tabIndex, 0, 'keyboard readers can focus and scroll the convention during the countdown');
  assert.equal(button.disabled, true);
  assert.match(button.textContent, /10 秒/);
  button.dispatchEvent(new doc.defaultView.Event('click'));
  assert.equal(writes.filter(write => write.path === 'agree').length, 0);
  advance(9999); await tick(); assert.equal(button.disabled, true);
  advance(10000); await tick(); assert.equal(button.disabled, false);
  button.click(); button.dispatchEvent(new doc.defaultView.Event('click'));
  await turn();
  assert.deepEqual(writes.filter(write => write.path === 'agree'), [{ path: 'agree', body: { version: 'one' } }]);
  assert.equal(accepted, 'one');
  assert.equal(doc.querySelector('[role="dialog"]'), null);
  assert.equal(doc.querySelector('main').inert, undefined);
  assert.equal(doc.activeElement.id, 'before');
  consent.close();
});

test('Escape and background interaction do not dismiss the mandatory convention', async t => {
  const { doc } = await setup(t);
  assert.equal(doc.querySelector('main').inert, true);
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  assert.ok(doc.querySelector('[role="dialog"]'));
  assert.equal(doc.body.style.overflow, 'hidden');
});

test('an in-place page rebuild keeps the same countdown and locks newly inserted background nodes', async t => {
  const { consent, doc, advance } = await setup(t);
  const overlay = doc.querySelector('.community-convention-dialog');
  const added = doc.createElement('aside'); doc.body.append(added);
  overlay.inert = true;
  advance(9000); consent.sync(member('one'), doc, common);
  assert.equal(overlay.inert, false);
  assert.equal(added.inert, true);
  assert.equal(doc.querySelectorAll('[role="dialog"]').length, 1);
  advance(10000); await tick();
  assert.equal(doc.querySelector('[data-convention-confirm]').disabled, false, 'the existing timer is not restarted by a repaint');
  consent.close(); assert.equal(added.inert, undefined);
});

test('a revised convention starts its own ten-second countdown instead of reusing old consent', async t => {
  const { consent, doc, advance, revise } = await setup(t);
  advance(10000); await tick(); assert.equal(doc.querySelector('[data-convention-confirm]').disabled, false);
  revise(); consent.sync(member('two'), doc, common); await turn(); await turn();
  assert.equal(doc.querySelectorAll('[role="dialog"]').length, 1);
  assert.equal(doc.querySelector('[data-convention-confirm]').disabled, true);
  advance(19999); await tick(); assert.equal(doc.querySelector('[data-convention-confirm]').disabled, true);
  advance(20000); await tick(); assert.equal(doc.querySelector('[data-convention-confirm]').disabled, false);
});

test('read failures cannot enable consent and leaving ignores late responses', async t => {
  let finish;
  const request = new Promise(resolve => { finish = resolve; });
  const { consent, doc, advance, writes } = await setup(t, { request: () => request });
  advance(60000); await tick(); assert.equal(doc.querySelector('[data-convention-confirm]').disabled, true);
  consent.close(); finish({ version: 'one', body: '迟到的正文' }); await turn();
  assert.equal(doc.querySelector('[role="dialog"]'), null);
  assert.equal(writes.length, 0);
});

test('server rejection of an obsolete version loads the revision and disables the bottom button again', async t => {
  let version = 'one';
  const { doc, advance } = await setup(t, {
    request: async () => ({ version, body: '最新正文' }),
    send: async path => {
      if (path === 'agree') { version = 'two'; throw Object.assign(new Error('公约已更新'), { status: 409 }); }
      return { version, eligibleAt: new Date(Date.now() + 10000).toISOString() };
    },
  });
  advance(10000); await tick(); doc.querySelector('[data-convention-confirm]').click(); await turn(); await turn();
  assert.ok(doc.querySelector('[role="dialog"]'));
  assert.equal(doc.querySelector('[data-convention-confirm]').disabled, true);
});
