import test from 'node:test';
import assert from 'node:assert/strict';
import { validReaderNickname, readerNicknameLength } from '../src/reader-policy.ts';

test('nickname limit counts eight visible characters consistently for Chinese and emoji', () => {
  for (const name of ['一二三四五六七八', 'abcdefgh', '👩‍🚀'.repeat(8), '读者']) assert.equal(validReaderNickname(name), true, name);
  for (const name of ['一二三四五六七八九', 'abcdefghi', '👩‍🚀'.repeat(9), '字', '<名字>', '名\u200b字']) assert.equal(validReaderNickname(name), false, name);
  assert.equal(readerNicknameLength('e\u0301e\u0301'), 2);
});
