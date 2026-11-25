import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createAdminConsolePreview } from '../scripts/preview-admin-console.ts';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

// Only the private puzzle engine is deterministic here. The browser form,
// proof signing/nonce/single-use checks, password authentication, Payload and
// manage APIs are the real modules. No test endpoint or bypass enters a build.
async function captchaFixture() {
  const secret = randomBytes(48).toString('hex'), issued = new Set();
  const png = async width => 'data:image/png;base64,' + (await sharp({ create: {
    width, height: 360, channels: 4, background: '#62748c',
  } }).png().toBuffer()).toString('base64');
  const backgroundImage = await png(600), templateImage = await png(110);
  let accepted = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer ' + secret) { res.writeHead(403); res.end('{}'); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (req.url === '/challenge') {
      const id = randomUUID(); issued.add(id);
      res.end(JSON.stringify({ id, type: 'SLIDER', backgroundImage, templateImage,
        backgroundImageWidth: 600, backgroundImageHeight: 360, templateImageWidth: 110, templateImageHeight: 360 }));
    } else if (req.url === '/verify') {
      const verified = issued.delete(body.id) && body.track?.left === 60;
      if (verified) accepted++;
      res.end(JSON.stringify({ verified }));
    } else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { serviceOrigin: `http://127.0.0.1:${server.address().port}`, serviceSecret: secret,
    accepted: () => accepted, close: () => new Promise(done => server.close(done)) };
}

test('release assets reuse the original verified login, retain owner destinations and reject ordinary readers',
  { skip: process.env.ADMIN_CONSOLE_BROWSER !== '1', timeout: 120000 }, async () => {
    const captcha = await captchaFixture();
    let preview;
    try {
      preview = await createAdminConsolePreview({ port: 0, deliveryVerification: {
        serviceOrigin: captcha.serviceOrigin, serviceSecret: captcha.serviceSecret,
      } });
      const { origin } = preview;
      for (const namespace of ['reader', 'author']) {
        const missing = await fetch(`${origin}/api/${namespace}/login`, { method: 'POST',
          headers: { Origin: origin, [`X-${namespace === 'author' ? 'Author' : 'Reader'}-Request`]: '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'owner@example.test', password: 'DemoLogin2026!' }) });
        assert.equal(missing.status, 403, 'passwords do not bypass verification');
        assert.equal(missing.headers.has('set-cookie'), false);
        await missing.arrayBuffer();
      }
      for (const path of ['/preview-login', '/preview-login.js', '/preview-author-navigation.js'])
        assert.equal((await fetch(origin + path)).status, 404, 'no preview route in delivery mode');
      assert.equal((await fetch(origin + '/api/manage/readers')).status, 403);
      const errors = [];
      let id = 2700;
      const result = await evaluateInWebGLBrowser(process.env.TEST_BROWSER_PATH ||
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'window.releaseConsoleResult', 'about:blank', async socket => {
          const call = (method, params = {}) => new Promise((resolve, reject) => {
            const current = id++;
            const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(Error('CDP timed out: ' + method)); }, 15000);
            function receive(event) {
              const response = JSON.parse(event.data); if (response.id !== current) return;
              clearTimeout(timer); socket.removeEventListener('message', receive);
              if (response.error || response.result?.exceptionDetails) reject(Error(JSON.stringify(response)));
              else resolve(response.result);
            }
            socket.addEventListener('message', receive); socket.send(JSON.stringify({ id: current, method, params }));
          });
          socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
          });
          await call('Runtime.enable');
          const evaluate = async expression => (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
          const wait = async (expression, label) => {
            for (let attempt = 0; attempt < 140; attempt++) {
              try { if (await evaluate(expression)) return; } catch { /* Navigation replaces the context. */ }
              await new Promise(done => setTimeout(done, 70));
            }
            throw Error(label + ': ' + await evaluate("location.href+' '+document.body.innerText.slice(-1400)"));
          };
          const loginForm = `!!document.querySelector('[data-reader-form="login"]')`;
          await call('Page.navigate', { url: origin + '/admin-console/#/memberships?filter=%7B%22q%22%3A%22private-search%22%7D' });
          await wait(loginForm, 'existing site login opens');
          assert.equal(await evaluate("new URLSearchParams(location.search).get('adminReturn')"), 'memberships');
          assert.equal(await evaluate("location.href.includes('private-search')"), false, 'private filters are not carried to login');
          const login = async email => {
            await wait(loginForm, 'existing login form is ready');
            await evaluate(`(()=>{const form=document.querySelector('[data-reader-form="login"]');
              for(const [name,value] of [['email',${JSON.stringify(email)}],['password','DemoLogin2026!']]){
                const input=form.elements.namedItem(name);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
              }})()`);
            await wait(`document.querySelector('[data-login-verification-control]')?.dataset.state==='ready'`, 'slider control prepared');
            assert.equal(await evaluate(`document.querySelector('[data-reader-form="login"] button[type="submit"]').disabled`), true);
            await evaluate(`document.querySelector('[data-login-verification-control]').click()`);
            await wait(`document.querySelector('[data-login-slider-thumb]')?.disabled===false`, 'actual slider shown');
            await evaluate(`(async()=>{const thumb=document.querySelector('[data-login-slider-thumb]');for(let i=0;i<20;i++){
              thumb.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,25));
            }thumb.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));})()`);
            await wait(`document.querySelector('[data-login-verification-control]')?.dataset.state==='verified'`, 'server proof returned');
            await evaluate(`document.querySelector('[data-reader-form="login"] button[type="submit"]').click()`);
          };
          await login('owner@example.test');
          await wait(`location.pathname==='/admin-console/'&&location.hash.startsWith('#/memberships')&&!!document.querySelector('[data-testid="reader-table"] tbody tr')`, 'owner returns to requested VIP section');
          assert.equal(await evaluate(`document.body.innerText.includes('当前使用演示数据')||document.body.innerText.includes('本地预览')`), false);
          await evaluate(`document.querySelector('[href="#/author-panel"]').click()`);
          await wait(`!!document.querySelector('.author-hub-heading')`, 'original author hub opens');
          assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.author-menu-grid [data-author-open]'), el=>el.dataset.authorOpen)`),
            ['announcements','articles','works','resources','software','resource-center','profile','background','music','appearance','admin']);
          await evaluate(`document.querySelector('[data-author-open="admin"]').click()`);
          await wait(`location.pathname==='/admin-console/'&&!!document.querySelector('[data-testid="reader-table"] tbody tr')`, 'original hub returns to release console');
          await call('Page.navigate', { url: origin + '/#/admin' });
          await wait(`location.pathname==='/admin-console/'&&location.hash.startsWith('#/readers')&&!!document.querySelector('[data-testid="reader-table"] tbody tr')`, 'legacy admin bookmark opens the formal console with the existing owner session');
          assert.equal(await evaluate(`document.body.classList.contains('admin-open')`), false, 'the legacy in-page management shell is not mounted');
          await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
          assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false);
          await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
          const interceptionErrors = [];
          const unavailable = event => {
            const message = JSON.parse(event.data);
            if (message.method !== 'Fetch.requestPaused') return;
            void call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 503,
              responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
              body: Buffer.from(JSON.stringify({ error: 'Temporary session lookup failure' })).toString('base64'),
            }).catch(error => interceptionErrors.push(error.message));
          };
          socket.addEventListener('message', unavailable);
          await call('Fetch.enable', { patterns: [{ urlPattern: origin + '/api/author/session', requestStage: 'Request' }] });
          await call('Page.reload');
          await wait(`location.hash.startsWith('#/session-unavailable')&&document.body.innerText.includes('重试')`, 'session service failure offers retry');
          assert.equal(await evaluate(`(async()=>{const r=await fetch('/api/manage/readers');return r.status})()`), 200, 'temporary lookup failure does not revoke a valid author session');
          assert.equal(await evaluate(`!!document.querySelector('[data-testid="reader-table"]')`), false, 'unverified private page is not shown');
          await call('Fetch.disable');
          socket.removeEventListener('message', unavailable);
          assert.deepEqual(interceptionErrors, []);
          await evaluate(`Array.from(document.querySelectorAll('a')).find(el=>el.textContent.trim()==='重试').click()`);
          await wait(`location.hash.startsWith('#/readers')&&!!document.querySelector('[data-testid="reader-table"] tbody tr')`, 'retry restores console without another login');
          await wait(`!!document.querySelector('.RaUserMenu-userButton')`, 'author menu is ready');
          await evaluate(`document.querySelector('.RaUserMenu-userButton').click()`);
          await wait(`!!document.querySelector('#menu-appbar .logout')`, 'logout action is shown');
          await evaluate(`document.querySelector('#menu-appbar .logout').click()`);
          await wait(loginForm, 'explicit logout returns to existing login');
          assert.equal(await evaluate(`(async()=>{const r=await fetch('/api/manage/readers');return r.status})()`), 403, 'user logout really revokes server access');
          await login('owner@example.test');
          await wait(`location.pathname==='/admin-console/'&&!!document.querySelector('[data-testid="reader-table"] tbody tr')`, 'owner can sign in again after explicit logout');
          await evaluate(`(async()=>{const result=await fetch('/api/author/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Author-Request':'1'},body:'{}'});if(!result.ok)throw Error('Logout failed');location.hash='#/profile-reviews';})()`);
          await wait(loginForm, 'session loss sends owner to original login');
          assert.equal(await evaluate(`!!document.querySelector('[data-testid="reader-table"]')`), false);
          await login('reader-01@example.test');
          await wait(`!!document.querySelector('[data-reader-form="profile"]')`, 'ordinary reader gets their normal account page');
          await call('Page.navigate', { url: origin + '/admin-console/#/readers' });
          await wait(`location.pathname==='/'&&!!document.querySelector('[data-reader-form="profile"]')`, 'ordinary reader cannot enter console');
          assert.equal(await evaluate(`(async()=>{const r=await fetch('/api/manage/readers');return r.status})()`), 403);
          await evaluate(`window.releaseConsoleResult={ownerReturn:true,originalHub:true,networkRecovery:true,explicitLogout:true,expiredSession:true,readerDenied:true};`);
        });
      assert.deepEqual(result, { ownerReturn: true, originalHub: true, networkRecovery: true, explicitLogout: true, expiredSession: true, readerDenied: true });
      assert.deepEqual(errors, []);
      assert.equal(captcha.accepted(), 3, 'each password login required a real nonce-bound verification proof');
    } finally {
      try { await preview?.close(); } finally { await captcha.close(); }
    }
  });
