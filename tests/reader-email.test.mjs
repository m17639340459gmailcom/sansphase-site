import test from 'node:test';
import assert from 'node:assert/strict';
import { smtpConfigured, smtpTransportOptions } from '../server/payload/smtp-settings.ts';

const complete = { host: 'smtp.example.test', port: 465, user: 'reader', password: 'private-key', from: 'hello@example.test' };

test('registration remains unavailable for incomplete email settings', () => {
  assert.equal(smtpConfigured(undefined), false);
  for (const key of ['host', 'user', 'password', 'from']) {
    assert.equal(smtpConfigured({ ...complete, [key]: '' }), false, key);
  }
  assert.equal(smtpConfigured({ ...complete, port: 'invalid' }), false);
  assert.equal(smtpConfigured({ ...complete, from: 'not-an-address' }), false);
  assert.throws(() => smtpTransportOptions({ host: complete.host, from: complete.from }), /incomplete/);
});

test('SMTP uses encrypted transport for both implicit TLS and STARTTLS ports', () => {
  assert.equal(smtpConfigured(complete), true);
  const implicit = smtpTransportOptions(complete);
  assert.equal(implicit.secure, true);
  assert.equal(implicit.auth.pass, complete.password);
  assert.equal(implicit.connectionTimeout, 10000);
  const starttls = smtpTransportOptions({ ...complete, port: 587 });
  assert.equal(starttls.secure, false);
  assert.equal(starttls.requireTLS, true);
  assert.equal(smtpConfigured({ ...complete, connectAddress: 'not-an-ip' }), false);
  const resolved = smtpTransportOptions({ ...complete, connectAddress: '106.11.232.30' });
  assert.equal(resolved.host, '106.11.232.30');
  assert.equal(resolved.tls.servername, complete.host);
});
