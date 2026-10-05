import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityAccountHTML } from '../src/community.mjs';

const common = { t: zh => zh, esc: value => String(value ?? ''), icons: { eye: '<svg data-eye></svg>', shield: '<svg data-shield></svg>' } };
const person = {
  name: '预览读者', uid: '10001', role: 'reader', owner: false, mod: false, steward: false, level: 2, avatar: null,
  balance: 252, unread: { all: 0, reply: 0, thanks: 0, system: 0 }, checkedIn: false,
};

test('ordinary readers never receive identity switching or management, even with old preview markers', () => {
  for (const previewIdentityHref of [undefined, '/api/community/preview-identity', 'https://evil.example/', 'javascript:alert(1)']) {
    const dom = new JSDOM(communityAccountHTML({ ...common, me: { ...person, previewIdentityHref } }));
    try {
      assert.equal(dom.window.document.querySelector('[data-action="community-browse-mode"]'), null);
      assert.equal(dom.window.document.querySelector('a[href="#/community/manage"]'), null);
      assert.equal(dom.window.document.querySelector('a[href*="preview-identity"]'), null);
    } finally { dom.window.close(); }
  }
  for (const options of [{ author: true }, { nickname: '無相' }, { me: { ...person, role: 'owner', level: 4, steward: true } }]) {
    assert.doesNotMatch(communityAccountHTML({ ...common, ...options }), /community-browse-mode|href="#\/community\/manage"/);
  }
});

test('verified authors and moderators switch perspective inline and open management through a separate link', () => {
  for (const role of ['owner', 'steward']) for (const browsingAsReader of [false, true]) {
    const me = { ...person, owner: role === 'owner' && !browsingAsReader, mod: !browsingAsReader,
      management: { role, browsingAsReader }, previewIdentityHref: '/api/community/preview-identity' };
    const dom = new JSDOM(communityAccountHTML({ ...common, me }));
    try {
      const doc = dom.window.document;
      const toggle = doc.querySelector('[data-action="community-browse-mode"]');
      assert.ok(toggle);
      assert.equal(toggle.tagName, 'BUTTON');
      assert.equal(toggle.dataset.reader, String(!browsingAsReader));
      assert.ok(toggle.querySelector('[data-eye]'));
      assert.equal(toggle.hasAttribute('href'), false);
      const manage = doc.querySelector('a[href="#/community/manage"]');
      assert.equal(Boolean(manage), !browsingAsReader);
      if (manage) {
        assert.equal(manage.textContent, '管理台');
        assert.equal(manage.hasAttribute('data-action'), false);
        assert.ok(manage.querySelector('[data-shield]'));
      }
      assert.equal(doc.querySelector('a[href*="preview-identity"]'), null);
    } finally { dom.window.close(); }
  }
});
