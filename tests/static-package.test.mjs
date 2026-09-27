import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {packageStaticFiles,rewriteStaticHtml} from "../scripts/static-package.mjs";

test("static package preserves bytes, excludes HTML and private files, and creates a new version when content changes",async()=>{
  const root=await mkdtemp(join(tmpdir(),"sansphase-static-"));
  try {
    await mkdir(join(root,"assets/materials"),{recursive:true});
    await mkdir(join(root,"assets/scene"),{recursive:true});
    await writeFile(join(root,"app.mjs"),'export const value=1;');
    await writeFile(join(root,"assets/materials/normal.png"),Buffer.from([0,1,2,3]));
    await writeFile(join(root,"assets/scene/sky.jpg"),"unchanged separate scene delivery");
    await writeFile(join(root,"secret.env"),"must never be published");
    const html='<html lang="zh-CN"><head><script type="module" src="./app.mjs?v=1"></script></head><body><a href="#/notes">Notes</a><img src="/api/media/test"></body></html>';
    await writeFile(join(root,"index.html"),html);
    const first=await packageStaticFiles(root,"https://static.example");
    assert.deepEqual(first.files.map(x=>x.path),["app.mjs","assets/materials/normal.png"]);
    assert.deepEqual(await readFile(join(root,first.prefix,"assets/materials/normal.png")),Buffer.from([0,1,2,3]));
    const output=await readFile(join(root,"index.html"),"utf8");
    assert(output.includes(`src="https://static.example/${first.prefix}/app.mjs?v=1" crossorigin="anonymous"`));
    assert(output.includes('href="#/notes"'));assert(output.includes('src="/api/media/test"'));
    assert.equal(rewriteStaticHtml(html,null),html);
    await writeFile(join(root,"app.mjs"),'export const value=2;');
    await writeFile(join(root,"index.html"),html);
    const second=await packageStaticFiles(root,"https://static.example");
    assert.notEqual(first.prefix,second.prefix);
    assert.equal(await readFile(join(root,first.prefix,"app.mjs"),"utf8"),'export const value=1;');
  } finally {await rm(root,{recursive:true,force:true});}
});
