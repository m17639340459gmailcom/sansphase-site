import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { evaluateInWebGLBrowser } from "./helpers/webgl-browser.mjs";

test(
  "maintenance confirms exact selection, preserves failures, reports partial results, and clears private rows on lost access",
  {
    skip: process.env.ADMIN_CONSOLE_BROWSER !== "1",
    timeout: 60000,
  },
  async (t) => {
    const server = createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><body></body>");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    t.after(
      () =>
        new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        ),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const bundle = await build({
      stdin: {
        resolveDir: resolve("."),
        loader: "tsx",
        contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {CoreAdminContext,memoryStore} from 'react-admin';
    import {MaintenancePage,ActivityPage} from './src/admin-console/maintenance.tsx';
    const root=createRoot(document.querySelector('#root'));
    const auth={checkAuth:async()=>{if(window.lostAccess)throw Error('expired');},logout:async()=>{window.loggedOut=true;return false;},login:async()=>{},checkError:async()=>{}};
    window.mountMaintenanceFixture=(mode)=>root.render(<CoreAdminContext store={memoryStore()} authProvider={auth}>
      {mode==='activity'?<ActivityPage/>:<MaintenancePage/>}</CoreAdminContext>);`,
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "es2022",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const scenario = String.raw`(async(code)=>{
    const first='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',at='2026-10-12T08:00:00Z';
    const queues={expired:[],files:[{id:first,filename:'reader-avatar-'+first+'.webp',created_at:at},{id:second,filename:'reader-avatar-'+second+'.webp',created_at:at}],versions:[],media:[]};
    let failWrite=true,failRead=false,finishWrite;const requests=[];
    window.fetch=async(url,options={})=>{
      requests.push({url,body:options.body});
      if(url==='/api/manage/review')return failRead?Response.json({error:'读取暂时失败'},{status:503}):Response.json(queues);
      if(url==='/api/manage/review/files/cleanup')return failWrite?Response.json({error:'处理暂时失败'},{status:503}):new Promise(resolve=>{finishWrite=resolve;});
      if(url==='/api/manage/audit')return window.lostAccess?Response.json({error:'登录已失效'},{status:403}):Response.json({events:[{action:'remark',readerId:first,at,cleared:false,length:3,remark:'private sentinel'}]});
      throw Error('Unexpected '+url);
    };
    const errors=[];window.addEventListener('error',event=>errors.push(event.message));
    document.body.innerHTML='<div id="root"></div>';new Function(code)();window.mountMaintenanceFixture('maintenance');
    const wait=async fn=>{for(let i=0;i<140;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('UI wait timed out: '+document.body.textContent+' '+JSON.stringify(errors));};
    const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
    const click=text=>{const el=button(text);if(!el)throw Error('Missing '+text);el.click();};
    await wait(()=>document.body.textContent.includes('暂无待处理项目'));click('头像清理');
    await wait(()=>document.querySelectorAll('tbody input[type="checkbox"]').length===2);
    const noAutomaticWrite=requests.every(row=>!row.body);
    document.querySelector('tbody input[type="checkbox"]').click();await wait(()=>document.body.textContent.includes('已选 1 项'));
    click('处理所选项目');await wait(()=>document.querySelector('[role="dialog"]'));
    const exactPlan=document.querySelector('[role="dialog"]').querySelectorAll('li').length===1;
    click('确认处理所选');await wait(()=>document.body.textContent.includes('处理暂时失败'));
    const preservesError=document.querySelector('tbody input[type="checkbox"]').checked&&!!document.querySelector('[role="dialog"]');
    failWrite=false;click('确认处理所选');await wait(()=>finishWrite);
    const before=requests.length;button('正在处理…').click();
    const waitsForAck=button('正在处理…').disabled&&requests.length===before;
    finishWrite(Response.json({cleaned:0,failed:0,protected:1}));await wait(()=>!document.querySelector('[role="dialog"]'));
    const truthful=document.body.textContent.includes('仍在使用，保留 1 项')&&document.querySelector('tbody input[type="checkbox"]').checked;
    failRead=true;click('刷新列表');await wait(()=>document.body.textContent.includes('读取暂时失败'));
    const refreshPreserved=document.querySelectorAll('tbody input[type="checkbox"]').length===2&&document.querySelector('tbody input[type="checkbox"]').checked;
    const writes=requests.filter(row=>row.body).map(row=>JSON.parse(row.body).ids);
    window.mountMaintenanceFixture('activity');await wait(()=>document.body.textContent.includes('已保存备注（3 字）'));
    const noNoteBody=!document.body.textContent.includes('private sentinel');
    window.lostAccess=true;click('刷新记录');await wait(()=>window.loggedOut);
    const clearedPrivate=!document.body.textContent.includes('已保存备注（3 字）');
    return {noAutomaticWrite,exactPlan,preservesError,waitsForAck,truthful,refreshPreserved,noNoteBody,clearedPrivate,writes};
  })`;
    const result = await evaluateInWebGLBrowser(
      process.env.TEST_BROWSER_PATH ||
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      `${scenario}(${JSON.stringify(bundle.outputFiles[0].text)})`,
      `http://127.0.0.1:${address.port}/`,
    );
    assert.deepEqual(result, {
      noAutomaticWrite: true,
      exactPlan: true,
      preservesError: true,
      waitsForAck: true,
      truthful: true,
      refreshPreserved: true,
      noNoteBody: true,
      clearedPrivate: true,
      writes: [
        ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      ],
    });
  },
);
