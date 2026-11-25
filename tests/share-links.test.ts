import test from 'node:test';
import assert from 'node:assert/strict';
import { publicShareURL } from '../src/share-links.ts';

const post = '827fd106-eed2-4d05-b0ad-5bc3907484e3';
const reply = '927fd106-eed2-4d05-b0ad-5bc3907484e3';

test('public blog and post routes become crawlable links without browser-only query state', () => {
  assert.equal(publicShareURL('https://www.sansphase.com/blog/hello-world?v=local#main'),
    'https://www.sansphase.com/share/blog/hello-world');
  assert.equal(publicShareURL('https://www.sansphase.com/?communityTheme=light&v=local&token=private#/note/hello-world'),
    'https://www.sansphase.com/share/blog/hello-world');
  for (const origin of ['https://www.sansphase.com', 'https://community.sansphase.com', 'http://127.0.0.1:4244']) {
    assert.equal(publicShareURL(`${origin}/?token=private#/post/${post}`), `${origin}/share/post/${post}`);
    assert.equal(publicShareURL(`${origin}/#/post/${post}/reply/${reply}`), `${origin}/share/post/${post}`);
  }
});

test('site and community links have canonical sharing entry points', () => {
  for (const hash of ['', '#/', '#/home']) assert.equal(publicShareURL(`https://example.test/?v=local${hash}`), 'https://example.test/share/site');
  for (const hash of ['#/community', '#/community/home']) assert.equal(publicShareURL(`https://example.test/${hash}`), 'https://example.test/share/community');
  for (const route of ['site', 'community', 'blog/hello-world', `post/${post}`]) {
    assert.equal(publicShareURL(`https://example.test/share/${route}?token=private`), `https://example.test/share/${route}`);
  }
});

test('existing non-blog article sharing keeps its route while dropping query state', () => {
  for (const kind of ['work', 'software', 'resources', 'resource-center']) {
    assert.equal(publicShareURL(`https://example.test/?token=private&theme=dark#/${kind}/hello-world`), `https://example.test/#/${kind}/hello-world`);
  }
});

test('author previews, private routes and unrecognized routes never become public share links', () => {
  for (const url of [
    'https://example.test/?preview=draft#/note/hello-world',
    'https://example.test/?previewKind=notes#/note/hello-world',
    'https://example.test/?preview=#/note/hello-world',
    'https://example.test/#/admin',
    'https://example.test/#/account',
    'https://example.test/#/verify/private-token',
    'https://example.test/#/reset/private-token',
    'https://example.test/#/community/manage',
    'https://example.test/#/community/inbox',
    'https://example.test/#/community/edit/' + post,
    'https://example.test/api/author/preview',
    'https://example.test/unknown',
    'https://example.test/#/note/hello-world/edit',
  ]) assert.equal(publicShareURL(url), null, url);
});

test('invalid protocols, credentials, malformed escapes and non-canonical ids are rejected', () => {
  for (const url of [
    'javascript:alert(1)', 'data:text/plain,hello', 'not a url',
    'https://user:password@example.test/#/note/hello-world',
    'https://example.test/#/note/%',
    'https://example.test/#/note/hello%2Fworld',
    'https://example.test/#/note/hello%5Cworld',
    'https://example.test/#/note/hello%00world',
    'https://example.test/#/note/..',
    'https://example.test/#/note/hello?preview=draft',
    'https://example.test/#/post/not-a-uuid',
    `https://example.test/#/post/${post}/reply/private-token`,
    `https://example.test/#/post/${post}/edit`,
  ]) assert.equal(publicShareURL(url), null, url);
});
