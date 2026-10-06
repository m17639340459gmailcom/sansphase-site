import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import type { CommunityAuthor } from '../server/community-db.ts';

const reader = (id: string): CommunityAuthor => ({ kind: 'reader', id });
const at = '2026-10-06T00:00:00.000Z', old = '2025-10-01T00:00:00.000Z';
async function open(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-badge-test-'));
  const initial = new DatabaseSync(resolve(directory, 'content.db'));
  initial.exec('CREATE TABLE readers(id TEXT PRIMARY KEY,created_at TEXT)');
  initial.close();
  await migrateCommunity(directory);
  const store = createCommunityStore(directory), db = new DatabaseSync(resolve(directory, 'content.db'));
  t.after(async () => { store.close(); db.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { store, db, directory };
}
function topic(store: ReturnType<typeof createCommunityStore>, author: CommunityAuthor, now = old, board = 'qa') {
  return store.createTopic({ board, author, title: '用于徽章规则验证的主题', body: '只用测试数据库核对真实的公开贡献和荣誉记录。', now });
}

test('new tiers have durable evidence and legacy records survive repeated migrations', async t => {
  const { store, db, directory } = await open(t), me = reader('writer');
  store.members.award(me, 'good', old);
  topic(store, me);
  let state = store.members.badgeState(me, { now: Date.parse(at) });
  assert.equal(state.families.find(item => item.id === 'writing')?.tier, 'gold');
  assert.equal(state.families.find(item => item.id === 'appreciation')?.tier, null);
  assert.equal(state.legacy[0].id, 'good');
  const evidence = db.prepare("SELECT evidence FROM community_badge_honors WHERE family='writing' AND tier='gold'").get();
  assert.ok(JSON.parse(String(evidence?.evidence)).sources.length);
  await migrateCommunity(directory);
  assert.equal(store.members.badges(me)[0], 'good');
  const own = store.listTopics({ author: me, sort: 'newest', page: 1, pageSize: 20 }).items[0];
  store.deleteTopic(own.id, { now: at });
  state = store.members.badgeState(me, { now: Date.parse(at) });
  assert.equal(state.families.find(item => item.id === 'writing')?.tier, 'gold');
  assert.equal(state.families.find(item => item.id === 'writing')?.tiers[0].requirements[0].have, 0);
});

test('effective likes reject self likes, hidden/deleted parents, pending and private contributions', async t => {
  const { store, db } = await open(t), me = reader('writer');
  const valid = topic(store, me), hidden = topic(store, me), privateTopic = topic(store, me, old, 'vip');
  const reply = store.addReply({ topicId: hidden.id, author: me, body: '父主题隐藏后这条回复的点赞也不再计入有效贡献。', now: old });
  store.hide({ kind: 'topic', id: hidden.id }, '待复核', at);
  db.prepare('INSERT INTO community_reactions VALUES(?,?,?,?,?)').run('topic', valid.id, 'reader', me.id, old);
  for (let i = 0; i < 10; i++) {
    store.like({ kind: 'topic', id: valid.id }, reader(`v${i}`), true, { now: old });
    store.like({ kind: 'reply', id: reply.id }, reader(`h${i}`), true, { now: old });
    store.like({ kind: 'topic', id: privateTopic.id }, reader(`p${i}`), true, { now: old });
  }
  assert.equal(store.members.badgeMetrics(me, { now: Date.parse(at) }).appreciation.likes, 10);
  store.deleteTopic(valid.id, { now: at });
  assert.equal(store.members.badgeMetrics(me, { now: Date.parse(at) }).appreciation.likes, 0);
});

test('unlike/re-like and restoring content restart seven-day stability without adding contribution months', async t => {
  const { store } = await open(t), me = reader('writer'), liker = reader('liker');
  const first = topic(store, me);
  store.like({ kind: 'topic', id: first.id }, liker, true, { now: old });
  store.like({ kind: 'topic', id: first.id }, liker, false, { now: at });
  store.like({ kind: 'topic', id: first.id }, liker, true, { now: at });
  let m = store.members.badgeMetrics(me, { now: Date.parse(at) });
  assert.equal(m.appreciation.likes, 1);
  assert.equal(m.appreciation.stableLikes, 0);
  store.hide({ kind: 'topic', id: first.id }, '复核', at);
  store.restore({ kind: 'topic', id: first.id }, at);
  m = store.members.badgeMetrics(me, { now: Date.parse(at) + 6 * 86400000 });
  assert.equal(m.writing.stableTopics, 0);
  m = store.members.badgeMetrics(me, { now: Date.parse(at) + 7 * 86400000 });
  assert.equal(m.writing.stableTopics, 1);
  assert.equal(m.appreciation.stableLikes, 1);
});

test('makeups never earn early days; actual highest attendance honor survives a broken streak', async t => {
  const { store, db } = await open(t), me = reader('attendee');
  const insert = db.prepare('INSERT INTO community_checkins VALUES(?,?,?,?,?,?)');
  for (let i = 0; i < 100; i++) {
    const date = new Date(Date.parse(at) - i * 86400000).toISOString().slice(0, 10);
    insert.run('reader', me.id, date, 1, i === 0 ? 6 : 0, `${date}T00:00:00.000Z`);
    if (i === 0) db.prepare("INSERT INTO community_badge_events VALUES('early',?,?,?)").run(date, `reader:${me.id}`, `${date}T00:00:00.000Z`);
  }
  let state = store.members.badgeState(me, { now: Date.parse(at) });
  assert.equal(state.families[0].tier, 'diamond');
  assert.equal(store.members.badgeMetrics(me, { now: Date.parse(at) }).early.days, 1);
  state = store.members.badgeState(me, { now: Date.parse(at) + 4 * 86400000 });
  assert.equal(state.families[0].tier, 'diamond');
});

test('review revokes implicated honors and excludes confirmed fraud without automatic regrant', async t => {
  const { store } = await open(t), me = reader('writer'), owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
  const first = topic(store, me);
  assert.equal(store.members.badgeState(me, { now: Date.parse(at) }).families[2].tier, 'gold');
  store.members.reviewBadges(me, { family: 'writing', tier: 'gold', reason: '复核确认来源为重复发布', sources: [{ kind: 'topic', id: first.id }] }, owner, at);
  assert.equal(store.members.badgeState(me, { now: Date.parse(at) }).families[2].tier, null);
  assert.equal(store.members.badgeMetrics(me, { now: Date.parse(at) }).writing.topics, 0);
});

test('early sanction lift is not an appeal; an explicit appeal reversal removes the confirmed violation', async t => {
  const { store } = await open(t), me = reader('writer'), owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
  const sanction = store.members.mute(me, 7, '其他', owner, Date.parse(at));
  store.members.lift(sanction.id, at);
  assert.equal(store.members.badgeMetrics(me, { now: Date.parse(at) }).violations180, 1);
  store.members.reverseBadgeViolation('sanction', sanction.id, '申诉复核认定原处罚有误', owner, at);
  assert.equal(store.members.badgeMetrics(me, { now: Date.parse(at) }).violations180, 0);
});

test('Payload registration age wins over a newly created community row', async t => {
  const { store, db } = await open(t), me = reader('old-account');
  db.prepare('INSERT INTO readers VALUES(?,?)').run(me.id, old);
  store.members.ensure(me, at);
  assert.equal(store.members.badgeMetrics(me, { now: Date.parse(at) }).accountDays, 370);
  const state = store.members.badgeState(me, { now: Date.parse(at), joinedAt: at });
  assert.equal(state.families[0].tiers[2].requirements.find(item => item.key === 'accountDays')?.have, 370);
});

test('early rank does not shift after cleanup and later check-ins cannot inherit deleted places', async t => {
  const { store, db, directory } = await open(t), now = Date.parse(at);
  for (let i = 0; i < 11; i++) store.economy.checkin(reader(`bird-${i}`), { now: now + i * 1000 });
  assert.equal(store.members.badgeMetrics(reader('bird-10'), { now: now + 20000 }).early.days, 0);
  store.purgeReaderData('bird-0', () => {});
  assert.equal(store.economy.earlyBirds(now + 20000).length, 9);
  assert.ok(store.economy.earlyBirds(now + 20000).every(item => item.member.id !== 'bird-10'));
  const next = store.economy.checkin(reader('bird-11'), { now: now + 20000 });
  assert.equal(next.position, 12);
  assert.equal(store.members.badgeMetrics(reader('bird-11'), { now: now + 20000 }).early.days, 0);
  await migrateCommunity(directory);
  assert.equal(db.prepare('SELECT count FROM community_badge_checkin_ranks').get()?.count, 12);
});

test('cleanup anonymizes surviving honor and review receipts while keeping acquired rank', async t => {
  const { store, db } = await open(t), me = reader('survivor'), liker = reader('erased-reader');
  const first = topic(store, me);
  for (let i = 0; i < 9; i++) store.like({ kind: 'topic', id: first.id }, reader(`liker-${i}`), true, { now: old });
  store.like({ kind: 'topic', id: first.id }, liker, true, { now: old });
  const before = store.members.badgeState(me, { now: Date.parse(at) });
  assert.equal(before.families[3].tier, 'gold');
  store.purgeReaderData(liker.id, () => {});
  assert.equal(store.members.badgeState(me, { now: Date.parse(at) }).families[3].tier, 'gold');
  const receipts = db.prepare('SELECT evidence FROM community_badge_honors WHERE member_id=?').all(me.id);
  assert.ok(receipts.every(row => !String(row.evidence).includes(liker.id)));
  assert.ok(receipts.some(row => JSON.parse(String(row.evidence)).anonymizedSources > 0));
});

test('a reviewed reply reaction never revokes unrelated gold writing evidence', async t => {
  const { store } = await open(t), me = reader('writer'), owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
  topic(store, me);
  const question = topic(store, reader('asker'));
  const reply = store.addReply({ topicId: question.id, author: me, body: '这个回答获得认可以后，复核也不能误伤无关的第一篇主题荣誉。', now: old });
  for (let i = 0; i < 10; i++) store.like({ kind: 'reply', id: reply.id }, reader(`liker-${i}`), true, { now: old });
  store.members.reviewBadges(me, { family: 'appreciation', tier: 'gold', reason: '确认这条点赞无效', sources: [{ kind: 'reaction', id: `reply:${reply.id}`, actor: 'reader:liker-0' }] }, owner, at);
  const state = store.members.badgeState(me, { now: Date.parse(at) });
  assert.equal(state.families[2].tier, 'gold');
  assert.equal(state.families[3].tier, null);
});

test('only owner can restore a reviewed honor; original achievement time and all review receipts remain', async t => {
  const { store, db } = await open(t), me = reader('writer'), owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
  const first = topic(store, me);
  const original = store.members.badgeState(me, { now: Date.parse(at) }).families[2].achievedAt;
  const review = { family: 'writing' as const, tier: 'gold' as const, reason: '原审核误判，现已复核', sources: [{ kind: 'topic' as const, id: first.id }] };
  assert.throws(() => store.members.reviewBadges(me, review, reader('steward'), at), error => (error as { status?: number }).status === 403);
  store.members.reviewBadges(me, review, owner, at);
  assert.throws(() => store.members.restoreBadges(me, review, reader('steward'), at), error => (error as { status?: number }).status === 403);
  store.members.restoreBadges(me, review, owner, at);
  const state = store.members.badgeState(me, { now: Date.parse(at) });
  assert.equal(state.families[2].tier, 'gold');
  assert.equal(state.families[2].achievedAt, original);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_badge_honor_reviews').get()?.n, 2);
});

test('bulk qualification issues one highest-material notification per family and no badge currency', async t => {
  const { store, db } = await open(t), me = reader('attendee');
  for (let i = 0; i < 100; i++) {
    const date = new Date(Date.parse(at) - i * 86400000).toISOString().slice(0, 10);
    db.prepare('INSERT INTO community_checkins VALUES(?,?,?,?,?,?)').run('reader', me.id, date, 1, 6, `${date}T00:00:00.000Z`);
  }
  const balance = store.ledger.balance(me);
  const state = store.members.badgeState(me, { now: Date.parse(at) });
  assert.equal(state.families[0].tier, 'diamond');
  assert.equal(store.members.inbox(me).filter(row => row.type === 'badge').length, 1);
  assert.equal(store.ledger.balance(me), balance);
});

test('mistakenly revoked historical attendance can be restored after a normal broken streak', async t => {
  const { store, db } = await open(t), me = reader('attendee'), owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
  db.prepare('INSERT INTO readers VALUES(?,?)').run(me.id, '2024-01-01T00:00:00.000Z');
  for (let i = 0; i < 365; i++) {
    const date = new Date(Date.parse(at) - i * 86400000).toISOString().slice(0, 10);
    db.prepare('INSERT INTO community_checkins VALUES(?,?,?,?,?,?)').run('reader', me.id, date, 1, 6, `${date}T00:00:00.000Z`);
  }
  const original = store.members.badgeState(me, { now: Date.parse(at) }).families[0];
  assert.equal(original.tier, 'aurora');
  const later = '2026-10-20T00:00:00.000Z';
  assert.equal(store.members.badgeMetrics(me, { now: Date.parse(later) }).attendance.streak, 0);
  const review = { family: 'attendance' as const, tier: 'aurora' as const, reason: '原荣誉误撤，申诉复核成立' };
  store.members.reviewBadges(me, review, owner, later);
  store.members.restoreBadges(me, review, owner, later);
  const restored = store.members.badgeState(me, { now: Date.parse(later) }).families[0];
  assert.equal(restored.tier, 'aurora');
  assert.equal(restored.achievedAt, original.achievedAt);
  assert.equal(restored.tiers[2].eligible, false, 'historical honor differs from current progress');
});

test('explicit legacy review and restoration preserve the old achievement without minting a family tier', async t => {
  const { store } = await open(t), me = reader('legacy'), owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
  store.members.award(me, 'streak365', old);
  const review = { family: 'attendance' as const, tier: 'aurora' as const, legacyBadge: 'streak365', reason: '旧版荣誉申诉复核' };
  store.members.reviewBadges(me, review, owner, at);
  assert.deepEqual(store.members.badges(me), []);
  store.members.restoreBadges(me, review, owner, at);
  const state = store.members.badgeState(me, { now: Date.parse(at) });
  assert.deepEqual(store.members.badges(me), ['streak365']);
  assert.equal(state.families[0].tier, null);
  assert.equal(state.legacy[0].achievedAt, old);
});

test('all four content aurora families require actual twelve-month evidence and exclude self-acceptance', async t => {
  const { store, db } = await open(t), me = reader('long-term-writer');
  db.prepare('INSERT INTO readers VALUES(?,?)').run(me.id, '2024-01-01T00:00:00.000Z');
  const dates = Array.from({ length: 12 }, (_, i) => `${i < 3 ? 2025 : 2026}-${String((i + 9) % 12 + 1).padStart(2, '0')}-01T00:00:00.000Z`);
  const addTopic = db.prepare('INSERT INTO community_topics(id,board,author_kind,author_id,title,body,created_at,last_activity_at,featured,featured_at,badge_featured_since,accepted_reply_id,accepted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const addLike = db.prepare('INSERT INTO community_reactions VALUES(?,?,?,?,?)');
  const addReply = db.prepare('INSERT INTO community_replies(id,topic_id,author_kind,author_id,body,created_at) VALUES(?,?,?,?,?,?)');
  db.exec('BEGIN');
  for (let i = 0; i < 150; i++) {
    const date = dates[i % 12], id = `writing-${i}`, featured = i < 20;
    addTopic.run(id, 'qa', 'reader', me.id, '有效的跨月贡献主题', '这些数据只用于验证日期、稳定期、独立点赞者及精华数。', date, date, Number(featured), featured ? date : null, featured ? date : null, null, null);
    for (let j = 0; j < 10; j++) addLike.run('topic', id, 'reader', `liker-${(i * 10 + j) % 300}`, date);
  }
  for (let i = 0; i < 100; i++) {
    const date = dates[i % 12], id = `question-${i}`, reply = `answer-${i}`;
    addTopic.run(id, 'qa', 'reader', `asker-${i % 40}`, '有效的提问主题', '为不同提问者提供可复核的解决办法。', date, date, 0, null, null, reply, date);
    addReply.run(reply, id, 'reader', me.id, '这是一条实际被采纳、审核通过且公开可见的回复。', date);
  }
  db.exec('COMMIT');
  const metrics = store.members.badgeMetrics(me, { now: Date.parse(at) });
  assert.deepEqual([metrics.writing.topics, metrics.writing.stableRecognized, metrics.appreciation.likes, metrics.appreciation.people, metrics.answers.count, metrics.answers.people, metrics.featured.count], [150, 150, 1500, 300, 100, 40, 20]);
  assert.equal(metrics.writing.stableMonths, 12);
  const state = store.members.badgeState(me, { now: Date.parse(at) });
  assert.deepEqual(state.families.slice(2).map(row => row.tier), ['aurora', 'aurora', 'aurora', 'aurora']);
  db.prepare("UPDATE community_topics SET author_id=? WHERE id='question-0'").run(me.id);
  assert.equal(store.members.badgeMetrics(me, { now: Date.parse(at) }).answers.count, 99);
  assert.equal(store.members.badgeState(me, { now: Date.parse(at) }).families[4].tier, 'aurora', 'normal progress changes keep a confirmed honor');
});

test('cancelling and re-featuring the same topic does not create a new month and restarts stability', async t => {
  const { store } = await open(t), me = reader('writer');
  const first = topic(store, me);
  store.setFeatured(first.id, true, { now: old });
  assert.equal(store.members.badgeMetrics(me, { now: Date.parse(at) }).featured.stableCount, 1);
  store.setFeatured(first.id, false, { now: at });
  store.setFeatured(first.id, true, { now: at });
  const metrics = store.members.badgeMetrics(me, { now: Date.parse(at) });
  assert.equal(metrics.featured.count, 1);
  assert.equal(metrics.featured.months, 1);
  assert.equal(metrics.featured.stableCount, 0);
});

test('moving restricted content into a public board begins its public stability observation', async t => {
  const { store } = await open(t), me = reader('writer');
  const first = topic(store, me, old, 'vip');
  assert.equal(store.members.badgeMetrics(me, { now: Date.parse(at) }).writing.topics, 0);
  store.move(first.id, 'qa', at);
  const metrics = store.members.badgeMetrics(me, { now: Date.parse(at) });
  assert.equal(metrics.writing.topics, 1);
  assert.equal(metrics.writing.stableTopics, 0);
});
