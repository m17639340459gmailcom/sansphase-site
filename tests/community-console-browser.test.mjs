import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCommunityConsolePreview } from '../scripts/preview-community-console.ts';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const enabled = process.env.COMMUNITY_CONSOLE_BROWSER === '1';
const browser = process.env.TEST_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function driver(socket) {
  let id = 4000;
  const call = (method, params = {}) => new Promise((done, fail) => {
    const current = id++;
    const timer = setTimeout(() => { socket.removeEventListener('message', receive); fail(Error(method + ' timed out')); }, 12000);
    function receive(event) {
      const result = JSON.parse(event.data);
      if (result.id !== current) return;
      clearTimeout(timer); socket.removeEventListener('message', receive);
      if (result.error || result.result?.exceptionDetails) fail(Error(JSON.stringify(result)));
      else done(result.result);
    }
    socket.addEventListener('message', receive);
    socket.send(JSON.stringify({ id: current, method, params }));
  });
  const evaluate = async expression => (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  const wait = async (expression, label) => {
    for (let i = 0; i < 100; i++) {
      try { if (await evaluate(`Boolean(${expression})`)) return; } catch { /* Navigation destroys the prior context. */ }
      await new Promise(done => setTimeout(done, 60));
    }
    throw Error(label + ': ' + await evaluate("document.body.innerText+' DOM '+JSON.stringify([...document.querySelectorAll('[data-testid],table,tbody,tr,[role=table]')].map(el=>[el.tagName,el.getAttribute('data-testid'),el.getAttribute('class')]).slice(0,12))"));
  };
  const click = async expression => {
    const point = await evaluate(`(()=>{const el=${expression};if(!el)throw Error('Missing click target');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  const button = label => `[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(label)}&&!el.disabled)`;
  const navigate = url => call('Page.navigate', { url });
  const selectRole = (origin, role) => call('Network.setCookie', { name: 'preview_as', value: role, url: origin, httpOnly: true, sameSite: 'Strict' });
  const screenshot = async name => {
    const result = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve('.local', name), Buffer.from(result.data, 'base64'));
  };
  return { call, evaluate, wait, click, button, navigate, selectRole, screenshot,
    listen: listener => socket.addEventListener('message', listener),
    unlisten: listener => socket.removeEventListener('message', listener) };
}

test('preserved community management entry uses the original UI and real moderation flows', { skip: !enabled, timeout: 120000 }, async t => {
  const preview = await createCommunityConsolePreview();
  t.after(() => preview.close());
  const { origin } = preview;
  const errors = [];
  const run = callback => evaluateInWebGLBrowser(browser, 'true', 'about:blank', async socket => {
    const d = driver(socket);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    });
    await d.call('Runtime.enable');
    await d.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await callback(d);
  });
  await run(async d => {
    await d.selectRole(origin, 'owner');
    await d.navigate(origin + '/community-console/?communityTheme=light#/queue');
    await d.wait("['#/community/manage','#/community/manage/queue'].includes(location.hash)&&document.querySelector('[data-review-row]')", 'original management queue');
    assert.equal(await d.evaluate("!!document.querySelector('.community-management-nav')"), true);
    assert.equal(await d.evaluate("!!document.querySelector('.RaLayout-root,.MuiDataTable-root')"), false);
    assert.equal(await d.evaluate("getComputedStyle(document.body).getPropertyValue('--bg').trim()"), '#e8e2d6');
    await d.screenshot('community-management-restored-light.png');
    const queue = await d.evaluate("fetch('/api/community/manage?tab=queue').then(r=>r.json())");
    const pending = queue.queue.topics.find(row => row.title === '这个网站可以免费抠图');
    assert.ok(pending);
    await d.click(`document.querySelector('[data-action="community-approve"][data-id="${pending.id}"]')`);
    await d.wait(`!document.querySelector('[data-review-row="${pending.id}"]')`, 'approved post leaves old queue');
    assert.equal(await d.evaluate("!!document.querySelector('.community-management-nav a[href=\"#/community/manage/content\"]')"), false, 'no duplicate published-post sidebar');
    await d.navigate(origin + '/#/community/manage/content');
    await d.wait("document.querySelector('[data-community=\"manage\"][data-tab=\"content\"] .community-queue')?.textContent.includes('这个网站可以免费抠图')", 'old content card list');
    assert.equal(await d.evaluate("!!document.querySelector('.community-management-nav a[href=\"#/community/manage/orders\"]')"), true);
    await d.click("document.querySelector('[data-community-management-switch=\"reports\"]')");
    await d.wait("document.querySelector('[data-action=\"community-dismiss\"]')", 'old report card actions');
    await d.click("document.querySelector('[data-action=\"community-dismiss\"]')");
    await d.wait("!document.querySelector('[data-action=\"community-dismiss\"]')&&document.querySelector('.community-management-body')?.textContent.includes('没有待处理的举报')", 'dismiss report');
    assert.equal((await d.evaluate("fetch('/api/community/manage?tab=reports').then(r=>r.json())")).reports.length, 0);
    await d.click("document.querySelector('.community-management-nav a[href=\"#/community/manage/orders\"]')");
    await d.wait("document.querySelector('[data-community=\"manage\"][data-tab=\"orders\"] .community-table')", 'original fulfillment panel');
    assert.equal(await d.evaluate("!!document.querySelector('.community-management-nav a[href=\"#/community/manage/items\"]')"), true);
    await d.screenshot('community-management-restored-orders.png');
  });
  await run(async d => {
    await d.selectRole(origin, 'assistant');
    await d.navigate(origin + '/community-console/?communityTheme=dark#/queue');
    await d.wait("document.querySelector('[data-review-row]')", 'assistant original queue');
    assert.equal(await d.evaluate("!!document.querySelector('.community-management-nav a[href=\"#/community/manage/orders\"]')"), false);
    const queue = await d.evaluate("fetch('/api/community/manage?tab=queue').then(r=>r.json())");
    assert.ok(queue.queue.topics.length && queue.queue.topics.every(row => row.board === 'qa'));
    assert.equal(await d.evaluate("!!document.querySelector('[data-action=\"community-queue-delete\"]')"), false);
    await d.click("document.querySelector('.community-appearance-toggle')");
    await d.wait("document.body.dataset.communityTheme==='dark'", 'existing theme control');
    await d.screenshot('community-management-restored-dark.png');
    await d.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await d.wait("document.documentElement.scrollWidth<=innerWidth+1", 'no mobile overflow');
    await d.wait("[...document.images].filter(image=>image.getClientRects().length).every(image=>image.complete)", 'visible identity images settled');
    assert.deepEqual(await d.evaluate("[...document.images].filter(image=>image.getClientRects().length&&image.complete&&!image.naturalWidth).map(image=>image.src)"), [], 'no broken visible identity images');
    await d.screenshot('community-management-restored-mobile.png');
    await d.selectRole(origin, 'demo');
    await d.navigate(origin + '/?communityTheme=light#/community/manage/queue');
    await d.wait("document.body.innerText.includes('没有管理权限')||document.body.innerText.includes('仅作者或版主')||document.body.innerText.includes('没有权限')", 'reader denied');
    assert.equal(await d.evaluate("!!document.querySelector('[data-review-row]')"), false);
  });
  await run(async d => {
    await d.selectRole(origin, 'owner');
    await d.navigate(origin + '/?communityTheme=light#/community/manage/queue');
    await d.wait("document.querySelector('[data-action=\"community-reject\"]')", 'remaining review');
    await d.click("document.querySelector('[data-action=\"community-reject\"]')");
    await d.wait("document.querySelector('[data-community-form=\"reject\"]')", 'original rejection panel');
    await d.click("document.querySelector('[data-community-form=\"reject\"] input[name=\"reason\"]')");
    await d.click("document.querySelector('[data-community-form=\"reject\"] input[name=\"note\"]')");
    await d.call('Input.insertText', { text: '请补充复现步骤' });
    let failedRequests = 0;
    const intercept = async event => {
      const message = JSON.parse(event.data);
      if (message.method !== 'Fetch.requestPaused') return;
      failedRequests++;
      await d.call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 503,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ error: '本地测试暂时失败' })).toString('base64') });
    };
    d.listen(intercept);
    await d.call('Fetch.enable', { patterns: [{ urlPattern: '*/api/community/manage/topics/*/reject', requestStage: 'Request' }] });
    await d.click("document.querySelector('[data-community-form=\"reject\"] button[type=\"submit\"]')");
    await d.wait("document.querySelector('[data-community-form=\"reject\"] .community-form-status')?.textContent.includes('本地测试暂时失败')", 'failure retains original form');
    assert.equal(await d.evaluate("document.querySelector('[data-community-form=\"reject\"] input[name=\"note\"]').value"), '请补充复现步骤');
    assert.equal(failedRequests, 1);
    await d.call('Fetch.disable');
    d.unlisten(intercept);
    await d.click("document.querySelector('[data-community-form=\"reject\"] button[type=\"submit\"]')");
    await d.wait("!document.querySelector('[data-community-form=\"reject\"]')&&!document.querySelector('[data-review-row]')", 'manual retry completes rejection');
  });
  await run(async d => {
    const failedResponses = [];
    d.listen(event => {
      const message = JSON.parse(event.data);
      if (message.method !== 'Network.responseReceived') return;
      const response = message.params.response;
      if (response.url.startsWith(origin + '/') && response.status >= 400)
        failedResponses.push({ url: response.url.slice(origin.length), status: response.status });
    });
    await d.call('Network.enable');
    await d.selectRole(origin, 'owner');
    await d.navigate(origin + '/#/community/manage');
    await d.wait("document.querySelector('[data-community=\"manage\"][data-tab=\"queue\"] .community-management-body')&&!document.querySelector('[data-community-pending-route]')", 'owner navigation ready');
    const links = await d.evaluate("[...document.querySelectorAll('.community-management-nav nav>a')].map(link=>({href:link.getAttribute('href'),label:link.textContent.trim()}))");
    assert.equal(links.length, 12, 'all original owner modules remain available except the duplicate posts menu');
    await d.evaluate("window.savedCommunitySidebar=document.querySelector('.community-management-nav')");
    for (const link of links) {
      const tab = link.href.split('/')[3] || 'queue';
      await d.click(`document.querySelector('.community-management-nav a[href="${link.href}"]')`);
      await d.wait(`document.querySelector('[data-community="manage"][data-tab="${tab}"] .community-management-body')&&!document.querySelector('[data-community-pending-route]')`, link.label + ' loaded');
      assert.equal(await d.evaluate("document.querySelector('.community-management-nav')===window.savedCommunitySidebar"), true, link.label + ' retains the sidebar');
      assert.equal(await d.evaluate("!!document.querySelector('.community-management-nav a[aria-current=\"page\"]')"), true, link.label + ' selected menu');
      const content = await d.evaluate("document.querySelector('.community-management-body').innerText");
      assert.ok(content.trim(), link.label + ' has a visible result');
      assert.doesNotMatch(content, /服务器错误|没有权限|加载失败|没有这个分类/, link.label + ' is a functioning module');
      await d.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await d.wait("document.documentElement.scrollWidth<=innerWidth+1", link.label + ' mobile page fits');
      await d.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    }
    assert.deepEqual(failedResponses, [], 'all management pages load without failed local requests');
  });
  await run(async d => {
    await d.selectRole(origin, 'general');
    await d.navigate(origin + '/#/community/u/10009');
    await d.wait("document.querySelector('.community-m-name h1 .community-uname')", 'profile cover loaded');
    const snapshot = `(()=>{const title=document.querySelector('.community-m-name h1 .community-uname'); const box=title.getBoundingClientRect(); return {color:getComputedStyle(title).color,box:[box.x,box.y,box.width,box.height],cover:document.querySelector('.community-m-cover').outerHTML,icon:document.querySelector('.community-m-name [data-name-icon]')?.dataset.nameIcon,scroll:[scrollX,scrollY]}})()`;
    await d.evaluate("window.savedProfileTitle=document.querySelector('.community-m-name h1 .community-uname')");
    const light = await d.evaluate(snapshot);
    await d.screenshot('community-profile-theme-light.png');
    await d.click("document.querySelector('.community-appearance-toggle')");
    await d.wait("document.body.dataset.communityTheme==='dark'", 'dark profile theme');
    const dark = await d.evaluate(snapshot);
    assert.equal(light.color, 'rgb(255, 255, 255)', 'the original dark profile cover uses white nickname ink in light mode');
    assert.equal(dark.color, light.color, 'unchanged dark artwork keeps the same readable nickname when the theme changes');
    assert.deepEqual(light.box, dark.box);
    assert.equal(light.cover, dark.cover);
    assert.ok(light.icon && light.icon === dark.icon, 'equipped staff icon is retained');
    assert.deepEqual(light.scroll, dark.scroll);
    await d.screenshot('community-profile-theme-dark.png');
    await d.click("document.querySelector('.community-appearance-toggle')");
    await d.wait("document.body.dataset.communityTheme==='light'", 'light profile theme restored');
    assert.deepEqual(await d.evaluate(snapshot), light);
    assert.equal(await d.evaluate("document.querySelector('.community-m-name h1 .community-uname')===window.savedProfileTitle"), true);
    await d.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await d.wait("document.documentElement.scrollWidth<=innerWidth+1", 'profile mobile fits');
    await d.screenshot('community-profile-theme-mobile.png');
  });
  assert.deepEqual(errors, [], 'no uncaught browser errors');
});
