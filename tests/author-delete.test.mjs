import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

test('author deletion confirms the named item, preserves unsaved edits on cancel/failure and refreshes all six lists',async()=>{
  const kinds=['articles','works','resources','software','resource-center','announcements'];
  const rows=new Map(kinds.map((kind,i)=>[kind,{id:`00000000-0000-4000-8000-00000000000${i}`,title:`${kind} <test>`,slug:'example-'+kind,status:'published',date_updated:'2026-09-17T00:00:00.000Z',body:'<p>Saved body</p>',attachments:[]} ]));
  const dom=new JSDOM('<button data-author-login>作者</button><script id="site-content" type="application/json">{"author":{"name":"作者"}}</script>',{url:'http://127.0.0.1:4176/#/works',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,d=w.document,writes=[];let failDelete=false;
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  w.Range.prototype.getClientRects=()=>[];
  w.Range.prototype.getBoundingClientRect=()=>({top:0,bottom:0,left:0,right:0,width:0,height:0});
  w.fetch=async(path,options={})=>{
    const parts=path.split('/'),kind=parts[4],row=rows.get(kind);
    if(options.method==='DELETE'){
      writes.push({path,body:JSON.parse(options.body)});
      if(failDelete){failDelete=false;return {ok:false,json:async()=>({error:'删除失败，请稍后重试。'})};}
      assert.equal(parts[5],row.id);rows.delete(kind);
      return {ok:true,json:async()=>({deleted:true,id:row.id})};
    }
    return {ok:true,json:async()=>path==='/api/content'?{}:parts[5]?structuredClone(row):row?[structuredClone(row)]:[]};
  };
  const modules=new Map(),context=dom.getInternalVMContext();
  async function load(url){
    if(modules.has(url.href))return modules.get(url.href);
    const mod=new vm.SourceTextModule(readFileSync(url,'utf8'),{context,identifier:url.href});modules.set(url.href,mod);
    await mod.link(spec=>load(new URL(spec,url)));return mod;
  }
  const settle=()=>new Promise(r=>setTimeout(r,40));
  const click=s=>{const el=d.querySelector(s);assert.ok(el,s);el.click();};
  const escape=()=>d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  try{
    await(await load(new URL('../dist/author.bundle.mjs',import.meta.url))).evaluate();
    click('[data-author-login]');await settle();
    for(const kind of kinds){
      click(`[data-author-open="${kind}"]`);await settle();click('[data-edit]');await settle();
      assert.ok(d.querySelector('[data-unpublish]'));
      const input=d.querySelector('[name="title"]');input.value='Unsaved title';input.dispatchEvent(new w.Event('input',{bubbles:true}));
      const count=writes.length;click('[data-delete-content]');
      const prompt=d.querySelector('.author-discard');assert.equal(prompt.hidden,false);
      assert.ok(prompt.textContent.includes(kind+' <test>'));assert.ok(prompt.textContent.includes('未保存'));
      assert.ok(d.querySelector('#author-dialog-content').hasAttribute('inert'));
      assert.equal(writes.length,count,'Opening confirmation does not delete');
      escape();assert.equal(prompt.hidden,true);assert.equal(input.value,'Unsaved title');
      click('[data-delete-content]');click('[data-keep-editing]');assert.equal(writes.length,count);
      if(kind==='articles'){
        failDelete=true;click('[data-delete-content]');click('[data-discard]');await settle();
        assert.match(d.querySelector('.author-feedback').textContent,/删除失败/);
        assert.equal(input.value,'Unsaved title');
        click('[data-author-back]');assert.equal(prompt.hidden,false);
        assert.ok(prompt.textContent.includes('还有未保存的修改'));assert.ok(!prompt.textContent.includes('确认删除'));
        click('[data-keep-editing]');
      }
      const item=rows.get(kind);click('[data-delete-content]');click('[data-discard]');await settle();
      assert.equal(d.querySelectorAll('[data-edit]').length,0);
      assert.match(d.querySelector('.author-feedback').textContent,/内容已删除/);
      assert.equal(writes.at(-1).body.confirmId,item.id);
      assert.equal(writes.at(-1).body.expectedUpdated,item.date_updated);
      click('[data-new]');await settle();assert.equal(d.querySelector('[data-delete-content]'),null,'Unsaved new entries are not deletable');
      click('[data-author-back]');await settle();click('[data-author-back]');await settle();
    }
  }finally{dom.window.close();}
});
