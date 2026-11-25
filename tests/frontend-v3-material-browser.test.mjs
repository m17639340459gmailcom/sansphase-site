import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createFrontendIntegrationPreview } from '../scripts/preview-frontend-integration.ts';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const build = process.env.SANSPHASE_TEST_V3_BUILD;
const browser = process.env.SANSPHASE_UI_TEST_BROWSER;

test('V3 wheel reads to the bottom and back after opening a published material from the list', { skip: !build || !browser, timeout: 120000 }, async t => {
  const preview = await createFrontendIntegrationPreview({ frontend: 'v3', port: 0, buildAssets: false, v3AppDirectory: build });
  t.after(preview.close);
  const signed = await fetch(`${preview.origin}/api/reader/login`, {
    method: 'POST',
    headers: { Origin: preview.origin, 'Content-Type': 'application/json', 'X-Reader-Request': '1' },
    body: JSON.stringify({ email: 'reader@example.test', password: 'DemoLogin2026!' }),
  });
  assert.equal(signed.status, 200);
  const cookie = signed.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie);
  const separator = cookie.indexOf('=');
  const detail = `/learning/${preview.fixtures.slugs.resource}`;
  const card = JSON.stringify(`main #catalog a[href="${detail}"]`);

  for (const [width, height] of [[1120, 640], [1920, 1080]]) {
    await evaluateInWebGLBrowser(browser, 'true', 'about:blank', async socket => {
      let id = 100;
      const call = (method, params) => new Promise((resolve, reject) => {
        const requestId = ++id;
        const receive = ({ data }) => {
          const answer = JSON.parse(data);
          if (answer.id !== requestId) return;
          socket.removeEventListener('message', receive);
          const error = answer.error ?? answer.result?.exceptionDetails;
          if (error) reject(new Error(JSON.stringify(error)));
          else resolve(answer.result);
        };
        socket.addEventListener('message', receive);
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
      const read = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
      const waitFor = async expression => {
        for (let step = 0; step < 100; step++) {
          if (await read(expression)) return;
          await delay(75);
        }
        assert.fail(`Expected ${expression} at ${await read('location.pathname')} (${width}×${height}, scrollY=${await read('scrollY')})`);
      };
      const maximum = 'document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight';
      const wheel = deltaY => call('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: Math.round(width * 0.65), y: Math.round(height * 0.75), deltaX: 0, deltaY,
      });
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const installed = await call('Network.setCookie', { url: preview.origin, name: cookie.slice(0, separator), value: cookie.slice(separator + 1), httpOnly: true, sameSite: 'Strict' });
      assert.equal(installed.success, true);
      await call('Page.navigate', { url: `${preview.origin}/learning` });
      await waitFor(`!!document.querySelector(${card}) && document.documentElement.classList.contains('lenis')`);
      const previousLimit = await read(maximum);
      const initialDocument = await read('performance.timeOrigin');
      await read(`document.querySelector(${card}).click()`);
      await waitFor(`location.pathname === ${JSON.stringify(detail)} && !!document.querySelector('main .prose-tdx')`);
      assert.equal(await read('performance.timeOrigin'), initialDocument);
      assert.equal(await read('scrollY'), 0);
      const nextLimit = await read(maximum);
      assert.ok(nextLimit > previousLimit + 400, 'the detail must extend well past the list’s scroll range');
      await wheel(nextLimit * 2);
      await waitFor(`scrollY >= (${maximum}) - 5`);
      await wheel(-nextLimit * 2);
      await waitFor('scrollY <= 5');
    });
  }
});
