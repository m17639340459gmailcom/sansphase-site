import { readdir, readFile, writeFile, mkdir, copyFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, posix } from "node:path";
import ts from 'typescript';
import {parseDocument,DomUtils} from 'htmlparser2';
import { frontendV3StaticFiles, frontendV3StaticPrefix } from './frontend-v3-release.mjs';

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

function rewriteFrontendV2Html(html, delivery) {
  const base = delivery.origin + '/' + delivery.prefix + '/';
  const files = new Set(delivery.files.map(file => file.path));
  let result = rewriteStaticHtml(html, {...delivery,modulepreloads:[]});
  result = result.replace(/<(script|link)\b[^>]*>/g, tag => tag.replace(/\b(src|href)="(\/[^"#]+)"/, (match,attribute,path) => {
    const target = path === '/style.css' ? 'frontend-v2/style.css' : path.startsWith('/build/') ? 'frontend-v2' + path : null;
    if (!target || !files.has(target)) return match;
    return `${attribute}="${base}${target}" crossorigin="anonymous"`;
  }));
  const preloads = delivery.frontendV2Modulepreloads.map(path => `<link rel="modulepreload" href="${base}${path}" crossorigin="anonymous">`).join('');
  return result.replace('</head>',preloads+'</head>');
}

export async function packageStaticFiles(root, origin, frontendV3) {
  const frontend = await lstat(resolve(root,'frontend-v2')).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if (frontend && (!frontend.isDirectory() || frontend.isSymbolicLink())) throw Error('Invalid optional frontend directory');
  // Alternate frontends need immutable retained addresses even without a CDN.
  // Production installs these snapshots in the existing persistent public root.
  if (!origin && !frontend && !frontendV3) return null;
  origin ||= '';
  const files = [];
  async function visit(relative = "") {
    for (const entry of (await readdir(resolve(root, relative), {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("Static package cannot contain symlinks");
      if (entry.isDirectory()) {
        if (path === "chunks" || path === "assets" || path === 'frontend-v2' || path === 'frontend-v2/build' || (path.startsWith("assets/") && !/^assets\/(scene|site)(\/|$)/.test(path))) await visit(path);
      } else if (entry.isFile() && (/^[\w.-]+\.(?:m?js|css)$/.test(path) || path.startsWith("assets/") || /^chunks\/[\w.-]+\.mjs$/.test(path)
        || /^frontend-v2\/(?:style\.css|build\/[A-Za-z0-9_][A-Za-z0-9_.-]*-[A-Z0-9]{8}\.(?:js|css|woff2?|ttf))$/.test(path))) {
        const body = await readFile(resolve(root, path));
        files.push({path, bytes:body.length, sha256:createHash("sha256").update(body).digest("hex")});
      }
    }
  }
  await visit();
  // Next embeds the prefix while compiling, before the browser file hashes exist.
  const prefix = frontendV3
    ? frontendV3StaticPrefix(frontendV3.buildDirectory)
    : `assets/site/${createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0,24)}`;
  if (!prefix) throw Error('Missing frontend-v3 static prefix');
  if (frontendV3) files.push(...await frontendV3StaticFiles(frontendV3.appDirectory, frontendV3.buildDirectory, frontendV3.buildId));
  for (const file of files) {
    const destination = resolve(root, prefix, file.path);
    const source = file.path.startsWith('_next/static/')
      ? resolve(frontendV3.appDirectory, frontendV3.buildDirectory, file.path.slice('_next/'.length))
      : resolve(root, file.path);
    await mkdir(dirname(destination), {recursive:true});
    await copyFile(source, destination);
  }
  const communityEntry = 'community-runtime-client.mjs';
  const communityModulepreloads = files.some(file => file.path === communityEntry)
    ? [communityEntry, ...await staticModuleGraph(root, files, communityEntry)] : [];
  const delivery = {origin,prefix,files,modulepreloads:await staticModuleGraph(root, files),communityModulepreloads};
  if (frontend) {
    const html = await readFile(resolve(root,'frontend-v2/index.html'),'utf8');
    const entry = DomUtils.getElementsByTagName('script',parseDocument(html).children,true).find(node=>node.attribs.type==='module' && node.attribs.src?.startsWith('/build/'));
    const path = entry && 'frontend-v2' + entry.attribs.src;
    if (!path || !files.some(file=>file.path===path)) throw Error('Missing version 2 snapshot entry');
    delivery.frontendV2Modulepreloads = await staticModuleGraph(root, files, path);
    await writeFile(resolve(root,'frontend-v2/index.html'),rewriteFrontendV2Html(html,delivery));
  }
  await writeFile(resolve(root,"static-delivery.json"),JSON.stringify(delivery,null,2));
  await writeFile(resolve(root,"index.html"),rewriteStaticHtml(await readFile(resolve(root,"index.html"),"utf8"),delivery));
  return delivery;
}
