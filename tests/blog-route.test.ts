import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { blogSlug, blogPath, parseSiteRoute, mountBlogRouting } from '../src/blog-route.ts';

test('published article paths and legacy hashes resolve to the same reading route', () => {
  assert.deepEqual(parseSiteRoute('', '/blog/hello-world'), { page: 'note', id: 'hello-world' });
  assert.deepEqual(parseSiteRoute('#/note/hello-world', '/'), { page: 'note', id: 'hello-world' });
  assert.deepEqual(parseSiteRoute('#main', '/blog/hello-world'), { page: 'note', id: 'hello-world' });
  assert.deepEqual(parseSiteRoute('#/notes', '/blog/hello-world'), { page: 'notes', id: '' });
  assert.equal(blogPath('hello-world'), '/blog/hello-world');
  for (const path of ['/blog/no/slash', '/blog/%2f', '/blog/%', '/blog/UPPER', '/blog/' + 'a'.repeat(121)]) assert.equal(blogSlug(path), null);
});

test('article navigation preserves SPA interactions, clean URLs and back/forward without double renders', async () => {
  const dom = new JSDOM('<a id="back" href="/#/notes">Back</a><a id="next" href="/blog/second">Next</a><a id="anchor" href="#main">Body</a>', { url: 'https://site.test/blog/first' });
  const win = dom.window, events: Array<{oldURL: string; newURL: string}> = [];
  const cleanup = mountBlogRouting(win as unknown as Window, event => events.push(event));
  const tick = () => new Promise(resolve => setTimeout(resolve, 30));
  try {
    win.document.querySelector<HTMLAnchorElement>('#back')!.click();
    assert.equal(win.location.href, 'https://site.test/#/notes');
    assert.equal(events.length, 1);
    win.history.back(); await tick();
    assert.equal(win.location.pathname, '/blog/first');
    assert.equal(events.length, 2, 'popstate and hashchange must commit only once');
    win.document.querySelector<HTMLAnchorElement>('#next')!.click();
    assert.equal(win.location.pathname, '/blog/second');
    assert.equal(events.length, 3);
    win.history.back(); await tick();
    assert.equal(win.location.pathname, '/blog/first');
    assert.equal(events.length, 4, 'path-only history changes must render');
    win.location.hash = '#/works'; await tick();
    assert.equal(win.location.pathname, '/');
    assert.equal(events.length, 5);
    const modified = new win.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    win.document.querySelector('#next')!.dispatchEvent(modified);
    assert.equal(modified.defaultPrevented, false);
    assert.equal(events.length, 5);
  } finally { cleanup(); win.close(); }
});

test('article-only fragment navigation stays on the article without rerendering its body', async () => {
  const dom = new JSDOM('<main id="main">Body</main>', { url: 'https://site.test/blog/first' });
  let renders = 0;
  const cleanup = mountBlogRouting(dom.window as unknown as Window, () => { renders++; });
  try {
    dom.window.location.hash = '#main';
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(renders, 0);
    assert.deepEqual(parseSiteRoute('#main', dom.window.location.pathname), { page: 'note', id: 'first' });
  } finally { cleanup(); dom.window.close(); }
});

test('the retained local version stays on its own entry when opening and returning from an article', () => {
  const dom = new JSDOM('<a id="article" href="/blog/first">Read</a><a id="back" href="/#/notes">Back</a>', { url: 'http://127.0.0.1:4286/original#/notes' });
  const events: Array<{oldURL: string; newURL: string}> = [];
  const cleanup = mountBlogRouting(dom.window as unknown as Window, event => events.push(event));
  try {
    dom.window.document.querySelector<HTMLAnchorElement>('#article')!.click();
    assert.equal(dom.window.location.pathname, '/original');
    assert.equal(dom.window.location.hash, '#/note/first');
    assert.deepEqual(parseSiteRoute(dom.window.location.hash, dom.window.location.pathname), { page: 'note', id: 'first' });
    dom.window.document.querySelector<HTMLAnchorElement>('#back')!.click();
    assert.equal(dom.window.location.href, 'http://127.0.0.1:4286/original#/notes');
    assert.equal(events.length, 2);
  } finally { cleanup(); dom.window.close(); }
});

test('an explicitly retained production document keeps V1 article and collection links on its own entry', async () => {
  const dom = new JSDOM('<html data-frontend-entry="original"><body><a id="article" href="/blog/first">Read</a><a id="back" href="/#/notes">Back</a><a id="newtab" href="/blog/second" target="_blank">New tab</a></body></html>', { url: 'https://site.test/original#/notes' });
  const events: Array<{ oldURL: string; newURL: string }> = [];
  const cleanup = mountBlogRouting(dom.window as unknown as Window, event => events.push(event));
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector('#newtab')!.getAttribute('href'), '/original#/note/second');
    doc.querySelector<HTMLAnchorElement>('#article')!.click();
    assert.equal(dom.window.location.pathname, '/original'); assert.equal(dom.window.location.hash, '#/note/first');
    doc.querySelector<HTMLAnchorElement>('#back')!.click();
    assert.equal(dom.window.location.href, 'https://site.test/original#/notes'); assert.equal(events.length, 2);
    const later = doc.createElement('a'); later.href = '/blog/third'; doc.body.append(later); await Promise.resolve();
    assert.equal(later.getAttribute('href'), '/original#/note/third');
  } finally { cleanup(); dom.window.close(); }
});

test('retained version links have native v1 destinations for modified clicks, new tabs and copying', () => {
  const dom = new JSDOM('<a id="article" href="/blog/first?view=read">Read</a><a id="tab" href="/blog/second" target="_blank">New tab</a><a id="back" href="/?filter=one#/notes">Back</a><a id="foreign" href="https://other.test/blog/first">Other</a><a id="download" href="/blog/file" download>Download</a>', { url: 'http://127.0.0.1:4286/original#/notes' });
  let renders = 0;
  const cleanup = mountBlogRouting(dom.window as unknown as Window, () => { renders++; });
  const get = (id: string) => dom.window.document.getElementById(id) as HTMLAnchorElement;
  try {
    assert.equal(get('article').getAttribute('href'), '/original?view=read#/note/first');
    assert.equal(get('tab').getAttribute('href'), '/original#/note/second');
    assert.equal(get('back').getAttribute('href'), '/original?filter=one#/notes');
    assert.equal(get('foreign').href, 'https://other.test/blog/first');
    assert.equal(get('download').getAttribute('href'), '/blog/file');
    for (const [id, options] of [['article', { ctrlKey: true }], ['article', { metaKey: true }], ['tab', {}], ['article', { button: 1 }]] as const) {
      let preventedBeforeNative = true;
      // Inspect default ownership after the router, then avoid jsdom navigation.
      dom.window.document.addEventListener('click', event => { preventedBeforeNative = event.defaultPrevented; event.preventDefault(); }, { once: true });
      get(id).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
      assert.equal(preventedBeforeNative, false, `${id} retains the browser's native action`);
    }
    assert.equal(renders, 0); assert.equal(dom.window.location.hash, '#/notes');
  } finally { cleanup(); dom.window.close(); }
});

test('retained version adapts new and changed links and releases owned mutations and observers on cleanup', async () => {
  const dom = new JSDOM('<main></main>', { url: 'http://127.0.0.1:4286/original#/notes' });
  const cleanup = mountBlogRouting(dom.window as unknown as Window, () => {});
  const doc = dom.window.document;
  try {
    doc.querySelector('main')!.innerHTML = '<div><a href="http://[">Malformed URL</a><a id="dynamic" href="/blog/first">New article</a><a id="return" href="/index.html#/works">Return</a></div>';
    await Promise.resolve();
    const dynamic = doc.getElementById('dynamic') as HTMLAnchorElement;
    const back = doc.getElementById('return') as HTMLAnchorElement;
    assert.equal(dynamic.getAttribute('href'), '/original#/note/first');
    assert.equal(back.getAttribute('href'), '/original#/works');
    dynamic.setAttribute('href', '/blog/second?mode=read');
    await Promise.resolve();
    assert.equal(dynamic.getAttribute('href'), '/original?mode=read#/note/second');
    dynamic.remove(); await Promise.resolve();
    assert.equal(dynamic.getAttribute('href'), '/blog/second?mode=read', 'removed links release their owned href and cannot accumulate in the adapter');
    doc.querySelector('main')!.append(dynamic); await Promise.resolve();
    assert.equal(dynamic.getAttribute('href'), '/original?mode=read#/note/second');
    back.setAttribute('href', '/contact');
    cleanup(); cleanup();
    assert.equal(dynamic.getAttribute('href'), '/blog/second?mode=read', 'restore only the latest href owned by this adapter');
    assert.equal(back.getAttribute('href'), '/contact', 'cleanup cannot overwrite a newer external edit');
    const later = doc.createElement('a'); later.href = '/blog/after-cleanup'; doc.body.append(later);
    await Promise.resolve();
    assert.equal(later.getAttribute('href'), '/blog/after-cleanup', 'disconnected observers cannot adapt later renders');
  } finally { cleanup(); dom.window.close(); }
});

test('native link adaptation is limited to the exact retained loopback entry', async () => {
  for (const url of ['https://site.test/original#/notes', 'http://localhost:4286/original#/notes', 'http://127.0.0.1:4286/blog/first']) {
    const dom = new JSDOM('<a href="/blog/second">Article</a>', { url });
    const cleanup = mountBlogRouting(dom.window as unknown as Window, () => {});
    try {
      const link = dom.window.document.querySelector('a')!;
      assert.equal(link.getAttribute('href'), '/blog/second');
      link.setAttribute('href', '/blog/third'); await Promise.resolve();
      assert.equal(link.getAttribute('href'), '/blog/third');
    } finally { cleanup(); dom.window.close(); }
  }
});
