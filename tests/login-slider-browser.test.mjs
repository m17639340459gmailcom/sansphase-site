import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const browser = process.env.SANSPHASE_UI_TEST_BROWSER;

test('real browser login puzzle supports keyboard and simulated touch in both forms without layout overflow',
  { skip: !browser, timeout: 60_000 }, async () => {
    const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/login-verification-library.ts', import.meta.url))],
      bundle: true, write: false, format: 'iife', globalName: 'LoginSlider', platform: 'browser', target: 'es2022', logLevel: 'silent' });
    const css = await readFile(new URL('../src/login-verification.css', import.meta.url), 'utf8');
    const check = async (library, css) => {
      const ensure = (value, message) => { if (!value) throw Error(message); };
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const style = document.createElement('style'); style.textContent = css; document.head.append(style);
      const image = width => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 360;
        const context = canvas.getContext('2d'); context.fillStyle = '#789'; context.fillRect(0, 0, width, 360);
        return canvas.toDataURL('image/png');
      };
      const challenge = () => ({ id: 'isolated-browser-test', token: 'isolated-browser-token', expiresAt: Math.floor(Date.now() / 1000) + 120,
        backgroundImage: image(600), templateImage: image(110), backgroundImageWidth: 600, backgroundImageHeight: 360, templateImageWidth: 110, templateImageHeight: 360 });
      const results = [];
      for (const namespace of ['reader', 'author']) for (const width of [240, 460]) for (const mode of ['touch', 'keyboard']) {
        document.body.innerHTML = `<form class="${namespace === 'author' ? 'author-panel' : 'reader-card--auth'}" style="width:${width}px"><input name="email" value="fixture@example.test"><input name="password" value="fixture-password"><button type="button" data-login-verification-control>验证</button></form>`;
        const form = document.querySelector('form'), before = form.innerHTML, calls = [];
        const solve = library.createLoginSliderSolver({ request: async (url, options) => {
          calls.push({ url, options, body: JSON.parse(options.body) });
          return new Response(JSON.stringify({ proof: 'isolated-browser-proof', expiresAt: Math.floor(Date.now() / 1000) + 60 }));
        } });
        const solving = solve(form, challenge(), new AbortController().signal, namespace);
        const thumb = form.querySelector('[data-login-slider-thumb]');
        for (let i = 0; thumb.disabled && i < 100; i++) await pause(10);
        ensure(!thumb.disabled, 'real browser decodes both images');
        const panel = form.querySelector('[data-login-slider]'), background = form.querySelector('[data-login-slider-background]');
        const bounds = background.getBoundingClientRect();
        ensure(bounds.width >= 100 && bounds.width <= 300, 'image respects available width');
        ensure(panel.scrollWidth <= panel.clientWidth + 1, 'puzzle has no horizontal overflow');
        ensure(document.activeElement === thumb, 'keyboard focus moves to ready slider');
        ensure(getComputedStyle(thumb).touchAction === 'none', 'touch dragging stays on the slider');
        const pageY = scrollY;
        if (mode === 'touch') {
          const pointer = (element, type, x, pointerId = 1, isPrimary = true) => element.dispatchEvent(new PointerEvent(type,
            { bubbles: true, cancelable: true, pointerId, pointerType: 'touch', isPrimary, clientX: x, clientY: 20, button: 0 }));
          pointer(thumb, 'pointerdown', 20);
          pointer(window, 'pointermove', 80, 2, false);
          ensure(thumb.getAttribute('aria-valuenow') === '0', 'another finger cannot move the active piece');
          pointer(window, 'pointercancel', 20); pointer(window, 'pointerup', 80);
          ensure(calls.length === 0, 'cancelled touch never submits');
          pointer(thumb, 'pointerdown', 20);
          for (let i = 1; i <= 12; i++) { await pause(8); pointer(window, 'pointermove', 20 + i * 5); }
          pointer(window, 'pointerup', 80);
        } else {
          for (let i = 0; i < 12; i++) { await pause(8); thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); }
          ensure(calls.length === 0, 'arrows alone do not submit');
          thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        }
        ensure(await solving === 'isolated-browser-proof', 'only the verification response releases a proof');
        ensure(calls.length === 1 && calls[0].url === `/api/${namespace}/login-challenge/verify`, 'one request to the correct account namespace');
        ensure(calls[0].options.headers[namespace === 'author' ? 'X-Author-Request' : 'X-Reader-Request'] === '1', 'account intent header preserved');
        ensure(calls[0].body.track.bgImageWidth === Math.round(bounds.width), 'submitted image width matches actual browser layout');
        ensure(form.innerHTML === before && scrollY === pageY, 'completion preserves fields and scroll position');
        results.push({ namespace, width, mode });
      }
      return results;
    };
    const results = await evaluateInWebGLBrowser(browser, `(async () => { ${bundled.outputFiles[0].text}\n return (${check.toString()})(LoginSlider, ${JSON.stringify(css)}); })()`);
    assert.equal(results.length, 8);
  });
