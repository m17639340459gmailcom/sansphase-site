import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

// Deliberate source allowlist: no archives, generated website, credentials,
// database, uploads, browser profiles, migration exports or one-off experiments.
const trees=['src','public','server','tests','deploy','docs/assets'];
const singles=['.gitignore','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','server.mjs','README.md','ARCHITECTURE.md','THIRD_PARTY_NOTICES.md','docs/AUTHOR-GUIDE.md','docs/DEPLOYMENT.md','docs/STATIC-DELIVERY.md','docs/UPLOAD-15GB.md','docs/RELEASE-PROCESS.md','docs/RELEASE-PREPARATION-2026-09-15.md','scripts/build-site.mjs','scripts/build-cosmos.mjs','scripts/build-manifest.mjs','scripts/verify-site.mjs','scripts/dev.mjs','scripts/start.mjs','scripts/backup-payload.mjs','scripts/restore-payload.mjs','scripts/payload-account.mjs','scripts/healthcheck.mjs','scripts/scheduled-backup.mjs','scripts/publication-files.mjs','scripts/prepare-publication.mjs'];

export async function publicationFiles(root=resolve('.')) {
  const result=[...singles,'scripts/static-package.mjs','scripts/catalog-fixture-preview.mjs','scripts/fixtures/catalog-data.mjs','scripts/fixtures/music-demo.mjs','docs/CATALOG-DEMO.md','.gitattributes','.github/workflows/check.yml'];
  async function visit(directory) {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const path=resolve(directory,entry.name);
      if(entry.isSymbolicLink()) throw Error('Publication cannot contain symlinks');
      if(entry.isDirectory()) await visit(path);
      else if(entry.isFile()) result.push(relative(root,path).replaceAll('\\','/'));
    }
  }
  for(const tree of trees) await visit(resolve(root,tree));
  return [...new Set(result)].sort();
}

export async function scanPublication(root, paths, privateValues=[]) {
  const issues=[];
  for(const path of paths) {
    if(/(?:^|\/)(?:\.local|\.git|\.preview|outputs|archive|node_modules)(?:\/|$)|(?:^|\/)\.env(?:$|\.)|\.(?:db|sqlite3?|pem|key|pfx|log)$/i.test(path)) {
      issues.push({file:path,reason:'private-or-generated-path'});continue;
    }
    const bytes=await readFile(resolve(root,path));
    if(bytes.length>=100*1024**2) issues.push({file:path,reason:'source-file-too-large'});
    if(privateValues.some(value=>value.length>=8&&bytes.includes(Buffer.from(value)))) issues.push({file:path,reason:'known-private-value'});
    if(/\.(?:m?js|jsx|json|md|html|css|yml|yaml|env|conf|txt)$/.test(path)) {
      const text=bytes.toString('utf8');
      if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/.test(text)) issues.push({file:path,reason:'credential-pattern'});
    }
  }
  return issues;
}
