import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { siQq } from 'simple-icons';
import { communityShopHTML, communityShopDetailHTML, communityShopMineHTML } from '../src/community-pages.ts';
import { escapeHTML } from '../src/core.mjs';

const common = { t: zh => zh, esc: escapeHTML, icons: {} };
const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const resource = { id: 'monthly-resource', cat: 'digital', kind: 'digital', image, name: 'GPT Plus月卡', desc: '兑换后联系作者领取。', price: 1500, stock: 18, minLevel: 0, minDays: 0, builtin: false, active: true, state: { owned: false, left: 18, ok: true, code: 'ok', why: '' } };
const inventory = { makeup: 0, pin: 0, highlight: 0 };
const decorations = { frame: null, color: null, cover: null };
const shop = items => ({ balance: 2000, level: 2, owner: false, inventory, decorations, items });
const render = item => new JSDOM(communityShopHTML({ shop: { state: 'ready', data: shop([item]) }, tab: 'digital', ...common })).window.document;

test('an explicitly selected digital card reuses holo artwork in the list and details without changing its business kind', () => {
  const item = { ...resource, artStyle: 'holo-card' };
  const doc = render(item), entry = doc.querySelector('.community-sitem-art');
  assert.ok(entry.classList.contains('is-tool-card'));
  assert.ok(entry.querySelector('.community-sart.is-uploaded-card .community-holo.is-uploaded[data-community-card-art]'));
  assert.equal(entry.querySelector('img').getAttribute('src'), `/api/community/images/${image}.webp`);
  assert.ok(doc.querySelector('[data-action="community-redeem"]'));
  const details = new JSDOM(communityShopDetailHTML({ item, shop: shop([item]), showPrice: true, common })).window.document;
  assert.ok(details.querySelector('.community-shop-detail-art .community-holo.is-uploaded[data-community-card-art]'));
  assert.equal(details.querySelector('.community-shop-detail-art').getAttribute('tabindex'), '0');
  assert.equal(details.querySelector('.community-price b').textContent, '1500');
  assert.equal(item.cat, 'digital'); assert.equal(item.kind, 'digital');
  assert.equal(doc.querySelector('.community-have'), null, 'a paid resource must not display a makeup-card entitlement');
});

test('published digital resources reuse the same artwork effects without needing a presentation flag', () => {
  const doc = render(resource);
  assert.ok(doc.querySelector('.community-holo.is-uploaded[data-community-card-art]'));
  assert.equal(doc.querySelector('.community-sitem-art').classList.contains('is-tool-card'), true);
  const owned = render({ ...resource, state: { ...resource.state, owned: true } });
  assert.ok(owned.querySelector('[data-action="community-delivery"]'));
  assert.equal(owned.querySelector('[data-action="community-equip"]'), null);
});

test('every merchandise type has reusable interaction while missing or unsafe images keep their real preview', () => {
  for (const item of [{ ...resource, artStyle: 'holo-card', image: null }, { ...resource, artStyle: 'holo-card', image: 'javascript:evil' }, { ...resource, cat: 'goods', kind: 'goods' }, { ...resource, cat: 'look', kind: 'frame', ref: `image:${image}` }]) {
    const doc = new JSDOM(communityShopHTML({ shop: { state: 'ready', data: shop([item]) }, tab: 'all', ...common })).window.document;
    assert.ok(doc.querySelector('[data-community-card-art]'));
    assert.equal(doc.querySelector('[src^="javascript:"]'), null);
    if (!item.image || item.image === 'javascript:evil') assert.equal(doc.querySelector('.community-holo.is-uploaded'), null);
    if (item.kind === 'frame') assert.ok(doc.querySelector('.community-av'), 'a frame still demonstrates its actual avatar appearance');
  }
});

test('owned decoration cards and redemption confirmation retain their existing unwrapped artwork', () => {
  const looks = ['frame', 'color', 'cover'].map(kind => ({ ...resource, id: `owned-${kind}`, cat: 'look', kind, ref: kind === 'color' ? 'gold' : `image:${image}` }));
  const doc = new JSDOM(communityShopMineHTML({ mine: { state: 'ready', data: { balance: 500, inventory, decorations, looks, digital: [], orders: [] } }, ...common })).window.document;
  assert.equal(doc.querySelector('.is-merchandise'), null);
  assert.equal(doc.querySelector('.community-sitem-art .community-holo'), null, 'normal owned looks are not converted into new merchandise cards');
  assert.equal(doc.querySelectorAll('[data-action="community-equip"]').length, 3);
  for (const item of looks) {
    const detail = new JSDOM(communityShopDetailHTML({ item: { ...item, state: { ...resource.state, owned: true } }, shop: shop(looks), showPrice: false, common })).window.document;
    assert.equal(detail.querySelector('.community-holo'), null, 'owned-look details retain the same unwrapped appearance');
    assert.equal(detail.querySelector('.is-merchandise'), null);
  }
  const redeem = new JSDOM(communityShopHTML({ shop: { state: 'ready', data: shop([resource]) }, tab: 'digital', redeeming: resource.id, ...common })).window.document;
  assert.equal(redeem.querySelector('.community-redeem-art .community-holo'), null, 'the existing confirmation preview does not adopt the listing-only material');
});

const qq = 'http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=example&group_code=123456';
const delivered = delivery => new JSDOM(communityShopHTML({ shop: { state: 'ready', data: shop([resource]) }, tab: 'digital', delivery: { id: resource.id, name: resource.name, delivery: `兑换后联系作者领取。\n${qq}`, ...delivery }, ...common })).window.document;

test('an authorized author-QQ delivery exposes the existing QQ brand icon and preserves the supplied main-site URL', () => {
  const doc = delivered({ contact: 'author-qq' });
  const contact = doc.querySelector('[data-community-author-qq]');
  assert.ok(contact); assert.equal(contact.href, qq);
  assert.equal(contact.querySelector('path').getAttribute('d'), siQq.path);
  assert.equal(contact.target, '_blank'); assert.equal(contact.rel, 'noopener noreferrer');
  assert.match(contact.textContent, /QQ.*领取/);
  assert.ok(doc.querySelector('[data-action="community-copy-delivery"]'));
});

test('ordinary deliveries retain escaped copyable text without adding a contact action', () => {
  const doc = delivered({ delivery: `链接：${qq}\n<script>evil</script>` });
  assert.equal(doc.querySelector('[data-community-author-qq]'), null);
  assert.equal(doc.querySelector('script'), null);
  assert.match(doc.querySelector('[data-delivery]').textContent, /<script>evil<\/script>/);
});

test('QQ delivery does not turn unrelated, credential-bearing or unsafe URLs into contact buttons', () => {
  for (const delivery of ['javascript:alert(1)', 'https://qm.qq.com.evil.example/q/x', 'https://name:password@qm.qq.com/q/x', 'https://example.com/qq']) {
    assert.equal(delivered({ contact: 'author-qq', delivery }).querySelector('[data-community-author-qq]'), null);
  }
});

test('the owned-resource view provides the same authorized QQ contact without treating the resource as a decoration', () => {
  const html = communityShopMineHTML({ mine: { state: 'ready', data: { balance: 500, inventory, decorations, looks: [], digital: [{ id: resource.id, name: resource.name, desc: resource.desc }], orders: [] } }, delivery: { id: resource.id, name: resource.name, delivery: qq, contact: 'author-qq' }, ...common });
  const doc = new JSDOM(html).window.document;
  assert.ok(doc.querySelector('[data-community-author-qq]'));
  assert.ok(doc.querySelector('[data-action="community-delivery"]'));
  assert.equal(doc.querySelector('[data-action="community-equip"]'), null);
});
