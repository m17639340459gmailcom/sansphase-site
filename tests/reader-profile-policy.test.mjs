import test from 'node:test';
import assert from 'node:assert/strict';
import { contactDetailReason } from '../server/reader-profile-policy.mjs';

test('obvious phone and WeChat details are rejected before human review', () => {
  for (const value of ['联系 13800138000', '+86 138-0013-8000', '微信号 abc123', 'V X：abc123', '加微聊聊'])
    assert.ok(contactDetailReason(value), value);
  assert.equal(contactDetailReason('在星光里继续阅读'), null);
});
