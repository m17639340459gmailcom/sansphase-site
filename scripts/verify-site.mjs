import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { JSDOM } from "jsdom";

export async function verifySite(root) {
  const base = resolve(root);
  const check = async (path) => {
    const local = resolve(base, path.replace(/^\//, "").split(/[?#]/)[0]);
    if (!local.startsWith(base + sep) || !(await stat(local)).isFile())
      throw new Error(`Missing build asset: ${path}`);
  };
  const html = await readFile(resolve(base, "index.html"), "utf8");
  const dom = new JSDOM(html);
  for (const el of dom.window.document.querySelectorAll("[src], link[href]")) {
    const path = el.getAttribute("src") || el.getAttribute("href");
    if (!/^(https?:|data:|#)/.test(path)) await check(path);
  }
  dom.window.close();

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
