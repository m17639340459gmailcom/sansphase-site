import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiagnosticRoute, diagnosticLimits, normalizeDiagnosticEvent } from '../src/site-diagnostics-policy.ts';

test('diagnostic route labels never retain identifiers, query strings or unknown path text', () => {
  const cases = [
    ['/', '#/notes', 'notes'], ['/blog/a-private-reading-slug', '', 'note'],
    ['/', '#/note/private-id', 'note'], ['/', '#/post/secret-post-id/reply/private-reply', 'community-post'],
    ['/', '#/community/u/357341/frames', 'community-profile'], ['/', '#/community/manage/orders', 'community-management'],
    ['/', '#/community/new/qa', 'community-compose'], ['/', '#/community/boards/private-board', 'community-board'],
    ['/', '#/community/stardust/invites', 'community-stardust'], ['/', '#/community/shop/private-item', 'community-shop'],
    ['/share/invite/private-token', '', 'share'], ['/admin-console/', '', 'admin'],
    ['/private/user-data', '#/%ZZ', 'other'], ['/private/user-data', '', 'other'], ['/', '#/unrecognized-private-text', 'other'],
    ['/', '#/community/__proto__', 'other'], ['/', '#/community/constructor', 'other'],
  ] as const;
  for (const [pathname, hash, expected] of cases) {
    const actual = classifyDiagnosticRoute({ pathname, hash });
    assert.equal(actual, expected);
    assert.doesNotMatch(actual, /private|357341|token|secret/);
  }
});

test('normalization accepts only the exact anonymous event schema and bounded values', () => {
  const good = [
    { kind: 'vital', name: 'LCP', value: 1250, route: 'community-home' },
    { kind: 'vital', name: 'CLS', value: 0.125, route: 'note' },
    { kind: 'longtask', duration: 250, route: 'community-profile' },
    { kind: 'longtask', duration: 125_000, route: 'community-profile' },
    { kind: 'error', source: 'script', name: 'TypeError', line: 42, route: 'home' },
    { kind: 'error', source: 'promise', name: 'UnknownError', route: 'other' },
  ];
  for (const event of good) assert.deepEqual(normalizeDiagnosticEvent(event), event);
  const rejected: unknown[] = [null, [], {},
    ...good.map(event => ({ ...event, message: 'reader secret' })),
    ...good.map(event => ({ ...event, route: '#/community/u/357341' })),
    { ...good[0], value: NaN }, { ...good[0], value: Infinity }, { ...good[0], value: -1 },
    { ...good[0], value: 3_600_001 }, { ...good[1], value: 101 },
    { ...good[2], duration: 49 }, { ...good[2], duration: 3_600_001 },
    { ...good[4], name: 'private error text' }, { ...good[4], line: 1.5 },
    { ...good[4], asset: 'https://example.test/user/secret.jpg' },
    { ...good[5], source: 'custom' }, { ...good[5], stack: 'private stack' },
    { ...good[5], source: { toString: 'private text' } },
  ];
  for (const event of rejected) assert.equal(normalizeDiagnosticEvent(event), null);
  assert.deepEqual(diagnosticLimits, { batchEvents: 20, bodyBytes: 8192, pageEvents: 100, retentionMs: 86400000, maxEvents: 5000 });
});
