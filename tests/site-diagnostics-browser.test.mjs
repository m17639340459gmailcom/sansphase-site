import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewServer } from '../server.mjs';
import { createLocalDiagnostics } from '../server/local-diagnostics.ts';
import { createCommunityDemo } from '../scripts/fixtures/community-demo.mjs';
import { makeReadingDemo } from '../scripts/fixtures/reading-demo.mjs';
import { createMusicDemo } from '../scripts/fixtures/music-demo.mjs';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const browser = process.env.SANSPHASE_UI_TEST_BROWSER;

async function fixture(t, enabled) {
  const community = await createCommunityDemo({ visualDemo: true });
  const music = createMusicDemo();
  const data = { ...makeReadingDemo(), author: null, announcements: [], profile: {
    name: '无相', signature: '本地诊断验收', bio: '合成数据', socialLinks: [], music: music.settings,
  } };
  let diagnostics, communityService;
  const requests = [];
  const server = createPreviewServer({
    siteOrigin: 'http://127.0.0.1',
    contentService: { snapshot: async () => ({ data: structuredClone(data) }), media: music.media },
    communityEnabled: true,
    communityService: { handle: (req, res) => communityService.handle(req, res) },
    ...(enabled ? { diagnosticsService: { handle: (req, res) => diagnostics.handle(req, res) } } : {}),
    requestLogger: event => requests.push(event.path),
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  communityService = community.service(port);
  const origin = `http://127.0.0.1:${port}`;
  if (enabled) diagnostics = createLocalDiagnostics({ origin, release: 'isolated-browser-test' });
  t.after(async () => {
    await new Promise(done => server.close(done));
    community.close();
  });
  return { origin, requests };
}

test('ordinary pages do not load or request diagnostics', { skip: !browser, timeout: 60000 }, async t => {
  const f = await fixture(t, false);
  const result = await evaluateInWebGLBrowser(browser, `(async () => {
    await new Promise(done => setTimeout(done, 2500));
    return { ready: !!document.querySelector('main'), resources: performance.getEntriesByType('resource').map(entry => entry.name) };
  })()`, f.origin + '/#/notes');
  assert.equal(result.ready, true);
  assert.equal(result.resources.some(path => /site-diagnostics|\/api\/diagnostics/.test(path)), false);
  assert.equal(f.requests.some(path => /site-diagnostics|\/api\/diagnostics/.test(path)), false);
});

test('local monitoring records real metrics and long tasks without changing page markup or capturing content', { skip: !browser, timeout: 120000 }, async t => {
  const f = await fixture(t, true);
  const result = await evaluateInWebGLBrowser(browser, `(async () => {
    const wait = milliseconds => new Promise(done => setTimeout(done, milliseconds));
    await wait(2500);
    window.dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE_CONTENT_person@example.test', filename: location.origin + '/app.mjs?token=PRIVATE_TOKEN', lineno: 17, error: new TypeError('PRIVATE_CONTENT_person@example.test') }));
    await new Promise(done => setTimeout(() => {
      const started = performance.now();
      while (performance.now() - started < 120) { /* Isolated, deliberately slow fixture. */ }
      done();
    }, 0));
    await wait(250);
    window.dispatchEvent(new Event('pagehide'));
    await wait(400);
    const report = await fetch('/api/diagnostics/report').then(response => response.json());
    // Read the report before importing the controller: this must prove app.mjs
    // automatically started collection from the actual bootstrap response.
    const { startSiteDiagnostics } = await import('/site-diagnostics.mjs');
    const before = document.querySelector('main').outerHTML;
    startSiteDiagnostics();
    const unchanged = before === document.querySelector('main').outerHTML;
    return { unchanged, report, observerSupported: typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask') };
  })()`, f.origin + '/#/community/home');
  assert.equal(result.unchanged, true, 'starting twice must not change the page DOM');
  assert.ok(result.report.count > 0);
  assert.ok(result.report.events.some(event => event.kind === 'vital'), 'the real installed web-vitals library must report a browser metric');
  assert.ok(result.report.events.some(event => event.kind === 'error' && event.name === 'TypeError'));
  if (result.observerSupported) assert.ok(result.report.events.some(event => event.kind === 'longtask' && event.duration >= 100));
  assert.doesNotMatch(JSON.stringify(result.report), /PRIVATE_|person@example|token=|app\.mjs\?/);
});
