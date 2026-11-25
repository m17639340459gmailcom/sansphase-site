import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
test('repeated captcha packaging creates a fresh project jar and reproducible dependency bundle',
  { skip: process.env.SANSPHASE_CAPTCHA_BUILD_TEST !== '1', timeout: 240_000 }, async () => {
    const cwd = fileURLToPath(new URL('../', import.meta.url));
    let previous;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { stdout, stderr } = await run(process.execPath, ['scripts/build-login-captcha.mjs'],
        { cwd, windowsHide: true, timeout: 115_000, maxBuffer: 4 * 1024 ** 2 });
      assert.match(stdout, /BUILD SUCCESS/);
      assert.doesNotMatch(stdout + stderr, /overlapping classes/, 'an earlier shaded jar must never become the next build input');
      const bytes = await readFile(new URL('../server/login-captcha-service/target/login-captcha-service-1.0.0.jar', import.meta.url));
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (previous) assert.equal(digest, previous, 'unchanged source must produce identical release bytes');
      previous = digest;
    }
  });
