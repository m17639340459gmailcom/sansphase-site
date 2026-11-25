import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { communityMemberHTML } from '../src/community-pages.ts';
import { composeCommunityStyles } from '../scripts/compose-community-styles.mjs';
import { composeSiteStyles } from '../scripts/compose-site-styles.mjs';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

test('profile nickname keeps Song display type without preferring partial Heavy CJK fonts', async () => {
  const css = postcss.parse(await readFile(new URL('../src/community.css', import.meta.url), 'utf8'));
  let family;
  css.walkRules('.community-m-name h1', rule => rule.walkDecls('font-family', declaration => { family = declaration.value; }));
  assert.equal(family, 'var(--font-wordmark)', 'reuse the existing complete Song-family stack for mixed simplified/traditional nicknames');
  const foundation = postcss.parse(await readFile(new URL('../src/styles-foundation.css', import.meta.url), 'utf8'));
  let stack;
  foundation.walkDecls('--font-wordmark', declaration => { stack = declaration.value; });
  assert.match(stack, /^"SimSun", "Songti SC", "STSong",/);
  assert.doesNotMatch(stack, /Source Han Serif/);
});

test('profile 無相 glyphs use the same actual font across themes and viewport widths', {
  skip: process.env.COMMUNITY_PROFILE_FONT_BROWSER !== '1', timeout: 60000,
}, async t => {
  const css = (await composeSiteStyles()).toString() + '\n' + await composeCommunityStyles();
  const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
  const markup = communityMemberHTML({ ...common, member: { state: 'ready', data: {
    person: { name: '無相', uid: '10001', role: 'reader' }, bio: '', joinedAt: null, self: true, streak: 0,
    stats: {}, follows: {}, badges: [], topics: [], replies: [], bookmarks: [], counts: {}, tab: 'topics',
  } } });
  const samples = [];
  const inspectFonts = async socket => {
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
    await call('DOM.enable');
    await call('CSS.enable');
    await evaluate(`(async()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);document.body.className='community-open community-frame-open';document.body.innerHTML=${JSON.stringify(markup)};const name=document.querySelector('.community-m-name h1 .community-uname');name.replaceChildren(...[...name.textContent].map((glyph,index)=>{const span=document.createElement('span');span.dataset.fontGlyph=String(index);span.textContent=glyph;return span;}));await document.fonts.ready;})()`);
    for (const width of [1365, 390]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const theme of ['light', 'dark']) {
        await evaluate(`(async()=>{document.body.dataset.communityTheme='${theme}';await new Promise(requestAnimationFrame);})()`);
        const { root } = await call('DOM.getDocument');
        const fonts = [];
        for (const glyph of [0, 1]) {
          const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-font-glyph="${glyph}"]` });
          fonts.push((await call('CSS.getPlatformFontsForNode', { nodeId })).fonts.filter(font => font.glyphCount > 0).map(({ familyName, postScriptName }) => ({ familyName, postScriptName })));
        }
        const style = await evaluate(`(()=>{const style=getComputedStyle(document.querySelector('.community-m-name h1 .community-uname'));return{family:style.fontFamily,weight:style.fontWeight,size:style.fontSize,spacing:style.letterSpacing};})()`);
        samples.push({ width, theme, fonts, style });
      }
    }
  };
  await evaluateInWebGLBrowser(process.env.TEST_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'true', 'about:blank', inspectFonts);
  t.diagnostic(JSON.stringify(samples));
  for (const sample of samples) {
    assert.equal(sample.fonts[0].length, 1, 'traditional 無 must render from one font');
    assert.deepEqual(sample.fonts[0], sample.fonts[1], `無 and 相 must use the same actual font (${sample.width}px ${sample.theme})`);
    assert.equal(sample.style.size, '28px');
    assert.match(sample.style.family, /^SimSun,/);
  }
  assert.deepEqual(samples[0].style, samples[1].style, 'theme switching does not change nickname typography');
  assert.deepEqual(samples[2].style, samples[3].style, 'mobile theme switching does not change nickname typography');
});
