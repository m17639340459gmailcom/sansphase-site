import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const browser = process.env.SANSPHASE_UI_TEST_BROWSER;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function commands(socket) {
  let next = 200;
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(Error(`Timed out: ${method}`)); }, 10_000);
    function receive(event) {
      const message = JSON.parse(event.data); if (message.id !== id) return;
      clearTimeout(timer); socket.removeEventListener('message', receive);
      if (message.error || message.result?.exceptionDetails) reject(Error(JSON.stringify(message.error || message.result.exceptionDetails)));
      else resolve(message.result);
    }
    socket.addEventListener('message', receive); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function fixture(library, css, namespace) {
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  document.body.innerHTML = '<header id="site-header">Fixture header</header><main id="main">' + library.readerPage('account', '', null) + '</main><footer id="site-footer">Fixture footer</footer>';
  // The actual site pins this header after scrolling; keep the same 64px obstruction in every case.
  document.querySelector('#site-header').style.cssText = 'position:fixed;inset:0 0 auto;height:64px;background:#16253b';
  document.querySelector('#main').style.paddingTop = '64px';
  if (namespace === 'author') {
    document.querySelector('#main').innerHTML = '<p>Underlying page</p>';
    document.body.insertAdjacentHTML('beforeend', `<div class="dialog-shell author-dialog" data-size="login"><div class="author-frame"><section class="author-panel"><h2>登录</h2><p class="author-description">管理文章、资料和个人设置。</p><form><label class="author-field">账号邮箱<input name="email"></label><label class="author-field">密码<input name="password" type="password"></label>${library.loginVerificationControlHTML()}<p class="author-description">账号会在本机记住；密码可由浏览器安全保存和自动填充。</p><button class="author-primary" type="submit">登录</button></form></section></div></div>`);
  }
  const image = width => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 360; canvas.getContext('2d').fillRect(0, 0, width, 360); return canvas.toDataURL(); };
  const challenge = { id: 'fixture', token: 'fixture', expiresAt: Math.floor(Date.now() / 1000) + 120, backgroundImage: image(600), templateImage: image(110), backgroundImageWidth: 600, backgroundImageHeight: 360, templateImageWidth: 110, templateImageHeight: 360 };
  const form = document.querySelector('form'), control = form.querySelector('[data-login-verification-control]');
  let requests = 0;
  const solve = library.createLoginSliderSolver({ request: async () => { requests++; throw Error('This visibility check must not submit a puzzle'); } });
  const acquire = library.createLoginVerificationAcquirer({ request: async () => new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge }), { headers: { Date: new Date().toUTCString() } }), load: async () => ({ solveLoginChallenge: solve }) });
  library.createLoginVerificationControlMounter({ acquire })(form, namespace);
  await new Promise(resolve => setTimeout(resolve, 40));
  for (const input of form.querySelectorAll('input')) { input.value = input.name === 'email' ? 'fixture@example.test' : 'Fixture-only'; input.focus({ preventScroll: true }); input.dispatchEvent(new Event('input', { bubbles: true })); }
  control.scrollIntoView({ block: 'center', behavior: 'instant' });
  await new Promise(resolve => setTimeout(resolve, 80));
  const box = element => {
    if (!element) return null;
    const r = element.getBoundingClientRect(), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
    const hit = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight ? document.elementFromPoint(x, y) : null;
    return { top: r.top, bottom: r.bottom, height: r.height, x, y, hit: !!hit && (element === hit || element.contains(hit)) };
  };
  const events = [];
  document.addEventListener('click', event => { if (event.target.closest('[data-login-verification-control],[data-login-slider-cancel]')) events.push({ trusted: event.isTrusted }); });
  const container = form.closest('.author-panel');
  window.fixture = { form, control, events, snapshot: () => ({ scrollY, containerScroll: container?.scrollTop ?? 0, visibleTop: container ? container.getBoundingClientRect().top : 64, visibleBottom: container ? container.getBoundingClientRect().bottom : innerHeight, control: box(control), panel: box(form.querySelector('[data-login-slider]')), thumb: box(form.querySelector('[data-login-slider-thumb]')), cancel: box(form.querySelector('[data-login-slider-cancel]')), refresh: box(form.querySelector('[data-login-slider-refresh]')), values: [...form.querySelectorAll('input')].map(input => input.value), requests, focus: document.activeElement === control ? 'control' : document.activeElement?.getAttribute('role') }) };
}

test('real mouse and keyboard first opening keeps the complete puzzle visible in short viewports and restores cancellation', { skip: !browser, timeout: 120_000 }, async () => {
  const bundled = await build({ stdin: { contents: "export {readerPage} from './src/reader-ui.ts'; export {createLoginSliderSolver} from './src/login-verification-library.ts'; export {createLoginVerificationAcquirer} from './src/login-verification.ts'; export {loginVerificationControlHTML,createLoginVerificationControlMounter} from './src/login-verification-control.ts';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'LoginFixture', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  const sheets = await Promise.all(['styles-foundation.css', 'styles-reading.css', 'styles-content.css', 'reader.css', 'author.css', 'login-verification.css'].map(file => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')));
  const css = sheets.join('\n').replace(/@import[^;]+;/g, '').replace(/url\([^)]*\)/g, 'none');
  const results = [];
  for (const namespace of ['reader', 'author']) for (const viewport of [{ width: 756, height: 488 }, { width: 390, height: 488 }, { width: 390, height: 360 }, { width: 1280, height: 900 }]) for (const mode of ['mouse', 'keyboard']) {
    const result = await evaluateInWebGLBrowser(browser, 'window.fixture.result', 'about:blank', async socket => {
      const send = commands(socket);
      const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
      await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
      await evaluate(`(async()=>{${bundled.outputFiles[0].text};await (${fixture.toString()})(LoginFixture,${JSON.stringify(css)},${JSON.stringify(namespace)})})()`);
      const before = await evaluate('fixture.snapshot()');
      const click = async point => { assert(point.hit, 'real input target must be hittable'); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 }); };
      const key = async key => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 27, ...(key === 'Enter' ? { text: '\r' } : {}) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 27 }); };
      if (mode === 'mouse') await click(before.control); else { await evaluate('fixture.control.focus({preventScroll:true})'); await key('Enter'); }
      await evaluate('(async()=>{for(let n=0;n<100&&!document.querySelector("[data-login-slider-thumb]:not(:disabled)");n++)await new Promise(r=>setTimeout(r,10));})()');
      await delay(100);
      const opened = await evaluate('fixture.snapshot()');
      // Write measurements before asserting, so a failed run preserves useful evidence.
      results.push({ namespace, viewport, mode, before, opened });
      if (process.env.SANSPHASE_SLIDER_VIEWPORT_RECEIPT) await writeFile(process.env.SANSPHASE_SLIDER_VIEWPORT_RECEIPT, JSON.stringify(results, null, 2));
      // CSS subpixel edges can differ from the browser's integer scroll offset by <1px.
      assert(opened.panel && opened.panel.top >= opened.visibleTop - 1 && opened.panel.bottom <= opened.visibleBottom + 1, `complete puzzle must fit in its visible container: ${JSON.stringify({ namespace, viewport, mode, opened })}`);
      assert(opened.thumb.hit && opened.cancel.hit, 'thumb and cancel accept real pointer input');
      if (mode === 'mouse') for (let n = 0; n < 2; n++) {
        await click((await evaluate('fixture.snapshot()')).refresh); await delay(100);
        const refreshed = await evaluate('fixture.snapshot()');
        assert(refreshed.thumb.hit && refreshed.cancel.hit, 'refresh retains accessible controls');
        assert(Math.abs(refreshed.panel.top - opened.panel.top) <= 1, 'repeated refresh keeps the same puzzle position');
      }
      if (mode === 'mouse') await click(opened.cancel); else await key('Escape');
      await delay(100);
      const after = await evaluate('fixture.snapshot()');
      assert.equal(after.panel, null); assert.deepEqual(after.values, before.values); assert.equal(after.requests, 0);
      assert(Math.abs(after.scrollY - before.scrollY) <= 1, 'cancel restores original reading position');
      assert(Math.abs(after.containerScroll - before.containerScroll) <= 1, 'cancel restores nested scrolling');
      assert(Math.abs(after.control.top - before.control.top) <= 1, 'cancel restores the original form position');
      assert.equal(after.focus, 'control', 'keyboard focus returns to the enabled verification button');
      await evaluate(`fixture.result=${JSON.stringify({ namespace, viewport, mode, before, opened, after })};fixture.result.events=fixture.events;`);
    });
    results[results.length - 1] = result;
  }
  if (process.env.SANSPHASE_SLIDER_VIEWPORT_RECEIPT) await writeFile(process.env.SANSPHASE_SLIDER_VIEWPORT_RECEIPT, JSON.stringify(results, null, 2));
  assert.equal(results.length, 16);
  assert(results.every(result => result.events.length > 0 && result.events.every(event => event.trusted)));
});
