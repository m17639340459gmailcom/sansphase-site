import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// The official Maven launcher is invoked without composing a shell command.
const run = promisify(execFile);
const localRuntime = resolve('.local/runtime/captcha');
const javaHome = process.env.JAVA_HOME || (process.platform === 'win32' ? join(localRuntime, 'jdk-21.0.12.1+1') : '');
const java = javaHome ? join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const maven = process.env.MAVEN_HOME || join(localRuntime, 'apache-maven-3.10.0');
const boot = (await readdir(join(maven, 'boot'))).filter(file => /^plexus-classworlds-.*\.jar$/.test(file));
if (boot.length !== 1) throw Error('Use a verified Maven installation containing one Classworlds launcher.');
const version = await run(java, ['-version']);
if (!/(?:openjdk|java) version "(?:2[1-9]|[3-9][0-9])\./.test(version.stderr)) throw Error('Login captcha service requires Java 21 or later.');
const project = resolve('server/login-captcha-service');
await access(join(project, 'pom.xml'));
const args = [ '-Dmaven.home=' + maven, '-Dmaven.multiModuleProjectDirectory=' + project,
  '-Dclassworlds.conf=' + join(maven, 'bin/m2.conf'), '-classpath', join(maven, 'boot', boot[0]),
  'org.codehaus.plexus.classworlds.launcher.Launcher', '-C', '-B', '-f', join(project, 'pom.xml'),
  '-Dmaven.repo.local=' + join(localRuntime, 'm2'), 'test', 'package' ];
try { const result = await run(java, args, { maxBuffer: 4 * 1024 * 1024, timeout: 240_000 }); process.stdout.write(result.stdout); process.stderr.write(result.stderr); }
catch (error) { if (typeof error.stdout === 'string') process.stdout.write(error.stdout); if (typeof error.stderr === 'string') process.stderr.write(error.stderr); throw Error('Captcha service build failed; no site or production data was changed.'); }
