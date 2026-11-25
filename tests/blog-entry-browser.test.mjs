import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createPreviewServer } from '../server.mjs';
import { makeReadingDemo } from '../scripts/fixtures/reading-demo.mjs';
import { createMusicDemo } from '../scripts/fixtures/music-demo.mjs';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const browser = process.env.SANSPHASE_UI_TEST_BROWSER;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function commands(socket) {
  let next = 200;
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(Error(`Timed out: ${method}`)); }, 15_000);
    function receive(event) {
      const result = JSON.parse(event.data); if (result.id !== id) return;
      clearTimeout(timer); socket.removeEventListener('message', receive);
      if (result.error || result.result?.exceptionDetails) reject(Error(JSON.stringify(result.error || result.result.exceptionDetails)));
      else resolve(result.result);
    }
    socket.addEventListener('message', receive); socket.send(JSON.stringify({ id, method, params }));
  });
}
const geometry = `(() => {
  const box = selector => { const node = document.querySelector(selector); if (!node) return null; const r = node.getBoundingClientRect(); return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height}; };
  return {article:box('.reading-article'),title:box('.reading-article h1'),body:box('.article-body'),sidebar:box('.reading-sidebar'),theme:document.body.classList.contains('theme-light'),layouts:document.querySelectorAll('.reading-layout').length,sidebars:document.querySelectorAll('.reading-sidebar').length};
})()`;

async function fixture(t) {
  const music = createMusicDemo();
  const data = { ...makeReadingDemo(), author: null, announcements: [], profile: { name: '无相', signature: '本地演示', bio: '仅用于自动验证', socialLinks: [], music: music.settings } };
  data.notes[0].bodyHTML += '<pre><code>const value = "literal ** source";</code></pre>';
  const server = createPreviewServer({ contentService: { snapshot: async () => ({ data: structuredClone(data) }), media: music.media }, siteOrigin: 'http://127.0.0.1' });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return origin;
}

test('a slow article entry keeps SSR reading geometry, identity and theme while adopting its interactive controls', { skip: !browser, timeout: 120_000 }, async t => {
  const origin = await fixture(t);
  const results = [];
  for (const width of [1440, 390]) for (const theme of ['dark', 'light']) {
    let contentRequests = [], errors = [], failures = [];
    const result = await evaluateInWebGLBrowser(browser, 'window.__articleReview', 'about:blank', async socket => {
      const send = commands(socket);
      const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
      let paused;
      const observe = event => {
        const value = JSON.parse(event.data);
        if (value.method === 'Fetch.requestPaused') paused = value.params.requestId;
        if (value.method === 'Network.requestWillBeSent' && value.params.request.url.startsWith(origin + '/api/content')) contentRequests.push(new URL(value.params.request.url).search);
        if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.text);
        if (value.method === 'Network.responseReceived' && value.params.response.url.startsWith(origin) && value.params.response.status >= 400) failures.push([new URL(value.params.response.url).pathname, value.params.response.status]);
      };
      socket.addEventListener('message', observe);
      try {
        await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        if (width === 390 && theme === 'light') await send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('sansphase-theme',${JSON.stringify(theme)});` });
        await send('Fetch.enable', { patterns: [{ urlPattern: '*/app.mjs*', requestStage: 'Request' }] });
        await send('Page.navigate', { url: origin + '/blog/reading-preview' });
        for (let i = 0; i < 150; i++) {
          if (paused && await evaluate(`!!document.querySelector('.article-body') && Array.from(document.querySelectorAll('link[rel="stylesheet"]')).every(link => link.sheet)`)) break;
          await delay(20);
        }
        assert(paused, 'the application script is intentionally delayed');
        // Force a layout before waiting on fonts: the held module keeps the
        // document parser's completion pending, but the SSR content is visible.
        await evaluate(geometry);
        await evaluate('Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,500))]).then(()=>true)'); await delay(100);
        await evaluate('window.__serverArticle=document.querySelector(".reading-article");window.__serverBody=document.querySelector(".article-body");window.__serverCodeTools=document.querySelector(".article-code-tools")');
        const before = await evaluate(geometry);
        await send('Fetch.continueRequest', { requestId: paused }); await send('Fetch.disable');
        for (let i = 0; i < 200; i++) { if (await evaluate(`!!document.querySelector('.article-share-button') && !!document.querySelector('.article-contents') && !!document.querySelector('.plyr')`)) break; await delay(20); }
        await delay(150);
        const after = await evaluate(geometry);
        const retained = await evaluate('window.__serverArticle===document.querySelector(".reading-article") && window.__serverBody===document.querySelector(".article-body")');
        const codeToolsRetained = await evaluate('!!window.__serverCodeTools && window.__serverCodeTools===document.querySelector(".article-code-tools") && !window.__serverCodeTools.inert');
        const controls = await evaluate(`({share:document.querySelectorAll('.article-share-button').length,directory:document.querySelectorAll('.article-contents').length,copy:document.querySelectorAll('.article-code-tools button').length})`);
        const date = await evaluate(`(() => { const node=document.querySelector('.post-tags time'); return {actual:node.textContent,expected:new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(node.dateTime)).replaceAll('/','.')}; })()`);
        await evaluate(`window.__articleReview=${JSON.stringify({ width, theme, before, after, retained, codeToolsRetained, controls, date })}`);
      } finally { socket.removeEventListener('message', observe); }
    });
    results.push({ ...result, contentRequests, errors, failures });
    if (process.env.SANSPHASE_BLOG_ENTRY_RECEIPT) await writeFile(process.env.SANSPHASE_BLOG_ENTRY_RECEIPT, JSON.stringify(results, null, 2));
    assert.equal(result.retained, true, 'SSR article and body nodes must survive adoption');
    assert.equal(result.codeToolsRetained, true, 'SSR copy toolbar is adopted in place and becomes interactive');
    assert.equal(result.date.actual, result.date.expected, 'the displayed publication date preserves the browser time zone');
    assert.equal(result.before.theme, theme === 'light'); assert.equal(result.after.theme, result.before.theme);
    assert.equal(result.after.layouts, 1); assert.equal(result.after.sidebars, 1);
    assert.deepEqual(result.controls, { share: 1, directory: 1, copy: 1 });
    assert.deepEqual(contentRequests, [], 'the verified entry bootstrap must not repeat content fetches');
    assert.deepEqual(errors, []); assert.deepEqual(failures, []);
    for (const selector of ['article','title','body']) for (const axis of ['x','y','width','height']) assert(Math.abs(result.after[selector][axis] - result.before[selector][axis]) <= 2, `${width}/${theme}: ${selector}.${axis} changed from ${result.before[selector][axis]} to ${result.after[selector][axis]}`);
  }
});

test('clean article links preserve real-browser navigation, sharing, code copying, directory and saved theme', { skip: !browser, timeout: 120_000 }, async t => {
  const origin = await fixture(t);
  for (const width of [1440, 390]) for (const theme of ['dark', 'light']) {
    const result = await evaluateInWebGLBrowser(browser, 'window.__interactionReview', 'about:blank', async socket => {
      const send = commands(socket);
      const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
      const waitFor = async expression => { for (let i=0;i<200;i++) { if (await evaluate(expression)) return; await delay(20); } throw Error('Browser condition did not settle: '+expression); };
      const click = async selector => {
        const point = await evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); node.scrollIntoView({block:'center',behavior:'instant'}); const rect=node.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
        await send('Input.dispatchMouseEvent', { type:'mouseMoved',...point });
        await send('Input.dispatchMouseEvent', { type:'mousePressed',...point,button:'left',buttons:1,clickCount:1 });
        await send('Input.dispatchMouseEvent', { type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1 });
      };
      await send('Page.enable');
      await send('Emulation.setDeviceMetricsOverride', { width, height:900, deviceScaleFactor:1, mobile:false });
      await send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
      await send('Browser.grantPermissions', { origin, permissions:['clipboardReadWrite','clipboardSanitizedWrite'] });
      await send('Page.addScriptToEvaluateOnNewDocument', { source:`localStorage.setItem('sansphase-theme',${JSON.stringify(theme)});Object.defineProperty(navigator,'share',{value:undefined,configurable:true});` });
      await send('Page.navigate', { url:origin+'/blog/reading-preview' });
      await waitFor(`!!document.querySelector('.article-share-button') && !!document.querySelector('.article-code-tools button')`);
      await evaluate('window.__documentMarker=1');
      await click('.article-share-button');
      await waitFor(`document.querySelector('.article-share-feedback')?.textContent==='链接已复制'`);
      const shared = await evaluate('navigator.clipboard.readText()');
      await click('.article-code-tools button');
      await waitFor(`document.querySelector('.article-code-tools [role="status"]')?.textContent==='已复制'`);
      const copied = await evaluate('navigator.clipboard.readText()');
      await evaluate('window.__bodyMarker=document.querySelector(".article-body")');
      if (width<960) await click('.article-contents summary');
      await click('.article-contents nav button:last-child');
      const bodyKept = await evaluate('window.__bodyMarker===document.querySelector(".article-body")');
      await click('.back-link');
      await waitFor(`location.pathname==='/' && location.hash==='#/notes' && !!document.querySelector('a[href="/blog/reading-preview"]')`);
      await click('a[href="/blog/reading-preview"]');
      await waitFor(`location.pathname==='/blog/reading-preview' && !!document.querySelector('.article-share-button')`);
      const documentKept = await evaluate('window.__documentMarker===1');
      await evaluate('history.back()'); await waitFor(`location.pathname==='/' && location.hash==='#/notes'`);
      await evaluate('history.forward()'); await waitFor(`location.pathname==='/blog/reading-preview' && !!document.querySelector('.article-share-button')`);
      const beforeReload = await evaluate('performance.timeOrigin');
      await send('Page.reload');
      await waitFor(`performance.timeOrigin!==${beforeReload} && !!document.querySelector('.article-share-button')`);
      const themeKept = await evaluate(`document.body.classList.contains('theme-light')===${theme==='light'}`);
      await evaluate(`window.__interactionReview=${JSON.stringify({width,theme,shared,copied,bodyKept,documentKept,themeKept})}`);
    });
    assert.equal(result.shared, origin+'/share/blog/reading-preview');
    assert.equal(result.copied, 'const value = "literal ** source";');
    assert.equal(result.bodyKept,true); assert.equal(result.documentKept,true); assert.equal(result.themeKept,true);
  }
});
