import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { evaluateInWebGLBrowser } from "./helpers/webgl-browser.mjs";
import { createAdminConsolePreview } from "../scripts/preview-admin-console.ts";

test(
  "local console keeps the original author hub, editing paths and settings with a round trip to account management",
  { skip: process.env.ADMIN_CONSOLE_BROWSER !== "1", timeout: 120000 },
  async () => {
    const preview = await createAdminConsolePreview({ port: 0 });
    try {
      let id = 1000;
      const errors = [];
      const result = await evaluateInWebGLBrowser(
        process.env.TEST_BROWSER_PATH ||
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "window.mainSiteResult",
        "about:blank",
        async (socket) => {
          const call = (method, params = {}) =>
            new Promise((resolve, reject) => {
              const current = id++;
              const receive = (event) => {
                const response = JSON.parse(event.data);
                if (response.id !== current) return;
                socket.removeEventListener("message", receive);
                if (response.error || response.result?.exceptionDetails)
                  reject(Error(JSON.stringify(response)));
                else resolve(response.result);
              };
              socket.addEventListener("message", receive);
              socket.send(JSON.stringify({ id: current, method, params }));
            });
          socket.addEventListener("message", (event) => {
            const message = JSON.parse(event.data);
            if (message.method === "Runtime.exceptionThrown")
              errors.push(message.params.exceptionDetails.text);
          });
          await call("Runtime.enable");
          const evaluate = async (expression) =>
            (
              await call("Runtime.evaluate", {
                expression,
                returnByValue: true,
                awaitPromise: true,
              })
            ).result.value;
          const wait = async (expression, description) => {
            for (let attempt = 0; attempt < 100; attempt++) {
              try { if (await evaluate(expression)) return; } catch {}
              await new Promise(resolve => setTimeout(resolve, 60));
            }
            throw Error(description + ": " + await evaluate("location.href+' '+document.body.innerText.slice(-1200)"));
          };
          const hub = `!!document.querySelector('#author-dialog:not([aria-hidden="true"]) .author-hub-heading')`;
          await call("Emulation.setDeviceMetricsOverride", {
            width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
          });
          await call("Page.navigate", { url: preview.origin + "/preview-login" });
          await wait("!!document.querySelector('#login')", "preview login loaded");
          await evaluate("document.querySelector('#login button').click()");
          await wait(hub, "demo login opens original author hub");
          const initial = await evaluate(`({
            pathname:location.pathname, mainPreview:new URLSearchParams(location.search).get('mainPreview'),
            originalTheme:!document.querySelector('[data-author-host="admin-console"]')&&!document.body.classList.contains('admin-author-open'),
            originalStyles:[...document.styleSheets].some(sheet=>sheet.href&&new URL(sheet.href).pathname==='/author.css'),
            entries:[...document.querySelectorAll('.author-menu-grid [data-author-open]')].map(node=>node.dataset.authorOpen),
            overflow:document.documentElement.scrollWidth>innerWidth
          })`);
          assert.equal(initial.pathname, "/");
          assert.equal(initial.mainPreview, "1");
          assert.equal(initial.originalTheme, true);
          assert.equal(initial.originalStyles, true);
          assert.deepEqual(initial.entries, ['announcements','articles','works','resources','software','resource-center','profile','background','music','appearance','admin']);
          assert.equal(initial.overflow, false);
          await evaluate(`window.testWait=async fn=>{for(let i=0;i<120;i++){if(fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('UI state wait timed out: '+document.body.innerText.slice(-1400));};window.testValue=(selector,value)=>{const node=document.querySelector(selector);Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));};`);
          const edited = await evaluate(`(async()=>{
            const result={kinds:[],settings:[],book:false};
            const hub=()=>!!document.querySelector('.author-hub-heading');
            for(const kind of ['articles','works','resources','software','resource-center','announcements']){
              document.querySelector('[data-author-open="'+kind+'"]').click();
              await testWait(()=>document.querySelector('.author-item-list[aria-busy="false"] [data-edit]'));
              document.querySelector('[data-edit]').click();
              await testWait(()=>document.querySelector('#author-dialog input[name="title"]'));
              if(kind==='articles'){
                testValue('#author-dialog input[name="title"]','原作者面板浏览器验证文章');
                document.querySelector('[data-save]').click();
                await testWait(()=>document.querySelector('.author-feedback')?.textContent.includes('草稿已保存'));
                document.querySelector('[data-publish]').click();
                await testWait(()=>document.querySelector('.author-feedback')?.textContent.startsWith('已发布'));
              }
              if(kind==='resource-center')result.book=!!document.querySelector('.author-book-chapters');
              if(kind!=='articles')document.querySelector('[data-author-back]').click();
              await testWait(()=>document.querySelector('.author-item-list[aria-busy="false"] [data-edit]'));
              if(kind==='articles')result.published=document.querySelector('.author-item-list').textContent.includes('原作者面板浏览器验证文章');
              result.kinds.push(kind);
              document.querySelector('[data-author-back]').click();await testWait(hub);
            }
            for(const kind of ['profile','background','music','appearance']){
              document.querySelector('[data-author-open="'+kind+'"]').click();
              await testWait(()=>!hub()&&document.querySelector('#author-dialog [data-author-back]')?.hidden===false);
              result.settings.push(kind);
              document.querySelector('[data-author-back]').click();await testWait(hub);
            }
            return result;
          })()`);
          assert.equal(edited.published, true);
          assert.equal(edited.book, true);
          assert.equal(edited.kinds.length, 6);
          assert.equal(edited.settings.length, 4);
          if (process.env.ADMIN_SCREENSHOTS === "1")
            await writeFile(".local/main-admin-original-hub.png", Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data,"base64"));
          await call("Emulation.setDeviceMetricsOverride", {
            width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
          });
          const mobile = await evaluate(`(async()=>{
            const hubOverflow=document.documentElement.scrollWidth>innerWidth;
            document.querySelector('[data-author-open="articles"]').click();
            await testWait(()=>document.querySelector('.author-item-list[aria-busy="false"] [data-edit]'));
            document.querySelector('[data-edit]').click();await testWait(()=>document.querySelector('.tiptap'));
            const editorOverflow=document.querySelector('.author-frame').getBoundingClientRect().right>innerWidth;
            document.querySelector('[data-author-back]').click();await testWait(()=>document.querySelector('.author-item-list[aria-busy="false"] [data-edit]'));
            document.querySelector('[data-author-back]').click();await testWait(()=>document.querySelector('.author-hub-heading'));
            return {hubOverflow,editorOverflow};
          })()`);
          assert.deepEqual(mobile, { hubOverflow: false, editorOverflow: false });
          await call("Emulation.setDeviceMetricsOverride", {
            width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
          });
          await evaluate("document.querySelector('#author-dialog [data-author-open=admin]').click()");
          await wait("location.pathname==='/admin-console/'&&location.hash.startsWith('#/readers')&&!!document.querySelector('[href=\"#/author-panel\"]')", "original hub opens retained account console");
          await evaluate("document.querySelector('[href=\"#/author-panel\"]').click()");
          await wait(hub, "account console returns directly to original hub");
          await call("Page.navigate", { url: preview.origin + "/admin-console/#/site-settings" });
          await wait(hub, "old settings bookmark opens original hub");
          await evaluate(`window.mainSiteResult={roundTrip:true,legacySettings:true,originalTheme:!document.querySelector('[data-author-host="admin-console"]')};`);
        },
      );
      assert.deepEqual(result, {roundTrip:true,legacySettings:true,originalTheme:true});
      assert.deepEqual(errors, []);
    } finally {
      await preview.close();
    }
  },
);
