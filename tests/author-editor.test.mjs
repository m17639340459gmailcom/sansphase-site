import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { TableKit } from "@tiptap/extension-table";
test("third-party editor preserves existing headings, lists, tables and uploaded images", () => {
  const dom = new JSDOM('<div id="editor"></div>', { pretendToBeVisual: true });
  for (const name of [
    "window",
    "document",
    "Node",
    "HTMLElement",
    "MutationObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ])
    globalThis[name] = dom.window[name];
  const editor = new Editor({
    element: document.querySelector("#editor"),
    extensions: [StarterKit, Image, TableKit, TextStyleKit],
    content:
      '<h2>原有文章标题</h2><p><strong>重要内容</strong></p><ul><li><p>清单条目</p></li></ul><table><tbody><tr><th><p>列名</p></th></tr><tr><td><p>表格内容</p></td></tr></tbody></table><img src="/api/author/media/33333333-3333-4333-8333-333333333333" alt="图片说明">',
  });
  const html = editor.getHTML();
  for (const marker of [
    "原有文章标题",
    "<strong>重要内容</strong>",
    "清单条目",
    "<table",
    "表格内容",
    "图片说明",
    "/api/author/media/33333333",
  ])
    assert(html.includes(marker), marker);
  editor.commands.selectAll();
  editor.commands.setColor('#dac5ff');
  editor.commands.setFontFamily('New Tegomin');
  editor.commands.setFontSize('20px');
  assert.match(editor.getHTML(), /color: rgb\(218, 197, 255\)/);
  const formatted = editor.getHTML();
  editor.commands.setContent(formatted);
  assert.match(editor.getHTML(), /font-family:.*New Tegomin/);
  assert.match(editor.getHTML(), /font-size: 20px/);
  editor.destroy();
  dom.window.close();
});
