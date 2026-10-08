import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityListingFixture, owner, reader, listingIds as ids } from './fixtures/community-listing.mjs';

const setup = createCommunityListingFixture(test);

for (const sort of ['curated', 'published', 'newest', 'active']) {
  test(`${sort} listing rechecks visibility with summaries without loading complete threads or replies`, async t => {
    const f = await setup(t), inserted = [];
    for (let i = 0; i < 15; i++) inserted.push(f.topic(`列表读取主题 ${i}`, i / 100).id);
    for (const id of inserted.slice(-3)) for (let i = 0; i < 12; i++) f.store.addReply({
      topicId: id, author: reader('author'), body: `不应由列表读取的回复正文 ${i}`, now: f.ago(2),
    });
    const expected = f.store.listTopics({ sort, page: 1, pageSize: sort === 'curated' || sort === 'published' ? 6 : 20 }).items.map(topic => topic.id);
    const originalTopic = f.store.topic.bind(f.store);
    let detailReads = 0;
    f.store.topic = id => { detailReads++; return originalTopic(id); };

    const listing = await f.list(`topics?sort=${sort}`);
    assert.equal(detailReads, 0, 'a summary page must not load whole thread bodies and replies for every candidate');
    assert.deepEqual(ids(listing), expected, 'ranking and page boundaries remain unchanged');
    assert.equal(listing.total, inserted.length);
    assert.ok(listing.items.every(item => !('body' in item) && typeof item.replies === 'number'));
    assert.equal(JSON.stringify(listing).includes('不应由列表读取的回复正文'), false);
  });
}

for (const sort of ['curated', 'published']) {
  test(`${sort} summary recheck still removes newly hidden, deleted and moved-to-private candidates after people lookup`, async t => {
    const f = await setup(t), inserted = [];
    for (let i = 0; i < 12; i++) inserted.push(f.topic(`末次复核公开主题 ${i}`, i / 100).id);
    let changed = false;
    f.onPeople(() => {
      if (changed) return;
      changed = true;
      f.store.hide({ kind: 'topic', id: inserted[0] }, '测试隐藏');
      f.store.deleteTopic(inserted[1]);
      f.store.move(inserted[2], 'vip');
    });
    const listing = await f.list(`topics?sort=${sort}`);
    assert.equal(changed, true);
    assert.equal(listing.total, 9);
    assert.deepEqual(ids(listing), inserted.slice(3, 9));
    assert.ok(listing.items.every(item => item.board === 'qa'));
    assert.equal(JSON.stringify(listing).includes('末次复核公开主题 0"'), false);
    assert.equal(JSON.stringify(listing).includes('末次复核公开主题 1"'), false);
    assert.equal(JSON.stringify(listing).includes('末次复核公开主题 2"'), false);
  });
}

test('summary recheck still removes revoked private board access after people lookup', async t => {
  const f = await setup(t), publicIds = [];
  f.store.staff.appoint(owner, reader('mod'), { role: 'moderator', boards: ['qa', 'vip'], permissions: ['content.inspect'], delegable: [] });
  for (let i = 0; i < 8; i++) publicIds.push(f.topic(`只保留公开标题 ${i}`, 10 + i).id);
  for (let i = 0; i < 7; i++) f.topic(`READ-COST-PRIVATE-${i}`, i / 1000, { board: 'vip' });
  let revoked = false;
  f.onPeople(authors => {
    if (revoked || !authors.some(author => author.kind === 'owner')) return;
    revoked = true;
    f.store.staff.revoke(owner, reader('mod'));
  });
  const originalTopic = f.store.topic.bind(f.store);
  let detailReads = 0;
  f.store.topic = id => { detailReads++; return originalTopic(id); };
  const listing = await f.list('topics?sort=published', 'mod');
  assert.equal(detailReads, 0);
  assert.equal(revoked, true);
  assert.equal(listing.total, 8);
  assert.deepEqual(ids(listing), publicIds.slice(0, 6));
  assert.equal(JSON.stringify(listing).includes('READ-COST-PRIVATE'), false);
});

for (const sort of ['curated', 'published']) {
  test(`${sort} fills a concurrently shortened page with the replacement author's real identity`, async t => {
    const f = await setup(t), firstSix = [], requests = [];
    for (let i = 0; i < 6; i++) firstSix.push(f.topic(`初始页面站长主题 ${i}`, i / 100).id);
    const replacement = f.topic('补入另一位真实作者的主题', 1, { author: reader('author') });
    let removed = false;
    f.onPeople(authors => {
      requests.push([...new Set(authors.map(author => `${author.kind}:${author.id}`))]);
      if (removed || !authors.some(author => author.kind === 'owner')) return;
      removed = true;
      f.store.deleteTopic(firstSix[0]);
    });
    const listing = await f.list(`topics?sort=${sort}`);
    assert.equal(listing.total, 6);
    assert.equal(listing.items.length, 6);
    const item = listing.items.find(topic => topic.id === replacement.id);
    assert.ok(item);
    assert.equal(item.author.name, '帖子作者', 'a replacement is not an unqueried account falsely displayed as deleted');
    assert.equal(item.author.uid, '10004');
    assert.deepEqual(requests, [['owner:owner'], ['reader:author']], 'only the missing person is queried, not the full topic pool');
  });
}

test('a replacement moved into the private board during its identity lookup is removed again before sending', async t => {
  const f = await setup(t), firstSix = [], requests = [];
  for (let i = 0; i < 6; i++) firstSix.push(f.topic(`待复核公开主题 ${i}`, i / 100).id);
  const replacement = f.topic('REPLACEMENT-MOVED-PRIVATE', 1, { author: reader('author') });
  let removed = false, moved = false;
  f.onPeople(authors => {
    requests.push([...new Set(authors.map(author => `${author.kind}:${author.id}`))]);
    if (!removed && authors.some(author => author.kind === 'owner')) {
      removed = true;
      f.store.deleteTopic(firstSix[0]);
    } else if (removed && !moved && authors.some(author => author.id === 'author')) {
      moved = true;
      f.store.move(replacement.id, 'vip');
    }
  });
  const listing = await f.list('topics?sort=published');
  assert.equal(moved, true, 'mutation happens while the replacement identity is being awaited');
  assert.equal(listing.total, 5);
  assert.deepEqual(ids(listing), firstSix.slice(1));
  assert.equal(JSON.stringify(listing).includes('REPLACEMENT-MOVED-PRIVATE'), false);
  assert.deepEqual(requests, [['owner:owner'], ['reader:author']]);
});

test('replacement identity lookup still rechecks freshly revoked moderator visibility', async t => {
  const f = await setup(t), firstSix = [];
  f.store.staff.appoint(owner, reader('mod'), { role: 'moderator', boards: ['qa', 'vip'], permissions: ['content.inspect'], delegable: [] });
  for (let i = 0; i < 6; i++) firstSix.push(f.topic(i === 1 ? 'REPLACEMENT-REVOKED-PRIVATE' : `可见站长主题 ${i}`, i / 100, { board: i === 1 ? 'vip' : 'qa' }).id);
  const replacement = f.topic('实际读者作者的补入主题', 1, { author: reader('author') });
  let removed = false, revoked = false;
  f.onPeople(authors => {
    if (!removed && authors.some(author => author.kind === 'owner')) {
      removed = true;
      f.store.deleteTopic(firstSix[0]);
    } else if (removed && !revoked && authors.some(author => author.id === 'author')) {
      revoked = true;
      f.store.staff.revoke(owner, reader('mod'));
    }
  });
  const listing = await f.list('topics?sort=published', 'mod');
  assert.equal(revoked, true);
  assert.equal(listing.total, 5);
  assert.deepEqual(ids(listing), [...firstSix.slice(2), replacement.id]);
  assert.equal(listing.items.at(-1).author.name, '帖子作者');
  assert.equal(JSON.stringify(listing).includes('REPLACEMENT-REVOKED-PRIVATE'), false);
});

test('a queried replacement whose account really disappeared keeps the deleted-account fallback without repeated lookups', async t => {
  const f = await setup(t), firstSix = [], requests = [];
  for (let i = 0; i < 6; i++) firstSix.push(f.topic(`待填页主题 ${i}`, i / 100).id);
  const replacement = f.topic('真实注销作者的历史主题', 1, { author: reader('gone') });
  let removed = false;
  f.onPeople(authors => {
    requests.push([...new Set(authors.map(author => `${author.kind}:${author.id}`))]);
    if (removed || !authors.some(author => author.kind === 'owner')) return;
    removed = true;
    f.store.deleteTopic(firstSix[0]);
  });
  const listing = await f.list('topics?sort=curated');
  assert.equal(listing.items.find(topic => topic.id === replacement.id).author.name, '已注销用户');
  assert.deepEqual(requests, [['owner:owner'], ['reader:gone']], 'a missing answer from a real lookup does not trigger an endless retry');
});

test('a replacement latest replier is queried independently of its already known topic author', async t => {
  const f = await setup(t), firstSix = [], requests = [];
  for (let i = 0; i < 6; i++) firstSix.push(f.topic(`只认识主题作者 ${i}`, i / 100).id);
  const replacement = f.topic('补入主题的最后回复来自另一位读者', 100);
  f.store.addReply({ topicId: replacement.id, author: reader('vip'), body: '正文不应出现在榜单，最后回复作者需要正确。', now: f.ago(99) });
  let removed = false;
  f.onPeople(authors => {
    requests.push([...new Set(authors.map(author => `${author.kind}:${author.id}`))]);
    if (removed || !authors.some(author => author.kind === 'owner')) return;
    removed = true;
    f.store.deleteTopic(firstSix[0]);
  });
  const listing = await f.list('topics?sort=published');
  const item = listing.items.find(topic => topic.id === replacement.id);
  assert.equal(item.author.name, '测试站长');
  assert.equal(item.lastReply.author.name, '会员读者');
  assert.deepEqual(requests, [['owner:owner'], ['reader:vip']]);
});

test('continuous page replacement stops after two missing-person lookups and returns an explicit retry instead of a false deleted author', async t => {
  const f = await setup(t), firstSix = [], requests = [];
  for (let i = 0; i < 6; i++) firstSix.push(f.topic(`连续变动初始主题 ${i}`, i / 100).id);
  const replacements = [
    f.topic('第一次补入作者主题', 1, { author: reader('author') }).id,
    f.topic('第二次补入作者主题', 2, { author: reader('reader') }).id,
    f.topic('第三次补入作者主题', 3, { author: reader('vip') }).id,
  ];
  const removed = new Set();
  f.onPeople(authors => {
    const keys = [...new Set(authors.map(author => `${author.kind}:${author.id}`))];
    requests.push(keys);
    const id = keys.includes('owner:owner') ? firstSix[0]
      : keys.includes('reader:author') ? replacements[0]
      : keys.includes('reader:reader') ? replacements[1] : null;
    if (id && !removed.has(id)) { removed.add(id); f.store.deleteTopic(id); }
  });
  const response = await f.get('topics?sort=published');
  assert.equal(response.status, 409);
  const value = await response.json();
  assert.match(value.error, /更新|重试|重新/);
  assert.deepEqual(requests, [['owner:owner'], ['reader:author'], ['reader:reader']]);
  assert.equal(JSON.stringify(value).includes('已注销用户'), false);
});
