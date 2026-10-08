import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountCommunityComposeEditor } from '../src/community-compose-editor.ts';
import { communityComposeHTML } from '../src/community-post.ts';
import { bodyImageContent } from '../src/community-body-images.ts';
import type { CommunityMe } from '../src/community.ts';

const common = {
  t: (zh: string) => zh,
  esc: (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  icons: {},
};
const member = (trustLevel: number, general = false): CommunityMe => ({
  name: '权限测试成员', uid: '10001', role: 'reader', owner: false, mod: general, vip: false,
  staffRole: general ? 'general' : null, level: trustLevel, trustLevel, agreed: true,
  unread: { all: 0, reply: 0, thanks: 0, system: 0 }, balance: 0, checkedIn: true, streak: 1,
  nextReward: { total: 1, bonus: 0 }, inventory: { makeup: 0, pin: 0, highlight: 0 },
});
const markup = (board: string, me: CommunityMe) => communityComposeHTML({ ...common, board, me, members: true, simple: true });
const response = (data: unknown) => Response.json(data);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
async function until(check: () => boolean) {
  const deadline = performance.now() + 3000;
  while (!check()) {
    assert.ok(performance.now() < deadline, 'the image operation must settle within three seconds');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

for (const [board, maximum] of [['qa', 4], ['showcase', 9], ['tools', 4]] as const) {
  test(`${board}: the general's effective L3 appears in both the composer image cap and its visible caption`, () => {
    for (const [me, expected] of [[member(3, true), maximum], [member(0), 1], [{ ...member(0), mod: true, staffRole: 'moderator' as const }, 1]] as const) {
      const dom = new JSDOM(markup(board, me));
      const root = dom.window.document.querySelector<HTMLElement>('[data-inline-editor]')!;
      assert.equal(root.dataset.imageMax, String(expected));
      assert.match(dom.window.document.querySelector('.community-editor-caption')!.textContent!, new RegExp(`最多 ${expected} 张`));
      assert.equal(root.querySelector<HTMLInputElement>('[data-community-upload]')!.multiple, true);
      dom.window.close();
    }
  });
}

function setup(t: TestContext, board: string) {
  const dom = new JSDOM(markup(board, member(0)), { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'Node', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? w : w[name] });
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() { return {}; } });
  const firstImage = deferred<Response>(), imageRequests: RequestInit[] = [];
  const request: typeof fetch = async (_input, init = {}) => {
    imageRequests.push(init);
    return imageRequests.length === 1 ? firstImage.promise : response({ id: crypto.randomUUID() });
  };
  const root = w.document.querySelector<HTMLElement>('[data-inline-editor]')!;
  const control = mountCommunityComposeEditor(root, { request, prepare: async file => file, t: common.t, owner: false });
  t.after(() => {
    control.destroy(); w.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const paste = (count: number) => {
    const files = Array.from({ length: count }, () => Object.assign(new Blob(['image fixture'], { type: 'image/png' }), { name: 'fixture.png' }));
    const event = new w.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files, items: [], getData: () => '' } });
    control.editor.view.dom.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  };
  const refreshPermission = (me: CommunityMe) => {
    const template = w.document.createElement('template'); template.innerHTML = markup(board, me);
    root.dataset.imageMax = template.content.querySelector<HTMLElement>('[data-inline-editor]')!.dataset.imageMax;
  };
  return { root, control, paste, refreshPermission, firstImage, imageRequests };
}

for (const board of ['qa', 'showcase']) for (const general of [false, true]) {
  test(`${board}: the real editor applies a ${general ? 'general L3' : 'reader L1'} cap update to pending uploads and preserves the draft on a later downgrade`, { timeout: 5000 }, async t => {
    const f = setup(t, board), maximum = board === 'showcase' ? 9 : 4;
    f.control.editor.commands.setContent('<p>保留尚未发布的正文。</p>');
    f.paste(1);
    await until(() => f.imageRequests.length === 1);
    const placeholder = f.root.querySelector('.community-inline-upload')!;
    assert.match(placeholder.querySelector('figcaption')!.textContent!, /上传中/);
    f.control.editor.commands.setTextSelection(3);
    const selection = f.control.editor.state.selection.toJSON(), draft = f.control.field.value;
    f.refreshPermission(member(general ? 3 : 1, general));
    assert.equal(f.root.dataset.imageMax, String(maximum));
    assert.deepEqual(f.control.editor.state.selection.toJSON(), selection);
    assert.equal(f.control.field.value, draft);
    assert.equal(f.root.querySelector('.community-inline-upload'), placeholder);
    assert.equal(f.imageRequests[0].signal?.aborted, false);
    f.paste(maximum);
    await until(() => f.imageRequests.length === maximum);
    assert.equal(f.root.querySelectorAll('.community-inline-upload').length, maximum, 'a pending upload reserves one expanded slot');
    assert.match(f.root.querySelector('[role="status"]')!.textContent!, new RegExp(`最多 ${maximum} 张`));
    f.firstImage.resolve(response({ id: crypto.randomUUID() }));
    await until(() => bodyImageContent(f.control.field.value).images.length === maximum);
    assert.equal(f.control.state().pending, false);
    const finishedDraft = f.control.field.value;
    f.refreshPermission(member(0));
    assert.equal(f.root.dataset.imageMax, '1');
    assert.equal(f.control.field.value, finishedDraft, 'a reduced permission never silently removes uploaded draft images');
    f.paste(1);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(f.imageRequests.length, maximum, 'the current lower cap stops new uploads');
    assert.equal(f.control.field.value, finishedDraft);
  });
}
