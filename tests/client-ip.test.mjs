import test from 'node:test';
import assert from 'node:assert/strict';
import { clientAddress } from '../server/client-ip.ts';

test('only a loopback proxy may supply the observed public IP', () => {
  assert.deepEqual(clientAddress({ socket: { remoteAddress: '203.0.113.7' }, headers: { 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '198.51.100.3' } }),
    { ip: '203.0.113.7', peerIp: '203.0.113.7', source: 'socket' });
  assert.deepEqual(clientAddress({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '198.51.100.2' } }),
    { ip: '198.51.100.2', peerIp: '127.0.0.1', source: 'local-proxy' });
  assert.deepEqual(clientAddress({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '198.51.100.2, 203.0.113.7', 'x-forwarded-for': '198.51.100.3' } }),
    { ip: '127.0.0.1', peerIp: '127.0.0.1', source: 'socket' });
});
