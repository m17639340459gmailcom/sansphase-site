import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPreviewServer } from '../server.mjs';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const browser = process.env.SANSPHASE_UI_TEST_BROWSER;

test('visible navigation and page buttons remain hittable during route entry',
  { skip: !browser, timeout: 60000 }, async () => {
    const preview = createPreviewServer();
    const server = http.createServer((req, res) => {
      if (req.url === '/route-interaction-test') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><link rel="stylesheet" href="/styles.css">
          <style>#site-header{position:fixed;inset:0 0 auto}#main{padding-top:150px}</style>
          <header id="site-header"><button id="next-route">Next section</button></header>
          <main id="main"></main>`);
      } else preview.emit('request', req, res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const check = async () => {
        const { createRouteTransitions } = await import('/route-transition.mjs');
        const transitions = createRouteTransitions(document);
        const main = document.querySelector('main');
        let clicks = 0;
        const hits = [];
        document.addEventListener('click', event => { if (event.target instanceof HTMLButtonElement) clicks++; });
        for (const [from, to] of [['home', 'notes'], ['notes', 'works'], ['works', 'resource-center']]) {
          await transitions.run(from, to, () => { main.innerHTML = '<button id="page-action">Page action</button>'; });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          for (const id of ['next-route', 'page-action']) {
            const button = document.getElementById(id), rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            hits.push({ to, id, actual: hit?.id || hit?.tagName });
            hit?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            hit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        }
        transitions.dispose();
        return { hits, clicks };
      };
      const result = await evaluateInWebGLBrowser(browser, `(${check.toString()})()`, `http://127.0.0.1:${server.address().port}/route-interaction-test`);
      assert(result.hits.every(hit => hit.id === hit.actual), JSON.stringify(result.hits));
      assert.equal(result.clicks, 6, 'the first click must reach each visible control');
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
