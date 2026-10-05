import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { composeCommunityStyles } from '../../scripts/compose-community-styles.mjs';
import { createFrameThreadSidebar } from '../../src/community-layout/frame-thread-sidebar.ts';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string) => { window: Window };
};

for (const theme of ['dark', 'light']) {
  for (const locked of [false, true]) {
    test(`${theme} post support cards keep their appearance and controls when moving between columns (${locked ? 'locked' : 'public'} prompt)`, async () => {
      const surface = theme === 'light' ? '#e9e4d9' : '#192b43';
      // JSDOM does not resolve inherited custom properties. Resolve the relevant
      // palette tokens; the production selector cascade remains unchanged.
      const css = (await composeCommunityStyles())
        .replaceAll('var(--community-reading-edge-strong, var(--line))', '#bca783')
        .replaceAll('var(--community-reading-edge-strong)', '#bca783')
        .replaceAll('var(--community-reading-control, #0b1018)', surface)
        .replaceAll('var(--community-reading-control)', surface)
        .replaceAll('var(--line-strong)', '#788ba6')
        .replaceAll('var(--line)', '#485b75');
      const { window } = new JSDOM(`<style>${css}</style><body class="community-open community-frame-open" data-community-theme="${theme}">
        <main class="page community-page" data-community-frame="stable"><div class="community-layout">
          <div class="community-frame-center"><div data-frame-route>
            <section class="community-page" data-community="post" data-thread-design="feed"><div class="community-post-grid">
              <article class="community-thread"><textarea>未发送的草稿</textarea></article>
              <aside class="community-post-side"><section class="community-card">
                <dl class="community-mini-stats"><div><dt>帖子</dt><dd>3</dd></div></dl>
                <section class="community-prompt${locked ? ' is-locked' : ''}"><button type="button" data-action="community-unlock">${locked ? '解锁' : '复制'}</button><pre>提示词</pre></section>
                <ul class="community-related"><li><a href="#/post/related">相关帖子</a></li></ul>
              </section></aside>
            </div></section>
          </div></div><aside data-frame-right></aside>
        </div></main>
      </body>`);
      const doc = window.document;
      const route = doc.querySelector<HTMLElement>('[data-frame-route]')!;
      const right = doc.querySelector<HTMLElement>('[data-frame-right]')!;
      const controller = createFrameThreadSidebar(route, right);
      const side = doc.querySelector<HTMLElement>('.community-post-side')!;
      const prompt = side.querySelector<HTMLElement>('.community-prompt')!;
      const control = prompt.querySelector<HTMLButtonElement>('button')!;
      const stats = side.querySelector<HTMLElement>('.community-mini-stats')!;
      const item = side.querySelector<HTMLLIElement>('.community-related li')!;
      const link = item.querySelector<HTMLAnchorElement>('a')!;
      let clicks = 0;
      control.addEventListener('click', () => { clicks++; });
      try {
        for (const collapsed of [false, true, false]) {
          control.focus();
          controller.sync(true, collapsed);
          assert.equal(side.parentElement, collapsed ? route.querySelector('.community-post-grid') : right);
          assert.equal(doc.activeElement, control, 'moving the live control retains focus');
          control.click();
          assert.equal(window.getComputedStyle(stats).borderTopWidth, '0px');
          assert.equal(window.getComputedStyle(stats).borderBottomWidth, '0px');
          const statistics = window.getComputedStyle(stats);
          assert.equal(statistics.paddingBlock || statistics.paddingTop, '12px');
          assert.equal(statistics.paddingBlock || statistics.paddingBottom, '12px');
          const appearance = window.getComputedStyle(prompt);
          assert.equal(appearance.borderRadius, '10px');
          assert.equal(appearance.borderTopStyle, locked ? 'dashed' : 'solid');
          assert.equal(appearance.borderTopColor, 'rgb(188, 167, 131)');
          assert.equal(appearance.backgroundColor, theme === 'light' ? 'rgb(233, 228, 217)' : 'rgb(25, 43, 67)');
          const related = window.getComputedStyle(item);
          assert.equal(related.paddingBlock || related.paddingTop, '12px');
          assert.equal(related.paddingBlock || related.paddingBottom, '12px');
          assert.equal(window.getComputedStyle(link).lineHeight, '1.7');
          assert.equal(link.getAttribute('href'), '#/post/related');
          assert.equal(doc.querySelector<HTMLTextAreaElement>('textarea')!.value, '未发送的草稿');
        }
        assert.equal(clicks, 3);
      } finally { controller.release(); window.close(); }
    });
  }
}
