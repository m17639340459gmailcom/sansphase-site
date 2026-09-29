// Fast rejection for obvious contact details. Human review is still required:
// arbitrary WeChat IDs and text embedded in images cannot be identified reliably.
export function contactDetailReason(value: unknown) {
  const normalized = String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\u200b-\u200d\u2060·._－—-]/gu, '');
  if (/(?:\+?86)?1[3-9]\d{9}/u.test(normalized)) return '个性签名不能包含手机号。';
  if (/(?:微信|微\s*信|wechat|weixin|vx|v信|wx号|加微|加v)/iu.test(normalized)) return '个性签名不能包含微信联系方式。';
  return null;
}
