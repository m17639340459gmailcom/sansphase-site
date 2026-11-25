import test from "node:test";
import assert from "node:assert/strict";
import { evaluateInWebGLBrowser } from "./helpers/webgl-browser.mjs";
import { createAdminConsolePreview } from "../scripts/preview-admin-console.ts";

const enabled = process.env.ADMIN_CONSOLE_BROWSER === "1";
const redesign = process.env.ADMIN_CONSOLE_REDESIGN_BROWSER === "1";
test(
  "local console: real login, search, VIP mutation, review and responsive layout",
  { skip: !enabled, timeout: 60000 },
  async () => {
    const preview = await createAdminConsolePreview({ port: 0, redesign });
    const origin = preview.origin;
    try {
      assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
      const errors = [];
      let id = 700;
      const result = await evaluateInWebGLBrowser(
        process.env.TEST_BROWSER_PATH ||
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "window.consoleTestResult",
        "about:blank",
        async (socket) => {
          const call = (method, params = {}) =>
            new Promise((resolve, reject) => {
              const current = id++;
              const receive = (event) => {
                const msg = JSON.parse(event.data);
                if (msg.id !== current) return;
                socket.removeEventListener("message", receive);
                if (msg.error || msg.result?.exceptionDetails)
                  reject(Error(JSON.stringify(msg)));
                else resolve(msg.result);
              };
              socket.addEventListener("message", receive);
              socket.send(JSON.stringify({ id: current, method, params }));
            });
          socket.addEventListener("message", (event) => {
            const msg = JSON.parse(event.data);
            if (msg.method === "Runtime.exceptionThrown")
              errors.push(msg.params.exceptionDetails.text);
          });
          await call("Runtime.enable");
          await call("Emulation.setDeviceMetricsOverride", {
            width: 1440,
            height: 960,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await call("Page.navigate", { url: origin + "/preview-login" });
          const evaluate = async (expression) =>
            (
              await call("Runtime.evaluate", {
                expression,
                returnByValue: true,
                awaitPromise: true,
              })
            ).result.value;
          await evaluate(
            `(async()=>{for(let i=0;i<80 && document.readyState!=='complete';i++)await new Promise(r=>setTimeout(r,50));const form=document.querySelector('#login');if(!form)throw Error('Demo login form missing');form.requestSubmit();})()`,
          );
          if (redesign) {
            let overview;
            for (let attempt = 0; attempt < 120; attempt++) {
              try {
                overview = await evaluate(`[...document.querySelectorAll('dl[aria-label="账号概况"] dd')].map(el=>el.textContent)`);
              } catch {}
              if (overview?.[0] === "26") break;
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            assert.deepEqual(overview, ["26", "23", "8", "5"]);
            const examples = await evaluate(`(async()=>{
              const [review,audit]=await Promise.all(['/api/manage/review','/api/manage/audit'].map(url=>fetch(url).then(response=>response.json())));
              return {expired:review.expired.map(row=>row.email), actions:audit.events.map(row=>row.action)};
            })()`);
            assert.ok(examples.expired.includes("expired-demo@example.test"));
            assert.deepEqual(examples.actions, ["remark", "disable", "vip-grant"]);
          } else {
            let siteReady = false;
            for (let attempt = 0; attempt < 120; attempt++) {
              try {
                siteReady = await evaluate('location.pathname === "/" && location.search.includes("mainPreview")');
              } catch {}
              if (siteReady) break;
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            assert.equal(siteReady, true, "legacy demo login redirects to the local main site");
          }
          await call("Page.navigate", { url: origin + "/admin-console/#/readers" });
          // Wait from CDP, because navigation destroys the previous JS context.
          let ready = false;
          for (let attempt = 0; attempt < 120; attempt++) {
            try {
              ready = await evaluate(
                `!!document.querySelector('[data-testid="reader-table"] tbody tr')`,
              );
            } catch {}
            if (ready) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          assert.equal(ready, true, "reader table rendered");
          assert.deepEqual(await evaluate(`(() => {
            const link = [...document.querySelectorAll('header a')].find(element => element.textContent === '返回主站');
            return link && { href: link.getAttribute('href'), target: link.getAttribute('target') };
          })()`), {
            href: redesign ? "http://localhost:4308/" : "/?mainPreview=1#/notes",
            target: null,
          }, "the return link opens the matching local main site in the same tab");
          const desktop = await evaluate(`(async()=>{
      const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,60));}throw Error('UI wait timed out');};
      const clickText=(selector,text)=>{const el=[...document.querySelectorAll(selector)].find(x=>x.textContent.includes(text));if(!el)throw Error('Missing '+text);el.click();};
      const rows=document.querySelectorAll('[data-testid="reader-table"] tbody tr').length;
      clickText('button','查看用户');await wait(()=>document.querySelector('[role="dialog"]'));
      const remark='设计联络 🐱 私有备注';
      const editRemark=async value=>{clickText('button','编辑备注');await wait(()=>document.querySelector('textarea[name="readerRemark"]'));const textarea=document.querySelector('textarea[name="readerRemark"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,value);textarea.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,30));};
      await editRemark(remark);clickText('button','保存备注');await wait(()=>!document.querySelector('textarea[name="readerRemark"]')&&document.querySelector('[role="dialog"]').textContent.includes(remark));
      clickText('button','增加指定天数');await wait(()=>document.querySelector('input[name="vipDays"]'));
      clickText('button','确认增加');await wait(()=>document.body.textContent.includes('操作成功'));
      const remarkSurvivedVip=document.querySelector('[role="dialog"]').textContent.includes(remark);
      clickText('button','关闭详情');await wait(()=>!document.querySelector('[role="dialog"]'));
      const search=document.querySelector('input[name="q"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      set.call(search,remark);search.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>document.querySelectorAll('[data-testid="reader-table"] tbody tr').length===1);
      const privateSearchLeaked=decodeURIComponent(location.hash).includes(remark)||Object.values(localStorage).some(value=>String(value).includes(remark));
      clickText('button','查看用户');await wait(()=>document.querySelector('[role="dialog"]'));await editRemark('');clickText('button','保存备注');await wait(()=>!document.querySelector('textarea[name="readerRemark"]')&&document.querySelector('[role="dialog"]').textContent.includes('暂未设置备注'));
      clickText('button','关闭详情');await wait(()=>!document.querySelector('[role="dialog"]'));
      set.call(search,'no-match-local-demo');search.dispatchEvent(new Event('input',{bubbles:true}));
      await wait(()=>document.body.textContent.includes('没有符合'));
      set.call(search,'');search.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>document.querySelector('[data-testid="reader-table"] tbody tr'));
      location.hash='#/profile-reviews';await wait(()=>document.querySelector('[data-testid="review-table"] tbody tr'));
      clickText('button','查看申请');await wait(()=>document.querySelector('[role="dialog"]'));
      clickText('button','驳回');await wait(()=>document.querySelector('textarea[name="reason"]'));
      const blocked=[...document.querySelectorAll('button')].find(x=>x.textContent==='确认驳回').disabled;
      clickText('button','返回申请');await wait(()=>[...document.querySelectorAll('button')].some(x=>x.textContent==='通过审核'));clickText('button','通过审核');await wait(()=>!document.querySelector('[role="dialog"]'));
      window.consoleTestResult={rows,blocked,remarkSurvivedVip,privateSearchLeaked,desktopOverflow:document.documentElement.scrollWidth>innerWidth};return window.consoleTestResult;
    })()`);
          assert.equal(desktop.rows, 20);
          assert.equal(desktop.blocked, true);
          assert.equal(desktop.remarkSurvivedVip, true);
          assert.equal(desktop.privateSearchLeaked, false);
          assert.equal(desktop.desktopOverflow, false);
          await call("Emulation.setDeviceMetricsOverride", {
            width: 390,
            height: 844,
            deviceScaleFactor: 1,
            mobile: true,
          });
          await evaluate(
            `(async()=>{location.hash='#/readers';await new Promise(r=>setTimeout(r,800));window.consoleTestResult.mobileOverflow=document.documentElement.scrollWidth>390 || innerWidth>390;window.consoleTestResult.mobileList=!!document.querySelector('[data-testid="reader-mobile"]');})()`,
          );
          if (redesign) {
            await call("Emulation.setDeviceMetricsOverride", {
              width: 320,
              height: 640,
              deviceScaleFactor: 1,
              mobile: true,
            });
            await evaluate(`(async()=>{
              location.hash='#/';
              for(let i=0;i<90&&!document.querySelector('dl[aria-label="账号概况"]');i++)await new Promise(r=>setTimeout(r,50));
              const summary=document.querySelector('dl[aria-label="账号概况"]');
              const controls=[...document.querySelectorAll('header :is(button,a)')].filter(el=>el.getClientRects().length);
              window.consoleTestResult.mobileOverview={
                summary:!!summary,
                width:document.documentElement.scrollWidth,
                toolbarControlRightEdges:controls.map(el=>Math.round(el.getBoundingClientRect().right)),
              };
            })()`);
          }
        },
      );
      assert.equal(result.mobileOverflow, false);
      assert.equal(result.mobileList, true);
      if (redesign) {
        const { summary, width, toolbarControlRightEdges } = result.mobileOverview;
        assert.equal(summary, true, "dashboard fits the mobile route");
        assert.ok(width <= 320, `dashboard document width is ${width}px`);
        assert.ok(toolbarControlRightEdges.length && toolbarControlRightEdges.every((edge) => edge <= 320),
          `dashboard toolbar controls end at ${toolbarControlRightEdges.join(", ")}px`);
      }
      assert.deepEqual(errors, []);
    } finally {
      await preview.close();
    }
  },
);
