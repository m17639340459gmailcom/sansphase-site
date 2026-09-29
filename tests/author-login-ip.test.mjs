import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorService } from '../server/author-service.ts';

test('owner login records the observed address before releasing the cookie', async () => {
  const events = [], response = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
  const store = { login: async () => 'valid-token', identity: async () => ({ id: 'owner-id', first_name: 'Owner' }), logout: async () => {} };
  const service = createAuthorService({ url: 'http://127.0.0.1:8055', authorId: 'owner-id', store, loginLedger: { record: event => events.push(event) } });
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '198.51.100.24', 'user-agent': 'Test Browser' } };
  await service.loginCredentials(response, { email: 'OWNER@example.test', password: 'owner-pass' }, req);
  assert.equal(events.length, 1);
  assert.equal(events[0].actorType, 'owner');
  assert.equal(events[0].address.ip, '198.51.100.24');
  assert.match(response.headers['Set-Cookie'], /sansphase_author_session=/);
});
