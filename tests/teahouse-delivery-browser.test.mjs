import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPreviewServer } from '../server.mjs';
import { createCommunityHostAccess } from '../server/community-host-access.ts';
import { prepareCommunityHostDirectory, createCommunityHostStore } from '../server/community-host-store.ts';
import { createTeahouseService } from '../server/teahouse-service.ts';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const candidate = process.env.TEAHOUSE_BROWSER_DIST;
test('built standalone tea-room passes the real session gate, CSP, assets, uploads and Socket.IO upgrade', { skip: !candidate, timeout: 45000 }, async () => {
  const base = await mkdtemp(resolve(tmpdir(), 'teahouse-delivery-'));
  const directory = resolve(base, 'community');
  const mainOrigin = 'https://www.sansphase.com', origin = 'https://community.sansphase.com';
  const actor = { kind: 'reader', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', uid: '357341', name: '构建验收会员名字很长也不应遮挡个人入口', role: null, vip: true };
  let store, server, tea;
  try {
    await prepareCommunityHostDirectory(directory);
    store = createCommunityHostStore(directory);
    const cookie = store.createSession('isolated-build-check', actor);
    const access = createCommunityHostAccess({ store, siteOrigin: origin, mainSiteOrigin: mainOrigin, secret: 'isolated-build-check-secret-over-32-characters', teahouseEnabled: true,
      purge: async () => {}, client: { request: async () => ({ viewer: actor, author: null, reader: null }) } });
    server = createPreviewServer({ root: resolve(candidate), siteOrigin: origin, communityOnly: true, communityEnabled: true, teahouseEnabled: true, communityService: {},
      requestMiddleware: (req, res, next) => access.requestMiddleware(req, res, async () => { if (tea && await tea.handle(req, res)) return; await next(); }) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const local = `http://127.0.0.1:${server.address().port}`;
    tea = await createTeahouseService({ server, directory: resolve(base, 'chat'), origin: local, identify: req => access.runWithSession(req, async () => actor), authors: async (_req, authors) => authors.map(() => actor) });
    for (const path of ['/teahouse', '/teahouse.html']) {
      const guest = await fetch(local + path);
      assert.doesNotMatch(await guest.text(), /id="message-input"/);
      const page = await fetch(local + path, { headers: { Cookie: `sansphase_community_session=${cookie}` } });
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-security-policy'), /connect-src 'self' wss:\/\/community\.sansphase\.com/);
      assert.match(page.headers.get('cache-control'), /private, no-store/);
      const html = await page.text();
      assert.match(html, /id="message-input"/);
      assert.doesNotMatch(html, /local\/identities|app\.mjs|本地身份/);
    }
    let nextId = 500;
    const broken = [], upgrades = [];
    const result = await evaluateInWebGLBrowser('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '({violations:window.policyViolations, ready:!document.getElementById("message-input").disabled})', 'about:blank', async socket => {
      const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        const receive = event => { const message = JSON.parse(event.data); if (message.id !== id) return; socket.removeEventListener('message', receive); if (message.error || message.result?.exceptionDetails) reject(Error(JSON.stringify(message))); else resolve(message.result); };
        socket.addEventListener('message', receive); socket.send(JSON.stringify({ id, method, params }));
      });
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Network.loadingFailed' && message.params.blockedReason) broken.push(message.params.blockedReason);
        if (message.method === 'Network.webSocketHandshakeResponseReceived') upgrades.push(message.params.response.status);
      });
      const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
      const waitFor = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(50); } throw Error(`Timed out: ${expression}; ` + JSON.stringify(await evaluate(`({status:document.querySelector('#chat-status')?.textContent,toast:document.querySelector('#toast')?.textContent,violations:window.policyViolations,images:[...document.querySelectorAll('.message-media img')].map(img=>({src:img.src,width:img.naturalWidth,complete:img.complete})),connection:document.querySelector('#connection-status')?.textContent})`))); };
      await call('Page.enable'); await call('Network.enable'); await call('Runtime.enable');
      await call('Page.addScriptToEvaluateOnNewDocument', { source: "window.policyViolations=[];document.addEventListener('securitypolicyviolation',event=>window.policyViolations.push({directive:event.effectiveDirective,uri:event.blockedURI}));" });
      await call('Network.setCookie', { name: 'sansphase_community_session', value: cookie, url: local, httpOnly: true, sameSite: 'Strict' });
      await call('Page.navigate', { url: `${local}/teahouse` });
      await waitFor(`document.getElementById('message-input') && !document.getElementById('message-input').disabled`);
      assert.equal(await evaluate(`document.querySelectorAll('i[data-lucide]').length`), 0, 'installed icon module renders without a vendor global');
      for (const width of [1392, 390, 320]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height: 860, deviceScaleFactor: 1, mobile: false });
        for (const theme of ['light', 'dark']) {
          await evaluate(`document.body.dataset.theme=${JSON.stringify(theme)}`);
          const before = await evaluate(`({header:document.querySelector('.site-header').getBoundingClientRect().height, composer:document.querySelector('#composer').getBoundingClientRect().top})`);
          const bounds = await evaluate(`(()=>{const b=document.querySelector('#current-person').getBoundingClientRect(),t=document.querySelector('#theme-toggle').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,left:b.left,right:b.right,width:b.width,themeRight:t.right,scrollWidth:document.documentElement.scrollWidth}})()`);
          assert.ok(bounds.width > 0 && bounds.right <= width && bounds.left >= bounds.themeRight, 'avatar remains visible beside theme control at ' + width);
          assert.ok(bounds.scrollWidth <= width, 'header must not cause horizontal overflow at ' + width);
          await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds.x, y: bounds.y, button: 'left', clickCount: 1 });
          await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.x, y: bounds.y, button: 'left', clickCount: 1 });
          assert.equal(await evaluate(`document.querySelector('#account-menu').hidden`), false);
          assert.equal(await evaluate(`document.activeElement.getAttribute('href')`), '/#/community/u/357341');
          assert.equal(await evaluate(`(()=>{const m=document.querySelector('#account-menu'),b=m.getBoundingClientRect();return b.left>=0 && b.right<=innerWidth && m.contains(document.elementFromPoint(b.left+20,b.top+20))})()`), true, 'menu is visible and not covered by the room');
          await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          assert.equal(await evaluate(`document.querySelector('#account-menu').hidden && document.activeElement.id==='current-person'`), true);
          assert.deepEqual(await evaluate(`({header:document.querySelector('.site-header').getBoundingClientRect().height, composer:document.querySelector('#composer').getBoundingClientRect().top})`), before, 'opening the account menu cannot move the chat or composer');
        }
      }
      await call('Emulation.clearDeviceMetricsOverride');
      await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1000;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(1000,1000),bytes=new Uint8Array(pixels.data.buffer);for(let i=0;i<bytes.length;i+=65536)crypto.getRandomValues(bytes.subarray(i,Math.min(i+65536,bytes.length)));for(let i=3;i<bytes.length;i+=4)bytes[i]=255;ctx.putImageData(pixels,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'build-check.png',{type:'image/png'}));const picker=document.getElementById('image-input');picker.files=transfer.files;picker.dispatchEvent(new Event('change'));})()`);
      await waitFor(`document.querySelector('.attachment-preview img') && !document.getElementById('send-button').disabled`);
      await evaluate(`document.getElementById('composer').requestSubmit()`);
      await waitFor(`document.querySelector('.image-message img')?.naturalWidth > 0`);
      await delay(200);
    });
    assert.equal(result.ready, true);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(broken, []);
    assert.ok(upgrades.includes(101), 'same-origin Socket.IO upgrades to a WebSocket');
  } finally {
    await tea?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    store?.close();
    if (!base.startsWith(resolve(tmpdir()) + sep + 'teahouse-delivery-')) throw Error('Unexpected audit directory');
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
