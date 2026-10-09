import { readdir, readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, posix } from "node:path";
import ts from 'typescript';

// Standard modulepreload lets the browser fetch the already required static
// graph together, without discovering each dependency after another round trip.
// Dynamic imports (the author editor and the landing sky) stay on demand.
async function staticModuleGraph(root, files, entry = 'app.mjs') {
  const available = new Set(files.map(file => file.path).filter(path => /\.m?js$/.test(path)));
  const visited = new Set();
  async function visit(path) {
    if (!available.has(path) || visited.has(path)) return;
    visited.add(path);
    const source = ts.createSourceFile(path, await readFile(resolve(root, path), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const statement of source.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), specifier.text));
      await visit(target);
    }
  }
  await visit(entry);
  return [...visited].filter(path => path !== entry).sort();
}

export function rewriteStaticHtml(html, delivery) {
  if (!delivery) return html;
  const base = delivery.origin + "/" + delivery.prefix + "/";
  const files = new Set(delivery.files.map(file => file.path));
  let result = html.replace(/<html\b([^>]*)>/, `<html$1 data-static-base="${base}">`);
  result = result.replace(/<(script|link)\b[^>]*>/g, tag => tag.replace(/\b(src|href)="(\.\/[^"#]+)"/, (match, attr, path) => {
    if (!files.has(path.slice(2).split(/[?#]/)[0])) return match;
    return `${attr}="${base}${path.slice(2)}" crossorigin="anonymous"`;
  }));
  const preloads = (delivery.modulepreloads || []).map(path => `<link rel="modulepreload" href="${base}${path}" crossorigin="anonymous">`).join('');
  result = result.replace('</head>', `${preloads}</head>`);
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
  const communityEntry = 'community-runtime-client.mjs';
  const communityModulepreloads = files.some(file => file.path === communityEntry)
    ? [communityEntry, ...await staticModuleGraph(root, files, communityEntry)] : [];
  const delivery = {origin,prefix,files,modulepreloads:await staticModuleGraph(root, files),communityModulepreloads};
  await writeFile(resolve(root,"static-delivery.json"),JSON.stringify(delivery,null,2));
  await writeFile(resolve(root,"index.html"),rewriteStaticHtml(await readFile(resolve(root,"index.html"),"utf8"),delivery));
  return delivery;
}
