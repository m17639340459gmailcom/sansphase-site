import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';
import { musicPlayerStaticHTML } from '../src/music-player-markup.ts';

const browser = process.env.SANSPHASE_UI_TEST_BROWSER;
test('real Plyr replaces the inert static player without shifting record, controls or following content', { skip: !browser, timeout: 60_000 }, async () => {
  const source = fileURLToPath(new URL('../src', import.meta.url));
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/music-player.mjs', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'MusicFixture', platform: 'browser', target: 'es2022', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent' });
  const styles = await build({ stdin: { contents: '@import "./styles.css"; @import "../node_modules/plyr/dist/plyr.css"; @import "./blog-background.css"; @import "./visitor-controls.css";', loader: 'css', resolveDir: source }, bundle: true, write: false, external: ['*.woff2', '*.woff', '*.jpg', '*.png', '*.webp', '*.svg'], logLevel: 'silent' });
  const inspect = async (code, css, shells) => {
    const MusicFixture = new Function(`${code};return MusicFixture;`)();
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    const results = [];
    const pause = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    for (const theme of ['dark', 'light']) for (const english of [false, true]) {
      document.body.className = theme === 'light' ? 'theme-light' : '';
      document.body.innerHTML = `<div class="blog-page" style="width: min(300px, calc(100vw - 40px));"><div class="blog-side-card blog-music-card"><span class="eyebrow">MUSIC</span><div id="blog-audio-player">${shells[english ? 1 : 0]}</div></div><p data-after-player>following article</p></div>`;
      const target = document.querySelector('#blog-audio-player'), initial = target.firstElementChild;
      const geometry = () => Object.fromEntries(['.music-turntable', '.vinyl-controls', '.music-seek-row', '.music-transport', '.music-volume-row', '[data-after-player]'].map(selector => {
        const box = document.querySelector(selector).getBoundingClientRect(); return [selector, [box.x, box.y, box.width, box.height]];
      }));
      await pause();
      const before = geometry();
      MusicFixture.mountSiteMusic(target, { tracks: [{ title: 'first', url: 'https://example.test/one.mp3' }, { title: 'second', url: 'https://example.test/two.mp3' }] }, () => {}, { preparePlayback: false, language: english ? 'en' : 'zh' });
      await pause();
      const after = geometry();
      const live = target.querySelector('.site-music-player');
      results.push({ theme, english, before, after, sameHost: initial === live, inert: live.inert, placeholders: target.querySelectorAll('[data-music-player-static]').length, players: target.querySelectorAll('.site-music-player').length, audio: live.querySelectorAll('audio').length, controls: live.querySelectorAll('.vinyl-controls').length });
      MusicFixture.mountSiteMusic(null, { tracks: [] }, () => {});
    }
    return results;
  };
  for (const width of [1440, 390]) {
    const results = await evaluateInWebGLBrowser(browser, `(${inspect.toString()})(${JSON.stringify(bundled.outputFiles[0].text)},${JSON.stringify(styles.outputFiles[0].text)},${JSON.stringify([musicPlayerStaticHTML({ trackCount: 2 }), musicPlayerStaticHTML({ english: true, trackCount: 2 })])})`, 'about:blank', socket => new Promise((resolve, reject) => {
      const listener = event => { const value = JSON.parse(event.data); if (value.id !== 202) return; socket.removeEventListener('message', listener); if (value.error) reject(Error(JSON.stringify(value.error))); else resolve(); };
      socket.addEventListener('message', listener); socket.send(JSON.stringify({ id: 202, method: 'Emulation.setDeviceMetricsOverride', params: { width, height: 900, deviceScaleFactor: 1, mobile: false } }));
    }));
    for (const result of results) {
      assert.equal(result.sameHost, true); assert.equal(result.inert, false); assert.equal(result.placeholders, 0);
      assert.equal(result.players, 1); assert.equal(result.audio, 1); assert.equal(result.controls, 1);
      for (const [selector, values] of Object.entries(result.before)) values.forEach((value, index) => assert.ok(Math.abs(value - result.after[selector][index]) <= 1, `${width}/${result.theme}/${result.english} ${selector}[${index}] ${value} -> ${result.after[selector][index]}`));
    }
  }
});
