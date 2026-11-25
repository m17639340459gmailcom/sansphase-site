import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import sharp from 'sharp';
import { communityMemberHTML } from '../src/community-pages.ts';
import { composeCommunityStyles } from '../scripts/compose-community-styles.mjs';
import { composeSiteStyles } from '../scripts/compose-site-styles.mjs';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const enabled = process.env.COMMUNITY_PROFILE_THEME_BROWSER === '1';
const browser = process.env.TEST_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const variants = [
  {}, { role: 'owner' }, { color: 'gold' }, { color: 'aurora' },
  { nameEffect: { style: 'solid', colors: ['#FFFFFF'] } },
  { nameEffect: { style: 'gradient', colors: ['#FF0000', '#0000FF'] } },
  { nameEffect: { style: 'shimmer', colors: ['#8FE3C8', '#C9B6F2'] } },
];
const whiteCover = '/api/community/profile/background/00000000-0000-4000-8000-000000000001.webp';
const blackCover = '/api/community/profile/background/00000000-0000-4000-8000-000000000002.webp';
const backgrounds = [{}, { cover: 'aurora' }, { background: { url: whiteCover } }, { background: { url: blackCover } }];
const clientSource = `export {createCommunityAppearance} from './src/community-layout/appearance.ts'; export {createCommunityProfileContrast} from './src/community-profile-contrast.ts';`;
const clientBundle = async () => (await build({ stdin: { contents: clientSource, resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false })).outputFiles[0].text;
const clientBootstrap = `import {createCommunityAppearance,createCommunityProfileContrast} from '/appearance.js'; const appearance=createCommunityAppearance(document,window);appearance.sync(true);const contrast=createCommunityProfileContrast(document,window);contrast.sync(document);window.toggleTestTheme=()=>appearance.toggle();window.profileContrast=contrast;`;
test('profile nicknames adapt to the actual cover in both themes without altering cover pixels', { skip: !enabled, timeout: 60000 }, async () => {
  const css = (await composeSiteStyles()).toString() + '\n' + await composeCommunityStyles();
  const client = await clientBundle();
  const images = new Map(await Promise.all([[whiteCover, '#fff'], [blackCover, '#000']].map(async ([url, background]) => [url, await sharp({ create: { width: 8, height: 8, channels: 3, background } }).webp({ lossless: true }).toBuffer()])));
  const profiles = backgrounds.flatMap(background => variants.map(variant => communityMemberHTML({ ...common, member: { state: 'ready', data: {
    person: { name: '清晰昵称', uid: '10001', role: 'reader', showUid: true, ...variant }, bio: '个人主页的介绍与签名', joinedAt: '2026-09-01T00:00:00Z', self: true, streak: 2,
    stats: {}, follows: {}, badges: [], topics: [], replies: [], bookmarks: [], counts: {}, tab: 'topics', ...background,
  } } }))).join('');
  const server = createServer((req, res) => {
    if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else if (req.url === '/appearance.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(client); }
    else if (images.has(req.url)) { res.setHeader('Content-Type', 'image/webp'); res.end(images.get(req.url)); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><body class="community-open community-frame-open"><main>${profiles}</main><script type="module">${clientBootstrap}</script>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const pixelChecks = [];
    const verifyCoverPixels = async socket => {
      let sequence = 200;
      const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const receive = event => {
          const message = JSON.parse(event.data);
          if (message.id !== id) return;
          socket.removeEventListener('message', receive);
          if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
          else resolve(message.result);
        };
        socket.addEventListener('message', receive);
        socket.send(JSON.stringify({ id, method, params }));
      });
      const evaluate = async expression => (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
      const screenshot = async clip => Buffer.from((await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } })).data, 'base64');
      await call('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
      await evaluate(`(async()=>{for(let i=0;i<100&&!window.toggleTestTheme;i++)await new Promise(r=>setTimeout(r,30));await document.fonts.ready;await Promise.all([...document.querySelectorAll('.community-m-cover img')].map(image=>image.decode()));const style=document.createElement('style');style.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.append(style);window.profileContrast.sync(document);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);})()`);
      for (const theme of ['light', 'dark']) {
        const clips = await evaluate(`([0,7,14,21].map(index=>{const rect=document.querySelectorAll('.community-m-intro')[index].getBoundingClientRect();return{x:Math.ceil(rect.right-16),y:Math.ceil(rect.top+scrollY+8),width:8,height:Math.floor(rect.height-16)};}))`);
        const actual = [];
        for (const clip of clips) actual.push(await screenshot(clip));
        // Compare empty artwork beside the name with the same frame stripped of
        // profile wrapper paint. The original cover and its own decorations stay.
        await evaluate(`(()=>{const style=document.createElement('style');style.id='profile-pixel-reference';style.textContent='.community-m-intro,.community-m-id,.community-m-name{background:none!important;filter:none!important;backdrop-filter:none!important;opacity:1!important;mix-blend-mode:normal!important}.community-m-intro::before,.community-m-intro::after,.community-m-id::before,.community-m-id::after,.community-m-name::before,.community-m-name::after{content:none!important}';document.head.append(style);})()`);
        for (let i = 0; i < clips.length; i++) {
          const reference = await screenshot(clips[i]);
          const expected = await sharp(reference).removeAlpha().raw().toBuffer();
          const rendered = await sharp(actual[i]).removeAlpha().raw().toBuffer();
          assert.equal(rendered.length, expected.length, 'the artwork sample dimensions stay unchanged');
          pixelChecks.push({ theme, cover: i, maximum: rendered.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - expected[index])), 0) });
        }
        await evaluate(`document.querySelector('#profile-pixel-reference').remove()`);
        for (const [name, index] of [['gold', 2], ['gradient', 5]]) {
          const clip = await evaluate(`(()=>{const rect=document.querySelectorAll('.community-m-intro')[${index}].getBoundingClientRect();return{x:Math.ceil(rect.left),y:Math.ceil(rect.top+scrollY),width:Math.floor(rect.width),height:Math.floor(rect.height)};})()`);
          await writeFile(`.local/profile-cover-theme-${theme}-${name}.png`, await screenshot(clip));
        }
        await evaluate(`(async()=>{window.toggleTestTheme();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);})()`);
      }
    };
    const check = async () => {
      for (let i = 0; i < 100 && !window.toggleTestTheme; i++) await new Promise(resolve => setTimeout(resolve, 30));
      const nodes = [...document.querySelectorAll('.community-m-name .community-uname')];
      const capture = () => nodes.map(node => {
        const style = getComputedStyle(node), intro = node.closest('.community-m-intro'), cover = intro.querySelector('.community-m-cover');
        const rect = node.getBoundingClientRect();
        const paint = (element, pseudo) => { const computed = getComputedStyle(element, pseudo); return { element: element.className, pseudo: pseudo || '', content: computed.content, image: computed.backgroundImage, background: computed.backgroundColor, filter: computed.filter, backdropFilter: computed.backdropFilter, opacity: computed.opacity, blend: computed.mixBlendMode }; };
        return { color: style.color, image: style.backgroundImage, fill: style.webkitTextFillColor, strokeWidth: style.webkitTextStrokeWidth, shadow: style.textShadow, clip: style.backgroundClip,
          wrappers: [intro, ...intro.querySelectorAll('.community-m-id, .community-m-name')].flatMap(element => [undefined, '::before', '::after'].map(pseudo => paint(element, pseudo))),
          body: [...intro.querySelectorAll('.community-m-name p, .community-m-tags .is-mono')].map(element => ({ text: element.textContent, shadow: getComputedStyle(element).textShadow })),
          inkStart: style.getPropertyValue('--name-ink-start').trim(), inkEnd: style.getPropertyValue('--name-ink-end').trim(),
          geometry: [rect.left, rect.top + scrollY, rect.width, rect.height],
          cover: cover.outerHTML, coverClass: cover.className, coverImage: cover.querySelector('img')?.getAttribute('src') || '', coverLoaded: Boolean(cover.querySelector('img')?.naturalWidth), text: node.textContent };
      });
      const light = capture(); window.toggleTestTheme(); await new Promise(requestAnimationFrame); const dark = capture();
      window.toggleTestTheme(); await new Promise(requestAnimationFrame); const again = capture();
      return { light, dark, again, coverImageCount: document.querySelectorAll('.community-m-cover > img').length, retained: [...document.querySelectorAll('.community-m-name .community-uname')].every((node, i) => node === nodes[i]) };
    };
    const result = await evaluateInWebGLBrowser(browser, `(${check.toString()})()`, `http://127.0.0.1:${server.address().port}/`, verifyCoverPixels);
    assert.equal(result.light.length, 28);
    assert.equal(result.coverImageCount, 14, 'all seven variants use a real uploaded image for both white and black covers');
    assert.equal(result.retained, true, 'theme changes do not recreate nicknames');
    for (let i = 0; i < result.light.length; i++) {
      const light = result.light[i], dark = result.dark[i];
      if (i >= variants.length * 2) {
        assert.equal(light.coverImage, i < variants.length * 3 ? whiteCover : blackCover, 'uploaded image fixtures survive the production URL validator');
        assert.equal(light.coverLoaded, true, 'the uploaded background is decoded before checking its pixels');
      } else assert.match(light.coverClass, i < variants.length ? /is-default-cover/ : /is-cover-aurora/, 'each cover fixture uses its actual intended rendering path');
      const expected = i >= variants.length * 2 && i < variants.length * 3 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
      for (const sample of [light, dark]) {
        assert.equal(sample.color, expected, `profile ${i} adapts to the cover, independent of site theme`);
        assert.equal(sample.fill, expected, 'cover contrast overrides legacy transparent nickname effects');
        assert.equal(sample.image, 'none', 'the cover nickname has a readable solid fill');
      }
      assert.deepEqual(light, result.again[i], 'switching back restores appearance and geometry');
      assert.deepEqual(light.geometry, dark.geometry, 'theme switch does not move the name');
      assert.equal(light.cover, dark.cover, 'the original cover is never replaced');
      for (const sample of [light, dark]) {
        for (const wrapper of sample.wrappers) {
          const label = `profile ${i} ${wrapper.element}${wrapper.pseudo}`;
          assert.equal(wrapper.image, 'none', `${label} must not paint over the cover`);
          assert.equal(wrapper.background, 'rgba(0, 0, 0, 0)', `${label} has no background plate`);
          assert.equal(wrapper.filter, 'none', `${label} does not filter the artwork`);
          assert.equal(wrapper.backdropFilter, 'none', `${label} does not blur the artwork`);
          assert.equal(wrapper.opacity, '1', `${label} does not change artwork opacity`);
          assert.equal(wrapper.blend, 'normal', `${label} does not blend the artwork`);
        }
        assert.equal(sample.strokeWidth, '0px', 'nicknames have no outline');
        assert.equal(sample.shadow, 'none', 'nicknames have no added shadow');
        assert.ok(sample.body.length >= 3, 'UID and profile descriptions are included');
        for (const body of sample.body) {
          assert.equal(body.shadow, 'none', `${body.text} has no extra outline or shadow`);
        }
      }
    }
    assert.equal(pixelChecks.length, 8, 'each cover is pixel checked in both themes');
    // Repainting layered CSS gradients may round an 8-bit channel by two; uploaded solid
    // artwork must match exactly. A translucent plate would exceed this by far.
    for (const sample of pixelChecks) assert.ok(sample.maximum <= (sample.cover < 2 ? 2 : 0), `${sample.theme} cover ${sample.cover}: empty artwork beside the name stays unchanged without profile wrapper paint (largest channel difference ${sample.maximum})`);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('cover ink samples the nickname location, reacts to crop and image changes, and handles transparent or failed artwork', { skip: !enabled, timeout: 60000 }, async () => {
  const css = (await composeSiteStyles()).toString() + '\n' + await composeCommunityStyles();
  const client = await clientBundle();
  const splitCover = '/api/community/profile/background/00000000-0000-4000-8000-000000000003.webp';
  const clearCover = '/api/community/profile/background/00000000-0000-4000-8000-000000000004.webp';
  const failedCover = '/api/community/profile/background/00000000-0000-4000-8000-000000000005.webp';
  const delayedCover = '/api/community/profile/background/00000000-0000-4000-8000-000000000006.jpg';
  const image = background => sharp({ create: { width: 1600, height: 400, channels: 4, background } });
  // Most of this cover is white, but the desktop nickname sits on its dark left
  // section. A narrow viewport crops that section away with object-fit: cover.
  const darkSection = await sharp({ create: { width: 520, height: 400, channels: 4, background: '#000' } }).png().toBuffer();
  const images = new Map([
    [splitCover, await image('#fff').composite([{ input: darkSection, left: 0, top: 0 }]).webp({ lossless: true }).toBuffer()],
    [clearCover, await image('#0000').webp({ lossless: true }).toBuffer()],
    [whiteCover, await image('#fff').webp({ lossless: true }).toBuffer()],
  ]);
  const progressiveImage = await image('#fff').jpeg({ progressive: true }).toBuffer();
  let pendingImage;
  const profiles = [splitCover, clearCover, failedCover].map(url => communityMemberHTML({ ...common, member: { state: 'ready', data: {
    person: { name: '清晰昵称', uid: '10001', role: 'reader', showUid: true }, bio: '同一张封面在不同宽度下裁切', joinedAt: '2026-09-01T00:00:00Z', self: true, streak: 2,
    stats: {}, follows: {}, badges: [], topics: [], replies: [], bookmarks: [], counts: {}, tab: 'topics', background: { url },
  } } })).join('');
  const server = createServer((req, res) => {
    if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else if (req.url === '/appearance.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(client); }
    else if (req.url === delayedCover) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', progressiveImage.length);
      pendingImage = res;
      // The decoder receives image dimensions and scan data, but the transfer
      // remains incomplete until the test explicitly sends its final bytes.
      res.write(progressiveImage.subarray(0, -2));
    }
    else if (req.url === '/finish-test-image') { pendingImage?.end(progressiveImage.subarray(-2)); res.end('ok'); }
    else if (images.has(req.url)) { res.setHeader('Content-Type', 'image/webp'); res.end(images.get(req.url)); }
    else if (req.url === failedCover) { res.statusCode = 404; res.end(); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><body class="community-open community-frame-open"><main>${profiles}</main><script type="module">window.coverPixelReads=0;const getImageData=CanvasRenderingContext2D.prototype.getImageData;CanvasRenderingContext2D.prototype.getImageData=function(...args){window.coverPixelReads++;return getImageData.apply(this,args)};${clientBootstrap}</script>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const check = async () => {
      const frame = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
      for (let i = 0; i < 100 && !window.profileContrast; i++) await new Promise(resolve => setTimeout(resolve, 30));
      await document.fonts.ready;
      await Promise.all([...document.querySelectorAll('.community-m-cover img')].map(image => image.decode().catch(() => {})));
      const profiles = [...document.querySelectorAll('.community-member')];
      const names = profiles.map(profile => profile.querySelector('.community-m-name h1 .community-uname'));
      const image = profiles[0].querySelector('.community-m-cover img');
      const cover = image.parentElement;
      const snapshot = () => names.map(name => getComputedStyle(name).color);
      const style = document.createElement('style');
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
      document.head.append(style);
      profiles[0].style.width = '1000px';
      window.profileContrast.sync(document);
      await frame();
      const originalCover = cover.outerHTML;
      const light = snapshot();
      window.toggleTestTheme(); await frame();
      const dark = snapshot();
      profiles[0].style.width = '358px'; await frame();
      const narrow = snapshot();
      profiles[0].style.width = '1000px'; await frame();
      const wideAgain = snapshot();
      const unchangedCover = cover.outerHTML === originalCover;
      const readsBefore = window.coverPixelReads;
      for (let i = 0; i < 10; i++) {
        window.profileContrast.sync(document);
        window.dispatchEvent(new Event('scroll'));
      }
      await frame();
      const unchangedReads = window.coverPixelReads === readsBefore;
      // A new image loaded into the same DOM element must invalidate old samples.
      image.src = '/api/community/profile/background/00000000-0000-4000-8000-000000000006.jpg';
      for (let i = 0; i < 100 && !image.naturalWidth; i++) await new Promise(resolve => setTimeout(resolve, 10));
      window.profileContrast.sync(document); await frame();
      const incomplete = { width: image.naturalWidth, complete: image.complete, color: snapshot()[0] };
      await fetch('/finish-test-image');
      await image.decode(); await frame();
      const replacement = snapshot();
      const removedImage = profiles[1].querySelector('.community-m-cover img');
      profiles[1].remove();
      window.profileContrast.sync(document);
      const readsAfterRemoval = window.coverPixelReads;
      removedImage.src = '/api/community/profile/background/00000000-0000-4000-8000-000000000001.webp';
      await removedImage.decode(); await frame();
      const retiredReads = window.coverPixelReads === readsAfterRemoval;
      const readsAtDispose = window.coverPixelReads;
      window.profileContrast.dispose();
      image.src = '/api/community/profile/background/00000000-0000-4000-8000-000000000003.webp';
      await image.decode();
      window.profileContrast.sync(document); await frame();
      return { light, dark, narrow, wideAgain, incomplete, replacement, unchangedCover, unchangedReads, retiredReads,
        disposedReads: window.coverPixelReads === readsAtDispose,
        disposedInk: snapshot()[0], nodesRetained: profiles.every((profile, i) => profile.querySelector('.community-m-name h1 .community-uname') === names[i]),
        failedImage: profiles[2].querySelector('img').naturalWidth === 0 };
    };
    const result = await evaluateInWebGLBrowser(browser, `(${check.toString()})()`, `http://127.0.0.1:${server.address().port}/`);
    assert.deepEqual(result.light, ['rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)'], 'dark local region needs white; transparent and failed covers use the light card underneath');
    assert.deepEqual(result.dark, ['rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)'], 'transparent and failed covers follow the actual dark card after a theme switch');
    assert.equal(result.narrow[0], 'rgb(0, 0, 0)', 'center cropping on narrow cards exposes white under the name');
    assert.equal(result.wideAgain[0], 'rgb(255, 255, 255)', 'resizing back exposes the original dark name area');
    assert.equal(result.incomplete.complete, false, 'the delayed image is tested before its transfer finishes');
    assert.ok(result.incomplete.width > 0, 'the decoder already knows the image size while the transfer is still incomplete');
    assert.equal(result.incomplete.color, 'rgb(255, 255, 255)', 'incomplete images use the current card fallback');
    assert.equal(result.replacement[0], 'rgb(0, 0, 0)', 'a load event on the same image node recalculates contrast');
    assert.equal(result.unchangedCover, true, 'crop-aware contrast never changes the cover DOM');
    assert.equal(result.unchangedReads, true, 'repeated sync and scrolling do not resample unchanged artwork');
    assert.equal(result.nodesRetained, true, 'contrast updates do not rebuild nickname DOM');
    assert.equal(result.failedImage, true, 'the failure fixture is actually an unavailable image');
    assert.equal(result.retiredReads, true, 'a page removed during navigation no longer responds to image loads');
    assert.equal(result.disposedReads, true, 'disposing the page removes image/resize work');
    assert.equal(result.disposedInk, result.replacement[0], 'a disposed controller leaves the previous DOM untouched');
  } finally { pendingImage?.destroy(); await new Promise(resolve => server.close(resolve)); }
});
