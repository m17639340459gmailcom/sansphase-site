import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { JSDOM } from "jsdom";
import { adminConsoleRequiredFiles } from '../server/admin-console-assets.ts';
import { verifyAdminConsoleDependencies } from './build-admin-console.ts';

export async function verifySite(root) {
  const base = resolve(root);
  const check = async (path) => {
    const local = resolve(base, path.replace(/^\//, "").split(/[?#]/)[0]);
    if (!local.startsWith(base + sep) || !(await stat(local)).isFile())
      throw new Error(`Missing build asset: ${path}`);
  };
  for (const file of adminConsoleRequiredFiles) await check(file);
  const adminHTML = new JSDOM(await readFile(resolve(base, 'admin-console/index.html'), 'utf8'));
  const entryPoints = [];
  try {
    if (adminHTML.window.document.querySelector('base')) throw Error('The admin-console must use its own same-origin asset base.');
    for (const element of adminHTML.window.document.querySelectorAll('[src], link[href]')) {
      const reference = element.getAttribute('src') || element.getAttribute('href');
      const url = new URL(reference, 'https://build.invalid/admin-console/index.html');
      if (url.origin !== 'https://build.invalid' || !url.pathname.startsWith('/admin-console/'))
        throw Error(`The admin-console assets must be same-origin and self-contained: ${reference}`);
      const path = decodeURIComponent(url.pathname).slice(1);
      await check(path);
      if (/\.(?:m?js|css)$/.test(path)) entryPoints.push(path);
    }
    for (const required of adminConsoleRequiredFiles.slice(1))
      if (!entryPoints.includes(required)) throw Error(`The admin-console HTML does not reference ${required}`);
  } finally { adminHTML.window.close(); }
  await verifyAdminConsoleDependencies(base, entryPoints);
  const files = await readdir(base);
  const pages = ['index.html', ...files.filter(file => file !== 'index.html' && file.endsWith('.html'))];
  for (const page of pages) {
    const html = await readFile(resolve(base, page), "utf8");
    const dom = new JSDOM(html);
    try {
      for (const el of dom.window.document.querySelectorAll("[src], link[href]")) {
        const path = el.getAttribute("src") || el.getAttribute("href");
        if (!/^(https?:|data:|#)/.test(path)) await check(path);
      }
    } finally { dom.window.close(); }
  }

  for (const file of await readdir(base)) {
    if (!/\.(mjs|css)$/.test(file)) continue;
    const text = await readFile(resolve(base, file), "utf8");
    for (const m of text.matchAll(/["'](\.?\/?assets\/[^"'\s]+)["']/g)) {
      if (!m[1].endsWith("/") && !m[1].includes("${")) await check(m[1]);
    }
    for (const m of text.matchAll(
      /(?:from\s*|import\s*\(|import\s*)["'](\.\/[^"']+\.mjs)["']/g,
    ))
      await check(m[1]);
  }
  for (const retired of [
    "flight.mjs",
    "flight-core.mjs",
    "space-renderer.bundle.mjs",
  ]) {
    if ((await readdir(base)).includes(retired))
      throw new Error(`Retired runtime leaked into build: ${retired}`);
  }
}
