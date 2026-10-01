import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPreviewServer } from '../server.mjs';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const browser = process.env.SANSPHASE_UI_TEST_BROWSER;

test('author editor: empty and long paste preserve viewport; typing and rounded scrollport work',
  { skip: !browser, timeout: 60000 }, async () => {
    const preview = createPreviewServer();
    const server = http.createServer((req, res) => {
      if (req.url === '/editor-test') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><meta charset="utf-8">
          <link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/author.css">
          <button data-author-open="software" data-author-new>编辑</button><main id="main"></main>
          <script id="site-content" type="application/json">{"author":{"name":"测试作者"}}</script>
          <script type="module">import '/author.bundle.mjs'; window.editorTestReady=true;</script>`);
      } else if (req.url.startsWith('/api/')) {
        res.writeHead(req.method === 'GET' ? 200 : 405, { 'Content-Type': 'application/json' });
        res.end('[]'); // Isolated UI fixture, never connected to a database.
      } else preview.emit('request', req, res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const check = async () => {
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        const ensure = (value, message) => { if (!value) throw Error(message); };
        for (let i = 0; !window.editorTestReady && i < 100; i++) await pause(50);
        ensure(window.editorTestReady, 'author bundle ready');
        const checkedKinds = [];
        for (const kind of ['articles', 'works', 'resources', 'software', 'resource-center']) {
          document.querySelector('[data-author-new]').dataset.authorOpen = kind;
          document.querySelector('[data-author-new]').click();
          await pause(100);
          const dom = document.querySelector('.tiptap'), editor = dom.editor;
          const panel = dom.closest('.author-panel');
          dom.scrollIntoView({ block: 'center', behavior: 'instant' });
          dom.focus({ preventScroll: true });
          await pause(100);
          const initial = panel.scrollTop, pageY = scrollY;
          const paste = (text, html = '') => {
            const data = new DataTransfer();
            data.setData('text/plain', text); data.setData('text/html', html);
            dom.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
          };
          paste(''); await pause(150);
          ensure(Math.abs(panel.scrollTop - initial) <= 1, `empty paste moved panel: ${initial} -> ${panel.scrollTop}`);
          ensure(document.activeElement === dom, 'empty paste retained editor focus');
          ensure(editor.isEmpty, 'empty paste did not change document');
          paste(Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 段测试正文`).join('\n'));
          await pause(150);
          ensure(Math.abs(panel.scrollTop - initial) <= 1, 'long paste retained viewport');
          ensure(editor.getText().includes('第 30 段'), 'long paste inserted all content');
          editor.view.dispatch(editor.state.tr.insertText('继续输入').scrollIntoView());
          await pause(100);
          const caret = editor.view.coordsAtPos(editor.state.selection.head);
          const bounds = panel.getBoundingClientRect();
          ensure(caret.bottom <= bounds.bottom && caret.top >= bounds.top, 'normal typing brings caret into view');
          ensure(scrollY === pageY, 'background page did not scroll');
          editor.commands.selectAll();
          const before = editor.getHTML(); paste(''); await pause(100);
          ensure(editor.getHTML() === before, 'empty paste does not delete selected text');
          editor.commands.clearContent(); await pause(100);
          const cleared = panel.scrollTop; paste(''); await pause(100);
          ensure(Math.abs(panel.scrollTop - cleared) <= 1, 'empty paste after clearing remains stable');
          const frame = panel.closest('.author-frame');
          ensure(frame, 'scrollport has a rounded outer frame');
          const outer = frame.getBoundingClientRect(), inner = panel.getBoundingClientRect();
          ensure(inner.top >= outer.top + 8 && inner.bottom <= outer.bottom - 8, 'scrollbar is inset from rounded corners');
          ensure(inner.right <= outer.right - 8, 'scrollbar is inset from right edge');
          ensure(panel.scrollWidth <= panel.clientWidth + 1, 'no horizontal panel overflow');
          checkedKinds.push(kind);
          document.querySelector('[data-author-close]').click();
          if (!document.querySelector('.author-discard').hidden) document.querySelector('[data-discard]').click();
          await pause(50);
        }
        return { emptyPaste: true, longPaste: true, typing: true, clear: true, insetScrollbar: true, checkedKinds };
      };
      const result = await evaluateInWebGLBrowser(browser, `(${check.toString()})()`,
        `http://127.0.0.1:${server.address().port}/editor-test`);
      assert.equal(result.insetScrollbar, true);
      assert.equal(result.checkedKinds.length, 5);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
