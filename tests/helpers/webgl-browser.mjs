// Optional GPU tests use a fresh browser profile; never attach to user tabs.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function evaluateInWebGLBrowser(browserPath, expression) {
  const prefix = join(tmpdir(), 'sansphase-webgl-test-');
  const profile = await mkdtemp(prefix);
  const browser = spawn(browserPath, ['--headless=new', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--enable-unsafe-swiftshader', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  let socket, launchError;
  browser.on('error', error => { launchError = error; });
  const stopped = new Promise(resolve => browser.once('exit', resolve));
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      if (launchError) throw launchError;
      port = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then(s => s.split('\n')[0], () => null);
      if (port) break;
      await delay(100);
    }
    if (!port) throw new Error('GPU test browser did not start');
    const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('GPU evaluation timed out')), 30000);
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error || message.result?.exceptionDetails)
          reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        else resolve(message.result.result.value);
      });
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    socket.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
    return result;
  } finally {
    socket?.close();
    browser.kill();
    await Promise.race([stopped, delay(2000)]);
    // Only the exact fresh profile made above is eligible for recursive cleanup.
    const owned = resolve(profile);
    if (!owned.startsWith(resolve(tmpdir()) + sep + 'sansphase-webgl-test-'))
      throw new Error('Refusing to clean an unexpected GPU-test profile');
    await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
