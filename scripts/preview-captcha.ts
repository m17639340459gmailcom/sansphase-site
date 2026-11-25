// Shared by the isolated preview launchers. The service binds to loopback.
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer as createPortProbe } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { LoginVerificationSettings } from '../server/login-verification.ts';

const repository = fileURLToPath(new URL('../', import.meta.url));

export function validPort(port: number, allowAutomatic = false) {
  if (!Number.isInteger(port) || !(allowAutomatic && port === 0 || port >= 1024 && port <= 65535)) throw Error('Local port must be an integer between 1024 and 65535.');
  return port;
}
export async function availablePort(port: number) {
  validPort(port, true);
  const probe = createPortProbe();
  try { await new Promise<void>((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); }); }
  catch { throw Error('Requested loopback port is occupied. Stop only its known owner or choose another port.'); }
  const address = probe.address();
  if (!address || typeof address === 'string') throw Error('Local port has no TCP address.');
  await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()));
  return address.port;
}

export async function startCaptcha(settings: Pick<LoginVerificationSettings, 'serviceOrigin' | 'serviceSecret'>) {
  const port = Number(new URL(settings.serviceOrigin).port);
  await availablePort(port);
  const jar = resolve(repository, 'server/login-captcha-service/target/login-captcha-service-1.0.0.jar'); await access(jar);
  const javaHome = process.env.JAVA_HOME || (process.platform === 'win32' ? resolve(repository, '.local/runtime/captcha/jdk-21.0.12.1+1') : '');
  const java = javaHome ? resolve(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  const child = spawn(java, ['-Xms32m', '-Xmx192m', '-XX:ActiveProcessorCount=2', '-Djava.awt.headless=true', '-jar', jar], {
    cwd: repository, env: { ...process.env, PORT: String(port), CAPTCHA_SERVICE_SECRET: settings.serviceSecret }, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
  });
  let failed = false, exited = false;
  const exit = new Promise<void>(done => { child.once('error', () => { failed = true; exited = true; done(); }); child.once('exit', () => { failed = true; exited = true; done(); }); });
  const exitHook = () => { if (!exited) child.kill(); };
  process.once('exit', exitHook);
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    process.off('exit', exitHook);
    if (!exited) child.kill();
    const timeout = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 5000);
    await exit; clearTimeout(timeout);
  })();
  const deadline = Date.now() + 20000;
  while (!failed && Date.now() < deadline) {
    try {
      const response = await fetch(`${settings.serviceOrigin}/health`, { headers: { Authorization: `Bearer ${settings.serviceSecret}` }, signal: AbortSignal.timeout(1000) });
      const value: unknown = await response.json();
      if (response.ok && typeof value === 'object' && value !== null && 'ok' in value && value.ok === true && !failed) return { close, pid: child.pid, exited: exit };
    } catch { /* Wait only for this owned loopback service, never an external engine. */ }
    await delay(250);
  }
  await close(); throw Error('Dedicated local CAPTCHA did not become healthy within 20 seconds.');
}
