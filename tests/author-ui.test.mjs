import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM, VirtualConsole } from "jsdom";

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
    ])
      assert(d.querySelector(`[data-author-open="${kind}"]`), kind);
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
    assert.equal(d.querySelector('[name="playlist_url"]').value, profile.music_settings.playlistUrl);
    assert.ok(d.querySelector('[data-upload="music"]'));
    assert.match(d.querySelector('[data-upload="music"]').getAttribute('accept'),/audio/);
    assert.ok(d.querySelector('[name="music_autoplay"]'));
    d.querySelector('[name="music_link_title"]').value='链接测试音乐';
    d.querySelector('[name="music_link_url"]').value='https://example.com/music.mp3';
    click('[data-add-track]');
    assert.equal(d.querySelectorAll('[data-track-source]').length,1);
    d.querySelector('[name="music_title"]').value = "新的歌单名称";
    d.querySelector('form').dispatchEvent(new w.Event('submit', {bubbles:true,cancelable:true}));
    await settle();
    assert.deepEqual(writes.at(-1).social_links, profile.social_links);
    assert.equal(writes.at(-1).music_settings.title, '新的歌单名称');
    assert.equal(writes.at(-1).music_settings.tracks[0].title,'链接测试音乐');
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
    const originalWriteCount=writes.length;
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
    assert.deepEqual(errors, []);
  } finally {
    dom.window.close();
  }
});
