import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { autosizeCommunityTextarea } from '../src/community-editor-size.ts';
const { JSDOM } = createRequire(import.meta.url)('jsdom');

test('a textarea grows past a viewport, shrinks after deletion and retains the caret and outer scroll', () => {
  const dom = new JSDOM('<div style="overflow:auto"><textarea style="min-height:152px;padding:12px;border:0;box-sizing:border-box"></textarea></div>');
  const field = dom.window.document.querySelector('textarea') as HTMLTextAreaElement;
  const host = field.parentElement!;
  let contentHeight = 130;
  Object.defineProperty(field, 'scrollHeight', { get: () => contentHeight });
  field.value = '正在编写的草稿'; field.setSelectionRange(2, 4); host.scrollTop = 300;
  autosizeCommunityTextarea(field);
  assert.equal(field.style.height, '152px');
  contentHeight = 1300; autosizeCommunityTextarea(field);
  assert.equal(field.style.height, '1300px');
  contentHeight = 80; autosizeCommunityTextarea(field);
  assert.equal(field.style.height, '152px');
  assert.deepEqual([field.selectionStart, field.selectionEnd], [2, 4]);
  assert.equal(host.scrollTop, 300);
  field.hidden = true; contentHeight = 2000; autosizeCommunityTextarea(field);
  assert.equal(field.style.height, '152px');
  dom.window.close();
});
