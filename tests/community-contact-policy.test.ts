import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, communityContactReason } from '../server/community-context.ts';

test('long web identifiers are not phone numbers, including linked and full-width digits', () => {
  for (const value of [
    '公告编号 1891380013800012345',
    '[公告公开转录](https://news.example.test/status/1891380013800012345)',
    '原始公告：https://news.example.test/status/1891380013800012345',
    '编号 １８９１３８００１３８０００１２３４５',
    '事件编号 913800138000',
    '版本编号 138001380001',
  ]) {
    assert.equal(communityContactReason(value), null, value);
    assert.equal(cleanText(value, [1, 500], '正文', true), value);
  }
});

test('phone protection still covers visible text, links and disguised phone separators', () => {
  for (const value of [
    '请联系 13800138000。',
    '有问题打 138 0013 8000 找我',
    '联系 +86 138-0013-8000',
    '联系 0086 138-0013-8000',
    '联系 １３８００１３８０００',
    '联系 138\u200b0013\u200b8000',
    '[联系 13800138000](https://news.example.test/status/1891380013800012345)',
    '[联系我](https://example.test/contact/13800138000)',
    '公告编号 1891380013800012345，联系 13800138000',
    '公告编号 1891380013800012345 13800138000',
  ]) {
    assert.match(communityContactReason(value) || '', /手机号/, value);
    assert.throws(() => cleanText(value, [1, 500], '正文', true), /手机号/, value);
  }
  assert.match(communityContactReason('vx：abcdef123') || '', /微信/);
  assert.equal(communityContactReason('微信公众号的文章怎么总结'), null);
});
