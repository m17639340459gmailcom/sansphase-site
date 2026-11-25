import assert from 'node:assert/strict';
import test from 'node:test';
import { DomUtils, parseDocument } from 'htmlparser2';
import { createFrontendIntegrationPreview } from '../scripts/preview-frontend-integration.ts';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

const builtV3 = process.env.SANSPHASE_TEST_V3_BUILD;
const browser = process.env.SANSPHASE_UI_TEST_BROWSER;

test('V3 material and software cards render authorized catalog covers with concise summaries', { skip: !builtV3, timeout: 240000 }, async () => {
  const site = await createFrontendIntegrationPreview({ frontend: 'v3', port: 0, buildAssets: false, v3AppDirectory: builtV3 });
  try {
    const signed = await fetch(`${site.origin}/api/reader/login`, {
      method: 'POST',
      headers: { Origin: site.origin, 'Content-Type': 'application/json', 'X-Reader-Request': '1' },
      body: JSON.stringify({ email: 'reader@example.test', password: 'DemoLogin2026!' }),
    });
    assert.equal(signed.status, 200);
    const cookie = signed.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const headers = { Cookie: cookie };
    for (const [path, kind, slug] of [
      ['/learning', 'resources', site.fixtures.slugs.resource],
      ['/software', 'software', site.fixtures.slugs.software],
    ]) {
      const content = await fetch(`${site.origin}/api/content?view=list&kind=${kind}`, { headers });
      assert.equal(content.status, 200);
      const { items } = await content.json();
      const item = items.find((entry: { id: string }) => entry.id === slug);
      assert.ok(item?.coverSrc);
      const page = await fetch(site.origin + path, { headers });
      assert.equal(page.status, 200, site.diagnostics());
      const elements = parseDocument(await page.text()).children;
      const card = DomUtils.findOne(node => node.name === 'a' && node.attribs.href === `${path}/${slug}`, elements);
      assert.ok(card, `${path} renders a link to the published detail`);
      const cover = DomUtils.findOne(node => node.name === 'img', card.children);
      assert.ok(cover, `${path} renders the cover inside the card`);
      assert.equal(cover.attribs.src, item.coverSrc, 'the browser requests the protected cover on the same origin');
      assert.match(cover.attribs.class ?? '', /\bobject-contain\b/, `${path} leaves the cover uncropped`);
      assert.ok(cover.parent && 'attribs' in cover.parent);
      assert.ok(cover.parent.attribs.class.split(/\s+/).includes('aspect-video'), `${path} uses the shared compact cover frame`);
      const summary = DomUtils.findOne(node => node.name === 'p', card.children);
      assert.match(summary?.attribs.class ?? '', /\bline-clamp-1\b/, `${path} allows one visible summary line when a cover exists`);
      const media = await fetch(site.origin + cover.attribs.src, { headers });
      assert.equal(media.status, 200);
      assert.match(media.headers.get('content-type') ?? '', /^image\//);
    }
  } finally {
    await site.close();
  }
});

test('V3 reads a real local publication and the existing share card returns to that article', { skip: !builtV3, timeout: 240000 }, async () => {
  const site = await createFrontendIntegrationPreview({ frontend: 'v3', port: 0, buildAssets: false, v3AppDirectory: builtV3 });
  try {
    const slug = site.fixtures.slugs.article;
    const content = await fetch(site.origin + '/api/content?view=detail&kind=notes&public=1&id=' + slug);
    assert.equal(content.status, 200);
    const { item } = await content.json();
    assert.equal(item.id, slug);
    const article = await fetch(site.origin + '/blog/' + slug);
    assert.equal(article.status, 200, site.diagnostics());
    assert.match(article.headers.get('cache-control') ?? '', /no-store|no-cache/);
    const document = await article.text();
    assert.ok(document.includes(item.title), 'renders original title');
    assert.ok(document.includes('data-reading-root'), 'uses the V3 reader');
    assert.ok(document.includes(item.attachments[0].name), 'renders the existing attachment');
    const visible = DomUtils.innerText(parseDocument(document).children);
    assert.ok(visible.includes('無相'));
    assert.ok(!visible.includes('演示作者'));
    const share = await fetch(site.origin + '/share/blog/' + slug);
    assert.equal(share.status, 200);
    assert.ok((await share.text()).includes(site.origin + '/blog/' + slug));
    assert.equal((await fetch(site.origin + '/share/blog/' + slug + '-draft')).status, 404);
    assert.equal((await fetch(site.origin + '/blog/' + slug + '-draft')).status, 404);
    assert.equal((await fetch(site.origin + '/blog/personal-knowledge-base-completed')).status, 404, 'never substitute a demo article for a missing publication');
  } finally {
    await site.close();
  }
});

test('V3 About archive uses published notes and retains filters and localized detail links', { skip: !builtV3, timeout: 240000 }, async () => {
  const site = await createFrontendIntegrationPreview({ frontend: 'v3', port: 0, buildAssets: false, v3AppDirectory: builtV3 });
  try {
    const slug = site.fixtures.slugs.article;
    const content = await fetch(`${site.origin}/api/content?view=detail&kind=notes&public=1&id=${slug}`);
    assert.equal(content.status, 200);
    const { item } = await content.json();
    const readArchive = async (path: string) => {
      const response = await fetch(site.origin + path);
      assert.equal(response.status, 200, site.diagnostics());
      const document = await response.text();
      const archive = document.match(/<section\b[^>]*\bid="blog"[^>]*>[\s\S]*?<\/section>/)?.[0];
      assert.ok(archive, `missing #blog on ${path}`);
      return { document, archive };
    };

    const query = new URLSearchParams({ q: '本地联调', category: item.category, tag: '本地联调' });
    const zh = await readArchive(`/about?${query}`);
    assert.ok(zh.archive.includes(item.title));
    assert.ok(zh.archive.includes(`href="/blog/${slug}"`));
    assert.ok(zh.archive.includes('action="/about#blog"'));
    assert.ok(zh.document.includes(`src="${String(item.coverSrc).replaceAll('&', '&amp;')}"`));
    assert.ok(!zh.document.includes(`/blog/${slug}-draft`));
    assert.ok(!zh.document.includes('/blog/personal-knowledge-base-completed'));

    const noMatches = await readArchive('/about?q=no-local-article-matches-this-string');
    assert.ok(noMatches.archive.includes('没有找到匹配的文章'));
    assert.ok(!noMatches.archive.includes(`href="/blog/${slug}"`));

    const en = await readArchive('/en/about');
    assert.ok(en.archive.includes(`href="/en/blog/${slug}"`));
    assert.ok(en.archive.includes('action="/en/about#blog"'));
  } finally {
    await site.close();
  }
});

test('V3 Home shows one recent entry and the publication count for each catalog without exposing protected records', { skip: !builtV3, timeout: 240000 }, async t => {
  const site = await createFrontendIntegrationPreview({ frontend: 'v3', port: 0, buildAssets: false, v3AppDirectory: builtV3 });
  try {
    const { article, work, resource, software, publicBook, vipBook } = site.fixtures.slugs;
    const catalogs = [
      ['works', work, '/projects'],
      ['resources', resource, '/learning'],
      ['resource-center', publicBook, '/resources'],
      ['software', software, '/software'],
    ] as const;
    const response = await fetch(site.origin);
    assert.equal(response.status, 200, site.diagnostics());
    const document = await response.text();
    assert.ok(document.includes('data-home-preloader'), 'the document includes the homepage opening');
    const signed = await fetch(`${site.origin}/api/reader/login`, {
      method: 'POST',
      headers: { Origin: site.origin, 'Content-Type': 'application/json', 'X-Reader-Request': '1' },
      body: JSON.stringify({ email: 'reader@example.test', password: 'DemoLogin2026!' }),
    });
    assert.equal(signed.status, 200);
    const cookie = signed.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const entries = [];
    for (const [kind, slug, path] of catalogs) {
      const detailUrl = `${site.origin}/api/content?view=detail&kind=${kind}&id=${slug}`;
      const detail = await fetch(detailUrl, { headers: { Cookie: cookie } });
      assert.equal(detail.status, 200, `${kind} fixture detail is readable by a member`);
      const { item } = await detail.json() as { item: { title: string; summary: string; coverSrc: string; bodyHTML?: string } };
      const cover = item.coverSrc.split('?')[0] + '?view=home-cover';
      const href = `${path}/${slug}`;
      assert.ok(document.includes(`href="${href}"`), `${kind} detail link is streamed`);
      const thumbnail = await fetch(`${site.origin}${cover}`, { method: 'HEAD' });
      assert.equal(thumbnail.status, 200);
      assert.equal(thumbnail.headers.get('content-type'), 'image/webp');
      entries.push({ kind, title: item.title, summary: item.summary, cover, href });
      assert.equal((await fetch(`${site.origin}/api/content?view=list&kind=${kind}&public=1`)).status, 401);
      assert.equal((await fetch(`${detailUrl}&public=1`)).status, 401);
      if (item.bodyHTML) {
        const body = parseDocument(item.bodyHTML).children;
        const subsection = DomUtils.findOne(node => node.name === 'h2', body);
        assert.ok(subsection, `${kind} fixture has a protected body marker`);
        assert.ok(!document.includes(DomUtils.textContent(subsection)), `${kind} body is absent from the homepage payload`);
      }
    }
    assert.ok(document.includes('按北京时间统计作品、资料、资源中心和软件推荐的首次发布。'));
    const responseActivity = await fetch(`${site.origin}/api/content?view=bootstrap&public=1&activity=resources&featured=1`);
    assert.equal(responseActivity.status, 200);
    const { featured, resourceActivity: { days } } = await responseActivity.json() as {
      featured: unknown;
      resourceActivity: { days: Array<{ date: string; works: number; materials: number; resourceCenter: number; software: number }> };
    };
    assert.ok(featured, 'the existing activity request includes the home showcase projection');
    const publicProjection = JSON.stringify(featured);
    for (const privateValue of [vipBook, '本地联调 · VIP 阅读测试', 'LOCAL VIP CHAPTER', 'LOCAL PUBLIC CHAPTER', 'bodyHTML', 'downloadUrl', 'attachments']) {
      assert.ok(!publicProjection.includes(privateValue), `protected data missing from public activity: ${privateValue}`);
    }
    for (const key of ['works', 'materials', 'resourceCenter', 'software'] as const) {
      assert.equal(days.reduce((total, day) => total + day[key], 0), 1, `${key} must count its published, non-VIP fixture`);
    }
    assert.match(document, /<meta name="robots" content="noindex, nofollow"/);
    assert.ok(document.includes(`<meta property="og:image" content="${site.origin}/share/cover.jpg"`));
    for (const path of [`/blog/${article}-draft`, '/blog/personal-knowledge-base-completed', `/resources/${vipBook}`]) {
      assert.ok(!document.includes(`href="${path}"`), `unexpected home detail link ${path}`);
    }
    for (const privateValue of ['本地联调 · VIP 阅读测试', 'LOCAL VIP CHAPTER', 'LOCAL PUBLIC CHAPTER', '未发布测试草稿']) {
      assert.ok(!document.includes(privateValue), `private content must not reach the homepage: ${privateValue}`);
    }
    await t.test('homepage sections after the browser places streamed fragments', { skip: !browser }, async () => {
      assert.ok(browser);
      const rendered = await evaluateInWebGLBrowser(browser, 'document.documentElement.outerHTML', site.origin);
      const elements = parseDocument(rendered).children;
      const development = DomUtils.findOne(node => node.name === 'section' && node.attribs.id === 'development', elements);
      assert.ok(development, 'the home showcase section is rendered');
      const cards = DomUtils.findAll(node => node.name === 'article', development.children);
      assert.equal(cards.length, entries.length, 'the existing four-card layout is retained');
      for (const [index, { kind, title, summary, cover, href }] of entries.entries()) {
        const card = cards[index];
        const heading = DomUtils.findOne(node => node.name === 'h3', card.children);
        assert.ok(heading && DomUtils.textContent(heading).includes(title), `${kind} card renders the fixture's actual title`);
        assert.ok(DomUtils.textContent(card).includes(summary), `${kind} card renders the fixture's actual summary`);
        assert.equal(DomUtils.findOne(node => node.name === 'img', card.children)?.attribs.src, cover, `${kind} uses the published cover variant`);
        const links = DomUtils.findAll(node => node.name === 'a', card.children);
        assert.ok(links.length > 0, `${kind} card is clickable`);
        for (const link of links) assert.equal(link.attribs.href, href, `${kind} card links to its own detail page`);
      }
      for (const id of ['featured-projects', 'site-publishing']) {
        const section = rendered.match(new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/section>`))?.[0];
        assert.ok(section?.includes(`href="/blog/${article}"`), `actual note missing from ${id}`);
      }
      const topics = rendered.match(/<section\b[^>]*\bid="reading-topics"[^>]*>[\s\S]*?<\/section>/)?.[0];
      assert.match(topics ?? '', /href="\/about\?category=[^"#]+#blog"/);
      const grid = DomUtils.findOne(node => node.attribs['aria-label'] === '近一年，共发布 4 项', elements);
      assert.ok(grid, 'the calendar displays the combined total');
      const positiveCells = DomUtils.findAll(node => node.name === 'button' && Number(node.attribs['data-count']) > 0, grid.children);
      assert.deepEqual(positiveCells.map(cell => [cell.attribs['data-date'], Number(cell.attribs['data-count'])]), days.map(day => [day.date, day.works + day.materials + day.resourceCenter + day.software]));
    });
  } finally {
    await site.close();
  }
});
