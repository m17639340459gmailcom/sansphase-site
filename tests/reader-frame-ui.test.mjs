import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { readerPage, mountReaderUI } from '../src/reader-ui.ts';

const uuid = '11111111-1111-4111-8111-111111111111';
const image = `/api/reader/frame/${uuid}.webp`;
const account = { uid: '10001', nickname: '读者', email: 'reader@example.test', phone: '13800138000', signature: '已通过个签', avatar: null, frame: null, frameImage: null, vip: false };
const state = (frame = null, extra = {}) => ({ frame, frameImage: frame === `image:${uuid}` ? image : null, available: true, items: [{ id: 'frame-gold', name: '金环', ref: 'gold', image: null }, { id: uuid, name: '自定义星光', ref: `image:${uuid}`, image }], ...extra });
const turn = () => new Promise(resolve => setImmediate(resolve));

test('the VIP moon frame joins the existing main-site owned selector and equips without replacing profile inputs', async t => {
  const s = setup(t, { ...account, vip: true });
  s.respond(async (_url, init) => state(init?.method === 'POST' ? JSON.parse(init.body).ref : null, {
    items: [{ id: 'frame-vipmoon', name: 'VIP 月相头像框', ref: 'vipmoon', image: null }],
  }));
  const nickname = s.doc.querySelector('[name="nickname"]');
  nickname.value = '未保存昵称';
  s.open(); await turn();
  assert.ok(s.doc.querySelector('[data-reader-frame-select] option[value="vipmoon"]'));
  s.select('vipmoon'); s.save(); await turn();
  assert.ok(s.doc.querySelector('.reader-profile-avatar.reader-avatar-frame-vipmoon'));
  assert.equal(s.doc.querySelector('.reader-profile-frame-image')?.getAttribute('src'), '/assets/community/vip-frame/compact/frame-moon.webp?v=vip-moon-c78bcdb-r1');
  assert.equal(s.doc.querySelector('[name="nickname"]'), nickname);
  assert.equal(nickname.value, '未保存昵称');
  assert.equal(s.renderCount(), 0);
  assert.equal(s.calls.filter(call => call.init?.method === 'POST').length, 1);
});

test('an owner with a separate real reader account sees the existing editable personal account instead of the author gate', () => {
  const doc = new JSDOM(readerPage('account', '', account, false, true, { name: '博客品牌' })).window.document;
  assert.equal(doc.querySelector('[data-author-login]'), null);
  assert.ok(doc.querySelector('[data-reader-form="profile"]'));
  assert.equal(doc.querySelector('.reader-profile-person > div:last-child > strong').textContent, account.nickname);
  assert.equal(doc.querySelector('[name="nickname"]').value, account.nickname);
  const ownerOnly = new JSDOM(readerPage('account', '', null, false, true, { name: '博客品牌' })).window.document;
  assert.ok(ownerOnly.querySelector('[data-author-login]'));
});
function setup(t, initial = account) {
  const dom = new JSDOM('<main></main>', { url: 'https://www.sansphase.com/#/account' });
  const win = dom.window, doc = win.document;
  let identity = { ...initial }, calls = [], renders = 0, identities = 0;
  let respond = async (_url, init) => state(init?.method === 'POST' ? JSON.parse(init.body).ref : identity.frame);
  const globals = new Map();
  for (const [key, value] of Object.entries({ document: doc, window: win, location: win.location, history: win.history, CustomEvent: win.CustomEvent, FormData: win.FormData,
    fetch: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(await respond(url, init)), { headers: { 'content-type': 'application/json' } }); } })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const paint = () => { doc.querySelector('main').innerHTML = readerPage('account', '', identity); };
  paint();
  const ui = mountReaderUI({ render: () => { renders++; paint(); ui.route('account', ''); }, onIdentity: value => { identities++; identity = value; paint(); }, readIdentity: () => identity });
  ui.route('account', '');
  t.after(() => {
    ui.route('notes', ''); win.close();
    for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  });
  return { doc, win, calls, identity: () => identity, renderCount: () => renders, identities: () => identities,
    respond: value => { respond = value; }, open: () => doc.querySelector('[data-reader-avatar-trigger]').click(),
    select: value => { const field = doc.querySelector('[data-reader-frame-select]'); assert.ok(field, 'the existing avatar panel owns frame selection'); field.value = value; field.dispatchEvent(new win.Event('change', { bubbles: true })); },
    save: () => { const button = doc.querySelector('[data-reader-frame-save]'); assert.ok(button); button.click(); },
    switchAccount(value) { identity = value; win.dispatchEvent(new win.CustomEvent('reader:identity', { detail: value })); paint(); ui.route('account', ''); },
  };
}

test('an initial owner personal account can save its nickname and signature without inventing a contact number', async t => {
  const s = setup(t, { ...account, ownerReader: true, phone: '' });
  const form = s.doc.querySelector('[data-reader-form="profile"]');
  const phone = form.querySelector('[name="phone"]');
  assert.equal(phone.required, false);
  assert.equal(phone.checkValidity(), true);
  form.querySelector('[name="nickname"]').value = '个人昵称';
  form.querySelector('[name="signature"]').value = '个人签名';
  s.respond(async (_url, init) => ({ ...s.identity(), ...JSON.parse(init.body) }));
  form.requestSubmit(); await turn();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, '/api/reader/profile');
  assert.deepEqual(JSON.parse(s.calls[0].init.body), { nickname: '个人昵称', signature: '个人签名' });
  assert.equal(s.identity().phone, '');
  assert.equal(s.identity().ownerReader, true);
  assert.equal(s.doc.querySelector('[name="phone"]').required, false);
});

test('an optional owner contact number still uses the existing mainland mobile format when provided', async t => {
  const s = setup(t, { ...account, ownerReader: true, phone: '' });
  const form = s.doc.querySelector('[data-reader-form="profile"]');
  const phone = form.querySelector('[name="phone"]');
  phone.value = '123'; phone.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  assert.equal(phone.checkValidity(), false);
  form.requestSubmit(); await turn(); assert.equal(s.calls.length, 0);
  phone.value = '13900139000'; phone.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  assert.equal(phone.checkValidity(), true);
  s.respond(async (_url, init) => ({ ...s.identity(), ...JSON.parse(init.body) }));
  form.requestSubmit(); await turn();
  assert.equal(s.calls.length, 1);
  assert.equal(JSON.parse(s.calls[0].init.body).phone, '13900139000');
  assert.equal(s.doc.querySelector('[name="phone"]').required, true, 'a stored contact number cannot later be erased');
});

test('ordinary readers and owners with an existing contact number cannot clear that number', async t => {
  for (const initial of [{ ...account, phone: '' }, { ...account, ownerReader: true }]) {
    await t.test(initial.ownerReader ? 'existing owner contact' : 'ordinary reader', async subt => {
      const s = setup(subt, initial);
      const form = s.doc.querySelector('[data-reader-form="profile"]');
      const phone = form.querySelector('[name="phone"]');
      assert.equal(phone.required, true);
      phone.value = '';
      phone.dispatchEvent(new s.win.Event('input', { bubbles: true }));
      assert.equal(phone.checkValidity(), false);
      form.requestSubmit(); await turn();
      assert.equal(s.calls.length, 0);
      assert.equal(s.identity().phone, initial.phone);
    });
  }
});

test('the owner personal account signs out the real author session and clears both display identities only after success', async t => {
  const s = setup(t, { ...account, ownerReader: true, phone: '' });
  const authorEvents = [];
  s.win.addEventListener('author:identity', event => authorEvents.push(event.detail));
  s.respond(async () => ({ ok: true }));
  s.doc.querySelector('[data-reader-logout]').click(); await turn();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, '/api/author/logout');
  assert.equal(s.calls[0].init.method, 'POST');
  assert.equal(s.calls[0].init.credentials, 'same-origin');
  assert.equal(s.calls[0].init.headers['X-Author-Request'], '1');
  assert.equal(s.calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(s.calls[0].init.body), {});
  assert.deepEqual(authorEvents, [null]);
  assert.equal(s.identity(), null);
  assert.equal(s.win.location.hash, '#/notes');
});

test('a failed owner personal sign-out keeps both identities and the account route available for retry', async t => {
  const s = setup(t, { ...account, ownerReader: true, phone: '' });
  const authorEvents = [];
  s.win.addEventListener('author:identity', event => authorEvents.push(event.detail));
  s.respond(async () => { throw new Error('offline'); });
  s.doc.querySelector('[data-reader-logout]').click(); await turn();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, '/api/author/logout');
  assert.deepEqual(authorEvents, []);
  assert.equal(s.identity().uid, account.uid);
  assert.equal(s.identities(), 0);
  assert.equal(s.win.location.hash, '#/account');
  assert.match(s.doc.querySelector('[data-reader-message]').textContent, /offline/);
});

test('an ordinary reader still uses reader sign-out and does not emit an author identity event', async t => {
  const s = setup(t);
  const authorEvents = [];
  s.win.addEventListener('author:identity', event => authorEvents.push(event.detail));
  s.respond(async () => ({ ok: true }));
  s.doc.querySelector('[data-reader-logout]').click(); await turn();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, '/api/reader/logout');
  assert.equal(s.calls[0].init.headers['X-Reader-Request'], '1');
  assert.deepEqual(authorEvents, []);
  assert.equal(s.identity(), null);
  assert.equal(s.win.location.hash, '#/notes');
});

test('late profile and avatar replies cannot replace a cleared, different, or renewed reader identity', async t => {
  for (const action of ['profile', 'avatar', 'avatar/remove']) {
    for (const change of ['clear', 'different', 'renewed']) {
      await t.test(`${action}: ${change}`, async subt => {
        const old = { ...account, avatar: '/api/reader/avatar/22222222-2222-4222-8222-222222222222.webp', frame: 'gold' };
        const s = setup(subt, old);
        let reply;
        s.respond(() => new Promise(resolve => { reply = resolve; }));
        if (action === 'profile') s.doc.querySelector('[data-reader-form="profile"]').requestSubmit();
        else if (action === 'avatar') {
          const input = s.doc.querySelector('[data-reader-avatar-file]');
          Object.defineProperty(input, 'files', { value: [new s.win.File(['image'], 'avatar.webp', { type: 'image/webp' })] });
          input.dispatchEvent(new s.win.Event('change', { bubbles: true }));
        } else s.doc.querySelector('[data-reader-avatar-remove]').click();
        await turn(); assert.equal(s.calls.length, 1);
        const next = change === 'clear' ? null : { ...account, ...(change === 'different' ? { uid: '10002', email: 'other@example.test' } : {}), nickname: '当前账号', signature: '当前资料' };
        s.switchAccount(next);
        reply({ ...old, nickname: '迟到的旧资料', signature: '过期的签名', pendingAvatar: true }); await turn();
        assert.deepEqual(s.identity(), next);
        assert.equal(s.identities(), 0);
        assert.equal(s.doc.querySelector('[data-reader-message]')?.textContent || '', '');
        assert.equal(s.doc.querySelector('[data-reader-avatar-message]')?.textContent || '', '');
      });
    }
  }
});

test('a profile save begun before owner sign-out cannot restore the revoked personal identity when its reply arrives', async t => {
  const old = { ...account, ownerReader: true, phone: '' };
  const s = setup(t, old);
  let reply;
  s.respond((url) => url === '/api/reader/profile' ? new Promise(resolve => { reply = resolve; }) : { ok: true });
  s.doc.querySelector('[data-reader-form="profile"]').requestSubmit(); await turn();
  s.doc.querySelector('[data-reader-logout]').click(); await turn();
  assert.equal(s.identity(), null);
  assert.equal(s.identities(), 1);
  reply({ ...old, signature: '退出前的迟到资料' }); await turn();
  assert.equal(s.identity(), null);
  assert.equal(s.identities(), 1);
  assert.equal(s.win.location.hash, '#/notes');
  assert.deepEqual(s.calls.map(call => call.url), ['/api/reader/profile', '/api/author/logout']);
});

test('the session-equipped frame renders immediately at the existing 58px avatar without a frame-state request', async t => {
  for (const frame of ['gold', 'orbit', 'nebula', `image:${uuid}`]) {
    await t.test(frame, subt => {
    const s = setup(subt, { ...account, frame, frameImage: frame.startsWith('image:') ? image : null });
    const avatar = s.doc.querySelector('[data-reader-avatar-trigger]');
    assert.ok(avatar.classList.contains(frame.startsWith('image:') ? 'reader-avatar-frame-custom' : `reader-avatar-frame-${frame}`));
    if (frame.startsWith('image:')) assert.equal(avatar.querySelector('.reader-profile-frame-image')?.getAttribute('src'), image);
    assert.ok(s.doc.querySelector('[data-reader-form="profile"]'));
    assert.equal(s.calls.length, 0);
    });
  }
});

test('owned frames load within the existing avatar panel and save only frame state in place', async t => {
  const s = setup(t);
  const signature = s.doc.querySelector('[name="signature"]'); signature.value = '还没有保存的个签';
  s.open(); await turn();
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0].url, '/api/reader/frame-state');
  assert.equal(s.calls[0].init.credentials, 'same-origin');
  assert.equal(s.doc.querySelectorAll('[data-reader-frame-select] option').length, 3);
  s.select(`image:${uuid}`); s.save(); s.save(); await turn();
  const writes = s.calls.filter(call => call.init.method === 'POST');
  assert.equal(writes.length, 1); assert.equal(writes[0].url, '/api/reader/frame');
  assert.deepEqual(JSON.parse(writes[0].init.body), { ref: `image:${uuid}` });
  assert.equal(writes[0].init.headers['X-Reader-Request'], '1');
  assert.equal(s.identity().frame, `image:${uuid}`); assert.equal(s.identity().frameImage, image);
  assert.equal(s.doc.querySelector('.reader-profile-frame-image')?.getAttribute('src'), image);
  assert.equal(signature.value, '还没有保存的个签'); assert.equal(signature.isConnected, true);
  assert.equal(s.identity().nickname, account.nickname); assert.equal(s.identity().email, account.email);
  assert.equal(s.renderCount(), 0); assert.equal(s.identities(), 0); assert.equal(s.win.location.hash, '#/account');
  s.select(''); s.save(); await turn();
  assert.equal(s.identity().frame, null); assert.equal(s.doc.querySelector('.reader-profile-frame-image'), null);
});

test('opening the inventory also reconciles a community-equipped frame without writing or replacing unsaved fields', async t => {
  const s = setup(t);
  s.doc.querySelector('[name="signature"]').value = '保留这句草稿';
  s.respond(async () => state('gold'));
  s.open(); await turn();
  assert.equal(s.identity().frame, 'gold');
  assert.ok(s.doc.querySelector('[data-reader-avatar-trigger]').classList.contains('reader-avatar-frame-gold'));
  assert.equal(s.doc.querySelector('[data-reader-frame-select]').value, 'gold');
  assert.equal(s.doc.querySelector('[name="signature"]').value, '保留这句草稿');
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0].init.method, 'GET'); assert.equal(s.renderCount(), 0);
});

test('HK unavailability leaves login, profile and avatar editing usable and disables frame writes', async t => {
  const s = setup(t, { ...account, frame: 'gold' });
  s.respond(async () => state('gold', { available: false, items: [] }));
  s.open(); await turn();
  assert.match(s.doc.querySelector('[data-reader-frame-message]').textContent, /暂.*不可用|暂.*无法/);
  assert.equal(s.doc.querySelector('[data-reader-frame-save]').disabled, true);
  assert.equal(s.doc.querySelector('[data-reader-avatar-pick]').disabled, false);
  assert.equal(s.doc.querySelector('[data-reader-form="profile"] [type="submit"]').disabled, false);
  assert.ok(s.doc.querySelector('[data-reader-avatar-trigger]').classList.contains('reader-avatar-frame-gold'));
  assert.equal(s.identities(), 0); s.save(); await turn(); assert.equal(s.calls.length, 1);
});

test('malicious or mismatched frame image paths never become image sources or owned options', async t => {
  for (const bad of ['https://evil.test/frame.webp', '//evil.test/frame.webp', image + '?redirect=https://evil.test', '/api/reader/frame/22222222-2222-4222-8222-222222222222.webp']) {
    const doc = new JSDOM(readerPage('account', '', { ...account, frame: `image:${uuid}`, frameImage: bad })).window.document;
    assert.equal(doc.querySelector('.reader-profile-frame-image'), null, bad);
    doc.defaultView.close();
  }
  const s = setup(t);
  s.respond(async () => state(null, { items: [{ id: uuid, name: '<img src=x>', ref: `image:${uuid}`, image: 'https://evil.test/frame.webp' }, { id: 'bad', name: '不属于库存', ref: 'javascript:alert(1)', image: null }] }));
  s.open(); await turn();
  assert.equal(s.doc.querySelectorAll('[data-reader-frame-select] option').length, 1);
  assert.equal(s.doc.querySelector('[data-reader-frame-settings] img'), null);
});

test('late inventory and save replies cannot update a cleared or different legacy account without a UID', async t => {
  for (const method of ['GET', 'POST']) {
    await t.test(method, async subt => {
    const s = setup(subt, { ...account, uid: undefined });
    let reply;
    s.respond((_url, init) => init?.method === method ? new Promise(resolve => { reply = resolve; }) : state());
    s.open(); await turn();
    if (method === 'POST') { s.select('gold'); s.save(); await turn(); }
    const other = { ...account, uid: undefined, email: 'other@example.test', nickname: '另一读者', frame: null };
    s.switchAccount(other); reply(state('gold')); await turn();
    assert.equal(s.identity().email, other.email); assert.equal(s.identity().frame, null);
    assert.equal(s.doc.querySelector('[data-reader-avatar-trigger]').classList.contains('reader-avatar-frame-gold'), false);
    assert.equal(s.doc.querySelector('[data-reader-frame-select]').disabled, true);
    s.open(); await turn();
    if (method === 'GET') { s.switchAccount(null); reply(state('gold')); await turn(); assert.equal(s.identity(), null); }
    });
  }
});

test('the frame focus uses a single border and shared community orbit animation retains its definition', async () => {
  const reader = postcss.parse(await readFile('src/reader.css', 'utf8'));
  const community = postcss.parse(await readFile('src/community.css', 'utf8'));
  const focus = [];
  reader.walkRules(rule => { if (rule.selector.includes('reader-frame-settings') && rule.selector.includes(':focus-visible')) rule.walkDecls(decl => focus.push([decl.prop, decl.value])); });
  assert.ok(focus.some(([property]) => property === 'border-color'));
  assert.ok(focus.every(([property, value]) => !['outline', 'box-shadow'].includes(property) || value === 'none'));
  let keyframe = false;
  community.walkAtRules('keyframes', rule => { if (rule.params === 'community-orbit') keyframe = true; });
  assert.equal(keyframe, true, 'orbit frames still use the shared animation after removing the retired landing rings');
  const base = reader.nodes.find(node => node.type === 'rule' && node.selector === '.reader-profile-avatar');
  const dimensions = new Map(base.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  assert.equal(dimensions.get('width'), '58px'); assert.equal(dimensions.get('height'), '58px');
  for (const frame of ['gold', 'orbit', 'nebula']) {
    const main = reader.nodes.find(node => node.type === 'rule' && node.selector === `.reader-profile-avatar.reader-avatar-frame-${frame}`);
    const forum = community.nodes.find(node => node.type === 'rule' && node.selector === `.community-av.is-frame-${frame}`);
    const lookup = rule => new Map(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
    assert.equal(lookup(main).get('padding'), lookup(forum).get('padding'));
    const background = rule => {
      const declarations = lookup(rule), value = declarations.get('background');
      const variable = /^var\((--[a-z-]+)\)$/.exec(value);
      if (!variable) return value;
      assert.ok(declarations.has(variable[1]), 'the frame fill must resolve in the same rule');
      return declarations.get(variable[1]);
    };
    assert.equal(background(main), background(forum), 'main-site and community frames retain identical fills after variable reuse');
  }
});

test('a frame save failure or unavailable server keeps the equipped frame and the unsaved profile', async t => {
  for (const failure of ['network', 'unavailable']) {
    await t.test(failure, async subt => {
      const s = setup(subt, { ...account, frame: 'gold' });
      s.respond(async (_url, init) => {
        if (init?.method === 'POST') {
          if (failure === 'network') throw new Error('offline');
          return state('gold', { available: false, items: [] });
        }
        return state('gold');
      });
      s.open(); await turn(); s.doc.querySelector('[name="signature"]').value = '尚未保存';
      s.select(`image:${uuid}`); s.save(); await turn();
      assert.equal(s.identity().frame, 'gold'); assert.equal(s.doc.querySelector('.reader-profile-frame-image'), null);
      assert.equal(s.doc.querySelector('[name="signature"]').value, '尚未保存');
      assert.match(s.doc.querySelector('[data-reader-frame-message]').textContent, failure === 'network' ? /未能保存/ : /暂.*不可用/);
      if (failure === 'unavailable') assert.equal(s.doc.querySelector('[data-reader-frame-save]').disabled, true);
      assert.equal(s.calls.filter(call => call.init.method === 'POST').length, 1);
    });
  }
});

test('a client-forged option is never posted as an owned frame', async t => {
  const s = setup(t); s.open(); await turn();
  const select = s.doc.querySelector('[data-reader-frame-select]');
  const option = s.doc.createElement('option'); option.value = 'nebula'; option.textContent = '未拥有'; select.append(option);
  s.select('nebula'); s.save(); await turn();
  assert.equal(s.calls.filter(call => call.init.method === 'POST').length, 0);
  assert.equal(s.identity().frame, null);
});

test('ordinary profile and avatar responses preserve only the same account equipped frame without an HK lookup', async t => {
  for (const action of ['profile', 'avatar', 'avatar/remove']) {
    await t.test(action, async subt => {
      const s = setup(subt, { ...account, avatar: '/api/reader/avatar/22222222-2222-4222-8222-222222222222.webp', frame: `image:${uuid}`, frameImage: image });
      const { frame: _frame, frameImage: _image, ...next } = s.identity();
      s.respond(async () => ({ ...next, signature: '更新的已通过个签', pendingAvatar: action === 'avatar' }));
      if (action === 'profile') s.doc.querySelector('[data-reader-form="profile"]').dispatchEvent(new s.win.Event('submit', { bubbles: true, cancelable: true }));
      else if (action === 'avatar') {
        const input = s.doc.querySelector('[data-reader-avatar-file]');
        Object.defineProperty(input, 'files', { value: [new s.win.File(['image'], 'avatar.webp', { type: 'image/webp' })] });
        input.dispatchEvent(new s.win.Event('change', { bubbles: true }));
      } else s.doc.querySelector('[data-reader-avatar-remove]').click();
      await turn();
      assert.equal(s.calls.length, 1); assert.equal(s.calls[0].url, `/api/reader/${action}`);
      assert.equal(s.identity().frame, `image:${uuid}`); assert.equal(s.identity().frameImage, image);
      assert.equal(s.doc.querySelector('.reader-profile-frame-image')?.getAttribute('src'), image);
      assert.equal(s.identity().signature, '更新的已通过个签');
    });
  }
});

test('an explicit frame clear and a different account response cannot inherit a previous account frame', async t => {
  for (const response of [{ ...account, frame: null, frameImage: null }, { uid: '10002', nickname: '另一读者', email: 'other@example.test' }]) {
    await t.test(response.email + String(response.frame), async subt => {
      const s = setup(subt, { ...account, frame: 'gold' });
      s.respond(async () => response);
      s.doc.querySelector('[data-reader-form="profile"]').dispatchEvent(new s.win.Event('submit', { bubbles: true, cancelable: true }));
      await turn();
      assert.equal(s.identity().frame || null, null);
      assert.equal(s.doc.querySelector('[data-reader-avatar-trigger]').classList.contains('reader-avatar-frame-gold'), false);
      assert.equal(s.calls.length, 1);
    });
  }
});
