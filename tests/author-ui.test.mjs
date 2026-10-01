import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM, VirtualConsole } from "jsdom";
import { validateArticle } from "../server/author-service.ts";
import { cleanBody } from "../server/content-service.ts";

test("author hub groups actions; background editing preserves profile; back navigation protects unsaved work", async () => {
  const errors = [],
    writes = [];
  const profile = {
    name: "原有作者",
    signature: "原有签名",
    bio: "原有简介",
    avatar: null,
    background: null,
    music_settings: { title: "临时歌单", playlistUrl: "https://t1.kugou.com/1bKaRccG5V3", tracks: [] },
    appearance: {accent:"blue"},
    social_links: [{ label: "主页", url: "https://example.com/" }],
  };
  const console = new VirtualConsole();
  console.on("error", (...args) => errors.push(args.map(String).join(" ")));
  console.on("jsdomError", (error) => errors.push(error.message));
  const dom = new JSDOM(
    '<header id="site-header"><button data-author-login>作者模式</button></header><main id="main"></main><div id="home-stage"></div><footer id="site-footer"></footer><script id="site-content" type="application/json">{"author":{"name":"作者"}}</script>',
    {
      url: "http://127.0.0.1:4176/#/notes",
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole: console,
    },
  );
  const w = dom.window,
    d = w.document;
  // jsdom has no layout; ProseMirror asks for Range geometry after multiline paste.
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  w.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  w.fetch = async (path, options = {}) => {
    if (path === "/api/author/profile" && options.method === "PATCH") {
      writes.push(JSON.parse(options.body));
      return { ok: true, json: async () => profile };
    }
    return {
      ok: true,
      json: async () =>
        path === "/api/author/profile"
          ? structuredClone(profile)
          : path === "/api/content"
            ? { author: { name: "作者" } }
            : [],
    };
  };
  const context = dom.getInternalVMContext(),
    modules = new Map();
  async function load(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const mod = new vm.SourceTextModule(readFileSync(url, "utf8"), {
      context,
      identifier: url.href,
    });
    modules.set(url.href, mod);
    await mod.link((specifier) => load(new URL(specifier, url)));
    return mod;
  }
  const click = (selector) => {
    assert(d.querySelector(selector), selector);
    d.querySelector(selector).click();
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const escape = (options={}) => (d.activeElement || d).dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,...options}));
  try {
    await (
      await load(new URL("../dist/author.bundle.mjs", import.meta.url))
    ).evaluate();
    click("[data-author-login]");
    await settle();
    assert.equal(
      d.querySelector("#author-dialog-title").textContent,
      "作者模式",
    );
    for (const kind of [
      "articles",
      "works",
      "resources",
      "software",
      "resource-center",
      "announcements",
      "profile",
      "background",
      "music",
      "appearance",
      "admin",
    ])
      assert(d.querySelector(`[data-author-open="${kind}"]`), kind);
    click('.author-dialog-backdrop');
    assert.notEqual(d.querySelector('#author-dialog').getAttribute('aria-hidden'),'true','outside clicks keep the hub open');
    escape();await settle();
    assert.equal(d.querySelector('#author-dialog-title').textContent,'作者模式','Escape at the hub never exits the author panel');
    for(const section of ['articles','works','resources','software','resource-center','announcements','profile','background','music','appearance']){
      click(`[data-author-open="${section}"]`);await settle();
      const heading=d.querySelector('#author-dialog-title').textContent;
      click('.author-dialog-backdrop');click('.author-panel');
      assert.notEqual(d.querySelector('#author-dialog').getAttribute('aria-hidden'),'true');
      assert.equal(d.querySelector('#author-dialog-title').textContent,heading,'blank clicks preserve the current author screen');
      if(['articles','works','resources','software','resource-center','announcements'].includes(section)){
        click('[data-new]');await settle();
        click('.author-dialog-backdrop');
        escape();await settle();
        assert.equal(d.querySelector('#author-dialog-title').textContent,heading,'Escape from an editor returns to its own list');
      }
      escape();await settle();assert.equal(d.querySelector('#author-dialog-title').textContent,'作者模式');
    }
    click('[data-author-open="articles"]');await settle();click('[data-new]');await settle();
    const unsavedTitle=d.querySelector('[name="title"]');unsavedTitle.value='不能丢失的编辑';unsavedTitle.focus();unsavedTitle.dispatchEvent(new w.Event('input',{bubbles:true}));
    click('.author-dialog-backdrop');assert(d.querySelector('.author-discard').hidden,'outside clicks do not request leaving even when dirty');
    escape({repeat:true});assert(d.querySelector('.author-discard').hidden,'held Escape does not advance screens');
    escape();assert.equal(d.querySelector('.author-discard').hidden,false);
    assert(d.querySelector('#author-dialog-content').hasAttribute('inert'),'confirmation blocks background edits');
    d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
    assert(d.activeElement.hasAttribute('data-discard'));
    d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
    assert(d.activeElement.hasAttribute('data-keep-editing'),'Tab stays inside the warning');
    d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
    assert(d.activeElement.hasAttribute('data-discard'),'Shift+Tab also stays inside the warning');
    escape();assert(d.querySelector('.author-discard').hidden,'Escape dismisses the warning and keeps editing');
    assert.equal(d.querySelector('[name="title"]').value,'不能丢失的编辑');
    assert.equal(d.activeElement,unsavedTitle,'dismissing the warning restores editor focus');
    assert(!d.querySelector('#author-dialog-content').hasAttribute('inert'));
    escape();click('[data-discard]');await settle();
    assert.equal(d.querySelector('#author-dialog-title').textContent,'博客文章','discard after Escape returns one level instead of closing');
    assert.notEqual(d.querySelector('#author-dialog').getAttribute('aria-hidden'),'true');
    escape();await settle();
    click('[data-author-open="background"]');
    await settle();
    assert.equal(
      d.querySelector("#author-dialog-title").textContent,
      "博客背景",
    );
    assert(d.querySelector('.author-background-gallery'));
    assert(d.querySelector('[data-upload="background"]'));
    click('[data-author-back]'); await settle();
    click('[data-author-open="profile"]'); await settle();
    const signature=d.querySelector('[name="signature"]');
    signature.dispatchEvent(new w.Event('input',{bubbles:true}));
    click('[data-author-back]');
    assert.equal(d.querySelector('.author-discard').hidden,false);
    click('[data-keep-editing]');
    d.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await settle();
    assert.deepEqual(writes[0].music_settings,profile.music_settings);
    assert.equal(writes[0].signature,profile.signature);
    click('[data-author-back]'); await settle();
    click('[data-author-open="appearance"]'); await settle();
    assert(d.querySelector('.react-colorful'));
    const choose=(text)=>[...d.querySelectorAll('.author-color-targets button')].find(b=>b.textContent===text).click();
    const swatch=(text)=>d.querySelector(`[aria-label="预设颜色：${text}"]`).click();
    swatch('浅玫红'); await settle();
    const concentration = (label,number) => {
      const input=d.querySelector(`[aria-label="${label}"]`);
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,String(number));
      input.dispatchEvent(new w.Event('input',{bubbles:true}));
    };
    concentration('文字与图标浓度',72); await settle();
    choose('卡片底色'); await settle();
    const hue=d.querySelector('[aria-label="调色色相"]');
    hue.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',keyCode:39,bubbles:true}));
    await settle();
    assert(d.querySelector('.glass-preview-card'));
    choose('卡片边框'); await settle(); swatch('薄荷'); await settle();
    concentration('卡片边框浓度',21); await settle();
    choose('文字与图标'); await settle();
    assert.equal(d.querySelector('[aria-label="文字与图标浓度"]').value,'72');
    assert.equal(d.querySelector('[aria-label="颜色代码"]').value,'#f4b8c8');
    assert.equal(d.querySelectorAll('.react-colorful').length,1);
    choose('文章正文'); await settle(); swatch('月白'); await settle();
    concentration('文章正文浓度',80); await settle();
    choose('阅读区底色'); await settle(); swatch('深空蓝'); await settle();
    concentration('阅读区底色浓度',75); await settle();
    d.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await settle();
    assert.match(writes.at(-1).appearance.cardColor,/^#[0-9a-f]{6}$/i);
    assert.equal(writes.at(-1).appearance.cardOpacity,.08);
    assert.equal(writes.at(-1).appearance.accentColor,'#f4b8c8');
    assert.equal(writes.at(-1).appearance.cardBorderColor,'#afe5d7');
    assert.equal(writes.at(-1).appearance.accentOpacity,.72);
    assert.equal(writes.at(-1).appearance.cardBorderOpacity,.21);
    assert.equal(writes.at(-1).appearance.articleTextColor,'#eff6ff');
    assert.equal(writes.at(-1).appearance.articleTextOpacity,.8);
    assert.equal(writes.at(-1).appearance.articleBackgroundColor,'#334968');
    assert.equal(writes.at(-1).appearance.articleBackgroundOpacity,.75);
    assert.deepEqual(writes.at(-1).social_links,profile.social_links);
    click('[data-author-back]'); await settle();
    click('[data-author-open="music"]');
    await settle();
    assert.equal(d.querySelector('[name="playlist_url"]'),null);
    assert.ok(d.querySelector('[data-upload="music"]'));
    assert.match(d.querySelector('[data-upload="music"]').getAttribute('accept'),/audio/);
    assert.ok(d.querySelector('[name="music_autoplay"]'));
    d.querySelector('[name="music_link_title"]').value='链接测试音乐';
    d.querySelector('[name="music_link_url"]').value='https://example.com/music.mp3';
    click('[data-add-track]');
    assert.equal(d.querySelectorAll('[data-track-source]').length,1);
    for(const [title,url] of [['第二首','https://example.com/two.mp3'],['第三首','https://example.com/three.mp3']]){
      d.querySelector('[name="music_link_title"]').value=title;
      d.querySelector('[name="music_link_url"]').value=url;click('[data-add-track]');
    }
    click('[data-track-source="https://example.com/three.mp3"] [data-move-track="-1"]');
    click('[data-track-source="https://example.com/three.mp3"] [data-move-track="-1"]');
    assert(d.querySelector('[data-track-source] [data-move-track="-1"]').disabled);
    click('[data-track-source="https://example.com/music.mp3"] [data-move-track="1"]');
    d.querySelector('[name="music_title"]').value = "新的歌单名称";
    d.querySelector('form').dispatchEvent(new w.Event('submit', {bubbles:true,cancelable:true}));
    await settle();
    assert.deepEqual(writes.at(-1).social_links, profile.social_links);
    assert.equal(writes.at(-1).music_settings.title, '新的歌单名称');
    assert.equal(writes.at(-1).music_settings.playlistUrl,profile.music_settings.playlistUrl,'preserve legacy data when saving in-site playback settings');
    assert.deepEqual(writes.at(-1).music_settings.tracks.map(t=>t.title),['第三首','第二首','链接测试音乐']);
    assert.deepEqual(writes.at(-1).music_settings.tracks.map(t=>t.url),['https://example.com/three.mp3','https://example.com/two.mp3','https://example.com/music.mp3']);
    click('[data-author-back]'); await settle();
    click('[data-author-open="profile"]'); await settle();
    click('[data-add-social]');
    const rows=d.querySelectorAll('.author-social-row'), row=rows[rows.length-1], url=row.querySelector('[name="social_url"]');
    url.value='https://space.bilibili.com/123'; url.dispatchEvent(new w.Event('input',{bubbles:true}));
    assert.equal(row.querySelector('[name="social_label"]').value, '哔哩哔哩');
    assert(row.querySelector('.platform-icon path'));
    click('[data-author-back]'); click('[data-discard]'); await settle();
    click('[data-author-open="announcements"]'); await settle(); click('[data-new]'); await settle();
    const link = d.querySelector('[name="link"]');
    assert.equal(link.value, ''); assert.equal(link.required, false); assert.equal(link.checkValidity(), true);
    assert(d.querySelector('.author-cover-preview.cover-frame--notice'));
    assert(d.querySelector('form').textContent.includes('12:5'));
    click('[data-author-back]'); await settle(); click('[data-author-back]'); await settle();
    click('[data-author-open="articles"]');
    await settle();
    assert(d.querySelector("[data-new]"));
    click('[data-new]'); await settle();
    assert(d.querySelector('.author-cover-preview:not(.cover-frame--notice)'));
    assert(d.querySelector('form').textContent.includes('16:9'));
    assert.equal(d.querySelectorAll('[data-article-template]').length,3);
    const bodyEditor = d.querySelector('.author-editor .tiptap');
    const paste = (text, html = '') => {
      const event = new w.Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: {
        getData: type => type === 'text/plain' ? text : type === 'text/html' ? html : '',
        files: [],
      } });
      bodyEditor.dispatchEvent(event);
      return event;
    };
    bodyEditor.focus();
    assert.equal(paste('').defaultPrevented, true, 'empty clipboard is consumed without the legacy hidden-input fallback');
    assert.equal(d.activeElement, bodyEditor, 'empty paste never transfers focus away from the editor');
    await settle();
    assert.equal(bodyEditor.textContent, '', 'empty paste leaves the document untouched');
    paste('阅读[内部链接说明](https://obsidian.md/help/links) · [反向链接说明](https://obsidian.md/help/plugins/backlinks)。');
    await settle();
    assert.deepEqual([...bodyEditor.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')]), [
      ['内部链接说明', 'https://obsidian.md/help/links'],
      ['反向链接说明', 'https://obsidian.md/help/plugins/backlinks'],
    ], 'pasted Markdown uses descriptive link text and keeps punctuation outside the URL');
    assert.equal(bodyEditor.textContent, '阅读内部链接说明 · 反向链接说明。');
    const savedBody = validateArticle({ title: '链接验收', slug: 'link-check', body: bodyEditor.innerHTML }, 'software').body;
    const visitorBody = JSDOM.fragment(cleanBody(savedBody, 'https://example.com', new Set()));
    assert.deepEqual([...visitorBody.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href'), a.target]), [
      ['内部链接说明', 'https://obsidian.md/help/links', '_blank'],
      ['反向链接说明', 'https://obsidian.md/help/plugins/backlinks', '_blank'],
    ], 'author saving and public rendering preserve text links');
    click('[data-format="undo"]'); await settle();
    assert.equal(bodyEditor.textContent, '', 'one undo removes the pasted content');
    paste('', '<p><strong>资料</strong>：[下载](https://obsidian.md/download)。<a href="https://obsidian.md/">已有链接</a></p>');
    await settle();
    assert.equal(bodyEditor.querySelector('strong').textContent, '资料');
    assert.deepEqual([...bodyEditor.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')]), [
      ['下载', 'https://obsidian.md/download'], ['已有链接', 'https://obsidian.md/'],
    ], 'rich text pasted from other applications preserves formatting and existing links');
    click('[data-format="undo"]'); await settle();
    paste('[带括号的页面](https://example.com/notes_(guide))。\n\n[另一段](https://example.com/next)');
    await settle();
    assert.deepEqual([...bodyEditor.querySelectorAll('a')].map(a => a.getAttribute('href')), [
      'https://example.com/notes_(guide)', 'https://example.com/next',
    ]);
    click('[data-format="undo"]'); await settle();
    paste('', '<p><code>[[笔记名称]]</code> 与 <code>[代码示例](https://example.com/)</code>，[无效](javascript:alert(1))</p>');
    await settle();
    assert.equal(bodyEditor.querySelectorAll('a').length, 0, 'code examples and unsafe links do not become active links');
    assert(bodyEditor.textContent.includes('[[笔记名称]]'));
    assert(bodyEditor.textContent.includes('[代码示例](https://example.com/)'));
    click('[data-format="undo"]'); await settle();
    const originalWriteCount=writes.length;
    paste('https://example.com/download'); await settle();
    assert.equal(bodyEditor.querySelector('a')?.getAttribute('href'),'https://example.com/download','a pasted URL automatically becomes a link');
    const selection=w.getSelection(),range=d.createRange();
    range.selectNodeContents(bodyEditor.querySelector('a'));selection.removeAllRanges();selection.addRange(range);
    d.dispatchEvent(new w.Event('selectionchange')); await settle();
    click('[data-text-color="#afe5d7"]');click('[data-text-font="Georgia"]');await settle();
    assert(bodyEditor.querySelector('a span[style*="color"]'),'author color applies inside the link');
    const colored=JSDOM.fragment(cleanBody(validateArticle({title:'颜色',slug:'color',body:bodyEditor.innerHTML},'articles').body,'https://example.com',new Set()));
    assert.equal(colored.querySelector('a span').style.color,'rgb(175, 229, 215)');
    assert.equal(colored.querySelector('a span').style.fontFamily,'Georgia');
    click('[data-format="undo"]');click('[data-format="undo"]');click('[data-format="undo"]');await settle();
    assert.equal(bodyEditor.textContent,'');
    click('[data-article-template="tutorial"]'); await settle();
    assert.equal(d.querySelector('[name="category"]').value,'技术笔记');
    assert(d.querySelector('.author-editor').textContent.includes('验证结果'));
    assert.equal(writes.length,originalWriteCount,'choosing an outline does not publish or save');
    click("[data-author-close]");
    click('[data-discard]');
    assert.equal(
      d.querySelector("#author-dialog").getAttribute("aria-hidden"),
      "true",
    );
    click('[data-author-login]'); await settle();
    click('[data-author-open="works"]'); await settle();
    click('[data-new]'); await settle();
    assert.equal(d.querySelector('#author-dialog-title').textContent,'新建作品');
    assert(d.querySelector('[name="external_url"]'));
    assert.match(d.querySelector('form').textContent,/上传软件文件/);
    click('[data-article-template="works"]'); await settle();
    assert.match(d.querySelector('.author-editor').textContent,/版本与运行环境/);
    assert.match(d.querySelector('.author-editor').textContent,/更新记录/);
    click('[data-author-close]'); click('[data-discard]');
    d.documentElement.lang='en';
    click('[data-author-login]'); await settle();
    assert.equal(d.querySelector('#author-dialog-title').textContent,'Author mode');
    click('[data-author-open="works"]');await settle();click('[data-new]');await settle();
    assert.equal(d.querySelector('#author-dialog-title').textContent,'New Work');
    assert.equal(d.querySelector('[name="title"]').value,'');
    assert.equal(d.querySelector('[data-article-template="works"]').textContent,'Software project');
    click('[data-author-back]');await settle();click('[data-author-back]');await settle();
    click('[data-author-open="appearance"]');await settle();
    assert(d.querySelector('[aria-label="Text and icon opacity"]'));
    assert(d.querySelector('[aria-label="Color hue"]'));
    click('[data-author-back]');await settle();click('[data-author-open="profile"]');await settle();
    assert.equal(d.querySelector('[name="signature"]').value,profile.signature,'switching UI language keeps authored values');
    click('[data-author-close]');
    d.documentElement.lang='zh-CN';click('[data-author-login]');await settle();
    click('[data-author-open="works"]');await settle();
    assert.equal(d.querySelector('#author-dialog-title').textContent,'作品');
    assert.deepEqual(errors, []);
  } finally {
    dom.window.close();
  }
});
