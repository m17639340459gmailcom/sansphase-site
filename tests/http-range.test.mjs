import test from 'node:test';
import assert from 'node:assert/strict';
import { byteRange } from '../server/http-range.ts';

test('byte ranges preserve inclusive start and end positions', () => {
  assert.deepEqual(byteRange('bytes=2-4', 10), { start: 2, end: 4 });
  assert.deepEqual(byteRange('bytes=8-', 10), { start: 8, end: 9 });
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange('bytes=-20', 10), { start: 0, end: 9 });
});

test('malformed ranges fall back to a full response, while unsatisfiable ranges reject', () => {
  assert.equal(byteRange('items=2-4', 10), null);
  assert.equal(byteRange('bytes=2-4,6-8', 10), null);
  assert.equal(byteRange('bytes=10-', 10), false);
  assert.equal(byteRange('bytes=-0', 10), false);
  assert.equal(byteRange('bytes=0-', 0), false);
});
