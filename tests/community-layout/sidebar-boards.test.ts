import test from 'node:test';
import assert from 'node:assert/strict';
import { sidebarCommunityBoards } from '../../src/community-layout/sidebar-boards.ts';

test('sidebar shows the first five ordinary boards followed by the existing VIP board', () => {
  const items = ['vip', 'qa', 'showcase', 'tools', 'moments', 'meta', 'ai', 'models'].map(id => ({ id }));
  const original = structuredClone(items);
  assert.deepEqual(sidebarCommunityBoards(items).map(item => item.id), ['qa', 'showcase', 'tools', 'moments', 'meta', 'vip']);
  assert.deepEqual(items, original, 'full catalog stays available to board directory and composing');
  assert.equal(sidebarCommunityBoards(items)[0], items[1]);
});

test('ordinary order selects the sidebar slots and a missing VIP board is never invented', () => {
  const items = ['ai', 'qa', 'showcase', 'tools', 'moments', 'meta'].map(id => ({ id }));
  assert.deepEqual(sidebarCommunityBoards(items).map(item => item.id), ['ai', 'qa', 'showcase', 'tools', 'moments']);
  assert.deepEqual(sidebarCommunityBoards([{ id: 'qa' }]), [{ id: 'qa' }]);
  assert.deepEqual(sidebarCommunityBoards([]), []);
});
