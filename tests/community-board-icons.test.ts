import assert from 'node:assert/strict';
import { test } from 'node:test';
import { communityBoardIconChoices, communityBoardIcon, availableCommunityBoardIcons } from '../src/community-board-icons.ts';
import { defaultCommunityBoards, installCommunityBoardCatalog, resetCommunityBoardCatalog } from '../src/community.ts';

const reserveIds = ['bot', 'brain', 'cpu', 'workflow', 'code', 'lightbulb', 'book-open', 'flask', 'database', 'mic', 'video', 'palette', 'network', 'compass', 'wand', 'wrench'];

test('the board icon registry keeps all six legacy colors and provides sixteen AI-related reserves', () => {
  assert.equal(communityBoardIconChoices.length, 22);
  assert.equal(new Set(communityBoardIconChoices.map(icon => icon.id)).size, 22);
  for (const board of defaultCommunityBoards) {
    const icon = communityBoardIcon(board.icon);
    assert.ok(icon);
    assert.equal(icon.color, board.color);
    assert.equal(icon.lightColor, board.lightColor);
  }
  for (const id of reserveIds) {
    const icon = communityBoardIcon(id);
    assert.ok(icon, `${id} has metadata`);
    assert.ok(icon.zh.length > 0 && icon.en.length > 0);
    assert.match(icon.color, /^#[\da-f]{6}$/i);
    assert.match(icon.lightColor, /^#[\da-f]{6}$/i);
  }
});

test('available icons exclude every used symbol and return only registered choices', () => {
  assert.deepEqual(availableCommunityBoardIcons(defaultCommunityBoards).map(icon => icon.id), reserveIds);
  const items = [...defaultCommunityBoards, { icon: 'bot' }, { icon: 'bot' }, { icon: 'brain' }, { icon: 'unknown' }];
  assert.deepEqual(availableCommunityBoardIcons(items).map(icon => icon.id), reserveIds.slice(2));
  assert.deepEqual(availableCommunityBoardIcons(communityBoardIconChoices.map(icon => ({ icon: icon.id }))), []);
  assert.deepEqual(availableCommunityBoardIcons([]), communityBoardIconChoices);
});

test('the registry rejects unregistered values and protects shared metadata from mutation', () => {
  for (const value of [null, undefined, 1, {}, 'unknown', '__proto__', 'constructor', '<svg>', 'Bot', ' bot ']) assert.equal(communityBoardIcon(value), undefined);
  assert.ok(Object.isFrozen(communityBoardIconChoices));
  assert.ok(communityBoardIconChoices.every(Object.isFrozen));
});

test('new icon metadata is accepted by the catalog while unsupported values still reject the whole update', () => {
  resetCommunityBoardCatalog();
  try {
    const bot = communityBoardIcon('bot')!;
    const items = [...defaultCommunityBoards, { ...defaultCommunityBoards[0], id: 'ai-consulting', zh: 'AI 咨询', icon: bot.id, color: bot.color, lightColor: bot.lightColor }];
    assert.equal(installCommunityBoardCatalog({ version: 1, items }), true);
    assert.equal(installCommunityBoardCatalog({ version: 2, items: [...items, { ...items.at(-1)!, id: 'unsafe-icon', icon: 'unknown' }] }), false);
  } finally { resetCommunityBoardCatalog(); }
});
