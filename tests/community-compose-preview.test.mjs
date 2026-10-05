import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityComposeHTML, editingFrom } from '../src/community-post.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), members: true, me: { name: '预览读者', role: 'reader', level: 2, agreed: true } };
for (const board of ['qa', 'showcase', 'tools', 'moments', 'meta', 'vip']) {
  test(`simple compose ${board}: fixed board, required text and first-image cover, optional extras`, () => {
    const dom = new JSDOM(communityComposeHTML({ ...common, board, simple: true }));
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('input[name="board"]').length, 1);
    assert.equal(doc.querySelector('input[name="board"]').type, 'hidden');
    assert.equal(doc.querySelector('input[name="board"]').value, board);
    assert.equal(doc.querySelector('.community-board-pick'), null);
    assert.equal(doc.querySelector('textarea[name="body"]').required, true);
    assert.equal(doc.querySelector('textarea[name="body"]').minLength, 1);
    assert.equal(doc.querySelector('[name="title"]').required, true);
    assert.equal(doc.querySelectorAll('[required]').length, 2);
    assert.ok(doc.querySelector('[data-community-upload]'));
    assert.match(doc.querySelector('.community-editor-caption').textContent, /至少 1 张图片，第一张自动作为封面/);
    assert.equal(doc.querySelector('[data-community-upload]').accept, 'image/jpeg,image/png,image/webp');
    assert.equal(doc.querySelector('[name="price"], [name="bounty"]'), null);
    if (board === 'showcase') {
      const price = doc.querySelector('[name="promptPrice"]');
      assert.equal(price.type, 'number');
      assert.equal(price.min, '5'); assert.equal(price.max, '50'); assert.equal(price.step, '1');
      assert.equal(price.disabled, true); assert.equal(price.required, false);
      assert.equal(doc.querySelector('[data-price-row]').hidden, true);
      assert.equal(doc.querySelectorAll('[name="promptMode"]').length, 3);
    } else assert.equal(doc.querySelector('[name="promptPrice"], [name="promptMode"]'), null);
    assert.equal(doc.querySelector('.community-compose-side'), null);
    assert.ok(doc.querySelector('details[data-compose-extras]'));
    dom.window.close();
  });
}

test('simple work edits retain the paid prompt and the author-defined integer amount', () => {
  const editing = { id: 'work', board: 'showcase', title: '作品', body: '正文', tags: [],
    meta: { tools: '', model: '', usage: '', prompt: 'the original prompt', promptMode: 'paid', price: 17 } };
  const dom = new JSDOM(communityComposeHTML({ ...common, board: 'showcase', simple: true, editing }));
  const doc = dom.window.document, price = doc.querySelector('[name="promptPrice"]');
  assert.equal(doc.querySelector('[name="prompt"]').value, editing.meta.prompt);
  assert.equal(doc.querySelector('[name="promptMode"]:checked').value, 'paid');
  assert.equal(price.value, '17'); assert.equal(price.disabled, false); assert.equal(price.required, true);
  assert.equal(doc.querySelector('[data-price-row]').hidden, false);
  assert.equal(doc.querySelector('[name="promptPrivate"]'), null);
  dom.window.close();
});

test('editing an untitled post keeps title empty instead of storing the generated excerpt', () => {
  const draft = editingFrom({ state: 'ready', data: { topic: { id: 'a', board: 'qa', title: '正文摘要', rawTitle: '', body: '正文摘要', tags: [] } } });
  assert.equal(draft.title, '');
});
