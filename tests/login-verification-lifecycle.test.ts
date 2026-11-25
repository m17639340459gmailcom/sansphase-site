import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

type ReaderModule = Pick<typeof import('../src/reader-ui.ts'), 'readerPage' | 'mountReaderUI'>;
type RoutingModule = Pick<typeof import('../src/blog-route.ts'), 'parseSiteRoute' | 'mountBlogRouting'>;
type PendingChallenge = { aborted: boolean; complete(): void };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function waitFor(ready: () => boolean, message: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (ready()) return;
    await tick();
  }
  assert.ok(ready(), message);
}

let bundles: Promise<[string, string]> | undefined;
function sourceBundles() {
  if (!bundles) bundles = Promise.all([
    build({
      entryPoints: [fileURLToPath(new URL('../src/reader-ui.ts', import.meta.url))],
      bundle: true, write: false, format: 'iife', globalName: 'ReaderUI', platform: 'browser',
      target: 'es2022', jsx: 'automatic', loader: { '.css': 'empty' },
      define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
      plugins: [{ name: 'synthetic-login-solver', setup(builder) {
        builder.onResolve({ filter: /\/login-verification\.mjs$/ }, () => ({ path: 'login-adapter', namespace: 'lifecycle-test' }));
        builder.onLoad({ filter: /^login-adapter$/, namespace: 'lifecycle-test' }, () => ({
          contents: `export * from ${JSON.stringify(fileURLToPath(new URL('../src/login-verification.ts', import.meta.url)))};
            import {createLoginVerificationAcquirer} from ${JSON.stringify(fileURLToPath(new URL('../src/login-verification.ts', import.meta.url)))};
            export const acquireLoginVerification=createLoginVerificationAcquirer({load:async()=>globalThis.__verificationLibrary});`,
          resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        }));
      } }],
    }).then(output => output.outputFiles[0].text),
    build({
      entryPoints: [fileURLToPath(new URL('../src/blog-route.ts', import.meta.url))],
      bundle: true, write: false, format: 'iife', globalName: 'Routing', platform: 'browser',
      target: 'es2022', logLevel: 'silent',
    }).then(output => output.outputFiles[0].text),
  ]);
  return bundles;
}

async function fixture() {
  const dom = new JSDOM('<main id="main"></main>', {
    url: 'https://www.sansphase.com/#/account', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, d = w.document;
  const challenges: PendingChallenge[] = [], loginProofs: (string | null)[] = [];
  let solves = 0, renders = 0;
  Object.assign(w, {
    TextEncoder, TextDecoder,
    __verificationLibrary: { solveLoginChallenge: async () => `synthetic-proof-${++solves}` },
    fetch: async (path: string, options: RequestInit = {}) => {
      if (path === '/api/reader/login-challenge') {
        assert.equal(options.method, 'POST'); assert.equal(options.body, '{}');
        return new Promise<Response>(resolve => {
          let pending = true;
          const challenge: PendingChallenge = {
            aborted: false,
            complete() {
              pending = false;
              resolve(new Response(JSON.stringify({ enabled: true, engine: 'slider', challenge: {
                id: `synthetic-challenge-${challenges.indexOf(challenge)}`, token: 'synthetic-signed-token',
                expiresAt: Math.floor(Date.now() / 1000) + 120,
                backgroundImage: 'data:image/jpeg;base64,YQ==', templateImage: 'data:image/png;base64,Yg==',
                backgroundImageWidth: 600, backgroundImageHeight: 360, templateImageWidth: 110, templateImageHeight: 360,
              } }), { headers: { Date: new Date().toUTCString() } }));
            },
          };
          options.signal?.addEventListener('abort', () => { if (pending) challenge.aborted = true; }, { once: true });
          challenges.push(challenge);
        });
      }
      if (path === '/api/reader/login') {
        loginProofs.push(new Headers(options.headers).get('X-Login-Verification'));
        return new Response(JSON.stringify({ error: 'Synthetic sign-in rejection keeps the fixture on this page.' }), { status: 401 });
      }
      assert.fail(`Unexpected request in lifecycle fixture: ${path}`);
    },
  });
  const context = dom.getInternalVMContext();
  for (const code of await sourceBundles()) vm.runInContext(code, context);
  const ui = vm.runInContext('ReaderUI', context) as ReaderModule;
  const routing = vm.runInContext('Routing', context) as RoutingModule;
  let readerUI: ReturnType<ReaderModule['mountReaderUI']> | undefined;
  const render = () => {
    renders++;
    const route = routing.parseSiteRoute(w.location.hash, w.location.pathname);
    d.getElementById('main')!.innerHTML = route.page === 'account'
      ? ui.readerPage('account', '', null) : '<section data-synthetic-notes>Public notes</section>';
    readerUI?.route(route.page, route.id ?? '');
  };
  // Keep the actual main application ordering: identity renders are registered
  // before mountReaderUI installs its own identity lifecycle listeners.
  w.addEventListener('author:identity', () => render());
  w.addEventListener('reader:identity', () => render());
  const unroute = routing.mountBlogRouting(w as unknown as Window, () => render());
  readerUI = ui.mountReaderUI({ render, onIdentity() {}, readIdentity: () => null });
  render();
  const form = () => d.querySelector<HTMLFormElement>('[data-reader-form="login"]')!;
  const control = () => d.querySelector<HTMLButtonElement>('[data-login-verification-control]')!;
  const submit = () => form().querySelector<HTMLButtonElement>('[type="submit"]')!;
  const credentials = () => {
    form().querySelector<HTMLInputElement>('[name="email"]')!.value = 'synthetic-reader@example.test';
    form().querySelector<HTMLInputElement>('[name="password"]')!.value = 'synthetic-password';
  };
  const close = async () => {
    unroute(); d.getElementById('main')!.replaceChildren(); readerUI!.route('home', '');
    await tick(); w.close();
  };
  return { w, d, challenges, loginProofs, form, control, submit, credentials, close, renders: () => renders };
}

for (const eventName of ['reader:identity', 'author:identity']) {
  test(`${eventName} renders a fresh usable login gate without retaining the previous identity's proof`, async () => {
    const f = await fixture();
    try {
      f.challenges[0].complete();
      await waitFor(() => f.control().dataset.state === 'ready', 'Initial challenge should become ready');
      f.credentials(); f.control().click();
      await waitFor(() => f.control().dataset.state === 'verified', 'The synthetic old identity obtains a proof');
      const previousForm = f.form();
      f.w.dispatchEvent(new f.w.CustomEvent(eventName, { detail: null }));
      assert.notEqual(f.form(), previousForm, 'The main identity listener replaces the account form');
      assert.equal(f.challenges.length, 2, 'A replacement form must prepare its own challenge');
      f.challenges[1].complete();
      await waitFor(() => f.control().dataset.state === 'ready', 'Identity invalidation must not destroy the newly mounted login gate');
      assert.equal(f.challenges[1].aborted, false, 'The replacement preparation is still current');
      assert.equal(f.control().disabled, false);
      assert.equal(f.submit().disabled, true, 'The old proof cannot enable a replacement identity form');
      f.form().dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
      assert.equal(f.loginProofs.length, 0, 'The previous form proof cannot authorize a new login');
      f.credentials(); f.control().click();
      await waitFor(() => f.control().dataset.state === 'verified', 'A fresh explicit verification should work');
      f.form().dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => f.loginProofs.length === 1, 'The replacement form should allow a freshly verified login');
      assert.deepEqual(f.loginProofs, ['synthetic-proof-2']);
    } finally { await f.close(); }
  });
}

test('queued hash changes ending at the same account URL retain preparation and a usable verification gate', async () => {
  const f = await fixture();
  try {
    const originalForm = f.form();
    f.w.location.hash = '#/notes'; f.w.location.hash = '#/account';
    await tick(); await tick(); await tick();
    assert.equal(f.renders(), 1, 'The real router deduplicates the final URL');
    assert.equal(f.form(), originalForm);
    assert.equal(f.challenges[0].aborted, false, 'An irrelevant queued hash event must not cancel the retained form');
    f.challenges[0].complete();
    await waitFor(() => f.control().dataset.state === 'ready', 'Retained preparation should still become ready');
    assert.equal(f.control().disabled, false); assert.equal(f.submit().disabled, true);
    f.credentials(); f.control().click();
    await waitFor(() => f.control().dataset.state === 'verified', 'The retained gate can still verify');
    const password = f.form().querySelector<HTMLInputElement>('[name="password"]')!;
    password.value = 'changed-synthetic-password';
    password.dispatchEvent(new f.w.Event('input', { bubbles: true }));
    assert.equal(f.control().dataset.state, 'ready'); assert.equal(f.submit().disabled, true);
    f.form().dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(f.loginProofs.length, 0, 'Credential changes still invalidate the retained form proof');
  } finally { await f.close(); }
});

test('an actual route departure discards the old proof before a later account visit', async () => {
  const f = await fixture();
  try {
    f.challenges[0].complete();
    await waitFor(() => f.control().dataset.state === 'ready', 'Initial challenge should become ready');
    f.credentials(); f.control().click();
    await waitFor(() => f.control().dataset.state === 'verified', 'The old form obtains a proof');
    const previousForm = f.form();
    f.w.location.hash = '#/notes';
    await waitFor(() => Boolean(f.d.querySelector('[data-synthetic-notes]')), 'The route leaves the login form');
    assert.equal(previousForm.isConnected, false);
    f.w.location.hash = '#/account';
    await waitFor(() => f.challenges.length === 2, 'Returning to account prepares a fresh challenge');
    f.challenges[1].complete();
    await waitFor(() => f.control().dataset.state === 'ready', 'Returning account form should become ready');
    assert.notEqual(f.form(), previousForm); assert.equal(f.submit().disabled, true);
    f.form().dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(f.loginProofs.length, 0, 'A proof from the previous route cannot submit this form');
  } finally { await f.close(); }
});
