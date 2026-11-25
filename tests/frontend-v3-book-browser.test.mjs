import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrontendIntegrationPreview } from '../scripts/preview-frontend-integration.ts';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const build = process.env.SANSPHASE_TEST_V3_BUILD;
const browser = process.env.SANSPHASE_UI_TEST_BROWSER;

test('V3 preserves bookmarks and protected illustrations, and follows the active book subsection', { skip: !build || !browser, timeout: 90000 }, async t => {
  const preview = await createFrontendIntegrationPreview({ frontend: 'v3', port: 0, buildAssets: false, v3AppDirectory: build });
  t.after(preview.close);
  const slug = preview.fixtures.slugs.vipBook;
  const overview = `/en/resources/${slug}`;
  const chapter = `${overview}/local-two`;
  const media = `/api/media/${preview.fixtures.vipIllustrationId}?view=content`;
  const signed = await fetch(`${preview.origin}/api/reader/login`, {
    method: 'POST',
    headers: { Origin: preview.origin, 'Content-Type': 'application/json', 'X-Reader-Request': '1' },
    body: JSON.stringify({ email: 'vip@example.test', password: 'DemoLogin2026!' }),
  });
  assert.equal(signed.status, 200);
  const cookie = signed.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const cookieSeparator = cookie.indexOf('=');
  const response = await fetch(`${preview.origin}/api/content?view=detail&kind=resource-center&id=${slug}`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const { item } = await response.json();
  const recordId = String(item.recordId);
  const publicDetail = await fetch(`${preview.origin}/api/content?view=detail&kind=resource-center&id=${preview.fixtures.slugs.publicBook}`, { headers: { Cookie: cookie } });
  assert.equal(publicDetail.status, 200);
  const publicRecordId = String((await publicDetail.json()).item.recordId);
  const anchor = { chapter: 'local-two', block: 'local-heading-two', offset: 0, part: 0, revision: item.book.revision, title: 'Original V2 bookmark' };
  const previous = JSON.stringify({ [recordId]: { progress: anchor, bookmarks: [anchor] } });
  const result = await evaluateInWebGLBrowser(browser, 'document.documentElement.lang', 'about:blank', async socket => {
    let id = 90;
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const current = ++id;
      const receive = event => {
        const message = JSON.parse(event.data);
        if (message.id !== current) return;
        socket.removeEventListener('message', receive);
        if (message.error || message.result?.exceptionDetails) reject(Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        else resolve(message.result);
      };
      socket.addEventListener('message', receive);
      socket.send(JSON.stringify({ id: current, method, params }));
    });
    const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    const waitFor = async expression => {
      for (let attempt = 0; attempt < 70; attempt++) {
        if (await evaluate(expression).catch(() => false)) return;
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      const page = await evaluate(`({ path: location.pathname, search: location.search, language: document.documentElement.lang, main: document.querySelector('main')?.innerText.slice(0, 400), readingLabels: [...document.querySelectorAll('article details [aria-label]')].map(element => element.getAttribute('aria-label')) })`).catch(() => null);
      assert.fail(`Browser expression did not become true: ${expression}\n${JSON.stringify(page)}`);
    };
    await call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 650, deviceScaleFactor: 1, mobile: false });
    const installed = await call('Network.setCookie', { url: preview.origin, name: cookie.slice(0, cookieSeparator), value: cookie.slice(cookieSeparator + 1), httpOnly: true, sameSite: 'Strict' });
    assert.equal(installed.success, true);
    await call('Page.navigate', { url: `${preview.origin}/__local-test` });
    await waitFor(`location.origin === ${JSON.stringify(preview.origin)} && location.pathname === '/__local-test' && !!document.querySelector('h1')`);
    await evaluate(`localStorage.setItem('sansphase-book-reading-v1', ${JSON.stringify(previous)})`);
    const snapshots = `(JSON.parse(localStorage.getItem('sansphase-book-reading-v1'))[${JSON.stringify(recordId)}])`;
    await call('Page.navigate', { url: preview.origin + overview });
    await waitFor(`location.pathname === ${JSON.stringify(overview)} && [...document.links].some(link => link.textContent === 'Continue reading')`);
    assert.equal(await evaluate(`[...document.querySelectorAll('article summary')].some(summary => summary.textContent.trim() === 'Bookmarks')`), true);
    assert.equal(await evaluate(`[...document.links].find(link => link.textContent === 'Continue reading').getAttribute('href')`), `${chapter}?block=local-heading-two&offset=0`);
    await evaluate(`[...document.links].find(link => link.textContent === 'Continue reading').click()`);
    await waitFor(`location.pathname === ${JSON.stringify(chapter)} && location.search.includes('block=local-heading-two') && !!document.querySelector('#published-book-body img[role="button"]')`);
    await waitFor(`!!document.querySelector('nav a[href$="?block=local-heading-two&offset=0"]')`);

    await evaluate(`(() => {
      const image = document.querySelector('#published-book-body img[role="button"]');
      image.focus();
      image.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('dialog[open] img')?.getAttribute('src') === ${JSON.stringify(media)}`);
    await evaluate(`document.querySelector('dialog[open]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(await evaluate(`document.querySelector('dialog[open]') === null && document.activeElement === document.querySelector('#published-book-body img[role="button"]')`), true);

    await waitFor(`!!document.querySelector('button[aria-label^="Remove bookmark"]')`);
    await evaluate(`(() => {
      const remove = document.querySelector('button[aria-label^="Remove bookmark"]');
      remove.closest('details').open = true;
      remove.click();
    })()`);
    await waitFor(`${snapshots}.bookmarks.length === 0`);
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Toggle bookmark at this position').click()`);
    await waitFor(`${snapshots}.bookmarks.length === 1 && ${snapshots}.bookmarks[0].chapter === 'local-two'`);
    await call('Page.reload');
    await waitFor(`!!document.querySelector('button[aria-label^="Remove bookmark"]')`);

    const chineseOverview = `/resources/${slug}`;
    await call('Page.navigate', { url: preview.origin + chineseOverview });
    await waitFor(`location.pathname === ${JSON.stringify(chineseOverview)} && document.documentElement.lang === 'zh-CN' && [...document.links].some(link => link.textContent === '继续上次阅读')`);
    assert.equal(await evaluate(`[...document.querySelectorAll('article summary')].some(summary => summary.textContent.trim() === '书签')`), true);

    const shortChapter = `${chineseOverview}/local-two`;
    await call('Page.navigate', { url: preview.origin + shortChapter });
    await waitFor(`location.pathname === ${JSON.stringify(shortChapter)} && !!document.querySelector('[data-book-directory]')`);
    const shortDirectory = await evaluate(`(() => {
      const pane = document.querySelector('[data-book-directory]');
      scrollTo({ top: 240, behavior: 'instant' });
      const frame = pane.getBoundingClientRect();
      return { x: frame.left + 10, y: frame.top + 20, short: pane.scrollHeight === pane.clientHeight, scrollY };
    })()`);
    assert.equal(shortDirectory.short, true, 'the short directory has no internal overflow');
    await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: shortDirectory.x, y: shortDirectory.y, deltaX: 0, deltaY: 95 });
    await waitFor(`scrollY > ${shortDirectory.scrollY}`);

    const publicChapter = `/resources/${preview.fixtures.slugs.publicBook}/local-one`;
    await call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 450, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: preview.origin + publicChapter });
    const firstSection = `document.querySelector('#published-book-body [data-book-block="local-toc-1"] h3')`;
    const lastSection = `document.querySelector('#published-book-body [data-book-block="local-toc-12"] h3')`;
    await waitFor(`location.pathname === ${JSON.stringify(publicChapter)} && !!${firstSection} && !!${lastSection}`);
    assert.equal(await evaluate(`${firstSection}.closest('[data-book-part]').dataset.bookPart`), '0');
    assert.ok(await evaluate(`Number(${lastSection}.closest('[data-book-part]').dataset.bookPart) > 0`), 'the whole chapter includes later source fragments');
    assert.equal(await evaluate(`[...document.querySelectorAll('article a')].some(link => new URL(link.href).searchParams.has('part'))`), false);
    function scrollToSubsection(index) {
      return evaluate(`(() => {
        const heading = document.querySelector('#published-book-body [data-book-block="local-toc-${index}"] h3');
        const top = scrollY + heading.getBoundingClientRect().top - 156;
        scrollTo({ top, behavior: 'instant' });
        return scrollY;
      })()`);
    }
    const chapterNav = `document.querySelector('nav a[href="${publicChapter}"][aria-current="page"]').closest('nav')`;
    const currentLink = `${chapterNav}.querySelector('[aria-current="location"]')`;
    await scrollToSubsection(2);
    assert.ok(await evaluate(`${chapterNav}.getBoundingClientRect().bottom <= innerHeight`), 'sticky directory fits in the viewport');
    await waitFor(`${currentLink}?.getAttribute('href').endsWith('?block=local-toc-2&offset=0')`);
    const beforeFollow = await scrollToSubsection(4);
    await waitFor(`${currentLink}?.getAttribute('href').endsWith('?block=local-toc-4&offset=0')`);
    assert.ok(await evaluate(`(() => {
      const pane = document.querySelector('[data-book-directory]');
      const current = ${currentLink}.getBoundingClientRect();
      const frame = pane.getBoundingClientRect();
      return pane.scrollTop > 0 && current.top >= frame.top - 1 && current.bottom <= frame.bottom + 1;
    })()`), 'the long directory scrolls internally to reveal the active subsection');
    assert.equal(await evaluate('scrollY'), beforeFollow, 'directory active-state updates do not move the document');

    await evaluate(`${chapterNav}.querySelector('a[href$="?block=local-toc-7&offset=0"]').click()`);
    await waitFor(`location.search.includes('block=local-toc-7') && !!document.querySelector('#published-book-body [data-book-block="local-toc-7"] h3') && ${currentLink}?.getAttribute('href').endsWith('?block=local-toc-7&offset=0')`);
    assert.ok(await evaluate(`!!${firstSection} && !!${lastSection}`), 'a subsection link keeps the chapter complete');

    await call('Page.navigate', { url: `${preview.origin}${publicChapter}?part=2` });
    const secondPartStart = `document.querySelector('#published-book-body [data-book-part="1"] [data-book-block]')`;
    await waitFor(`location.search === '?part=2' && Math.abs(${secondPartStart}?.getBoundingClientRect().top - 150) < 12`);
    assert.ok(await evaluate(`!!${firstSection} && !!${lastSection}`), 'a legacy part link positions the same full chapter');
    const paragraphGap = await evaluate(`getComputedStyle(${firstSection}.closest('[data-book-block]')).marginTop`);
    assert.ok(Number.parseFloat(paragraphGap) > 0, 'the reader retains spacing between its paragraphs');
    assert.equal(await evaluate(`getComputedStyle(${secondPartStart}).marginTop`), paragraphGap, 'spacing is consistent across source fragments');
    await evaluate(`[...document.querySelectorAll('article button')].find(button => button.textContent.trim() === '添加或取消当前位置的书签').click()`);
    const publicSnapshots = `JSON.parse(localStorage.getItem('sansphase-book-reading-v1'))?.[${JSON.stringify(publicRecordId)}]`;
    await waitFor(`${publicSnapshots}?.bookmarks.some(mark => mark.chapter === 'local-one' && mark.part === 1)`);

    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: true });
    await waitFor(`getComputedStyle(${chapterNav}).position === 'static' && getComputedStyle(document.querySelector('[data-book-directory]')).overflowY === 'visible'`);
  });
  assert.equal(result, 'zh-CN');
});
