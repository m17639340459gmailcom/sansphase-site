import { readdir, readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";

export function rewriteStaticHtml(html, delivery) {
  if (!delivery) return html;
  const base = delivery.origin + "/" + delivery.prefix + "/";
  const files = new Set(delivery.files.map(file => file.path));
  let result = html.replace(/<html\b([^>]*)>/, `<html$1 data-static-base="${base}">`);
  result = result.replace(/<(script|link)\b[^>]*>/g, tag => tag.replace(/\b(src|href)="(\.\/[^"#]+)"/, (match, attr, path) => {
    if (!files.has(path.slice(2).split(/[?#]/)[0])) return match;
    return `${attr}="${base}${path.slice(2)}" crossorigin="anonymous"`;
  }));
  return result;
}

export async function packageStaticFiles(root, origin) {
  if (!origin) return null;
  const files = [];
  async function visit(relative = "") {
    for (const entry of (await readdir(resolve(root, relative), {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("Static package cannot contain symlinks");
      if (entry.isDirectory()) {
        if (path === "chunks" || path === "assets" || (path.startsWith("assets/") && !/^assets\/(scene|site)(\/|$)/.test(path))) await visit(path);
      } else if (entry.isFile() && (/^[\w.-]+\.(?:m?js|css)$/.test(path) || path.startsWith("assets/") || /^chunks\/[\w.-]+\.mjs$/.test(path))) {
        const body = await readFile(resolve(root, path));
        files.push({path, bytes:body.length, sha256:createHash("sha256").update(body).digest("hex")});
      }
    }
  }
  await visit();
  const id = createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0,24);
  const prefix = `assets/site/${id}`;
  for (const file of files) {
    const destination = resolve(root, prefix, file.path);
    await mkdir(dirname(destination), {recursive:true});
    await copyFile(resolve(root,file.path), destination);
  }
  const delivery = {origin,prefix,files};
  await writeFile(resolve(root,"static-delivery.json"),JSON.stringify(delivery,null,2));
  await writeFile(resolve(root,"index.html"),rewriteStaticHtml(await readFile(resolve(root,"index.html"),"utf8"),delivery));
  return delivery;
}
