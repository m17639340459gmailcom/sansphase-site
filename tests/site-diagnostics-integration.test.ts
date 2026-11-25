import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPreviewServer } from '../server.mjs';

test('diagnostics stay unavailable by default', async t => {
  const server = createPreviewServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const path of ['config', 'report']) {
    const response = await fetch(`${base}/api/diagnostics/${path}`);
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  }
});

test('explicit local diagnostics precede middleware without changing normal requests', async t => {
  const calls: string[] = [];
  const server = createPreviewServer({
    diagnosticsService: {
      async handle(req: IncomingMessage, res: ServerResponse) {
        if (req.url !== '/api/diagnostics/report') return false;
        calls.push('local-diagnostics');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"local":true}');
        return true;
      },
    },
    requestMiddleware: async (_req: IncomingMessage, res: ServerResponse) => {
      calls.push('existing-middleware');
      res.writeHead(403); res.end();
    },
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const report = await fetch(`${base}/api/diagnostics/report`);
  assert.equal(report.status, 200);
  assert.deepEqual(await report.json(), { local: true });
  const normal = await fetch(base + '/api/community/me');
  assert.equal(normal.status, 403);
  await normal.arrayBuffer();
  assert.deepEqual(calls, ['local-diagnostics', 'existing-middleware']);
});

test('the diagnostic bootstrap switch comes from the explicit service, never stored content', async t => {
  for (const enabled of [false, true]) {
    const server = createPreviewServer({
      contentService: { snapshot: async () => ({ data: { notes: [], diagnostics: { enabled: true } } }) },
      ...(enabled ? { diagnosticsService: { handle: async () => false } } : {}),
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    t.after(() => new Promise<void>(done => server.close(() => done())));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const data = await fetch(`${base}/api/content?view=bootstrap`).then(response => response.json());
    assert.deepEqual(data.diagnostics, enabled ? { enabled: true } : undefined);
  }
});

test('a withheld production sample never leaks the stored diagnostic switch into bootstrap', async t => {
  const server = createPreviewServer({
    contentService: { snapshot: async () => ({ data: { notes: [], diagnostics: { enabled: true } } }) },
    diagnosticsService: { handle: async () => false, bootstrap: () => undefined },
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const data = await fetch(`${base}/api/content?view=bootstrap`).then(response => response.json());
  assert.equal(data.diagnostics, undefined);
});
